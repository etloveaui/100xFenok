#!/usr/bin/env node

/** Emit one standard detection-attempt shard from Yahoo's durable batch index. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAttemptRow,
  buildSingleLaneShard,
  libraryTuple,
  writeJsonAtomic,
} from "./lib/data-supply-attempt-shard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const LANE_ID = "yahoo_batch_quote_history";
const INDEX_SCHEMA = "yahoo-batch-quote-history-index/v1";
const DEFAULT_INDEX_PATH = path.join(REPO_ROOT, "data/admin/yahoo-batch-quote-history/index.json");
const DEFAULT_ATTEMPT_SHARD_PATH = path.join(
  REPO_ROOT,
  "data/admin/data-supply-state/detection-attempts/yahoo_batch_quote_history.json",
);
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const ID_PART = /^[A-Za-z0-9_-]+$/;

function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function requireTimestamp(value, label) {
  if (typeof value !== "string" || !ISO_UTC.test(value) || !Number.isFinite(new Date(value).getTime())) {
    throw new Error(`${label} must be a strict UTC timestamp`);
  }
  return value;
}

export function toYahooBatchAttemptRow(index) {
  if (!index || index.schema_version !== INDEX_SCHEMA || !index.current_attempt || typeof index.current_attempt !== "object") {
    throw new Error("Yahoo batch index/current_attempt contract is invalid");
  }
  const current = index.current_attempt;
  const observedAt = requireTimestamp(index.generated_at, "index.generated_at");
  const runId = String(current.run_id ?? "");
  const runAttempt = requireNonNegativeInteger(current.run_attempt, "current_attempt.run_attempt");
  const attempted = requireNonNegativeInteger(current.attempted, "current_attempt.attempted");
  const failed = requireNonNegativeInteger(current.failed, "current_attempt.failed");
  const successes = requireNonNegativeInteger(current.successes, "current_attempt.successes");
  const skipped = requireNonNegativeInteger(current.skipped, "current_attempt.skipped");
  requireNonNegativeInteger(current.fetch_attempts, "current_attempt.fetch_attempts");
  if (!ID_PART.test(runId) || runAttempt < 1) throw new Error("current_attempt run identity is invalid");
  if (failed > attempted || successes > attempted || skipped > attempted || successes + failed + skipped !== attempted) {
    throw new Error("current_attempt totals do not close");
  }
  const attemptId = `gh-${runId}-${runAttempt}-yahoo-batch`;
  let tuple;
  if (attempted === 0) {
    tuple = libraryTuple({
      candidates: 0,
      retryCount: 0,
      latencyMs: 0,
      outcome: "no_fallback_candidates",
      payload: "empty",
    });
  } else if (failed > 0 && successes === 0) {
    // Nothing came back. This is a real producer failure.
    tuple = libraryTuple({
      candidates: attempted,
      retryCount: 0,
      latencyMs: 0,
      outcome: "error",
    });
  } else if (failed > 0) {
    // Partial success. This used to take the branch above, so ten bad tickers
    // out of 1194 recorded the whole lane as a producer that returned nothing -
    // measured on run 32429826829, where successes were 3, skipped 1181 and the
    // ten failures are individually known provider-coverage gaps. On a batch
    // this size `failed > 0` is close to always true, so that rule could
    // essentially never report health.
    //
    // No schema change was needed: tupleStatus already maps outcome "success"
    // with a failed assertion to "drift", which is neither ready nor
    // unavailable. The failure count rides on the assertion so it stays visible.
    tuple = libraryTuple({
      candidates: attempted,
      retryCount: 0,
      latencyMs: 0,
      outcome: "success",
      decode: "ok",
      payload: "non_empty",
      // The lane's declared assertion, failed. The detection floor requires the
      // assertion id set to match the lane's endpoint_contract exactly, so the
      // signal is this id with passed false rather than a new one; and it
      // reserves failure_entity/failure_detail for thrown executions, so the
      // counts are not carried here. They live in
      // data/admin/yahoo-batch-quote-history/index.json, which the same run
      // commits, and drift is the pointer to go read them.
      assertions: [{ id: "current_attempt_completed", passed: false }],
    });
  } else {
    tuple = libraryTuple({
      candidates: attempted,
      retryCount: 0,
      latencyMs: 0,
      outcome: "success",
      decode: "ok",
      payload: "non_empty",
      assertions: [{ id: "current_attempt_completed", passed: true }],
    });
  }
  return buildAttemptRow({
    laneId: LANE_ID,
    memberId: null,
    tuple,
    attemptId,
    observedAt,
  });
}

export function emitYahooBatchQuoteHistoryAttempt({
  indexPath = DEFAULT_INDEX_PATH,
  attemptShardPath = DEFAULT_ATTEMPT_SHARD_PATH,
} = {}) {
  let index;
  try {
    index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch (error) {
    throw new Error(`Yahoo batch index is unreadable: ${error.message}`);
  }
  const row = toYahooBatchAttemptRow(index);
  writeJsonAtomic(attemptShardPath, buildSingleLaneShard({ laneId: LANE_ID, row }));
  return row;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!new Set(["--index", "--attempt-shard"]).has(flag) || typeof value !== "string") {
      throw new Error("usage: emit-yahoo-batch-quote-history-attempt.mjs [--index <path>] [--attempt-shard <path>]");
    }
    if (flag === "--index") options.indexPath = path.resolve(value);
    if (flag === "--attempt-shard") options.attemptShardPath = path.resolve(value);
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const row = emitYahooBatchQuoteHistoryAttempt(parseArgs(process.argv.slice(2)));
  process.stdout.write(`Yahoo batch attempt shard: ${row.attempt_id}\n`);
}
