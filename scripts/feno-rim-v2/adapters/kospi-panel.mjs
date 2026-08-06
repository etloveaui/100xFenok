// FENO RIM v2 — KOSPI source adapter (Phase 4 remainder).
//
// Panel from the emerging benchmark file, payout from the constituent
// aggregate (payout-history.json#kospi), KR risk-free from FRED
// IRLTLT01KRM156N. The KR series is stale after its last observation
// (2026-06-01): an asOf beyond it refuses with the reason instead of
// silently serving an old rate.

import { defineAdapter } from "../provenance.mjs";
import { buildPanelInput, lastAtOrBefore, readJson } from "./panel-common.mjs";
import { erpWindowAt } from "../erp-band.mjs";

export function krRiskFree(asOf) {
  const rates = readJson("data/macro/fred-banking-daily.json").series.IRLTLT01KRM156N;
  const last = rates[rates.length - 1];
  if (!last) throw new Error("kospi adapter: KR risk-free series empty");
  if (asOf > last.date) {
    throw new Error(`kospi adapter: KR risk-free series stale: last IRLTLT01KRM156N observation ${last.date}; refusing asOf ${asOf}`);
  }
  const rate = lastAtOrBefore(rates, asOf);
  if (!rate) throw new Error(`kospi adapter: no IRLTLT01KRM156N observation at or before ${asOf}`);
  return { value: rate.value * 0.01, date: rate.date };
}

export function buildKospiInput(asOf) {
  return buildPanelInput({
    asOf,
    panelFile: "data/benchmarks/emerging.json",
    section: "kospi",
    payoutKey: "kospi",
    rate: krRiskFree(asOf),
    universeId: "kospi_emerging_panel",
    currency: "KRW",
    erp: erpWindowAt(asOf, "kr"),
  });
}

export const kospiAdapter = defineAdapter("kospi_panel", () => buildKospiInput(new Date().toISOString().slice(0, 10)));
