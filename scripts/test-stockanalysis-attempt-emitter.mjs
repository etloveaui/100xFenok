#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ATTEMPT_SCHEMA,
  classifyAttempt,
  validateAttemptEvidence,
  validateAttemptShard,
} from "./build-data-supply-detection-floor.mjs";
import {
  DATA_SUPPLY_DETECTION_CONFIG,
  validateDetectionConfig,
} from "./lib/data-supply-detection-config.mjs";
import {
  emitStockAnalysisAttempt,
} from "./emit-stockanalysis-attempt.mjs";
import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

const ATTEMPT_ID = "gh-900-1";
const OBSERVED_AT = "2026-07-16T09:30:00.000Z";

function lane(id) {
  return DATA_SUPPLY_DETECTION_CONFIG.lanes.find((row) => row.id === id);
}

function readShard(root, id) {
  return JSON.parse(fs.readFileSync(path.join(root, `${id}.json`), "utf8"));
}

assert.equal(validateDetectionConfig(DATA_SUPPLY_DETECTION_CONFIG), true);
// Flipped live by 844dfab743 on a real committed attempt shard; reverting to "shadow" must be an equally conscious edit here.
assert.equal(lane("yahoo_etf_fallback").enforcement, "live");
assert.equal(lane("yahoo_etf_fallback").endpoint_contract.transport, "library");
assert.equal(lane("stockanalysis_etf_universe").enforcement, "live");
assert.equal(
  Object.hasOwn(lane("stockanalysis_etf_universe").endpoint_contract, "transport"),
  false,
  "undeclared endpoint transport remains HTTP",
);
assert.deepEqual(
  lane("stockanalysis_etf_universe").freshness.source_basis,
  [],
  "a provider-dateless artifact must not promote collected_at into source_as_of",
);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "stockanalysis-attempt-"));
try {
  const empty = emitStockAnalysisAttempt({
    laneId: "yahoo_etf_fallback",
    shardRoot: root,
    attemptId: ATTEMPT_ID,
    observedAt: OBSERVED_AT,
    envelope: { transport: "library", candidate_count: 0, observations: [] },
  });
  assert.equal(empty.candidates, 0);
  assert.equal(empty.retry_count, 0);
  assert.equal(empty.latency_ms, 0);
  assert.equal(empty.outcome, "no_fallback_candidates");
  assert.equal(empty.http_status, null);
  assert.equal(classifyAttempt(empty).reason, "ok");
  validateAttemptShard(readShard(root, "yahoo_etf_fallback"), "yahoo_etf_fallback");
  const libraryShard = readShard(root, "yahoo_etf_fallback");
  const fabricatedLibraryStatus = structuredClone(libraryShard);
  fabricatedLibraryStatus.attempts[0].http_status = 200;
  assert.throws(
    () => validateAttemptShard(fabricatedLibraryStatus, "yahoo_etf_fallback"),
    /fabricates an HTTP status/,
  );
  const missingLibraryEvidence = structuredClone(libraryShard);
  delete missingLibraryEvidence.attempts[0].retry_count;
  assert.throws(() => validateAttemptShard(missingLibraryEvidence, "yahoo_etf_fallback"), /keys must be exactly/);
  const negativeLibraryEvidence = structuredClone(libraryShard);
  negativeLibraryEvidence.attempts[0].latency_ms = -1;
  assert.throws(() => validateAttemptShard(negativeLibraryEvidence, "yahoo_etf_fallback"), /library evidence is invalid/);

  assert.throws(() => emitStockAnalysisAttempt({
    laneId: "yahoo_etf_fallback",
    shardRoot: root,
    attemptId: "gh-901-1",
    observedAt: OBSERVED_AT,
    envelope: {
      transport: "library",
      candidate_count: 1,
      fabricated_http_status: 200,
      observations: [],
    },
  }), /fabricated|http_status|library/i);

  assert.throws(() => emitStockAnalysisAttempt({
    laneId: "stockanalysis_etf_universe",
    shardRoot: root,
    attemptId: "gh-902-1",
    observedAt: OBSERVED_AT,
    envelope: { transport: "library", candidate_count: 0, observations: [] },
  }), /transport|http/i);
  assert.throws(() => emitStockAnalysisAttempt({
    laneId: "yahoo_etf_fallback",
    shardRoot: root,
    attemptId: "gh-902b-1",
    observedAt: OBSERVED_AT,
    envelope: { transport: "library", candidate_count: 1, fallback_enabled: true, observations: [] },
  }), /candidate_count/);
  assert.throws(() => emitStockAnalysisAttempt({
    laneId: "yahoo_etf_fallback",
    shardRoot: root,
    attemptId: "gh-902c-1",
    observedAt: OBSERVED_AT,
    envelope: {
      transport: "library",
      candidate_count: 0,
      fallback_enabled: true,
      observations: [{ execution: "returned", retry_count: 0, latency_ms: 1, outcome: "success", document: {} }],
    },
  }), /zero candidates/);
  const disabled = emitStockAnalysisAttempt({
    laneId: "yahoo_etf_fallback",
    shardRoot: root,
    attemptId: "gh-902d-1",
    observedAt: OBSERVED_AT,
    envelope: { transport: "library", candidate_count: 1, fallback_enabled: false, observations: [] },
  });
  assert.equal(disabled.outcome, "not_attempted");
  assert.equal(classifyAttempt(disabled).status, "unavailable");

  const returnedError = emitStockAnalysisAttempt({
    laneId: "yahoo_etf_fallback",
    shardRoot: root,
    attemptId: "gh-902e-1",
    observedAt: OBSERVED_AT,
    envelope: {
      transport: "library",
      candidate_count: 1,
      observations: [{
        execution: "returned",
        exception_kind: null,
        retry_count: 2,
        latency_ms: 81,
        outcome: "error",
      }],
    },
  });
  assert.equal(returnedError.execution, "returned");
  assert.equal(returnedError.exception_kind, null);
  assert.equal(returnedError.retry_count, 2);
  assert.equal(returnedError.latency_ms, 81);
  assert.equal(returnedError.outcome, "error");
  assert.equal(classifyAttempt(returnedError).reason, "unexpected_error");

  const producerFailure = emitStockAnalysisAttempt({
    laneId: "yahoo_etf_fallback",
    shardRoot: root,
    attemptId: "gh-902f-1",
    observedAt: OBSERVED_AT,
    envelope: {
      transport: "library",
      candidate_count: 0,
      observations: [],
      producer_failure: { execution: "threw", exception_kind: "unexpected" },
    },
  });
  assert.equal(producerFailure.execution, "threw");
  assert.equal(producerFailure.candidates, 0);
  assert.equal(classifyAttempt(producerFailure).reason, "unexpected_error");

  const yahooReady = emitStockAnalysisAttempt({
    laneId: "yahoo_etf_fallback",
    shardRoot: root,
    attemptId: "gh-903-1",
    observedAt: OBSERVED_AT,
    envelope: {
      transport: "library",
      candidate_count: 1,
      observations: [{
        execution: "returned",
        retry_count: 0,
        latency_ms: 125,
        outcome: "success",
        document: { info: { symbol: "SPY", quoteType: "ETF" } },
      }],
    },
  });
  assert.equal(yahooReady.http_status, null);
  assert.equal(yahooReady.outcome, "success");
  assert.deepEqual(yahooReady.assertions, [{ id: "yahoo_etf_identity", passed: true }]);
  assert.equal(classifyAttempt(yahooReady).reason, "ok");

  const yahooDrift = emitStockAnalysisAttempt({
    laneId: "yahoo_etf_fallback",
    shardRoot: root,
    attemptId: "gh-904-1",
    observedAt: OBSERVED_AT,
    envelope: {
      transport: "library",
      candidate_count: 1,
      observations: [{
        execution: "returned",
        retry_count: 0,
        latency_ms: 30,
        outcome: "success",
        document: { info: { symbol: "SPY" } },
      }],
    },
  });
  assert.equal(classifyAttempt(yahooDrift).reason, "schema_drift");

  const universeReady = emitStockAnalysisAttempt({
    laneId: "stockanalysis_etf_universe",
    shardRoot: root,
    attemptId: "gh-905-1",
    observedAt: OBSERVED_AT,
    envelope: {
      transport: "http",
      observations: [{
        status_code: 200,
        document: { rows: [{ ticker: "SPY", name: "SPDR S&P 500 ETF Trust" }] },
      }],
    },
  });
  assert.equal(universeReady.http_status, 200);
  assert.equal(classifyAttempt(universeReady).reason, "ok");
  const nullHttpStatus = readShard(root, "stockanalysis_etf_universe");
  nullHttpStatus.attempts[0].http_status = null;
  assert.throws(() => validateAttemptShard(nullHttpStatus, "stockanalysis_etf_universe"), /returned tuple is invalid/);
  const httpWithLibraryEvidence = readShard(root, "stockanalysis_etf_universe");
  Object.assign(httpWithLibraryEvidence.attempts[0], {
    candidates: 1,
    retry_count: 0,
    latency_ms: 1,
    outcome: "success",
  });
  assert.throws(() => validateAttemptShard(httpWithLibraryEvidence, "stockanalysis_etf_universe"), /keys must be exactly/);

  const universeEmpty = emitStockAnalysisAttempt({
    laneId: "stockanalysis_etf_universe",
    shardRoot: root,
    attemptId: "gh-906-1",
    observedAt: OBSERVED_AT,
    envelope: {
      transport: "http",
      observations: [{ status_code: 200, document: { rows: [] } }],
    },
  });
  assert.equal(classifyAttempt(universeEmpty).reason, "empty_payload");
  const merged = {
    schema_version: ATTEMPT_SCHEMA,
    attempts: [
      ...readShard(root, "yahoo_etf_fallback").attempts,
      ...readShard(root, "stockanalysis_etf_universe").attempts,
    ],
  };
  assert.equal(validateAttemptEvidence(merged), true, "lane-specific attempt IDs merge without collision");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

const workflow = fs.readFileSync(new URL("../.github/workflows/fetch-stockanalysis.yml", import.meta.url), "utf8");
assert.match(workflow, /test-stockanalysis-attempt-emitter\.mjs/);
assert.match(workflow, /detection-attempts\/yahoo_etf_fallback\.json/);
assert.match(workflow, /detection-attempts\/stockanalysis_etf_universe\.json/);


// Lane Registry ⇄ commit-shard completeness gate (#366 step 4).
{
  const workflowText = fs.readFileSync(new URL("../.github/workflows/fetch-stockanalysis.yml", import.meta.url), "utf8");
  const gate = checkWorkflowCommitShardsAgainstRegistry({
    workflowText,
    workflowRel: ".github/workflows/fetch-stockanalysis.yml",
  });
  assert.deepEqual(gate.missing_in_workflow, [],
    `declared shards the workflow never commits: ${JSON.stringify(gate.missing_in_workflow)}`);
  assert.deepEqual(gate.undeclared_in_workflow, [],
    `allowlist paths with no registry record: ${JSON.stringify(gate.undeclared_in_workflow)}`);
  assert.deepEqual(gate.lanes.sort(), ["stockanalysis_etf_universe", "yahoo_etf_fallback"].sort(), "registry lane attribution for this workflow");
}

console.log("PASS stockanalysis attempt emitter");
