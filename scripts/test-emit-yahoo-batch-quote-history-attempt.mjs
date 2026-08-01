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
assert.equal(failed.outcome, "error");
assert.equal(failed.payload, "not_available");
assert.deepEqual(failed.assertions, []);

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
