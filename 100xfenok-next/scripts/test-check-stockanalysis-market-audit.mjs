#!/usr/bin/env node
/**
 * Unit fixtures for the ETF history-gap report dispatch contract
 * (check-stockanalysis-market-audit.mjs :: assertHistoryGapReportContract).
 *
 * Guards the generator<->checker recommended_dispatch.status vocabulary: the daily_1y
 * continuity carve-out must fire for the generator's real "scheduled_backfill_active"
 * status (not the dead "owner_gated" literal that blocked every GOLI drain), and any
 * unknown status must hard-fail so vocabulary drift can never silently pass again.
 */
import assert from "node:assert/strict";

import { assertHistoryGapReportContract } from "./check-stockanalysis-market-audit.mjs";
import { DISPATCH_STATUS } from "./stockanalysis-dispatch-status.mjs";

let passed = 0;
const ok = (label) => { passed += 1; console.log(`  ok - ${label}`); };

// A fully-valid report (passes every non-dispatch assert) parameterized by the dispatch
// state. enforcement.enforced=false keeps the incremental-plan subset checks out of scope
// so each fixture isolates the recommended_dispatch branch under test.
function baseReport({ periods = ["daily_1y"], fetchable = 0, scoredDailyFetchable = 0, status, inputs = null } = {}) {
  const inception = 1;
  const terminal = 1;
  const missing = fetchable + inception + terminal;
  const perPeriod = (value) => Object.fromEntries(periods.map((p) => [p, value]));
  return {
    schema_version: "stockanalysis-history-gap-report/v1",
    generated_at: "2026-07-10T00:00:00.000Z",
    classification_as_of: "2026-07-09T23:59:59.000Z",
    report_profile: {
      key: periods.slice().sort().join(","),
      required_history_periods: periods.slice().sort(),
      generated_at: "2026-07-10T00:00:00.000Z",
      classification_as_of: "2026-07-09T23:59:59.000Z",
    },
    required_history_periods: periods,
    primary_stockanalysis_detail_files: 100,
    missing_required_history: missing,
    fetchable_required_history: fetchable,
    inception_limited_required_history: inception,
    terminal_limited_required_history: terminal,
    missing_by_period: perPeriod(missing),
    fetchable_by_period: perPeriod(fetchable),
    inception_limited_by_period: perPeriod(inception),
    terminal_limited_by_period: perPeriod(terminal),
    incremental_plan: { strict_count_matches: { required_periods: true }, enforcement: { enforced: false } },
    daily_1y_gap: { scored_etfs: { fetchable: scoredDailyFetchable } },
    recommended_dispatch: { status, inputs },
  };
}

function run(report) {
  const errors = [];
  const plan = { required_history_periods: report.required_history_periods };
  const audit = { incremental_etf: { counts: {} } };
  assertHistoryGapReportContract(report, plan, audit, errors);
  return errors;
}

const DAILY_INPUTS = { history_gaps_only: "true", required_history_periods: "daily_1y" };

console.log("# stockanalysis market-audit history-gap dispatch fixtures");

// (a) Branch-B — the exact GOLI-drain state: full-scan fetchable_required=0 while SCORED
// daily_1y continuity gaps remain, status scheduled_backfill_active. Must PASS.
{
  const errors = run(baseReport({ fetchable: 0, scoredDailyFetchable: 2, status: DISPATCH_STATUS.SCHEDULED_BACKFILL_ACTIVE, inputs: DAILY_INPUTS }));
  assert.equal(errors.length, 0, `Branch-B must pass, got: ${errors.join("; ")}`);
  ok("(a) scheduled_backfill_active + scored daily_1y gaps (fetchable_required=0) -> audit PASSES");
}

// (b) Same state carrying the OLD dead literal owner_gated -> FAIL (unknown/unaligned status).
{
  const errors = run(baseReport({ fetchable: 0, scoredDailyFetchable: 2, status: "owner_gated", inputs: DAILY_INPUTS }));
  assert.ok(errors.length > 0, "owner_gated must fail");
  assert.ok(errors.some((e) => /unknown recommended_dispatch\.status owner_gated/.test(e)), `owner_gated should flag unknown status, got: ${errors.join("; ")}`);
  ok("(b) owner_gated (old dead literal) -> audit FAILS as unknown/unaligned status");
}

// (c) Fully drained: no scored gaps left -> not_recommended still passes (remaining gaps are
// inception/terminal-limited, which do not block).
{
  const errors = run(baseReport({ fetchable: 0, scoredDailyFetchable: 0, status: DISPATCH_STATUS.NOT_RECOMMENDED, inputs: null }));
  assert.equal(errors.length, 0, `not_recommended must pass, got: ${errors.join("; ")}`);
  ok("(c) fully-drained -> not_recommended still PASSES");
}

// (d) if-branch (fetchable_required>0) unaffected — daily_1y scheduled + multi-year manual.
{
  const daily = run(baseReport({ fetchable: 3, scoredDailyFetchable: 3, status: DISPATCH_STATUS.SCHEDULED_BACKFILL_ACTIVE, inputs: DAILY_INPUTS }));
  assert.equal(daily.length, 0, `daily_1y fetchable>0 if-branch must pass, got: ${daily.join("; ")}`);
  const multiYear = run(baseReport({ periods: ["monthly_1y"], fetchable: 2, status: DISPATCH_STATUS.MANUAL_DISPATCH_RECOMMENDED, inputs: { history_gaps_only: "true", required_history_periods: "monthly_1y" } }));
  assert.equal(multiYear.length, 0, `multi-year manual dispatch if-branch must pass, got: ${multiYear.join("; ")}`);
  ok("(d) fetchable_required>0 if-branch unaffected (daily_1y + multi-year) -> PASSES");
}

// (e) Drift guard: any status outside the shared enum hard-fails loudly.
{
  const errors = run(baseReport({ fetchable: 0, scoredDailyFetchable: 2, status: "banana", inputs: DAILY_INPUTS }));
  assert.ok(errors.some((e) => /unknown recommended_dispatch\.status banana/.test(e)), "arbitrary unknown status must hard-fail");
  ok("(e) arbitrary unknown status -> hard error (vocabulary drift is loud)");
}

console.log(`\n# ${passed} fixtures passed`);
