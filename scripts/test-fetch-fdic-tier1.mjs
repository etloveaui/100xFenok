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
  latestClosedQuarter,
  migrateFdicPersistenceDocument,
  retainLatestQuarters,
  runFdicPersistenceMigration,
  runFdicTier1,
} from "./fetch-fdic-tier1.mjs";
import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";
import { projectRecoveryRecoveredSet } from "./build-fenok-data-health-kpi.mjs";

const OBSERVED_AT = "2026-07-14T12:34:56.000Z";
const ATTEMPT_ID = "fdic-tier1-20260714t123456000z-test";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const QUARTERS = ["20251231", "20260331"];

{
  const workflow = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "fetch-fdic.yml"), "utf8");
  assert.match(workflow, /cron:\s*['"]0 6 \* \* 1['"]/);
  assert.match(workflow, /cron:\s*['"]0 6 \* \* 4['"]/);
  assert.doesNotMatch(workflow, /0 6 1-7 \* 1/);
  assert.doesNotMatch(workflow, /guard-fdic-first-monday\.mjs|steps\.schedule_gate\.outputs\.eligible/);
  assert.match(workflow, /owner_approved_recovery:/);
  assert.match(workflow, /INPUT_OWNER_APPROVED_RECOVERY:/);
  assert.match(
    workflow,
    /if: \$\{\{ always\(\) && steps\.publish_cloud_generation\.outcome != 'skipped' \}\}/,
  );
  const lane = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((row) => row.id === "fdic_tier1");
  assert.deepEqual(lane.producer_members[0].schedule, ["0 6 * * 1", "0 6 * * 4"]);
  assert.equal(lane.producer_members[0].cadence_calendar, "utc");
}

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
  assert.equal(latestClosedQuarter(new Date("2026-06-30T23:59:59.999Z")), "20260331");
  assert.equal(latestClosedQuarter(new Date("2026-07-01T00:00:00.000Z")), "20260630");
  assert.equal(latestClosedQuarter(new Date("2026-01-01T00:00:00.000Z")), "20251231");
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
  const quarterEnds = ["0331", "0630", "0930", "1231"];
  const data = Array.from({ length: MAX_QUARTERS + 1 }, (_, index) => {
    const year = 2006 + Math.floor(index / 4);
    const suffix = quarterEnds[index % 4];
    return {
      date: `${year}-${suffix.slice(0, 2)}-${suffix.slice(2)}`,
      value: 12 + index / 100,
      banks: 5_000 - index,
    };
  });
  const legacy = {
    updated: "2026-07-14T14:55:51.727Z",
    source: "FDIC",
    description: "Average Tier 1 Capital Ratio (RBC1AAJ)",
    data,
  };
  const migrated = migrateFdicPersistenceDocument(legacy);
  assert.equal(migrated.document.updated, legacy.updated, "metadata migration preserves acquisition time");
  assert.equal(migrated.document.data.length, MAX_QUARTERS);
  assert.equal(migrated.document.data[0].date, data[1].date, "oldest quarter is evicted");
  assert.deepEqual(migrated.document.persistence_policy, FDIC_PERSISTENCE_POLICY);
  assert.deepEqual(migrated.document.persistence_state, {
    available_quarters: MAX_QUARTERS + 1,
    retained_quarters: MAX_QUARTERS,
    pruned_quarters: 1,
  });
  const migratedAgain = migrateFdicPersistenceDocument(migrated.document);
  assert.equal(migratedAgain.changed, false, "metadata migration is idempotent");
  assert.deepEqual(migratedAgain.document, migrated.document);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fdic-tier1-persistence-migration-"));
  const paths = makePaths(root);
  fs.mkdirSync(path.dirname(paths.canonicalPath), { recursive: true });
  const legacy = {
    updated: "2026-07-14T14:55:51.727Z",
    source: "FDIC",
    description: "Average Tier 1 Capital Ratio (RBC1AAJ)",
    data: [
      { date: "2025-12-31", value: 13, banks: 2 },
      { date: "2026-03-31", value: 15, banks: 2 },
    ],
  };
  const legacyBytes = `${JSON.stringify(legacy, null, 2)}\n`;
  fs.writeFileSync(paths.canonicalPath, legacyBytes);

  assert.throws(
    () => runFdicPersistenceMigration({ ...paths, eventName: "schedule" }),
    /workflow_dispatch/,
    "metadata migration is explicit dispatch-only maintenance",
  );
  const result = runFdicPersistenceMigration({ ...paths, eventName: "workflow_dispatch" });
  assert.equal(result.ok, true);
  assert.equal(result.updated, true);
  const migrated = readJson(paths.canonicalPath);
  assert.deepEqual(migrated.data, legacy.data, "in-bound current data is byte-value preserved");
  assert.deepEqual(migrated.persistence_policy, FDIC_PERSISTENCE_POLICY);

  const idempotent = runFdicPersistenceMigration({ ...paths, eventName: "workflow_dispatch" });
  assert.equal(idempotent.updated, false);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fdic-tier1-persistence-migration-rollback-"));
  const paths = makePaths(root);
  fs.mkdirSync(path.dirname(paths.canonicalPath), { recursive: true });
  const canonicalBytes = `${JSON.stringify({
    updated: "2026-07-14T14:55:51.727Z",
    source: "FDIC",
    description: "Average Tier 1 Capital Ratio (RBC1AAJ)",
    data: [{ date: "2026-03-31", value: 15, banks: 2 }],
  }, null, 2)}\n`;
  fs.writeFileSync(paths.canonicalPath, canonicalBytes);
  assert.throws(
    () => runFdicPersistenceMigration({
      ...paths,
      eventName: "workflow_dispatch",
      write: (targetPath, bytes) => {
        fs.writeFileSync(targetPath, bytes);
        throw new Error("injected canonical write failure");
      },
    }),
    /injected canonical write failure/,
  );
  assert.equal(fs.readFileSync(paths.canonicalPath, "utf8"), canonicalBytes, "canonical rollback is byte-identical");
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fdic-tier1-unpublished-probe-"));
  const paths = makePaths(root);
  const calls = [];
  const result = await runFdicTier1({
    ...paths,
    quarters: QUARTERS,
    probeQuarter: "20260630",
    request: async (_url, quarter) => {
      calls.push(quarter);
      return quarter === "20260630"
        ? response(200, { data: [] })
        : response(200, fdicRows(quarter === QUARTERS[0] ? 12 : 14));
    },
    observedAt: OBSERVED_AT,
    attemptId: `${ATTEMPT_ID}-unpublished-probe`,
    sleep: async () => {},
  });
  assert.equal(result.ok, true, "an unpublished optional quarter must not degrade confirmed history");
  assert.deepEqual(calls, [...QUARTERS, "20260630"]);
  assert.deepEqual(result.probe, {
    quarter: "20260630",
    status: "not_yet_published",
    reason: "empty_payload",
  });
  const output = readJson(paths.canonicalPath);
  assert.equal(output.data.at(-1).date, "2026-03-31");
  assert.equal(output.persistence_state.available_quarters, QUARTERS.length);
  assertValidShard(readJson(paths.attemptShardPath));
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fdic-tier1-published-probe-"));
  const paths = makePaths(root);
  const result = await runFdicTier1({
    ...paths,
    quarters: QUARTERS,
    probeQuarter: "20260630",
    request: async (_url, quarter) => response(200, fdicRows(quarter === "20260630" ? 16 : 14)),
    observedAt: OBSERVED_AT,
    attemptId: `${ATTEMPT_ID}-published-probe`,
    sleep: async () => {},
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.probe, {
    quarter: "20260630",
    status: "included",
    reason: "ready",
  });
  const output = readJson(paths.canonicalPath);
  assert.equal(output.data.at(-1).date, "2026-06-30");
  assert.equal(output.persistence_state.available_quarters, QUARTERS.length + 1);
  assert.equal(output.persistence_state.retained_quarters, QUARTERS.length + 1);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fdic-tier1-probe-retention-"));
  const paths = makePaths(root);
  const quarterEnds = ["0331", "0630", "0930", "1231"];
  const fullWindow = Array.from({ length: MAX_QUARTERS }, (_, index) => {
    const year = 2006 + Math.floor(index / 4);
    return `${year}${quarterEnds[index % 4]}`;
  });
  const probeQuarter = "20260331";
  const result = await runFdicTier1({
    ...paths,
    quarters: fullWindow,
    probeQuarter,
    request: async () => response(200, fdicRows(14)),
    observedAt: OBSERVED_AT,
    attemptId: `${ATTEMPT_ID}-probe-retention`,
    sleep: async () => {},
  });
  assert.equal(result.ok, true);
  const output = readJson(paths.canonicalPath);
  assert.equal(output.data.length, MAX_QUARTERS);
  assert.equal(output.data[0].date, "2006-06-30", "a discovered quarter evicts the oldest retained quarter");
  assert.equal(output.data.at(-1).date, "2026-03-31");
  assert.deepEqual(output.persistence_state, {
    available_quarters: MAX_QUARTERS + 1,
    retained_quarters: MAX_QUARTERS,
    pruned_quarters: 1,
  });
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fdic-tier1-failed-probe-"));
  const paths = makePaths(root);
  const result = await runFdicTier1({
    ...paths,
    quarters: QUARTERS,
    probeQuarter: "20260630",
    request: async (_url, quarter) => {
      if (quarter === "20260630") throw Object.assign(new Error("probe unavailable"), { code: "ECONNRESET" });
      return response(200, fdicRows(14));
    },
    observedAt: OBSERVED_AT,
    attemptId: `${ATTEMPT_ID}-failed-probe`,
    sleep: async () => {},
  });
  assert.equal(result.ok, true, "an optional discovery failure must not invalidate confirmed quarters");
  assert.equal(result.probe.quarter, "20260630");
  assert.equal(result.probe.status, "failed");
  assert.equal(result.probe.reason, "transport_error");
  assert.equal(readJson(paths.canonicalPath).data.at(-1).date, "2026-03-31");
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
  const lkg = `${JSON.stringify({ marker: "lkg" }, null, 2)}\n`;
  fs.writeFileSync(paths.canonicalPath, lkg);
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

  const manualAdvanced = await runFdicTier1({
    ...paths,
    quarters: QUARTERS,
    probeQuarter: "20260630",
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
    quarters: QUARTERS,
    probeQuarter: "20260630",
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fdic-tier1-diagnostic-"));
  const paths = makePaths(root);
  const secret = "fdic-secret-must-not-leak";
  const failed = await runFdicTier1({
    ...paths,
    quarters: QUARTERS,
    request: async () => {
      throw Object.assign(new Error(`gateway reset token=${secret}`), { code: "ECONNRESET" });
    },
    observedAt: OBSERVED_AT,
    attemptId: "fdic-tier1-diagnostic",
    runId: "fdic-tier1-diagnostic",
    sleep: async () => {},
  });
  assert.equal(failed.reason, "transport_error", "reason enum must remain stable");
  assert.match(failed.failure_detail, /Error: gateway reset/, "caught error identity must reach the run result");
  assert.match(failed.failure_detail, /token=\[redacted\]/, "diagnostic detail must redact secrets");
  assert.doesNotMatch(failed.failure_detail, new RegExp(secret), "diagnostic detail must not leak a secret");
  assert(failed.failure_detail.length <= 320, "diagnostic detail must stay bounded");
  const shard = readJson(paths.attemptShardPath);
  assertValidShard(shard);
  assert.equal(Object.hasOwn(shard.attempts[0], "failure_detail"), false, "attempt shard schema must remain unchanged");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fdic-tier1-controlled-no-detail-"));
  const paths = makePaths(root);
  const failed = await runFdicTier1({
    ...paths,
    quarters: QUARTERS,
    request: async (_url, quarter) => response(200, fdicRows(quarter === QUARTERS[0] ? 12 : 14)),
    controlledFailureKey: "latest",
    eventName: "workflow_dispatch",
    observedAt: OBSERVED_AT,
    attemptId: "fdic-tier1-controlled-no-detail",
    runId: "fdic-tier1-controlled-no-detail",
    sleep: async () => {},
  });
  assert.equal(failed.failure_detail ?? null, null, "controlled synthetic failures must not invent diagnostic detail");
}

{
  const workflow = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "fetch-fdic.yml"), "utf8");
  const producer = fs.readFileSync(new URL("./fetch-fdic-tier1.mjs", import.meta.url), "utf8");
  const manifest = JSON.parse(fs.readFileSync(
    path.join(REPO_ROOT, "data", "admin", "lane-commit-manifest.json"),
    "utf8",
  ));
  const canonicalSpec = manifest.workflows[".github/workflows/fetch-fdic.yml"]
    .stages.success_if_exists
    .find((spec) => spec.path === "data/macro/fdic-tier1.json");
  assert.match(producer, /diagnosticSuffix\(result\.failure_detail\)/, "CLI failures must append bounded diagnostic detail");
  assert.match(producer, /probeQuarter:\s*latestClosedQuarter\(new Date\(observedAt\)\)/,
    "the real CLI path must probe the latest fully closed quarter");
  assert.match(workflow, /node scripts\/test-fetch-fdic-tier1\.mjs/);
  assert.match(workflow, /node scripts\/fetch-fdic-tier1\.mjs/);
  assert.doesNotMatch(workflow, /node << ['"]?EOF/);
  assert.doesNotMatch(workflow, /git add -A/);
  assert.match(workflow, /controlled_failure_key/);
  assert.match(workflow, /INPUT_CONTROLLED_FAILURE_KEY/);
  assert.equal(
    canonicalSpec?.required,
    true,
    "successful FDIC Tier-1 fetch must require the canonical payload",
  );
  assert.match(workflow, /persistence_migration_only:/);
  assert.match(workflow, /INPUT_PERSISTENCE_MIGRATION_ONLY:/);
  assert.match(workflow, /- name: Commit and push\n\s+if: \$\{\{ always\(\) \}\}/);
  assert.match(workflow, /steps\.fetch_fdic\.outputs\.updated == 'true'/);
}

// Lane Registry ⇄ commit-shard completeness gate (#366 step 4).
{
  const workflowText = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "fetch-fdic.yml"), "utf8");
  const gate = checkWorkflowCommitShardsAgainstRegistry({
    workflowText,
    workflowRel: ".github/workflows/fetch-fdic.yml",
  });
  assert.deepEqual(gate.missing_in_workflow, [],
    `declared shards the workflow never commits: ${JSON.stringify(gate.missing_in_workflow)}`);
  assert.deepEqual(gate.undeclared_in_workflow, [],
    `allowlist paths with no registry record: ${JSON.stringify(gate.undeclared_in_workflow)}`);
  assert.deepEqual(gate.lanes, ["fdic_tier1"], "the registry must attribute this lane to fetch-fdic.yml");
  assert.match(workflowText, /scripts\/stage-lane-manifest\.sh/);
  assert.match(workflowText, /--stage always_if_exists/);
  assert.match(
    workflowText,
    /if \[\[ "\$FETCH_OUTCOME" == "success" \]\]; then[\s\S]*?scripts\/stage-lane-manifest\.sh[\s\S]*?--stage success_if_exists/,
    "canonical FDIC output must be manifest-staged only on fetch success",
  );
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fdic-tier1-current-skip-"));
  const paths = makePaths(root);
  const currentQuarters = ["20260331", "20260630"];
  await runFdicTier1({
    ...paths,
    quarters: currentQuarters,
    request: async (_url, quarter) => response(200, fdicRows(quarter === "20260630" ? 16 : 14)),
    eventName: "schedule",
    observedAt: "2026-08-31T06:00:00.000Z",
    attemptId: "fdic-tier1-current-baseline",
    runId: "40000000001",
    sleep: async () => {},
  });
  const before = fs.readFileSync(paths.canonicalPath);
  let requests = 0;
  const skipped = await runFdicTier1({
    ...paths,
    quarters: currentQuarters,
    request: async (_url, quarter) => {
      requests += 1;
      return response(200, fdicRows(quarter === "20260630" ? 16 : 14));
    },
    eventName: "schedule",
    observedAt: "2026-09-03T06:00:00.000Z",
    attemptId: "fdic-tier1-current-backup",
    runId: "40000000002",
    sleep: async () => {},
  });
  assert.equal(skipped.ok, true);
  assert.equal(skipped.reason, "already_current");
  assert.equal(skipped.updated, false);
  assert.equal(requests, 1, "a current backup run probes only the latest quarter");
  assert.deepEqual(fs.readFileSync(paths.canonicalPath), before, "a current backup run must not rewrite canonical data");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fdic-tier1-release-wait-"));
  const paths = makePaths(root);
  await runFdicTier1({
    ...paths,
    quarters: QUARTERS,
    request: async (_url, quarter) => response(200, fdicRows(quarter === QUARTERS[0] ? 12 : 14)),
    eventName: "schedule",
    observedAt: "2026-07-02T06:00:00.000Z",
    attemptId: "fdic-tier1-release-wait-baseline",
    runId: "40000000006",
    sleep: async () => {},
  });
  const before = fs.readFileSync(paths.canonicalPath);
  const calls = [];
  const waiting = await runFdicTier1({
    ...paths,
    quarters: QUARTERS,
    probeQuarter: "20260630",
    request: async (_url, quarter) => {
      calls.push(quarter);
      return response(200, { data: [] });
    },
    eventName: "schedule",
    observedAt: "2026-07-06T06:00:00.000Z",
    attemptId: "fdic-tier1-release-wait-probe",
    runId: "40000000007",
    sleep: async () => {},
  });
  assert.equal(waiting.ok, true);
  assert.equal(waiting.reason, "provider_wait");
  assert.equal(waiting.updated, false);
  assert.deepEqual(waiting.probe, {
    quarter: "20260630",
    status: "not_yet_published",
    reason: "empty_payload",
  });
  assert.deepEqual(calls, ["20260630"], "a backup slot checks only the new closed quarter while the provider has not published it");
  assert.deepEqual(fs.readFileSync(paths.canonicalPath), before, "provider wait must not rewrite current canonical data");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fdic-tier1-release-ready-"));
  const paths = makePaths(root);
  await runFdicTier1({
    ...paths,
    quarters: QUARTERS,
    request: async (_url, quarter) => response(200, fdicRows(quarter === QUARTERS[0] ? 12 : 14)),
    eventName: "schedule",
    observedAt: "2026-07-02T06:00:00.000Z",
    attemptId: "fdic-tier1-release-ready-baseline",
    runId: "40000000008",
    sleep: async () => {},
  });
  const calls = [];
  const advanced = await runFdicTier1({
    ...paths,
    quarters: QUARTERS,
    probeQuarter: "20260630",
    request: async (_url, quarter) => {
      calls.push(quarter);
      return response(200, fdicRows(quarter === "20260630" ? 16 : 14));
    },
    eventName: "schedule",
    observedAt: "2026-07-09T06:00:00.000Z",
    attemptId: "fdic-tier1-release-ready-probe",
    runId: "40000000009",
    sleep: async () => {},
  });
  assert.equal(advanced.ok, true);
  assert.equal(advanced.updated, true);
  assert.equal(calls.filter((quarter) => quarter === "20260630").length, 1, "the release probe is reused during promotion");
  assert.equal(readJson(paths.canonicalPath).data.at(-1).date, "2026-06-30");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fdic-tier1-owner-recovery-"));
  const paths = makePaths(root);
  await runFdicTier1({
    ...paths,
    quarters: QUARTERS,
    request: async (_url, quarter) => response(200, fdicRows(quarter === QUARTERS[0] ? 12 : 14)),
    eventName: "schedule",
    observedAt: "2026-07-13T06:00:00.000Z",
    attemptId: "fdic-tier1-owner-baseline",
    runId: "40000000003",
    sleep: async () => {},
  });
  await runFdicTier1({
    ...paths,
    quarters: QUARTERS,
    request: async (_url, quarter) => response(200, fdicRows(quarter === QUARTERS[0] ? 12 : 14)),
    controlledFailureKey: "latest",
    eventName: "workflow_dispatch",
    observedAt: "2026-07-14T06:00:00.000Z",
    attemptId: "fdic-tier1-owner-failure",
    runId: "40000000004",
    sleep: async () => {},
  });
  const recovered = await runFdicTier1({
    ...paths,
    quarters: QUARTERS,
    probeQuarter: "20260630",
    request: async (_url, quarter) => response(200, fdicRows(quarter === "20260630" ? 16 : 14)),
    eventName: "workflow_dispatch",
    ownerApprovedRecovery: true,
    observedAt: "2026-08-29T12:00:00.000Z",
    attemptId: "fdic-tier1-owner-recovery",
    runId: "40000000005",
    runAttempt: 1,
    sleep: async () => {},
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.recovered, true);
  const state = readJson(path.join(root, "data", "admin", "fdic_tier1", "index.json"));
  assert.equal(state.items.fdic_tier1.recovery_event_name, "workflow_dispatch");
  assert.deepEqual(
    projectRecoveryRecoveredSet(state, "fdic_tier1"),
    [],
    "owner-approved operational recovery must not earn natural schedule evidence",
  );
}

console.log("test-fetch-fdic-tier1: ok");
