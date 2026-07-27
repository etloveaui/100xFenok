#!/usr/bin/env node

import assert from "node:assert/strict";

import { buildEtfScoringLaneReadiness } from "./lib/etf-readiness-gate.mjs";

const greenScoredLane = {
  signalGeneratedAt: "2026-07-26T14:23:44.115Z",
  signalAgeHours: 9.46,
  historyGapGeneratedAt: "2026-07-26T14:24:14.000Z",
  historyGapAgeHours: 9.45,
  maxAgeHours: 48,
  publicReady: true,
  qaGateOk: true,
  classificationAsOf: "2026-07-26T14:23:56.710Z",
  scoredDenominatorCount: 4431,
  exactPlanScoredCount: 4431,
  scoredCompleteDaily1y: 3642,
  scoredFetchableDaily1yGap: 0,
  scoredInceptionLimitedDaily1yGap: 740,
  scoredTerminalLimitedDaily1yGap: 49,
  exactPlanCountEquationOk: true,
  historyGapDaily1yMatches: true,
  fullPrimaryFetchableRequiredHistory: 2,
  fullPrimaryMissingRequiredHistory: 684,
  fullPrimaryInceptionLimitedRequiredHistory: 259,
  fullPrimaryTerminalLimitedRequiredHistory: 423,
  fullPrimaryFetchableRows: [
    { ticker: "OUTSIDE_PLAN_A", missing: ["daily_1y"] },
    { ticker: "OUTSIDE_PLAN_B", missing: ["daily_1y"] },
  ],
};

const dependencyKiller = buildEtfScoringLaneReadiness({
  ...greenScoredLane,
  coreArtifactExists: false,
  coreReady: false,
  coreAgeHours: 49,
  coreSelectedCount: 0,
  coreFreshSelectedCount: 0,
  coreStaleSelectedCount: 1,
});

assert.equal(dependencyKiller.dailyReady, true);
assert.equal(dependencyKiller.gatedReady, true);
assert.deepEqual(dependencyKiller.dailyBlockers, []);
assert.deepEqual(dependencyKiller.gatedBlockers, []);
assert.equal(
  dependencyKiller.scoringLaneChecks.some((check) => check.id.includes("core_daily")),
  false,
  "Core Basket must not set, clear, or substitute for full ETF S3",
);
assert.equal(
  dependencyKiller.scoringLaneChecks.some((check) => check.id.includes("required_history")),
  false,
  "full-primary history gaps must not enter the scored-denominator gate",
);

const fullPrimaryDiagnostic = dependencyKiller.diagnosticChecks.find(
  (check) => check.id === "etf_no_fetchable_required_history_gap",
);
assert.equal(fullPrimaryDiagnostic?.ok, false);
assert.equal(fullPrimaryDiagnostic?.missing_required_history, 684);
assert.deepEqual(
  fullPrimaryDiagnostic?.fetchable_rows.map((row) => row.ticker),
  ["OUTSIDE_PLAN_A", "OUTSIDE_PLAN_B"],
);
assert.deepEqual(
  dependencyKiller.gatedChecks.map((check) => check.id),
  [
    "etf_signal_summary_fresh",
    "etf_history_gap_report_fresh",
    "etf_scored_daily_1y_count_equation",
    "etf_no_fetchable_daily_1y_gap",
    "public_surface_proof",
    "qa_fenok_etf_signal_gate",
  ],
);

for (const [label, mutation] of [
  ["Core missing", { coreArtifactExists: false }],
  ["Core stale", { coreAgeHours: 49 }],
  ["Core false", { coreReady: false }],
  ["Core sparse", { coreSelectedCount: 0, coreFreshSelectedCount: 0 }],
]) {
  const mutated = buildEtfScoringLaneReadiness({ ...greenScoredLane, ...mutation });
  assert.equal(mutated.dailyReady, true, `${label} must not flip full ETF S3 daily`);
  assert.equal(mutated.gatedReady, true, `${label} must not flip full ETF S3 gated`);
  console.log(`mutation ${label}: daily=true gated=true core_ignored=true`);
}

const openScoredGap = buildEtfScoringLaneReadiness({
  ...greenScoredLane,
  scoredCompleteDaily1y: 3641,
  scoredFetchableDaily1yGap: 1,
});
assert.equal(openScoredGap.dailyReady, false);
assert.equal(openScoredGap.gatedReady, false);
assert.deepEqual(openScoredGap.dailyBlockers, ["etf_no_fetchable_daily_1y_gap"]);

const brokenCountEquation = buildEtfScoringLaneReadiness({
  ...greenScoredLane,
  exactPlanScoredCount: 4432,
});
assert.equal(brokenCountEquation.dailyReady, false);
assert.deepEqual(brokenCountEquation.dailyBlockers, ["etf_scored_daily_1y_count_equation"]);

const publicBlocked = buildEtfScoringLaneReadiness({
  ...greenScoredLane,
  publicReady: false,
});
assert.equal(publicBlocked.dailyReady, true);
assert.equal(publicBlocked.gatedReady, false);
assert.deepEqual(publicBlocked.gatedBlockers, ["public_surface_proof"]);

const qaBlocked = buildEtfScoringLaneReadiness({
  ...greenScoredLane,
  qaGateOk: false,
});
assert.equal(qaBlocked.dailyReady, true);
assert.equal(qaBlocked.gatedReady, false);
assert.deepEqual(qaBlocked.gatedBlockers, ["qa_fenok_etf_signal_gate"]);

console.log("test-etf-readiness-gate: ok");
