#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ARCHIVED_ERP_ROWS,
  RULE_FAMILIES,
  YOO_LOGIC_SHARED_INFERRED_RULE,
  buildCurrentExtendedYooLogicProxyRanges,
  buildCurrentIndexForecastPathRanges,
  buildCurrentInferredFenoRanges,
  buildCurrentMethodFamilyUnionRanges,
  buildHistoricalConditionalPayoutDiagnostic,
  buildHistoricalHorizonResidualValueDiagnostic,
  buildCurrentYooLogicInferredRanges,
  buildCurrentYooLogicSharedInferredRanges,
  buildRussellOfficialSnapshotDiagnostic,
  buildRussellCurrentOfficialFundamentalsDiagnostic,
  chronologicalCompetition,
  computeInferredFenoRange,
  computeYooLogicInferredRange,
  computeYooLogicLtroeCoverageSensitivity,
  computeYooLogicSharedInferredRange,
  deriveFy3RoeProxy,
  fitConditionalGridPayout,
  latticeRound,
  runArchivedRuleCalibration,
} from "./fenok-rim-rule-calibration.mjs";

assert.equal(latticeRound(0.0471), 0.045);
assert.equal(latticeRound(0.0476), 0.05);
assert.deepEqual(RULE_FAMILIES.discount.map((row) => row.horizon), [8, 8, 9, 9, 10, 10]);

// The fit winner must remain frozen even when another candidate would win after
// looking at holdout. This is the central anti-refit contract.
const sealed = chronologicalCompetition({
  cutoff: "2025-12-31",
  rows: [
    { id: "fit-a", date: "2025-01-01", x: 1, target: 1 },
    { id: "fit-b", date: "2025-06-01", x: 2, target: 2 },
    { id: "holdout", date: "2026-01-01", x: 3, target: 6 },
  ],
  candidates: [{ id: "identity" }, { id: "double" }],
  fitCandidate: (candidate) => ({
    valid: true,
    parameters: { multiplier: candidate.id === "identity" ? 1 : 2 },
    predict: (row) => row.x * (candidate.id === "identity" ? 1 : 2),
  }),
  minimumFit: 2,
  minimumHoldout: 1,
  holdoutMaeLimit: 0.1,
});
assert.equal(sealed.selected_candidate.id, "identity");
assert.equal(sealed.holdout.mae, 3);
assert.equal(sealed.status, "blocked");
assert.ok(sealed.blocking_reasons.includes("sealed_holdout_failed"));

const report = runArchivedRuleCalibration();
assert.equal(report.production_integrated, false);
assert.equal(report.verdict, "no_promotable_rule");
assert.equal(report.erp.fit_ids.length, 1);
assert.equal(report.erp.holdout_ids.length, 5);
assert.equal(report.erp.selected_candidate.id, "erp-public-base");
assert.equal(report.erp.selected_candidate.parameters.offset, 0);
assert.ok(report.erp.holdout.mae > report.erp.holdout_mae_limit);
assert.ok(report.erp.blocking_reasons.includes("sealed_holdout_failed"));
assert.ok(report.erp.rejected_candidates.some((row) => row.id === "erp-public-base-group-50bp"));
assert.equal(report.lt_roe.status, "blocked");
assert.equal(report.discount_horizon.status, "partially_identified_not_promotable");
assert.equal(report.discount_horizon.selected_candidate.horizon, 9);

// The actual five holdout rows remain immutable evidence, not fit material.
assert.deepEqual(
  ARCHIVED_ERP_ROWS.filter((row) => row.date > "2025-12-31").map((row) => row.id).sort(),
  report.erp.holdout_ids,
);

const toyRange = computeInferredFenoRange({
  id: "TOY",
  price: 100,
  book: 50,
  earnings: [10, 11, 12],
  payout: 0.4,
  riskFree: 0.04,
  publicErp: 0.05,
  normalRoe: 0.15,
});
assert.equal(toyRange.status, "inferred_range_only");
assert.equal(toyRange.range.low, toyRange.range.high);
assert.equal(toyRange.scenarios[0].terminal_payout, 1);

const current = buildCurrentInferredFenoRanges();
assert.equal(current.production_integrated, false);
assert.deepEqual(current.rows.map((row) => row.id), ["SPX", "NDX", "KOSPI", "SOX"]);
assert.ok(current.rows.every((row) => row.status === "inferred_range_only"));
assert.ok(current.rows.every((row) => row.range.low <= row.range.high));

const yooToy = computeYooLogicInferredRange({
  id: "SPX",
  price: 100,
  book: 25,
  fy3Roe: 0.20,
  payout: 0.30,
  riskFree: 0.04,
  publicErp: 0.05,
});
assert.equal(yooToy.classification, "SINGLE_OBSERVATION_BRIDGE_DIAGNOSTIC");
assert.equal(yooToy.center.horizon, 9);
assert.equal(yooToy.sweep.cells, 9);
assert.ok(Math.abs(yooToy.transformed_inputs.lt_roe.center - 0.20 * 1.05165481) < 1e-12);
assert.ok(Math.abs(yooToy.transformed_inputs.lt_roe.low / yooToy.transformed_inputs.lt_roe.center - 0.95) < 1e-12);
assert.ok(Math.abs(yooToy.transformed_inputs.lt_roe.high / yooToy.transformed_inputs.lt_roe.center - 1.05) < 1e-12);
assert.ok(Math.abs(yooToy.transformed_inputs.erp.low - 0.045) < 1e-12);
assert.ok(Math.abs(yooToy.transformed_inputs.erp.high - 0.055) < 1e-12);

const yooCurrent = buildCurrentYooLogicInferredRanges();
assert.equal(yooCurrent.production_integrated, false);
assert.deepEqual(yooCurrent.rows.map((row) => row.id), ["SPX", "NDX", "KOSPI", "SOX"]);
assert.ok(yooCurrent.rows.every((row) => row.status === "yoo_logic_inferred_range_only"));
assert.ok(yooCurrent.rows.every((row) => row.sweep.range.low <= row.center.nine_cell_mean));
assert.ok(yooCurrent.rows.every((row) => row.center.nine_cell_mean <= row.sweep.range.high));
const kospiYoo = yooCurrent.rows.find((row) => row.id === "KOSPI");
assert.equal(kospiYoo.wide_range, true);
assert.ok(kospiYoo.transformed_inputs.erp.surcharge.low > 0);
assert.ok(Math.abs(kospiYoo.transformed_inputs.erp.public_base + kospiYoo.transformed_inputs.erp.surcharge.high - 0.12) < 1e-12);
const soxDiagnostic = yooCurrent.rows.find((row) => row.id === "SOX");
const spxDiagnostic = yooCurrent.rows.find((row) => row.id === "SPX");
assert.equal(soxDiagnostic.lt_roe_transform.bridge.proxy, true);
assert.equal(soxDiagnostic.lt_roe_proxy, true);
assert.deepEqual(soxDiagnostic.identity_blockers, ["SOXX_not_PHLX"]);
assert.equal(spxDiagnostic.lt_roe_transform.bridge.proxy, false);
assert.equal(spxDiagnostic.lt_roe_proxy, false);
assert.equal(spxDiagnostic.lt_roe_transform.bridge.observations, 1);
assert.equal(spxDiagnostic.lt_roe_transform.bridge.effective_from, "2026-08-03");
assert.ok(spxDiagnostic.lt_roe_transform.bridge.derivation);
assert.equal(spxDiagnostic.lt_roe_transform.reusable, false);
assert.match(spxDiagnostic.lt_roe_transform.assumed_relative_uncertainty.basis, /assumed sensitivity/);

const expectedCenters = { SPX: 7853, NDX: 32066, KOSPI: 14075, SOX: 12995 };
const centreRelativeTolerance = 0.001;
for (const row of yooCurrent.rows) {
  assert.ok(Math.abs(row.center.nine_cell_mean / expectedCenters[row.id] - 1) <= centreRelativeTolerance, `${row.id} centre drifted beyond relative tolerance`);
}

const kospiShifted = computeYooLogicInferredRange({
  id: "KOSPI",
  price: kospiYoo.runtime_inputs.price,
  book: kospiYoo.runtime_inputs.book,
  fy3Roe: kospiYoo.runtime_inputs.fy3_roe,
  payout: kospiYoo.runtime_inputs.payout,
  riskFree: kospiYoo.runtime_inputs.risk_free,
  publicErp: kospiYoo.runtime_inputs.public_erp + 0.01,
});
for (const endpoint of ["low", "center", "high"]) {
  assert.ok(
    Math.abs((kospiShifted.transformed_inputs.erp[endpoint] - kospiYoo.transformed_inputs.erp[endpoint]) - 0.01) < 1e-12,
    `KOSPI ${endpoint} ERP must move one-for-one with live public ERP`,
  );
  assert.equal(kospiShifted.transformed_inputs.erp.surcharge[endpoint], kospiYoo.transformed_inputs.erp.surcharge[endpoint]);
}
assert.equal(kospiShifted.transformed_inputs.erp.surcharge_provenance, kospiYoo.transformed_inputs.erp.surcharge_provenance);

const yooRule = yooCurrent.rule;
assert.equal(yooRule.structure_components.book_roll_forward.evidence_status, "same_sheet_confirmed");
assert.equal(yooRule.structure_components.discount.evidence_status, "locally_fitted");
assert.equal(yooRule.structure_components.terminal.evidence_status, "historically_supported_conditional_candidate");
assert.equal(yooRule.structure_components.horizon.evidence_status, "selected_by_two_index_cross_vintage_payout_validation");

const sharedToy = computeYooLogicSharedInferredRange({
  id: "SPX",
  price: 100,
  book: 25,
  fy3Roe: 0.20,
  normalRoe: 0.10,
  payout: 0.30,
  riskFree: 0.04,
  publicErp: 0.05,
});
assert.equal(sharedToy.classification, "YOO_LOGIC_SHARED_PERSISTENCE_INFERRED_RANGE_NOT_POINT");
assert.ok(Math.abs(sharedToy.transformed_inputs.lt_roe.low - 0.1622122403144301) < 1e-12);
assert.ok(Math.abs(sharedToy.transformed_inputs.lt_roe.center - 0.1682554879558668) < 1e-12);
assert.ok(Math.abs(sharedToy.transformed_inputs.lt_roe.high - 0.1755606109847254) < 1e-12);
assert.equal(sharedToy.lt_roe_transform.persistence_weight.evidence_status, "inferred_transfer");
assert.equal(sharedToy.lt_roe_transform.persistence_weight.observations, 4);
assert.equal(sharedToy.lt_roe_transform.reusable_transformation, "form_only");

const sharedToyPayoutBand = computeYooLogicSharedInferredRange({
  id: "SPX",
  price: 100,
  book: 25,
  fy3Roe: 0.20,
  normalRoe: 0.10,
  payout: { low: 0.20, center: 0.30, high: 0.40 },
  riskFree: 0.04,
  publicErp: 0.05,
});
assert.ok(Number.isFinite(sharedToyPayoutBand.center.center_cell));
assert.equal(sharedToyPayoutBand.runtime_inputs.payout.center, 0.30);

const coverageToy = computeYooLogicLtroeCoverageSensitivity({
  id: "SPX",
  price: 100,
  book: 25,
  roePath: [0.20, 0.18, 0.16],
  normalRoe: 0.10,
  payout: 0.30,
  riskFree: 0.04,
  publicErp: 0.05,
});
assert.equal(coverageToy.point_estimate, null);
assert.equal(coverageToy.transformed_inputs.lt_roe.low, 0.065);
assert.equal(coverageToy.transformed_inputs.lt_roe.high, 0.23500000000000001);
assert.ok(coverageToy.sweep.range.low < coverageToy.sweep.range.high);

// The shared weights must remain derivable from the named frozen evidence,
// rather than drifting into unexplained constants.
const stockFixture = JSON.parse(fs.readFileSync(new URL("./fixtures/fenok-rim-2026-08-03-stock-grids.json", import.meta.url), "utf8"));
const samsungDetail = JSON.parse(fs.readFileSync(new URL("../data/global-scouter/stocks/detail/005930.KS.json", import.meta.url), "utf8"));
const hynixDetail = JSON.parse(fs.readFileSync(new URL("../data/global-scouter/stocks/detail/000660.KS.json", import.meta.url), "utf8"));
const medianFive = (values) => [...values].sort((a, b) => a - b)[2] / 100;
const calibrationById = Object.fromEntries(
  YOO_LOGIC_SHARED_INFERRED_RULE.persistence_weight.calibration_observations.map((row) => [row.id, row]),
);
for (const [id, detail] of [["SAMSUNG", samsungDetail], ["HYNIX", hynixDetail]]) {
  const source = stockFixture.instruments[id];
  const normalRoe = medianFive(detail.profitability.roe);
  const fy3Roe = source.printed.forecast_path.at(-1).roe;
  for (const grid of source.grids) {
    const expected = calibrationById[`${id}-${grid.id}`];
    assert.equal(expected.normal_roe, normalRoe);
    assert.equal(expected.fy3_roe, fy3Roe);
    assert.equal(expected.lt_roe, grid.cells.find((cell) => cell.row === 1 && cell.col === 1).roe);
  }
}

const sharedCurrent = buildCurrentYooLogicSharedInferredRanges();
assert.equal(sharedCurrent.production_integrated, false);
assert.equal(sharedCurrent.rule.reusable_transformation, "form_only");
assert.deepEqual(sharedCurrent.rows.map((row) => row.id), ["SPX", "NDX", "KOSPI", "SOX"]);
assert.ok(sharedCurrent.rows.every((row) => row.status === "yoo_logic_inferred_range_only"));
assert.deepEqual(sharedCurrent.rows.find((row) => row.id === "SOX").identity_blockers, ["SOXX_not_PHLX"]);

const indexPath = buildCurrentIndexForecastPathRanges();
assert.equal(indexPath.production_integrated, false);
assert.equal(indexPath.rule_selection_status, "comparison_candidate_not_chronologically_validated");
assert.deepEqual(indexPath.rows.map((row) => row.id), ["SPX", "NDX", "KOSPI", "SOX"]);
assert.ok(indexPath.rows.filter((row) => ["SPX", "NDX"].includes(row.id)).every((row) => row.classification === "FENO_INDEX_AUTOMATIC_FORECAST_PATH_RESEARCH_RANGE"));
assert.deepEqual(indexPath.rows.find((row) => row.id === "SPX").automatic_payout_candidates.map((row) => row.id), [
  "direct_index_yield_over_forward_earnings",
]);
assert.deepEqual(indexPath.rows.find((row) => row.id === "SPX").excluded_sensitivity_candidates.map((row) => row.id), [
  "constituent_weighted_Yahoo_payout",
  "trailing_realised_payout",
]);
assert.ok(["KOSPI", "SOX"].every((id) => indexPath.rows.find((row) => row.id === id).status === "blocked"));
assert.ok(indexPath.rows.find((row) => row.id === "KOSPI").blocking_reasons.includes("covered_weight_below_95pct"));

const methodUnion = buildCurrentMethodFamilyUnionRanges();
assert.equal(methodUnion.production_integrated, false);
assert.equal(methodUnion.point_estimates, false);
assert.deepEqual(methodUnion.rows.map((row) => row.id), ["SPX", "NDX", "KOSPI", "SOX"]);
for (const row of methodUnion.rows.filter((candidate) => !["KOSPI", "SOX"].includes(candidate.id))) {
  assert.equal(row.status, "method_family_union_research_only");
  assert.equal(row.point_estimate, null);
  assert.equal(row.runtime_yoo_value_injection, false);
  assert.equal(row.family_ranges.length, 2);
}
assert.equal(methodUnion.rows.find((row) => row.id === "SPX").intervals.length, 2);
assert.equal(methodUnion.rows.find((row) => row.id === "SPX").envelope, null);
assert.equal(methodUnion.rows.find((row) => row.id === "NDX").intervals.length, 2);
assert.ok(["KOSPI", "SOX"].every((id) => methodUnion.rows.find((row) => row.id === id).status === "blocked"));

const conditionalToy = fitConditionalGridPayout({
  book: 25,
  rateScenarios: { current: 0.04 },
  cells: [{ scenario: "current", lt_roe: 0.20, risk_premium: 0.05, fair_value: 85.52140555377994 }],
});
assert.equal(conditionalToy.status, "conditional_anchor_fit");
assert.ok(Math.abs(conditionalToy.payout - 0.30) < 1e-10);

const conditionalPayout = buildHistoricalConditionalPayoutDiagnostic();
assert.equal(conditionalPayout.production_integrated, false);
assert.equal(conditionalPayout.classification, "formula_conditionally_identified_not_runtime_stable");
assert.deepEqual(conditionalPayout.rows.map((row) => row.id), ["SPX", "CCMP"]);
const conditionalSpx = conditionalPayout.rows.find((row) => row.id === "SPX");
const conditionalCcmp = conditionalPayout.rows.find((row) => row.id === "CCMP");
assert.ok(Math.abs(conditionalSpx.combined_fit.payout - 0.3124228881) < 1e-8);
assert.ok(Math.abs(conditionalCcmp.combined_fit.payout - 0.2163994821) < 1e-8);
assert.ok(conditionalSpx.scenario_payout_spread_pp < 0.001);
assert.ok(conditionalCcmp.scenario_payout_spread_pp < 0.1);
assert.ok(Math.abs(conditionalSpx.later_printed_sheet.difference_pp) < 0.2);
assert.ok(Math.abs(conditionalCcmp.later_printed_sheet.difference_pp) < 0.2);

const horizonResidual = buildHistoricalHorizonResidualValueDiagnostic();
assert.equal(horizonResidual.production_integrated, false);
assert.equal(horizonResidual.selected_horizon, 9);
assert.ok(horizonResidual.selected_validation_mae_pp < 0.2);
assert.ok(horizonResidual.runner_up_validation_mae_pp > 6);
assert.equal(horizonResidual.candidates.length, 9);

const fy3Proxy = deriveFy3RoeProxy({
  price: 100,
  priceToBook: 2,
  forwardPe: 10,
  payout: 0.25,
  annualEpsGrowth: 0.10,
});
assert.equal(fy3Proxy.status, "ready_proxy");
assert.equal(fy3Proxy.path.length, 3);
assert.ok(Math.abs(fy3Proxy.path[0].roe - 0.20) < 1e-12);
assert.ok(Math.abs(fy3Proxy.path[1].book_beginning - 57.5) < 1e-12);
assert.ok(fy3Proxy.fy3_roe < fy3Proxy.path[0].roe);

const extended = buildCurrentExtendedYooLogicProxyRanges();
assert.equal(extended.production_integrated, false);
assert.equal(extended.exact_index_value_status, "blocked");
assert.deepEqual(extended.rows.map((row) => row.id), ["CCMP", "RUT"]);
for (const row of extended.rows) {
  assert.equal(row.classification, "FENO_AUTO_PROXY_RESEARCH_RANGE");
  assert.equal(row.proxy_inputs.generated_from_yoo_runtime_values, false);
  assert.ok(row.sweep.range.low <= row.center.nine_cell_mean);
  assert.ok(row.center.nine_cell_mean <= row.sweep.range.high);
  assert.ok(row.identity_blockers.length > 0);
}
const ccmpProxy = extended.rows.find((row) => row.id === "CCMP");
const rutProxy = extended.rows.find((row) => row.id === "RUT");
assert.deepEqual(ccmpProxy.proxy_inputs.payout.observations.map((row) => row.ticker), ["ONEQ"]);
assert.deepEqual(rutProxy.proxy_inputs.payout.observations.map((row) => row.ticker), ["IWM", "VTWO"]);
assert.ok(rutProxy.runtime_inputs.payout.low < rutProxy.runtime_inputs.payout.high);
assert.equal(rutProxy.status, "suppressed_failed_basis_sanity");
assert.match(rutProxy.suppression.release_gate, /LSEG/);
assert.ok(ccmpProxy.proxy_inputs.eps_growth.low < ccmpProxy.proxy_inputs.eps_growth.high);

const russellOfficial = buildRussellOfficialSnapshotDiagnostic();
assert.equal(russellOfficial.production_integrated, false);
assert.equal(russellOfficial.row.classification, "OFFICIAL_SAME_DATE_FUNDAMENTALS_SNAPSHOT_DIAGNOSTIC");
assert.equal(russellOfficial.row.official_snapshot.runtime_contract.manual_value_promotion, false);
assert.equal(russellOfficial.row.official_snapshot.runtime_contract.yoo_value_used, false);
assert.ok(Math.abs(russellOfficial.row.official_snapshot.derived.payout - 0.240792) < 1e-12);
assert.ok(Math.abs(russellOfficial.row.official_snapshot.derived.risk_free - 0.043) < 1e-12);
assert.ok(Math.abs(russellOfficial.row.official_snapshot.derived.fy3_roe_proxy.fy3_roe - 0.1338489) < 1e-6);

const russellCurrent = buildRussellCurrentOfficialFundamentalsDiagnostic();
assert.equal(russellCurrent.production_integrated, false);
assert.equal(russellCurrent.row.status, "suppressed_method_not_validated");
assert.equal(russellCurrent.row.official_fundamentals.status, "ready_official_quarterly_snapshot");
assert.equal(russellCurrent.row.official_fundamentals.as_of, "2026-06-30");
assert.equal(russellCurrent.row.official_fundamentals.runtime_yoo_value_injection, false);
assert.equal(russellCurrent.row.fundamentals_age_days_at_price, 31);
assert.equal(russellCurrent.row.suppression.source_blocked, false);

console.log("fenok-rim rule calibration tests passed");
