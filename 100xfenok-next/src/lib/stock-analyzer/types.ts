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
  marketCap?: number;
  growthRate?: number;
  eps?: number;
  per?: number;
  rank?: number;
  [metric: string]: string | number | boolean | null | undefined;
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
