#!/usr/bin/env node

// FENO RIM v2 — E2 research-scoring contract tests (bottom-up control).
//
// Proves on real repo data: the success criteria were frozen pre-result
// (artifact present, frozen_pre_result marker, sha matching the frozen
// constant), E2 scoring determinism (identical blocks and sha across two
// builds), the research_only surface, the three-way comparison on IDENTICAL
// origin sets, the reported dropped-constituent reasons, the survivorship
// caveat presence, and that the verdict follows the FROZEN criteria.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildE2Criteria, E2_CRITERIA_SCHEMA_VERSION } from "../e2-criteria.mjs";
import { buildE2Panel } from "../e2-basket-panel.mjs";
import { applyE2Verdict, buildE2Scoring, loadFrozenE2Criteria } from "./e2-research-scoring.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const criteriaFile = path.join(ROOT, "data/computed/feno-rim-v2/e2-success-criteria.json");

// --- frozen pre-result criteria ---------------------------------------------

assert.ok(fs.existsSync(criteriaFile), "e2-success-criteria.json must exist (frozen BEFORE any E2 result)");
const savedCriteria = JSON.parse(fs.readFileSync(criteriaFile, "utf8"));
assert.equal(savedCriteria.schema_version, E2_CRITERIA_SCHEMA_VERSION, "criteria schema version");
assert.equal(savedCriteria.frozen_pre_result, true, "criteria carry frozen_pre_result: true");
assert.equal(savedCriteria.criteria_sha256, buildE2Criteria().criteria_sha256, "artifact sha matches the frozen constant");

const sc = savedCriteria.success_criteria;
assert.equal(sc.basket.symbols.length, 30, "basket has 30 fixed symbols");
assert.equal(sc.basket.fixed_list, true, "basket is a fixed list");
assert.ok(sc.basket.survivorship_caveat.includes("survivorship"), "survivorship caveat stated");
assert.ok(sc.pass_rank_vs_baseline.operational.includes(">"), "pass requires strictly greater rho than the baseline");
assert.equal(sc.verdict.outcomes.pass, "BOTTOM_UP_PASSES", "pass outcome name");
assert.equal(sc.verdict.outcomes.fail, "BOTTOM_UP_FAILS", "fail outcome name");

assert.equal(loadFrozenE2Criteria().criteria_sha256, savedCriteria.criteria_sha256, "loadFrozenE2Criteria returns the frozen criteria");

// --- panel structure ----------------------------------------------------------

const panel = buildE2Panel();
assert.equal(panel.origins.length, 34, "same 34 origins as E1 sp500");
assert.equal(panel.origins_scored, 34, "all 34 origins scored");
assert.ok(panel.basket_weekly_rows.length > 500, "basket weekly series present");
assert.ok(panel.origin_rows.every((o) => o.n_ok_members >= 20), "every origin keeps >= 20 of 30 constituents");
assert.ok(panel.point_in_time.book_concept_per_symbol, "book concept recorded per symbol");
assert.ok(panel.point_in_time.earn_concept_per_symbol, "earnings concept recorded per symbol");

// --- scoring determinism + research-only surface ------------------------------

const s1 = buildE2Scoring();
const s2 = buildE2Scoring();
assert.deepEqual(s1.per_origin_rows, s2.per_origin_rows, "per-origin rows identical across builds");
assert.deepEqual(s1.comparison, s2.comparison, "comparison identical across builds");
assert.deepEqual(s1.verdict, s2.verdict, "verdict identical across builds");
assert.equal(s1.scoring_sha256, s2.scoring_sha256, "scoring hash stable (generated_at excluded)");

assert.equal(s1.research_only, true, "research_only flag true");
assert.equal(s1.promotion, null, "promotion null");
assert.equal(s1.frozen_criteria.criteria_sha256, savedCriteria.criteria_sha256, "artifact cites frozen criteria sha");
assert.ok(s1.basket.survivorship_caveat, "survivorship caveat carried into the artifact");
assert.equal(s1.origins_scored, 34, "34 origins scored");

const c = s1.comparison;
assert.equal(c.bottom_up.n, 34, "bottom-up on all origins");
assert.equal(c.baseline.n, 34, "baseline on all origins");
assert.equal(c.identical_origins_bu_vs_baseline, 34, "identical origins for bu vs baseline");
for (const key of ["top_down", "bottom_up", "baseline"]) {
  assert.ok(c[key].spearman_rho >= -1 && c[key].spearman_rho <= 1, `${key} rho in [-1,1]`);
  assert.ok(c[key].directional_rate >= 0 && c[key].directional_rate <= 1, `${key} directional in [0,1]`);
}

// dropped constituents reported with reasons
assert.ok(
  s1.per_origin_rows.some((r) => r.members_dropped.length > 0),
  "dropped constituents are reported per origin",
);
assert.ok(
  s1.per_origin_rows.every((r) => r.members_dropped.every((d) => d.symbol && d.reason)),
  "every drop carries symbol + reason",
);

// realized return = (1 + cap_return + yield)^(1/3) - 1
for (const r of s1.per_origin_rows) {
  assert.ok(
    Math.abs(r.return_annualised - ((1 + r.cap_return + r.dividend_yield) ** (1 / 3) - 1)) < 1e-6,
    `${r.as_of}: annualised matches (1+cap+yield)^(1/3)-1`,
  );
}

// --- verdict follows the FROZEN criteria ---------------------------------------

{
  const v = applyE2Verdict(sc, { buRho: -0.3, blRho: -0.6, n: 34 });
  assert.equal(v.verdict, "BOTTOM_UP_PASSES", "bu rho > bl rho passes");
  assert.equal(v.pass_condition_met, true, "pass flag true");
}
{
  const v = applyE2Verdict(sc, { buRho: -0.6, blRho: -0.3, n: 34 });
  assert.equal(v.verdict, "BOTTOM_UP_FAILS", "bu rho <= bl rho fails");
  assert.equal(v.pass_condition_met, false, "pass flag false");
}
{
  const v = applyE2Verdict(sc, { buRho: -0.5, blRho: -0.5, n: 34 });
  assert.equal(v.verdict, "BOTTOM_UP_FAILS", "a tie is not a pass");
}
{
  const v = applyE2Verdict(sc, { buRho: 0.1, blRho: -0.1, n: 1 });
  assert.equal(v.verdict, "E2_INSUFFICIENT_DATA", "fewer than 2 origins => insufficient");
}
{
  const v = applyE2Verdict(sc, { buRho: null, blRho: -0.1, n: 34 });
  assert.equal(v.verdict, "E2_INSUFFICIENT_DATA", "missing rho => insufficient");
}

console.log("feno-rim-v2 e2-research-scoring (bottom-up control) tests passed");
