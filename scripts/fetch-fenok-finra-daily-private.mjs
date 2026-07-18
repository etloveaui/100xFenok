#!/usr/bin/env node
/**
 * Private/admin FINRA source/backfill loader.
 *
 * Scope:
 * - Defaults to the FINRA CNMS daily short-volume dataset only.
 * - Writes only under _private/admin/fenok-flow/finra/.
 * - Does not create public/computed mirrors or product-facing scores.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  attemptResult,
  atomicWrite,
  classifyEndpointResponse,
  defaultAttemptId,
  returnedTuple,
  threwTuple,
  transportError,
  unobservedTuple,
  worstRequestResult,
  writeAttemptShard,
} from "./lib/data-supply-attempt-shard.mjs";
import {
  LaneLkgStore,
  PROMOTION_CONTRACT_PROVIDER_OBSERVATION_V2,
  buildProviderObservationV2,
  classifyLkgFailure,
  isNaturalScheduleRun,
  systemicLkgFailureReason,
} from "./lib/data-supply-lkg-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const privateRoot = path.join(repoRoot, "_private", "admin", "fenok-flow");
const FINRA_ROOT = path.join(privateRoot, "finra");
const REGSHO_DAILY_CACHE_DIR = path.join(FINRA_ROOT, "regsho_daily");
const MANIFEST_FILE = path.join(FINRA_ROOT, "manifests", "collection_manifest.json");
// Last-known-good recovery lane. FINRA short-volume rows are admin-private
// (raw_public: false), so the store never touches the raw payload: it protects a
// NON-PRIVATE freshness marker (source date + row count + payload hash) that lives
// under the committed data/admin/<lane>/ tree, mirroring fetch-defillama's stable
// canonical without leaking any short-volume rows to the public repo.
const FINRA_LANE_ID = "finra_short_volume";
const FINRA_LKG_KEY = "regsho_daily";
const FINRA_FRESHNESS_MARKER_SCHEMA = "fenok-finra-freshness-marker/v1";
// Bounded persistence (P): alongside the single current-day marker, keep a
// bounded history of the freshest markers — the latest 100 distinct trade
// dates, OCC-consistent. Sparse history is never evicted; malformed dates fail
// closed; re-rotating the same date replaces its entry (idempotent).
const FINRA_PERSISTENCE_POLICY = Object.freeze({
  schema_version: "finra-bounded-persistence/v1",
  basis: "source_date",
  scope: "per_artifact",
  max_distinct_source_dates: 100,
  eviction: "oldest_source_date_first",
});
const FINRA_HISTORY_SCHEMA = "fenok-finra-marker-history/v1";
const DEFAULT_DATASET = "regsho-daily";
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_BACKOFF_MS = 2000;
const DEFAULT_SLEEP_MS = 0;
const DETECTION_CALENDARS = JSON.parse(fs.readFileSync(
  path.join(__dirname, "lib", "data-supply-detection-calendars.json"),
  "utf8",
));
const US_TRADING_CALENDAR = DETECTION_CALENDARS.calendars.find((calendar) => calendar.id === "us_trading");
const US_TRADING_HOLIDAYS = new Set(US_TRADING_CALENDAR?.holidays ?? []);
const FINRA_AVAILABILITY_POLICY = {
  source_id: "finra_daily_short_sale_volume_files",
  availability_status: "official_release_by_time_verified",
  official_release_by_local_time: "18:00 America/New_York same trade date",
  official_evidence: "https://www.finra.org/finra-data/browse-catalog/short-sale-volume-data/daily-short-sale-volume-files",
  kst_equivalent: {
    edt: "next-day 07:00 KST",
    est: "next-day 08:00 KST",
  },
  scheduler_guidance: {
    initial_daily_run_kst: "08:30",
    rationale: "Runs after the known FINRA 18:00 ET deadline in both EDT and EST; keep retries because rare late source/cdn updates are possible.",
    do_not_default_to: ["23:45 ET", "12:45 KST"],
  },
  poll_window_kst: {
    start: "07:05",
    end: "09:30",
  },
};

const DATASETS = {
  [DEFAULT_DATASET]: {
    dataset_id: DEFAULT_DATASET,
    provider: "FINRA",
    display_name: "CNMS daily short sale volume",
    cadence: "daily",
    cache_scope: "admin_private_only",
    raw_public: false,
    public_mirror_allowed: false,
    product_surface_allowed: false,
    endpoint_template: "https://cdn.finra.org/equity/regsho/daily/CNMSshvol{date}.txt",
    cache_dir: REGSHO_DAILY_CACHE_DIR,
    availability_policy: FINRA_AVAILABILITY_POLICY,
    retry_policy: {
      retries: DEFAULT_RETRIES,
      retry_backoff_ms: DEFAULT_RETRY_BACKOFF_MS,
      sleep_ms_between_dates: DEFAULT_SLEEP_MS,
    },
  },
};

function parseArgs(argv) {
  const args = {
    dataset: DEFAULT_DATASET,
    date: "",
    from: "",
    to: "",
    inputFile: "",
    noFetch: false,
    noWrite: false,
    planOnly: false,
    retries: DEFAULT_RETRIES,
    retryBackoffMs: DEFAULT_RETRY_BACKOFF_MS,
    sleepMs: DEFAULT_SLEEP_MS,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    if (arg === "--dataset") args.dataset = next();
    else if (arg === "--date") args.date = next();
    else if (arg === "--from") args.from = next();
    else if (arg === "--to") args.to = next();
    else if (arg === "--input-file") args.inputFile = next();
    else if (arg === "--no-fetch") args.noFetch = true;
    else if (arg === "--no-write") args.noWrite = true;
    else if (arg === "--plan-only") args.planOnly = true;
    else if (arg === "--retries") args.retries = Number(next()) || 0;
    else if (arg === "--retry-backoff-ms") args.retryBackoffMs = Number(next()) || 0;
    else if (arg === "--sleep-ms") args.sleepMs = Number(next()) || 0;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function datasetConfig(dataset) {
  const key = String(dataset ?? "").trim() || DEFAULT_DATASET;
  const config = DATASETS[key];
  if (!config) {
    throw new Error(`Unsupported FINRA dataset: ${dataset}. Enabled datasets: ${Object.keys(DATASETS).join(", ")}`);
  }
  return config;
}

function normalizeDate(value) {
  const raw = String(value ?? "").trim();
  const compact = raw.replaceAll("-", "");
  if (!/^\d{8}$/.test(compact)) {
    throw new Error(`Expected --date YYYYMMDD or YYYY-MM-DD, got: ${value}`);
  }
  return compact;
}

function isoFromYmd(yyyymmdd) {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function ymdFromDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function latestWeekdayYmd(referenceDate = new Date()) {
  const d = new Date(Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate(),
  ));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return ymdFromDate(d);
}

function isUsTradingDate(yyyymmdd) {
  const iso = isoFromYmd(yyyymmdd);
  const date = new Date(`${iso}T00:00:00Z`);
  const day = date.getUTCDay();
  return day !== 0 && day !== 6 && !US_TRADING_HOLIDAYS.has(iso);
}

function expandDateRange({ date, from, to }) {
  if (date && (from || to)) {
    throw new Error("Use either --date or --from/--to, not both.");
  }
  if (date) return [normalizeDate(date)];
  if (from || to) {
    if (!from || !to) throw new Error("--from and --to must be provided together.");
    const start = normalizeDate(from);
    const end = normalizeDate(to);
    if (start > end) throw new Error(`Expected --from <= --to, got ${from} > ${to}`);
    const out = [];
    const cursor = new Date(Date.UTC(
      Number(start.slice(0, 4)),
      Number(start.slice(4, 6)) - 1,
      Number(start.slice(6, 8)),
    ));
    const endDate = new Date(Date.UTC(
      Number(end.slice(0, 4)),
      Number(end.slice(4, 6)) - 1,
      Number(end.slice(6, 8)),
    ));
    while (cursor <= endDate) {
      const day = cursor.getUTCDay();
      if (day !== 0 && day !== 6) out.push(ymdFromDate(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return out;
  }
  return [latestWeekdayYmd()];
}

function endpointForDate(yyyymmdd) {
  return DATASETS[DEFAULT_DATASET].endpoint_template.replace("{date}", yyyymmdd);
}

function numberValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replaceAll(",", "").trim());
  return Number.isFinite(n) ? n : null;
}

function parseDelimitedLine(line) {
  const [date, symbol, shortVolume, shortExemptVolume, totalVolume, market] = line.split("|");
  return {
    date: String(date ?? "").trim(),
    symbol: String(symbol ?? "").trim().toUpperCase(),
    shortVolume: numberValue(shortVolume),
    shortExemptVolume: numberValue(shortExemptVolume),
    totalVolume: numberValue(totalVolume),
    market: String(market ?? "").trim(),
  };
}

function parseFinraDailyShortVolume(text, expectedDate = "") {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  const header = lines[0].split("|").map((part) => part.trim());
  const expectedHeader = ["Date", "Symbol", "ShortVolume", "ShortExemptVolume", "TotalVolume", "Market"];
  if (expectedHeader.some((part, index) => header[index] !== part)) {
    throw new Error(`Unexpected FINRA header: ${header.join("|")}`);
  }

  const rows = [];
  for (const line of lines.slice(1)) {
    const parsed = parseDelimitedLine(line);
    if (!parsed.symbol || parsed.shortVolume === null || parsed.totalVolume === null) continue;
    if (expectedDate && parsed.date !== expectedDate) continue;
    const shortVolumeRatio = parsed.totalVolume > 0 ? parsed.shortVolume / parsed.totalVolume : null;
    const shortExemptRatio = parsed.totalVolume > 0 ? (parsed.shortExemptVolume ?? 0) / parsed.totalVolume : null;
    rows.push({
      date: parsed.date,
      symbol: parsed.symbol,
      short_volume: parsed.shortVolume,
      short_exempt_volume: parsed.shortExemptVolume ?? 0,
      total_volume: parsed.totalVolume,
      short_volume_ratio: shortVolumeRatio,
      short_exempt_ratio: shortExemptRatio,
      market: parsed.market,
    });
  }
  return rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function buildPayload({ yyyymmdd, sourceUrl, fetchedAt, rows }) {
  const dataset = DATASETS[DEFAULT_DATASET];
  return {
    schema_version: 1,
    provider: dataset.provider,
    dataset_id: dataset.dataset_id,
    dataset: dataset.display_name,
    date: yyyymmdd,
    as_of: isoFromYmd(yyyymmdd),
    generated_at: fetchedAt,
    source_url: sourceUrl,
    cache_scope: dataset.cache_scope,
    raw_public: dataset.raw_public,
    public_mirror_allowed: dataset.public_mirror_allowed,
    product_surface_allowed: dataset.product_surface_allowed,
    caveats: [
      "FINRA daily short-volume is an off-exchange/short-volume proxy, not true dark-pool intent.",
      "ShortVolume/TotalVolume is not buyer/seller direction.",
      "Rows must remain admin-private until owner/legal redistribution review clears a derived public surface.",
    ],
    fields: [
      "date",
      "symbol",
      "short_volume",
      "short_exempt_volume",
      "total_volume",
      "short_volume_ratio",
      "short_exempt_ratio",
      "market",
    ],
    row_count: rows.length,
    rows,
  };
}

async function fetchResponse(url) {
  const response = await fetch(url);
  return { statusCode: response.status, body: await response.text() };
}

function isMissingFileError(err) {
  // FINRA's CDN answers 403 (not 404) for files that do not exist, e.g. market
  // holidays inside the requested window or today's file before publication.
  return err && (err.httpStatus === 403 || err.httpStatus === 404);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchResponseWithRetry(url, {
  retries = DEFAULT_RETRIES,
  retryBackoffMs = DEFAULT_RETRY_BACKOFF_MS,
  request = fetchResponse,
} = {}) {
  let lastError = null;
  let lastResponse = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      lastResponse = await request(url);
      if ((lastResponse.statusCode >= 200 && lastResponse.statusCode < 300) || [403, 404].includes(lastResponse.statusCode)) {
        return lastResponse;
      }
      lastError = null;
    } catch (err) {
      lastError = err;
    }
    if (attempt >= retries) break;
    if (retryBackoffMs > 0) await sleep(retryBackoffMs);
  }
  if (lastError) throw lastError;
  return lastResponse;
}

function thrownEndpointResult(error) {
  const exceptionKind = transportError(error) ? "transport" : "unexpected";
  return attemptResult(
    exceptionKind === "transport" ? "transport_error" : "unexpected_error",
    threwTuple(exceptionKind),
  );
}

function stableAttemptId(prefix, observedAt) {
  const runId = String(process.env.GITHUB_RUN_ID || "").trim();
  const runAttempt = String(process.env.GITHUB_RUN_ATTEMPT || "1").trim();
  return runId ? `${prefix}-${runId}-${runAttempt}` : defaultAttemptId(prefix, observedAt);
}

function classifyFinraEndpointResponse(response, expectedDate = "") {
  if ([403, 404].includes(response?.statusCode)) {
    return {
      ...attemptResult("http_error", returnedTuple({ httpStatus: response.statusCode })),
      expectedMissing: Boolean(expectedDate) && !isUsTradingDate(expectedDate),
    };
  }
  return {
    ...classifyEndpointResponse(response, {
      laneId: "finra_short_volume",
      decodeBody: (body) => ({ rows: parseFinraDailyShortVolume(body, expectedDate) }),
    }),
    expectedMissing: false,
  };
}

function reduceFinraEndpointResults(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return attemptResult("workflow_unobserved", unobservedTuple());
  }
  const ready = results.filter((result) => result.status === "ready");
  const actionable = results.filter((result) => result.expectedMissing !== true);
  if (ready.length > 0 && actionable.every((result) => result.status === "ready")) {
    return worstRequestResult(ready);
  }
  return worstRequestResult(actionable.length > 0 ? actionable : results);
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function freshnessMarkerPathFor(repoRootDir) {
  return path.join(repoRootDir, "data", "admin", FINRA_LANE_ID, "current", `${FINRA_LKG_KEY}.json`);
}

// The freshness marker is the store's canonical: a small, PUBLIC-SAFE record of the
// latest ready trade date, its row count, and a sha256 of the private payload. It
// carries no short-volume rows, so committing it never violates the lane's
// admin_private_only / raw_public:false contract.
function buildFreshnessMarker({ payload, generatedAt }) {
  const payloadBytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return {
    schema_version: FINRA_FRESHNESS_MARKER_SCHEMA,
    lane_id: FINRA_LANE_ID,
    dataset_id: payload.dataset_id,
    source_as_of: payload.as_of,
    trade_date: payload.date,
    row_count: payload.row_count,
    payload_sha256: sha256Hex(payloadBytes),
    generated_at: generatedAt,
    raw_public: false,
    public_mirror_allowed: false,
  };
}

function validFreshnessMarker(doc) {
  return Boolean(doc)
    && typeof doc === "object"
    && !Array.isArray(doc)
    && doc.schema_version === FINRA_FRESHNESS_MARKER_SCHEMA
    && doc.lane_id === FINRA_LANE_ID
    && typeof doc.dataset_id === "string" && doc.dataset_id.length > 0
    && typeof doc.source_as_of === "string" && /^\d{4}-\d{2}-\d{2}$/.test(doc.source_as_of)
    && Number.isFinite(Date.parse(doc.source_as_of))
    && typeof doc.trade_date === "string" && /^\d{8}$/.test(doc.trade_date)
    && Number.isInteger(doc.row_count) && doc.row_count >= 0
    && typeof doc.payload_sha256 === "string" && /^[0-9a-f]{64}$/.test(doc.payload_sha256)
    && doc.raw_public === false
    && doc.public_mirror_allowed === false;
}

function freshnessMarkerSourceAsOf(doc) {
  return validFreshnessMarker(doc) ? doc.source_as_of : null;
}

function finraHistoryPathFor(repoRootDir) {
  return path.join(repoRootDir, "data", "admin", FINRA_LANE_ID, "history", `${FINRA_LKG_KEY}.json`);
}

// Retain only entries whose source_as_of is within the newest N distinct
// dates. Fail-closed: every entry must be a valid freshness marker with a
// parseable source_as_of; duplicate dates collapse to the newest generated_at
// (idempotent re-rotation).
function retainLatestMarkerDates(entries, policy = FINRA_PERSISTENCE_POLICY) {
  const maxDates = Number(policy?.max_distinct_source_dates);
  if (!Number.isInteger(maxDates) || maxDates <= 0) {
    throw new Error("invalid FINRA persistence max_distinct_source_dates");
  }
  const rows = Array.isArray(entries) ? entries : [];
  const byDate = new Map();
  for (const entry of rows) {
    if (!validFreshnessMarker(entry)) {
      throw new Error(`invalid FINRA history entry: ${entry?.source_as_of ?? "unknown"}`);
    }
    const date = entry.source_as_of;
    const prior = byDate.get(date);
    if (!prior || String(entry.generated_at) >= String(prior.generated_at)) byDate.set(date, entry);
  }
  const retainedDates = new Set([...byDate.keys()].sort().reverse().slice(0, maxDates));
  const retained = [...byDate.values()]
    .filter((entry) => retainedDates.has(entry.source_as_of))
    .sort((a, b) => b.source_as_of.localeCompare(a.source_as_of));
  return {
    entries: retained,
    stats: {
      distinct_source_dates: byDate.size,
      entries_before: rows.length,
      entries_retained: retained.length,
      pruned: byDate.size - retained.length,
    },
  };
}

function validFinraHistory(doc) {
  return Boolean(doc)
    && typeof doc === "object"
    && !Array.isArray(doc)
    && doc.schema_version === FINRA_HISTORY_SCHEMA
    && doc.lane_id === FINRA_LANE_ID
    && doc.persistence_policy?.schema_version === FINRA_PERSISTENCE_POLICY.schema_version
    && Array.isArray(doc.entries)
    && doc.entries.every((entry) => validFreshnessMarker(entry));
}

// Rotate the bounded marker history after a fresh-primary promotion. The
// history file is the lane's only record of prior trade dates (the store's
// current/lkg slots hold at most two), so its writes are fail-closed: a
// corrupt existing history throws instead of silently dropping dates.
function rotateFinraMarkerHistory({ repoRootDir, historyPath = finraHistoryPathFor(repoRootDir), marker, generatedAt }) {
  if (!validFreshnessMarker(marker)) {
    throw new Error("FINRA history rotation requires a valid freshness marker");
  }
  let existing = [];
  if (fs.existsSync(historyPath)) {
    const doc = readJson(historyPath, null);
    if (!validFinraHistory(doc)) {
      throw new Error(`FINRA marker history is corrupt: ${path.relative(repoRootDir, historyPath)}`);
    }
    existing = doc.entries;
  }
  const retained = retainLatestMarkerDates([marker, ...existing]);
  const doc = {
    schema_version: FINRA_HISTORY_SCHEMA,
    lane_id: FINRA_LANE_ID,
    persistence_policy: FINRA_PERSISTENCE_POLICY,
    generated_at: generatedAt,
    entries: retained.entries,
  };
  atomicWrite(historyPath, `${JSON.stringify(doc, null, 2)}\n`);
  return { history: doc, stats: retained.stats };
}

// The store's freshness anchor is the NEWEST expected trading date in the window.
// Holidays/weekends are not trading dates (isUsTradingDate), so their 403s never
// enter the failure cycle: a window with no trading date at all is EXPECTED ABSENCE,
// a window whose newest trading date was collected is SUCCESS, and a window whose
// newest trading date is genuinely missing is a FAILURE (retain LKG). An older
// date's transient miss cannot demote a lane whose latest trading data is present.
function computeFinraLkgOutcome({ dates, results }) {
  const tradingDates = (dates ?? []).filter((date) => isUsTradingDate(date)).sort();
  if (tradingDates.length === 0) {
    return { kind: "expected_absence" };
  }
  const newestTradingDate = tradingDates[tradingDates.length - 1];
  const collected = new Map((results ?? []).map((result) => [result.payload.date, result]));
  if (collected.has(newestTradingDate)) {
    return { kind: "success", latest: collected.get(newestTradingDate) };
  }
  return { kind: "failure" };
}

function finraLkgArtifactDescriptor(markerPath) {
  return {
    key: FINRA_LKG_KEY,
    canonicalPath: markerPath,
    validateDocument: validFreshnessMarker,
    sourceAsOf: freshnessMarkerSourceAsOf,
  };
}

// Additive LKG recovery wrapper around the existing per-date collection. It never
// mutates the detection attempt shard (that stays owned by writeAttemptShard) and
// never rewrites a per-date payload; it only maintains the store's freshness marker,
// LKG copy, and recovery index under data/admin/finra_short_volume/.
function applyFinraLkgStore({ repoRoot: storeRepoRoot, markerPath, dates, endpointResults, results, run }) {
  const store = new LaneLkgStore({ repoRoot: storeRepoRoot, laneId: FINRA_LANE_ID });
  const artifact = finraLkgArtifactDescriptor(markerPath);
  const outcome = computeFinraLkgOutcome({ dates, results });

  if (outcome.kind === "expected_absence") {
    return { kind: "expected_absence", updated: false };
  }

  if (outcome.kind === "failure") {
    const actionableReasons = (endpointResults ?? [])
      .filter((result) => result?.expectedMissing !== true)
      .map((result) => result?.reason);
    const reason = systemicLkgFailureReason(actionableReasons)
      ?? reduceFinraEndpointResults(endpointResults).reason;
    const failure = store.recordFailure({ artifacts: [artifact], run, reason });
    return {
      kind: "failure",
      updated: false,
      reason,
      retrySet: failure.retrySet,
      ...classifyLkgFailure({ reason, hasCompleteLkg: failure.hasCompleteLkg }),
    };
  }

  const marker = buildFreshnessMarker({ payload: outcome.latest.payload, generatedAt: run.observedAt });
  const serialized = `${JSON.stringify(marker, null, 2)}\n`;
  const sourceAsOf = marker.source_as_of;
  const payloadBytes = Buffer.from(serialized, "utf8");
  const markerRelative = path.relative(storeRepoRoot, path.resolve(markerPath)).split(path.sep).join("/");

  const snapshot = store.stateSnapshot();
  const priorItem = snapshot.items[FINRA_LKG_KEY];
  const retryActive = priorItem?.retry === true;
  const priorSourceAsOf = priorItem?.current?.source_as_of;
  // Backfill guard: outside an active retry, only advance the freshness anchor when
  // the provider date is strictly newer. A range/backfill of older dates must never
  // regress the marker. During a retry the store's own advancement gate governs.
  if (!retryActive && typeof priorSourceAsOf === "string"
    && Number.isFinite(Date.parse(priorSourceAsOf))
    && Date.parse(sourceAsOf) <= Date.parse(priorSourceAsOf)) {
    return { kind: "not_newer", updated: false, sourceAsOf };
  }

  const candidate = {
    key: FINRA_LKG_KEY,
    currentRelativePath: markerRelative,
    payloadBytes,
    sourceAsOf,
    validateDocument: validFreshnessMarker,
    deriveSourceAsOf: freshnessMarkerSourceAsOf,
    promotion_contract: PROMOTION_CONTRACT_PROVIDER_OBSERVATION_V2,
    provider_observation: buildProviderObservationV2({
      payloadBytes,
      sourceAsOf,
      validateDocument: validFreshnessMarker,
      deriveSourceAsOf: freshnessMarkerSourceAsOf,
      candidateContainsObservation: (candidateDocument, providerDocument) => (
        JSON.stringify(candidateDocument) === JSON.stringify(providerDocument)
      ),
      run,
    }),
  };

  if (retryActive && !isNaturalScheduleRun(run)) {
    return { kind: "recovery_requires_schedule", updated: false, reason: "recovery_requires_schedule", degraded: true, corrupt: false, exitCode: 0 };
  }

  const [decision] = store.evaluatePromotionCandidates([candidate], run);
  if (!decision.eligible) {
    if (["foreign_writer_conflict", "recovery_not_advanced_by_provider"].includes(decision.reason)) {
      store.recordPromotionDeferral({ artifacts: [candidate], run, reason: decision.reason });
    }
    return { kind: "not_promotable", updated: false, reason: decision.reason, degraded: true, corrupt: false, exitCode: 0 };
  }

  atomicWrite(markerPath, serialized);
  const success = store.recordSuccess({ artifacts: [candidate], run });
  const recovered = success.state.items[FINRA_LKG_KEY]?.recovered_at === run.observedAt;
  const history = rotateFinraMarkerHistory({
    repoRootDir: storeRepoRoot,
    marker,
    generatedAt: run.observedAt,
  });
  return { kind: "success", updated: true, recovered, sourceAsOf, history: history.stats };
}

function cachePathForDate(yyyymmdd) {
  return path.join(REGSHO_DAILY_CACHE_DIR, `CNMSshvol${yyyymmdd}.json`);
}

function rawTextPathForDate(yyyymmdd) {
  return path.join(REGSHO_DAILY_CACHE_DIR, `CNMSshvol${yyyymmdd}.txt`);
}

function writeJson(abs, payload) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return abs;
}

function readJson(abs, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    return fallback;
  }
}

function writeText(abs, text) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, "utf8");
  return abs;
}

function buildManifest({ previous, entries, generatedAt }) {
  const priorCollections = Array.isArray(previous?.collections) ? previous.collections : [];
  const incomingKeys = new Set(entries.map((entry) => `${entry.dataset_id}|${entry.date}`));
  const kept = priorCollections.filter((entry) => !incomingKeys.has(`${entry.dataset_id}|${entry.date}`));
  return {
    schema_version: 1,
    generated_at: generatedAt,
    cache_scope: "admin_private_only",
    raw_public: false,
    public_mirror_allowed: false,
    default_dataset: DEFAULT_DATASET,
    enabled_datasets: Object.values(DATASETS).map((dataset) => ({
      dataset_id: dataset.dataset_id,
      provider: dataset.provider,
      display_name: dataset.display_name,
      cadence: dataset.cadence,
      endpoint_template: dataset.endpoint_template,
      cache_scope: dataset.cache_scope,
      raw_public: dataset.raw_public,
      public_mirror_allowed: dataset.public_mirror_allowed,
      product_surface_allowed: dataset.product_surface_allowed,
      availability_policy: dataset.availability_policy,
      retry_policy: dataset.retry_policy,
    })),
    collections: [...kept, ...entries].sort((a, b) => (
      String(a.dataset_id).localeCompare(String(b.dataset_id)) || String(a.date).localeCompare(String(b.date))
    )),
  };
}

function manifestEntry({ payload, outputAbs, rawTextAbs, sourceUrl, sourceKind }) {
  return {
    dataset_id: payload.dataset_id,
    provider: payload.provider,
    date: payload.date,
    as_of: payload.as_of,
    generated_at: payload.generated_at,
    source_url: sourceUrl,
    source_kind: sourceKind,
    output_file: path.relative(repoRoot, outputAbs),
    raw_text_file: rawTextAbs ? path.relative(repoRoot, rawTextAbs) : null,
    row_count: payload.row_count,
    cache_scope: payload.cache_scope,
    raw_public: payload.raw_public,
    public_mirror_allowed: payload.public_mirror_allowed,
    product_surface_allowed: payload.product_surface_allowed,
  };
}

async function loadTextForDate({ yyyymmdd, inputFile, noFetch, retries, retryBackoffMs, request }) {
  const rawTextAbs = rawTextPathForDate(yyyymmdd);
  if (inputFile) {
    const abs = path.resolve(inputFile);
    return {
      text: fs.readFileSync(abs, "utf8"),
      sourceUrl: `file://${abs}`,
      sourceKind: "input_file",
      rawTextAbs: abs,
      shouldCacheRawText: false,
      endpointResult: null,
    };
  }
  if (fs.existsSync(rawTextAbs)) {
    return {
      text: fs.readFileSync(rawTextAbs, "utf8"),
      sourceUrl: `file://${rawTextAbs}`,
      sourceKind: "private_raw_cache",
      rawTextAbs,
      shouldCacheRawText: false,
      endpointResult: null,
    };
  }
  if (noFetch) {
    throw new Error(`FINRA raw cache missing for ${yyyymmdd}: ${path.relative(repoRoot, rawTextAbs)}`);
  }
  const sourceUrl = endpointForDate(yyyymmdd);
  const response = await fetchResponseWithRetry(sourceUrl, { retries, retryBackoffMs, request });
  const endpointResult = classifyFinraEndpointResponse(response, yyyymmdd);
  if (endpointResult.status !== "ready") {
    const error = new Error(`FINRA fetch failed: HTTP ${response.statusCode}`);
    error.httpStatus = response.statusCode;
    error.endpointResult = endpointResult;
    throw error;
  }
  return {
    text: response.body,
    sourceUrl,
    sourceKind: "remote_fetch",
    rawTextAbs,
    shouldCacheRawText: true,
    endpointResult,
  };
}

async function collectRegshoDailyDate({ yyyymmdd, inputFile, noFetch, noWrite, generatedAt, retries, retryBackoffMs, request }) {
  const source = await loadTextForDate({ yyyymmdd, inputFile, noFetch, retries, retryBackoffMs, request });
  const rows = parseFinraDailyShortVolume(source.text, yyyymmdd);
  const payload = buildPayload({
    yyyymmdd,
    sourceUrl: source.sourceUrl,
    fetchedAt: generatedAt,
    rows,
  });
  const outputTarget = cachePathForDate(yyyymmdd);
  const outputAbs = noWrite ? outputTarget : writeJson(outputTarget, payload);
  const rawTextAbs = source.shouldCacheRawText && !noWrite
    ? writeText(source.rawTextAbs, source.text)
    : source.rawTextAbs;
  return {
    output_file: noWrite ? null : path.relative(repoRoot, outputAbs),
    planned_output_file: path.relative(repoRoot, outputTarget),
    raw_text_file: rawTextAbs ? path.relative(repoRoot, rawTextAbs) : null,
    wrote: !noWrite,
    row_count: payload.row_count,
    date: yyyymmdd,
    source_url: payload.source_url,
    source_kind: source.sourceKind,
    payload,
    outputAbs,
    rawTextAbs: rawTextAbs && rawTextAbs.startsWith(repoRoot) ? rawTextAbs : null,
    endpointResult: source.endpointResult,
  };
}

async function run(argv = process.argv.slice(2), {
  request = fetchResponse,
  attemptShardPath = path.join(repoRoot, "data/admin/data-supply-state/detection-attempts/finra_short_volume.json"),
  observedAt = new Date().toISOString(),
  attemptId = stableAttemptId("finra-short-volume", observedAt),
  lkgRepoRoot = repoRoot,
  markerPath = freshnessMarkerPathFor(lkgRepoRoot),
  runId = process.env.GITHUB_RUN_ID || "local",
  runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1),
  eventName = process.env.GITHUB_EVENT_NAME || "local",
} = {}) {
  const args = parseArgs(argv);
  const dataset = datasetConfig(args.dataset);
  const dates = expandDateRange(args);
  if (args.inputFile && dates.length !== 1) {
    throw new Error("--input-file can only be used with a single --date.");
  }
  if (args.planOnly) {
    return {
      plan_only: true,
      dataset: dataset.dataset_id,
      dates,
      no_fetch: args.noFetch,
      no_write: args.noWrite,
      outputs: dates.map((yyyymmdd) => ({
        date: yyyymmdd,
        output_file: path.relative(repoRoot, cachePathForDate(yyyymmdd)),
        raw_text_file: path.relative(repoRoot, rawTextPathForDate(yyyymmdd)),
        source_url: endpointForDate(yyyymmdd),
      })),
      manifest_file: path.relative(repoRoot, MANIFEST_FILE),
      availability_policy: dataset.availability_policy,
      retry_policy: {
        retries: args.retries,
        retry_backoff_ms: args.retryBackoffMs,
        sleep_ms_between_dates: args.sleepMs,
      },
      raw_public: dataset.raw_public,
      public_mirror_allowed: dataset.public_mirror_allowed,
      product_surface_allowed: dataset.product_surface_allowed,
    };
  }

  const generatedAt = observedAt;
  const results = [];
  const skippedDates = [];
  const endpointResults = [];
  try {
    for (const yyyymmdd of dates) {
      try {
        const collected = await collectRegshoDailyDate({
        yyyymmdd,
        inputFile: args.inputFile,
        noFetch: args.noFetch,
        noWrite: args.noWrite,
        generatedAt,
        retries: args.retries,
        retryBackoffMs: args.retryBackoffMs,
        request,
        });
        results.push(collected);
        if (collected.endpointResult) endpointResults.push(collected.endpointResult);
      } catch (err) {
        const endpointResult = err?.endpointResult ?? thrownEndpointResult(err);
        endpointResults.push(endpointResult);
        if (!isMissingFileError(err)) throw err;
        // Holiday or not-yet-published file inside the window: record and move on
        // instead of failing the whole run (and with it the downstream data push).
        skippedDates.push({ date: yyyymmdd, reason: `not_published (HTTP ${err.httpStatus})` });
        console.warn(`[finra-daily] skip ${yyyymmdd}: file not published (HTTP ${err.httpStatus})`);
        continue;
      }
      if (args.sleepMs > 0) await sleep(args.sleepMs);
    }
    // Additive LKG recovery: engage only for the automatic latest/window refresh
    // (the daily cron and its dispatch overrides). Explicit single-date, input-file,
    // and no-write invocations are manual/backfill/test paths and never touch the
    // shared recovery state. This keeps every existing --no-write test unaffected.
    const storeMode = !args.noWrite && !args.inputFile && !args.date;
    if (storeMode) {
      applyFinraLkgStore({
        repoRoot: lkgRepoRoot,
        markerPath,
        dates,
        endpointResults,
        results,
        run: {
          runId: String(runId),
          runAttempt: Number(runAttempt),
          eventName,
          observedAt,
        },
      });
    }
    if (results.length === 0 && dates.length > 0) {
      throw new Error(
        `FINRA fetch produced no data for any requested date (${dates[0]}..${dates[dates.length - 1]}); ` +
        "all files missing — refusing to treat a fully-missing window as success.",
      );
    }

    let manifestFile = null;
    if (!args.noWrite) {
    const entries = results.map((result) => manifestEntry({
      payload: result.payload,
      outputAbs: result.outputAbs,
      rawTextAbs: result.rawTextAbs,
      sourceUrl: result.source_url,
      sourceKind: result.source_kind,
    }));
    const manifest = buildManifest({
      previous: readJson(MANIFEST_FILE, null),
      entries,
      generatedAt,
    });
    manifestFile = path.relative(repoRoot, writeJson(MANIFEST_FILE, manifest));
    }

    const totalRows = results.reduce((sum, result) => sum + result.row_count, 0);
    const first = results[0];
    return {
    dataset: dataset.dataset_id,
    dates,
    wrote: !args.noWrite,
    no_fetch: args.noFetch,
    availability_policy: dataset.availability_policy,
    retry_policy: {
      retries: args.retries,
      retry_backoff_ms: args.retryBackoffMs,
      sleep_ms_between_dates: args.sleepMs,
    },
    row_count: totalRows,
    output_file: results.length === 1 ? first.output_file : null,
    date: results.length === 1 ? first.date : null,
    source_url: results.length === 1 ? first.source_url : null,
    manifest_file: manifestFile,
    skipped_dates: skippedDates,
    outputs: results.map(({ payload, outputAbs, rawTextAbs, ...result }) => result),
    };
  } finally {
    writeAttemptShard({
      laneId: "finra_short_volume",
      attemptShardPath,
      observedAt,
      attemptId,
      result: reduceFinraEndpointResults(endpointResults),
    });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run()
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((err) => {
      console.error(err.stack || err.message);
      process.exit(1);
    });
}

export {
  applyFinraLkgStore,
  buildFreshnessMarker,
  buildPayload,
  buildManifest,
  cachePathForDate,
  classifyFinraEndpointResponse,
  computeFinraLkgOutcome,
  datasetConfig,
  endpointForDate,
  expandDateRange,
  FINRA_AVAILABILITY_POLICY,
  FINRA_FRESHNESS_MARKER_SCHEMA,
  FINRA_HISTORY_SCHEMA,
  FINRA_LANE_ID,
  FINRA_LKG_KEY,
  FINRA_PERSISTENCE_POLICY,
  finraHistoryPathFor,
  freshnessMarkerPathFor,
  freshnessMarkerSourceAsOf,
  isUsTradingDate,
  normalizeDate,
  parseFinraDailyShortVolume,
  rawTextPathForDate,
  reduceFinraEndpointResults,
  retainLatestMarkerDates,
  rotateFinraMarkerHistory,
  run,
  validFinraHistory,
  validFreshnessMarker,
};
