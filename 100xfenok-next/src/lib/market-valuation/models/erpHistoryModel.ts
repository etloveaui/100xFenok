// Damodaran historical ERP model (FORGE Slice B, Claude/cc-29).
//
// Answers feedback #6: an ERP line on its own has no reference. This model returns
// the implied ERP (FCFE + DDM) AND the risk-free (10Y T-bond) on the same percent
// axis, plus the year-end S&P 500 level for a right-axis overlay — so the investor
// reads ERP against rates and price, not in a vacuum.

import { buildCoverage } from "./coverage";
import { loadSummary, sortSeriesByDate } from "./loaders";
import type { CoverageEntry, SeriesPoint } from "./types";

interface HistoricalErpYear {
  tbond_rate?: number | null;
  implied_erp_ddm?: number | null;
  implied_erp_fcfe?: number | null;
}

interface HistoricalErpDoc {
  years?: Record<string, HistoricalErpYear>;
}

interface Sp500Point {
  date?: string;
  value?: number | null;
}

export interface ErpHistoryModel {
  /** Implied ERP via free-cash-flow-to-equity, in percent. */
  erpFcfe: SeriesPoint[];
  /** Implied ERP via dividend-discount model, in percent. */
  erpDdm: SeriesPoint[];
  /** 10Y Treasury (risk-free), in percent. */
  tbond: SeriesPoint[];
  /** Year-end S&P 500 level (right axis overlay). */
  sp500Annual: SeriesPoint[];
  meta: CoverageEntry;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function yearEndSp500(rows: readonly Sp500Point[]): SeriesPoint[] {
  const byYear = new Map<string, { date: string; value: number }>();
  for (const row of rows) {
    if (!row.date || !finite(row.value)) continue;
    const year = row.date.slice(0, 4);
    const prev = byYear.get(year);
    if (!prev || row.date > prev.date) byYear.set(year, { date: row.date, value: row.value });
  }
  return sortSeriesByDate(
    [...byYear.values()].map((row) => ({ date: `${row.date.slice(0, 4)}-12-31`, value: row.value })),
  );
}

export async function loadErpHistoryModel(nowIso?: string): Promise<ErpHistoryModel | null> {
  const doc = await loadSummary<HistoricalErpDoc>("damodaran/historical_erp.json");
  if (!doc?.years) return null;

  const erpFcfe: SeriesPoint[] = [];
  const erpDdm: SeriesPoint[] = [];
  const tbond: SeriesPoint[] = [];
  for (const [year, entry] of Object.entries(doc.years)) {
    const date = `${year}-12-31`;
    if (finite(entry.implied_erp_fcfe)) erpFcfe.push({ date, value: entry.implied_erp_fcfe * 100 });
    if (finite(entry.implied_erp_ddm)) erpDdm.push({ date, value: entry.implied_erp_ddm * 100 });
    if (finite(entry.tbond_rate)) tbond.push({ date, value: entry.tbond_rate * 100 });
  }

  const sp500Doc = await loadSummary<Sp500Point[]>("indices/sp500.json");
  const sp500Annual = yearEndSp500(Array.isArray(sp500Doc) ? sp500Doc : []);

  const available = Object.keys(doc.years).length;
  return {
    erpFcfe: sortSeriesByDate(erpFcfe),
    erpDdm: sortSeriesByDate(erpDdm),
    tbond: sortSeriesByDate(tbond),
    sp500Annual,
    meta: buildCoverage({
      source: "damodaran/historical_erp.json",
      availableCount: available,
      reachableCount: available,
      defaultVisibleCount: available,
      downsamplePolicy: "none",
      surface: "ledger-default",
      nowIso,
    }),
  };
}
