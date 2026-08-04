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
    center_diagnostic: row.center.nine_cell_mean,
    point_estimate: null,
    upside_range: {
      low: row.price_context.low_upside,
      high: row.price_context.high_upside,
    },
  };
}

function baseRow(row, payoutEvidence) {
  const exactCore = ["SPX", "NDX"].includes(row.id);
  const quality = exactCore ? "medium" : "low";
  return {
    id: row.id,
    status: exactCore ? "automatic_narrow_house_diagnostic" : "automatic_narrow_proxy_diagnostic",
    confidence: quality,
    production_promoted: false,
    value: valueSummary(row),
    automatic_inputs: row.runtime_inputs,
    transformed_inputs: row.transformed_inputs,
    payout_basis: {
      role: "measured trailing policy band",
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

function extendedRow(row) {
  return {
    id: row.id,
    status: "automatic_narrow_proxy_diagnostic",
    confidence: "low",
    production_promoted: false,
    value: valueSummary(row),
    automatic_inputs: row.runtime_inputs,
    transformed_inputs: row.transformed_inputs,
    source_quality: "exact Nasdaq Composite benchmark fundamentals combined with ONEQ payout proxy; exact Composite dividend weights are unavailable",
    proxy_inputs: row.proxy_inputs,
    promotion_blockers: row.identity_blockers,
    method: {
      lt_roe: row.lt_roe_transform.equation,
      residual_value: YOO_LOGIC_INFERRED_RULE.structure_components.terminal,
      horizon: YOO_LOGIC_INFERRED_RULE.structure_components.horizon,
    },
    runtime_yoo_value_injection: false,
  };
}

function russellRow(row) {
  return {
    id: "RUT",
    status: "automatic_narrow_official_input_diagnostic",
    confidence: "low",
    production_promoted: false,
    value: valueSummary(row),
    automatic_inputs: row.runtime_inputs,
    transformed_inputs: row.transformed_inputs,
    source_quality: "official recurring LSEG Russell 2000 fundamentals; current price is newer than the quarterly fundamentals snapshot",
    official_fundamentals: row.official_fundamentals,
    fundamentals_age_days_at_price: row.fundamentals_age_days_at_price,
    promotion_blockers: row.identity_blockers,
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
    ...core.rows.map((row) => baseRow(row, payoutEvidence)),
    extendedRow(extended.rows.find((row) => row.id === "CCMP")),
    russellRow(russell),
  ];
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
    status: "automatic_research_diagnostics_ready_no_promotable_fair_value_rule",
    scope: ["SPX", "NDX", "KOSPI", "SOX", "CCMP", "RUT"],
    runtime_contract: {
      automatic_diagnostic_fallback_inputs_refreshable: true,
      exact_official_input_refresh_complete: false,
      future_yoo_values_required: false,
      runtime_yoo_value_injection: false,
      runtime_target_level_injection: false,
      frozen_historical_yoo_calibration_parameters_used: true,
      output_type: "range_only",
      point_estimate: false,
    },
    official_input_producers: {
      RUT: "ready recurring official LSEG quarterly snapshot with immutable archive",
      KOSPI: "producer and parser ready; live official screen refresh blocked pending an authorized KRX Data Marketplace session",
      SPX_NDX: "automatic benchmark and constituent paths ready",
      CCMP_SOX: "exact payout or official-weight routes unavailable; diagnostics use explicit proxies only",
    },
    methodology: {
      structure_components_with_mixed_evidence_status: YOO_LOGIC_INFERRED_RULE.structure_components,
      narrow_house_diagnostic_rule: {
        ...YOO_LOGIC_SHARED_INFERRED_RULE,
        promotion_status: "rejected_as_index_point_or_narrow_range_without_index_holdout",
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
      unresolved_for_production: {
        erp: calibration.erp.blocking_reasons,
        lt_roe: calibration.lt_roe.blocking_reasons,
        discount_horizon: calibration.discount_horizon.blocking_reasons,
      },
    },
    interpretation: "Narrow rows are reproducible diagnostics, not promotable fair values. coverage_safe_rows remove unsupported point precision and are fair-value sensitivities only, not claims of Yoo's current values.",
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
