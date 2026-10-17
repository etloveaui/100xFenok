import { NextResponse } from "next/server";
import {
  getStockanalysisAsset,
  getStockanalysisEtfUniverse,
  normalizeStockanalysisAssetKind,
  normalizeStockanalysisTicker,
} from "@/lib/server/data-loader";
import {
  resolveDataSupplyEtfDetail,
} from "@/lib/server/data-supply-etf-detail";
import {
  buildEtfResponse,
  STOCKANALYSIS_CACHE_HEADERS,
} from "@/lib/server/data-supply-etf-response";
import { recordTypedUnavailableResponse } from "@/lib/server/data-supply-etf-telemetry";
import { withResponseCache } from "@/lib/server/response-cache";
import { BUILD_VERSION } from "@/generated/build-version";

export const dynamic = "force-dynamic";
export const revalidate = false;
export { buildEtfResponse } from "@/lib/server/data-supply-etf-response";

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
      if (resolution.kind === "not_found") {
        const universe = await getStockanalysisEtfUniverse();
        const records = Array.isArray(universe?.records) ? universe.records : [];
        const row = records.find((value: Record<string, unknown>) => value.ticker === ticker);
        if (row) return NextResponse.json({ ticker, asset_type: "etf", detail_status: "universe_only",
          normalized: { overview: { name: row.name, aum: row.aum, expenseRatio: row.expenseRatio,
            inceptionDate: row.inceptionDate, category: row.category, dividendYield: row.dividendYield,
            beta: row.beta, sharesOut: row.sharesOut, etf_website: row.etf_website },
            performance: row.performance, classification: row.classification } },
          { headers: STOCKANALYSIS_CACHE_HEADERS });
      }
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
