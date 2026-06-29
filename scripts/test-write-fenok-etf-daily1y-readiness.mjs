#!/usr/bin/env node
import assert from "node:assert/strict";

import { buildEtfDaily1yReadiness } from "./write-fenok-etf-daily1y-readiness.mjs";

const payload = buildEtfDaily1yReadiness();
const plan = payload.fetchable_plan;

assert.equal(payload.ok, true);
assert.equal(payload.daily_1y_readiness.denominator, 4484);
assert.equal(payload.daily_1y_readiness.daily_1y_complete, 3366);
assert.equal(payload.daily_1y_readiness.daily_1y_fetchable, 584);
assert.equal(payload.daily_1y_readiness.inception_limited_daily_1y_gap, 534);
assert.equal(payload.daily_1y_readiness.count_equation_ok, true);
assert.equal(payload.public_done_claim_allowed, false);

assert.equal(Object.keys(payload).includes("fetchable_plan"), false);
assert.equal(payload.exact_fetchable_plan.fetchable_count, 584);
assert.equal(payload.exact_fetchable_plan.can_drive_bounded_ticker_batches, true);
assert.equal(payload.exact_fetchable_plan.batch_count, 5);

assert.equal(plan.counts.scored_etf_count, 4484);
assert.equal(plan.counts.complete, 3366);
assert.equal(plan.counts.fetchable, 584);
assert.equal(plan.counts.inception_limited, 534);
assert.equal(plan.counts.equation_ok, true);
assert.equal(plan.counts.matches_history_gap_report, true);
assert.equal(plan.counts.matches_coverage_index, true);
assert.equal(plan.counts.matches_coverage_index_daily_check, true);
assert.equal(plan.tickers.length, 584);
assert.equal(new Set(plan.tickers).size, 584);
assert.deepEqual(plan.tickers, [...plan.tickers].sort());

assert.equal(plan.bounded_batches.can_drive_bounded_ticker_batches, true);
assert.equal(plan.bounded_batches.default_batch_size, 120);
assert.equal(plan.bounded_batches.batch_count, 5);
assert.equal(plan.bounded_batches.first_batch_tickers.length, 120);

assert.ok(plan.tickers.includes("AAAD"));
assert.ok(plan.tickers.includes("AAAP"));
assert.ok(plan.tickers.includes("AAAU"));
assert.ok(plan.tickers.includes("ACLC"));
assert.ok(!plan.tickers.includes("AAAC"));
assert.ok(!plan.tickers.includes("QNDX"));

assert.equal(plan.yf_local_crosscheck.matches_exact_fetchable_selector, false);
assert.ok(plan.yf_local_crosscheck.missing_or_lt_min_rows > plan.counts.fetchable);

console.log("test-write-fenok-etf-daily1y-readiness: ok");
