import { NextResponse } from "next/server";
import {
  getStockanalysisSurface,
  normalizeStockanalysisTicker,
} from "@/lib/server/data-loader";
import { withResponseCache } from "@/lib/server/response-cache";

type JsonRecord = Record<string, unknown>;

type SurfaceSpec = {
  surface: string;
  label: string;
  section: "earnings" | "actions" | "markets" | "etfs" | "ipo" | "industry";
  tickerKeys: string[];
  fields: string[];
  limit: number;
};

const STOCKANALYSIS_TICKER_SURFACE_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
} as const;

const SURFACE_SPECS: SurfaceSpec[] = [
  {
    surface: "earnings_calendar",
    label: "어닝 캘린더",
    section: "earnings",
    tickerKeys: ["symbol"],
    fields: ["week_of", "date", "day", "symbol", "name", "timing", "eps_estimate", "eps_growth_pct", "revenue_estimate", "revenue_growth_pct", "market_cap"],
    limit: 8,
  },
  {
    surface: "actions_recent",
    label: "기업 이벤트",
    section: "actions",
    tickerKeys: ["symbol"],
    fields: ["date", "type", "symbol", "name", "text", "other"],
    limit: 8,
  },
  {
    surface: "actions_splits",
    label: "분할 이벤트",
    section: "actions",
    tickerKeys: ["symbol"],
    fields: ["date", "symbol", "company_name", "type", "split_ratio"],
    limit: 5,
  },
  {
    surface: "market_gainers",
    label: "상승 무버",
    section: "markets",
    tickerKeys: ["symbol"],
    fields: ["symbol", "company_name", "pct_change", "stock_price", "volume", "market_cap"],
    limit: 4,
  },
  {
    surface: "market_losers",
    label: "하락 무버",
    section: "markets",
    tickerKeys: ["symbol"],
    fields: ["symbol", "company_name", "pct_change", "stock_price", "volume", "market_cap"],
    limit: 4,
  },
  {
    surface: "market_active",
    label: "거래량 무버",
    section: "markets",
    tickerKeys: ["symbol"],
    fields: ["symbol", "company_name", "pct_change", "stock_price", "volume", "market_cap"],
    limit: 4,
  },
  {
    surface: "market_premarket",
    label: "프리마켓",
    section: "markets",
    tickerKeys: ["symbol"],
    fields: ["symbol", "company_name", "pct_change", "stock_price", "volume", "market_cap"],
    limit: 4,
  },
  {
    surface: "market_afterhours",
    label: "애프터마켓",
    section: "markets",
    tickerKeys: ["symbol"],
    fields: ["symbol", "company_name", "pct_change", "stock_price", "volume", "market_cap"],
    limit: 4,
  },
  {
    surface: "new_etfs",
    label: "신규 ETF",
    section: "etfs",
    tickerKeys: ["s", "symbol"],
    fields: ["s", "symbol", "n", "fund_name", "inceptionDate", "price", "change"],
    limit: 4,
  },
  {
    surface: "etf_screener",
    label: "ETF 스크리너",
    section: "etfs",
    tickerKeys: ["s", "symbol"],
    fields: ["s", "symbol", "n", "fund_name", "assetClass", "aum", "price", "change", "volume", "holdings"],
    limit: 4,
  },
  {
    surface: "etf_provider_blackrock",
    label: "BlackRock ETF",
    section: "etfs",
    tickerKeys: ["symbol", "s"],
    fields: ["symbol", "s", "fund_name", "n", "assets", "div_yield", "exp_ratio", "change_1y"],
    limit: 4,
  },
  {
    surface: "etf_provider_proshares",
    label: "ProShares ETF",
    section: "etfs",
    tickerKeys: ["symbol", "s"],
    fields: ["symbol", "s", "fund_name", "n", "assets", "div_yield", "exp_ratio", "change_1y"],
    limit: 4,
  },
  {
    surface: "list_bitcoin_etfs",
    label: "Bitcoin ETF",
    section: "etfs",
    tickerKeys: ["symbol", "s"],
    fields: ["symbol", "s", "fund_name", "n", "stock_price", "pct_change", "assets"],
    limit: 4,
  },
  {
    surface: "ipos_calendar",
    label: "IPO 예정",
    section: "ipo",
    tickerKeys: ["symbol", "s"],
    fields: ["ipo_date", "symbol", "company_name", "price_range", "deal_size", "market_cap"],
    limit: 4,
  },
  {
    surface: "ipos_recent",
    label: "최근 IPO",
    section: "ipo",
    tickerKeys: ["symbol", "s"],
    fields: ["ipo_date", "symbol", "company_name", "price", "current", "return"],
    limit: 4,
  },
  {
    surface: "ipos_filings",
    label: "IPO filing",
    section: "ipo",
    tickerKeys: ["symbol", "s"],
    fields: ["date", "symbol", "company_name", "price_range", "deal_size", "market_cap"],
    limit: 4,
  },
  {
    surface: "industry_semiconductors",
    label: "반도체 산업",
    section: "industry",
    tickerKeys: ["symbol", "s"],
    fields: ["symbol", "company_name", "market_cap", "pct_change", "volume", "revenue"],
    limit: 4,
  },
  {
    surface: "sector_technology",
    label: "기술 섹터",
    section: "industry",
    tickerKeys: ["symbol", "s"],
    fields: ["symbol", "company_name", "market_cap", "pct_change", "volume", "revenue"],
    limit: 4,
  },
];

export const dynamic = "force-dynamic";
export const revalidate = false;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function cleanTicker(value: unknown): string {
  return String(value ?? "")
    .replace(/^\$/, "")
    .trim()
    .toUpperCase();
}

function rowsFromSurface(payload: JsonRecord | null): JsonRecord[] {
  if (!payload) return [];
  const records = Array.isArray(payload.records) ? payload.records : [];
  const tableRecords = Array.isArray(payload.tables)
    ? payload.tables.flatMap((table) => {
        const record = asRecord(table);
        return Array.isArray(record?.records) ? record.records : [];
      })
    : [];

  return [...records, ...tableRecords].map(asRecord).filter((row): row is JsonRecord => row !== null);
}

function totalRows(payload: JsonRecord | null, fallback: number): number {
  const counts = asRecord(payload?.counts);
  const count = counts?.records ?? counts?.rows;
  return typeof count === "number" && Number.isFinite(count) ? count : fallback;
}

function pickFields(row: JsonRecord, fields: string[]): JsonRecord {
  const picked: JsonRecord = {};
  for (const field of fields) {
    if (field in row) picked[field] = row[field];
  }
  return picked;
}

function selectSurfaceSpecs(request: Request): SurfaceSpec[] {
  const asset = new URL(request.url).searchParams.get("asset");
  if (asset === "etf") return SURFACE_SPECS.filter((spec) => spec.section === "etfs");
  if (asset === "stock") return SURFACE_SPECS.filter((spec) => spec.section !== "etfs");
  return SURFACE_SPECS;
}

async function loadSurfaceMatches(spec: SurfaceSpec, ticker: string) {
  const payload = await getStockanalysisSurface(spec.surface);
  const surface = asRecord(payload);
  const rows = rowsFromSurface(surface);
  const matches = rows
    .filter((row) => spec.tickerKeys.some((key) => cleanTicker(row[key]) === ticker))
    .slice(0, spec.limit)
    .map((row) => pickFields(row, spec.fields));

  return {
    surface: spec.surface,
    label: spec.label,
    section: spec.section,
    fetched_at: typeof surface?.fetched_at === "string" ? surface.fetched_at : null,
    rows_total: totalRows(surface, rows.length),
    match_count: matches.length,
    matches,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await params;
  const normalizedTicker = normalizeStockanalysisTicker(ticker);

  if (!normalizedTicker) {
    return NextResponse.json(
      {
        error: "STOCKANALYSIS_BAD_TICKER",
        message: "Use /api/data/stockanalysis/ticker/AAPL/surfaces.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  return withResponseCache(
    `stockanalysis:ticker-surfaces:${normalizedTicker}:${new URL(request.url).searchParams.get("asset") || "all"}`,
    300,
    async () => {
      const specs = selectSurfaceSpecs(request);
      const results = await Promise.all(specs.map((spec) => loadSurfaceMatches(spec, normalizedTicker)));
      const matched = results.filter((result) => result.match_count > 0);
      const sections = {
        earnings: matched.filter((result) => result.section === "earnings"),
        actions: matched.filter((result) => result.section === "actions"),
        markets: matched.filter((result) => result.section === "markets"),
        etfs: matched.filter((result) => result.section === "etfs"),
        ipo: matched.filter((result) => result.section === "ipo"),
        industry: matched.filter((result) => result.section === "industry"),
      };

      return NextResponse.json(
        {
          schema_version: "stockanalysis-ticker-surfaces/v1",
          generated_at: new Date().toISOString(),
          source: "stockanalysis surfaces server-filtered from local DataPack",
          ticker: normalizedTicker,
          counts: {
            asset_filter: new URL(request.url).searchParams.get("asset") || "all",
            surfaces_checked: results.length,
            surfaces_matched: matched.length,
            rows_returned: matched.reduce((sum, item) => sum + item.match_count, 0),
          },
          sections,
        },
        { headers: STOCKANALYSIS_TICKER_SURFACE_CACHE_HEADERS },
      );
    },
  );
}
