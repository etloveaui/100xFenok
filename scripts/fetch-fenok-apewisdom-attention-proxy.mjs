#!/usr/bin/env node
/**
 * Fetch ApeWisdom stock mention aggregates and build a private-derived Fenok
 * social-attention proxy.
 *
 * Raw API pages stay under _private/admin/fenok-flow/apewisdom. The computed
 * artifact is internal by default and must not be mirrored publicly.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  atomicWrite,
  attemptResult,
  classifyEndpointResponse,
  defaultAttemptId,
  threwTuple,
  transportError,
  writeAttemptShard,
} from "./lib/data-supply-attempt-shard.mjs";
import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";
import {
  LaneLkgStore,
  PROMOTION_CONTRACT_PROVIDER_OBSERVATION_V2,
  buildProviderObservationV2,
  classifyLkgFailure,
  isNaturalScheduleRun,
} from "./lib/data-supply-lkg-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");
const privateRoot = path.join(repoRoot, "_private", "admin", "fenok-flow", "apewisdom");

const LANE_ID = "apewisdom_attention";
const ATTEMPT_SHARD_PATH = path.join(
  repoRoot, "data", "admin", "data-supply-state", "detection-attempts", `${LANE_ID}.json`,
);

const DEFAULT_FILTER = "all-stocks";
const SCHEMA_VERSION = "fenok-social-attention-proxy/v0.1";
const FORMULA_VERSION = "fenok-social-attention-v0.1-apewisdom";
const OUTPUT_FILE = "computed/fenok_social_attention_proxy.json";
const HISTORY_FILE = "computed/fenok_social_attention_proxy_history.json";
const LKG_KEY = "social_attention_proxy";

// Match the FINRA daily marker-history sibling: retain the newest 100 distinct
// provider source dates, never an unbounded number of ticker rows.
export const MAX_APEWISDOM_HISTORY_SOURCE_DATES = 100;
export const APEWISDOM_HISTORY_PERSISTENCE_POLICY = Object.freeze({
  schema_version: "apewisdom-bounded-persistence/v1",
  basis: "provider_source_date",
  scope: "per_artifact",
  max_distinct_source_dates: MAX_APEWISDOM_HISTORY_SOURCE_DATES,
  eviction: "oldest_source_date_first",
});

const SUPPORTED_FILTERS = new Set([
  "all",
  "all-stocks",
  "all-crypto",
  "4chan",
  "CryptoCurrency",
  "CryptoCurrencies",
  "Bitcoin",
  "SatoshiStreetBets",
  "CryptoMoonShots",
  "CryptoMarkets",
  "stocks",
  "wallstreetbets",
  "options",
  "WallStreetbetsELITE",
  "Wallstreetbetsnew",
  "SPACs",
  "investing",
  "Daytrading",
]);

function parseArgs(argv) {
  const args = {
    filter: DEFAULT_FILTER,
    maxPages: 10,
    tickers: "",
    limit: 0,
    noFetch: false,
    noWrite: false,
    inputFile: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    if (arg === "--filter") args.filter = next();
    else if (arg === "--max-pages") args.maxPages = Number(next()) || args.maxPages;
    else if (arg === "--tickers") args.tickers = next();
    else if (arg === "--limit") args.limit = Number(next()) || 0;
    else if (arg === "--no-fetch") args.noFetch = true;
    else if (arg === "--no-write") args.noWrite = true;
    else if (arg === "--input-file") args.inputFile = next();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!SUPPORTED_FILTERS.has(args.filter)) throw new Error(`Unsupported ApeWisdom filter: ${args.filter}`);
  return args;
}

function isoNow() {
  return new Date().toISOString();
}

function ymdNow() {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

function readJson(relPath, fallback = null, root = dataRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relPath), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(relPath, payload, root = dataRoot) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return abs;
}

function writePrivateJson(abs, payload) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function normalizeTicker(ticker) {
  return String(ticker ?? "").trim().toUpperCase();
}

function numberValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replaceAll(",", "").trim());
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min = 0, max = 100) {
  if (!Number.isFinite(value)) return null;
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function apeWisdomUrl(filter, page) {
  if (page <= 1) return `https://apewisdom.io/api/v1.0/filter/${encodeURIComponent(filter)}`;
  return `https://apewisdom.io/api/v1.0/filter/${encodeURIComponent(filter)}/page/${page}`;
}

function fetchJson(url, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "FenokResearch/1.0" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 160)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`Invalid JSON: ${err.message}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
  });
}

// Raw HTTP GET that preserves the status code so the detection-floor attempt
// shard can classify the provider observation honestly (fail-closed).
function rawGet(url, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "FenokResearch/1.0" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve({
        statusCode: res.statusCode ?? 0,
        body,
        // The API body has no publish timestamp. Preserve the provider response
        // HTTP Date exactly as the source marker; never substitute fetch time.
        headers: { date: res.headers.date ?? null },
      }));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
  });
}

// Observe the ApeWisdom aggregate (page 1) and classify it into a detection
// attempt result. A dispatch-only controlled failure forces an honest transport
// failure so the failure path can be exercised without faking success.
function providerSourceAsOf(response) {
  const raw = Array.isArray(response?.headers?.date) ? response.headers.date[0] : response?.headers?.date;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function withEndpointAssertionIds(result) {
  if ((result?.attempt?.assertions ?? []).length > 0 || result?.status === "ready") return result;
  const assertions = DATA_SUPPLY_DETECTION_CONFIG.lanes
    .find((lane) => lane.id === LANE_ID)
    .endpoint_contract.assertions
    .map((assertion) => ({ id: assertion.id, passed: false }));
  return { ...result, attempt: { ...result.attempt, assertions } };
}

async function observeAttempt({ filter, controlledFailure, request = rawGet }) {
  if (controlledFailure) {
    return {
      result: withEndpointAssertionIds(attemptResult("transport_error", threwTuple("transport"))),
      document: null,
      response: null,
    };
  }
  try {
    const response = await request(apeWisdomUrl(filter, 1));
    const result = withEndpointAssertionIds(classifyEndpointResponse(response, { laneId: LANE_ID }));
    return { result, document: result.document ?? null, response };
  } catch (err) {
    const kind = transportError(err) ? "transport" : "unexpected";
    return {
      result: withEndpointAssertionIds(
        attemptResult(kind === "transport" ? "transport_error" : "unexpected_error", threwTuple(kind)),
      ),
      document: null,
      response: null,
    };
  }
}

function loadTickerUniverse({ tickers, limit, dataRoot: root = dataRoot }) {
  let out = [];
  if (tickers) {
    out = tickers.split(",").map(normalizeTicker).filter(Boolean);
  } else {
    const fenokSignals = readJson("computed/fenok_signals.json", {}, root);
    const rows = Array.isArray(fenokSignals.rows) ? fenokSignals.rows : [];
    out = rows
      .filter((row) => row.market_scope === "us")
      .map((row) => normalizeTicker(row.ticker))
      .filter(Boolean);
  }
  out = [...new Set(out)].filter((ticker) => /^[A-Z][A-Z0-9.\-]{0,11}$/.test(ticker));
  if (limit > 0) out = out.slice(0, limit);
  return out;
}

function normalizeApeRows(pages) {
  const rows = [];
  for (const page of pages) {
    for (const row of page.results ?? []) {
      const ticker = normalizeTicker(row.ticker);
      if (!ticker) continue;
      rows.push({
        rank: numberValue(row.rank),
        ticker,
        name: String(row.name ?? "").trim(),
        mentions: numberValue(row.mentions),
        upvotes: numberValue(row.upvotes),
        rank_24h_ago: numberValue(row.rank_24h_ago),
        mentions_24h_ago: numberValue(row.mentions_24h_ago),
      });
    }
  }
  return rows;
}

function attentionScoreFromRank(rank, count) {
  if (!Number.isFinite(rank) || !Number.isFinite(count) || count <= 1) return null;
  return round(clamp(100 - ((rank - 1) / (count - 1)) * 100), 2);
}

function momentumScore({ mentions, mentions_24h_ago: previousMentions }) {
  if (!Number.isFinite(mentions) || !Number.isFinite(previousMentions)) return null;
  const scale = Math.max(1, Math.sqrt(previousMentions + 1));
  return round(clamp(50 + 20 * Math.tanh((mentions - previousMentions) / scale)), 2);
}

function buildRows({ universeTickers, apeRows, count, sourceDate }) {
  const byTicker = new Map(apeRows.map((row) => [row.ticker, row]));
  return universeTickers.map((ticker) => {
    const row = byTicker.get(ticker) ?? null;
    const hasRow = Boolean(row);
    const score = hasRow ? attentionScoreFromRank(row.rank, count) : null;
    return {
      ticker,
      as_of: sourceDate,
      source_date: sourceDate,
      confidence: hasRow ? "medium" : "low",
      coverage_ratio: hasRow ? 1 : 0,
      source_family: "ApeWisdom all-stocks aggregate",
      caveat_code: "attention_proxy_not_sentiment",
      social_attention_proxy: {
        score_0_100: score,
        momentum_score_0_100: hasRow ? momentumScore(row) : null,
        rank: hasRow ? row.rank : null,
        mentions: hasRow ? row.mentions : null,
        upvotes: hasRow ? row.upvotes : null,
        rank_24h_ago: hasRow ? row.rank_24h_ago : null,
        mentions_24h_ago: hasRow ? row.mentions_24h_ago : null,
        caveat: "ApeWisdom ticker-level mention aggregate; attention proxy only, not sentiment, bullishness, or Reddit raw corpus.",
      },
    };
  });
}

async function loadPages({ filter, maxPages, inputFile, noFetch, cacheDate, privateDir = privateRoot, request = fetchJson }) {
  if (inputFile) {
    const payload = JSON.parse(fs.readFileSync(path.resolve(inputFile), "utf8"));
    return Array.isArray(payload) ? payload : [payload];
  }
  const pages = [];
  let totalPages = maxPages;
  for (let page = 1; page <= totalPages && page <= maxPages; page++) {
    const cachePath = path.join(privateDir, filter, cacheDate, `page-${page}.json`);
    if (fs.existsSync(cachePath)) {
      pages.push(JSON.parse(fs.readFileSync(cachePath, "utf8")));
    } else {
      if (noFetch) break;
      const payload = await request(apeWisdomUrl(filter, page));
      writePrivateJson(cachePath, payload);
      pages.push(payload);
    }
    const last = pages[pages.length - 1];
    totalPages = Math.min(maxPages, Number(last.pages) || maxPages);
  }
  return pages;
}

function buildSnapshot({ filter, pages, rows, sourceDate, sourceAsOf, providerObservationPayloadSha256, generatedAt }) {
  const firstPage = pages[0] ?? {};
  const count = Number(firstPage.count) || rows.length;
  return {
    schema_version: 1,
    generated_at: generatedAt,
    formula_version: FORMULA_VERSION,
    source: {
      provider: "ApeWisdom",
      filter,
      source_url: apeWisdomUrl(filter, 1),
      source_date: sourceDate,
      source_as_of: sourceAsOf,
      provider_observation_payload_sha256: providerObservationPayloadSha256,
      pages_collected: pages.length,
      reported_count: count,
    },
    public_surface_status: "admin_private_derived_only_not_public",
    raw_policy: {
      external_collection: true,
      raw_cache_public: false,
      third_party_raw_public: false,
      raw_cache_path: path.relative(repoRoot, path.join(privateRoot, filter, sourceDate)),
      public_payload: null,
    },
    semantics: {
      socialAttentionProxyScore: "Higher means a higher ApeWisdom mention rank within the selected aggregate feed; not sentiment or direction.",
      socialAttentionMomentumScore: "Higher means mentions increased versus ApeWisdom's 24h-ago mention field.",
    },
    coverage: {
      row_count: rows.length,
      with_attention: rows.filter((row) => row.social_attention_proxy.score_0_100 != null).length,
      source_reported_count: count,
    },
    rows,
  };
}

function validSourceDate(value) {
  if (typeof value !== "string" || !/^\d{8}$/.test(value)) return false;
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso;
}

export function mergeHistory(snapshot, { dataRoot: root = dataRoot } = {}) {
  const fallback = {
    schema_version: 1,
    formula_version: FORMULA_VERSION,
    generated_at: snapshot.generated_at,
    rows: [],
  };
  const historyPath = path.join(root, HISTORY_FILE);
  let history = fallback;
  if (fs.existsSync(historyPath)) {
    try {
      history = JSON.parse(fs.readFileSync(historyPath, "utf8"));
    } catch (error) {
      throw new Error(`ApeWisdom history is invalid JSON: ${error.message}`);
    }
    if (history?.schema_version !== 1 || history?.formula_version !== FORMULA_VERSION || !Array.isArray(history?.rows)) {
      throw new Error("ApeWisdom history contract is invalid");
    }
  }
  const incoming = snapshot.rows
    .filter((row) => row.social_attention_proxy.score_0_100 != null)
    .map((row) => ({
      ticker: row.ticker,
      as_of: row.as_of,
      source_date: row.source_date,
      confidence: row.confidence,
      socialAttentionProxyScore: row.social_attention_proxy.score_0_100,
      socialAttentionMomentumScore: row.social_attention_proxy.momentum_score_0_100,
      mentions: row.social_attention_proxy.mentions,
      rank: row.social_attention_proxy.rank,
    }));
  const incomingKeys = new Set(incoming.map((row) => `${row.ticker}|${row.source_date}`));
  const kept = (history.rows ?? []).filter((row) => !incomingKeys.has(`${row.ticker}|${row.source_date}`));
  const all = [...kept, ...incoming];
  if (all.some((row) => !validSourceDate(row?.source_date))) {
    throw new Error("ApeWisdom history carries an invalid provider source date");
  }
  const sourceDates = [...new Set(all.map((row) => row.source_date))].sort();
  const retainedSourceDates = new Set(sourceDates.slice(-MAX_APEWISDOM_HISTORY_SOURCE_DATES));
  const retainedRows = all.filter((row) => retainedSourceDates.has(row.source_date));
  return {
    schema_version: 1,
    formula_version: FORMULA_VERSION,
    generated_at: snapshot.generated_at,
    raw_policy: {
      third_party_raw_public: false,
      rows_are_derived_only: true,
    },
    persistence_policy: APEWISDOM_HISTORY_PERSISTENCE_POLICY,
    persistence_state: {
      available_source_dates: sourceDates.length,
      retained_source_dates: retainedSourceDates.size,
      pruned_source_dates: sourceDates.length - retainedSourceDates.size,
    },
    rows: retainedRows.sort((a, b) => (
      String(a.ticker).localeCompare(String(b.ticker)) || String(a.source_date).localeCompare(String(b.source_date))
    )),
  };
}

async function build(args, {
  cacheDate = ymdNow(),
  sourceAsOf = null,
  providerObservationPayloadSha256 = null,
  generatedAt = isoNow(),
  dataRoot: root = dataRoot,
  privateDir = privateRoot,
  pages: suppliedPages = null,
  request = fetchJson,
  write = !args.noWrite,
} = {}) {
  if (typeof sourceAsOf !== "string" || !Number.isFinite(Date.parse(sourceAsOf))) {
    throw new Error("ApeWisdom provider source_as_of is required");
  }
  if (!/^[0-9a-f]{64}$/.test(providerObservationPayloadSha256 ?? "")) {
    throw new Error("ApeWisdom provider observation payload hash is required");
  }
  const pages = suppliedPages ?? await loadPages({
    filter: args.filter,
    maxPages: args.maxPages,
    inputFile: args.inputFile,
    noFetch: args.noFetch,
    cacheDate,
    privateDir,
    request,
  });
  const firstPage = pages[0] ?? {};
  const apeRows = normalizeApeRows(pages);
  const tickers = loadTickerUniverse({ ...args, dataRoot: root });
  const sourceDate = sourceAsOf.slice(0, 10).replaceAll("-", "");
  const rows = buildRows({
    universeTickers: tickers,
    apeRows,
    count: Number(firstPage.count) || apeRows.length,
    sourceDate,
  });
  const snapshot = buildSnapshot({
    filter: args.filter,
    pages,
    rows,
    sourceDate,
    sourceAsOf,
    providerObservationPayloadSha256,
    generatedAt,
  });
  const history = mergeHistory(snapshot, { dataRoot: root });
  if (write) {
    writeJson(OUTPUT_FILE, snapshot, root);
    writeJson(HISTORY_FILE, history, root);
  }
  return {
    output_file: `data/${OUTPUT_FILE}`,
    history_file: `data/${HISTORY_FILE}`,
    wrote: write,
    filter: args.filter,
    pages_collected: pages.length,
    coverage: snapshot.coverage,
    sample_rows: snapshot.rows
      .filter((row) => row.social_attention_proxy.score_0_100 != null)
      .slice(0, 8),
    snapshot,
    history,
  };
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function serializeDocument(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function validRfc3339Utc(value) {
  return typeof value === "string" && value.endsWith("Z") && Number.isFinite(Date.parse(value));
}

function validApeWisdomProviderObservation(document) {
  return document !== null && typeof document === "object" && !Array.isArray(document)
    && document.schema_version === "apewisdom-provider-observation/v1"
    && validRfc3339Utc(document.source_as_of)
    && document.response !== null && typeof document.response === "object" && !Array.isArray(document.response)
    && Array.isArray(document.response.results) && document.response.results.length > 0;
}

function apeWisdomProviderSourceAsOf(document) {
  return validApeWisdomProviderObservation(document) ? document.source_as_of : null;
}

function validApeWisdomSnapshot(document) {
  const source = document?.source;
  return document !== null && typeof document === "object" && !Array.isArray(document)
    && document.schema_version === 1
    && source?.provider === "ApeWisdom"
    && validRfc3339Utc(source.source_as_of)
    && validSourceDate(source.source_date)
    && source.source_date === source.source_as_of.slice(0, 10).replaceAll("-", "")
    && /^[0-9a-f]{64}$/.test(source.provider_observation_payload_sha256 ?? "")
    && Array.isArray(document.rows) && document.rows.length > 0;
}

function apeWisdomSnapshotSourceAsOf(document) {
  return validApeWisdomSnapshot(document) ? document.source.source_as_of : null;
}

// The pre-L/P/R canonical has only source_date, which was assigned by our
// observer. It is not a provider observation and must never be a candidate for
// new primary promotion. It is accepted only to seed an existing deployment's
// first retained LKG when the provider is already unavailable.
function validLegacyApeWisdomSnapshot(document) {
  const source = document?.source;
  return document !== null && typeof document === "object" && !Array.isArray(document)
    && document.schema_version === 1
    && source?.provider === "ApeWisdom"
    && typeof source.filter === "string" && typeof source.source_url === "string"
    && validSourceDate(source.source_date)
    && !Object.hasOwn(source, "source_as_of")
    && !Object.hasOwn(source, "provider_observation_payload_sha256")
    && Array.isArray(document.rows) && document.rows.length > 0;
}

function legacyApeWisdomSourceAsOf(document) {
  if (!validLegacyApeWisdomSnapshot(document)) return null;
  const sourceDate = document.source.source_date;
  return `${sourceDate.slice(0, 4)}-${sourceDate.slice(4, 6)}-${sourceDate.slice(6, 8)}T00:00:00.000Z`;
}

function readLegacyApeWisdomSnapshot(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const document = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return validLegacyApeWisdomSnapshot(document) ? document : null;
  } catch {
    return null;
  }
}

function legacyLkgSeedAllowed({ runnerRepoRoot, recoveryState }) {
  const item = recoveryState?.items?.[LKG_KEY];
  if (!item) return true;
  const descriptor = item?.lkg;
  const expectedPath = `data/admin/${LANE_ID}/lkg/${LKG_KEY}.json`;
  if (item.resolution_state !== "lkg_primary" || descriptor?.path !== expectedPath) return false;
  return readLegacyApeWisdomSnapshot(path.join(runnerRepoRoot, descriptor.path)) !== null;
}

function candidateContainsProviderObservation(candidateDocument, providerDocument) {
  if (!validApeWisdomSnapshot(candidateDocument) || !validApeWisdomProviderObservation(providerDocument)) return false;
  return candidateDocument.source.source_as_of === providerDocument.source_as_of
    && candidateDocument.source.provider_observation_payload_sha256 === sha256Hex(
      Buffer.from(serializeDocument(providerDocument)),
    );
}

function validateControlledFailure(value, eventName) {
  if (!value) return false;
  if (value !== "transport") throw new Error(`unknown ApeWisdom controlled failure: ${value}`);
  if (eventName !== "workflow_dispatch") throw new Error("controlled failure requires workflow_dispatch");
  return true;
}

function apeWisdomLkgArtifact(canonicalPath, { allowLegacy = false } = {}) {
  return {
    key: LKG_KEY,
    canonicalPath,
    validateDocument: (document) => validApeWisdomSnapshot(document)
      || (allowLegacy && validLegacyApeWisdomSnapshot(document)),
    sourceAsOf: (document) => apeWisdomSnapshotSourceAsOf(document)
      ?? (allowLegacy ? legacyApeWisdomSourceAsOf(document) : null),
  };
}

export async function runApeWisdomAttention({
  repoRoot: runnerRepoRoot = repoRoot,
  dataRoot: runnerDataRoot = dataRoot,
  privateRoot: runnerPrivateRoot = privateRoot,
  canonicalPath = path.join(runnerDataRoot, OUTPUT_FILE),
  historyPath = path.join(runnerDataRoot, HISTORY_FILE),
  attemptShardPath = path.join(runnerRepoRoot, "data", "admin", "data-supply-state", "detection-attempts", `${LANE_ID}.json`),
  filter = DEFAULT_FILTER,
  maxPages = 10,
  tickers = "",
  limit = 0,
  inputFile = "",
  noFetch = false,
  noWrite = false,
  request = rawGet,
  observedAt = isoNow(),
  attemptId = defaultAttemptId("apewisdom-attention", observedAt),
  runId = process.env.GITHUB_RUN_ID || "local",
  runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1),
  eventName = process.env.GITHUB_EVENT_NAME || "local",
  controlledFailure = process.env.INPUT_CONTROLLED_FAILURE || "",
} = {}) {
  if (!SUPPORTED_FILTERS.has(filter)) throw new Error(`Unsupported ApeWisdom filter: ${filter}`);
  const controlled = validateControlledFailure(String(controlledFailure).trim(), eventName);
  const run = { runId: String(runId), runAttempt: Number(runAttempt), eventName, observedAt };
  const lkgStore = new LaneLkgStore({ repoRoot: runnerRepoRoot, laneId: LANE_ID });
  const initialRecoveryState = lkgStore.stateSnapshot();
  const artifact = apeWisdomLkgArtifact(canonicalPath, {
    allowLegacy: legacyLkgSeedAllowed({ runnerRepoRoot, recoveryState: initialRecoveryState }),
  });
  const args = { filter, maxPages, tickers, limit, inputFile, noFetch, noWrite };

  // Always observe and persist the current endpoint-contract result first. The
  // LKG store is deliberately separate from this attempt evidence.
  const observation = await observeAttempt({ filter, controlledFailure: controlled, request });
  const attempt = noWrite ? null : writeAttemptShard({
    laneId: LANE_ID,
    attemptShardPath,
    observedAt,
    attemptId,
    result: observation.result,
  });
  const recordFailure = (reason) => {
    if (noWrite) {
      return { hasCompleteLkg: lkgStore.validRetainedLkg(LKG_KEY, artifact.validateDocument, artifact.sourceAsOf), retrySet: lkgStore.stateSnapshot().retry_set };
    }
    return lkgStore.recordFailure({ artifacts: [artifact], run, reason });
  };
  const fail = (reason) => {
    const failure = recordFailure(reason);
    return {
      ok: false,
      reason,
      attempt,
      retrySet: failure.retrySet,
      ...classifyLkgFailure({ reason, hasCompleteLkg: failure.hasCompleteLkg }),
    };
  };
  if (observation.result.status !== "ready") {
    return fail(controlled ? "controlled_failure" : observation.result.reason);
  }

  const sourceAsOf = providerSourceAsOf(observation.response);
  if (sourceAsOf === null || observation.document === null) return fail("source_date_unavailable");
  const providerObservation = {
    schema_version: "apewisdom-provider-observation/v1",
    source_as_of: sourceAsOf,
    response: observation.document,
  };
  const providerSerialized = serializeDocument(providerObservation);
  const cacheDate = sourceAsOf.slice(0, 10).replaceAll("-", "");

  // Reuse the exact page-1 response that supplied the provider-issued Date.
  let built;
  try {
    if (!noWrite) writePrivateJson(path.join(runnerPrivateRoot, filter, cacheDate, "page-1.json"), observation.document);
    built = await build(args, {
      cacheDate,
      sourceAsOf,
      providerObservationPayloadSha256: sha256Hex(Buffer.from(providerSerialized)),
      generatedAt: observedAt,
      dataRoot: runnerDataRoot,
      privateDir: runnerPrivateRoot,
      write: false,
    });
  } catch (error) {
    return fail(transportError(error) ? "transport_error" : "unexpected_error");
  }
  const serialized = serializeDocument(built.snapshot);
  const candidate = {
    key: LKG_KEY,
    currentRelativePath: path.relative(runnerRepoRoot, canonicalPath),
    payloadBytes: Buffer.from(serialized),
    sourceAsOf: apeWisdomSnapshotSourceAsOf(built.snapshot),
    validateDocument: validApeWisdomSnapshot,
    deriveSourceAsOf: apeWisdomSnapshotSourceAsOf,
    promotion_contract: PROMOTION_CONTRACT_PROVIDER_OBSERVATION_V2,
    provider_observation: buildProviderObservationV2({
      payloadBytes: Buffer.from(providerSerialized),
      sourceAsOf: apeWisdomProviderSourceAsOf(providerObservation),
      validateDocument: validApeWisdomProviderObservation,
      deriveSourceAsOf: apeWisdomProviderSourceAsOf,
      candidateContainsObservation: candidateContainsProviderObservation,
      run,
    }),
  };
  const recoveryState = lkgStore.stateSnapshot();
  if (recoveryState.items[LKG_KEY]?.retry === true && !isNaturalScheduleRun(run)) {
    return {
      ok: false,
      reason: "recovery_requires_schedule",
      attempt,
      retrySet: recoveryState.retry_set,
      degraded: true,
      corrupt: false,
      exitCode: 0,
    };
  }
  const decisions = lkgStore.evaluatePromotionCandidates([candidate], run);
  if (!decisions[0].eligible) {
    const reason = decisions[0].reason;
    if (["foreign_writer_conflict", "recovery_not_advanced_by_provider"].includes(reason) && !noWrite) {
      lkgStore.recordPromotionDeferral({ artifacts: [candidate], run, reason });
    }
    return {
      ok: false,
      reason,
      attempt,
      retrySet: lkgStore.stateSnapshot().retry_set,
      degraded: true,
      corrupt: false,
      exitCode: 0,
    };
  }
  if (noWrite) return { ok: true, reason: "ok", attempt, retrySet: recoveryState.retry_set, wrote: false, recovered: false };
  atomicWrite(canonicalPath, serialized);
  atomicWrite(historyPath, serializeDocument(built.history));
  const success = lkgStore.recordSuccess({ artifacts: [candidate], run });
  return {
    ok: true,
    reason: "ok",
    attempt,
    retrySet: success.retrySet,
    wrote: true,
    recovered: success.state.items[LKG_KEY]?.recovered_at === observedAt,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outcome = await runApeWisdomAttention(args);
  if (!outcome.ok) {
    const prefix = outcome.degraded ? "[degraded]" : "[corrupt]";
    const message = `${prefix} ApeWisdom attention ${outcome.reason}; retry set: ${(outcome.retrySet ?? []).join(", ") || "none"}`;
    if (outcome.degraded) console.log(message);
    else console.error(message);
    process.exitCode = outcome.exitCode ?? 2;
    return;
  }
  console.log(JSON.stringify(outcome, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

export {
  attentionScoreFromRank,
  buildRows,
  momentumScore,
  normalizeApeRows,
  parseArgs,
};
