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
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");
const privateRoot = path.join(repoRoot, "_private", "admin", "fenok-flow", "gdelt_news");

const FORMULA_VERSION = "fenok-news-tone-proxy-v0.1-gdelt-headlines";
const OUTPUT_FILE = "computed/fenok_news_tone_proxy.json";
const HISTORY_FILE = "computed/fenok_news_tone_proxy_history.json";
const DEFAULT_REFERENCE_TICKERS = ["DASH", "UNH", "PYPL", "RDDT", "COIN", "MU", "PLTR", "NVDA"];

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

function readJson(relPath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataRoot, relPath), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(relPath, payload) {
  const abs = path.join(dataRoot, relPath);
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

function findFenokRowIndex() {
  const fenokSignals = readJson("computed/fenok_signals.json", {});
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

function queryForTicker(ticker, company) {
  const cleaned = cleanCompanyName(company);
  if (cleaned && cleaned.length >= 4) return `"${cleaned}"`;
  return `"${ticker}"`;
}

function cachePathForTicker(ticker) {
  return path.join(privateRoot, `${ticker}.json`);
}

async function loadArticles({ ticker, company, maxRecords, noFetch, retries, retryBackoffMs }) {
  fs.mkdirSync(privateRoot, { recursive: true });
  const cachePath = cachePathForTicker(ticker);
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

function computeTone({ ticker, company, payload }) {
  const articles = Array.isArray(payload.articles) ? payload.articles : [];
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
    as_of: payload.fetched_at,
    confidence: articleCount >= 15 ? "medium" : articleCount >= 5 ? "low" : "very_low",
    coverage_ratio: Math.round(Math.min(1, articleCount / 25) * 100) / 100,
    source_families: ["GDELT DOC 2.0 ArtList"],
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

async function build(args) {
  const fenokIndex = findFenokRowIndex();
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
  const generatedAt = isoNow();
  const snapshot = {
    schema_version: 1,
    generated_at: generatedAt,
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
      row_count: rows.length,
      with_articles: rows.filter((row) => row.direct_news_tone_proxy.article_count > 0).length,
      with_tone_score: rows.filter((row) => row.direct_news_tone_proxy.score_0_100 != null).length,
      errors,
    },
    rows,
  };
  const history = mergeHistory(snapshot);
  if (!args.noWrite) {
    writeJson(OUTPUT_FILE, snapshot);
    writeJson(HISTORY_FILE, history);
  }
  return snapshot;
}

function mergeHistory(snapshot) {
  const history = readJson(HISTORY_FILE, {
    schema_version: 1,
    formula_version: FORMULA_VERSION,
    rows: [],
  });
  const current = snapshot.rows.map((row) => ({
    ticker: row.ticker,
    as_of: row.as_of,
    generated_at: snapshot.generated_at,
    directNewsToneProxyScore: row.direct_news_tone_proxy.score_0_100,
    newsAttentionScore: row.direct_news_tone_proxy.attention_score_0_100,
    articleCount: row.direct_news_tone_proxy.article_count,
  }));
  const keys = new Set(current.map((row) => `${row.ticker}|${row.as_of ?? "missing"}`));
  const kept = (history.rows ?? []).filter((row) => !keys.has(`${row.ticker}|${row.as_of ?? "missing"}`));
  return {
    schema_version: 1,
    formula_version: FORMULA_VERSION,
    generated_at: snapshot.generated_at,
    rows: [...kept, ...current].sort((a, b) => (
      String(a.ticker).localeCompare(String(b.ticker)) || String(a.as_of).localeCompare(String(b.as_of))
    )),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = await build(args);
  console.log(JSON.stringify({
    output_file: `data/${OUTPUT_FILE}`,
    history_file: `data/${HISTORY_FILE}`,
    wrote: !args.noWrite,
    coverage: snapshot.coverage,
    rows: snapshot.rows.map((row) => ({
      ticker: row.ticker,
      directNewsToneProxyScore: row.direct_news_tone_proxy.score_0_100,
      attentionScore: row.direct_news_tone_proxy.attention_score_0_100,
      articleCount: row.direct_news_tone_proxy.article_count,
      confidence: row.confidence,
    })),
  }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

export {
  cleanCompanyName,
  computeTone,
  cueCounts,
  fetchJsonWithRetry,
  queryForTicker,
};
