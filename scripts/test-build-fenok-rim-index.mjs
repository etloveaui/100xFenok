import assert from "node:assert/strict";
import {
  checkCalibration,
  computeYooRimRow,
  computeYooSheetCase,
  computeYooSheetCell,
  YOO_CALIBRATION_ANCHORS,
  YOO_DISCOUNT_SENSITIVITY,
  YOO_EXPLICIT_YEARS,
  YOO_MARKET_RATES,
  YOO_TERMINAL_GROWTH,
  YOO_TERMINAL_ROE_CAP,
} from "./build-rim-yoo-index.mjs";

// Hand-computed reference (g = 0, cap above ROE so it does not bind):
//   B0 = 1000, ROE 20%, r 10%, retention 0.5 -> book grows 10%/yr
//   RI_1 = 0.10*1000 = 100        PV = 100/1.1   =  90.909
//   RI_2 = 0.10*1100 = 110        PV = 110/1.21  =  90.909
//   RI_3 = 0.10*1210 = 121        PV = 121/1.331 =  90.909
//   TV   = 121/0.10 = 1210        PV = 1210/1.331 = 909.09
//   V = 1000 + 272.73 + 909.09 = 2181.82
{
  const row = computeYooRimRow({
    key: "t", name: "T",
    px: 2000, pbr: 2.0, roe: 0.2, date: "2026-07-31",
    discountRate: 0.1, retention: 0.5, terminalGrowth: 0, terminalRoeCap: 0.99,
  });
  assert.equal(row.status, "ready");
  assert.equal(row.book_value, 1000);
  assert.equal(Math.round(row.fair_value * 100) / 100, 2181.82);
  assert.equal(Math.round(row.upside_pct * 100) / 100, 9.09, "2181.82/2000 - 1");
  assert.equal(Math.round(row.components.pv_explicit_residual_income * 100) / 100, 272.73);
}

// The terminal ROE cap binds: with cap 0.15 the terminal residual uses
// (0.15 - r), shrinking the terminal leg but leaving the explicit leg alone.
{
  const capped = computeYooRimRow({
    px: 2000, pbr: 2.0, roe: 0.2, discountRate: 0.1, retention: 0.5,
    terminalGrowth: 0, terminalRoeCap: 0.15, key: "t", name: "T", date: "d",
  });
  const uncapped = computeYooRimRow({
    px: 2000, pbr: 2.0, roe: 0.2, discountRate: 0.1, retention: 0.5,
    terminalGrowth: 0, terminalRoeCap: 0.99, key: "t", name: "T", date: "d",
  });
  assert.equal(capped.components.pv_explicit_residual_income, uncapped.components.pv_explicit_residual_income);
  assert.ok(capped.components.pv_terminal < uncapped.components.pv_terminal);
  // TV_capped = (0.05 * 1210) / 0.10 = 605 -> PV 454.55
  assert.equal(Math.round(capped.components.pv_terminal * 100) / 100, 454.55);
}

// Terminal growth raises value; r <= g is rejected instead of exploding.
{
  const g0 = computeYooRimRow({ px: 2000, pbr: 2, roe: 0.2, discountRate: 0.1, retention: 0.5, terminalGrowth: 0, key: "t", name: "T", date: "d" });
  const g25 = computeYooRimRow({ px: 2000, pbr: 2, roe: 0.2, discountRate: 0.1, retention: 0.5, terminalGrowth: 0.025, key: "t", name: "T", date: "d" });
  assert.ok(g25.fair_value > g0.fair_value);
  const bad = computeYooRimRow({ px: 2000, pbr: 2, roe: 0.2, discountRate: 0.02, retention: 0.5, terminalGrowth: 0.025, key: "t", name: "T", date: "d" });
  assert.equal(bad.status, "excluded");
}

// ROE below r produces fair value below book — negative spread reduces.
{
  const row = computeYooRimRow({ px: 900, pbr: 1.0, roe: 0.05, discountRate: 0.1, retention: 0.5, key: "t", name: "T", date: "d" });
  assert.ok(row.fair_value < row.book_value);
}

// Missing inputs exclude with reasons; no fabricated numbers.
{
  const row = computeYooRimRow({ px: 100, pbr: null, roe: 0.2, discountRate: 0.1, retention: 0.5, key: "t", name: "T", date: "d" });
  assert.equal(row.status, "excluded");
  assert.match(row.reason, /px_to_book_ratio/);
  const zero = computeYooRimRow({ px: 100, pbr: 0, roe: 0.2, discountRate: 0.1, retention: 0.5, key: "t", name: "T", date: "d" });
  assert.equal(zero.status, "excluded");
  const badRet = computeYooRimRow({ px: 100, pbr: 1, roe: 0.2, discountRate: 0.1, retention: 1.2, key: "t", name: "T", date: "d" });
  assert.equal(badRet.status, "excluded");
}

// A speaker-stated ROE override replaces the observed spot ROE for the whole
// computation, and both values plus the source stay visible in the row.
{
  const row = computeYooRimRow({
    px: 2000, pbr: 2.0, roe: 0.34, discountRate: 0.1, retention: 0.5,
    terminalGrowth: 0, terminalRoeCap: 0.99,
    roeOverride: { value: 0.2, source: "yoo_stated_3y_average_roe" },
    key: "t", name: "T", date: "d",
  });
  assert.equal(Math.round(row.fair_value * 100) / 100, 2181.82, "override 0.20 reproduces the ROE-20% reference value");
  assert.equal(row.forward_roe_observed, 0.34);
  assert.equal(row.roe_used, 0.2);
  assert.equal(row.roe_override_source, "yoo_stated_3y_average_roe");
}

// Input priority: a speaker-stated override beats the consensus path.
{
  const row = computeYooRimRow({
    px: 2000, pbr: 2.0, roe: 0.34, discountRate: 0.1, retention: 0.5,
    terminalGrowth: 0, terminalRoeCap: 0.99,
    roeOverride: { value: 0.2, source: "yoo_stated_3y_average_roe" },
    roePath: [0.34, 0.35, 0.29],
    key: "t", name: "T", date: "d",
  });
  assert.equal(Math.round(row.fair_value * 100) / 100, 2181.82, "path is ignored when a stated override exists");
  assert.equal(row.roe_path, null);
}

// A per-year path drives each year and the terminal uses the faded final year.
{
  const constant = computeYooRimRow({
    px: 2000, pbr: 2.0, roe: 0.2, discountRate: 0.1, retention: 0.5,
    terminalGrowth: 0, terminalRoeCap: 0.99, key: "t", name: "T", date: "d",
  });
  const fading = computeYooRimRow({
    px: 2000, pbr: 2.0, roe: 0.2, discountRate: 0.1, retention: 0.5,
    terminalGrowth: 0, terminalRoeCap: 0.99, roePath: [0.2, 0.18, 0.15],
    key: "t", name: "T", date: "d",
  });
  assert.ok(fading.fair_value < constant.fair_value, "a fading path lowers the value");
  assert.equal(fading.terminal_roe, 0.15, "terminal uses the final path year");
  assert.deepEqual(fading.roe_path, [0.2, 0.18, 0.15]);
}

// Calibration check: within-tolerance and diverged classifications, and the
// KOSPI fair-range anchor path.
{
  const rows = [
    { key: "sp500", status: "ready", upside_pct: 9.0, fair_value: 8000 },
    { key: "nasdaq100", status: "ready", upside_pct: 5.0, fair_value: 30000 },
    { key: "kospi", status: "ready", upside_pct: 60, fair_value: 10500 },
  ];
  const results = checkCalibration(rows);
  assert.equal(results.find((r) => r.key === "sp500").status, "within_tolerance");
  assert.equal(results.find((r) => r.key === "nasdaq100").status, "diverged", "+5% vs published +25~30% must flag");
  assert.equal(results.find((r) => r.key === "kospi").status, "within_tolerance", "10,500 sits in the published 10,000-12,000 band");
  const missing = checkCalibration([]);
  assert.ok(missing.every((r) => r.status === "unavailable"));
}

// DWY sheet cell: hand-computed reference. B0 = 1000, path [0.2, 0.2, 0.2],
// retention 0.5, rf 0.04, ERP 0.06 -> r = 0.10. Explicit legs are the 2181.82
// case's 272.73; terminal book = 1331, LT ROE 0.15 -> RI = 0.05*1331 = 66.55,
// perpetuity 665.5, PV 665.5/1.331 = 500 -> V = 1000 + 272.73 + 500 = 1772.73.
{
  const v = computeYooSheetCell({
    bookValue: 1000, roePath: [0.2, 0.2, 0.2], retention: 0.5,
    riskFree: 0.04, erp: 0.06, ltRoe: 0.15,
  });
  assert.equal(Math.round(v * 100) / 100, 1772.73);
}

// Sheet case: 3x3 matrix mean sits between the min and max cells, the LT rows
// are FY3 x haircut +-0.5%p, and a higher haircut (Likely) beats Worst.
{
  const base = { px: 1500, bookValue: 1000, roePath: [0.3, 0.25, 0.2], retention: 0.8, riskFree: 0.0468 };
  const worst = computeYooSheetCase({ ...base, haircut: 0.735 });
  const likely = computeYooSheetCase({ ...base, haircut: 0.81 });
  assert.deepEqual(likely.lt_roe_rows, [0.157, 0.162, 0.167], "0.2 x 0.81 = 0.162 center, +-0.5%p");
  assert.ok(likely.fair_value > worst.fair_value);
  assert.ok(likely.upside_min_pct < likely.upside_pct && likely.upside_pct < likely.upside_max_pct);
  assert.equal(likely.erp_grid.length * likely.lt_roe_rows.length, 9, "nine cells");
}

// Contract pins: house assumption axes are explicit.
assert.deepEqual(YOO_MARKET_RATES, { us: 0.08, kr: 0.0971 });
assert.equal(YOO_CALIBRATION_ANCHORS.length >= 3, true, "anchors exist for sp500/nasdaq100/kospi");
assert.equal(YOO_DISCOUNT_SENSITIVITY[0], 0.08, "headline rate is the Yoo-calibrated 8%");
assert.ok(YOO_DISCOUNT_SENSITIVITY.includes(0.0971), "house ERP-derived rate stays visible");
assert.equal(YOO_EXPLICIT_YEARS, 3);
assert.equal(YOO_TERMINAL_GROWTH, 0.025);
assert.equal(YOO_TERMINAL_ROE_CAP, null, "no global cap; speaker overrides carry the correction");

console.log("build-rim-yoo-index tests passed");
