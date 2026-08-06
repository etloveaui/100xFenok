// FENO RIM v2 — NASDAQ-100 source adapter (Phase 4 remainder).
//
// Same contract as spx-panel.mjs: panel from the Bloomberg benchmark file,
// US 10Y from FRED, payout from the constituent aggregate document
// (payout-history.json#nasdaq100). First-knowable is the max of the three
// component dates and refuses an asOf before any component (look-ahead).

import { defineAdapter } from "../provenance.mjs";
import { buildPanelInput, payoutFor, usRiskFree } from "./panel-common.mjs";

export function buildNdxInput(asOf) {
  return buildPanelInput({
    asOf,
    panelFile: "data/benchmarks/us.json",
    section: "nasdaq100",
    payoutKey: "nasdaq100",
    rate: usRiskFree(asOf),
    universeId: "nasdaq100_bloomberg_panel",
    currency: "USD",
  });
}

export const ndxAdapter = defineAdapter("ndx_panel", () => buildNdxInput(new Date().toISOString().slice(0, 10)));
