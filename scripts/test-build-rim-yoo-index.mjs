import assert from "node:assert/strict";
import { computeYooRimRow, YOO_PERSISTENCE_SCENARIOS, YOO_DISCOUNT_SENSITIVITY } from "./build-rim-yoo-index.mjs";

// Hand-computed reference: B0 = 1000, ROE 20%, r 10%, w = 1.0
//   V = B0 + (ROE - r) * B0 * w / (1 + r - w) = 1000 + 0.10*1000*1/(1.10-1.0) = 2000
{
  const row = computeYooRimRow({
    key: "test_index",
    name: "Test",
    px: 1500,
    pbr: 1.5,
    roe: 0.2,
    date: "2026-07-31",
    discountRate: 0.1,
  });
  assert.equal(row.book_value, 1000);
  const w1 = row.scenarios.find((s) => s.w === 1.0);
  assert.equal(Math.round(w1.fair_value), 2000);
  assert.equal(Math.round(w1.upside_pct * 100) / 100, 33.33, "2000/1500 - 1 = +33.33%");
  // w = 0.9: 0.10*1000*0.9 / (1.10 - 0.9) = 90/0.20 = 450 -> V = 1450
  const w09 = row.scenarios.find((s) => s.w === 0.9);
  assert.equal(Math.round(w09.fair_value), 1450);
  assert.ok(w09.fair_value < w1.fair_value, "lower persistence must not raise fair value");
}

// ROE below the discount rate produces a fair value BELOW book plus nothing —
// negative residual income must reduce, never inflate.
{
  const row = computeYooRimRow({
    key: "t", name: "T", px: 900, pbr: 1.0, roe: 0.05, date: "2026-07-31", discountRate: 0.1,
  });
  const w1 = row.scenarios.find((s) => s.w === 1.0);
  assert.ok(w1.fair_value < row.book_value, "negative spread lowers value below book");
}

// Missing inputs exclude the row with an explicit reason instead of emitting
// a fabricated number.
{
  const row = computeYooRimRow({ key: "t", name: "T", px: 100, pbr: null, roe: 0.2, date: "2026-07-31", discountRate: 0.1 });
  assert.equal(row.status, "excluded");
  assert.match(row.reason, /px_to_book_ratio/);
}
{
  const row = computeYooRimRow({ key: "t", name: "T", px: 100, pbr: 0, roe: 0.2, date: "2026-07-31", discountRate: 0.1 });
  assert.equal(row.status, "excluded", "zero PBR cannot produce a book value");
}

// Contract pins: the published scenario and sensitivity axes are explicit
// house assumptions, not observations.
assert.deepEqual(YOO_PERSISTENCE_SCENARIOS, [1.0, 0.9, 0.8]);
assert.ok(YOO_DISCOUNT_SENSITIVITY.length >= 2, "at least house rate plus one alternative");
for (const r of YOO_DISCOUNT_SENSITIVITY) assert.ok(r > 0.03 && r < 0.2);

console.log("build-rim-yoo-index tests passed");
