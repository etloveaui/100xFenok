#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";
import { validateAttemptEvidence, validateAttemptShard } from "./build-data-supply-detection-floor.mjs";
import {
  FRED_MACRO_SERIES,
  runFredMacro,
} from "./fetch-fred-macro.mjs";

const OBSERVED_AT = "2026-07-14T12:34:56.000Z";
const ATTEMPT_ID = "fred-macro-20260714t123456000z-test";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function expectedAssertionIds(laneId) {
  const lane = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((row) => row.id === laneId);
  return lane.endpoint_contract.assertions.map((assertion) => assertion.id);
}

function response(statusCode, payload) {
  return { statusCode, body: typeof payload === "string" ? payload : JSON.stringify(payload) };
}

function observations(seriesId) {
  return {
    observations: [
      { date: "2026-07-11", value: seriesId === "GDP" ? "29.1" : "5.25" },
    ],
  };
}

function makePaths(root) {
  return {
    canonicalPath: path.join(root, "data", "macro", "fred-macro.json"),
    publicPath: path.join(root, "public", "data", "macro", "fred-macro.json"),
    attemptShardPath: path.join(root, "data", "admin", "data-supply-state", "detection-attempts", "fred_macro.json"),
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertValidShard(shard) {
  assert.equal(validateAttemptShard(shard, shard.lane_id), true);
  assert.equal(validateAttemptEvidence({
    schema_version: "data-supply-detection-attempts/v1",
    attempts: shard.attempts,
  }), true);
}

async function runCase(request) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fred-macro-test-"));
  const paths = makePaths(root);
  const result = await runFredMacro({
    ...paths,
    apiKey: "test-key",
    request,
    observedAt: OBSERVED_AT,
    attemptId: ATTEMPT_ID,
    sleep: async () => {},
  });
  return { paths, result, shard: readJson(paths.attemptShardPath) };
}

{
  const calls = [];
  const { paths, result, shard } = await runCase(async (_url, seriesId) => {
    calls.push(seriesId);
    return response(200, observations(seriesId));
  });
  assert.deepEqual(calls, FRED_MACRO_SERIES.map((row) => row.id));
  assert.equal(result.ok, true);
  assert.deepEqual(fs.readFileSync(paths.canonicalPath), fs.readFileSync(paths.publicPath));
  const output = readJson(paths.canonicalPath);
  assert.deepEqual(Object.keys(output.series), FRED_MACRO_SERIES.map((row) => row.id));
  assert.equal(shard.schema_version, "data-supply-detection-attempt-shard/v1");
  assert.equal(shard.lane_id, "fred_macro");
  assert.equal(shard.attempts.length, 1);
  assertValidShard(shard);
  const row = shard.attempts[0];
  assert.equal(row.lane_id, "fred_macro");
  assert.equal(row.member_id, null);
  assert.equal(row.attempt_id, ATTEMPT_ID);
  assert.equal(row.observed_at, OBSERVED_AT);
  assert.equal(row.execution, "returned");
  assert.equal(row.http_status, 200);
  assert.equal(row.auth, "ok");
  assert.equal(row.decode, "ok");
  assert.equal(row.payload, "non_empty");
  assert.deepEqual(expectedAssertionIds("fred_macro"), ["observations_array"]);
  assert.deepEqual(row.assertions.map((assertion) => assertion.id), expectedAssertionIds("fred_macro"));
  assert.equal(row.assertions.every((assertion) => assertion.passed), true);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fred-macro-lkg-test-"));
  const paths = makePaths(root);
  fs.mkdirSync(path.dirname(paths.canonicalPath), { recursive: true });
  fs.mkdirSync(path.dirname(paths.publicPath), { recursive: true });
  const lkg = `${JSON.stringify({ marker: "lkg" }, null, 2)}\n`;
  fs.writeFileSync(paths.canonicalPath, lkg);
  fs.writeFileSync(paths.publicPath, lkg);
  const result = await runFredMacro({
    ...paths,
    apiKey: "test-key",
    request: async (_url, seriesId) => seriesId === "WALCL"
      ? response(429, { error: "rate limit" })
      : response(200, observations(seriesId)),
    observedAt: OBSERVED_AT,
    attemptId: ATTEMPT_ID,
    sleep: async () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "rate_limited");
  assert.equal(fs.readFileSync(paths.canonicalPath, "utf8"), lkg);
  assert.equal(fs.readFileSync(paths.publicPath, "utf8"), lkg);
  const shard = readJson(paths.attemptShardPath);
  assertValidShard(shard);
  const row = shard.attempts[0];
  assert.equal(row.http_status, 429);
  assert.equal(row.rate_limited, true);
  assert.deepEqual(row.assertions, []);
}

for (const failure of [
  {
    name: "auth",
    responseValue: response(401, { error: "unauthorized" }),
    expected: { reason: "auth_error", auth: "rejected", decode: "not_attempted", payload: "not_available" },
  },
  {
    name: "decode",
    responseValue: response(200, "{not-json"),
    expected: { reason: "decode_error", auth: "ok", decode: "error", payload: "not_available" },
  },
  {
    name: "empty",
    responseValue: response(200, { observations: [] }),
    expected: { reason: "empty_payload", auth: "ok", decode: "ok", payload: "empty" },
  },
  {
    name: "schema",
    responseValue: response(200, { observations: {} }),
    expected: { reason: "schema_drift", auth: "ok", decode: "ok", payload: "non_empty" },
  },
]) {
  const { result, shard } = await runCase(async (_url, seriesId) => seriesId === "WALCL"
    ? failure.responseValue
    : response(200, observations(seriesId)));
  assert.equal(result.reason, failure.expected.reason, failure.name);
  assertValidShard(shard);
  const row = shard.attempts[0];
  assert.equal(row.auth, failure.expected.auth, failure.name);
  assert.equal(row.decode, failure.expected.decode, failure.name);
  assert.equal(row.payload, failure.expected.payload, failure.name);
  if (failure.name === "schema") {
    assert.deepEqual(row.assertions, [{ id: "observations_array", passed: false }]);
  } else {
    assert.deepEqual(row.assertions, []);
  }
}

{
  const transport = Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
  const { result, shard } = await runCase(async (_url, seriesId) => {
    if (seriesId === "WALCL") throw transport;
    return response(200, observations(seriesId));
  });
  assert.equal(result.reason, "transport_error");
  assertValidShard(shard);
  assert.deepEqual(shard.attempts[0], {
    lane_id: "fred_macro",
    member_id: null,
    attempt_id: ATTEMPT_ID,
    observed_at: OBSERVED_AT,
    execution: "threw",
    exception_kind: "transport",
    http_status: null,
    auth: "not_applicable",
    rate_limited: false,
    decode: "not_attempted",
    payload: "not_available",
    assertions: [],
  });
}

{
  const workflow = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "fetch-fred-macro.yml"), "utf8");
  assert.match(workflow, /node scripts\/test-fetch-fred-macro\.mjs/);
  assert.match(workflow, /node scripts\/fetch-fred-macro\.mjs/);
  assert.doesNotMatch(workflow, /node << ['"]?EOF/);
  assert.match(workflow, /detection-attempts\/fred_macro\.json/);
  assert.match(workflow, /- name: Commit and push macro FRED data\n\s+if: \$\{\{ always\(\) \}\}/);
}

console.log("test-fetch-fred-macro: ok");
