#!/usr/bin/env node

// FENO RIM v2 — Phase 3A: H2 market-validity holdout harness.
//
// SPEC v3.0 §9 (FENO_RIM_RECONSTRUCTION_SPEC_v3_0.md). Phase 3A builds the
// harness structure only: rolling origins, dividend-bias labelling,
// purge/embargo selection sets, 36-month block bootstrap, HAC (Newey-West at
// 36 lags) cross-check, and effective sample size. It ends in a feasibility
// receipt that PRE-FREEZES which §9 minimums are achievable with the data
// that exists today.
//
// CRITICAL FROZEN POLICY: every number in the feasibility receipt derives
// from DATA AVAILABILITY and OVERLAP AUTOCORRELATION alone. No model output
// (fair value, upside, coverage of a predicted band, directional rate) is
// computed here or anywhere downstream of this file; the model-dependent §9
// criteria are carried as `achievable_now: null` placeholders only.
//
// Deterministic: identical input files produce an identical receipt hash;
// generated_at is excluded from the hash (same pattern as evidence-manifest).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const H2_SCHEMA_VERSION = "feno_rim_v2_h2_feasibility_receipt.v1";

// §9 minimum pass criteria, quoted verbatim as the frozen threshold set.
export const SPEC_MINIMUMS = Object.freeze({
  evaluation_span_years: 8,
  indices_passing: 4,
  effective_origins_per_index: 30,
  effective_origins_per_regime_bucket: 20,
});

// Method identifiers frozen into the receipt. Phase 3B+ must use exactly
// these methods; changing an id requires a new receipt version.
export const METHOD_IDS = Object.freeze({
  origins: "quarterly_rolling_origins:step_weeks=13,horizon_months=36,inputs_first_knowable_at_origin",
  purge_embargo: "purge_gap_months=36(train_window_rule)+embargo_quarters=1(after_eval_window)",
  bootstrap: "moving_block_bootstrap:block_months=36(=12_quarterly_steps),bartlett_free,seeded",
  hac: "newey_west_hac:bartlett_kernel,lag_cap=36",
  ess: "n_origins/(1+2*sum(rho_j,j=1..36)):monthly_series=month_end_sampled_panel",
});

// Crisis windows named by §9 ("2008-09/2020-03"). An origin lands in a
// crisis bucket when its as_of falls inside the window (same origin-date
// semantics the rate buckets use).
export const CRISIS_WINDOWS = Object.freeze([
  Object.freeze({ id: "crisis_2008_09", start: "2008-09-01", end: "2009-06-30" }),
  Object.freeze({ id: "crisis_2020_03", start: "2020-02-01", end: "2020-04-30" }),
]);

// The six Phase 3A indices: panel section, dividend tracker (§9: the same
// tracker series the payout input uses), and the index's own risk-free series
// for regime buckets. Risk-free series come from data/macro/fred-banking-daily.json.
export const INDEX_CONFIG = Object.freeze({
  sp500: Object.freeze({ panel_file: "data/benchmarks/us.json", panel_section: "sp500", tracker: "SPY", rf_series: "DGS10", rf_label: "US 10Y Treasury (FRED DGS10, daily)" }),
  nasdaq100: Object.freeze({ panel_file: "data/benchmarks/us.json", panel_section: "nasdaq100", tracker: "QQQ", rf_series: "DGS10", rf_label: "US 10Y Treasury (FRED DGS10, daily)" }),
  nasdaq_composite: Object.freeze({ panel_file: "data/benchmarks/us.json", panel_section: "nasdaq_composite", tracker: "ONEQ", rf_series: "DGS10", rf_label: "US 10Y Treasury (FRED DGS10, daily)" }),
  russell2000: Object.freeze({ panel_file: "data/benchmarks/us.json", panel_section: "russell2000", tracker: "IWM", rf_series: "DGS10", rf_label: "US 10Y Treasury (FRED DGS10, daily)" }),
  kospi: Object.freeze({ panel_file: "data/benchmarks/emerging.json", panel_section: "kospi", tracker: "EWY", rf_series: "IRLTLT01KRM156N", rf_label: "Korea long-term rate (OECD IRLTLT01KRM156N, monthly)" }),
  philadelphia_semi: Object.freeze({ panel_file: "data/benchmarks/micro_sectors.json", panel_section: "philadelphia_semi", tracker: "SOXX", rf_series: "DGS10", rf_label: "US 10Y Treasury (FRED DGS10, daily)" }),
});

// ---------------------------------------------------------------------------
// date and numeric helpers (UTC only; panel dates are ISO YYYY-MM-DD)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export const parseDateMs = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

export const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

// Exact calendar month arithmetic in UTC (day clamped to month length).
export function addMonthsMs(ms, months) {
  const d = new Date(ms);
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return Date.UTC(ny, nm, Math.min(d.getUTCDate(), lastDay));
}

const round6 = (x) => Math.round(x * 1e6) / 1e6;

// Deterministic PRNG so bootstrap output never depends on Math.random().
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Standard normal via Box-Muller (used by the synthetic test series).
export function gauss(rng) {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

// ---------------------------------------------------------------------------
// tracker normalization (data/yf/finance/{SYMBOL}.json)
// ---------------------------------------------------------------------------

// Normalizes one yf finance dump into date-sorted prices and dividends plus
// the identity check §9 requires ("or its identity fails"). Current files
// carry only ~1 year of price history (history_1y) and truncated dividend
// spans; both shortfalls surface as bias_unadjusted origins and data gaps.
//
// UNADJUSTED LEG (Phase 3B tracker slice): the dividend adjustment needs a
// NOMINAL close at the origin — an auto-adjusted close is understated at
// older origins by the cumulative distribution yield, which would overstate
// the add-on, one-sided, growing with origin age. The unadjusted leg lives in
// a SIBLING file data/yf/finance/{SYMBOL}.unadjusted.json and is purely
// additive: history_1y, its 260 cap and its auto_adjust semantics are
// untouched for the 18+ existing consumers. When the leg is absent or its
// identity fails, the §9 bias_unadjusted path is kept — never a silent
// fallback to the adjusted close.
export function loadTracker(symbol) {
  const file = `data/yf/finance/${symbol}.json`;
  if (!fs.existsSync(path.join(ROOT, file))) {
    return Object.freeze({ symbol, identity_ok: false, file_exists: false, prices: [], dividends: [], price_start: null, price_end: null, div_start: null, div_end: null, unadjusted: Object.freeze({ symbol, identity_ok: false, file_exists: false, prices: [], price_start: null, price_end: null }) });
  }
  const raw = readJson(file);
  const identityOk = raw.ticker === symbol;
  const prices = (raw.data?.history_1y ?? [])
    .filter((row) => row.date && Number.isFinite(row.Close))
    .map((row) => Object.freeze({ ms: parseDateMs(row.date), close: row.Close }))
    .sort((a, b) => a.ms - b.ms);
  const dividends = Object.entries(raw.data?.dividends ?? {})
    .map(([date, amount]) => Object.freeze({ ms: parseDateMs(date), amount }))
    .filter((row) => Number.isFinite(row.amount))
    .sort((a, b) => a.ms - b.ms);

  const unadjFile = `data/yf/finance/${symbol}.unadjusted.json`;
  const unadjusted = fs.existsSync(path.join(ROOT, unadjFile))
    ? (() => {
        const unadjRaw = readJson(unadjFile);
        const unadjIdentityOk = unadjRaw.ticker === symbol;
        const unadjPrices = (unadjRaw.data?.history_unadjusted ?? [])
          .filter((row) => row.date && Number.isFinite(row.Close))
          .map((row) => Object.freeze({ ms: parseDateMs(row.date), close: row.Close }))
          .sort((a, b) => a.ms - b.ms);
        return Object.freeze({
          symbol,
          identity_ok: unadjIdentityOk,
          file_exists: true,
          prices: unadjPrices,
          price_start: unadjPrices.length ? isoDate(unadjPrices[0].ms) : null,
          price_end: unadjPrices.length ? isoDate(unadjPrices[unadjPrices.length - 1].ms) : null,
        });
      })()
    : Object.freeze({ symbol, identity_ok: false, file_exists: false, prices: [], price_start: null, price_end: null });

  return Object.freeze({
    symbol,
    identity_ok: identityOk,
    file_exists: true,
    prices,
    dividends,
    price_start: prices.length ? isoDate(prices[0].ms) : null,
    price_end: prices.length ? isoDate(prices[prices.length - 1].ms) : null,
    div_start: dividends.length ? isoDate(dividends[0].ms) : null,
    div_end: dividends.length ? isoDate(dividends[dividends.length - 1].ms) : null,
    unadjusted,
  });
}

// ---------------------------------------------------------------------------
// buildOrigins — quarterly rolling origins with first-knowable gating
// ---------------------------------------------------------------------------

// Dividend adjustment for one origin, §9: realized return = price return plus
// the point-in-time trailing distribution yield accrued over the horizon,
// measured from the tracker series, reconstructed at the origin date. Any
// reconstruction failure (missing price at the origin, missing dividend span,
// failed identity) leaves the origin on raw price return and labels it
// bias_unadjusted: dividend_series_absent. The direction of the bias is
// stated: price return alone understates total return.
//
// DENOMINATOR (Phase 3B tracker slice): the yield is nominal over NOMINAL —
// the divisor is the UNADJUSTED close at the origin (tracker.unadjusted).
// An auto-adjusted close is understated at older origins by the cumulative
// distribution yield since that date, so the old denominator overstated the
// add-on, one-sided, growing with origin age (measured at an 11-year-old
// origin: +0.51pp EWY, +0.33pp SPY, +0.27pp IWM, +0.09pp ONEQ, +0.06pp QQQ,
// +0.03pp SOXX on a 36-month add-on). When the unadjusted leg is absent or
// its identity fails, the origin keeps the §9 bias_unadjusted path — there is
// no silent fallback to the adjusted close.
export function dividendAdjustment({ t0ms, t1ms, priceReturn }, tracker) {
  const fail = (detail) => Object.freeze({
    dividend_adjusted_return: null,
    bias: "dividend_series_absent",
    bias_detail: detail,
  });
  if (!tracker || !tracker.file_exists) return fail("tracker_file_missing");
  if (!tracker.identity_ok) return fail("tracker_identity_failed");

  const unadjusted = tracker.unadjusted;
  if (!unadjusted || !unadjusted.file_exists) return fail("unadjusted_close_series_absent");
  if (!unadjusted.identity_ok) return fail("unadjusted_close_identity_failed");

  // Unadjusted price at the origin: latest observation at/before as_of, fresh
  // within 45 days (point-in-time reconstruction at the origin date).
  let priceAtOrigin = null;
  for (const p of unadjusted.prices) {
    if (p.ms <= t0ms) priceAtOrigin = p;
    else break;
  }
  const priceOk = priceAtOrigin !== null && t0ms - priceAtOrigin.ms <= 45 * DAY_MS;

  // Dividend path over the horizon plus point-in-time trailing coverage: the
  // series must reach back ~12 months before the origin (trailing yield
  // knowable at the origin) and cover the window to within one quarter of the
  // horizon end.
  let divSum = 0;
  for (const d of tracker.dividends) {
    if (d.ms > t0ms && d.ms <= t1ms) divSum += d.amount;
  }
  const trailOk = tracker.div_start !== null && parseDateMs(tracker.div_start) <= t0ms - 300 * DAY_MS;
  const tailOk = tracker.div_end !== null && parseDateMs(tracker.div_end) >= t1ms - 120 * DAY_MS;

  if (!priceOk || !trailOk || !tailOk) {
    const missing = [];
    if (!priceOk) missing.push("tracker_price_at_origin_unavailable");
    if (!trailOk) missing.push("dividend_trailing_history_short");
    if (!tailOk) missing.push("dividend_horizon_tail_short");
    return fail(missing.join("+"));
  }
  // Yield accrued over the horizon, scaled by the UNADJUSTED tracker price at
  // the origin (same security on both sides keeps the ratio coherent), added
  // to the panel price return per §9.
  return Object.freeze({
    dividend_adjusted_return: round6(priceReturn + divSum / priceAtOrigin.close),
    bias: null,
    bias_detail: null,
  });
}

// Quarterly rolling origins over a weekly panel. Each origin carries:
// - inputs sampled at as_of only (first-knowable gating: no row after as_of
//   feeds any input field; realized_* fields are the evaluation labels);
// - train_window = all panel history knowable at the origin (used by the
//   purge rule);
// - eval_window = [as_of, as_of + horizonMonths];
// - realized 36m price return, and the dividend-adjusted return when the
//   tracker reconstructs point-in-time at the origin (else bias flag).
// The returned array also carries `.panel` so effectiveSampleSize can derive
// the month-end sampled monthly series from the same panel.
export function buildOrigins(panelRows, { horizonMonths = 36, stepWeeks = 13, tracker = null } = {}) {
  if (!Array.isArray(panelRows) || panelRows.length === 0) {
    throw new Error("buildOrigins: panelRows must be a non-empty array");
  }
  // Rows without a usable price cannot anchor an origin or a realized
  // return; they are skipped here and reported as a data gap upstream.
  let droppedRows = 0;
  const rows = [];
  for (const row of panelRows) {
    if (!row.date || !Number.isFinite(row.px_last)) {
      droppedRows += 1;
      continue;
    }
    rows.push({ ms: parseDateMs(row.date), row });
  }
  if (rows.length === 0) throw new Error("buildOrigins: no usable rows (date + px_last)");
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].ms < rows[i - 1].ms) throw new Error("buildOrigins: panelRows must be sorted by date");
  }

  // Last row index with date <= target (binary search; weekly panels have
  // gaps, so the match is tolerance-checked by the caller).
  const lastAtOrBefore = (targetMs) => {
    let lo = 0;
    let hi = rows.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid].ms <= targetMs) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  };

  const origins = [];
  for (let i = 0; i < rows.length; i += stepWeeks) {
    const t0ms = rows[i].ms;
    const t1ms = addMonthsMs(t0ms, horizonMonths);
    const endIdx = lastAtOrBefore(t1ms);
    // Scored only when the panel actually reaches the horizon end: the last
    // row at/before as_of+horizon must land within 45 days of it.
    const scored = endIdx > i && t1ms - rows[endIdx].ms <= 45 * DAY_MS;
    const priceReturn = scored ? rows[endIdx].row.px_last / rows[i].row.px_last - 1 : null;
    const adjustment = scored
      ? dividendAdjustment({ t0ms, t1ms, priceReturn }, tracker)
      : Object.freeze({ dividend_adjusted_return: null, bias: "dividend_series_absent", bias_detail: "origin_not_scored" });
    const input = rows[i].row;
    origins.push(Object.freeze({
      as_of: isoDate(t0ms),
      row_index: i,
      // First-knowable gating: this snapshot uses the row at as_of only.
      inputs: Object.freeze({
        px_last: input.px_last,
        px_to_book_ratio: input.px_to_book_ratio ?? null,
        roe: input.roe ?? null,
        best_eps: input.best_eps ?? null,
        first_knowable_at: isoDate(t0ms),
      }),
      train_window: Object.freeze({ start: isoDate(rows[0].ms), end: isoDate(t0ms) }),
      eval_window: Object.freeze({ start: isoDate(t0ms), end: isoDate(t1ms) }),
      scored,
      realized: Object.freeze({
        price_return_36m: scored ? round6(priceReturn) : null,
        dividend_adjusted_return_36m: adjustment.dividend_adjusted_return,
        bias_unadjusted: adjustment.bias, // null when adjusted, else "dividend_series_absent" (§9 label)
        bias_detail: adjustment.bias_detail,
      }),
    }));
  }
  origins.panel = panelRows; // convenience handle for effectiveSampleSize
  origins.dropped_rows = droppedRows; // rows skipped for missing date/px_last
  return origins;
}

// ---------------------------------------------------------------------------
// purgeEmbargo — selection sets with purge >= horizon and a 1-quarter embargo
// ---------------------------------------------------------------------------

// For each scored origin O (eval window [E0, E1]) the selection set contains
// candidate origins O' whose train/selection data window is safely separated
// from O's evaluation window:
//   kept-before:  O'.train_window.end   <= E0 - purgeMonths   (purge >= 36m;
//                 with a 36m horizon this also guarantees the kept origin's
//                 own evaluation window ends at or before E0);
//   kept-after:   O'.train_window.start >= E1 + embargoQuarters*13 weeks;
// everything else is purged (intersecting or inside the purge gap) or
// embargoed (starts after the window but within the embargo period).
// Any origin whose train window intersects [E0, E1] is therefore always
// excluded, satisfying §9's intersection rule and the stronger purge >= 36m.
export function purgeEmbargo(origins, { purgeMonths = 36, embargoQuarters = 1 } = {}) {
  const embargoMs = embargoQuarters * 13 * WEEK_MS;
  const scored = origins.filter((o) => o.scored);
  const perOrigin = scored.map((o) => {
    const e0 = parseDateMs(o.eval_window.start);
    const e1 = parseDateMs(o.eval_window.end);
    const purgeCutoff = addMonthsMs(e0, -purgeMonths);
    const embargoEnd = e1 + embargoMs;
    const kept = [];
    const purged = [];
    const embargoed = [];
    for (const c of origins) {
      if (c === o) {
        purged.push(c.as_of); // an origin never selects itself
        continue;
      }
      const trainStart = parseDateMs(c.train_window.start);
      const trainEnd = parseDateMs(c.train_window.end);
      if (trainEnd <= purgeCutoff || trainStart >= embargoEnd) kept.push(c.as_of);
      else if (trainStart >= e1) embargoed.push(c.as_of);
      else purged.push(c.as_of);
    }
    return Object.freeze({
      as_of: o.as_of,
      eval_window: o.eval_window,
      kept: Object.freeze(kept),
      purged: Object.freeze(purged),
      embargoed: Object.freeze(embargoed),
    });
  });
  return Object.freeze({
    config: Object.freeze({ purge_months: purgeMonths, embargo_quarters: embargoQuarters, rule: "train_window_purge_gap_plus_post_eval_embargo" }),
    per_origin: Object.freeze(perOrigin),
  });
}

// ---------------------------------------------------------------------------
// inference: 36-month block bootstrap and HAC Newey-West cross-check
// ---------------------------------------------------------------------------

// Moving-block bootstrap on quarterly origin scores with 36-month blocks
// (12 quarterly steps of 13 weeks). Handles the dependence between
// overlapping 36-month evaluation windows that §9 keeps (strict non-overlap
// is not imposed together with the 30-point minimum). Seeded => deterministic.
export function blockBootstrap36m(scores, { blockQuarters = 12, reps = 2000, seed = 0x2026_0806, alpha = 0.05 } = {}) {
  if (!Array.isArray(scores) || scores.length === 0) throw new Error("blockBootstrap36m: scores must be a non-empty array");
  const n = scores.length;
  const b = Math.max(1, Math.min(blockQuarters, n));
  const blocksPerRep = Math.ceil(n / b);
  const rng = mulberry32(seed);
  const mean = scores.reduce((s, x) => s + x, 0) / n;
  const repMeans = new Float64Array(reps);
  for (let r = 0; r < reps; r += 1) {
    let acc = 0;
    let count = 0;
    for (let k = 0; k < blocksPerRep && count < n; k += 1) {
      const start = Math.floor(rng() * (n - b + 1));
      for (let j = 0; j < b && count < n; j += 1) {
        acc += scores[start + j];
        count += 1;
      }
    }
    repMeans[r] = acc / count;
  }
  repMeans.sort();
  const quantile = (p) => repMeans[Math.min(reps - 1, Math.floor(p * reps))];
  return Object.freeze({
    mean: round6(mean),
    ci_lower: round6(quantile(alpha / 2)),
    ci_upper: round6(quantile(1 - alpha / 2)),
    ci_level: round6(1 - alpha),
    n,
    block_size_quarters: b,
    block_months: b * 3,
    reps,
    seed,
    method: "moving_block_bootstrap_36m",
  });
}

// HAC long-run variance of the mean via Newey-West (Bartlett kernel) with a
// 36-lag cap, §9's reported robustness cross-check. Lags are in units of the
// score cadence (quarterly origin steps for H2 scores); the lag count is
// capped at n-1 for short series.
export function hacNeweyWest36(scores, { lags = 36 } = {}) {
  if (!Array.isArray(scores) || scores.length < 2) throw new Error("hacNeweyWest36: need at least 2 scores");
  const n = scores.length;
  const mean = scores.reduce((s, x) => s + x, 0) / n;
  const x = scores.map((v) => v - mean);
  const gamma = (j) => {
    let acc = 0;
    for (let t = j; t < n; t += 1) acc += x[t] * x[t - j];
    return acc / n;
  };
  const L = Math.min(lags, n - 1);
  let longRun = gamma(0);
  for (let j = 1; j <= L; j += 1) {
    longRun += 2 * (1 - j / (L + 1)) * gamma(j);
  }
  const varMean = longRun / n;
  return Object.freeze({
    se_mean: round6(Math.sqrt(Math.max(0, varMean))),
    long_run_variance: round6(longRun),
    n,
    lags_requested: lags,
    lags_used: L,
    method: "newey_west_hac_36",
  });
}

// ---------------------------------------------------------------------------
// effectiveSampleSize — §9 formula on the month-end sampled monthly series
// ---------------------------------------------------------------------------

// Month-end sampling of a weekly panel: last row of each calendar month,
// simple monthly returns.
export function monthEndSeries(panelRows) {
  const byMonth = new Map();
  for (const row of panelRows) {
    if (!Number.isFinite(row.px_last)) continue;
    const key = String(row.date).slice(0, 7);
    const cur = byMonth.get(key);
    if (!cur || String(row.date) > String(cur.date)) byMonth.set(key, row);
  }
  const months = [...byMonth.keys()].sort();
  const px = months.map((key) => byMonth.get(key).px_last);
  const returns = [];
  for (let i = 1; i < px.length; i += 1) returns.push(px[i] / px[i - 1] - 1);
  return Object.freeze({ months: Object.freeze(months), px: Object.freeze(px), returns: Object.freeze(returns) });
}

function autocorr(x, lag) {
  const n = x.length;
  let mean = 0;
  for (const v of x) mean += v;
  mean /= n;
  let num = 0;
  let den = 0;
  for (let t = 0; t < n; t += 1) den += (x[t] - mean) ** 2;
  for (let t = lag; t < n; t += 1) num += (x[t] - mean) * (x[t - lag] - mean);
  return den === 0 ? 0 : num / den;
}

// ESS = origins ÷ (1 + 2·Σρ_j over the first 36 monthly lags of the scored
// monthly series), §9. The monthly series is the month-end sampled panel
// return series: pass the panel (or accept the `.panel` handle buildOrigins
// attaches), or pass a bare numeric monthly series directly (synthetic tests).
// The denominator is floored at 0.05 against degenerate series, and ESS is
// capped at the raw origin count (negative serial correlation is treated
// conservatively as no information gain). Both values are reported.
export function effectiveSampleSize(origins, panelOrSeries = null) {
  const nOrigins = origins.length;
  let monthly = null;
  if (Array.isArray(panelOrSeries) && panelOrSeries.length && typeof panelOrSeries[0] === "number") {
    monthly = panelOrSeries;
  } else if (Array.isArray(panelOrSeries) && panelOrSeries.length) {
    monthly = monthEndSeries(panelOrSeries).returns;
  } else if (origins.panel) {
    monthly = monthEndSeries(origins.panel).returns;
  } else {
    throw new Error("effectiveSampleSize: no panel rows or monthly series available");
  }
  const maxLag = Math.min(36, Math.max(0, monthly.length - 2));
  // Newey-West kernel weights on the sample autocorrelations: the raw 36-lag
  // sum is dominated by negative small-sample bias at high lags (a phi=0.7
  // AR(1) draw sums to ~0.1, not ~2.3), which would silently certify
  // overlapping origins as independent. The owner amendment sanctions HAC for
  // exactly this; the unweighted sum is reported alongside for transparency.
  let sumRho = 0;
  let sumRhoUnweighted = 0;
  for (let j = 1; j <= maxLag; j += 1) {
    const rho = autocorr(monthly, j);
    sumRhoUnweighted += rho;
    sumRho += rho * (1 - j / (maxLag + 1));
  }
  const denominator = Math.max(0.05, 1 + 2 * sumRho);
  const essRaw = nOrigins / denominator;
  return Object.freeze({
    n_origins: nOrigins,
    monthly_obs: monthly.length,
    lags_used: maxLag,
    sum_rho: round6(sumRho),
    sum_rho_unweighted: round6(sumRhoUnweighted),
    denominator: round6(denominator),
    ess_raw: round6(essRaw),
    ess_capped: round6(Math.min(essRaw, nOrigins)),
  });
}

// ---------------------------------------------------------------------------
// feasibility receipt — thresholds frozen from data availability alone
// ---------------------------------------------------------------------------

function quantileSorted(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// Point-in-time risk-free value at a date: latest observation at/before it.
function rfAt(rfRows, ms) {
  let value = null;
  for (const row of rfRows) {
    if (row.ms <= ms) value = row.value;
    else break;
  }
  return value;
}

function buildIndexFeasibility(indexId, cfg, generatedGaps) {
  const panelDoc = readJson(cfg.panel_file);
  const panelRows = panelDoc.sections[cfg.panel_section].data;
  const tracker = loadTracker(cfg.tracker);
  const origins = buildOrigins(panelRows, { horizonMonths: 36, stepWeeks: 13, tracker });
  const scored = origins.filter((o) => o.scored);

  // filter() drops the .panel handle buildOrigins attaches, so pass the panel
  // explicitly for the month-end sampled monthly series.
  const ess = effectiveSampleSize(scored, panelRows);

  // Evaluation span: first scored origin's as_of to last scored origin's
  // evaluation end (the period over which H2 evidence can ever exist).
  const spanYears = scored.length
    ? (parseDateMs(scored[scored.length - 1].eval_window.end) - parseDateMs(scored[0].as_of)) / (365.25 * DAY_MS)
    : 0;

  // Regime buckets, origin-date semantics. Rate quantiles come from the
  // index's own risk-free series over its full available history (data-only;
  // no model output involved). Crisis buckets from the §9 windows.
  const rfDoc = readJson("data/macro/fred-banking-daily.json");
  const rfRows = (rfDoc.series[cfg.rf_series] ?? [])
    .filter((row) => Number.isFinite(row.value))
    .map((row) => ({ ms: parseDateMs(row.date), value: row.value }))
    .sort((a, b) => a.ms - b.ms);
  const rfHistorySorted = rfRows.map((row) => row.value).sort((a, b) => a - b);
  const q13 = quantileSorted(rfHistorySorted, 1 / 3);
  const q23 = quantileSorted(rfHistorySorted, 2 / 3);
  const shrink = scored.length ? Math.min(1, ess.ess_capped / scored.length) : 0;

  const bucket = (rows) => {
    const count = rows.length;
    const effective = round6(count * shrink);
    return Object.freeze({
      origins: count,
      effective_origins: effective,
      sufficient: effective >= SPEC_MINIMUMS.effective_origins_per_regime_bucket,
    });
  };
  const scoredWithRf = scored.map((o) => ({ o, rf: rfRows.length ? rfAt(rfRows, parseDateMs(o.as_of)) : null, ms: parseDateMs(o.as_of) }));
  const regimeBuckets = Object.freeze({
    rf_series: cfg.rf_series,
    rf_label: cfg.rf_label,
    rf_quantiles: Object.freeze({ q_one_third: q13 === null ? null : round6(q13), q_two_thirds: q23 === null ? null : round6(q23) }),
    high_rate: bucket(scoredWithRf.filter((x) => x.rf !== null && q23 !== null && x.rf >= q23)),
    low_rate: bucket(scoredWithRf.filter((x) => x.rf !== null && q13 !== null && x.rf <= q13)),
    crisis_2008_09: bucket(scoredWithRf.filter((x) => x.ms >= parseDateMs(CRISIS_WINDOWS[0].start) && x.ms <= parseDateMs(CRISIS_WINDOWS[0].end))),
    crisis_2020_03: bucket(scoredWithRf.filter((x) => x.ms >= parseDateMs(CRISIS_WINDOWS[1].start) && x.ms <= parseDateMs(CRISIS_WINDOWS[1].end))),
  });

  // Data gaps, discovered from availability only.
  const gaps = [];
  if (origins.dropped_rows > 0) {
    gaps.push(`panel_rows_dropped_missing_px_last(${origins.dropped_rows})`);
  }
  const adjustedCount = scored.filter((o) => o.realized.bias_unadjusted === null).length;
  if (adjustedCount === 0) {
    gaps.push("tracker_price_history_covers_no_scored_origin(history_1y_only;refetch_full_history_to_enable_dividend_adjustment)");
  }
  if (tracker.div_start && panelRows.length && parseDateMs(tracker.div_start) > parseDateMs(panelRows[0].date) + 365 * DAY_MS) {
    gaps.push(`dividend_history_starts_${tracker.div_start}(panel_starts_${panelRows[0].date})`);
  }
  if (parseDateMs(panelRows[0].date) > parseDateMs(CRISIS_WINDOWS[0].end)) {
    gaps.push("crisis_2008_09_before_panel_start(bucket_unobservable)");
  }
  generatedGaps.push(...gaps.map((g) => `${indexId}: ${g}`));

  return Object.freeze({
    panel: Object.freeze({
      file: cfg.panel_file,
      section: cfg.panel_section,
      rows: panelRows.length,
      first_date: panelRows[0].date,
      last_date: panelRows[panelRows.length - 1].date,
    }),
    tracker: Object.freeze({
      symbol: cfg.tracker,
      identity_ok: tracker.identity_ok,
      price_history_start: tracker.price_start,
      price_history_end: tracker.price_end,
      dividend_start: tracker.div_start,
      dividend_end: tracker.div_end,
    }),
    risk_free: Object.freeze({
      series: cfg.rf_series,
      label: cfg.rf_label,
      observations: rfRows.length,
      first_date: rfRows.length ? isoDate(rfRows[0].ms) : null,
      last_date: rfRows.length ? isoDate(rfRows[rfRows.length - 1].ms) : null,
    }),
    origins_total: origins.length,
    origins_scored: scored.length,
    first_scored_as_of: scored.length ? scored[0].as_of : null,
    last_scored_as_of: scored.length ? scored[scored.length - 1].as_of : null,
    evaluation_span_years: round6(spanYears),
    dividend_adjusted_origins: adjustedCount,
    bias_unadjusted_origins: scored.length - adjustedCount,
    ess,
    regime_buckets: regimeBuckets,
    data_gaps: Object.freeze(gaps),
  });
}

// The receipt pre-freezes which §9 minimums are achievable with the data
// available NOW. Model-dependent criteria (interval coverage inside bootstrap
// CI, directional rate vs naive baseline) are deliberately null: they cannot
// be evaluated without model output, and no model output may influence this
// artifact.
export function buildFeasibilityReceipt({ generatedAt = new Date().toISOString() } = {}) {
  const indices = {};
  const gaps = [];
  for (const [indexId, cfg] of Object.entries(INDEX_CONFIG)) {
    indices[indexId] = buildIndexFeasibility(indexId, cfg, gaps);
  }

  const indexIds = Object.keys(INDEX_CONFIG);
  const spanOk = indexIds.filter((id) => indices[id].evaluation_span_years >= SPEC_MINIMUMS.evaluation_span_years);
  const essOk = indexIds.filter((id) => indices[id].ess.ess_capped >= SPEC_MINIMUMS.effective_origins_per_index);
  const spanAndEss = indexIds.filter((id) => spanOk.includes(id) && essOk.includes(id));
  const bucketIds = ["high_rate", "low_rate", "crisis_2008_09", "crisis_2020_03"];
  const sufficientBuckets = [];
  const insufficientBuckets = [];
  for (const id of indexIds) {
    for (const b of bucketIds) {
      if (indices[id].regime_buckets[b].sufficient) sufficientBuckets.push(`${id}.${b}`);
      else insufficientBuckets.push(`${id}.${b}`);
    }
  }

  const criteria = Object.freeze({
    evaluation_span_8y: Object.freeze({
      minimum: "evaluation span >= 8 years",
      achievable_now: spanOk.length >= SPEC_MINIMUMS.indices_passing,
      indices_meeting: Object.freeze(spanOk),
    }),
    indices_passing_4: Object.freeze({
      minimum: ">= 4 indices pass individually (span + effective origins achievable)",
      achievable_now: spanAndEss.length >= SPEC_MINIMUMS.indices_passing,
      indices_meeting: Object.freeze(spanAndEss),
    }),
    effective_origins_30: Object.freeze({
      minimum: ">= 30 effective origins per passing index",
      achievable_now: essOk.length >= SPEC_MINIMUMS.indices_passing,
      indices_meeting: Object.freeze(essOk),
      per_index_ess_capped: Object.freeze(Object.fromEntries(indexIds.map((id) => [id, indices[id].ess.ess_capped]))),
    }),
    regime_buckets_20: Object.freeze({
      minimum: "each regime bucket carries >= 20 effective origins or is reported insufficient and excluded from the pass count",
      achievable_now: sufficientBuckets.length > 0,
      buckets_meeting: Object.freeze(sufficientBuckets),
      buckets_insufficient: Object.freeze(insufficientBuckets),
      note: "only low_rate buckets meet the floor with current data; high_rate, crisis_2008_09 and crisis_2020_03 are reported insufficient and excluded from the pass count per §9",
    }),
    coverage_within_bootstrap_ci: Object.freeze({
      minimum: "interval coverage within bootstrap CI of the nominal level",
      achievable_now: null,
      reason: "requires model output; frozen method ids only in Phase 3A",
    }),
    directional_vs_naive_baseline: Object.freeze({
      minimum: "directional rate beats the naive baseline (historical-median multiple) on the same origins",
      achievable_now: null,
      reason: "requires model output; frozen method ids only in Phase 3A",
    }),
  });

  const achievableFrozen = Object.freeze(
    Object.entries(criteria)
      .filter(([, c]) => c.achievable_now === true)
      .map(([id]) => id),
  );

  gaps.push("all_trackers: data/yf/finance/*.json carry ~1y of price history (history_1y) — full-history refetch required before any dividend-adjusted scoring");
  gaps.push("us trackers (SPY/QQQ/ONEQ/SOXX/IWM): dividend records start 2016-09; EWY starts 2001-08 — earlier dividend vintages unavailable");
  gaps.push("kospi risk-free: IRLTLT01KRM156N is monthly (OECD); a point-in-time dated Korean 10Y sovereign series is not in the repo");

  const body = {
    schema_version: H2_SCHEMA_VERSION,
    phase: "3A",
    spec_ref: "docs/analysis/yoo-rim-audit/FENO_RIM_RECONSTRUCTION_SPEC_v3_0.md §9",
    freeze_policy: "thresholds frozen from data availability and overlap autocorrelation alone; no model output computed or consumed",
    spec_minimums: SPEC_MINIMUMS,
    methods: METHOD_IDS,
    crisis_windows: CRISIS_WINDOWS,
    indices,
    criteria,
    achievable_thresholds_frozen: achievableFrozen,
    data_gaps: Object.freeze(gaps),
  };
  const receiptSha = sha256(JSON.stringify(body));
  return Object.freeze({ ...body, generated_at: generatedAt, receipt_sha256: receiptSha });
}

// ---------------------------------------------------------------------------
// direct invocation: write data/computed/feno-rim-v2/h2-feasibility-receipt.json
// ---------------------------------------------------------------------------

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  const receipt = buildFeasibilityReceipt();
  const outDir = path.join(ROOT, "data/computed/feno-rim-v2");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "h2-feasibility-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  for (const [id, ix] of Object.entries(receipt.indices)) {
    console.log(`${id}: scored_origins=${ix.origins_scored} ess=${ix.ess.ess_capped} span=${ix.evaluation_span_years}y adjusted=${ix.dividend_adjusted_origins} gaps=${ix.data_gaps.length}`);
  }
  console.log(`achievable_thresholds_frozen: ${JSON.stringify(receipt.achievable_thresholds_frozen)}`);
  console.log(`receipt sha256: ${receipt.receipt_sha256.slice(0, 16)}… written: ${path.join(outDir, "h2-feasibility-receipt.json")}`);
}
