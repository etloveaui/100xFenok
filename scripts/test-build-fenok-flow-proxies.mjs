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
assert.equal(scoreOffExchangeShare(0.1), 0);
assert.equal(scoreOffExchangeShare(0.25), 50);
assert.equal(scoreOffExchangeShare(0.4), 100);
assert.equal(scoreOffExchangeShare(0.9), 100);

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
