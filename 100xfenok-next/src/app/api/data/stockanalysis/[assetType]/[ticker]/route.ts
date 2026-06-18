import { NextResponse } from "next/server";
import {
  getStockanalysisAsset,
  normalizeStockanalysisAssetKind,
  normalizeStockanalysisTicker,
} from "@/lib/server/data-loader";
import { withResponseCache } from "@/lib/server/response-cache";

const STOCKANALYSIS_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
} as const;

export const dynamic = "force-dynamic";
export const revalidate = false;

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
