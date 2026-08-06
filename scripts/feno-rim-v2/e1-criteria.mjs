#!/usr/bin/env node

// FENO RIM v2 — E1: V/P-to-return evaluation, failure criteria (FROZEN PRE-RESULT).
//
// Owner ruling 2026-08-06 (second pass; delivered via feno-handoff
// fh-20260806-123-cc-1f98a6d2): the static 36-month level-coverage framing
// measured the wrong thing — today's intrinsic value is not a fixed 36-month
// price target. Primary evaluation becomes origin V/P (valuation gap) against
// the subsequent 36-month ANNUALISED total return.
//
// The failure criteria below are fixed by the owner and frozen as data BEFORE
// any E1 result exists, the same way the H2 thresholds were frozen in the
// Phase 3A feasibility receipt (data availability and overlap autocorrelation
// alone, no model output). This module computes NO E1 numbers — it only emits
// the frozen criteria. If any E1 result existed before this artifact, the
// freeze would be void; the scorer refuses to run without it.
//
// Deterministic: identical input produces an identical criteria hash;
// generated_at is excluded from the hash (same pattern as the H2 receipt).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const E1_CRITERIA_SCHEMA_VERSION = "feno_rim_v2_e1_failure_criteria.v1";

// The four US indices of the fail set (kospi is the Korean market and is
// reported but never fail-gating; russell2000 scores zero origins by design —
// LSEG factsheet not first-knowable — and is excluded from the fail set).
export const E1_FOUR_US_INDICES = Object.freeze([
  "sp500",
  "nasdaq100",
  "nasdaq_composite",
  "philadelphia_semi",
]);

export const E1_OWNER_RULING = Object.freeze({
  ref: "owner ruling 2026-08-06, second pass (feno-handoff fh-20260806-123-cc-1f98a6d2)",
  verbatim:
    "The result does NOT reject RIM as such. What it rejects is the COMBINATION of top-down index-book B1 "
    + "with a STATIC 36-month price-band coverage test. Today's intrinsic value is not a fixed 36-month price "
    + "target, so comparing today's band against the level 36 months later was measuring the wrong thing. "
    + "Primary evaluation changes to: origin V/P (or valuation gap) -> subsequent 36-month ANNUALISED total return. "
    + "Scored by: decile calibration, Spearman rank correlation, directional agreement, improvement over the "
    + "same-origin historical P/B baseline, and rate/regime stability. Static interval coverage is DEMOTED to a "
    + "diagnostic - keep emitting it, stop treating it as the verdict. "
    + "This is a time-unit alignment fix, not a fit-to-result change. Do not add a multiple-expansion term.",
});

export const E1_REALIZED_DEFINITION = Object.freeze({
  label: "subsequent 36-month annualised total return",
  cumulative: "dividend_adjusted_return_36m from the harness origins (price return + point-in-time trailing distribution yield accrued over the horizon)",
  annualised: "(1 + cumulative)^(1/3) - 1",
  fallback: "origins labelled bias_unadjusted (dividend_series_absent) fall back to annualised price_return_36m and are flagged; price return alone understates",
});

export const E1_MODEL_DEFINITION = Object.freeze({
  label: "origin V/P (valuation gap)",
  value: "computeFamilyB value_hull midpoint at the origin as-of (b2_admitted=false, erp_band wired point-in-time per origin)",
  ratio: "V/P = hull_mid / origin price",
});

export const E1_BASELINE_DEFINITION = Object.freeze({
  label: "same-origin historical P/B baseline",
  value: "trailing-10y price-per-book distribution (P25/P50/P75) x origin book at the same origin as-of (naiveBaselineBand, pure panel math, no engine)",
  ratio: "baseline V/P = P50 x book / origin price",
  identical_origins: "baseline is scored on the IDENTICAL origin set as the model (same as-ofs, same realized returns)",
});

// ---------------------------------------------------------------------------
// FROZEN FAILURE CRITERIA (owner-fixed; operationalised once, here, pre-result)
// ---------------------------------------------------------------------------

export const E1_FAILURE_CRITERIA = Object.freeze({
  scope: "top-down index-book B1 (Family B, b2_admitted=false, erp_band at origin, hull midpoint as V)",
  four_us_indices: E1_FOUR_US_INDICES,
  realized: E1_REALIZED_DEFINITION,
  model: E1_MODEL_DEFINITION,
  baseline: E1_BASELINE_DEFINITION,

  fail_rank_relationship: Object.freeze({
    owner_rule: "rank relationship <= 0 in 3 or more of the four US indices",
    operational:
      "per-index Spearman rho between origin V/P (hull midpoint / price) and the realized 36m annualised "
      + "total return; rho <= 0 in >= 3 of the four US indices triggers this criterion",
    fail_when: "rho <= 0 in >= 3 of 4 US indices",
  }),

  fail_worse_than_baseline: Object.freeze({
    owner_rule: "worse than the baseline",
    operational:
      "on IDENTICAL origins, per-index model rho (V/P vs return) is compared with the same-origin historical "
      + "P/B baseline rho (baseline V/P vs return); model rho < baseline rho in >= 3 of the four US indices "
      + "triggers this criterion (a tie is not a beat)",
    fail_when: "model rho < baseline rho in >= 3 of 4 US indices",
  }),

  fail_no_regime_stability: Object.freeze({
    owner_rule: "no regime stability",
    operational:
      "the feasibility receipt's regime buckets (high_rate / low_rate / crisis_2008_09 / crisis_2020_03) with "
      + "origin-date semantics and the receipt's per-index risk-free quantiles; per (index, bucket) cell with "
      + ">= 5 origins on the four US indices, compute Spearman rho (V/P vs return); rho <= 0 in >= half of the "
      + "evaluable cells triggers this criterion; fewer than 2 evaluable cells => insufficient_data, which is "
      + "neither pass nor fail",
    fail_when: "rho <= 0 in >= half of the evaluable (index, bucket) cells (cells with >= 5 origins)",
    min_cells: 2,
  }),

  verdict: Object.freeze({
    rule: "top-down B1 terminates if ANY of the three criteria fails",
    outcomes: Object.freeze({
      pass: "B1_SURVIVES_E1",
      fail: "TOP_DOWN_B1_TERMINATES",
      insufficient: "E1_INSUFFICIENT_DATA",
    }),
  }),

  demoted: Object.freeze({
    field: "static 36-month interval coverage",
    status: "DEMOTED to a diagnostic field; still emitted, never the verdict",
    reason: "today's intrinsic value is not a fixed 36-month price target; the static-band comparison measured the wrong thing (owner ruling)",
  }),

  frozen_pre_result: true,
  freeze_mechanism:
    "criteria emitted as data by e1-criteria.mjs before any E1 result exists, "
    + "consumed by e1-research-scoring.mjs which fails closed if the criteria file is missing or its sha mismatches",
});

export const E1_CRITERIA_FREEZE_POLICY =
  "failure criteria frozen from the owner ruling alone; no E1 model output computed or consumed at freeze time";

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

export function buildFailureCriteria({ generatedAt = new Date().toISOString() } = {}) {
  const body = {
    schema_version: E1_CRITERIA_SCHEMA_VERSION,
    frozen_pre_result: true,
    freeze_policy: E1_CRITERIA_FREEZE_POLICY,
    owner_ruling: E1_OWNER_RULING,
    failure_criteria: E1_FAILURE_CRITERIA,
  };
  const criteriaSha = sha256(JSON.stringify(body));
  return { ...body, generated_at: generatedAt, criteria_sha256: criteriaSha };
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  const criteria = buildFailureCriteria();
  const outDir = path.join(ROOT, "data/computed/feno-rim-v2");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "e1-failure-criteria.json"), `${JSON.stringify(criteria, null, 2)}\n`);
  console.log(`E1 failure criteria frozen pre-result: ${path.join(outDir, "e1-failure-criteria.json")}`);
  console.log(`criteria sha256: ${criteria.criteria_sha256.slice(0, 16)}…`);
}
