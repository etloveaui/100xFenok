#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildRimIndexInputs,
  parseArgs,
  validateRimIndexInputs,
  buildPublicRimMirror,
  krxInputFreshness,
  soxInputFreshness,
} from "./build-rim-index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function writeJson(absPath, payload) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function makeKr10yFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rim-index-"));
  for (const dir of ["benchmarks", "computed", "damodaran", "slickcharts", "stockanalysis", "yf"]) {
    fs.symlinkSync(path.join(dataRoot, dir), path.join(tempRoot, dir), "dir");
  }
  const macroPayload = readJson(path.join(dataRoot, "macro/fred-banking-daily.json"));
  macroPayload.series.IRLTLT01KRM156N = [
    { date: "2026-05-01", value: 3.25 },
    { date: "2026-06-01", value: 3.33 },
  ];
  writeJson(path.join(tempRoot, "macro/fred-banking-daily.json"), macroPayload);
  return tempRoot;
}

function makeKrxBridgeFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rim-index-krx-bridge-"));
  for (const dir of ["benchmarks", "computed", "damodaran", "macro", "slickcharts", "stockanalysis", "yf"]) {
    fs.symlinkSync(path.join(dataRoot, dir), path.join(tempRoot, dir), "dir");
  }
  const stockActionPayload = readJson(path.join(dataRoot, "computed/stock_action_index.json"));
  const rows = (stockActionPayload.rows ?? [])
    .filter((row) =>
      row?.marketScope === "korea"
      && String(row?.symbol ?? "").endsWith(".KS")
      && /^\d{6}$/.test(String(row?.ticker_normalized ?? ""))
      && typeof row?.dividendYield === "number"
      && typeof row?.estimateSnapshot?.forwardEps?.fy1 === "number"
      && typeof row?.estimateSnapshot?.forwardEps?.fy2 === "number"
      && typeof row?.estimateSnapshot?.forwardEps?.fy3 === "number"
      && typeof row?.profitabilitySnapshot?.roe?.fy1 === "number"
      && typeof row?.profitabilitySnapshot?.roe?.fy2 === "number"
      && typeof row?.profitabilitySnapshot?.roe?.fy3 === "number"
      && typeof row?.marketCap === "number"
      && row.marketCap > 0)
    .slice(0, 24);
  assert.ok(rows.length >= 12, "Korea stock_action fixture rows");
  const totalMarketCap = rows.reduce((sum, row) => sum + row.marketCap, 0);
  const bridgeSource = "admin/fenok-edge-korea-krx-daily-index.json";
  writeJson(path.join(tempRoot, bridgeSource), {
    schema_version: "fenok-edge-korea-krx-bridge/v1",
    generated_at: "2026-07-08T15:00:00.000Z",
    market: "Korea",
    source: "KRX_OPEN_API",
    raw_public: false,
    license_or_terms_note: "fixture raw stays private",
    bridge_scope: "stats_and_public_safe_rim_inputs_private_path_refs_no_raw_rows",
    as_of: "2026-07-08",
    private_artifacts: {
      raw_root: "_private/admin/fenok-edge-korea/daily/fixture/raw",
    },
    derived_rim_inputs: {
      schema_version: "krx_derived_rim_inputs.v1",
      generated_at: "2026-07-08T15:00:00.000Z",
      as_of: "2026-07-08",
      raw_public: false,
      license_or_terms_note: "fixture raw stays private",
      status: "ready",
      missing: [],
      kospi_weights: {
        source: `${bridgeSource}#derived_rim_inputs.kospi_weights`,
        source_field: "derived_rim_inputs.kospi_weights.rows[].weight",
        as_of: "2026-07-08",
        raw_public: false,
        license_or_terms_note: "fixture raw stays private",
        row_count: rows.length,
        total_market_cap: totalMarketCap,
        denominator: {
          method: "issuer_level_market_cap_sum",
          label: "KRX KOSPI stock-daily issuer MKTCAP sum; matches KOSPI including foreign shares aggregate in kospi_dd_trd",
          unit: "KRW",
          value: totalMarketCap,
        },
        rows: rows.map((row) => {
          const weight = row.marketCap / totalMarketCap;
          return {
            code: row.ticker_normalized,
            name: row.company,
            weight,
            weight_pct: weight * 100,
          };
        }),
      },
      korea_10y: {
        value: 0.04241,
        date: "2026-07-08",
        raw_value_percent: 4.241,
        source: `${bridgeSource}#derived_rim_inputs.korea_10y`,
        source_field: "derived_rim_inputs.korea_10y.value",
        label: "KRX KTS 10Y benchmark government bond yield",
        raw_public: false,
        license_or_terms_note: "fixture raw stays private",
      },
    },
  });
  return tempRoot;
}

function makeBenchmarkAvailabilityFixture({ missing = false, stale = false } = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rim-index-availability-"));
  for (const dir of ["computed", "damodaran", "indices", "macro", "slickcharts", "stockanalysis", "yf"]) {
    fs.symlinkSync(path.join(dataRoot, dir), path.join(tempRoot, dir), "dir");
  }
  if (!missing) {
    fs.mkdirSync(path.join(tempRoot, "benchmarks"), { recursive: true });
    for (const file of ["us.json", "emerging.json", "micro_sectors.json"]) {
      const payload = readJson(path.join(dataRoot, "benchmarks", file));
      if (stale) {
        for (const section of Object.values(payload.sections ?? {})) {
          for (const row of Array.isArray(section?.data) ? section.data : []) row.date = "2026-05-01";
        }
      }
      writeJson(path.join(tempRoot, "benchmarks", file), payload);
    }
  }
  return tempRoot;
}

const ciSundayKrxFreshness = krxInputFreshness(
  "2026-07-09",
  "2026-07-12T01:41:29.000Z",
);
assert.equal(ciSundayKrxFreshness.calendar_age_days, 3);
assert.equal(ciSundayKrxFreshness.business_age_days, 1);
assert.equal(ciSundayKrxFreshness.freshness_unit, "business_days");
assert.equal(ciSundayKrxFreshness.freshness_calendar, "krx_market");
assert.equal(ciSundayKrxFreshness.status, "fresh_enough_for_input_slice");

const staleTuesdayKrxFreshness = krxInputFreshness(
  "2026-07-09",
  "2026-07-14T00:00:00.000Z",
);
assert.equal(staleTuesdayKrxFreshness.calendar_age_days, 5);
assert.equal(staleTuesdayKrxFreshness.business_age_days, 3);
assert.equal(staleTuesdayKrxFreshness.status, "refresh_recommended");

const mondayBoundaryKrxFreshness = krxInputFreshness(
  "2026-07-09",
  "2026-07-13T02:30:00.000Z",
);
assert.equal(mondayBoundaryKrxFreshness.calendar_age_days, 4);
assert.equal(mondayBoundaryKrxFreshness.business_age_days, 2);
assert.equal(mondayBoundaryKrxFreshness.status, "fresh_enough_for_input_slice");

const krxHolidayFreshness = krxInputFreshness(
  "2026-08-14",
  "2026-08-18T00:00:00.000Z",
);
assert.equal(krxHolidayFreshness.calendar_age_days, 4);
assert.equal(krxHolidayFreshness.business_age_days, 1);
assert.equal(krxHolidayFreshness.status, "fresh_enough_for_input_slice");

const holidayWeekendSoxFreshness = soxInputFreshness(
  "2026-07-02",
  "2026-07-12T00:00:00.000Z",
);
assert.equal(holidayWeekendSoxFreshness.calendar_age_days, 10);
assert.equal(holidayWeekendSoxFreshness.business_age_days, 5);
assert.equal(holidayWeekendSoxFreshness.freshness_calendar, "us_market");
assert.equal(holidayWeekendSoxFreshness.status, "fresh_enough_for_input_slice");

const futureKrxFreshness = krxInputFreshness(
  "2026-07-13",
  "2026-07-12T00:00:00.000Z",
);
assert.equal(futureKrxFreshness.business_age_days, 0);
assert.equal(futureKrxFreshness.future_date_anomaly, true);
assert.equal(futureKrxFreshness.status, "refresh_recommended");

const invalidKrxFreshness = krxInputFreshness(
  "2026-02-31",
  "2026-07-12T00:00:00.000Z",
);
assert.equal(invalidKrxFreshness.business_age_days, null);
assert.equal(invalidKrxFreshness.status, "refresh_recommended");

const futureSoxFreshness = soxInputFreshness(
  "2026-07-13",
  "2026-07-12T00:00:00.000Z",
);
assert.equal(futureSoxFreshness.future_date_anomaly, true);
assert.equal(futureSoxFreshness.status, "refresh_recommended");

const invalidSoxFreshness = soxInputFreshness(
  "2026-07-09junk",
  "2026-07-12T00:00:00.000Z",
);
assert.equal(invalidSoxFreshness.business_age_days, null);
assert.equal(invalidSoxFreshness.status, "refresh_recommended");

const payload = buildRimIndexInputs({
  generatedAt: "2026-07-12T01:41:29.000Z",
});
const validation = validateRimIndexInputs(payload);

assert.equal(validation.ok, true, validation.errors.join("\n"));
assert.equal(payload.schema_version, "rim_index_inputs.v1");
assert.equal(payload.output_scope, "inputs_only_no_fair_value");
assert.deepEqual(payload.policy.primary_indices, ["SPX", "NDX"]);

for (const id of ["SPX", "NDX"]) {
  const item = payload.indices[id];
  assert.equal(item.role, "primary_public_v1", `${id}: role`);
  assert.equal(item.blockers.length, 0, `${id}: blockers`);
  assert.equal(item.observed.price.source_tier, "observed_source", `${id}: price tier`);
  assert.equal(item.observed.forward_eps.source_tier, "observed_source", `${id}: EPS tier`);
  assert.equal(item.observed.risk_free_rate.source_tier, "observed_source", `${id}: risk-free tier`);
  assert.equal(item.observed.risk_free_rate.source, "macro/fred-banking-daily.json", `${id}: risk-free source`);
  assert.equal(item.derived.payout_ratio.source_tier, "derived_formula", `${id}: payout tier`);
  assert.equal(item.derived.payout_ratio.formula, "stock_action_index_weighted_dividend_yield / (benchmark_best_eps / benchmark_px_last)", `${id}: payout formula`);
  assert.equal(item.derived.explicit_eps_growth_3y.source_tier, "derived_formula", `${id}: growth tier`);
  assert.ok(item.derived.payout_ratio.coverage.covered_weight_ratio > 0.5, `${id}: payout coverage`);
  assert.ok(item.derived.payout_ratio.coverage.weighted_dividend_yield >= 0, `${id}: weighted dividend yield`);
  assert.equal(item.derived.legacy_payout_ratio_qa.source_tier, "derived_formula", `${id}: legacy payout QA tier`);
  assert.ok(item.derived.legacy_payout_ratio_qa.qa.covered_weight_ratio > 0.5, `${id}: legacy payout QA coverage`);
  assert.ok(item.derived.explicit_eps_growth_3y.coverage.covered_weight_ratio >= 0.75, `${id}: growth coverage`);
  assert.equal(item.derived.cost_of_equity.source_tier, "derived_formula", `${id}: cost of equity tier`);
  assert.ok(item.derived.cost_of_equity.value > item.observed.risk_free_rate.value, `${id}: cost of equity value`);
  assert.equal(item.derived.forecast_grid_v1.schema_version, "forecast_grid_v1", `${id}: forecast grid schema`);
  assert.equal(item.derived.forecast_grid_v1.public_status, "ready_inputs_only_no_fair_value", `${id}: forecast grid status`);
  assert.equal(item.derived.forecast_grid_v1.periods.length, 3, `${id}: forecast grid period count`);
  for (const [rowIndex, row] of item.derived.forecast_grid_v1.periods.entries()) {
    assert.ok(["fy1", "fy2", "fy3"].includes(row.period), `${id}: forecast period`);
    assert.equal(
      row.derivation_depth,
      rowIndex === 0 ? "source_anchored_or_one_step" : "chained_roll_forward",
      `${id}: derivation depth`,
    );
    assert.equal(
      row.source_confidence,
      rowIndex === 0 ? "source_snapshot_base_effect_sensitive" : "compounded_derived",
      `${id}: source confidence`,
    );
    assert.equal(
      row.growth_basis,
      rowIndex === 0 ? "source_reported_eps_growth_snapshot" : "forward_eps_ratio",
      `${id}: growth basis`,
    );
    assert.equal(
      row.growth_usage,
      rowIndex === 0 ? "context_only_not_earnings_roll_forward" : "earnings_path_roll_forward",
      `${id}: growth usage`,
    );
    assert.equal(row.earnings_proxy.source_tier, "derived_formula", `${id}: earnings proxy tier`);
    assert.equal(row.book_value_ending.source_tier, "derived_formula", `${id}: book value ending tier`);
    assert.equal(row.pe_ratio.source_tier, "derived_formula", `${id}: PE tier`);
    assert.equal(row.peg_ratio.source_tier, "derived_formula", `${id}: PEG tier`);
    assert.equal(row.peg_ratio.formula, "pe_ratio / (derived.explicit_eps_growth_3y * 100)", `${id}: PEG formula`);
    assert.ok(row.peg_ratio.sources.includes("derived.explicit_eps_growth_3y"), `${id}: PEG canonical source`);
    assert.notEqual(row.residual_income_proxy.value, null, `${id}: residual income proxy value`);
    if (rowIndex === 0) {
      assert.equal(row.earnings_proxy.formula, "benchmark_best_eps_anchor", `${id}: FY1 earnings proxy anchor`);
      assert.match(row.eps_growth.formula, /estimateSnapshot\.epsGrowth\.fy1/, `${id}: FY1 source-reported growth formula`);
      assert.match(row.eps_growth.notes.join(" "), /not applied/i, `${id}: FY1 eps growth caveat`);
      assert.match(row.earnings_proxy.notes.join(" "), /not multiplied/i, `${id}: FY1 earnings proxy caveat`);
    } else {
      assert.match(row.eps_growth.formula, /forward_eps_fy\d \/ forward_eps_fy\d/, `${id}: forward ratio growth formula`);
      assert.match(row.earnings_proxy.formula, /prior_period_earnings_proxy/, `${id}: roll-forward earnings proxy`);
    }
  }
}

// Coverage loss is honest lane degradation, not platform corruption. A stricter
// fixture floor forces the real builder down that path without fabricating inputs.
const degradedCoveragePayload = buildRimIndexInputs({
  generatedAt: "2026-07-12T01:41:29.000Z",
  minCoveredWeight: 0.99,
});
const degradedCoverageValidation = validateRimIndexInputs(degradedCoveragePayload, {
  minCoveredWeight: 0.99,
});
assert.equal(degradedCoverageValidation.ok, true, degradedCoverageValidation.errors.join("\n"));
assert.ok(degradedCoverageValidation.warnings.length > 0, "coverage degradation must be named");
for (const id of ["SPX", "NDX"]) {
  const item = degradedCoveragePayload.indices[id];
  assert.equal(item.public_status, "input_only_primary_with_caveats", `${id}: degraded public status`);
  assert.ok(item.blockers.length > 0, `${id}: degradation blockers`);
  assert.equal(
    item.derived.forecast_grid_v1.public_status,
    "input_only_primary_with_caveats_no_fair_value",
    `${id}: degraded forecast-grid status`,
  );
}

// Claiming READY with the same low coverage remains a false-ready corruption.
const falseReadyPayload = JSON.parse(JSON.stringify(degradedCoveragePayload));
falseReadyPayload.indices.SPX.public_status = "ready_inputs_and_forecast_grid";
falseReadyPayload.indices.SPX.derived.forecast_grid_v1.public_status = "ready_inputs_only_no_fair_value";
const falseReadyValidation = validateRimIndexInputs(falseReadyPayload, { minCoveredWeight: 0.99 });
assert.equal(falseReadyValidation.ok, false);
assert.ok(falseReadyValidation.errors.some((error) => /SPX: false-ready/.test(error)));

// Formula/source-tier integrity remains platform-blocking even when availability
// is otherwise healthy.
const tamperedFormulaPayload = JSON.parse(JSON.stringify(payload));
tamperedFormulaPayload.indices.SPX.derived.cost_of_equity.formula = "risk_free_rate";
assert.equal(validateRimIndexInputs(tamperedFormulaPayload).ok, false);
const tamperedValuePayload = JSON.parse(JSON.stringify(payload));
tamperedValuePayload.indices.SPX.derived.cost_of_equity.value += 0.1;
assert.equal(validateRimIndexInputs(tamperedValuePayload).ok, false);

const missingBenchmarkRoot = makeBenchmarkAvailabilityFixture({ missing: true });
try {
  const missingBenchmarkPayload = buildRimIndexInputs({
    dataRootOverride: missingBenchmarkRoot,
    generatedAt: "2026-07-12T00:00:00.000Z",
  });
  const missingBenchmarkValidation = validateRimIndexInputs(missingBenchmarkPayload);
  assert.equal(missingBenchmarkValidation.ok, true, missingBenchmarkValidation.errors.join("\n"));
  for (const id of ["SPX", "NDX", "KOSPI", "SOX"]) {
    assert.ok(missingBenchmarkPayload.indices[id].blockers.some((row) => row.code === "source_unavailable"));
    assert.equal(missingBenchmarkPayload.indices[id].observed.price.value, null);
    assert.match(missingBenchmarkPayload.indices[id].observed.price.reason, /unavailable/);
  }
} finally {
  fs.rmSync(missingBenchmarkRoot, { recursive: true, force: true });
}

const staleBenchmarkRoot = makeBenchmarkAvailabilityFixture({ stale: true });
try {
  const staleBenchmarkPayload = buildRimIndexInputs({
    dataRootOverride: staleBenchmarkRoot,
    generatedAt: "2026-07-12T00:00:00.000Z",
  });
  const staleBenchmarkValidation = validateRimIndexInputs(staleBenchmarkPayload);
  assert.equal(staleBenchmarkValidation.ok, true, staleBenchmarkValidation.errors.join("\n"));
  for (const id of ["SPX", "NDX"]) {
    assert.equal(staleBenchmarkPayload.indices[id].public_status, "input_only_primary_with_caveats");
    assert.ok(staleBenchmarkPayload.indices[id].blockers.some((row) => row.code === "benchmark_source_refresh_recommended"));
  }
  assert.equal(staleBenchmarkPayload.indices.SOX.public_status, "input_only_sox_methodology_weights_with_caveats");
  const tamperedDegradedSecondary = JSON.parse(JSON.stringify(staleBenchmarkPayload));
  tamperedDegradedSecondary.indices.SOX.derived.cost_of_equity.formula = "risk_free_rate";
  assert.equal(validateRimIndexInputs(tamperedDegradedSecondary).ok, false);
} finally {
  fs.rmSync(staleBenchmarkRoot, { recursive: true, force: true });
}

assert.equal(payload.indices.CCMP.role, "secondary_input_only");
assert.ok(payload.indices.CCMP.blockers.some((blocker) => blocker.code === "missing_named_constituent_weight_path"));
assert.equal(payload.coverage_diagnostics.proxy_constituent_candidates.CCMP.proxy_ticker, "ONEQ");
assert.equal(payload.coverage_diagnostics.proxy_constituent_candidates.CCMP.exact_index_substitute, false);
assert.ok(payload.coverage_diagnostics.proxy_constituent_candidates.CCMP.resolved_weight_ratio < 0.75);

const kospi = payload.indices.KOSPI;
assert.doesNotMatch(String(kospi.observed.risk_free_rate.source_field ?? ""), /DGS10/);
if (kospi.role === "secondary_input_only") {
  assert.equal(kospi.public_status, "ready_inputs_and_forecast_grid");
  assert.equal(kospi.observed.risk_free_rate.source_tier, "observed_source");
  assert.match(kospi.observed.risk_free_rate.source, /(kts_bydd_trd\/\d{8}\.json|derived_rim_inputs\.korea_10y)/);
  assert.ok(kospi.observed.risk_free_rate.value > 0.01);
  assert.ok(kospi.observed.risk_free_rate.value < 0.1);
  assert.equal(kospi.blockers.length, 0);
  assert.ok(!kospi.blockers.some((blocker) => blocker.code === "missing_kospi_constituent_weight_path"));
  assert.ok(!kospi.blockers.some((blocker) => blocker.code === "country_risk_free_source_solved_not_wired"));
  assert.equal(kospi.derived.payout_ratio.source_tier, "derived_formula");
  assert.equal(kospi.derived.explicit_eps_growth_3y.source_tier, "derived_formula");
  assert.equal(kospi.derived.cost_of_equity.source_tier, "derived_formula");
  assert.ok(kospi.derived.payout_ratio.coverage.covered_weight_ratio >= 0.75);
  assert.ok(kospi.derived.explicit_eps_growth_3y.coverage.covered_weight_ratio >= 0.75);
  assert.equal(kospi.derived.forecast_grid_v1.schema_version, "forecast_grid_v1");
  assert.equal(kospi.derived.forecast_grid_v1.public_status, "input_only_krx_exact_weights_no_fair_value");
  assert.equal(kospi.derived.forecast_grid_v1.periods.length, 3);
  assert.equal(payload.coverage_diagnostics.stock_action.KOSPI.public_status, "krx_exact_weights_available");
  assert.equal(payload.coverage_diagnostics.stock_action.KOSPI.krx_kospi_weights.source_tier, "exact_index_weight_source");
  assert.ok(payload.coverage_diagnostics.stock_action.KOSPI.krx_kospi_weights.krx_rows > 0);
  assert.equal(
    payload.coverage_diagnostics.stock_action.KOSPI.krx_kospi_weights.denominator.label,
    "KRX KOSPI stock-daily issuer MKTCAP sum; matches KOSPI including foreign shares aggregate in kospi_dd_trd",
  );
  assert.ok(payload.coverage_diagnostics.stock_action.KOSPI.krx_kospi_weights.matched_weight_ratio >= 0.9);
  assert.ok(payload.coverage_diagnostics.stock_action.KOSPI.krx_kospi_weights.forward_eps_fy1_fy3_weight_ratio >= 0.75);
} else {
  assert.equal(kospi.role, "backlog_blocked");
  assert.equal(kospi.public_status, "blocked_or_input_only");
  assert.ok(kospi.blockers.some((blocker) => blocker.code === "missing_kospi_constituent_weight_path"));
  assert.equal(payload.coverage_diagnostics.stock_action.KOSPI.public_status, "blocked_missing_kospi_index_weights");
  assert.equal(payload.coverage_diagnostics.stock_action.KOSPI.krx_kospi_weights, null);
}
assert.equal(payload.coverage_diagnostics.stock_action.KOSPI.kospi_index_weight_rows, 0);
assert.ok(payload.coverage_diagnostics.stock_action.KOSPI.forward_eps_fy1_fy3_rows > 0);
assert.equal(payload.coverage_diagnostics.proxy_constituent_candidates.KOSPI.proxy_ticker, "EWY");
assert.equal(payload.coverage_diagnostics.proxy_constituent_candidates.KOSPI.exact_index_substitute, false);
assert.equal(payload.coverage_diagnostics.proxy_constituent_candidates.KOSPI.diagnostic_status, "rejected_not_kospi_benchmark");
assert.ok(payload.coverage_diagnostics.proxy_constituent_candidates.KOSPI.resolved_weight_ratio >= 0.75);
assert.ok(payload.coverage_diagnostics.proxy_constituent_candidates.KOSPI.forward_eps_fy1_fy3_weight_ratio >= 0.75);

const fixtureRoot = makeKr10yFixture();
try {
  const payloadWithKr10y = buildRimIndexInputs({
    dataRootOverride: fixtureRoot,
    generatedAt: "2026-07-12T00:00:00.000Z",
  });
  const kospiRiskFree = payloadWithKr10y.indices.KOSPI.observed.risk_free_rate;
  assert.equal(kospiRiskFree.source_tier, "observed_source");
  assert.equal(kospiRiskFree.source, "macro/fred-banking-daily.json");
  assert.equal(kospiRiskFree.source_field, "series.IRLTLT01KRM156N[-1].value / 100");
  assert.equal(kospiRiskFree.value, 0.0333);
  assert.equal(validateRimIndexInputs(payloadWithKr10y).ok, true);
  assert.ok(!payloadWithKr10y.indices.KOSPI.blockers.some((blocker) => blocker.code === "country_risk_free_source_solved_not_wired"));
  assert.ok(payloadWithKr10y.indices.KOSPI.blockers.some((blocker) => blocker.code === "missing_kospi_constituent_weight_path"));
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

const bridgeFixtureRoot = makeKrxBridgeFixture();
try {
  const payloadWithBridgeOnlyKrx = buildRimIndexInputs({
    dataRootOverride: bridgeFixtureRoot,
    generatedAt: "2026-07-12T00:00:00.000Z",
  });
  assert.equal(validateRimIndexInputs(payloadWithBridgeOnlyKrx).ok, true);
  const kospiBridge = payloadWithBridgeOnlyKrx.indices.KOSPI;
  assert.equal(kospiBridge.role, "secondary_input_only");
  assert.equal(kospiBridge.public_status, "ready_inputs_and_forecast_grid");
  assert.match(kospiBridge.observed.risk_free_rate.source, /derived_rim_inputs\.korea_10y/);
  assert.equal(kospiBridge.blockers.length, 0);
  assert.equal(payloadWithBridgeOnlyKrx.coverage_diagnostics.stock_action.KOSPI.public_status, "krx_exact_weights_available");
  assert.match(payloadWithBridgeOnlyKrx.coverage_diagnostics.stock_action.KOSPI.krx_kospi_weights.source, /derived_rim_inputs\.kospi_weights/);
  assert.ok(payloadWithBridgeOnlyKrx.coverage_diagnostics.stock_action.KOSPI.krx_kospi_weights.matched_weight_ratio >= 0.75);
  assert.equal(kospiBridge.derived.forecast_grid_v1.public_status, "input_only_krx_exact_weights_no_fair_value");

  const staleBridgePayload = buildRimIndexInputs({
    dataRootOverride: bridgeFixtureRoot,
    generatedAt: "2026-07-13T02:30:00.000Z",
  });
  const staleKospiBridge = staleBridgePayload.indices.KOSPI;
  assert.equal(staleKospiBridge.public_status, "input_only_krx_exact_weights_with_caveats");
  assert.ok(staleKospiBridge.blockers.some((row) => row.code === "krx_kospi_daily_refresh_recommended"));
} finally {
  fs.rmSync(bridgeFixtureRoot, { recursive: true, force: true });
}

const sox = payload.indices.SOX;
assert.equal(sox.role, "secondary_input_only");
assert.equal(sox.public_status, "ready_inputs_and_forecast_grid");
assert.equal(sox.blockers.length, 0);
assert.equal(sox.observed.risk_free_rate.source_tier, "observed_source");
assert.equal(sox.observed.risk_free_rate.source, "macro/fred-banking-daily.json");
assert.equal(sox.observed.equity_risk_premium.source_tier, "observed_source");
assert.equal(sox.derived.payout_ratio.source_tier, "derived_formula");
assert.equal(sox.derived.payout_ratio.formula, "sox_methodology_weighted_dividend_yield / (benchmark_best_eps / benchmark_px_last)");
assert.equal(sox.derived.explicit_eps_growth_3y.source_tier, "derived_formula");
assert.equal(sox.derived.cost_of_equity.source_tier, "derived_formula");
assert.ok(sox.derived.payout_ratio.coverage.covered_weight_ratio >= 0.75);
assert.ok(sox.derived.explicit_eps_growth_3y.coverage.covered_weight_ratio >= 0.75);
assert.equal(sox.derived.forecast_grid_v1.schema_version, "forecast_grid_v1");
assert.equal(sox.derived.forecast_grid_v1.public_status, "input_only_sox_methodology_weights_no_fair_value");
assert.equal(sox.derived.forecast_grid_v1.periods.length, 3);
assert.equal(sox.derived.forecast_grid_v1.coverage.index_key, "sox_nasdaq_giw_methodology_mktcap");
assert.equal(sox.derived.proxy_inputs_v1, undefined);
const soxDiagnostic = payload.coverage_diagnostics.stock_action.SOX;
assert.equal(soxDiagnostic.source_tier, "methodology_derived_index_weight_source");
assert.equal(soxDiagnostic.source, "indices/nasdaq-giw-sox-constituents.json");
assert.equal(soxDiagnostic.official_weight_columns_available, false);
assert.equal(soxDiagnostic.constituent_rows, 30);
assert.equal(soxDiagnostic.methodology_weight_rows, 30);
assert.equal(soxDiagnostic.cap_violation_count, 0);
assert.ok(Math.abs(soxDiagnostic.methodology_weight_total - 100) < 0.0001);
assert.ok(Array.isArray(soxDiagnostic.top_weight_sample));
assert.ok(soxDiagnostic.top_weight_sample.length > 0);
assert.ok(soxDiagnostic.matched_weight_ratio >= 0.99);
assert.ok(soxDiagnostic.forward_eps_fy1_fy3_weight_ratio >= 0.75);
assert.equal(payload.coverage_diagnostics.proxy_constituent_candidates.SOX.proxy_ticker, "SOXX");
assert.equal(payload.coverage_diagnostics.proxy_constituent_candidates.SOX.exact_index_substitute, false);
assert.ok(payload.coverage_diagnostics.proxy_constituent_candidates.SOX.resolved_weight_ratio >= 0.75);

const badProxyPayload = JSON.parse(JSON.stringify(payload));
badProxyPayload.indices.SOX.derived.proxy_inputs_v1 = {
  schema_version: "proxy_inputs_v1",
  source_tier: "proxy_diagnostic",
  exact_index_substitute: false,
};
assert.equal(validateRimIndexInputs(badProxyPayload).ok, false);

const publicText = JSON.stringify(payload);
assert.equal(publicText.includes('"fair_value"'), false);
assert.equal(publicText.includes('"target_price"'), false);
const projected = buildPublicRimMirror({ source: "_private/admin/rim.json", value: 1 });
assert.equal(projected.source, "admin_private_path_redacted");
assert.equal(projected.public_mirror_policy.raw_public, false);

assert.deepEqual(parseArgs(["--check", "--min-covered-weight", "0.8"]).check, true);
const cliRoot = path.join(os.tmpdir(), "rim-cli-data-root");
const cliPublicRoot = path.join(os.tmpdir(), "rim-cli-public-root");
assert.equal(parseArgs(["--data-root", cliRoot]).dataRoot, path.resolve(cliRoot));
assert.equal(parseArgs([`--data-root=${cliRoot}`]).dataRoot, path.resolve(cliRoot));
assert.equal(parseArgs(["--public-data-root", cliPublicRoot]).publicDataRoot, path.resolve(cliPublicRoot));
assert.equal(parseArgs([`--public-data-root=${cliPublicRoot}`]).publicDataRoot, path.resolve(cliPublicRoot));

console.log("test-build-rim-index: ok");
