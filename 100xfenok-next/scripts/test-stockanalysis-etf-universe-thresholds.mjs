#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  MIN_MERGED_EXPENSE_RATIO_COUNT,
  deriveStockAnalysisEtfUniverseThresholds,
} from "./stockanalysis-etf-universe-thresholds.mjs";

const baseline = deriveStockAnalysisEtfUniverseThresholds(4731);
assert.equal(baseline.baseline_satisfied, true);
assert.equal(baseline.catalog_participation_floor, 4684);
assert.equal(baseline.expense_ratio_floor, 4684);

const grown = deriveStockAnalysisEtfUniverseThresholds(4782);
assert.equal(grown.catalog_participation_floor, 4735);
assert.equal(grown.expense_ratio_floor, 4684, "new primary files must not inflate the R2.4 expense-ratio floor");

const belowBaseline = deriveStockAnalysisEtfUniverseThresholds(4730);
assert.equal(belowBaseline.baseline_satisfied, false);
const shrunkenMergedCount = 4684;
const oldDynamicExpenseFloor = Math.ceil(shrunkenMergedCount * 0.99);
assert.equal(oldDynamicExpenseFloor, 4638);
assert.equal(4638 >= oldDynamicExpenseFloor, true, "the old dynamic denominator would hide this regression");
assert.equal(4638 < belowBaseline.expense_ratio_floor, true, "the fixed R2.4 floor must catch denominator shrink");
assert.equal(MIN_MERGED_EXPENSE_RATIO_COUNT, 5000);

assert.throws(() => deriveStockAnalysisEtfUniverseThresholds(-1), /non-negative integer/);
assert.throws(() => deriveStockAnalysisEtfUniverseThresholds(4731.5), /non-negative integer/);

console.log("test-stockanalysis-etf-universe-thresholds: ok");
