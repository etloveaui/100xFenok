import type {
  StockAnalyzerFilter,
  StockAnalyzerFilterPipeline,
  StockAnalyzerFilterState,
  StockAnalyzerRecord,
  StockAnalyzerSortOrder,
} from "@/lib/stock-analyzer/types";

export const DEFAULT_FILTER_STATE: StockAnalyzerFilterState = {
  query: "",
  sectors: [],
  industries: [],
  sortKey: "marketCap",
  sortOrder: "desc",
};

function normalizeSortValue(value: unknown): string | number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    return value;
  }

  return "";
}

function compareRecords(
  a: StockAnalyzerRecord,
  b: StockAnalyzerRecord,
  sortKey: string,
  order: StockAnalyzerSortOrder,
): number {
  const aValue = normalizeSortValue(a[sortKey]);
  const bValue = normalizeSortValue(b[sortKey]);

  let base = 0;

  if (typeof aValue === "number" && typeof bValue === "number") {
    base = aValue - bValue;
  } else {
    base = String(aValue).localeCompare(String(bValue));
  }

  if (base === 0) {
    base = a.symbol.localeCompare(b.symbol);
  }

  return order === "asc" ? base : -base;
}

function includeByQuery(
  record: StockAnalyzerRecord,
  query: string,
): boolean {
  if (!query) return true;

  const target = query.toLowerCase();

  return (
    record.symbol.toLowerCase().includes(target) ||
    record.companyName.toLowerCase().includes(target) ||
    (record.sector ?? "").toLowerCase().includes(target)
  );
}

function includeBySector(
  record: StockAnalyzerRecord,
  sectors: string[],
): boolean {
  if (sectors.length === 0) return true;
  const sector = (record.sector ?? "").trim();
  return sector ? sectors.includes(sector) : false;
}

function includeByRange(
  value: number | undefined,
  min: number | undefined,
  max: number | undefined,
): boolean {
  if (value === undefined) {
    return min === undefined && max === undefined;
  }

  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

const queryFilter: StockAnalyzerFilter = {
  id: "query",
  label: "Query Filter",
  apply(records, state) {
    const query = state.query.trim();
    return records.filter((record) => includeByQuery(record, query));
  },
};

const sectorFilter: StockAnalyzerFilter = {
  id: "sector",
  label: "Sector Filter",
  apply(records, state) {
    return records.filter((record) => includeBySector(record, state.sectors));
  },
};

const marketCapFilter: StockAnalyzerFilter = {
  id: "market-cap-range",
  label: "Market Cap Range",
  apply(records, state) {
    return records.filter((record) =>
      includeByRange(record.marketCap, state.minMarketCap, state.maxMarketCap),
    );
  },
};

const growthFilter: StockAnalyzerFilter = {
  id: "growth-range",
  label: "Growth Range",
  apply(records, state) {
    return records.filter((record) =>
      includeByRange(
        record.growthRate,
        state.minGrowthRate,
        state.maxGrowthRate,
      ),
    );
  },
};

const sortFilter: StockAnalyzerFilter = {
  id: "sort",
  label: "Sort",
  apply(records, state) {
    const sortKey = state.sortKey || "marketCap";
    const sortOrder = state.sortOrder || "desc";

    return [...records].sort((a, b) =>
      compareRecords(a, b, sortKey, sortOrder),
    );
  },
};

export class FilterManager
  implements StockAnalyzerFilterPipeline<StockAnalyzerRecord>
{
  readonly filters: ReadonlyArray<StockAnalyzerFilter<StockAnalyzerRecord>> = [
    queryFilter,
    sectorFilter,
    marketCapFilter,
    growthFilter,
    sortFilter,
  ];

  run(
    records: readonly StockAnalyzerRecord[],
    state: StockAnalyzerFilterState,
  ): StockAnalyzerRecord[] {
    return this.filters.reduce<StockAnalyzerRecord[]>(
      (current, filter) => filter.apply(current, state),
      [...records],
    );
  }
}
