#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  ETF_CORE_DAILY_BASKET_CONFIG,
  buildEtfCoreDailyBasket,
  selectBasketRows,
  validateEtfCoreDailyBasket,
} from "./build-fenok-etf-core-daily-basket.mjs";

function fixtureCandidates(count, { status, scoreBase, prefix }) {
  const candidates = [];
  for (const [category, cap] of Object.entries(ETF_CORE_DAILY_BASKET_CONFIG.categoryCaps)) {
    for (let index = 0; index < cap && candidates.length < count; index += 1) {
      candidates.push({
        ticker: `${prefix}${String(candidates.length + 1).padStart(3, "0")}`,
        category,
        status,
        action_score: scoreBase - candidates.length,
        aum: 1_000_000_000 - candidates.length,
      });
    }
    if (candidates.length >= count) break;
  }
  return candidates;
}

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
assert.ok(
  Number(admin.coverage.excluded_reason_counts?.single_stock_or_concentrated_derivative_income_strategy || 0) > 0,
  "Core Basket must explicitly exclude single-stock/concentrated derivative-income ETF strategies",
);

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
  assert.doesNotMatch(
    `${row.ticker} ${row.company ?? ""}`,
    /\b(YieldMax|WeeklyPay|YieldBOOST|Option Income Strategy ETF|Performance\s*&\s*Distribution\s*Target)\b/i,
    `${row.ticker}: concentrated derivative-income strategy must not enter Core Basket`,
  );
}

if (admin.readiness.core_daily_basket_ready) {
  assert.equal(admin.readiness.stale_selected_count, 0);
  assert.equal(admin.readiness.blockers.length, 0);
} else {
  assert.ok(admin.readiness.blockers.length > 0);
}

{
  const fresh = fixtureCandidates(ETF_CORE_DAILY_BASKET_CONFIG.minSelectedCount, {
    status: "fresh",
    scoreBase: 100,
    prefix: "F",
  });
  const stale = [
    {
      ticker: "S001",
      category: "Fixed Income",
      status: "needs_refresh",
      action_score: 1_000,
      aum: 1_000_000_000,
    },
  ];
  const { selected } = selectBasketRows([...stale, ...fresh]);
  assert.equal(selected.length, ETF_CORE_DAILY_BASKET_CONFIG.minSelectedCount);
  assert.equal(selected.filter((row) => row.status !== "fresh").length, 0);
  assert.equal(selected.some((row) => row.ticker.startsWith("S")), false);
}

{
  const fresh = fixtureCandidates(ETF_CORE_DAILY_BASKET_CONFIG.minSelectedCount - 1, {
    status: "fresh",
    scoreBase: 100,
    prefix: "F",
  });
  const stale = [
    {
      ticker: "S001",
      category: "Fixed Income",
      status: "needs_refresh",
      action_score: 1_000,
      aum: 1_000_000_000,
    },
  ];
  const { selected } = selectBasketRows([...stale, ...fresh]);
  assert.equal(selected.length, ETF_CORE_DAILY_BASKET_CONFIG.minSelectedCount);
  assert.ok(selected.some((row) => row.status === "needs_refresh"));
}

console.log("test-build-fenok-etf-core-daily-basket: ok");
