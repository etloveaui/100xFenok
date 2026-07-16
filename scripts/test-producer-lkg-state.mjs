#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ProducerLkgStateStore,
  assessRecoveryExit,
} from "./lib/producer-lkg-state.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "producer-lkg-state-"));
const stateRoot = path.join(root, "data", "admin", "fixture-lane");
const run = (runId, observedAt = "2026-07-15T01:00:00Z") => ({
  run_id: runId,
  run_attempt: 1,
  event_name: "workflow_dispatch",
  natural: false,
  observed_at: observedAt,
});
const naturalRun = (runId, observedAt = "2026-07-15T01:00:00Z") => ({
  ...run(runId, observedAt),
  event_name: "schedule",
  natural: true,
});
const bytes = (sourceAsOf, value = 1) => Buffer.from(`${JSON.stringify({
  schema_version: "fixture/v1",
  key: "alpha.json",
  source_as_of: sourceAsOf,
  value,
}, null, 2)}\n`);
const parse = (payloadBytes) => JSON.parse(payloadBytes.toString("utf8"));
const makeStore = (rootPath) => new ProducerLkgStateStore({
  root: rootPath,
  laneId: "fixture_lane",
  publicRoot: "data/admin/fixture-lane",
  validatePayload(key, payload) {
    return payload?.schema_version === "fixture/v1" && payload?.key === key;
  },
  progressMarker(_key, payload) {
    return payload?.source_as_of ?? null;
  },
});
const store = makeStore(stateRoot);

function v2Args(targetStore, sourceAsOf, value, currentRun, candidateBytes = null) {
  const providerBytes = bytes(sourceAsOf, value);
  return {
    key: "alpha.json",
    payloadBytes: candidateBytes ?? providerBytes,
    providerObservation: targetStore.buildProviderObservation({
      key: "alpha.json",
      payloadBytes: providerBytes,
      run: currentRun,
    }),
    canonicalRef: "data/source/alpha.json",
    run: currentRun,
  };
}

{
  const initial = store.recordCandidate({
    key: "alpha.json",
    payloadBytes: bytes("2026-07-14", 1),
    canonicalRef: "data/source/alpha.json",
    run: run("seed"),
  });
  assert.equal(initial.accepted, true);
  assert.equal(initial.state.resolution_state, "fresh_primary");
  assert.equal(initial.state.retry, false);
  assert.equal(initial.state.current.payload_sha256, crypto.createHash("sha256").update(bytes("2026-07-14", 1)).digest("hex"));
}

{
  const fallback = bytes("2026-07-14", 1);
  const failed = store.recordFailure({
    key: "alpha.json",
    error: "controlled failure",
    failureKind: "controlled",
    fallbackBytes: fallback,
    canonicalRef: "data/source/alpha.json",
    run: run("failure-1"),
  });
  const lkgPath = path.join(stateRoot, "lkg", "alpha.json");
  assert.equal(failed.resolution_state, "lkg_primary");
  assert.equal(failed.retry, true);
  assert.equal(failed.current.path, "data/admin/fixture-lane/lkg/alpha.json");
  assert.equal(failed.lkg.payload_sha256, crypto.createHash("sha256").update(fallback).digest("hex"));
  assert.deepEqual(fs.readFileSync(lkgPath), fallback, "LKG bytes must be exact and hash-bound");

  const index = store.buildIndex({ keys: ["alpha.json"], run: run("failure-1") });
  assert.deepEqual(index.keys, ["alpha.json"]);
  assert.deepEqual(index.retry_keys, ["alpha.json"]);
  assert.equal(index.lkg_details[0].failure_run_id, "failure-1");
  assert.equal(index.current_attempt.failed, 1);
  assert.deepEqual(index.current_attempt.failed_keys, ["alpha.json"]);
  assert.deepEqual(assessRecoveryExit({ store, index, failedKeys: ["alpha.json"] }), {
    exit_code: 0,
    keys: ["alpha.json"],
    reasons: [],
  });
}

{
  const same = store.recordCandidate({
    key: "alpha.json",
    payloadBytes: bytes("2026-07-14", 2),
    canonicalRef: "data/source/alpha.json",
    run: naturalRun("same-source", "2026-07-15T02:00:00Z"),
  });
  assert.equal(same.accepted, false, "recovery must advance beyond the retained LKG source marker");
  assert.equal(same.state.resolution_state, "lkg_primary");
  assert.equal(same.state.latest_failure.run_id, "same-source");

  const advancedBytes = bytes("2026-07-15", 3);
  const advanced = store.recordCandidate({
    key: "alpha.json",
    payloadBytes: advancedBytes,
    canonicalRef: "data/source/alpha.json",
    run: naturalRun("recovery-1", "2026-07-15T03:00:00Z"),
  });
  assert.equal(advanced.accepted, true);
  assert.equal(advanced.state.resolution_state, "fresh_primary");
  assert.equal(advanced.state.retry, false);
  assert.equal(advanced.state.recovered_from_run_id, "same-source");
  assert.equal(advanced.state.current.payload_sha256, crypto.createHash("sha256").update(advancedBytes).digest("hex"));
}

{
  store.recordFailure({
    key: "alpha.json",
    error: "transport reset",
    failureKind: "transport",
    fallbackBytes: bytes("2026-07-15", 3),
    canonicalRef: "data/source/alpha.json",
    run: run("failure-2", "2026-07-15T04:00:00Z"),
  });
  fs.writeFileSync(path.join(stateRoot, "lkg", "alpha.json"), bytes("2026-07-15", 999));
  const index = store.buildIndex({ keys: ["alpha.json"], run: run("failure-2", "2026-07-15T04:00:00Z") });
  const assessment = assessRecoveryExit({ store, index, failedKeys: ["alpha.json"] });
  assert.equal(assessment.exit_code, 2);
  assert.match(assessment.reasons.join("; "), /valid retained LKG/i);
}

{
  const pointerRoot = path.join(root, "pointer-binding");
  const pointerStore = makeStore(pointerRoot);
  pointerStore.recordCandidate({ key: "alpha.json", payloadBytes: bytes("2026-07-14"), canonicalRef: "data/source/alpha.json", run: run("pointer-seed") });
  pointerStore.recordFailure({ key: "alpha.json", error: "reset", failureKind: "transport", fallbackBytes: bytes("2026-07-14"), canonicalRef: "data/source/alpha.json", run: run("pointer-failure") });
  const statePath = path.join(pointerRoot, "keys", "alpha.json");
  const tampered = JSON.parse(fs.readFileSync(statePath, "utf8"));
  tampered.current = { path: "data/wrong.json", payload_sha256: "0".repeat(64), source_as_of: tampered.lkg.source_as_of };
  fs.writeFileSync(statePath, `${JSON.stringify(tampered, null, 2)}\n`);
  assert.match(pointerStore.inspectState("alpha.json").reason, /pointer binding/i);
  const index = pointerStore.buildIndex({ keys: ["alpha.json"], run: run("pointer-failure") });
  const assessment = assessRecoveryExit({ store: pointerStore, index, failedKeys: ["alpha.json"] });
  assert.equal(assessment.exit_code, 2);
  assert.match(assessment.reasons.join("; "), /valid retained LKG/i);

  const firstRepair = pointerStore.recordCandidate({ key: "alpha.json", payloadBytes: bytes("2026-07-15"), canonicalRef: "data/source/alpha.json", run: run("pointer-repair-1") });
  assert.equal(firstRepair.accepted, false, "a corrupt retained pointer is reported once instead of silently healed");
  assert.equal(firstRepair.state.resolution_state, "unavailable");
  const secondRepair = pointerStore.recordCandidate({ key: "alpha.json", payloadBytes: bytes("2026-07-15"), canonicalRef: "data/source/alpha.json", run: naturalRun("pointer-repair-2") });
  assert.equal(secondRepair.accepted, true, "a later valid primary can recover from unavailable state");
  assert.equal(secondRepair.state.recovered_from_run_id, "pointer-repair-1");
}

{
  const attemptRoot = path.join(root, "attempt-binding");
  const attemptStore = makeStore(attemptRoot);
  attemptStore.recordCandidate({ key: "alpha.json", payloadBytes: bytes("2026-07-14"), canonicalRef: "data/source/alpha.json", run: run("same-run") });
  attemptStore.recordFailure({ key: "alpha.json", error: "reset", failureKind: "transport", fallbackBytes: bytes("2026-07-14"), canonicalRef: "data/source/alpha.json", run: run("same-run") });
  const rerun = { ...run("same-run"), run_attempt: 2 };
  const index = attemptStore.buildIndex({ keys: ["alpha.json"], run: rerun });
  assert.deepEqual(index.current_attempt.failed_keys, [], "attempt 1 failure is not rebound to attempt 2");
  const assessment = assessRecoveryExit({ store: attemptStore, index, failedKeys: ["alpha.json"] });
  assert.equal(assessment.exit_code, 2);
  assert.match(assessment.reasons.join("; "), /current attempt/i);
}

{
  const unavailableRoot = path.join(root, "unavailable-recovery");
  const unavailableStore = makeStore(unavailableRoot);
  const unavailable = unavailableStore.recordFailure({ key: "alpha.json", error: "no baseline", failureKind: "transport", fallbackBytes: null, canonicalRef: "data/source/alpha.json", run: run("unavailable-1") });
  assert.equal(unavailable.resolution_state, "unavailable");
  assert.equal(unavailable.lkg, null);
  const recovered = unavailableStore.recordCandidate({ key: "alpha.json", payloadBytes: bytes("2026-07-15"), canonicalRef: "data/source/alpha.json", run: naturalRun("unavailable-2") });
  assert.equal(recovered.accepted, true);
  assert.equal(recovered.state.resolution_state, "fresh_primary");
  assert.equal(recovered.state.recovered_from_run_id, "unavailable-1");
}

{
  const naturalGateRoot = path.join(root, "natural-recovery-gate");
  const naturalGateStore = makeStore(naturalGateRoot);
  naturalGateStore.recordCandidate({ key: "alpha.json", payloadBytes: bytes("2026-07-14"), canonicalRef: "data/source/alpha.json", run: run("natural-seed") });
  naturalGateStore.recordFailure({ key: "alpha.json", error: "controlled", failureKind: "controlled", fallbackBytes: bytes("2026-07-14"), canonicalRef: "data/source/alpha.json", run: run("chaos-run") });
  const dispatchCandidate = naturalGateStore.recordCandidate({ key: "alpha.json", payloadBytes: bytes("2026-07-15"), canonicalRef: "data/source/alpha.json", run: run("manual-green") });
  assert.equal(dispatchCandidate.accepted, false);
  assert.equal(dispatchCandidate.deferred, true, "a manual green observation cannot prove or perform recovery promotion");
  assert.equal(dispatchCandidate.state.resolution_state, "lkg_primary");
  assert.equal(dispatchCandidate.state.latest_failure.run_id, "chaos-run");
  const rerunCandidate = naturalGateStore.recordCandidate({
    key: "alpha.json",
    payloadBytes: bytes("2026-07-15"),
    canonicalRef: "data/source/alpha.json",
    run: { ...naturalRun("scheduled-rerun"), run_attempt: 2 },
  });
  assert.equal(rerunCandidate.deferred, true, "a rerun of a scheduled job is not a distinct natural occurrence");
  const naturalCandidate = naturalGateStore.recordCandidate({ key: "alpha.json", payloadBytes: bytes("2026-07-15"), canonicalRef: "data/source/alpha.json", run: naturalRun("natural-recovery") });
  assert.equal(naturalCandidate.accepted, true);
  assert.equal(naturalCandidate.state.resolution_state, "fresh_primary");
  assert.equal(naturalCandidate.state.recovered_from_run_id, "chaos-run");
  assert.equal(naturalCandidate.state.recovery_event_name, "schedule");
  assert.equal(naturalCandidate.state.recovery_run_attempt, 1);
  assert.equal(naturalCandidate.state.recovered_at, "2026-07-15T01:00:00Z");
  const laterFresh = naturalGateStore.recordCandidate({ key: "alpha.json", payloadBytes: bytes("2026-07-16"), canonicalRef: "data/source/alpha.json", run: run("later-fresh") });
  assert.equal(laterFresh.state.recovered_from_run_id, "chaos-run", "recovery provenance persists beyond the transition run");
  assert.equal(laterFresh.state.recovery_run_id, "natural-recovery");
  assert.equal(laterFresh.state.recovery_event_name, "schedule");
}

{
  const v2Root = path.join(root, "provider-observation-v2");
  const v2Store = makeStore(v2Root);
  const retainedBytes = bytes("2026-07-14", 1);
  v2Store.recordCandidate({ key: "alpha.json", payloadBytes: retainedBytes, canonicalRef: "data/source/alpha.json", run: run("v2-seed") });
  v2Store.recordFailure({ key: "alpha.json", error: "controlled", failureKind: "controlled", fallbackBytes: retainedBytes, canonicalRef: "data/source/alpha.json", run: run("v2-chaos") });
  const statePath = path.join(v2Root, "keys", "alpha.json");
  const lkgPath = path.join(v2Root, "lkg", "alpha.json");

  const same = v2Store.recordCandidate(v2Args(v2Store, "2026-07-14", 2, naturalRun("v2-same")));
  assert.equal(same.accepted, false);
  assert.equal(same.reason, "recovery_not_advanced_by_provider");
  assert.equal(same.state.latest_failure.run_id, "v2-chaos", "a same-marker deferral preserves the LKG-entering failure");
  assert.equal(same.state.latest_promotion_deferral.run_id, "v2-same");
  assert.equal(same.state.latest_promotion_deferral.reason, "recovery_not_advanced_by_provider");
  assert.deepEqual(fs.readFileSync(lkgPath), retainedBytes);

  const advancedBytes = bytes("2026-07-15", 3);
  const advanced = v2Store.recordCandidate(v2Args(v2Store, "2026-07-15", 3, naturalRun("v2-recovery")));
  assert.equal(advanced.accepted, true);
  assert.equal(advanced.state.recovered_from_run_id, "v2-chaos");
  assert.equal(advanced.state.last_recovered_failure.run_id, "v2-chaos");
  assert.equal(advanced.state.promotion_contract, "provider_observation/v2");
  assert.equal(advanced.state.provider_observation.run_id, "v2-recovery");
  assert.equal(advanced.state.provider_observation.payload_sha256, crypto.createHash("sha256").update(advancedBytes).digest("hex"));
  assert.equal(advanced.state.current.payload_sha256, crypto.createHash("sha256").update(advancedBytes).digest("hex"));
  assert.deepEqual(fs.readFileSync(lkgPath), retainedBytes, "promotion preserves the retained LKG bytes for attribution");

  const validFreshState = fs.readFileSync(statePath);
  const tamperedCurrent = JSON.parse(validFreshState.toString("utf8"));
  tamperedCurrent.current.payload_sha256 = "0".repeat(64);
  fs.writeFileSync(statePath, `${JSON.stringify(tamperedCurrent, null, 2)}\n`);
  assert.equal(v2Store.inspectState("alpha.json").kind, "corrupt", "fresh current hash tampering is corruption");
  fs.writeFileSync(statePath, validFreshState);
  const tamperedProof = JSON.parse(validFreshState.toString("utf8"));
  tamperedProof.provider_observation.run_id = "foreign-run";
  fs.writeFileSync(statePath, `${JSON.stringify(tamperedProof, null, 2)}\n`);
  assert.equal(v2Store.inspectState("alpha.json").kind, "corrupt", "persisted provider proof tampering is corruption");
  fs.writeFileSync(statePath, validFreshState);
  const downgraded = JSON.parse(validFreshState.toString("utf8"));
  downgraded.promotion_contract = "legacy_source_marker/v1";
  fs.writeFileSync(statePath, `${JSON.stringify(downgraded, null, 2)}\n`);
  assert.equal(v2Store.inspectState("alpha.json").kind, "corrupt", "provider proof contract downgrade is corruption");
  fs.writeFileSync(statePath, validFreshState);
  const deletedProof = JSON.parse(validFreshState.toString("utf8"));
  delete deletedProof.provider_observation;
  delete deletedProof.promotion_proof_required;
  deletedProof.promotion_contract = "legacy_source_marker/v1";
  deletedProof.schema_version = "producer-lkg-key-state/v1";
  fs.writeFileSync(statePath, `${JSON.stringify(deletedProof, null, 2)}\n`);
  assert.equal(v2Store.inspectState("alpha.json").kind, "corrupt", "state schema and all proof markers cannot downgrade past the lane anchor");
  fs.writeFileSync(statePath, validFreshState);
  const reboundRecovery = JSON.parse(validFreshState.toString("utf8"));
  delete reboundRecovery.last_recovered_failure;
  reboundRecovery.recovery_run_id = "foreign-recovery";
  fs.writeFileSync(statePath, `${JSON.stringify(reboundRecovery, null, 2)}\n`);
  assert.equal(v2Store.inspectState("alpha.json").kind, "corrupt", "recovery evidence deletion plus attribution ID tampering is corruption");
  fs.writeFileSync(statePath, validFreshState);
  const deletedRecoveryProof = JSON.parse(validFreshState.toString("utf8"));
  delete deletedRecoveryProof.recovery_observation;
  fs.writeFileSync(statePath, `${JSON.stringify(deletedRecoveryProof, null, 2)}\n`);
  assert.equal(v2Store.inspectState("alpha.json").kind, "corrupt", "persisted recovery observation deletion is corruption");
  fs.writeFileSync(statePath, validFreshState);
  for (const [field, value] of [["payload_sha256", "f".repeat(64)], ["source_as_of", "2099-01-01"]]) {
    const tamperedRecoveryProof = JSON.parse(validFreshState.toString("utf8"));
    tamperedRecoveryProof.recovery_observation[field] = value;
    fs.writeFileSync(statePath, `${JSON.stringify(tamperedRecoveryProof, null, 2)}\n`);
    assert.equal(v2Store.inspectState("alpha.json").kind, "corrupt", `recovery observation ${field} tampering is corruption`);
  }
  fs.writeFileSync(statePath, validFreshState);
  for (const [field, value] of [["event_name", "workflow_dispatch"], ["observed_at", "2026-07-15T05:00:00Z"]]) {
    const rebound = JSON.parse(validFreshState.toString("utf8"));
    rebound.provider_observation[field] = value;
    fs.writeFileSync(statePath, `${JSON.stringify(rebound, null, 2)}\n`);
    assert.equal(v2Store.inspectState("alpha.json").kind, "corrupt", `provider proof ${field} tampering is corruption`);
  }
  fs.writeFileSync(statePath, validFreshState);

  const laterBytes = bytes("2026-07-16", 4);
  const laterFresh = v2Store.recordCandidate(v2Args(v2Store, "2026-07-16", 4, naturalRun("v2-later-fresh")));
  assert.equal(laterFresh.accepted, true);
  assert.equal(laterFresh.state.provider_observation.run_id, "v2-later-fresh");
  assert.equal(laterFresh.state.recovery_observation.run_id, "v2-recovery");
  assert.equal(laterFresh.state.recovered_from_run_id, "v2-chaos");
  assert.equal(laterFresh.state.recovery_run_id, "v2-recovery");
  assert.equal(v2Store.inspectState("alpha.json").kind, "valid", "a later fresh observation preserves historical recovery attribution");

  const postRecoveryFailure = v2Store.recordFailure({
    key: "alpha.json",
    error: "later transport failure",
    failureKind: "transport",
    fallbackBytes: laterBytes,
    canonicalRef: "data/source/alpha.json",
    run: run("v2-later-failure"),
  });
  assert.equal(postRecoveryFailure.lkg.source_as_of, "2026-07-16");
  assert.deepEqual(fs.readFileSync(lkgPath), laterBytes, "the next failure captures the exact published fresh primary as its new LKG");
}

{
  const conflictRoot = path.join(root, "provider-observation-conflict");
  const conflictStore = makeStore(conflictRoot);
  const retainedBytes = bytes("2026-07-14", 1);
  conflictStore.recordCandidate({ key: "alpha.json", payloadBytes: retainedBytes, canonicalRef: "data/source/alpha.json", run: run("conflict-seed") });
  conflictStore.recordFailure({ key: "alpha.json", error: "controlled", failureKind: "controlled", fallbackBytes: retainedBytes, canonicalRef: "data/source/alpha.json", run: run("conflict-chaos") });
  const statePath = path.join(conflictRoot, "keys", "alpha.json");
  const lkgPath = path.join(conflictRoot, "lkg", "alpha.json");
  const beforeState = fs.readFileSync(statePath);
  const beforeLkg = fs.readFileSync(lkgPath);
  const currentRun = naturalRun("conflict-natural");
  const plan = conflictStore.planCandidate(v2Args(
    conflictStore,
    "2026-07-15",
    2,
    currentRun,
    bytes("2026-07-16", 99),
  ));
  assert.equal(plan.accepted, false);
  assert.equal(plan.reason, "foreign_writer_conflict");
  assert.deepEqual(fs.readFileSync(statePath), beforeState, "candidate planning is pure");
  assert.deepEqual(fs.readFileSync(lkgPath), beforeLkg, "candidate planning cannot mutate LKG bytes");
  const deferred = conflictStore.recordPromotionDeferral(plan);
  assert.equal(deferred.latest_failure.run_id, "conflict-chaos");
  assert.equal(deferred.latest_promotion_deferral.reason, "foreign_writer_conflict");
  assert.deepEqual(fs.readFileSync(lkgPath), beforeLkg);

  const tampered = v2Args(conflictStore, "2026-07-15", 2, naturalRun("proof-tamper"));
  tampered.providerObservation.payload_sha256 = "0".repeat(64);
  assert.throws(() => conflictStore.planCandidate(tampered), /proof is not payload-bound/);
}

for (const [name, malformedState] of [
  ["decode", "{broken\n"],
  ["schema", `${JSON.stringify({ schema_version: "wrong/v1", lane_id: "fixture_lane", key: "alpha.json" })}\n`],
]) {
  const corruptRoot = path.join(root, `corrupt-state-${name}`);
  fs.mkdirSync(path.join(corruptRoot, "keys"), { recursive: true });
  fs.writeFileSync(path.join(corruptRoot, "keys", "alpha.json"), malformedState);
  const corruptStore = makeStore(corruptRoot);
  const failed = corruptStore.recordFailure({
    key: "alpha.json",
    error: "transport reset",
    failureKind: "transport",
    fallbackBytes: bytes("2026-07-14"),
    canonicalRef: "data/source/alpha.json",
    run: run(`corrupt-state-${name}`),
  });
  assert.equal(failed.resolution_state, "unavailable", "corrupt committed state must not bootstrap a fallback LKG");
  assert.equal(failed.lkg, null);
  assert.equal(failed.latest_failure.failure_kind, "corrupt_state");
  const index = corruptStore.buildIndex({ keys: ["alpha.json"], run: run(`corrupt-state-${name}`) });
  assert.equal(assessRecoveryExit({ store: corruptStore, index, failedKeys: ["alpha.json"] }).exit_code, 2);
}

assert.equal(parse(bytes("2026-07-15")).source_as_of, "2026-07-15");
console.log("test-producer-lkg-state: ok");
