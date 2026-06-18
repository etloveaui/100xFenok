import { NextResponse } from "next/server";
import {
  getStockanalysisAsset,
  getStockanalysisSurface,
  normalizeStockanalysisAssetKind,
  normalizeStockanalysisTicker,
} from "@/lib/server/data-loader";
import { withResponseCache } from "@/lib/server/response-cache";

const STOCKANALYSIS_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
} as const;

export const dynamic = "force-dynamic";
export const revalidate = false;

type JsonRecord = Record<string, unknown>;

const ETF_SURFACE_FALLBACKS = [
  {
    surface: "new_etfs",
    tickerKeys: ["s", "symbol"],
  },
  {
    surface: "etf_screener",
    tickerKeys: ["s", "symbol"],
  },
  {
    surface: "etf_provider_blackrock",
    tickerKeys: ["symbol", "s"],
  },
  {
    surface: "etf_provider_proshares",
    tickerKeys: ["symbol", "s"],
  },
  {
    surface: "list_bitcoin_etfs",
    tickerKeys: ["symbol", "s"],
  },
] as const;

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

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[%,$]/g, "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

async function getEtfSurfaceFallback(ticker: string) {
  const matches: Array<{
    surface: string;
    fetched_at: string | null;
    row: JsonRecord;
  }> = [];

  for (const spec of ETF_SURFACE_FALLBACKS) {
    const surface = asRecord(await getStockanalysisSurface(spec.surface));
    const rows = rowsFromSurface(surface);
    for (const row of rows) {
      if (spec.tickerKeys.some((key) => cleanTicker(row[key]) === ticker)) {
        matches.push({
          surface: spec.surface,
          fetched_at: typeof surface?.fetched_at === "string" ? surface.fetched_at : null,
          row,
        });
      }
    }
  }

  const primary = matches[0];
  if (!primary) return null;

  const row = primary.row;
  const price = parseNumber(row.price ?? row.stock_price);
  const changePct = parseNumber(row.change ?? row.pct_change);
  const holdingCount = parseNumber(row.holdings);
  const overview: JsonRecord = {};
  const aum = row.aum ?? row.assets;
  const expenseRatio = row.exp_ratio;
  const dividendYield = row.div_yield;
  const inception = row.inceptionDate;
  if (aum !== undefined && aum !== null) overview.aum = aum;
  if (expenseRatio !== undefined && expenseRatio !== null) overview.expenseRatio = expenseRatio;
  if (dividendYield !== undefined && dividendYield !== null) overview.dividendYield = dividendYield;
  if (inception !== undefined && inception !== null) overview.inception = inception;

  return {
    schema_version: "stockanalysis/v1",
    source: "stockanalysis",
    asset_type: "etf",
    ticker,
    fetched_at: primary.fetched_at ?? new Date().toISOString(),
    role: "surface-only ETF fallback; per-ETF detail JSON not yet available",
    detail_status: "surface_only",
    normalized: {
      holdings: [],
      holding_count: holdingCount,
      overview,
      quote: {
        p: price,
        cp: changePct,
        u: primary.fetched_at,
        ex: "stockanalysis surface",
      },
      surface_fallback: {
        match_count: matches.length,
        surfaces: matches.map((match) => ({
          surface: match.surface,
          fetched_at: match.fetched_at,
          row: match.row,
        })),
      },
    },
    raw: {
      surface_fallback: matches,
    },
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetType: string; ticker: string }> },
) {
  const { assetType, ticker } = await params;
  const normalizedAssetKind = normalizeStockanalysisAssetKind(assetType);
  const normalizedTicker = normalizeStockanalysisTicker(ticker);

  if (!normalizedAssetKind || !normalizedTicker) {
    return NextResponse.json(
      {
        error: "STOCKANALYSIS_BAD_REQUEST",
        message: "Use /api/data/stockanalysis/etfs/SPY, /stocks/AAPL, or /financials/AAPL.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  return withResponseCache(
    `stockanalysis:${normalizedAssetKind}:${normalizedTicker}`,
    300,
    async () => {
      const payload = await getStockanalysisAsset(normalizedAssetKind, normalizedTicker);
      if (!payload && normalizedAssetKind === "etfs") {
        const fallback = await getEtfSurfaceFallback(normalizedTicker);
        if (fallback) {
          return NextResponse.json(fallback, { headers: STOCKANALYSIS_CACHE_HEADERS });
        }
      }
      if (!payload) {
        return NextResponse.json(
          {
            error: "STOCKANALYSIS_ASSET_NOT_FOUND",
            assetType: normalizedAssetKind,
            ticker: normalizedTicker,
          },
          { status: 404, headers: { "Cache-Control": "no-store" } },
        );
      }

      return NextResponse.json(payload, { headers: STOCKANALYSIS_CACHE_HEADERS });
    },
  );
}
