#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  attemptResult,
  atomicWrite,
  defaultAttemptId,
  libraryTuple,
  writeAttemptShard,
} from "./lib/data-supply-attempt-shard.mjs";
import {
  LaneLkgStore,
  PROMOTION_CONTRACT_PROVIDER_OBSERVATION_V2,
  buildProviderObservationV2,
  classifyLkgFailure,
  isNaturalScheduleRun,
} from "./lib/data-supply-lkg-store.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");

export const LANE_ID = "yahoo_private_options";
export const SCHEDULED_TICKERS = Object.freeze(["DASH", "UNH", "PYPL", "RDDT", "COIN", "MU", "PLTR", "NVDA"]);
export const AVAILABILITY_SCHEMA = "fenok-yahoo-private-options-availability/v1";
const SUMMARY_SCHEMA = "fenok-private-options-collection-summary/v1";
const FORBIDDEN_RAW_KEYS = new Set([
  "ask", "bid", "calls", "contractSymbol", "contracts", "expiration", "impliedVolatility",
  "inTheMoney", "lastPrice", "openInterest", "options", "puts", "strike", "volume",
]);

function validUtc(value) {
  return typeof value === "string" && value.endsWith("Z") && Number.isFinite(Date.parse(value));
}

function exactKeys(value, expected) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function containsForbiddenRawKey(value) {
  if (Array.isArray(value)) return value.some(containsForbiddenRawKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, nested]) => FORBIDDEN_RAW_KEYS.has(key) || containsForbiddenRawKey(nested));
}

export function validCollectionSummary(summary) {
  if (!exactKeys(summary, [
    "schema_version", "generated_at", "scheduled", "tickers", "requested_count",
    "ready_count", "failed_count", "results",
  ]) || summary.schema_version !== SUMMARY_SCHEMA || summary.scheduled !== true
    || !validUtc(summary.generated_at) || JSON.stringify(summary.tickers) !== JSON.stringify(SCHEDULED_TICKERS)
    || summary.requested_count !== SCHEDULED_TICKERS.length
    || !Number.isInteger(summary.ready_count) || !Number.isInteger(summary.failed_count)
    || summary.ready_count + summary.failed_count !== SCHEDULED_TICKERS.length
    || !Array.isArray(summary.results) || summary.results.length !== SCHEDULED_TICKERS.length) return false;
  let ready = 0;
  let failed = 0;
  for (const [index, row] of summary.results.entries()) {
    if (row?.ticker !== SCHEDULED_TICKERS[index] || !["ready", "failed"].includes(row?.status)) return false;
    if (row.status === "ready") {
      ready += 1;
      if (!exactKeys(row, ["ticker", "status", "fetched_at", "expiry_count", "call_rows", "put_rows"])
        || !validUtc(row.fetched_at) || !Number.isInteger(row.expiry_count) || row.expiry_count < 1
        || !Number.isInteger(row.call_rows) || row.call_rows < 1
        || !Number.isInteger(row.put_rows) || row.put_rows < 1) return false;
    } else {
      failed += 1;
      if (!exactKeys(row, ["ticker", "status", "reason"])
        || !["empty_chain", "empty_expiries", "provider_error"].includes(row.reason)) return false;
    }
  }
  return ready === summary.ready_count && failed === summary.failed_count && !containsForbiddenRawKey(summary);
}

function summarySourceAsOf(summary) {
  const timestamps = summary?.results?.filter((row) => row?.status === "ready").map((row) => row.fetched_at) ?? [];
  return timestamps.length > 0 && timestamps.every(validUtc)
    ? timestamps.sort((left, right) => Date.parse(left) - Date.parse(right)).at(-1)
    : null;
}

export function buildAvailabilityMarker(summary) {
  if (!validCollectionSummary(summary) || summary.failed_count !== 0) {
    throw new Error("private options collection summary is not a complete safe observation");
  }
  const rows = summary.results.map((row) => ({
    ticker: row.ticker,
    status: row.status,
    fetched_at: row.fetched_at,
    expiry_count: row.expiry_count,
    call_rows: row.call_rows,
    put_rows: row.put_rows,
  }));
  return {
    schema_version: AVAILABILITY_SCHEMA,
    lane_id: LANE_ID,
    source: "yahoo_finance",
    source_family: "targeted_yfinance_option_chain_snapshot",
    generated_at: summary.generated_at,
    source_as_of: summarySourceAsOf(summary),
    scheduled_allowlist: true,
    public_safe: true,
    raw_payload_included: false,
    tickers: [...SCHEDULED_TICKERS],
    counts: { requested: SCHEDULED_TICKERS.length, ready: rows.length, failed: 0 },
    rows,
  };
}

export function validAvailabilityMarker(marker) {
  return exactKeys(marker, [
    "schema_version", "lane_id", "source", "source_family", "generated_at", "source_as_of",
    "scheduled_allowlist", "public_safe", "raw_payload_included", "tickers", "counts", "rows",
  ]) && marker.schema_version === AVAILABILITY_SCHEMA && marker.lane_id === LANE_ID
    && marker.source === "yahoo_finance"
    && marker.source_family === "targeted_yfinance_option_chain_snapshot"
    && validUtc(marker.generated_at) && validUtc(marker.source_as_of)
    && marker.scheduled_allowlist === true && marker.public_safe === true && marker.raw_payload_included === false
    && JSON.stringify(marker.tickers) === JSON.stringify(SCHEDULED_TICKERS)
    && exactKeys(marker.counts, ["requested", "ready", "failed"])
    && marker.counts.requested === SCHEDULED_TICKERS.length
    && marker.counts.ready === SCHEDULED_TICKERS.length && marker.counts.failed === 0
    && Array.isArray(marker.rows) && marker.rows.length === SCHEDULED_TICKERS.length
    && marker.rows.every((row, index) => exactKeys(row, ["ticker", "status", "fetched_at", "expiry_count", "call_rows", "put_rows"])
      && row.ticker === SCHEDULED_TICKERS[index] && row.status === "ready" && validUtc(row.fetched_at)
      && Number.isInteger(row.expiry_count) && row.expiry_count >= 1
      && Number.isInteger(row.call_rows) && row.call_rows >= 1
      && Number.isInteger(row.put_rows) && row.put_rows >= 1)
    && !containsForbiddenRawKey(marker);
}

function markerSourceAsOf(marker) {
  return validAvailabilityMarker(marker) ? marker.source_as_of : null;
}

function markerContainsSummary(marker, summary) {
  if (!validAvailabilityMarker(marker) || !validCollectionSummary(summary) || summary.failed_count !== 0) return false;
  return marker.source_as_of === summarySourceAsOf(summary)
    && JSON.stringify(marker.rows) === JSON.stringify(summary.results);
}

function defaultCollect({ outputDir, summaryPath, observedAt }) {
  const result = spawnSync("python3", [
    "scripts/fetch-fenok-private-options.py",
    "--reference-only",
    "--scheduled",
    "--output-dir", outputDir,
    "--summary-path", summaryPath,
    "--observed-at", observedAt,
    "--sleep", process.env.YAHOO_PRIVATE_OPTIONS_SLEEP ?? "0.5",
  ], { cwd: REPO_ROOT, encoding: "utf8" });
  if (!fs.existsSync(summaryPath)) {
    throw new Error(`private options collector did not write a summary (exit=${result.status ?? "signal"})`);
  }
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  return summary;
}

export function runYahooPrivateOptions({
  repoRoot = REPO_ROOT,
  canonicalPath = path.join(repoRoot, "data", "computed", "fenok_yahoo_private_options_availability.json"),
  publicMirrorPath = path.join(repoRoot, "100xfenok-next", "public", "data", "computed", "fenok_yahoo_private_options_availability.json"),
  attemptShardPath = path.join(repoRoot, "data", "admin", "data-supply-state", "detection-attempts", `${LANE_ID}.json`),
  outputDir = path.join(os.tmpdir(), "yf-options"),
  summaryPath = path.join(os.tmpdir(), "yf-options-summary.json"),
  observedAt = new Date().toISOString(),
  attemptId = defaultAttemptId("yahoo-private-options", observedAt),
  runId = process.env.GITHUB_RUN_ID || "local",
  runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1),
  eventName = process.env.GITHUB_EVENT_NAME || "local",
  collect = defaultCollect,
} = {}) {
  const started = Date.now();
  const run = { runId: String(runId), runAttempt: Number(runAttempt), eventName, observedAt };
  const store = new LaneLkgStore({ repoRoot, laneId: LANE_ID });
  const descriptor = {
    key: "availability",
    canonicalPath,
    validateDocument: validAvailabilityMarker,
    sourceAsOf: markerSourceAsOf,
  };
  let summary;
  try {
    summary = collect({ outputDir, summaryPath, observedAt });
  } catch {
    summary = null;
  }
  const summaryValid = validCollectionSummary(summary);
  const complete = summaryValid && summary.failed_count === 0;
  const result = attemptResult(complete ? "ok" : summaryValid ? "empty_payload" : "schema_drift", libraryTuple({
    candidates: SCHEDULED_TICKERS.length,
    retryCount: 0,
    latencyMs: Math.max(0, Date.now() - started),
    outcome: complete ? "success" : "error",
    decode: complete ? "ok" : "not_attempted",
    payload: complete ? "non_empty" : "not_available",
    assertions: complete ? [{ id: "scheduled_allowlist_complete", passed: true }] : [],
  }), summary);
  const attempt = writeAttemptShard({ laneId: LANE_ID, attemptShardPath, observedAt, attemptId, result });
  if (!complete) {
    const reason = summaryValid ? "empty_payload" : "schema_drift";
    const stateReason = summaryValid ? "provider_failure" : reason;
    const systemic = summaryValid && summary.failed_count === SCHEDULED_TICKERS.length;
    const failure = store.recordFailure({ artifacts: [descriptor], run, reason: stateReason });
    return {
      ok: false,
      reason,
      attempt,
      retrySet: failure.retrySet,
      ...classifyLkgFailure({ reason: stateReason, hasCompleteLkg: failure.hasCompleteLkg, systemic }),
    };
  }

  const marker = buildAvailabilityMarker(summary);
  const markerBytes = Buffer.from(`${JSON.stringify(marker, null, 2)}\n`);
  const summaryBytes = Buffer.from(`${JSON.stringify(summary, null, 2)}\n`);
  const candidate = {
    key: "availability",
    currentRelativePath: "data/computed/fenok_yahoo_private_options_availability.json",
    payloadBytes: markerBytes,
    sourceAsOf: marker.source_as_of,
    validateDocument: validAvailabilityMarker,
    deriveSourceAsOf: markerSourceAsOf,
    promotion_contract: PROMOTION_CONTRACT_PROVIDER_OBSERVATION_V2,
    provider_observation: buildProviderObservationV2({
      payloadBytes: summaryBytes,
      sourceAsOf: summarySourceAsOf(summary),
      validateDocument: validCollectionSummary,
      deriveSourceAsOf: summarySourceAsOf,
      candidateContainsObservation: markerContainsSummary,
      run,
    }),
  };
  const state = store.stateSnapshot();
  if (state.items.availability?.retry === true && !isNaturalScheduleRun(run)) {
    return { ok: false, reason: "recovery_requires_schedule", attempt, retrySet: state.retry_set, degraded: true, corrupt: false, exitCode: 0 };
  }
  const decisions = store.evaluatePromotionCandidates([candidate], run);
  if (!decisions[0].eligible) {
    const reason = decisions[0].reason;
    if (["foreign_writer_conflict", "recovery_not_advanced_by_provider"].includes(reason)) {
      store.recordPromotionDeferral({ artifacts: [candidate], run, reason });
    }
    return { ok: false, reason, attempt, retrySet: store.stateSnapshot().retry_set, degraded: true, corrupt: false, exitCode: 0 };
  }
  atomicWrite(canonicalPath, markerBytes);
  atomicWrite(publicMirrorPath, markerBytes);
  const success = store.recordSuccess({ artifacts: [candidate], run });
  return { ok: true, reason: "ok", attempt, marker, retrySet: success.retrySet, degraded: false, corrupt: false, exitCode: 0 };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--output-dir") options.outputDir = path.resolve(next());
    else if (arg === "--summary-path") options.summaryPath = path.resolve(next());
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] === __filename) {
  try {
    const result = runYahooPrivateOptions(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 2;
  }
}
