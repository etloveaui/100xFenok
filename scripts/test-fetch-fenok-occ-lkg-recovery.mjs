#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  applyOccLkgStore,
  build,
  buildOccLkgCandidate,
  classifyOccEndpointResponse,
  OCC_LANE_ID,
  OCC_LKG_KEY,
  occFreshnessMarkerPathFor,
  occFreshnessMarkerSourceAsOf,
  occOutputSourceAsOf,
  parseArgs,
  shouldManageOccLkg,
  validOccFreshnessMarker,
  validOccOutputDocument,
} from "./fetch-fenok-occ-options-volume.mjs";
import {
  projectRecoveryRecoveredSet,
  projectRecoveryRetrySet,
} from "./build-fenok-data-health-kpi.mjs";
import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";
import { LaneLkgStore } from "./lib/data-supply-lkg-store.mjs";

function naturalRun(runId, observedAt) {
  return { runId, runAttempt: 1, eventName: "schedule", observedAt };
}

function dispatchRun(runId, observedAt) {
  return { runId, runAttempt: 1, eventName: "workflow_dispatch", observedAt };
}

function makeRoot(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `occ-lkg-${tag}-`));
}

function canonicalPath(root) {
  return path.join(root, "data", "computed", "fenok_occ_options_volume.json");
}

function markerPath(root) {
  return occFreshnessMarkerPathFor(root);
}

function indexPath(root) {
  return path.join(root, "data", "admin", OCC_LANE_ID, "index.json");
}

function lkgPath(root) {
  return path.join(root, "data", "admin", OCC_LANE_ID, "lkg", `${OCC_LKG_KEY}.json`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeCanonical(root, document) {
  const target = canonicalPath(root);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
}

function readyAttempt(sourceDate, runId = "run") {
  return {
    attempt_ref: runId,
    attempt_number: 1,
    observed_at: `${sourceDate}T12:00:00.000Z`,
    target_source_date: sourceDate,
    served_source_date: sourceDate,
    status: "ready_current",
    fallback_active: false,
    selected_tickers: 1,
    message: "fixture ready",
    batch_retention_limit: 100,
    batches: [],
  };
}

function outputDocument(sourceDate, runId = "run") {
  const compact = sourceDate.replaceAll("-", "");
  return {
    schema_version: 1,
    generated_at: `${sourceDate}T12:00:00.000Z`,
    formula_version: "fenok-occ-options-volume-v0.2-volume-skew-calibration",
    public_surface_status: "admin_private_derived_only_public_summary_source",
    raw_policy: {
      external_collection: true,
      raw_cache_public: false,
      third_party_raw_public: false,
      full_public_mirror: false,
      raw_cache_dir: `_private/admin/fenok-flow/occ_options_volume/${compact}`,
      public_payload: null,
    },
    current_attempt: readyAttempt(sourceDate, runId),
    rows: [{
      ticker: "NVDA",
      as_of: sourceDate,
      source_date: compact,
      confidence: "medium",
      raw_cache_paths: [`_private/admin/fenok-flow/occ_options_volume/${compact}/NVDA_C.csv`],
      options_activity_proxy: {
        score_0_100: 55,
        call_volume: 120,
        put_volume: 80,
        total_volume: 200,
      },
    }],
  };
}

const failureEndpoints = [classifyOccEndpointResponse({ statusCode: 500, body: "provider failed" })];

// Sequential all-eligible runs finalize recovery state on the last batch only.
{
  const firstBatch = parseArgs(["--all-eligible", "--batch-size", "250", "--batch-index", "0"]);
  const finalBatch = parseArgs(["--all-eligible", "--batch-size", "250", "--batch-index", "3"]);
  const selectedBatch = { eligible_count: 1000 };
  assert.equal(shouldManageOccLkg({ args: firstBatch, universe: selectedBatch, selectedTickers: 250 }), false);
  assert.equal(shouldManageOccLkg({ args: finalBatch, universe: selectedBatch, selectedTickers: 250 }), true);
  assert.equal(shouldManageOccLkg({
    args: parseArgs(["--all-eligible", "--batch-size", "250", "--batch-index", "99"]),
    universe: { eligible_count: 1000 },
    selectedTickers: 0,
  }), false, "an out-of-range batch index with zero selected tickers cannot mutate shared recovery state");
  assert.equal(shouldManageOccLkg({
    args: parseArgs(["--all-eligible", "--batch-size", "250", "--batch-index", "3", "--date", "20260716"]),
    universe: selectedBatch,
    selectedTickers: 250,
  }), false, "manual date/backfill runs never mutate shared recovery state");
}

// Detection-floor registration and public-safe payload contract.
{
  const lane = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((row) => row.id === OCC_LANE_ID);
  assert.ok(lane);
  assert.equal(lane.enforcement, "live");
  assert.equal(lane.kpi_required, true);

  const document = outputDocument("2026-07-14", "seed-run");
  assert.equal(validOccOutputDocument(document), true);
  assert.equal(occOutputSourceAsOf(document), "2026-07-14");
  assert.equal(document.raw_policy.raw_cache_public, false);
  assert.equal(document.raw_policy.third_party_raw_public, false);
  assert.ok(!Object.prototype.hasOwnProperty.call(document, "raw_rows"));
  assert.equal(validOccOutputDocument({ ...document, rows: [{ ...document.rows[0], source_date: null }] }), false,
    "honest-null is not inferred for OCC rows; a missing provider date is rejected");
  assert.throws(() => buildOccLkgCandidate({
    repoRoot: makeRoot("mismatched-source"),
    candidateDocument: {
      ...document,
      current_attempt: readyAttempt("2026-07-15", "mismatched-run"),
    },
    run: naturalRun("mismatched-run", "2026-07-15T12:00:00.000Z"),
  }), /source date is not bound to this run's ready provider rows/);
}

// Production-shaped holiday walkback: the holiday target is unavailable, but
// the newest trading date in the candidate window is served. This is not a
// failure and must not fabricate a recovery on the next natural run.
{
  const root = makeRoot("holiday");
  const seedDocument = outputDocument("2026-07-02", "seed-run");
  writeCanonical(root, seedDocument);
  const seed = applyOccLkgStore({
    repoRoot: root,
    markerPath: markerPath(root),
    candidateDocument: seedDocument,
    dates: ["20260702"],
    currentAttempt: seedDocument.current_attempt,
    endpointResults: [],
    run: naturalRun("seed-run", "2026-07-02T12:00:00.000Z"),
  });
  assert.equal(seed.kind, "success");

  const nonTradingOnly = applyOccLkgStore({
    repoRoot: root,
    markerPath: markerPath(root),
    candidateDocument: null,
    dates: ["20260703"],
    currentAttempt: { ...readyAttempt("2026-07-03", "nontrading-run"), status: "unavailable", served_source_date: null },
    endpointResults: failureEndpoints,
    run: naturalRun("nontrading-run", "2026-07-03T11:00:00.000Z"),
  });
  assert.equal(nonTradingOnly.kind, "expected_absence");
  assert.deepEqual(readJson(indexPath(root)).retry_set, []);

  const holidayDocument = outputDocument("2026-07-02", "holiday-run");
  holidayDocument.current_attempt = {
    ...holidayDocument.current_attempt,
    observed_at: "2026-07-03T12:00:00.000Z",
    target_source_date: "2026-07-03",
    served_source_date: "2026-07-02",
    status: "degraded_walkback",
    fallback_active: true,
    message: "fixture holiday target served by prior trading-day walkback",
  };
  const holiday = applyOccLkgStore({
    repoRoot: root,
    markerPath: markerPath(root),
    candidateDocument: holidayDocument,
    dates: ["20260703", "20260702", "20260701"],
    currentAttempt: holidayDocument.current_attempt,
    endpointResults: failureEndpoints,
    run: naturalRun("holiday-run", "2026-07-03T12:00:00.000Z"),
  });
  assert.equal(holiday.kind, "not_newer");
  const holidayState = readJson(indexPath(root));
  assert.deepEqual(holidayState.retry_set, []);
  assert.equal(holidayState.items[OCC_LKG_KEY].resolution_state, "fresh_primary");
  assert.equal(occFreshnessMarkerSourceAsOf(readJson(markerPath(root))), "2026-07-02");
  assert.deepEqual(projectRecoveryRecoveredSet(holidayState, OCC_LANE_ID), []);

  const nextTradingDocument = outputDocument("2026-07-06", "next-trading-run");
  const nextTrading = applyOccLkgStore({
    repoRoot: root,
    markerPath: markerPath(root),
    candidateDocument: nextTradingDocument,
    dates: ["20260706", "20260705", "20260704", "20260703", "20260702"],
    currentAttempt: nextTradingDocument.current_attempt,
    endpointResults: [],
    run: naturalRun("next-trading-run", "2026-07-06T12:00:00.000Z"),
  });
  assert.equal(nextTrading.kind, "success");
  assert.equal(nextTrading.recovered, false);
  const nextTradingState = readJson(indexPath(root));
  assert.deepEqual(nextTradingState.retry_set, []);
  assert.deepEqual(projectRecoveryRecoveredSet(nextTradingState, OCC_LANE_ID), []);
}

// Owner-approved dispatch chaos uses the real OCC failure branch: the current
// marker remains byte-identical, its public-safe LKG is retained, and retry is
// parked against the injected run.
{
  const root = makeRoot("controlled-failure");
  const seedDocument = outputDocument("2026-07-02", "seed-run");
  writeCanonical(root, seedDocument);
  applyOccLkgStore({
    repoRoot: root,
    markerPath: markerPath(root),
    candidateDocument: seedDocument,
    dates: ["20260702"],
    currentAttempt: seedDocument.current_attempt,
    endpointResults: [],
    run: naturalRun("seed-run", "2026-07-02T12:00:00.000Z"),
  });
  const markerBefore = fs.readFileSync(markerPath(root));

  const candidateDocument = outputDocument("2026-07-02", "chaos-run");
  candidateDocument.current_attempt = {
    ...candidateDocument.current_attempt,
    observed_at: "2026-07-03T12:00:00.000Z",
    target_source_date: "2026-07-03",
    served_source_date: "2026-07-02",
    status: "degraded_walkback",
    fallback_active: true,
  };
  const injected = applyOccLkgStore({
    repoRoot: root,
    markerPath: markerPath(root),
    candidateDocument,
    dates: ["20260703", "20260702", "20260701"],
    currentAttempt: candidateDocument.current_attempt,
    endpointResults: [],
    run: dispatchRun("chaos-run", "2026-07-03T12:00:00.000Z"),
    controlledFailure: true,
  });
  assert.equal(injected.kind, "failure");
  assert.equal(injected.reason, "controlled_failure");
  assert.equal(injected.degraded, true);
  assert.equal(injected.corrupt, false);
  assert.deepEqual(injected.retrySet, [OCC_LKG_KEY]);
  assert.deepEqual(fs.readFileSync(markerPath(root)), markerBefore, "controlled failure cannot advance the marker");
  assert.deepEqual(fs.readFileSync(lkgPath(root)), markerBefore, "controlled failure retains the marker as LKG");
  const state = readJson(indexPath(root));
  assert.equal(state.items[OCC_LKG_KEY].resolution_state, "lkg_primary");
  assert.equal(state.items[OCC_LKG_KEY].latest_failure.run_id, "chaos-run");
  assert.equal(state.items[OCC_LKG_KEY].latest_failure.reason, "controlled_failure");
}

// The producer-level dispatch path must short-circuit provider/source writes,
// record the real LKG failure on the final covered batch, and leave later empty
// workflow batches unable to overwrite that evidence.
{
  const root = makeRoot("controlled-build");
  const seedDocument = outputDocument("2026-07-16", "seed-run");
  writeCanonical(root, seedDocument);
  applyOccLkgStore({
    repoRoot: root,
    markerPath: markerPath(root),
    candidateDocument: seedDocument,
    dates: ["20260716"],
    currentAttempt: seedDocument.current_attempt,
    endpointResults: [],
    run: naturalRun("seed-run", "2026-07-16T12:00:00.000Z"),
  });
  const markerBefore = fs.readFileSync(markerPath(root));
  const canonicalBefore = fs.readFileSync(canonicalPath(root));
  const attemptShardPath = path.join(root, "attempts", `${OCC_LANE_ID}.json`);
  const cacheDir = path.join(root, "cache");
  let requests = 0;
  const injected = await build(parseArgs([
    "--all-eligible",
    "--batch-size", "1000",
    "--batch-index", "0",
  ]), {
    request: async () => {
      requests += 1;
      throw new Error("controlled OCC failure must not call the provider");
    },
    cacheDir,
    attemptShardPath,
    observedAt: "2026-07-17T12:00:00.000Z",
    attemptId: "occ-controlled-build-attempt",
    lkgRepoRoot: root,
    lkgMarkerPath: markerPath(root),
    runId: "controlled-build-run",
    runAttempt: 1,
    eventName: "workflow_dispatch",
    controlledFailureLanes: "occ_options_volume",
  });
  assert.equal(requests, 0);
  assert.equal(injected.controlled_failure, true);
  assert.equal(injected.injection_applied, true);
  assert.equal(injected.status, "recorded");
  assert.equal(injected.reason, "controlled_failure");
  assert.equal(injected.wrote, false);
  assert.equal(injected.source_artifacts_written, false);
  assert.equal(injected.recovery_state_written, true);
  assert.equal(fs.existsSync(cacheDir), false, "controlled failure cannot create an OCC raw cache");
  assert.deepEqual(fs.readFileSync(markerPath(root)), markerBefore);
  assert.deepEqual(fs.readFileSync(canonicalPath(root)), canonicalBefore);
  const attemptBeforeTail = fs.readFileSync(attemptShardPath);
  const stateBeforeTail = fs.readFileSync(indexPath(root));
  const state = JSON.parse(stateBeforeTail);
  assert.equal(state.items[OCC_LKG_KEY].latest_failure.run_id, "controlled-build-run");
  assert.equal(state.items[OCC_LKG_KEY].latest_failure.reason, "controlled_failure");
  assert.deepEqual(state.retry_set, [OCC_LKG_KEY]);

  const emptyTail = await build(parseArgs([
    "--all-eligible",
    "--batch-size", "250",
    "--batch-index", "4",
  ]), {
    request: async () => {
      requests += 1;
      throw new Error("empty controlled OCC tail must not call the provider");
    },
    cacheDir,
    attemptShardPath,
    observedAt: "2026-07-17T12:05:00.000Z",
    attemptId: "occ-controlled-empty-tail",
    lkgRepoRoot: root,
    lkgMarkerPath: markerPath(root),
    runId: "controlled-build-run",
    runAttempt: 1,
    eventName: "workflow_dispatch",
    controlledFailureLanes: "occ_options_volume",
  });
  assert.equal(emptyTail.status, "incomplete_coverage");
  assert.equal(emptyTail.injection_applied, false);
  assert.equal(requests, 0);
  assert.deepEqual(fs.readFileSync(attemptShardPath), attemptBeforeTail,
    "empty tail cannot overwrite the injected attempt evidence");
  assert.deepEqual(fs.readFileSync(indexPath(root)), stateBeforeTail,
    "empty tail cannot overwrite the injected recovery state");
}

// A fallback older than the newest trading date remains a real failure.
{
  const root = makeRoot("stale-walkback");
  const seedDocument = outputDocument("2026-07-01", "seed-run");
  writeCanonical(root, seedDocument);
  applyOccLkgStore({
    repoRoot: root,
    markerPath: markerPath(root),
    candidateDocument: seedDocument,
    dates: ["20260701"],
    currentAttempt: seedDocument.current_attempt,
    endpointResults: [],
    run: naturalRun("seed-run", "2026-07-01T12:00:00.000Z"),
  });
  const staleDocument = outputDocument("2026-07-01", "stale-run");
  staleDocument.current_attempt = {
    ...staleDocument.current_attempt,
    observed_at: "2026-07-03T12:00:00.000Z",
    target_source_date: "2026-07-03",
    served_source_date: "2026-07-01",
    status: "degraded_walkback",
    fallback_active: true,
  };
  const stale = applyOccLkgStore({
    repoRoot: root,
    markerPath: markerPath(root),
    candidateDocument: staleDocument,
    dates: ["20260703", "20260702", "20260701"],
    currentAttempt: staleDocument.current_attempt,
    endpointResults: failureEndpoints,
    run: naturalRun("stale-run", "2026-07-03T12:00:00.000Z"),
  });
  assert.equal(stale.kind, "failure");
  assert.deepEqual(stale.retrySet, [OCC_LKG_KEY]);
}

// Full failure -> retained LKG -> natural provider-bound recovery.
{
  const root = makeRoot("cycle");
  const seedDocument = outputDocument("2026-07-14", "seed-run");
  writeCanonical(root, seedDocument);
  applyOccLkgStore({
    repoRoot: root,
    markerPath: markerPath(root),
    candidateDocument: seedDocument,
    dates: ["20260714"],
    currentAttempt: seedDocument.current_attempt,
    endpointResults: [],
    run: naturalRun("seed-run", "2026-07-14T12:00:00.000Z"),
  });
  const seedMarker = readJson(markerPath(root));
  assert.equal(validOccFreshnessMarker(seedMarker), true);
  assert.equal(occFreshnessMarkerSourceAsOf(seedMarker), "2026-07-14");
  assert.ok(!Object.prototype.hasOwnProperty.call(seedMarker, "rows"));

  const failedAttempt = {
    ...readyAttempt("2026-07-15", "chaos-run"),
    status: "unavailable",
    served_source_date: null,
  };
  const failed = applyOccLkgStore({
    repoRoot: root,
    markerPath: markerPath(root),
    candidateDocument: null,
    dates: ["20260715"],
    currentAttempt: failedAttempt,
    endpointResults: failureEndpoints,
    run: dispatchRun("chaos-run", "2026-07-15T12:00:00.000Z"),
  });
  assert.equal(failed.kind, "failure");
  assert.equal(failed.degraded, true);
  assert.equal(failed.corrupt, false);
  assert.deepEqual(failed.retrySet, [OCC_LKG_KEY]);
  assert.deepEqual(readJson(lkgPath(root)), seedMarker, "only the public-safe freshness marker is retained; raw CSV rows are never stored");

  const retryState = readJson(indexPath(root));
  const retrySet = projectRecoveryRetrySet(retryState, OCC_LANE_ID);
  assert.equal(retrySet.length, 1);
  assert.equal(retrySet[0].key, OCC_LKG_KEY);
  assert.equal(retrySet[0].failure_run_id, "chaos-run");

  const recoveredDocument = outputDocument("2026-07-16", "manual-run");
  const dispatchRecovery = applyOccLkgStore({
    repoRoot: root,
    markerPath: markerPath(root),
    candidateDocument: recoveredDocument,
    dates: ["20260716"],
    currentAttempt: recoveredDocument.current_attempt,
    endpointResults: [],
    run: dispatchRun("manual-run", "2026-07-16T12:00:00.000Z"),
  });
  assert.equal(dispatchRecovery.kind, "recovery_requires_schedule");
  assert.equal(occFreshnessMarkerSourceAsOf(readJson(markerPath(root))), "2026-07-14");

  const sameSourceDocument = outputDocument("2026-07-14", "same-source-run");
  const sameSource = applyOccLkgStore({
    repoRoot: root,
    markerPath: markerPath(root),
    candidateDocument: sameSourceDocument,
    dates: ["20260714"],
    currentAttempt: sameSourceDocument.current_attempt,
    endpointResults: [],
    run: naturalRun("same-source-run", "2026-07-16T13:00:00.000Z"),
  });
  assert.equal(sameSource.kind, "not_promotable");
  assert.equal(sameSource.reason, "recovery_not_advanced_by_provider");

  const naturalDocument = outputDocument("2026-07-16", "natural-recovery-run");
  const naturalRecovery = applyOccLkgStore({
    repoRoot: root,
    markerPath: markerPath(root),
    candidateDocument: naturalDocument,
    dates: ["20260716"],
    currentAttempt: naturalDocument.current_attempt,
    endpointResults: [],
    run: naturalRun("natural-recovery-run", "2026-07-16T14:00:00.000Z"),
  });
  assert.equal(naturalRecovery.kind, "success");
  assert.equal(naturalRecovery.recovered, true);
  assert.equal(occFreshnessMarkerSourceAsOf(readJson(markerPath(root))), "2026-07-16");

  const recoveredState = readJson(indexPath(root));
  assert.deepEqual(recoveredState.retry_set, []);
  const recoveredSet = projectRecoveryRecoveredSet(recoveredState, OCC_LANE_ID);
  assert.equal(recoveredSet.length, 1);
  assert.equal(recoveredSet[0].recovered_from_run_id, "chaos-run");
  assert.equal(recoveredSet[0].recovery_event_name, "schedule");
  assert.equal(recoveredSet[0].lkg_source_as_of, "2026-07-14");
  assert.equal(recoveredSet[0].source_as_of, "2026-07-16");
}

// Corrupted provider proof is rejected before promotion.
{
  const root = makeRoot("proof");
  const seedDocument = outputDocument("2026-07-14", "seed-run");
  writeCanonical(root, seedDocument);
  applyOccLkgStore({
    repoRoot: root,
    markerPath: markerPath(root),
    candidateDocument: seedDocument,
    dates: ["20260714"],
    currentAttempt: seedDocument.current_attempt,
    endpointResults: [],
    run: naturalRun("seed-run", "2026-07-14T12:00:00.000Z"),
  });
  const store = new LaneLkgStore({ repoRoot: root, laneId: OCC_LANE_ID });
  store.recordFailure({
    artifacts: [{
      key: OCC_LKG_KEY,
      canonicalPath: markerPath(root),
      validateDocument: validOccFreshnessMarker,
      sourceAsOf: occFreshnessMarkerSourceAsOf,
    }],
    run: dispatchRun("chaos-run", "2026-07-15T12:00:00.000Z"),
    reason: "http_error",
  });
  const run = naturalRun("natural-run", "2026-07-16T12:00:00.000Z");
  const candidate = buildOccLkgCandidate({
    repoRoot: root,
    markerPath: markerPath(root),
    candidateDocument: outputDocument("2026-07-16", "natural-run"),
    run,
  });
  candidate.provider_observation.payload_sha256 = "0".repeat(64);
  assert.throws(() => store.evaluatePromotionCandidates([candidate], run), /provider observation sha256 is not payload-bound/);
}

console.log("test-fetch-fenok-occ-lkg-recovery: ok");
