import assert from "node:assert/strict";
import { epsSignFlip, formatEps, formatEpsRevisionChange, listingCurrency, readEpsRevision } from "./eps-revision";

function test(name: string, run: () => void): void {
  run();
  console.log(`ok - ${name}`);
}

test("a zero crossing reads as the turn, not as a ratio", () => {
  // 비나텍 2026-09-11 -> 09-18: 281 -> -2,454, change_1w -9.7331
  const rev = readEpsRevision({ eps_fy1: -2454, eps_fy1_prev: 281, change_1w: -9.7331 });
  assert.deepEqual(rev, { before: 281, after: -2454, flip: "to-loss" });
  assert.equal(formatEpsRevisionChange(-9.7331, rev.flip), "적자 전환");
  assert.equal(formatEpsRevisionChange(0.5, epsSignFlip(-10, 5)), "흑자 전환");
});

test("same-sign revisions keep the signed ratio", () => {
  // 제주항공: loss narrows -378 -> -265 = +29.9% (upward revision)
  const rev = readEpsRevision({ eps_fy1: -265, eps_fy1_prev: -378 });
  assert.equal(rev.flip, null);
  assert.equal(formatEpsRevisionChange(0.2989, rev.flip), "+29.9%");
  assert.equal(formatEpsRevisionChange(-0.8182, null), "-81.8%");
  assert.equal(epsSignFlip(0, 5), null);
  assert.equal(epsSignFlip(5, 0), null);
});

test("feeds without the prior week leave before unknown and never guess a flip", () => {
  const rev = readEpsRevision({ eps_fy1: -2454, change_1w: -9.7331 });
  assert.deepEqual(rev, { before: null, after: -2454, flip: null });
  assert.equal(formatEpsRevisionChange(-9.7331, rev.flip), "-973.3%");
});

test("EPS is formatted in the listing currency", () => {
  assert.equal(listingCurrency("126340.KQ"), "KRW");
  assert.equal(listingCurrency("0700.hk"), "HKD");
  assert.equal(listingCurrency("GILD"), "USD");
  assert.equal(listingCurrency("BMW.DE"), "EUR");
  assert.equal(listingCurrency("MC.PA"), "EUR");
  assert.equal(listingCurrency("2454.TW"), "TWD");
  assert.equal(listingCurrency("BRK.B"), "USD");
  assert.equal(formatEps(9.51, "BMW.DE"), "€9.51");
  assert.equal(formatEps(-2454, "126340.KQ"), "-₩2,454");
  assert.equal(formatEps(-0.44, "GILD"), "-$0.44");
  assert.equal(formatEps(null, "GILD"), "—");
});
