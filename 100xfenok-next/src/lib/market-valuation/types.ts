/**
 * Market valuation types (/market-valuation).
 *
 * Replaces the legacy radar `corporate-health.html` stub (#294): that name was
 * wrong (it's index-level valuation, not "corporate health") and it only used
 * the latest 4 KPIs. This native page uses the full history instead.
 *
 * Source: `/data/benchmarks/us.json` .sections[idx].data — 4 US indices
 * (sp500/nasdaq100/nasdaq_composite/russell2000), weekly series since 2010 with
 * { date, px_last, best_eps, best_pe_ratio (Fwd P/E), px_to_book_ratio, roe }.
 */

export interface ValuationBand {
  /** Latest value. */
  current: number | null;
  min: number | null;
  avg: number | null;
  max: number | null;
  /** Percentile rank of `current` within the full history (0–100), or null. */
  percentile: number | null;
}

export interface MomentumSet {
  "1w": number | null;
  "1m": number | null;
  "3m": number | null;
  "6m": number | null;
  ytd: number | null;
}

export interface IndexMomentum {
  price: MomentumSet;
  eps: MomentumSet;
  pe: MomentumSet;
  pb: MomentumSet;
  roe: MomentumSet;
}

export interface ValuationDriver {
  label: string;
  detail: string;
  tone: "emerald" | "amber" | "rose" | "slate";
}

export interface MarketIndexValuation {
  id: string;
  name: string;
  nameEn: string;
  /** Latest price (px_last). */
  price: number | null;
  /** Latest observation date. */
  date: string | null;
  /** Forward P/E band (best_pe_ratio). */
  pe: ValuationBand;
  /** Price/Book band (px_to_book_ratio). */
  pb: ValuationBand;
  /** Latest forward EPS estimate (best_eps). */
  eps: number | null;
  /** Latest ROE (fraction). */
  roe: number | null;
  /** Price/EPS/multiple momentum from benchmarks/summaries.json. */
  momentum: IndexMomentum | null;
  /** Derived quality read: whether price action is earnings- or multiple-led. */
  driver: ValuationDriver | null;
  /** History length (data points). */
  points: number;
}

export interface ValuationDataSource {
  id: string;
  label: string;
  source: string;
  updated: string | null;
  cadence: string | null;
  coverage: string;
  usage: string;
}

export interface MarketValuationResult {
  indices: MarketIndexValuation[];
  dataSources: ValuationDataSource[];
  benchmarkSections: number | null;
  damodaranUsErp: number | null;
  dataReady: boolean;
  failed: boolean;
  /** us.json metadata.version (source date), or null. */
  sourceDate: string | null;
}
