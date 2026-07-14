#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACCOUNT_TYPES,
  ATTEMPT_SHARD_SCHEMA,
  runTreasuryTga,
} from "./fetch-treasury-tga.mjs";
import { validateAttemptEvidence } from "./build-data-supply-detection-floor.mjs";

const OBSERVED_AT = "2026-07-14T12:34:56.000Z";
const ATTEMPT_ID = "tga-20260714t123456000z-test";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function response(statusCode, payload) {
  return {
    statusCode,
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  };
}

function rowsFor(accountType, index = 0) {
  return {
    data: [
      {
        record_date: "2026-07-11",
        open_today_bal: String(700_000 + index),
        account_type: accountType,
      },
    ],
  };
}

function makePaths(root) {
  return {
    canonicalPath: path.join(root, "data", "macro", "tga.json"),
    publicPath: path.join(root, "100xfenok-next", "public", "data", "macro", "tga.json"),
    attemptShardPath: path.join(root, "data", "admin", "data-supply-state", "detection-attempts", "treasury_tga.json"),
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function runCase(request) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-tga-test-"));
  const paths = makePaths(root);
  const result = await runTreasuryTga({
    ...paths,
    request,
    observedAt: OBSERVED_AT,
    attemptId: ATTEMPT_ID,
  });
  return { root, paths, result, shard: readJson(paths.attemptShardPath) };
}

function assertShardShape(shard) {
  assert.deepEqual(Object.keys(shard), ["schema_version", "lane_id", "attempts"]);
  assert.equal(shard.schema_version, ATTEMPT_SHARD_SCHEMA);
  assert.equal(shard.lane_id, "treasury_tga");
  assert.equal(shard.attempts.length, 1);
  assert.equal(validateAttemptEvidence({
    schema_version: "data-supply-detection-attempts/v1",
    attempts: shard.attempts,
  }), true);
  const row = shard.attempts[0];
  assert.deepEqual(Object.keys(row), [
    "lane_id",
    "member_id",
    "attempt_id",
    "observed_at",
    "execution",
    "exception_kind",
    "http_status",
    "auth",
    "rate_limited",
    "decode",
    "payload",
    "assertions",
  ]);
  assert.equal(row.lane_id, "treasury_tga");
  assert.equal(row.member_id, null);
  assert.equal(row.attempt_id, ATTEMPT_ID);
  assert.equal(row.observed_at, OBSERVED_AT);
  return row;
}

{
  let calls = 0;
  const { paths, result, shard } = await runCase(async (_url, accountType) => {
    const index = ACCOUNT_TYPES.indexOf(accountType);
    calls += 1;
    return response(200, rowsFor(accountType, index));
  });
  assert.equal(calls, 3);
  assert.equal(result.ok, true);
  assert.equal(result.reason, "ok");
  assert.equal(result.updated, true);
  assert.deepEqual(fs.readFileSync(paths.canonicalPath), fs.readFileSync(paths.publicPath));
  const output = readJson(paths.canonicalPath);
  assert.equal(output.source, "Treasury FiscalData");
  assert.equal(output.series.length, 1);
  assert.equal(output.series[0].date, "2026-07-11");
  assert.equal(output.raw.fra.length, 1);
  assert.equal(output.raw.tga.length, 1);
  assert.equal(output.raw.tgaOpening.length, 1);
  const row = assertShardShape(shard);
  assert.deepEqual(row, {
    lane_id: "treasury_tga",
    member_id: null,
    attempt_id: ATTEMPT_ID,
    observed_at: OBSERVED_AT,
    execution: "returned",
    exception_kind: null,
    http_status: 200,
    auth: "not_applicable",
    rate_limited: false,
    decode: "ok",
    payload: "non_empty",
    assertions: [{ id: "data_array", passed: true }],
  });
}

async function assertFailureCase({ failingResponse, expected, failingIndex = 1 }) {
  const { paths, result, shard } = await runCase(async (_url, accountType) => {
    const index = ACCOUNT_TYPES.indexOf(accountType);
    if (index === failingIndex) {
      if (failingResponse instanceof Error) throw failingResponse;
      return failingResponse;
    }
    return response(200, rowsFor(accountType, index));
  });
  assert.equal(result.ok, false);
  assert.equal(result.updated, false);
  assert.equal(result.reason, expected.reason);
  assert.equal(fs.existsSync(paths.canonicalPath), false);
  assert.equal(fs.existsSync(paths.publicPath), false);
  const row = assertShardShape(shard);
  for (const [key, value] of Object.entries(expected.row)) assert.deepEqual(row[key], value, key);
}

await assertFailureCase({
  failingResponse: response(429, { error: "rate limit" }),
  expected: {
    reason: "rate_limited",
    row: {
      execution: "returned",
      exception_kind: null,
      http_status: 429,
      auth: "not_applicable",
      rate_limited: true,
      decode: "not_attempted",
      payload: "not_available",
      assertions: [],
    },
  },
});

{
  const { result, shard } = await runCase(async (_url, accountType) => {
    const index = ACCOUNT_TYPES.indexOf(accountType);
    if (index === 0) return response(200, { data: {} });
    if (index === 2) return response(429, { error: "rate limit" });
    return response(200, rowsFor(accountType, index));
  });
  assert.equal(result.reason, "rate_limited", "unavailable must outrank drift");
  const row = assertShardShape(shard);
  assert.equal(row.http_status, 429);
}

await assertFailureCase({
  failingResponse: response(401, { error: "unauthorized" }),
  expected: {
    reason: "auth_error",
    row: {
      execution: "returned",
      exception_kind: null,
      http_status: 401,
      auth: "rejected",
      rate_limited: false,
      decode: "not_attempted",
      payload: "not_available",
      assertions: [],
    },
  },
});

await assertFailureCase({
  failingResponse: response(200, "{not-json"),
  expected: {
    reason: "decode_error",
    row: {
      execution: "returned",
      http_status: 200,
      auth: "not_applicable",
      rate_limited: false,
      decode: "error",
      payload: "not_available",
      assertions: [],
    },
  },
});

await assertFailureCase({
  failingResponse: response(200, { data: [] }),
  expected: {
    reason: "empty_payload",
    row: {
      execution: "returned",
      http_status: 200,
      auth: "not_applicable",
      rate_limited: false,
      decode: "ok",
      payload: "empty",
      assertions: [],
    },
  },
});

await assertFailureCase({
  failingResponse: response(200, { data: {} }),
  expected: {
    reason: "schema_drift",
    row: {
      execution: "returned",
      http_status: 200,
      auth: "not_applicable",
      rate_limited: false,
      decode: "ok",
      payload: "non_empty",
      assertions: [{ id: "data_array", passed: false }],
    },
  },
});

await assertFailureCase({
  failingResponse: Object.assign(new Error("socket reset"), { code: "ECONNRESET" }),
  expected: {
    reason: "transport_error",
    row: {
      execution: "threw",
      exception_kind: "transport",
      http_status: null,
      auth: "not_applicable",
      rate_limited: false,
      decode: "not_attempted",
      payload: "not_available",
      assertions: [],
    },
  },
});

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-tga-lkg-test-"));
  const paths = makePaths(root);
  fs.mkdirSync(path.dirname(paths.canonicalPath), { recursive: true });
  fs.mkdirSync(path.dirname(paths.publicPath), { recursive: true });
  const lkg = `${JSON.stringify({ source: "Treasury FiscalData", marker: "lkg" }, null, 2)}\n`;
  fs.writeFileSync(paths.canonicalPath, lkg);
  fs.writeFileSync(paths.publicPath, lkg);
  const result = await runTreasuryTga({
    ...paths,
    request: async (_url, accountType) => accountType === ACCOUNT_TYPES[2]
      ? response(500, { error: "upstream" })
      : response(200, rowsFor(accountType)),
    observedAt: OBSERVED_AT,
    attemptId: ATTEMPT_ID,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "http_error");
  assert.equal(fs.readFileSync(paths.canonicalPath, "utf8"), lkg);
  assert.equal(fs.readFileSync(paths.publicPath, "utf8"), lkg);
  assert.equal(readJson(paths.attemptShardPath).attempts[0].http_status, 500);
}

{
  const workflow = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "fetch-treasury-tga.yml"), "utf8");
  assert.match(workflow, /node scripts\/fetch-treasury-tga\.mjs/);
  assert.doesNotMatch(workflow, /node << ['"]?EOF/);
  assert.match(workflow, /data\/admin\/data-supply-state\/detection-attempts\/treasury_tga\.json/);
  assert.doesNotMatch(workflow, /data-supply-detection-floor\.json/);
  assert.match(workflow, /- name: Commit and push\n\s+if: \$\{\{ always\(\) \}\}/);
}

console.log("test-fetch-treasury-tga: ok");
