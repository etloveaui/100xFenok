import assert from "node:assert/strict";

import { SECTOR_DEFINITIONS } from "../src/lib/dashboard/constants";
import { buildDashboardSnapshot } from "../src/lib/dashboard/snapshot-builder";

const point = [{ date: "2026-09-19", value: 1 }];
const required = {
  fearGreed: [{ date: "2026-09-19", score: 50 }],
  vix: null,
  putCall: null,
  crypto: null,
  benchmarkSource: { sections: { momentum: { data: point } } },
  weeklyBanking: null,
  quarterlyBanking: null,
  dailyBanking: { series: { DGS10: point, BAMLH0A0HYM2: point } },
  indexTicker: {},
};

const priceOnlyTickers = Object.fromEntries(SECTOR_DEFINITIONS.map(({ etf }) => [
  etf,
  { price: 100, state: { status: "ready", asOf: "2026-09-19T20:00:00Z" } },
]));

const priceOnly = buildDashboardSnapshot({
  ...required,
  summaries: null,
  sectorTicker: priceOnlyTickers,
} as Parameters<typeof buildDashboardSnapshot>[0]);
assert.equal(priceOnly.judgmentInputsReady, false, "price without a finite sector change is not a judgment input");
assert.equal(priceOnly.sectorInputsReady, false);

const partialBenchmark = buildDashboardSnapshot({
  ...required,
  summaries: { momentum: { [SECTOR_DEFINITIONS[0].key]: { "1m": 0.03 } } },
  sectorTicker: {},
} as Parameters<typeof buildDashboardSnapshot>[0]);
assert.equal(partialBenchmark.judgmentInputsReady, false, "partial benchmark momentum must not fill missing sectors with zero");
assert.equal(partialBenchmark.sectorInputsReady, false);

const completeBenchmark = buildDashboardSnapshot({
  ...required,
  summaries: {
    momentum: Object.fromEntries(SECTOR_DEFINITIONS.map(({ key }) => [key, { "1m": 0.03 }])),
  },
  sectorTicker: {},
} as Parameters<typeof buildDashboardSnapshot>[0]);
assert.equal(completeBenchmark.judgmentInputsReady, true);
assert.equal(completeBenchmark.sectorInputsReady, true);

const unavailableTickers = buildDashboardSnapshot({
  ...required,
  summaries: {
    momentum: Object.fromEntries(SECTOR_DEFINITIONS.map(({ key }) => [key, { "1m": 0.03 }])),
  },
  sectorTicker: Object.fromEntries(SECTOR_DEFINITIONS.map(({ etf }) => [etf, {
    price: 100, changePercent: -99, state: { status: "unavailable", asOf: "2026-09-19T20:00:00Z" },
  }])),
} as Parameters<typeof buildDashboardSnapshot>[0]);
assert.equal(unavailableTickers.judgmentInputsReady, true);
assert.equal(unavailableTickers.sectorMode, "BASE_1M");
assert.ok(unavailableTickers.sectorRows.every((sector) => sector.displayChange === 0.03));

console.log("dashboard integrity: ok");
