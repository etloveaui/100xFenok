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

function observations(seriesId, date = "2026-07-11") {
  return {
    observations: [
      { date, value: seriesId === "GDP" ? "29.1" : "5.25" },
    ],
  };
}

function makePaths(root) {
  return {
    repoRoot: root,
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
  await runFredMacro({
    ...paths,
    apiKey: "test-key",
    request: async (_url, seriesId) => response(200, observations(seriesId)),
    observedAt: "2026-07-14T11:00:00.000Z",
    attemptId: "fred-macro-baseline",
    runId: "baseline",
    sleep: async () => {},
  });
  const canonicalBefore = fs.readFileSync(paths.canonicalPath, "utf8");
  const result = await runFredMacro({
    ...paths,
    apiKey: "test-key",
    request: async (_url, seriesId) => seriesId === "WALCL"
      ? response(429, { error: "rate limit" })
      : response(200, observations(seriesId)),
    observedAt: OBSERVED_AT,
    attemptId: ATTEMPT_ID,
    runId: "systemic-rate-limit",
    sleep: async () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "rate_limited");
  assert.equal(result.exitCode, 2, "systemic failure remains fatal even with LKG");
  assert.equal(result.corrupt, true);
  assert.equal(fs.readFileSync(paths.canonicalPath, "utf8"), canonicalBefore);
  assert.equal(fs.readFileSync(paths.publicPath, "utf8"), canonicalBefore);
  const shard = readJson(paths.attemptShardPath);
  assertValidShard(shard);
  const row = shard.attempts[0];
  assert.equal(row.http_status, 429);
  assert.equal(row.rate_limited, true);
  assert.deepEqual(row.assertions, []);

  const maskedSystemic = await runFredMacro({
    ...paths,
    apiKey: "test-key",
    request: async (_url, seriesId) => {
      if (seriesId === "M2SL") return response(500, { error: "upstream" });
      if (seriesId === "WALCL") return response(401, { error: "unauthorized" });
      return response(200, observations(seriesId));
    },
    observedAt: "2026-07-14T12:45:00.000Z",
    attemptId: "fred-macro-masked-systemic",
    runId: "masked-systemic",
    sleep: async () => {},
  });
  assert.equal(maskedSystemic.reason, "auth_error", "systemic failure cannot hide behind the first equal-severity HTTP failure");
  assert.equal(maskedSystemic.exitCode, 2);
  assert.equal(readJson(paths.attemptShardPath).attempts[0].http_status, 500, "existing current-attempt fold remains unchanged");

  const systemicOutage = await runFredMacro({
    ...paths,
    apiKey: "test-key",
    request: async () => response(500, { error: "upstream" }),
    observedAt: "2026-07-14T12:50:00.000Z",
    attemptId: "fred-macro-systemic-http-outage",
    runId: "systemic-http-outage",
    sleep: async () => {},
  });
  assert.equal(systemicOutage.reason, "http_error");
  assert.equal(systemicOutage.exitCode, 2, "all-request HTTP outage is systemic even with valid LKG");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fred-macro-chaos-test-"));
  const paths = makePaths(root);
  await runFredMacro({
    ...paths,
    apiKey: "test-key",
    request: async (_url, seriesId) => response(200, observations(seriesId)),
    observedAt: "2026-07-14T11:00:00.000Z",
    attemptId: "fred-macro-chaos-baseline",
    runId: "baseline-run",
    sleep: async () => {},
  });
  const failed = await runFredMacro({
    ...paths,
    apiKey: "test-key",
    request: async (_url, seriesId) => response(200, observations(seriesId)),
    controlledFailureKey: "WALCL",
    eventName: "workflow_dispatch",
    observedAt: "2026-07-14T12:00:00.000Z",
    attemptId: "fred-macro-controlled-failure",
    runId: "controlled-failure-run",
    sleep: async () => {},
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.degraded, true);
  assert.equal(failed.exitCode, 0);
  assert.deepEqual(failed.retrySet, ["fred_macro"]);
  const statePath = path.join(root, "data", "admin", "fred_macro", "index.json");
  const lkgPath = path.join(root, "data", "admin", "fred_macro", "lkg", "fred_macro.json");
  assert.equal(fs.existsSync(lkgPath), true);
  assert.equal(readJson(statePath).items.fred_macro.resolution_state, "lkg_primary");

  const notAdvanced = await runFredMacro({
    ...paths,
    apiKey: "test-key",
    request: async (_url, seriesId) => response(200, observations(seriesId)),
    eventName: "schedule",
    observedAt: "2026-07-14T13:00:00.000Z",
    attemptId: "fred-macro-same-source",
    runId: "same-source-run",
    sleep: async () => {},
  });
  assert.equal(notAdvanced.reason, "recovery_not_advanced_by_provider");
  assert.equal(notAdvanced.degraded, true);
  assert.equal(readJson(statePath).items.fred_macro.resolution_state, "lkg_primary");

  const manualAdvanced = await runFredMacro({
    ...paths,
    apiKey: "test-key",
    request: async (_url, seriesId) => response(200, observations(seriesId, "2026-07-12")),
    eventName: "workflow_dispatch",
    observedAt: "2026-07-14T14:00:00.000Z",
    attemptId: "fred-macro-manual-advanced",
    runId: "manual-advanced-run",
    sleep: async () => {},
  });
  assert.equal(manualAdvanced.ok, false);
  assert.equal(manualAdvanced.degraded, true);
  assert.equal(manualAdvanced.reason, "recovery_requires_schedule");
  assert.equal(readJson(statePath).items.fred_macro.resolution_state, "lkg_primary");
  assert.equal(readJson(paths.canonicalPath).series.M2SL.at(-1).date, "2026-07-11", "manual recovery candidate must not overwrite canonical payload");

  const recovered = await runFredMacro({
    ...paths,
    apiKey: "test-key",
    request: async (_url, seriesId) => response(200, observations(seriesId, "2026-07-12")),
    eventName: "schedule",
    observedAt: "2026-07-14T14:30:00.000Z",
    attemptId: "fred-macro-scheduled-recovery",
    runId: "scheduled-recovery-run",
    sleep: async () => {},
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.recovered, true);
  const recoveredState = readJson(statePath);
  assert.deepEqual(recoveredState.retry_set, []);
  assert.equal(recoveredState.items.fred_macro.resolution_state, "fresh_primary");
  assert.equal(recoveredState.items.fred_macro.promotion_contract, "provider_observation/v2");
  assert.equal(recoveredState.items.fred_macro.recovered_from_run_id, "controlled-failure-run");

  await assert.rejects(() => runFredMacro({
    ...paths,
    apiKey: "test-key",
    request: async (_url, seriesId) => response(200, observations(seriesId)),
    controlledFailureKey: "WALCL",
    eventName: "schedule",
    observedAt: "2026-07-14T15:00:00.000Z",
    attemptId: "fred-macro-invalid-chaos",
    runId: "invalid-chaos",
    sleep: async () => {},
  }), /workflow_dispatch/);
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
  assert.doesNotMatch(workflow, /git add -A/);
  assert.match(workflow, /detection-attempts\/fred_macro\.json/);
  assert.match(workflow, /controlled_failure_key/);
  assert.match(workflow, /INPUT_CONTROLLED_FAILURE_KEY/);
  assert.match(workflow, /data\/admin\/fred_macro\/index\.json/);
  assert.match(workflow, /data\/admin\/fred_macro\/lkg\/fred_macro\.json/);
  assert.match(workflow, /- name: Commit and push macro FRED data\n\s+if: \$\{\{ always\(\) \}\}/);
}

console.log("test-fetch-fred-macro: ok");
