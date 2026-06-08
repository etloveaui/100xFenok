/**
 * Stock screener types (/screener).
 *
 * Source: `/data/global-scouter/core/stocks_index.json` .stocks (1,066 tickers,
 * single 287KB fetch — no per-ticker files needed for the list view).
 *
 * Raw item shape (compact keys):
 *   n  = name        x  = exchange    s  = sector (Korean GICS-like label)
 *   c  = country     p  = price       mc = market cap (USD mn)
 *   pe = PER         pb = PBR         dy = dividend yield (fraction)
 *   r12 = trailing 12-month return (fraction)
 */

export interface ScreenerStock {
  ticker: string;
  name: string;
  exchange: string;
  sector: string;
  country: string;
  price: number | null;
  marketCap: number | null;
  per: number | null;
  pbr: number | null;
  dividendYield: number | null;
  return12m: number | null;
}

export type ScreenerSortKey =
  | "ticker"
  | "name"
  | "sector"
  | "country"
  | "price"
  | "marketCap"
  | "per"
  | "pbr"
  | "dividendYield"
  | "return12m";

export type SortDir = "asc" | "desc";

export interface ScreenerDataResult {
  stocks: ScreenerStock[];
  dataReady: boolean;
  failed: boolean;
  /** stocks_index source_date (data freshness), or null. */
  sourceDate: string | null;
  /** Distinct sector labels for the filter dropdown (sorted). */
  sectors: string[];
  /** Distinct country codes for the filter (sorted). */
  countries: string[];
}
