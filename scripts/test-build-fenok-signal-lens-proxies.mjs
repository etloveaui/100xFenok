#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  alignReturns,
  buildCoverage,
  correlation,
  sp500TrackingSignal,
  technicalIndicatorSignal,
} from "./build-fenok-signal-lens-proxies.mjs";

function historyFromCloses(closes) {
  return closes.map((close, idx) => ({
    date: `2026-01-${String(idx + 1).padStart(2, "0")}`,
    close,
    volume: 1000 + idx,
  }));
}

const base = Array.from({ length: 80 }, (_, idx) => 100 + idx);
const same = base.map((v) => v * 2);
const inverse = base.map((v) => 300 - v);

assert(correlation([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]) === null, "short series must be null");
assert(Math.abs(correlation(base, same) - 1) < 1e-9);
assert(correlation(base, inverse) < -0.99);

const aligned = alignReturns(historyFromCloses(base), historyFromCloses(same));
assert.equal(aligned.ticker.length, 79);
assert.equal(aligned.spy.length, 79);

const tracking = sp500TrackingSignal(historyFromCloses(base), historyFromCloses(same));
assert(tracking.score_0_100 >= 95);
assert.equal(tracking.direction, "tracks_sp500");

const technical = technicalIndicatorSignal(historyFromCloses(base));
assert(technical.score_0_100 > 60);
assert.equal(technical.direction, "constructive");
assert.equal(technical.coverage_ratio, 0.9);

const coverage = buildCoverage([
  {
    long_term: {
      profitabilityScore: 1,
      durabilityProfitabilityScore: 2,
      growthScore: null,
      upsidePotentialScore: 3,
      downsidePressureScore: 4,
      peerSimilarityScore: 5,
      sp500TrackingSimilarityScore: 6,
    },
    short_term: {
      technicalFlowScore: 7,
      technicalIndicatorProxyScore: 8,
      netOptionsProxyScore: null,
      offExchangeActivityProxyScore: 9,
      shortPressureProxyScore: 10,
      directNewsToneProxyScore: null,
    },
  },
]);
assert.equal(coverage.row_count, 1);
assert.equal(coverage.axis_counts.profitability, 1);
assert.equal(coverage.axis_counts.growth, 0);
assert.equal(coverage.axis_counts.net_options_proxy, 0);
assert.equal(coverage.axis_counts.short_pressure_proxy, 1);

console.log("test-build-fenok-signal-lens-proxies: ok");
