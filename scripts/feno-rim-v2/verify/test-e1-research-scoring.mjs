#!/usr/bin/env node

// FENO RIM v2 — E1 research-scoring contract tests.
//
// Proves on real repo data: the failure criteria were frozen pre-result
// (artifact present, frozen_pre_result marker, sha matching the frozen
// constant), E1 scoring determinism (identical per-index block and sha across
// two builds), the research_only surface, the demotion of static coverage to a
// diagnostic field, the Spearman/decile/rho-bootstrap helpers, and that the
// verdict follows the FROZEN criteria (fail set, baseline set, regime set).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFailureCriteria, E1_CRITERIA_SCHEMA_VERSION, E1_FOUR_US_INDICES } from "../e1-criteria.mjs";
import {
  applyFrozenVerdict,
  blockBootstrapRho,
  buildE1Scoring,
  decileCalibration,
  loadFrozenCriteria,
  spearmanRho,
} from "./e1-research-scoring.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const criteriaFile = path.join(ROOT, "data/computed/feno-rim-v2/e1-failure-criteria.json");

// --- frozen pre-result criteria ---------------------------------------------

assert.ok(fs.existsSync(criteriaFile), "e1-failure-criteria.json must exist (frozen BEFORE any E1 result)");
const savedCriteria = JSON.parse(fs.readFileSync(criteriaFile, "utf8"));
assert.equal(savedCriteria.schema_version, E1_CRITERIA_SCHEMA_VERSION, "criteria schema version");
assert.equal(savedCriteria.frozen_pre_result, true, "criteria carry frozen_pre_result: true");
assert.equal(savedCriteria.criteria_sha256, buildFailureCriteria().criteria_sha256, "artifact sha matches the frozen constant");

const fc = savedCriteria.failure_criteria;
assert.deepEqual(fc.four_us_indices, E1_FOUR_US_INDICES, "four US indices in the fail set");
for (const key of ["fail_rank_relationship", "fail_worse_than_baseline", "fail_no_regime_stability"]) {
  assert.ok(fc[key]?.owner_rule, `${key}: owner rule present`);
  assert.ok(fc[key]?.operational, `${key}: operational definition present`);
}
assert.ok(fc.verdict.rule.includes("terminates"), "verdict rule names B1 termination");
assert.equal(fc.demoted.status.includes("DEMOTED"), true, "static coverage demoted status recorded");

// loadFrozenCriteria accepts the artifact and rejects nothing it must not.
assert.equal(loadFrozenCriteria().criteria_sha256, savedCriteria.criteria_sha256, "loadFrozenCriteria returns the frozen criteria");

// --- statistics helpers ------------------------------------------------------

{
  const xs = [1, 2, 3, 4, 5];
  assert.equal(spearmanRho(xs, xs), 1, "perfect monotone => rho 1");
  assert.equal(spearmanRho(xs, [...xs].reverse()), -1, "perfect reverse => rho -1");
  const ties = [1, 1, 2, 3, 4];
  assert.equal(spearmanRho(ties, ties), 1, "ties handled via average ranks");
  assert.equal(spearmanRho([1, 2], [1]), null, "length mismatch => null");
  assert.equal(spearmanRho([1, 1, 1], [1, 2, 3]), null, "degenerate x => null");
}

{
  const pairs = Array.from({ length: 34 }, (_, i) => ({ x: i, y: i * 2 }));
  const b1 = blockBootstrapRho(pairs);
  const b2 = blockBootstrapRho(pairs);
  assert.deepEqual(b1, b2, "rho bootstrap is deterministic");
  assert.ok(b1.mean > 0.99, "seeded bootstrap mean near 1 for perfect relation");
}

{
  const cal = decileCalibration(Array.from({ length: 34 }, (_, i) => ({ x: i, y: i })));
  assert.equal(cal.reduce((s, d) => s + d.n, 0), 34, "deciles cover all origins");
  const means = cal.map((d) => d.mean_annualised_return_36m);
  for (let i = 1; i < means.length; i += 1) {
    assert.ok(means[i] >= means[i - 1], `decile means monotone (d${i} < d${i - 1})`);
  }
}

// --- scoring determinism + research-only surface ------------------------------

const s1 = buildE1Scoring();
const s2 = buildE1Scoring();
assert.deepEqual(s1.per_index, s2.per_index, "per-index scoring must be identical across builds");
assert.deepEqual(s1.verdict, s2.verdict, "verdict must be identical across builds");
assert.equal(s1.scoring_sha256, s2.scoring_sha256, "scoring hash must be stable (generated_at excluded)");

assert.equal(s1.research_only, true, "research_only flag must be true");
assert.equal(s1.promotion, null, "promotion must be null");
assert.equal(s1.frozen_criteria.criteria_sha256, savedCriteria.criteria_sha256, "artifact cites the frozen criteria sha");

// Every scored index carries model + baseline on the IDENTICAL origin set.
for (const [id, s] of Object.entries(s1.per_index)) {
  if (s.identical_origins.n === 0) continue;
  assert.equal(s.identical_origins.n, s.identical_origins.model.spearman_ci.n, `${id}: model CI on identical set`);
  assert.equal(s.identical_origins.n, s.identical_origins.baseline.spearman_ci.n, `${id}: baseline CI on identical set`);
  assert.ok(
    s.identical_origins.model.spearman_rho >= -1 && s.identical_origins.model.spearman_rho <= 1,
    `${id}: model rho in [-1,1]`,
  );
  assert.ok(
    s.identical_origins.baseline.spearman_rho >= -1 && s.identical_origins.baseline.spearman_rho <= 1,
    `${id}: baseline rho in [-1,1]`,
  );
  assert.equal(typeof s.identical_origins.model_beats_baseline_on_rank, "boolean", `${id}: baseline beat flag boolean`);
  assert.equal(s.diagnostic.demoted, true, `${id}: static coverage demoted to diagnostic`);
  assert.equal(typeof s.diagnostic.interval_coverage_36m, "number", `${id}: coverage still emitted as diagnostic`);
}

// --- verdict follows the FROZEN criteria ---------------------------------------

// Synthetic per-index blocks: all four US indices with model rho <= 0.
function syntheticIndex(modelRho, baselineRho, cells) {
  return {
    identical_origins: { n: 10, model: { spearman_rho: modelRho }, baseline: { spearman_rho: baselineRho } },
    regime_stability: cells.map(([bucket, n, rho]) => ({ bucket, n, evaluable: n >= 5, spearman_rho: rho })),
  };
}
const mk = (model, baseline, cells) => Object.fromEntries(E1_FOUR_US_INDICES.map((id) => [id, syntheticIndex(model, baseline, cells)]));

{
  const perIndex = mk(-0.1, 0.1, [["low_rate", 10, -0.05], ["high_rate", 8, 0.1]]);
  const v = applyFrozenVerdict(savedCriteria, perIndex);
  assert.equal(v.verdict, "TOP_DOWN_B1_TERMINATES", "rank <= 0 on all four US indices terminates");
  assert.ok(v.triggered_failures.includes("fail_rank_relationship"), "rank failure named");
}

{
  const perIndex = mk(0.2, 0.5, [["low_rate", 10, 0.3], ["high_rate", 8, 0.4]]);
  const v = applyFrozenVerdict(savedCriteria, perIndex);
  assert.equal(v.verdict, "TOP_DOWN_B1_TERMINATES", "losing to the baseline on all four US indices terminates");
  assert.ok(v.triggered_failures.includes("fail_worse_than_baseline"), "baseline failure named");
}

{
  const perIndex = mk(0.3, 0.1, [["low_rate", 10, -0.2], ["high_rate", 8, -0.3]]);
  const v = applyFrozenVerdict(savedCriteria, perIndex);
  assert.equal(v.verdict, "TOP_DOWN_B1_TERMINATES", "no regime stability terminates");
  assert.ok(v.triggered_failures.includes("fail_no_regime_stability"), "regime failure named");
}

{
  const perIndex = mk(0.4, 0.2, [["low_rate", 10, 0.3], ["high_rate", 8, 0.5]]);
  const v = applyFrozenVerdict(savedCriteria, perIndex);
  assert.equal(v.verdict, "B1_SURVIVES_E1", "positive rank, beats baseline, stable => survives");
  assert.deepEqual(v.triggered_failures, [], "no failures triggered");
}

{
  const perIndex = mk(0.4, 0.2, []);
  const v = applyFrozenVerdict(savedCriteria, perIndex);
  assert.equal(v.verdict, "E1_INSUFFICIENT_DATA", "fewer than 2 evaluable regime cells => insufficient, not pass/fail");
}

console.log("feno-rim-v2 e1-research-scoring (V/P vs 36m annualised return) tests passed");
