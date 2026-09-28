import assert from "node:assert/strict";
import { readPriceTargets } from "./price-target";

function test(name: string, run: () => void): void {
  run();
  console.log(`ok - ${name}`);
}

// NVDA yf fetch 2026-09-24: the analyst stamp lags the quote in the same file.
const nvdaTargets = { current: 217.2119, high: 500, low: 180, mean: 302.82758, median: 300 };

test("upside is measured from the displayed quote, not the analyst stamp", () => {
  const read = readPriceTargets(nvdaTargets, 225.51);
  assert.equal(read.current, 225.51);
  assert.equal(read.basis, "quote");
  assert.equal(Math.round(read.upsidePct! * 1000) / 10, 34.3);
});

test("the analyst stamp is only a fallback when no quote exists", () => {
  for (const quote of [null, undefined, Number.NaN, 0]) {
    const read = readPriceTargets(nvdaTargets, quote);
    assert.equal(read.current, 217.2119);
    assert.equal(read.basis, "analyst-stamp");
    assert.equal(Math.round(read.upsidePct! * 1000) / 10, 39.4);
  }
});

test("no price and no mean leave upside unknown instead of inventing one", () => {
  assert.deepEqual(readPriceTargets({ mean: 300 }, null), {
    current: null,
    basis: null,
    low: null,
    mean: 300,
    median: null,
    high: null,
    upsidePct: null,
  });
  assert.equal(readPriceTargets({ current: 200 }, 210).upsidePct, null);
  assert.equal(readPriceTargets(null, 210).upsidePct, null);
  assert.equal(readPriceTargets("bad", 210).current, 210);
});
