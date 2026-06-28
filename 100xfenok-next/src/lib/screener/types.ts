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

import type { StockServiceEtfLink } from "@/lib/data-entity-graph/stock-index";

export interface ScreenerConnectionFlags {
  marketFacts: boolean;
  filings: boolean;
  smartMoney: boolean;
  indexMembership: boolean;
  singleStockEtfs: boolean;
}

export interface ScreenerConnectionMeta {
  flags: ScreenerConnectionFlags;
  count: number;
  serviceCount?: number | null;
  singleStockEtfs?: StockServiceEtfLink[];
  confidenceLabel?: string | null;
  coverageRatio?: number | null;
  asOf?: {
    profile?: string | null;
    actionIndex?: string | null;
    marketFacts?: string | null;
    filings?: string | null;
    sec13f?: string | null;
  };
}

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
  forwardPeFy1?: number | null;
  forwardEpsFy1?: number | null;
  peg: number | null;
  revenueGrowthFy1?: number | null;
  epsGrowthFy1?: number | null;
  forwardPeFy2?: number | null;
  forwardEpsFy2?: number | null;
  revenueGrowthFy2?: number | null;
  epsGrowthFy2?: number | null;
  forwardPeFy3?: number | null;
  forwardEpsFy3?: number | null;
  revenueGrowthFy3?: number | null;
  epsGrowthFy3?: number | null;
  dividendTtm: number | null;
  ret1y: number | null;
  ret3y: number | null;
  ret5y: number | null;
  operatingMarginFy1?: number | null;
  roeFy1?: number | null;
  grossMarginFy1?: number | null;
  operatingMarginFy2?: number | null;
  roeFy2?: number | null;
  grossMarginFy2?: number | null;
  operatingMarginFy3?: number | null;
  roeFy3?: number | null;
  grossMarginFy3?: number | null;
  connection?: ScreenerConnectionMeta | null;
  connectionCount?: number | null;
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
  | "forwardPeFy1"
  | "forwardEpsFy1"
  | "revenueGrowthFy1"
  | "epsGrowthFy1"
  | "forwardPeFy2"
  | "forwardEpsFy2"
  | "revenueGrowthFy2"
  | "epsGrowthFy2"
  | "forwardPeFy3"
  | "forwardEpsFy3"
  | "revenueGrowthFy3"
  | "epsGrowthFy3"
  | "dividendTtm"
  | "ret1y"
  | "ret3y"
  | "ret5y"
  | "actionScore"
  | "guruHolders"
  | "operatingMarginFy1"
  | "roeFy1"
  | "grossMarginFy1"
  | "operatingMarginFy2"
  | "roeFy2"
  | "grossMarginFy2"
  | "operatingMarginFy3"
  | "roeFy3"
  | "grossMarginFy3"
  | "peg"
  | "connectionCount";

export type SortDir = "asc" | "desc";

export interface ScreenerDataResult {
  stocks: ScreenerStock[];
  dataReady: boolean;
  failed: boolean;
  /** stocks_analyzer source_date (data freshness), or null. */
  sourceDate: string | null;
  /** entity_graph_stock_index generated_at, or null when unavailable. */
  connectionIndexDate: string | null;
  connectionIndexReady: boolean;
  /** Distinct sector labels for the filter dropdown (sorted). */
  sectors: string[];
  /** Distinct country codes for the filter (sorted). */
  countries: string[];
}
