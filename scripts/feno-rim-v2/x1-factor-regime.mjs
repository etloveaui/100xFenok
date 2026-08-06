#!/usr/bin/env node

// FENO RIM — X1: factor/period control (contract section 6; deliverable 12.4).
//
// DeepSeek red team. Directive: feno-handoff fh-20260806-175-cc-b563494b.
// Verdict criteria frozen pre-result in data/computed/feno-rim-v2/x1-factor-criteria.json
// (sha-checked fail-closed). Data: Kenneth French Data Library, official source
// only, raw bytes + receipt in data/kf-french/archives/.
//
// Statistics are my own (imported from my own x0-forensic-audit.mjs); no import
// of the handler's scorers. Every statistic is computed on BOTH origin sets
// (all 34, window-complete 18) per the handler's frozen decision. Factors are
// regime CONTEXT, not a substitute baseline.
//
// Deterministic: seeded bootstrap, sha over the body excluding generated_at.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ownBlockBootstrap, ownBlockBootstrapMean, ownEss, ownSpearman } from "./x0-forensic-audit.mjs";
import { buildX1Criteria, X1_CRITERIA_SCHEMA_VERSION } from "./x1-criteria.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const X1_SCORING_SCHEMA_VERSION = "feno_rim_v2_x1_factor_regime_control.v1";

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");
const round6 = (x) => (x === null || x === undefined ? null : Math.round(x * 1e6) / 1e6);
const BOOTSTRAP = Object.freeze({ blockQuarters: 12, reps: 2000, seed: 0x2026_0806 });

// ---------------------------------------------------------------------------
// frozen criteria gate (fail-closed)
// ---------------------------------------------------------------------------

export function loadFrozenX1Criteria() {
  const file = path.join(ROOT, "data/computed/feno-rim-v2/x1-factor-criteria.json");
  if (!fs.existsSync(file)) {
    throw new Error("X1 factor criteria are not frozen: run scripts/feno-rim-v2/x1-criteria.mjs FIRST, before any X1 number exists");
  }
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  if (saved.schema_version !== X1_CRITERIA_SCHEMA_VERSION) {
    throw new Error(`X1 criteria schema mismatch: artifact ${saved.schema_version}, code ${X1_CRITERIA_SCHEMA_VERSION}`);
  }
  if (saved.frozen_pre_result !== true) {
    throw new Error("X1 criteria artifact lacks frozen_pre_result: true — freeze invalid");
  }
  const expected = buildX1Criteria();
  if (saved.criteria_sha256 !== expected.criteria_sha256) {
    throw new Error("X1 criteria artifact sha mismatch vs frozen constant — refuse to score against drifted criteria");
  }
  return saved;
}

// ---------------------------------------------------------------------------
// own Ken French CSV parser (official files only)
// ---------------------------------------------------------------------------

// Parses the MONTHLY data block of a Ken French CSV: rows matching /^\d{6},/.
// Stops at the first non-monthly section marker after data begins. Columns are
// taken from the header line that precedes the first monthly row.
export function parseMonthlyCsv(relPath) {
  const text = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  const lines = text.split(/\r?\n/);
  const out = [];
  let started = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\d{6},/.test(trimmed)) {
      started = true;
      const parts = trimmed.split(",");
      const ym = parts[0];
      const values = parts.slice(1).map((v) => (v.trim() === "" || v.trim() === "-99.99" || v.trim() === "-999" ? null : Number(v.trim())));
      out.push({ ym, values });
    } else if (started && trimmed.length > 0) {
      break; // end of the monthly block (annual/average sections follow)
    }
  }
  if (!out.length) throw new Error(`parseMonthlyCsv: no monthly rows in ${relPath}`);
  return out;
}

// ---------------------------------------------------------------------------
// factor series
// ---------------------------------------------------------------------------

function loadFactors() {
  const research = parseMonthlyCsv("data/kf-french/parsed/F-F_Research_Data_Factors.csv");
  const five = parseMonthlyCsv("data/kf-french/parsed/F-F_Research_Data_5_Factors_2x3.csv");
  const mom = parseMonthlyCsv("data/kf-french/parsed/F-F_Momentum_Factor.csv");
  const p25 = parseMonthlyCsv("data/kf-french/parsed/25_Portfolios_5x5.csv");

  const byYm = (rows, col) => {
    const m = new Map();
    for (const r of rows) {
      // normalize "201501" -> "2015-01"
      const key = `${r.ym.slice(0, 4)}-${r.ym.slice(4, 6)}`;
      m.set(key, r.values[col]);
    }
    return m;
  };
  // Column positions (official file layouts):
  // research: Mkt-RF SMB HML RF
  // five:     Mkt-RF SMB HML RMW CMA RF
  // momentum: Mom
  // 25:       ME1 BM1 .. ME1 BM5, ME2 BM1 .., ..., ME5 BM1 .. ME5 BM5 (0-based: ME5 BM1 = 20, ME5 BM5 = 24)
  const mkt = byYm(research, 0);
  const hml5 = byYm(five, 2);
  const rmw = byYm(five, 3);
  const cma = byYm(five, 4);
  const momMap = byYm(mom, 0);
  const bigVBG = new Map();
  for (const r of p25) {
    const bm5 = r.values[24];
    const bm1 = r.values[20];
    if (bm5 !== null && bm1 !== null) {
      const key = `${r.ym.slice(0, 4)}-${r.ym.slice(4, 6)}`;
      bigVBG.set(key, bm5 - bm1);
    }
  }
  return { mkt, hml5, rmw, cma, mom: momMap, bigVBG };
}

// Compound monthly factor returns over (t, t+36m] in percent units.
function factor36m(factorMap, originYm, months) {
  const [y, m] = originYm.split("-").map(Number);
  const startKey = y * 12 + (m - 1);
  let product = 1;
  let count = 0;
  for (let k = 1; k <= months; k += 1) {
    const ymKey = startKey + k;
    const key = `${Math.floor(ymKey / 12)}-${String((ymKey % 12) + 1).padStart(2, "0")}`;
    const v = factorMap.get(key);
    if (v === undefined || v === null) return { value: null, missing: key };
    product *= 1 + v / 100;
    count += 1;
  }
  return { value: product - 1, missing: null, count };
}

// ---------------------------------------------------------------------------
// own OLS (normal equations + Gauss elimination) — own implementation
// ---------------------------------------------------------------------------

export function ownOls(y, Xcols) {
  const n = y.length;
  const k = Xcols.length;
  // design matrix with intercept
  const X = Xcols.map((col) => col.slice());
  const A = Array.from({ length: k + 1 }, () => new Array(k + 1).fill(0));
  const b = new Array(k + 1).fill(0);
  for (let i = 0; i < n; i += 1) {
    const row = [1, ...X.map((col) => col[i])];
    for (let a = 0; a <= k; a += 1) {
      b[a] += row[a] * y[i];
      for (let c = 0; c <= k; c += 1) A[a][c] += row[a] * row[c];
    }
  }
  // Gauss elimination with partial pivoting
  for (let col = 0; col <= k; col += 1) {
    let pivot = col;
    for (let r = col + 1; r <= k; r += 1) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    if (Math.abs(A[pivot][col]) < 1e-12) return null;
    [A[col], A[pivot]] = [A[pivot], A[col]];
    [b[col], b[pivot]] = [b[pivot], b[col]];
    for (let r = col + 1; r <= k; r += 1) {
      const f = A[r][col] / A[col][col];
      for (let c = col; c <= k; c += 1) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const beta = new Array(k + 1).fill(0);
  for (let r = k; r >= 0; r -= 1) {
    let acc = b[r];
    for (let c = r + 1; c <= k; c += 1) acc -= A[r][c] * beta[c];
    beta[r] = acc / A[r][r];
  }
  const fitted = y.map((_, i) => beta[0] + X.reduce((s, col, j) => s + beta[j + 1] * col[i], 0));
  const resid = y.map((v, i) => v - fitted[i]);
  const yMean = y.reduce((s, v) => s + v, 0) / n;
  const ssTot = y.reduce((s, v) => s + (v - yMean) ** 2, 0);
  const ssRes = resid.reduce((s, v) => s + v ** 2, 0);
  return { beta, fitted, resid, r2: ssTot === 0 ? null : 1 - ssRes / ssTot, n };
}

// ---------------------------------------------------------------------------
// X1 evaluation
// ---------------------------------------------------------------------------

export function buildX1FactorRegime({ generatedAt = new Date().toISOString() } = {}) {
  const criteria = loadFrozenX1Criteria();
  const frozen = criteria.verdict_criteria;
  const e2 = readJson("data/computed/feno-rim-v2/e2-research-scoring.json");
  const rowsByAsOf = new Map(e2.per_origin_rows.map((r) => [r.as_of, r]));
  const factors = loadFactors();

  const originSets = {
    all_34: criteria.origin_sets_frozen.all_34,
    window_complete_18: criteria.origin_sets_frozen.window_complete_18,
  };

  // Per-origin 36m factor returns + basket total return.
  const originData = [];
  const gaps = [];
  for (const asOf of criteria.origin_sets_frozen.all_34) {
    const row = rowsByAsOf.get(asOf);
    if (!row) {
      gaps.push(`${asOf}: missing in e2 artifact`);
      continue;
    }
    const ym = asOf.slice(0, 7);
    const f36 = (map) => factor36m(map, ym, 36);
    const mkt = f36(factors.mkt);
    const hml = f36(factors.hml5);
    const rmw = f36(factors.rmw);
    const cma = f36(factors.cma);
    const mom = f36(factors.mom);
    const bvg = f36(factors.bigVBG);
    for (const [name, r] of [["Mkt-RF", mkt], ["HML", hml], ["RMW", rmw], ["CMA", cma], ["MOM", mom], ["BigVBG", bvg]]) {
      if (r.missing) gaps.push(`${asOf}: factor ${name} missing month ${r.missing}`);
    }
    originData.push({
      as_of: asOf,
      total_return_36m: row.total_return_36m ?? row.cap_return + row.dividend_yield,
      vp_bottom_up: row.vp_bottom_up,
      vp_top_down: row.vp_top_down,
      vp_baseline: row.vp_baseline,
      mkt_36m: mkt.value, hml_36m: hml.value, rmw_36m: rmw.value, cma_36m: cma.value,
      mom_36m: mom.value, bigvbg_36m: bvg.value,
    });
  }

  // Cumulative factor returns over the matched period 2015-01..2023-12.
  const periodCumulative = {};
  const monthKeys = [];
  for (let y = 2015; y <= 2023; y += 1) for (let m = 1; m <= 12; m += 1) monthKeys.push(`${y}-${String(m).padStart(2, "0")}`);
  const cum = (map) => {
    let product = 1;
    let missing = 0;
    for (const key of monthKeys) {
      const v = map.get(key);
      if (v === undefined || v === null) { missing += 1; continue; }
      product *= 1 + v / 100;
    }
    return { cumulative: product - 1, missing_months: missing };
  };
  for (const [name, map] of [["HML", factors.hml5], ["BigVBG", factors.bigVBG], ["RMW", factors.rmw], ["CMA", factors.cma], ["MOM", factors.mom], ["Mkt-RF", factors.mkt]]) {
    periodCumulative[name] = cum(map);
  }

  // Per origin set: raw rho + factor-residual rho (bottom-up primary; td/bl reported).
  const evaluateSet = (setName) => {
    const rows = originData.filter((r) => originSets[setName].includes(r.as_of));
    const n = rows.length;
    const pairsRaw = rows.filter((r) => r.vp_bottom_up !== null && Number.isFinite(r.total_return_36m))
      .map((r) => ({ x: r.vp_bottom_up, y: r.total_return_36m, as_of: r.as_of }))
      .sort((a, b) => (a.as_of < b.as_of ? -1 : 1));
    const rawRho = ownSpearman(pairsRaw.map((p) => p.x), pairsRaw.map((p) => p.y));
    const rawCi = ownBlockBootstrap(ownSpearman, pairsRaw, BOOTSTRAP);

    // Pooled OLS residual on the same set.
    const y = rows.map((r) => r.total_return_36m);
    const X = [rows.map((r) => r.mkt_36m ?? 0), rows.map((r) => r.hml_36m ?? 0), rows.map((r) => r.rmw_36m ?? 0), rows.map((r) => r.cma_36m ?? 0), rows.map((r) => r.mom_36m ?? 0)];
    const ols = ownOls(y, X);
    const pairsResid = ols
      ? rows.map((r, i) => ({ x: r.vp_bottom_up, y: ols.resid[i], as_of: r.as_of }))
          .filter((p) => p.x !== null)
          .sort((a, b) => (a.as_of < b.as_of ? -1 : 1))
      : [];
    const residRho = pairsResid.length >= 2 ? ownSpearman(pairsResid.map((p) => p.x), pairsResid.map((p) => p.y)) : null;
    const residCi = pairsResid.length >= 2 ? ownBlockBootstrap(ownSpearman, pairsResid, BOOTSTRAP) : null;

    // Top-down + baseline raw rhos (reported).
    const tdRho = ownSpearman(rows.filter((r) => r.vp_top_down !== null).map((r) => r.vp_top_down), y);
    const blRho = ownSpearman(rows.filter((r) => r.vp_baseline !== null).map((r) => r.vp_baseline), y);

    // ESS: same monthly dependence structure as X0's basket ESS, scaled to this n.
    const panel = readJson("data/computed/feno-rim-v2/e2-basket-panel.json");
    const ess = ownEss(panel.basket_weekly_rows, n);

    return {
      origin_set: setName,
      raw_n: n,
      effective_n: ess.ess_capped,
      ess,
      raw: { spearman_rho: round6(rawRho), rho_ci: rawCi },
      factor_residual: {
        spearman_rho: round6(residRho),
        rho_ci: residCi,
        ols_r2: ols ? round6(ols.r2) : null,
        ols_n: ols?.n ?? null,
        beta: ols ? { intercept: round6(ols.beta[0]), mkt_rf: round6(ols.beta[1]), hml: round6(ols.beta[2]), rmw: round6(ols.beta[3]), cma: round6(ols.beta[4]), mom: round6(ols.beta[5]) } : null,
      },
      reported: { top_down_raw_rho: round6(tdRho), baseline_raw_rho: round6(blRho) },
      improvement_raw_to_residual: rawRho !== null && residRho !== null ? round6(residRho - rawRho) : null,
    };
  };

  const sets = {
    all_34: evaluateSet("all_34"),
    window_complete_18: evaluateSet("window_complete_18"),
  };

  // -------------------------------------------------------------------------
  // verdict against the FROZEN criteria (decision order)
  // -------------------------------------------------------------------------
  const dataGaps = gaps.length > 0;
  const r2BothLow = (sets.all_34.factor_residual.ols_r2 !== null && sets.all_34.factor_residual.ols_r2 < 0.50)
    && (sets.window_complete_18.factor_residual.ols_r2 !== null && sets.window_complete_18.factor_residual.ols_r2 < 0.50);
  const insufficient = dataGaps || r2BothLow;
  const hmlNegative = periodCumulative.HML.cumulative < 0;
  const residPosBoth = sets.all_34.factor_residual.spearman_rho !== null && sets.all_34.factor_residual.spearman_rho > 0
    && sets.window_complete_18.factor_residual.spearman_rho !== null && sets.window_complete_18.factor_residual.spearman_rho > 0;
  const improvesBoth = sets.all_34.improvement_raw_to_residual !== null && sets.all_34.improvement_raw_to_residual > 0
    && sets.window_complete_18.improvement_raw_to_residual !== null && sets.window_complete_18.improvement_raw_to_residual > 0;
  const residNonPosSome = sets.all_34.factor_residual.spearman_rho !== null && sets.all_34.factor_residual.spearman_rho <= 0
    || sets.window_complete_18.factor_residual.spearman_rho !== null && sets.window_complete_18.factor_residual.spearman_rho <= 0;
  const residNonPosBoth = sets.all_34.factor_residual.spearman_rho !== null && sets.all_34.factor_residual.spearman_rho <= 0
    && sets.window_complete_18.factor_residual.spearman_rho !== null && sets.window_complete_18.factor_residual.spearman_rho <= 0;

  let verdict;
  let fired = null;
  if (insufficient) {
    verdict = "INSUFFICIENT_MATCHED_UNIVERSE";
    fired = "insufficient_matched_universe";
  } else if (hmlNegative && residPosBoth) {
    verdict = "PERIOD_EFFECT_EXPLAINS_MOST";
    fired = "period_effect_explains_most";
  } else if (improvesBoth && residNonPosSome) {
    verdict = "PERIOD_EFFECT_PARTIAL_ONLY";
    fired = "period_effect_partial_only";
  } else if (residNonPosBoth) {
    verdict = "MODEL_FAILURE_REMAINS";
    fired = "model_failure_remains";
  } else {
    verdict = "MODEL_FAILURE_REMAINS";
    fired = "model_failure_remains (conservative default)";
  }

  const body = {
    schema_version: X1_SCORING_SCHEMA_VERSION,
    phase: "X1",
    directive_ref: criteria.directive_ref,
    research_only: true,
    promotion: null,
    frozen_criteria: {
      artifact: "data/computed/feno-rim-v2/x1-factor-criteria.json",
      criteria_sha256: criteria.criteria_sha256,
      frozen_pre_result: criteria.frozen_pre_result,
    },
    data: {
      source: "Kenneth French Data Library, official files only",
      archive_dir: "data/kf-french/archives/",
      receipt: "data/kf-french/archives/receipt.json",
      files: criteria.factor_sources.map((s) => s.url),
      parsed: ["data/kf-french/parsed/F-F_Research_Data_Factors.csv", "data/kf-french/parsed/F-F_Research_Data_5_Factors_2x3.csv", "data/kf-french/parsed/F-F_Momentum_Factor.csv", "data/kf-french/parsed/25_Portfolios_5x5.csv"],
    },
    factor_universe_note: "whole-market factor portfolios are NOT the same universe as the fixed Dow basket — factors are regime CONTEXT, not a substitute baseline (contract 6 X1)",
    period_cumulative_2015_2023: periodCumulative,
    per_origin: originData.map((r) => ({
      as_of: r.as_of,
      total_return_36m: round6(r.total_return_36m),
      vp_bottom_up: round6(r.vp_bottom_up),
      vp_top_down: round6(r.vp_top_down),
      vp_baseline: round6(r.vp_baseline),
      factor_36m: { mkt_rf: round6(r.mkt_36m), hml: round6(r.hml_36m), rmw: round6(r.rmw_36m), cma: round6(r.cma_36m), mom: round6(r.mom_36m), bigvbg: round6(r.bigvbg_36m) },
    })),
    origin_sets: sets,
    verdict: {
      verdict,
      fired_criterion: fired,
      rule: frozen.scope,
      decision_order: frozen.decision_order,
      conditions: {
        insufficient: { data_gaps: dataGaps, r2_below_0_5_on_both: r2BothLow, all_34_r2: sets.all_34.factor_residual.ols_r2, complete_18_r2: sets.window_complete_18.factor_residual.ols_r2 },
        explains_most: { hml_cumulative_2015_2023_negative: hmlNegative, hml_cumulative: periodCumulative.HML.cumulative, residual_rho_positive_both: residPosBoth, all_34: sets.all_34.factor_residual.spearman_rho, complete_18: sets.window_complete_18.factor_residual.spearman_rho },
        partial_only: { improves_on_both: improvesBoth, residual_non_positive_on_some: residNonPosSome, all_34_improvement: sets.all_34.improvement_raw_to_residual, complete_18_improvement: sets.window_complete_18.improvement_raw_to_residual },
        model_failure: { residual_non_positive_on_both: residNonPosBoth },
      },
    },
    data_gaps: gaps,
    constraints: { quarantine: "KEEP_QUARANTINED", promotion: "none", ui: "none", deploy: "none", commit: "none", fifth_experiment: "none" },
  };
  const scoringSha = sha256(JSON.stringify(body));
  return { ...body, generated_at: generatedAt, scoring_sha256: scoringSha };
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  const x1 = buildX1FactorRegime();
  const outDir = path.join(ROOT, "data/computed/feno-rim-v2");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "RIM_FACTOR_REGIME_CONTROL.json"), `${JSON.stringify(x1, null, 2)}\n`);
  console.log("=== X1 factor/period control ===");
  console.log("period 2015-2023 cumulative:", JSON.stringify(Object.fromEntries(Object.entries(x1.period_cumulative_2015_2023).map(([k, v]) => [k, round6(v.cumulative)]))));
  for (const [name, s] of Object.entries(x1.origin_sets)) {
    console.log(`${name}: n=${s.raw_n}/eff=${s.effective_n} raw_rho=${s.raw.spearman_rho} [${s.raw.rho_ci.ci_lower},${s.raw.rho_ci.ci_upper}] -> resid_rho=${s.factor_residual.spearman_rho} [${s.factor_residual.rho_ci?.ci_lower},${s.factor_residual.rho_ci?.ci_upper}] (R2=${s.factor_residual.ols_r2}) improvement=${s.improvement_raw_to_residual}`);
  }
  console.log(`X1 verdict: ${x1.verdict.verdict} (${x1.verdict.fired_criterion})`);
  console.log(`scoring sha256: ${x1.scoring_sha256.slice(0, 16)}… written: ${path.join(outDir, "RIM_FACTOR_REGIME_CONTROL.json")}`);
}
