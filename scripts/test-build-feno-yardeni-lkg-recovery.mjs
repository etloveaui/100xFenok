#!/usr/bin/env node
// LKG recovery adoption for the FRED Yardeni weekly model lane.
//
// Mirrors the fetch-fenok-finra recovery contract, adapted for a weekly-cadence
// modeled source (DEC-264: staleness judged by the source's own cadence):
//   (a) a broken fetch retains the last-known-good marker and parks retry (degraded),
//   (b) a weekly rebuild without a newer Friday print is EXPECTED ABSENCE
//       (not_newer), never a failure and never a regression,
//   (c) a natural-schedule success after a failure records recovery provenance
//       under provider_observation/v2,
//   (d) a workflow_dispatch success cannot promote a recovery (natural gate),
//   (e) a systemic break (rate limit/auth/decode) is corruption, not degradation,
//   (f) corrupt or unprovable candidates are rejected fail-closed,
//   (g) the index the store writes round-trips through the KPI recovery validator.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  applyYardeniLkgStore,
  buildYardeniFreshnessMarker,
  runFenoYardeni,
  validYardeniFreshnessMarker,
  yardeniMarkerPathFor,
  yardeniMarkerSourceAsOf,
  YARDENI_LANE_ID,
  YARDENI_LKG_KEY,
} from "./build-feno-yardeni-model.mjs";
import {
  projectRecoveryRecoveredSet,
  projectRecoveryRetrySet,
} from "./build-fenok-data-health-kpi.mjs";
import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";
import { LaneLkgStore } from "./lib/data-supply-lkg-store.mjs";

const seedPayload = {
  meta: { model: "yardney_model", frequency: "weekly" },
  data: [
    { date: "2009-12-25", spx: 1100, eps: 80, bond_per: 20, fair_value: 1600, premium_pct: -31.25 },
  ],
};

const benchmarkPayload = {
  metadata: { version: "fixture-benchmark", generated: "2026-07-08T00:00:00.000Z", source: "fixture" },
  sections: {
    sp500: {
      data: [
        { date: "2010-01-01", px_last: 1115.1, best_eps: 78.6127 },
        { date: "2010-01-08", px_last: 1144.98, best_eps: 79.1824 },
        { date: "2010-01-15", px_last: 1136.03, best_eps: 79.6816 },
      ],
    },
  },
};

// Two provider generations: Friday 2010-01-08 is the newest print in gen1;
// Friday 2010-01-15 arrives in gen2 (the weekly advance).
const fredGen1 = {
  WAAA: [
    { date: "2010-01-01", value: 5 },
    { date: "2010-01-08", value: 5.2 },
  ],
  WBAA: [
    { date: "2010-01-01", value: 6 },
    { date: "2010-01-08", value: 6.2 },
  ],
};
const fredGen2 = {
  WAAA: [...fredGen1.WAAA, { date: "2010-01-15", value: 5.4 }],
  WBAA: [...fredGen1.WBAA, { date: "2010-01-15", value: 6.4 }],
};

function response(statusCode, payload) {
  return { statusCode, body: typeof payload === "string" ? payload : JSON.stringify(payload) };
}

function fredRequest(series) {
  return async (_url, seriesId) => response(200, {
    observations: series[seriesId].map((row) => ({ date: row.date, value: String(row.value) })),
  });
}

function transportRequest() {
  return async () => {
    throw Object.assign(new Error("connect reset"), { code: "ECONNRESET" });
  };
}

function rateLimitedRequest() {
  return async () => response(429, { error: "rate limit" });
}

function naturalRun(runId, observedAt) {
  return { runId, runAttempt: 1, eventName: "schedule", observedAt };
}
function dispatchRun(runId, observedAt) {
  return { runId, runAttempt: 1, eventName: "workflow_dispatch", observedAt };
}

function makeRoot(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `yardeni-lkg-${tag}-`));
}
function runPaths(root) {
  return {
    publicOutputPath: path.join(root, "data", "yardney", "yardney_model.json"),
    publicMirrorPath: path.join(root, "public", "data", "yardney", "yardney_model.json"),
    privateOutputPath: path.join(root, "private", "yardney_model_full.json"),
    privateFredCachePath: path.join(root, "private", "fred_yardeni_yields.json"),
    attemptShardPath: path.join(root, "data", "admin", "data-supply-state", "detection-attempts", "fred_yardeni.json"),
  };
}
function indexPath(root) {
  return path.join(root, "data", "admin", YARDENI_LANE_ID, "index.json");
}
function lkgPath(root) {
  return path.join(root, "data", "admin", YARDENI_LANE_ID, "lkg", `${YARDENI_LKG_KEY}.json`);
}
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
function markerSourceAsOf(root) {
  const marker = readJson(yardeniMarkerPathFor(root));
  assert.equal(validYardeniFreshnessMarker(marker), true, "persisted freshness marker must be valid");
  return marker.source_as_of;
}

async function runLane(root, { series, request, run }) {
  return runFenoYardeni({
    ...runPaths(root),
    seedPayload,
    privateSeedPayload: null,
    benchmarkPayload,
    apiKey: "test-key",
    request: request ?? fredRequest(series),
    observedAt: run.observedAt,
    lkgRepoRoot: root,
    runId: run.runId,
    runAttempt: run.runAttempt,
    eventName: run.eventName,
  });
}

// --- Detection-floor lane registration -------------------------------------
{
  const lane = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((row) => row.id === YARDENI_LANE_ID);
  assert.ok(lane, "fred_yardeni must be a registered detection lane");
  assert.equal(lane.enforcement, "live", "fred_yardeni lane is live; the recovery store depends on it staying live");
  assert.equal(lane.kpi_required, true);
}

// --- Marker validators + privacy contract ----------------------------------
{
  const publicPayload = {
    meta: {
      total_records: 3,
      last_update: { last_public_date: "2010-01-08" },
    },
  };
  const publicPayloadBytes = Buffer.from(`${JSON.stringify(publicPayload, null, 2)}\n`, "utf8");
  const marker = buildYardeniFreshnessMarker({ publicPayload, publicPayloadBytes, generatedAt: "2026-07-14T04:00:00Z" });
  assert.equal(validYardeniFreshnessMarker(marker), true);
  assert.equal(marker.source_as_of, "2010-01-08");
  assert.equal(yardeniMarkerSourceAsOf(marker), "2010-01-08");
  assert.equal(marker.source_cadence, "weekly", "marker must declare the provider's weekly cadence");
  assert.match(marker.payload_sha256, /^[0-9a-f]{64}$/);
  const markerText = JSON.stringify(marker);
  for (const forbidden of ["moodys_aaa", "moodys_baa", "spread_avg", "WAAA", "WBAA"]) {
    assert.equal(markerText.includes(forbidden), false, `marker leaked FRED component ${forbidden}`);
  }
}

// --- (a)-(d),(g) full failure -> LKG -> recovery cycle, via the producer ----
{
  const root = makeRoot("cycle");

  // seed a healthy weekly print (Friday 2010-01-08 is the newest)
  const seed = await runLane(root, { series: fredGen1, run: naturalRun("seed-run", "2026-07-11T10:00:00Z") });
  assert.equal(seed.ok, true);
  assert.equal(seed.lkg.kind, "success");
  assert.equal(seed.lkg.updated, true);
  assert.equal(markerSourceAsOf(root), "2010-01-08");
  const afterSeed = readJson(indexPath(root));
  assert.deepEqual(afterSeed.retry_set, []);
  assert.equal(afterSeed.items[YARDENI_LKG_KEY].resolution_state, "fresh_primary");
  assert.equal(afterSeed.items[YARDENI_LKG_KEY].promotion_contract, "provider_observation/v2");
  assert.equal(afterSeed.items[YARDENI_LKG_KEY].provider_observation.run_id, "seed-run");

  // (b) weekly cadence: a rebuild with no newer Friday print is expected absence
  const absence = await runLane(root, { series: fredGen1, run: naturalRun("weekly-absence-run", "2026-07-12T10:00:00Z") });
  assert.equal(absence.ok, true);
  assert.equal(absence.lkg.kind, "not_newer");
  assert.equal(absence.lkg.updated, false);
  const afterAbsence = readJson(indexPath(root));
  assert.deepEqual(afterAbsence.retry_set, [], "a print-less week must not park the lane in retry");
  assert.equal(afterAbsence.items[YARDENI_LKG_KEY].resolution_state, "fresh_primary");
  assert.equal(markerSourceAsOf(root), "2010-01-08", "expected absence must not move the freshness anchor");

  // (a) a broken fetch retains the LKG marker and parks retry, degraded not corrupt
  const failed = await runLane(root, { request: transportRequest(), run: naturalRun("transport-run", "2026-07-13T10:00:00Z") });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, "transport_error");
  assert.equal(failed.lkg.kind, "failure");
  assert.equal(failed.lkg.degraded, true);
  assert.equal(failed.lkg.corrupt, false);
  assert.equal(failed.lkg.exitCode, 0);
  assert.deepEqual(failed.lkg.retrySet, [YARDENI_LKG_KEY]);
  assert.equal(markerSourceAsOf(root), "2010-01-08", "a failure must not overwrite the freshness marker");
  const retained = readJson(indexPath(root));
  assert.equal(retained.items[YARDENI_LKG_KEY].resolution_state, "lkg_primary");
  assert.equal(retained.items[YARDENI_LKG_KEY].latest_failure.run_id, "transport-run");
  assert.equal(
    retained.items[YARDENI_LKG_KEY].lkg.payload_sha256,
    createHash("sha256").update(fs.readFileSync(lkgPath(root))).digest("hex"),
    "retained LKG is sha256-bound to the on-disk lkg copy",
  );

  // (g) the retry-state index round-trips through the KPI validator
  const retrySet = projectRecoveryRetrySet(retained, YARDENI_LANE_ID);
  assert.equal(retrySet.length, 1);
  assert.equal(retrySet[0].key, YARDENI_LKG_KEY);
  assert.equal(retrySet[0].resolution_state, "lkg_primary");
  assert.equal(retrySet[0].failure_run_id, "transport-run");

  // (d) a workflow_dispatch success cannot promote a recovery (natural gate)
  const dispatchAttempt = await runLane(root, { series: fredGen2, run: dispatchRun("manual-run", "2026-07-13T11:00:00Z") });
  assert.equal(dispatchAttempt.ok, true);
  assert.equal(dispatchAttempt.lkg.kind, "recovery_requires_schedule");
  assert.equal(markerSourceAsOf(root), "2010-01-08", "a dispatch run must not advance recovery");
  assert.equal(readJson(indexPath(root)).items[YARDENI_LKG_KEY].resolution_state, "lkg_primary");

  // same-source natural run cannot recover (provider Friday not advanced)
  const sameSource = await runLane(root, { series: fredGen1, run: naturalRun("same-source-run", "2026-07-13T12:00:00Z") });
  assert.equal(sameSource.ok, true);
  assert.equal(sameSource.lkg.kind, "not_promotable");
  assert.equal(sameSource.lkg.reason, "recovery_not_advanced_by_provider");
  const deferred = readJson(indexPath(root)).items[YARDENI_LKG_KEY];
  assert.equal(deferred.latest_promotion_deferral.reason, "recovery_not_advanced_by_provider");
  assert.equal(deferred.latest_promotion_deferral.run_id, "same-source-run");

  // (c) natural-schedule success with an advanced provider Friday recovers
  const recovered = await runLane(root, { series: fredGen2, run: naturalRun("natural-recovery-run", "2026-07-18T10:00:00Z") });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.lkg.kind, "success");
  assert.equal(recovered.lkg.recovered, true);
  assert.equal(markerSourceAsOf(root), "2010-01-15", "recovery advances the freshness anchor to the new Friday");

  const finalState = readJson(indexPath(root));
  assert.deepEqual(finalState.retry_set, []);
  const item = finalState.items[YARDENI_LKG_KEY];
  assert.equal(item.resolution_state, "fresh_primary");
  assert.equal(item.retry, false);
  assert.equal(item.recovered_from_run_id, "transport-run");
  assert.equal(item.recovery_run_id, "natural-recovery-run");
  assert.equal(item.recovery_event_name, "schedule");
  assert.equal(item.last_recovered_failure.reason, "transport_error");

  // (g) the recovered-state index round-trips through the KPI validator
  const recoveredSet = projectRecoveryRecoveredSet(finalState, YARDENI_LANE_ID);
  assert.equal(recoveredSet.length, 1);
  assert.equal(recoveredSet[0].key, YARDENI_LKG_KEY);
  assert.equal(recoveredSet[0].recovered_from_run_id, "transport-run");
  assert.equal(recoveredSet[0].recovery_event_name, "schedule");
  assert.equal(recoveredSet[0].lkg_source_as_of, "2010-01-08");
  assert.equal(recoveredSet[0].source_as_of, "2010-01-15");
}

// --- (e) a systemic break is corruption, not degradation --------------------
{
  const root = makeRoot("systemic");
  const seed = await runLane(root, { series: fredGen1, run: naturalRun("seed-run", "2026-07-11T10:00:00Z") });
  assert.equal(seed.lkg.kind, "success");
  const failed = await runLane(root, { request: rateLimitedRequest(), run: naturalRun("rate-limit-run", "2026-07-13T10:00:00Z") });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, "rate_limited");
  assert.equal(failed.lkg.kind, "failure");
  assert.equal(failed.lkg.degraded, false);
  assert.equal(failed.lkg.corrupt, true);
  assert.equal(failed.lkg.exitCode, 2, "systemic failures exit non-zero even with a retained LKG");
  assert.equal(markerSourceAsOf(root), "2010-01-08", "a systemic failure must not overwrite the freshness marker");
}

// --- (f) corrupt or unprovable candidates are rejected fail-closed ----------
{
  // A lane whose canonical cannot be validated has no provable LKG: the failure
  // is corruption (exit 2), never a silent pretend-degraded.
  const root = makeRoot("corrupt");
  const markerPath = yardeniMarkerPathFor(root);
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, `${JSON.stringify({ schema_version: "forged", source_as_of: "2099-01-01" }, null, 2)}\n`, "utf8");
  const failed = await runLane(root, { request: transportRequest(), run: naturalRun("transport-run", "2026-07-13T10:00:00Z") });
  assert.equal(failed.ok, false);
  assert.equal(failed.lkg.kind, "failure");
  assert.equal(failed.lkg.degraded, false);
  assert.equal(failed.lkg.corrupt, true);
  assert.equal(failed.lkg.exitCode, 2);
  assert.equal(readJson(indexPath(root)).items[YARDENI_LKG_KEY].resolution_state, "unavailable");

  // A candidate whose claimed source marker is not payload-bound is rejected by
  // the store's own validator before any state mutation.
  const store = new LaneLkgStore({ repoRoot: makeRoot("candidate"), laneId: YARDENI_LANE_ID });
  const honestPayload = {
    meta: { total_records: 3, last_update: { last_public_date: "2010-01-08" } },
  };
  const honestBytes = Buffer.from(`${JSON.stringify(honestPayload, null, 2)}\n`, "utf8");
  const marker = buildYardeniFreshnessMarker({ publicPayload: honestPayload, publicPayloadBytes: honestBytes, generatedAt: "2026-07-13T10:00:00Z" });
  const forgedCandidate = {
    key: YARDENI_LKG_KEY,
    currentRelativePath: "data/admin/fred_yardeni/current/yardney_model.json",
    payloadBytes: Buffer.from(`${JSON.stringify(marker, null, 2)}\n`, "utf8"),
    sourceAsOf: "2099-01-01",
    validateDocument: validYardeniFreshnessMarker,
    deriveSourceAsOf: yardeniMarkerSourceAsOf,
    promotion_contract: "legacy_source_marker/v1",
  };
  assert.throws(
    () => store.evaluatePromotionCandidates([forgedCandidate], { runId: "forged-run", runAttempt: 1, eventName: "schedule", observedAt: "2026-07-13T10:00:00Z" }),
    /not payload-bound/,
    "a candidate whose source marker is not payload-bound must be rejected",
  );
}

// --- applyYardeniLkgStore stays inert without a store context ---------------
{
  const root = makeRoot("inert");
  const result = await runFenoYardeni({
    ...runPaths(root),
    seedPayload,
    privateSeedPayload: null,
    benchmarkPayload,
    apiKey: "test-key",
    request: fredRequest(fredGen1),
    observedAt: "2026-07-11T10:00:00Z",
  });
  assert.equal(result.ok, true);
  assert.equal(result.lkg, null, "no lkgRepoRoot -> the store is never touched");
  assert.equal(fs.existsSync(indexPath(root)), false, "no recovery state is written without a store context");

  const noWrite = await runFenoYardeni({
    ...runPaths(root),
    seedPayload,
    privateSeedPayload: null,
    benchmarkPayload,
    apiKey: "test-key",
    request: fredRequest(fredGen1),
    observedAt: "2026-07-12T10:00:00Z",
    noWrite: true,
    lkgRepoRoot: root,
  });
  assert.equal(noWrite.ok, true);
  assert.equal(noWrite.lkg, null, "--no-write never touches the store");
  assert.equal(fs.existsSync(indexPath(root)), false);
}

console.log("test-build-feno-yardeni-lkg-recovery: ok");
