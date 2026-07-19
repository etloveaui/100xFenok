#!/usr/bin/env tsx

import assert from "node:assert/strict";

import {
  etfClassificationLabels,
  formatTypeHint,
  isInverseEtf,
  isLeveragedEtf,
  isSingleStockLeveragedEtf,
  type EtfUniverseRecord,
} from "../src/app/explore/etfUniverseUtils";

function fixture(overrides: EtfUniverseRecord): EtfUniverseRecord {
  return {
    ticker: "TEST",
    name: "Plain ETF",
    category: "Equity",
    issuer: "Fixture",
    ...overrides,
  };
}

const highConfidencePlain = fixture({
  name: "Example 2x Long NVDA Daily ETF",
  classification: {
    is_leveraged: false,
    is_inverse: false,
    is_single_stock: false,
    confidence: "high",
  },
});
assert.equal(isLeveragedEtf(highConfidencePlain), false, "high-confidence plain classification must beat regex");
assert.equal(isSingleStockLeveragedEtf(highConfidencePlain), false, "high-confidence plain single-stock classification must beat regex");

const lowConfidenceNoSignal = fixture({
  name: "Example 2x Long NVDA Daily ETF",
  classification: {
    is_leveraged: false,
    is_inverse: false,
    is_single_stock: false,
    confidence: "low",
  },
});
assert.equal(isLeveragedEtf(lowConfidenceNoSignal), true, "low-confidence no-signal classification should allow leveraged fallback");
assert.equal(
  isSingleStockLeveragedEtf(lowConfidenceNoSignal),
  true,
  "low-confidence no-signal classification should allow single-stock fallback",
);

const lowConfidencePositiveSignal = fixture({
  name: "Plain Treasury ETF",
  classification: {
    is_inverse: true,
    confidence: "low",
  },
});
assert.equal(isInverseEtf(lowConfidencePositiveSignal), true, "positive stored signal should remain authoritative");

const mediumConfidencePositiveSignal = fixture({
  name: "Plain Equity ETF",
  classification: {
    is_leveraged: true,
    leverage_factor: 2,
    confidence: "medium",
  },
});
assert.equal(isLeveragedEtf(mediumConfidencePositiveSignal), true, "medium-confidence positive leveraged signal should remain authoritative");
assert.match(formatTypeHint(mediumConfidencePositiveSignal), /2배/, "stored leverage factor should remain visible");
assert.deepEqual(etfClassificationLabels(mediumConfidencePositiveSignal), ["2배 레버리지"], "stored leverage label should use the shared multiple language");

const legacyFlatClassification = fixture({
  name: "Plain Equity ETF",
  is_leveraged: true,
  leverage_factor: 3,
});
assert.equal(isLeveragedEtf(legacyFlatClassification), true, "legacy flat classification fields should still work");
assert.match(formatTypeHint(legacyFlatClassification), /3배/, "legacy flat leverage factor should remain visible");

console.log("ETF classification confidence check passed (5 fixtures)");
