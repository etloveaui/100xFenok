#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  applyTickerBatch,
  build,
  buildRowsForTest,
  candidateDates,
  estimateMaxLiveRequests,
  mergeOutputSnapshot,
  OCC_AVAILABILITY_POLICY,
  parseOccCsv,
  parseArgs,
  scoreOptionsVolume,
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

console.log("test-fetch-fenok-occ-options-volume: ok");
