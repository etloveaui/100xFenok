#!/usr/bin/env node

// FENO RIM — X1: factor/period control, verdict criteria (FROZEN PRE-RESULT).
//
// Directive: feno-handoff fh-20260806-175-cc-b563494b (handler = cc; owner
// amended the contract — final A/B/C owner is cc, not Qwen). Contract section
// 6 (X1) + 12.4 (deliverable). Handler fixed the verdict criteria below; they
// are frozen as data BEFORE any X1 number exists, consumed fail-closed by
// x1-factor-regime.mjs. This module computes NO factor numbers.
//
// Handler decisions frozen alongside (they bind X1):
//   - representative value V stays the MIDPOINT (endpoint ranks remain a
//     reported diagnostic — switching to low after X0 would be fitting to
//     result);
//   - rank correlation remains the primary metric; directional_rate stays
//     demoted and is not used in any verdict;
//   - every X1 statistic is computed on BOTH origin sets: all 34, and the 18
//     window-complete ones (X0 proved the full set is truncation-confounded).
//
// Deterministic: identical input produces an identical criteria hash;
// generated_at is excluded from the hash.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const X1_CRITERIA_SCHEMA_VERSION = "feno_rim_v2_x1_factor_criteria.v1";

// Origin sets frozen from the accepted artifacts (data, not results):
// all 34 scored origins (e2 artifact); the 18 window-complete ones = baseline
// window actually covering >= 9.5y of the requested 10y span, measured in the
// accepted X0 audit (X0 P0-3 reversal set).
export function frozenOriginSets() {
  const e2 = JSON.parse(fs.readFileSync(path.join(ROOT, "data/computed/feno-rim-v2/e2-research-scoring.json"), "utf8"));
  const audit = JSON.parse(fs.readFileSync(path.join(ROOT, "data/computed/feno-rim-v2/E1_E2_FORENSIC_AUDIT.json"), "utf8"));
  const all = e2.per_origin_rows.map((r) => r.as_of);
  const windows = audit.e2?.baseline_windows ?? [];
  const complete = windows
    .filter((w) => (w.window_years ?? w.years) >= 9.5)
    .map((w) => w.as_of);
  return { all_34: all, window_complete_18: complete };
}

export const X1_FACTOR_SOURCES = Object.freeze([
  Object.freeze({
    id: "ff_research_factors",
    url: "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_CSV.zip",
    contains: ["Mkt-RF", "SMB", "HML", "RF"],
  }),
  Object.freeze({
    id: "ff_5factors_2x3",
    url: "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_5_Factors_2x3_CSV.zip",
    contains: ["RMW", "CMA"],
  }),
  Object.freeze({
    id: "ff_momentum",
    url: "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Momentum_Factor_CSV.zip",
    contains: ["MOM"],
  }),
  Object.freeze({
    id: "ff_25_me_bm",
    url: "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/25_Portfolios_ME_BM_CSV.zip",
    contains: ["Big Value minus Big Growth = (ME5,BM5) - (ME5,BM1) monthly"],
  }),
]);

export const X1_FACTOR_DEFINITIONS = Object.freeze({
  hml: "HML (value factor), monthly, from F-F_Research_Data_5_Factors_2x3",
  big_value_minus_big_growth: "(ME5,BM5) - (ME5,BM1) monthly portfolio returns from 25_Portfolios_ME_BM",
  rmw: "RMW (profitability), monthly, from F-F_Research_Data_5_Factors_2x3",
  cma: "CMA (investment), monthly, from F-F_Research_Data_5_Factors_2x3",
  momentum: "MOM (momentum), monthly, from F-F_Momentum_Factor",
  market_excess: "Mkt-RF, monthly, from F-F_Research_Data_Factors",
});

export const X1_METHOD = Object.freeze({
  window: "each origin's subsequent 36 months: compound the monthly factor returns over (t, t+36m]; the basket's 36m cumulative total return over the SAME window",
  period_window: "2015-01 .. 2023-12 cumulative factor returns (the origin span's matched period)",
  residual: "pooled OLS per origin set: y = basket 36m cumulative total return on X = [1, MktRF36, HML36, RMW36, CMA36, MOM36]; factor-residual return = y - yhat",
  primary_signal: "bottom-up V/P (midpoint) vs 36m cumulative return (raw and factor-residual), Spearman rank correlation with own moving-block bootstrap CI and ESS; top-down V/P reported alongside",
  both_origin_sets: "all 34 and the 18 window-complete origins — every statistic computed on both (handler decision)",
});

// ---------------------------------------------------------------------------
// FROZEN VERDICT CRITERIA (handler-fixed; operationalised once, here, pre-result)
// ---------------------------------------------------------------------------

export const X1_VERDICT_CRITERIA = Object.freeze({
  scope: "X1 factor/period control for the E2 bottom-up RIM signal on the fixed Dow-30 basket; factors are regime CONTEXT, never a substitute baseline (contract 6 X1)",
  origin_sets: "all_34 + window_complete_18 (both required for every statistic)",

  insufficient_matched_universe: Object.freeze({
    directive_rule: "the Dow basket cannot be matched to the factor universe closely enough to interpret the residual",
    operational:
      "any required 36m origin window has missing factor months (data gap), OR the pooled OLS R2 < 0.50 on BOTH origin sets "
      + "(the factors barely co-move with the basket, so residuals are uninterpretable); do not force a number",
    fail_when: "data gap in any origin window, or R2 < 0.50 on both sets",
  }),

  period_effect_explains_most: Object.freeze({
    directive_rule: "value factors are materially negative over the matched window AND the RIM signal's rank correlation against FACTOR-RESIDUAL returns turns positive on both origin sets",
    operational:
      "cumulative HML over 2015-01..2023-12 < 0 (materially negative, magnitude reported) AND "
      + "spearman(bottom-up V/P, factor-residual 36m return) > 0 on BOTH origin sets",
    pass_when: "HML_cum_2015_2023 < 0 AND residual_rho > 0 on both sets",
  }),

  period_effect_partial_only: Object.freeze({
    directive_rule: "factor-residual rank improves versus raw but remains <= 0 on at least one origin set",
    operational:
      "residual_rho > raw_rho on BOTH origin sets (improvement on the same set) AND residual_rho <= 0 on at least one set",
    pass_when: "residual_rho > raw_rho on both sets AND residual_rho <= 0 on >= 1 set",
  }),

  model_failure_remains: Object.freeze({
    directive_rule: "factor-residual rank stays <= 0 on both origin sets",
    operational: "residual_rho <= 0 on BOTH origin sets (or no criteria above is met — conservative default)",
    pass_when: "residual_rho <= 0 on both sets, or no other criterion fires",
  }),

  decision_order: Object.freeze([
    "insufficient_matched_universe",
    "period_effect_explains_most",
    "period_effect_partial_only",
    "model_failure_remains",
  ]),

  frozen_pre_result: true,
  freeze_mechanism:
    "criteria emitted as data by x1-criteria.mjs before any X1 number exists, consumed fail-closed by x1-factor-regime.mjs",
});

export const X1_CRITERIA_FREEZE_POLICY =
  "verdict criteria frozen from the handler's directive alone; no factor data fetched and no factor number computed at freeze time";

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

export function buildX1Criteria({ generatedAt = new Date().toISOString() } = {}) {
  const originSets = frozenOriginSets();
  const body = {
    schema_version: X1_CRITERIA_SCHEMA_VERSION,
    frozen_pre_result: true,
    freeze_policy: X1_CRITERIA_FREEZE_POLICY,
    directive_ref: "feno-handoff fh-20260806-175-cc-b563494b (handler: cc; owner-amended contract, commit 671202c61b)",
    handler_decisions: {
      representative_value: "midpoint (endpoint ranks remain a reported diagnostic; switching to low post-X0 would be fitting to result)",
      primary_metric: "rank correlation; directional_rate demoted, not used in any verdict",
      origin_sets: "all 34 + the 18 window-complete ones, both required for every statistic",
    },
    origin_sets_frozen: {
      all_34: originSets.all_34,
      window_complete_18: originSets.window_complete_18,
      rule: "window_complete = baseline window_years >= 9.5 of the requested 10y span (X0 P0-3 reversal set)",
    },
    factor_sources: X1_FACTOR_SOURCES,
    factor_definitions: X1_FACTOR_DEFINITIONS,
    method: X1_METHOD,
    verdict_criteria: X1_VERDICT_CRITERIA,
  };
  const criteriaSha = sha256(JSON.stringify(body));
  return { ...body, generated_at: generatedAt, criteria_sha256: criteriaSha };
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  const criteria = buildX1Criteria();
  const outDir = path.join(ROOT, "data/computed/feno-rim-v2");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "x1-factor-criteria.json"), `${JSON.stringify(criteria, null, 2)}\n`);
  console.log(`X1 factor criteria frozen pre-result: ${path.join(outDir, "x1-factor-criteria.json")}`);
  console.log(`origin sets: all_34=${criteria.origin_sets_frozen.all_34.length} window_complete_18=${criteria.origin_sets_frozen.window_complete_18.length}`);
  console.log(`criteria sha256: ${criteria.criteria_sha256.slice(0, 16)}…`);
}
