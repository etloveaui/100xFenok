import assert from "node:assert/strict";
import type { PerformanceSeries, PortfolioViewsData } from "../src/lib/superinvestors/types";
import {
  alignSamePeriodPerformance,
  formatQuarterDate,
  getCommonSamePeriodWindow,
  MIN_SHARED_OBSERVATIONS,
} from "../src/app/superinvestors/samePeriodWindow";

const dates = Array.from({ length: 21 }, (_, index) => {
  const quarter = index + 1;
  const year = 2021 + Math.floor((quarter - 1) / 4);
  const month = ((quarter - 1) % 4) * 3 + 6;
  return `${year + (month > 12 ? 1 : 0)}-${String(month > 12 ? month - 12 : month).padStart(2, "0")}-30`;
});

function performance(seriesDates: string[] = dates): PerformanceSeries {
  return {
    dates: seriesDates,
    portfolio: seriesDates.map((_, index) => 100 + index),
    spy: null,
    coverage: seriesDates.slice(0, -1).map(() => 1),
  };
}

function view(perf: PerformanceSeries) {
  return {
    name: "Test investor",
    quarter: "2026-Q2",
    quarters: [],
    sector_history: {},
    treemap: [],
    performance: perf,
  };
}

const data = {
  investors: {
    alpha: view(performance()),
    beta: view(performance()),
    short: view(performance(dates.slice(-15))),
    q1: view(performance(["2021-03-31", ...dates.slice(1)])),
  },
} as Pick<PortfolioViewsData, "investors">;

assert.equal(MIN_SHARED_OBSERVATIONS, 20);
const window = getCommonSamePeriodWindow(data);
assert.deepEqual(window && {
  startDate: window.startDate,
  endDate: window.endDate,
  observations: window.dates.length,
  investors: window.investorCount,
}, {
  startDate: dates[0],
  endDate: dates.at(-1),
  observations: 21,
  investors: 2,
});
assert.equal(alignSamePeriodPerformance(data.investors.alpha.performance, window)?.dates.length, 21);
assert.equal(alignSamePeriodPerformance(data.investors.short.performance, window), null);
assert.equal(formatQuarterDate(dates[0]), "2021-Q2");
console.log("superinvestor same-period window: PASS");
