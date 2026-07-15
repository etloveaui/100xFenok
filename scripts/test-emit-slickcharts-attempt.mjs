#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateAttemptShard } from "./build-data-supply-detection-floor.mjs";
import { runSlickchartsAttempt } from "./emit-slickcharts-attempt.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "slickcharts-attempt-test-"));
const shardPath = path.join(root, "slickcharts.json");

function eventPath(name, rows) {
  const filePath = path.join(root, `${name}.jsonl`);
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  return filePath;
}

function outcomePath(name, rows) {
  const filePath = path.join(root, `${name}-outcomes.jsonl`);
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  return filePath;
}

const ready = {
  execution: "returned",
  exception_kind: null,
  http_status: 200,
  auth: "not_applicable",
  rate_limited: false,
  decode: "ok",
  payload: "non_empty",
  assertions: [{ id: "table_rows", passed: true }],
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
  const rowPath = path.join(root, "daily-row.json");
  const result = runSlickchartsAttempt({
    memberId: "daily",
    eventPaths: [eventPath("daily", [ready, ready])],
    producerOutcomes: ["success", "success"],
    shardPath,
    rowPath,
    observedAt: "2026-07-14T01:00:00Z",
    attemptId: "gh-200-1-daily",
    outcomesPath: outcomePath("daily", [
      { key: "gainers.json", outcome: "success" },
      { key: "losers.json", outcome: "success" },
      { key: "treasury.json", outcome: "success" },
      { key: "currency.json", outcome: "success" },
      { key: "mortgage.json", outcome: "success" },
    ]),
  });
  assert.equal(result.row.member_id, "daily");
  assert.equal(result.row.assertions[0].passed, true);
  assert.equal(validateAttemptShard(result.shard, "slickcharts"), true);
  assert.deepEqual(result.shard.attempts.map((row) => row.member_id), ["daily", "weekly", "monthly", "history", "symbols"]);
  assert.deepEqual(result.shard.attempts.map((row) => row.execution), ["returned", "unobserved", "unobserved", "unobserved", "unobserved"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(rowPath, "utf8")), result.row);
}

{
  const result = runSlickchartsAttempt({
    memberId: "daily",
    eventPaths: [eventPath("daily-controlled", [ready])],
    producerOutcomes: ["success"],
    outcomesPath: outcomePath("daily-controlled", [
      { key: "gainers.json", outcome: "success" },
      { key: "losers.json", outcome: "success" },
      { key: "treasury.json", outcome: "failure", failure_kind: "controlled" },
      { key: "currency.json", outcome: "success" },
      { key: "mortgage.json", outcome: "success" },
    ]),
    shardPath,
    rowPath: path.join(root, "daily-controlled-row.json"),
    observedAt: "2026-07-14T01:30:00Z",
    attemptId: "gh-200b-1-daily",
  });
  assert.equal(result.row.execution, "threw", "controlled per-file failure remains visible in attempt evidence");
  assert.equal(result.row.exception_kind, "unexpected");
}

{
  const result = runSlickchartsAttempt({
    memberId: "weekly",
    eventPaths: [eventPath("weekly", [ready, rate, ready])],
    producerOutcomes: ["success"],
    shardPath,
    rowPath: path.join(root, "weekly-row.json"),
    observedAt: "2026-07-14T02:00:00Z",
    attemptId: "gh-201-1-weekly",
  });
  assert.equal(result.row.http_status, 429, "the member attempt is the worst HTTP request");
  assert.equal(result.shard.attempts[0].attempt_id, "gh-200b-1-daily", "another workflow's row is preserved");
}

{
  const result = runSlickchartsAttempt({
    memberId: "monthly",
    eventPaths: [eventPath("monthly", [ready])],
    producerOutcomes: ["success", "failure", "skipped"],
    shardPath,
    rowPath: path.join(root, "monthly-row.json"),
    observedAt: "2026-07-14T03:00:00Z",
    attemptId: "gh-202-1-monthly",
  });
  assert.equal(result.row.execution, "threw");
  assert.equal(result.row.exception_kind, "unexpected");
}

{
  const result = runSlickchartsAttempt({
    memberId: "history",
    eventPaths: [],
    producerOutcomes: ["success"],
    shardPath,
    rowPath: path.join(root, "history-row.json"),
    observedAt: "2026-07-14T04:00:00Z",
    attemptId: "gh-203-1-history",
  });
  assert.equal(result.row.execution, "threw", "a green producer with no observed request is not a false green");
}

{
  const corruptPath = path.join(root, "corrupt.jsonl");
  fs.writeFileSync(corruptPath, "{truncated\n");
  const result = runSlickchartsAttempt({
    memberId: "symbols",
    eventPaths: [corruptPath],
    producerOutcomes: ["success"],
    shardPath,
    rowPath: path.join(root, "symbols-row.json"),
    observedAt: "2026-07-14T05:00:00Z",
    attemptId: "gh-204-1-symbols",
  });
  assert.equal(result.row.execution, "threw", "corrupt telemetry must still emit an honest attempt");
  assert.equal(result.row.exception_kind, "unexpected");
}

console.log("test-emit-slickcharts-attempt: ok");
