#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  buildEtfDaily1yDispatchPlan,
  validateEtfDaily1yDispatchPlan,
} from "./build-fenok-etf-daily1y-dispatch-plan.mjs";

const sourcePlan = {
  generated_at: "2026-07-10T00:00:00.000Z",
  classification_as_of: "2026-07-09T23:59:59.000Z",
  tickers: ["GOLI"],
  source_files: {},
  counts: {
    equation_ok: true,
    matches_history_gap_report: true,
    matches_coverage_index: true,
    matches_coverage_index_daily_check: true,
  },
};
const report = {
  required_history_periods: ["daily_1y"],
  generated_at: "2026-07-10T00:00:00.000Z",
  classification_as_of: "2026-07-09T23:59:59.000Z",
  report_profile: {
    key: "daily_1y",
    required_history_periods: ["daily_1y"],
    generated_at: "2026-07-10T00:00:00.000Z",
    classification_as_of: "2026-07-09T23:59:59.000Z",
  },
  daily_1y_gap: { samples: { fetchable: [{ ticker: "GOLI" }] } },
};
const payload = buildEtfDaily1yDispatchPlan({ sourcePlan, historyGapReport: report, generatedAt: new Date("2026-07-10T00:01:00.000Z") });
assert.equal(validateEtfDaily1yDispatchPlan(payload, sourcePlan, report).ok, true);
assert.equal(payload.source_classification_as_of, report.classification_as_of);

const staleReport = { ...report, generated_at: "2026-07-09T00:00:00.000Z" };
const staleResult = validateEtfDaily1yDispatchPlan(payload, sourcePlan, staleReport);
assert.equal(staleResult.ok, false);
assert.ok(staleResult.errors.includes("source hash binding mismatch"));

const badProfile = { ...report, report_profile: { ...report.report_profile, key: "monthly_3y" } };
assert.throws(
  () => buildEtfDaily1yDispatchPlan({ sourcePlan, historyGapReport: badProfile }),
  /history gap report profile mismatch/,
);
assert.ok(validateEtfDaily1yDispatchPlan(payload, sourcePlan, badProfile).errors.includes("history gap report profile mismatch"));

const mixedPayload = structuredClone(payload);
mixedPayload.counts.source_matches_history_gap_report = false;
const mixedResult = validateEtfDaily1yDispatchPlan(mixedPayload, sourcePlan, report);
assert.equal(mixedResult.ok, false);
assert.ok(mixedResult.errors.includes("source_matches_history_gap_report must be true"));

const mismatchedClockPlan = { ...sourcePlan, classification_as_of: "2026-07-09T23:59:58.000Z" };
assert.throws(
  () => buildEtfDaily1yDispatchPlan({ sourcePlan: mismatchedClockPlan, historyGapReport: report }),
  /classification_as_of must match/,
);

console.log("test-fenok-etf-daily1y-dispatch-plan: ok");
