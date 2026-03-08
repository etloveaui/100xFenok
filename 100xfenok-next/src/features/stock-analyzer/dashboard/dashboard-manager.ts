import type {
  StockAnalyzerDashboardController,
  StockAnalyzerDashboardState,
  StockAnalyzerDataProvider,
  StockAnalyzerFilterPipeline,
  StockAnalyzerFilterState,
  StockAnalyzerRecord,
  StockAnalyzerTab,
} from "@/lib/stock-analyzer/types";

import { ChartManager } from "@/features/stock-analyzer/charts/chart-manager";
import {
  DEFAULT_FILTER_STATE,
  FilterManager,
} from "@/features/stock-analyzer/filter/filter-manager";
import { StaticStockAnalyzerDataProvider } from "@/features/stock-analyzer/data/static-data-provider";

export function createDefaultFilterState(): StockAnalyzerFilterState {
  return {
    ...DEFAULT_FILTER_STATE,
    sectors: [...DEFAULT_FILTER_STATE.sectors],
    industries: [...DEFAULT_FILTER_STATE.industries],
  };
}

export function createEmptyDashboardState(): StockAnalyzerDashboardState {
  return {
    activeTab: "overview",
    records: [],
    filteredRecords: [],
    selectedSymbol: undefined,
    filters: createDefaultFilterState(),
    charts: [],
    isLoading: false,
    lastUpdatedAt: undefined,
    errorMessage: undefined,
  };
}

interface DashboardManagerOptions {
  dataProvider?: StockAnalyzerDataProvider<StockAnalyzerRecord>;
  filterPipeline?: StockAnalyzerFilterPipeline<StockAnalyzerRecord>;
  chartManager?: ChartManager;
  initialTab?: StockAnalyzerTab;
}

const TAB_SORT_PRESETS: Record<
  StockAnalyzerTab,
  Pick<StockAnalyzerFilterState, "sortKey" | "sortOrder">
> = {
  overview: { sortKey: "marketCap", sortOrder: "desc" },
  growth: { sortKey: "growthRate", sortOrder: "desc" },
  ranking: { sortKey: "rank", sortOrder: "asc" },
  eps: { sortKey: "eps", sortOrder: "desc" },
  portfolio: { sortKey: "marketCap", sortOrder: "desc" },
  compare: { sortKey: "symbol", sortOrder: "asc" },
};

export class DashboardManager
  implements StockAnalyzerDashboardController<StockAnalyzerRecord>
{
  private readonly dataProvider: StockAnalyzerDataProvider<StockAnalyzerRecord>;
  private readonly filterPipeline: StockAnalyzerFilterPipeline<StockAnalyzerRecord>;
  private readonly chartManager: ChartManager;
  private state: StockAnalyzerDashboardState<StockAnalyzerRecord>;

  constructor(options: DashboardManagerOptions = {}) {
    this.dataProvider =
      options.dataProvider ?? new StaticStockAnalyzerDataProvider();
    this.filterPipeline = options.filterPipeline ?? new FilterManager();
    this.chartManager = options.chartManager ?? new ChartManager();
    this.state = {
      ...createEmptyDashboardState(),
      activeTab: options.initialTab ?? "overview",
    };
  }

  async initialize(): Promise<void> {
    this.state = {
      ...this.state,
      isLoading: true,
      errorMessage: undefined,
    };

    try {
      const records = await this.dataProvider.load();

      this.state = {
        ...this.state,
        records,
        lastUpdatedAt: new Date().toISOString(),
      };

      this.recompute();
    } catch (error) {
      this.state = {
        ...this.state,
        records: [],
        filteredRecords: [],
        charts: [],
        errorMessage:
          error instanceof Error
            ? error.message
            : "Stock Analyzer 데이터를 불러오지 못했습니다.",
      };
    } finally {
      this.state = {
        ...this.state,
        isLoading: false,
      };
    }
  }

  setTab(tab: StockAnalyzerTab): void {
    const preset = TAB_SORT_PRESETS[tab];
    this.state = {
      ...this.state,
      activeTab: tab,
      filters: preset
        ? {
            ...this.state.filters,
            sortKey: preset.sortKey,
            sortOrder: preset.sortOrder,
          }
        : this.state.filters,
    };
    this.recompute();
  }

  setFilters(nextState: StockAnalyzerFilterState): void {
    this.state = {
      ...this.state,
      filters: {
        ...nextState,
        sectors: [...nextState.sectors],
        industries: [...nextState.industries],
      },
    };

    this.recompute();
  }

  selectSymbol(symbol: string): void {
    this.state = {
      ...this.state,
      selectedSymbol: symbol,
    };
  }

  getState(): StockAnalyzerDashboardState<StockAnalyzerRecord> {
    return {
      ...this.state,
      records: [...this.state.records],
      filteredRecords: [...this.state.filteredRecords],
      charts: [...this.state.charts],
      filters: {
        ...this.state.filters,
        sectors: [...this.state.filters.sectors],
        industries: [...this.state.filters.industries],
      },
    };
  }

  private recompute(): void {
    const filteredRecords = this.filterPipeline.run(
      this.state.records,
      this.state.filters,
    );

    const charts = this.chartManager.buildCharts(filteredRecords);

    const selectedSymbol =
      this.state.selectedSymbol &&
      filteredRecords.some((record) => record.symbol === this.state.selectedSymbol)
        ? this.state.selectedSymbol
        : undefined;

    this.state = {
      ...this.state,
      selectedSymbol,
      filteredRecords,
      charts,
    };
  }
}
