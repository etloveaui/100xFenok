#!/usr/bin/env node

// FENO RIM v2 — Phase 3B: H2 research scoring on real Family B outputs,
// extended with the naive-baseline comparison and the SPEC v3.0 §9
// minimum-pass check (research mode, no promotion).
//
// SPEC v3.0 §9, research mode only. The harness (Phase 3A) pre-froze the
// method ids and the feasibility receipt; this module is the first consumer
// of model output, so every number here is explicitly research_only and
// nothing here can promote anything (promotion: null).
//
// DESIGN (honest limitations stated):
// - Per index, the B1 diagnostic hull is computed at the LATEST asOf at which
//   every adapter input is point-in-time (probed from data-derived dates;
//   adapters refuse look-ahead). The v2 adapters supply latest-vintage payout
//   only, so point-in-time hulls AT HISTORICAL origin dates are not
//   computable today — coverage therefore tests the current diagnostic band
//   against the harness's historical 36m origins, not a walk-forward.
// - NAIVE BASELINE (independent of any Family B output): at each origin, the
//   trailing-10y price-per-book distribution of the index's own panel, stated
//   precisely as
//       baseline_level(origin) = P_q(trailing 10y px_to_book_ratio) × book(origin),
//       book(origin) = px_last / px_to_book_ratio at the origin,
//   with band endpoints P25/P75 and midpoint P50. The baseline IS point-in-time
//   per origin (data ≤ origin only); the hull is current-asOf (see above).
// - Interval coverage: realized 36m LEVEL (origin price × (1+realized return))
//   inside the band [low, high]. Directional: sign(band midpoint − price)
//   agrees with sign(realized return). MAE: mean |band midpoint level −
//   realized level|. CIs: the harness's seeded 36-month moving-block
//   bootstrap. ESS/span/regime buckets: read from the feasibility receipt.
// - Tracker price history covers ~1y (receipt gap), so no origin carries a
//   dividend-adjusted return; scoring falls back to raw price return with the
//   §9 bias_unadjusted: dividend_series_absent label.
//
// Deterministic for fixed inputs: no clock in the probe, seeded bootstrap,
// sha over the body excluding generated_at (same pattern as the harness).

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

// Data-derived candidate as-of dates (no clock): the last observation date of
// every input series and every first-knowable component. The adapters' refusal
// boundaries live exactly at these dates, so the LATEST working asOf is always
// one of them, and the probe is hash-stable for fixed inputs.
export function candidateDates() {
  const dates = new Set();
  for (const cfg of Object.values(INDEX_CONFIG)) {
    const panel = readJson(cfg.panel_file).sections[cfg.panel_section].data;
    if (panel.length) dates.add(panel[panel.length - 1].date);
  }
  const fred = readJson("data/macro/fred-banking-daily.json").series;
  for (const id of ["DGS10", "IRLTLT01KRM156N"]) {
    const rows = fred[id] ?? [];
    if (rows.length) dates.add(rows[rows.length - 1].date);
  }
  const payout = readJson("data/computed/fenok-rim/payout-history.json");
  for (const entry of Object.values(payout.indices)) dates.add(entry.newest_statement_period);
  const oneq = readJson("data/computed/market_facts/tickers/ONEQ.json");
  if (oneq?.facts?.dividend_yield?.fetched_at) dates.add(String(oneq.facts.dividend_yield.fetched_at).slice(0, 10));
  const rut = readJson("data/computed/fenok-rim/russell2000-official-fundamentals.json");
  if (rut?.generated_at) dates.add(String(rut.generated_at).slice(0, 10));
  return [...dates].sort().reverse();
}

export function probeLatestAsOf(build) {
  for (const asOf of candidateDates()) {
    try {
      return { asOf, input: build(asOf) };
    } catch {
      // adapter refused (look-ahead or stale); try the next-earlier candidate
    }
  }
  throw new Error("h2-research-scoring: no working as-of for an adapter");
}

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
// Family B scoring + baseline comparison
// ---------------------------------------------------------------------------

function scoreIndex(indexId, cfg, build, receipt) {
  const { asOf, input } = probeLatestAsOf(build);
  const result = computeFamilyB(input);
  const hull = result.value_hull;

  const panelRows = readJson(cfg.panel_file).sections[cfg.panel_section].data;
  const origins = buildOrigins(panelRows, { horizonMonths: 36, stepWeeks: 13, tracker: loadTracker(cfg.tracker) });
  const scored = origins.filter((o) => o.scored && Number.isFinite(o.realized.price_return_36m));

  const upsideMid = ((hull.low + hull.high) / 2) / input.price - 1;
  const rows = [];
  for (const o of scored) {
    const realizedReturn = o.realized.dividend_adjusted_return_36m ?? o.realized.price_return_36m;
    const realizedLevel = o.inputs.px_last * (1 + realizedReturn);
    const covered = realizedLevel >= hull.low && realizedLevel <= hull.high;
    const dirSign = Math.sign(upsideMid);
    const agree = dirSign !== 0 && Math.sign(realizedReturn) === dirSign;
    rows.push({
      as_of: o.as_of,
      realized_return: round6(realizedReturn),
      realized_level: round6(realizedLevel),
      covered,
      agree,
      mae_level: Math.abs((hull.low + hull.high) / 2 - realizedLevel),
      bias_unadjusted: o.realized.bias_unadjusted,
      bias_detail: o.realized.bias_detail,
    });
  }

  const mean = (values) => (values.length ? values.reduce((s, x) => s + x, 0) / values.length : null);
  const coverageRate = mean(rows.map((r) => (r.covered ? 1 : 0)));
  const directionalRate = mean(rows.map((r) => (r.agree ? 1 : 0)));
  const maeLevel = mean(rows.map((r) => r.mae_level));
  const biasPp = mean(rows.map((r) => r.realized_return)) - upsideMid;
  const dividendAdjusted = scored.filter((o) => o.realized.bias_unadjusted === null).length;

  const bootstrap = (values) => (values.length ? blockBootstrap36m(values) : null);
  const receiptIdx = receipt?.indices?.[indexId];

  // Naive baseline on the SAME scored origins (pure panel math; no engine).
  const baselineRows = scoreBaseline(panelRows, scored);
  const baselineCoverage = mean(baselineRows.map((r) => (r.covered ? 1 : 0)));
  const baselineDirectional = mean(baselineRows.map((r) => (r.agree ? 1 : 0)));
  const baselineMae = mean(baselineRows.map((r) => r.mae_level));

  return {
    as_of: asOf,
    price: input.price,
    hull: {
      low: hull.low,
      high: hull.high,
      public_status: result.public_status,
      null_reasons: result.null_reasons,
    },
    origins_scored: scored.length,
    dividend_adjusted: dividendAdjusted,
    bias_unadjusted_origins: scored.length - dividendAdjusted,
    coverage_rate: round6(coverageRate),
    directional_rate: round6(directionalRate),
    bias_pp: round6(biasPp),
    mae_level: round6(maeLevel),
    ci: {
      coverage: bootstrap(rows.map((r) => (r.covered ? 1 : 0))),
      directional: bootstrap(rows.map((r) => (r.agree ? 1 : 0))),
      mae: bootstrap(rows.map((r) => r.mae_level)),
    },
    ess_capped: receiptIdx?.ess?.ess_capped ?? null,
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
      hull_beats_on_coverage: baselineCoverage !== null && coverageRate >= baselineCoverage,
      hull_beats_on_mae: baselineMae !== null && maeLevel < baselineMae,
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
    const scored = scoreIndex(indexId, cfg, build, receipt);
    perIndex[indexId] = scored;
    if (scored.dividend_adjusted === 0) {
      gaps.push(`${indexId}: no dividend-adjusted origin scored (tracker price history ~1y; raw price return used, bias_unadjusted=dividend_series_absent)`);
    }
  }
  gaps.push("hull is computed at the latest point-in-time asOf per index, not walk-forward: adapters supply latest-vintage payout only, so per-origin historical hulls are not computable today; the naive baseline IS per-origin point-in-time");

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

  const body = {
    schema_version: H2_SCORING_SCHEMA_VERSION,
    phase: "3B",
    spec_ref: "docs/analysis/yoo-rim-audit/FENO_RIM_RECONSTRUCTION_SPEC_v3_0.md §9",
    research_only: true,
    promotion: null,
    scoring_method:
      "diagnostic B1 hull (computeFamilyB, b2_admitted=false, erp_band=null) at the latest point-in-time asOf, "
      + "scored against the harness 36m origins: realized level inside hull, directional agreement of the band midpoint, "
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
  console.log("=== hull vs naive baseline (coverage / directional / mae) ===");
  for (const [id, s] of Object.entries(scoring.per_index)) {
    const b = s.baseline;
    console.log(
      `${id}: hull ${s.coverage_rate}/${s.directional_rate}/${s.mae_level} vs base ${b.coverage_rate}/${b.directional_rate}/${b.mae_level} `
      + `-> cov ${b.hull_beats_on_coverage ? "BEAT" : "lose"}, mae ${b.hull_beats_on_mae ? "BEAT" : "lose"}`,
    );
  }
  const pass = scoring.spec9_minimum_pass;
  for (const key of ["evaluation_span_8y", "indices_passing_4", "effective_origins_30", "regime_buckets_20"]) {
    console.log(`§9 ${key}: met=${pass[key].met} (${JSON.stringify(pass[key].indices_meeting ?? pass[key].sufficient_buckets ?? [])})`);
  }
  console.log(`scoring sha256: ${scoring.scoring_sha256.slice(0, 16)}… written: ${path.join(outDir, "h2-research-scoring.json")}`);
}
