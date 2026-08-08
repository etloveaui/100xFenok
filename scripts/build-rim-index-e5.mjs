#!/usr/bin/env node
// E5 — historical QA of candidate B (stable-growth RI) via the frozen proxy lane.
// Criteria: feno-index-rim-e5-criteria.json (a3f8781dab) + -v2.json (27c7643d99).
// Proxy lane (v2 frozen): FY1 = benchmarks best_eps; FY2/FY3 flat at FY1; ERP =
// historical_erp implied_erp_fcfe; payout from PIT book series (retention = ΔB/(ROE·B_prev),
// clipped [0,1]); everything else identical to B. Every number is labelled PROXY and never
// satisfies a READY gate. No commit.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");
const OUT = path.join(dataRoot, "computed", "rim-index");
const ORIGINS = ["2019-06-30", "2020-06-30", "2021-06-30", "2022-06-30", "2023-06-30", "2024-06-30", "2025-06-30"];
const DAY = 86400000;
const CRITERIA = JSON.parse(fs.readFileSync(path.join(OUT, "feno-index-rim-e5-criteria.json"), "utf8"));
const CRITERIA_V2 = JSON.parse(fs.readFileSync(path.join(OUT, "feno-index-rim-e5-criteria-v2.json"), "utf8"));

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(dataRoot, rel), "utf8"));
const writeJson = (name, payload) => fs.writeFileSync(path.join(OUT, name), `${JSON.stringify(payload, null, 1)}\n`);
const round = (x, d = 4) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x);

const bench = readJson("benchmarks/us.json").sections;
const fred = readJson("macro/fred-banking-daily.json");
const histErp = readJson("damodaran/historical_erp.json").years;

function lastAtOrBefore(rows, date, field) {
  let best = null;
  for (const r of rows) {
    if (r.date > date) break;
    best = r;
  }
  return best ? best[field] : null;
}
function rowAtOrBefore(rows, date) {
  let best = null;
  for (const r of rows) {
    if (r.date > date) break;
    best = r;
  }
  return best;
}
function firstKnowableDate(rows, date) {
  // publication date of the observation used = the observation's own date (series is dated)
  const r = rowAtOrBefore(rows, date);
  return r ? r.date : null;
}
function rfAt(origin) {
  const obs = fred.series.DGS10.filter((x) => x.date <= origin);
  const last = obs.at(-1);
  return last ? { value: last.value / 100, date: last.date } : null;
}
function ltroeAt(section, origin) {
  const rows = section.data;
  const cutoff = Date.parse(`${origin}T00:00:00Z`);
  const start = cutoff - Math.floor(10 * 365.25) * DAY;
  const roes = rows.filter((r) => {
    const ms = Date.parse(`${r.date}T00:00:00Z`);
    return ms >= start && ms <= cutoff && Number.isFinite(r.roe);
  }).map((r) => r.roe).sort((a, b) => a - b);
  if (roes.length === 0) return { base: null, n: 0 };
  const q = (p) => roes[Math.min(roes.length - 1, Math.floor(p * (roes.length - 1)))];
  const mid = roes.length / 2;
  const base = roes.length % 2 === 1 ? roes[Math.floor(mid)] : (roes[mid - 1] + roes[mid]) / 2;
  return { base, n: roes.length, q25: q(0.25), q75: q(0.75), startDate: new Date(start).toISOString().slice(0, 10) };
}

function proxyPayout(section, origin) {
  // retention_t = (B_t - B_(t-1)) / (ROE_t * B_(t-1)); B = px_last / px_to_book; clip [0,1]
  const rows = section.data;
  const t = rowAtOrBefore(rows, origin);
  if (!t) return null;
  const t1Date = new Date(Date.parse(`${origin}T00:00:00Z`) - Math.floor(365 * DAY)).toISOString().slice(0, 10);
  const t1 = rowAtOrBefore(rows, t1Date);
  if (!t || !t1 || !t.px_to_book_ratio || !t1.px_to_book_ratio || !Number.isFinite(t.roe)) return null;
  const Bt = t.px_last / t.px_to_book_ratio;
  const Bt1 = t1.px_last / t1.px_to_book_ratio;
  const denom = t.roe * Bt1;
  if (!Number.isFinite(denom) || denom <= 0) return null;
  const retention = Math.max(0, Math.min(1, (Bt - Bt1) / denom));
  return { retention, payout: 1 - retention, B_t: Bt, B_t1: Bt1, roe_t: t.roe, t1_date: t1.date };
}

function computeB({ b0, eps, payout, ke, ltroe, g }) {
  // candidate B: stable-growth RI, CV3 = (LTROE-Ke)*B3/(Ke-g), g = Rf(t0)
  if (![b0, payout, ke, ltroe, g].every(Number.isFinite) || b0 <= 0 || ke <= g) {
    return { value: null, blocker: ke <= g ? "ke_le_g" : "operand_missing" };
  }
  const retention = 1 - payout;
  const B = [b0];
  for (let t = 0; t < 3; t += 1) B.push(B[t] + eps[t] * retention);
  const B3 = B[3];
  if (B3 <= 0) return { value: null, blocker: "terminal_book_nonpositive" };
  const ri = [0, 1, 2].map((t) => eps[t] - ke * B[t]);
  const cv3 = ((ltroe - ke) * B3) / (ke - g);
  const explicitPv = ri.reduce((s, r, t) => s + r / (1 + ke) ** (t + 1), 0);
  const value = b0 + explicitPv + cv3 / (1 + ke) ** 3;
  if (!Number.isFinite(value)) return { value: null, blocker: "non_finite" };
  const terminalShare = cv3 / (1 + ke) ** 3 / value;
  return { value, cv3, explicitPv, terminalShare, b3: B3, ke, g, stableRetention: g / ltroe };
}

function buildGrid({ b0, eps, payout, rf, erpBase, ltroeBase }) {
  const erp = { low: erpBase - 0.005, base: erpBase, high: erpBase + 0.005 };
  const ltroe = { low: ltroeBase - 0.005, base: ltroeBase, high: ltroeBase + 0.005 };
  const g = rf;
  const cells = {};
  for (const [ek, ev] of Object.entries(erp)) {
    for (const [lk, lv] of Object.entries(ltroe)) {
      const ke = rf + ev;
      const r = computeB({ b0, eps, payout, ke, ltroe: lv, g });
      cells[`${ek}_${lk}`] = { erp: ev, ltroe: lv, ke, g, value: r.value, terminalShare: r.terminalShare, stableRetention: r.stableRetention };
    }
  }
  const vals = Object.values(cells).map((c) => c.value).filter(Number.isFinite);
  const monotonic = (() => {
    if (vals.length !== 9) return false;
    for (const lk of ["low", "base", "high"]) {
      if (!(cells[`low_${lk}`].value >= cells[`base_${lk}`].value && cells[`base_${lk}`].value >= cells[`high_${lk}`].value)) return false;
    }
    for (const ek of ["low", "base", "high"]) {
      if (!(cells[`${ek}_high`].value >= cells[`${ek}_base`].value && cells[`${ek}_base`].value >= cells[`${ek}_low`].value)) return false;
    }
    return true;
  })();
  const keMin = Math.min(...Object.values(cells).map((c) => c.ke));
  return {
    cells,
    BEAR: cells.high_low.value, BASE: cells.base_base.value, BULL: cells.low_high.value,
    GRID_MEAN: vals.reduce((a, x) => a + x, 0) / 9,
    monotonicity_passed: monotonic,
    min_ke_minus_g: keMin - g,
  };
}

// ============ 1. PIT SOURCE LEDGER ============
const ledger = { schema_version: "feno_index_rim_e5_pit_ledger.v1", criteria_v1: CRITERIA.schema_version,
  criteria_v2: CRITERIA_V2.schema_version, origins: {} };
const handlerInventory = CRITERIA_V2.pit_inventory_finding;
for (const origin of ORIGINS) {
  const originLedger = { inputs: {}, classification: null };
  for (const [idx, sectionName] of [["SPX", "sp500"], ["NDX", "nasdaq100"]]) {
    const section = bench[sectionName];
    const row = rowAtOrBefore(section.data, origin);
    const rows = section.data;
    const rdate = row?.date ?? null;
    const inputs = {
      P0: { value: row?.px_last ?? null, source: "benchmarks/us.json", source_date: rdate,
        publication_date: rdate, first_knowable: firstKnowableDate(rows, origin),
        classification: rdate ? "MODEL_EQUIVALENT" : "RETROSPECTIVE_ONLY",
        note: "dated series; observation at or before origin is knowable at origin" },
      P_B: { value: row?.px_to_book_ratio ?? null, source: "benchmarks/us.json", source_date: rdate,
        publication_date: rdate, first_knowable: firstKnowableDate(rows, origin),
        classification: rdate ? "MODEL_EQUIVALENT" : "RETROSPECTIVE_ONLY" },
      FY1_EPS: { value: row?.best_eps ?? null, source: "benchmarks/us.json best_eps", source_date: rdate,
        publication_date: rdate, first_knowable: firstKnowableDate(rows, origin),
        classification: rdate ? "MODEL_EQUIVALENT" : "RETROSPECTIVE_ONLY",
        note: "live B takes FY1 from benchmark best_eps; same source class" },
      FY2_FY3_EPS: { value: null, source: "computed/stock_action_index.json (forwardEps fy2/fy3)",
        source_date: "2026-08-08 (single current file)", publication_date: "2026-08-08",
        first_knowable: "2026-08-08", classification: "RETROSPECTIVE_ONLY",
        note: "handler inventory: NO historical vintage. confirmed." },
      ROE_history: { value: ltroeAt(section, origin).base, source: "benchmarks/us.json roe series",
        source_date: rdate, publication_date: rdate,
        first_knowable: firstKnowableDate(rows, origin),
        classification: "MODEL_EQUIVALENT",
        note: `trailing window ${ltroeAt(section, origin).startDate}..${origin} (n=${ltroeAt(section, origin).n}); window shorter than 10y disclosed` },
      Rf: { value: rfAt(origin)?.value ?? null, source: "macro/fred-banking-daily.json DGS10",
        source_date: rfAt(origin)?.date ?? null, publication_date: rfAt(origin)?.date ?? null,
        first_knowable: rfAt(origin)?.date ?? null,
        classification: rfAt(origin) ? "MODEL_EQUIVALENT" : "RETROSPECTIVE_ONLY" },
      ERP: { value: histErp[origin.slice(0, 4)]?.implied_erp_fcfe ?? null,
        source: "damodaran/historical_erp.json implied_erp_fcfe",
        source_date: `${origin.slice(0, 4)}-12-31`, publication_date: `~${Number(origin.slice(0, 4)) + 1}-01`,
        first_knowable: `${Number(origin.slice(0, 4)) + 1}-01`,
        classification: "RECONSTRUCTED_PIT_PROXY",
        note: "source-class substitution: live B reads country-premium erp.json; historical_erp is Damodaran implied ERP. confirmed." },
      payout_A: { value: null, source: "computed/stock_action_index.json (weighted dividend yield)",
        source_date: "2026-08-08 (single current file)", publication_date: "2026-08-08",
        first_knowable: "2026-08-08", classification: "RETROSPECTIVE_ONLY",
        note: "handler inventory: NO historical vintage. confirmed." },
      payout_B: { value: null, source: "slickcharts/{index}-yield.json", source_date: "2026-08-01",
        publication_date: "2026-08-01", first_knowable: "2026-08-01",
        classification: "RETROSPECTIVE_ONLY",
        note: "handler inventory: yield files carry only the current reading. confirmed." },
    };
    originLedger.inputs[idx] = inputs;
  }
  // origin classification: any RETROSPECTIVE_ONLY material input -> RETROSPECTIVE_ONLY for live lane
  const allClasses = [...Object.values(originLedger.inputs.SPX), ...Object.values(originLedger.inputs.NDX)].map((i) => i.classification);
  const hasRetro = allClasses.includes("RETROSPECTIVE_ONLY");
  const hasProxyOnly = !hasRetro && allClasses.includes("RECONSTRUCTED_PIT_PROXY");
  originLedger.classification = hasRetro ? "RETROSPECTIVE_ONLY" : (hasProxyOnly ? "RECONSTRUCTED_PIT_PROXY" : "MODEL_EQUIVALENT_PIT");
  originLedger.proxy_lane_computable = true; // proxy construction (v2) covers every input via substitution
  ledger.origins[origin] = originLedger;
}
ledger.handler_inventory_confirmed = {
  model_equivalent_pit: { SPX: 0, NDX: 0 },
  statement: "Handler inventory confirmed: FY2/FY3 EPS and both payout routes have no historical vintage; historical ERP is implied (source-class mismatch). MODEL_EQUIVALENT_PIT = 0 for both indices. D1/D2 fail; READY unreachable on data grounds; missing data is not a RETIRE condition.",
  contradictions: [],
};
writeJson("FENO_RIM_E5_PIT_SOURCE_LEDGER.json", ledger);
console.log("ledger written");

// ============ 2. PROXY LANE: historical grid + 12m QA + benchmark + fragility ============
const gridArtifact = { schema_version: "feno_index_rim_e5_historical_grid.v1", proxy_lane: true,
  substitutions: CRITERIA_V2.proxy_construction_frozen, origins: {} };
const qaArtifact = { schema_version: "feno_index_rim_e5_12m_target_qa.v1", proxy_lane: true,
  convention: "P12 = last trading close on or before origin + 12 calendar months; P0 = last trading close on or before origin",
  per_origin: {}, aggregates: {} };
const benchArtifact = { schema_version: "feno_index_rim_e5_benchmark_comparison.v1", proxy_lane: true,
  naive_target: "P0 (no-change)", per_origin: {}, aggregates: {} };
const fragArtifact = { schema_version: "feno_index_rim_e5_terminal_fragility.v1", proxy_lane: true,
  canonical: "g0 = Rf(t0)", shadows: { g1: "max(0, Rf - 0.01)", g2: "max(0, Rf - 0.02)" },
  current: {}, per_origin: {} };

function runOrigin(origin) {
  const out = {};
  for (const [idx, sectionName] of [["SPX", "sp500"], ["NDX", "nasdaq100"]]) {
    const section = bench[sectionName];
    const row = rowAtOrBefore(section.data, origin);
    const b0 = row.px_last / row.px_to_book_ratio;
    const fy1 = row.best_eps;
    const eps = [fy1, fy1, fy1]; // v2: FY2/FY3 flat at FY1 (declared degenerate path)
    const erpBase = histErp[origin.slice(0, 4)]?.implied_erp_fcfe;
    const payoutInfo = proxyPayout(section, origin);
    const payout = payoutInfo?.payout ?? null;
    const rf = rfAt(origin)?.value;
    const lt = ltroeAt(section, origin);
    if (![b0, fy1, erpBase, payout, rf, lt.base].every(Number.isFinite)) {
      out[idx] = { blocker: "proxy_input_missing" };
      continue;
    }
    const grid = buildGrid({ b0, eps, payout, rf, erpBase, ltroeBase: lt.base });
    out[idx] = {
      proxy_substitutions: {
        FY1: "benchmarks best_eps", FY2_FY3: "flat at FY1 (declared degenerate, not a forecast)",
        ERP: `historical_erp ${origin.slice(0, 4)} implied_erp_fcfe = ${round(erpBase, 4)}`,
        payout: `PIT book series retention=ΔB/(ROE·B_prev) clipped [0,1] -> payout ${round(payout, 4)}`,
      },
      inputs: { P0: row.px_last, P0_date: row.date, B0: b0, FY1: fy1, payout, rf, rf_date: rfAt(origin).date,
        ltroe: lt.base, ltroe_n: lt.n, erp_base: erpBase },
      grid: grid.cells, BEAR: grid.BEAR, BASE: grid.BASE, BULL: grid.BULL, GRID_MEAN: grid.GRID_MEAN,
      monotonicity_passed: grid.monotonicity_passed, min_ke_minus_g: grid.min_ke_minus_g,
      base_terminal_share: grid.cells.base_base.terminalShare,
      base_stable_retention: grid.cells.base_base.stableRetention,
      label: "PROXY",
    };
  }
  return out;
}

// historical origins
for (const origin of ORIGINS) {
  const r = runOrigin(origin);
  gridArtifact.origins[origin] = r;
  // 12m QA
  const targetDate = new Date(Date.parse(`${origin}T00:00:00Z`) + 12 * 365 * DAY).toISOString().slice(0, 10);
  // use calendar-month arithmetic: origin + 12 months
  const [yy, mm, dd] = origin.split("-").map(Number);
  const targetCal = `${yy + 1}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  for (const [idx, sectionName] of [["SPX", "sp500"], ["NDX", "nasdaq100"]]) {
    const section = bench[sectionName];
    const p0row = rowAtOrBefore(section.data, origin);
    const p12row = rowAtOrBefore(section.data, targetCal);
    const o = r[idx];
    if (!o || !p0row || !p12row) { qaArtifact.per_origin[origin] = { [idx]: { blocker: "missing" } }; continue; }
    const P0 = p0row.px_last, P12 = p12row.px_last;
    const predBase = o.BASE / P0 - 1;
    const r12 = P12 / P0 - 1;
    const bandHit = o.BEAR <= P12 && P12 <= o.BULL;
    const bandWidth = (o.BULL - o.BEAR) / P0;
    const missDist = bandHit ? 0 : Math.min(Math.abs(P12 - o.BEAR), Math.abs(P12 - o.BULL)) / P0;
    const baseErr = Math.abs(o.BASE - P12) / P12;
    const gmErr = Math.abs(o.GRID_MEAN - P12) / P12;
    const ncErr = Math.abs(P0 - P12) / P12;
    const cls = (ret) => (ret > 0.03 ? "UP" : ret < -0.03 ? "DOWN" : "FLAT");
    const dirHit = cls(predBase) === cls(r12);
    qaArtifact.per_origin[origin] = qaArtifact.per_origin[origin] ?? {};
    qaArtifact.per_origin[origin][idx] = {
      P0, P0_date: p0row.date, P12, P12_date: p12row.date, target_date: targetCal,
      BEAR: round(o.BEAR, 2), BASE: round(o.BASE, 2), BULL: round(o.BULL, 2), GRID_MEAN: round(o.GRID_MEAN, 2),
      pred_base_return: round(predBase, 4), realized_12m_return: round(r12, 4),
      band_hit: bandHit, band_width: round(bandWidth, 4), band_miss_distance: round(missDist, 4),
      base_abs_level_error: round(baseErr, 4), gridmean_abs_level_error: round(gmErr, 4),
      no_change_abs_level_error: round(ncErr, 4), direction_pred: cls(predBase), direction_realized: cls(r12),
      direction_hit: dirHit, label: "PROXY",
    };
    benchArtifact.per_origin[origin] = benchArtifact.per_origin[origin] ?? {};
    benchArtifact.per_origin[origin][idx] = { P0, P12, naive_target: P0, naive_error: round(ncErr, 4),
      base_error: round(baseErr, 4), base_beats_naive: baseErr <= ncErr, label: "PROXY" };
    // fragility shadows at this origin
    const rf = rfAt(origin)?.value;
    const b0 = p0row.px_last / p0row.px_to_book_ratio;
    const eps = [p0row.best_eps, p0row.best_eps, p0row.best_eps];
    const payoutInfo = proxyPayout(section, origin);
    const lt = ltroeAt(section, origin);
    const erpBase = histErp[origin.slice(0, 4)]?.implied_erp_fcfe;
    if ([rf, b0, payoutInfo?.payout, lt.base, erpBase].every(Number.isFinite)) {
      const gs = { g0: rf, g1: Math.max(0, rf - 0.01), g2: Math.max(0, rf - 0.02) };
      const bases = {};
      for (const [gk, g] of Object.entries(gs)) {
        const gd = buildGrid({ b0, eps, payout: payoutInfo.payout, rf, erpBase, ltroeBase: lt.base });
        // rebuild with g override: buildGrid uses g=rf, so recompute the base cell directly
        const ke = rf + erpBase;
        bases[gk] = computeB({ b0, eps, payout: payoutInfo.payout, ke, ltroe: lt.base, g }).value;
      }
      const shift100 = Math.abs(bases.g1 / bases.g0 - 1);
      const shift200 = Math.abs(bases.g2 / bases.g0 - 1);
      const flip100 = (bases.g1 - P0) * (bases.g0 - P0) < 0;
      const flip200 = (bases.g2 - P0) * (bases.g0 - P0) < 0;
      fragArtifact.per_origin[origin] = fragArtifact.per_origin[origin] ?? {};
      fragArtifact.per_origin[origin][idx] = {
        base_g0: round(bases.g0, 2), base_g1: round(bases.g1, 2), base_g2: round(bases.g2, 2),
        shift_100bp: round(shift100, 4), shift_200bp: round(shift200, 4),
        direction_flip_100bp: flip100, direction_flip_200bp: flip200,
        base_terminal_share: round(gridArtifact.origins[origin][idx].base_terminal_share, 4),
        min_ke_minus_g: round(gridArtifact.origins[origin][idx].min_ke_minus_g, 4),
        label: "PROXY",
      };
    }
  }
}

// aggregates per index over 7 origins (proxy lane)
for (const idx of ["SPX", "NDX"]) {
  const rows = ORIGINS.map((o) => qaArtifact.per_origin[o]?.[idx]).filter(Boolean);
  const median = (arr) => { const s = [...arr].sort((a, b) => a - b); const m = s.length / 2; return s.length % 2 ? s[Math.floor(m)] : (s[m - 1] + s[m]) / 2; };
  qaArtifact.aggregates[idx] = {
    n: rows.length,
    band_hit_rate: round(rows.filter((r) => r.band_hit).length / rows.length, 4),
    median_band_width: round(median(rows.map((r) => r.band_width)), 4),
    median_band_miss_distance: round(median(rows.map((r) => r.band_miss_distance)), 4),
    direction_hit_rate: round(rows.filter((r) => r.direction_hit).length / rows.length, 4),
    median_base_abs_level_error: round(median(rows.map((r) => r.base_abs_level_error)), 4),
    median_gridmean_abs_level_error: round(median(rows.map((r) => r.gridmean_abs_level_error)), 4),
    median_no_change_abs_level_error: round(median(rows.map((r) => r.no_change_abs_level_error)), 4),
    base_to_naive_error_ratio: round(
      median(rows.map((r) => r.base_abs_level_error)) / median(rows.map((r) => r.no_change_abs_level_error)), 4),
    spearman_pred_vs_realized: null,
    label: "PROXY (never satisfies a READY gate)",
  };
  // spearman
  const xs = rows.map((r) => r.pred_base_return), ys = rows.map((r) => r.realized_12m_return);
  const rank = (arr) => { const o = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]); const r = new Array(arr.length); for (let i = 0; i < o.length; i++) r[o[i][1]] = i + 1; return r; };
  const rx = rank(xs), ry = rank(ys);
  const n = xs.length;
  const mx = rx.reduce((a, x) => a + x, 0) / n, my = ry.reduce((a, x) => a + x, 0) / n;
  const num = rx.reduce((s, x, i) => s + (x - mx) * (ry[i] - my), 0);
  const den = Math.sqrt(rx.reduce((s, x) => s + (x - mx) ** 2, 0) * ry.reduce((s, x) => s + (x - my) ** 2, 0));
  qaArtifact.aggregates[idx].spearman_pred_vs_realized = round(num / den, 4);
}
writeJson("FENO_RIM_E5_HISTORICAL_GRID.json", gridArtifact);
writeJson("FENO_RIM_E5_12M_TARGET_QA.json", qaArtifact);
writeJson("FENO_RIM_E5_BENCHMARK_COMPARISON.json", benchArtifact);
// writeJson(FRAGILITY) moved after current fragility block (line ~395)
console.log("historical grid / 12m QA / benchmark / fragility written");

// ============ 3. CURRENT fragility (live B inputs, ab46a51077-era) ============
const currentInputs = {
  SPX: { price: 7489.72, pb: 5.6916, eps: [383.3257, 452.9469, 537.4319], payout: 0.207015, ltroe: 0.2198 },
  NDX: { price: 28274.2, pb: 8.8371, eps: [1324.6293, 1612.164, 2229.7107], payout: 0.097071, ltroe: 0.3081 },
};
const rfCurrent = 0.0463; // criteria-frozen 2026-08-05
const erpCurrent = 0.0503;
for (const [idx, ci] of Object.entries(currentInputs)) {
  const b0 = ci.price / ci.pb;
  const gs = { g0: rfCurrent, g1: Math.max(0, rfCurrent - 0.01), g2: Math.max(0, rfCurrent - 0.02) };
  const bases = {};
  for (const [gk, g] of Object.entries(gs)) {
    const ke = rfCurrent + erpCurrent;
    const r = computeB({ b0, eps: ci.eps, payout: ci.payout, ke, ltroe: ci.ltroe, g });
    bases[gk] = { value: r.value, terminalShare: r.terminalShare };
  }
  const P0 = ci.price;
  fragArtifact.current[idx] = {
    inputs: { P0, B0: b0, rf: rfCurrent, erp_base: erpCurrent, ltroe: ci.ltroe, payout: ci.payout,
      eps_path: ci.eps, as_of: "2026-07-31 (benchmark) / 2026-08-05 (Rf criteria-frozen)" },
    base_g0: round(bases.g0.value, 2), base_g1: round(bases.g1.value, 2), base_g2: round(bases.g2.value, 2),
    shift_100bp: round(Math.abs(bases.g1.value / bases.g0.value - 1), 4),
    shift_200bp: round(Math.abs(bases.g2.value / bases.g0.value - 1), 4),
    direction_flip_100bp: (bases.g1.value - P0) * (bases.g0.value - P0) < 0,
    direction_flip_200bp: (bases.g2.value - P0) * (bases.g0.value - P0) < 0,
    base_terminal_share: round(bases.g0.terminalShare, 4),
    min_ke_minus_g: round(rfCurrent + erpCurrent - gs.g0, 4),
    label: "LIVE B (validation snapshot, not proxy)",
  };
  console.log(idx, "current | g0:", round(bases.g0.value,1), "| g1:", round(bases.g1.value,1),
    "| g2:", round(bases.g2.value,1), "| flip100:", (bases.g1.value - P0) * (bases.g0.value - P0) < 0,
    "| flip200:", (bases.g2.value - P0) * (bases.g0.value - P0) < 0,
    "| terminal share:", round(bases.g0.terminalShare, 4));
}

writeJson("FENO_RIM_E5_TERMINAL_FRAGILITY.json", fragArtifact);
// summary print
console.log("\n== 12m QA aggregates (PROXY lane) ==");
for (const idx of ["SPX", "NDX"]) {
  const a = qaArtifact.aggregates[idx];
  console.log(idx, "| n:", a.n, "| band hit:", a.band_hit_rate, "| dir hit:", a.direction_hit_rate,
    "| median base err:", a.median_base_abs_level_error, "| median no-change:", a.median_no_change_abs_level_error,
    "| base/naive:", a.base_to_naive_error_ratio, "| spearman:", a.spearman_pred_vs_realized);
}
console.log("\n== per-origin SPX (PROXY) ==");
for (const o of ORIGINS) {
  const r = qaArtifact.per_origin[o]?.SPX;
  if (r) console.log(o, "| P0:", r.P0, "| P12:", r.P12, "| Bear/Base/Bull:", r.BEAR, r.BASE, r.BULL,
    "| hit:", r.band_hit, "| dir:", r.direction_hit);
}
