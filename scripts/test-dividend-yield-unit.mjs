#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  emptyDividendYieldUnitMix,
  resolveDividendYieldFraction,
  tallyDividendYieldUnit,
} from "./lib/dividend-yield-unit.mjs";
import { normalizeDividendYieldFraction } from "./build-rim-index.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// The four cases the field actually produces, using real published values.
// ---------------------------------------------------------------------------

// MTB pays 6.00 on a 246.29 price, a 2.44% yield, and stores 2.43 -- percent.
const mtb = resolveDividendYieldFraction({
  symbol: "MTB", dividendYield: 2.43, price: 246.29, dividendHistory: { ttm: 6 },
});
assert.equal(mtb.unit, "percent", "MTB's own dividend and price can only support a percent reading");
assert.ok(Math.abs(mtb.value - 0.0243) < 0.0005, `MTB must become a fraction, got ${mtb.value}`);

// AAPL pays 1.05 on a 333.02 price, a 0.32% yield, and stores 0.00321 -- fraction.
const aapl = resolveDividendYieldFraction({
  symbol: "AAPL", dividendYield: 0.0032130202390246838, price: 333.02, dividendHistory: { ttm: 1.05 },
});
assert.equal(aapl.unit, "fraction", "AAPL is already a fraction");
assert.equal(aapl.value, 0.0032130202390246838, "a fraction row passes through untouched");

// KRX rows carry neither price nor trailing dividend. Fail closed.
const krx = resolveDividendYieldFraction({
  symbol: "001450.KS", dividendYield: 0.0346964, price: null, dividendHistory: null,
});
assert.equal(krx.value, null, "an unmeasurable row must not be guessed");
assert.equal(krx.unit, "unresolved", "and must say so");
assert.ok(krx.reason.length > 0, "and state why");

// A stored yield with no dividend behind it contradicts itself. Fail closed.
const contradiction = resolveDividendYieldFraction({
  symbol: "NODIV", dividendYield: 1.5, price: 100, dividendHistory: { ttm: 0 },
});
assert.equal(contradiction.value, null, "a contradictory row must not be guessed");
assert.equal(contradiction.unit, "unresolved", "and must say so");

// A real zero is a measurement.
const zero = resolveDividendYieldFraction({ dividendYield: 0, price: 10, dividendHistory: { ttm: 0 } });
assert.equal(zero.value, 0, "a genuine zero yield is a measurement, not a gap");
assert.equal(zero.unit, "zero");

// Negative and non-numeric inputs fail closed rather than propagating.
for (const bad of [-1, "abc", null, undefined, NaN, Infinity, {}]) {
  const result = resolveDividendYieldFraction({ dividendYield: bad, price: 100, dividendHistory: { ttm: 1 } });
  assert.equal(result.value, null, `dividendYield ${JSON.stringify(bad)} must fail closed`);
  assert.equal(result.unit, "unresolved");
}

// THE TRAP THE OLD HEURISTIC FELL INTO. A percent-encoded 0.4% yield is 0.4,
// which every magnitude threshold reads as a 40% fraction. Measurement does not
// care how large the number is.
const lowPercent = resolveDividendYieldFraction({
  dividendYield: 0.4, price: 100, dividendHistory: { ttm: 0.4 },
});
assert.equal(lowPercent.unit, "percent", "a sub-1 percent value is still a percent value");
assert.ok(Math.abs(lowPercent.value - 0.004) < 1e-9, `expected 0.004, got ${lowPercent.value}`);

// ---------------------------------------------------------------------------
// PARITY with the RIM boundary implementation. Two copies of a rule become two
// rules; this fails the moment they disagree on any input.
// ---------------------------------------------------------------------------
{
  const cases = [
    { dividendYield: 2.43, price: 246.29, dividendHistory: { ttm: 6 } },
    { dividendYield: 0.0032130202390246838, price: 333.02, dividendHistory: { ttm: 1.05 } },
    { dividendYield: 0.0346964, price: null, dividendHistory: null },
    { dividendYield: 1.5, price: 100, dividendHistory: { ttm: 0 } },
    { dividendYield: 0, price: 10, dividendHistory: { ttm: 0 } },
    { dividendYield: 0.4, price: 100, dividendHistory: { ttm: 0.4 } },
    { dividendYield: 8.15, price: 20, dividendHistory: { ttm: 1.63 } },
    { dividendYield: -1, price: 100, dividendHistory: { ttm: 1 } },
    { dividendYield: "2.43", price: 246.29, dividendHistory: { ttm: 6 } },
    {},
  ];
  for (const row of cases) {
    const shared = resolveDividendYieldFraction(row);
    const rim = normalizeDividendYieldFraction(row);
    assert.deepEqual(
      { value: shared.value, unit: shared.unit },
      { value: rim.value, unit: rim.unit },
      `shared rule and RIM disagree on ${JSON.stringify(row)}`,
    );
  }

  // And on every real row in the published artifact, not only on fixtures.
  const artifact = path.join(repoRoot, "data", "computed", "stock_action_index.json");
  if (fs.existsSync(artifact)) {
    const rows = JSON.parse(fs.readFileSync(artifact, "utf8")).rows ?? [];
    let compared = 0;
    for (const row of rows) {
      const shared = resolveDividendYieldFraction(row);
      const rim = normalizeDividendYieldFraction(row);
      assert.deepEqual(
        { value: shared.value, unit: shared.unit },
        { value: rim.value, unit: rim.unit },
        `shared rule and RIM disagree on published row ${row.symbol}`,
      );
      compared += 1;
    }
    assert.ok(compared > 500, `parity must be checked against the real population, only saw ${compared}`);
  }
}

// ---------------------------------------------------------------------------
// The mix tally is what keeps the population visible instead of averaged away.
// ---------------------------------------------------------------------------
{
  const mix = emptyDividendYieldUnitMix();
  assert.deepEqual(mix, { fraction: 0, percent: 0, zero: 0, unresolved: 0 });
  for (const unit of ["percent", "percent", "fraction", "zero", "unresolved", "nonsense"]) {
    tallyDividendYieldUnit(mix, unit);
  }
  assert.deepEqual(mix, { fraction: 1, percent: 2, zero: 1, unresolved: 1 }, "unknown units are not tallied");
}

// ---------------------------------------------------------------------------
// PROOF ON THE PUBLISHED POPULATION: the rule must actually resolve the 74 rows
// that are wrong today, and must not disturb the ones that are right.
// ---------------------------------------------------------------------------
{
  const artifact = path.join(repoRoot, "data", "computed", "stock_action_index.json");
  if (fs.existsSync(artifact)) {
    const rows = JSON.parse(fs.readFileSync(artifact, "utf8")).rows ?? [];
    const mix = emptyDividendYieldUnitMix();
    let stillAboveOne = 0;
    for (const row of rows) {
      const resolved = resolveDividendYieldFraction(row);
      tallyDividendYieldUnit(mix, resolved.unit);
      if (typeof resolved.value === "number" && resolved.value > 1) stillAboveOne += 1;
    }
    // The one thing that must hold whatever state the artifact is in: nothing
    // the rule resolves may exceed 100%. Deliberately NOT asserting that
    // percent-encoded rows are still present -- once the writer fix lands and
    // the bot regenerates, they are gone, and a test that demanded their
    // presence would fail for the best possible reason.
    assert.equal(stillAboveOne, 0, `${stillAboveOne} resolved yields are still above 100%`);
    assert.ok(mix.fraction > 0, "the population must contain resolvable fraction rows");
    assert.equal(
      mix.fraction + mix.percent + mix.zero + mix.unresolved,
      rows.length,
      "every row must be accounted for in the mix",
    );
  }
}

console.log("test-dividend-yield-unit: ok");
