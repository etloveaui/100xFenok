#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  applyTickerBatch,
  build,
  buildNoRecordEvidence,
  buildRowsForTest,
  candidateDates,
  estimateMaxLiveRequests,
  mergeNoRecordEvidence,
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
const emptyCsv = "quantity,underlying,symbol,actype,porc,exchange,actdate\n";

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
assert.throws(
  () => parseArgs(["--reference-only", "--s0-occ-missing"]),
  /Choose exactly one OCC ticker selector/,
);

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

const manifestDir = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-occ-test-"));
const missingManifest = path.join(manifestDir, "s0-occ-missing.json");
fs.writeFileSync(
  missingManifest,
  JSON.stringify({ tickers: ["AAPL", "BRK.B", "BRK-A", "MSFT", "ZZZZ"] }),
  "utf8",
);
const s0MissingPlan = await build(parseArgs([
  "--s0-occ-missing",
  "--eligible-manifest",
  missingManifest,
  "--batch-size",
  "2",
  "--plan-only",
]));
assert.equal(s0MissingPlan.collection_mode, "s0_occ_missing_batched");
assert.equal(s0MissingPlan.selected_tickers, 2);
assert.deepEqual(s0MissingPlan.sample, ["MSFT", "ZZZZ"]);
assert.ok(!s0MissingPlan.sample.includes("AAPL"), "covered OCC ticker must be skipped by --s0-occ-missing");
assert.equal(s0MissingPlan.missing_selector.excluded_count, 2);
assert.ok(s0MissingPlan.missing_selector.excluded_sample.includes("BRK.B"));
assert.ok(s0MissingPlan.missing_selector.excluded_sample.includes("BRK-A"));
assert.match(s0MissingPlan.excluded_note, /dotted\/foreign suffixes/);

const noRecordResult = await build(parseArgs([
  "--tickers",
  "ZZZZ",
  "--date",
  "20260626",
  "--max-walkback-days",
  "0",
  "--no-fetch",
  "--no-write",
]));
assert.equal(noRecordResult.wrote, false);
assert.equal(noRecordResult.no_record_persisted, false);
assert.equal(noRecordResult.availability_evidence.status, "cache_missing_no_fetch");
assert.equal(noRecordResult.availability_evidence.evidence_counts.cache_missing_no_fetch, 1);

const emptyRow = buildRowsForTest({
  ticker: "NONE",
  ymd: "20260626",
  callCsv: emptyCsv,
  putCsv: emptyCsv,
});
assert.equal(emptyRow.options_activity_proxy.total_volume, 0);
assert.equal(emptyRow.options_activity_proxy.score_0_100, null);

const allEmptyEvidence = buildNoRecordEvidence({
  generatedAt: "2026-06-29T00:00:00.000Z",
  universe: { mode: "explicit_tickers", missing_selector: null },
  tickers: ["NONE"],
  dates: ["20260626"],
  dateResults: [{ ymd: "20260626", rows: [emptyRow], attempts: [] }],
  args: { noFetch: true, noWrite: true, maxRequests: 0 },
  estimatedMaxLiveRequests: 2,
});
assert.equal(allEmptyEvidence.status, "all_empty_occ_records");
assert.equal(allEmptyEvidence.evidence_counts.empty_row_count, 1);

const evidenceMerged = mergeNoRecordEvidence(
  { generated_at: "2026-06-28T00:00:00.000Z", coverage: { row_count: 1 }, rows: [row] },
  allEmptyEvidence,
);
assert.equal(evidenceMerged.rows.length, 1);
assert.equal(evidenceMerged.rows[0].ticker, "NVDA");
assert.equal(evidenceMerged.availability_evidence.status, "all_empty_occ_records");
assert.equal(evidenceMerged.availability_evidence_history.length, 1);

console.log("test-fetch-fenok-occ-options-volume: ok");
