import { NextResponse } from "next/server";
import {
  getStockanalysisAsset,
  getStockanalysisEtfUniverse,
  getStockanalysisSurface,
  normalizeStockanalysisAssetKind,
  normalizeStockanalysisTicker,
} from "@/lib/server/data-loader";
import {
  buildUnavailableEtfRepresentation,
  mergeEtfDataSupply,
  resolveDataSupplyEtfDetail,
  type EtfDetailResolution,
} from "@/lib/server/data-supply-etf-detail";
import { withResponseCache } from "@/lib/server/response-cache";
import { normalizeForFilePath } from "@/lib/ticker";

const STOCKANALYSIS_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
} as const;

const DATA_SUPPLY_NEGATIVE_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=15, s-maxage=60",
  "X-100x-Data-Supply-SLO": "typed-unavailable",
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
type EtfSurfaceFallbackSpec = (typeof ETF_SURFACE_FALLBACKS)[number];
type EtfSurfaceFallbackMatch = {
  surface: string;
  fetched_at: string | null;
  row: JsonRecord;
};

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function cleanTicker(value: unknown): string {
  return normalizeForFilePath(String(value ?? ""));
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

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text !== "-" ? text : null;
}

async function getEtfSurfaceMatches(specs: readonly EtfSurfaceFallbackSpec[], ticker: string): Promise<EtfSurfaceFallbackMatch[]> {
  const groups = await Promise.all(specs.map(async (spec) => {
    const surface = asRecord(await getStockanalysisSurface(spec.surface));
    const rows = rowsFromSurface(surface);
    return rows
      .filter((row) => spec.tickerKeys.some((key) => cleanTicker(row[key]) === ticker))
      .map((row) => ({
        surface: spec.surface,
        fetched_at: typeof surface?.fetched_at === "string" ? surface.fetched_at : null,
        row,
      }));
  }));
  return groups.flat();
}

async function getEtfSurfaceFallback(ticker: string) {
  const priorityMatches = await getEtfSurfaceMatches(ETF_SURFACE_FALLBACKS.slice(0, 2), ticker);
  const matches = priorityMatches.length > 0
    ? priorityMatches
    : await getEtfSurfaceMatches(ETF_SURFACE_FALLBACKS.slice(2), ticker);
  const universe = matches.length === 0 ? asRecord(await getStockanalysisEtfUniverse()) : null;
  const universeRow = universe ? rowsFromSurface(universe).find((row) => cleanTicker(row.ticker) === ticker) ?? null : null;
  const universeFetchedAt = typeof universe?.generated_at === "string" ? universe.generated_at : null;
  const primary = matches[0];
  if (!primary && !universeRow) return null;

  const row = primary?.row ?? universeRow!;
  const price = parseNumber(row.price ?? row.stock_price);
  const changePct = parseNumber(row.change ?? row.pct_change);
  const holdingCount = parseNumber(row.holdings);
  const overview: JsonRecord = {};
  const aum = row.aum ?? row.assets ?? universeRow?.aum ?? universeRow?.aum_raw;
  const expenseRatio = row.exp_ratio;
  const dividendYield = row.div_yield;
  const inception = row.inceptionDate;
  const name = cleanText(row.n) ?? cleanText(row.fund_name) ?? cleanText(row.name) ?? cleanText(universeRow?.name);
  const category = cleanText(row.assetClass) ?? cleanText(row.category) ?? cleanText(universeRow?.category);
  const classification = matches
    .map((match) => asRecord(match.row.classification))
    .find((item): item is JsonRecord => item !== null)
    ?? asRecord(universeRow?.classification);
  const performance = asRecord(row.performance) ?? asRecord(universeRow?.performance);
  if (name) overview.name = name;
  if (category) overview.category = category;
  if (aum !== undefined && aum !== null) overview.aum = aum;
  if (expenseRatio !== undefined && expenseRatio !== null) overview.expenseRatio = expenseRatio;
  if (dividendYield !== undefined && dividendYield !== null) overview.dividendYield = dividendYield;
  if (inception !== undefined && inception !== null) overview.inception = inception;
  const fetchedAt = primary?.fetched_at ?? universeFetchedAt ?? null;
  const detailStatus = primary ? "surface_only" : "universe_only";

  return {
    schema_version: "stockanalysis/v1",
    source: "stockanalysis",
    asset_type: "etf",
    ticker,
    fetched_at: fetchedAt,
    role: primary
      ? "surface-only ETF fallback; per-ETF detail JSON not yet available"
      : "universe-only ETF fallback; per-ETF detail JSON not yet available",
    detail_status: detailStatus,
    normalized: {
      holdings: [],
      holding_count: holdingCount,
      overview,
      performance,
      classification,
      quote: {
        p: price,
        cp: changePct,
        u: fetchedAt,
        ex: primary ? "stockanalysis surface" : "stockanalysis ETF universe",
      },
      surface_fallback: {
        match_count: matches.length,
        surfaces: matches.map((match) => ({
          surface: match.surface,
          fetched_at: match.fetched_at,
          row: match.row,
        })),
      },
      universe_fallback: universeRow
        ? {
            fetched_at: universeFetchedAt,
            row: universeRow,
          }
        : null,
    },
    raw: {
      surface_fallback: matches,
      universe_fallback: universeRow
        ? {
            fetched_at: universeFetchedAt,
            row: universeRow,
          }
        : null,
    },
  };
}

async function buildEtfResponse(resolution: EtfDetailResolution, ticker: string) {
  if (resolution.kind === "selected") {
    return NextResponse.json(
      mergeEtfDataSupply(resolution.payload, resolution.dataSupply),
      { headers: STOCKANALYSIS_CACHE_HEADERS },
    );
  }
  if (resolution.kind === "direct") {
    return NextResponse.json(resolution.payload, { headers: STOCKANALYSIS_CACHE_HEADERS });
  }
  if (resolution.kind === "unavailable") {
    const summary = await getEtfSurfaceFallback(ticker);
    const representation = buildUnavailableEtfRepresentation(ticker, resolution.dataSupply, summary);
    if (representation.kind === "summary") {
      return NextResponse.json(
        representation.body,
        { headers: { "Cache-Control": "public, max-age=15, s-maxage=60" } },
      );
    }
    return NextResponse.json(
      representation.body,
      { status: 503, headers: DATA_SUPPLY_NEGATIVE_CACHE_HEADERS },
    );
  }
  if (resolution.kind === "error") {
    return NextResponse.json(
      { error: resolution.code, ticker },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const summary = await getEtfSurfaceFallback(ticker);
  if (summary) return NextResponse.json(summary, { headers: STOCKANALYSIS_CACHE_HEADERS });
  return NextResponse.json(
    { error: "STOCKANALYSIS_ASSET_NOT_FOUND", assetType: "etfs", ticker },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
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

  if (normalizedAssetKind === "etfs") {
    const resolution = await resolveDataSupplyEtfDetail(normalizedTicker);
    const digest = resolution.projectionDigest ?? "guard-unavailable";
    const negative = resolution.kind === "unavailable";
    return withResponseCache(
      `stockanalysis:etfs:${negative ? "unavailable" : "payload"}:${normalizedTicker}:${digest}`,
      negative ? 60 : 300,
      () => buildEtfResponse(resolution, normalizedTicker),
      {
        isCacheable: (response) => response.ok
          || (response.status === 503 && response.headers.get("X-100x-Data-Supply-SLO") === "typed-unavailable"),
        preserveCacheControl: true,
      },
    );
  }

  return withResponseCache(
    `stockanalysis:${normalizedAssetKind}:${normalizedTicker}`,
    300,
    async () => {
      const payload = await getStockanalysisAsset(normalizedAssetKind, normalizedTicker);
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
