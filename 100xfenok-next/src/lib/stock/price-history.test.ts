import { test } from "node:test";
import assert from "node:assert/strict";
import { quotedDailyBars } from "./price-history";

type Quoted = { date: string; open: number; high: number; low: number; close: number; volume?: number; dividend?: number };

/** What yfinance auto_adjust stores: each ex-dividend scales every earlier bar by (1 - D / prior close). */
function autoAdjust(quoted: Quoted[]) {
  const multipliers = quoted.map(() => 1);
  for (let i = 1; i < quoted.length; i += 1) {
    const dividend = quoted[i].dividend ?? 0;
    if (dividend <= 0) continue;
    const m = 1 - dividend / quoted[i - 1].close;
    for (let j = 0; j < i; j += 1) multipliers[j] *= m;
  }
  return quoted.map((row, i) => ({
    date: row.date,
    Open: row.open * multipliers[i],
    High: row.high * multipliers[i],
    Low: row.low * multipliers[i],
    Close: row.close * multipliers[i],
    Volume: row.volume ?? 1000,
    Dividends: row.dividend ?? 0,
    "Stock Splits": 0,
  }));
}

const QUOTED: Quoted[] = [
  { date: "2026-03-10", open: 60, high: 61, low: 59, close: 60 },
  { date: "2026-03-11", open: 60, high: 62, low: 59.5, close: 61 },
  { date: "2026-03-12", open: 60.4, high: 60.9, low: 60, close: 60.5, dividend: 0.51 },
  { date: "2026-03-13", open: 60.5, high: 61.2, low: 60.1, close: 61 },
  { date: "2026-06-12", open: 64, high: 65, low: 63.5, close: 64.2, dividend: 0.53 },
  { date: "2026-06-15", open: 64.2, high: 64.8, low: 63.9, close: 64.5 },
];

function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

test("undoes the dividend scaling so bars read as quoted", () => {
  const bars = quotedDailyBars(autoAdjust(QUOTED));
  assert.equal(bars.length, QUOTED.length);
  bars.forEach((bar, i) => {
    assert.equal(bar.time, QUOTED[i].date);
    close(bar.open, QUOTED[i].open);
    close(bar.high, QUOTED[i].high);
    close(bar.low, QUOTED[i].low);
    close(bar.close, QUOTED[i].close);
  });
});

test("the stored series itself is lower before each ex-date (what is being undone)", () => {
  const stored = autoAdjust(QUOTED);
  assert.ok(stored[0].Close < QUOTED[0].close);
  close(stored[5].Close, QUOTED[5].close);
});

test("skips the in-progress row but keeps its dividend", () => {
  const stored = autoAdjust([...QUOTED, { date: "2026-06-16", open: 64, high: 64, low: 64, close: 64.3, dividend: 0.4 }]);
  const partial = { date: stored[6].date, Volume: 5000, Dividends: 0.4, "Stock Splits": 0 };
  const bars = quotedDailyBars([...stored.slice(0, 6), partial]);
  assert.equal(bars.length, 6);
  assert.equal(bars[bars.length - 1].time, "2026-06-15");
  bars.forEach((bar, i) => close(bar.close, QUOTED[i].close));
});

test("sorts by date, keeps the last row for a repeated date, and drops undated rows", () => {
  const stored = autoAdjust(QUOTED);
  const shuffled = [stored[3], stored[0], { ...stored[1], Close: 1 }, stored[1], stored[2], { date: "not-a-date", Close: 5 }, stored[5], stored[4]];
  const bars = quotedDailyBars(shuffled);
  assert.deepEqual(bars.map((bar) => bar.time), QUOTED.map((row) => row.date));
  close(bars[1].close, QUOTED[1].close);
});

test("returns no bars for a missing or malformed history", () => {
  assert.deepEqual(quotedDailyBars(undefined), []);
  assert.deepEqual(quotedDailyBars(null), []);
  assert.deepEqual(quotedDailyBars({ history: [] }), []);
  assert.deepEqual(quotedDailyBars([null, 3, "x"]), []);
});

test("keeps volume as stored and leaves it out when absent", () => {
  const stored = autoAdjust(QUOTED);
  const bars = quotedDailyBars([{ ...stored[0], Volume: undefined }, stored[1]]);
  assert.equal(bars[0].volume, undefined);
  assert.equal(bars[1].volume, 1000);
});
