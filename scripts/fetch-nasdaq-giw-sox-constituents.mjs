#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  attemptResult,
  atomicWrite,
  classifyEndpointResponse,
  defaultAttemptId,
  threwTuple,
  transportError,
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const DATA_ROOT = path.join(REPO_ROOT, "data");
const PUBLIC_DATA_ROOT = path.join(REPO_ROOT, "100xfenok-next", "public", "data");

const SCHEMA_VERSION = "nasdaq_giw_sox_constituents.v1";
const DEFAULT_OUTPUT = "indices/nasdaq-giw-sox-constituents.json";
const GIW_WEIGHTING_URL = "https://indexes.nasdaqomx.com/Index/Weighting/SOX";
const GIW_ENDPOINT = "https://indexes.nasdaqomx.com/Index/WeightingData";
const MIN_ROWS = 25;
const LANE_ID = "nasdaq_giw_sox";
const LKG_KEY = "constituents";

// Bounded persistence (P): alongside the single canonical snapshot, keep a
// bounded dated-snapshot sidecar — the latest 100 distinct trade dates,
// OCC-consistent. Sparse history is never evicted; malformed dates fail
// closed; re-rotating the same date replaces its entry (idempotent).
const SOX_PERSISTENCE_POLICY = Object.freeze({
  schema_version: "sox-bounded-persistence/v1",
  basis: "source_date",
  scope: "per_artifact",
  max_distinct_source_dates: 100,
  eviction: "oldest_source_date_first",
});
const SOX_HISTORY_SCHEMA = "fenok-sox-snapshot-history/v1";

function parseArgs(argv) {
  const args = {
    date: null,
    lookbackDays: 10,
    output: DEFAULT_OUTPUT,
    write: true,
    publicMirror: true,
    check: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--date") args.date = argv[++i];
    else if (arg.startsWith("--date=")) args.date = arg.slice("--date=".length);
    else if (arg === "--lookback-days") args.lookbackDays = Number(argv[++i]);
    else if (arg.startsWith("--lookback-days=")) args.lookbackDays = Number(arg.slice("--lookback-days=".length));
    else if (arg === "--output") args.output = argv[++i];
    else if (arg.startsWith("--output=")) args.output = arg.slice("--output=".length);
    else if (arg === "--check") {
      args.check = true;
      args.write = false;
    } else if (arg === "--no-write") args.write = false;
    else if (arg === "--no-public-mirror") args.publicMirror = false;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(args.lookbackDays) || args.lookbackDays < 0 || args.lookbackDays > 30) {
    throw new Error("--lookback-days must be between 0 and 30");
  }
  return args;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function candidateDates(startDate, lookbackDays) {
  const start = startDate ? new Date(`${startDate}T00:00:00Z`) : new Date();
  if (!Number.isFinite(start.getTime())) throw new Error(`Invalid --date: ${startDate}`);
  return Array.from({ length: lookbackDays + 1 }, (_, index) => {
    const next = new Date(start);
    next.setUTCDate(start.getUTCDate() - index);
    return isoDate(next);
  });
}

function normalizeRows(rawRows) {
  return rawRows.map((row, index) => ({
    rank: index + 1,
    name: row.Name.trim(),
    symbol: row.Symbol.trim().toUpperCase(),
  }));
}

export async function requestWeightingData(_url, tradeDate, { timeoutMs = 30_000 } = {}) {
  const body = new URLSearchParams({ id: "SOX", tradeDate, timeOfDay: "SOD" });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(GIW_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Origin": "https://indexes.nasdaqomx.com",
        "Referer": GIW_WEIGHTING_URL,
        "User-Agent": "100xFenok-data-pipeline/1.0",
        "X-Requested-With": "XMLHttpRequest",
      },
      body,
      signal: controller.signal,
    });
    return { statusCode: response.status, body: await response.text() };
  } finally {
    clearTimeout(timeout);
  }
}

async function evaluateTradeDate({ request, tradeDate, controlled }) {
  if (controlled) return { ...attemptResult("transport_error", threwTuple("transport")), tradeDate };
  try {
    const classified = classifyEndpointResponse(await request(GIW_ENDPOINT, tradeDate), { laneId: LANE_ID });
    if (classified.status !== "ready") return { ...classified, tradeDate };
    return { ...classified, tradeDate, rows: normalizeRows(classified.document.aaData) };
  } catch (error) {
    const exceptionKind = transportError(error) ? "transport" : "unexpected";
    return {
      ...attemptResult(
        exceptionKind === "transport" ? "transport_error" : "unexpected_error",
        threwTuple(exceptionKind),
      ),
      tradeDate,
    };
  }
}

function buildPayload({ tradeDate, rows, generatedAt }) {
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt,
    source: "Nasdaq Global Index Watch",
    source_url: GIW_WEIGHTING_URL,
    endpoint: GIW_ENDPOINT,
    access_scope: "public_free_constituent_view_no_official_weight_columns",
    index_id: "SOX",
    index_name: "PHLX Semiconductor",
    time_of_day: "SOD",
    as_of: tradeDate,
    row_count: rows.length,
    symbols: rows.map((row) => row.symbol),
    rows,
    notes: [
      "Nasdaq GIW public free weighting view exposes official SOX constituents but not official weight columns.",
      "RIM builder derives SOX input weights from these official constituents plus stock_action market caps using the published SOX methodology cap schedule.",
      "This file must not be treated as a licensed official weight file.",
    ],
  };
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function soxSourceAsOf(document) {
  return validDate(document?.as_of) ? document.as_of : null;
}

export function validSoxDocument(document) {
  if (document?.schema_version !== SCHEMA_VERSION
    || document?.source !== "Nasdaq Global Index Watch"
    || document?.index_id !== "SOX"
    || document?.access_scope !== "public_free_constituent_view_no_official_weight_columns"
    || !Number.isFinite(Date.parse(document?.generated_at))
    || soxSourceAsOf(document) === null
    || !Number.isInteger(document?.row_count)
    || document.row_count < MIN_ROWS
    || !Array.isArray(document?.symbols)
    || !Array.isArray(document?.rows)
    || document.symbols.length !== document.row_count
    || document.rows.length !== document.row_count) return false;
  const unique = new Set();
  for (const [index, row] of document.rows.entries()) {
    if (row?.rank !== index + 1 || typeof row?.name !== "string" || row.name.trim() === ""
      || typeof row?.symbol !== "string" || row.symbol.trim() === "" || document.symbols[index] !== row.symbol
      || unique.has(row.symbol)) return false;
    unique.add(row.symbol);
  }
  return true;
}

function stableComparable(payload) {
  const clone = structuredClone(payload);
  delete clone.generated_at;
  return clone;
}

function readValidCanonical(canonicalPath) {
  if (!fs.existsSync(canonicalPath)) return null;
  try {
    const bytes = fs.readFileSync(canonicalPath);
    const document = JSON.parse(bytes.toString("utf8"));
    return validSoxDocument(document) ? { bytes, document } : null;
  } catch {
    return null;
  }
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function soxHistoryPathFor(repoRoot) {
  return path.join(repoRoot, "data", "admin", LANE_ID, "history", `${LKG_KEY}.json`);
}

function validSoxHistoryEntry(entry) {
  return Boolean(entry)
    && typeof entry === "object"
    && !Array.isArray(entry)
    && validDate(entry?.as_of)
    && typeof entry?.payload_sha256 === "string" && /^[0-9a-f]{64}$/.test(entry.payload_sha256)
    && validSoxDocument(entry?.snapshot);
}

// Retain only entries whose as_of is within the newest N distinct dates.
// Fail-closed: every entry must be a valid dated snapshot; duplicate dates
// collapse to the newest generated_at (idempotent re-rotation).
function retainLatestSnapshotDates(entries, policy = SOX_PERSISTENCE_POLICY) {
  const maxDates = Number(policy?.max_distinct_source_dates);
  if (!Number.isInteger(maxDates) || maxDates <= 0) {
    throw new Error("invalid SOX persistence max_distinct_source_dates");
  }
  const rows = Array.isArray(entries) ? entries : [];
  const byDate = new Map();
  for (const entry of rows) {
    if (!validSoxHistoryEntry(entry)) {
      throw new Error(`invalid SOX history entry: ${entry?.as_of ?? "unknown"}`);
    }
    const date = entry.as_of;
    const prior = byDate.get(date);
    if (!prior || String(entry.snapshot.generated_at) >= String(prior.snapshot.generated_at)) byDate.set(date, entry);
  }
  const retainedDates = new Set([...byDate.keys()].sort().reverse().slice(0, maxDates));
  const retained = [...byDate.values()]
    .filter((entry) => retainedDates.has(entry.as_of))
    .sort((a, b) => b.as_of.localeCompare(a.as_of));
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

function validSoxHistory(doc) {
  return Boolean(doc)
    && typeof doc === "object"
    && !Array.isArray(doc)
    && doc.schema_version === SOX_HISTORY_SCHEMA
    && doc.lane_id === LANE_ID
    && doc.persistence_policy?.schema_version === SOX_PERSISTENCE_POLICY.schema_version
    && Array.isArray(doc.entries)
    && doc.entries.every((entry) => validSoxHistoryEntry(entry));
}

// Rotate the bounded dated-snapshot sidecar after a fresh-primary promotion.
// Fail-closed: a corrupt existing history throws instead of silently dropping
// dates; the entry's digest binds the snapshot bytes it carries.
function rotateSoxSnapshotHistory({ repoRoot, historyPath = soxHistoryPathFor(repoRoot), payload, generatedAt }) {
  if (!validSoxDocument(payload)) {
    throw new Error("SOX history rotation requires a valid snapshot payload");
  }
  const entry = {
    as_of: payload.as_of,
    payload_sha256: sha256Hex(Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8")),
    snapshot: payload,
  };
  let existing = [];
  if (fs.existsSync(historyPath)) {
    let doc = null;
    try {
      doc = JSON.parse(fs.readFileSync(historyPath, "utf8"));
    } catch {
      doc = null;
    }
    if (!validSoxHistory(doc)) {
      throw new Error(`SOX snapshot history is corrupt: ${path.relative(repoRoot, historyPath)}`);
    }
    existing = doc.entries;
  }
  const retained = retainLatestSnapshotDates([entry, ...existing]);
  const doc = {
    schema_version: SOX_HISTORY_SCHEMA,
    lane_id: LANE_ID,
    persistence_policy: SOX_PERSISTENCE_POLICY,
    generated_at: generatedAt,
    entries: retained.entries,
  };
  atomicWrite(historyPath, `${JSON.stringify(doc, null, 2)}\n`);
  return { history: doc, stats: retained.stats };
}

function controlledFailure(controlledFailureKey, eventName) {
  const key = controlledFailureKey.trim();
  if (!key) return false;
  if (eventName !== "workflow_dispatch") throw new Error("controlled failure requires workflow_dispatch");
  if (key !== LKG_KEY) throw new Error(`unknown controlled SOX key: ${key}`);
  return true;
}

export async function runNasdaqGiwSox({
  repoRoot = REPO_ROOT,
  canonicalPath = path.join(REPO_ROOT, "data", DEFAULT_OUTPUT),
  publicPath = path.join(REPO_ROOT, "100xfenok-next", "public", "data", DEFAULT_OUTPUT),
  attemptShardPath = path.join(REPO_ROOT, "data", "admin", "data-supply-state", "detection-attempts", `${LANE_ID}.json`),
  dates = candidateDates(null, 10),
  request = requestWeightingData,
  observedAt = new Date().toISOString(),
  attemptId = defaultAttemptId("nasdaq-giw-sox", observedAt),
  runId = process.env.GITHUB_RUN_ID || "local",
  runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1),
  eventName = process.env.GITHUB_EVENT_NAME || "local",
  controlledFailureKey = process.env.INPUT_CONTROLLED_FAILURE_KEY || "",
  write = true,
  publicMirror = false,
} = {}) {
  if (!Array.isArray(dates) || dates.length === 0 || dates.some((date) => !validDate(date))) {
    throw new Error("SOX candidate dates must be a non-empty YYYY-MM-DD array");
  }
  const controlled = controlledFailure(controlledFailureKey, eventName);
  const run = { runId: String(runId), runAttempt: Number(runAttempt), eventName, observedAt };
  const lkgStore = new LaneLkgStore({ repoRoot, laneId: LANE_ID });
  const lkgArtifacts = [{
    key: LKG_KEY,
    canonicalPath,
    validateDocument: validSoxDocument,
    sourceAsOf: soxSourceAsOf,
  }];
  const requestResults = [];
  let selected = null;
  for (const tradeDate of dates) {
    const result = await evaluateTradeDate({ request, tradeDate, controlled });
    requestResults.push(result);
    if (result.status === "ready") {
      selected = result;
      break;
    }
  }
  const folded = selected ?? worstRequestResult(requestResults);
  const attempt = write ? writeAttemptShard({ laneId: LANE_ID, attemptShardPath, observedAt, attemptId, result: folded }) : null;

  if (selected === null) {
    const failureReason = systemicLkgFailureReason(requestResults.map((row) => row.reason))
      ?? (controlled ? "controlled_failure" : folded.reason);
    const failure = write
      ? lkgStore.recordFailure({ artifacts: lkgArtifacts, run, reason: failureReason })
      : { hasCompleteLkg: false, retrySet: [] };
    const nonTransientHttp = requestResults.some((row) => row.reason === "http_error"
      && !(row.attempt?.http_status >= 500 && row.attempt.http_status <= 599));
    // Single-logical-artifact divergence from FRED/FDIC: an all-lookback
    // transport/5xx ratio adds no independent corruption signal. Classification
    // is by failure kind; the shared helper still makes auth/rate/decode/schema,
    // malformed/empty payload, unexpected failure, non-transient HTTP, or
    // missing LKG fatal.
    const outcome = classifyLkgFailure({
      reason: failureReason,
      hasCompleteLkg: failure.hasCompleteLkg,
      systemic: nonTransientHttp,
    });
    return { ok: false, reason: failureReason, updated: false, attempt, retrySet: failure.retrySet, ...outcome };
  }

  const payload = buildPayload({ tradeDate: selected.tradeDate, rows: selected.rows, generatedAt: observedAt });
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  const currentRelativePath = path.relative(repoRoot, canonicalPath).split(path.sep).join("/");
  const candidate = {
    key: LKG_KEY,
    currentRelativePath,
    payloadBytes: Buffer.from(serialized),
    sourceAsOf: soxSourceAsOf(payload),
    validateDocument: validSoxDocument,
    deriveSourceAsOf: soxSourceAsOf,
    promotion_contract: PROMOTION_CONTRACT_PROVIDER_OBSERVATION_V2,
    provider_observation: buildProviderObservationV2({
      payloadBytes: Buffer.from(serialized),
      sourceAsOf: soxSourceAsOf(payload),
      validateDocument: validSoxDocument,
      deriveSourceAsOf: soxSourceAsOf,
      candidateContainsObservation: (candidateDocument, providerDocument) => JSON.stringify(candidateDocument) === JSON.stringify(providerDocument),
      run,
    }),
  };
  if (!write) return { ok: true, reason: "ok", updated: false, attempt, payload, asOf: payload.as_of, rowCount: payload.row_count };

  const recoveryState = lkgStore.stateSnapshot();
  if (recoveryState.items[LKG_KEY]?.retry === true && !isNaturalScheduleRun(run)) {
    return {
      ok: false,
      reason: "recovery_requires_schedule",
      updated: false,
      attempt,
      retrySet: recoveryState.retry_set,
      degraded: true,
      corrupt: false,
      exitCode: 0,
    };
  }
  const currentCanonical = readValidCanonical(canonicalPath);
  if (currentCanonical !== null && recoveryState.items[LKG_KEY]?.retry !== true) {
    const currentSourceAsOf = soxSourceAsOf(currentCanonical.document);
    const currentEpoch = Date.parse(currentSourceAsOf);
    const candidateEpoch = Date.parse(candidate.sourceAsOf);
    if (candidateEpoch < currentEpoch) {
      const failure = lkgStore.recordFailure({ artifacts: lkgArtifacts, run, reason: "source_regression" });
      const outcome = classifyLkgFailure({ reason: "source_regression", hasCompleteLkg: failure.hasCompleteLkg });
      return {
        ok: false,
        reason: "source_regression",
        updated: false,
        attempt,
        retrySet: failure.retrySet,
        ...outcome,
      };
    }
    if (candidateEpoch === currentEpoch) {
      if (!recoveryState.items[LKG_KEY]) {
        lkgStore.recordSuccess({
          artifacts: [{
            ...candidate,
            payloadBytes: currentCanonical.bytes,
            sourceAsOf: currentSourceAsOf,
          }],
          run,
        });
      }
      return {
        ok: true,
        reason: "unchanged_source",
        updated: false,
        attempt,
        asOf: currentSourceAsOf,
        rowCount: currentCanonical.document.row_count,
        symbols: currentCanonical.document.symbols,
        accessScope: currentCanonical.document.access_scope,
        recovered: false,
      };
    }
  }
  const decisions = lkgStore.evaluatePromotionCandidates([candidate], run);
  const promotable = decisions.filter((decision) => decision.eligible).map((decision) => decision.artifact);
  if (promotable.length === 0) {
    const reason = decisions[0].reason;
    if (["foreign_writer_conflict", "recovery_not_advanced_by_provider"].includes(reason)) {
      lkgStore.recordPromotionDeferral({ artifacts: [candidate], run, reason });
    }
    return {
      ok: false,
      reason,
      updated: false,
      attempt,
      retrySet: lkgStore.stateSnapshot().retry_set,
      degraded: true,
      corrupt: false,
      exitCode: 0,
    };
  }
  atomicWrite(canonicalPath, serialized);
  if (publicMirror) atomicWrite(publicPath, serialized);
  const success = lkgStore.recordSuccess({ artifacts: promotable, run });
  const recovered = success.state.items[LKG_KEY]?.recovered_at === observedAt;
  const history = rotateSoxSnapshotHistory({ repoRoot, payload, generatedAt: observedAt });
  return {
    ok: true,
    reason: "ok",
    updated: true,
    attempt,
    asOf: payload.as_of,
    rowCount: payload.row_count,
    symbols: payload.symbols,
    accessScope: payload.access_scope,
    recovered,
    history: history.stats,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const canonicalPath = path.join(DATA_ROOT, args.output);
  const publicPath = path.join(PUBLIC_DATA_ROOT, args.output);
  const result = await runNasdaqGiwSox({
    canonicalPath,
    publicPath,
    dates: candidateDates(args.date, args.lookbackDays),
    write: args.write,
    publicMirror: args.publicMirror,
  });
  if (!result.ok) {
    const prefix = result.degraded ? "[degraded]" : "[corrupt]";
    const message = `${prefix} Nasdaq GIW SOX ${result.reason}; retry set: ${(result.retrySet || []).join(", ") || "none"}`;
    if (result.degraded) console.log(message);
    else console.error(message);
    process.exitCode = result.exitCode ?? 2;
    return;
  }
  if (args.check) {
    const current = fs.existsSync(canonicalPath) ? JSON.parse(fs.readFileSync(canonicalPath, "utf8")) : null;
    if (!current || JSON.stringify(stableComparable(current)) !== JSON.stringify(stableComparable(result.payload))) {
      throw new Error(`${path.join("data", args.output)} is not up to date with Nasdaq GIW SOX constituents`);
    }
    if (args.publicMirror) {
      const mirror = fs.existsSync(publicPath) ? JSON.parse(fs.readFileSync(publicPath, "utf8")) : null;
      if (!mirror || JSON.stringify(stableComparable(mirror)) !== JSON.stringify(stableComparable(result.payload))) {
        throw new Error(`${path.join("100xfenok-next/public/data", args.output)} is not up to date with Nasdaq GIW SOX constituents`);
      }
    }
  }
  console.log(JSON.stringify({
    ok: true,
    wrote: args.write ? [path.join("data", args.output), ...(args.publicMirror ? [path.join("100xfenok-next/public/data", args.output)] : [])] : [],
    as_of: result.asOf,
    row_count: result.rowCount,
    symbols: result.symbols ?? result.payload?.symbols,
    access_scope: result.accessScope ?? result.payload?.access_scope,
    recovered: result.recovered === true,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export {
  retainLatestSnapshotDates,
  rotateSoxSnapshotHistory,
  soxHistoryPathFor,
  validSoxHistory,
  SOX_HISTORY_SCHEMA,
  SOX_PERSISTENCE_POLICY,
};
