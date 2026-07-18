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

import {
  assertCoverageContract,
  assertHistoryGapReportContract,
  assertProductSurfaceCoverageContract,
  renderMarketAuditHtml,
} from "./check-stockanalysis-market-audit.mjs";
import { deriveProductSurfaceStampEvidence } from "../../scripts/lib/product-surface-stamp-v2.mjs";
import { validateCoverage } from "./check-data-freshness.mjs";
import {
  assertProductSurfaceCoverageV2Contract,
  assertStockCandidatePair,
} from "./smoke-stockanalysis-routes.mjs";
import { PRODUCT_SURFACE_COLLECTION_MAX_AGE_HOURS } from "../../scripts/lib/kpi-contract-constants.mjs";
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

// A stock-only or surface-only run is still a real StockAnalysis run. Its zero ETF
// request count must not erase the required latest-run card from Data Lab.
{
  const html = renderMarketAuditHtml({
    stockanalysisIndex: {
      generated_at: "2026-07-15T13:24:22Z",
      counts: {
        etfs_requested: 0,
        stocks_requested: 1,
        ok: 0,
        failed: 1,
        hard_failed: 1,
        etf_candidate_total: 5480,
        etf_detail_covered: 4726,
        etf_detail_coverage_pct: 86.24,
      },
      results: [{ ticker: "AAPL", asset_type: "stock", status: "error" }],
    },
  });
  assert.ok(html.includes("최근 ETF 상세 갱신"), "zero-ETF run must keep the latest ETF refresh card visible");
  assert.ok(html.includes("이번 실행 ETF 요청 없음"), "zero-ETF run must name the no-request state honestly");
  ok("(j) stock-only run with etfs_requested=0 keeps the latest ETF refresh card visible");
}

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

// (f) A genuinely empty lane is a lane-local degradation, not structural corruption.
{
  const errors = [];
  const warnings = [];
  assertCoverageContract({
    counts: {
      candidate_total: 0,
      covered_detail_files: 0,
      missing_detail_files: 0,
      coverage_pct: 0,
      yahoo_fallback_files: 0,
    },
    missing_reason_summary: {},
    missing_status_summary: {},
  }, errors, warnings);
  assert.deepEqual(errors, [], `empty coverage must not be a global blocker: ${errors.join("; ")}`);
  assert.ok(warnings.some((warning) => /no candidate universe/.test(warning)), "empty coverage must be named as degraded");
  ok("(f) empty ETF candidate universe -> DEGRADED warning, not global failure");
}

function surfaceFixture(overrides = {}) {
  return {
    id: "stock_detail",
    route: "/stock/AAPL",
    status: "unavailable",
    as_of: "2026-07-13T00:00:00.000Z",
    source_as_of: null,
    source_as_of_reason: "provider publishes no aggregate source date",
    checks: [{
      key: "source_freshness",
      ok: false,
      status: "unavailable",
      as_of: null,
      age_days: null,
      max_age_days: 3,
      reason: "provider publishes no aggregate source date",
    }],
    ...overrides,
  };
}

function coverageFixture(surfaces) {
  const statuses = ["ready", "partial", "pending", "stale", "unavailable", "error"];
  const generatedAt = "2026-07-13T00:00:00.000Z";
  const requiredRoutes = new Map([
    ["stock_detail", "/stock/AAPL"],
    ["market_valuation", "/market-valuation"],
    ["market_events", "/market/events"],
    ["sectors", "/sectors"],
    ["etf_center", "/etfs"],
    ["screener", "/screener"],
  ]);
  const expanded = [...surfaces];
  const present = new Set(expanded.map((surface) => surface.id));
  for (const [id, route] of requiredRoutes) {
    if (!present.has(id)) expanded.push(surfaceFixture({ id, route }));
  }
  const stampedSurfaces = expanded.map((surface) => {
    const stamp_evidence = deriveProductSurfaceStampEvidence([{
      id: `${surface.id}:fixture`,
      stamp_class: "date_bearing",
      source_as_of: surface.source_as_of,
    }], generatedAt);
    return { ...surface, stamp_evidence };
  });
  return {
    schema_version: "product-surface-coverage/v2",
    source_stamp_version: 2,
    generated_at: generatedAt,
    raw_policy: {
      public_mirror_allowed: true,
      raw_rows_included: false,
      private_artifact_paths_included: false,
    },
    totals: {
      surfaces: stampedSurfaces.length,
      ...Object.fromEntries(statuses.map((status) => [status, stampedSurfaces.filter((surface) => surface.status === status).length])),
    },
    surfaces: stampedSurfaces,
  };
}

// (g) Honest null + reason is accepted and visible as lane-local degradation.
{
  const errors = [];
  const warnings = [];
  assertProductSurfaceCoverageContract(coverageFixture([surfaceFixture()]), errors, warnings);
  assert.deepEqual(errors, [], `honest null must pass structural validation: ${errors.join("; ")}`);
  const freshnessErrors = [];
  validateCoverage(coverageFixture([surfaceFixture()]), new Map(), freshnessErrors, []);
  assert.deepEqual(freshnessErrors, [], `v2 freshness consumer must pass: ${freshnessErrors.join("; ")}`);
  assert.doesNotThrow(() => assertProductSurfaceCoverageV2Contract(coverageFixture([surfaceFixture()])), "v2 smoke consumer must pass");
  assert.ok(warnings.some((warning) => /stock_detail is unavailable/.test(warning)), "unavailable lane must be named as degraded");
  ok("(g) source_as_of:null + explicit reason -> accepted, stale lane named DEGRADED");
}

// (g2) The completed migration is v2-only: a legacy v1 artifact is a hard downgrade.
{
  const errors = [];
  const warnings = [];
  const legacy = coverageFixture([surfaceFixture()]);
  legacy.schema_version = "product-surface-coverage/v1";
  legacy.source_stamp_version = 1;
  for (const surface of legacy.surfaces) delete surface.stamp_evidence;
  assertProductSurfaceCoverageContract(legacy, errors, warnings);
  assert.ok(errors.some((error) => /schema_version must be exactly product-surface-coverage\/v2/.test(error)), "v1 schema must fail");
  assert.ok(errors.some((error) => /source_stamp_version must be exactly numeric 2/.test(error)), "v1 stamp marker must fail");
  const freshnessErrors = [];
  validateCoverage(legacy, new Map(), freshnessErrors, []);
  assert.ok(freshnessErrors.some((error) => /schema_version must be exactly product-surface-coverage\/v2/.test(error)), "v1 freshness consumer must fail");
  assert.throws(() => assertProductSurfaceCoverageV2Contract(legacy), /schema_version must be exactly product-surface-coverage\/v2/, "v1 smoke consumer must fail");
  ok("(g2) legacy v1 product-surface artifact -> hard downgrade failure");
}

// (h) A null with no provenance reason is still dishonest and must fail.
{
  const errors = [];
  const warnings = [];
  assertProductSurfaceCoverageContract(coverageFixture([surfaceFixture({ source_as_of_reason: null })]), errors, warnings);
  assert.ok(errors.some((error) => /null source_as_of needs a reason/.test(error)), "reasonless null must fail");
  ok("(h) source_as_of:null without reason -> hard error");
}

// (i) A malformed claimed source date remains corruption and must fail.
{
  const errors = [];
  const warnings = [];
  assertProductSurfaceCoverageContract(coverageFixture([surfaceFixture({
      status: "ready",
      source_as_of: "not-a-date",
      source_as_of_reason: null,
      checks: [{ key: "source_freshness", ok: true, status: "ready", as_of: "not-a-date", age_days: 0, max_age_days: 3 }],
    })]), errors, warnings);
  assert.ok(errors.some((error) => /source_as_of must be a valid source date/.test(error)), "malformed source date must fail");
  assert.ok(errors.some((error) => /freshness source date is invalid/.test(error)), "malformed freshness date must fail");
  ok("(i) malformed claimed source date -> hard error");
}

function stockCandidateFixture() {
  return {
    stock: {
      schema_version: "stockanalysis/v1",
      source: "stockanalysis",
      asset_type: "stock",
      ticker: "AAPL",
      fetched_at: "2026-07-18T00:00:30Z",
      normalized: {
        overview: { marketCap: "4T" },
        financials: { fetched_at: "2026-07-18T00:00:00Z" },
      },
    },
    financials: {
      schema_version: "stockanalysis/v1",
      source: "stockanalysis",
      asset_type: "stock",
      ticker: "AAPL",
      fetched_at: "2026-07-18T00:00:00Z",
      statements: {
        annual: { income: { rows: [{}] } },
        quarterly: { income: { rows: [{}] } },
      },
    },
  };
}

// (k) The live overview and financial candidate must be one coherent producer pair.
{
  const fixture = stockCandidateFixture();
  const pair = assertStockCandidatePair(fixture.stock, fixture.financials, "AAPL", "2026-07-18T01:00:00Z");
  assert.equal(pair.max_age_hours, PRODUCT_SURFACE_COLLECTION_MAX_AGE_HOURS);
  assert.equal(pair.status, "ready");
  assert.equal(pair.degraded, false);
  assert.deepEqual(pair.warnings, []);
  const boundary = structuredClone(fixture);
  boundary.stock.fetched_at = "2026-07-15T23:00:00Z";
  boundary.financials.fetched_at = "2026-07-15T23:00:00Z";
  boundary.stock.normalized.financials.fetched_at = boundary.financials.fetched_at;
  assert.doesNotThrow(
    () => assertStockCandidatePair(boundary.stock, boundary.financials, "AAPL", "2026-07-18T01:00:00Z"),
  );
  const mismatched = structuredClone(fixture);
  mismatched.stock.normalized.financials.fetched_at = "2026-07-17T00:00:00Z";
  assert.throws(
    () => assertStockCandidatePair(mismatched.stock, mismatched.financials, "AAPL", "2026-07-18T01:00:00Z"),
    /financial freshness mismatch/,
  );
  const future = structuredClone(fixture);
  future.financials.fetched_at = "2026-07-19T00:00:00Z";
  future.stock.normalized.financials.fetched_at = future.financials.fetched_at;
  assert.throws(
    () => assertStockCandidatePair(future.stock, future.financials, "AAPL", "2026-07-18T01:00:00Z"),
    /cannot be in the future/,
  );
  const stale = structuredClone(fixture);
  stale.stock.fetched_at = "2026-07-15T22:59:59Z";
  stale.financials.fetched_at = "2026-07-15T22:59:59Z";
  stale.stock.normalized.financials.fetched_at = stale.financials.fetched_at;
  const warnings = [];
  const stalePair = assertStockCandidatePair(
    stale.stock,
    stale.financials,
    "AAPL",
    "2026-07-18T01:00:00Z",
    warnings,
  );
  assert.equal(stalePair.status, "degraded");
  assert.equal(stalePair.degraded, true);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((warning) => /older than 50 hours/.test(warning)));
  ok("(k) stock overview + financial candidate -> coherent live freshness pair");
}

console.log(`\n# ${passed} fixtures passed`);
