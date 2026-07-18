#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";
import { validateAttemptEvidence, validateAttemptShard } from "./build-data-supply-detection-floor.mjs";
import {
  FDIC_PERSISTENCE_POLICY,
  MAX_QUARTERS,
  retainLatestQuarters,
  runFdicTier1,
} from "./fetch-fdic-tier1.mjs";

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
  assert.equal(MAX_QUARTERS, 80, "20 years preserves today's 2009-present history with a hard bound");
  assert.equal(FDIC_PERSISTENCE_POLICY.max_retained_quarters, MAX_QUARTERS);
  const quarterEnds = ["0331", "0630", "0930", "1231"];
  const allQuarters = Array.from({ length: MAX_QUARTERS + 1 }, (_, index) => {
    const year = 2016 + Math.floor(index / 4);
    return `${year}${quarterEnds[index % 4]}`;
  });
  const retained = retainLatestQuarters(allQuarters);
  assert.equal(retained.quarters.length, MAX_QUARTERS);
  assert.equal(retained.quarters.includes(allQuarters[0]), false, "oldest quarter is evicted first");
  assert.deepEqual(retained.persistence_state, {
    available_quarters: MAX_QUARTERS + 1,
    retained_quarters: MAX_QUARTERS,
    pruned_quarters: 1,
  });
  const retainedAgain = retainLatestQuarters(retained.quarters);
  assert.deepEqual(retainedAgain.quarters, retained.quarters, "quarter retention is idempotent");
  assert.equal(retainedAgain.persistence_state.pruned_quarters, 0);
  assert.throws(
    () => retainLatestQuarters(["20260231", ...allQuarters]),
    /invalid FDIC quarter identifier/,
    "malformed quarters fail closed even when they would fall outside the retained window",
  );
  assert.throws(() => retainLatestQuarters(["00000331", ...allQuarters]), /invalid FDIC quarter identifier/);
  assert.throws(
    () => retainLatestQuarters([allQuarters[0], ...allQuarters]),
    /duplicate FDIC quarter identifier/,
    "duplicates fail closed before oldest-quarter slicing",
  );
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fdic-tier1-retention-test-"));
  const paths = makePaths(root);
  const quarterEnds = ["0331", "0630", "0930", "1231"];
  const allQuarters = Array.from({ length: MAX_QUARTERS + 1 }, (_, index) => {
    const year = 2006 + Math.floor(index / 4);
    return `${year}${quarterEnds[index % 4]}`;
  });
  const calls = [];
  const result = await runFdicTier1({
    ...paths,
    quarters: allQuarters,
    request: async (_url, quarter) => {
      calls.push(quarter);
      return response(200, fdicRows(12));
    },
    observedAt: OBSERVED_AT,
    attemptId: `${ATTEMPT_ID}-retention`,
    sleep: async () => {},
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, MAX_QUARTERS);
  assert.equal(calls.includes(allQuarters[0]), false, "evicted quarters are not fetched or persisted");
  const output = readJson(paths.canonicalPath);
  assert.equal(output.data.length, MAX_QUARTERS);
  assert.deepEqual(output.persistence_state, {
    available_quarters: MAX_QUARTERS + 1,
    retained_quarters: MAX_QUARTERS,
    pruned_quarters: 1,
  });
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
  assert.deepEqual(output.persistence_policy, FDIC_PERSISTENCE_POLICY);
  assert.deepEqual(output.persistence_state, {
    available_quarters: QUARTERS.length,
    retained_quarters: QUARTERS.length,
    pruned_quarters: 0,
  });
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
  const data = [
    { date: "2025-12-31", value: 13, banks: 2 },
    { date: "2026-03-31", value: 15, banks: 2 },
  ];
  const state = {
    available_quarters: 2,
    retained_quarters: 2,
    pruned_quarters: 0,
  };
  const legacy = {
    updated: "2026-04-01T00:00:00.000Z",
    source: "FDIC",
    description: "Average Tier 1 Capital Ratio (RBC1AAJ)",
    data,
  };
  const metadataCases = [
    ["legacy", legacy, true],
    ["policy-without-state", { ...legacy, persistence_policy: FDIC_PERSISTENCE_POLICY }, false],
    ["state-without-policy", { ...legacy, persistence_state: state }, false],
    ["wrong-policy", {
      ...legacy,
      persistence_policy: { ...FDIC_PERSISTENCE_POLICY, max_retained_quarters: MAX_QUARTERS + 1 },
      persistence_state: state,
    }, false],
    ["extra-policy-key", {
      ...legacy,
      persistence_policy: { ...FDIC_PERSISTENCE_POLICY, extra: true },
      persistence_state: state,
    }, false],
    ["descending", {
      ...legacy,
      persistence_policy: FDIC_PERSISTENCE_POLICY,
      persistence_state: state,
      data: [...data].reverse(),
    }, false],
    ["duplicate-date", {
      ...legacy,
      persistence_policy: FDIC_PERSISTENCE_POLICY,
      persistence_state: state,
      data: [data[0], data[0]],
    }, false],
    ["bad-arithmetic", {
      ...legacy,
      persistence_policy: FDIC_PERSISTENCE_POLICY,
      persistence_state: { ...state, pruned_quarters: 1 },
    }, false],
  ];
  const overCapData = Array.from({ length: MAX_QUARTERS + 1 }, (_, index) => {
    const date = new Date(Date.UTC(2000, index * 3 + 2, 1));
    date.setUTCMonth(date.getUTCMonth() + 1, 0);
    return { date: date.toISOString().slice(0, 10), value: 13, banks: 2 };
  });
  metadataCases.push(["over-cap", {
    ...legacy,
    persistence_policy: FDIC_PERSISTENCE_POLICY,
    persistence_state: {
      available_quarters: overCapData.length,
      retained_quarters: overCapData.length,
      pruned_quarters: 0,
    },
    data: overCapData,
  }, false]);

  for (const [name, document, validLkg] of metadataCases) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `fetch-fdic-tier1-${name}-lkg-test-`));
    const paths = makePaths(root);
    fs.mkdirSync(path.dirname(paths.canonicalPath), { recursive: true });
    fs.writeFileSync(paths.canonicalPath, `${JSON.stringify(document, null, 2)}\n`);
    const result = await runFdicTier1({
      ...paths,
      quarters: QUARTERS,
      request: async (_url, quarter) => quarter === QUARTERS[1]
        ? response(500, { error: "upstream" })
        : response(200, fdicRows(12)),
      observedAt: OBSERVED_AT,
      attemptId: `${ATTEMPT_ID}-${name}`,
      sleep: async () => {},
    });
    assert.equal(result.degraded, validLkg, `${name} LKG validity`);
    assert.equal(result.exitCode, validLkg ? 0 : 2, `${name} LKG exit code`);
  }
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
    eventName: "schedule",
    observedAt: "2026-07-14T13:00:00.000Z",
    attemptId: "fdic-tier1-same-source",
    runId: "same-source-run",
    sleep: async () => {},
  });
  assert.equal(notAdvanced.reason, "recovery_not_advanced_by_provider");
  assert.equal(notAdvanced.degraded, true);
  assert.equal(readJson(statePath).items.fdic_tier1.resolution_state, "lkg_primary");

  const advancedQuarters = [...QUARTERS, "20260630"];
  const manualAdvanced = await runFdicTier1({
    ...paths,
    quarters: advancedQuarters,
    request: async (_url, quarter) => response(200, fdicRows(quarter === "20260630" ? 16 : 14)),
    eventName: "workflow_dispatch",
    observedAt: "2026-07-14T14:00:00.000Z",
    attemptId: "fdic-tier1-manual-advanced",
    runId: "manual-advanced-run",
    sleep: async () => {},
  });
  assert.equal(manualAdvanced.ok, false);
  assert.equal(manualAdvanced.degraded, true);
  assert.equal(manualAdvanced.reason, "recovery_requires_schedule");
  assert.equal(readJson(statePath).items.fdic_tier1.resolution_state, "lkg_primary");
  assert.equal(readJson(paths.canonicalPath).data.at(-1).date, "2026-03-31", "manual recovery candidate must not overwrite canonical payload");

  const recovered = await runFdicTier1({
    ...paths,
    quarters: advancedQuarters,
    request: async (_url, quarter) => response(200, fdicRows(quarter === "20260630" ? 16 : 14)),
    eventName: "schedule",
    observedAt: "2026-07-14T14:30:00.000Z",
    attemptId: "fdic-tier1-scheduled-recovery",
    runId: "scheduled-recovery-run",
    sleep: async () => {},
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.recovered, true);
  const recoveredState = readJson(statePath);
  assert.deepEqual(recoveredState.retry_set, []);
  assert.equal(recoveredState.items.fdic_tier1.resolution_state, "fresh_primary");
  assert.equal(recoveredState.items.fdic_tier1.promotion_contract, "provider_observation/v2");
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
