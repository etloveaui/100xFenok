#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  YOO_LOGIC_INFERRED_RULE,
  YOO_LOGIC_SHARED_INFERRED_RULE,
  buildCurrentExtendedYooLogicProxyRanges,
  buildCurrentIndexForecastPathRanges,
  buildCurrentYooLogicSharedInferredRanges,
  buildHistoricalHorizonResidualValueDiagnostic,
  buildRussellCurrentOfficialFundamentalsDiagnostic,
  computeYooLogicLtroeCoverageSensitivity,
  runArchivedRuleCalibration,
} from "./fenok-rim-rule-calibration.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = path.join(ROOT, "data/computed/fenok-rim/sustainable-index-ranges.json");

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function writeJsonAtomic(destination, payload) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" });
  fs.renameSync(temporary, destination);
}

function valueSummary(row) {
  return {
    current_price: row.runtime_inputs.price,
    range: row.sweep.range,
    point_estimate: null,
    upside_range: {
      low: row.price_context.low_upside,
      high: row.price_context.high_upside,
    },
  };
}

function discountDomain(riskFree) {
  const measured = { low: 0.035, high: 0.042 };
  const houseExtrapolation = { low: 0.03, high: 0.05 };
  const inside = riskFree >= measured.low && riskFree <= measured.high;
  const bounded = riskFree >= houseExtrapolation.low && riskFree <= houseExtrapolation.high;
  return {
    status: inside ? "inside_measured_domain" : bounded ? "extrapolated" : "outside_house_domain",
    measured_risk_free_domain: measured,
    bounded_house_extrapolation_domain: houseExtrapolation,
    current_risk_free: riskFree,
    distance_from_domain: inside ? 0 : Math.min(Math.abs(riskFree - measured.low), Math.abs(riskFree - measured.high)),
  };
}

function dayAge(asOf, generatedAt) {
  const start = Date.parse(`${String(asOf).slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${String(generatedAt).slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.floor((end - start) / 86400000) : null;
}

function freshnessSummary(generatedAt, definitions) {
  const items = definitions.map(({ id, as_of: asOf, max_age_days: maxAgeDays }) => {
    const ageDays = dayAge(asOf, generatedAt);
    const passed = Number.isFinite(ageDays) && ageDays >= 0 && ageDays <= maxAgeDays;
    return { id, as_of: asOf ?? null, age_days: ageDays, max_age_days: maxAgeDays, status: passed ? "passed" : "failed" };
  });
  return { status: items.every((item) => item.status === "passed") ? "passed" : "failed", items };
}

function assertPromotableHouseRows(rows) {
  if (rows.length !== 6 || new Set(rows.map((row) => row.id)).size !== 6) {
    throw new Error("FENO house range promotion requires six unique indices");
  }
  for (const row of rows) {
    const range = row.value?.range;
    if (![row.value?.current_price, range?.low, range?.high].every(Number.isFinite) || range.low > range.high) {
      throw new Error(`${row.id}: finite ordered fair-value range required`);
    }
    if (row.value.point_estimate !== null || row.runtime_yoo_value_injection !== false) {
      throw new Error(`${row.id}: point or runtime Yoo target injection is forbidden`);
    }
    if (row.house_policy_proxy_used && row.confidence !== "low") {
      throw new Error(`${row.id}: proxy-backed house range must be low confidence`);
    }
    if (row.model_domain?.discount?.status === "outside_house_domain") {
      throw new Error(`${row.id}: risk-free rate is outside the bounded FENO discount domain`);
    }
    if (row.input_freshness?.status !== "passed") {
      throw new Error(`${row.id}: stale or future input blocks FENO house range publication`);
    }
    const payout = row.automatic_inputs?.payout;
    const payouts = typeof payout === "number" ? [payout] : [payout?.low, payout?.center, payout?.high];
    if (!payouts.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
      throw new Error(`${row.id}: payout inputs must be finite fractions`);
    }
  }
}

function baseRow(row, payoutEvidence, inputEvidence, generatedAt) {
  const exactCore = ["SPX", "NDX"].includes(row.id);
  const quality = exactCore ? "medium" : "low";
  return {
    id: row.id,
    status: "feno_house_fair_value_range",
    publication_status: "RANGE",
    confidence: quality,
    production_promoted: true,
    house_policy_proxy_used: !exactCore,
    model_domain: { discount: discountDomain(row.runtime_inputs.risk_free) },
    input_freshness: freshnessSummary(generatedAt, [
      { id: "price", as_of: inputEvidence.observed.price.as_of, max_age_days: 10 },
      { id: "risk_free", as_of: inputEvidence.observed.risk_free_rate.as_of, max_age_days: 10 },
      { id: "erp", as_of: inputEvidence.observed.equity_risk_premium.as_of, max_age_days: 180 },
      { id: "payout_policy_build", as_of: payoutEvidence.generated_at, max_age_days: 10 },
    ]),
    value: valueSummary(row),
    automatic_inputs: row.runtime_inputs,
    transformed_inputs: row.transformed_inputs,
    payout_basis: {
      role: "measured trailing four-year policy band",
      generated_at: payoutEvidence.generated_at,
      basis_id: payoutEvidence.basis_id,
      eligibility: payoutEvidence.indices[row.id === "SPX" ? "sp500" : row.id === "NDX" ? "nasdaq100" : row.id === "KOSPI" ? "kospi" : "philadelphia_semi"].eligibility,
    },
    source_quality: exactCore
      ? "exact index benchmark fundamentals plus current named membership; trailing payout remains a sensitivity-calibrated policy input"
      : row.id === "KOSPI"
        ? "exact KOSPI benchmark fundamentals, but the payout universe is all collected .KS names rather than exact historical KOSPI membership"
        : "exact PHLX benchmark fundamentals and public constituent identity, but trailing payout is current-membership and unweighted",
    method: {
      lt_roe: row.lt_roe_transform.equation,
      residual_value: YOO_LOGIC_INFERRED_RULE.structure_components.terminal,
      horizon: YOO_LOGIC_INFERRED_RULE.structure_components.horizon,
    },
    runtime_yoo_value_injection: false,
  };
}

function extendedRow(row, marketInput, generatedAt) {
  return {
    id: row.id,
    status: "feno_house_fair_value_range",
    publication_status: "RANGE",
    confidence: "low",
    production_promoted: true,
    house_policy_proxy_used: true,
    model_domain: { discount: discountDomain(row.runtime_inputs.risk_free) },
    input_freshness: freshnessSummary(generatedAt, [
      { id: "price", as_of: row.proxy_inputs.index_fundamentals.as_of, max_age_days: 10 },
      { id: "risk_free", as_of: marketInput.observed.risk_free_rate.as_of, max_age_days: 10 },
      { id: "erp", as_of: marketInput.observed.equity_risk_premium.as_of, max_age_days: 180 },
      { id: "payout_proxy_build", as_of: row.proxy_inputs.payout.generated_at, max_age_days: 10 },
    ]),
    value: valueSummary(row),
    automatic_inputs: row.runtime_inputs,
    transformed_inputs: row.transformed_inputs,
    source_quality: "exact Nasdaq Composite benchmark fundamentals combined with ONEQ payout proxy; exact Composite dividend weights are unavailable",
    proxy_inputs: row.proxy_inputs,
    exact_input_limitations: row.identity_blockers,
    method: {
      lt_roe: row.lt_roe_transform.equation,
      residual_value: YOO_LOGIC_INFERRED_RULE.structure_components.terminal,
      horizon: YOO_LOGIC_INFERRED_RULE.structure_components.horizon,
    },
    runtime_yoo_value_injection: false,
  };
}

function russellRow(row, marketInput, generatedAt) {
  return {
    id: "RUT",
    status: "feno_house_fair_value_range",
    publication_status: "RANGE",
    confidence: "low",
    production_promoted: true,
    house_policy_proxy_used: true,
    model_domain: { discount: discountDomain(row.runtime_inputs.risk_free) },
    input_freshness: freshnessSummary(generatedAt, [
      { id: "price", as_of: row.price_as_of, max_age_days: 10 },
      { id: "risk_free", as_of: marketInput.observed.risk_free_rate.as_of, max_age_days: 10 },
      { id: "erp", as_of: marketInput.observed.equity_risk_premium.as_of, max_age_days: 180 },
      { id: "official_quarterly_fundamentals", as_of: row.official_fundamentals.as_of, max_age_days: 120 },
    ]),
    value: valueSummary(row),
    automatic_inputs: row.runtime_inputs,
    transformed_inputs: row.transformed_inputs,
    source_quality: "official recurring LSEG Russell 2000 fundamentals; current price is newer than the quarterly fundamentals snapshot",
    official_fundamentals: row.official_fundamentals,
    fundamentals_age_days_at_price: row.fundamentals_age_days_at_price,
    exact_input_limitations: row.identity_blockers,
    method: {
      lt_roe: row.lt_roe_transform.equation,
      residual_value: YOO_LOGIC_INFERRED_RULE.structure_components.terminal,
      horizon: YOO_LOGIC_INFERRED_RULE.structure_components.horizon,
    },
    runtime_yoo_value_injection: false,
  };
}

export function buildSustainableIndexRanges({ root = ROOT, generatedAt = new Date().toISOString() } = {}) {
  const calibration = runArchivedRuleCalibration();
  const horizon = buildHistoricalHorizonResidualValueDiagnostic(root);
  const payoutEvidence = readJson(root, "data/computed/fenok-rim/payout-history.json");
  const core = buildCurrentYooLogicSharedInferredRanges(root);
  const strictPath = buildCurrentIndexForecastPathRanges(root);
  const indexInputs = readJson(root, "data/computed/rim-index/inputs.json");
  const extended = buildCurrentExtendedYooLogicProxyRanges(root);
  const russell = buildRussellCurrentOfficialFundamentalsDiagnostic(root).row;
  const rows = [
    ...core.rows.map((row) => baseRow(row, payoutEvidence, indexInputs.indices[row.id], generatedAt)),
    extendedRow(extended.rows.find((row) => row.id === "CCMP"), indexInputs.indices.SPX, generatedAt),
    russellRow(russell, indexInputs.indices.SPX, generatedAt),
  ];
  assertPromotableHouseRows(rows);
  const coverageSafeRows = core.rows.map((row) => {
    const strict = strictPath.rows.find((candidate) => candidate.id === row.id);
    if (strict?.status === "blocked") {
      return {
        id: row.id,
        status: "blocked",
        reason: "LTROE path exists but payout and identity gates do not support a fair-value sensitivity",
        blocking_reasons: strict.blocking_reasons,
      };
    }
    const periods = indexInputs.indices[row.id].derived.forecast_grid_v1.periods;
    return computeYooLogicLtroeCoverageSensitivity({
      id: row.id,
      price: row.runtime_inputs.price,
      book: row.runtime_inputs.book,
      roePath: periods.map((period) => period.roe_on_beginning_book.value),
      normalRoe: row.lt_roe_transform.normal_roe,
      payout: strict.automatic_payout_candidates[0].value,
      riskFree: row.runtime_inputs.risk_free,
      publicErp: row.runtime_inputs.public_erp,
    });
  });
  coverageSafeRows.push({
    id: "CCMP",
    status: "blocked",
    reason: "exact constituent weights, payout, and FY1-FY3 path are unavailable",
  });
  const russellCurrentRoe = russell.official_fundamentals.derived.current_roe_ex_negative_basis;
  const russellCoverage = computeYooLogicLtroeCoverageSensitivity({
      id: "RUT",
      price: russell.runtime_inputs.price,
      book: russell.runtime_inputs.book,
      roePath: [russell.runtime_inputs.fy3_roe.low, russell.runtime_inputs.fy3_roe.high],
      normalRoe: russellCurrentRoe,
      payout: russell.runtime_inputs.payout,
      riskFree: russell.runtime_inputs.risk_free,
      publicErp: russell.runtime_inputs.public_erp,
    });
  coverageSafeRows.push({
    ...russellCoverage,
    status: "diagnostic_only_date_mismatch_and_no_holdout",
    rule: {
      ...russellCoverage.rule,
      equation: "LTROE = hull(official current ROE, automatic FY3 scenario band) +/- 3.5 percentage points",
      input_shape: "official current ROE plus FY3 low/high scenarios; not a preserved FY1-FY3 path",
    },
  });
  return {
    schema_version: "fenok_rim_sustainable_index_ranges.v1",
    generated_at: generatedAt,
    status: "automatic_feno_house_fair_value_ranges_ready",
    scope: ["SPX", "NDX", "KOSPI", "SOX", "CCMP", "RUT"],
    runtime_contract: {
      automatic_diagnostic_fallback_inputs_refreshable: true,
      exact_official_input_refresh_complete: false,
      future_yoo_values_required: false,
      runtime_yoo_value_injection: false,
      runtime_target_level_injection: false,
      frozen_historical_yoo_calibration_parameters_used: true,
      output_type: "FENO_house_fair_value_range",
      point_estimate: false,
    },
    official_input_producers: {
      RUT: "ready recurring official LSEG quarterly snapshot with immutable archive",
      KOSPI: "producer and parser ready; live official screen refresh blocked pending an authorized KRX Data Marketplace session",
      SPX_NDX: "automatic benchmark and constituent paths ready",
      CCMP_SOX: "exact payout or official-weight routes unavailable; FENO house ranges use explicit low-confidence proxies",
    },
    methodology: {
      feno_house_policy: {
        starting_book: {
          equation: "B0 = current automatic benchmark price / current automatic benchmark P/B",
          fallback: "same-instrument automatic proxy only; proxy use lowers confidence but never injects a target level",
        },
        payout: {
          equation: "same-date direct index dividend yield / forward earnings yield when eligible; otherwise the disclosed automatic trailing or instrument proxy band",
          safeguard: "no Yoo payout or fair-value inversion is a runtime operand",
        },
        risk_free: {
          equation: "market-local automatic 10-year government yield",
        },
        erp: {
          equation: "public Damodaran ERP plus the frozen FENO asset-class lattice/range",
          safeguard: "historical calibration is frozen; current Yoo output is never used",
        },
        lt_roe: {
          equation: YOO_LOGIC_SHARED_INFERRED_RULE.equation,
          persistence_weight: YOO_LOGIC_SHARED_INFERRED_RULE.persistence_weight,
        },
        discount: YOO_LOGIC_INFERRED_RULE.structure_components.discount,
        horizon_and_residual_value: {
          horizon: YOO_LOGIC_INFERRED_RULE.structure_components.horizon,
          residual_income: YOO_LOGIC_INFERRED_RULE.structure_components.residual_income,
          book_roll_forward: YOO_LOGIC_INFERRED_RULE.structure_components.book_roll_forward,
          terminal: YOO_LOGIC_INFERRED_RULE.structure_components.terminal,
        },
      },
      structure_components_with_mixed_evidence_status: YOO_LOGIC_INFERRED_RULE.structure_components,
      narrow_house_range_rule: {
        ...YOO_LOGIC_SHARED_INFERRED_RULE,
        promotion_status: "adopted_as_FENO_house_range_policy",
      },
      coverage_safe_ltroe_rule: {
        equation: "LTROE = hull(normal ROE, automatic FY1-FY3 ROE path) +/- 3.5 percentage points",
        center: "none",
        derivation: "smallest symmetric 0.5 percentage-point lattice margin covering the archived index and stock calibration cases",
        evidence_status: "coverage_calibration_not_sealed_validation",
      },
      horizon_validation: {
        selected_horizon: horizon.selected_horizon,
        selected_validation_mae_pp: horizon.selected_validation_mae_pp,
        runner_up_validation_mae_pp: horizon.runner_up_validation_mae_pp,
        classification: horizon.classification,
      },
      unresolved_for_exact_yoo_identification: {
        erp: calibration.erp.blocking_reasons,
        lt_roe: calibration.lt_roe.blocking_reasons,
        discount_horizon: calibration.discount_horizon.blocking_reasons,
      },
    },
    promotion_gate: {
      status: "passed",
      checks: {
        six_unique_indices: true,
        finite_ordered_ranges: true,
        point_estimates_forbidden: true,
        runtime_yoo_target_injection_forbidden: true,
        proxy_rows_low_confidence: true,
        bounded_discount_extrapolation: true,
        input_freshness_enforced: true,
        payout_fraction_bounds_enforced: true,
      },
    },
    interpretation: "Rows are automatic FENO house fair-value ranges. They deliberately convert unresolved Yoo identification into frozen FENO policy, disclose proxy use, discount-domain extrapolation and confidence, and never claim to be Yoo's current values. No point estimate is published.",
    rows,
    coverage_safe_rows: coverageSafeRows,
  };
}

function parseArgs(argv) {
  let output = DEFAULT_OUTPUT;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--output") {
      if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error("--output requires a path");
      output = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argv[index] === "--stdout") {
      output = null;
    } else {
      throw new Error(`unknown argument ${argv[index]}`);
    }
  }
  return { output };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const artifact = buildSustainableIndexRanges();
  if (args.output) writeJsonAtomic(args.output, artifact);
  else process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
}
