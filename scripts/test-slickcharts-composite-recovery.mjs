#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  SLICKCHARTS_COMPOSITE_MEMBERS,
  SLICKCHARTS_MEMBER_PATHS,
  finalizeSlickchartsCompositeRecovery,
  inspectSlickchartsCompositeLiveIntegrity,
  inspectSlickchartsMemberBundle,
  mergeSlickchartsCompositeMember,
  prepareSlickchartsCompositeSnapshot,
  validateSlickchartsCompositeIndex,
} from "./lib/slickcharts-composite-recovery.mjs";
import { mapDetectionFloorRow } from "./build-fenok-data-health-kpi.mjs";
import { canonicalJson } from "./lib/json-canonical.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "slickcharts-composite-recovery-"));
const indexPath = path.join(root, "data/admin/slickcharts-composite-recovery/index.json");
let runCounter = 100;

function write(relative, value) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
}

for (const [member, specs] of Object.entries(SLICKCHARTS_MEMBER_PATHS)) {
  for (const spec of specs) {
    if (spec.kind === "directory") {
      write(`${spec.path}/AAA.json`, { member, path: `${spec.path}/AAA.json`, version: 1 });
    } else {
      write(spec.path, { member, path: spec.path, version: 1 });
    }
  }
}

function readyRow(member, passed = true) {
  return {
    lane_id: "slickcharts",
    member_id: member,
    attempt_id: `gh-${runCounter}-1-${member}`,
    observed_at: "2026-08-01T00:00:00.000Z",
    execution: "returned",
    exception_kind: null,
    http_status: 200,
    auth: "not_applicable",
    rate_limited: false,
    decode: "ok",
    payload: "non_empty",
    assertions: [{ id: "table_rows", passed }],
  };
}

function receipt(target, providerDate, responseSha256 = "a".repeat(64)) {
  write(target, {
    execution: "returned",
    exception_kind: null,
    http_status: 200,
    auth: "not_applicable",
    rate_limited: false,
    decode: "ok",
    payload: "non_empty",
    assertions: [{ id: "table_rows", passed: true }],
    provider_date: providerDate,
    response_sha256: responseSha256,
  });
}

function finalize(member, {
  eventName = "schedule",
  runAttempt = 1,
  runId = null,
  providerDate = "2026-08-01T00:00:00.000Z",
  passed = true,
  fullRun = true,
  mutateAfterSnapshot = false,
  responseSha256 = "a".repeat(64),
} = {}) {
  runCounter += 1;
  const snapshotRoot = path.join(root, "snapshots", `${member}-${runCounter}`);
  const rowPath = path.join(root, "rows", `${member}-${runCounter}.json`);
  const receiptPath = path.join(root, "events", `${member}-${runCounter}.jsonl`);
  const statusPath = path.join(root, "status", `${member}-${runCounter}.json`);
  prepareSlickchartsCompositeSnapshot({ repoRoot: root, member, snapshotRoot });
  if (mutateAfterSnapshot) {
    const firstFile = inspectSlickchartsMemberBundle(root, member).files[0].path;
    write(firstFile, { member, candidate_after_snapshot: runCounter });
  }
  write(path.relative(root, rowPath), readyRow(member, passed));
  receipt(path.relative(root, receiptPath), providerDate, responseSha256);
  return finalizeSlickchartsCompositeRecovery({
    repoRoot: root,
    member,
    snapshotRoot,
    indexPath,
    rowPath,
    receiptTargets: [receiptPath],
    statusPath,
    run: {
      run_id: runId ?? String(runCounter),
      run_attempt: runAttempt,
      event_name: eventName,
      observed_at: `2026-08-${String(Math.min(runCounter - 99, 28)).padStart(2, "0")}T00:00:00.000Z`,
      head_sha: String(runCounter).padStart(40, "0"),
    },
    fullRun,
  });
}

function failMember(member, providerDate) {
  runCounter += 1;
  const snapshotRoot = path.join(root, "snapshots", `${member}-failure-${runCounter}`);
  const rowPath = path.join(root, "rows", `${member}-failure-${runCounter}.json`);
  const receiptPath = path.join(root, "events", `${member}-failure-${runCounter}.jsonl`);
  prepareSlickchartsCompositeSnapshot({ repoRoot: root, member, snapshotRoot });
  const firstFile = inspectSlickchartsMemberBundle(root, member).files[0].path;
  write(firstFile, { member, partial_failure: runCounter });
  const directorySpec = SLICKCHARTS_MEMBER_PATHS[member].find((spec) => spec.kind === "directory");
  if (directorySpec) write(`${directorySpec.path}/UNEXPECTED.json`, { partial_failure: true });
  write(path.relative(root, rowPath), readyRow(member, false));
  receipt(path.relative(root, receiptPath), providerDate);
  return finalizeSlickchartsCompositeRecovery({
    repoRoot: root,
    member,
    snapshotRoot,
    indexPath,
    rowPath,
    receiptTargets: [receiptPath],
    statusPath: path.join(root, "status", `${member}-failure-${runCounter}.json`),
    run: {
      run_id: String(runCounter),
      run_attempt: 1,
      event_name: "workflow_dispatch",
      observed_at: providerDate,
      head_sha: String(runCounter).padStart(40, "f"),
    },
    fullRun: true,
  });
}

// Policy since 6e26769b92 ("allow verified bootstrap publication"): a healthy
// FULL dispatch with a valid provider receipt MAY establish the baseline —
// the same admission rule the promotion gate adopted in 1f3fc3518f. The old
// baseline_requires_natural_schedule_attempt_1 refusal applied only before
// that change; this test previously pinned it and killed every natural run
// from 2026-08-02 on (the KPI's degraded slickcharts lane).
const initialDailyBefore = inspectSlickchartsMemberBundle(root, "daily");
let initialManual = finalize("daily", {
  eventName: "workflow_dispatch",
  providerDate: "2026-07-30T00:00:00.000Z",
  mutateAfterSnapshot: true,
});
assert.equal(initialManual.status.decision, "candidate_promoted");
assert.equal(initialManual.status.publish_data, true);
assert.equal(initialManual.index.members.daily.resolution_state, "fresh_primary");
assert.equal(initialManual.index.members.daily.retry, false);
assert.notDeepEqual(initialManual.index.members.daily.bundle, initialDailyBefore,
  "the verified bootstrap publishes the new bundle instead of restoring the snapshot");

const prebaselineFailure = failMember("monthly", "2026-07-31T00:00:00.000Z");
assert.equal(prebaselineFailure.status.decision, "bootstrap_failure_retained");
assert.equal(prebaselineFailure.index.members.monthly.resolution_state, "bootstrap_unverified");
assert.equal(prebaselineFailure.index.members.monthly.retry, false);

// Each member must then establish a natural, receipt-bound baseline before the
// composite can become ready.
for (const member of SLICKCHARTS_COMPOSITE_MEMBERS) {
  const result = finalize(member);
  assert.equal(result.index.members[member].resolution_state, "fresh_primary");
}
let index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
assert.equal(index.composite_state, "ready");
assert.deepEqual(index.retry_members, []);
assert.equal(validateSlickchartsCompositeIndex(index), true);

// A failed member may have partially changed multiple files. The entire owned
// bundle is restored and the complete retained composite generation is named.
const weeklyBefore = inspectSlickchartsMemberBundle(root, "weekly");
const generationBeforeFailure = index.active_composite.generation_id;
const weeklySnapshot = path.join(root, "snapshots", "weekly-failure");
prepareSlickchartsCompositeSnapshot({ repoRoot: root, member: "weekly", snapshotRoot: weeklySnapshot });
write("data/slickcharts/sp500.json", { corrupt: true });
write("data/slickcharts/etf.json", { partial: true });
runCounter += 1;
const failedRowPath = path.join(root, "rows", "weekly-failure.json");
const failedReceiptPath = path.join(root, "events", "weekly-failure.jsonl");
const failedStatusPath = path.join(root, "status", "weekly-failure.json");
write(path.relative(root, failedRowPath), readyRow("weekly", false));
receipt(path.relative(root, failedReceiptPath), "2026-08-02T00:00:00.000Z");
let result = finalizeSlickchartsCompositeRecovery({
  repoRoot: root,
  member: "weekly",
  snapshotRoot: weeklySnapshot,
  indexPath,
  rowPath: failedRowPath,
  receiptTargets: [failedReceiptPath],
  statusPath: failedStatusPath,
  run: {
    run_id: String(runCounter),
    run_attempt: 1,
    event_name: "workflow_dispatch",
    observed_at: "2026-08-02T00:00:00.000Z",
    head_sha: "f".repeat(40),
  },
  fullRun: true,
});
assert.equal(result.status.decision, "retained_lkg");
assert.equal(result.status.publish_data, false);
assert.equal(result.index.composite_state, "degraded_lkg");
assert.deepEqual(result.index.retry_members, ["weekly"]);
assert.equal(result.index.active_composite.generation_id, generationBeforeFailure);
assert.equal(result.index.retained_composite.generation_id, generationBeforeFailure);
assert.deepEqual(inspectSlickchartsMemberBundle(root, "weekly"), weeklyBefore);
const failureRunId = result.index.members.weekly.last_failure.run.run_id;

// The lane opts into the shared first-attempt structured workflow_dispatch
// recovery policy: a bound (numeric nonzero run id) first-attempt dispatch is
// admitted like a natural schedule run and still faces the provider gates.
// Synthetic run ids, retry attempts, and stale observations cannot promote.
write("data/slickcharts/sp500.json", { candidate: "dispatch" });
result = finalize("weekly", { eventName: "workflow_dispatch", providerDate: "2026-08-03T00:00:00.000Z" });
assert.equal(result.status.decision, "recovery_requires_advancing_provider_content");
assert.equal(result.index.members.weekly.resolution_state, "lkg_primary");

write("data/slickcharts/sp500.json", { candidate: "dispatch-synthetic-run-id" });
result = finalize("weekly", {
  eventName: "workflow_dispatch",
  runId: "slickcharts-manual-recovery-run",
  providerDate: "2026-08-03T00:00:00.000Z",
  responseSha256: "b".repeat(64),
});
assert.equal(result.status.decision, "recovery_requires_natural_schedule_attempt_1");
assert.equal(result.index.members.weekly.resolution_state, "lkg_primary");

write("data/slickcharts/sp500.json", { candidate: "dispatch-attempt-2" });
result = finalize("weekly", {
  eventName: "workflow_dispatch",
  runAttempt: 2,
  providerDate: "2026-08-03T00:00:00.000Z",
  responseSha256: "b".repeat(64),
});
assert.equal(result.status.decision, "recovery_requires_natural_schedule_attempt_1");

write("data/slickcharts/sp500.json", { candidate: "dispatch-stale-provider-time" });
result = finalize("weekly", { eventName: "workflow_dispatch", providerDate: "2026-08-01T00:00:00.000Z" });
assert.equal(result.status.decision, "recovery_requires_advancing_provider_time");

write("data/slickcharts/sp500.json", { candidate: "attempt-2" });
result = finalize("weekly", { runAttempt: 2, providerDate: "2026-08-03T00:00:00.000Z" });
assert.equal(result.status.decision, "recovery_requires_natural_schedule_attempt_1");

write("data/slickcharts/sp500.json", { candidate: "same-date" });
result = finalize("weekly", { providerDate: "2026-08-01T00:00:00.000Z" });
assert.equal(result.status.decision, "recovery_requires_advancing_provider_time");

write("data/slickcharts/sp500.json", { candidate: "later-date-identical-content" });
result = finalize("weekly", { providerDate: "2026-08-04T00:00:00.000Z" });
assert.equal(result.status.decision, "recovery_requires_advancing_provider_content");

write("data/slickcharts/sp500.json", { candidate: "natural-recovery" });
result = finalize("weekly", {
  providerDate: "2026-08-05T00:00:00.000Z",
  responseSha256: "b".repeat(64),
});
assert.equal(result.status.decision, "recovered_and_promoted");
assert.equal(result.status.publish_data, true);
assert.equal(result.index.composite_state, "ready");
assert.deepEqual(result.index.retry_members, []);
assert.equal(result.index.members.weekly.last_recovery.recovered_from_run_id, failureRunId);
assert.equal(result.index.members.weekly.last_recovery.recovery_run_attempt, 1);
assert.equal(result.index.members.weekly.last_recovery.recovery_event_name, "schedule");

// A bound first-attempt workflow_dispatch with an advancing provider
// observation recovers exactly like a natural schedule run.
const dispatchFailure = failMember("weekly", "2026-08-06T00:00:00.000Z");
assert.equal(dispatchFailure.status.decision, "retained_lkg");
const dispatchFailureRunId = dispatchFailure.index.members.weekly.last_failure.run.run_id;
write("data/slickcharts/sp500.json", { candidate: "dispatch-recovery" });
result = finalize("weekly", {
  eventName: "workflow_dispatch",
  providerDate: "2026-08-07T00:00:00.000Z",
  responseSha256: "c".repeat(64),
});
assert.equal(result.status.decision, "recovered_and_promoted");
assert.equal(result.status.publish_data, true);
assert.equal(result.index.composite_state, "ready");
assert.deepEqual(result.index.retry_members, []);
assert.equal(result.index.members.weekly.last_recovery.recovered_from_run_id, dispatchFailureRunId);
assert.equal(result.index.members.weekly.last_recovery.recovery_run_attempt, 1);
assert.equal(result.index.members.weekly.last_recovery.recovery_event_name, "workflow_dispatch");

// Every workflow-owned path contract uses the same all-or-nothing rollback.
for (const [offset, member] of ["daily", "monthly", "history", "symbols"].entries()) {
  const before = inspectSlickchartsMemberBundle(root, member);
  const failed = failMember(member, `2026-09-0${offset + 1}T00:00:00.000Z`);
  assert.equal(failed.status.decision, "retained_lkg");
  assert.equal(failed.index.members[member].resolution_state, "lkg_primary");
  assert.deepEqual(inspectSlickchartsMemberBundle(root, member), before);
  const recovered = finalize(member, {
    providerDate: `2026-09-1${offset}T00:00:00.000Z`,
    responseSha256: "b".repeat(64),
  });
  assert.equal(recovered.status.decision, "recovered_and_promoted");
  assert.equal(recovered.index.members[member].resolution_state, "fresh_primary");
}

// A degraded composite permits exactly one retry. All other member candidates
// and failures are restored until that retry recovers, so the five-member
// canonical generation cannot become mixed.
let failedDaily = failMember("daily", "2026-10-01T00:00:00.000Z");
const generationWhileDailyRetries = failedDaily.index.active_composite.generation_id;
const historyBeforeSuppressedFailure = inspectSlickchartsMemberBundle(root, "history");
let failedHistory = failMember("history", "2026-10-02T00:00:00.000Z");
assert.equal(failedHistory.status.decision, "secondary_failure_deferred");
assert.deepEqual(failedHistory.index.retry_members, ["daily"]);
assert.equal(failedHistory.index.active_composite.generation_id, generationWhileDailyRetries);
assert.deepEqual(inspectSlickchartsMemberBundle(root, "history"), historyBeforeSuppressedFailure);
const retainedGeneration = failedHistory.index.retained_composite.generation_id;
let deferredHistory = finalize("history", {
  providerDate: "2026-10-03T00:00:00.000Z",
  mutateAfterSnapshot: true,
});
assert.equal(deferredHistory.status.decision, "composite_retry_in_progress_deferred");
assert.equal(deferredHistory.status.publish_data, false);
assert.deepEqual(deferredHistory.index.retry_members, ["daily"]);
assert.equal(deferredHistory.index.retained_composite.generation_id, retainedGeneration);
assert.equal(deferredHistory.index.active_composite.generation_id, generationWhileDailyRetries);
assert.deepEqual(inspectSlickchartsMemberBundle(root, "history"), historyBeforeSuppressedFailure);
let recoveredDaily = finalize("daily", {
  providerDate: "2026-10-04T00:00:00.000Z",
  responseSha256: "c".repeat(64),
});
assert.deepEqual(recoveredDaily.index.retry_members, []);
assert.equal(recoveredDaily.index.retained_composite, null);

const detectionConfig = {
  id: "slickcharts",
  label: "SlickCharts composite",
  enforcement: "live",
  kpi_required: true,
  status: "ready",
  reason: "ok",
  artifact: { status: "ready", reason: "ok", source_as_of: "2026-08-04" },
};
const kpiReady = mapDetectionFloorRow(detectionConfig, result.index);
assert.equal(kpiReady.status, "ready");
assert.equal(kpiReady.details.recovery.composite_state, "ready");
const tamperedKpiIndex = structuredClone(result.index);
tamperedKpiIndex.members.monthly.bundle.tree_sha256 = "0".repeat(64);
const kpiTampered = mapDetectionFloorRow(detectionConfig, tamperedKpiIndex);
assert.equal(kpiTampered.status, "degraded");
assert.equal(kpiTampered.checks.find((row) => row.id === "recovery_state_present").status, "blocked");

// Partial runs never publish a mixed member bundle.
const symbolsBefore = inspectSlickchartsMemberBundle(root, "symbols");
const symbolsSnapshot = path.join(root, "snapshots", "symbols-partial");
prepareSlickchartsCompositeSnapshot({ repoRoot: root, member: "symbols", snapshotRoot: symbolsSnapshot });
write("data/slickcharts/symbols.json", { partial: true });
runCounter += 1;
const symbolsRowPath = path.join(root, "rows", "symbols-partial.json");
const symbolsReceiptPath = path.join(root, "events", "symbols-partial.jsonl");
write(path.relative(root, symbolsRowPath), readyRow("symbols", true));
receipt(path.relative(root, symbolsReceiptPath), "2026-08-05T00:00:00.000Z");
result = finalizeSlickchartsCompositeRecovery({
  repoRoot: root,
  member: "symbols",
  snapshotRoot: symbolsSnapshot,
  indexPath,
  rowPath: symbolsRowPath,
  receiptTargets: [symbolsReceiptPath],
  statusPath: path.join(root, "status", "symbols-partial.json"),
  run: {
    run_id: String(runCounter),
    run_attempt: 1,
    event_name: "workflow_dispatch",
    observed_at: "2026-08-05T00:00:00.000Z",
    head_sha: "e".repeat(40),
  },
  fullRun: false,
});
assert.equal(result.status.decision, "partial_run_deferred");
assert.equal(result.status.publish_data, false);
assert.deepEqual(inspectSlickchartsMemberBundle(root, "symbols"), symbolsBefore);

// Rebase-safe merge changes only the saved member and retains an upstream
// member advancement.
const baseIndex = structuredClone(result.index);
const savedIndex = structuredClone(result.index);
baseIndex.members.daily.bundle.files[0].sha256 = "b".repeat(64);
baseIndex.members.daily.bundle.tree_sha256 = crypto.createHash("sha256")
  .update(canonicalJson(baseIndex.members.daily.bundle.files)).digest("hex");
// Recompute base through a valid round-trip using a temporary saved member
// merge, then assert the real merge preserves that upstream daily digest.
const savedWeeklyBaseSha256 = crypto.createHash("sha256")
  .update(canonicalJson(savedIndex.members.weekly)).digest("hex");
savedIndex.members.weekly.last_failure = { marker: "saved-member-state" };
savedIndex.current_attempt = {
  ...savedIndex.current_attempt,
  member_id: "weekly",
  base_member_state_sha256: savedWeeklyBaseSha256,
};
const upstreamDailyDigest = baseIndex.members.daily.bundle.tree_sha256;
const vector = SLICKCHARTS_COMPOSITE_MEMBERS.map((member) => ({
  member,
  tree_sha256: baseIndex.members[member].bundle.tree_sha256,
}));
baseIndex.active_composite.generation_id = crypto.createHash("sha256").update(canonicalJson(vector)).digest("hex");
baseIndex.active_composite.members = Object.fromEntries(vector.map((row) => [row.member, row.tree_sha256]));
assert.equal(validateSlickchartsCompositeIndex(baseIndex), true);
const merged = mergeSlickchartsCompositeMember({
  baseIndex,
  savedIndex,
  member: "weekly",
  generatedAt: "2026-08-20T00:00:00.000Z",
});
assert.equal(merged.members.daily.bundle.tree_sha256, upstreamDailyDigest);
assert.deepEqual(merged.members.weekly, savedIndex.members.weekly);
assert.equal(validateSlickchartsCompositeIndex(merged), true);

const sameMemberConflict = structuredClone(baseIndex);
sameMemberConflict.members.weekly.last_recovery = { marker: "newer-upstream-state" };
assert.equal(validateSlickchartsCompositeIndex(sameMemberConflict), true);
assert.throws(() => mergeSlickchartsCompositeMember({
  baseIndex: sameMemberConflict,
  savedIndex,
  member: "weekly",
  generatedAt: "2026-08-21T00:00:00.000Z",
}), /foreign_writer_conflict/);

const malformed = structuredClone(merged);
malformed.members.history.bundle.tree_sha256 = "0".repeat(64);
assert.throws(() => validateSlickchartsCompositeIndex(malformed), /history bundle is invalid/);

// The index must be bound to the bytes currently present for every owned
// member, not merely internally self-consistent.
assert.equal(inspectSlickchartsCompositeLiveIntegrity(root, result.index).valid, true);
for (const member of SLICKCHARTS_COMPOSITE_MEMBERS) {
  const before = inspectSlickchartsMemberBundle(root, member);
  const firstFile = before.files[0].path;
  const original = fs.readFileSync(path.join(root, firstFile));
  write(firstFile, { member, live_divergence: true });
  const integrity = inspectSlickchartsCompositeLiveIntegrity(root, result.index);
  assert.equal(integrity.valid, false);
  assert.deepEqual(integrity.mismatches.map((row) => row.member), [member]);
  fs.writeFileSync(path.join(root, firstFile), original);
}

fs.rmSync(root, { recursive: true, force: true });
console.log("test-slickcharts-composite-recovery: ok");
