#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  alignPriceTotalReturnSeries,
  deriveTrailingIndexDividendYield,
  dividendYieldToPayout,
} from "./lib/index-dividend-yield.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PREVIEW_2026_07_31 = Object.freeze({
  totalReturnRows: [
    { date: "2025-07-31", value: 25902.10 },
    { date: "2026-07-31", value: 31304.85 },
  ],
  priceReturnRows: [
    { date: "2025-07-31", value: 21122.450 },
    { date: "2026-07-31", value: 25373.853 },
  ],
  price: 25373.85,
  epsFy1: 1080.9544,
  expectedYield: 0.006084649376886242,
  expectedPayout: 0.1428283936784983,
});

const PREVIEW_2026_08_07 = Object.freeze({
  totalReturnRows: [
    { date: "2025-08-07", value: 26050.7 },
    { date: "2026-08-07", value: 32930.05 },
  ],
  priceReturnRows: [
    { date: "2025-08-07", value: 21242.7 },
    { date: "2026-08-07", value: 26690.62 },
  ],
  expectedYield: 0.006060379880316491,
});

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function closeTo(actual, expected, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} within ${tolerance}`);
}

test("aligns exact dates, sorts inputs, and drops one-sided observations", () => {
  const aligned = alignPriceTotalReturnSeries({
    totalReturnRows: [
      { date: "2026-01-01", value: 1100 },
      { date: "2025-06-01", value: 1050 },
      { date: "2025-01-01", value: 1000 },
    ],
    priceReturnRows: [
      { date: "2025-01-01", value: 100 },
      { date: "2026-01-01", value: 100 },
      { date: "2025-09-01", value: 100 },
    ],
  });
  assert.equal(aligned.ok, true);
  assert.deepEqual(aligned.rows.map((row) => row.date), ["2025-01-01", "2026-01-01"]);
  assert.deepEqual(aligned.source_clocks, {
    total_return_last_observation: "2026-01-01",
    price_return_last_observation: "2026-01-01",
    aligned_last_observation: "2026-01-01",
  });
});

test("preview 2026-07-31 reproduces measured yield and payout", () => {
  const derived = deriveTrailingIndexDividendYield(PREVIEW_2026_07_31);
  assert.equal(derived.ok, true);
  closeTo(derived.value, PREVIEW_2026_07_31.expectedYield);
  assert.equal(derived.date, "2026-07-31");
  assert.equal(derived.anchor_date, "2025-07-31");
  assert.equal(derived.lookback_days_actual, 365);
  const payout = dividendYieldToPayout({
    dividendYield: derived.value,
    price: PREVIEW_2026_07_31.price,
    epsFy1: PREVIEW_2026_07_31.epsFy1,
  });
  assert.equal(payout.ok, true);
  closeTo(payout.value, PREVIEW_2026_07_31.expectedPayout);
});

test("preview 2026-08-07 reproduces measured yield", () => {
  const derived = deriveTrailingIndexDividendYield(PREVIEW_2026_08_07);
  assert.equal(derived.ok, true);
  closeTo(derived.value, PREVIEW_2026_08_07.expectedYield);
});

test("selects t=max date<=asOf and s=max date<=t-365", () => {
  const derived = deriveTrailingIndexDividendYield({
    totalReturnRows: [
      { date: "2025-08-06", value: 1000 },
      { date: "2025-08-07", value: 1001 },
      { date: "2026-08-07", value: 1100 },
      { date: "2026-08-08", value: 1101 },
    ],
    priceReturnRows: [
      { date: "2025-08-06", value: 100 },
      { date: "2025-08-07", value: 100 },
      { date: "2026-08-07", value: 100 },
      { date: "2026-08-08", value: 100 },
    ],
    asOf: "2026-08-08",
  });
  assert.equal(derived.ok, true);
  assert.equal(derived.date, "2026-08-08");
  assert.equal(derived.anchor_date, "2025-08-07");
});

test("emits trailing_measured_index_yield and first-knowable source clocks", () => {
  const derived = deriveTrailingIndexDividendYield(PREVIEW_2026_07_31);
  assert.equal(derived.tier, "trailing_measured_index_yield");
  assert.equal(derived.unit, "fraction");
  assert.equal(derived.formula, "(T_t * P_s) / (T_s * P_t) - 1");
  assert.equal(derived.first_knowable_at, "2026-07-31");
  assert.equal(derived.source_clocks.used_observation, "2026-07-31");
  assert.equal(derived.source_clocks.anchor_observation, "2025-07-31");
  assert.equal(derived.source_clocks.all_used_inputs_at_or_before, "2026-07-31");
  assert.match(derived.source, /NASDAQXCMP\/NASDAQCOM/);
});

test("is pure and does not mutate caller rows", () => {
  const input = structuredClone(PREVIEW_2026_08_07);
  const before = structuredClone(input);
  const first = deriveTrailingIndexDividendYield(input);
  const second = deriveTrailingIndexDividendYield(input);
  assert.deepEqual(input, before);
  assert.deepEqual(first, second);
});

test("fails closed for missing series", () => {
  assert.equal(deriveTrailingIndexDividendYield({ totalReturnRows: [], priceReturnRows: [] }).code, "missing_series");
});

test("fails closed for malformed or impossible calendar dates", () => {
  for (const badDate of ["2026-07-31T00:00:00Z", "2026-02-30", null]) {
    const input = structuredClone(PREVIEW_2026_07_31);
    input.totalReturnRows[0].date = badDate;
    assert.equal(deriveTrailingIndexDividendYield(input).code, "invalid_date");
  }
});

test("fails closed for duplicate dates", () => {
  const input = structuredClone(PREVIEW_2026_07_31);
  input.totalReturnRows.push({ ...input.totalReturnRows[0] });
  assert.equal(deriveTrailingIndexDividendYield(input).code, "duplicate_date");
});

test("fails closed for nonpositive or nonfinite values", () => {
  for (const badValue of [0, -1, "N/A", Infinity]) {
    const input = structuredClone(PREVIEW_2026_07_31);
    input.priceReturnRows[0].value = badValue;
    assert.equal(deriveTrailingIndexDividendYield(input).code, "invalid_value");
  }
});

test("fails closed when PR/TR have no exact aligned dates", () => {
  const input = structuredClone(PREVIEW_2026_07_31);
  input.priceReturnRows = input.priceReturnRows.map((row) => ({ ...row, date: row.date.replace("31", "30") }));
  assert.equal(deriveTrailingIndexDividendYield(input).code, "no_aligned_observations");
});

test("fails closed for invalid asOf and invalid gates", () => {
  assert.equal(deriveTrailingIndexDividendYield({ ...PREVIEW_2026_07_31, asOf: "bad" }).code, "invalid_asof");
  assert.equal(deriveTrailingIndexDividendYield({ ...PREVIEW_2026_07_31, lookbackDays: 0 }).code, "invalid_lookback");
  assert.equal(deriveTrailingIndexDividendYield({ ...PREVIEW_2026_07_31, maxObservationAgeDays: -1 }).code, "invalid_freshness_gate");
  assert.equal(deriveTrailingIndexDividendYield({ ...PREVIEW_2026_07_31, minimumTrPrRatio: 0 }).code, "invalid_ratio_gate");
  assert.equal(deriveTrailingIndexDividendYield({ ...PREVIEW_2026_07_31, maximumYield: -1 }).code, "invalid_yield_gate");
});

test("fails closed when asOf precedes the first aligned observation", () => {
  assert.equal(
    deriveTrailingIndexDividendYield({ ...PREVIEW_2026_07_31, asOf: "2025-01-01" }).code,
    "asof_before_first_observation",
  );
});

test("fails closed when aligned history is shorter than lookback", () => {
  const input = structuredClone(PREVIEW_2026_07_31);
  input.totalReturnRows = input.totalReturnRows.slice(1);
  input.priceReturnRows = input.priceReturnRows.slice(1);
  assert.equal(deriveTrailingIndexDividendYield(input).code, "lookback_missing");
});

test("fails closed when the selected aligned observation is stale", () => {
  assert.equal(
    deriveTrailingIndexDividendYield({ ...PREVIEW_2026_07_31, asOf: "2026-08-30" }).code,
    "stale_observations",
  );
  const withinGate = deriveTrailingIndexDividendYield({ ...PREVIEW_2026_07_31, asOf: "2026-08-01" });
  assert.equal(withinGate.ok, true);
  assert.equal(withinGate.observation_age_days, 1);
});

test("fails closed for a PR/TR unit-ratio mismatch", () => {
  const input = structuredClone(PREVIEW_2026_08_07);
  input.totalReturnRows = input.totalReturnRows.map((row) => ({ ...row, value: row.value * 0.5 }));
  assert.equal(deriveTrailingIndexDividendYield(input).code, "tr_pr_ratio_below_gate");
});

test("fails closed when derived yield is outside gate", () => {
  const input = structuredClone(PREVIEW_2026_08_07);
  input.totalReturnRows[0].value *= 100;
  assert.equal(deriveTrailingIndexDividendYield(input).code, "yield_out_of_gate");
});

test("payout conversion pins y*price/epsFY1 and metadata", () => {
  const payout = dividendYieldToPayout({ dividendYield: 0.006, price: 25000, epsFy1: 1000 });
  assert.deepEqual(payout, {
    ok: true,
    value: 0.15,
    unit: "fraction",
    formula: "dividend_yield * price / eps_fy1",
    basis: "trailing_measured_index_dividends_over_forward_fy1_earnings",
  });
});

test("payout conversion fails closed for missing, invalid, and out-of-gate inputs", () => {
  assert.equal(dividendYieldToPayout({ dividendYield: -0.01, price: 100, epsFy1: 1 }).code, "invalid_yield_input");
  assert.equal(dividendYieldToPayout({ dividendYield: 0.01, price: 0, epsFy1: 1 }).code, "invalid_price");
  assert.equal(dividendYieldToPayout({ dividendYield: 0.01, price: 100, epsFy1: 0 }).code, "invalid_eps");
  assert.equal(dividendYieldToPayout({ dividendYield: 0.05, price: 100, epsFy1: 1 }).code, "payout_out_of_gate");
  assert.equal(dividendYieldToPayout({ dividendYield: 0.01, price: 100, epsFy1: 1, maximumPayout: -1 }).code, "invalid_payout_gate");
});

test("module is dependency-free and isolated from valuation/output contracts", () => {
  const source = fs.readFileSync(path.join(__dirname, "lib/index-dividend-yield.mjs"), "utf8");
  assert.equal(/^\s*import\s/m.test(source), false, "pure module must not import runtime dependencies");
  for (const banned of [
    "build-rim-index.mjs",
    "build-rim-index-five-canonical.mjs",
    "build-fenok-rim-owner-ordered-current.mjs",
    "FENO_RIM_FIVE_CANONICAL_CURRENT",
    "fenok-rim-calibration-evidence",
    "SOXX",
  ]) {
    assert.equal(source.includes(banned), false, `pure module must not depend on ${banned}`);
  }
});

console.log(`\n${passed} checks passed`);
