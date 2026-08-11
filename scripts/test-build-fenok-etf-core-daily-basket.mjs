#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  ETF_CORE_DAILY_BASKET_CONFIG,
  buildEtfCoreDailyBasket,
  selectBasketRows,
  structuralReasons,
  validateEtfCoreDailyBasket,
} from "./build-fenok-etf-core-daily-basket.mjs";
import { classifyEtfCoreReadiness } from "../100xfenok-next/scripts/check-fenok-etf-core-daily-basket.mjs";

const producerSource = fs.readFileSync(new URL("./build-fenok-etf-core-daily-basket.mjs", import.meta.url), "utf8");
const writeBlock = producerSource.match(/if \(!args\.noWrite && validation\.ok\) \{([\s\S]*?)\n  \}/)?.[1];
assert.ok(writeBlock, "producer write block must remain explicit");
assert.match(writeBlock, /writeJson\(ADMIN_REL, payload\.admin\)/, "producer must write the canonical admin artifact");
assert.match(writeBlock, /writeJson\(SUMMARY_REL, payload\.summary\)/, "producer must write the canonical summary");
assert.doesNotMatch(writeBlock, /PUBLIC_SUMMARY_REL/, "producer must not mutate the public summary destination");

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
assert.deepEqual(summary.coverage.cohort_metrics, admin.coverage.cohort_metrics);
assert.deepEqual(
  Object.keys(admin.coverage.cohort_metrics),
  [...Object.keys(admin.coverage.cohort_metrics)].sort((left, right) => left.localeCompare(right)),
);
assert.equal(admin.daily_refresh_universe.count, admin.rows.length);
assert.equal(admin.daily_refresh_universe.tickers.length, admin.rows.length);
assert.ok(admin.rows.length >= ETF_CORE_DAILY_BASKET_CONFIG.minSelectedCount);
assert.ok(admin.rows.length < admin.coverage.source_scored_etf_count);
assert.equal(new Set(admin.rows.map((row) => row.ticker)).size, admin.rows.length);
assert.ok(
  Number(admin.coverage.excluded_reason_counts?.single_stock_or_concentrated_derivative_income_strategy || 0) > 0,
  "Core Basket must explicitly exclude single-stock/concentrated derivative-income ETF strategies",
);

const clonePayload = (payload) => JSON.parse(JSON.stringify(payload));
const firstCohortCategory = Object.keys(admin.coverage.cohort_metrics)[0];
assert.ok(firstCohortCategory, "fixture must expose at least one cohort metric");

const invalidMetricCases = [
  ["negative eligible_count", (invalidAdmin) => {
    invalidAdmin.coverage.cohort_metrics[firstCohortCategory].eligible_count = -1;
  }],
  ["non-integer selected_count", (invalidAdmin) => {
    invalidAdmin.coverage.cohort_metrics[firstCohortCategory].selected_count = 1.5;
  }],
  ["selected count does not equal fresh plus stale", (invalidAdmin) => {
    const metric = invalidAdmin.coverage.cohort_metrics[firstCohortCategory];
    metric.fresh_selected_count += 1;
  }],
  ["selected count exceeds eligible count", (invalidAdmin) => {
    Object.assign(invalidAdmin.coverage.cohort_metrics[firstCohortCategory], {
      eligible_count: 0,
      selected_count: 1,
      fresh_selected_count: 1,
      stale_selected_count: 0,
      achieved_coverage_pct: 0,
    });
  }],
  ["coverage percentage outside range", (invalidAdmin) => {
    invalidAdmin.coverage.cohort_metrics[firstCohortCategory].achieved_coverage_pct = 101;
  }],
  ["negative max quote age", (invalidAdmin) => {
    invalidAdmin.coverage.cohort_metrics[firstCohortCategory].max_quote_age_days = -1;
  }],
  ["missing metric field", (invalidAdmin) => {
    delete invalidAdmin.coverage.cohort_metrics[firstCohortCategory].max_quote_age_days;
  }],
  ["unsorted category keys", (invalidAdmin, invalidSummary) => {
    const template = admin.coverage.cohort_metrics[firstCohortCategory];
    const malformed = { Zebra: { ...template }, Alpha: { ...template } };
    invalidAdmin.coverage.cohort_metrics = malformed;
    invalidSummary.coverage.cohort_metrics = clonePayload(malformed);
  }],
  ["summary/admin metrics mismatch", (_invalidAdmin, invalidSummary) => {
    const metric = invalidSummary.coverage.cohort_metrics[firstCohortCategory];
    metric.achieved_coverage_pct = metric.achieved_coverage_pct === 100 ? 99 : 100;
  }],
];

for (const [label, mutate] of invalidMetricCases) {
  const invalidAdmin = clonePayload(admin);
  const invalidSummary = clonePayload(summary);
  mutate(invalidAdmin, invalidSummary);
  const invalidValidation = validateEtfCoreDailyBasket(invalidAdmin, invalidSummary);
  assert.equal(invalidValidation.ok, false, label);
}

{
  const fetchedAt = "2026-06-29T23:45:00.000Z";
  const withDatelessNewEtfSurface = buildEtfCoreDailyBasket({
    generatedAt,
    now: generatedAt,
    newEtfs: {
      generated_at: null,
      fetched_at: fetchedAt,
      source_as_of: null,
      records: [],
    },
  });
  assert.equal(
    withDatelessNewEtfSurface.admin.source_generated_at.new_etfs,
    fetchedAt,
    "dateless new-ETF surfaces must expose acquisition age through fetched_at",
  );
}

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
  const ticker = "YFONLY";
  const detail = {
    source: "yahoo_finance",
    source_provider: "yahoo_finance",
    detail_status: "yf_fallback",
    normalized: {
      name: "Yahoo fallback test ETF",
      classification: {
        confidence: "high",
        is_leveraged: false,
        is_inverse: false,
        is_single_stock: false,
      },
      history_periods: {
        daily_1y: Array.from({ length: ETF_CORE_DAILY_BASKET_CONFIG.minDaily1yRows }, (_, index) => ({
          date: new Date(Date.UTC(2025, 0, 2 + index)).toISOString().slice(0, 10),
          Close: 100,
          Volume: 20_000,
        })),
      },
    },
  };
  const actionRow = {
    ticker,
    company: "Yahoo fallback test ETF",
    scored_signal_count: ETF_CORE_DAILY_BASKET_CONFIG.minScoredSignalCount,
    coverage_ratio: ETF_CORE_DAILY_BASKET_CONFIG.minCoverageRatio,
    confidence_label: ETF_CORE_DAILY_BASKET_CONFIG.allowedActionConfidence,
    aum: ETF_CORE_DAILY_BASKET_CONFIG.minAum,
  };
  const common = {
    ticker,
    actionRow,
    detail,
    missingDetailSet: new Set(),
    yahooFallbackSet: new Set([ticker]),
    newEtfSet: new Set(),
  };
  const unenrolledReasons = structuralReasons({ ...common, enrolled: false });
  assert.ok(unenrolledReasons.includes("yahoo_fallback_detail"));
  assert.ok(unenrolledReasons.includes("non_stockanalysis_detail"));

  const enrolledReasons = structuralReasons({ ...common, enrolled: true });
  assert.equal(enrolledReasons.includes("yahoo_fallback_detail"), false);
  assert.equal(enrolledReasons.includes("non_stockanalysis_detail"), false);
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

{
  const { cohortMetrics } = selectBasketRows([
    {
      ticker: "EQFRESH1",
      category: "Equity",
      status: "fresh",
      action_score: 4,
      proof: { quote_age_days: 1 },
    },
    {
      ticker: "EQFRESH2",
      category: "Equity",
      status: "fresh",
      action_score: 3,
      proof: { quote_age_days: 3 },
    },
    {
      ticker: "FISTALE1",
      category: "Fixed Income",
      status: "needs_refresh",
      action_score: 2,
      proof: { quote_age_days: 8 },
    },
    {
      ticker: "FISTALE2",
      category: "Fixed Income",
      status: "needs_refresh",
      action_score: 1,
      proof: { quote_age_days: null },
    },
  ]);
  assert.deepEqual(cohortMetrics, {
    Equity: {
      eligible_count: 2,
      selected_count: 2,
      fresh_selected_count: 2,
      stale_selected_count: 0,
      achieved_coverage_pct: 100,
      max_quote_age_days: 3,
    },
    "Fixed Income": {
      eligible_count: 2,
      selected_count: 2,
      fresh_selected_count: 0,
      stale_selected_count: 2,
      achieved_coverage_pct: 100,
      max_quote_age_days: 8,
    },
  });
}

{
  const category = "Equity";
  const eligibleCount = ETF_CORE_DAILY_BASKET_CONFIG.categoryCaps[category] + 1;
  const { selected, cohortMetrics } = selectBasketRows(
    Array.from({ length: eligibleCount }, (_, index) => ({
      ticker: `CAP${String(index + 1).padStart(3, "0")}`,
      category,
      status: "fresh",
      action_score: eligibleCount - index,
    })),
  );
  assert.equal(selected.length, ETF_CORE_DAILY_BASKET_CONFIG.categoryCaps[category]);
  assert.deepEqual(cohortMetrics[category], {
    eligible_count: eligibleCount,
    selected_count: ETF_CORE_DAILY_BASKET_CONFIG.categoryCaps[category],
    fresh_selected_count: ETF_CORE_DAILY_BASKET_CONFIG.categoryCaps[category],
    stale_selected_count: 0,
    achieved_coverage_pct: 98.04,
    max_quote_age_days: null,
  });
}

{
  const category = "Currency";
  const { selected, cohortMetrics } = selectBasketRows([
    {
      ticker: "NULLAGE1",
      category,
      status: "fresh",
      action_score: 2,
      proof: { quote_age_days: null },
    },
    {
      ticker: "NULLAGE2",
      category,
      status: "fresh",
      action_score: 1,
      proof: { quote_age_days: null },
    },
  ]);
  assert.equal(selected.length, 2);
  assert.equal(cohortMetrics[category].selected_count, 2);
  assert.equal(cohortMetrics[category].max_quote_age_days, null);
}

{
  const honestDegraded = classifyEtfCoreReadiness({
    core_daily_basket_ready: false,
    readiness_status: "not_ready",
    stale_selected_count: 2,
    blockers: ["two selected rows need refresh"],
  });
  assert.deepEqual(honestDegraded.errors, []);
  assert.ok(honestDegraded.warnings.some((message) => message.includes("DEGRADED")));
  assert.ok(honestDegraded.warnings.some((message) => message.includes("stale_selected_count=2")));

  const falseReady = classifyEtfCoreReadiness({
    core_daily_basket_ready: true,
    readiness_status: "ready",
    stale_selected_count: 1,
    blockers: [],
  });
  assert.ok(falseReady.errors.some((message) => message.includes("false-ready")));

  const malformed = classifyEtfCoreReadiness({
    core_daily_basket_ready: "yes",
    readiness_status: "green",
    stale_selected_count: "2",
    blockers: null,
  });
  assert.equal(malformed.errors.length, 4);
}

console.log("test-build-fenok-etf-core-daily-basket: ok");
