#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateAttemptShard } from "./build-data-supply-detection-floor.mjs";
import { emitKrxAttempt } from "./emit-fenok-krx-attempt.mjs";
import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";
import { registryLaneById } from "./lib/lane-registry.mjs";

const LANE_ID = "krx";
const WORKFLOW = ".github/workflows/fenok-edge-krx-daily.yml";

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function successBridge() {
  return {
    schema_version: "fenok-edge-korea-krx-bridge/v1",
    generated_at: "2026-07-20T10:31:00.000Z",
    source: "KRX_OPEN_API",
    market: "Korea",
    raw_public: false,
    as_of: "2026-07-17",
    freshness: {
      as_of: "2026-07-17",
      source_date_min: "2026-07-17",
      source_date_max: "2026-07-17",
    },
    latest_run: {
      run_id: "krx_daily_20260717",
      attempted_call_count: 31,
      summary: {
        total_files: 31,
        success_files: 31,
        empty_files: 0,
        failed_files: 0,
      },
    },
  };
}

const lane = registryLaneById(LANE_ID);
assert.ok(lane, "KRX must be registered before the producer can emit a valid shard");
assert.equal(lane.owner_workflow, WORKFLOW);
assert.equal(lane.enforcement, "shadow", "emitter-first: KRX stays shadow until a real committed shard lands");
assert.equal(lane.roots.admin_store, "data/admin/krx");
assert.equal(lane.roots.detection_attempt, "data/admin/data-supply-state/detection-attempts/krx.json");
assert.equal(lane.recovery_store, "data/admin/krx/index.json");
assert.equal(lane.kpi_recovery_shape, "general");
assert.ok(lane.commit_shards.includes("data/admin/data-supply-state/detection-attempts/krx.json"));
assert.ok(lane.commit_shards.includes("data/admin/krx/index.json"));
assert.ok(lane.commit_shards.includes("data/admin/krx/lkg/bridge.json"));

const configLane = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((row) => row.id === LANE_ID);
assert.ok(configLane, "KRX must enter the detection-floor denominator");
assert.equal(configLane.enforcement, "shadow");
assert.equal(configLane.kpi_required, false);
assert.deepEqual(configLane.producer_members[0].schedule, ["30 10 * * 1-5"]);
assert.equal(
  configLane.producer_members[0].artifact_contracts[0].path,
  "data/admin/fenok-edge-korea-krx-daily-index.json",
);
assert.equal(configLane.endpoint_contract.transport, "library");

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "krx-attempt-success-"));
  const bridgeIndexPath = path.join(root, "bridge.json");
  const attemptShardPath = path.join(root, "krx.json");
  writeJson(bridgeIndexPath, successBridge());

  const row = emitKrxAttempt({
    outcome: "success",
    bridgeIndexPath,
    attemptShardPath,
    attemptId: "gh-12345-1",
    observedAt: "2026-07-20T10:31:01.000Z",
  });
  const shard = JSON.parse(fs.readFileSync(attemptShardPath, "utf8"));
  assert.equal(validateAttemptShard(shard, LANE_ID), true);
  assert.equal(row.outcome, "success");
  assert.equal(row.candidates, 31);
  assert.equal(row.payload, "non_empty");
  assert.deepEqual(row.assertions, [
    { id: "krx_bridge_contract", passed: true },
  ]);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "krx-attempt-failure-"));
  const attemptShardPath = path.join(root, "krx.json");
  const row = emitKrxAttempt({
    outcome: "failure",
    bridgeIndexPath: path.join(root, "must-not-be-read.json"),
    attemptShardPath,
    attemptId: "gh-12346-1",
    observedAt: "2026-07-20T10:32:01.000Z",
  });
  const shard = JSON.parse(fs.readFileSync(attemptShardPath, "utf8"));
  assert.equal(validateAttemptShard(shard, LANE_ID), true);
  assert.equal(row.outcome, "error");
  assert.equal(row.candidates, 1);
  assert.equal(row.payload, "not_available");
  assert.deepEqual(row.assertions, []);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "krx-attempt-invalid-"));
  const bridgeIndexPath = path.join(root, "bridge.json");
  const attemptShardPath = path.join(root, "krx.json");
  writeJson(bridgeIndexPath, { ...successBridge(), as_of: null });
  assert.throws(
    () => emitKrxAttempt({
      outcome: "success",
      bridgeIndexPath,
      attemptShardPath,
      attemptId: "gh-12347-1",
      observedAt: "2026-07-20T10:33:01.000Z",
    }),
    /bridge contract/i,
  );
  assert.equal(fs.existsSync(attemptShardPath), false, "invalid success evidence must not publish a shard");
}

const workflowText = fs.readFileSync(new URL("../.github/workflows/fenok-edge-krx-daily.yml", import.meta.url), "utf8");
assert.match(workflowText, /id: krx_fetch/);
assert.match(workflowText, /controlled_failure:/);
assert.match(workflowText, /INPUT_CONTROLLED_FAILURE/);
assert.match(workflowText, /--controlled-failure/);
assert.match(workflowText, /steps\.krx_fetch\.outputs\.attempt_outcome \|\| steps\.krx_fetch\.outcome/);
assert.match(workflowText, /emit-fenok-krx-attempt\.mjs/);
assert.match(workflowText, /detection-attempts\/krx\.json/);
assert.match(workflowText, /if: \$\{\{ always\(\)/, "failure evidence must still reach the emitter/commit path");
assert.match(workflowText, /--stage always_if_exists/);
assert.match(workflowText, /--stage success_if_exists/);
assert.match(workflowText, /git add -- data\/admin\/krx\/index\.json/);
assert.match(workflowText, /git add -- data\/admin\/krx\/lkg\/bridge\.json/);
assert.match(workflowText, /if \[ "\$KRX_FETCH_OUTCOME" = "success" \]; then/);

console.log("test-emit-fenok-krx-attempt: ok");
