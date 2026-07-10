#!/usr/bin/env node
import assert from "node:assert/strict";
import { buildEtfDaily1yDispatchPlan, validateEtfDaily1yDispatchPlan } from "./build-fenok-etf-daily1y-dispatch-plan.mjs";

const sourcePlan = {
  generated_at: "2026-07-10T00:00:00.000Z",
  tickers: ["bbb", "AAA"],
  counts: {
    scored_etf_count: 3,
    complete: 0,
    inception_limited: 0,
    equation_ok: true,
    matches_history_gap_report: true,
    matches_coverage_index: true,
    matches_coverage_index_daily_check: true,
  },
  source_files: {},
};
const historyGapReport = {
  required_history_periods: ["daily_1y"],
  generated_at: "2026-07-10T00:00:00.000Z",
  report_profile: {
    key: "daily_1y",
    required_history_periods: ["daily_1y"],
    generated_at: "2026-07-10T00:00:00.000Z",
  },
  daily_1y_gap: { samples: { fetchable: [{ ticker: "AAA" }, { ticker: "BBB" }] } },
};
const plan = buildEtfDaily1yDispatchPlan({ sourcePlan, historyGapReport, generatedAt: new Date("2026-07-10T01:00:00.000Z") });
assert.equal(plan.source_hash_algo, "sha256");
assert.match(plan.source_hash, /^[a-f0-9]{64}$/);
assert.equal(validateEtfDaily1yDispatchPlan(plan, sourcePlan, historyGapReport).ok, true);
const changed = { ...historyGapReport, daily_1y_gap: { samples: { fetchable: [{ ticker: "AAA" }] } } };
assert.equal(validateEtfDaily1yDispatchPlan(plan, sourcePlan, changed).ok, false);
console.log("test-fenok-etf-daily1y-dispatch-checksum: ok");
