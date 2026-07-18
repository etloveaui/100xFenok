#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  buildRows,
  candidateDates,
  parseFinraDaily,
  scoreOffExchangeShare,
  scoreShortPressure,
} from "./build-fenok-flow-proxies.mjs";

const sampleFinra = [
  "Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market",
  "20260626|NVDA|100|5|250|Q",
  "20260626|NVDA|50|0|150|N",
  "20260626|PLTR|20|0|100|Q",
  "",
].join("\n");

const parsed = parseFinraDaily(sampleFinra);
assert.equal(parsed.get("NVDA").short_volume, 150);
assert.equal(parsed.get("NVDA").short_exempt_volume, 5);
assert.equal(parsed.get("NVDA").total_volume, 400);
assert.equal(parsed.get("NVDA").row_count, 2);
assert.equal(parsed.get("PLTR").total_volume, 100);

assert.equal(scoreShortPressure(0.35), 0);
assert.equal(scoreShortPressure(0.525), 50);
assert.equal(scoreShortPressure(0.7), 100);
assert.equal(scoreShortPressure(0.9), 100);

// Off-exchange share recalibrated 2026-07-18 to the measured p5/p95 band
// [0.25, 0.65] (see build-fenok-flow-proxies.mjs). Boundary cases:
assert.equal(scoreOffExchangeShare(0.25), 0); // floor anchor
assert.equal(scoreOffExchangeShare(0.45), 50); // band midpoint
assert.equal(scoreOffExchangeShare(0.65), 100); // ceil anchor
assert.equal(scoreOffExchangeShare(0.35), 25); // lower interior
assert.equal(scoreOffExchangeShare(0.55), 75); // upper interior
assert.equal(scoreOffExchangeShare(0.1), 0); // below floor -> clamped
assert.equal(scoreOffExchangeShare(0.9), 100); // above ceil -> clamped
assert.equal(scoreOffExchangeShare(NaN), null);

// DISTRIBUTION-SANITY (class-level pin): scored over a realistic fixture, no more
// than 20% of rows may land at exactly 0 or exactly 100. This is the guard that
// blocks any future recalibration from silently re-saturating the axis the way
// the v0.1 band did (52.8% pinned at 100 on 2026-07-18 production data).
// Fixture = 40 evenly-spaced order statistics drawn from that same production
// off_exchange_share distribution (data/computed/fenok_flow_proxies.json).
const OFF_EXCHANGE_SHARE_SAMPLE = [
  0.119, 0.2324, 0.2518, 0.2653, 0.2791, 0.2971, 0.3063, 0.3109, 0.3215, 0.3289,
  0.3363, 0.3424, 0.3524, 0.3613, 0.369, 0.3751, 0.3814, 0.3885, 0.3964, 0.403,
  0.4083, 0.4152, 0.4248, 0.4339, 0.4395, 0.4468, 0.4542, 0.462, 0.4707, 0.4793,
  0.4885, 0.4989, 0.5102, 0.5169, 0.5387, 0.561, 0.6056, 0.6678, 0.7631, 1.9428,
];
const sampleScores = OFF_EXCHANGE_SHARE_SAMPLE.map(scoreOffExchangeShare);
const saturated = sampleScores.filter((s) => s === 0 || s === 100).length;
assert.ok(
  saturated / sampleScores.length <= 0.2,
  `off_exchange score saturated on ${saturated}/${sampleScores.length} realistic fixtures (> 20% floor)`,
);

const rows = buildRows({
  tickers: ["NVDA", "MISSING"],
  finraRows: parsed,
  sourceYmd: "20260626",
});
assert.equal(rows.length, 2);
assert.equal(rows[0].ticker, "NVDA");
assert.equal(rows[0].short_pressure_proxy.short_volume_ratio, 0.375);
assert.equal(rows[0].short_pressure_proxy.score_0_100, 7.14);
assert.equal(rows[1].confidence, "low");
assert.equal(rows[1].short_pressure_proxy.score_0_100, null);

assert.deepEqual(candidateDates({ requestedDate: "2026-06-26", maxWalkbackDays: 14 }), ["20260626"]);

console.log("test-build-fenok-flow-proxies: ok");
