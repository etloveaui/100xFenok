#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  classifyAttempt,
  validateAttemptEvidence,
  validateAttemptShard,
} from "./build-data-supply-detection-floor.mjs";
import {
  buildAttemptRow,
  classifyEndpointResponse,
  foldWorstTuples,
  mergeCompositeShard,
  returnedTuple,
  threwTuple,
  transportError,
  unobservedTuple,
  writeMergedAttemptShard,
} from "./lib/data-supply-attempt-shard.mjs";

const MEMBERS = ["daily", "weekly", "monthly", "history", "symbols"];

function validateRow(row) {
  return validateAttemptEvidence({
    schema_version: "data-supply-detection-attempts/v1",
    attempts: [row],
  });
}

function rowFor(memberId, index) {
  return buildAttemptRow({
    laneId: "slickcharts",
    memberId,
    attemptId: `gh-100-${index}-${memberId}`,
    observedAt: `2026-07-14T00:00:0${index}Z`,
    tuple: returnedTuple({
      httpStatus: 200,
      decode: "ok",
      payload: "non_empty",
      assertions: [{ id: "table_rows", passed: true }],
    }),
  });
}

{
  assert.equal(transportError({ cause: { code: "ENOTFOUND" } }), true);
  assert.equal(transportError({ name: "AbortError" }), true);
  assert.equal(transportError(new Error("schema mismatch")), false);
}

{
  const finra403 = buildAttemptRow({
    laneId: "finra_short_volume",
    memberId: null,
    attemptId: "finra-403-test",
    observedAt: "2026-07-14T00:00:00Z",
    tuple: returnedTuple({ httpStatus: 403 }),
  });
  assert.equal(validateRow(finra403), true);
  assert.equal(classifyAttempt(finra403).reason, "http_error");
  assert.throws(() => validateRow(buildAttemptRow({
    laneId: "slickcharts",
    memberId: "daily",
    attemptId: "slickcharts-403-test",
    observedAt: "2026-07-14T00:00:00Z",
    tuple: returnedTuple({ httpStatus: 403 }),
  })), /schema_error/);
}

{
  const states = [
    buildAttemptRow({ laneId: "slickcharts", memberId: "daily", tuple: unobservedTuple() }),
    buildAttemptRow({
      laneId: "slickcharts",
      memberId: "daily",
      attemptId: "gh-101-daily",
      observedAt: "2026-07-14T00:00:00Z",
      tuple: threwTuple("transport"),
    }),
    buildAttemptRow({
      laneId: "slickcharts",
      memberId: "daily",
      attemptId: "gh-102-daily",
      observedAt: "2026-07-14T00:00:00Z",
      tuple: returnedTuple({ httpStatus: 401, auth: "rejected" }),
    }),
    buildAttemptRow({
      laneId: "slickcharts",
      memberId: "daily",
      attemptId: "gh-103-daily",
      observedAt: "2026-07-14T00:00:00Z",
      tuple: returnedTuple({ httpStatus: 429, rateLimited: true }),
    }),
    buildAttemptRow({
      laneId: "slickcharts",
      memberId: "daily",
      attemptId: "gh-104-daily",
      observedAt: "2026-07-14T00:00:00Z",
      tuple: returnedTuple({ httpStatus: 503 }),
    }),
    buildAttemptRow({
      laneId: "slickcharts",
      memberId: "daily",
      attemptId: "gh-105-daily",
      observedAt: "2026-07-14T00:00:00Z",
      tuple: returnedTuple({ httpStatus: 200, decode: "error" }),
    }),
    buildAttemptRow({
      laneId: "slickcharts",
      memberId: "daily",
      attemptId: "gh-106-daily",
      observedAt: "2026-07-14T00:00:00Z",
      tuple: returnedTuple({ httpStatus: 200, decode: "ok", payload: "empty" }),
    }),
    rowFor("daily", 7),
  ];
  for (const row of states) assert.equal(validateRow(row), true);
}

{
  const decoded = classifyEndpointResponse({
    statusCode: 200,
    body: "Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market\n20260714|NVDA|10|0|100|Q\n",
  }, {
    laneId: "finra_short_volume",
    decodeBody: (body) => ({ rows: body.trim().split("\n").slice(1) }),
  });
  assert.equal(decoded.status, "ready");
  assert.deepEqual(decoded.attempt.assertions, [{ id: "regsho_rows", passed: true }]);

  const malformed = classifyEndpointResponse({ statusCode: 200, body: "not-regsho" }, {
    laneId: "finra_short_volume",
    decodeBody: () => { throw new Error("bad header"); },
  });
  assert.equal(malformed.reason, "decode_error");
  assert.equal(malformed.attempt.decode, "error");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "single-lane-attempt-"));
  const attemptShardPath = path.join(root, "occ_options_volume.json");
  const ready = {
    status: "ready",
    reason: "ok",
    attempt: returnedTuple({
      httpStatus: 200,
      decode: "ok",
      payload: "non_empty",
      assertions: [{ id: "csv_rows", passed: true }],
    }),
  };
  const rateLimited = {
    status: "unavailable",
    reason: "rate_limited",
    attempt: returnedTuple({ httpStatus: 429, rateLimited: true }),
  };
  const empty = {
    status: "unavailable",
    reason: "empty_payload",
    attempt: returnedTuple({ httpStatus: 200, decode: "ok", payload: "empty" }),
  };
  const expectedEmptyPath = path.join(root, "occ_expected_empty.json");
  writeMergedAttemptShard({
    laneId: "occ_options_volume",
    attemptShardPath: expectedEmptyPath,
    observedAt: "2026-07-15T00:58:00Z",
    attemptId: "occ-options-volume-99-1",
    result: { status: "unobserved", reason: "workflow_unobserved", attempt: unobservedTuple() },
  });
  writeMergedAttemptShard({
    laneId: "occ_options_volume",
    attemptShardPath: expectedEmptyPath,
    observedAt: "2026-07-15T00:59:00Z",
    attemptId: "occ-options-volume-99-1",
    result: ready,
  });
  assert.equal(JSON.parse(fs.readFileSync(expectedEmptyPath, "utf8")).attempts[0].payload, "non_empty");
  writeMergedAttemptShard({
    laneId: "occ_options_volume",
    attemptShardPath: expectedEmptyPath,
    observedAt: "2026-07-15T00:59:30Z",
    attemptId: "occ-options-volume-99-1",
    result: { status: "unobserved", reason: "workflow_unobserved", attempt: unobservedTuple() },
  });
  assert.equal(JSON.parse(fs.readFileSync(expectedEmptyPath, "utf8")).attempts[0].payload, "non_empty");

  const genuineEmptyPath = path.join(root, "occ_genuine_empty.json");
  writeMergedAttemptShard({
    laneId: "occ_options_volume",
    attemptShardPath: genuineEmptyPath,
    observedAt: "2026-07-15T00:58:00Z",
    attemptId: "occ-options-volume-98-1",
    result: ready,
  });
  writeMergedAttemptShard({
    laneId: "occ_options_volume",
    attemptShardPath: genuineEmptyPath,
    observedAt: "2026-07-15T00:59:00Z",
    attemptId: "occ-options-volume-98-1",
    result: empty,
  });
  assert.equal(JSON.parse(fs.readFileSync(genuineEmptyPath, "utf8")).attempts[0].payload, "empty");
  writeMergedAttemptShard({
    laneId: "occ_options_volume",
    attemptShardPath,
    observedAt: "2026-07-15T01:00:00Z",
    attemptId: "occ-options-volume-100-1",
    result: ready,
  });
  writeMergedAttemptShard({
    laneId: "occ_options_volume",
    attemptShardPath,
    observedAt: "2026-07-15T01:01:00Z",
    attemptId: "occ-options-volume-100-1",
    result: rateLimited,
  });
  writeMergedAttemptShard({
    laneId: "occ_options_volume",
    attemptShardPath,
    observedAt: "2026-07-15T01:02:00Z",
    attemptId: "occ-options-volume-100-1",
    result: ready,
  });
  let shard = JSON.parse(fs.readFileSync(attemptShardPath, "utf8"));
  assert.equal(shard.attempts[0].http_status, 429, "later ready batch cannot hide same-run failure");
  assert.equal(shard.attempts[0].observed_at, "2026-07-15T01:02:00Z");

  writeMergedAttemptShard({
    laneId: "occ_options_volume",
    attemptShardPath,
    observedAt: "2026-07-16T01:00:00Z",
    attemptId: "occ-options-volume-101-1",
    result: ready,
  });
  shard = JSON.parse(fs.readFileSync(attemptShardPath, "utf8"));
  assert.equal(shard.attempts[0].attempt_id, "occ-options-volume-101-1");
  assert.equal(shard.attempts[0].http_status, 200, "new run resets the prior worst tuple");
}

{
  const ready = returnedTuple({
    httpStatus: 200,
    decode: "ok",
    payload: "non_empty",
    assertions: [{ id: "table_rows", passed: true }],
  });
  const drift = returnedTuple({
    httpStatus: 200,
    decode: "ok",
    payload: "non_empty",
    assertions: [{ id: "table_rows", passed: false }],
  });
  const rate = returnedTuple({ httpStatus: 429, rateLimited: true });
  const transport = threwTuple("transport");
  assert.equal(foldWorstTuples([ready, drift, rate]), rate);
  assert.equal(foldWorstTuples([ready, rate, transport]), rate, "equal severity keeps the first tuple");
}

function permutations(values) {
  if (values.length < 2) return [values];
  return values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index))
    .map((tail) => [value, ...tail]));
}

for (const order of permutations(MEMBERS)) {
  let shard = null;
  for (const memberId of order) {
    shard = mergeCompositeShard({
      laneId: "slickcharts",
      memberIds: MEMBERS,
      baseShard: shard,
      row: rowFor(memberId, MEMBERS.indexOf(memberId)),
    });
    assert.equal(validateAttemptShard(shard, "slickcharts"), true);
  }
  assert.deepEqual(shard.attempts.map((row) => row.member_id), MEMBERS);
  assert.deepEqual(shard.attempts.map((row) => row.execution), MEMBERS.map(() => "returned"));
}

{
  let shard = null;
  for (const [index, memberId] of MEMBERS.entries()) {
    shard = mergeCompositeShard({ laneId: "slickcharts", memberIds: MEMBERS, baseShard: shard, row: rowFor(memberId, index) });
  }
  const before = new Map(shard.attempts.map((row) => [row.member_id, row.attempt_id]));
  const replacement = buildAttemptRow({
    laneId: "slickcharts",
    memberId: "monthly",
    attemptId: "gh-999-monthly",
    observedAt: "2026-07-14T12:00:00Z",
    tuple: returnedTuple({ httpStatus: 429, rateLimited: true }),
  });
  shard = mergeCompositeShard({ laneId: "slickcharts", memberIds: MEMBERS, baseShard: shard, row: replacement });
  for (const row of shard.attempts) {
    assert.equal(row.attempt_id, row.member_id === "monthly" ? "gh-999-monthly" : before.get(row.member_id));
  }
  assert.throws(() => mergeCompositeShard({
    laneId: "slickcharts",
    memberIds: MEMBERS,
    baseShard: shard,
    row: { ...replacement, member_id: "unknown" },
  }), /unknown member/);
}

console.log("test-data-supply-attempt-producer: ok");
