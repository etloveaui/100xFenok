#!/usr/bin/env node

// FENO RIM v2 — Phase 3B: H2 research scoring on real Family B outputs.
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
// - Tracker price history covers ~1y (receipt gap), so no origin carries a
//   dividend-adjusted return; scoring falls back to raw price return with the
//   §9 bias_unadjusted: dividend_series_absent label, and `dividend_adjusted`
//   is reported honestly (0 today).
// - Interval coverage: realized 36m LEVEL (origin price × (1+realized return))
//   inside the B1 hull [low, high]. Directional: sign(band midpoint − price)
//   agrees with sign(realized return). CIs: the harness's seeded 36-month
//   moving-block bootstrap. ESS: read from the feasibility receipt.
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
import { readJson } from "../adapters/panel-common.mjs";

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
      bias_unadjusted: o.realized.bias_unadjusted,
      bias_detail: o.realized.bias_detail,
    });
  }

  const coverageRate = rows.length ? rows.filter((r) => r.covered).length / rows.length : null;
  const directionalRate = rows.length ? rows.filter((r) => r.agree).length / rows.length : null;
  const biasPp = rows.length ? rows.reduce((s, r) => s + r.realized_return, 0) / rows.length - upsideMid : null;
  const dividendAdjusted = scored.filter((o) => o.realized.bias_unadjusted === null).length;

  const bootstrap = (values) => (values.length ? blockBootstrap36m(values.map((v) => (v ? 1 : 0))) : null);
  const receiptIdx = receipt?.indices?.[indexId];

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
    ci: {
      coverage: bootstrap(rows.map((r) => r.covered)),
      directional: bootstrap(rows.map((r) => r.agree)),
    },
    ess_capped: receiptIdx?.ess?.ess_capped ?? null,
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
  gaps.push("hull is computed at the latest point-in-time asOf per index, not walk-forward: adapters supply latest-vintage payout only, so per-origin historical hulls are not computable today");

  const body = {
    schema_version: H2_SCORING_SCHEMA_VERSION,
    phase: "3B",
    spec_ref: "docs/analysis/yoo-rim-audit/FENO_RIM_RECONSTRUCTION_SPEC_v3_0.md §9",
    research_only: true,
    promotion: null,
    scoring_method:
      "diagnostic B1 hull (computeFamilyB, b2_admitted=false, erp_band=null) at the latest point-in-time asOf, "
      + "scored against the harness 36m origins: realized level inside hull, directional agreement of the band midpoint, "
      + "36m block bootstrap CIs, ESS from the feasibility receipt",
    per_index: perIndex,
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
  for (const [id, s] of Object.entries(scoring.per_index)) {
    console.log(
      `${id}: as_of=${s.as_of} hull=[${s.hull.low.toFixed(0)},${s.hull.high.toFixed(0)}] origins=${s.origins_scored} `
      + `coverage=${s.coverage_rate} directional=${s.directional_rate} bias_pp=${s.bias_pp} adjusted=${s.dividend_adjusted} ess=${s.ess_capped}`,
    );
  }
  console.log(`scoring sha256: ${scoring.scoring_sha256.slice(0, 16)}… written: ${path.join(outDir, "h2-research-scoring.json")}`);
}
