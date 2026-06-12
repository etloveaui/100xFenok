/**
 * 13F /superinvestors types.
 *
 * Sources:
 * - /data/sec-13f/analytics/consensus.json
 * - /data/sec-13f/summary.json
 * - /data/sec-13f/by_ticker.json
 * - /data/sec-13f/investors/{name}.json
 */

export type SuperInvestorsTab = "consensus" | "gurus" | "by-ticker" | "trades" | "insights";

export interface TradesRankingRow {
  rank: number;
  ticker: string;
  name: string;
  sector: string;
  sector_gics?: string;
  amount: number;
  investors_count: number;
  new_count?: number;
  exit_count?: number;
  top_investor: {
    id: string;
    name: string;
    amount: number;
  };
}

export interface TradesRankingData {
  metadata: {
    quarter: string;
    investors_included: string[];
    investors_excluded?: Array<{ id: string; latest_quarter: string }>;
    price_method?: string;
    skipped_no_price?: number;
    share_normalized_count?: number;
    top_n: number;
    generated_at?: string;
    disclaimer?: string;
  };
  bought: TradesRankingRow[];
  sold: TradesRankingRow[];
}

export interface TurnoverEntry {
  investor: string;
  quarter: string;
  turnover: number;
  new_count: number;
  sold_count: number;
  total_positions: number;
}

export interface TurnoverData {
  by_investor: Record<string, TurnoverEntry>;
}

export interface PortfolioRow {
  ticker: string;
  name: string;
  sector: string;
  weight: number;
  value: number;
  ret: number | null;
}

export interface PerformanceSeries {
  dates: string[];
  portfolio: number[];
  spy: number[] | null;
  coverage: number[];
}

export interface InvestorPortfolioView {
  name: string;
  quarter: string;
  quarters: string[];
  sector_history: Record<string, number[]>;
  treemap: PortfolioRow[];
  performance?: PerformanceSeries | null;
}

export interface AggregateSectorHistory {
  quarters: string[];
  series: Record<string, number[]>;
}

export interface PortfolioViewsData {
  metadata: {
    quarter: string;
    cohort_count: number;
    return_proxy?: string;
    return_source?: string;
    performance_method?: string;
    sector_chain?: string;
    generated_at?: string;
    disclaimer?: string;
  };
  total: {
    treemap: PortfolioRow[];
    sectors: Record<string, number>;
    sector_history?: AggregateSectorHistory;
  };
  investors: Record<string, InvestorPortfolioView>;
}

// ---------------------------------------------------------------------------
// W3a Insight tab types
// ---------------------------------------------------------------------------

export interface BuyingPressureRow {
  ticker: string;
  net_buyers: number;
  net_sellers: number;
  net_holders: number;
  pressure: number;
  total_value_change: number;
}

export interface BuyingPressureData {
  metadata: { tickers_count: number; quarter: string; current_cohort_investors: number };
  buying_pressure: Record<string, BuyingPressureRow>;
  top_buying: BuyingPressureRow[];
  top_selling: BuyingPressureRow[];
}

export interface NewPositionRow {
  ticker: string;
  investor: string;
  quarter_added: string;
  position_value: number;
  position_weight: number;
}

export interface NewPositionsData {
  metadata: { quarter: string; new_positions_count: number; unique_tickers: number };
  new_positions: NewPositionRow[];
}

export interface HhiRow {
  investor: string;
  hhi: number;
  holdings_count: number;
  top_weight: number;
  classification: string;
}

export interface HhiData {
  metadata: { investors_count: number; classifications: Record<string, number>; quarter: string };
  by_investor: Record<string, HhiRow>;
}

export interface ConvictionPosition {
  ticker: string;
  weight: number;
  rank: number;
  is_top5: boolean;
  is_top10: boolean;
  market_value: number;
}

export interface ConvictionData {
  metadata: { quarter: string; investors_count: number };
  by_investor: Record<string, ConvictionPosition[]>;
}

export interface ConsensusMetadata {
  total_investors: number;
  tickers_count: number;
  quarter: string;
  current_cohort_investors: number;
  excluded_stale_investors: string[];
}

export interface ConsensusTicker {
  ticker: string;
  score: number;
  holders_count: number;
  holders_list: string[];
}

export interface ConsensusData {
  metadata: ConsensusMetadata;
  consensus: Record<string, ConsensusTicker>;
}

export interface SummaryInvestor {
  name: string;
  group: string;
  aum: number;
  holdings_count: number;
  top5: string[];
  quarter: string;
  latest_quarter: string;
  global_latest_quarter: string;
  is_stale: boolean;
  stale_quarters: number;
}

export interface SummaryData {
  metadata: {
    generated_at?: string;
    latest_quarter?: string;
    total_investors?: number;
    total_tickers?: number;
  };
  investors: Record<string, SummaryInvestor>;
  top_stocks: Array<{
    ticker: string;
    holders_count: number;
    total_shares: number;
  }>;
}

export interface ByTickerEntry {
  holders: string[];
  total_shares: number;
  holder_details: Array<{
    investor: string;
    shares: number;
    weight: number;
  }>;
}

export type ByTickerData = Record<string, ByTickerEntry>;

export interface InvestorHolding {
  ticker: string | null;
  cusip: string;
  name: string;
  shares: number;
  market_value: number;
  weight: number;
  title_of_class?: string;
  sector?: string;
  industry?: string;
  enrichment_source?: string;
  enrichment_symbol?: string;
  market_cap_usd?: number;
  market_cap_bucket_abs?: string;
  market_cap_bucket_rel?: string;
  market_cap_as_of?: string;
  market_cap_source?: string;
  price_at_filing?: number;
  price_latest?: number;
  return_since_filing_pct?: number;
  return_as_of?: string;
  price_source?: string;
}

export interface InvestorFiling {
  quarter: string;
  filing_date: string;
  report_date: string;
  aum_total: number;
  holdings_count: number;
  top_10_weight: number;
  holdings: InvestorHolding[];
  changes_summary?: {
    new?: Array<{ ticker: string; name: string; change_pct: number }>;
    increased?: Array<{ ticker: string; name: string; change_pct: number }>;
    decreased?: Array<{ ticker: string; name: string; change_pct: number }>;
    sold?: Array<{ ticker: string; name: string; change_pct: number }>;
  };
}

export interface InvestorData {
  metadata: {
    cik?: string;
    entity?: string;
    group?: string;
    name?: string;
    source?: string;
  };
  investor: {
    name: string;
    entity: string;
    cik: string;
    group: string;
    filings: InvestorFiling[];
  };
}

export interface SuperInvestorsDataResult {
  consensus: ConsensusData | null;
  summary: SummaryData | null;
  byTicker: ByTickerData | null;
  dataReady: boolean;
  failed: boolean;
  quarter: string | null;
  excludedStale: string[];
}
