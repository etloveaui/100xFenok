#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  attemptResult,
  classifyEndpointResponse,
  evaluateEndpointAssertions,
  foldWorstTuples,
  libraryTuple,
  threwTuple,
  transportError,
  worstRequestResult,
  writeMergedAttemptShard,
} from "./lib/data-supply-attempt-shard.mjs";
import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_SHARD_ROOT = path.join(REPO_ROOT, "data/admin/data-supply-state/detection-attempts");
const SUPPORTED_LANES = new Set([
  "yahoo_etf_fallback",
  "stockanalysis_etf_universe",
  "stockanalysis_stock_financial",
  "stockanalysis_surfaces",
]);

function laneConfig(laneId) {
  if (!SUPPORTED_LANES.has(laneId)) throw new Error(`unsupported StockAnalysis attempt lane: ${laneId}`);
  const lane = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((row) => row.id === laneId);
  if (!lane) throw new Error(`missing StockAnalysis attempt lane config: ${laneId}`);
  return lane;
}

function transportFor(lane) {
  return lane.endpoint_contract.transport === "library" ? "library" : "http";
}

function finiteNonNegative(value, field) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be finite and non-negative`);
  return value;
}

function integerNonNegative(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`);
  return value;
}

function classifyHttpObservation(laneId, observation) {
  if (observation?.execution === "threw") {
    const exceptionKind = observation.exception_kind === "transport" ? "transport" : "unexpected";
    return attemptResult(
      exceptionKind === "transport" ? "transport_error" : "unexpected_error",
      threwTuple(exceptionKind),
    );
  }
  if (!Number.isInteger(observation?.status_code)) throw new Error("HTTP observation status_code is required");
  return classifyEndpointResponse(
    { statusCode: observation.status_code, body: "" },
    { laneId, decodeBody: () => observation.document },
  );
}

function classifyLibraryEnvelope(laneId, envelope) {
  if (Object.hasOwn(envelope, "fabricated_http_status") || Object.hasOwn(envelope, "http_status")) {
    throw new Error("library transport forbids fabricated http_status");
  }
  const observations = Array.isArray(envelope.observations) ? envelope.observations : null;
  if (observations === null) throw new Error("library observations must be an array");
  const candidateCount = integerNonNegative(envelope.candidate_count, "candidate_count");
  if (envelope.producer_failure !== undefined) {
    if (candidateCount !== 0 || observations.length !== 0
      || envelope.producer_failure?.execution !== "threw"
      || !new Set(["transport", "unexpected"]).has(envelope.producer_failure?.exception_kind)) {
      throw new Error("producer_failure must be an honest zero-candidate thrown tuple");
    }
    return attemptResult(
      envelope.producer_failure.exception_kind === "transport" ? "transport_error" : "unexpected_error",
      libraryTuple({
        execution: "threw",
        exceptionKind: envelope.producer_failure.exception_kind,
        candidates: 0,
        retryCount: 0,
        latencyMs: 0,
        outcome: "error",
      }),
    );
  }
  if (candidateCount === 0) {
    if (observations.length !== 0) throw new Error("zero candidates cannot carry library observations");
    return attemptResult("ok", libraryTuple({
      candidates: 0,
      retryCount: 0,
      latencyMs: 0,
      outcome: "no_fallback_candidates",
      payload: "empty",
    }));
  }
  if (envelope.fallback_enabled === false && observations.length === 0) {
    return attemptResult("unexpected_error", libraryTuple({
      candidates: candidateCount,
      retryCount: 0,
      latencyMs: 0,
      outcome: "not_attempted",
    }));
  }
  if (candidateCount !== observations.length) throw new Error("candidate_count must equal library observations length");

  let retryCount = 0;
  let latencyMs = 0;
  const tuples = observations.map((observation, index) => {
    const observationRetryCount = integerNonNegative(observation?.retry_count, `observations[${index}].retry_count`);
    const observationLatencyMs = finiteNonNegative(observation?.latency_ms, `observations[${index}].latency_ms`);
    retryCount += observationRetryCount;
    latencyMs += observationLatencyMs;
    if (observation.execution === "threw") {
      const exceptionKind = observation.exception_kind === "transport" ? "transport" : "unexpected";
      return libraryTuple({
        execution: "threw",
        exceptionKind,
        candidates: 1,
        retryCount: observationRetryCount,
        latencyMs: observationLatencyMs,
        outcome: "error",
      });
    }
    if (observation.execution === "returned" && observation.outcome === "error") {
      if (observation.exception_kind !== null) {
        throw new Error(`observations[${index}] returned library error cannot carry exception_kind`);
      }
      return libraryTuple({
        candidates: 1,
        retryCount: observationRetryCount,
        latencyMs: observationLatencyMs,
        outcome: "error",
      });
    }
    if (observation.execution !== "returned" || observation.outcome !== "success") {
      throw new Error(`observations[${index}] has an invalid library outcome`);
    }
    const assertions = evaluateEndpointAssertions(laneId, observation.document);
    return libraryTuple({
      candidates: 1,
      retryCount: observationRetryCount,
      latencyMs: observationLatencyMs,
      outcome: "success",
      decode: "ok",
      payload: "non_empty",
      assertions,
    });
  });
  const tuple = { ...foldWorstTuples(tuples), candidates: candidateCount, retry_count: retryCount, latency_ms: latencyMs };
  const status = tuple.execution === "threw"
    ? tuple.exception_kind === "transport" ? "transport_error" : "unexpected_error"
    : tuple.outcome === "error" ? "unexpected_error"
    : tuple.assertions.some((assertion) => !assertion.passed) ? "schema_drift" : "ok";
  return attemptResult(status, tuple);
}

export function emitStockAnalysisAttempt({
  laneId,
  envelope,
  attemptId,
  observedAt,
  shardRoot = DEFAULT_SHARD_ROOT,
}) {
  const lane = laneConfig(laneId);
  const expectedTransport = transportFor(lane);
  if (envelope?.transport !== expectedTransport) {
    throw new Error(`${laneId} transport mismatch: expected ${expectedTransport}`);
  }
  let result;
  if (expectedTransport === "library") {
    result = classifyLibraryEnvelope(laneId, envelope);
  } else {
    if (!Array.isArray(envelope.observations) || envelope.observations.length === 0) {
      throw new Error("HTTP observations must be non-empty");
    }
    result = worstRequestResult(envelope.observations.map((observation) => classifyHttpObservation(laneId, observation)));
  }
  return writeMergedAttemptShard({
    laneId,
    attemptShardPath: path.join(shardRoot, `${laneId}.json`),
    observedAt,
    attemptId,
    result,
  });
}

function argumentValue(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  if (index + 1 >= argv.length) throw new Error(`${name} requires a value`);
  return argv[index + 1];
}

function main(argv = process.argv.slice(2)) {
  const laneId = argumentValue(argv, "--lane");
  const attemptId = argumentValue(argv, "--attempt-id");
  const observedAt = argumentValue(argv, "--observed-at");
  const shardRoot = argumentValue(argv, "--shard-root", DEFAULT_SHARD_ROOT);
  if (!laneId || !attemptId || !observedAt) throw new Error("--lane, --attempt-id, and --observed-at are required");
  const envelope = JSON.parse(fs.readFileSync(0, "utf8"));
  const row = emitStockAnalysisAttempt({ laneId, envelope, attemptId, observedAt, shardRoot });
  process.stdout.write(`${JSON.stringify({ lane_id: laneId, status: row.outcome ?? row.execution, attempt_id: row.attempt_id })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    if (transportError(error)) process.exitCode = 2;
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode ||= 1;
  }
}
