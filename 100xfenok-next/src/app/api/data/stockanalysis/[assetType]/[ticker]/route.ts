import { NextResponse } from "next/server";
import {
  getStockanalysisAsset,
  normalizeStockanalysisAssetKind,
  normalizeStockanalysisTicker,
} from "@/lib/server/data-loader";
import {
  buildUnavailableEtfRepresentation,
  mergeEtfDataSupply,
  resolveDataSupplyEtfDetail,
  type EtfDetailResolution,
} from "@/lib/server/data-supply-etf-detail";
import { recordTypedUnavailableResponse } from "@/lib/server/data-supply-etf-telemetry";
import { withResponseCache } from "@/lib/server/response-cache";
import { BUILD_VERSION } from "@/generated/build-version";

const STOCKANALYSIS_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
} as const;

const DATA_SUPPLY_NEGATIVE_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=15, s-maxage=60",
  "X-100x-Data-Supply-SLO": "typed-unavailable",
} as const;

export const dynamic = "force-dynamic";
export const revalidate = false;

export async function buildEtfResponse(resolution: EtfDetailResolution, ticker: string) {
  if (resolution.kind === "selected") {
    return NextResponse.json(
      mergeEtfDataSupply(resolution.payload, resolution.dataSupply),
      { headers: STOCKANALYSIS_CACHE_HEADERS },
    );
  }
  if (resolution.kind === "shard") {
    return new Response(resolution.document.raw, {
      headers: {
        ...STOCKANALYSIS_CACHE_HEADERS,
        "Content-Type": "application/json",
      },
    });
  }
  if (resolution.kind === "plane") {
    return new Response(resolution.document.bytes, {
      headers: {
        ...STOCKANALYSIS_CACHE_HEADERS,
        "Content-Type": "application/json",
        "X-100x-ETF-Detail-Authority": "cloud-data-plane",
        "X-Data-Plane-Generation": resolution.generationId,
      },
    });
  }
  if (resolution.kind === "unavailable") {
    const representation = buildUnavailableEtfRepresentation(ticker, resolution.dataSupply);
    return NextResponse.json(
      representation.body,
      { status: 503, headers: DATA_SUPPLY_NEGATIVE_CACHE_HEADERS },
    );
  }
  if (resolution.kind === "shard_unavailable") {
    return NextResponse.json(
      { error: "STOCKANALYSIS_ETF_SHARD_UNAVAILABLE", ticker },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (resolution.kind === "error") {
    return NextResponse.json(
      { error: resolution.code, ticker },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    { error: "STOCKANALYSIS_ASSET_NOT_FOUND", assetType: "etfs", ticker },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

export async function getEtfResponse(
  ticker: string,
  buildVersion = BUILD_VERSION,
  resolve = resolveDataSupplyEtfDetail,
) {
  return withResponseCache(
    `stockanalysis:etfs:${buildVersion}:${ticker}`,
    300,
    async () => {
      const resolution = await resolve(ticker);
      const response = await buildEtfResponse(resolution, ticker);
      if (
        resolution.kind === "unavailable"
        && response.status === 503
        && response.headers.get("X-100x-Data-Supply-SLO") === "typed-unavailable"
      ) {
        recordTypedUnavailableResponse({
          ticker,
          cacheStatus: "MISS",
          stateObservedAt: resolution.stateObservedAt,
        });
      }
      return response;
    },
    {
      isCacheable: (response) => response.ok
        || (response.status === 503 && response.headers.get("X-100x-Data-Supply-SLO") === "typed-unavailable"),
      preserveCacheControl: true,
    },
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
    return getEtfResponse(normalizedTicker);
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
