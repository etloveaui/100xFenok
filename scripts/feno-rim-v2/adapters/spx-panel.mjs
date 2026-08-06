#!/usr/bin/env node

// FENO RIM v2 — SPX source adapter (Phase 4 step 3).
//
// Maps raw sources onto the normalized input contract and stops there.
// Book and risk-free come from dated series; the ROE band from the index's
// own forward-ROE history; the payout from the constituent aggregate
// (cash dividends paid over net income, same universe, same period — the
// Gate 2 amendment definition, fiscal-basis TTM proxy, labelled as such).
// Core ERP stays null until the ERP contract research proves a band, so the
// adapter's public output is NULL by construction; B2 stays excluded until
// clean-surplus bridge data (issuance, OCI) exists.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineAdapter, firstKnowable } from "../provenance.mjs";
import { erpWindowAt } from "../erp-band.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

import fs from "node:fs";

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function lastAtOrBefore(rows, asOf) {
  let found = null;
  for (const row of rows) {
    if (row.date <= asOf) found = row;
    else break;
  }
  return found;
}

function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

function bookCagr(bookRows, asOf, years) {
  const end = lastAtOrBefore(bookRows, asOf);
  const start = lastAtOrBefore(bookRows, shiftYears(asOf, -years));
  if (!end || !start) return null;
  const b0 = start.px_last / start.px_to_book_ratio;
  const b1 = end.px_last / end.px_to_book_ratio;
  if (!(b0 > 0) || !(b1 > 0)) return null;
  // Annualised over the requested window, not the observed span: the caller
  // asks for a 5/10/15-year CAGR and the row dates land where the panel has
  // them. (A dead `span` computation sat here and was never read.)
  return (b1 / b0) ** (1 / years) - 1;
}

function shiftYears(iso, years) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y + years}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function buildSpxInput(asOf) {
  const panel = readJson("data/benchmarks/us.json").sections.sp500.data
    .filter((row) => Number.isFinite(row.px_last) && row.px_to_book_ratio > 0);
  const row = lastAtOrBefore(panel, asOf);
  if (!row) throw new Error(`spx adapter: no panel row at or before ${asOf}`);

  const rates = readJson("data/macro/fred-banking-daily.json").series.DGS10;
  const rate = lastAtOrBefore(rates, asOf);
  if (!rate) throw new Error(`spx adapter: no DGS10 at or before ${asOf}`);

  const payoutDoc = readJson("data/computed/fenok-rim/payout-history.json");
  const spx = payoutDoc.indices.sp500;
  const latest = spx.history[spx.history.length - 1];

  const history = panel.filter((candidate) => candidate.date <= asOf);
  const window260 = history.slice(-260).map((candidate) => candidate.roe).filter(Number.isFinite);

  const book = row.px_last / row.px_to_book_ratio;
  // SCOPE CORRECTION (owner ruling, 2026-08-06): payout is consumed only
  // inside the B2 branch of computeFamilyB; with b2_admitted=false (clean-
  // surplus gate) the payout component must not refuse a historical origin.
  // It rejoins the component set the moment B2 is admitted; admission
  // without the component is a build error (fail-closed).
  const b2Admitted = false; // clean-surplus bridge gate (SPEC v3.0 §7)
  const componentDates = { price: row.date, rate: rate.date };
  if (b2Admitted) {
    if (!spx.newest_statement_period) throw new Error("spx adapter: b2_admitted requires a payout first-knowable component");
    componentDates.payout_statement = spx.newest_statement_period;
  }
  // ERP is consumed (band wiring slice): restored band at THIS origin, joined
  // to the first-knowable component set — fail-closed if it cannot provide one.
  const erp = erpWindowAt(asOf, "us");
  if (!erp.first_knowable) throw new Error("spx adapter: erp band requires a first-knowable component");
  componentDates.erp = erp.first_knowable;
  const firstK = firstKnowable(componentDates, asOf);
  return {
    // normalized numerics
    book,
    price: row.px_last,
    risk_free: rate.value * 0.01,
    roe: {
      band: { low: quantile(window260, 0.25), high: quantile(window260, 0.75) },
      consensus: null,
      coverage_ok: false,
    },
    payout_scenarios: [{
      id: "ttm_ttm",
      low: latest.payout_ratio,
      high: latest.payout_ratio,
      basis: "sum(Cash Dividends Paid)/sum(Net Income), same universe, latest fiscal period (TTM proxy)",
      period: latest.year,
    }],
    growth_observed: {
      w5: bookCagr(panel, asOf, 5),
      w10: bookCagr(panel, asOf, 10),
      w15: bookCagr(panel, asOf, 15),
    },
    erp_band: erp.band,
    erp_first_knowable: erp.first_knowable,
    // One flag decides admission, the payout component and payout_consumed
    // together. Two independent literals would let a future engineer flip
    // admission while the component set stays scoped out — the engine guard
    // would catch it, but only after the wrong input had already been built.
    b2_admitted: b2Admitted,
    b2_exclusion_reason: b2Admitted ? null : "clean-surplus bridge data incomplete: issuance and OCI aggregates absent",
    // provenance keys
    universe_id: "sp500_bloomberg_panel",
    membership_as_of: row.date,
    earnings_basis: "trailing_fiscal_aggregate_ttm_proxy",
    equity_basis: "common_equity_aggregate",
    negative_earners_policy: "positive_net_income_only",
    currency: "USD",
    share_class_policy: "as_published_single_count",
    payout_consumed: b2Admitted,
    payout_unconsumed_reason: b2Admitted
      ? null
      : "b2_admitted=false: payout enters the engine only inside the B2 branch (engine.mjs:127), excluded by the clean-surplus gate; its first-knowable check is scoped out with it",
    first_knowable_at: firstK,
  };
}

export const spxAdapter = defineAdapter("spx_panel", () => buildSpxInput(new Date().toISOString().slice(0, 10)));

export function adaptSpx(asOf) {
  const input = buildSpxInput(asOf);
  // validate through the adapter boundary with the dated input
  return spxAdapter.normalize === undefined ? input : validateThroughBoundary(input);
}

import { validateNormalizedInput } from "../provenance.mjs";
function validateThroughBoundary(input) {
  validateNormalizedInput(input, "adapter:spx_panel");
  return input;
}
