#!/usr/bin/env node

// FENO RIM v2 — E2: bottom-up control, success criteria (FROZEN PRE-RESULT).
//
// Peer directive (feno-handoff fh-20260806-134-cc-932a5122, owner approved):
// E1 terminated the top-down index-book approach (TOP_DOWN_B1_TERMINATES,
// committed 7e37d4c735). E2 asks whether the failure is RIM itself or the
// top-down aggregation, by running all THREE methods against ONE basket:
//   1. top-down:  aggregate the basket's book and earnings, then the existing
//                 B1 engine (computeFamilyB, unchanged);
//   2. bottom-up: per-constituent RIM (computeFamilyB per constituent), then
//                 aggregation of total intrinsic values (equivalently
//                 market-cap weighted V/P);
//   3. baseline:  the basket's own historical P/B multiple, same rule as E1's
//                 baseline (trailing-10y P25/P50/P75 x aggregate book / cap).
// Same origins as E1 (the 34 sp500 walk-forward origins), same realized series
// (36-month annualised dividend-adjusted total return), same metrics (Spearman
// rho with moving-block CI, decile calibration, directional rate, regime cells).
//
// The success criteria below are fixed by the directive and frozen as data
// BEFORE any E2 number exists — the same pattern as E1 (criteria emitted by
// e1-criteria.mjs, consumed fail-closed by the scorer). This module computes
// NO E2 numbers; it only emits the frozen criteria.
//
// Deterministic: identical input produces an identical criteria hash;
// generated_at is excluded from the hash.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const E2_CRITERIA_SCHEMA_VERSION = "feno_rim_v2_e2_success_criteria.v1";

// The basket is the CURRENT Dow 30 list as stored in the repo's own index
// pipeline (data/slickcharts/dowjones.json, updated 2026-08-01, count 30).
// The list is FIXED for the whole evaluation. A fixed constituent list carries
// survivorship bias — that bias is common to all three methods because they
// share the identical basket, so the comparison stays fair even though the
// basket itself is not a clean index. The limitation bounds what E2 can
// conclude and must be stated in the E2 artifact, never quietly dropped.
export const E2_BASKET = Object.freeze({
  name: "Dow Jones Industrial Average (current constituents, fixed list)",
  source: "data/slickcharts/dowjones.json (updated 2026-08-01, count 30)",
  symbols: Object.freeze([
    "GS", "CAT", "MSFT", "UNH", "AMGN", "TRV", "V", "GOOGL", "JPM", "SHW",
    "AXP", "HD", "AAPL", "AMZN", "MCD", "JNJ", "HON", "IBM", "BA", "NVDA",
    "CVX", "CRM", "MMM", "PG", "MRK", "CSCO", "WMT", "DIS", "KO", "NKE",
  ]),
  fixed_list: true,
  survivorship_caveat:
    "a fixed constituent list carries survivorship bias; all three methods share the identical basket, "
    + "so the bias is common to all three and the comparison stays fair — but the basket is not a clean "
    + "index and the caveat bounds what E2 can conclude",
});

export const E2_ORIGINS_DEFINITION = Object.freeze({
  label: "same origins as E1 (the 34)",
  operational:
    "the 34 as-of dates of E1's sp500 walk-forward scored origins, recomputed deterministically via the "
    + "same buildOrigins + spx adapter + computeFamilyB path (identical to E1's origin set)",
});

export const E2_REALIZED_DEFINITION = Object.freeze({
  label: "subsequent 36-month annualised dividend-adjusted total return of the basket",
  operational:
    "basket total market cap at origin vs origin+36m, annualised: (1 + cap_return)^(1/3) - 1, plus the "
    + "aggregate point-in-time dividend yield accrued over the horizon from the constituent dividend "
    + "series (nominal dividends / basket cap at origin, mirroring the harness dividendAdjustment)",
});

export const E2_METHODS = Object.freeze({
  top_down: Object.freeze({
    label: "top-down on the basket",
    operational:
      "aggregate the basket's point-in-time book and earnings at each origin, then the existing B1 engine "
      + "(computeFamilyB, b2_admitted=false, erp_band at origin) on the aggregate; V/P = hull midpoint / basket cap",
  }),
  bottom_up: Object.freeze({
    label: "bottom-up on the basket",
    operational:
      "per-constituent point-in-time RIM (computeFamilyB on each constituent's own book, earnings, growth "
      + "and ROE band, b2_admitted=false, erp_band at origin), then aggregate total intrinsic values; "
      + "V/P = sum(V_i) / basket cap (equivalently market-cap weighted V/P)",
  }),
  baseline: Object.freeze({
    label: "the basket's own historical P/B multiple",
    operational:
      "trailing-10y price-per-book distribution (P25/P50/P75) of the basket x aggregate book / basket cap, "
      + "same rule as E1's baseline (naiveBaselineBand on the basket panel)",
  }),
});

// ---------------------------------------------------------------------------
// FROZEN SUCCESS CRITERIA (directive-fixed; operationalised once, here, pre-result)
// ---------------------------------------------------------------------------

export const E2_SUCCESS_CRITERIA = Object.freeze({
  scope: "bottom-up control on one fixed basket; all three methods share the identical basket and origins",
  basket: E2_BASKET,
  origins: E2_ORIGINS_DEFINITION,
  realized: E2_REALIZED_DEFINITION,
  methods: E2_METHODS,

  pass_rank_vs_baseline: Object.freeze({
    directive_rule: "bottom-up passes only if it beats the basket's own P/B baseline on rank correlation across the origins",
    operational:
      "on the IDENTICAL origin set, Spearman rho(bottom-up V/P, 36m annualised dividend-adjusted TR) "
      + "> Spearman rho(basket P/B baseline V/P, same series); strictly greater — a tie is not a pass",
    pass_when: "rho_bottom_up > rho_baseline on identical origins",
    fail_when: "rho_bottom_up <= rho_baseline on identical origins",
  }),

  regime_cells_reported: Object.freeze({
    directive_rule: "with the regime cells reported",
    operational:
      "high_rate / low_rate / crisis_2008_09 / crisis_2020_03 buckets with origin-date semantics and the "
      + "feasibility receipt's sp500 risk-free quantiles (the basket is US large caps); per-bucket n and "
      + "Spearman rho reported; reported, not pass-gating",
    pass_gating: false,
  }),

  verdict: Object.freeze({
    rule: "bottom-up passes only if it beats the basket's own P/B baseline on rank correlation across the origins",
    outcomes: Object.freeze({
      pass: "BOTTOM_UP_PASSES",
      fail: "BOTTOM_UP_FAILS",
      insufficient: "E2_INSUFFICIENT_DATA",
    }),
  }),

  reported_not_gated: Object.freeze([
    "top-down on the same basket (comparison, not pass-gated)",
    "three-way comparison table (top-down / bottom-up / baseline)",
    "constituents dropped at each origin and why",
    "survivorship caveat (stated, never dropped)",
  ]),

  constraints: Object.freeze({
    engine: "existing B1 engine (computeFamilyB) unchanged; adapters' first-knowable logic untouched",
    commit: "no commit",
    spec: "no spec iteration, no new design loops",
  }),

  frozen_pre_result: true,
  freeze_mechanism:
    "criteria emitted as data by e2-criteria.mjs before any E2 number exists, "
    + "consumed by e2-research-scoring.mjs which fails closed if the criteria file is missing or its sha mismatches",
});

export const E2_CRITERIA_FREEZE_POLICY =
  "success criteria frozen from the peer directive (owner approved) alone; no E2 model output computed or consumed at freeze time";

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

export function buildE2Criteria({ generatedAt = new Date().toISOString() } = {}) {
  const body = {
    schema_version: E2_CRITERIA_SCHEMA_VERSION,
    frozen_pre_result: true,
    freeze_policy: E2_CRITERIA_FREEZE_POLICY,
    directive_ref: "feno-handoff fh-20260806-134-cc-932a5122 (owner approved)",
    success_criteria: E2_SUCCESS_CRITERIA,
  };
  const criteriaSha = sha256(JSON.stringify(body));
  return { ...body, generated_at: generatedAt, criteria_sha256: criteriaSha };
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  const criteria = buildE2Criteria();
  const outDir = path.join(ROOT, "data/computed/feno-rim-v2");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "e2-success-criteria.json"), `${JSON.stringify(criteria, null, 2)}\n`);
  console.log(`E2 success criteria frozen pre-result: ${path.join(outDir, "e2-success-criteria.json")}`);
  console.log(`criteria sha256: ${criteria.criteria_sha256.slice(0, 16)}…`);
}
