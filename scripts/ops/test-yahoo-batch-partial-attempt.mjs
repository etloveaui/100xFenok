#!/usr/bin/env node
// A batch producer that mostly worked was being recorded as one that returned
// nothing at all.
//
// toYahooBatchAttemptRow branched on `failed > 0` and emitted outcome "error"
// with decode "not_attempted" and payload "not_available". Measured 2026-08-21
// on run 32429826829: attempted 1194, successes 3, skipped 1181, failed 10 -
// and the ten are individually known provider-coverage gaps (012510.KS,
// 230360.KQ, BK, BLD, CTRA, DAY, EA, HOLX, MMC, SATS), the Korean pair already
// recorded as such under #348. Ten bad tickers out of 1194 marked the whole
// lane unavailable, which reached the KPI as producer_status "unavailable" /
// producer_reason "unexpected_error" and put fetch-yf-finance into the alarm.
//
// On a 1194-ticker batch, `failed > 0` is very close to always true, so this
// rule can essentially never report health.
//
// The platform already has the right vocabulary and it did not need a schema
// change: tupleStatus maps outcome "success" WITH a failed assertion to
// "drift", which is neither "ready" nor "unavailable". Partial success is now
// recorded that way, so the ten failures stay visible as drift instead of
// being reported as a producer that returned nothing.
//
// The genuinely-nothing case is unchanged and must stay: successes 0 with
// failures is still an error.

import assert from "node:assert/strict";

import { toYahooBatchAttemptRow } from "../emit-yahoo-batch-quote-history-attempt.mjs";
import { tupleStatus } from "../lib/data-supply-attempt-shard.mjs";

const INDEX_SCHEMA = "yahoo-batch-quote-history-index/v1";

function index({ attempted, successes, failed, skipped }) {
  return {
    schema_version: INDEX_SCHEMA,
    generated_at: "2026-08-21T00:07:00Z",
    current_attempt: {
      run_id: "32429826829",
      run_attempt: 1,
      attempted,
      failed,
      successes,
      skipped,
      fetch_attempts: attempted,
    },
  };
}

const statusOf = (row) => tupleStatus({
  execution: row.execution,
  outcome: row.outcome,
  decode: row.decode,
  payload: row.payload,
  assertions: row.assertions,
  http_status: row.http_status,
});

// --- The measured incident: 10 of 1194 failed and 3 succeeded ---------------
{
  const row = toYahooBatchAttemptRow(index({ attempted: 1194, successes: 3, failed: 10, skipped: 1181 }));
  assert.equal(statusOf(row), "drift", "a mostly-working batch must not read as a dead producer");
  assert.notEqual(statusOf(row), "unavailable");
  assert.equal(row.decode, "ok", "data was decoded; saying otherwise is false");
  assert.equal(row.payload, "non_empty", "three tickers returned payloads");
  const failedAssertion = row.assertions.find((a) => a.passed === false);
  assert.ok(failedAssertion, "the failures must remain visible as a failed assertion, not be smoothed away");
  // The detection floor requires the assertion id set to match the lane's
  // declared endpoint_contract exactly, so partial success must fail the
  // DECLARED assertion rather than invent a new id. It also reserves
  // failure_entity/failure_detail for thrown executions, so the counts are not
  // carried on the row; they are in the index the same run commits.
  assert.equal(
    failedAssertion.id,
    "current_attempt_completed",
    "partial success must fail the lane's declared assertion, not a new id the floor would reject",
  );
  assert.deepEqual(Object.keys(failedAssertion).sort(), ["id", "passed"]);
  assert.equal(row.failure_entity, undefined, "failure diagnostics are reserved for thrown executions");
}

// --- Nothing came back at all: still an error -------------------------------
{
  const row = toYahooBatchAttemptRow(index({ attempted: 12, successes: 0, failed: 10, skipped: 2 }));
  assert.equal(row.outcome, "error", "zero successes with failures is a real producer failure");
  assert.equal(statusOf(row), "unavailable");
}

// --- A clean batch is still clean -------------------------------------------
{
  const row = toYahooBatchAttemptRow(index({ attempted: 100, successes: 100, failed: 0, skipped: 0 }));
  assert.equal(row.outcome, "success");
  assert.equal(statusOf(row), "ready", "a batch with no failures must stay ready");
  assert.ok(
    !row.assertions.some((a) => a.passed === false),
    "a clean batch must not carry a failed assertion",
  );
}

// --- Nothing to do is unchanged ---------------------------------------------
{
  const row = toYahooBatchAttemptRow(index({ attempted: 0, successes: 0, failed: 0, skipped: 0 }));
  assert.equal(row.outcome, "no_fallback_candidates");
  assert.equal(statusOf(row), "ready");
}

// --- All skipped, none attempted to fetch, is not a failure -----------------
{
  const row = toYahooBatchAttemptRow(index({ attempted: 50, successes: 0, failed: 0, skipped: 50 }));
  assert.equal(statusOf(row), "ready", "a batch where every ticker was already fresh is healthy");
}

// --- The boundary is successes, not a failure ratio --------------------------
// A ratio would be a tuned threshold, and the standing rule is that a limit is
// never set to whatever makes the current measurement pass.
{
  const barely = toYahooBatchAttemptRow(index({ attempted: 1000, successes: 1, failed: 999, skipped: 0 }));
  assert.equal(statusOf(barely), "drift", "one success is still data returned; drift, not ready, not dead");
  const none = toYahooBatchAttemptRow(index({ attempted: 1000, successes: 0, failed: 1000, skipped: 0 }));
  assert.equal(statusOf(none), "unavailable");
}

console.log("test-yahoo-batch-partial-attempt: ok");
