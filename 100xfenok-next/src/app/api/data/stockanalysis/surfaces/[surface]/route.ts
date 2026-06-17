import { NextResponse } from "next/server";
import {
  getStockanalysisSurface,
  normalizeStockanalysisSurfaceName,
} from "@/lib/server/data-loader";
import { withResponseCache } from "@/lib/server/response-cache";

const STOCKANALYSIS_SURFACE_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
} as const;

export const dynamic = "force-dynamic";
export const revalidate = false;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ surface: string }> },
) {
  const { surface } = await params;
  const normalizedSurface = normalizeStockanalysisSurfaceName(surface);

  if (!normalizedSurface) {
    return NextResponse.json(
      {
        error: "STOCKANALYSIS_BAD_SURFACE",
        message: "Use /api/data/stockanalysis/surfaces/earnings_calendar.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  return withResponseCache(
    `stockanalysis:surface:${normalizedSurface}`,
    300,
    async () => {
      const payload = await getStockanalysisSurface(normalizedSurface);
      if (!payload) {
        return NextResponse.json(
          {
            error: "STOCKANALYSIS_SURFACE_NOT_FOUND",
            surface: normalizedSurface,
          },
          { status: 404, headers: { "Cache-Control": "no-store" } },
        );
      }

      return NextResponse.json(payload, { headers: STOCKANALYSIS_SURFACE_CACHE_HEADERS });
    },
  );
}
