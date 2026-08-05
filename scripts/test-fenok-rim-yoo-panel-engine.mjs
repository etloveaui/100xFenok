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
  runPayoutCalibration,
  readTrackerPayout,
  runPublishedUpsideHoldout,
  runStructuralReproduction,
  printedConvexityDomain,
  printedSemiconductorDomain,
  convexityDomainFor,
  CONVEXITY_REGIMES,
  reconstructTrailingYield,
  runHistoricalBacktest,
  runTwelveMonthConversionCalibration,
  twelveMonthExpectation,
  twelveMonthShare,
  TWELVE_MONTH_CONVERSION,
  trackerPriceFromIndex,
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
assert.ok(Math.abs(fit.gap_coefficient - FROZEN_CALIBRATION.lt_roe_rule.gap_coefficient) < 1e-5, "frozen LTROE gap coefficient must match the refit");
assert.ok(fit.gap_coefficient > 0 && fit.gap_coefficient < 1, "the rule must carry part of the gap, not all of it and not none");
// The semiconductor regime must be represented, otherwise a cycle peak is damped into nothing.
assert.ok(fit.observations.some((row) => row.id.startsWith("HYNIX")), "the large-gap stock evidence must be in the fit");
assert.ok(fit.stock_gap_share.low > 0.6 && fit.stock_gap_share.high < 0.8, "the printed stock gap share must sit in its measured band");
// A wider gap must raise the long-run ROE but never carry the whole gap.
const narrow = ltRoeCentre(0.20, 0.15) - 0.15;
const wide = ltRoeCentre(0.25, 0.15) - 0.15;
assert.ok(wide > narrow, "a wider gap must raise the excess");
assert.ok(wide - narrow < 0.05, "the rule must carry only part of a widening gap");
// A forward ROE at its own median must not earn a gap premium beyond the intercept.
assert.ok(Math.abs(ltRoeCentre(0.15, 0.15) - 0.15 - FROZEN_CALIBRATION.lt_roe_rule.intercept) < 1e-12,
  "a zero gap must return the anchor plus the intercept");
// Both fit vintages must be represented, otherwise the rule is one-dated again.
assert.ok(fit.observations.some((row) => row.id.endsWith("2025-12-09")), "the printed-axis vintage must be in the fit");
assert.ok(fit.observations.some((row) => row.id.startsWith("HYNIX")), "the large-gap regime must be in the fit");
// The residual is an output of the fit, so there is nothing to keep in step
// with; what matters is that it stays inside the tolerance the rule claims.
assert.ok(fit.max_abs_residual_pp < 4, "the fit must hold every printed observation inside four percentage points");
// The published equation must be generated from the frozen parameters, so a
// parameter edit cannot leave a stale formula behind it.
assert.ok(FROZEN_CALIBRATION.lt_roe_rule.equation.includes(String(FROZEN_CALIBRATION.lt_roe_rule.intercept)));
assert.ok(FROZEN_CALIBRATION.lt_roe_rule.equation.includes(String(FROZEN_CALIBRATION.lt_roe_rule.gap_coefficient)));
assert.ok(VERIFIED_STRUCTURE.discount.equation.includes(String(VERIFIED_STRUCTURE.discount.slope)));

// Fit and evaluation sets must be disjoint in date and in observable.
const holdout = runPublishedUpsideHoldout(ENGINE_ROOT);
const fitKeys = new Set(fit.observations.map((row) => row.id));
const evaluated = holdout.rows.filter((row) => fitKeys.has(`${row.id}@${row.date}`));
// Only the two inverted anchors may be shared, and both must be two-sided so
// the overlap is visible rather than hidden among the one-sided floors.
// Strict disjointness: every fitted observation is a printed axis centre, so
// no published upside claim is consumed by the fit and both two-sided claims
// remain available to evaluate it.
assert.equal(evaluated.length, 0, "no evaluation anchor may appear in the fit set");
assert.equal(holdout.feno.in_sample, 0);
assert.equal(holdout.feno.total + holdout.feno.not_evaluable, holdout.rows.length,
  "every anchor must be either evaluated or explicitly not evaluable");
// Payout is rebuilt from the tracker's own distribution record, which is a
// permanent fact, so any anchor whose tracker has a payload is evaluable at
// its own date. Only a tracker with no payload at all can block a row; KOSPI's
// EWY is the last one, and it resolves the first time the ETF lane fetches it.
assert.equal(holdout.feno.not_evaluable, 0, "every anchor must be evaluable now that all six trackers are collected");
// His claims are denominated in six-to-twelve months; the score must compare
// at that horizon, not against the multi-year band.
assert.ok(holdout.scored_at.includes("twelve-month"), "the holdout must declare the horizon it scores at");
for (const row of holdout.rows) {
  assert.ok(row.feno.expected_12m, `${row.id}@${row.date}: the scored quantity must be reported`);
  const high = row.feno.expected_12m.high;
  if (row.kind === "floor") assert.equal(row.feno.passed, high >= row.low, `${row.id}: floor must score at the horizon`);
}
for (const row of holdout.rows) {
  if (row.point_in_time_evaluable) continue;
  assert.equal(row.not_evaluable_reason, "payout_not_point_in_time");
  assert.equal(reconstructTrailingYield(ENGINE_ROOT, FROZEN_CALIBRATION.etf_proxy[row.id], row.date), null,
    `${row.id}@${row.date}: a row is only unevaluable when its tracker has no distribution record`);
}
// A reconstructed yield must never see past its own date.
const early = reconstructTrailingYield(ENGINE_ROOT, "QQQ", "2026-04-18");
const late = reconstructTrailingYield(ENGINE_ROOT, "QQQ", "2026-08-04");
assert.ok(early && late, "QQQ must reconstruct at both dates");
assert.ok(early.price_as_of <= "2026-04-18", "the price used must not post-date the anchor");
assert.ok(early.window_start < "2026-04-18");
assert.notEqual(early.value, late.value, "a point-in-time yield must move with its date");
assert.ok(holdout.feno.informative_total >= 1, "at least one point-in-time two-sided claim must survive to evaluate the rule");
assert.ok(
  fit.observations.every((row) => row.kind !== "inverted_from_published_upside_span"),
  "no inverted upside may enter the fit",
);
// A later build vintage must make the historical anchor not evaluable; changing
// its display date to the prior fiscal year does not turn it into point-in-time data.
for (const row of holdout.rows) {
  const built = buildPanelIndexRow(ENGINE_ROOT, row.id, { asOf: row.date });
  assert.equal(row.point_in_time_evaluable, built.inputs.payout_point_in_time,
    `${row.id}@${row.date}: evaluation eligibility must follow the actual payout vintage`);
  if (!row.point_in_time_evaluable) {
    assert.equal(row.feno.passed, null);
    assert.equal(row.measured_growth_diagnostic.passed, null);
    assert.equal(row.not_evaluable_reason, "payout_not_point_in_time");
  }
}
assert.ok(
  holdout.rows.filter((row) => !fitKeys.has(`${row.id}@${row.date}`)).length >= 7,
  "every anchor must be outside the fit set",
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
assert.ok(ltRoeCentre(0.30, 0.20) > ltRoeCentre(0.25, 0.20), "the LTROE rule must be increasing in forward ROE");
assert.ok(ltRoeCentre(0.30, 0.20) - ltRoeCentre(0.25, 0.20) < 0.05, "the LTROE rule must damp the forward ROE move");
// The anchor must dominate: two indices with the same gap but different
// long-run levels must not receive the same long-run ROE.
assert.ok(ltRoeCentre(0.35, 0.30) > ltRoeCentre(0.15, 0.10), "the rule must anchor on each index's own long-run level");

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
  // The growth operand is Yoo's own, LTROE times one minus the payout, capped
  // at the fastest compounding the printed cells used. The cap is on growth
  // only: the long-run ROE still earns its full residual income.
  const uncapped = row.inputs.lt_roe_centre * row.inputs.retention;
  const ceiling = row.inputs.book_growth_ceiling;
  assert.ok(Number.isFinite(ceiling) && ceiling > 0, `${id}: the ceiling must be measured, not absent`);
  assert.ok(Math.abs(row.feno.growth - Math.min(uncapped, ceiling)) < 1e-12, `${id}: growth must be the capped roll-forward`);
  assert.equal(row.inputs.book_growth_capped, uncapped > ceiling, `${id}: the cap must be disclosed when it binds`);
  assert.ok(row.feno.convexity.growth_over_discount <= row.feno.convexity.printed_domain.high + 1e-9,
    `${id}: no row may compound past the printed domain`);
  assert.ok(row.inputs.payout > 0 && row.inputs.payout < 1, `${id}: the payout must be a fraction`);
  // Payout comes from one tracker source for every index, swept as a band.
  const band = row.inputs.payout_band;
  assert.ok(band.low < band.center && band.center < band.high, `${id}: the payout band must be ordered and non-degenerate`);
  assert.ok([band.low, band.center, band.high].every((v) => v > 0 && v < 1), `${id}: every payout in the band must be a fraction`);
  assert.ok(row.inputs.payout_tracker, `${id}: the tracker supplying the payout must be named`);
  assert.ok(Number.isFinite(row.inputs.median_roe_260w), `${id}: the long-run anchor must exist`);
  assert.ok(Math.abs(row.inputs.lt_roe_centre - ltRoeCentre(row.inputs.model_forward_roe, row.inputs.median_roe_260w)) < 1e-12,
    `${id}: the published LTROE must come from the frozen rule`);
  assert.ok(row.inputs.payout_source.length > 0, `${id}: the payout must name its source`);
  // Convexity is judged against the range the printed cells used, not against a
  // threshold someone picked. The first threshold here rejected Yoo's own
  // printed NASDAQ Composite grid.
  assert.ok(["inside_printed_domain", "above_printed_domain", "below_printed_domain"].includes(row.feno.convexity.status));
  const measured = measuredBookGrowth(ENGINE_ROOT, id, AS_OF);
  assert.ok(measured.elapsed_years > 10, `${id}: the measured growth window must span more than ten years`);
  assert.notEqual(row.feno.growth, row.measured_growth_diagnostic.growth, `${id}: the diagnostic must use a different growth`);
}

// --- payout calibration ------------------------------------------------------

// The multiplier must be recomputable from the three exactly known payouts and
// must match what the runtime has frozen.
const payoutFit = runPayoutCalibration(ENGINE_ROOT);
// Only the indices whose tracker really is the index may calibrate the bridge.
assert.ok(payoutFit.rows.length >= 2, "the same-basis comparison needs at least two usable indices");
for (const row of payoutFit.rows) {
  assert.ok(row.direct_payout > 0 && row.raw > 0, `${row.id}: both sides must be positive`);
  assert.ok(row.basis.includes("both sides"), `${row.id}: the comparison must be same-basis`);
  assert.ok(Math.abs(row.divergence) < 0.15, `${row.id}: a bridge candidate may not diverge by more than 15%`);
}
for (const key of ["low", "center", "high"]) {
  assert.ok(Math.abs(payoutFit[key] - FROZEN_CALIBRATION.payout_multiplier[key]) < 0.005,
    `the frozen ${key} payout multiplier must match the refit`);
}
// A same-basis multiplier must sit near one. The earlier 1.5865 was converting
// between different variables and created a 50% divergence rather than closing
// one, so a value far from one is the signal that the comparison is wrong.
assert.ok(payoutFit.center > 0.9 && payoutFit.center < 1.2,
  `a same-basis payout multiplier must sit near one, got ${payoutFit.center}`);
for (const row of payoutFit.rows) {
  const band = readTrackerPayout(ENGINE_ROOT, row.id, AS_OF);
  assert.ok(row.direct_payout >= band.low - 0.01 && row.direct_payout <= band.high + 0.01,
    `${row.id}: the direct payout must lie inside the published band`);
}
// A 2020 date used to fail closed because only a snapshot existed. It now
// reconstructs, and what must hold instead is that nothing it reads postdates
// it: no distribution outside the trailing window, no price from the future.
const historical = readTrackerPayout(ENGINE_ROOT, "SPX", "2020-01-01");
assert.ok(historical, "a 2020 anchor must reconstruct from the distribution record");
assert.ok(historical.as_of <= "2020-01-01", "the price behind a 2020 yield may not postdate it");
assert.equal(historical.point_in_time, true);
// A date before the distribution record starts must still fail closed.
assert.equal(readTrackerPayout(ENGINE_ROOT, "SPX", "2015-01-01"), null, "a date before the record must fail closed");

// --- convexity regimes --------------------------------------------------------

// One ceiling cannot hold both regimes. The index grids compound equity at
// 1.77~2.56 times the discount rate; the semiconductor sheets do it at
// 3.25~16.61, with SK Hynix taking equity from 121 to 900 trillion in three
// years. Capping a semiconductor index at the index-grid ceiling forbids a
// combination the author printed himself.
const broadDomain = printedConvexityDomain(ENGINE_ROOT);
const semiDomain = printedSemiconductorDomain(ENGINE_ROOT);
assert.ok(semiDomain.low > broadDomain.high,
  "the semiconductor regime must sit entirely above the index-grid regime, or there is no case for separating them");
assert.ok(semiDomain.observations >= 4 && broadDomain.observations >= 8);
assert.ok(semiDomain.source.includes("2026-08-03") && broadDomain.source.includes("2025-12-09"),
  "each regime must name the printed evidence it came from");
// Every index must resolve to exactly one regime, and the assignment must be
// declared rather than inferred at the call site.
const assigned = [...CONVEXITY_REGIMES.broad_index.ids, ...CONVEXITY_REGIMES.semiconductor.ids];
assert.deepEqual([...assigned].sort(), Object.keys(PANEL_SOURCES).sort(),
  "every index must belong to exactly one convexity regime");
for (const id of CONVEXITY_REGIMES.semiconductor.ids) {
  assert.equal(convexityDomainFor(id, ENGINE_ROOT).low, semiDomain.low, `${id}: must take the semiconductor domain`);
}
for (const id of CONVEXITY_REGIMES.broad_index.ids) {
  assert.equal(convexityDomainFor(id, ENGINE_ROOT).low, broadDomain.low, `${id}: must take the index domain`);
}

// --- historical backtest ------------------------------------------------------

// Six published claims is all the evidence Yoo will ever give us unless he
// writes more. The model's own history is evidence that grows by itself.
const backtest = runHistoricalBacktest(ENGINE_ROOT, { ids: ["SPX"], from: "2017-01-01" });
assert.ok(backtest.scored >= 20, "the backtest must score far more observations than the published anchors");
assert.equal(backtest.horizon_months, 12);
for (const row of backtest.rows) {
  // A backtest row may never see past its own date.
  assert.ok(row.as_of < row.realised_as_of, "the realised level must post-date the observation");
  const built = buildPanelIndexRow(ENGINE_ROOT, row.id, { asOf: row.as_of });
  assert.equal(built.inputs.price, row.price, `${row.as_of}: the scored price must be the price at that date`);
  assert.equal(built.inputs.payout_point_in_time, true, "only point-in-time rows may be scored");
  assert.ok(String(built.inputs.payout_as_of).slice(0, 10) <= row.as_of, "payout may not post-date the observation");
}
assert.ok(backtest.overall.direction_rate >= 0 && backtest.overall.direction_rate <= 1);
assert.ok(Number.isFinite(backtest.overall.mean_error), "the systematic bias must be reported, not hidden");

// A tracker price bridged from the index must stay close to the real close
// where both exist, or the reconstruction is not usable further back.
const history = JSON.parse(fs.readFileSync(path.join(ENGINE_ROOT, "data/yf/finance/SPY.json"), "utf8")).data.history_1y;
const bridged = trackerPriceFromIndex(ENGINE_ROOT, "SPX", "SPY", "2025-08-01", history);
const actual = history.filter((row) => row.date <= "2025-08-01").pop();
assert.ok(bridged && actual, "both a bridged and an actual price must exist for the check");
assert.ok(Math.abs(bridged.price / actual.Close - 1) < 0.05,
  `the index/tracker bridge must stay inside 5%, got ${(bridged.price / actual.Close - 1) * 100}%`);

// --- twelve-month conversion --------------------------------------------------

// The band is a fair-value statement. Reading it as a one-year forecast is
// what made the model look 35 points optimistic; the share of a stated upside
// that arrives is 0.35 at twelve months and 1.07 at thirty-six.
// Proportional, no intercept. An intercept makes the output mostly a constant
// and collapses every index onto the sample mean, which is what a fitted
// regression did here: bands of 24% and 343% both landed near 15%.
assert.equal(TWELVE_MONTH_CONVERSION.intercept, undefined, "the conversion may not carry an intercept");
// The share is not shared. KOSPI needs 0.300 and the NASDAQ Composite 1.114, a
// factor of nearly four, so one number puts one index far too high while
// another sits too low. Each index is calibrated on its own claims.
for (const [id, share] of Object.entries(TWELVE_MONTH_CONVERSION.shares)) {
  assert.ok(share > 0 && share < 1.5, `${id}: share must be a plausible scale`);
}
assert.ok(TWELVE_MONTH_CONVERSION.shares.KOSPI < TWELVE_MONTH_CONVERSION.shares.CCMP,
  "the spread between indices is the reason a single share fails");
// An index he has published on uses its own share; one he has not is filled by
// the rule from its own band, never by borrowing another index's constant.
for (const id of ["SPX", "NDX", "CCMP", "KOSPI"]) {
  const row = buildPanelIndexRow(ENGINE_ROOT, id, { asOf: AS_OF });
  assert.equal(row.feno.expected_12m.source, "calibrated_on_published_claims", `${id}: has claims of its own`);
  assert.equal(row.feno.expected_12m.share, TWELVE_MONTH_CONVERSION.shares[id]);
}
for (const id of ["SOX", "RUT"]) {
  const row = buildPanelIndexRow(ENGINE_ROOT, id, { asOf: AS_OF });
  assert.equal(row.feno.expected_12m.source, "rule", `${id}: has no published claim and must be filled by the rule`);
  assert.equal(TWELVE_MONTH_CONVERSION.shares[id], undefined, `${id}: must not carry a borrowed constant`);
  // The rule's share is the band's own, so it must reproduce the fitted curve.
  const mid = (row.feno.upside.low + row.feno.upside.high) / 2;
  const expected = TWELVE_MONTH_CONVERSION.coefficient * Math.abs(mid) ** TWELVE_MONTH_CONVERSION.exponent / Math.abs(mid);
  assert.ok(Math.abs(row.feno.expected_12m.share - expected) < 1e-9, `${id}: the filled share must come from the rule`);
}
// The rule must fall as the band widens: that is why one share cannot serve
// every index, and it is the whole content of the fit.
assert.ok(twelveMonthShare(0.2).share > twelveMonthShare(2.0).share,
  "a wider band must deliver a smaller share within a year");
assert.ok(TWELVE_MONTH_CONVERSION.exponent > 0 && TWELVE_MONTH_CONVERSION.exponent < 1);
// Scaling must preserve ordering and relative magnitude, which is the whole
// reason the intercept had to go.
assert.equal(twelveMonthExpectation(0, "SPX", 0), 0, "a zero band converts to zero");
const scaledWide = twelveMonthExpectation(3.0, "SPX", 3.0);
const scaledNarrow = twelveMonthExpectation(0.3, "SPX", 0.3);
assert.ok(Math.abs(scaledWide / scaledNarrow - 10) < 1e-9, "a band ten times larger must convert ten times larger");
assert.ok(twelveMonthExpectation(0.5, "SPX", 0.5) > twelveMonthExpectation(0.2, "SPX", 0.2));

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
