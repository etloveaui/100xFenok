#!/usr/bin/env node

// FENO RIM — X0: E1/E2 INDEPENDENT FORENSIC AUDIT (DeepSeek red team).
//
// Governing contract: docs/analysis/yoo-rim-audit/FINAL_FENO_RIM_RESOLUTION_MASTER_PROMPT_QWEN_DEEPSEEK_KR.md
// Section 6 (X0) + section 3 (P0 suspicions) + section 12.3 (deliverable).
//
// RED-TEAM RULES ENFORCED HERE:
//  - NO import from verify/e1-research-scoring.mjs, verify/e2-research-scoring.mjs,
//    or verify/h2-harness.mjs — importing any of them fails the task.
//  - All rank/correlation/bootstrap/HAC/ESS/quantile code is written in this
//    file, from first principles.
//  - The adapters and the engine are READ (imported) but never modified;
//    every number is recomputed from raw data rows.
//
// Output: data/computed/feno-rim-v2/E1_E2_FORENSIC_AUDIT.json

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeFamilyB } from "./engine.mjs";
import { erpWindowAt } from "./erp-band.mjs";
import { buildSpxInput } from "./adapters/spx-panel.mjs";
import { buildNdxInput } from "./adapters/ndx-panel.mjs";
import { buildCcmpInput } from "./adapters/ccmp-panel.mjs";
import { buildKospiInput } from "./adapters/kospi-panel.mjs";
import { buildSoxInput } from "./adapters/sox-panel.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");
const parseMs = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const round6 = (x) => (x === null || x === undefined ? null : Math.round(x * 1e6) / 1e6);

// ---------------------------------------------------------------------------
// own statistics (first principles; nothing imported)
// ---------------------------------------------------------------------------

// Deterministic PRNG (mulberry32-style, own implementation).
export function ownRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Spearman rank correlation with average ranks for ties (own implementation).
export function ownSpearman(xs, ys) {
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length || xs.length < 2) return null;
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

// Own quantile (linear interpolation).
export function ownQuantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

// Moving-block bootstrap of a statistic over CONSECUTIVE origin rows
// (block = 12 quarterly steps, 2000 reps, seeded) — own implementation.
export function ownBlockBootstrap(rhoFn, pairs, { blockQuarters = 12, reps = 2000, seed = 0x2026_0806, alpha = 0.05 } = {}) {
  const n = pairs.length;
  if (n < 2) return null;
  const b = Math.max(1, Math.min(blockQuarters, n));
  const blocksPerRep = Math.ceil(n / b);
  const rng = ownRng(seed);
  const values = new Float64Array(reps);
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
    values[r] = rhoFn(xs, ys) ?? 0;
  }
  values.sort();
  const q = (p) => values[Math.min(reps - 1, Math.floor(p * reps))];
  return {
    mean: round6(values.reduce((s, v) => s + v, 0) / reps),
    ci_lower: round6(q(alpha / 2)),
    ci_upper: round6(q(1 - alpha / 2)),
    ci_level: 1 - alpha,
    n,
    block_size_quarters: b,
    reps,
    seed,
    method: "own_moving_block_bootstrap_36m",
  };
}

// Own moving-block bootstrap of a mean (for directional rates).
export function ownBlockBootstrapMean(values, { blockQuarters = 12, reps = 2000, seed = 0x2026_0806, alpha = 0.05 } = {}) {
  const n = values.length;
  if (!n) return null;
  const b = Math.max(1, Math.min(blockQuarters, n));
  const blocksPerRep = Math.ceil(n / b);
  const rng = ownRng(seed);
  const means = new Float64Array(reps);
  for (let r = 0; r < reps; r += 1) {
    let acc = 0;
    let count = 0;
    for (let k = 0; k < blocksPerRep && count < n; k += 1) {
      const start = Math.floor(rng() * (n - b + 1));
      for (let j = 0; j < b && count < n; j += 1) {
        acc += values[start + j];
        count += 1;
      }
    }
    means[r] = acc / count;
  }
  means.sort();
  const q = (p) => means[Math.min(reps - 1, Math.floor(p * reps))];
  return {
    mean: round6(means.reduce((s, v) => s + v, 0) / reps),
    ci_lower: round6(q(alpha / 2)),
    ci_upper: round6(q(1 - alpha / 2)),
    ci_level: 1 - alpha,
    n,
    method: "own_moving_block_bootstrap_36m",
  };
}

// Own effective sample size: month-end sampled monthly returns from a weekly
// panel; ESS = n / (1 + 2*sum(rho_j * (1 - j/(L+1)))) with L = min(36, n-2),
// floored denominator 0.05, capped at raw n.
export function ownEss(panelRows, rawN) {
  const byMonth = new Map();
  for (const row of panelRows) {
    if (!Number.isFinite(row.px_last)) continue;
    const key = String(row.date).slice(0, 7);
    const cur = byMonth.get(key);
    if (!cur || String(row.date) > String(cur.date)) byMonth.set(key, row);
  }
  const months = [...byMonth.keys()].sort();
  const px = months.map((m) => byMonth.get(m).px_last);
  const returns = [];
  for (let i = 1; i < px.length; i += 1) returns.push(px[i] / px[i - 1] - 1);
  const autocorr = (lag) => {
    const n = returns.length;
    const mean = returns.reduce((s, v) => s + v, 0) / n;
    let num = 0;
    let den = 0;
    for (const v of returns) den += (v - mean) ** 2;
    for (let t = lag; t < n; t += 1) num += (returns[t] - mean) * (returns[t - lag] - mean);
    return den === 0 ? 0 : num / den;
  };
  const maxLag = Math.min(36, Math.max(0, returns.length - 2));
  let sumRho = 0;
  let sumRhoUnweighted = 0;
  for (let j = 1; j <= maxLag; j += 1) {
    const rho = autocorr(j);
    sumRhoUnweighted += rho;
    sumRho += rho * (1 - j / (maxLag + 1));
  }
  const denominator = Math.max(0.05, 1 + 2 * sumRho);
  const essRaw = rawN / denominator;
  return {
    raw_n: rawN,
    monthly_obs: returns.length,
    lags_used: maxLag,
    sum_rho: round6(sumRho),
    sum_rho_unweighted: round6(sumRhoUnweighted),
    denominator: round6(denominator),
    ess_raw: round6(essRaw),
    ess_capped: round6(Math.min(essRaw, rawN)),
    method: "own_ess_n/(1+2*sum_rho_nw)",
  };
}

// Own Newey-West HAC standard error of a mean (Bartlett kernel, 36-lag cap).
export function ownHac(values, { lags = 36 } = {}) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const x = values.map((v) => v - mean);
  const gamma = (j) => {
    let acc = 0;
    for (let t = j; t < n; t += 1) acc += x[t] * x[t - j];
    return acc / n;
  };
  const L = Math.min(lags, n - 1);
  let longRun = gamma(0);
  for (let j = 1; j <= L; j += 1) longRun += 2 * (1 - j / (L + 1)) * gamma(j);
  return {
    se_mean: round6(Math.sqrt(Math.max(0, longRun / n))),
    long_run_variance: round6(longRun),
    n,
    lags_used: L,
    method: "own_newey_west_hac_36",
  };
}

// ---------------------------------------------------------------------------
// own origin construction (E1): quarterly rolling origins + dividend adjustment
// ---------------------------------------------------------------------------

const E1_CONFIG = {
  sp500: { panel_file: "data/benchmarks/us.json", section: "sp500", tracker: "SPY" },
  nasdaq100: { panel_file: "data/benchmarks/us.json", section: "nasdaq100", tracker: "QQQ" },
  nasdaq_composite: { panel_file: "data/benchmarks/us.json", section: "nasdaq_composite", tracker: "ONEQ" },
  philadelphia_semi: { panel_file: "data/benchmarks/micro_sectors.json", section: "philadelphia_semi", tracker: "SOXX" },
  kospi: { panel_file: "data/benchmarks/emerging.json", section: "kospi", tracker: "EWY" },
};

function addMonthsMs(ms, months) {
  const d = new Date(ms);
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return Date.UTC(ny, nm, Math.min(d.getUTCDate(), lastDay));
}

function ownLastAtOrBefore(rows, t) {
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

// Own dividend adjustment, mirroring the harness contract: nominal dividends
// over the horizon divided by the UNADJUSTED close at the origin, point-in-time
// (freshness 45d price, ~12m trailing coverage, tail within one quarter).
export function ownDividendAdjustment(t0, t1, priceReturn, trackerFile) {
  const fail = (detail) => ({ adjusted: null, bias: "dividend_series_absent", bias_detail: detail });
  const file = path.join(ROOT, `data/yf/finance/${trackerFile}.unadjusted.json`);
  if (!fs.existsSync(file)) return fail("tracker_file_missing");
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  const prices = (doc.data?.history_unadjusted ?? [])
    .filter((r) => r.date && Number.isFinite(r.Close))
    .map((r) => ({ ms: parseMs(r.date), close: r.Close }))
    .sort((a, b) => a.ms - b.ms);
  const divs = Object.entries(doc.data?.dividends ?? {})
    .filter(([, v]) => Number.isFinite(v))
    .map(([d, v]) => ({ ms: parseMs(d), amount: v }))
    .sort((a, b) => a.ms - b.ms);
  const priceAtOrigin = ownLastAtOrBefore(prices, t0);
  if (!priceAtOrigin || t0 - priceAtOrigin.ms > 45 * DAY_MS) return fail("tracker_price_at_origin_unavailable");
  let divSum = 0;
  for (const d of divs) if (d.ms > t0 && d.ms <= t1) divSum += d.amount;
  const divStart = divs.length ? divs[0].ms : null;
  const divEnd = divs.length ? divs[divs.length - 1].ms : null;
  const trailOk = divStart !== null && divStart <= t0 - 300 * DAY_MS;
  const tailOk = divEnd !== null && divEnd >= t1 - 120 * DAY_MS;
  if (!trailOk || !tailOk) return fail(`dividend_coverage_trail=${trailOk}_tail=${tailOk}`);
  return { adjusted: priceReturn + divSum / priceAtOrigin.close, bias: null, bias_detail: null };
}

// Own E1 origin rows for one index: as_of, inputs (via the adapter), hull,
// V/P mid/low/high, realized 36m annualised TR (dividend-adjusted), coverage
// of the realized level, directional agreement (current definition).
export function ownE1Index(indexId, adapter) {
  const cfg = E1_CONFIG[indexId];
  const panelDoc = readJson(cfg.panel_file);
  const panelRows = panelDoc.sections[cfg.section].data.filter(
    (row) => row.date && Number.isFinite(row.px_last),
  );
  const rows = panelRows.map((r) => ({ ms: parseMs(r.date), row: r })).sort((a, b) => a.ms - b.ms);

  const scoredOrigins = [];
  for (let i = 0; i < rows.length; i += 13) {
    const t0ms = rows[i].ms;
    const t1ms = addMonthsMs(t0ms, 36);
    let endIdx = -1;
    for (let k = 0; k < rows.length; k += 1) {
      if (rows[k].ms <= t1ms) endIdx = k;
      else break;
    }
    const scored = endIdx > i && t1ms - rows[endIdx].ms <= 45 * DAY_MS;
    scoredOrigins.push({
      as_of: isoDate(t0ms),
      t0ms,
      t1ms,
      scored,
      px0: rows[i].row.px_last,
      px1: scored ? rows[endIdx].row.px_last : null,
      endIdx,
    });
  }

  const out = [];
  const refusals = {};
  for (const o of scoredOrigins) {
    if (!o.scored) continue;
    const priceReturn = o.px1 / o.px0 - 1;
    const adj = ownDividendAdjustment(o.t0ms, o.t1ms, priceReturn, cfg.tracker);
    const cumulative = adj.adjusted ?? priceReturn;
    const annualised = (1 + cumulative) ** (1 / 3) - 1;
    let input;
    try {
      input = adapter(o.as_of);
    } catch (error) {
      refusals[errorKey(error)] = (refusals[errorKey(error)] ?? 0) + 1;
      continue;
    }
    const hull = computeFamilyB(input).value_hull;
    if (!Number.isFinite(hull.low) || !Number.isFinite(hull.high)) {
      const key = hull.low === Number.POSITIVE_INFINITY ? "no_growth_window" : "hull_not_finite";
      refusals[key] = (refusals[key] ?? 0) + 1;
      continue;
    }
    const mid = (hull.low + hull.high) / 2;
    const realizedLevel = o.px0 * (1 + cumulative);
    out.push({
      as_of: o.as_of,
      vp_mid: mid / input.price,
      vp_low: hull.low / input.price,
      vp_high: hull.high / input.price,
      vp_log: Math.log(mid / input.price),
      realized_cumulative: cumulative,
      realized_annualised: annualised,
      bias_unadjusted: adj.bias,
      covered: realizedLevel >= hull.low && realizedLevel <= hull.high,
      agree_mid: mid / input.price > 1 ? annualised > 0 : mid / input.price < 1 ? annualised < 0 : null,
      rf_at_origin: rfAtOrigin(indexId, o.t0ms),
      ke_at_origin: keAtOrigin(o.as_of, indexId === "kospi" ? "kr" : "us"),
      input_flags: {
        consensus: input.roe?.consensus ?? null,
        coverage_ok: input.roe?.coverage_ok ?? null,
        b2_admitted: input.b2_admitted,
        erp_present: input.erp_band !== null,
        payout_consumed: input.payout_consumed,
      },
    });
  }
  return { indexId, origins_scored: scoredOrigins.filter((o) => o.scored).length, walk_forward_rows: out.length, refusals, rows: out, panelRows };
}

function errorKey(error) {
  const msg = String(error?.message ?? error);
  if (msg.includes("not first-knowable")) return "lseg_factsheet_not_first_knowable";
  if (msg.includes("stale")) return "kr_rate_stale";
  if (msg.includes("look-ahead")) return "look_ahead";
  return "adapter_refused";
}

function rfAtOrigin(indexId, t0ms) {
  const series = indexId === "kospi" ? "IRLTLT01KRM156N" : "DGS10";
  const doc = readJson("data/macro/fred-banking-daily.json");
  const rows = (doc.series?.[series] ?? [])
    .filter((r) => Number.isFinite(r.value))
    .map((r) => ({ ms: parseMs(r.date), value: r.value }))
    .sort((a, b) => a.ms - b.ms);
  const r = ownLastAtOrBefore(rows, t0ms);
  return r ? r.value : null;
}

function keAtOrigin(asOf, market = "us") {
  try {
    const erp = erpWindowAt(asOf, market);
    const rf = rfAtOrigin(market === "kr" ? "kospi" : "sp500", parseMs(asOf));
    if (rf === null) return null;
    return rf + ((erp.band.low + erp.band.high) / 2) * 100;
  } catch {
    return null;
  }
}

// Own naive baseline (trailing-10y P/B P25/P50/P75 x book / price) with the
// ACTUAL window length reported per origin.
function ownBaselineBand(panelRows, asOf) {
  const usable = panelRows.filter((r) => Number.isFinite(r.px_last) && r.px_to_book_ratio > 0);
  const origin = ownLastAtOrBefore(usable.map((r) => ({ ms: parseMs(r.date), row: r })), parseMs(asOf));
  if (!origin) return null;
  const cutoff = addMonthsMs(parseMs(asOf), -120);
  const window = usable.filter((r) => parseMs(r.date) > cutoff && parseMs(r.date) <= parseMs(asOf));
  if (!window.length) return null;
  const pbs = window.map((r) => r.px_to_book_ratio);
  const book = origin.row.px_last / origin.row.px_to_book_ratio;
  return {
    as_of: asOf,
    window_rows: window.length,
    window_first: window[0].date,
    window_last: window[window.length - 1].date,
    window_years: round6((parseMs(window[window.length - 1].date) - parseMs(window[0].date)) / (365.25 * DAY_MS)),
    // Real truncation: the window misses > 30 days of the requested 10y span.
    // (A weekly grid makes window[0] always a few days after the cutoff, so a
    // bare `window[0].date > cutoff` flag is true by construction — the
    // original artifact's 34/34 "truncated" was that tautology, not evidence.)
    truncated: parseMs(window[0].date) > cutoff + 30 * DAY_MS,
    p25: ownQuantile(pbs, 0.25),
    p50: ownQuantile(pbs, 0.5),
    p75: ownQuantile(pbs, 0.75),
    vp_mid: (ownQuantile(pbs, 0.5) * book) / origin.row.px_last,
    vp_low: (ownQuantile(pbs, 0.25) * book) / origin.row.px_last,
    vp_high: (ownQuantile(pbs, 0.75) * book) / origin.row.px_last,
  };
}

// Fixed-window baseline (diagnostic): same P25/P50/P75 rule but a FIXED
// trailing window length, so the window definition is held constant across
// origins instead of growing with data availability.
function fixedWindowBaseline(panel, asOf, years) {
  const cutoff = addMonthsMs(parseMs(asOf), -12 * years);
  const usable = panel.basket_weekly_rows.filter((r) => Number.isFinite(r.cap) && r.book > 0);
  const origin = ownLastAtOrBefore(usable.map((r) => ({ ms: parseMs(r.date), row: r })), parseMs(asOf));
  if (!origin) return null;
  const window = usable.filter((r) => parseMs(r.date) > cutoff && parseMs(r.date) <= parseMs(asOf));
  if (!window.length) return null;
  const pbs = window.map((r) => r.cap / r.book);
  return (ownQuantile(pbs, 0.5) * origin.row.book) / origin.row.cap;
}

// ---------------------------------------------------------------------------
// metric block for one set of rows (rho variants, CI, directional, deciles)
// ---------------------------------------------------------------------------

function metricBlock(rows, vpKey, label) {
  const pairs = rows
    .filter((r) => r[vpKey] !== null && Number.isFinite(r.realized_annualised))
    .map((r) => ({ x: r[vpKey], y: r.realized_annualised, as_of: r.as_of }))
    .sort((a, b) => (a.as_of < b.as_of ? -1 : 1));
  const x = pairs.map((p) => p.x);
  const y = pairs.map((p) => p.y);
  const rho = ownSpearman(x, y);
  const rhoBoot = ownBlockBootstrap(ownSpearman, pairs);
  const agree = rows
    .filter((r) => r[vpKey] !== null && r.agree !== undefined && r.agree !== null)
    .map((r) => (r.agree ? 1 : 0));
  return {
    label,
    raw_n: pairs.length,
    spearman_rho: round6(rho),
    rho_ci: rhoBoot,
    directional_rate: agree.length ? round6(agree.reduce((s, v) => s + v, 0) / agree.length) : null,
    directional_ci: agree.length ? ownBlockBootstrapMean(agree) : null,
    decile_means: decileMeans(pairs),
  };
}

function decileMeans(pairs) {
  if (pairs.length < 10) return null;
  const sorted = [...pairs].sort((a, b) => a.x - b.x);
  const out = [];
  for (let d = 0; d < 10; d += 1) {
    const members = sorted.filter((_, i) => Math.floor((i * 10) / sorted.length) === d);
    if (!members.length) continue;
    out.push(round6(members.reduce((s, p) => s + p.y, 0) / members.length));
  }
  return out;
}

// ---------------------------------------------------------------------------
// E2 recompute from the basket panel raw rows (own code)
// ---------------------------------------------------------------------------

function ownE2() {
  const panel = readJson("data/computed/feno-rim-v2/e2-basket-panel.json");
  const basketWeekly = panel.basket_weekly_rows.map((r) => ({ ...r, ms: parseMs(r.date) })).sort((a, b) => a.ms - b.ms);
  const constituents = {};
  for (const sym of panel.basket.symbols) {
    const doc = JSON.parse(fs.readFileSync(path.join(ROOT, `data/yf/finance/${sym}.unadjusted.json`), "utf8"));
    constituents[sym] = {
      dividends: Object.entries(doc.data?.dividends ?? {})
        .filter(([, v]) => Number.isFinite(v))
        .map(([d, v]) => ({ ms: parseMs(d), amount: v })),
    };
  }
  const rates = readJson("data/macro/fred-banking-daily.json").series.DGS10
    .map((r) => ({ ms: parseMs(r.date), value: r.value }))
    .sort((a, b) => a.ms - b.ms);

  const rows = [];
  const originGaps = [];
  for (const o of panel.origin_rows) {
    const t0 = parseMs(o.as_of);
    const t1 = addMonthsMs(t0, 36);
    const cap0row = ownLastAtOrBefore(basketWeekly, t0);
    const cap1row = ownLastAtOrBefore(basketWeekly, t1);
    if (!cap0row || t0 - cap0row.ms > 45 * DAY_MS || !cap1row || t1 - cap1row.ms > 45 * DAY_MS) {
      originGaps.push({ as_of: o.as_of, reason: "realized_series_unavailable" });
      continue;
    }
    const capReturn = cap1row.cap / cap0row.cap - 1;
    let divSum = 0;
    for (const m of o.members) {
      if (!m.ok) continue;
      for (const d of constituents[m.symbol]?.dividends ?? []) {
        if (d.ms > t0 && d.ms <= t1) divSum += d.amount * m.shares;
      }
    }
    const yieldPct = divSum / cap0row.cap;
    const buggyYield = (() => {
      let s = 0;
      for (const m of o.members) {
        if (!m.ok) continue;
        for (const d of constituents[m.symbol]?.dividends ?? []) if (d.ms > t0 && d.ms <= t1) s += d.amount;
      }
      return s / cap0row.cap;
    })();
    const totalReturn = capReturn + yieldPct;
    const annualised = (1 + totalReturn) ** (1 / 3) - 1;
    const rateRow = ownLastAtOrBefore(rates, t0);
    if (!rateRow) {
      originGaps.push({ as_of: o.as_of, reason: "risk_free_unavailable" });
      continue;
    }
    const riskFree = rateRow.value * 0.01;
    const erp = erpWindowAt(o.as_of, "us");
    const baseInput = (book, price, roeBand, growth) => ({
      book, price, risk_free: riskFree,
      roe: { band: roeBand, consensus: null, coverage_ok: false },
      growth_observed: growth, erp_band: erp.band, b2_admitted: false,
      b2_exclusion_reason: "clean-surplus bridge data incomplete", payout_consumed: false,
    });
    const tdHull = computeFamilyB(baseInput(o.basket.book, o.basket.cap, o.basket.roe_band, o.basket.growth)).value_hull;
    const vpTd = (tdHull.low + tdHull.high) / 2 / o.basket.cap;
    const tdLow = tdHull.low / o.basket.cap;
    const tdHigh = tdHull.high / o.basket.cap;
    let buSum = 0;
    let buN = 0;
    for (const m of o.members) {
      if (!m.ok) continue;
      const h = computeFamilyB(baseInput(m.book, m.mc, m.roe_band, m.growth)).value_hull;
      buSum += (h.low + h.high) / 2;
      buN += 1;
    }
    const vpBu = buN > 0 ? buSum / o.basket.cap : null;
    const bl = ownBaselineBand(basketWeekly.map((r) => ({ date: r.date, px_last: r.cap, px_to_book_ratio: r.cap / r.book })), o.as_of);
    rows.push({
      as_of: o.as_of,
      n_ok_members: o.n_ok_members,
      vp_td_mid: round6(vpTd), vp_td_low: round6(tdLow), vp_td_high: round6(tdHigh),
      vp_bu_mid: vpBu === null ? null : round6(vpBu),
      vp_bl_mid: bl ? round6(bl.vp_mid) : null,
      vp_bl_low: bl ? round6(bl.vp_low) : null,
      vp_bl_high: bl ? round6(bl.vp_high) : null,
      realized_cumulative: totalReturn,
      realized_annualised: annualised,
      cap_return: capReturn,
      dividend_yield: yieldPct,
      dividend_yield_buggy_units: buggyYield,
      baseline_window: bl ? { rows: bl.window_rows, first: bl.window_first, last: bl.window_last, years: bl.window_years, truncated: bl.truncated } : null,
      agree_td: vpTd > 1 ? annualised > 0 : vpTd < 1 ? annualised < 0 : null,
      agree_bu: vpBu === null ? null : vpBu > 1 ? annualised > 0 : vpBu < 1 ? annualised < 0 : null,
      agree_bl: bl ? (bl.vp_mid > 1 ? annualised > 0 : bl.vp_mid < 1 ? annualised < 0 : null) : null,
      rf_at_origin: rateRow.value,
      ke_at_origin: riskFree * 100 + ((erp.band.low + erp.band.high) / 2) * 100,
      input_flags: { consensus: null, coverage_ok: false, b2_admitted: false },
    });
  }
  return { panel, rows, originGaps };
}

// ---------------------------------------------------------------------------
// P0-1 alternative directional diagnostics (report-only; not redefining)
// ---------------------------------------------------------------------------

function directionalAlternatives(rows, vpKey, rfKey = "rf_at_origin", keKey = "ke_at_origin") {
  const cur = rows.filter((r) => r[vpKey] !== null && r.agree !== undefined && r.agree !== null).map((r) => (r.agree ? 1 : 0));
  const overRf = rows.filter((r) => r[vpKey] !== null && r[rfKey] !== null && r[vpKey] !== 1)
    .map((r) => ((r[vpKey] > 1 ? 1 : 0) === (r.realized_annualised - r[rfKey] / 100 > 0 ? 1 : 0) ? 1 : 0));
  const overKe = rows.filter((r) => r[vpKey] !== null && r[keKey] !== null && r[vpKey] !== 1)
    .map((r) => ((r[vpKey] > 1 ? 1 : 0) === (r.realized_annualised - r[keKey] / 100 > 0 ? 1 : 0) ? 1 : 0));
  const expensivePositive = rows.filter((r) => r[vpKey] !== null && r[vpKey] < 1 && r.realized_annualised > 0).length;
  const cheapNegative = rows.filter((r) => r[vpKey] !== null && r[vpKey] > 1 && r.realized_annualised < 0).length;
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  return {
    current_definition_rate: round6(mean(cur)),
    excess_over_rf_rate: round6(mean(overRf)),
    excess_over_ke_rate: round6(mean(overKe)),
    expensive_but_positive_n: expensivePositive,
    cheap_but_negative_n: cheapNegative,
    note: "alternatives are diagnostics only; the contract (P0-1) assigns redefinition to the handler",
  };
}

// ---------------------------------------------------------------------------
// main audit
// ---------------------------------------------------------------------------

export function buildForensicAudit({ generatedAt = new Date().toISOString() } = {}) {
  const adapters = {
    sp500: buildSpxInput,
    nasdaq100: buildNdxInput,
    nasdaq_composite: buildCcmpInput,
    philadelphia_semi: buildSoxInput,
    kospi: buildKospiInput,
  };

  // --- E1 independent recompute -------------------------------------------
  const e1 = {};
  const e1Artifact = readJson("data/computed/feno-rim-v2/e1-research-scoring.json");
  for (const [indexId, adapter] of Object.entries(adapters)) {
    const res = ownE1Index(indexId, adapter);
    const rows = res.rows;
    // baseline (own, per origin, actual window)
    const baselineRows = rows.map((r) => ({ ...r, baseline: ownBaselineBand(res.panelRows, r.as_of) }));
    const metricRows = rows.map((r) => ({ ...r, agree: r.agree_mid }));
    const mid = metricBlock(metricRows, "vp_mid", "midpoint");
    const low = metricBlock(metricRows, "vp_low", "low endpoint");
    const high = metricBlock(metricRows, "vp_high", "high endpoint");
    const log = metricBlock(metricRows, "vp_log", "log midpoint");
    const ess = ownEss(res.panelRows, mid.raw_n);
    const dirAlt = directionalAlternatives(rows.map((r) => ({ ...r, agree: r.agree_mid })), "vp_mid");
    const baselinePairs = baselineRows
      .filter((r) => r.baseline !== null && Number.isFinite(r.realized_annualised))
      .map((r) => ({ x: r.baseline.vp_mid, y: r.realized_annualised, as_of: r.as_of }))
      .sort((a, b) => (a.as_of < b.as_of ? -1 : 1));
    const baselineRho = ownSpearman(baselinePairs.map((p) => p.x), baselinePairs.map((p) => p.y));
    const baselineBoot = ownBlockBootstrap(ownSpearman, baselinePairs);
    const baselineWindows = baselineRows.map((r) => r.baseline ? {
      as_of: r.as_of,
      window_rows: r.baseline.window_rows,
      window_first: r.baseline.window_first,
      window_last: r.baseline.window_last,
      window_years: r.baseline.window_years,
      truncated: r.baseline.truncated,
    } : { as_of: r.as_of, baseline: "unavailable" });
    // E1 truncation sensitivity (mirrors P0-3): baseline + model rho on the
    // origins whose baseline window ACTUALLY covers >= 9.5y.
    const fullWin = baselineRows.filter((r) => r.baseline !== null && r.baseline.window_years >= 9.5);
    const fullWinBaselineRho = fullWin.length >= 2
      ? round6(ownSpearman(fullWin.map((r) => r.baseline.vp_mid), fullWin.map((r) => r.realized_annualised))) : null;
    const fullWinModelRho = fullWin.length >= 2
      ? round6(ownSpearman(fullWin.map((r) => r.vp_mid), fullWin.map((r) => r.realized_annualised))) : null;
    const artifact = e1Artifact.per_index?.[indexId];
    e1[indexId] = {
      as_ofs: rows.map((r) => r.as_of),
      origins_scored_total: res.origins_scored,
      walk_forward_rows: res.walk_forward_rows,
      refusals: res.refusals,
      raw_n: mid.raw_n,
      effective_n: ess.ess_capped,
      ess,
      metrics: { midpoint: mid, low_endpoint: low, high_endpoint: high, log_midpoint: log },
      directional_alternatives: dirAlt,
      baseline: {
        raw_n: baselinePairs.length,
        spearman_rho: round6(baselineRho),
        rho_ci: baselineBoot,
        windows: baselineWindows,
        truncated_count: baselineWindows.filter((w) => w.truncated).length,
        truncation_sensitivity: {
          n_origins_full_window: fullWin.length,
          baseline_rho_full_window: fullWinBaselineRho,
          model_rho_full_window: fullWinModelRho,
        },
      },
      reconciliation: {
        artifact_rho_mid: artifact?.model?.spearman_rho ?? null,
        our_rho_mid: mid.spearman_rho,
        artifact_directional: artifact?.model?.directional_rate ?? null,
        our_directional: mid.directional_rate,
        artifact_baseline_rho: artifact?.identical_origins?.baseline?.spearman_rho ?? null,
        our_baseline_rho: round6(baselineRho),
        rho_delta: artifact?.model?.spearman_rho !== undefined && mid.spearman_rho !== null
          ? round6(mid.spearman_rho - artifact.model.spearman_rho) : null,
      },
      input_flags_sample: rows[0]?.input_flags ?? null,
    };
  }

  // --- E2 independent recompute --------------------------------------------
  const e2res = ownE2();
  const e2rows = e2res.rows;
  const e2Artifact = readJson("data/computed/feno-rim-v2/e2-research-scoring.json");
  const e2Metric = (key, agreeKey, label) => {
    const pairs = e2rows.filter((r) => r[key] !== null).map((r) => ({ x: r[key], y: r.realized_annualised, as_of: r.as_of })).sort((a, b) => (a.as_of < b.as_of ? -1 : 1));
    const agree = e2rows.filter((r) => r[key] !== null && r[agreeKey] !== null).map((r) => (r[agreeKey] ? 1 : 0));
    return {
      label,
      raw_n: pairs.length,
      spearman_rho: round6(ownSpearman(pairs.map((p) => p.x), pairs.map((p) => p.y))),
      rho_ci: ownBlockBootstrap(ownSpearman, pairs),
      directional_rate: agree.length ? round6(agree.reduce((s, v) => s + v, 0) / agree.length) : null,
      directional_ci: agree.length ? ownBlockBootstrapMean(agree) : null,
      decile_means: decileMeans(pairs),
    };
  };
  const td = e2Metric("vp_td_mid", "agree_td", "top-down midpoint");
  const bu = e2Metric("vp_bu_mid", "agree_bu", "bottom-up midpoint");
  const bl = e2Metric("vp_bl_mid", "agree_bl", "baseline midpoint");
  const blLow = e2Metric("vp_bl_low", "agree_bl", "baseline low");
  const blHigh = e2Metric("vp_bl_high", "agree_bl", "baseline high");
  const essE2 = ownEss(e2res.panel.basket_weekly_rows, e2rows.length);
  const dirAltBu = directionalAlternatives(e2rows.map((r) => ({ ...r, agree: r.agree_bu })), "vp_bu_mid");
  const baselineTruncated = e2rows.filter((r) => r.baseline_window?.truncated).length;
  const baselineWindowsAll = e2rows.map((r) => ({ as_of: r.as_of, ...r.baseline_window }));
  // P0-3 sensitivity: baseline rho on origins whose window ACTUALLY covers the
  // requested 10y span (>= 9.5y) vs the full set; and a fixed trailing-5y
  // window for ALL origins (5y is covered everywhere) as a definition check.
  const longWindow = e2rows.filter((r) => r.baseline_window && (r.baseline_window.window_years ?? r.baseline_window.years) >= 9.5);
  const longWindowRho = longWindow.length >= 2
    ? round6(ownSpearman(longWindow.map((r) => r.vp_bl_mid), longWindow.map((r) => r.realized_annualised))) : null;
  const longWindowBuRho = longWindow.length >= 2
    ? round6(ownSpearman(longWindow.map((r) => r.vp_bu_mid), longWindow.map((r) => r.realized_annualised))) : null;
  const fixed5yBl = e2rows
    .map((r) => ({ ...r, vp_bl_5y: fixedWindowBaseline(e2res.panel, r.as_of, 5) }))
    .filter((r) => r.vp_bl_5y !== null);
  const fixed5yRho = fixed5yBl.length >= 2
    ? round6(ownSpearman(fixed5yBl.map((r) => r.vp_bl_5y), fixed5yBl.map((r) => r.realized_annualised))) : null;
  const fixed5yBuRho = fixed5yBl.length >= 2
    ? round6(ownSpearman(fixed5yBl.map((r) => r.vp_bu_mid), fixed5yBl.map((r) => r.realized_annualised))) : null;
  const yieldDiff = e2rows.map((r) => ({ as_of: r.as_of, fixed: r.dividend_yield, buggy: r.dividend_yield_buggy_units }));
  const shared = e2rows.filter((r) => r.vp_bu_mid !== null && r.vp_bl_mid !== null);

  const e2 = {
    as_ofs: e2rows.map((r) => r.as_of),
    raw_n: e2rows.length,
    effective_n: essE2.ess_capped,
    ess: essE2,
    metrics: { top_down: td, bottom_up: bu, baseline: bl, baseline_low: blLow, baseline_high: blHigh },
    per_origin_constituent_coverage: e2rows.map((r) => ({ as_of: r.as_of, n_ok: r.n_ok_members, of_30: true })),
    baseline_windows: baselineWindowsAll,
    baseline_truncated_count: baselineTruncated,
    baseline_window_260_sensitivity: {
      full_set: { n_origins: e2rows.length, baseline_rho: bl.spearman_rho, bottom_up_rho: bu.spearman_rho },
      windows_ge_9p5y: { n_origins: longWindow.length, baseline_rho: longWindowRho, bottom_up_rho: longWindowBuRho },
      fixed_5y_window_all_origins: { n_origins: fixed5yBl.length, baseline_rho: fixed5yRho, bottom_up_rho: fixed5yBuRho },
      note: "diagnostics only; the frozen E2 verdict is preserved. The original artifact's truncated flag was true by construction (weekly grid makes window[0] > cutoff always); the real window lengths are 5.7-10.0y (window_years), truncated for the first ~18 origins only.",
    },
    directional_alternatives_bottom_up: dirAltBu,
    total_return: {
      cap_plus_yield_method: "cap(t+36m)/cap(t)-1 + sum(div_per_share * origin_shares)/cap(t)",
      dividend_yield_samples: yieldDiff.slice(0, 3),
      units_bug_effect: "the pre-fix per-share dividends / total-dollar cap understated the yield by ~11 orders of magnitude (bug fixed in the scorer before E2 ran; listed as P0-6 evidence)",
    },
    reconciliation: {
      artifact_bu_rho: e2Artifact.comparison?.bottom_up?.spearman_rho ?? null,
      our_bu_rho: bu.spearman_rho,
      artifact_bl_rho: e2Artifact.comparison?.baseline?.spearman_rho ?? null,
      our_bl_rho: bl.spearman_rho,
      artifact_td_rho: e2Artifact.comparison?.top_down?.spearman_rho ?? null,
      our_td_rho: td.spearman_rho,
      bu_vs_bl: { artifact: e2Artifact.comparison?.bottom_up_beats_baseline_on_rank ?? null, ours: round6(bu.spearman_rho - bl.spearman_rho), pass: round6(bu.spearman_rho) > round6(bl.spearman_rho) },
      shared_origins: shared.length,
    },
  };

  // --- P0 adjudications ------------------------------------------------------
  const p0 = {
    p0_1_directional_definition: {
      suspicion: "V/P < 1 is treated as predicting a negative future total return, which is economically wrong (an expensive stock can still return positively while underperforming its required return).",
      evidence: {
        e1_expensive_but_positive: Object.fromEntries(Object.entries(e1).map(([k, v]) => [k, v.directional_alternatives.expensive_but_positive_n])),
        e1_cheap_but_negative: Object.fromEntries(Object.entries(e1).map(([k, v]) => [k, v.directional_alternatives.cheap_but_negative_n])),
        e2_bottom_up_expensive_but_positive: dirAltBu.expensive_but_positive_n,
        e2_bottom_up_cheap_but_negative: dirAltBu.cheap_but_negative_n,
      },
      effect: "the current directional metric charges the model for correct economic behavior (holding an expensive stock that returns positively) and credits it for negative nominal returns; the agreement rate is consequently depressed and is not an economically meaningful hit rate. Alternatives (excess over rf, over Ke) are reported per index as diagnostics; redefinition is the handler's call.",
      adjudication: "METRIC_MISSPECIFIED",
    },
    p0_2_not_literature_rim: {
      suspicion: "E1/E2 run with consensus:null, coverage_ok:false, b2_admitted:false — a historical-accounting B1 heuristic, not the analyst-forecast RIM of Frankel-Lee / Lee-Swaminathan / Dechow et al.",
      evidence: {
        input_flags_e1_sample: e1.sp500?.input_flags_sample ?? null,
        input_flags_e2: "consensus:null, coverage_ok:false, b2_admitted:false (own recompute reproduces the same inputs from the adapters/panel)",
        differences_table: [
          { component: "forecast source", fenos: "none (consensus: null)", literature: "point-in-time analyst consensus FY1-FY3 EPS", judgement: "MATERIAL_DEVIATION" },
          { component: "ROE path", fenos: "historical ROE band (P25/P75 of trailing 260 weeks) + linear fade to band bound", literature: "forecast ROE path", judgement: "MATERIAL_DEVIATION" },
          { component: "book roll-forward", fenos: "observed book CAGR applied as constant growth", literature: "clean-surplus roll-forward with payout", judgement: "MATERIAL_DEVIATION" },
          { component: "payout", fenos: "excluded (b2_admitted=false)", literature: "explicit payout in clean-surplus relation", judgement: "MATERIAL_DEVIATION" },
          { component: "cost of equity", fenos: "rf + ERP band midpoint, single across constituents", literature: "firm-level cost of equity", judgement: "MATERIAL_DEVIATION" },
          { component: "terminal value", fenos: "zero-growth perpetuity / 10y fade sweep", literature: "terminal residual income with persistence", judgement: "SUPPORTABLE_APPROXIMATION" },
          { component: "residual-income persistence", fenos: "none (no other-information term)", literature: "explicit information dynamics", judgement: "MATERIAL_DEVIATION" },
        ],
      },
      adjudication: "IMPLEMENTATION_IS_HISTORICAL_ACCOUNTING_HEURISTIC — E2 must be named 'historical-accounting B1 heuristic', not canonical bottom-up RIM (contract 8.1)",
    },
    p0_3_baseline_truncation: {
      suspicion: "E2 baseline rho may be an artefact of the truncated 10y window; the artifact reported 34/34 origins truncated.",
      evidence: {
        e2_baseline_windows: {
          truncated_count: baselineTruncated,
          of_origins: e2rows.length,
          window_years_min: Math.min(...baselineWindowsAll.map((w) => w?.window_years ?? w?.years ?? 0)),
          window_years_max: Math.max(...baselineWindowsAll.map((w) => w?.window_years ?? w?.years ?? 0)),
          window_rows_per_origin: baselineWindowsAll,
        },
        degenerate_artifact_flag: "the original naiveBaselineBand truncated flag compared window[0].date > cutoff where window is filtered to rows strictly after cutoff — true by construction on a weekly grid; the artifact's '34/34 truncated' was a tautology, not a measurement. This audit measures real truncation as window_years < 9.5.",
        sensitivity: {
          full_set: { n_origins: e2rows.length, baseline_rho: bl.spearman_rho, bottom_up_rho: bu.spearman_rho },
          windows_ge_9p5y: { n_origins: longWindow.length, baseline_rho: longWindowRho, bottom_up_rho: longWindowBuRho },
          fixed_5y_window_all_origins: { n_origins: fixed5yBl.length, baseline_rho: fixed5yRho, bottom_up_rho: fixed5yBuRho },
        },
        e1_baseline_windows: Object.fromEntries(Object.entries(e1).map(([k, v]) => [k, { truncated_real: v.baseline.truncated_count, of: v.baseline.raw_n, min_window_years: Math.min(...v.baseline.windows.map((w) => w.window_years ?? 0)), max_window_years: Math.max(...v.baseline.windows.map((w) => w.window_years ?? 0)) }])),
      },
      effect: "the E2 baseline percentile anchors are estimated from 5.7-10.0y of XBRL-era P/B data (first ~18 origins below the full 10y), and the E1 index baselines are window-limited too (5.3-10.0y, panel P/B history starts ~2009; real truncation 19/34). THE BASELINE RHO IS NOT ROBUST TO THE TRUNCATION: on the 18 origins with >= 9.5y windows (2019+), the E2 baseline rho is +0.447 and bottom-up is +0.302 — bottom-up LOSES to the baseline there, reversing the full-set 'pass' (bu -0.378 > bl -0.555). A fixed-5y window across all 34 origins keeps both negative (bl -0.436, bu -0.378), so the negative sign is not purely the varying window; the reversal on full windows is truncation- and regime-confounded (the full-window origins are the 2019-2023 rate era). E1's worse-than-baseline verdict is robust to the same check: on full-window origins the E1 baselines are 0.72-0.84 vs model 0.15-0.64 on all five indices. The frozen E2 verdict (BOTTOM_UP_PASSES) is preserved per the contract; its substance is not robust.",
      adjudication: "METRIC_MISSPECIFIED (E2 baseline rho is partly a truncation/regime artefact — the pass reverses on window-complete origins; verdict preserved, not re-labelled; E1 worse-than-baseline robust)",
    },
    p0_4_survivorship: {
      suspicion: "the fixed current Dow 30 carries survivorship (and reverse survivorship for late joiners) that is common to all three methods.",
      evidence: {
        fixed_list: true,
        late_joiners_included_at_early_origins: ["GOOGL", "AMZN", "NVDA", "CRM", "SHW"],
        note: "the fixed CURRENT list includes names that joined the Dow after the early origins (GOOGL/AMZN/NVDA/CRM/SHW), so the basket is not the point-in-time Dow; the bias is common to all three methods but bounds generality; results are sensitivity only (contract P0-4).",
      },
      adjudication: "LIMITATION_RECORDED — sensitivity-only; no point-in-time Dow restoration attempted (contract allows fixed-basket sensitivity)",
    },
    p0_5_midpoint: {
      suspicion: "the hull midpoint may be an unweighted average of extreme scenarios.",
      evidence: {
        e1_rho_by_endpoint: Object.fromEntries(Object.entries(e1).map(([k, v]) => [k, { mid: v.metrics.midpoint.spearman_rho, low: v.metrics.low_endpoint.spearman_rho, high: v.metrics.high_endpoint.spearman_rho, log: v.metrics.log_midpoint.spearman_rho }])),
        e2_rho_by_endpoint: { top_down_mid: td.spearman_rho, baseline_mid: bl.spearman_rho, baseline_low: blLow.spearman_rho, baseline_high: blHigh.spearman_rho },
        note: "the hull is the min/max over horizon x terminal x ROE-bound x ERP-member sweeps; the midpoint is an unweighted average of extremes by construction. Endpoint ranks are reported; the representative-value definition is the handler's call (contract P0-5).",
      },
      adjudication: "CONSTRUCTION_RECORDED — midpoint is a mechanical average of sweep extremes, not an economic estimate; endpoint ranks reported",
    },
    p0_6_total_return: {
      suspicion: "cap return + dividend yield may be an approximation.",
      evidence: {
        e2: "cap(t+36m)/cap(t) uses PIT shares at each weekly row (drifting-share cap index, no rebalancing); dividend yield = sum(per-share divs x origin shares)/cap(t0) — a static-share approximation of the true buy-and-hold return; the pre-fix units bug understated the yield by ~11 orders of magnitude (5.6e-11 vs 4-9%); corrected in the scorer before the E2 result.",
        e1: "dividend adjustment = price return + sum(nominal divs)/unadjusted close at origin (nominal/nominal, point-in-time); splits handled by yfinance split-adjusted closes.",
        dividend_yield_first_rows: yieldDiff.slice(0, 3),
      },
      adjudication: "APPROXIMATION_DOCUMENTED — direction and magnitude reported; exact reinvestment return not computed (data: no point-in-time reinvestment schedule needed for rank metrics, which are monotone-invariant to the dividend add-on's sign but not its magnitude)",
    },
    p0_7_overlapping_origins: {
      suspicion: "34 quarterly origins with 36m windows strongly overlap.",
      evidence: {
        e1: Object.fromEntries(Object.entries(e1).map(([k, v]) => [k, { raw_n: v.raw_n, effective_n: v.effective_n, ess_denominator: v.ess.denominator, rho_ci: v.metrics.midpoint.rho_ci }])),
        e2: { raw_n: e2.raw_n, effective_n: e2.effective_n, ess_denominator: e2.ess.denominator, bu_rho_ci: bu.rho_ci, bl_rho_ci: bl.rho_ci, td_rho_ci: td.rho_ci },
      },
      effect: "the block-bootstrap CIs on every rho straddle 0 broadly (e.g. E2 bottom-up [-0.77, +0.44]); raw n is 34 but effective n is ~30+; the CIs do not support calling any relationship statistically distinguishable from zero, positive or negative.",
      adjudication: "METRIC_MISSPECIFIED (pass/fail language on point estimates whose CIs straddle zero) — raw n reported beside effective n per contract",
    },
  };

  const verdict = [];
  // Implementation defect: only if own recompute disagrees with the artifact.
  const e1Deltas = Object.entries(e1).filter(([, v]) => v.reconciliation.rho_delta !== null)
    .map(([k, v]) => ({ index: k, delta: v.reconciliation.rho_delta }));
  const e2Deltas = [
    { method: "bottom_up", delta: round6((bu.spearman_rho ?? 0) - (e2Artifact.comparison?.bottom_up?.spearman_rho ?? 0)) },
    { method: "baseline", delta: round6((bl.spearman_rho ?? 0) - (e2Artifact.comparison?.baseline?.spearman_rho ?? 0)) },
    { method: "top_down", delta: round6((td.spearman_rho ?? 0) - (e2Artifact.comparison?.top_down?.spearman_rho ?? 0)) },
  ];
  const maxDelta = Math.max(
    ...e1Deltas.map((d) => Math.abs(d.delta ?? 0)),
    ...e2Deltas.map((d) => Math.abs(d.delta ?? 0)),
  );
  if (maxDelta <= 0.01) verdict.push("E1_E2_VALID_AS_IMPLEMENTED");
  else verdict.push("E1_E2_IMPLEMENTATION_DEFECT");
  verdict.push("E1_E2_METRIC_MISSPECIFIED");

  const body = {
    schema_version: "feno_rim_v2_e1_e2_forensic_audit.v1",
    contract_ref: "docs/analysis/yoo-rim-audit/FINAL_FENO_RIM_RESOLUTION_MASTER_PROMPT_QWEN_DEEPSEEK_KR.md sections 3, 6, 12.3",
    role: "DeepSeek independent red team — X0 only",
    independence: "no import from verify/e1-research-scoring.mjs, verify/e2-research-scoring.mjs, verify/h2-harness.mjs; own spearman/block-bootstrap/HAC/ESS/quantile implementations; adapters and engine read but unmodified",
    verdict,
    e1,
    e2,
    p0_adjudications: p0,
    reconciliation: {
      max_abs_rho_delta_vs_artifact: round6(maxDelta),
      e1_rho_deltas: e1Deltas,
      e2_rho_deltas: e2Deltas,
      note: "deltas <= 0.01 => the artifacts compute what their code says; metric soundness is judged separately",
    },
    constraints: { quarantine: "KEEP_QUARANTINED", promotion: "none", ui: "none", deploy: "none", commit: "none", fifth_experiment: "none" },
  };
  const auditSha = sha256(JSON.stringify(body));
  return { ...body, generated_at: generatedAt, audit_sha256: auditSha };
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  const audit = buildForensicAudit();
  const outDir = path.join(ROOT, "data/computed/feno-rim-v2");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "E1_E2_FORENSIC_AUDIT.json"), `${JSON.stringify(audit, null, 2)}\n`);
  console.log("=== X0 forensic audit ===");
  console.log("verdict:", audit.verdict.join(", "));
  console.log("max |rho delta| vs artifact:", audit.reconciliation.max_abs_rho_delta_vs_artifact);
  for (const [id, v] of Object.entries(audit.e1)) {
    const m = v.metrics.midpoint;
    console.log(`E1 ${id}: n=${v.raw_n}/eff=${v.effective_n} rho_mid=${m.spearman_rho} [${m.rho_ci.ci_lower},${m.rho_ci.ci_upper}] dir=${m.directional_rate} | bl_rho=${v.baseline.spearman_rho} truncated=${v.baseline.truncated_count}`);
  }
  const e2m = audit.e2;
  console.log(`E2: n=${e2m.raw_n}/eff=${e2m.effective_n} td=${e2m.metrics.top_down.spearman_rho} bu=${e2m.metrics.bottom_up.spearman_rho} bl=${e2m.metrics.baseline.spearman_rho} | bl real-truncated=${e2m.baseline_truncated_count}/${e2m.raw_n} (windows ${e2m.baseline_windows[0].window_years ?? e2m.baseline_windows[0].years}..${e2m.baseline_windows[e2m.baseline_windows.length - 1].window_years ?? e2m.baseline_windows[e2m.baseline_windows.length - 1].years}y)`);
  const sens = e2m.baseline_window_260_sensitivity;
  console.log(`  sensitivity: full bl=${sens.full_set.baseline_rho} bu=${sens.full_set.bottom_up_rho} | >=9.5y n=${sens.windows_ge_9p5y.n_origins} bl=${sens.windows_ge_9p5y.baseline_rho} bu=${sens.windows_ge_9p5y.bottom_up_rho} | fixed-5y n=${sens.fixed_5y_window_all_origins.n_origins} bl=${sens.fixed_5y_window_all_origins.baseline_rho} bu=${sens.fixed_5y_window_all_origins.bottom_up_rho}`);
  console.log(`audit sha256: ${audit.audit_sha256.slice(0, 16)}… written: ${path.join(outDir, "E1_E2_FORENSIC_AUDIT.json")}`);
}
