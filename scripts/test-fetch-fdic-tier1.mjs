#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";
import { validateAttemptEvidence, validateAttemptShard } from "./build-data-supply-detection-floor.mjs";
import { runFdicTier1 } from "./fetch-fdic-tier1.mjs";

const OBSERVED_AT = "2026-07-14T12:34:56.000Z";
const ATTEMPT_ID = "fdic-tier1-20260714t123456000z-test";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const QUARTERS = ["20251231", "20260331"];

function expectedAssertionIds(laneId) {
  const lane = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((row) => row.id === laneId);
  return lane.endpoint_contract.assertions.map((assertion) => assertion.id);
}

function response(statusCode, payload) {
  return { statusCode, body: typeof payload === "string" ? payload : JSON.stringify(payload) };
}

function fdicRows(value) {
  return { data: [{ data: { RBC1AAJ: value } }, { data: { RBC1AAJ: value + 2 } }] };
}

function makePaths(root) {
  return {
    repoRoot: root,
    canonicalPath: path.join(root, "data", "macro", "fdic-tier1.json"),
    publicPath: path.join(root, "public", "data", "macro", "fdic-tier1.json"),
    attemptShardPath: path.join(root, "data", "admin", "data-supply-state", "detection-attempts", "fdic_tier1.json"),
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

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fdic-tier1-test-"));
  const paths = makePaths(root);
  const calls = [];
  const result = await runFdicTier1({
    ...paths,
    quarters: QUARTERS,
    request: async (_url, quarter) => {
      calls.push(quarter);
      return response(200, fdicRows(quarter === QUARTERS[0] ? 12 : 14));
    },
    observedAt: OBSERVED_AT,
    attemptId: ATTEMPT_ID,
    sleep: async () => {},
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, QUARTERS);
  assert.deepEqual(fs.readFileSync(paths.canonicalPath), fs.readFileSync(paths.publicPath));
  const output = readJson(paths.canonicalPath);
  assert.equal(output.source, "FDIC");
  assert.deepEqual(output.data.map((row) => row.value), [13, 15]);
  const shard = readJson(paths.attemptShardPath);
  assertValidShard(shard);
  const row = shard.attempts[0];
  assert.equal(row.lane_id, "fdic_tier1");
  assert.equal(row.member_id, null);
  assert.equal(row.http_status, 200);
  assert.deepEqual(expectedAssertionIds("fdic_tier1"), ["bank_data_array"]);
  assert.deepEqual(row.assertions.map((assertion) => assertion.id), expectedAssertionIds("fdic_tier1"));
  assert.equal(row.assertions.every((assertion) => assertion.passed), true);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fdic-tier1-lkg-test-"));
  const paths = makePaths(root);
  fs.mkdirSync(path.dirname(paths.canonicalPath), { recursive: true });
  fs.mkdirSync(path.dirname(paths.publicPath), { recursive: true });
  const lkg = `${JSON.stringify({ marker: "lkg" }, null, 2)}\n`;
  fs.writeFileSync(paths.canonicalPath, lkg);
  fs.writeFileSync(paths.publicPath, lkg);
  const result = await runFdicTier1({
    ...paths,
    quarters: QUARTERS,
    request: async (_url, quarter) => quarter === QUARTERS[1]
      ? response(500, { error: "upstream" })
      : response(200, fdicRows(12)),
    observedAt: OBSERVED_AT,
    attemptId: ATTEMPT_ID,
    sleep: async () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "http_error");
  assert.equal(result.exitCode, 2, "a transient failure without a valid canonical LKG is fatal");
  assert.equal(fs.readFileSync(paths.canonicalPath, "utf8"), lkg);
  assert.equal(fs.readFileSync(paths.publicPath, "utf8"), lkg);
  const shard = readJson(paths.attemptShardPath);
  assertValidShard(shard);
  assert.equal(shard.attempts[0].http_status, 500);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fdic-tier1-chaos-test-"));
  const paths = makePaths(root);
  await runFdicTier1({
    ...paths,
    quarters: QUARTERS,
    request: async (_url, quarter) => response(200, fdicRows(quarter === QUARTERS[0] ? 12 : 14)),
    observedAt: "2026-07-14T11:00:00.000Z",
    attemptId: "fdic-tier1-baseline",
    runId: "baseline-run",
    sleep: async () => {},
  });
  const failed = await runFdicTier1({
    ...paths,
    quarters: QUARTERS,
    request: async (_url, quarter) => response(200, fdicRows(quarter === QUARTERS[0] ? 12 : 14)),
    controlledFailureKey: "latest",
    eventName: "workflow_dispatch",
    observedAt: "2026-07-14T12:00:00.000Z",
    attemptId: "fdic-tier1-controlled-failure",
    runId: "controlled-failure-run",
    sleep: async () => {},
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.degraded, true);
  assert.equal(failed.exitCode, 0);
  assert.deepEqual(failed.retrySet, ["fdic_tier1"]);
  const statePath = path.join(root, "data", "admin", "fdic_tier1", "index.json");
  const lkgPath = path.join(root, "data", "admin", "fdic_tier1", "lkg", "fdic_tier1.json");
  assert.equal(fs.existsSync(lkgPath), true);
  assert.equal(readJson(statePath).items.fdic_tier1.resolution_state, "lkg_primary");

  const notAdvanced = await runFdicTier1({
    ...paths,
    quarters: QUARTERS,
    request: async (_url, quarter) => response(200, fdicRows(quarter === QUARTERS[0] ? 12 : 14)),
    eventName: "workflow_dispatch",
    observedAt: "2026-07-14T13:00:00.000Z",
    attemptId: "fdic-tier1-same-source",
    runId: "same-source-run",
    sleep: async () => {},
  });
  assert.equal(notAdvanced.reason, "recovery_not_advanced");
  assert.equal(notAdvanced.degraded, true);
  assert.equal(readJson(statePath).items.fdic_tier1.resolution_state, "lkg_primary");

  const advancedQuarters = [...QUARTERS, "20260630"];
  const recovered = await runFdicTier1({
    ...paths,
    quarters: advancedQuarters,
    request: async (_url, quarter) => response(200, fdicRows(quarter === "20260630" ? 16 : 14)),
    eventName: "workflow_dispatch",
    observedAt: "2026-07-14T14:00:00.000Z",
    attemptId: "fdic-tier1-recovery",
    runId: "recovery-run",
    sleep: async () => {},
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.recovered, true);
  const recoveredState = readJson(statePath);
  assert.deepEqual(recoveredState.retry_set, []);
  assert.equal(recoveredState.items.fdic_tier1.resolution_state, "fresh_primary");
  assert.equal(recoveredState.items.fdic_tier1.recovered_from_run_id, "controlled-failure-run");

  await assert.rejects(() => runFdicTier1({
    ...paths,
    quarters: QUARTERS,
    request: async (_url, quarter) => response(200, fdicRows(12)),
    controlledFailureKey: "latest",
    eventName: "schedule",
    observedAt: "2026-07-14T15:00:00.000Z",
    attemptId: "fdic-tier1-invalid-chaos",
    runId: "invalid-chaos",
    sleep: async () => {},
  }), /workflow_dispatch/);
}

{
  const workflow = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "fetch-fdic.yml"), "utf8");
  assert.match(workflow, /node scripts\/test-fetch-fdic-tier1\.mjs/);
  assert.match(workflow, /node scripts\/fetch-fdic-tier1\.mjs/);
  assert.doesNotMatch(workflow, /node << ['"]?EOF/);
  assert.doesNotMatch(workflow, /git add -A/);
  assert.match(workflow, /detection-attempts\/fdic_tier1\.json/);
  assert.match(workflow, /controlled_failure_key/);
  assert.match(workflow, /INPUT_CONTROLLED_FAILURE_KEY/);
  assert.match(workflow, /data\/admin\/fdic_tier1\/index\.json/);
  assert.match(workflow, /data\/admin\/fdic_tier1\/lkg\/fdic_tier1\.json/);
  assert.match(workflow, /- name: Commit and push\n\s+if: \$\{\{ always\(\) \}\}/);
}

console.log("test-fetch-fdic-tier1: ok");
