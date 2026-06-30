#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  ETF_CORE_DAILY_BASKET_CONFIG,
  buildEtfCoreDailyBasket,
  validateEtfCoreDailyBasket,
} from "./build-fenok-etf-core-daily-basket.mjs";

const generatedAt = new Date("2026-06-30T00:00:00.000Z");
const { admin, summary } = buildEtfCoreDailyBasket({ generatedAt, now: generatedAt });
const validation = validateEtfCoreDailyBasket(admin, summary);

assert.equal(validation.ok, true, validation.errors.join("\n"));
assert.equal(admin.asset_type, "etf");
assert.equal(summary.asset_type, "etf");
assert.equal(admin.raw_policy.public, false);
assert.equal(summary.raw_policy.public, true);
assert.equal(admin.coverage.selected_count, admin.rows.length);
assert.equal(summary.rows.length, admin.rows.length);
assert.equal(admin.daily_refresh_universe.count, admin.rows.length);
assert.equal(admin.daily_refresh_universe.tickers.length, admin.rows.length);
assert.ok(admin.rows.length >= ETF_CORE_DAILY_BASKET_CONFIG.minSelectedCount);
assert.ok(admin.rows.length < admin.coverage.source_scored_etf_count);
assert.equal(new Set(admin.rows.map((row) => row.ticker)).size, admin.rows.length);

for (const row of admin.rows) {
  assert.equal(row.asset_type, "etf", `${row.ticker}: asset_type`);
  assert.equal(row.core_candidate_allowed, true, `${row.ticker}: core candidate`);
  assert.equal(row.confidence_label, "high", `${row.ticker}: confidence`);
  assert.ok(row.scored_signal_count >= ETF_CORE_DAILY_BASKET_CONFIG.minScoredSignalCount, `${row.ticker}: signal count`);
  assert.ok(row.coverage_ratio >= ETF_CORE_DAILY_BASKET_CONFIG.minCoverageRatio, `${row.ticker}: coverage ratio`);
  assert.ok(row.aum >= ETF_CORE_DAILY_BASKET_CONFIG.minAum, `${row.ticker}: AUM`);
  assert.ok(row.proof.daily_1y_rows >= ETF_CORE_DAILY_BASKET_CONFIG.minDaily1yRows, `${row.ticker}: daily rows`);
  assert.ok(row.proof.average_dollar_volume_5d >= ETF_CORE_DAILY_BASKET_CONFIG.minAverageDollarVolume5d, `${row.ticker}: dollar volume`);
  assert.ok(["fresh", "needs_refresh"].includes(row.status), `${row.ticker}: status`);
}

if (admin.readiness.core_daily_basket_ready) {
  assert.equal(admin.readiness.stale_selected_count, 0);
  assert.equal(admin.readiness.blockers.length, 0);
} else {
  assert.ok(admin.readiness.blockers.length > 0);
}

console.log("test-build-fenok-etf-core-daily-basket: ok");
