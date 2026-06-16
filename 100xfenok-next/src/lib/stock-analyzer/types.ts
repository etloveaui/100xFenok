/**
 * Week3 Phase6-1 skeleton contracts for Stock Analyzer migration.
 * Implementations are intentionally excluded in this stage.
 */

export type StockAnalyzerTab =
  | "overview"
  | "growth"
  | "ranking"
  | "eps"
  | "portfolio"
  | "compare";

export type StockAnalyzerSortOrder = "asc" | "desc";

export type StockAnalyzerChartType = "line" | "bar" | "radar" | "scatter";

export interface StockAnalyzerRecord {
  symbol: string;
  companyName: string;
  sector?: string;
  industry?: string;
  country?: string;
  marketCap?: number;
  price?: number;
  growthRate?: number;
  eps?: number;
  per?: number;
  pbr?: number;
  dividendYield?: number;
  return12m?: number;
  roe?: number;
  opm?: number;
  momentum1m?: number;
  momentum3m?: number;
  momentum6m?: number;
  momentum12m?: number;
  perBandCurrent?: number;
  perBandMin?: number;
  perBandAvg?: number;
  perBandMax?: number;
  peForward?: number;
  epsForward?: number;
  dividendTtm?: number;
  ret1y?: number;
  ret3y?: number;
  ret5y?: number;
  guruHolders?: number | null;
  actionScore?: number | null;
  confidenceLabel?: string | null;
  actionLabel?: string | null;
  actionBucket?: string | null;
  actionReasons?: string[];
  lowEvidence?: boolean | null;
  forwardPeFy1?: number | null;
  forwardEpsFy1?: number | null;
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
  grossMarginFy1?: number | null;
  operatingMarginFy1?: number | null;
  roeFy1?: number | null;
  grossMarginFy2?: number | null;
  operatingMarginFy2?: number | null;
  roeFy2?: number | null;
  grossMarginFy3?: number | null;
  operatingMarginFy3?: number | null;
  roeFy3?: number | null;
  rank?: number;
  [metric: string]: string | number | boolean | string[] | null | undefined;
}

export interface StockAnalyzerFilterState {
  query: string;
  sectors: string[];
  industries: string[];
  minMarketCap?: number;
  maxMarketCap?: number;
  minGrowthRate?: number;
  maxGrowthRate?: number;
  sortKey: string;
  sortOrder: StockAnalyzerSortOrder;
}

export interface StockAnalyzerFilter<TRecord = StockAnalyzerRecord> {
  id: string;
  label: string;
  apply(
    records: readonly TRecord[],
    state: StockAnalyzerFilterState,
  ): TRecord[];
}

export interface StockAnalyzerFilterPipeline<TRecord = StockAnalyzerRecord> {
  filters: ReadonlyArray<StockAnalyzerFilter<TRecord>>;
  run(
    records: readonly TRecord[],
    state: StockAnalyzerFilterState,
  ): TRecord[];
}

export interface StockAnalyzerChartPoint {
  x: string | number | Date;
  y: number;
}

export interface StockAnalyzerChartSeries {
  id: string;
  label: string;
  color?: string;
  points: ReadonlyArray<StockAnalyzerChartPoint>;
}

export interface StockAnalyzerChartConfig {
  chartId: string;
  chartType: StockAnalyzerChartType;
  title: string;
  yAxisLabel?: string;
  xAxisLabel?: string;
  stacked?: boolean;
}

export interface StockAnalyzerChartModel {
  config: StockAnalyzerChartConfig;
  series: ReadonlyArray<StockAnalyzerChartSeries>;
}

export interface StockAnalyzerDataProviderContext {
  at?: string;
  signal?: AbortSignal;
}

export interface StockAnalyzerDataProvider<TRecord = StockAnalyzerRecord> {
  id: string;
  source: string;
  load(context?: StockAnalyzerDataProviderContext): Promise<TRecord[]>;
  getBySymbol?(
    symbol: string,
    context?: StockAnalyzerDataProviderContext,
  ): Promise<TRecord | null>;
}

export interface StockAnalyzerDashboardState<TRecord = StockAnalyzerRecord> {
  activeTab: StockAnalyzerTab;
  records: ReadonlyArray<TRecord>;
  filteredRecords: ReadonlyArray<TRecord>;
  selectedSymbol?: string;
  filters: StockAnalyzerFilterState;
  charts: ReadonlyArray<StockAnalyzerChartModel>;
  isLoading: boolean;
  lastUpdatedAt?: string;
  errorMessage?: string;
}

export interface StockAnalyzerDashboardController<
  TRecord = StockAnalyzerRecord,
> {
  initialize(): Promise<void>;
  setTab(tab: StockAnalyzerTab): void;
  setFilters(nextState: StockAnalyzerFilterState): void;
  selectSymbol(symbol: string): void;
  getState(): StockAnalyzerDashboardState<TRecord>;
}
