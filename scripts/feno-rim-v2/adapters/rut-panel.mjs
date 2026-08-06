// FENO RIM v2 — Russell 2000 (RUT) source adapter (Phase 4 remainder).
//
// RUT takes its book, ROE and payout from the LSEG FTSE Russell official
// snapshot (its own publisher), per the old-system identity ruling. The
// snapshot's first-knowable date is the file's generated_at (the retrieval
// receipt); an asOf before it throws with the reason — the snapshot simply
// was not knowable then. Growth windows still come from the dated panel so
// the book-CAGR inputs stay point-in-time.

import { defineAdapter } from "../provenance.mjs";
import { lastAtOrBefore, readJson, shiftYears, usablePanelRows, usRiskFree } from "./panel-common.mjs";

export function rutOfficialSnapshot() {
  const snap = readJson("data/computed/fenok-rim/russell2000-official-fundamentals.json");
  if (snap.status !== "ready_official_quarterly_snapshot") {
    throw new Error(`rut adapter: official snapshot not ready (status=${snap.status})`);
  }
  const priceToBook = snap?.fundamentals?.price_to_book;
  const roe = snap?.derived?.current_roe_ex_negative_basis;
  const payout = snap?.derived?.payout_ex_negative_basis;
  if (!Number.isFinite(priceToBook) || priceToBook <= 0 || !Number.isFinite(roe) || !Number.isFinite(payout)) {
    throw new Error("rut adapter: official snapshot fundamentals incomplete");
  }
  const firstK = String(snap.generated_at).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstK)) throw new Error("rut adapter: snapshot first-knowable date missing");
  return { priceToBook, roe, payout, asOf: snap.as_of, firstK };
}

function bookCagr(panel, asOf, years) {
  const end = lastAtOrBefore(panel, asOf);
  const start = lastAtOrBefore(panel, shiftYears(asOf, -years));
  if (!end || !start) return null;
  const b0 = start.px_last / start.px_to_book_ratio;
  const b1 = end.px_last / end.px_to_book_ratio;
  if (!(b0 > 0) || !(b1 > 0)) return null;
  return (b1 / b0) ** (1 / years) - 1;
}

export function buildRutInput(asOf) {
  const snap = rutOfficialSnapshot();
  if (asOf < snap.firstK) {
    throw new Error(`rut adapter: LSEG official snapshot not first-knowable at ${asOf} (first_knowable_at ${snap.firstK})`);
  }
  const panel = usablePanelRows(readJson("data/benchmarks/us.json").sections.russell2000.data);
  const row = lastAtOrBefore(panel, asOf);
  if (!row) throw new Error(`rut adapter: no russell2000 panel row at or before ${asOf}`);
  const rate = usRiskFree(asOf);

  const price = row.px_last;
  const book = price / snap.priceToBook;
  return {
    book,
    price,
    risk_free: rate.value,
    roe: {
      band: { low: snap.roe, high: snap.roe }, // official snapshot current ROE (point band)
      consensus: null,
      coverage_ok: false,
      basis: "LSEG FTSE Russell factsheet current ROE, ex-negative basis",
    },
    payout_scenarios: [{
      id: "lseg_official_snapshot",
      low: snap.payout,
      high: snap.payout,
      basis: "LSEG FTSE Russell factsheet payout, ex-negative basis",
      period: snap.asOf,
    }],
    growth_observed: {
      w5: bookCagr(panel, asOf, 5),
      w10: bookCagr(panel, asOf, 10),
      w15: bookCagr(panel, asOf, 15),
    },
    erp_band: null,
    b2_admitted: false,
    b2_exclusion_reason: "clean-surplus bridge data incomplete: issuance and OCI aggregates absent",
    universe_id: "rut_lseg_factsheet",
    membership_as_of: snap.asOf,
    earnings_basis: "ex_negative_earners_lseg_factsheet",
    equity_basis: "lseg_factsheet_book",
    negative_earners_policy: "ex_negative",
    currency: "USD",
    share_class_policy: "as_published_single_count",
    first_knowable_at: snap.firstK,
  };
}

export const rutAdapter = defineAdapter("rut_panel", () => buildRutInput(new Date().toISOString().slice(0, 10)));
