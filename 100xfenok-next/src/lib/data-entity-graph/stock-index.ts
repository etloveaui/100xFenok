export type StockConnectionFlags = {
  market_facts?: boolean;
  filings?: boolean;
  sec_13f?: boolean;
  index_membership?: boolean;
};

export type StockConnectionEntry = {
  ticker: string;
  label?: string | null;
  route?: string | null;
  canonical_sector?: string | null;
  confidence?: {
    label?: string | null;
    rank?: number | null;
    coverage_ratio?: number | null;
  } | null;
  flags?: StockConnectionFlags;
  connection_count?: number | null;
  as_of?: {
    profile?: string | null;
    action_index?: string | null;
    market_facts?: string | null;
    filings?: string | null;
    sec_13f?: string | null;
  } | null;
  relations?: Array<{
    type?: string | null;
    target?: string | null;
  }>;
};

export type StockConnectionIndex = {
  schema_version: "data-entity-graph-stock-index/v1";
  generated_at?: string | null;
  source_as_of?: Record<string, string | null | undefined>;
  totals?: {
    stocks?: number | null;
    with_market_facts?: number | null;
    with_filings?: number | null;
    with_sec_13f?: number | null;
    with_index_membership?: number | null;
  };
  stocks?: Record<string, StockConnectionEntry | undefined>;
};

let stockIndexCache: StockConnectionIndex | null = null;
let stockIndexPromise: Promise<StockConnectionIndex | null> | null = null;

export function normalizeStockConnectionTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

export async function loadStockConnectionIndex(signal?: AbortSignal): Promise<StockConnectionIndex | null> {
  if (stockIndexCache) return stockIndexCache;
  if (stockIndexPromise) return stockIndexPromise;

  stockIndexPromise = fetch("/data/computed/entity_graph_stock_index.json", { cache: "force-cache", signal })
    .then((response) => (response.ok ? response.json() as Promise<StockConnectionIndex> : null))
    .then((payload) => {
      stockIndexCache = payload?.schema_version === "data-entity-graph-stock-index/v1" ? payload : null;
      stockIndexPromise = null;
      return stockIndexCache;
    })
    .catch(() => {
      stockIndexPromise = null;
      return null;
    });

  return stockIndexPromise;
}

export function getStockConnection(index: StockConnectionIndex | null | undefined, ticker: string): StockConnectionEntry | null {
  const symbol = normalizeStockConnectionTicker(ticker);
  return index?.stocks?.[symbol] ?? null;
}

export function stockConnectionCount(entry: StockConnectionEntry | null | undefined): number | null {
  if (typeof entry?.connection_count === "number" && Number.isFinite(entry.connection_count)) {
    return entry.connection_count;
  }
  if (!entry?.flags) return null;
  return Object.values(entry.flags).filter(Boolean).length;
}
