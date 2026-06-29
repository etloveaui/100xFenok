#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  applyTickerBatch,
  build,
  buildAvailabilitySnapshot,
  buildRowsForTest,
  candidateDates,
  estimateMaxLiveRequests,
  loadS0OccMissingUniverse,
  mergeAvailabilitySnapshot,
  mergeOutputSnapshot,
  OCC_AVAILABILITY_POLICY,
  parseOccCsv,
  parseArgs,
  scoreOptionsVolume,
  summarizeTickerAvailability,
} from "./fetch-fenok-occ-options-volume.mjs";

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

assert.deepEqual(
  candidateDates({ requestedDate: "20260628", maxWalkbackDays: 4 }),
  ["20260626", "20260625", "20260624"],
);
assert.deepEqual(
  candidateDates({ requestedDate: "20260619", maxWalkbackDays: 2 }),
  ["20260619", "20260618", "20260617"],
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
assert.equal(OCC_AVAILABILITY_POLICY.availability_status, "not_verified");
assert.equal(OCC_AVAILABILITY_POLICY.exact_volume_query_release_time, null);
assert.equal(OCC_AVAILABILITY_POLICY.scheduler_guidance.initial_daily_run_kst, "08:30");
assert.ok(OCC_AVAILABILITY_POLICY.scheduler_guidance.do_not_default_to.includes("12:45 KST"));

assert.equal(scoreOptionsVolume(4045792, 2746518), 56.97);

const row = buildRowsForTest({
  ticker: "NVDA",
  ymd: "20260626",
  callCsv,
  putCsv,
});

assert.equal(row.ticker, "NVDA");
assert.equal(row.options_activity_proxy.score_0_100, 56.97);
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

const allEligiblePlan = await build(parseArgs(["--all-eligible", "--plan-only"]));
assert.equal(allEligiblePlan.collection_mode, "all_eligible_batched");
assert.ok(allEligiblePlan.eligible_count > allEligiblePlan.selected_tickers);
assert.equal(allEligiblePlan.selected_tickers, 50);
assert.equal(allEligiblePlan.request_budget.max_requests, 100);
assert.equal(allEligiblePlan.request_budget.status, "within_budget");

const overBudgetPlan = await build(parseArgs([
  "--all-eligible",
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

const s0OccMissingPlan = await build(parseArgs(["--s0-occ-missing", "--plan-only"]));
assert.equal(s0OccMissingPlan.collection_mode, "s0_occ_missing_plain_us_batched");
assert.equal(s0OccMissingPlan.eligible_count, s0OccMissing.length);
assert.equal(s0OccMissingPlan.selected_tickers, s0OccDefaultBatchSize);
assert.equal(s0OccMissingPlan.request_budget.estimated_max_live_requests, s0OccDefaultBatchSize * 2);
assert.equal(s0OccMissingPlan.request_budget.status, "within_budget");

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

const noFetchNoWrite = await build(parseArgs([
  "--tickers",
  "ZZZTEST",
  "--date",
  "20260626",
  "--max-walkback-days",
  "0",
  "--no-fetch",
  "--no-write",
]));
assert.equal(noFetchNoWrite.no_usable_rows, true);
assert.equal(noFetchNoWrite.wrote, false);
assert.equal(noFetchNoWrite.availability_summary.latest_status_counts.cache_missing_no_fetch, 1);

console.log("test-fetch-fenok-occ-options-volume: ok");
