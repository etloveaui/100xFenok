import assert from "node:assert/strict";
import { holdingEntries, overlapFor, pairOverlaps, parseTickers } from "../src/app/etfs/compare/etfCompareOverlap";
import type { EtfCompareRow } from "../src/app/etfs/compare/etfCompareOverlap";

function row(ticker: string, holdings: NonNullable<NonNullable<EtfCompareRow["data"]>["normalized"]>["holdings"]): EtfCompareRow {
  return {
    ticker,
    failed: false,
    data: {
      ticker,
      fetched_at: "2026-06-23T00:00:00Z",
      normalized: {
        holdings_updated: "2026-06-17",
        holdings,
      },
    },
  };
}

assert.deepEqual(parseTickers("spy, voo SPY qqq dia iwm"), ["SPY", "VOO", "QQQ", "DIA"]);
assert.deepEqual(parseTickers("$brk.b, brk-b, 123BAD, x"), ["BRK.B", "BRK-B", "X"]);

const spy = row("SPY", [
  { symbol: "NVDA", name: "NVIDIA Corp", weight_pct: 7.8 },
  { symbol: "AAPL", name: "Apple Inc", weight_pct: 6.8 },
  { symbol: "", name: "Cash and Treasury", weight_pct: 0.3 },
]);
const voo = row("VOO", [
  { symbol: "NVDA", name: "NVIDIA Corp", weight_pct: 7.2 },
  { symbol: "MSFT", name: "Microsoft Corp", weight_pct: 6.4 },
]);
const qqq = row("QQQ", [
  { symbol: "AAPL", name: "Apple Inc", weight_pct: 8.1 },
  { symbol: "MSFT", name: "Microsoft Corp", weight_pct: 7.3 },
]);

assert.deepEqual(holdingEntries(spy).map((entry) => entry.symbol), ["NVDA", "AAPL"]);

const spyVoo = overlapFor(spy, voo);
assert.equal(spyVoo.common.length, 1);
assert.equal(spyVoo.common[0]?.symbol, "NVDA");
assert.equal(spyVoo.overlapWeight, 7.2);

const pairs = pairOverlaps([spy, voo, qqq]);
assert.equal(pairs.length, 3);
assert.deepEqual(pairs.map((pair) => `${pair.left.ticker}/${pair.right.ticker}`), ["SPY/VOO", "SPY/QQQ", "VOO/QQQ"]);

console.log("ETF compare overlap checks passed.");
