// FENO RIM v2 — NASDAQ Composite (CCMP) source adapter (Phase 4 remainder).
//
// The composite has no constituent payout aggregate in payout-history.json,
// so the payout comes from the ONEQ tracker (the composite's own ETF) as an
// explicitly-labelled PROXY: coverage_ok=false, and B2 is excluded on that
// basis while B1 stands. The proxy's fetched_at is a first-knowable component,
// so an asOf before the proxy was fetched refuses with `look-ahead` rather
// than silently using a later vintage.

import { defineAdapter } from "../provenance.mjs";
import { buildPanelInput, readJson, usRiskFree } from "./panel-common.mjs";
import { erpWindowAt } from "../erp-band.mjs";

export function oneqPayoutProxy() {
  const doc = readJson("data/computed/market_facts/tickers/ONEQ.json");
  const fact = doc?.facts?.dividend_yield;
  if (!fact || !Number.isFinite(fact.value) || typeof fact.fetched_at !== "string") {
    throw new Error("ccmp adapter: ONEQ dividend-yield fact unavailable");
  }
  return {
    payout_ratio: fact.value * 0.01, // percent_points -> fraction
    period: fact.as_of ?? null,
    first_knowable_component: fact.fetched_at.slice(0, 10),
    proxy: "ONEQ",
    coverage_ok: false,
  };
}

export function buildCcmpInput(asOf) {
  const proxy = oneqPayoutProxy();
  return buildPanelInput({
    asOf,
    panelFile: "data/benchmarks/us.json",
    section: "nasdaq_composite",
    payoutKey: null,
    rate: usRiskFree(asOf),
    universeId: "ccmp_oneq_tracker_proxy",
    currency: "USD",
    payoutOverride: {
      payout_ratio: proxy.payout_ratio,
      period: proxy.period,
      first_knowable_component: proxy.first_knowable_component,
    },
    payoutScenarioId: "oneq_tracker_proxy",
    payoutBasis: "ONEQ tracker dividend yield as payout proxy; not the payout contract (coverage_ok=false)",
    erp: erpWindowAt(asOf, "us"),
    extras: {
      payout_proxy: { ticker: "ONEQ", coverage_ok: false },
      b2_exclusion_reason: "payout via ONEQ tracker proxy with coverage_ok=false; B2 excluded, B1 stands",
    },
  });
}

export const ccmpAdapter = defineAdapter("ccmp_panel", () => buildCcmpInput(new Date().toISOString().slice(0, 10)));
