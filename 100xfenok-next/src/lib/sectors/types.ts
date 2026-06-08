/**
 * Sector dashboard types (/sectors).
 *
 * Data sources (all same-origin static JSON + ticker API):
 * - `/data/benchmarks/summaries.json` .momentum[sectorKey] → multi-window performance
 * - `/data/global-scouter/etfs/index.json` .etfs[ticker]    → sector ETF detail
 * - `/api/ticker/{etf}`                                     → live day change
 *
 * Sector universe = the 11 GICS sectors in `SECTOR_DEFINITIONS`
 * (shared with the home Breadth tile so /sectors stays consistent with home).
 */

export type MomentumWindow = "1w" | "1m" | "3m" | "6m" | "ytd";

export const MOMENTUM_WINDOWS: ReadonlyArray<{ key: MomentumWindow; label: string }> = [
  { key: "1w", label: "1주" },
  { key: "1m", label: "1개월" },
  { key: "3m", label: "3개월" },
  { key: "6m", label: "6개월" },
  { key: "ytd", label: "연초이후" },
];

export type SectorMomentum = Partial<Record<MomentumWindow, number | null>>;

export type EtfReturnWindow = "1m" | "3m" | "6m" | "ytd" | "1y" | "3y" | "5y" | "10y";
export type EtfCagrWindow = "3y" | "5y" | "10y";

export interface SectorEtfInfo {
  ticker: string;
  category: string | null;
  marketCap: number | null;
  returns: Partial<Record<EtfReturnWindow, number>>;
  cagr: Partial<Record<EtfCagrWindow, number>>;
  beta: number | null;
  expenseRatio: number | null;
}

export interface SectorRow {
  key: string;
  etf: string;
  name: string;
  /** Multi-window momentum (decimal fraction, e.g. 0.0104 = +1.04%). */
  momentum: SectorMomentum;
  /** Live day change as decimal fraction, or null when ticker missing. */
  dayChange: number | null;
  price: number | null;
  marketState: string | null;
  /** SPDR/sector ETF detail; null for sectors without a tracked ETF (XLC, XLRE). */
  etfInfo: SectorEtfInfo | null;
}

export interface SectorDataResult {
  rows: SectorRow[];
  dataReady: boolean;
  /** Source ids that fell back (e.g. "benchmarks", "etfs", "ticker:XLK"). */
  failedSources: string[];
  /** benchmarks generated timestamp, or null. */
  updatedAt: string | null;
}
