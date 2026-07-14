#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateAttemptShard } from "./build-data-supply-detection-floor.mjs";
import { recordSentimentAttemptTuple, runSentiment } from "./fetch-sentiment.mjs";
import { classifyEndpointResponse } from "./lib/data-supply-attempt-shard.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ready = {
  execution: "returned",
  exception_kind: null,
  http_status: 200,
  auth: "not_applicable",
  rate_limited: false,
  decode: "ok",
  payload: "non_empty",
  assertions: [{ id: "series_array", passed: true }],
};
const rate = {
  execution: "returned",
  exception_kind: null,
  http_status: 429,
  auth: "not_applicable",
  rate_limited: true,
  decode: "not_attempted",
  payload: "not_available",
  assertions: [],
};

{
  const classified = classifyEndpointResponse({
    statusCode: 200,
    body: JSON.stringify({ data: [{ value: "50" }] }),
  }, { laneId: "sentiment" });
  assert.equal(classified.status, "drift");
  assert.deepEqual(classified.attempt.assertions, [{ id: "series_array", passed: false }]);
}

async function runCase(sources) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-sentiment-test-"));
  const attemptShardPath = path.join(root, "sentiment.json");
  const result = await runSentiment({
    sources,
    attemptShardPath,
    observedAt: "2026-07-14T06:00:00Z",
    attemptId: "gh-400-1-sentiment",
    quiet: true,
  });
  const shard = JSON.parse(fs.readFileSync(attemptShardPath, "utf8"));
  assert.equal(validateAttemptShard(shard, "sentiment"), true);
  assert.equal(shard.attempts[0].member_id, null);
  return { result, row: shard.attempts[0] };
}

{
  const { result, row } = await runCase([["ok", async () => {
    recordSentimentAttemptTuple(ready);
    return [{ file: "test.json", action: "updated", before: 1, after: 1, sample: {} }];
  }]]);
  assert.equal(result.ok, true);
  assert.deepEqual(row.assertions, [{ id: "series_array", passed: true }]);
}

{
  const { result, row } = await runCase([
    ["ok", async () => { recordSentimentAttemptTuple(ready); return []; }],
    ["rate", async () => { recordSentimentAttemptTuple(rate); throw new Error("rate"); }],
  ]);
  assert.equal(result.ok, true, "partial source publishing behavior is preserved");
  assert.equal(row.http_status, 429, "all source requests fold worst-of");
  assert.equal(row.assertions.length, 0);
}

{
  const { row } = await runCase([["false green", async () => []]]);
  assert.equal(row.execution, "threw");
  assert.equal(row.exception_kind, "unexpected");
}

{
  const workflow = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "fetch-sentiment.yml"), "utf8");
  assert.match(workflow, /detection-attempts\/sentiment\.json/);
  assert.match(workflow, /- name: Commit sentiment data\n\s+if: \$\{\{ always\(\) \}\}/);
}

console.log("test-fetch-sentiment: ok");
