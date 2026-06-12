/**
 * Stock screener types (/screener).
 *
 * Source: `/data/global-scouter/core/stocks_analyzer.json` .data (1,066 tickers,
 * single fetch — enriched with ROE/OPM/EPS/momentum/rank from F-2).
 *
 * CAUTION: roe, opm, growthRate, and momentum fields are stored as fractions
 * (e.g., roe=1.17 means 117%, opm=0.32 means 32%). Multiply by 100 when
 * displaying as percentages.
 */

export interface ScreenerStock {
  guruHolders?: number | null;
  actionScore?: number | null;
  confidenceLabel?: string | null;
  actionLabel?: string | null;
  actionBucket?: string | null;
  actionReasons?: string[];
  lowEvidence?: boolean | null;
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
  roe: number | null;
  opm: number | null;
  eps: number | null;
  growthRate: number | null;
  momentum1m: number | null;
  momentum3m: number | null;
  momentum6m: number | null;
  momentum12m: number | null;
  rank: number | null;
  perBandCurrent: number | null;
  perBandMin: number | null;
  perBandAvg: number | null;
  perBandMax: number | null;
  peForward: number | null;
  epsForward: number | null;
  dividendTtm: number | null;
  ret1y: number | null;
  ret3y: number | null;
  ret5y: number | null;
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
  | "return12m"
  | "roe"
  | "opm"
  | "eps"
  | "growthRate"
  | "momentum1m"
  | "momentum3m"
  | "momentum6m"
  | "momentum12m"
  | "rank"
  | "perBandCurrent"
  | "peForward"
  | "epsForward"
  | "dividendTtm"
  | "ret1y"
  | "ret3y"
  | "ret5y"
  | "actionScore"
  | "guruHolders";

export type SortDir = "asc" | "desc";

export interface ScreenerDataResult {
  stocks: ScreenerStock[];
  dataReady: boolean;
  failed: boolean;
  /** stocks_analyzer source_date (data freshness), or null. */
  sourceDate: string | null;
  /** Distinct sector labels for the filter dropdown (sorted). */
  sectors: string[];
  /** Distinct country codes for the filter (sorted). */
  countries: string[];
}
