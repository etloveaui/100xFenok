// FENO RIM v2 — Philadelphia Semiconductor (SOX) source adapter.
//
// Computable from the micro-sector panel + FRED US 10Y + the semiconductor
// payout aggregate — but flagged OUT_OF_SCOPE for publication: published
// semiconductor claims name SOXX, a different index from the Philadelphia
// Semiconductor index (measured bridge fails on price and payout identity).
// The flag rides on the normalized input as a non-contract key; the engine
// remains id- and key-blind.

import { defineAdapter } from "../provenance.mjs";
import { buildPanelInput, usRiskFree } from "./panel-common.mjs";

export const SOX_OUT_OF_SCOPE_REASON =
  "published semiconductor claims name SOXX, a different index from the Philadelphia Semiconductor index";

export function buildSoxInput(asOf) {
  return buildPanelInput({
    asOf,
    panelFile: "data/benchmarks/micro_sectors.json",
    section: "philadelphia_semi",
    payoutKey: "philadelphia_semi",
    rate: usRiskFree(asOf),
    universeId: "philadelphia_semi_micro_sector_panel",
    currency: "USD",
    extras: {
      publication_scope: "OUT_OF_SCOPE",
      out_of_scope_reason: SOX_OUT_OF_SCOPE_REASON,
    },
  });
}

export const soxAdapter = defineAdapter("sox_panel", () => buildSoxInput(new Date().toISOString().slice(0, 10)));
