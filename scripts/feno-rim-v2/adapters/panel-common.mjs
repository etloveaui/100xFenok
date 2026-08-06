// FENO RIM v2 — shared adapter helpers (Phase 4 remainder).
//
// Panel adapters map one raw source family (benchmark panel + FRED rate +
// payout-history + official snapshots) onto the normalized input contract.
// These helpers are the shared, tested parts; each adapter supplies its own
// source keys and honest labels. Nothing here invents numbers: every value
// originates in a repo file, and the per-adapter tests re-read those files to
// prove the trace.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { firstKnowable } from "../provenance.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

/** Latest row with date <= asOf; rows are assumed ascending by date. */
export function lastAtOrBefore(rows, asOf) {
  let found = null;
  for (const row of rows) {
    if (row.date <= asOf) found = row;
    else break;
  }
  return found;
}

export function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

export function shiftYears(iso, years) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y + years}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Book rows: px_last finite and positive P/B, so book = px_last / P/B is real. */
export function usablePanelRows(rows) {
  return rows.filter((row) => Number.isFinite(row.px_last) && row.px_to_book_ratio > 0);
}

export function bookCagr(panel, asOf, years) {
  const end = lastAtOrBefore(panel, asOf);
  const start = lastAtOrBefore(panel, shiftYears(asOf, -years));
  if (!end || !start) return null;
  const b0 = start.px_last / start.px_to_book_ratio;
  const b1 = end.px_last / end.px_to_book_ratio;
  if (!(b0 > 0) || !(b1 > 0)) return null;
  return (b1 / b0) ** (1 / years) - 1;
}

/** q25/q75 of the trailing 260-week forward-ROE history (SPEC v3.0 section 4). */
export function roeBandFrom(rows, asOf) {
  const history = rows.filter((candidate) => candidate.date <= asOf);
  const window260 = history.slice(-260).map((candidate) => candidate.roe).filter(Number.isFinite);
  return { low: quantile(window260, 0.25), high: quantile(window260, 0.75) };
}

/** Trailing 5/10/15-year book CAGR windows from the panel's own book history. */
export function growthWindows(panel, asOf) {
  return { w5: bookCagr(panel, asOf, 5), w10: bookCagr(panel, asOf, 10), w15: bookCagr(panel, asOf, 15) };
}

/** Payout from the constituent aggregate document (payout-history.json). */
export function payoutFor(key) {
  const doc = readJson("data/computed/fenok-rim/payout-history.json");
  const entry = doc.indices[key];
  if (!entry) throw new Error(`payout-history: no entry for ${key}`);
  const latest = entry.history[entry.history.length - 1];
  if (!latest || !Number.isFinite(latest.payout_ratio)) {
    throw new Error(`payout-history: no finite payout for ${key}`);
  }
  return {
    payout_ratio: latest.payout_ratio,
    year: latest.year,
    newest_statement_period: entry.newest_statement_period,
  };
}

/** US 10Y constant maturity, dated point-in-time. */
export function usRiskFree(asOf) {
  const rates = readJson("data/macro/fred-banking-daily.json").series.DGS10;
  const rate = lastAtOrBefore(rates, asOf);
  if (!rate) throw new Error(`risk-free: no DGS10 observation at or before ${asOf}`);
  return { value: rate.value * 0.01, date: rate.date };
}

/**
 * Common normalized-input shape for panel-based adapters. `extras` may carry
 * per-adapter honest labels (proxy flags, out-of-scope markers); provenance
 * keys are always the same eight and first-knowable is recomputed with the
 * look-ahead refusal (a component not yet knowable at asOf throws).
 */
/**
 * `payout` is either a payout-history entry (via payoutFor) or an explicit
 * override `{ payout_ratio, period, first_knowable_component }` for proxied
 * payouts (e.g. CCMP via ONEQ). The first-knowable check always includes the
 * payout's own component date, so a proxy fetched after asOf refuses with
 * `look-ahead` instead of silently mixing vintages.
 */
export function buildPanelInput({ asOf, panelFile, section, payoutKey, rate, universeId, currency, extras = {}, payoutOverride = null, payoutScenarioId = "ttm_ttm", payoutBasis = null }) {
  const panel = usablePanelRows(readJson(panelFile).sections[section].data);
  const row = lastAtOrBefore(panel, asOf);
  if (!row) throw new Error(`${section} adapter: no panel row at or before ${asOf}`);
  const payout = payoutOverride ?? payoutFor(payoutKey);
  const payoutComponent = payout.first_knowable_component ?? payout.newest_statement_period;
  const firstK = firstKnowable(
    { price: row.date, rate: rate.date, payout_statement: payoutComponent },
    asOf,
  );
  return {
    book: row.px_last / row.px_to_book_ratio,
    price: row.px_last,
    risk_free: rate.value,
    roe: { band: roeBandFrom(panel, asOf), consensus: null, coverage_ok: false },
    payout_scenarios: [{
      id: payoutScenarioId,
      low: payout.payout_ratio,
      high: payout.payout_ratio,
      basis: payoutBasis ?? "sum(Cash Dividends Paid)/sum(Net Income), same universe, latest fiscal period (TTM proxy)",
      period: payout.year ?? payout.period,
    }],
    growth_observed: growthWindows(panel, asOf),
    erp_band: null, // core ERP unproven until the ERP contract research lands
    b2_admitted: false,
    b2_exclusion_reason: "clean-surplus bridge data incomplete: issuance and OCI aggregates absent",
    universe_id: universeId,
    membership_as_of: row.date,
    earnings_basis: "trailing_fiscal_aggregate_ttm_proxy",
    equity_basis: "common_equity_aggregate",
    negative_earners_policy: "positive_net_income_only",
    currency,
    share_class_policy: "as_published_single_count",
    first_knowable_at: firstK,
    ...extras,
  };
}
