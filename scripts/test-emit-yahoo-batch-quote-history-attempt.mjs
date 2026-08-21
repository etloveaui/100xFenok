#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateAttemptShard } from "./build-data-supply-detection-floor.mjs";
import {
  emitYahooBatchQuoteHistoryAttempt,
  toYahooBatchAttemptRow,
} from "./emit-yahoo-batch-quote-history-attempt.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "yahoo-batch-attempt-"));
const indexPath = path.join(root, "index.json");
const attemptShardPath = path.join(root, "attempts", "yahoo_batch_quote_history.json");

const successfulIndex = {
  schema_version: "yahoo-batch-quote-history-index/v1",
  generated_at: "2026-08-01T01:00:13Z",
  current_attempt: {
    run_id: "30674982988",
    run_attempt: 1,
    event_name: "schedule",
    schedule: "20 23 * * 1-5",
    natural: true,
    attempted: 1185,
    successes: 1118,
    failed: 0,
    skipped: 67,
    fetch_attempts: 1131,
    errors: [],
  },
};

const success = toYahooBatchAttemptRow(successfulIndex);
assert.equal(success.lane_id, "yahoo_batch_quote_history");
assert.equal(success.member_id, null);
assert.equal(success.attempt_id, "gh-30674982988-1-yahoo-batch");
assert.equal(success.observed_at, successfulIndex.generated_at);
assert.equal(success.outcome, "success");
assert.equal(success.candidates, 1185);
assert.equal(success.retry_count, 0);
assert.deepEqual(success.assertions, [{ id: "current_attempt_completed", passed: true }]);

fs.mkdirSync(path.dirname(indexPath), { recursive: true });
fs.writeFileSync(indexPath, `${JSON.stringify(successfulIndex, null, 2)}\n`);
const written = emitYahooBatchQuoteHistoryAttempt({ indexPath, attemptShardPath });
assert.equal(written.attempt_id, success.attempt_id);
const shard = JSON.parse(fs.readFileSync(attemptShardPath, "utf8"));
assert.equal(validateAttemptShard(shard, "yahoo_batch_quote_history"), true);

const failed = toYahooBatchAttemptRow({
  ...successfulIndex,
  current_attempt: {
    ...successfulIndex.current_attempt,
    failed: 2,
    skipped: 65,
    errors: [{ ticker: "FAIL" }],
  },
});
// UPDATED 2026-08-21. This fixture is a PARTIAL success - it keeps the
// successful index's successes and adds 2 failures out of 1185 - and it used to
// assert outcome "error" with payload "not_available", i.e. a producer that
// returned nothing. That was measured wrong in production: run 32429826829 had
// attempted 1194, successes 3, skipped 1181 and failed 10, all ten individually
// known provider-coverage gaps, and the whole lane was recorded unavailable and
// paged. On a batch this size `failed > 0` is close to always true, so the old
// rule could essentially never report health.
//
// Partial success is now outcome "success" with the lane's DECLARED assertion
// failed, which tupleStatus maps to "drift" - neither ready nor unavailable.
// The assertion id must match the lane's endpoint_contract exactly and
// failure_entity/failure_detail are reserved for thrown executions, so the
// counts stay in the index the same run commits.
assert.equal(failed.outcome, "success");
assert.equal(failed.decode, "ok");
assert.equal(failed.payload, "non_empty");
assert.deepEqual(failed.assertions, [{ id: "current_attempt_completed", passed: false }]);

// The genuinely-nothing case is what "error" is for, and it was not covered
// here before. Zero successes with failures must still be a producer failure.
const nothingReturned = toYahooBatchAttemptRow({
  ...successfulIndex,
  current_attempt: {
    ...successfulIndex.current_attempt,
    successes: 0,
    failed: 4,
    skipped: successfulIndex.current_attempt.attempted - 4,
    errors: [{ ticker: "FAIL" }],
  },
});
assert.equal(nothingReturned.outcome, "error");
assert.equal(nothingReturned.payload, "not_available");
assert.deepEqual(nothingReturned.assertions, []);

const empty = toYahooBatchAttemptRow({
  ...successfulIndex,
  current_attempt: {
    ...successfulIndex.current_attempt,
    attempted: 0,
    successes: 0,
    skipped: 0,
    fetch_attempts: 0,
  },
});
assert.equal(empty.outcome, "no_fallback_candidates");

fs.rmSync(root, { recursive: true, force: true });
process.stdout.write("test-emit-yahoo-batch-quote-history-attempt: ok\n");
