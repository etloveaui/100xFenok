#!/usr/bin/env node
import assert from "node:assert/strict";

import { buildEtfDaily1yReadiness } from "./write-fenok-etf-daily1y-readiness.mjs";

const payload = buildEtfDaily1yReadiness();
const plan = payload.fetchable_plan;
const readiness = payload.daily_1y_readiness;
const breakdownTotal = Object.values(readiness.fetchable_breakdown?.counts || readiness.fetchable_breakdown || {})
  .reduce((sum, value) => sum + Number(value || 0), 0);
const planBreakdownTotal = Object.values(plan.fetchable_breakdown?.counts || {})
  .reduce((sum, value) => sum + Number(value || 0), 0);

assert.equal(payload.ok, true);
assert.ok(readiness.denominator > 0);
assert.equal(
  readiness.daily_1y_complete + readiness.daily_1y_fetchable + readiness.inception_limited_daily_1y_gap,
  readiness.denominator,
);
assert.equal(readiness.daily_1y_missing, readiness.daily_1y_fetchable + readiness.inception_limited_daily_1y_gap);
assert.equal(readiness.count_equation_ok, true);
assert.equal(breakdownTotal, readiness.daily_1y_fetchable);
assert.equal(payload.public_done_claim_allowed, false);

assert.equal(Object.keys(payload).includes("fetchable_plan"), false);
assert.equal(payload.exact_fetchable_plan.fetchable_count, readiness.daily_1y_fetchable);
assert.equal(payload.exact_fetchable_plan.can_drive_bounded_ticker_batches, true);
assert.equal(payload.exact_fetchable_plan.batch_count, Math.ceil(readiness.daily_1y_fetchable / 120));

assert.equal(plan.counts.scored_etf_count, readiness.denominator);
assert.equal(plan.counts.complete, readiness.daily_1y_complete);
assert.equal(plan.counts.fetchable, readiness.daily_1y_fetchable);
assert.equal(plan.counts.inception_limited, readiness.inception_limited_daily_1y_gap);
assert.equal(plan.counts.equation_ok, true);
assert.equal(plan.counts.matches_history_gap_report, true);
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

console.log("test-write-fenok-etf-daily1y-readiness: ok");
