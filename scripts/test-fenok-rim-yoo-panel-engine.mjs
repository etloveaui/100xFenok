#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ENGINE_ROOT,
  FROZEN_CALIBRATION,
  PANEL_SOURCES,
  VERIFIED_STRUCTURE,
  buildPanelIndexRow,
  discountRate,
  ltRoeCentre,
  measuredBookGrowth,
  readPanelObservation,
  readRiskFree,
  residualValueFairValue,
  runBookIdentityCheck,
  runLtRoeCalibration,
  runPublishedUpsideHoldout,
  runStructuralReproduction,
} from "./fenok-rim-yoo-panel-engine.mjs";

const AS_OF = "2026-08-04";
const SCOPE = ["SPX", "NDX", "KOSPI", "SOX", "CCMP", "RUT"];

// --- structure reproduces the published grid ---------------------------------

const structural = runStructuralReproduction(ENGINE_ROOT);
const reproduced = structural.instruments.filter((row) => row.status === "reproduced");
assert.ok(reproduced.length >= 2, "at least two grid instruments must have a unit-coherent book");
for (const row of reproduced) {
  assert.ok(row.rmse_pct_of_mean_fair_value < 0.005, `${row.instrument}: grid reproduction must stay inside 0.5% RMSE`);
}
const spx = reproduced.find((row) => row.instrument === "SPX");
// The payout fitted on the 18 published cells must agree with the payout Yoo
// printed on his separate S&P 500 input sheet.
assert.ok(Math.abs(spx.fitted_payout - 0.3109) < 0.005, "fitted SPX payout must match the printed 31.09% within 0.5pp");

// A wrong horizon must score worse, otherwise N=9 is not identified.
const shortHorizon = runStructuralReproduction(ENGINE_ROOT, { horizon: 5 }).instruments.find((row) => row.instrument === "SPX");
assert.ok(shortHorizon.rmse_pct_of_mean_fair_value > spx.rmse_pct_of_mean_fair_value * 10, "N=9 must beat N=5 by a wide margin");

// --- the book source is the one Yoo printed ---------------------------------

for (const row of runBookIdentityCheck(ENGINE_ROOT)) {
  assert.ok(Math.abs(row.relative_error) < 0.0005, `${row.id}: panel book must match the printed feed book within display rounding`);
}

// The risk-free source must reproduce the rate Yoo printed as 4.2%.
const decemberRate = readRiskFree(ENGINE_ROOT, "SPX", "2025-12-09");
assert.equal(decemberRate.series, "DGS10");
assert.ok(Math.abs(decemberRate.value - 0.042) < 0.0005, "the 2025-12-09 sovereign 10Y must round to the printed 4.2%");

// --- LTROE rule: frozen constants match the recomputed fit -------------------

const fit = runLtRoeCalibration(ENGINE_ROOT);
assert.ok(Math.abs(fit.intercept - FROZEN_CALIBRATION.lt_roe_rule.intercept) < 1e-5, "frozen LTROE intercept must match the refit");
assert.ok(Math.abs(fit.slope - FROZEN_CALIBRATION.lt_roe_rule.slope) < 1e-5, "frozen LTROE slope must match the refit");
assert.ok(fit.slope > 0 && fit.slope < 1, "the fitted slope must be a mean reversion, not an amplification");
assert.ok(fit.max_abs_residual_pp <= FROZEN_CALIBRATION.lt_roe_rule.max_abs_residual_pp + 0.01, "recorded residual must not understate the fit error");

// Fit and evaluation sets must be disjoint in date and in observable.
const holdout = runPublishedUpsideHoldout(ENGINE_ROOT);
const fitKeys = new Set(fit.observations.map((row) => row.id));
const evaluated = holdout.rows.filter((row) => fitKeys.has(`${row.id}@${row.date}`));
assert.equal(evaluated.length, 1, "exactly the inverted SPX anchor may appear in both sets");
assert.ok(evaluated[0].informative, "the shared anchor must be declared, not hidden among the one-sided floors");
assert.ok(
  holdout.rows.filter((row) => !fitKeys.has(`${row.id}@${row.date}`)).length >= 6,
  "at least six evaluation anchors must be outside the fit set",
);

// --- runtime target independence --------------------------------------------

// Mutating every published Yoo value in the frozen evidence fixture must not
// move a single runtime number.
const evidencePath = path.join(ENGINE_ROOT, "scripts/fixtures/fenok-rim-calibration-evidence.json");
const originalEvidence = fs.readFileSync(evidencePath, "utf8");
const baseline = SCOPE.map((id) => buildPanelIndexRow(ENGINE_ROOT, id, { asOf: AS_OF }));
try {
  const mutated = JSON.parse(originalEvidence);
  for (const claim of mutated.claims) claim.raw_value = "999999";
  fs.writeFileSync(evidencePath, `${JSON.stringify(mutated, null, 2)}\n`);
  const after = SCOPE.map((id) => buildPanelIndexRow(ENGINE_ROOT, id, { asOf: AS_OF }));
  assert.deepEqual(after, baseline, "runtime rows must not depend on any published Yoo value");
} finally {
  fs.writeFileSync(evidencePath, originalEvidence);
}

// --- metamorphic directions --------------------------------------------------

const base = { book: 1000, ltRoe: 0.25, growth: 0.08, riskFree: 0.045, erp: 0.05 };
const baseValue = residualValueFairValue(base);

// Book scales the whole answer linearly.
const scaled = residualValueFairValue({ ...base, book: base.book * 1.01 });
assert.ok(Math.abs(scaled / baseValue - 1.01) < 1e-9, "a 1% book increase must move the endpoint by exactly 1%");

// A higher equity risk premium must lower the value.
assert.ok(residualValueFairValue({ ...base, erp: base.erp + 0.005 }) < baseValue, "a higher ERP must lower the fair value");

// A higher long-run ROE must raise it.
assert.ok(residualValueFairValue({ ...base, ltRoe: base.ltRoe + 0.005 }) > baseValue, "a higher LTROE must raise the fair value");

// A higher book growth rate must raise it while residual income is positive.
assert.ok(residualValueFairValue({ ...base, growth: base.growth + 0.01 }) > baseValue, "faster book growth must raise the fair value");

// The LTROE rule must be monotone and damped.
assert.ok(ltRoeCentre(0.30) > ltRoeCentre(0.25), "the LTROE rule must be increasing in forward ROE");
assert.ok(ltRoeCentre(0.30) - ltRoeCentre(0.25) < 0.05, "the LTROE rule must damp the forward ROE move");

// The discount relation must be the fitted one, not the cost of equity.
assert.ok(Math.abs(discountRate(0.042) - 0.09952) < 1e-9, "the discount relation must be 0.076 + 0.560 * Rf");

// --- six-index completion and lane separation --------------------------------

for (const id of SCOPE) {
  const row = buildPanelIndexRow(ENGINE_ROOT, id, { asOf: AS_OF });
  assert.ok(Number.isFinite(row.inputs.price) && row.inputs.price > 0, `${id}: needs a current price`);
  assert.ok(Number.isFinite(row.inputs.book) && row.inputs.book > 0, `${id}: needs a positive book`);
  for (const lane of [row.feno, row.measured_growth_diagnostic]) {
    assert.ok(Number.isFinite(lane.fair_value.low) && Number.isFinite(lane.fair_value.high), `${id}: both bands need finite endpoints`);
    assert.ok(lane.fair_value.low <= lane.fair_value.high, `${id}: endpoints must be ordered`);
  }
  // The growth operand is Yoo's own: LTROE times one minus the payout.
  assert.ok(Math.abs(row.feno.growth - row.inputs.lt_roe_centre * row.inputs.retention) < 1e-12,
    `${id}: growth must be LTROE * (1 - payout)`);
  assert.ok(row.inputs.payout > 0 && row.inputs.payout < 1, `${id}: the payout must be a fraction`);
  assert.ok(row.inputs.payout_source.length > 0, `${id}: the payout must name its source`);
  // Convexity is disclosed, never silently corrected.
  assert.ok(["bounded", "convex", "amplifying"].includes(row.feno.convexity.status));
  const measured = measuredBookGrowth(ENGINE_ROOT, id, AS_OF);
  assert.ok(measured.elapsed_years > 10, `${id}: the measured growth window must span more than ten years`);
  assert.notEqual(row.feno.growth, row.measured_growth_diagnostic.growth, `${id}: the diagnostic must use a different growth`);
}

// --- fail closed on a stale or missing panel ---------------------------------

assert.throws(() => readPanelObservation(ENGINE_ROOT, "SPX", "2009-01-01"), /no panel row/, "a date before the panel must fail closed");
assert.throws(() => residualValueFairValue({ ...base, book: 0 }), /positive book/, "a non-positive book must fail closed");
assert.throws(() => buildPanelIndexRow(ENGINE_ROOT, "UNKNOWN", { asOf: AS_OF }), /no panel source/, "an unknown index must fail closed");

// --- panel identity ----------------------------------------------------------

assert.deepEqual(Object.keys(PANEL_SOURCES).sort(), [...SCOPE].sort(), "the panel must cover exactly the six published indices");
assert.equal(PANEL_SOURCES.SOX.section, "philadelphia_semi", "SOX must resolve to the Philadelphia index, not SOXX");
assert.equal(PANEL_SOURCES.CCMP.section, "nasdaq_composite", "CCMP must stay distinct from NASDAQ 100");
assert.equal(VERIFIED_STRUCTURE.horizon, 9);

console.log("FENO RIM panel engine tests passed");
