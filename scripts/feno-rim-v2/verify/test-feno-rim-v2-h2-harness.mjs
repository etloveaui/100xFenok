#!/usr/bin/env node

// Tests for the Phase 3A H2 market-validity harness (SPEC v3.0 §9).
// Synthetic leak/embargo/bootstrap/ESS behavior is tested on fabricated
// series; real-data smoke tests build origins for all six indices and assert
// the feasibility receipt is deterministic and free of model output.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  INDEX_CONFIG,
  H2_SCHEMA_VERSION,
  SPEC_MINIMUMS,
  buildOrigins,
  purgeEmbargo,
  blockBootstrap36m,
  hacNeweyWest36,
  effectiveSampleSize,
  buildFeasibilityReceipt,
  monthEndSeries,
  mulberry32,
  gauss,
  parseDateMs,
  isoDate,
} from "./h2-harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));

// --- synthetic panel builders ----------------------------------------------

// Weekly random-walk panel of nWeeks rows starting at startIso; weeklyReturn
// is a function (i) => r.
function syntheticPanel(nWeeks, startIso, weeklyReturn) {
  const start = parseDateMs(startIso);
  const rows = [];
  let px = 1000;
  for (let i = 0; i < nWeeks; i += 1) {
    rows.push({ date: isoDate(start + i * 7 * 86_400_000), px_last: Math.round(px * 1e4) / 1e4, roe: 0.1, px_to_book_ratio: 2, best_eps: 50 });
    px *= 1 + weeklyReturn(i);
  }
  return rows;
}

const originStub = (asOf) => Object.freeze({ as_of: asOf });

// ---------------------------------------------------------------------------
// 1. Synthetic leak test: a train window intersecting a scored origin's
//    evaluation window MUST be purged from that origin's selection set.
// ---------------------------------------------------------------------------
{
  const scoredOrigin = {
    as_of: "2010-01-01",
    scored: true,
    train_window: { start: "2000-01-01", end: "2010-01-01" },
    eval_window: { start: "2010-01-01", end: "2013-01-01" },
  };
  const leaking = {
    as_of: "2011-06-01",
    scored: false,
    train_window: { start: "2009-06-01", end: "2011-06-01" }, // intersects [2010-01-01, 2013-01-01]
    eval_window: { start: "2011-06-01", end: "2014-06-01" },
  };
  const safeBefore = {
    as_of: "2006-06-01",
    scored: false,
    train_window: { start: "2000-01-01", end: "2006-06-01" }, // ends >= 36m before eval start
    eval_window: { start: "2006-06-01", end: "2009-06-01" },
  };
  const purgeGapOnly = {
    as_of: "2008-06-01",
    scored: false,
    // No intersection with the eval window, but inside the >=36m purge gap.
    train_window: { start: "2000-01-01", end: "2008-06-01" },
    eval_window: { start: "2008-06-01", end: "2011-06-01" },
  };
  const result = purgeEmbargo([scoredOrigin, leaking, safeBefore, purgeGapOnly]);
  assert.equal(result.per_origin.length, 1, "only scored origins get selection sets");
  const entry = result.per_origin[0];
  assert.ok(!entry.kept.includes(leaking.as_of), "leaking origin must NOT be kept");
  assert.ok(entry.purged.includes(leaking.as_of), "train window intersecting the eval window must be purged");
  assert.ok(!entry.kept.includes(purgeGapOnly.as_of), "origin inside the 36m purge gap must NOT be kept");
  assert.ok(entry.purged.includes(purgeGapOnly.as_of), "purge >= 36 months is enforced, not just intersection");
  assert.ok(entry.kept.includes(safeBefore.as_of), "origin ending >= 36m before the eval window is kept");
  assert.ok(entry.purged.includes(scoredOrigin.as_of), "an origin never selects itself");
}

// ---------------------------------------------------------------------------
// 2. Embargo: origins starting after the eval window but within the embargo
//    period are excluded; beyond it they are kept.
// ---------------------------------------------------------------------------
{
  const scoredOrigin = {
    as_of: "2010-01-01",
    scored: true,
    train_window: { start: "2000-01-01", end: "2010-01-01" },
    eval_window: { start: "2010-01-01", end: "2013-01-01" },
  };
  const insideEmbargo = {
    as_of: "2013-03-01",
    scored: false,
    train_window: { start: "2013-02-01", end: "2013-03-01" }, // after eval end, inside 13-week embargo
    eval_window: { start: "2013-03-01", end: "2016-03-01" },
  };
  const beyondEmbargo = {
    as_of: "2014-06-01",
    scored: false,
    train_window: { start: "2014-01-01", end: "2014-06-01" }, // starts after eval end + 13 weeks
    eval_window: { start: "2014-06-01", end: "2017-06-01" },
  };
  const entry = purgeEmbargo([scoredOrigin, insideEmbargo, beyondEmbargo]).per_origin[0];
  assert.ok(!entry.kept.includes(insideEmbargo.as_of), "embargoed origin must NOT be kept");
  assert.ok(entry.embargoed.includes(insideEmbargo.as_of), "origin inside the post-eval embargo is labelled embargoed");
  assert.ok(entry.kept.includes(beyondEmbargo.as_of), "origin beyond the embargo is kept");
}

// ---------------------------------------------------------------------------
// 3. Bootstrap CI widens when overlap increases: iid series vs series whose
//    12-quarter blocks are fully overlapping (constant within each block).
// ---------------------------------------------------------------------------
{
  const rngA = mulberry32(11);
  const iid = Array.from({ length: 96 }, () => gauss(rngA));
  const rngB = mulberry32(12);
  const overlapping = [];
  for (let b = 0; b < 8; b += 1) {
    const v = gauss(rngB);
    for (let j = 0; j < 12; j += 1) overlapping.push(v);
  }
  const ciA = blockBootstrap36m(iid, { seed: 5 });
  const ciB = blockBootstrap36m(overlapping, { seed: 5 });
  const widthA = ciA.ci_upper - ciA.ci_lower;
  const widthB = ciB.ci_upper - ciB.ci_lower;
  assert.ok(widthB > widthA, `fully overlapping blocks must widen the CI (got ${widthB} vs iid ${widthA})`);
  // Determinism: same seed reproduces the identical interval.
  assert.deepEqual(blockBootstrap36m(iid, { seed: 5 }), ciA, "seeded bootstrap must be deterministic");
  assert.equal(ciA.block_months, 36, "block size is 36 months = 12 quarterly steps");
}

// ---------------------------------------------------------------------------
// 4. ESS: iid monthly series => ESS ~= origins; AR(1)-like => ESS < origins.
// ---------------------------------------------------------------------------
{
  // iid weekly random walk -> month-end sampled returns are ~iid.
  const rng = mulberry32(21);
  const iidPanel = syntheticPanel(1040, "1990-01-05", () => gauss(rng) * 0.01);
  const iidOrigins = buildOrigins(iidPanel);
  const iidScored = iidOrigins.filter((o) => o.scored);
  const essIid = effectiveSampleSize(iidScored, iidPanel);
  assert.ok(
    essIid.ess_capped >= 0.5 * essIid.n_origins && essIid.ess_capped <= essIid.n_origins,
    `iid ESS must be ~= origins (got ${essIid.ess_capped} of ${essIid.n_origins})`,
  );

  // AR(1) phi=0.7 monthly series: sum(rho_j) ~= phi/(1-phi) ~= 2.33, so ESS
  // must shrink well below the raw origin count. Long series (2400 months)
  // keeps the tail-lag sample noise small.
  const rngAr = mulberry32(99);
  const arMonthly = [];
  let x = 0;
  for (let t = 0; t < 2400; t += 1) {
    x = 0.7 * x + gauss(rngAr);
    arMonthly.push(x);
  }
  const essAr = effectiveSampleSize(Array.from({ length: 120 }, (_, i) => originStub(`o${i}`)), arMonthly);
  assert.ok(essAr.ess_raw < 0.5 * 120, `AR(1) ESS must be well below origins (got ${essAr.ess_raw} of 120)`);
  assert.ok(essAr.sum_rho > 1, `AR(1) sum of 36 monthly autocorrelations must be large (got ${essAr.sum_rho})`);

  // Formula cross-check: origins / (1 + 2*sum_rho) with the floored denominator.
  assert.ok(Math.abs(essAr.ess_raw - 120 / Math.max(0.05, 1 + 2 * essAr.sum_rho)) < 1e-4, "ESS must equal origins/(1+2*sum rho)");
}

// ---------------------------------------------------------------------------
// 5. HAC Newey-West cross-check: structure, lag cap, and a long-run variance
//    above the iid variance for positively correlated scores.
// ---------------------------------------------------------------------------
{
  // n=240 keeps the 36-lag Newey-West estimate stable (at n=60 the long-run
  // variance estimator is too noisy to separate from the iid case).
  const rngAr = mulberry32(7);
  const arScores = [];
  let x = 0;
  for (let t = 0; t < 240; t += 1) {
    x = 0.7 * x + gauss(rngAr);
    arScores.push(x);
  }
  const hac = hacNeweyWest36(arScores);
  assert.ok(Number.isFinite(hac.se_mean) && hac.se_mean >= 0, "HAC se must be finite and non-negative");
  assert.equal(hac.lags_used, 36, "240 scores allow the full 36-lag Newey-West window");
  // HAC se must exceed the iid se (sd/sqrt(n)) under strong positive dependence.
  const mean = arScores.reduce((s, v) => s + v, 0) / arScores.length;
  const sd = Math.sqrt(arScores.reduce((s, v) => s + (v - mean) ** 2, 0) / arScores.length);
  assert.ok(hac.se_mean > sd / Math.sqrt(arScores.length), "HAC se must exceed the iid se for AR(1) scores");
  const short = hacNeweyWest36(arScores.slice(0, 10));
  assert.equal(short.lags_used, 9, "lag cap must shrink to n-1 for short series");
}

// ---------------------------------------------------------------------------
// 6. Real-data smoke: origins build for all six indices; purge keeps no
//    origin whose evaluation window overlaps the scored origin's window.
// ---------------------------------------------------------------------------
const realOrigins = {};
for (const [indexId, cfg] of Object.entries(INDEX_CONFIG)) {
  const panelRows = readJson(cfg.panel_file).sections[cfg.panel_section].data;
  const origins = buildOrigins(panelRows);
  const scored = origins.filter((o) => o.scored);
  assert.ok(origins.length >= 60, `${indexId}: expected >= 60 rolling origins, got ${origins.length}`);
  assert.ok(scored.length >= 50, `${indexId}: expected >= 50 scored origins, got ${scored.length}`);
  for (const o of scored) {
    assert.ok(Number.isFinite(o.realized.price_return_36m), `${indexId}: scored origin ${o.as_of} must have a price return`);
    assert.ok(
      o.realized.bias_unadjusted === null || o.realized.bias_unadjusted === "dividend_series_absent",
      `${indexId}: bias label must be null or the §9 dividend_series_absent label`,
    );
    assert.ok(o.inputs.first_knowable_at === o.as_of, `${indexId}: inputs are first-knowable at the origin only`);
  }
  // Purge invariant on real origins: every kept origin's evaluation window
  // ends at or before the scored origin's evaluation window starts.
  const pe = purgeEmbargo(origins);
  const byAsOf = new Map(origins.map((o) => [o.as_of, o]));
  for (const entry of pe.per_origin) {
    const evalStart = parseDateMs(entry.eval_window.start);
    for (const keptAsOf of entry.kept) {
      const kept = byAsOf.get(keptAsOf);
      assert.ok(parseDateMs(kept.eval_window.end) <= evalStart, `${indexId}: kept origin ${keptAsOf} must not overlap ${entry.as_of}`);
    }
  }
  // ESS on the real panel must clear the §9 floor for all six indices.
  const ess = effectiveSampleSize(scored, panelRows);
  assert.ok(ess.ess_capped >= SPEC_MINIMUMS.effective_origins_per_index, `${indexId}: ESS ${ess.ess_capped} below the 30-origin floor`);
  realOrigins[indexId] = { origins, scored, ess };
  console.log(`smoke ${indexId}: origins=${origins.length} scored=${scored.length} ess=${ess.ess_capped} sum_rho=${ess.sum_rho}`);
}

// ---------------------------------------------------------------------------
// 7. Feasibility receipt: determinism, frozen achievable thresholds, and no
//    model output anywhere in the artifact.
// ---------------------------------------------------------------------------
{
  const receiptA = buildFeasibilityReceipt({ generatedAt: "2026-08-06T00:00:00.000Z" });
  const receiptB = buildFeasibilityReceipt({ generatedAt: "2027-01-01T00:00:00.000Z" });
  assert.equal(receiptA.schema_version, H2_SCHEMA_VERSION);
  assert.equal(receiptA.receipt_sha256, receiptB.receipt_sha256, "same inputs must produce the same receipt sha256");
  assert.notEqual(receiptA.generated_at, receiptB.generated_at, "generated_at stays outside the hash");

  for (const indexId of Object.keys(INDEX_CONFIG)) {
    const ix = receiptA.indices[indexId];
    assert.ok(ix.origins_scored === realOrigins[indexId].scored.length, `${indexId}: receipt scored origins must match the harness`);
    assert.ok(ix.ess.ess_capped === realOrigins[indexId].ess.ess_capped, `${indexId}: receipt ESS must match the harness`);
    assert.ok(ix.evaluation_span_years >= SPEC_MINIMUMS.evaluation_span_years, `${indexId}: evaluation span must clear 8 years`);
    for (const bucket of ["high_rate", "low_rate", "crisis_2008_09", "crisis_2020_03"]) {
      assert.ok(typeof ix.regime_buckets[bucket].origins === "number", `${indexId}: regime bucket ${bucket} must be reported`);
    }
  }

  // Frozen achievable set: all four data-availability criteria are achievable
  // with today's data. For regime buckets the floor is met by the low_rate
  // bucket (37 effective origins on the US panels, >=20); high_rate,
  // crisis_2008_09 and crisis_2020_03 fall short and are reported
  // insufficient (excluded from the pass count per §9).
  assert.deepEqual(
    receiptA.achievable_thresholds_frozen,
    ["evaluation_span_8y", "indices_passing_4", "effective_origins_30", "regime_buckets_20"],
    "achievable threshold set frozen from data availability alone",
  );
  assert.equal(receiptA.criteria.regime_buckets_20.achievable_now, true, "low_rate bucket clears the 20-effective floor");
  assert.ok(
    receiptA.criteria.regime_buckets_20.buckets_meeting.every((b) => b.endsWith(".low_rate")),
    "only low_rate buckets meet the regime floor with current data",
  );
  assert.equal(receiptA.criteria.regime_buckets_20.buckets_meeting.length, Object.keys(INDEX_CONFIG).length, "every index has a sufficient low_rate bucket");
  assert.ok(
    receiptA.criteria.regime_buckets_20.buckets_insufficient.some((b) => b.endsWith(".crisis_2008_09")),
    "2008-09 crisis bucket is insufficient (panel starts 2010)",
  );
  assert.equal(receiptA.criteria.coverage_within_bootstrap_ci.achievable_now, null, "model-dependent criteria stay null in Phase 3A");
  assert.equal(receiptA.criteria.directional_vs_naive_baseline.achievable_now, null, "model-dependent criteria stay null in Phase 3A");

  // No model output anywhere: walk every key and reject fair-value/upside
  // style names; deferred criteria must carry no numeric results.
  const forbidden = /(fair_?value|upside|point_?estimate|target_?price|(?<!e)valuation|predicted_?band)/i;
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
    } else if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        assert.ok(!forbidden.test(key), `receipt must carry no model-output keys, found: ${key}`);
        walk(value);
      }
    }
  };
  walk(receiptA);
  assert.equal(receiptA.criteria.coverage_within_bootstrap_ci.value ?? null, null, "coverage criterion carries no value in Phase 3A");

  // Month-end sampling sanity on a real panel: one row per calendar month.
  const spPanel = readJson(INDEX_CONFIG.sp500.panel_file).sections.sp500.data;
  const monthly = monthEndSeries(spPanel);
  assert.equal(monthly.months.length, new Set(spPanel.map((r) => String(r.date).slice(0, 7))).size, "one month-end sample per calendar month");
  assert.equal(monthly.returns.length, monthly.months.length - 1, "monthly returns are successive month-end ratios");
}

console.log("feno-rim-v2 h2 harness tests passed");
