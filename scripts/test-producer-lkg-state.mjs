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

{
  // Exact deadlock repro (root commit 67e3df35cc): a pre-contract v1 state with inherited
  // recovery lineage (mirrors data/admin/yahoo-hourly-ticker/keys/TQQQ.json@e4eba9d906)
  // must stay committable under v2 provider proof via the declared legacy exception.
  const legacyRoot = path.join(root, "legacy-recovery-provenance");
  const legacyStore = makeStore(legacyRoot);
  const retainedBytes = bytes("2026-07-14", 1);
  const retainedSha = crypto.createHash("sha256").update(retainedBytes).digest("hex");
  const legacyState = {
    schema_version: "producer-lkg-key-state/v1",
    lane_id: "fixture_lane",
    key: "alpha.json",
    updated_at: "2026-07-16T11:51:09.839Z",
    resolution_state: "fresh_primary",
    retry: false,
    current: { path: "data/source/alpha.json", payload_sha256: retainedSha, source_as_of: "2026-07-14" },
    canonical_ref: "data/source/alpha.json",
    lkg: { path: "data/admin/fixture-lane/lkg/alpha.json", payload_sha256: retainedSha, source_as_of: "2026-07-14" },
    latest_failure: null,
    recovered_from_run_id: "29417720099",
    recovery_run_id: "29421917838",
    recovery_run_attempt: 1,
    recovery_event_name: "schedule",
    recovered_at: "2026-07-15T14:04:52.506Z",
    last_run_id: "29495869517",
    last_run_attempt: 1,
  };
  const statePath = path.join(legacyRoot, "keys", "alpha.json");
  fs.mkdirSync(path.join(legacyRoot, "keys"), { recursive: true });
  fs.mkdirSync(path.join(legacyRoot, "lkg"), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(legacyState, null, 2)}\n`);
  fs.writeFileSync(path.join(legacyRoot, "lkg", "alpha.json"), retainedBytes);
  assert.equal(legacyStore.inspectState("alpha.json").kind, "valid", "the pre-contract legacy state itself reads as valid");

  const committed = legacyStore.recordCandidate(v2Args(legacyStore, "2026-07-15", 2, naturalRun("legacy-natural", "2026-07-16T12:00:00Z")));
  assert.equal(committed.accepted, true, "a v2 provider-proof commit over legacy lineage must not deadlock");
  assert.equal(committed.state.schema_version, "producer-lkg-key-state/v2");
  assert.equal(committed.state.recovery_provenance_contract, "legacy_source_marker/v1");
  assert.equal(committed.state.recovered_from_run_id, "29417720099", "inherited lineage is preserved, not laundered");
  assert.equal(committed.state.recovery_observation, undefined);
  assert.equal(legacyStore.inspectState("alpha.json").kind, "valid",
    "the committed state is provable via its declared exception (pre-fix: provider observation proof binding is invalid)");
  const anchor = JSON.parse(fs.readFileSync(path.join(legacyRoot, "promotion-contracts", "alpha.json"), "utf8"));
  assert.equal(anchor.recovery_observation_sha256, null, "the anchor honestly records that no recovery observation exists");

  const later = legacyStore.recordCandidate(v2Args(legacyStore, "2026-07-16", 3, naturalRun("legacy-later", "2026-07-16T13:00:00Z")));
  assert.equal(later.accepted, true);
  assert.equal(later.state.recovery_provenance_contract, "legacy_source_marker/v1",
    "the declaration propagates across later v2 commits while the lineage persists");
  assert.equal(legacyStore.inspectState("alpha.json").kind, "valid");

  const declaredBytes = fs.readFileSync(statePath);
  const undeclared = JSON.parse(declaredBytes.toString("utf8"));
  delete undeclared.recovery_provenance_contract;
  fs.writeFileSync(statePath, `${JSON.stringify(undeclared, null, 2)}\n`);
  const undeclaredInspection = legacyStore.inspectState("alpha.json");
  assert.equal(undeclaredInspection.kind, "corrupt", "the same state without the declaration stays unprovable");
  assert.match(undeclaredInspection.reason, /provider observation proof binding is invalid/);
  fs.writeFileSync(statePath, declaredBytes);
  const fabricated = JSON.parse(declaredBytes.toString("utf8"));
  fabricated.recovery_observation = { ...fabricated.provider_observation };
  fs.writeFileSync(statePath, `${JSON.stringify(fabricated, null, 2)}\n`);
  const fabricatedInspection = legacyStore.inspectState("alpha.json");
  assert.equal(fabricatedInspection.kind, "corrupt", "the declaration plus fabricated v2 proof fields is corruption");
  assert.match(fabricatedInspection.reason, /legacy recovery provenance declaration is invalid/);
  fs.writeFileSync(statePath, declaredBytes);
  const unknownDeclaration = JSON.parse(declaredBytes.toString("utf8"));
  unknownDeclaration.recovery_provenance_contract = "legacy_source_marker/v2";
  fs.writeFileSync(statePath, `${JSON.stringify(unknownDeclaration, null, 2)}\n`);
  assert.equal(legacyStore.inspectState("alpha.json").kind, "corrupt", "an unknown provenance declaration is corruption");
  fs.writeFileSync(statePath, declaredBytes);
  assert.equal(legacyStore.inspectState("alpha.json").kind, "valid");
}

{
  // A prior committed under the legacy PROMOTION contract (promotion_contract:
  // legacy_source_marker/v1, written by a non-provider commit) with inherited lineage
  // must also carry the declaration forward once the producer migrates to
  // providerObservation — otherwise the same deadlock re-arms on migration day.
  const legacyContractRoot = path.join(root, "legacy-promotion-contract-prior");
  const legacyContractStore = makeStore(legacyContractRoot);
  const retainedBytes = bytes("2026-07-14", 1);
  const retainedSha = crypto.createHash("sha256").update(retainedBytes).digest("hex");
  const priorState = {
    schema_version: "producer-lkg-key-state/v1",
    lane_id: "fixture_lane",
    key: "alpha.json",
    updated_at: "2026-07-16T11:51:09.839Z",
    resolution_state: "fresh_primary",
    retry: false,
    current: { path: "data/source/alpha.json", payload_sha256: retainedSha, source_as_of: "2026-07-14" },
    canonical_ref: "data/source/alpha.json",
    lkg: { path: "data/admin/fixture-lane/lkg/alpha.json", payload_sha256: retainedSha, source_as_of: "2026-07-14" },
    latest_failure: null,
    recovered_from_run_id: "29417720099",
    recovery_run_id: "29421917838",
    recovery_run_attempt: 1,
    recovery_event_name: "schedule",
    recovered_at: "2026-07-15T14:04:52.506Z",
    last_run_id: "29495869517",
    last_run_attempt: 1,
    last_event_name: "schedule",
    promotion_contract: "legacy_source_marker/v1",
  };
  const statePath = path.join(legacyContractRoot, "keys", "alpha.json");
  fs.mkdirSync(path.join(legacyContractRoot, "keys"), { recursive: true });
  fs.mkdirSync(path.join(legacyContractRoot, "lkg"), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(priorState, null, 2)}\n`);
  fs.writeFileSync(path.join(legacyContractRoot, "lkg", "alpha.json"), retainedBytes);
  assert.equal(legacyContractStore.inspectState("alpha.json").kind, "valid");
  const migrated = legacyContractStore.recordCandidate(v2Args(legacyContractStore, "2026-07-15", 2, naturalRun("contract-migration", "2026-07-16T12:00:00Z")));
  assert.equal(migrated.accepted, true, "migrating a legacy-promotion-contract prior to provider proof must not deadlock");
  assert.equal(migrated.state.recovery_provenance_contract, "legacy_source_marker/v1");
  assert.equal(migrated.state.recovered_from_run_id, "29417720099");
  assert.equal(legacyContractStore.inspectState("alpha.json").kind, "valid");

  // Abuse direction: the same prior that already carries a recovery_observation gets NO
  // declaration — the observation is real proof and must stay bound, not be waived.
  const observedRoot = path.join(root, "legacy-contract-with-observation");
  const observedStore = makeStore(observedRoot);
  const observedPrior = {
    ...priorState,
    recovery_observation: {
      schema_version: "provider_observation/v2",
      payload_sha256: retainedSha,
      source_as_of: "2026-07-14",
      run_id: "29421917838",
      run_attempt: 1,
      event_name: "schedule",
      observed_at: "2026-07-15T14:04:52.506Z",
      recovered_from_run_id: "29417720099",
    },
  };
  fs.mkdirSync(path.join(observedRoot, "keys"), { recursive: true });
  fs.mkdirSync(path.join(observedRoot, "lkg"), { recursive: true });
  fs.writeFileSync(path.join(observedRoot, "keys", "alpha.json"), `${JSON.stringify(observedPrior, null, 2)}\n`);
  fs.writeFileSync(path.join(observedRoot, "lkg", "alpha.json"), retainedBytes);
  const observedCommit = observedStore.recordCandidate(v2Args(observedStore, "2026-07-15", 2, naturalRun("observed-migration", "2026-07-16T12:00:00Z")));
  assert.equal(observedCommit.state.recovery_provenance_contract, undefined,
    "a prior carrying a recovery_observation cannot be re-declared legacy");
  assert.equal(observedCommit.state.recovery_observation.run_id, "29421917838", "the real observation stays bound instead");
}

{
  // The declaration cannot dodge v2 proof: neither on fresh lineage-less states nor on
  // states whose recovery really happened under the v2 contract.
  const dodgeRoot = path.join(root, "legacy-declaration-dodge");
  const dodgeStore = makeStore(dodgeRoot);
  const statePath = path.join(dodgeRoot, "keys", "alpha.json");
  dodgeStore.recordCandidate(v2Args(dodgeStore, "2026-07-14", 1, naturalRun("dodge-seed")));
  const freshTamper = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(freshTamper.recovered_from_run_id, null);
  freshTamper.recovery_provenance_contract = "legacy_source_marker/v1";
  fs.writeFileSync(statePath, `${JSON.stringify(freshTamper, null, 2)}\n`);
  const freshInspection = dodgeStore.inspectState("alpha.json");
  assert.equal(freshInspection.kind, "corrupt", "a lineage-less fresh state cannot carry the legacy declaration");
  assert.match(freshInspection.reason, /legacy recovery provenance declaration is invalid/);

  const provenRoot = path.join(root, "legacy-declaration-dodge-proven");
  const provenStore = makeStore(provenRoot);
  const provenStatePath = path.join(provenRoot, "keys", "alpha.json");
  provenStore.recordCandidate({ key: "alpha.json", payloadBytes: bytes("2026-07-14", 1), canonicalRef: "data/source/alpha.json", run: run("proven-seed") });
  provenStore.recordFailure({ key: "alpha.json", error: "controlled", failureKind: "controlled", fallbackBytes: bytes("2026-07-14", 1), canonicalRef: "data/source/alpha.json", run: run("proven-chaos") });
  const provenRecovery = provenStore.recordCandidate(v2Args(provenStore, "2026-07-15", 2, naturalRun("proven-recovery")));
  assert.equal(provenRecovery.accepted, true);
  assert.equal(provenRecovery.state.recovery_observation.run_id, "proven-recovery");
  const dodged = JSON.parse(fs.readFileSync(provenStatePath, "utf8"));
  delete dodged.recovery_observation;
  delete dodged.last_recovered_failure;
  dodged.recovery_provenance_contract = "legacy_source_marker/v1";
  fs.writeFileSync(provenStatePath, `${JSON.stringify(dodged, null, 2)}\n`);
  const dodgedInspection = provenStore.inspectState("alpha.json");
  assert.equal(dodgedInspection.kind, "corrupt",
    "a real v2 recovery cannot shed its proof by re-declaring itself legacy — the anchor sha contradicts it");
  assert.match(dodgedInspection.reason, /legacy recovery provenance declaration is invalid/);
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
