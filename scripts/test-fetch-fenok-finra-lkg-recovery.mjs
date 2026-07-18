#!/usr/bin/env node
// LKG recovery adoption for the FINRA short-volume lane.
//
// Mirrors the fetch-defillama recovery contract, adapted for an admin-private,
// per-date, holiday-bearing source:
//   (a) a genuine trading-day miss retains the last-known-good and parks retry,
//   (b) a market-holiday 403 is EXPECTED ABSENCE, never a failure,
//   (c) a natural-schedule success after a miss records recovery provenance,
//   (d) a workflow_dispatch success cannot promote a recovery (natural gate),
//   (e) the index the store writes round-trips through the KPI recovery validator.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  applyFinraLkgStore,
  buildFreshnessMarker,
  buildPayload,
  classifyFinraEndpointResponse,
  computeFinraLkgOutcome,
  FINRA_LANE_ID,
  FINRA_LKG_KEY,
  freshnessMarkerPathFor,
  freshnessMarkerSourceAsOf,
  parseFinraDailyShortVolume,
  run,
  validFreshnessMarker,
} from "./fetch-fenok-finra-daily-private.mjs";
import {
  projectRecoveryRecoveredSet,
  projectRecoveryRetrySet,
} from "./build-fenok-data-health-kpi.mjs";
import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";

function sampleFor(compactDate) {
  return [
    "Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market",
    `${compactDate}|NVDA|123|4|1000|B,Q,N`,
    `${compactDate}|BRK.B|50|0|200|Q`,
    "",
  ].join("\n");
}

// --- Controlled failure: real recordFailure, no request/history rotation ---
{
  const root = makeRoot("controlled-failure");
  const markerPath = freshnessMarkerPathFor(root);
  applyFinraLkgStore({
    ...readyInputs("20260714", "2026-07-14T04:00:00Z"),
    repoRoot: root,
    markerPath,
    run: naturalRun("seed-run", "2026-07-14T04:00:00Z"),
  });
  const markerBefore = fs.readFileSync(markerPath);
  const historyPath = path.join(root, "data", "admin", FINRA_LANE_ID, "history", `${FINRA_LKG_KEY}.json`);
  const historyBefore = fs.readFileSync(historyPath);
  let requests = 0;
  const injected = await run([
    "--from",
    "2026-07-15",
    "--to",
    "2026-07-15",
  ], {
    request: async () => {
      requests += 1;
      return { statusCode: 200, body: sampleFor("20260715") };
    },
    attemptShardPath: path.join(root, "attempts", `${FINRA_LANE_ID}.json`),
    observedAt: "2026-07-15T04:00:00Z",
    attemptId: "finra-controlled-failure-attempt",
    lkgRepoRoot: root,
    markerPath,
    runId: "controlled-failure-run",
    runAttempt: 1,
    eventName: "workflow_dispatch",
    controlledFailureLanes: "occ_options_volume,finra_short_volume",
  });
  assert.equal(requests, 0, "controlled FINRA failure must not call the provider");
  assert.equal(injected.controlled_failure, true);
  assert.equal(injected.reason, "controlled_failure");
  assert.equal(injected.degraded, true);
  assert.equal(injected.corrupt, false);
  assert.equal(injected.exit_code, 0);
  assert.deepEqual(injected.retry_set, [FINRA_LKG_KEY]);
  assert.deepEqual(fs.readFileSync(markerPath), markerBefore, "failure retains the current marker byte-for-byte");
  assert.deepEqual(fs.readFileSync(historyPath), historyBefore, "failure must not rotate marker history");
  const attempt = readJson(path.join(root, "attempts", `${FINRA_LANE_ID}.json`));
  assert.equal(attempt.attempts[0].execution, "threw");
  assert.equal(attempt.attempts[0].exception_kind, "transport");

  const state = readJson(indexPath(root));
  assert.equal(state.items[FINRA_LKG_KEY].resolution_state, "lkg_primary");
  assert.equal(state.items[FINRA_LKG_KEY].latest_failure.run_id, "controlled-failure-run");
  assert.equal(state.items[FINRA_LKG_KEY].latest_failure.reason, "controlled_failure");
  assert.deepEqual(state.retry_set, [FINRA_LKG_KEY]);
  assert.equal(fs.existsSync(lkgPath(root)), true);
}

function readyInputs(compactDate, observedAt) {
  const sample = sampleFor(compactDate);
  const endpoint = classifyFinraEndpointResponse({ statusCode: 200, body: sample }, compactDate);
  const rows = parseFinraDailyShortVolume(sample, compactDate);
  const payload = buildPayload({
    yyyymmdd: compactDate,
    sourceUrl: "https://example.test/CNMSshvol.txt",
    fetchedAt: observedAt,
    rows,
  });
  return { dates: [compactDate], endpointResults: [endpoint], results: [{ payload }] };
}

function tradingDayMissInputs(compactDate) {
  // Trading-day 403 = data genuinely absent at cron time (expectedMissing false).
  const endpoint = classifyFinraEndpointResponse({ statusCode: 403, body: "<Error>AccessDenied</Error>" }, compactDate);
  assert.equal(endpoint.expectedMissing, false, `${compactDate} must be a trading day for this fixture`);
  return { dates: [compactDate], endpointResults: [endpoint], results: [] };
}

function holidayMissInputs(compactHolidayDate) {
  const endpoint = classifyFinraEndpointResponse({ statusCode: 403, body: "<Error>AccessDenied</Error>" }, compactHolidayDate);
  assert.equal(endpoint.expectedMissing, true, `${compactHolidayDate} must be a market holiday for this fixture`);
  return { dates: [compactHolidayDate], endpointResults: [endpoint], results: [] };
}

function naturalRun(runId, observedAt) {
  return { runId, runAttempt: 1, eventName: "schedule", observedAt };
}
function dispatchRun(runId, observedAt) {
  return { runId, runAttempt: 1, eventName: "workflow_dispatch", observedAt };
}

function makeRoot(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `finra-lkg-${tag}-`));
}
function indexPath(root) {
  return path.join(root, "data", "admin", FINRA_LANE_ID, "index.json");
}
function lkgPath(root) {
  return path.join(root, "data", "admin", FINRA_LANE_ID, "lkg", `${FINRA_LKG_KEY}.json`);
}
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
function markerSourceAsOf(root) {
  const marker = readJson(freshnessMarkerPathFor(root));
  assert.equal(validFreshnessMarker(marker), true, "persisted freshness marker must be valid");
  return marker.source_as_of;
}

// --- Detection-floor lane registration -------------------------------------
{
  const lane = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((row) => row.id === FINRA_LANE_ID);
  assert.ok(lane, "FINRA short-volume must be a registered detection lane");
  assert.equal(lane.enforcement, "live", "FINRA lane is live; the recovery store depends on it staying live");
  assert.equal(lane.kpi_required, true);
}

// --- Marker validators + privacy contract ----------------------------------
{
  const sample = sampleFor("20260714");
  const rows = parseFinraDailyShortVolume(sample, "20260714");
  const payload = buildPayload({ yyyymmdd: "20260714", sourceUrl: "https://example.test", fetchedAt: "2026-07-14T04:00:00Z", rows });
  const marker = buildFreshnessMarker({ payload, generatedAt: "2026-07-14T04:00:00Z" });
  assert.equal(validFreshnessMarker(marker), true);
  assert.equal(marker.source_as_of, "2026-07-14");
  assert.equal(freshnessMarkerSourceAsOf(marker), "2026-07-14");
  assert.equal(marker.raw_public, false, "marker must never advertise the private rows as public");
  assert.equal(marker.public_mirror_allowed, false);
  assert.ok(!Object.prototype.hasOwnProperty.call(marker, "rows"), "marker must not carry short-volume rows");
  assert.match(marker.payload_sha256, /^[0-9a-f]{64}$/);
}

// --- computeFinraLkgOutcome holiday classification -------------------------
{
  const holiday = holidayMissInputs("20260703");
  assert.equal(computeFinraLkgOutcome(holiday).kind, "expected_absence");
  const miss = tradingDayMissInputs("20260715");
  assert.equal(computeFinraLkgOutcome(miss).kind, "failure");
  const ready = readyInputs("20260714", "2026-07-14T04:00:00Z");
  assert.equal(computeFinraLkgOutcome(ready).kind, "success");
}

// --- Window semantics: freshness follows the newest trading date -----------
{
  const payloadFor = (compactDate) => {
    const rows = parseFinraDailyShortVolume(sampleFor(compactDate), compactDate);
    return { payload: buildPayload({ yyyymmdd: compactDate, sourceUrl: "https://example.test", fetchedAt: "2026-07-16T04:00:00Z", rows }) };
  };

  // A holiday (2026-07-03) sits inside the window; the newest trading date
  // (2026-07-16) was collected -> success, holiday absence is irrelevant.
  const withHoliday = computeFinraLkgOutcome({
    dates: ["20260703", "20260715", "20260716"],
    results: [payloadFor("20260715"), payloadFor("20260716")],
  });
  assert.equal(withHoliday.kind, "success");
  assert.equal(withHoliday.latest.payload.date, "20260716");

  // An OLDER trading date is missing but the newest trading date is present ->
  // still success; a transient older miss must not demote a fresh lane.
  const olderMissing = computeFinraLkgOutcome({
    dates: ["20260714", "20260715", "20260716"],
    results: [payloadFor("20260715"), payloadFor("20260716")],
  });
  assert.equal(olderMissing.kind, "success");
  assert.equal(olderMissing.latest.payload.date, "20260716");

  // The NEWEST trading date is missing -> failure, even though older data exists.
  const newestMissing = computeFinraLkgOutcome({
    dates: ["20260714", "20260715", "20260716"],
    results: [payloadFor("20260714"), payloadFor("20260715")],
  });
  assert.equal(newestMissing.kind, "failure");
}

// --- (b) Holiday is not a failure ------------------------------------------
{
  const root = makeRoot("holiday");
  const seed = applyFinraLkgStore({
    ...readyInputs("20260714", "2026-07-14T04:00:00Z"),
    repoRoot: root,
    markerPath: freshnessMarkerPathFor(root),
    run: naturalRun("seed-run", "2026-07-14T04:00:00Z"),
  });
  assert.equal(seed.kind, "success");
  const afterSeed = readJson(indexPath(root));
  assert.deepEqual(afterSeed.retry_set, []);
  assert.equal(afterSeed.items[FINRA_LKG_KEY].resolution_state, "fresh_primary");

  const holiday = applyFinraLkgStore({
    ...holidayMissInputs("20260703"),
    repoRoot: root,
    markerPath: freshnessMarkerPathFor(root),
    run: naturalRun("holiday-run", "2026-07-06T04:00:00Z"),
  });
  assert.equal(holiday.kind, "expected_absence");
  assert.equal(holiday.updated, false);
  const afterHoliday = readJson(indexPath(root));
  assert.deepEqual(afterHoliday.retry_set, [], "a holiday must not park the lane in retry");
  assert.equal(afterHoliday.items[FINRA_LKG_KEY].resolution_state, "fresh_primary", "a holiday must not demote to lkg_primary");
  assert.equal(markerSourceAsOf(root), "2026-07-14", "a holiday must not overwrite the freshness marker");
}

// --- (a),(c),(d),(e) full failure -> LKG -> recovery cycle ------------------
{
  const root = makeRoot("cycle");
  const markerPath = freshnessMarkerPathFor(root);

  // seed a healthy day
  const seed = applyFinraLkgStore({
    ...readyInputs("20260714", "2026-07-14T04:00:00Z"),
    repoRoot: root,
    markerPath,
    run: naturalRun("seed-run", "2026-07-14T04:00:00Z"),
  });
  assert.equal(seed.kind, "success");
  assert.equal(markerSourceAsOf(root), "2026-07-14");

  // (a) genuine trading-day miss retains LKG + parks retry, degraded (not corrupt)
  const failed = applyFinraLkgStore({
    ...tradingDayMissInputs("20260715"),
    repoRoot: root,
    markerPath,
    run: dispatchRun("chaos-run", "2026-07-15T04:00:00Z"),
  });
  assert.equal(failed.kind, "failure");
  assert.equal(failed.reason, "http_error");
  assert.equal(failed.degraded, true);
  assert.equal(failed.corrupt, false);
  assert.deepEqual(failed.retrySet, [FINRA_LKG_KEY]);
  assert.equal(markerSourceAsOf(root), "2026-07-14", "a failure must not overwrite the freshness marker");
  const retained = readJson(indexPath(root));
  assert.equal(retained.items[FINRA_LKG_KEY].resolution_state, "lkg_primary");
  assert.equal(retained.items[FINRA_LKG_KEY].latest_failure.run_id, "chaos-run");
  assert.equal(
    retained.items[FINRA_LKG_KEY].lkg.payload_sha256,
    createHash("sha256").update(fs.readFileSync(lkgPath(root))).digest("hex"),
    "retained LKG is sha256-bound to the on-disk lkg copy",
  );

  // (e) the retry-state index round-trips through the KPI validator
  const retrySet = projectRecoveryRetrySet(retained, FINRA_LANE_ID);
  assert.equal(retrySet.length, 1);
  assert.equal(retrySet[0].key, FINRA_LKG_KEY);
  assert.equal(retrySet[0].resolution_state, "lkg_primary");
  assert.equal(retrySet[0].failure_run_id, "chaos-run");

  // (d) a workflow_dispatch success cannot promote a recovery (natural gate)
  const dispatchAttempt = applyFinraLkgStore({
    ...readyInputs("20260716", "2026-07-16T04:30:00Z"),
    repoRoot: root,
    markerPath,
    run: dispatchRun("manual-run", "2026-07-16T04:30:00Z"),
  });
  assert.equal(dispatchAttempt.kind, "recovery_requires_schedule");
  assert.equal(markerSourceAsOf(root), "2026-07-14", "a dispatch run must not advance recovery");

  // same-source natural run cannot recover (provider date not advanced)
  const sameSource = applyFinraLkgStore({
    ...readyInputs("20260714", "2026-07-16T05:00:00Z"),
    repoRoot: root,
    markerPath,
    run: naturalRun("same-source-run", "2026-07-16T05:00:00Z"),
  });
  assert.equal(sameSource.kind, "not_promotable");
  assert.equal(sameSource.reason, "recovery_not_advanced_by_provider");

  // (c) natural-schedule success with an advanced provider date recovers
  const recovered = applyFinraLkgStore({
    ...readyInputs("20260716", "2026-07-16T06:00:00Z"),
    repoRoot: root,
    markerPath,
    run: naturalRun("natural-recovery-run", "2026-07-16T06:00:00Z"),
  });
  assert.equal(recovered.kind, "success");
  assert.equal(recovered.recovered, true);
  assert.equal(markerSourceAsOf(root), "2026-07-16", "recovery advances the freshness marker");

  const finalState = readJson(indexPath(root));
  assert.deepEqual(finalState.retry_set, []);
  const item = finalState.items[FINRA_LKG_KEY];
  assert.equal(item.resolution_state, "fresh_primary");
  assert.equal(item.retry, false);
  assert.equal(item.recovered_from_run_id, "chaos-run");
  assert.equal(item.recovery_run_id, "natural-recovery-run");
  assert.equal(item.recovery_event_name, "schedule");

  // (e) the recovered-state index round-trips through the KPI validator
  const recoveredSet = projectRecoveryRecoveredSet(finalState, FINRA_LANE_ID);
  assert.equal(recoveredSet.length, 1);
  assert.equal(recoveredSet[0].key, FINRA_LKG_KEY);
  assert.equal(recoveredSet[0].recovered_from_run_id, "chaos-run");
  assert.equal(recoveredSet[0].recovery_event_name, "schedule");
  assert.equal(recoveredSet[0].lkg_source_as_of, "2026-07-14");
  assert.equal(recoveredSet[0].source_as_of, "2026-07-16");
}

// --- Backfill guard: an older-date range never regresses the marker --------
{
  const root = makeRoot("backfill");
  const markerPath = freshnessMarkerPathFor(root);
  applyFinraLkgStore({
    ...readyInputs("20260716", "2026-07-16T04:00:00Z"),
    repoRoot: root,
    markerPath,
    run: naturalRun("seed-run", "2026-07-16T04:00:00Z"),
  });
  assert.equal(markerSourceAsOf(root), "2026-07-16");
  const backfill = applyFinraLkgStore({
    ...readyInputs("20260710", "2026-07-17T04:00:00Z"),
    repoRoot: root,
    markerPath,
    run: naturalRun("backfill-run", "2026-07-17T04:00:00Z"),
  });
  assert.equal(backfill.kind, "not_newer");
  assert.equal(markerSourceAsOf(root), "2026-07-16", "a backfill of older dates must not regress the marker");
}

console.log("test-fetch-fenok-finra-lkg-recovery: ok");
