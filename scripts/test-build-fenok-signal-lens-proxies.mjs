#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FORMULA_VERSION,
  alignReturns,
  buildCoverage,
  buildRows,
  correlation,
  historyRowsForCurrentFormula,
  movingAveragePositionScore,
  sp500TrackingSignal,
  technicalIndicatorSignal,
} from "./build-fenok-signal-lens-proxies.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

assert.equal(FORMULA_VERSION, "fenok-signal-lens-proxies-v0.2-ma-distance");
assert.deepEqual(historyRowsForCurrentFormula({ formula_version: "fenok-signal-lens-proxies-v0.1", rows: [{ ticker: "OLD" }] }), []);
const currentHistoryRows = [{ ticker: "NEW" }];
assert.equal(historyRowsForCurrentFormula({ formula_version: FORMULA_VERSION, rows: currentHistoryRows }), currentHistoryRows);

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

const maBands = [-0.12, -0.07, -0.03, 0, 0.03, 0.07, 0.12]
  .map((distance) => movingAveragePositionScore(100 * (1 + distance), 100));
assert.deepEqual(maBands.map((row) => row.score), [10, 25, 40, 50, 60, 75, 90]);
assert.equal(new Set(maBands.map((row) => row.score)).size, 7, "MA position must not collapse to a binary score");
assert.deepEqual([90, 95, 98, 102, 105, 110].map((latest) => movingAveragePositionScore(latest, 100).score), [25, 40, 50, 60, 75, 90]);
assert.deepEqual(movingAveragePositionScore(null, 100), { score: null, distance_pct: null, band: "unavailable" });
assert.deepEqual(movingAveragePositionScore(100, 0), { score: null, distance_pct: null, band: "unavailable" });
assert.deepEqual(movingAveragePositionScore(Infinity, 100), { score: null, distance_pct: null, band: "unavailable" });

const corpusRows = buildRows({ tickers: "", referenceOnly: false, limit: 0 });
for (const key of ["ma20_position", "ma50_position", "ma200_position"]) {
  const scores = corpusRows
    .map((row) => row.short_term.technicalIndicatorProxy?.indicators?.components?.[key])
    .filter(Number.isFinite);
  const counts = new Map();
  for (const score of scores) counts.set(score, (counts.get(score) ?? 0) + 1);
  const largestBucket = Math.max(...counts.values());
  assert(scores.length >= 500, `${key} corpus coverage unexpectedly low: ${scores.length}`);
  assert(counts.size >= 5, `${key} must populate at least five graded bands, got ${[...counts.keys()]}`);
  assert(largestBucket / scores.length < 0.85, `${key} distribution collapsed: ${largestBucket}/${scores.length}`);
}

if (process.argv.includes("--artifacts")) {
  for (const relPath of [
    "data/computed/fenok_signal_lens_proxies.json",
    "data/computed/fenok_signal_lens_proxies_summary.json",
    "data/computed/fenok_signal_lens_proxies_history.json",
  ]) {
    const payload = JSON.parse(fs.readFileSync(path.join(repoRoot, relPath), "utf8"));
    assert.equal(payload.formula_version, FORMULA_VERSION, `${relPath} formula_version is stale`);
  }
}

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
