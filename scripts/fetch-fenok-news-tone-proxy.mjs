#!/usr/bin/env node
/**
 * Fetch a bounded GDELT headline sample and build a Fenok news tone proxy.
 *
 * Raw article rows stay under _private/admin. The computed output contains only
 * derived scores and compact provenance.
 */

import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

import {
  attemptResult,
  classifyEndpointResponse,
  defaultAttemptId,
  returnedTuple,
  threwTuple,
  transportError,
  writeAttemptShard,
} from "./lib/data-supply-attempt-shard.mjs";
import {
  LaneLkgStore,
  PROMOTION_CONTRACT_PROVIDER_OBSERVATION_V2,
  buildProviderObservationV2,
} from "./lib/data-supply-lkg-store.mjs";
import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");
const privateRoot = path.join(repoRoot, "_private", "admin", "fenok-flow", "gdelt_news");

const LANE_ID = "gdelt_news_tone";
const ATTEMPT_SHARD_PATH = path.join(
  repoRoot, "data", "admin", "data-supply-state", "detection-attempts", `${LANE_ID}.json`,
);

const FORMULA_VERSION = "fenok-news-tone-proxy-v0.1-gdelt-headlines";
const OUTPUT_FILE = "computed/fenok_news_tone_proxy.json";
const HISTORY_FILE = "computed/fenok_news_tone_proxy_history.json";
// Match the FINRA daily marker-history sibling: retain the newest 100 distinct
// provider source dates for this one artifact, never an unbounded ticker-row set.
const MAX_GDELT_HISTORY_SOURCE_DATES = 100;
const GDELT_HISTORY_PERSISTENCE_POLICY = Object.freeze({
  schema_version: "gdelt-news-tone-bounded-persistence/v1",
  basis: "provider_source_date",
  scope: "per_artifact",
  max_distinct_source_dates: MAX_GDELT_HISTORY_SOURCE_DATES,
  eviction: "oldest_source_date_first",
});
const LKG_ARTIFACT_KEY = "news_tone_proxy";
const DEFAULT_REFERENCE_TICKERS = ["DASH", "UNH", "PYPL", "RDDT", "COIN", "MU", "PLTR", "NVDA"];
const LEGACY_TOC_COMPANY_NAMES = Object.freeze({
  DASH: "DoorDash",
  UNH: "UnitedHealth",
  PYPL: "PayPal",
  RDDT: "Reddit",
  COIN: "Coinbase",
  MU: "Micron",
  PLTR: "Palantir",
  NVDA: "NVIDIA",
});
const LEGACY_TOC_ALIASES = Object.freeze({
  DASH: [/\bdoordash\b/i],
  UNH: [/\bunitedhealth(?:care)?\b/i],
  PYPL: [/\bpaypal\b/i],
  RDDT: [/\breddit\b/i],
  COIN: [/\bcoinbase\b/i],
  MU: [/\bmicron\b/i],
  PLTR: [/\bpalantir\b/i],
  NVDA: [/\bnvidia\b/i],
});
const LEGACY_TOC_SOURCE_FAMILY = "GDELT Web Legacy NGrams TOC";
const LEGACY_TOC_ROOT = "https://storage.googleapis.com/data.gdeltproject.org/gdeltv5/weblegacy/ngrams";
const LEGACY_TOC_LOOKBACK_HOURS = 24;
const LEGACY_TOC_FETCH_CONCURRENCY = 20;
const MAX_LEGACY_TOC_BYTES = 2 * 1024 * 1024;
const MAX_LEGACY_TOC_DECOMPRESSED_BYTES = 2 * 1024 * 1024;
const MAX_LEGACY_TOC_TOTAL_DECOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_LEGACY_TOC_REQUESTS = 500;

const POSITIVE_CUES = [
  "beat", "beats", "upgrade", "upgraded", "raises", "raised", "record", "strong",
  "growth", "profit", "profitable", "surge", "surges", "rally", "jumps",
  "partnership", "expands", "approval", "approved", "outperform", "bullish",
  "buy", "rebound", "optimistic", "wins", "launches",
];
const NEGATIVE_CUES = [
  "miss", "misses", "downgrade", "downgraded", "cuts", "cut", "lawsuit", "probe",
  "investigation", "weak", "warning", "warns", "loss", "losses", "falls",
  "plunges", "slumps", "tumbles", "sell", "bearish", "risk", "concern",
  "recall", "fraud", "delay", "delays", "halts",
];

function parseArgs(argv) {
  const args = {
    tickers: "",
    limit: 0,
    maxRecords: 25,
    sleepMs: 5500,
    retries: 2,
    retryBackoffMs: 6500,
    noWrite: false,
    noFetch: false,
    referenceOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    if (arg === "--tickers") args.tickers = next();
    else if (arg === "--limit") args.limit = Number(next()) || 0;
    else if (arg === "--max-records") args.maxRecords = Number(next()) || args.maxRecords;
    else if (arg === "--sleep-ms") args.sleepMs = Number(next()) || args.sleepMs;
    else if (arg === "--retries") args.retries = Number(next()) || 0;
    else if (arg === "--retry-backoff-ms") args.retryBackoffMs = Number(next()) || args.retryBackoffMs;
    else if (arg === "--reference-only") args.referenceOnly = true;
    else if (arg === "--no-write") args.noWrite = true;
    else if (arg === "--no-fetch") args.noFetch = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function isoNow() {
  return new Date().toISOString();
}

function readJson(relPath, fallback = null, dataRootPath = dataRoot) {
  const abs = path.join(dataRootPath, relPath);
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw new Error(`Cannot read valid JSON from ${abs}: ${error?.message || error}`, { cause: error });
  }
}

function writeJson(relPath, payload, dataRootPath = dataRoot) {
  const abs = path.join(dataRootPath, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function normalizeTicker(ticker) {
  return String(ticker ?? "").trim().toUpperCase();
}

function cleanCompanyName(value) {
  return String(value ?? "")
    .replace(/\b(Class|Corp\.?|Corporation|Inc\.?|PLC|ADR|NV|SA|Ltd\.?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findFenokRowIndex(dataRootPath = dataRoot) {
  const fenokSignals = readJson("computed/fenok_signals.json", {}, dataRootPath);
  const index = new Map();
  for (const row of fenokSignals.rows ?? []) {
    index.set(normalizeTicker(row.ticker), row);
  }
  return index;
}

function loadTickerUniverse(args, fenokIndex) {
  let out = [];
  if (args.tickers) {
    out = args.tickers.split(",").map(normalizeTicker).filter(Boolean);
  } else if (args.referenceOnly) {
    out = DEFAULT_REFERENCE_TICKERS.slice();
  } else {
    out = [...fenokIndex.keys()].filter((ticker) => fenokIndex.get(ticker)?.market_scope === "us");
  }
  out = [...new Set(out)];
  if (args.limit > 0) out = out.slice(0, args.limit);
  return out;
}

function fetchJson(url, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "FenokResearch/1.0" } }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 160)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error(`JSON parse failed: ${err.message}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry(url, { retries, retryBackoffMs }) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchJson(url);
    } catch (err) {
      lastErr = err;
      if (attempt >= retries) break;
      await sleep(retryBackoffMs * (attempt + 1));
    }
  }
  throw lastErr;
}

// Raw HTTP GET preserving the status code for honest attempt classification.
function rawGet(url, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "FenokResearch/1.0" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
  });
}

// GDELT sometimes signals its request throttle with HTTP 200 and a plain-text
// advisory instead of HTTP 429 or a JSON document. Treat that provider-owned
// response as throttling so the bounded retry/fallback path can adjudicate it;
// classifying it as schema drift would incorrectly skip the recovery path.
function isGdeltThrottleAdvisory(response) {
  if (!Number.isInteger(response?.statusCode) || response.statusCode < 200 || response.statusCode >= 300) {
    return false;
  }
  const body = String(response.body ?? "").toLowerCase();
  return body.includes("please limit requests to one every 5 seconds")
    || body.includes("high-traffic users should switch to our ngrams dataset");
}

function rawGetBuffer(url, { timeoutMs = 30000, maxBytes = MAX_LEGACY_TOC_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "FenokResearch/1.0" } }, (res) => {
      const chunks = [];
      let byteLength = 0;
      res.on("data", (chunk) => {
        byteLength += chunk.length;
        if (byteLength > maxBytes) {
          req.destroy(new Error(`response exceeded ${maxBytes} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({
        statusCode: res.statusCode ?? 0,
        body: Buffer.concat(chunks),
      }));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
  });
}

function gdeltDocUrl(query, maxRecords) {
  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("maxrecords", String(maxRecords));
  url.searchParams.set("format", "json");
  url.searchParams.set("sort", "HybridRel");
  return url.toString();
}

// Observe GDELT reachability with one stable reference query and classify it
// into a detection attempt result. A dispatch-only controlled failure forces an
// honest transport failure. A valid `{articles:[...]}` response (even zero
// articles for the probe query) counts as a reachable provider.
function withEndpointAssertions(result) {
  const assertions = result.status !== "ready" && result.attempt.assertions.length === 0
    ? DATA_SUPPLY_DETECTION_CONFIG.lanes
      .find((lane) => lane.id === LANE_ID)
      .endpoint_contract.assertions
      .map((assertion) => ({ id: assertion.id, passed: false }))
    : result.attempt.assertions;
  return assertions === result.attempt.assertions ? result : {
    ...result,
    attempt: { ...result.attempt, assertions },
  };
}

function withRetryEvidence(result, retryCount, retryWaitMs) {
  const observed = withEndpointAssertions(result);
  if (retryCount === 0) return observed;
  return {
    ...observed,
    attempt: {
      ...observed.attempt,
      retry_reason: "rate_limited",
      retry_count: retryCount,
      retry_wait_ms: retryWaitMs,
    },
  };
}

async function observeAttempt({
  maxRecords,
  controlledFailure,
  retries = 2,
  retryBackoffMs = 6500,
  rawGetFn = rawGet,
  sleepFn = sleep,
}) {
  if (controlledFailure) {
    return { result: attemptResult("transport_error", threwTuple("transport")) };
  }
  const query = queryForTicker("DASH", "DoorDash");
  let firstRateLimited = null;
  let retryCount = 0;
  let retryWaitMs = 0;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let result;
    try {
      const raw = await rawGetFn(gdeltDocUrl(query, maxRecords));
      result = isGdeltThrottleAdvisory(raw)
        ? attemptResult("rate_limited", returnedTuple({
          httpStatus: raw.statusCode,
          rateLimited: true,
          decode: "error",
          payload: "non_empty",
        }))
        : classifyEndpointResponse(raw, { laneId: LANE_ID });
    } catch (err) {
      const kind = transportError(err) ? "transport" : "unexpected";
      result = attemptResult(kind === "transport" ? "transport_error" : "unexpected_error", threwTuple(kind));
    }
    if (result.reason !== "rate_limited") {
      const preserveInitiatingRateLimit = firstRateLimited
        && new Set(["http_error", "transport_error"]).has(result.reason);
      return {
        result: withRetryEvidence(preserveInitiatingRateLimit ? firstRateLimited : result, retryCount, retryWaitMs),
      };
    }
    firstRateLimited ??= result;
    if (attempt >= retries) return { result: withRetryEvidence(firstRateLimited, retryCount, retryWaitMs) };
    const waitMs = retryBackoffMs * (attempt + 1);
    retryCount += 1;
    retryWaitMs += waitMs;
    await sleepFn(waitMs);
  }
  return { result: withRetryEvidence(firstRateLimited, retryCount, retryWaitMs) };
}

function queryForTicker(ticker, company) {
  const cleaned = cleanCompanyName(company);
  if (cleaned && cleaned.length >= 4) return `"${cleaned}"`;
  return `"${ticker}"`;
}

function legacyTocText(record) {
  return `${String(record?.title ?? "")} ${String(record?.url ?? "")}`;
}

function matchLegacyTocTickers(record, {
  expectedTickers = DEFAULT_REFERENCE_TICKERS,
  aliases = LEGACY_TOC_ALIASES,
} = {}) {
  const text = legacyTocText(record);
  return expectedTickers.filter((ticker) => (
    Array.isArray(aliases[ticker]) && aliases[ticker].some((pattern) => pattern.test(text))
  ));
}

function collectLegacyTocArticles(records, {
  expectedTickers = DEFAULT_REFERENCE_TICKERS,
  maxRecords = 25,
} = {}) {
  const boundedMaxRecords = Math.max(1, Number(maxRecords) || 25);
  const articlesByTicker = Object.fromEntries(expectedTickers.map((ticker) => [ticker, []]));
  const seenUrlsByTicker = Object.fromEntries(expectedTickers.map((ticker) => [ticker, new Set()]));
  const newestFirst = [...records].sort((a, b) => String(b?.date ?? "").localeCompare(String(a?.date ?? "")));
  for (const record of newestFirst) {
    if (record?.lang && record.lang !== "en") continue;
    const seendate = articleSeenAt(record?.date);
    const title = String(record?.title ?? "").trim();
    const url = String(record?.url ?? "").trim();
    if (!seendate || !title || !url) continue;
    for (const ticker of matchLegacyTocTickers(record, { expectedTickers })) {
      if (articlesByTicker[ticker].length >= boundedMaxRecords || seenUrlsByTicker[ticker].has(url)) continue;
      seenUrlsByTicker[ticker].add(url);
      articlesByTicker[ticker].push({ title, url, seendate });
    }
  }
  return articlesByTicker;
}

function buildLegacyTocSnapshot({
  records,
  expectedTickers = DEFAULT_REFERENCE_TICKERS,
  companyNames = LEGACY_TOC_COMPANY_NAMES,
  maxRecords = 25,
  generatedAt = isoNow(),
}) {
  const articlesByTicker = collectLegacyTocArticles(records, { expectedTickers, maxRecords });
  const rows = expectedTickers.map((ticker) => computeTone({
    ticker,
    company: companyNames[ticker] ?? ticker,
    payload: {
      source_families: [LEGACY_TOC_SOURCE_FAMILY],
      articles: articlesByTicker[ticker] ?? [],
    },
  }));
  const errors = expectedTickers
    .filter((ticker) => (articlesByTicker[ticker] ?? []).length === 0)
    .map((ticker) => ({ ticker, error: "legacy_toc_no_matching_article" }));
  return buildSnapshotDocument({ rows, errors, generatedAt, expectedTickers });
}

function compactUtcTimestamp(value) {
  return value.toISOString().replace(/\D/g, "").slice(0, 14);
}

function legacyTocCandidateUrls(observedAt, lookbackHours = LEGACY_TOC_LOOKBACK_HOURS) {
  const observed = new Date(observedAt);
  if (!Number.isFinite(observed.getTime())) throw new Error("legacy TOC observedAt must be a valid timestamp");
  const stepMs = 15 * 60 * 1000;
  const minuteMs = 60 * 1000;
  const floorMs = Math.floor(observed.getTime() / stepMs) * stepMs;
  const oldestMs = observed.getTime() - lookbackHours * 60 * 60 * 1000;
  const urls = [];
  for (let baseMs = floorMs; baseMs >= oldestMs - stepMs; baseMs -= stepMs) {
    for (let offset = 4; offset >= 0; offset -= 1) {
      const candidateMs = baseMs + offset * minuteMs;
      if (candidateMs > observed.getTime() || candidateMs < oldestMs) continue;
      const timestamp = compactUtcTimestamp(new Date(candidateMs));
      urls.push(`${LEGACY_TOC_ROOT}/${timestamp}.toc.json.gz`);
    }
  }
  return urls;
}

function parseLegacyTocJsonl(text) {
  const records = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // One malformed line must not discard an otherwise valid provider file.
    }
  }
  return records;
}

function decodeLegacyTocGzip(body) {
  return zlib.gunzipSync(body, {
    maxOutputLength: MAX_LEGACY_TOC_DECOMPRESSED_BYTES,
  }).toString("utf8");
}

function hasAtLeastOneLegacyArticle(articlesByTicker, expectedTickers) {
  return expectedTickers.every((ticker) => (articlesByTicker[ticker] ?? []).length > 0);
}

async function fetchLegacyTocRecords({
  observedAt,
  expectedTickers = DEFAULT_REFERENCE_TICKERS,
  maxRecords = 25,
  lookbackHours = LEGACY_TOC_LOOKBACK_HOURS,
  concurrency = LEGACY_TOC_FETCH_CONCURRENCY,
  rawGetBufferFn = rawGetBuffer,
}) {
  const urls = legacyTocCandidateUrls(observedAt, lookbackHours).slice(0, MAX_LEGACY_TOC_REQUESTS);
  const records = [];
  let totalDecompressedBytes = 0;
  const batchSize = Math.max(1, Number(concurrency) || LEGACY_TOC_FETCH_CONCURRENCY);
  for (let index = 0; index < urls.length; index += batchSize) {
    const batch = urls.slice(index, index + batchSize);
    const responses = await Promise.all(batch.map(async (url) => {
      try {
        const response = await rawGetBufferFn(url);
        if (response.statusCode !== 200) return [];
        const text = decodeLegacyTocGzip(response.body);
        return { byteLength: Buffer.byteLength(text), records: parseLegacyTocJsonl(text) };
      } catch {
        return [];
      }
    }));
    for (const response of responses) {
      if (Array.isArray(response)) continue;
      if (totalDecompressedBytes + response.byteLength > MAX_LEGACY_TOC_TOTAL_DECOMPRESSED_BYTES) {
        return records;
      }
      totalDecompressedBytes += response.byteLength;
      records.push(...response.records);
    }
    const articlesByTicker = collectLegacyTocArticles(records, { expectedTickers, maxRecords });
    if (hasAtLeastOneLegacyArticle(articlesByTicker, expectedTickers)) break;
  }
  return records;
}

async function buildWebLegacyFallback({
  repoRoot: repoRootPath,
  args,
  observedAt,
  rawGetBufferFn = rawGetBuffer,
}) {
  const expectedTickers = DEFAULT_REFERENCE_TICKERS.filter((ticker) => (
    !args.tickers || args.tickers.split(",").map(normalizeTicker).includes(ticker)
  ));
  const records = await fetchLegacyTocRecords({
    observedAt,
    expectedTickers,
    maxRecords: args.maxRecords,
    rawGetBufferFn,
  });
  const snapshot = buildLegacyTocSnapshot({
    records,
    expectedTickers,
    maxRecords: args.maxRecords,
    generatedAt: observedAt,
  });
  if (!validToneSnapshot(snapshot)) return { snapshot };
  const dataRootPath = path.join(repoRootPath, "data");
  return {
    snapshot,
    history: mergeHistory(snapshot, { dataRootPath }),
  };
}

function cachePathForTicker(ticker, privateRootPath = privateRoot) {
  return path.join(privateRootPath, `${ticker}.json`);
}

async function loadArticles({ ticker, company, maxRecords, noFetch, retries, retryBackoffMs, privateRootPath = privateRoot }) {
  fs.mkdirSync(privateRootPath, { recursive: true });
  const cachePath = cachePathForTicker(ticker, privateRootPath);
  if (fs.existsSync(cachePath)) {
    return { cache_hit: true, payload: JSON.parse(fs.readFileSync(cachePath, "utf8")) };
  }
  if (noFetch) {
    return {
      cache_hit: false,
      payload: {
        schema_version: "fenok-private-gdelt-news/v0.1",
        ticker,
        company,
        fetched_at: null,
        raw_public: false,
        query: queryForTicker(ticker, company),
        articles: [],
        error: "cache_missing_no_fetch",
      },
    };
  }

  const query = queryForTicker(ticker, company);
  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("maxrecords", String(maxRecords));
  url.searchParams.set("format", "json");
  url.searchParams.set("sort", "HybridRel");

  const json = await fetchJsonWithRetry(url.toString(), { retries, retryBackoffMs });
  const payload = {
    schema_version: "fenok-private-gdelt-news/v0.1",
    ticker,
    company,
    fetched_at: isoNow(),
    raw_public: false,
    source_url: url.toString(),
    query,
    articles: Array.isArray(json?.articles) ? json.articles : [],
  };
  fs.writeFileSync(cachePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { cache_hit: false, payload };
}

function cueCounts(text) {
  const lower = String(text ?? "").toLowerCase();
  const positive = POSITIVE_CUES.filter((cue) => new RegExp(`\\b${cue}\\b`, "i").test(lower)).length;
  const negative = NEGATIVE_CUES.filter((cue) => new RegExp(`\\b${cue}\\b`, "i").test(lower)).length;
  return { positive, negative };
}

function articleSeenAt(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/);
  const normalized = compact
    ? `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z`
    : text;
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function latestArticleSeenAt(articles) {
  const dates = (Array.isArray(articles) ? articles : [])
    .map((article) => articleSeenAt(article?.seendate))
    .filter(Boolean)
    .sort();
  return dates.at(-1) ?? null;
}

function computeTone({ ticker, company, payload }) {
  const articles = Array.isArray(payload.articles) ? payload.articles : [];
  const sourceSeenAt = latestArticleSeenAt(articles);
  let positive = 0;
  let negative = 0;
  let cueBearing = 0;
  for (const article of articles) {
    const title = article?.title ?? "";
    const counts = cueCounts(title);
    positive += counts.positive;
    negative += counts.negative;
    if (counts.positive || counts.negative) cueBearing += 1;
  }
  const articleCount = articles.length;
  const rawCueScore = Math.max(-2, Math.min(2, (positive - negative) / Math.max(1, Math.sqrt(Math.max(articleCount, 1)))));
  const score = articleCount ? Math.max(0, Math.min(100, 50 + 12.5 * rawCueScore)) : null;
  const attentionScore = articleCount ? Math.max(0, Math.min(100, (articleCount / 25) * 100)) : null;
  return {
    ticker,
    company,
    as_of: sourceSeenAt,
    as_of_reason: sourceSeenAt ? null : "GDELT articles do not expose a usable seendate",
    confidence: articleCount >= 15 ? "medium" : articleCount >= 5 ? "low" : "very_low",
    coverage_ratio: Math.round(Math.min(1, articleCount / 25) * 100) / 100,
    source_families: Array.isArray(payload.source_families) && payload.source_families.length > 0
      ? payload.source_families
      : ["GDELT DOC 2.0 ArtList"],
    direct_news_tone_proxy: {
      score_0_100: score == null ? null : Math.round(score * 100) / 100,
      direction: score == null ? "unavailable" : score >= 58 ? "positive_headline_tilt" : score <= 42 ? "negative_headline_tilt" : "neutral_headline_tilt",
      basis: "private_gdelt_headline_lexical_proxy",
      positive_cue_count: positive,
      negative_cue_count: negative,
      cue_bearing_article_count: cueBearing,
      article_count: articleCount,
      attention_score_0_100: attentionScore == null ? null : Math.round(attentionScore * 100) / 100,
      caveat: "News headline tone proxy only; not social sentiment, not live social firehose, and entity matching can be noisy.",
    },
  };
}

async function build(args, { dataRootPath = dataRoot, privateRootPath = privateRoot } = {}) {
  const fenokIndex = findFenokRowIndex(dataRootPath);
  const tickers = loadTickerUniverse(args, fenokIndex);
  const rows = [];
  const errors = [];
  for (const ticker of tickers) {
    const row = fenokIndex.get(ticker) ?? {};
    const company = row.company ?? ticker;
    try {
      const loaded = await loadArticles({
        ticker,
        company,
        maxRecords: args.maxRecords,
        noFetch: args.noFetch,
        retries: args.retries,
        retryBackoffMs: args.retryBackoffMs,
        privateRootPath,
      });
      rows.push(computeTone({ ticker, company, payload: loaded.payload }));
      if (!loaded.cache_hit && !args.noFetch && args.sleepMs > 0) await sleep(args.sleepMs);
    } catch (err) {
      errors.push({ ticker, error: err.message });
      rows.push(computeTone({
        ticker,
        company,
        payload: { fetched_at: null, articles: [] },
      }));
      if (!args.noFetch && args.sleepMs > 0) await sleep(args.sleepMs);
    }
  }
  const snapshot = buildSnapshotDocument({
    rows,
    errors,
    generatedAt: isoNow(),
    expectedTickers: tickers,
  });
  return { snapshot, history: mergeHistory(snapshot, { dataRootPath }) };
}

// The fetch loop turns an unavailable ticker into an article-less row. Keep the
// dated evidence in the candidate document for diagnostics/history assembly,
// but fail readiness unless every requested reference has a provider timestamp.
// A partial reference basket is not comparable with the complete live basket
// and must never replace its LKG.
export function buildSnapshotDocument({
  rows = [],
  errors = [],
  generatedAt,
  expectedTickers = DEFAULT_REFERENCE_TICKERS,
}) {
  if (!Array.isArray(expectedTickers)) {
    throw new Error("GDELT expected ticker universe must be an array");
  }
  const expectedUniverse = expectedTickers.map(normalizeTicker);
  if (expectedUniverse.length === 0
    || expectedUniverse.some((ticker) => ticker === "")
    || new Set(expectedUniverse).size !== expectedUniverse.length) {
    throw new Error("GDELT expected ticker universe must be non-empty and unique");
  }
  const expectedSet = new Set(expectedUniverse);
  const observedTickers = rows.map((row) => normalizeTicker(row?.ticker));
  const observedCounts = observedTickers.reduce((counts, ticker) => {
    counts.set(ticker, (counts.get(ticker) ?? 0) + 1);
    return counts;
  }, new Map());
  const missingTickers = expectedUniverse.filter((ticker) => !observedCounts.has(ticker));
  const duplicateTickers = [...observedCounts]
    .filter(([, count]) => count > 1)
    .map(([ticker]) => ticker)
    .filter(Boolean)
    .sort();
  const unexpectedTickers = [...new Set(observedTickers)]
    .filter((ticker) => ticker !== "" && !expectedSet.has(ticker))
    .sort();
  const invalidTickerRowCount = observedTickers.filter((ticker) => ticker === "").length;
  const datedRows = rows.filter((row) => validRfc3339Utc(row?.as_of));
  const unavailableTickers = [...new Set([
    ...missingTickers,
    ...rows
      .filter((row) => expectedSet.has(normalizeTicker(row?.ticker)) && !validRfc3339Utc(row?.as_of))
      .map((row) => normalizeTicker(row?.ticker)),
  ])].sort();
  // Oldest dated row: the floor must never claim freshness a row cannot back.
  const sourceAsOf = datedRows.length > 0
    ? [...datedRows.map((row) => row.as_of)].sort().at(0)
    : null;
  const complete = rows.length === expectedUniverse.length
    && datedRows.length === expectedUniverse.length
    && invalidTickerRowCount === 0
    && rows.every((row) => row?.ticker === normalizeTicker(row?.ticker))
    && missingTickers.length === 0
    && duplicateTickers.length === 0
    && unexpectedTickers.length === 0
    && unavailableTickers.length === 0;
  const partial = sourceAsOf !== null && !complete;
  return {
    schema_version: 1,
    generated_at: generatedAt,
    source_as_of: sourceAsOf,
    source_as_of_reason: sourceAsOf
      ? (partial
        ? `partial coverage: aggregate source floor spans ${datedRows.length} dated row(s); `
          + `${missingTickers.length} expected ticker(s) missing, ${duplicateTickers.length} duplicated, `
          + `${unexpectedTickers.length} unexpected, and ${unavailableTickers.length} unavailable`
        : null)
      : "aggregate source floor unavailable because no article row carries a usable seendate",
    status: complete ? "ready" : "degraded",
    formula_version: FORMULA_VERSION,
    public_surface_status: "private_admin_derived_only_not_public",
    raw_policy: {
      external_collection: true,
      raw_cache_public: false,
      third_party_raw_public: false,
      full_public_mirror: false,
      raw_cache_path: "_private/admin/fenok-flow/gdelt_news/{TICKER}.json",
      public_payload: null,
    },
    coverage: {
      expected_tickers: expectedUniverse,
      expected_row_count: expectedUniverse.length,
      observed_row_count: rows.length,
      row_count: datedRows.length,
      with_articles: datedRows.filter((row) => row.direct_news_tone_proxy.article_count > 0).length,
      with_tone_score: datedRows.filter((row) => row.direct_news_tone_proxy.score_0_100 != null).length,
      unavailable_row_count: unavailableTickers.length,
      unavailable_tickers: unavailableTickers,
      missing_tickers: missingTickers,
      duplicate_tickers: duplicateTickers,
      unexpected_tickers: unexpectedTickers,
      invalid_ticker_row_count: invalidTickerRowCount,
      complete,
      errors,
    },
    rows: datedRows,
  };
}

function mergeHistory(snapshot, { dataRootPath = dataRoot, history = null } = {}) {
  const prior = history ?? readJson(HISTORY_FILE, {
    schema_version: 1,
    formula_version: FORMULA_VERSION,
    rows: [],
  }, dataRootPath);
  const current = snapshot.rows.map((row) => ({
    ticker: row.ticker,
    as_of: row.as_of,
    source_date: providerSourceDate(row.as_of),
    generated_at: snapshot.generated_at,
    directNewsToneProxyScore: row.direct_news_tone_proxy.score_0_100,
    newsAttentionScore: row.direct_news_tone_proxy.attention_score_0_100,
    articleCount: row.direct_news_tone_proxy.article_count,
  }));
  const priorPolicySchema = prior?.persistence_policy?.schema_version;
  const legacyHistory = priorPolicySchema === undefined;
  if (!legacyHistory && priorPolicySchema !== GDELT_HISTORY_PERSISTENCE_POLICY.schema_version) {
    throw new Error("GDELT history persistence policy is invalid");
  }
  const normalizeRow = (row) => ({ ...row, source_date: row?.source_date ?? providerSourceDate(row?.as_of) });
  const keys = new Set(current.map((row) => `${row.ticker}|${row.source_date}`));
  const normalizedPrior = (prior.rows ?? []).map(normalizeRow);
  const legacyUnboundRows = normalizedPrior.filter((row) => !validSourceDate(row?.source_date));
  if (!legacyHistory && legacyUnboundRows.length > 0) {
    throw new Error("GDELT history carries an invalid provider source date");
  }
  // Pre-policy history could carry score rows without any provider timestamp.
  // Such rows cannot prove source-date retention or recovery advancement, so the
  // first bounded-policy rotation drops only those unbound legacy rows.
  const migrationRows = legacyHistory
    ? normalizedPrior.filter((row) => validSourceDate(row?.source_date))
    : normalizedPrior;
  const kept = migrationRows
    .filter((row) => !keys.has(`${row.ticker}|${row.source_date ?? "missing"}`));
  const all = [...kept, ...current];
  if (all.some((row) => !validSourceDate(row?.source_date))) {
    throw new Error("GDELT history carries an invalid provider source date");
  }
  const sourceDates = [...new Set(all.map((row) => row.source_date))].sort();
  const retainedSourceDates = new Set(sourceDates.slice(-MAX_GDELT_HISTORY_SOURCE_DATES));
  const bounded = all
    .filter((row) => retainedSourceDates.has(row.source_date))
    .sort((a, b) => (
      String(a.ticker).localeCompare(String(b.ticker)) || String(a.source_date).localeCompare(String(b.source_date))
    ));
  return {
    schema_version: 1,
    formula_version: FORMULA_VERSION,
    generated_at: snapshot.generated_at,
    raw_policy: {
      third_party_raw_public: false,
      rows_are_derived_only: true,
    },
    persistence_policy: GDELT_HISTORY_PERSISTENCE_POLICY,
    persistence_state: {
      available_source_dates: sourceDates.length,
      retained_source_dates: retainedSourceDates.size,
      pruned_source_dates: sourceDates.length - retainedSourceDates.size,
      legacy_unbound_rows_dropped: legacyHistory ? legacyUnboundRows.length : 0,
    },
    rows: bounded,
  };
}

// The public document's source_as_of intentionally remains an aggregate floor.
// LKG recovery needs the same latest provider article clock used by the registry
// selector (max rows[].as_of), never generated_at or that aggregate floor.
function validRfc3339Utc(value) {
  return typeof value === "string" && value.endsWith("Z") && Number.isFinite(Date.parse(value));
}

function validSourceDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function providerSourceDate(value) {
  return validRfc3339Utc(value) ? value.slice(0, 10) : null;
}

function latestRowSourceAsOf(snapshot) {
  const values = (snapshot?.rows ?? [])
    .map((row) => row?.as_of)
    .filter(validRfc3339Utc)
    .sort();
  return values.at(-1) ?? null;
}

function hasCompleteReferenceCoverage(snapshot) {
  const coverage = snapshot?.coverage;
  const expectedTickers = coverage?.expected_tickers;
  const observedTickers = Array.isArray(snapshot?.rows)
    ? snapshot.rows.map((row) => row?.ticker)
    : [];
  const expectedSet = Array.isArray(expectedTickers) ? new Set(expectedTickers) : new Set();
  const observedSet = new Set(observedTickers);
  return coverage?.complete === true
    && Array.isArray(expectedTickers)
    && expectedSet.size === expectedTickers.length
    && expectedSet.size === DEFAULT_REFERENCE_TICKERS.length
    && DEFAULT_REFERENCE_TICKERS.every((ticker) => expectedSet.has(ticker))
    && Number.isInteger(coverage.expected_row_count)
    && coverage.expected_row_count === DEFAULT_REFERENCE_TICKERS.length
    && coverage.observed_row_count === coverage.expected_row_count
    && coverage.row_count === coverage.expected_row_count
    && coverage.unavailable_row_count === 0
    && Array.isArray(coverage.unavailable_tickers)
    && coverage.unavailable_tickers.length === 0
    && Array.isArray(coverage.missing_tickers)
    && coverage.missing_tickers.length === 0
    && Array.isArray(coverage.duplicate_tickers)
    && coverage.duplicate_tickers.length === 0
    && Array.isArray(coverage.unexpected_tickers)
    && coverage.unexpected_tickers.length === 0
    && coverage.invalid_ticker_row_count === 0
    && Array.isArray(snapshot?.rows)
    && snapshot.rows.length === coverage.expected_row_count
    && observedSet.size === observedTickers.length
    && expectedTickers.every((ticker) => observedSet.has(ticker));
}

function validToneSnapshot(snapshot) {
  return snapshot?.schema_version === 1
    && snapshot?.status === "ready"
    && hasCompleteReferenceCoverage(snapshot)
    && Array.isArray(snapshot?.rows)
    && snapshot.rows.length > 0
    && snapshot.rows.every((row) => (
      row?.direct_news_tone_proxy
      && typeof row.ticker === "string"
      && validRfc3339Utc(row.as_of)
    ))
    && latestRowSourceAsOf(snapshot) !== null;
}

function withSnapshotReadinessAssertion(result, snapshot, reason = "schema_drift") {
  if (result.status !== "ready" || validToneSnapshot(snapshot)) return result;
  const hasArticlesAssertion = result.attempt.assertions.some((assertion) => assertion.id === "articles_array");
  return attemptResult(reason, {
    ...result.attempt,
    assertions: hasArticlesAssertion
      ? result.attempt.assertions.map((assertion) => (
        assertion.id === "articles_array" ? { ...assertion, passed: false } : assertion
      ))
      : [{ id: "articles_array", passed: false }],
  });
}

function snapshotSourceAsOf(snapshot) {
  return validToneSnapshot(snapshot) ? latestRowSourceAsOf(snapshot) : null;
}

function providerObservationFromSnapshot(snapshot) {
  return {
    schema_version: "gdelt-provider-observation/v1",
    source_as_of: snapshotSourceAsOf(snapshot),
    rows: snapshot.rows.map((row) => ({ ticker: row.ticker, as_of: row.as_of })),
  };
}

function validProviderObservation(document) {
  return document !== null && typeof document === "object" && !Array.isArray(document)
    && document.schema_version === "gdelt-provider-observation/v1"
    && validRfc3339Utc(document.source_as_of)
    && Array.isArray(document.rows) && document.rows.length > 0
    && document.rows.every((row) => typeof row?.ticker === "string" && validRfc3339Utc(row?.as_of))
    && document.source_as_of === document.rows.map((row) => row.as_of).sort().at(-1);
}

function providerObservationSourceAsOf(document) {
  return validProviderObservation(document) ? document.source_as_of : null;
}

function candidateContainsProviderObservation(candidate, providerObservation) {
  if (!validToneSnapshot(candidate) || !validProviderObservation(providerObservation)) return false;
  return snapshotSourceAsOf(candidate) === providerObservation.source_as_of
    && providerObservation.rows.every((providerRow) => candidate.rows.some((row) => (
      row.ticker === providerRow.ticker && row.as_of === providerRow.as_of
    )));
}

function snapshotArtifact(repoRootPath) {
  return {
    key: LKG_ARTIFACT_KEY,
    canonicalPath: path.join(repoRootPath, "data", OUTPUT_FILE),
    validateDocument: validToneSnapshot,
    sourceAsOf: snapshotSourceAsOf,
  };
}

function snapshotCandidate(snapshot, run) {
  const sourceAsOf = snapshotSourceAsOf(snapshot);
  if (!validToneSnapshot(snapshot) || sourceAsOf === null) {
    throw new Error("GDELT snapshot has no provider-derived article seendate");
  }
  const payloadBytes = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`);
  const providerObservation = providerObservationFromSnapshot(snapshot);
  const providerPayloadBytes = Buffer.from(`${JSON.stringify(providerObservation, null, 2)}\n`);
  return {
    key: LKG_ARTIFACT_KEY,
    currentRelativePath: `data/${OUTPUT_FILE}`,
    payloadBytes,
    sourceAsOf,
    validateDocument: validToneSnapshot,
    deriveSourceAsOf: snapshotSourceAsOf,
    promotion_contract: PROMOTION_CONTRACT_PROVIDER_OBSERVATION_V2,
    provider_observation: buildProviderObservationV2({
      payloadBytes: providerPayloadBytes,
      sourceAsOf: providerObservationSourceAsOf(providerObservation),
      validateDocument: validProviderObservation,
      deriveSourceAsOf: providerObservationSourceAsOf,
      candidateContainsObservation: candidateContainsProviderObservation,
      run,
    }),
  };
}

function runContext({ runId, runAttempt, eventName, observedAt }) {
  return {
    runId: String(runId),
    runAttempt: Number(runAttempt),
    eventName: String(eventName),
    observedAt,
  };
}

export async function runNewsTone({
  repoRoot: repoRootPath = repoRoot,
  args = parseArgs(process.argv.slice(2)),
  observedAt = isoNow(),
  runId = process.env.GITHUB_RUN_ID || "local",
  runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1),
  eventName = process.env.GITHUB_EVENT_NAME || "local",
  attemptId = defaultAttemptId("gdelt-news-tone", observedAt),
  controlledFailure = (process.env.INPUT_CONTROLLED_FAILURE || "").trim() === "transport",
  attemptShardPath = path.join(repoRootPath, "data", "admin", "data-supply-state", "detection-attempts", `${LANE_ID}.json`),
  observeAttemptFn = observeAttempt,
  fallbackFn = buildWebLegacyFallback,
  buildFn = build,
  sleepFn = sleep,
} = {}) {
  const write = args.noWrite !== true;
  const run = runContext({ runId, runAttempt, eventName, observedAt });
  const store = new LaneLkgStore({ repoRoot: repoRootPath, laneId: LANE_ID });
  const observed = await observeAttemptFn({
    maxRecords: args.maxRecords,
    controlledFailure,
    retries: args.retries,
    retryBackoffMs: args.retryBackoffMs,
  });
  let result = withEndpointAssertions(observed.result);
  const writeResult = () => {
    if (write) writeAttemptShard({ laneId: LANE_ID, attemptShardPath, observedAt, attemptId, result });
  };

  // `reason` is the stable vocabulary the LKG store and the detection floor
  // consume, so it must not absorb free text. The identity of whatever actually
  // threw travels beside it instead, because a run that reports only
  // `unexpected_error` cannot be diagnosed from CI alone. Bounded on purpose:
  // provider payloads reach error messages.
  const failureDetailOf = (error) => {
    if (!error) return null;
    const name = error?.name || error?.constructor?.name || "Error";
    return `${name}: ${String(error?.message ?? error)}`.slice(0, 320);
  };

  const retainFailure = (reason, error = null) => {
    const failure_detail = failureDetailOf(error);
    if (!write) {
      return {
        ok: false,
        reason,
        failure_detail,
        degraded: false,
        corrupt: true,
        exitCode: 2,
        retrySet: [],
        retained: false,
        result,
      };
    }
    const failure = store.recordFailure({
      artifacts: [snapshotArtifact(repoRootPath)],
      run,
      reason,
    });
    // GDELT remains graceful only when the retained artifact is a complete,
    // exact reference basket. Partial/legacy candidates cannot make a failed
    // current attempt recoverable.
    const retained = failure.hasCompleteLkg === true;
    return {
      ok: false,
      reason,
      failure_detail,
      degraded: retained,
      corrupt: !retained,
      exitCode: retained ? 0 : 2,
      retrySet: failure.retrySet,
      retained,
      result,
    };
  };

  let built = null;
  const primaryRetryCount = Number(result.attempt.retry_count ?? 0);
  if (result.reason === "rate_limited"
    && primaryRetryCount >= 1
    && controlledFailure !== true
    && args.noFetch === false) {
    try {
      const fallbackBuilt = await fallbackFn({
        repoRoot: repoRootPath,
        args,
        observedAt,
      });
      const fallbackSnapshot = fallbackBuilt?.snapshot ?? fallbackBuilt;
      if (validToneSnapshot(fallbackSnapshot)) {
        built = fallbackBuilt;
        const readyFallback = attemptResult("ok", returnedTuple({
          httpStatus: 200,
          decode: "ok",
          payload: "non_empty",
          assertions: [{ id: "articles_array", passed: true }],
        }));
        result = withRetryEvidence(
          readyFallback,
          primaryRetryCount,
          Number(result.attempt.retry_wait_ms ?? 0),
        );
      }
    } catch {
      // The DOC API 429 remains the authoritative failure when the bounded
      // provider-owned fallback cannot produce a complete reference basket.
    }
  }

  if (result.status !== "ready") {
    writeResult();
    return retainFailure(result.reason);
  }

  // The reachability probe and the first reference-ticker fetch hit the same
  // rate-limited GDELT endpoint. Honor the per-request spacing between those
  // two phases as well as between ticker fetches; otherwise the first ticker
  // can consume its retries before the documented five-second window clears.
  const probeCooldownMs = built !== null || args.noFetch === true ? 0 : Number(args.sleepMs ?? 0);
  if (Number.isFinite(probeCooldownMs) && probeCooldownMs > 0) {
    await sleepFn(probeCooldownMs);
  }

  if (built === null) {
    try {
      built = await buildFn(args, {
        dataRootPath: path.join(repoRootPath, "data"),
        privateRootPath: path.join(repoRootPath, "_private", "admin", "fenok-flow", "gdelt_news"),
      });
    } catch (err) {
      result = withSnapshotReadinessAssertion(result, null, "unexpected_error");
      writeResult();
      return retainFailure("unexpected_error", err);
    }
  }
  const snapshot = built?.snapshot ?? built;
  result = withSnapshotReadinessAssertion(result, snapshot);
  writeResult();
  if (result.status !== "ready") return retainFailure(result.reason);

  let candidate;
  try {
    candidate = snapshotCandidate(snapshot, run);
  } catch (err) {
    return retainFailure("schema_drift", err);
  }
  if (!write) {
    return { ok: true, reason: "ok", degraded: false, exitCode: 0, retrySet: [], snapshot, result };
  }
  const decisions = store.evaluatePromotionCandidates([candidate], run);
  const decision = decisions[0];
  if (!decision.eligible) {
    if (["foreign_writer_conflict", "recovery_not_advanced_by_provider"].includes(decision.reason)) {
      store.recordPromotionDeferral({ artifacts: [candidate], run, reason: decision.reason });
    }
    return {
      ok: false,
      reason: decision.reason,
      degraded: true,
      exitCode: 0,
      retrySet: store.stateSnapshot().retry_set,
      result,
      snapshot,
    };
  }

  const history = built?.history ?? mergeHistory(snapshot, { dataRootPath: path.join(repoRootPath, "data") });
  writeJson(OUTPUT_FILE, snapshot, path.join(repoRootPath, "data"));
  writeJson(HISTORY_FILE, history, path.join(repoRootPath, "data"));
  const success = store.recordSuccess({ artifacts: [candidate], run });
  return {
    ok: true,
    reason: "ok",
    degraded: false,
    exitCode: 0,
    retrySet: success.retrySet,
    recovered: success.state.items[LKG_ARTIFACT_KEY]?.recovered_at === observedAt,
    snapshot,
    history,
    result,
  };
}

export async function main({
  argv = process.argv.slice(2),
  runNewsToneFn = runNewsTone,
  log = console.log,
  error = console.error,
} = {}) {
  const args = parseArgs(argv);
  const result = await runNewsToneFn({ args });
  if (!result.ok) {
    const detail = result.failure_detail ? `; error: ${result.failure_detail}` : "";
    error(`[degraded] GDELT news tone ${result.reason}; retry set: ${result.retrySet.join(", ") || "none"}${detail}`);
    return Number.isInteger(result.exitCode) ? result.exitCode : 1;
  }
  const snapshot = result.snapshot;
  log(JSON.stringify({
    output_file: `data/${OUTPUT_FILE}`,
    history_file: `data/${HISTORY_FILE}`,
    wrote: !args.noWrite,
    source_as_of: snapshotSourceAsOf(snapshot),
    source_families: [...new Set(snapshot.rows.flatMap((row) => row.source_families ?? []))].sort(),
    coverage: snapshot.coverage,
    rows: snapshot.rows.map((row) => ({
      ticker: row.ticker,
      directNewsToneProxyScore: row.direct_news_tone_proxy.score_0_100,
      attentionScore: row.direct_news_tone_proxy.attention_score_0_100,
      articleCount: row.direct_news_tone_proxy.article_count,
      confidence: row.confidence,
    })),
  }, null, 2));
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((err) => {
      console.error(err.stack || err.message);
      process.exitCode = 1;
    });
}

export {
  articleSeenAt,
  buildLegacyTocSnapshot,
  cleanCompanyName,
  collectLegacyTocArticles,
  computeTone,
  cueCounts,
  decodeLegacyTocGzip,
  fetchJsonWithRetry,
  GDELT_HISTORY_PERSISTENCE_POLICY,
  MAX_GDELT_HISTORY_SOURCE_DATES,
  latestArticleSeenAt,
  mergeHistory,
  matchLegacyTocTickers,
  observeAttempt,
  queryForTicker,
  snapshotSourceAsOf,
  validToneSnapshot,
};
