#!/usr/bin/env node

// FENO RIM v2 — X3 success criteria, frozen BEFORE any X3 result exists.
//
// Contract: docs/analysis/yoo-rim-audit/FINAL_FENO_RIM_RESOLUTION_MASTER_PROMPT_QWEN_DEEPSEEK_KR.md
// section 6 (X3) requires the Oracle "success" bar to be frozen ahead of the
// result, and section 10 requires every experiment's criteria to be written
// before its result file with a fixed sha256.
//
// X3 separates two explanations that every earlier experiment confounded:
// whether the FORMULA cannot rank returns, or whether the DATA needed to feed
// it does not exist at origin time. The Oracle arm is deliberate look-ahead -
// it uses realised future book and earnings, is never a production input, and
// measures only the theoretical ceiling of the formula. The Deployable arm
// uses strictly what was filed on or before the origin.
//
// Handler: cc. Written before the scorer, and the scorer consumes it
// fail-closed - if this file is absent or its sha does not match what the
// scorer recorded, the run refuses.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const X3_CRITERIA_SCHEMA_VERSION = "feno_rim_v2_x3_success_criteria.v1";

// The bar is the same for both arms on purpose. An asymmetric bar would let
// the Oracle "succeed" on weaker evidence than the Deployable, which is
// exactly the direction that manufactures a REQUIRES_PAID_DATA conclusion.
export const X3_CRITERIA = Object.freeze({
  schema_version: X3_CRITERIA_SCHEMA_VERSION,
  frozen_pre_result: true,
  freeze_policy:
    "frozen from the contract alone (section 6 X3 + section 10 anti-loop); no X3 model output computed or consumed at freeze time",
  contract_ref:
    "docs/analysis/yoo-rim-audit/FINAL_FENO_RIM_RESOLUTION_MASTER_PROMPT_QWEN_DEEPSEEK_KR.md section 6 (X3), section 9 (final decision), section 10 (anti-loop)",
  handler: "cc",

  scope: Object.freeze({
    basket: "fixed Dow 30 list, identical to E2 — same basket, same origins, so X3 is comparable to E1/E2 rather than a new universe",
    origins: "the same 34 quarterly origins as E1/E2",
    primary_metric:
      "Spearman rank correlation of origin V/P against the subsequent 36-month annualised dividend-adjusted total return",
    origin_sets: Object.freeze([
      "all_34",
      "window_complete_18 — the subset X0 proved is not truncation-confounded; reported for both arms because a verdict on the confounded set alone would inherit the confound",
    ]),
  }),

  // Deliberately the same numeric bar for both arms.
  success_bar: Object.freeze({
    rule: "an arm SUCCEEDS when its Spearman rho is positive AND its block-bootstrap 95% CI excludes zero, on the window_complete_18 set",
    rho_must_be: "> 0",
    ci_must: "exclude zero",
    decisive_origin_set: "window_complete_18",
    all_34_role:
      "reported and required to be non-contradictory: an arm whose all_34 rho is negative while window_complete_18 is positive is recorded as REGIME_DEPENDENT rather than a clean success",
    why_positive_is_required:
      "E2's frozen rule required only beating the baseline and never required a positive relationship, so 'less negative' satisfied it. That gap is not repeated here.",
  }),

  // Contract section 6 X3's matrix, restated so the scorer resolves it
  // mechanically rather than by narrative.
  decision_matrix: Object.freeze({
    oracle_pass_deployable_pass: "DATA_AND_FORMULA_BOTH_VIABLE",
    oracle_pass_deployable_fail: "POINT_IN_TIME_FORECAST_DATA_IS_THE_BINDING_CONSTRAINT",
    oracle_fail_deployable_fail: "RIM_STRUCTURE_UNSUITED_TO_THE_TARGET",
    oracle_fail_deployable_pass: "IMPLEMENTATION_ERROR_SUSPECTED_REVERIFY",
  }),

  arms: Object.freeze({
    oracle: Object.freeze({
      definition:
        "residual income path built from REALISED future book and earnings drawn from EDGAR filings dated after the origin — explicit look-ahead",
      never: "never a production input; never promoted; measures the formula's ceiling only",
      lookahead_is_intentional: true,
    }),
    deployable: Object.freeze({
      definition:
        "strictly facts filed on or before the origin, earliest filed value per fiscal period so restatements cannot leak backwards, plus a pre-declared mean-reversion rule for the forward path",
      mean_reversion_rule:
        "ROE fades linearly from the origin's trailing realised ROE toward the constituent's own trailing 5-year median ROE over the forecast horizon; declared here, before any result, and not tuned afterwards",
      no_consensus_available:
        "the repo holds no per-constituent analyst consensus; per contract section 6 the deployable arm therefore uses historical actuals plus the stated rule, and the limitation is disclosed rather than worked around",
    }),
  }),

  anti_loop: Object.freeze({
    no_fifth_experiment: true,
    no_threshold_movement_after_results: true,
    prior_verdicts_preserved: true,
    representative_value:
      "V is the hull midpoint, unchanged from E1/E2 — X0 showed the endpoints disagree (sp500 mid -0.036, low +0.114, high -0.146) and switching after seeing that would be fitting to result",
  }),
});

export function criteriaSha256() {
  return crypto.createHash("sha256").update(JSON.stringify(X3_CRITERIA)).digest("hex");
}

export function writeCriteria() {
  const body = { ...X3_CRITERIA, criteria_sha256: criteriaSha256() };
  const out = path.join(ROOT, "data/computed/feno-rim-v2/x3-success-criteria.json");
  fs.writeFileSync(out, `${JSON.stringify(body, null, 2)}\n`);
  return { path: out, sha256: body.criteria_sha256 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = writeCriteria();
  console.log(`x3 criteria frozen: ${r.path}\nsha256: ${r.sha256}`);
}
