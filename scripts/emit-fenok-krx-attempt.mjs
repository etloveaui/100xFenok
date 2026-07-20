#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  attemptResult,
  libraryTuple,
  writeAttemptShard,
} from "./lib/data-supply-attempt-shard.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const LANE_ID = "krx";
const DEFAULT_BRIDGE_INDEX_PATH = path.join(REPO_ROOT, "data/admin/fenok-edge-korea-krx-daily-index.json");
const DEFAULT_ATTEMPT_SHARD_PATH = path.join(REPO_ROOT, "data/admin/data-supply-state/detection-attempts/krx.json");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

function failBridge(message) {
  throw new Error(`KRX bridge contract: ${message}`);
}

function readSuccessBridge(bridgeIndexPath, observedAt) {
  let bridge;
  try {
    bridge = JSON.parse(fs.readFileSync(bridgeIndexPath, "utf8"));
  } catch (error) {
    failBridge(`unreadable JSON at ${bridgeIndexPath}: ${error.message}`);
  }
  if (bridge?.schema_version !== "fenok-edge-korea-krx-bridge/v1") failBridge("schema_version is invalid");
  if (bridge.source !== "KRX_OPEN_API") failBridge("source is invalid");
  if (!DATE_RE.test(bridge.as_of) || !Number.isFinite(Date.parse(`${bridge.as_of}T00:00:00Z`))) failBridge("as_of is invalid");
  const generatedAtMs = Date.parse(bridge.generated_at);
  const observedAtMs = Date.parse(observedAt);
  if (!Number.isFinite(generatedAtMs) || !bridge.generated_at.endsWith("Z")) failBridge("generated_at is invalid");
  if (!Number.isFinite(observedAtMs) || !observedAt.endsWith("Z")) failBridge("observedAt is invalid");

  const attempted = bridge.latest_run?.attempted_call_count;
  const summary = bridge.latest_run?.summary;
  if (!Number.isSafeInteger(attempted) || attempted < 1) failBridge("attempted_call_count is invalid");
  if (!summary || !Number.isSafeInteger(summary.total_files) || summary.total_files !== attempted) failBridge("summary.total_files does not match attempted_call_count");
  for (const key of ["success_files", "empty_files", "failed_files"]) {
    if (!Number.isSafeInteger(summary[key]) || summary[key] < 0) failBridge(`summary.${key} is invalid`);
  }
  if (summary.failed_files !== 0) failBridge("summary.failed_files must be zero for success");
  if (summary.success_files + summary.empty_files !== summary.total_files) failBridge("summary file counts do not balance");

  return {
    candidates: attempted,
    latencyMs: Math.max(0, observedAtMs - generatedAtMs),
  };
}

export function emitKrxAttempt({
  outcome,
  bridgeIndexPath = DEFAULT_BRIDGE_INDEX_PATH,
  attemptShardPath = DEFAULT_ATTEMPT_SHARD_PATH,
  attemptId,
  observedAt,
}) {
  if (!new Set(["success", "failure"]).has(outcome)) throw new Error("outcome must be success or failure");
  let tuple;
  let reason;
  if (outcome === "success") {
    const bridge = readSuccessBridge(bridgeIndexPath, observedAt);
    tuple = libraryTuple({
      candidates: bridge.candidates,
      retryCount: 0,
      latencyMs: bridge.latencyMs,
      outcome: "success",
      decode: "ok",
      payload: "non_empty",
      assertions: [{ id: "krx_bridge_contract", passed: true }],
    });
    reason = "ok";
  } else {
    tuple = libraryTuple({
      candidates: 1,
      retryCount: 0,
      latencyMs: 0,
      outcome: "error",
    });
    reason = "unexpected_error";
  }
  return writeAttemptShard({
    laneId: LANE_ID,
    attemptShardPath,
    observedAt,
    attemptId,
    result: attemptResult(reason, tuple),
  });
}

function argumentValue(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  if (index + 1 >= argv.length) throw new Error(`${name} requires a value`);
  return argv[index + 1];
}

function main(argv = process.argv.slice(2)) {
  const outcome = argumentValue(argv, "--outcome");
  const attemptId = argumentValue(argv, "--attempt-id");
  const observedAt = argumentValue(argv, "--observed-at");
  if (!outcome || !attemptId || !observedAt) throw new Error("--outcome, --attempt-id, and --observed-at are required");
  const row = emitKrxAttempt({
    outcome,
    attemptId,
    observedAt,
    bridgeIndexPath: argumentValue(argv, "--bridge-index", DEFAULT_BRIDGE_INDEX_PATH),
    attemptShardPath: argumentValue(argv, "--attempt-shard", DEFAULT_ATTEMPT_SHARD_PATH),
  });
  process.stdout.write(`${JSON.stringify({ lane_id: LANE_ID, status: row.outcome, attempt_id: row.attempt_id })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
