#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  applyTickerBatch,
  build,
  buildAvailabilitySnapshot,
  buildCoverage,
  buildOccBatchAttempt,
  controlledOccFailureDisposition,
  buildRowsForTest,
  candidateDates,
  classifyOccEndpointResponse,
  detectOccMissingTradingDays,
  enforceOccRequestBudget,
  estimateMaxLiveRequests,
  loadS0OccClassShareUniverse,
  loadS0OccMissingUniverse,
  loadS0OccPartialMissingUniverse,
  mergeAvailabilitySnapshot,
  mergeOccCurrentAttempt,
  mergeOutputSnapshot,
  OCC_AVAILABILITY_POLICY,
  OCC_PERSISTENCE_POLICY,
  occOutputSourceAsOf,
  parseControlledFailureLanes,
  parseOccCsv,
  parseArgs,
  planOccMissingDayBackfill,
  reduceOccEndpointResults,
  retainLatestTickerSourceDates,
  scoreOptionsLogRatio,
  scoreOptionsVolume,
  summarizeDateAttempt,
  summarizeTickerAvailability,
} from "./fetch-fenok-occ-options-volume.mjs";

assert.equal(
  occOutputSourceAsOf({
    rows: [
      { source_date: "20260716" },
      { source_date: "20260718" },
      { source_date: "20260717" },
    ],
  }),
  "2026-07-18",
  "OCC source_as_of must use the provider-max source date",
);
assert.equal(
  occOutputSourceAsOf({ rows: [{ source_date: "" }, { source_date: "invalid" }] }),
  null,
  "OCC source_as_of must stay honestly null without a valid provider date",
);

assert.deepEqual(parseControlledFailureLanes("", "schedule"), []);
assert.deepEqual(
  parseControlledFailureLanes(" occ_options_volume , finra_short_volume ", "workflow_dispatch"),
  ["occ_options_volume", "finra_short_volume"],
);
assert.deepEqual(
  parseControlledFailureLanes("finra_short_volume", "workflow_dispatch"),
  ["finra_short_volume"],
  "a valid FINRA-only injection must not imply OCC injection",
);
assert.throws(
  () => parseControlledFailureLanes("occ_options_volume,", "workflow_dispatch"),
  /empty controlled failure lane token/,
);
assert.throws(
  () => parseControlledFailureLanes("occ_options_volume,unknown", "workflow_dispatch"),
  /unknown controlled failure lane: unknown/,
);
assert.throws(
  () => parseControlledFailureLanes("occ_options_volume", "schedule"),
  /controlled failure lanes are allowed only for workflow_dispatch/,
);
assert.deepEqual(
  controlledOccFailureDisposition({
    args: parseArgs(["--all-eligible", "--batch-size", "2", "--batch-index", "0"]),
    universe: { eligible_count: 5 },
    selectedTickers: 2,
  }),
  {
    action: "defer",
    final_batch: false,
    batch_window_end: 2,
    remaining_after_batch_window: 3,
  },
);
assert.deepEqual(
  controlledOccFailureDisposition({
    args: parseArgs(["--all-eligible", "--batch-size", "2", "--batch-index", "2"]),
    universe: { eligible_count: 5 },
    selectedTickers: 1,
  }),
  {
    action: "inject",
    final_batch: true,
    batch_window_end: 5,
    remaining_after_batch_window: 0,
  },
);
assert.deepEqual(
  controlledOccFailureDisposition({
    args: parseArgs(["--all-eligible", "--batch-size", "2", "--batch-index", "3"]),
    universe: { eligible_count: 5 },
    selectedTickers: 0,
  }),
  {
    action: "incomplete_coverage",
    final_batch: false,
    batch_window_end: 5,
    remaining_after_batch_window: 0,
  },
  "an empty/out-of-range batch cannot claim that controlled failure was injected",
);
assert.throws(
  () => parseControlledFailureLanes("finra_short_volume", "local"),
  /controlled failure lanes are allowed only for workflow_dispatch/,
);

const callCsv = [
  "quantity,underlying,symbol,actype,porc,exchange,actdate",
  "4000000,NVDA,NVDA,C,C,CBOE,06/26/2026,",
  "45792,NVDA,NVDA,C,C,AMEX,06/26/2026,",
].join("\n");

const putCsv = [
  "quantity,underlying,symbol,actype,porc,exchange,actdate",
  "2700000,NVDA,NVDA,C,P,CBOE,06/26/2026,",
  "46518,NVDA,NVDA,C,P,AMEX,06/26/2026,",
].join("\n");

const callRows = parseOccCsv(callCsv);
assert.equal(callRows.length, 2);
assert.equal(callRows[0].quantity, 4000000);
assert.equal(callRows[0].porc, "C");

const readyEndpoint = classifyOccEndpointResponse({ statusCode: 200, body: callCsv });
assert.equal(readyEndpoint.status, "ready");
assert.deepEqual(readyEndpoint.attempt.assertions, [{ id: "csv_rows", passed: true }]);
const noRecordEndpoint = classifyOccEndpointResponse({ statusCode: 200, body: "No record(s) found" });
assert.equal(noRecordEndpoint.expectedUnavailable, true);
assert.equal(reduceOccEndpointResults([noRecordEndpoint, readyEndpoint]).status, "ready");
assert.equal(reduceOccEndpointResults([noRecordEndpoint]).reason, "workflow_unobserved");
const headerOnlyEndpoint = classifyOccEndpointResponse({
  statusCode: 200,
  body: "quantity,underlying,symbol,actype,porc,exchange,actdate\n",
});
assert.equal(headerOnlyEndpoint.expectedUnavailable, false);
assert.equal(reduceOccEndpointResults([headerOnlyEndpoint, readyEndpoint]).reason, "empty_payload");
const semanticErrorEndpoint = classifyOccEndpointResponse({
  statusCode: 200,
  body: "Report date cannot be greater than 07/14/2026",
});
assert.equal(semanticErrorEndpoint.reason, "decode_error");
assert.equal(semanticErrorEndpoint.expectedUnavailable, true);
assert.equal(reduceOccEndpointResults([semanticErrorEndpoint, readyEndpoint]).status, "ready");

// The date sentinel must match the WHOLE body. A prefix anchor would accept any
// payload that merely started with the sentence, and because expectedUnavailable
// rows are excluded from both the reducer and the systemic scan, an all-endpoint
// failure shaped that way would reduce to workflow_unobserved and exit 0 as
// degraded while a real decode failure went unreported.
for (const contaminated of [
  "Report date cannot be greater than 07/14/2026<html><body>gateway</body></html>",
  "Report date cannot be greater than 07/14/2026\nquantity,underlying",
  "Report date cannot be greater than the configured window",
]) {
  const endpoint = classifyOccEndpointResponse({ statusCode: 200, body: contaminated });
  assert.equal(
    endpoint.expectedUnavailable,
    false,
    `a body that only starts with the sentinel must stay actionable: ${contaminated.slice(0, 48)}`,
  );
  assert.equal(endpoint.reason, "decode_error");
}
// The exact provider sentence, with or without a trailing period, still passes.
for (const exact of [
  "Report date cannot be greater than 7/4/2026",
  "Report date cannot be greater than 07/14/2026.",
  "  Report date cannot be greater than 07/14/2026  ",
]) {
  assert.equal(
    classifyOccEndpointResponse({ statusCode: 200, body: exact }).expectedUnavailable,
    true,
    `the exact provider sentence must stay expected: ${exact.trim()}`,
  );
}

const dateNotAvailableBody = "Report date cannot be greater than 7/25/2026.";
const futureDateTickers = Array.from(
  { length: 25 },
  (_, index) => `FUT${String(index + 1).padStart(2, "0")}`,
);
let futureDateRequests = 0;
const futureDateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "occ-date-not-available-"));
const futureDateResult = await build(parseArgs([
  "--tickers", futureDateTickers.join(","),
  "--date", "20260726",
  "--max-walkback-days", "0",
  "--fail-threshold", "26",
  "--sleep-ms", "0",
  "--no-write",
]), {
  request: async () => {
    futureDateRequests += 1;
    return { statusCode: 200, body: dateNotAvailableBody };
  },
  cacheDir: path.join(futureDateRoot, "cache"),
  attemptShardPath: path.join(futureDateRoot, "attempt.json"),
  observedAt: "2026-07-26T12:30:00Z",
  attemptId: "occ-date-not-available-25-test",
});
assert.equal(futureDateResult.date_attempts[0].hard_failure_count, 0);
assert.equal(futureDateRequests, 25 * 2, "25 expected-unavailable tickers must still query both OCC sides");
assert.equal(futureDateResult.date_attempts[0].stopped_fail_threshold, false);
assert.equal(futureDateResult.date_attempts[0].status_counts.date_not_available, 25);
assert.equal(futureDateResult.coverage.failed_attempts, 0);
assert.equal(futureDateResult.coverage.date_not_available_attempts, 25);

const noRecordRoot = fs.mkdtempSync(path.join(os.tmpdir(), "occ-no-record-control-"));
const noRecordResult = await build(parseArgs([
  "--tickers", "FTV",
  "--date", "20260726",
  "--max-walkback-days", "0",
  "--sleep-ms", "0",
  "--no-write",
]), {
  request: async () => ({ statusCode: 200, body: "No record(s) found" }),
  cacheDir: path.join(noRecordRoot, "cache"),
  attemptShardPath: path.join(noRecordRoot, "attempt.json"),
  observedAt: "2026-07-26T12:31:00Z",
  attemptId: "occ-no-record-control-test",
});
assert.equal(noRecordResult.date_attempts[0].hard_failure_count, 0);
assert.equal(noRecordResult.date_attempts[0].status_counts.no_record, 1);
assert.equal(noRecordResult.coverage.failed_attempts, 0);

const hardFailureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "occ-hard-failure-control-"));
const hardFailureResult = await build(parseArgs([
  "--tickers", "ERR",
  "--date", "20260726",
  "--max-walkback-days", "0",
  "--sleep-ms", "0",
  "--no-write",
]), {
  request: async () => ({ statusCode: 500, body: "provider failure" }),
  cacheDir: path.join(hardFailureRoot, "cache"),
  attemptShardPath: path.join(hardFailureRoot, "attempt.json"),
  observedAt: "2026-07-26T12:32:00Z",
  attemptId: "occ-hard-failure-control-test",
});
assert.equal(hardFailureResult.date_attempts[0].hard_failure_count, 1);
assert.equal(hardFailureResult.coverage.failed_attempts, 1);

const mixedDateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "occ-mixed-date-"));
const mixedDateResult = await build(parseArgs([
  "--tickers", "NVDA,FUTURE",
  "--date", "20260726",
  "--max-walkback-days", "0",
  "--fail-threshold", "5",
  "--sleep-ms", "0",
  "--no-write",
]), {
  request: async (url) => {
    const params = new URL(url).searchParams;
    if (params.get("symbol") === "FUTURE") {
      return { statusCode: 200, body: dateNotAvailableBody };
    }
    return {
      statusCode: 200,
      body: params.get("porc") === "C" ? callCsv : putCsv,
    };
  },
  cacheDir: path.join(mixedDateRoot, "cache"),
  attemptShardPath: path.join(mixedDateRoot, "attempt.json"),
  observedAt: "2026-07-26T12:33:00Z",
  attemptId: "occ-mixed-date-test",
});
assert.equal(mixedDateResult.batch_coverage.row_count, 1);
assert.equal(mixedDateResult.batch_coverage.failed_attempts, 0);
assert.equal(mixedDateResult.batch_coverage.date_not_available_attempts, 1);
assert.equal(mixedDateResult.date_attempts[0].status_counts.options_activity_available, 1);
assert.equal(mixedDateResult.date_attempts[0].status_counts.date_not_available, 1);
assert(
  mixedDateResult.reference_rows.some((row) => row.ticker === "NVDA"),
  "the loaded ticker must remain accepted in a mixed date",
);

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "occ-emitter-ready-"));
  const attemptShardPath = path.join(root, "occ_options_volume.json");
  const options = {
    cacheDir: path.join(root, "cache-ready"),
    attemptShardPath,
    observedAt: "2026-07-15T03:30:00Z",
    attemptId: "occ-options-volume-test-run-1",
    request: async (url) => ({
      statusCode: 200,
      body: new URL(url).searchParams.get("porc") === "C" ? callCsv : putCsv,
    }),
  };
  const result = await build(parseArgs([
    "--tickers", "NVDA",
    "--date", "20260626",
    "--max-walkback-days", "0",
    "--max-requests", "2",
    "--sleep-ms", "0",
    "--no-write",
  ]), options);
  assert.equal(result.no_usable_rows, undefined);
  let shard = JSON.parse(fs.readFileSync(attemptShardPath, "utf8"));
  assert.deepEqual(shard.attempts[0].assertions, [{ id: "csv_rows", passed: true }]);

  await build(parseArgs([
    "--tickers", "NVDA",
    "--date", "20260626",
    "--max-walkback-days", "0",
    "--max-requests", "2",
    "--sleep-ms", "0",
    "--no-write",
  ]), {
    ...options,
    cacheDir: path.join(root, "cache-rate-limited"),
    observedAt: "2026-07-15T03:31:00Z",
    request: async () => ({ statusCode: 429, body: "rate limited" }),
  });
  shard = JSON.parse(fs.readFileSync(attemptShardPath, "utf8"));
  assert.equal(shard.attempts[0].http_status, 429, "same-run later batch failure is retained");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "occ-emitter-empty-tail-"));
  const attemptShardPath = path.join(root, "occ_options_volume.json");
  const options = {
    cacheDir: path.join(root, "cache"),
    attemptShardPath,
    observedAt: "2026-07-15T03:40:00Z",
    attemptId: "occ-options-volume-test-empty-tail",
    request: async (url) => ({
      statusCode: 200,
      body: new URL(url).searchParams.get("porc") === "C" ? callCsv : putCsv,
    }),
  };
  await build(parseArgs([
    "--tickers", "NVDA",
    "--date", "20260626",
    "--max-walkback-days", "0",
    "--max-requests", "2",
    "--sleep-ms", "0",
    "--no-write",
  ]), options);
  await build(parseArgs([
    "--all-eligible",
    "--batch-size", "1",
    "--batch-index", "999999",
    "--date", "20260626",
    "--max-walkback-days", "0",
    "--no-fetch",
    "--no-write",
  ]), {
    ...options,
    observedAt: "2026-07-15T03:41:00Z",
    request: async () => { throw new Error("empty tail must not request"); },
  });
  const shard = JSON.parse(fs.readFileSync(attemptShardPath, "utf8"));
  assert.equal(shard.attempts[0].attempt_id, options.attemptId);
  assert.equal(shard.attempts[0].payload, "non_empty", "empty tail cannot erase observed same-run evidence");
}

assert.deepEqual(
  candidateDates({ requestedDate: "20260628", maxWalkbackDays: 4 }),
  ["20260626", "20260625", "20260624"],
);
assert.deepEqual(
  candidateDates({ requestedDate: "20260619", maxWalkbackDays: 2 }),
  ["20260619", "20260618", "20260617"],
);
assert.deepEqual(
  candidateDates({ requestedDate: "20260705", maxWalkbackDays: 0 }),
  ["20260703"],
);
assert.deepEqual(
  applyTickerBatch(["A", "B", "C", "D", "E"], { batchSize: 2, batchIndex: 1 }),
  ["C", "D"],
);
assert.deepEqual(
  applyTickerBatch(["A", "B", "C", "D", "E"], { startAfter: "B", batchSize: 2 }),
  ["C", "D"],
);
assert.equal(
  estimateMaxLiveRequests({ tickers: ["A", "MSFT"], dates: ["20260626", "20260625"] }),
  8,
);

const occHistoryDates = [
  "20260630", "20260701", "20260702",
  "20260706", "20260707", "20260708", "20260709", "20260710",
  "20260713", "20260714", "20260715", "20260716", "20260717",
  "20260720", "20260721", "20260722", "20260723", "20260724",
];
function occHistoryRows(countByDate) {
  return occHistoryDates.flatMap((sourceDate) => Array.from(
    { length: countByDate[sourceDate] ?? 100 },
    (_, index) => ({ ticker: `T${String(index).padStart(3, "0")}`, source_date: sourceDate }),
  ));
}

const oldestHolePlan = planOccMissingDayBackfill({
  rows: occHistoryRows({ 20260708: 0, 20260720: 0 }),
  referenceYmd: "20260724",
  normalDates: ["20260724", "20260723", "20260722"],
  attemptRef: "history-hole-run",
  attemptNumber: 1,
});
assert.deepEqual(
  oldestHolePlan.extra_dates,
  ["20260708"],
  "a history hole must add exactly one recovery date, oldest first",
);

const noHolePlan = planOccMissingDayBackfill({
  rows: occHistoryRows({}),
  referenceYmd: "20260724",
  normalDates: ["20260724", "20260723", "20260722"],
  attemptRef: "no-hole-run",
  attemptNumber: 1,
});
assert.deepEqual(noHolePlan.extra_dates, [], "complete history must add no recovery date");
assert.equal(
  estimateMaxLiveRequests({
    tickers: Array.from({ length: 250 }, (_, index) => `T${index}`),
    dates: ["20260724", "20260723", "20260722", ...noHolePlan.extra_dates],
  }),
  1500,
  "no-hole request count must remain unchanged",
);

const partialHoleDetection = detectOccMissingTradingDays({
  rows: occHistoryRows({ 20260708: 27, 20260720: 98 }),
  referenceYmd: "20260724",
});
assert.deepEqual(
  partialHoleDetection.in_lookback_holes.map((row) => row.source_date),
  ["2026-07-08"],
  "a 27%-populated day is a hole while a 98%-populated day is not",
);

const oldHoleDetection = detectOccMissingTradingDays({
  rows: occHistoryRows({ 20260701: 0 }),
  referenceYmd: "20260724",
});
assert.deepEqual(oldHoleDetection.in_lookback_holes, []);
assert.deepEqual(
  oldHoleDetection.outside_lookback_holes.map((row) => row.source_date),
  ["2026-07-01"],
  "a hole older than the lookback must be reported but not fetched",
);

const fourDateEstimate = estimateMaxLiveRequests({
  tickers: Array.from({ length: 250 }, (_, index) => `T${index}`),
  dates: ["20260724", "20260723", "20260722", "20260708"],
});
assert.equal(fourDateEstimate, 2000);
assert.doesNotThrow(() => enforceOccRequestBudget({
  estimatedMaxLiveRequests: fourDateEstimate,
  maxRequests: 2000,
}));
assert.throws(
  () => enforceOccRequestBudget({
    estimatedMaxLiveRequests: fourDateEstimate,
    maxRequests: 1500,
  }),
  /estimated 2000, max 1500/,
  "the four-date estimate must remain fail-closed at the old 1500 budget",
);

const pinnedHolePlan = planOccMissingDayBackfill({
  rows: occHistoryRows({ 20260708: 75, 20260720: 0 }),
  referenceYmd: "20260724",
  normalDates: ["20260724", "20260723", "20260722"],
  attemptRef: "history-hole-run",
  attemptNumber: 1,
  previousCurrentAttempt: {
    attempt_ref: "history-hole-run",
    attempt_number: 1,
    missing_day_backfill: { selected_source_date: "2026-07-08" },
  },
});
assert.deepEqual(
  pinnedHolePlan.extra_dates,
  ["20260708"],
  "all batches in one run must keep the original recovery day even after it crosses the hole threshold",
);

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "occ-missing-day-integration-"));
  const eligibleManifest = path.join(root, "eligible.json");
  fs.writeFileSync(eligibleManifest, `${JSON.stringify(["NVDA"])}\n`);
  const requestedDates = [];
  const result = await build(parseArgs([
    "--all-eligible",
    "--eligible-manifest", eligibleManifest,
    "--batch-size", "1",
    "--max-walkback-days", "2",
    "--max-requests", "8",
    "--sleep-ms", "0",
    "--no-write",
  ]), {
    request: async (url) => {
      const params = new URL(url).searchParams;
      requestedDates.push(params.get("reportDate"));
      return {
        statusCode: 200,
        body: params.get("porc") === "C" ? callCsv : putCsv,
      };
    },
    cacheDir: path.join(root, "cache"),
    attemptShardPath: path.join(root, "attempt.json"),
    observedAt: "2026-07-24T12:30:00Z",
    attemptId: "occ-missing-day-integration",
    runId: "history-hole-run",
    runAttempt: 1,
    referenceDate: new Date("2026-07-24T12:30:00Z"),
    publishedOutput: {
      rows: occHistoryRows({ 20260708: 0, 20260720: 0 }),
      current_attempt: null,
    },
  });
  assert.deepEqual(
    [...new Set(requestedDates)],
    ["20260724", "20260708"],
    "the live path must resolve the normal date first, then fetch only the oldest missing day",
  );
  assert.equal(result.missing_day_backfill.backfilled_source_date, "2026-07-08");
  assert.equal(result.missing_day_backfill.accepted_rows, 1);
  assert.ok(result.missing_day_backfill.holes_remaining.includes("2026-07-20"));
}
assert.equal(OCC_AVAILABILITY_POLICY.availability_status, "not_verified");
assert.equal(OCC_AVAILABILITY_POLICY.exact_volume_query_release_time, null);
assert.equal(OCC_AVAILABILITY_POLICY.scheduler_guidance.initial_daily_run_kst, "08:30");
assert.ok(OCC_AVAILABILITY_POLICY.scheduler_guidance.do_not_default_to.includes("12:45 KST"));

assert.equal(scoreOptionsVolume(999999, 999999), 50, "equal call/put volume must remain semantically balanced");
assert.equal(scoreOptionsVolume(4045792, 2746518), 55.61);
assert.equal(scoreOptionsLogRatio(-0.9), 0);
assert.equal(scoreOptionsLogRatio(-0.45), 25);
assert.equal(scoreOptionsLogRatio(0), 50);
assert.equal(scoreOptionsLogRatio(1.725), 75);
assert.equal(scoreOptionsLogRatio(3.45), 100);
assert.equal(scoreOptionsLogRatio(Number.NaN), null);

// DISTRIBUTION-SANITY: 40 evenly-spaced latest-per-ticker order statistics
// from the measured 2026-07-18 OCC log(call/put) distribution (686 rows).
const OCC_LOG_RATIO_SAMPLE = [
  -3.01762, -1.422859, -0.873283, -0.524877, -0.40718, -0.283685, -0.19601, -0.093499,
  -0.024507, 0.035916, 0.070231, 0.127307, 0.190259, 0.241347, 0.319425, 0.378749,
  0.444417, 0.510826, 0.568013, 0.6283, 0.670254, 0.740033, 0.827586, 0.905208,
  1.005739, 1.095345, 1.155933, 1.242343, 1.375154, 1.483295, 1.632166, 1.717651,
  1.956927, 2.105732, 2.353303, 2.576408, 2.931201, 3.376604, 4.147034, 8.761707,
];
const occSampleScores = OCC_LOG_RATIO_SAMPLE.map((logRatio) => (
  scoreOptionsVolume(Math.round(Math.exp(logRatio) * 1_000_000) - 1, 999_999)
));
const occSaturated = occSampleScores.filter((score) => score === 0 || score === 100).length;
assert.ok(
  occSaturated / occSampleScores.length <= 0.2,
  `net_options score saturated on ${occSaturated}/${occSampleScores.length} realistic fixtures (> 20% ceiling)`,
);

const row = buildRowsForTest({
  ticker: "NVDA",
  ymd: "20260626",
  callCsv,
  putCsv,
});

assert.equal(row.ticker, "NVDA");
assert.equal(row.options_activity_proxy.score_0_100, 55.61);
assert.equal(row.options_activity_proxy.call_volume, 4045792);
assert.equal(row.options_activity_proxy.put_volume, 2746518);
assert.equal(row.options_activity_proxy.direction, "balanced_volume_proxy");
assert.equal(row.accepted_form_policy, "both_sides_loaded");

const partialNoRecordRow = buildRowsForTest({
  ticker: "ATO",
  ymd: "20260626",
  callCsv,
  putCsv: "No record(s) found",
  putStatus: "no_record",
});
assert.equal(partialNoRecordRow.accepted_form, "ATO");
assert.equal(partialNoRecordRow.accepted_form_policy, "one_side_loaded_one_side_no_record_zero_volume_side");
assert.deepEqual(partialNoRecordRow.side_statuses, { C: "loaded", P: "no_record" });
assert.deepEqual(partialNoRecordRow.zero_volume_sides, ["P"]);
assert.equal(partialNoRecordRow.options_activity_proxy.call_volume, 4045792);
assert.equal(partialNoRecordRow.options_activity_proxy.put_volume, 0);
assert.equal(partialNoRecordRow.options_activity_proxy.total_volume, 4045792);
assert.equal(partialNoRecordRow.coverage_ratio, 0.5);

const existingOutputRow = {
  ...row,
  ticker: "AAPL",
  options_activity_proxy: {
    ...row.options_activity_proxy,
    score_0_100: 40,
  },
};
const updatedOutputRow = {
  ...row,
  ticker: "AAPL",
  options_activity_proxy: {
    ...row.options_activity_proxy,
    score_0_100: 60,
  },
};
const newOutputRow = {
  ...row,
  ticker: "MSFT",
};
const mergedOutput = mergeOutputSnapshot(
  { generated_at: "2026-06-28T00:00:00.000Z", rows: [existingOutputRow] },
  {
    generated_at: "2026-06-29T00:00:00.000Z",
    attempts: [],
    coverage: { row_count: 2 },
    rows: [updatedOutputRow, newOutputRow],
  },
);
assert.equal(mergedOutput.rows.length, 2);
assert.equal(mergedOutput.coverage.row_count, 2);
assert.equal(mergedOutput.batch_coverage.row_count, 2);
assert.equal(mergedOutput.upsert_policy.replaced_rows, 1);
assert.equal(mergedOutput.rows.find((item) => item.ticker === "AAPL").options_activity_proxy.score_0_100, 60);
assert.deepEqual(mergedOutput.persistence_policy, OCC_PERSISTENCE_POLICY);

const retainedOldFormulaRow = {
  ...row,
  ticker: "OLD",
  source_date: "20260625",
  options_activity_proxy: {
    ...row.options_activity_proxy,
    score_0_100: 99,
  },
};
const recalibratedOutput = mergeOutputSnapshot(
  { generated_at: "2026-06-28T00:00:00.000Z", rows: [retainedOldFormulaRow] },
  {
    generated_at: "2026-06-29T00:00:00.000Z",
    attempts: [],
    coverage: { row_count: 1 },
    rows: [newOutputRow],
  },
);
assert.equal(
  recalibratedOutput.rows.find((item) => item.ticker === "OLD").options_activity_proxy.score_0_100,
  55.61,
  "a formula bump must rescore retained rows from call/put volumes instead of relabeling old scores",
);

function ymdAtOffset(offset) {
  const value = new Date(Date.UTC(2026, 0, 1 + offset));
  return `${value.getUTCFullYear()}${String(value.getUTCMonth() + 1).padStart(2, "0")}${String(value.getUTCDate()).padStart(2, "0")}`;
}

const tickerADates = Array.from({ length: 101 }, (_, index) => ymdAtOffset(index));
const tickerBDates = [ymdAtOffset(0), ymdAtOffset(1)];
const retentionInput = {
  rows: [
    ...tickerADates.map((sourceDate) => ({ ticker: "A", source_date: sourceDate })),
    ...tickerBDates.map((sourceDate) => ({ ticker: "B", source_date: sourceDate })),
  ],
  side_attempts: [
    ...tickerADates.flatMap((sourceDate) => ([
      { ticker: "A", source_date: sourceDate, side: "C", attempted_form: "A" },
      { ticker: "A", source_date: sourceDate, side: "P", attempted_form: "A" },
    ])),
    ...tickerBDates.flatMap((sourceDate) => ([
      { ticker: "B", source_date: sourceDate, side: "C", attempted_form: "B" },
      { ticker: "B", source_date: sourceDate, side: "P", attempted_form: "B" },
    ])),
  ],
};
const retained = retainLatestTickerSourceDates(retentionInput);
assert.equal(retained.collections.rows.filter((item) => item.ticker === "A").length, 100);
assert.equal(retained.collections.rows.filter((item) => item.ticker === "B").length, 2,
  "one ticker advancing cannot evict an untouched ticker");
assert.equal(retained.collections.rows.some((item) => item.ticker === "A" && item.source_date === tickerADates[0]), false);
assert.equal(retained.collections.side_attempts.filter((item) => item.ticker === "A").length, 200,
  "the C/P evidence cohort is retained together for each ticker/date");
assert.equal(retained.stats.collections.rows.pruned, 1);
assert.equal(retained.stats.collections.side_attempts.pruned, 2);
const retainedAgain = retainLatestTickerSourceDates(retained.collections);
assert.deepEqual(retainedAgain.collections, retained.collections, "bounded persistence is idempotent");
assert.equal(retainedAgain.stats.collections.rows.pruned, 0);
assert.throws(() => retainLatestTickerSourceDates({ rows: [{ ticker: "A", source_date: "20260231" }] }),
  /invalid source_date/);

const allEligiblePlan = await build(parseArgs(["--all-eligible", "--plan-only"]));
assert.equal(allEligiblePlan.collection_mode, "all_eligible_batched");
assert.ok(allEligiblePlan.eligible_count > allEligiblePlan.selected_tickers);
assert.equal(allEligiblePlan.selected_tickers, 50);
assert.equal(allEligiblePlan.request_budget.max_requests, 200);
assert.equal(allEligiblePlan.request_budget.status, "within_budget");
const finraOnlyPlan = await build(parseArgs(["--all-eligible", "--plan-only"]), {
  eventName: "workflow_dispatch",
  controlledFailureLanes: "finra_short_volume",
});
assert.deepEqual(finraOnlyPlan, allEligiblePlan, "FINRA-only chaos input must leave OCC behavior byte-stable");
const incompatibleInjectionOptions = {
  eventName: "workflow_dispatch",
  controlledFailureLanes: "occ_options_volume",
};
await assert.rejects(
  () => build(parseArgs(["--all-eligible", "--plan-only"]), incompatibleInjectionOptions),
  /OCC controlled failure is incompatible with: --plan-only/,
);
await assert.rejects(
  () => build(parseArgs(["--all-eligible", "--no-fetch", "--plan-only"]), incompatibleInjectionOptions),
  /--no-fetch/,
);
await assert.rejects(
  () => build(parseArgs(["--all-eligible", "--no-write", "--plan-only"]), incompatibleInjectionOptions),
  /--no-write/,
);
await assert.rejects(
  () => build(parseArgs(["--all-eligible", "--date", "20260715", "--plan-only"]), incompatibleInjectionOptions),
  /--date/,
);
await assert.rejects(
  () => build(parseArgs(["--reference-only", "--plan-only"]), incompatibleInjectionOptions),
  /--all-eligible is required/,
);
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "occ-controlled-deferred-"));
  let requests = 0;
  const deferred = await build(parseArgs([
    "--all-eligible",
    "--batch-size", "1",
    "--batch-index", "0",
  ]), {
    ...incompatibleInjectionOptions,
    cacheDir: path.join(root, "cache"),
    attemptShardPath: path.join(root, "attempts", "occ_options_volume.json"),
    lkgRepoRoot: root,
    lkgMarkerPath: path.join(root, "marker.json"),
    request: async () => {
      requests += 1;
      throw new Error("deferred controlled failure must not request OCC");
    },
  });
  assert.equal(requests, 0);
  assert.equal(deferred.controlled_failure, true);
  assert.equal(deferred.injection_applied, false);
  assert.equal(deferred.status, "deferred");
  assert.equal(deferred.reason, "controlled_failure_deferred_until_final_all_eligible_batch");
  assert.equal(deferred.wrote, false);
  assert.equal(deferred.source_artifacts_written, false);
  assert.equal(deferred.recovery_state_written, false);
  assert.equal(deferred.collection_coverage.complete, false);
  assert.equal(deferred.collection_coverage.status, "not_attempted_controlled_failure");
  assert.equal(deferred.collection_coverage.collected_tickers, 0);
  assert.equal(deferred.collection_coverage.final_batch, false);
  assert.deepEqual(fs.readdirSync(root), [], "deferred injection must not create cache, attempt, or LKG files");
}

const overBudgetPlan = await build(parseArgs([
  "--all-eligible",
  "--date",
  "20260705",
  "--batch-size",
  "51",
  "--max-requests",
  "100",
  "--plan-only",
]));
assert.equal(overBudgetPlan.selected_tickers, 51);
assert.equal(overBudgetPlan.request_budget.estimated_max_live_requests, 102);
assert.equal(overBudgetPlan.request_budget.status, "blocked_over_budget");

const s0OccMissing = loadS0OccMissingUniverse();
const s0OccDefaultBatchSize = Math.min(50, s0OccMissing.length);
assert.ok(s0OccMissing.every((ticker) => /^[A-Z][A-Z0-9]{0,11}$/.test(ticker)));
assert.ok(!s0OccMissing.includes("BRK-A"));

const s0OccClassShare = loadS0OccClassShareUniverse();
assert.deepEqual(s0OccClassShare, ["BRK.A", "BRK.B"]);

const s0OccPartialMissing = loadS0OccPartialMissingUniverse();
const knownS0OccPartialMissingCandidates = [
  "ATO",
  "COLM",
  "FTS",
  "FTV",
  "GIB",
  "GIII",
  "LII",
  "PAG",
  "PBA",
  "RPM",
  "RS",
  "STE",
  "WLK",
];
assert.ok(s0OccPartialMissing.every((ticker) => knownS0OccPartialMissingCandidates.includes(ticker)));
assert.ok(!s0OccPartialMissing.includes("ELS"));
assert.ok(!s0OccPartialMissing.includes("NVR"));

const s0OccMissingPlan = await build(parseArgs(["--s0-occ-missing", "--plan-only"]));
assert.equal(s0OccMissingPlan.collection_mode, "s0_occ_missing_plain_us_batched");
assert.equal(s0OccMissingPlan.eligible_count, s0OccMissing.length);
assert.equal(s0OccMissingPlan.selected_tickers, s0OccDefaultBatchSize);
assert.equal(s0OccMissingPlan.request_budget.estimated_max_live_requests, s0OccDefaultBatchSize * 2);
assert.equal(s0OccMissingPlan.request_budget.status, "within_budget");

const s0OccClassSharePlan = await build(parseArgs([
  "--s0-occ-class-share",
  "--date",
  "20260626",
  "--max-requests",
  "4",
  "--plan-only",
]));
assert.equal(s0OccClassSharePlan.collection_mode, "s0_occ_class_share_accepted_form_batched");
assert.equal(s0OccClassSharePlan.eligible_count, s0OccClassShare.length);
assert.equal(s0OccClassSharePlan.selected_tickers, s0OccClassShare.length);
assert.deepEqual(s0OccClassSharePlan.sample, s0OccClassShare);
assert.equal(s0OccClassSharePlan.request_budget.estimated_max_live_requests, 4);
assert.equal(s0OccClassSharePlan.request_budget.status, "within_budget");

const s0OccPartialMissingPlan = await build(parseArgs([
  "--s0-occ-partial-missing",
  "--batch-size",
  "100",
  "--plan-only",
]));
assert.equal(s0OccPartialMissingPlan.collection_mode, "s0_occ_partial_no_record_plain_us_batched");
assert.equal(s0OccPartialMissingPlan.eligible_count, s0OccPartialMissing.length);
assert.equal(s0OccPartialMissingPlan.selected_tickers, s0OccPartialMissing.length);
assert.deepEqual(s0OccPartialMissingPlan.sample, s0OccPartialMissing);
assert.equal(s0OccPartialMissingPlan.request_budget.estimated_max_live_requests, s0OccPartialMissing.length * 2);
assert.equal(s0OccPartialMissingPlan.request_budget.status, "within_budget");

if (s0OccMissing.length >= 51) {
  const s0OccMissingOverBudget = await build(parseArgs([
    "--s0-occ-missing",
    "--batch-size",
    "51",
    "--max-requests",
    "100",
    "--plan-only",
  ]));
  assert.equal(s0OccMissingOverBudget.selected_tickers, 51);
  assert.equal(s0OccMissingOverBudget.request_budget.status, "blocked_over_budget");
}

const noRecordSummary = summarizeTickerAvailability({
  ticker: "FTV",
  ymd: "20260626",
  sideAttempts: [
    { ticker: "FTV", source_date: "20260626", side: "C", attempted_form: "FTV", status: "no_record" },
    { ticker: "FTV", source_date: "20260626", side: "P", attempted_form: "FTV", status: "no_record" },
  ],
});
assert.equal(noRecordSummary.status, "no_record");
assert.equal(noRecordSummary.accepted_form, null);
assert.equal(noRecordSummary.accepted_form_policy, null);
assert.equal(noRecordSummary.scoring_row_eligible, false);
assert.equal(noRecordSummary.coverage_row_eligible, false);
assert.equal(noRecordSummary.no_listed_options_policy_status, "pending_owner_acceptance");

const dateNotAvailableSummary = summarizeTickerAvailability({
  ticker: "FUTURE",
  ymd: "20260726",
  sideAttempts: [
    { ticker: "FUTURE", source_date: "20260726", side: "C", attempted_form: "FUTURE", status: "date_not_available" },
    { ticker: "FUTURE", source_date: "20260726", side: "P", attempted_form: "FUTURE", status: "date_not_available" },
  ],
});
assert.equal(dateNotAvailableSummary.status, "date_not_available");
assert.equal(dateNotAvailableSummary.accepted_form, null);
assert.equal(dateNotAvailableSummary.accepted_form_policy, null);
assert.equal(dateNotAvailableSummary.no_listed_options_policy_status, null);
assert.equal(dateNotAvailableSummary.evidence_policy, null);

for (const [otherStatus, expectedStatus] of [
  ["loaded", "unavailable"],
  ["no_record", "partial_no_record_or_form_gap"],
  ["cache_missing_no_fetch", "cache_missing_no_fetch"],
  ["transient_failed", "transient_failed"],
]) {
  const prioritySummary = summarizeTickerAvailability({
    ticker: "MIXED",
    ymd: "20260726",
    sideAttempts: [
      { ticker: "MIXED", source_date: "20260726", side: "C", attempted_form: "MIXED", status: otherStatus },
      { ticker: "MIXED", source_date: "20260726", side: "P", attempted_form: "MIXED", status: "date_not_available" },
    ],
  });
  assert.equal(
    prioritySummary.status,
    expectedStatus,
    `${otherStatus} must outrank a one-side date_not_available status`,
  );
}

const partialNoRecordSummary = summarizeTickerAvailability({
  ticker: "ATO",
  ymd: "20260626",
  sideAttempts: [
    { ticker: "ATO", source_date: "20260626", side: "C", attempted_form: "ATO", status: "loaded" },
    { ticker: "ATO", source_date: "20260626", side: "P", attempted_form: "ATO", status: "no_record" },
  ],
});
assert.equal(partialNoRecordSummary.status, "partial_no_record_or_form_gap");
assert.equal(partialNoRecordSummary.accepted_form, "ATO");
assert.equal(partialNoRecordSummary.accepted_form_policy, "one_side_loaded_one_side_no_record_zero_volume_side");
assert.equal(partialNoRecordSummary.scoring_row_eligible, true);
assert.equal(partialNoRecordSummary.coverage_row_eligible, true);
assert.equal(partialNoRecordSummary.no_listed_options_policy_status, null);

const availabilitySnapshot = buildAvailabilitySnapshot({
  ymd: "20260626",
  generatedAt: "2026-06-29T00:00:00.000Z",
  universe: { mode: "s0_occ_missing_plain_us_batched", tickers: ["FTV"], eligible_count: s0OccMissing.length },
  sideAttempts: [
    { ticker: "FTV", source_date: "20260626", side: "C", attempted_form: "FTV", status: "no_record" },
    { ticker: "FTV", source_date: "20260626", side: "P", attempted_form: "FTV", status: "no_record" },
  ],
  tickerAvailability: [noRecordSummary],
  requestBudget: { estimated_max_live_requests: 2, max_requests: 100 },
});
assert.equal(availabilitySnapshot.rows[0].status, "no_record");
assert.equal(availabilitySnapshot.raw_policy.private_artifact_paths_included, false);

const mergedAvailability = mergeAvailabilitySnapshot(
  { generated_at: "2026-06-28T00:00:00.000Z", rows: [], side_attempts: [] },
  availabilitySnapshot,
);
assert.equal(mergedAvailability.rows.length, 1);
assert.equal(mergedAvailability.side_attempts.length, 2);
assert.deepEqual(mergedAvailability.persistence_policy, OCC_PERSISTENCE_POLICY);

const dateFailureAttempts = [
  { ticker: "A", status: "failed" },
  { ticker: "B", status: "transient_failed" },
  { ticker: "C", status: "no_record" },
  { ticker: "D", status: "stopped_fail_threshold", fail_threshold: 2 },
];
const dateFailureSummary = summarizeDateAttempt({
  ymd: "20260708",
  rows: [],
  attempts: dateFailureAttempts,
  ticker_availability: [
    { status: "failed" }, { status: "transient_failed" }, { status: "no_record" },
  ],
});
assert.equal(dateFailureSummary.hard_failure_count, 2);
assert.equal(dateFailureSummary.stopped_fail_threshold, true);
assert.equal(buildCoverage([], dateFailureAttempts).failed_attempts, 2);
assert.equal(buildCoverage([], dateFailureAttempts).unresolved_attempts, 3);

const walkbackBatch = buildOccBatchAttempt({
  attemptRef: "28982598913",
  attemptNumber: 1,
  batchIndex: 0,
  selectedTickers: 50,
  targetYmd: "20260708",
  servedYmd: "20260707",
  dateAttempts: [
    { source_date: "2026-07-08", accepted_rows: 0, usable_rows: 0, status_counts: { failed: 25 }, hard_failure_count: 25, stopped_fail_threshold: true },
    { source_date: "2026-07-07", accepted_rows: 50, usable_rows: 50, status_counts: { options_activity_available: 50 }, hard_failure_count: 0, stopped_fail_threshold: false },
  ],
});
assert.equal(walkbackBatch.status, "degraded_walkback");
assert.equal(walkbackBatch.target_source_date, "2026-07-08");
assert.equal(walkbackBatch.served_source_date, "2026-07-07");
assert.match(walkbackBatch.message, /target 2026-07-08 was unavailable.*serving fallback dated 2026-07-07/i);

const readyBatch = buildOccBatchAttempt({
  attemptRef: "28982598913", attemptNumber: 1, batchIndex: 1, selectedTickers: 50,
  targetYmd: "20260708", servedYmd: "20260708",
  dateAttempts: [{ source_date: "2026-07-08", accepted_rows: 50, usable_rows: 50, status_counts: { options_activity_available: 50 }, hard_failure_count: 0, stopped_fail_threshold: false }],
  missingDayBackfill: {
    status: "backfilled",
    selected_source_date: "2026-07-01",
    backfilled_source_date: "2026-07-01",
    holes_remaining: ["2026-07-02"],
  },
});
let mergedAttempt = mergeOccCurrentAttempt(null, walkbackBatch);
mergedAttempt = mergeOccCurrentAttempt(mergedAttempt, readyBatch);
assert.equal(mergedAttempt.status, "degraded_walkback", "one walked-back batch keeps the whole current run degraded");
assert.equal(mergedAttempt.batches.length, 2);
assert.equal(mergedAttempt.missing_day_backfill.selected_source_date, "2026-07-01");

const emptyTail = buildOccBatchAttempt({
  attemptRef: "28982598913", attemptNumber: 1, batchIndex: 4, selectedTickers: 0,
  targetYmd: "20260708", servedYmd: null, dateAttempts: [],
});
mergedAttempt = mergeOccCurrentAttempt(mergedAttempt, emptyTail);
assert.equal(mergedAttempt.status, "degraded_walkback", "empty tail batch cannot overwrite non-empty run evidence");
assert.equal(mergedAttempt.batches.length, 3);
assert.equal(
  mergedAttempt.missing_day_backfill.backfilled_source_date,
  "2026-07-01",
  "an empty tail batch cannot erase same-run backfill visibility",
);
assert.equal(
  mergedAttempt.missing_day_backfill.status,
  "backfilled",
  "an empty tail batch cannot contradict a same-run successful backfill",
);

const unavailableBatch = buildOccBatchAttempt({
  attemptRef: "new-run", attemptNumber: 1, batchIndex: 0, selectedTickers: 10,
  targetYmd: "20260709", servedYmd: null,
  dateAttempts: [{ source_date: "2026-07-09", accepted_rows: 0, usable_rows: 0, status_counts: { failed: 10 }, hard_failure_count: 10, stopped_fail_threshold: true }],
});
const resetAttempt = mergeOccCurrentAttempt(mergedAttempt, unavailableBatch);
assert.equal(resetAttempt.status, "unavailable");
assert.equal(resetAttempt.served_source_date, null);
assert.equal(resetAttempt.batches.length, 1, "new run resets the bounded current-attempt batch list");
assert.equal(resetAttempt.missing_day_backfill, null, "new run resets prior-run backfill visibility");

const noFetchAttemptRoot = fs.mkdtempSync(path.join(os.tmpdir(), "occ-no-fetch-attempt-"));
const noFetchNoWrite = await build(parseArgs([
  "--tickers",
  "ZZZTEST",
  "--date",
  "20260626",
  "--max-walkback-days",
  "0",
  "--no-fetch",
  "--no-write",
]), {
  cacheDir: path.join(noFetchAttemptRoot, "cache"),
  attemptShardPath: path.join(noFetchAttemptRoot, "occ_options_volume.json"),
  observedAt: "2026-07-15T04:00:00Z",
  attemptId: "occ-options-volume-no-fetch-test",
});
assert.equal(noFetchNoWrite.no_usable_rows, true);
assert.equal(noFetchNoWrite.wrote, false);
assert.equal(noFetchNoWrite.availability_summary.latest_status_counts.cache_missing_no_fetch, 1);

console.log("test-fetch-fenok-occ-options-volume: ok");
