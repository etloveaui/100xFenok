#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  canonicalHistoryStateAfterRun,
  isDaily1yReport,
  isProfileConsistent,
  reportClassificationDate,
  reportProfile,
} from "./history-gap-profile.mjs";

const report = {
  generated_at: "2026-07-10T00:00:00.000Z",
  classification_as_of: "2026-07-09T23:59:59.999Z",
  required_history_periods: ["daily_1y"],
  report_profile: {
    key: "daily_1y",
    required_history_periods: ["daily_1y"],
    generated_at: "2026-07-10T00:00:00.000Z",
    classification_as_of: "2026-07-09T23:59:59.999Z",
  },
};
assert.equal(isProfileConsistent(report), true);
assert.equal(isDaily1yReport(report), true);
assert.deepEqual(reportProfile(report).required_history_periods, ["daily_1y"]);
assert.equal(isDaily1yReport({ ...report, report_profile: { ...report.report_profile, key: "monthly_3y,monthly_5y" } }), false);
assert.equal(isProfileConsistent({ ...report, report_profile: { ...report.report_profile, generated_at: "stale" } }), false);
assert.equal(isProfileConsistent({ ...report, classification_as_of: undefined }), false);
assert.equal(isProfileConsistent({ ...report, classification_as_of: "2026-07-10T00:00:00Z" }), false);
const profileClockDeleted = {
  ...report,
  report_profile: { ...report.report_profile, classification_as_of: undefined },
};
assert.equal(isProfileConsistent(profileClockDeleted), false);
assert.equal(reportClassificationDate(profileClockDeleted), null);
assert.equal(isProfileConsistent({
  ...report,
  classification_as_of: "2026-07-10T00:00:00.001Z",
  report_profile: { ...report.report_profile, classification_as_of: "2026-07-10T00:00:00.001Z" },
}), false);
assert.equal(isProfileConsistent({ ...report, report_profile: undefined }), false);

const canonicalState = {
  report: { generated_at: "canonical-report", counts: { fetchable: 17 } },
  plan: { generated_at: "canonical-plan", required_history_periods: ["daily_1y"], tickers: ["AAA"] },
};
const nonDefaultCandidate = {
  report: { generated_at: "non-default-report", counts: { fetchable: 999 } },
  plan: { generated_at: "non-default-plan", required_history_periods: ["monthly_3y", "monthly_5y"], tickers: ["BBB"] },
};
const canonicalCandidate = {
  report: { generated_at: "next-canonical-report", counts: { fetchable: 23 } },
  plan: { generated_at: "next-canonical-plan", required_history_periods: ["daily_1y"], tickers: ["CCC"] },
};
assert.deepStrictEqual(
  canonicalHistoryStateAfterRun(canonicalState, nonDefaultCandidate, ["monthly_3y", "monthly_5y"]),
  canonicalState,
);
assert.deepStrictEqual(
  canonicalHistoryStateAfterRun(canonicalState, canonicalCandidate, ["daily_1y"]),
  canonicalCandidate,
);
console.log("test-history-gap-profile: ok");
