#!/usr/bin/env node
import assert from "node:assert/strict";
import { isDaily1yReport, isProfileConsistent, reportProfile } from "./history-gap-profile.mjs";

const report = {
  generated_at: "2026-07-10T00:00:00.000Z",
  required_history_periods: ["daily_1y"],
  report_profile: {
    key: "daily_1y",
    required_history_periods: ["daily_1y"],
    generated_at: "2026-07-10T00:00:00.000Z",
  },
};
assert.equal(isProfileConsistent(report), true);
assert.equal(isDaily1yReport(report), true);
assert.deepEqual(reportProfile(report).required_history_periods, ["daily_1y"]);
assert.equal(isDaily1yReport({ ...report, report_profile: { ...report.report_profile, key: "monthly_3y,monthly_5y" } }), false);
assert.equal(isProfileConsistent({ ...report, report_profile: { ...report.report_profile, generated_at: "stale" } }), false);
assert.equal(isProfileConsistent({ ...report, report_profile: undefined }), false);
console.log("test-history-gap-profile: ok");
