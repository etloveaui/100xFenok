#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildEtfDaily1yReadiness,
  classifyDaily1yGap,
  etfInceptionDate,
} from "./write-fenok-etf-daily1y-readiness.mjs";

const currentNow = new Date("2026-07-09T00:00:00Z");
const recentYahooFallback = {
  source_provider: "yahoo_finance",
  detail_status: "yf_fallback",
  normalized: {
    history_periods: {
      daily_1y: [
        { date: "2026-05-06", Close: 25.4 },
        { date: "2026-07-08", Close: 25.7 },
      ],
    },
  },
};
const oldYahooFallback = {
  source_provider: "yahoo_finance",
  detail_status: "yf_fallback",
  normalized: {
    history_periods: {
      daily_1y: [
        { date: "2025-01-03", Close: 20.1 },
        { date: "2026-07-08", Close: 25.7 },
      ],
    },
  },
};
const recentStockAnalysisShortRows = {
  asset_type: "etf",
  source_provider: "stockanalysis",
  fetched_at: "2026-07-08T00:00:00Z",
  normalized: {
    overview: {
      inception: "Jan 1, 2020",
    },
    history_periods: {
      daily_1y: [
        { date: "2026-07-08", Close: 25.7 },
      ],
    },
  },
};
const recentProviderFailure = {
  last_attempt_utc: "2026-07-08T18:00:00Z",
  failure_reason: "ValueError: Yahoo fallback quoteType is not ETF/MUTUALFUND: EQUITY",
};

function writeFixture(rootDir, relPath, payload) {
  const target = path.join(rootDir, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-etf-daily1y-readiness-"));
const fixtureGeneratedAt = "2026-07-09T00:00:00.000Z";
writeFixture(fixtureRoot, "data/computed/fenok_etf_signals_summary.json", { rows: [{ ticker: "AAA" }] });
writeFixture(fixtureRoot, "data/stockanalysis/backfill/history_gap_report_latest.json", {
  generated_at: fixtureGeneratedAt,
  required_history_periods: ["daily_1y"],
  report_profile: {
    key: "daily_1y",
    required_history_periods: ["daily_1y"],
    generated_at: fixtureGeneratedAt,
  },
  daily_1y_gap: {
    scored_etfs: {
      scored_etf_count: 1,
      complete: 1,
      fetchable: 0,
      inception_limited: 0,
      terminal_limited: 0,
    },
  },
  recommended_dispatch: null,
});
writeFixture(fixtureRoot, "data/stockanalysis/etfs/AAA.json", {
  asset_type: "etf",
  source_provider: "stockanalysis",
  normalized: { history_periods: { daily_1y: Array.from({ length: 200 }, (_, index) => ({ date: `2026-01-${String((index % 28) + 1).padStart(2, "0")}`, Close: index + 1 })) } },
});
writeFixture(fixtureRoot, "data/admin/fenok-edge-coverage-index.json", {
  public_scoring_readiness: {
    tracks: [{
      id: "etf_scoring_lane",
      stage: "PUBLIC",
      requirements: { public: true, daily: true, gated: true },
      evidence_based_readiness: {
        daily_ready: true,
        gated_ready: true,
        counts: {
          scored_public_etf: 1,
          fetchable_daily_1y_gap: 0,
          inception_limited_daily_1y_gap: 0,
          terminal_limited_daily_1y_gap: 0,
        },
        daily_checks: [{
          id: "etf_no_fetchable_daily_1y_gap",
          fetchable_daily_1y_gap: 0,
          inception_limited_daily_1y_gap: 0,
          terminal_limited_daily_1y_gap: 0,
        }],
      },
    }],
  },
});

assert.equal(etfInceptionDate(recentYahooFallback).toISOString().slice(0, 10), "2026-05-06");
assert.deepEqual(classifyDaily1yGap(recentYahooFallback, currentNow).fetchable, []);
assert.deepEqual(classifyDaily1yGap(recentYahooFallback, currentNow).inceptionLimited, ["daily_1y"]);
assert.deepEqual(classifyDaily1yGap(oldYahooFallback, currentNow).fetchable, ["daily_1y"]);
assert.deepEqual(classifyDaily1yGap(oldYahooFallback, currentNow).inceptionLimited, []);
assert.deepEqual(classifyDaily1yGap(recentStockAnalysisShortRows, currentNow).fetchable, []);
assert.deepEqual(classifyDaily1yGap(recentStockAnalysisShortRows, currentNow).terminalLimited, ["daily_1y"]);
assert.equal(classifyDaily1yGap(recentStockAnalysisShortRows, currentNow).terminalLimitSource, "stockanalysis_recent_short_rows");
assert.deepEqual(classifyDaily1yGap(oldYahooFallback, currentNow, recentProviderFailure).terminalLimited, ["daily_1y"]);
assert.equal(classifyDaily1yGap(oldYahooFallback, currentNow, recentProviderFailure).terminalLimitSource, "provider_rejected_non_etf");

const payload = buildEtfDaily1yReadiness({ rootDir: fixtureRoot, now: currentNow });
const plan = payload.fetchable_plan;
const readiness = payload.daily_1y_readiness;
const breakdownTotal = Object.values(readiness.fetchable_breakdown?.counts || readiness.fetchable_breakdown || {})
  .reduce((sum, value) => sum + Number(value || 0), 0);
const planBreakdownTotal = Object.values(plan.fetchable_breakdown?.counts || {})
  .reduce((sum, value) => sum + Number(value || 0), 0);

assert.equal(payload.ok, true);
assert.ok(readiness.denominator > 0);
assert.equal(
  readiness.daily_1y_complete
    + readiness.daily_1y_fetchable
    + readiness.inception_limited_daily_1y_gap
    + readiness.terminal_limited_daily_1y_gap,
  readiness.denominator,
);
assert.equal(
  readiness.daily_1y_missing,
  readiness.daily_1y_fetchable
    + readiness.inception_limited_daily_1y_gap
    + readiness.terminal_limited_daily_1y_gap,
);
assert.equal(readiness.count_equation_ok, true);
assert.equal(breakdownTotal, readiness.daily_1y_fetchable);
assert.equal(payload.public_done_claim_allowed, true);
assert.equal(payload.readiness_status, "ready");

assert.equal(Object.keys(payload).includes("fetchable_plan"), false);
assert.equal(payload.exact_fetchable_plan.fetchable_count, readiness.daily_1y_fetchable);
assert.equal(payload.exact_fetchable_plan.can_drive_bounded_ticker_batches, true);
assert.equal(payload.exact_fetchable_plan.batch_count, Math.ceil(readiness.daily_1y_fetchable / 120));

assert.equal(plan.counts.scored_etf_count, readiness.denominator);
assert.equal(plan.counts.complete, readiness.daily_1y_complete);
assert.equal(plan.counts.fetchable, readiness.daily_1y_fetchable);
assert.equal(plan.counts.inception_limited, readiness.inception_limited_daily_1y_gap);
assert.equal(plan.counts.terminal_limited, readiness.terminal_limited_daily_1y_gap);
assert.equal(plan.counts.missing, readiness.daily_1y_missing);
assert.equal(plan.counts.equation_ok, true);
assert.equal(typeof plan.counts.matches_history_gap_report, "boolean");
assert.equal(plan.counts.matches_coverage_index, true);
assert.equal(plan.counts.matches_coverage_index_daily_check, true);
assert.equal(plan.tickers.length, readiness.daily_1y_fetchable);
assert.equal(new Set(plan.tickers).size, readiness.daily_1y_fetchable);
assert.deepEqual(plan.tickers, [...plan.tickers].sort());
assert.equal(planBreakdownTotal, readiness.daily_1y_fetchable);

assert.equal(plan.bounded_batches.can_drive_bounded_ticker_batches, true);
assert.equal(plan.bounded_batches.default_batch_size, 120);
assert.equal(plan.bounded_batches.batch_count, Math.ceil(readiness.daily_1y_fetchable / 120));
assert.equal(plan.bounded_batches.first_batch_tickers.length, Math.min(120, readiness.daily_1y_fetchable));

assert.equal(plan.yf_local_crosscheck.matches_exact_fetchable_selector, false);
assert.ok(plan.yf_local_crosscheck.missing_or_lt_min_rows > plan.counts.fetchable);

fs.rmSync(fixtureRoot, { recursive: true, force: true });
console.log("test-write-fenok-etf-daily1y-readiness: ok");
