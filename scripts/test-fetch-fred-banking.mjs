#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";
import { validateAttemptEvidence, validateAttemptShard } from "./build-data-supply-detection-floor.mjs";
import {
  FRED_BANKING_GROUPS,
  runFredBanking,
} from "./fetch-fred-banking.mjs";
import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

const OBSERVED_AT = "2026-07-14T12:34:56.000Z";
const ATTEMPT_ID = "fred-banking-20260714t123456000z-test";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function expectedAssertionIds(laneId) {
  const lane = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((row) => row.id === laneId);
  return lane.endpoint_contract.assertions.map((assertion) => assertion.id);
}

function response(statusCode, payload) {
  return { statusCode, body: typeof payload === "string" ? payload : JSON.stringify(payload) };
}

function observations(seriesId, date = "2026-07-11") {
  return { observations: [{ date, value: seriesId.length.toString() }] };
}

function makePaths(root) {
  const canonical = {};
  const publicPaths = {};
  for (const group of FRED_BANKING_GROUPS) {
    canonical[group.id] = path.join(root, "data", "macro", `fred-banking-${group.id}.json`);
    publicPaths[group.id] = path.join(root, "public", "data", "macro", `fred-banking-${group.id}.json`);
  }
  return {
    repoRoot: root,
    canonicalPaths: canonical,
    publicPaths,
    attemptShardPath: path.join(root, "data", "admin", "data-supply-state", "detection-attempts", "fred_banking.json"),
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
  assert.deepEqual(FRED_BANKING_GROUPS.map((group) => group.id), ["daily", "weekly", "monthly", "quarterly"]);
  assert.deepEqual(FRED_BANKING_GROUPS.find((group) => group.id === "daily").series.map((row) => row.id), [
    "DGS10",
    "BAMLH0A0HYM2",
    "IRLTLT01KRM156N",
  ]);
  assert.deepEqual(FRED_BANKING_GROUPS.find((group) => group.id === "monthly").series.map((row) => row.id), [
    "IRLTLT01KRM156N",
  ]);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fred-banking-test-"));
  const paths = makePaths(root);
  const calls = [];
  const result = await runFredBanking({
    ...paths,
    apiKey: "test-key",
    request: async (_url, seriesId) => {
      calls.push(seriesId);
      return response(200, observations(seriesId));
    },
    observedAt: OBSERVED_AT,
    attemptId: ATTEMPT_ID,
    sleep: async () => {},
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, FRED_BANKING_GROUPS.flatMap((group) => group.series.map((row) => row.id)));
  for (const group of FRED_BANKING_GROUPS) {
    assert.deepEqual(fs.readFileSync(paths.canonicalPaths[group.id]), fs.readFileSync(paths.publicPaths[group.id]));
    assert.equal(readJson(paths.canonicalPaths[group.id]).type, group.id);
  }
  const shard = readJson(paths.attemptShardPath);
  assertValidShard(shard);
  assert.equal(shard.lane_id, "fred_banking");
  assert.equal(shard.attempts.length, 1, "four cadence artifacts still emit one lane attempt");
  const row = shard.attempts[0];
  assert.equal(row.member_id, null);
  assert.equal(row.http_status, 200);
  assert.equal(row.auth, "ok");
  assert.deepEqual(expectedAssertionIds("fred_banking"), ["observations_array"]);
  assert.deepEqual(row.assertions.map((assertion) => assertion.id), expectedAssertionIds("fred_banking"));
  assert.equal(row.assertions.every((assertion) => assertion.passed), true);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fred-banking-worst-test-"));
  const paths = makePaths(root);
  for (const group of FRED_BANKING_GROUPS) {
    fs.mkdirSync(path.dirname(paths.canonicalPaths[group.id]), { recursive: true });
    fs.mkdirSync(path.dirname(paths.publicPaths[group.id]), { recursive: true });
    fs.writeFileSync(paths.canonicalPaths[group.id], `${JSON.stringify({ marker: `lkg-${group.id}` })}\n`);
    fs.writeFileSync(paths.publicPaths[group.id], `${JSON.stringify({ marker: `lkg-${group.id}` })}\n`);
  }
  const result = await runFredBanking({
    ...paths,
    apiKey: "test-key",
    request: async (_url, seriesId) => {
      if (seriesId === "DGS10") return response(200, { observations: {} });
      if (seriesId === "DPSACBW027SBOG") return response(429, { error: "rate limit" });
      return response(200, observations(seriesId));
    },
    observedAt: OBSERVED_AT,
    attemptId: ATTEMPT_ID,
    sleep: async () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "rate_limited", "unavailable must outrank drift");
  assert.equal(result.exitCode, 2, "systemic failure with invalid canonical artifacts is fatal");
  const shard = readJson(paths.attemptShardPath);
  assertValidShard(shard);
  const row = shard.attempts[0];
  assert.equal(row.http_status, 429);
  assert.equal(row.rate_limited, true);
  for (const group of FRED_BANKING_GROUPS) {
    assert.equal(readJson(paths.canonicalPaths[group.id]).marker, `lkg-${group.id}`);
    assert.equal(readJson(paths.publicPaths[group.id]).marker, `lkg-${group.id}`);
  }
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fred-banking-source-binding-test-"));
  const paths = makePaths(root);
  await runFredBanking({
    ...paths,
    type: "daily",
    apiKey: "test-key",
    request: async (_url, seriesId) => response(200, observations(seriesId)),
    observedAt: "2026-07-14T11:00:00.000Z",
    attemptId: "fred-banking-binding-baseline",
    runId: "binding-baseline",
    sleep: async () => {},
  });
  const tampered = readJson(paths.canonicalPaths.daily);
  tampered.source_as_of = "2026-07-10";
  fs.writeFileSync(paths.canonicalPaths.daily, `${JSON.stringify(tampered, null, 2)}\n`);
  const failed = await runFredBanking({
    ...paths,
    type: "daily",
    apiKey: "test-key",
    request: async (_url, seriesId) => response(200, observations(seriesId)),
    controlledFailureKey: "DGS10",
    eventName: "workflow_dispatch",
    observedAt: "2026-07-14T12:00:00.000Z",
    attemptId: "fred-banking-binding-failure",
    runId: "binding-failure",
    sleep: async () => {},
  });
  assert.equal(failed.exitCode, 2, "declared source_as_of must match the payload series boundary before becoming LKG");
  assert.equal(failed.corrupt, true);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fred-banking-chaos-test-"));
  const paths = makePaths(root);
  await runFredBanking({
    ...paths,
    apiKey: "test-key",
    request: async (_url, seriesId) => response(200, observations(seriesId)),
    observedAt: "2026-07-14T11:00:00.000Z",
    attemptId: "fred-banking-baseline",
    runId: "baseline-run",
    sleep: async () => {},
  });
  const failed = await runFredBanking({
    ...paths,
    apiKey: "test-key",
    request: async (_url, seriesId) => response(200, observations(seriesId)),
    controlledFailureKey: "DGS10",
    eventName: "workflow_dispatch",
    observedAt: "2026-07-14T12:00:00.000Z",
    attemptId: "fred-banking-controlled-failure",
    runId: "controlled-failure-run",
    sleep: async () => {},
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.degraded, true);
  assert.equal(failed.exitCode, 0);
  assert.deepEqual(failed.retrySet, [
    "daily",
    "monthly",
    "quarterly",
    "weekly",
  ]);
  const statePath = path.join(root, "data", "admin", "fred_banking", "index.json");
  const state = readJson(statePath);
  assert.equal(state.items.daily.resolution_state, "lkg_primary");
  for (const key of failed.retrySet) {
    assert.equal(fs.existsSync(path.join(root, "data", "admin", "fred_banking", "lkg", `${key}.json`)), true);
  }

  const dailySeries = new Set(FRED_BANKING_GROUPS.find((group) => group.id === "daily").series.map((item) => item.id));
  const partial = await runFredBanking({
    ...paths,
    apiKey: "test-key",
    request: async (_url, seriesId) => response(200, observations(seriesId, dailySeries.has(seriesId) ? "2026-07-12" : "2026-07-11")),
    eventName: "workflow_dispatch",
    observedAt: "2026-07-14T12:30:00.000Z",
    attemptId: "fred-banking-partial-recovery",
    runId: "partial-recovery-run",
    sleep: async () => {},
  });
  assert.equal(partial.ok, false);
  assert.equal(partial.degraded, true);
  assert.equal(partial.updated, false);
  assert.equal(partial.reason, "recovery_requires_schedule");
  assert.deepEqual(partial.retrySet, ["daily", "monthly", "quarterly", "weekly"]);
  const partialState = readJson(statePath);
  assert.equal(partialState.items.daily.resolution_state, "lkg_primary");
  assert.equal(partialState.items.monthly.resolution_state, "lkg_primary");
  assert.equal(partialState.items.weekly.resolution_state, "lkg_primary");
  assert.equal(partialState.items.quarterly.resolution_state, "lkg_primary");
  assert.equal(readJson(paths.canonicalPaths.daily).source_as_of, "2026-07-11", "manual recovery candidate must not overwrite canonical payload");

  const scheduledPartial = await runFredBanking({
    ...paths,
    apiKey: "test-key",
    request: async (_url, seriesId) => response(200, observations(seriesId, dailySeries.has(seriesId) ? "2026-07-12" : "2026-07-11")),
    eventName: "schedule",
    observedAt: "2026-07-14T12:45:00.000Z",
    attemptId: "fred-banking-scheduled-partial-recovery",
    runId: "scheduled-partial-recovery-run",
    sleep: async () => {},
  });
  assert.equal(scheduledPartial.ok, false);
  assert.equal(scheduledPartial.degraded, true);
  assert.equal(scheduledPartial.updated, true);
  assert.equal(scheduledPartial.recovered, true);
  assert.deepEqual(scheduledPartial.retrySet, ["quarterly", "weekly"]);
  const scheduledPartialState = readJson(statePath);
  assert.equal(scheduledPartialState.items.daily.resolution_state, "fresh_primary");
  assert.equal(scheduledPartialState.items.daily.recovered_from_run_id, "controlled-failure-run");
  assert.equal(scheduledPartialState.items.monthly.resolution_state, "fresh_primary");
  assert.equal(scheduledPartialState.items.monthly.recovered_from_run_id, "controlled-failure-run");

  const recovered = await runFredBanking({
    ...paths,
    apiKey: "test-key",
    request: async (_url, seriesId) => response(200, observations(seriesId, "2026-07-12")),
    eventName: "schedule",
    observedAt: "2026-07-14T13:00:00.000Z",
    attemptId: "fred-banking-recovery",
    runId: "recovery-run",
    sleep: async () => {},
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.recovered, true);
  const recoveredState = readJson(statePath);
  assert.deepEqual(recoveredState.retry_set, []);
  for (const key of failed.retrySet) {
    assert.equal(recoveredState.items[key].resolution_state, "fresh_primary");
    assert.equal(recoveredState.items[key].promotion_contract, "provider_observation/v2");
    assert.equal(recoveredState.items[key].recovered_from_run_id, "controlled-failure-run");
  }

  await assert.rejects(() => runFredBanking({
    ...paths,
    apiKey: "test-key",
    request: async (_url, seriesId) => response(200, observations(seriesId)),
    controlledFailureKey: "DGS10",
    eventName: "schedule",
    observedAt: "2026-07-14T14:00:00.000Z",
    attemptId: "fred-banking-invalid-chaos",
    runId: "invalid-chaos",
    sleep: async () => {},
  }), /workflow_dispatch/);
}

{
  const workflow = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "fetch-fred-banking.yml"), "utf8");
  assert.match(workflow, /node scripts\/test-fetch-fred-banking\.mjs/);
  assert.match(workflow, /node scripts\/fetch-fred-banking\.mjs/);
  assert.doesNotMatch(workflow, /node << ['"]?EOF/);
  assert.doesNotMatch(workflow, /git add -A/);
  assert.match(workflow, /detection-attempts\/fred_banking\.json/);
  assert.match(workflow, /controlled_failure_key/);
  assert.match(workflow, /INPUT_CONTROLLED_FAILURE_KEY/);
  assert.match(workflow, /data\/admin\/fred_banking\/index\.json/);
  assert.match(workflow, /data\/admin\/fred_banking\/lkg\/daily\.json/);
  assert.match(workflow, /data\/admin\/fred_banking\/lkg\/weekly\.json/);
  assert.match(workflow, /data\/admin\/fred_banking\/lkg\/monthly\.json/);
  assert.match(workflow, /data\/admin\/fred_banking\/lkg\/quarterly\.json/);
  assert.match(workflow, /data\/macro\/fred-banking-monthly\.json/);
  assert.match(workflow, /100xfenok-next\/public\/data\/macro\/fred-banking-monthly\.json/);
  assert.match(workflow, /scripts\/stage-lane-manifest\.sh/);
  assert.match(workflow, /--stage always_if_exists/);
  assert.match(workflow, /--stage success_if_exists/);
  assert.match(workflow, /FETCH_OUTCOME.*success[\s\S]*--stage success_if_exists/);
  assert.match(workflow, /- name: Commit and push owned FRED banking data\n\s+if: \$\{\{ always\(\) \}\}/);
}


// Lane Registry ⇄ commit-shard completeness gate (#366 step 4).
{
  const workflowText = fs.readFileSync(new URL("../.github/workflows/fetch-fred-banking.yml", import.meta.url), "utf8");
  const gate = checkWorkflowCommitShardsAgainstRegistry({
    workflowText,
    workflowRel: ".github/workflows/fetch-fred-banking.yml",
  });
  assert.deepEqual(gate.missing_in_workflow, [],
    `declared shards the workflow never commits: ${JSON.stringify(gate.missing_in_workflow)}`);
  assert.deepEqual(gate.undeclared_in_workflow, [],
    `allowlist paths with no registry record: ${JSON.stringify(gate.undeclared_in_workflow)}`);
  assert.deepEqual(gate.lanes.sort(), ["fred_banking"].sort(), "registry lane attribution for this workflow");
}

console.log("test-fetch-fred-banking: ok");
