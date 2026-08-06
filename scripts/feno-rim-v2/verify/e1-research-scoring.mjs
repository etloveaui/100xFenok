#!/usr/bin/env node

// FENO RIM v2 — E1: origin V/P (valuation gap) vs subsequent 36-month
// ANNUALISED total return (owner ruling 2026-08-06, second pass; delivered via
// feno-handoff fh-20260806-123-cc-1f98a6d2).
//
// The static 36-month level-coverage framing measured the wrong thing and is
// DEMOTED here to a diagnostic field (still emitted, never the verdict). The
// primary evaluation is the time-unit-aligned one: V/P at the origin against
// the subsequent 36-month annualised dividend-adjusted total return.
//
// FAIL-CLOSED FREEZE: this scorer refuses to run unless the failure criteria
// artifact (data/computed/feno-rim-v2/e1-failure-criteria.json, emitted by
// e1-criteria.mjs BEFORE any E1 result existed) is present and its sha matches
// the frozen constant. The verdict is applied by the frozen criteria, never
// redefined here.
//
// Per index, on the SAME walk-forward origins h2-research-scoring scores:
//   - model:     V/P = computeFamilyB value_hull midpoint / origin price
//   - baseline:  V/P = trailing-10y P/B P50 x origin book / origin price
//                (naiveBaselineBand, pure panel math, identical origin set)
//   - realized:  annualised 36m dividend-adjusted total return
//   - metrics:   decile calibration, Spearman rho + moving-block bootstrap CI,
//                directional rate + CI, rate/regime bucket stability
//   - diagnostic: static 36m interval coverage, hull width, MAE (demoted)
//
// Deterministic for fixed inputs: fixed origin dates, seeded bootstrap, sha
// over the body excluding generated_at.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeFamilyB } from "../engine.mjs";
import { blockBootstrap36m, buildOrigins, CRISIS_WINDOWS, INDEX_CONFIG, loadTracker, mulberry32, parseDateMs } from "./h2-harness.mjs";
import { buildSpxInput } from "../adapters/spx-panel.mjs";
import { buildNdxInput } from "../adapters/ndx-panel.mjs";
import { buildCcmpInput } from "../adapters/ccmp-panel.mjs";
import { buildRutInput } from "../adapters/rut-panel.mjs";
import { buildKospiInput } from "../adapters/kospi-panel.mjs";
import { buildSoxInput } from "../adapters/sox-panel.mjs";
import { quantile, readJson } from "../adapters/panel-common.mjs";
import { naiveBaselineBand } from "./h2-research-scoring.mjs";
import { buildFailureCriteria, E1_FOUR_US_INDICES, E1_CRITERIA_SCHEMA_VERSION } from "../e1-criteria.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const E1_SCORING_SCHEMA_VERSION = "feno_rim_v2_e1_research_scoring.v1";

const INDEX_ADAPTERS = Object.freeze({
  sp500: buildSpxInput,
  nasdaq100: buildNdxInput,
  nasdaq_composite: buildCcmpInput,
  russell2000: buildRutInput,
  kospi: buildKospiInput,
  philadelphia_semi: buildSoxInput,
});

const round6 = (x) => (x === null || x === undefined ? null : Math.round(x * 1e6) / 1e6);
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

const BOOTSTRAP = Object.freeze({ blockQuarters: 12, reps: 2000, seed: 0x2026_0806 });

// ---------------------------------------------------------------------------
// frozen criteria gate (fail-closed)
// ---------------------------------------------------------------------------

export function loadFrozenCriteria() {
  const file = path.join(ROOT, "data/computed/feno-rim-v2/e1-failure-criteria.json");
  if (!fs.existsSync(file)) {
    throw new Error("E1 failure criteria are not frozen: run scripts/feno-rim-v2/e1-criteria.mjs FIRST, before any E1 result exists");
  }
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  if (saved.schema_version !== E1_CRITERIA_SCHEMA_VERSION) {
    throw new Error(`E1 criteria schema mismatch: artifact ${saved.schema_version}, code ${E1_CRITERIA_SCHEMA_VERSION}`);
  }
  if (saved.frozen_pre_result !== true) {
    throw new Error("E1 criteria artifact lacks frozen_pre_result: true — freeze invalid");
  }
  const expected = buildFailureCriteria();
  if (saved.criteria_sha256 !== expected.criteria_sha256) {
    throw new Error("E1 criteria artifact sha mismatch vs frozen constant — refuse to score against drifted criteria");
  }
  return saved;
}

// ---------------------------------------------------------------------------
// statistics (deterministic)
// ---------------------------------------------------------------------------

// Spearman rank correlation with average ranks for ties.
export function spearmanRho(xs, ys) {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const rank = (values) => {
    const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const ranks = new Array(values.length);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j += 1;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k += 1) ranks[order[k][1]] = avg;
      i = j + 1;
    }
    return ranks;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  let sumD2 = 0;
  for (let i = 0; i < n; i += 1) sumD2 += (rx[i] - ry[i]) ** 2;
  // Pearson on ranks — handles ties via average ranks (Spearman variant).
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i += 1) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx2 += (rx[i] - mx) ** 2;
    dy2 += (ry[i] - my) ** 2;
  }
  if (dx2 === 0 || dy2 === 0) return null;
  return num / Math.sqrt(dx2 * dy2);
}

// Moving-block bootstrap of Spearman rho over CONSECUTIVE origin pairs
// (same block semantics as blockBootstrap36m: overlapping 36m windows make
// adjacent origins dependent). Seeded => deterministic.
export function blockBootstrapRho(pairs, { blockQuarters = 12, reps = 2000, seed = 0x2026_0806, alpha = 0.05 } = {}) {
  const n = pairs.length;
  if (n < 2) return null;
  const b = Math.max(1, Math.min(blockQuarters, n));
  const blocksPerRep = Math.ceil(n / b);
  const rng = mulberry32(seed);
  const repRhOs = new Float64Array(reps);
  for (let r = 0; r < reps; r += 1) {
    const xs = [];
    const ys = [];
    for (let k = 0; k < blocksPerRep && xs.length < n; k += 1) {
      const start = Math.floor(rng() * (n - b + 1));
      for (let j = 0; j < b && xs.length < n; j += 1) {
        xs.push(pairs[start + j].x);
        ys.push(pairs[start + j].y);
      }
    }
    repRhOs[r] = spearmanRho(xs, ys) ?? 0;
  }
  repRhOs.sort();
  const quantileAt = (p) => repRhOs[Math.min(reps - 1, Math.floor(p * reps))];
  const mean = repRhOs.reduce((s, v) => s + v, 0) / reps;
  return Object.freeze({
    mean: round6(mean),
    ci_lower: round6(quantileAt(alpha / 2)),
    ci_upper: round6(quantileAt(1 - alpha / 2)),
    ci_level: round6(1 - alpha),
    n,
    block_size_quarters: b,
    reps,
    seed,
    method: "moving_block_bootstrap_36m_on_origin_pairs",
  });
}

// Decile calibration: rank by predicted V/P, mean realized annualised return
// per decile (nearest-rank deciles; ties stay in order, n is reported).
export function decileCalibration(pairs, { buckets = 10 } = {}) {
  if (pairs.length < 2) return null;
  const sorted = [...pairs].sort((a, b) => a.x - b.x);
  const out = [];
  for (let d = 0; d < buckets; d += 1) {
    const members = sorted.filter((_, i) => Math.floor((i * buckets) / sorted.length) === d);
    if (members.length === 0) continue;
    const meanY = members.reduce((s, p) => s + p.y, 0) / members.length;
    out.push({
      decile: d + 1,
      n: members.length,
      vp_min: round6(members[0].x),
      vp_max: round6(members[members.length - 1].x),
      mean_annualised_return_36m: round6(meanY),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// regime buckets — identical semantics to the feasibility receipt
// (origin-date membership, receipt rf quantiles, §9 crisis windows)
// ---------------------------------------------------------------------------

function rfAt(rfRows, ms) {
  let value = null;
  for (const row of rfRows) {
    if (row.ms <= ms) value = row.value;
    else break;
  }
  return value;
}

function labelRegimeBuckets(cfg, receiptIndex, pairs) {
  const rfDoc = readJson("data/macro/fred-banking-daily.json");
  const rfRows = (rfDoc.series[cfg.rf_series] ?? [])
    .filter((row) => Number.isFinite(row.value))
    .map((row) => ({ ms: parseDateMs(row.date), value: row.value }))
    .sort((a, b) => a.ms - b.ms);
  const q13 = receiptIndex?.regime_buckets?.rf_quantiles?.q_one_third ?? null;
  const q23 = receiptIndex?.regime_buckets?.rf_quantiles?.q_two_thirds ?? null;
  const buckets = [
    { id: "high_rate", test: (rf, ms) => rf !== null && q23 !== null && rf >= q23 },
    { id: "low_rate", test: (rf, ms) => rf !== null && q13 !== null && rf <= q13 },
    { id: "crisis_2008_09", test: (rf, ms) => ms >= parseDateMs(CRISIS_WINDOWS[0].start) && ms <= parseDateMs(CRISIS_WINDOWS[0].end) },
    { id: "crisis_2020_03", test: (rf, ms) => ms >= parseDateMs(CRISIS_WINDOWS[1].start) && ms <= parseDateMs(CRISIS_WINDOWS[1].end) },
  ];
  return buckets.map((b) => {
    const members = pairs.filter((p) => b.test(rfAt(rfRows, parseDateMs(p.as_of)), parseDateMs(p.as_of)));
    const rho = members.length >= 2 ? spearmanRho(members.map((p) => p.x), members.map((p) => p.y)) : null;
    return {
      bucket: b.id,
      n: members.length,
      evaluable: members.length >= 5,
      spearman_rho: round6(rho),
    };
  });
}

// ---------------------------------------------------------------------------
// E1 walk-forward scoring
// ---------------------------------------------------------------------------

function refusalKey(error) {
  const msg = String(error?.message ?? error);
  if (msg.includes("not first-knowable")) return "lseg_factsheet_not_first_knowable";
  if (msg.includes("stale")) return "kr_rate_stale";
  if (msg.includes("look-ahead")) return "look_ahead";
  return "adapter_refused";
}

export function e1ScoreIndex(indexId, cfg, build, receipt) {
  const panelRows = readJson(cfg.panel_file).sections[cfg.panel_section].data;
  const tracker = loadTracker(cfg.tracker);
  const origins = buildOrigins(panelRows, { horizonMonths: 36, stepWeeks: 13, tracker });
  const scored = origins.filter((o) => o.scored && Number.isFinite(o.realized.price_return_36m));

  const rows = [];
  const refusals = {};
  for (const o of scored) {
    let input;
    try {
      input = build(o.as_of);
    } catch (error) {
      const key = refusalKey(error);
      refusals[key] = (refusals[key] ?? 0) + 1;
      continue;
    }
    const result = computeFamilyB(input);
    const hull = result.value_hull;
    if (!Number.isFinite(hull.low) || !Number.isFinite(hull.high)) {
      const key = hull.low === Number.POSITIVE_INFINITY ? "no_growth_window" : "hull_not_finite";
      refusals[key] = (refusals[key] ?? 0) + 1;
      continue;
    }
    const cumulativeReturn = o.realized.dividend_adjusted_return_36m ?? o.realized.price_return_36m;
    const annualised = (1 + cumulativeReturn) ** (1 / 3) - 1;
    const mid = (hull.low + hull.high) / 2;
    const vpModel = mid / input.price;
    const realizedLevel = o.inputs.px_last * (1 + cumulativeReturn);
    const baselineBand = naiveBaselineBand(panelRows, o.as_of);
    const vpBaseline = baselineBand ? baselineBand.mid / baselineBand.price : null;
    const agreeModel = vpModel > 1 ? Math.sign(annualised) > 0 : vpModel < 1 ? Math.sign(annualised) < 0 : null;
    const agreeBaseline = vpBaseline === null ? null : vpBaseline > 1 ? Math.sign(annualised) > 0 : vpBaseline < 1 ? Math.sign(annualised) < 0 : null;
    rows.push({
      as_of: o.as_of,
      price: input.price,
      vp_model: round6(vpModel),
      vp_baseline: vpBaseline === null ? null : round6(vpBaseline),
      hull_low: hull.low,
      hull_high: hull.high,
      hull_width_pct: round6(((hull.high - hull.low) / input.price) * 100),
      realized_cumulative_36m: round6(cumulativeReturn),
      realized_annualised_36m: round6(annualised),
      bias_unadjusted: o.realized.bias_unadjusted,
      covered: realizedLevel >= hull.low && realizedLevel <= hull.high,
      agree_model: agreeModel,
      agree_baseline: agreeBaseline,
      mae_level: Math.abs(mid - realizedLevel),
    });
  }

  const mean = (values) => (values.length ? values.reduce((s, x) => s + x, 0) / values.length : null);
  const boot = (values) => (values.length ? blockBootstrap36m(values, BOOTSTRAP) : null);

  // Model metrics on ALL scored origins.
  const modelPairs = rows.map((r) => ({ x: r.vp_model, y: r.realized_annualised_36m }));
  // Identical-origin set: rows where model AND baseline V/P exist (the only
  // fair basis for the baseline comparison).
  const shared = rows.filter((r) => r.vp_model !== null && r.vp_baseline !== null);
  const sharedModelPairs = shared.map((r) => ({ x: r.vp_model, y: r.realized_annualised_36m }));
  const sharedBaselinePairs = shared.map((r) => ({ x: r.vp_baseline, y: r.realized_annualised_36m }));

  const directionalCi = (agreeFn) => {
    const values = rows.filter((r) => agreeFn(r) !== null).map((r) => (agreeFn(r) ? 1 : 0));
    return boot(values);
  };
  const agreementRate = (agreeFn) => {
    const values = rows.filter((r) => agreeFn(r) !== null).map((r) => (agreeFn(r) ? 1 : 0));
    return values.length ? round6(values.reduce((s, x) => s + x, 0) / values.length) : null;
  };
  const rateOn = (subset, agreeFn) => {
    const values = subset.filter((r) => agreeFn(r) !== null).map((r) => (agreeFn(r) ? 1 : 0));
    return values.length ? round6(values.reduce((s, x) => s + x, 0) / values.length) : null;
  };

  const receiptIdx = receipt?.indices?.[indexId] ?? null;

  const sharedModelRho = spearmanRho(sharedModelPairs.map((p) => p.x), sharedModelPairs.map((p) => p.y));
  const sharedBaselineRho = spearmanRho(sharedBaselinePairs.map((p) => p.x), sharedBaselinePairs.map((p) => p.y));
  // Regime stability on the IDENTICAL-origin set (rows carry as_of for bucket
  // membership; x/y are the V/P and annualised return pair).
  const sharedBucketPairs = shared.map((r) => ({ x: r.vp_model, y: r.realized_annualised_36m, as_of: r.as_of }));

  return {
    origins_scored: scored.length,
    walk_forward_origins: rows.length,
    refused_total: scored.length - rows.length,
    refusals,
    shared_origins: shared.length,
    bias_unadjusted_origins: rows.filter((r) => r.bias_unadjusted !== null).length,
    model: {
      n: rows.length,
      spearman_rho: round6(spearmanRho(modelPairs.map((p) => p.x), modelPairs.map((p) => p.y))),
      spearman_ci: blockBootstrapRho(modelPairs),
      directional_rate: agreementRate((r) => r.agree_model),
      directional_ci: directionalCi((r) => r.agree_model),
      decile_calibration: decileCalibration(modelPairs),
    },
    // Baseline and the model re-scored on the IDENTICAL origin set.
    identical_origins: {
      n: shared.length,
      model: {
        spearman_rho: round6(sharedModelRho),
        spearman_ci: blockBootstrapRho(sharedModelPairs),
        directional_rate: rateOn(shared, (r) => r.agree_model),
      },
      baseline: {
        spearman_rho: round6(sharedBaselineRho),
        spearman_ci: blockBootstrapRho(sharedBaselinePairs),
        directional_rate: rateOn(shared, (r) => r.agree_baseline),
        decile_calibration: decileCalibration(sharedBaselinePairs),
      },
      model_beats_baseline_on_rank: sharedModelRho !== null && sharedBaselineRho !== null ? sharedModelRho > sharedBaselineRho : null,
    },
    regime_stability: labelRegimeBuckets(cfg, receiptIdx, sharedBucketPairs),
    // DEMOTED diagnostic: static 36m interval coverage stays emitted, never a verdict.
    diagnostic: {
      interval_coverage_36m: round6(mean(rows.map((r) => (r.covered ? 1 : 0)))),
      coverage_ci: boot(rows.map((r) => (r.covered ? 1 : 0))),
      hull_width_pct_mean: round6(mean(rows.map((r) => r.hull_width_pct))),
      mae_level: round6(mean(rows.map((r) => r.mae_level))),
      demoted: true,
      demotion_reason: "static 36-month level coverage measured the wrong thing (owner ruling 2026-08-06); emitted as evidence of the earlier framing, never the verdict",
    },
  };
}

// ---------------------------------------------------------------------------
// verdict against the FROZEN criteria
// ---------------------------------------------------------------------------

export function applyFrozenVerdict(criteria, perIndex) {
  const us = E1_FOUR_US_INDICES;
  const usPresent = us.filter((id) => perIndex[id]?.identical_origins?.n >= 2);
  const missing = us.filter((id) => !usPresent.includes(id));

  const rhoOf = (id, side) => {
    const block = side === "model" ? perIndex[id].identical_origins.model : perIndex[id].identical_origins.baseline;
    return block.spearman_rho;
  };
  const rhoPerIndex = Object.fromEntries(usPresent.map((id) => [id, { model: rhoOf(id, "model"), baseline: rhoOf(id, "baseline") }]));

  // Criterion 1: rank relationship <= 0 in >= 3 of the four US indices.
  const rankNonPositive = usPresent.filter((id) => rhoOf(id, "model") !== null && rhoOf(id, "model") <= 0);
  const failRank = rankNonPositive.length >= 3;

  // Criterion 2: worse than the baseline (identical origins; tie is not a beat).
  const lostToBaseline = usPresent.filter((id) => {
    const m = rhoOf(id, "model");
    const b = rhoOf(id, "baseline");
    return m !== null && b !== null && m < b;
  });
  const failBaseline = lostToBaseline.length >= 3;

  // Criterion 3: no regime stability — rho <= 0 in >= half of the evaluable
  // (index, bucket) cells with >= 5 origins on the four US indices.
  const cells = [];
  for (const id of usPresent) {
    for (const cell of perIndex[id].regime_stability) {
      if (cell.evaluable) cells.push({ index: id, bucket: cell.bucket, rho: cell.spearman_rho });
    }
  }
  const nonPositiveCells = cells.filter((c) => c.rho !== null && c.rho <= 0);
  const failRegime = cells.length >= 2 && nonPositiveCells.length * 2 >= cells.length;
  const regimeInsufficient = cells.length < 2;

  const failures = [];
  if (failRank) failures.push("fail_rank_relationship");
  if (failBaseline) failures.push("fail_worse_than_baseline");
  if (failRegime) failures.push("fail_no_regime_stability");

  let verdict;
  if (regimeInsufficient && !failRank && !failBaseline) {
    verdict = criteria.failure_criteria.verdict.outcomes.insufficient;
  } else if (failures.length > 0) {
    verdict = criteria.failure_criteria.verdict.outcomes.fail;
  } else {
    verdict = criteria.failure_criteria.verdict.outcomes.pass;
  }

  return {
    verdict,
    rule: criteria.failure_criteria.verdict.rule,
    criteria_frozen_sha256: criteria.criteria_sha256,
    four_us_indices_scored: usPresent,
    four_us_indices_without_origins: missing,
    rho_per_index: rhoPerIndex,
    rank_relationship: {
      rule: criteria.failure_criteria.fail_rank_relationship.owner_rule,
      indices_with_rho_non_positive: rankNonPositive,
      fail: failRank,
    },
    worse_than_baseline: {
      rule: criteria.failure_criteria.fail_worse_than_baseline.owner_rule,
      indices_losing_to_baseline: lostToBaseline,
      fail: failBaseline,
    },
    regime_stability: {
      rule: criteria.failure_criteria.fail_no_regime_stability.owner_rule,
      evaluable_cells: cells,
      non_positive_cells: nonPositiveCells,
      insufficient_data: regimeInsufficient,
      fail: failRegime,
    },
    triggered_failures: failures,
  };
}

// ---------------------------------------------------------------------------
// artifact build
// ---------------------------------------------------------------------------

export function buildE1Scoring({ generatedAt = new Date().toISOString() } = {}) {
  const criteria = loadFrozenCriteria();
  const receipt = readJson("data/computed/feno-rim-v2/h2-feasibility-receipt.json");

  const perIndex = {};
  const gaps = [];
  for (const [indexId, cfg] of Object.entries(INDEX_CONFIG)) {
    const build = INDEX_ADAPTERS[indexId];
    if (!build) throw new Error(`e1-research-scoring: no adapter for ${indexId}`);
    const scored = e1ScoreIndex(indexId, cfg, build, receipt);
    perIndex[indexId] = scored;
    const refused = scored.refused_total;
    if (refused > 0) {
      gaps.push(`${indexId}: ${refused}/${scored.origins_scored} scored origins refused in walk-forward (${JSON.stringify(scored.refusals)})`);
    }
    if (scored.bias_unadjusted_origins > 0) {
      gaps.push(`${indexId}: ${scored.bias_unadjusted_origins} origins on raw price return (bias_unadjusted), annualised from price return only`);
    }
  }

  const verdict = applyFrozenVerdict(criteria, perIndex);

  const body = {
    schema_version: E1_SCORING_SCHEMA_VERSION,
    phase: "E1",
    owner_ruling_ref: criteria.owner_ruling.ref,
    research_only: true,
    promotion: null,
    frozen_criteria: {
      artifact: "data/computed/feno-rim-v2/e1-failure-criteria.json",
      criteria_sha256: criteria.criteria_sha256,
      frozen_pre_result: criteria.frozen_pre_result,
    },
    scoring_method:
      "origin V/P (computeFamilyB hull midpoint / price, b2_admitted=false, erp_band point-in-time at origin) "
      + "vs subsequent 36m annualised dividend-adjusted total return; same-origin historical P/B baseline "
      + "(trailing-10y P/B P50 x book / price) on IDENTICAL origins; decile calibration, Spearman rho with "
      + "moving-block bootstrap CI, directional rate, rate/regime bucket stability per the frozen criteria; "
      + "static 36m interval coverage demoted to diagnostic",
    per_index: perIndex,
    verdict,
    data_gaps: gaps,
  };
  const scoringSha = sha256(JSON.stringify(body));
  return { ...body, generated_at: generatedAt, scoring_sha256: scoringSha };
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  const scoring = buildE1Scoring();
  const outDir = path.join(ROOT, "data/computed/feno-rim-v2");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "e1-research-scoring.json"), `${JSON.stringify(scoring, null, 2)}\n`);
  console.log("=== E1: origin V/P vs 36m annualised total return (identical origins: model vs baseline) ===");
  for (const [id, s] of Object.entries(scoring.per_index)) {
    if (s.identical_origins.n === 0) {
      console.log(`${id}: no scored origins (refused ${JSON.stringify(s.refusals)})`);
      continue;
    }
    const m = s.identical_origins.model;
    const b = s.identical_origins.baseline;
    console.log(
      `${id}: n=${s.identical_origins.n} model rho ${m.spearman_rho} [${m.spearman_ci.ci_lower},${m.spearman_ci.ci_upper}] `
      + `dir ${m.directional_rate} | baseline rho ${b.spearman_rho} [${b.spearman_ci.ci_lower},${b.spearman_ci.ci_upper}] `
      + `dir ${b.directional_rate} | beat_rank=${s.identical_origins.model_beats_baseline_on_rank}`
    );
  }
  console.log(`E1 verdict: ${scoring.verdict.verdict} (${JSON.stringify(scoring.verdict.triggered_failures)})`);
  console.log(`scoring sha256: ${scoring.scoring_sha256.slice(0, 16)}… written: ${path.join(outDir, "e1-research-scoring.json")}`);
}
