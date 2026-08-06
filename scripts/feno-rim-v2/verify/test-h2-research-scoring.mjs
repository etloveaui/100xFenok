#!/usr/bin/env node

// FENO RIM v2 — Phase 3B: h2-research-scoring contract tests (incl. baseline).
//
// Proves on real repo data: determinism (identical per-index block and sha
// across two builds), the research_only flag, the absence of any promotion
// key with a value, rates within [0,1], origin counts matching the feasibility
// receipt, and the INDEPENDENCE of the naive baseline: the baseline band is
// re-derived from the raw panel alone (no Family B output) and must equal the
// artifact's baseline numbers.

import assert from "node:assert/strict";
import { buildResearchScoring, derivePerformance, naiveBaselineBand, scoreBaseline } from "./h2-research-scoring.mjs";
import { buildOrigins, INDEX_CONFIG, loadTracker } from "./h2-harness.mjs";
import { quantile, readJson } from "../adapters/panel-common.mjs";

const receipt = readJson("data/computed/feno-rim-v2/h2-feasibility-receipt.json");

// --- determinism ------------------------------------------------------------

const s1 = buildResearchScoring();
const s2 = buildResearchScoring();
assert.deepEqual(s1.per_index, s2.per_index, "per-index scoring must be identical across builds");
assert.deepEqual(s1.baseline_comparison, s2.baseline_comparison, "baseline comparison must be identical across builds");
assert.equal(s1.scoring_sha256, s2.scoring_sha256, "scoring hash must be stable (generated_at excluded)");

// --- research-only surface --------------------------------------------------

assert.equal(s1.research_only, true, "research_only flag must be true");
assert.equal(s1.promotion, null, "promotion must be null");

// No key named "promotion" may carry a value anywhere in the artifact.
(function walk(node, pathSoFar) {
  if (Array.isArray(node)) {
    node.forEach((child, i) => walk(child, `${pathSoFar}[${i}]`));
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "promotion" && value !== null) {
        assert.fail(`promotion key with a value at ${pathSoFar}.${key}`);
      }
      walk(value, `${pathSoFar}.${key}`);
    }
  }
})(s1, "$");

// --- per-index contract -----------------------------------------------------

const indexIds = Object.keys(s1.per_index);
assert.ok(indexIds.length === 6, "all six indices must be scored");

for (const id of indexIds) {
  const s = s1.per_index[id];
  const r = receipt.indices[id];
  assert.ok(s, `${id}: scored block present`);

  // Walk-forward bookkeeping: refused + scored origins reconcile to the
  // harness origin count (the receipt anchor).
  assert.ok(s.walk_forward, `${id}: walk_forward block present`);
  assert.equal(
    s.walk_forward.origins_scored + s.walk_forward.refused_total,
    s.origins_scored,
    `${id}: walk-forward origins reconcile`,
  );

  // Rates within [0,1] when walk-forward origins exist; null only when none
  // did (RUT: LSEG factsheet not first-knowable at historical origins).
  if (s.coverage_rate !== null) {
    assert.ok(s.coverage_rate >= 0 && s.coverage_rate <= 1, `${id}: coverage_rate in [0,1]`);
    assert.ok(s.directional_rate >= 0 && s.directional_rate <= 1, `${id}: directional_rate in [0,1]`);
  } else {
    assert.equal(s.walk_forward.origins_scored, 0, `${id}: null rates only with zero walk-forward origins`);
  }
  assert.ok(s.baseline.coverage_rate >= 0 && s.baseline.coverage_rate <= 1, `${id}: baseline coverage in [0,1]`);
  assert.ok(s.baseline.directional_rate >= 0 && s.baseline.directional_rate <= 1, `${id}: baseline directional in [0,1]`);
  if (s.mae_level !== null) assert.ok(s.mae_level >= 0 && s.baseline.mae_level >= 0, `${id}: MAE non-negative`);
  assert.equal(typeof s.baseline.hull_beats_on_coverage, "boolean", `${id}: coverage beat flag boolean`);
  assert.equal(typeof s.baseline.hull_beats_on_mae, "boolean", `${id}: mae beat flag boolean`);

  // Origin count must match the feasibility receipt (same harness, same data).
  assert.equal(s.origins_scored, r.origins_scored, `${id}: origins_scored matches the receipt`);
  assert.equal(s.baseline.origins_scored, r.origins_scored, `${id}: baseline scored the same origins`);

  // Hull is the last walk-forward origin's band (null when none computed).
  if (s.hull) {
    assert.ok(Number.isFinite(s.hull.low) && Number.isFinite(s.hull.high), `${id}: hull finite`);
    assert.ok(s.hull.low < s.hull.high, `${id}: hull ordered`);
    assert.equal(s.hull.public_status, "NULL", `${id}: NULL public status expected in research mode`);
    assert.ok(!s.hull.null_reasons.includes("core_erp_unidentified"), `${id}: core_erp_unidentified dropped with the band landed`);
  } else {
    assert.equal(s.walk_forward.origins_scored, 0, `${id}: hull null only when no walk-forward origin`);
  }

  // Dividend adjustment count must match the receipt.
  assert.equal(s.dividend_adjusted, r.dividend_adjusted_origins, `${id}: dividend_adjusted matches the receipt`);

  // Payout check scoping: today every adapter runs b2_admitted=false, so the
  // payout first-knowable check is scoped out and RECORDED (never silent).
  // null only when no walk-forward input built (RUT: factsheet not knowable
  // at any scored origin) — but never `true` while B2 is excluded.
  assert.notEqual(s.payout_consumed, true, `${id}: payout must never be marked consumed while B2 is excluded`);
  if (s.walk_forward.origins_scored > 0) {
    assert.equal(s.payout_consumed, false, `${id}: payout scoped out while B2 is excluded`);
  }

  // CIs are ordered when present.
  if (s.ci.coverage) assert.ok(s.ci.coverage.ci_lower <= s.ci.coverage.ci_upper, `${id}: coverage CI ordered`);
  if (s.ci.directional) assert.ok(s.ci.directional.ci_lower <= s.ci.directional.ci_upper, `${id}: directional CI ordered`);
  if (s.ci.mae) assert.ok(s.ci.mae.ci_lower <= s.ci.mae.ci_upper, `${id}: mae CI ordered`);
  if (s.baseline.ci.coverage) assert.ok(s.baseline.ci.coverage.ci_lower <= s.baseline.ci.coverage.ci_upper, `${id}: baseline coverage CI ordered`);

  // ESS reported from the receipt.
  assert.equal(s.ess_capped, r.ess.ess_capped, `${id}: ess_capped matches the receipt`);
}

// --- baseline independence: pure panel math, no Family B output -------------

// 1) The band at the artifact as-of is hand-recomputable from the raw panel.
{
  const id = "sp500";
  const cfg = INDEX_CONFIG[id];
  const panel = readJson(cfg.panel_file).sections[cfg.panel_section].data;
  const asOf = s1.per_index[id].as_of;
  const band = naiveBaselineBand(panel, asOf);
  assert.ok(band, "baseline band must exist at the scoring as-of");
  const usable = panel.filter((row) => Number.isFinite(row.px_last) && row.px_to_book_ratio > 0);
  const origin = usable.filter((row) => row.date <= asOf).at(-1);
  const book = origin.px_last / origin.px_to_book_ratio;
  // Recompute the exact P50/P25/P75 over the same window (sorted) and compare.
  const cutoff = `${Number(asOf.slice(0, 4)) - 10}${asOf.slice(4)}`;
  const win = usable.filter((row) => row.date > cutoff && row.date <= asOf);
  const sorted = win.map((row) => row.px_to_book_ratio).sort((a, b) => a - b);
  assert.ok(Math.abs(band.mid - quantile(sorted, 0.5) * book) < 1e-9, "baseline midpoint = P50(10y P/B) x book");
  assert.ok(Math.abs(band.low - quantile(sorted, 0.25) * book) < 1e-9, "baseline low = P25(10y P/B) x book");
  assert.ok(Math.abs(band.high - quantile(sorted, 0.75) * book) < 1e-9, "baseline high = P75(10y P/B) x book");

  // 2) The artifact's baseline rates equal a from-scratch recomputation that
  //    never imports the engine (panel + harness origins only).
  const origins = buildOrigins(panel, { horizonMonths: 36, stepWeeks: 13, tracker: loadTracker(cfg.tracker) });
  const scored = origins.filter((o) => o.scored && Number.isFinite(o.realized.price_return_36m));
  const rows = scoreBaseline(panel, scored);
  const coverage = rows.filter((r) => r.covered).length / rows.length;
  assert.ok(Math.abs(coverage - s1.per_index[id].baseline.coverage_rate) < 1e-9, "baseline coverage re-derived from panel alone");
}

// --- performance declaration (owner ruling 2026-08-06) ----------------------

// The restored ERP band is wired into every input-producing index, so the
// artifact is performance-evaluable; RUT (refused for the LSEG factsheet
// scope, a non-ERP reason) must not pin it back at smoke-only.
assert.equal(s1.status, "PERFORMANCE_EVALUABLE", "status must flip once every input-producing index has a band");
assert.equal(s1.performance_evaluable, true, "performance_evaluable must be true with the band landed");
assert.equal(s1.reason, null, "reason must clear once evaluable");
assert.deepEqual(s1.indices_without_core_erp, [], "no input-producing index may be missing a band");
assert.equal(s1.per_index.russell2000.walk_forward.origins_scored, 0, "precondition: RUT contributes no walk-forward origins");
assert.equal(s1.per_index.russell2000.erp_present, null, "RUT has no input, so its ERP presence is unobservable — and must not pin the flag");

// The derivation itself, pinned on synthetic per-index blocks: an index
// refused for a non-ERP reason must not count as missing ERP.
const evaluable = { walk_forward: { origins_scored: 34 }, hull: { null_reasons: ["holdout_interval_calibration_not_met"] } };
const missingErp = { walk_forward: { origins_scored: 34 }, hull: { null_reasons: ["core_erp_unidentified"] } };
const rutLike = { walk_forward: { origins_scored: 0 }, hull: null };
assert.deepEqual(derivePerformance({ sp500: evaluable, nasdaq100: evaluable, russell2000: rutLike }), {
  status: "PERFORMANCE_EVALUABLE",
  performance_evaluable: true,
  reason: null,
  indices_without_core_erp: [],
}, "RUT-like (no inputs) must not pin the artifact at smoke-only");
assert.deepEqual(derivePerformance({ sp500: missingErp, russell2000: rutLike }), {
  status: "INFRASTRUCTURE_SMOKE_ONLY",
  performance_evaluable: false,
  reason: "core_erp_absent",
  indices_without_core_erp: ["sp500"],
}, "an input-producing index without a band keeps the artifact at smoke-only");
const finiteRates = Object.values(s1.per_index).some((s) => s.coverage_rate !== null);
assert.ok(finiteRates, "precondition: some walk-forward rates are finite");
assert.equal(s1.performance_evaluable, true, "finite rates with the band landed are evaluable");

// Walk-forward band fields: hull width, point/range split, erp presence.
for (const id of indexIds) {
  const s = s1.per_index[id];
  if (s.walk_forward.origins_scored > 0) {
    assert.ok(Number.isFinite(s.walk_forward.hull_width_pct_mean), `${id}: hull width measured`);
    assert.ok(s.walk_forward.hull_width_pct_mean >= 0, `${id}: hull width non-negative`);
  } else {
    assert.equal(s.walk_forward.hull_width_pct_mean, null, `${id}: no hull width without walk-forward origins`);
  }
  assert.equal(
    s.walk_forward.point_band_origins + s.walk_forward.range_band_origins,
    s.walk_forward.origins_scored,
    `${id}: point+range band origins reconcile`,
  );
  if (s.walk_forward.origins_scored > 0) {
    assert.equal(s.erp_present, true, `${id}: ERP band present on built inputs`);
    assert.ok(s.hull.null_reasons.includes("holdout_interval_calibration_not_met"), `${id}: next blocker is the holdout calibration gate`);
    assert.ok(!s.hull.null_reasons.includes("core_erp_unidentified"), `${id}: core_erp_unidentified must have dropped away`);
  }
}

// --- SPEC §9 minimum-pass table ---------------------------------------------

{
  const pass = s1.spec9_minimum_pass;
  assert.deepEqual(pass.spec_minimums, receipt.spec_minimums, "spec minimums come from the frozen receipt");
  for (const key of ["evaluation_span_8y", "indices_passing_4", "effective_origins_30"]) {
    assert.equal(typeof pass[key].met, "boolean", `${key}: met flag boolean`);
    assert.ok(Array.isArray(pass[key].indices_meeting), `${key}: indices_meeting list`);
  }
  // Regime buckets must match the receipt's frozen assessment exactly.
  assert.deepEqual(
    [...pass.regime_buckets_20.sufficient_buckets].sort(),
    [...receipt.criteria.regime_buckets_20.buckets_meeting].sort(),
    "sufficient buckets match the receipt",
  );
  assert.deepEqual(
    [...pass.regime_buckets_20.insufficient_buckets].sort(),
    [...receipt.criteria.regime_buckets_20.buckets_insufficient].sort(),
    "insufficient buckets match the receipt",
  );
  assert.equal(pass.coverage_within_bootstrap_ci.promotion, null, "coverage criterion stays non-promotable");
  assert.equal(pass.directional_vs_naive_baseline.promotion, null, "directional criterion stays non-promotable");
}

console.log("feno-rim-v2 h2-research-scoring (baseline) tests passed");
