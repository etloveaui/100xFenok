import assert from "node:assert/strict";
import {
  computeYooRimRow,
  YOO_DISCOUNT_SENSITIVITY,
  YOO_EXPLICIT_YEARS,
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

// Contract pins: house assumption axes are explicit.
assert.equal(YOO_DISCOUNT_SENSITIVITY[0], 0.08, "headline rate is the Yoo-calibrated 8%");
assert.ok(YOO_DISCOUNT_SENSITIVITY.includes(0.0971), "house ERP-derived rate stays visible");
assert.equal(YOO_EXPLICIT_YEARS, 3);
assert.equal(YOO_TERMINAL_GROWTH, 0.025);
assert.equal(YOO_TERMINAL_ROE_CAP, null, "no global cap; speaker overrides carry the correction");

console.log("build-rim-yoo-index tests passed");
