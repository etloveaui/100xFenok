#!/usr/bin/env node

// FENO RIM v2 — E2: bottom-up control on one fixed Dow-30 basket.
//
// Directive fh-20260806-134-cc-932a5122 (owner approved). E1 terminated the
// top-down index-book approach; E2 asks whether the failure is RIM itself or
// the top-down aggregation by running all THREE methods on ONE basket:
//   1. top-down  — aggregate basket book/earnings -> existing B1 engine
//   2. bottom-up — per-constituent B1 -> sum of total intrinsic values
//   3. baseline  — basket's own trailing-10y P/B multiple (E1's rule)
// Same origins as E1 (the 34 sp500 walk-forward as-ofs), same realized series
// (36m annualised dividend-adjusted total return), same metrics.
//
// FAIL-CLOSED FREEZE: refuses to run unless the success criteria artifact
// (data/computed/feno-rim-v2/e2-success-criteria.json, emitted by
// e2-criteria.mjs BEFORE any E2 number existed) is present and its sha matches
// the frozen constant. The verdict is applied by the frozen criteria only.
//
// Survivorship caveat (frozen): a fixed constituent list carries survivorship
// bias common to all three methods; the basket is not a clean index and the
// caveat bounds what E2 can conclude. It is stated in the artifact, never
// dropped.
//
// Deterministic for fixed inputs; sha over the body excluding generated_at.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeFamilyB } from "../engine.mjs";
import { CRISIS_WINDOWS, mulberry32, parseDateMs } from "./h2-harness.mjs";
import { erpWindowAt } from "../erp-band.mjs";
import { naiveBaselineBand } from "./h2-research-scoring.mjs";
import { quantile, readJson } from "../adapters/panel-common.mjs";
import { blockBootstrapRho, decileCalibration, spearmanRho } from "./e1-research-scoring.mjs";
import { buildE2Criteria, E2_CRITERIA_SCHEMA_VERSION } from "../e2-criteria.mjs";
import { buildE2Panel } from "../e2-basket-panel.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const E2_SCORING_SCHEMA_VERSION = "feno_rim_v2_e2_research_scoring.v1";

const round6 = (x) => (x === null || x === undefined ? null : Math.round(x * 1e6) / 1e6);
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");
const BOOTSTRAP = Object.freeze({ blockQuarters: 12, reps: 2000, seed: 0x2026_0806 });
const DAY_MS = 86_400_000;
const MONTH_MS = 30.4 * DAY_MS;

function lastAtOrBefore(rows, t) {
  let lo = 0;
  let hi = rows.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].ms <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans === -1 ? null : rows[ans];
}

// ---------------------------------------------------------------------------
// frozen criteria gate (fail-closed)
// ---------------------------------------------------------------------------

export function loadFrozenE2Criteria() {
  const file = path.join(ROOT, "data/computed/feno-rim-v2/e2-success-criteria.json");
  if (!fs.existsSync(file)) {
    throw new Error("E2 success criteria are not frozen: run scripts/feno-rim-v2/e2-criteria.mjs FIRST, before any E2 result exists");
  }
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  if (saved.schema_version !== E2_CRITERIA_SCHEMA_VERSION) {
    throw new Error(`E2 criteria schema mismatch: artifact ${saved.schema_version}, code ${E2_CRITERIA_SCHEMA_VERSION}`);
  }
  if (saved.frozen_pre_result !== true) {
    throw new Error("E2 criteria artifact lacks frozen_pre_result: true — freeze invalid");
  }
  const expected = buildE2Criteria();
  if (saved.criteria_sha256 !== expected.criteria_sha256) {
    throw new Error("E2 criteria artifact sha mismatch vs frozen constant — refuse to score against drifted criteria");
  }
  return saved;
}

// ---------------------------------------------------------------------------
// realized basket return (36m annualised, dividend-adjusted)
// ---------------------------------------------------------------------------

// For one origin: cap(t+36m)/cap(t) - 1 plus the aggregate dividend yield
// (sum of constituent dividends in (t, t+36m] / cap at t). Returns null when
// the basket series does not reach the horizon. The basket cap is sampled at
// the nearest weekly row AT OR BEFORE each date, fresh within 45 days.
// The dividend yield is computed by the CALLER with per-member shares (see
// buildE2Scoring) because the basket cap is in total-dollar units while the
// yfinance dividend amounts are per-share.
function realizedAt(panel, t0, t1) {
  const weekly = panel.basket_weekly_rows.map((r) => ({ ...r, ms: parseDateMs(r.date) }));
  const start = lastAtOrBefore(weekly, t0);
  const end = lastAtOrBefore(weekly, t1);
  if (!start || t0 - start.ms > 45 * DAY_MS || !end || t1 - end.ms > 45 * DAY_MS) return null;
  return {
    cap0: start.cap,
    cap1: end.cap,
    cap_return: end.cap / start.cap - 1,
  };
}

// ---------------------------------------------------------------------------
// regime buckets — same semantics as the feasibility receipt, sp500 quantiles
// (the basket is US large caps), origin-date membership
// ---------------------------------------------------------------------------

function regimeCellsFor(rows, receiptSp500) {
  const rfDoc = readJson("data/macro/fred-banking-daily.json");
  const rfRows = (rfDoc.series?.DGS10 ?? [])
    .filter((r) => Number.isFinite(r.value))
    .map((r) => ({ ms: parseDateMs(r.date), value: r.value }))
    .sort((a, b) => a.ms - b.ms);
  const q13 = receiptSp500?.regime_buckets?.rf_quantiles?.q_one_third ?? null;
  const q23 = receiptSp500?.regime_buckets?.rf_quantiles?.q_two_thirds ?? null;
  const rfAt = (ms) => {
    const r = lastAtOrBefore(rfRows, ms);
    return r ? r.value : null;
  };
  const buckets = [
    { id: "high_rate", test: (rf, ms) => rf !== null && q23 !== null && rf >= q23 },
    { id: "low_rate", test: (rf, ms) => rf !== null && q13 !== null && rf <= q13 },
    { id: "crisis_2008_09", test: (rf, ms) => ms >= parseDateMs(CRISIS_WINDOWS[0].start) && ms <= parseDateMs(CRISIS_WINDOWS[0].end) },
    { id: "crisis_2020_03", test: (rf, ms) => ms >= parseDateMs(CRISIS_WINDOWS[1].start) && ms <= parseDateMs(CRISIS_WINDOWS[1].end) },
  ];
  return buckets.map((b) => {
    const members = rows.filter((r) => b.test(rfAt(parseDateMs(r.as_of)), parseDateMs(r.as_of)));
    const rho = members.length >= 2 ? spearmanRho(members.map((m) => m.x), members.map((m) => m.y)) : null;
    return { bucket: b.id, n: members.length, evaluable: members.length >= 5, spearman_rho: round6(rho) };
  });
}

// ---------------------------------------------------------------------------
// per-origin three-way scoring
// ---------------------------------------------------------------------------

function methodScore(rows, key, label) {
  const pairs = rows.filter((r) => r[key] !== null && Number.isFinite(r.return_annualised)).map((r) => ({ x: r[key], y: r.return_annualised }));
  const agree = (r) => (r[key] > 1 ? Math.sign(r.return_annualised) > 0 : r[key] < 1 ? Math.sign(r.return_annualised) < 0 : null);
  const agreeValues = rows.filter((r) => r[key] !== null && agree(r) !== null).map((r) => (agree(r) ? 1 : 0));
  return {
    label,
    n: pairs.length,
    spearman_rho: round6(pairs.length >= 2 ? spearmanRho(pairs.map((p) => p.x), pairs.map((p) => p.y)) : null),
    spearman_ci: pairs.length >= 2 ? blockBootstrapRho(pairs, BOOTSTRAP) : null,
    directional_rate: agreeValues.length ? round6(agreeValues.reduce((s, v) => s + v, 0) / agreeValues.length) : null,
    decile_calibration: decileCalibration(pairs),
  };
}

// -------------------------------------------------------------------------
// verdict against the FROZEN criteria
// -------------------------------------------------------------------------
export function applyE2Verdict(frozen, { buRho, blRho, n }) {
  const insufficient = n < 2 || buRho === null || blRho === null;
  const pass = !insufficient && buRho > blRho;
  return {
    verdict: insufficient ? frozen.verdict.outcomes.insufficient : pass ? frozen.verdict.outcomes.pass : frozen.verdict.outcomes.fail,
    pass_condition_met: insufficient ? null : pass,
  };
}

export function buildE2Scoring({ generatedAt = new Date().toISOString() } = {}) {
  const criteria = loadFrozenE2Criteria();
  const frozen = criteria.success_criteria;
  const panel = buildE2Panel();
  const receipt = readJson("data/computed/feno-rim-v2/h2-feasibility-receipt.json");
  const receiptSp500 = receipt.indices.sp500;

  // Constituent dividend/prices handles (for the realized return).
  const symbols = frozen.basket.symbols;
  const constituents = {};
  for (const symbol of symbols) {
    const yf = JSON.parse(fs.readFileSync(path.join(ROOT, `data/yf/finance/${symbol}.unadjusted.json`), "utf8"));
    constituents[symbol] = {
      dividends: Object.entries(yf.data?.dividends ?? {})
        .filter(([, v]) => Number.isFinite(v))
        .map(([d, v]) => ({ ms: parseDateMs(d), amount: v })),
    };
  }

  const rows = [];
  const originGaps = [];
  const rates = readJson("data/macro/fred-banking-daily.json").series.DGS10
    .map((r) => ({ ms: parseDateMs(r.date), value: r.value }))
    .sort((a, b) => a.ms - b.ms);
  for (const o of panel.origin_rows) {
    const t0 = parseDateMs(o.as_of);
    const t1 = t0 + Math.round(36 * MONTH_MS);
    const realized = realizedAt(panel, t0, t1);
    if (!realized) {
      originGaps.push({ as_of: o.as_of, reason: "realized_series_unavailable" });
      continue;
    }
    // Aggregate dividend yield: per-share dividends x the member's shares at
    // the origin, summed over the fundamental-set members, divided by the
    // basket cap at the origin (nominal over nominal, mirroring the harness
    // dividendAdjustment — the basket cap is total-dollar, so per-share
    // dividends alone would understate the yield by ~10 orders of magnitude).
    let divSum = 0;
    for (const m of o.members) {
      if (!m.ok) continue;
      const divs = constituents[m.symbol]?.dividends ?? [];
      for (const d of divs) {
        if (d.ms > t0 && d.ms <= t1) divSum += d.amount * m.shares;
      }
    }
    const yieldPct = divSum / realized.cap0;
    const totalReturn = realized.cap_return + yieldPct;
    const annualised = (1 + totalReturn) ** (1 / 3) - 1;
    const rateRow = lastAtOrBefore(rates, t0);
    if (!rateRow) {
      originGaps.push({ as_of: o.as_of, reason: "risk_free_unavailable" });
      continue;
    }
    const riskFree = rateRow.value * 0.01;
    const erp = erpWindowAt(o.as_of, "us");

    const baseInput = (book, price, roeBand, growth) => ({
      book,
      price,
      risk_free: riskFree,
      roe: { band: roeBand, consensus: null, coverage_ok: false },
      growth_observed: growth,
      erp_band: erp.band,
      b2_admitted: false,
      b2_exclusion_reason: "clean-surplus bridge data incomplete",
      payout_consumed: false,
    });

    // 1. top-down
    const tdInput = baseInput(o.basket.book, o.basket.cap, o.basket.roe_band, o.basket.growth);
    const tdHull = computeFamilyB(tdInput).value_hull;
    const vpTd = (tdHull.low + tdHull.high) / 2 / o.basket.cap;

    // 2. bottom-up: sum of per-constituent total intrinsic values (only ok members)
    let buSum = 0;
    let buN = 0;
    for (const m of o.members) {
      if (!m.ok) continue;
      const hull = computeFamilyB(baseInput(m.book, m.mc, m.roe_band, m.growth)).value_hull;
      buSum += (hull.low + hull.high) / 2;
      buN += 1;
    }
    const vpBu = buN > 0 ? buSum / o.basket.cap : null;

    // 3. baseline: basket's own trailing-10y P/B (E1 rule) on the basket panel
    const baselinePanel = panel.basket_weekly_rows.map((r) => ({ date: r.date, px_last: r.px_last, px_to_book_ratio: r.px_to_book_ratio }));
    const baselineBand = naiveBaselineBand(baselinePanel, o.as_of);
    const vpBl = baselineBand ? baselineBand.mid / baselineBand.price : null;

    rows.push({
      as_of: o.as_of,
      n_ok_members: o.n_ok_members,
      members_dropped: o.members.filter((m) => !m.ok).map((m) => ({ symbol: m.symbol, reason: m.reason })),
      vp_top_down: round6(vpTd),
      vp_bottom_up: vpBu === null ? null : round6(vpBu),
      vp_baseline: vpBl === null ? null : round6(vpBl),
      return_annualised: round6(annualised),
      cap_return: round6(realized.cap_return),
      dividend_yield: round6(yieldPct),
      total_return_36m: round6(totalReturn),
      baseline_truncated: baselineBand?.truncated ?? null,
    });
  }

  const topDown = methodScore(rows, "vp_top_down", "top-down on the basket");
  const bottomUp = methodScore(rows, "vp_bottom_up", "bottom-up on the basket (market-cap weighted aggregation)");
  const baseline = methodScore(rows, "vp_baseline", "basket's own historical P/B multiple");

  // Identical-origin sets for the fair comparisons: baseline vs bottom-up and
  // baseline vs top-down share the same origin rows (rows include all three or
  // nulls; the shared set filters on the two involved methods).
  const sharedBU = rows.filter((r) => r.vp_bottom_up !== null && r.vp_baseline !== null);
  const sharedTD = rows.filter((r) => r.vp_top_down !== null && r.vp_baseline !== null);
  const rhoOf = (subset, key) => (subset.length >= 2 ? spearmanRho(subset.map((r) => r[key]), subset.map((r) => r.return_annualised)) : null);
  const buRhoShared = rhoOf(sharedBU, "vp_bottom_up");
  const blRhoShared = rhoOf(sharedBU, "vp_baseline");
  const tdRhoShared = rhoOf(sharedTD, "vp_top_down");

  const regime = {
    bottom_up: regimeCellsFor(sharedBU.map((r) => ({ as_of: r.as_of, x: r.vp_bottom_up, y: r.return_annualised })), receiptSp500),
    baseline: regimeCellsFor(sharedBU.map((r) => ({ as_of: r.as_of, x: r.vp_baseline, y: r.return_annualised })), receiptSp500),
    top_down: regimeCellsFor(sharedTD.map((r) => ({ as_of: r.as_of, x: r.vp_top_down, y: r.return_annualised })), receiptSp500),
  };

  // -------------------------------------------------------------------------
  // verdict against the FROZEN criteria
  // -------------------------------------------------------------------------
  const applied = applyE2Verdict(frozen, { buRho: buRhoShared, blRho: blRhoShared, n: sharedBU.length });

  const body = {
    schema_version: E2_SCORING_SCHEMA_VERSION,
    phase: "E2",
    directive_ref: criteria.directive_ref,
    research_only: true,
    promotion: null,
    frozen_criteria: {
      artifact: "data/computed/feno-rim-v2/e2-success-criteria.json",
      criteria_sha256: criteria.criteria_sha256,
      frozen_pre_result: criteria.frozen_pre_result,
    },
    basket: {
      name: frozen.basket.name,
      source: frozen.basket.source,
      symbols: symbols,
      fixed_list: frozen.basket.fixed_list,
      survivorship_caveat: frozen.basket.survivorship_caveat,
    },
    scoring_method:
      "three methods on ONE fixed basket, same origins as E1 (the 34 sp500 walk-forward as-ofs), "
      + "same 36m annualised dividend-adjusted total return, same metrics (Spearman rho + moving-block CI, "
      + "decile calibration, directional rate, regime cells); V/P = intrinsic value midpoint / basket cap",
    origins_scored: rows.length,
    origin_gaps: originGaps,
    per_origin_rows: rows,
    comparison: {
      identical_origins_bu_vs_baseline: sharedBU.length,
      identical_origins_td_vs_baseline: sharedTD.length,
      top_down: { ...topDown, spearman_rho_identical_origins: round6(tdRhoShared) },
      bottom_up: { ...bottomUp, spearman_rho_identical_origins: round6(buRhoShared) },
      baseline: { ...baseline, spearman_rho_identical_origins: round6(blRhoShared) },
      bottom_up_beats_baseline_on_rank: buRhoShared !== null && blRhoShared !== null ? buRhoShared > blRhoShared : null,
      top_down_beats_baseline_on_rank: tdRhoShared !== null && blRhoShared !== null ? tdRhoShared > blRhoShared : null,
    },
    regime_cells: regime,
    verdict: {
      verdict: applied.verdict,
      rule: frozen.verdict.rule,
      criteria_sha256: criteria.criteria_sha256,
      pass_condition_met: applied.pass_condition_met,
      pass_rule: frozen.pass_rank_vs_baseline.directive_rule,
      pass_operational: frozen.pass_rank_vs_baseline.operational,
    },
    data_gaps: [
      ...originGaps.map((g) => `${g.as_of}: ${g.reason}`),
      `baseline truncated windows: ${rows.filter((r) => r.baseline_truncated).length}/${rows.length} origins (XBRL-era book limits the trailing-10y window; naiveBaselineBand flags truncated)`,
    ],
  };
  const scoringSha = sha256(JSON.stringify(body));
  return { ...body, generated_at: generatedAt, scoring_sha256: scoringSha };
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  const scoring = buildE2Scoring();
  const outDir = path.join(ROOT, "data/computed/feno-rim-v2");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "e2-research-scoring.json"), `${JSON.stringify(scoring, null, 2)}\n`);
  const c = scoring.comparison;
  console.log("=== E2: three methods on the Dow-30 basket (identical origins) ===");
  for (const key of ["top_down", "bottom_up", "baseline"]) {
    const m = c[key];
    console.log(`${key}: n=${m.n} rho=${m.spearman_rho} [${m.spearman_ci?.ci_lower},${m.spearman_ci?.ci_upper}] dir=${m.directional_rate}`);
  }
  console.log(`bottom-up beats baseline on rank: ${c.bottom_up_beats_baseline_on_rank} (bu ${c.bottom_up.spearman_rho_identical_origins} vs bl ${c.baseline.spearman_rho_identical_origins})`);
  console.log(`top-down beats baseline on rank: ${c.top_down_beats_baseline_on_rank} (td ${c.top_down.spearman_rho_identical_origins} vs bl ${c.baseline.spearman_rho_identical_origins})`);
  console.log(`E2 verdict: ${scoring.verdict.verdict}`);
  console.log(`scoring sha256: ${scoring.scoring_sha256.slice(0, 16)}… written: ${path.join(outDir, "e2-research-scoring.json")}`);
}
