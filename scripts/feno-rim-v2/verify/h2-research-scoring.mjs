#!/usr/bin/env node

// FENO RIM v2 — Phase 3B: H2 research scoring on real Family B outputs,
// walk-forward per-origin hulls (SPEC v3.0 §9, research mode, no promotion).
//
// The harness (Phase 3A) pre-froze the method ids and the feasibility
// receipt; this module is the first consumer of model output, so every number
// here is explicitly research_only and nothing here can promote anything
// (promotion: null).
//
// WALK-FORWARD (owner ruling 2026-08-06): the payout first-knowable check is
// scoped to the B2 branch — the only place payout is consumed — so adapters
// now build point-in-time inputs at HISTORICAL origin dates. Each scored
// origin gets its OWN B1 diagnostic hull from the adapter at that origin's
// as-of, and the realized 36m outcome is scored against it. Origins where the
// adapter or the hull cannot compute are refused with a reason (RUT: LSEG
// factsheet not first-knowable before 2026-08-04 — its book/ROE ARE consumed,
// so its check stays; early origins: no 5/10/15y growth window yet).
//
// - Interval coverage: realized 36m LEVEL (origin price × (1+realized return))
//   inside that origin's hull [low, high]. Directional: sign(band midpoint −
//   price) agrees with sign(realized return). MAE: mean |midpoint − realized|.
//   CIs: the harness's seeded 36-month moving-block bootstrap. ESS/span/regime
//   buckets: read from the feasibility receipt (frozen).
// - NAIVE BASELINE (independent of Family B): trailing-10y price-per-book band
//   (P25/P50/P75 × origin book) on the same origins, point-in-time.
// - Dividend adjustment: nominal dividends over the UNADJUSTED close at the
//   origin, from the sibling full-history series (canonical 40-cap fallback
//   visible via dividend_source); absent → §9 bias_unadjusted path.
//
// Deterministic for fixed inputs: fixed origin dates, seeded bootstrap, sha
// over the body excluding generated_at.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeFamilyB } from "../engine.mjs";
import { blockBootstrap36m, buildOrigins, INDEX_CONFIG, loadTracker } from "./h2-harness.mjs";
import { buildSpxInput } from "../adapters/spx-panel.mjs";
import { buildNdxInput } from "../adapters/ndx-panel.mjs";
import { buildCcmpInput } from "../adapters/ccmp-panel.mjs";
import { buildRutInput } from "../adapters/rut-panel.mjs";
import { buildKospiInput } from "../adapters/kospi-panel.mjs";
import { buildSoxInput } from "../adapters/sox-panel.mjs";
import { quantile, readJson, shiftYears } from "../adapters/panel-common.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const H2_SCORING_SCHEMA_VERSION = "feno_rim_v2_h2_research_scoring.v1";

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

// ---------------------------------------------------------------------------
// naive baseline — pure panel math, no engine, no Family B output
// ---------------------------------------------------------------------------

/**
 * Trailing-10y price-per-book band at one origin, stated precisely:
 *   P_q(px_to_book_ratio over rows in (origin − 10y, origin]) × book(origin)
 * with band endpoints P25/P75 and midpoint P50. Rows before the panel start
 * simply do not exist; the window is truncated and flagged.
 */
export function naiveBaselineBand(panelRows, originAsOf) {
  const usable = panelRows.filter((row) => Number.isFinite(row.px_last) && row.px_to_book_ratio > 0);
  const origin = usable.filter((row) => row.date <= originAsOf).at(-1);
  if (!origin) return null;
  const cutoff = shiftYears(originAsOf, -10);
  const window = usable.filter((row) => row.date > cutoff && row.date <= originAsOf);
  if (window.length === 0) return null;
  const pbs = window.map((row) => row.px_to_book_ratio).sort((a, b) => a - b);
  const book = origin.px_last / origin.px_to_book_ratio;
  return {
    as_of: originAsOf,
    price: origin.px_last,
    book,
    window_rows: window.length,
    truncated: window[0].date > cutoff,
    p25: quantile(pbs, 0.25),
    p50: quantile(pbs, 0.5),
    p75: quantile(pbs, 0.75),
    low: quantile(pbs, 0.25) * book,
    mid: quantile(pbs, 0.5) * book,
    high: quantile(pbs, 0.75) * book,
  };
}

/** Coverage / directional / MAE scores of the baseline on the scored origins. */
export function scoreBaseline(panelRows, scoredOrigins) {
  const rows = [];
  for (const o of scoredOrigins) {
    const band = naiveBaselineBand(panelRows, o.as_of);
    if (!band) continue;
    const realizedReturn = o.realized.dividend_adjusted_return_36m ?? o.realized.price_return_36m;
    const realizedLevel = o.inputs.px_last * (1 + realizedReturn);
    const covered = realizedLevel >= band.low && realizedLevel <= band.high;
    const dirSign = Math.sign(band.mid / band.price - 1);
    const agree = dirSign !== 0 && Math.sign(realizedReturn) === dirSign;
    rows.push({
      as_of: o.as_of,
      covered,
      agree,
      mae_level: Math.abs(band.mid - realizedLevel),
      band,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// walk-forward Family B scoring + baseline comparison
// ---------------------------------------------------------------------------

function refusalKey(error) {
  const msg = String(error?.message ?? error);
  if (msg.includes("not first-knowable")) return "lseg_factsheet_not_first_knowable";
  if (msg.includes("stale")) return "kr_rate_stale";
  if (msg.includes("look-ahead")) return "look_ahead";
  return "adapter_refused";
}

function walkForwardScore(indexId, cfg, build, receipt) {
  const panelRows = readJson(cfg.panel_file).sections[cfg.panel_section].data;
  const tracker = loadTracker(cfg.tracker);
  const origins = buildOrigins(panelRows, { horizonMonths: 36, stepWeeks: 13, tracker });
  const scored = origins.filter((o) => o.scored && Number.isFinite(o.realized.price_return_36m));

  const rows = [];
  const refusals = {};
  let lastHull = null;
  let lastAsOf = null;
  let lastInput = null;
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
    const realizedReturn = o.realized.dividend_adjusted_return_36m ?? o.realized.price_return_36m;
    const realizedLevel = o.inputs.px_last * (1 + realizedReturn);
    const mid = (hull.low + hull.high) / 2;
    const upsideMid = mid / input.price - 1;
    const covered = realizedLevel >= hull.low && realizedLevel <= hull.high;
    const dirSign = Math.sign(upsideMid);
    const agree = dirSign !== 0 && Math.sign(realizedReturn) === dirSign;
    rows.push({
      as_of: o.as_of,
      hull_low: hull.low,
      hull_high: hull.high,
      covered,
      agree,
      mae_level: Math.abs(mid - realizedLevel),
    });
    lastHull = hull;
    lastAsOf = o.as_of;
    lastInput = input;
  }

  const mean = (values) => (values.length ? values.reduce((s, x) => s + x, 0) / values.length : null);
  const coverageRate = mean(rows.map((r) => (r.covered ? 1 : 0)));
  const directionalRate = mean(rows.map((r) => (r.agree ? 1 : 0)));
  const maeLevel = mean(rows.map((r) => r.mae_level));
  const dividendAdjusted = scored.filter((o) => o.realized.bias_unadjusted === null).length;

  const bootstrap = (values) => (values.length ? blockBootstrap36m(values) : null);
  const receiptIdx = receipt?.indices?.[indexId];

  // Naive baseline on the SAME scored origins (pure panel math; no engine).
  const baselineRows = scoreBaseline(panelRows, scored);
  const baselineCoverage = mean(baselineRows.map((r) => (r.covered ? 1 : 0)));
  const baselineDirectional = mean(baselineRows.map((r) => (r.agree ? 1 : 0)));
  const baselineMae = mean(baselineRows.map((r) => r.mae_level));

  const rates = {
    coverage_rate: round6(coverageRate),
    directional_rate: round6(directionalRate),
    mae_level: round6(maeLevel),
    ci: {
      coverage: bootstrap(rows.map((r) => (r.covered ? 1 : 0))),
      directional: bootstrap(rows.map((r) => (r.agree ? 1 : 0))),
      mae: bootstrap(rows.map((r) => r.mae_level)),
    },
  };

  return {
    as_of: lastAsOf,
    price: lastInput?.price ?? null,
    hull: lastHull
      ? {
          low: lastHull.low,
          high: lastHull.high,
          public_status: "NULL",
          null_reasons: ["core_erp_unidentified"],
        }
      : null,
    walk_forward: {
      origins_scored: rows.length,
      refused_total: scored.length - rows.length,
      refusals,
      ...rates,
    },
    // Top-level rates = walk-forward rates (research).
    ...rates,
    origins_scored: scored.length,
    dividend_adjusted: dividendAdjusted,
    bias_unadjusted_origins: scored.length - dividendAdjusted,
    // Which dividend series fed the adjustment: the sibling's full history
    // when present, else the canonical 40-entry cap — never silent.
    dividend_source: tracker.unadjusted?.file_exists
      ? (tracker.unadjusted.dividend_source ?? "canonical_40_cap")
      : "sibling_absent",
    ess_capped: receiptIdx?.ess?.ess_capped ?? null,
    payout_consumed: lastInput?.payout_consumed ?? null,
    baseline: {
      origins_scored: baselineRows.length,
      coverage_rate: round6(baselineCoverage),
      directional_rate: round6(baselineDirectional),
      mae_level: round6(baselineMae),
      ci: {
        coverage: bootstrap(baselineRows.map((r) => (r.covered ? 1 : 0))),
        directional: bootstrap(baselineRows.map((r) => (r.agree ? 1 : 0))),
        mae: bootstrap(baselineRows.map((r) => r.mae_level)),
      },
      hull_beats_on_coverage: coverageRate !== null && baselineCoverage !== null && coverageRate >= baselineCoverage,
      hull_beats_on_mae: baselineMae !== null && maeLevel !== null && maeLevel < baselineMae,
    },
  };
}

// ---------------------------------------------------------------------------
// SPEC v3.0 §9 minimum-pass table (frozen feasibility-receipt thresholds only)
// ---------------------------------------------------------------------------

function buildSpec9Table(receipt) {
  const minimums = receipt.spec_minimums;
  const indices = receipt.indices;
  const ids = Object.keys(indices);
  const spanOk = ids.filter((id) => indices[id].evaluation_span_years >= minimums.evaluation_span_years);
  const essOk = ids.filter((id) => indices[id].ess.ess_capped >= minimums.effective_origins_per_index);
  const spanAndEss = ids.filter((id) => spanOk.includes(id) && essOk.includes(id));

  const bucketIds = ["high_rate", "low_rate", "crisis_2008_09", "crisis_2020_03"];
  const sufficient = [];
  const insufficient = [];
  for (const id of ids) {
    for (const b of bucketIds) {
      if (indices[id].regime_buckets[b].sufficient) sufficient.push(`${id}.${b}`);
      else insufficient.push(`${id}.${b}`);
    }
  }

  return {
    spec_minimums: minimums,
    evaluation_span_8y: {
      minimum: "evaluation span >= 8 years",
      met: spanOk.length >= minimums.indices_passing,
      indices_meeting: spanOk,
    },
    indices_passing_4: {
      minimum: ">= 4 indices pass individually (span + effective origins)",
      met: spanAndEss.length >= minimums.indices_passing,
      indices_meeting: spanAndEss,
    },
    effective_origins_30: {
      minimum: ">= 30 effective origins per index",
      met: essOk.length >= minimums.indices_passing,
      indices_meeting: essOk,
    },
    regime_buckets_20: {
      minimum: "each regime bucket >= 20 effective origins or reported insufficient and excluded from the pass count",
      met: sufficient.length > 0,
      sufficient_buckets: sufficient,
      insufficient_buckets: insufficient,
    },
    coverage_within_bootstrap_ci: {
      minimum: "interval coverage within bootstrap CI of the nominal level",
      nominal_level: 0.95,
      research_only: true,
      promotion: null,
    },
    directional_vs_naive_baseline: {
      minimum: "directional rate beats the naive baseline on the same origins",
      research_only: true,
      promotion: null,
    },
  };
}

export function buildResearchScoring({ generatedAt = new Date().toISOString() } = {}) {
  const receipt = readJson("data/computed/feno-rim-v2/h2-feasibility-receipt.json");

  const perIndex = {};
  const gaps = [];
  for (const [indexId, cfg] of Object.entries(INDEX_CONFIG)) {
    const build = INDEX_ADAPTERS[indexId];
    if (!build) throw new Error(`h2-research-scoring: no adapter for ${indexId}`);
    const scored = walkForwardScore(indexId, cfg, build, receipt);
    perIndex[indexId] = scored;
    if (scored.dividend_adjusted === 0) {
      gaps.push(`${indexId}: no dividend-adjusted origin scored (raw price return used, bias_unadjusted=dividend_series_absent)`);
    }
    const refused = scored.walk_forward.refused_total;
    if (refused > 0) {
      gaps.push(`${indexId}: ${refused}/${scored.origins_scored} scored origins refused in walk-forward (${JSON.stringify(scored.walk_forward.refusals)})`);
    }
  }
  gaps.push("walk-forward: per-origin B1 hulls at each origin's as-of (payout check scoped to the B2 branch per owner ruling; RUT keeps its consumed LSEG factsheet check)");

  const baselineComparison = {
    method: "naive baseline = trailing-10y price-per-book distribution (P25/P50/P75) × origin book; same scored origins as the hull",
    per_index: Object.fromEntries(
      Object.entries(perIndex).map(([id, s]) => [
        id,
        {
          hull: { coverage_rate: s.coverage_rate, directional_rate: s.directional_rate, mae_level: s.mae_level },
          baseline: { coverage_rate: s.baseline.coverage_rate, directional_rate: s.baseline.directional_rate, mae_level: s.baseline.mae_level, origins_scored: s.baseline.origins_scored },
          hull_beats_baseline_on_coverage: s.baseline.hull_beats_on_coverage,
          hull_beats_baseline_on_mae: s.baseline.hull_beats_on_mae,
        },
      ]),
    ),
  };

  // SMOKE-ONLY DECLARATION (owner ruling 2026-08-06): until a core ERP band
  // lands, the walk-forward rates are infrastructure smoke, never performance.
  // Derived, not hard-coded: the moment an erp_band stops being absent the
  // artifact flips to performance-evaluable on its own.
  // Per index first: ERP is restored market by market, so a partially
  // restored run must not read as evaluable for the indices still missing it.
  const indicesWithoutErp = Object.entries(perIndex)
    .filter(([, s]) => !s.hull || s.hull.null_reasons.includes("core_erp_unidentified"))
    .map(([id]) => id);
  // The document-level flag is the conservative one: evaluable only when every
  // index has a band. Anything looser lets one restored market make the whole
  // artifact look like a performance result.
  const erpAbsent = indicesWithoutErp.length > 0;
  const performance = {
    status: erpAbsent ? "INFRASTRUCTURE_SMOKE_ONLY" : "PERFORMANCE_EVALUABLE",
    performance_evaluable: !erpAbsent,
    reason: erpAbsent ? "core_erp_absent" : null,
    indices_without_core_erp: indicesWithoutErp,
  };
  // Stated only while it is true. A sentence that survives the change it
  // describes is how the receipt ended up demanding a refetch that had
  // already landed, twice today.
  if (erpAbsent) {
    gaps.push(
      `status=INFRASTRUCTURE_SMOKE_ONLY: core_erp_absent for ${indicesWithoutErp.join("/")} — walk-forward coverage/directional numbers are smoke, not performance, `
      + "until the restored ERP band lands (owner ruling 2026-08-06)",
    );
  }

  const body = {
    schema_version: H2_SCORING_SCHEMA_VERSION,
    phase: "3B",
    spec_ref: "docs/analysis/yoo-rim-audit/FENO_RIM_RECONSTRUCTION_SPEC_v3_0.md §9",
    research_only: true,
    promotion: null,
    ...performance,
    scoring_method:
      "walk-forward: per-origin B1 diagnostic hull (computeFamilyB, b2_admitted=false, erp_band=null) at each scored origin's as-of, "
      + "realized level inside that origin's hull, directional agreement of the band midpoint, "
      + "MAE of band midpoint vs realized, 36m block bootstrap CIs, ESS from the feasibility receipt; "
      + "naive baseline (trailing-10y P/B band) on the same origins, independent of Family B output",
    per_index: perIndex,
    baseline_comparison: baselineComparison,
    spec9_minimum_pass: buildSpec9Table(receipt),
    data_gaps: gaps,
  };
  const scoringSha = sha256(JSON.stringify(body));
  return { ...body, generated_at: generatedAt, scoring_sha256: scoringSha };
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  const scoring = buildResearchScoring();
  const outDir = path.join(ROOT, "data/computed/feno-rim-v2");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "h2-research-scoring.json"), `${JSON.stringify(scoring, null, 2)}\n`);
  console.log("=== walk-forward hull vs naive baseline (coverage / directional / mae) ===");
  for (const [id, s] of Object.entries(scoring.per_index)) {
    const b = s.baseline;
    console.log(
      `${id}: wf ${s.walk_forward.origins_scored}/${s.origins_scored} (refused ${JSON.stringify(s.walk_forward.refusals)}) `
      + `hull ${s.coverage_rate}/${s.directional_rate}/${s.mae_level} vs base ${b.coverage_rate}/${b.directional_rate}/${b.mae_level} `
      + `-> cov ${b.hull_beats_on_coverage ? "BEAT" : "lose"}, mae ${b.hull_beats_on_mae ? "BEAT" : "lose"}`,
    );
  }
  const pass = scoring.spec9_minimum_pass;
  for (const key of ["evaluation_span_8y", "indices_passing_4", "effective_origins_30", "regime_buckets_20"]) {
    console.log(`§9 ${key}: met=${pass[key].met}`);
  }
  console.log(`scoring sha256: ${scoring.scoring_sha256.slice(0, 16)}… written: ${path.join(outDir, "h2-research-scoring.json")}`);
}
