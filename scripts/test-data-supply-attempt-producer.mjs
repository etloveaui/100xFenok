#!/usr/bin/env node

import assert from "node:assert/strict";

import { validateAttemptEvidence, validateAttemptShard } from "./build-data-supply-detection-floor.mjs";
import {
  buildAttemptRow,
  foldWorstTuples,
  mergeCompositeShard,
  returnedTuple,
  threwTuple,
  unobservedTuple,
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
