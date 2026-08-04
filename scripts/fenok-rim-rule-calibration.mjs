#!/usr/bin/env node

// Isolated research harness. Historical Yoo observations may select a rule,
// but predictions after the cutoff use only the public/automatic operands on
// each row. Nothing in this file is imported by the production RIM builders.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const RULE_FAMILIES = Object.freeze({
  ltRoe: Object.freeze([
    Object.freeze({ id: "ltroe-fy1", source: "forward_roe_fy1", scale: 1 }),
    Object.freeze({ id: "ltroe-fy3", source: "forward_roe_fy3", scale: 1 }),
    Object.freeze({ id: "ltroe-fy3-x075", source: "forward_roe_fy3", scale: 0.75 }),
    Object.freeze({ id: "ltroe-fy3-x080", source: "forward_roe_fy3", scale: 0.80 }),
    Object.freeze({ id: "ltroe-median3", source: "forward_roe_median3", scale: 1 }),
  ]),
  erp: Object.freeze([
    Object.freeze({ id: "erp-public-base", offset: "none" }),
    Object.freeze({ id: "erp-public-base-global-50bp", offset: "global_lattice", lattice: 0.005 }),
    Object.freeze({ id: "erp-public-base-group-50bp", offset: "group_lattice", lattice: 0.005, minimumFitPerGroup: 2 }),
  ]),
  discount: Object.freeze([
    ...[8, 9, 10].flatMap((horizon) => [
      Object.freeze({ id: `discount-ke-n${horizon}`, discount: "cost_of_equity", horizon }),
      Object.freeze({ id: `discount-affine-rf-n${horizon}`, discount: "affine_risk_free", horizon }),
    ]),
  ]),
});

function finite(value) {
  return Number.isFinite(value);
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function instant(date, label) {
  const value = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(value)) throw new Error(`${label}: invalid ISO date ${date}`);
  return value;
}

export function latticeRound(value, step = 0.005) {
  if (!finite(value) || !finite(step) || step <= 0) throw new Error("finite value and positive lattice step required");
  return Math.round(value / step) * step;
}

function score(rows, predict) {
  const errors = [];
  for (const row of rows) {
    const prediction = predict(row);
    if (!finite(prediction)) return { valid: false, reason: `unscoreable:${row.id}` };
    errors.push(prediction - row.target);
  }
  return {
    valid: true,
    count: rows.length,
    mae: mean(errors.map(Math.abs)),
    rmse: Math.sqrt(mean(errors.map((value) => value ** 2))),
    maxAbs: Math.max(...errors.map(Math.abs)),
    errors,
  };
}

// Candidate parameters are fitted once using rows at/before cutoff. The
// selected candidate and its frozen parameters are then evaluated unchanged.
export function chronologicalCompetition({
  rows,
  cutoff,
  candidates,
  fitCandidate,
  minimumFit = 2,
  minimumHoldout = 1,
  holdoutMaeLimit = 0.005,
}) {
  const cutoffMs = instant(cutoff, "cutoff");
  const ordered = [...rows].sort((a, b) => instant(a.date, a.id) - instant(b.date, b.id) || a.id.localeCompare(b.id));
  const fitRows = ordered.filter((row) => instant(row.date, row.id) <= cutoffMs);
  const holdoutRows = ordered.filter((row) => instant(row.date, row.id) > cutoffMs);
  const accepted = [];
  const rejected = [];

  for (const definition of candidates) {
    const frozen = fitCandidate(definition, fitRows);
    if (!frozen?.valid) {
      rejected.push({ id: definition.id, reason: frozen?.reason ?? "fit_failed" });
      continue;
    }
    const fit = score(fitRows, frozen.predict);
    if (!fit.valid) {
      rejected.push({ id: definition.id, reason: fit.reason });
      continue;
    }
    accepted.push({ definition, frozen, fit });
  }

  accepted.sort((a, b) => a.fit.mae - b.fit.mae || a.definition.id.localeCompare(b.definition.id));
  const selected = accepted[0] ?? null;
  const blocking = [];
  if (fitRows.length < minimumFit) blocking.push("insufficient_chronological_fit");
  if (holdoutRows.length < minimumHoldout) blocking.push("insufficient_chronological_holdout");
  if (!selected) blocking.push("no_fit_candidate");
  const holdout = selected && holdoutRows.length
    ? score(holdoutRows, selected.frozen.predict)
    : null;
  if (holdout && (!holdout.valid || holdout.mae > holdoutMaeLimit)) blocking.push("sealed_holdout_failed");

  return {
    cutoff,
    fit_ids: fitRows.map((row) => row.id),
    holdout_ids: holdoutRows.map((row) => row.id),
    selected_candidate: selected ? {
      id: selected.definition.id,
      parameters: selected.frozen.parameters,
      fit: selected.fit,
    } : null,
    holdout,
    holdout_mae_limit: holdoutMaeLimit,
    status: blocking.length ? "blocked" : "passed",
    blocking_reasons: [...new Set(blocking)],
    rejected_candidates: rejected,
  };
}

function fitErpCandidate(definition, rows) {
  if (!rows.length) return { valid: false, reason: "no_fit_rows" };
  if (definition.offset === "none") {
    return { valid: true, parameters: { offset: 0 }, predict: (row) => row.publicBase };
  }
  if (definition.offset === "global_lattice") {
    const offset = latticeRound(mean(rows.map((row) => row.target - row.publicBase)), definition.lattice);
    return { valid: true, parameters: { offset }, predict: (row) => row.publicBase + offset };
  }
  if (definition.offset === "group_lattice") {
    const groups = new Map();
    for (const row of rows) groups.set(row.group, [...(groups.get(row.group) ?? []), row]);
    if ([...groups.values()].some((groupRows) => groupRows.length < definition.minimumFitPerGroup)) {
      return { valid: false, reason: "insufficient_fit_per_group" };
    }
    const offsets = Object.fromEntries([...groups].map(([group, groupRows]) => [
      group,
      latticeRound(mean(groupRows.map((row) => row.target - row.publicBase)), definition.lattice),
    ]));
    return {
      valid: true,
      parameters: { offsets },
      predict: (row) => finite(offsets[row.group]) ? row.publicBase + offsets[row.group] : null,
    };
  }
  return { valid: false, reason: "unknown_erp_candidate" };
}

function earningsYield(pe) {
  return 1 / pe;
}

// The only pre-cutoff public-base observation in the archive is the separate
// 2025 S&P 12-month P/E slide. The five later rows are same-sheet captures.
// This deliberately weak fit is retained to show that a coincidental S&P match
// does not become a universal rule after the later sheets are opened.
export const ARCHIVED_ERP_ROWS = Object.freeze([
  Object.freeze({ id: "2025-spx", date: "2025-12-09", group: "us_broad", publicBase: earningsYield(22.4), target: 0.045, provenance: "adjacent presentation slide; not same-image" }),
  Object.freeze({ id: "2026-spx", date: "2026-08-03", group: "us_broad", publicBase: earningsYield(21.26), target: 0.050, provenance: "same-image first forward P/E" }),
  Object.freeze({ id: "2026-ccmp", date: "2026-08-03", group: "us_tech", publicBase: earningsYield(27.61), target: 0.055, provenance: "same-image first forward P/E" }),
  Object.freeze({ id: "2026-ndx", date: "2026-08-03", group: "us_tech", publicBase: earningsYield(25.07), target: 0.055, provenance: "same-image first forward P/E" }),
  Object.freeze({ id: "2026-kospi", date: "2026-08-03", group: "kr", publicBase: earningsYield(6.94), target: 0.120, provenance: "same-image first forward P/E" }),
  Object.freeze({ id: "2026-kosdaq", date: "2026-08-03", group: "kr", publicBase: earningsYield(21.49), target: 0.050, provenance: "same-image first forward P/E" }),
]);

export function runArchivedRuleCalibration() {
  const erp = chronologicalCompetition({
    rows: ARCHIVED_ERP_ROWS,
    cutoff: "2025-12-31",
    candidates: RULE_FAMILIES.erp,
    fitCandidate: fitErpCandidate,
    minimumFit: 1,
    minimumHoldout: 3,
    holdoutMaeLimit: 0.005,
  });

  // Archived LT-ROE rows do not contain an independent pre-cutoff automatic
  // forecast path and a later Yoo LT-ROE target. The 2026 stock sheets expose
  // two simultaneous scenario axes, not a later single target. Likewise, the
  // Historical feed book plus later printed payout anchors now select N=9 and
  // support a zero-growth residual-value tail conditionally. The affine
  // risk-free discount relation still has only two distinct rate observations.
  const ltRoe = {
    status: "blocked",
    selected_candidate: null,
    candidate_ids: RULE_FAMILIES.ltRoe.map((row) => row.id),
    blocking_reasons: [
      "no_independent_pre_cutoff_automatic_roe_path",
      "no_later_single_ltroe_target",
      "stock_worst_and_likely_axes_are_simultaneous_scenarios",
    ],
  };
  const discount = {
    status: "partially_identified_not_promotable",
    selected_candidate: {
      horizon: 9,
      terminal: "RI_N / discount; Gordon g=0",
      evidence_status: "historical_cross_vintage_conditional_validation",
    },
    candidate_ids: RULE_FAMILIES.discount.map((row) => row.id),
    blocking_reasons: [
      "affine_discount_has_only_two_risk_free_points",
      "very_slow_fade_not_distinguishable_from_perpetuity",
      "no_independent_later_grid_holdout_for_discount_slope",
    ],
  };

  return {
    schema_version: "fenok_rim_rule_calibration.v1",
    production_integrated: false,
    rule: "select_on_fit_once_then_score_sealed_holdout_without_refit",
    erp,
    lt_roe: ltRoe,
    discount_horizon: discount,
    verdict: "no_promotable_rule",
  };
}

export const INFERRED_FENO_RULE = Object.freeze({
  classification: "GENERIC_KE_TERMINAL_INFERRED_RANGE_NOT_YOO_LOGIC",
  explicit_years: 3,
  discount: "Ke = observed risk-free + public Damodaran ERP",
  book_roll_forward: "B_t = B_(t-1) + E_t * (1 - trailing four-year mean payout)",
  residual_income: "RI_t = E_t - Ke * B_(t-1)",
  terminal_roe: "rolling 260-week median ROE ending at the current input vintage",
  terminal_growth_band: Object.freeze([0]),
  terminal_payout: "1 - g / terminal_ROE",
  terminal_value: "((terminal_ROE - Ke) * B_3 * (1 + g)) / (Ke - g)",
  safeguards: Object.freeze([
    "Ke must exceed terminal growth",
    "implied terminal payout must be between zero and one",
    "range endpoints only; never promote midpoint to a point estimate",
  ]),
});

export const YOO_LOGIC_INFERRED_RULE = Object.freeze({
  classification: "SINGLE_OBSERVATION_BRIDGE_DIAGNOSTIC",
  runtime_yoo_value_injection: false,
  structure_components: Object.freeze({
    lt_roe: Object.freeze({ equation: "one flat singular LTROE for the full horizon", evidence_status: "observed_structure" }),
    residual_income: Object.freeze({ equation: "RI_t = (LTROE - (Rf + ERP)) * B_(t-1)", evidence_status: "structural_transfer" }),
    book_roll_forward: Object.freeze({ equation: "B_t = B_(t-1) * (1 + LTROE * retention)", evidence_status: "same_sheet_confirmed" }),
    discount: Object.freeze({ equation: "d(Rf) = 0.076 + 0.560 * Rf, separate from cost of equity", evidence_status: "locally_fitted" }),
    terminal: Object.freeze({ equation: "RI_N / d(Rf), discounted from N; Gordon g=0", evidence_status: "historically_supported_conditional_candidate" }),
    horizon: Object.freeze({ equation: "N=9", evidence_status: "selected_by_two_index_cross_vintage_payout_validation" }),
  }),
  inferred_transformations: Object.freeze({
    index_ltroe_bridge_assumed_relative_uncertainty: Object.freeze({
      value: 0.05,
      basis: "assumed sensitivity around each single-observation bridge; not estimated from a sample distribution",
    }),
    index_ltroe_bridges: Object.freeze({
      SPX: Object.freeze({ multiplier: 1.05165481, derivation: "2026-08-03 Yoo FY3 28.56% / same-vintage FENO FY3 27.1572%", observations: 1, effective_from: "2026-08-03", proxy: false }),
      NDX: Object.freeze({ multiplier: 0.86572702, derivation: "2026-08-03 Yoo FY3 32.99% / same-vintage FENO FY3 38.1067%", observations: 1, effective_from: "2026-08-03", proxy: false }),
      KOSPI: Object.freeze({ multiplier: 0.85850133, derivation: "2026-08-03 Yoo FY3 24.52% / same-vintage FENO FY3 28.5614%", observations: 1, effective_from: "2026-08-03", proxy: false }),
      SOX: Object.freeze({ multiplier: 0.86572702, derivation: "inherits frozen NDX technology-index bridge; no same-sheet SOX FY3 bridge", observations: 1, effective_from: "2026-08-03", proxy: true, identity_blockers: Object.freeze(["SOXX_not_PHLX"]) }),
    }),
    // Stock-only level multiplier LTROE/FY3. This is not the shared
    // FY3-minus-normal gap-persistence weight defined below.
    stock_ltroe_multiplier_band: Object.freeze([0.735, 0.82]),
    horizon_sweep: Object.freeze([9]),
    center_horizon: 9,
    local_grid_step: 0.005,
    payout: "automatic trailing four-year mean payout",
    book: "automatic current price / PBR",
    risk_free: "automatic observed sovereign 10Y",
    erp: "automatic Damodaran public base plus frozen asset-class offset/range",
  }),
  erp_rules: Object.freeze({
    SPX: Object.freeze({ offset_center: 0, half_width: 0.005 }),
    NDX: Object.freeze({ offset_center: 0.005, half_width: 0.005 }),
    CCMP: Object.freeze({
      offset_center: 0.005,
      half_width: 0.005,
      observations: 1,
      effective_from: "2026-08-03",
      evidence_status: "single_observation_asset_class_offset",
    }),
    RUT: Object.freeze({
      offset_center: 0,
      half_width: 0.005,
      observations: 0,
      effective_from: "2026-04-01",
      evidence_status: "FENO_public_ERP_base_no_Yoo_offset",
    }),
    SOX: Object.freeze({ offset_center: 0.005, half_width: 0.005 }),
    KOSPI: Object.freeze({
      calibration_public_base: 0.0549077,
      surcharge_range: Object.freeze([0.0100923, 0.0375923, 0.0650923]),
      provenance: "surcharges frozen from 2026-08-03 broad-regime total ERP band relative to same-vintage Damodaran Korea ERP; runtime total moves with current public ERP",
      wide_regime_range: true,
    }),
  }),
});

const SHARED_GAP_PERSISTENCE_OBSERVATIONS = Object.freeze([
  Object.freeze({ id: "SAMSUNG-worst", normal_roe: 0.1085, fy3_roe: 0.4162, lt_roe: 0.303 }),
  Object.freeze({ id: "SAMSUNG-likely", normal_roe: 0.1085, fy3_roe: 0.4162, lt_roe: 0.341 }),
  Object.freeze({ id: "HYNIX-worst", normal_roe: 0.1684, fy3_roe: 0.5246, lt_roe: 0.390 }),
  Object.freeze({ id: "HYNIX-likely", normal_roe: 0.1684, fy3_roe: 0.5246, lt_roe: 0.425 }),
]);

const SHARED_GAP_PERSISTENCE_WEIGHTS = SHARED_GAP_PERSISTENCE_OBSERVATIONS.map(
  (row) => (row.lt_roe - row.normal_roe) / (row.fy3_roe - row.normal_roe),
);

// Unlike stock_ltroe_multiplier_band, these weights apply only to the
// FY3-minus-normal gap. Similar numeric levels do not imply equal meaning.
export const YOO_LOGIC_SHARED_INFERRED_RULE = Object.freeze({
  classification: "YOO_LOGIC_SHARED_PERSISTENCE_INFERRED_RANGE_NOT_POINT",
  reusable_transformation: "form_only",
  equation: "LTROE = own rolling 260-week median ROE + w * (automatic FY3 ROE - own median)",
  persistence_weight: Object.freeze({
    low: Math.min(...SHARED_GAP_PERSISTENCE_WEIGHTS),
    center: mean(SHARED_GAP_PERSISTENCE_WEIGHTS),
    high: Math.max(...SHARED_GAP_PERSISTENCE_WEIGHTS),
    evidence_status: "inferred_transfer",
    observations: SHARED_GAP_PERSISTENCE_OBSERVATIONS.length,
    calibration_observations: SHARED_GAP_PERSISTENCE_OBSERVATIONS,
    normal_roe_basis: "median of five FENO actual annual ROE observations at the calibration vintage",
    source_paths: Object.freeze([
      "scripts/fixtures/fenok-rim-2026-08-03-stock-grids.json",
      "data/global-scouter/stocks/detail/005930.KS.json",
      "data/global-scouter/stocks/detail/000660.KS.json",
    ]),
    derivation: "gap weights recomputed as (source LTROE - FENO five-actual-year median ROE) / (source FY3 ROE - FENO median ROE) from four 2026-08-03 stock scenarios; transferred to indices as one shared form without index validation",
  }),
  runtime_yoo_value_injection: false,
});

function yooLogicCell({ book, ltRoe, payout, riskFree, erp, horizon }) {
  const discount = 0.076 + 0.560 * riskFree;
  const costOfEquity = riskFree + erp;
  let rollingBook = book;
  let value = book;
  let residual = 0;
  for (let year = 1; year <= horizon; year += 1) {
    residual = (ltRoe - costOfEquity) * rollingBook;
    value += residual / (1 + discount) ** year;
    rollingBook *= 1 + ltRoe * (1 - payout);
  }
  value += (residual / discount) / (1 + discount) ** horizon;
  return value;
}

function minimiseBoundedUnitInterval(objective) {
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const first = low + (high - low) / 3;
    const second = high - (high - low) / 3;
    if (objective(first) < objective(second)) high = second;
    else low = first;
  }
  return (low + high) / 2;
}

export function fitConditionalGridPayout({ book, cells, rateScenarios, horizon = 9 }) {
  if (!finite(book) || book <= 0 || !Array.isArray(cells) || !cells.length || !rateScenarios) {
    return { status: "blocked", reason: "unit_coherent_book_cells_and_rates_required" };
  }
  const objective = (payout) => cells.reduce((sum, cell) => {
    const riskFree = rateScenarios[cell.scenario];
    if (![cell.lt_roe, cell.risk_premium, cell.fair_value, riskFree].every(finite)) return Number.POSITIVE_INFINITY;
    const error = yooLogicCell({
      book,
      ltRoe: cell.lt_roe,
      payout,
      riskFree,
      erp: cell.risk_premium,
      horizon,
    }) - cell.fair_value;
    return sum + error ** 2;
  }, 0);
  const payout = minimiseBoundedUnitInterval(objective);
  const errors = cells.map((cell) => yooLogicCell({
    book,
    ltRoe: cell.lt_roe,
    payout,
    riskFree: rateScenarios[cell.scenario],
    erp: cell.risk_premium,
    horizon,
  }) - cell.fair_value);
  const observedScale = mean(cells.map((cell) => Math.abs(cell.fair_value)));
  return {
    status: "conditional_anchor_fit",
    payout,
    cells: cells.length,
    value_error: {
      mae: mean(errors.map(Math.abs)),
      rmse: Math.sqrt(mean(errors.map((error) => error ** 2))),
      max_abs: Math.max(...errors.map(Math.abs)),
      rmse_pct_of_mean_fair_value: Math.sqrt(mean(errors.map((error) => error ** 2))) / observedScale,
      max_abs_pct_of_mean_fair_value: Math.max(...errors.map(Math.abs)) / observedScale,
    },
  };
}

export function buildHistoricalConditionalPayoutDiagnostic(root = ROOT) {
  const fixture = JSON.parse(fs.readFileSync(path.join(root, "scripts/fixtures/fenok-rim-2025-12-09-grid.json"), "utf8"));
  const fairValues = JSON.parse(fs.readFileSync(path.join(root, "data/computed/fenok-rim/fair-values.json"), "utf8"));
  const keyById = { SPX: "sp500", CCMP: "nasdaq_composite" };
  const rows = Object.entries(keyById).map(([id, key]) => {
    const instrument = fixture.instruments[id];
    const cells = fixture.cells.filter((cell) => cell.instrument === id);
    const scenarioFits = Object.keys(fixture.rate_scenarios).map((scenario) => ({
      scenario,
      ...fitConditionalGridPayout({
        book: instrument.feed_book,
        cells: cells.filter((cell) => cell.scenario === scenario),
        rateScenarios: fixture.rate_scenarios,
      }),
    }));
    const allCells = fitConditionalGridPayout({
      book: instrument.feed_book,
      cells,
      rateScenarios: fixture.rate_scenarios,
    });
    const laterSheetPayout = fairValues.rows.find((row) => row.key === key)?.payout_basis_comparison?.sheet_anchor?.value;
    return {
      id,
      fixture_as_of: "2025-12-09",
      feed_book: instrument.feed_book,
      combined_fit: allCells,
      scenario_fits: scenarioFits,
      scenario_payout_spread_pp: (Math.max(...scenarioFits.map((fit) => fit.payout)) - Math.min(...scenarioFits.map((fit) => fit.payout))) * 100,
      later_printed_sheet: {
        as_of: "2026-08-03",
        payout: laterSheetPayout,
        difference_pp: finite(laterSheetPayout) ? (allCells.payout - laterSheetPayout) * 100 : null,
        production_eligible: false,
      },
    };
  });
  return {
    schema_version: "fenok_rim_conditional_payout_diagnostic.v1",
    classification: "formula_conditionally_identified_not_runtime_stable",
    production_integrated: false,
    runtime_yoo_value_injection: false,
    formula_conditions: "N=9; fixture book/LTROE/ERP/risk-free/fair-value cells fixed; affine discount retained",
    automatic_rule: "same-vintage aggregate cash dividends / aggregate forward earnings, equivalently index dividend yield / same-basis forward earnings yield",
    promotion_blockers: [
      "the inferred payout consumes historical Yoo fair-value cells and cannot be a runtime operand",
      "no contemporaneous exact-index forward payout series exists for the 2025 fixture",
      "book and earnings universes must match, including any negative-earnings exclusion",
      "no later sealed holdout has passed without refitting",
    ],
    rows,
  };
}

export function buildHistoricalHorizonResidualValueDiagnostic(root = ROOT) {
  const fixture = JSON.parse(fs.readFileSync(path.join(root, "scripts/fixtures/fenok-rim-2025-12-09-grid.json"), "utf8"));
  const fairValues = JSON.parse(fs.readFileSync(path.join(root, "data/computed/fenok-rim/fair-values.json"), "utf8"));
  const keyById = { SPX: "sp500", CCMP: "nasdaq_composite" };
  const anchors = Object.entries(keyById).map(([id, key]) => ({
    id,
    book: fixture.instruments[id].feed_book,
    cells: fixture.cells.filter((cell) => cell.instrument === id),
    laterPayout: fairValues.rows.find((row) => row.key === key)?.payout_basis_comparison?.sheet_anchor?.value,
  }));
  const candidates = Array.from({ length: 9 }, (_, index) => index + 6).map((horizon) => {
    const rows = anchors.map((anchor) => {
      const fit = fitConditionalGridPayout({
        book: anchor.book,
        cells: anchor.cells,
        rateScenarios: fixture.rate_scenarios,
        horizon,
      });
      return {
        id: anchor.id,
        inferred_payout: fit.payout,
        later_printed_payout: anchor.laterPayout,
        payout_difference_pp: (fit.payout - anchor.laterPayout) * 100,
        grid_rmse_pct: fit.value_error.rmse_pct_of_mean_fair_value * 100,
      };
    });
    return {
      horizon,
      validation_mae_pp: mean(rows.map((row) => Math.abs(row.payout_difference_pp))),
      rows,
    };
  });
  candidates.sort((first, second) => first.validation_mae_pp - second.validation_mae_pp || first.horizon - second.horizon);
  return {
    schema_version: "fenok_rim_horizon_residual_value_diagnostic.v1",
    classification: "historical_cross_vintage_validation_not_runtime_operand",
    production_integrated: false,
    runtime_yoo_value_injection: false,
    residual_value_form: "RI_N / discount, discounted from N to present; zero terminal growth",
    selected_horizon: candidates[0].horizon,
    selected_validation_mae_pp: candidates[0].validation_mae_pp,
    runner_up_validation_mae_pp: candidates[1].validation_mae_pp,
    caveat: "The later printed payouts are independent historical validation anchors, not runtime values; two indices and one later vintage do not identify every terminal-value alternative.",
    candidates,
  };
}

function resolveYooLogicErp(id, publicErp) {
  const erpRule = YOO_LOGIC_INFERRED_RULE.erp_rules[id];
  if (!erpRule) return null;
  return erpRule.surcharge_range
    ? {
      low: publicErp + erpRule.surcharge_range[0],
      center: publicErp + erpRule.surcharge_range[1],
      high: publicErp + erpRule.surcharge_range[2],
      public_base: publicErp,
      surcharge: {
        low: erpRule.surcharge_range[0],
        center: erpRule.surcharge_range[1],
        high: erpRule.surcharge_range[2],
      },
      surcharge_provenance: erpRule.provenance,
    }
    : {
      low: publicErp + erpRule.offset_center - erpRule.half_width,
      center: publicErp + erpRule.offset_center,
      high: publicErp + erpRule.offset_center + erpRule.half_width,
    };
}

function normalizeBand(value, label) {
  const band = finite(value)
    ? { low: value, center: value, high: value }
    : value;
  if (![band?.low, band?.center, band?.high].every(finite) || band.low > band.center || band.center > band.high) {
    throw new Error(`${label}: ordered finite low/center/high required`);
  }
  return band;
}

function computeYooLogicResolvedRange({ id, price, book, fy3Roe, payout, riskFree, publicErp, ltRoe, classification, ltRoeTransform, identityBlockers = [] }) {
  const erpRule = YOO_LOGIC_INFERRED_RULE.erp_rules[id];
  const erp = resolveYooLogicErp(id, publicErp);
  if (!erpRule || !erp) return { id, status: "blocked", reason: "missing_frozen_asset_class_erp_rule" };
  const payoutBand = normalizeBand(payout, "payout");
  const localStep = YOO_LOGIC_INFERRED_RULE.inferred_transformations.local_grid_step;
  const localGrid = [];
  for (const roeShift of [-localStep, 0, localStep]) {
    for (const erpShift of [-localStep, 0, localStep]) {
      localGrid.push(yooLogicCell({
        book,
        ltRoe: ltRoe.center + roeShift,
        payout: payoutBand.center,
        riskFree,
        erp: erp.center + erpShift,
        horizon: YOO_LOGIC_INFERRED_RULE.inferred_transformations.center_horizon,
      }));
    }
  }
  const sweep = [];
  for (const horizon of YOO_LOGIC_INFERRED_RULE.inferred_transformations.horizon_sweep) {
    for (const roe of [ltRoe.low, ltRoe.center, ltRoe.high]) {
      for (const premium of [erp.low, erp.center, erp.high]) {
        for (const payoutValue of [...new Set([payoutBand.low, payoutBand.center, payoutBand.high])]) {
          sweep.push({
            horizon,
            lt_roe: roe,
            erp: premium,
            payout: payoutValue,
            value: yooLogicCell({ book, ltRoe: roe, payout: payoutValue, riskFree, erp: premium, horizon }),
          });
        }
      }
    }
  }
  const values = sweep.map((row) => row.value);
  const nineCellMean = mean(localGrid);
  return {
    id,
    status: "yoo_logic_inferred_range_only",
    classification,
    wide_range: Boolean(erpRule.wide_regime_range),
    lt_roe_transform: ltRoeTransform,
    lt_roe_proxy: Boolean(ltRoeTransform?.bridge?.proxy),
    identity_blockers: identityBlockers,
    runtime_inputs: {
      price,
      book,
      fy3_roe: fy3Roe,
      payout: payoutBand.low === payoutBand.high ? payoutBand.center : payoutBand,
      risk_free: riskFree,
      public_erp: publicErp,
    },
    transformed_inputs: { lt_roe: ltRoe, erp, discount: 0.076 + 0.560 * riskFree },
    center: {
      horizon: 9,
      nine_cell_mean: nineCellMean,
      center_cell: yooLogicCell({ book, ltRoe: ltRoe.center, payout: payoutBand.center, riskFree, erp: erp.center, horizon: 9 }),
    },
    sweep: { cells: sweep.length, range: { low: Math.min(...values), high: Math.max(...values) } },
    price_context: { center_upside: nineCellMean / price - 1, low_upside: Math.min(...values) / price - 1, high_upside: Math.max(...values) / price - 1 },
  };
}

export function computeYooLogicInferredRange({ id, price, book, fy3Roe, payout, riskFree, publicErp, instrumentType = "index" }) {
  if (![price, book, fy3Roe, payout, riskFree, publicErp].every(finite)) {
    return { id, status: "blocked", reason: "non_finite_operand" };
  }
  const bridge = instrumentType === "stock" ? null : YOO_LOGIC_INFERRED_RULE.inferred_transformations.index_ltroe_bridges[id];
  if (instrumentType !== "stock" && !bridge) return { id, status: "blocked", reason: "missing_frozen_ltroe_bridge" };
  const assumed = YOO_LOGIC_INFERRED_RULE.inferred_transformations.index_ltroe_bridge_assumed_relative_uncertainty;
  const multiplierCenter = instrumentType === "stock"
    ? mean(YOO_LOGIC_INFERRED_RULE.inferred_transformations.stock_ltroe_multiplier_band)
    : bridge.multiplier;
  const multiplierBand = instrumentType === "stock"
    ? YOO_LOGIC_INFERRED_RULE.inferred_transformations.stock_ltroe_multiplier_band
    : [multiplierCenter * (1 - assumed.value), multiplierCenter * (1 + assumed.value)];
  return computeYooLogicResolvedRange({
    id, price, book, fy3Roe, payout, riskFree, publicErp,
    ltRoe: { low: fy3Roe * multiplierBand[0], center: fy3Roe * multiplierCenter, high: fy3Roe * multiplierBand[1] },
    classification: YOO_LOGIC_INFERRED_RULE.classification,
    ltRoeTransform: instrumentType === "stock"
      ? { kind: "stock_scenario_band", reusable: false }
      : { kind: "single_observation_bridge", reusable: false, bridge, assumed_relative_uncertainty: assumed },
    identityBlockers: bridge?.identity_blockers ?? [],
  });
}

export function computeYooLogicSharedInferredRange({
  id,
  price,
  book,
  fy3Roe,
  normalRoe,
  payout,
  riskFree,
  publicErp,
  classification = YOO_LOGIC_SHARED_INFERRED_RULE.classification,
  identityBlockers,
}) {
  const fy3Band = normalizeBand(fy3Roe, "fy3Roe");
  const payoutBand = normalizeBand(payout, "payout");
  if (![price, book, normalRoe, riskFree, publicErp].every(finite)) {
    return { id, status: "blocked", reason: "non_finite_operand" };
  }
  const weight = YOO_LOGIC_SHARED_INFERRED_RULE.persistence_weight;
  const transform = (w, forecast) => normalRoe + w * (forecast - normalRoe);
  const endpoints = [weight.low, weight.high].flatMap((w) => [fy3Band.low, fy3Band.high].map((forecast) => transform(w, forecast)));
  return computeYooLogicResolvedRange({
    id, price, book, fy3Roe: fy3Band, payout: payoutBand, riskFree, publicErp,
    ltRoe: { low: Math.min(...endpoints), center: transform(weight.center, fy3Band.center), high: Math.max(...endpoints) },
    classification,
    ltRoeTransform: { ...YOO_LOGIC_SHARED_INFERRED_RULE, normal_roe: normalRoe, fy3_roe_band: fy3Band },
    identityBlockers: identityBlockers ?? (id === "SOX" ? ["SOXX_not_PHLX"] : []),
  });
}

export function computeYooLogicLtroeCoverageSensitivity({
  id,
  price,
  book,
  roePath,
  normalRoe,
  payout,
  riskFree,
  publicErp,
  margin = 0.035,
}) {
  if (![price, book, normalRoe, riskFree, publicErp, margin, ...roePath].every(finite)
    || !roePath.length || margin < 0) {
    return { id, status: "blocked", reason: "finite_normal_and_roe_path_required" };
  }
  const payoutBand = normalizeBand(payout, "payout");
  const erp = resolveYooLogicErp(id, publicErp);
  if (!erp) return { id, status: "blocked", reason: "missing_frozen_asset_class_erp_rule" };
  const ltRoe = {
    low: Math.min(normalRoe, ...roePath) - margin,
    high: Math.max(normalRoe, ...roePath) + margin,
    center: null,
  };
  const cells = [];
  for (const roe of [ltRoe.low, ltRoe.high]) {
    for (const premium of [erp.low, erp.high]) {
      for (const payoutValue of [...new Set([payoutBand.low, payoutBand.high])]) {
        cells.push({
          lt_roe: roe,
          erp: premium,
          payout: payoutValue,
          value: yooLogicCell({ book, ltRoe: roe, payout: payoutValue, riskFree, erp: premium, horizon: 9 }),
        });
      }
    }
  }
  const values = cells.map((cell) => cell.value);
  const range = { low: Math.min(...values), high: Math.max(...values) };
  return {
    id,
    status: "ltroe_coverage_band_fair_value_sensitivity_only",
    classification: "FENO_HOUSE_CALIBRATED_COVERAGE_BAND_NOT_POINT",
    production_integrated: false,
    point_estimate: null,
    rule: {
      equation: "LTROE = hull(normal ROE, automatic FY1-FY3 ROE path) +/- 3.5 percentage points",
      margin,
      evidence_status: "coverage_calibration_not_sealed_validation",
      center: "none",
    },
    runtime_inputs: { price, book, normal_roe: normalRoe, roe_path: roePath, payout: payoutBand, risk_free: riskFree, public_erp: publicErp },
    transformed_inputs: { lt_roe: ltRoe, erp, discount: 0.076 + 0.560 * riskFree },
    sweep: { cells: cells.length, range },
    price_context: { low_upside: range.low / price - 1, high_upside: range.high / price - 1 },
    runtime_yoo_value_injection: false,
  };
}

export function computeFenoIndexForecastPathRange({
  id,
  price,
  book,
  roePath,
  payout,
  riskFree,
  publicErp,
  identityBlockers = [],
}) {
  if (![price, book, riskFree, publicErp, ...roePath].every(finite) || roePath.length !== 3) {
    return { id, status: "blocked", reason: "three_year_automatic_roe_path_required" };
  }
  const ltRoe = { low: Math.min(...roePath), center: roePath.at(-1), high: Math.max(...roePath) };
  return computeYooLogicResolvedRange({
    id,
    price,
    book,
    fy3Roe: ltRoe,
    payout,
    riskFree,
    publicErp,
    ltRoe,
    classification: "FENO_INDEX_AUTOMATIC_FORECAST_PATH_RESEARCH_RANGE",
    ltRoeTransform: {
      kind: "automatic_index_roe_path_band",
      equation: "LTROE center = automatic FY3 ROE; range spans the automatic FY1-FY3 ROE path",
      evidence_status: "FENO_house_inference_not_Yoo_identified",
      runtime_yoo_value_injection: false,
    },
    identityBlockers,
  });
}

export function deriveFy3RoeProxy({
  price,
  priceToBook,
  forwardPe,
  payout,
  annualEpsGrowth,
  earningsBasis = "forward_fy1",
}) {
  if (![price, priceToBook, forwardPe, payout, annualEpsGrowth].every(finite)
    || priceToBook <= 0 || forwardPe <= 0 || payout < 0 || payout > 1 || annualEpsGrowth <= -1) {
    return { status: "blocked", reason: "invalid_fundamental_operand" };
  }
  let book = price / priceToBook;
  let earnings = price / forwardPe;
  const path = [];
  for (let year = 1; year <= 3; year += 1) {
    if (year > 1 || earningsBasis === "current_trailing") earnings *= 1 + annualEpsGrowth;
    path.push({ year, earnings, book_beginning: book, roe: earnings / book });
    book += earnings * (1 - payout);
  }
  return {
    status: "ready_proxy",
    formula: earningsBasis === "current_trailing"
      ? "current earnings anchor; FY1/FY2/FY3 grow at the supplied earnings CAGR; book rolls with payout"
      : "FY1 forward EPS anchor; FY2/FY3 grow at exact-index trailing forward-EPS CAGR; book rolls with proxy payout",
    earnings_basis: earningsBasis,
    annual_eps_growth: annualEpsGrowth,
    payout,
    path,
    fy3_roe: path.at(-1).roe,
  };
}

export function computeInferredFenoRange({ id, price, book, earnings, payout, riskFree, publicErp, normalRoe }) {
  if (![price, book, payout, riskFree, publicErp, normalRoe, ...earnings].every(finite)) {
    return { id, status: "blocked", reason: "non_finite_operand" };
  }
  if (earnings.length !== INFERRED_FENO_RULE.explicit_years || payout < 0 || payout > 1) {
    return { id, status: "blocked", reason: "invalid_path_or_payout" };
  }
  const ke = riskFree + publicErp;
  let rollingBook = book;
  const residualIncome = [];
  const bookPath = [book];
  for (const value of earnings) {
    residualIncome.push(value - ke * rollingBook);
    rollingBook += value * (1 - payout);
    bookPath.push(rollingBook);
  }
  const explicitValue = book + residualIncome.reduce(
    (sum, value, index) => sum + value / (1 + ke) ** (index + 1),
    0,
  );
  const scenarios = INFERRED_FENO_RULE.terminal_growth_band.map((growth) => {
    if (ke <= growth || normalRoe <= 0) return { growth, status: "blocked", reason: "invalid_terminal_rate_order" };
    const terminalPayout = 1 - growth / normalRoe;
    if (terminalPayout < 0 || terminalPayout > 1) return { growth, status: "blocked", reason: "invalid_implied_terminal_payout" };
    const terminalResidual = (normalRoe - ke) * rollingBook * (1 + growth);
    const continuingValueAtFy3 = terminalResidual / (ke - growth);
    const value = explicitValue + continuingValueAtFy3 / (1 + ke) ** earnings.length;
    return { growth, status: "ready", terminal_payout: terminalPayout, continuing_value_at_fy3: continuingValueAtFy3, value };
  });
  if (scenarios.some((row) => row.status !== "ready")) {
    return { id, status: "blocked", ke, book_path: bookPath, residual_income: residualIncome, scenarios };
  }
  const values = scenarios.map((row) => row.value);
  return {
    id,
    status: "inferred_range_only",
    classification: INFERRED_FENO_RULE.classification,
    price,
    ke,
    payout,
    normal_roe: normalRoe,
    book_path: bookPath,
    residual_income: residualIncome,
    scenarios,
    range: { low: Math.min(...values), high: Math.max(...values) },
    price_context: {
      low_upside: Math.min(...values) / price - 1,
      high_upside: Math.max(...values) / price - 1,
    },
  };
}

export function buildCurrentInferredFenoRanges(root = ROOT) {
  const input = JSON.parse(fs.readFileSync(path.join(root, "data/computed/rim-index/inputs.json"), "utf8"));
  const payouts = JSON.parse(fs.readFileSync(path.join(root, "data/computed/fenok-rim/payout-history.json"), "utf8"));
  const configs = {
    SPX: { payoutKey: "sp500", benchmark: ["us.json", "sp500"] },
    NDX: { payoutKey: "nasdaq100", benchmark: ["us.json", "nasdaq100"] },
    KOSPI: { payoutKey: "kospi", benchmark: ["emerging.json", "kospi"] },
    SOX: { payoutKey: "philadelphia_semi", benchmark: ["micro_sectors.json", "philadelphia_semi"] },
  };
  const rows = Object.entries(configs).map(([id, config]) => {
    const source = input.indices[id];
    const periods = source?.derived?.forecast_grid_v1?.periods ?? [];
    const [benchmarkFile, benchmarkKey] = config.benchmark;
    return computeInferredFenoRange({
      id,
      price: source?.observed?.price?.value,
      book: periods[0]?.book_value_beginning?.value,
      earnings: periods.map((row) => row.earnings_proxy?.value),
      payout: payouts?.indices?.[config.payoutKey]?.summary?.mean,
      riskFree: source?.observed?.risk_free_rate?.value,
      publicErp: source?.observed?.equity_risk_premium?.value,
      normalRoe: (() => {
        const payload = JSON.parse(fs.readFileSync(path.join(root, "data", "benchmarks", benchmarkFile), "utf8"));
        const values = payload.sections[benchmarkKey].data.slice(-260).map((row) => row.roe).filter(finite);
        return median(values);
      })(),
    });
  });
  return {
    schema_version: "fenok_rim_inferred_range.v1",
    production_integrated: false,
    rule: INFERRED_FENO_RULE,
    input_generated_at: input.generated_at,
    payout_generated_at: payouts.generated_at,
    rows,
  };
}

export function buildCurrentYooLogicInferredRanges(root = ROOT) {
  const input = JSON.parse(fs.readFileSync(path.join(root, "data/computed/rim-index/inputs.json"), "utf8"));
  const payouts = JSON.parse(fs.readFileSync(path.join(root, "data/computed/fenok-rim/payout-history.json"), "utf8"));
  const payoutKeys = { SPX: "sp500", NDX: "nasdaq100", KOSPI: "kospi", SOX: "philadelphia_semi" };
  const rows = Object.entries(payoutKeys).map(([id, payoutKey]) => {
    const source = input.indices[id];
    const periods = source?.derived?.forecast_grid_v1?.periods ?? [];
    return computeYooLogicInferredRange({
      id,
      price: source?.observed?.price?.value,
      book: periods[0]?.book_value_beginning?.value,
      fy3Roe: periods[2]?.roe_on_beginning_book?.value,
      payout: payouts?.indices?.[payoutKey]?.summary?.mean,
      riskFree: source?.observed?.risk_free_rate?.value,
      publicErp: source?.observed?.equity_risk_premium?.value,
      instrumentType: "index",
    });
  });
  return {
    schema_version: "fenok_rim_yoo_logic_single_observation_bridge_diagnostic.v1",
    production_integrated: false,
    rule: YOO_LOGIC_INFERRED_RULE,
    input_generated_at: input.generated_at,
    payout_generated_at: payouts.generated_at,
    rows,
  };
}

export function buildCurrentYooLogicSharedInferredRanges(root = ROOT) {
  const input = JSON.parse(fs.readFileSync(path.join(root, "data/computed/rim-index/inputs.json"), "utf8"));
  const payouts = JSON.parse(fs.readFileSync(path.join(root, "data/computed/fenok-rim/payout-history.json"), "utf8"));
  const configs = {
    SPX: { payoutKey: "sp500", benchmark: ["us.json", "sp500"] },
    NDX: { payoutKey: "nasdaq100", benchmark: ["us.json", "nasdaq100"] },
    KOSPI: { payoutKey: "kospi", benchmark: ["emerging.json", "kospi"] },
    SOX: { payoutKey: "philadelphia_semi", benchmark: ["micro_sectors.json", "philadelphia_semi"] },
  };
  const rows = Object.entries(configs).map(([id, config]) => {
    const source = input.indices[id];
    const periods = source?.derived?.forecast_grid_v1?.periods ?? [];
    const [benchmarkFile, benchmarkKey] = config.benchmark;
    const benchmark = JSON.parse(fs.readFileSync(path.join(root, "data", "benchmarks", benchmarkFile), "utf8"));
    const normalRoe = median(benchmark.sections[benchmarkKey].data.slice(-260).map((row) => row.roe).filter(finite));
    return computeYooLogicSharedInferredRange({
      id,
      price: source?.observed?.price?.value,
      book: periods[0]?.book_value_beginning?.value,
      fy3Roe: periods[2]?.roe_on_beginning_book?.value,
      normalRoe,
      payout: {
        low: payouts?.indices?.[config.payoutKey]?.summary?.min,
        center: payouts?.indices?.[config.payoutKey]?.summary?.mean,
        high: payouts?.indices?.[config.payoutKey]?.summary?.max,
      },
      riskFree: source?.observed?.risk_free_rate?.value,
      publicErp: source?.observed?.equity_risk_premium?.value,
    });
  });
  return {
    schema_version: "fenok_rim_yoo_logic_shared_persistence_inferred_range.v1",
    production_integrated: false,
    rule: YOO_LOGIC_SHARED_INFERRED_RULE,
    structure_rule: YOO_LOGIC_INFERRED_RULE.structure_components,
    erp_rules: YOO_LOGIC_INFERRED_RULE.erp_rules,
    input_generated_at: input.generated_at,
    payout_generated_at: payouts.generated_at,
    rows,
  };
}

export function buildCurrentIndexForecastPathRanges(root = ROOT) {
  const input = JSON.parse(fs.readFileSync(path.join(root, "data/computed/rim-index/inputs.json"), "utf8"));
  const payouts = JSON.parse(fs.readFileSync(path.join(root, "data/computed/fenok-rim/payout-history.json"), "utf8"));
  const payoutKeys = { SPX: "sp500", NDX: "nasdaq100", KOSPI: "kospi", SOX: "philadelphia_semi" };
  const rows = Object.entries(payoutKeys).map(([id, payoutKey]) => {
    const source = input.indices[id];
    const direct = source?.derived?.payout_ratio;
    const coverage = direct?.coverage ?? {};
    const blockingReasons = [];
    if (!finite(direct?.value) || direct.value <= 0 || direct.value >= 1) blockingReasons.push("invalid_direct_forward_payout");
    if ((coverage.covered_weight_ratio ?? 0) < 0.95) blockingReasons.push("covered_weight_below_95pct");
    if (!coverage.stock_action_source_date || coverage.stock_action_source_date !== coverage.benchmark_as_of) blockingReasons.push("dividend_and_earnings_as_of_mismatch");
    if (id === "SOX" && coverage.official_weight_columns_available === false) blockingReasons.push("official_index_weights_unavailable");
    const yahooQa = source?.derived?.legacy_payout_ratio_qa?.qa;
    const realised = payouts?.indices?.[payoutKey]?.summary?.mean;
    const excludedSensitivityCandidates = [
      ...(finite(yahooQa?.value) && yahooQa.value > 0 && yahooQa.value < 1
        ? [{ id: "constituent_weighted_Yahoo_payout", value: yahooQa.value, exclusion: "aggregate_denominator_mismatch" }]
        : []),
      ...(finite(realised) && realised > 0 && realised < 1
        ? [{ id: "trailing_realised_payout", value: realised, exclusion: "trailing_realised_not_forward_policy" }]
        : []),
    ];
    if (blockingReasons.length) {
      return {
        id,
        status: "blocked",
        reason: "no_denominator_coherent_forward_payout_route",
        blocking_reasons: blockingReasons,
        direct_route_audit: { value: direct?.value ?? null, coverage },
        excluded_sensitivity_candidates: excludedSensitivityCandidates,
      };
    }
    const periods = source?.derived?.forecast_grid_v1?.periods ?? [];
    const row = computeFenoIndexForecastPathRange({
      id,
      price: source?.observed?.price?.value,
      book: periods[0]?.book_value_beginning?.value,
      roePath: periods.map((period) => period.roe_on_beginning_book?.value),
      payout: direct.value,
      riskFree: source?.observed?.risk_free_rate?.value,
      publicErp: source?.observed?.equity_risk_premium?.value,
      identityBlockers: [],
    });
    row.automatic_payout_candidates = [{
      id: "direct_index_yield_over_forward_earnings",
      value: direct.value,
      coverage,
    }];
    row.excluded_sensitivity_candidates = excludedSensitivityCandidates;
    return row;
  });
  return {
    schema_version: "fenok_rim_index_automatic_forecast_path_range.v1",
    production_integrated: false,
    rule_selection_status: "comparison_candidate_not_chronologically_validated",
    rows,
  };
}

export function buildCurrentMethodFamilyUnionRanges(root = ROOT) {
  const persistence = buildCurrentYooLogicSharedInferredRanges(root);
  const forecastPath = buildCurrentIndexForecastPathRanges(root);
  const rows = persistence.rows.map((first) => {
    const second = forecastPath.rows.find((row) => row.id === first.id);
    if (!second || first.status === "blocked" || second.status === "blocked") {
      return {
        id: first.id,
        status: "blocked",
        reason: second?.reason ?? "both_method_families_required",
        identity_blockers: second?.blocking_reasons ?? [],
      };
    }
    const identityBlockers = [...new Set([...first.identity_blockers, ...second.identity_blockers])];
    if (identityBlockers.length) {
      return {
        id: first.id,
        status: "blocked",
        reason: "method_union_requires_two_valid_identity_and_payout_coherent_families",
        identity_blockers: identityBlockers,
      };
    }
    const ordered = [first.sweep.range, second.sweep.range].sort((a, b) => a.low - b.low);
    const intervals = ordered[1].low <= ordered[0].high
      ? [{ low: ordered[0].low, high: Math.max(ordered[0].high, ordered[1].high) }]
      : ordered;
    const price = first.runtime_inputs.price;
    return {
      id: first.id,
      status: "method_family_union_research_only",
      point_estimate: null,
      intervals,
      envelope: intervals.length === 1 ? intervals[0] : null,
      price_context: intervals.map((interval) => ({ low_upside: interval.low / price - 1, high_upside: interval.high / price - 1 })),
      family_ranges: [
        { id: "stock_calibrated_gap_persistence_transfer", range: first.sweep.range, center_diagnostic: first.center.nine_cell_mean },
        { id: "automatic_index_forecast_path", range: second.sweep.range, center_diagnostic: second.center.nine_cell_mean },
      ],
      reason: "available evidence rejects a universal winner; union preserves model-family uncertainty without selecting against Yoo outputs",
      runtime_yoo_value_injection: false,
      identity_blockers: identityBlockers,
    };
  });
  return {
    schema_version: "fenok_rim_method_family_union_range.v1",
    production_integrated: false,
    point_estimates: false,
    rows,
  };
}

function benchmarkGrowthBand(rows) {
  const latest = rows.at(-1);
  const latestMs = instant(latest.date, "benchmark latest");
  const cagr = (years) => {
    const targetMs = latestMs - years * 365.25 * 24 * 60 * 60 * 1000;
    const prior = rows.reduce((best, row) => (
      Math.abs(instant(row.date, "benchmark row") - targetMs) < Math.abs(instant(best.date, "benchmark row") - targetMs)
        ? row
        : best
    ), rows[0]);
    return {
      years,
      from: prior.date,
      to: latest.date,
      value: (latest.best_eps / prior.best_eps) ** (1 / years) - 1,
    };
  };
  const observations = [cagr(3), cagr(5)];
  const values = observations.map((row) => row.value);
  return {
    low: Math.min(...values),
    center: mean(values),
    high: Math.max(...values),
    observations,
  };
}

export function buildCurrentExtendedYooLogicProxyRanges(root = ROOT) {
  const benchmark = JSON.parse(fs.readFileSync(path.join(root, "data/benchmarks/us.json"), "utf8"));
  const input = JSON.parse(fs.readFileSync(path.join(root, "data/computed/rim-index/inputs.json"), "utf8"));
  const etfAction = JSON.parse(fs.readFileSync(path.join(root, "data/computed/etf_action_index.json"), "utf8"));
  const etfs = new Map(etfAction.rows.map((row) => [row.ticker, row]));
  const usRates = input.indices.SPX.observed;
  const configs = {
    CCMP: {
      benchmarkKey: "nasdaq_composite",
      payoutTickers: ["ONEQ"],
      blockers: ["ONEQ_sampling_proxy_for_COMP", "exact_COMP_weights_require_Nasdaq_entitlement"],
    },
    RUT: {
      benchmarkKey: "russell2000",
      payoutTickers: ["IWM", "VTWO"],
      blockers: ["IWM_VTWO_ETF_yield_proxy_for_Russell2000", "deprecated_proxy_path_use_official_factsheet_diagnostic"],
    },
  };
  const rows = Object.entries(configs).map(([id, config]) => {
    const history = benchmark.sections[config.benchmarkKey].data;
    const latest = history.at(-1);
    const normalValues = history.slice(-260).map((row) => row.roe).filter(finite);
    const normalRoe = median(normalValues);
    const growth = benchmarkGrowthBand(history);
    const payoutObservations = config.payoutTickers.map((ticker) => {
      const row = etfs.get(ticker);
      const dividendYield = row?.dividend_yield / 100;
      return {
        ticker,
        dividend_yield: dividendYield,
        payout: dividendYield * latest.best_pe_ratio,
      };
    });
    const payoutValues = payoutObservations.map((row) => row.payout).filter(finite);
    const payout = {
      low: Math.min(...payoutValues),
      center: mean(payoutValues),
      high: Math.max(...payoutValues),
    };
    const fy3Scenarios = [];
    for (const annualEpsGrowth of [growth.low, growth.center, growth.high]) {
      for (const payoutValue of [...new Set([payout.low, payout.center, payout.high])]) {
        fy3Scenarios.push(deriveFy3RoeProxy({
          price: latest.px_last,
          priceToBook: latest.px_to_book_ratio,
          forwardPe: latest.best_pe_ratio,
          payout: payoutValue,
          annualEpsGrowth,
        }));
      }
    }
    const fy3Values = fy3Scenarios.map((row) => row.fy3_roe).filter(finite);
    const centerFy3 = deriveFy3RoeProxy({
      price: latest.px_last,
      priceToBook: latest.px_to_book_ratio,
      forwardPe: latest.best_pe_ratio,
      payout: payout.center,
      annualEpsGrowth: growth.center,
    });
    const row = computeYooLogicSharedInferredRange({
      id,
      price: latest.px_last,
      book: latest.px_last / latest.px_to_book_ratio,
      fy3Roe: { low: Math.min(...fy3Values), center: centerFy3.fy3_roe, high: Math.max(...fy3Values) },
      normalRoe,
      payout,
      riskFree: usRates.risk_free_rate.value,
      publicErp: usRates.equity_risk_premium.value,
      classification: "FENO_AUTO_PROXY_RESEARCH_RANGE",
      identityBlockers: config.blockers,
    });
    row.proxy_inputs = {
      index_fundamentals: {
        identity: config.benchmarkKey,
        as_of: latest.date,
        price: latest.px_last,
        forward_eps: latest.best_eps,
        forward_pe: latest.best_pe_ratio,
        price_to_book: latest.px_to_book_ratio,
      },
      normal_roe: { value: normalRoe, formula: "median of trailing 260 exact-index weekly ROE observations" },
      eps_growth: { ...growth, formula: "range of exact-index forward-EPS 3y and 5y CAGRs; midpoint is diagnostic center" },
      payout: {
        ...payout,
        generated_at: etfAction.generated_at,
        observations: payoutObservations,
        formula: "ETF dividend yield / exact-index forward earnings yield",
      },
      fy3_roe_scenarios: fy3Scenarios,
      generated_from_yoo_runtime_values: false,
    };
    if (id === "RUT") {
      row.status = "suppressed_failed_basis_sanity";
      row.suppression = {
        reason: "proxy denominator produces false precision and a level rejected by the official same-date fundamentals check; the recurring LSEG factsheet producer is now the canonical source path",
        release_gate: "validate the automatic LTROE method on a later Russell holdout with date-aligned official LSEG fundamentals and index price",
      };
    }
    return row;
  });
  return {
    schema_version: "fenok_rim_extended_auto_proxy_range.v1",
    production_integrated: false,
    exact_index_value_status: "blocked",
    rule: YOO_LOGIC_SHARED_INFERRED_RULE,
    rows,
  };
}

export function buildRussellOfficialSnapshotDiagnostic(root = ROOT) {
  const fixture = JSON.parse(fs.readFileSync(path.join(root, "scripts/fixtures/fenok-rim-russell2000-official-2026-03-31.json"), "utf8"));
  const benchmark = JSON.parse(fs.readFileSync(path.join(root, "data/benchmarks/us.json"), "utf8"));
  const rates = JSON.parse(fs.readFileSync(path.join(root, "data/macro/fred-banking-daily.json"), "utf8"));
  const history = benchmark.sections.russell2000.data.filter((row) => row.date <= fixture.as_of);
  const normalRoe = median(history.slice(-260).map((row) => row.roe).filter(finite));
  const riskFree = rates.series.DGS10.find((row) => row.date === fixture.as_of)?.value / 100;
  const payout = fixture.fundamentals.dividend_yield * fixture.fundamentals.price_to_earnings_ex_negative;
  const fy3 = deriveFy3RoeProxy({
    price: fixture.index_close,
    priceToBook: fixture.fundamentals.price_to_book,
    forwardPe: fixture.fundamentals.price_to_earnings_ex_negative,
    payout,
    annualEpsGrowth: fixture.fundamentals.eps_growth_5y,
    earningsBasis: "current_trailing",
  });
  const row = computeYooLogicSharedInferredRange({
    id: "RUT",
    price: fixture.index_close,
    book: fixture.index_close / fixture.fundamentals.price_to_book,
    fy3Roe: fy3.fy3_roe,
    normalRoe,
    payout,
    riskFree,
    publicErp: fixture.public_erp,
    classification: "OFFICIAL_SAME_DATE_FUNDAMENTALS_SNAPSHOT_DIAGNOSTIC",
    identityBlockers: ["normal_ROE_uses_cross_provider_exact_index_history", "snapshot_not_current_runtime"],
  });
  row.official_snapshot = { ...fixture, derived: { payout, normal_roe: normalRoe, risk_free: riskFree, fy3_roe_proxy: fy3 } };
  return {
    schema_version: "fenok_rim_russell_official_snapshot_diagnostic.v1",
    production_integrated: false,
    row,
  };
}

export function buildRussellCurrentOfficialFundamentalsDiagnostic(root = ROOT) {
  const official = JSON.parse(fs.readFileSync(path.join(root, "data/computed/fenok-rim/russell2000-official-fundamentals.json"), "utf8"));
  const benchmark = JSON.parse(fs.readFileSync(path.join(root, "data/benchmarks/us.json"), "utf8"));
  const input = JSON.parse(fs.readFileSync(path.join(root, "data/computed/rim-index/inputs.json"), "utf8"));
  const history = benchmark.sections.russell2000.data;
  const latest = history.at(-1);
  const fundamentals = official.fundamentals;
  const payout = official.derived.payout_ex_negative_basis;
  const fy3 = deriveFy3RoeProxy({
    price: latest.px_last,
    priceToBook: fundamentals.price_to_book,
    forwardPe: fundamentals.price_to_earnings_ex_negative,
    payout,
    annualEpsGrowth: fundamentals.eps_growth_5y,
    earningsBasis: "current_trailing",
  });
  const row = computeFenoIndexForecastPathRange({
    id: "RUT",
    price: latest.px_last,
    book: latest.px_last / fundamentals.price_to_book,
    roePath: fy3.path.map((period) => period.roe),
    payout,
    riskFree: input.indices.SPX.observed.risk_free_rate.value,
    publicErp: input.indices.SPX.observed.equity_risk_premium.value,
    identityBlockers: ["official_fundamentals_asof_precedes_current_price", "method_family_not_validated_on_later_RUT_holdout"],
  });
  row.status = "suppressed_method_not_validated";
  row.official_fundamentals = official;
  row.price_as_of = latest.date;
  row.fundamentals_age_days_at_price = Math.round((instant(latest.date, "Russell price") - instant(official.as_of, "Russell fundamentals")) / 86400000);
  row.suppression = {
    reason: "exact recurring fundamentals producer is ready, but the automatic LTROE method still misses the historical Russell RIM family and lacks a later holdout",
    source_blocked: false,
  };
  return {
    schema_version: "fenok_rim_russell_current_official_fundamentals_diagnostic.v1",
    production_integrated: false,
    row,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify({
    calibration: runArchivedRuleCalibration(),
    inferred_current_ranges: buildCurrentInferredFenoRanges(),
    yoo_logic_single_observation_bridge_diagnostics: buildCurrentYooLogicInferredRanges(),
    yoo_logic_shared_inferred_current_ranges: buildCurrentYooLogicSharedInferredRanges(),
    index_automatic_forecast_path_ranges: buildCurrentIndexForecastPathRanges(),
    method_family_union_ranges: buildCurrentMethodFamilyUnionRanges(),
    historical_conditional_payout_diagnostic: buildHistoricalConditionalPayoutDiagnostic(),
    historical_horizon_residual_value_diagnostic: buildHistoricalHorizonResidualValueDiagnostic(),
    yoo_logic_extended_auto_proxy_ranges: buildCurrentExtendedYooLogicProxyRanges(),
    russell_official_snapshot_diagnostic: buildRussellOfficialSnapshotDiagnostic(),
    russell_current_official_fundamentals_diagnostic: buildRussellCurrentOfficialFundamentalsDiagnostic(),
  }, null, 2)}\n`);
}
