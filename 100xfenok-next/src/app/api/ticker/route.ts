import { NextResponse } from "next/server";
import { withResponseCache } from "@/lib/server/response-cache";
import { getTickerQuote } from "@/lib/server/ticker";

const TICKER_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=15, stale-while-revalidate=45",
} as const;

export const dynamic = "force-dynamic";
export const revalidate = false;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") ?? "").trim();
  if (!symbol) {
    return NextResponse.json(
      {
        error: "SYMBOL_REQUIRED",
        usage: "/api/ticker?symbol=AAPL 또는 /api/ticker/AAPL",
      },
      {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const normalizedSymbol = symbol.toUpperCase();
  return withResponseCache(`ticker:${normalizedSymbol}`, 15, async () => {
    try {
      const quote = await getTickerQuote(normalizedSymbol);
      return NextResponse.json(quote, { headers: TICKER_CACHE_HEADERS });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return NextResponse.json(
        {
          error: "TICKER_FETCH_FAILED",
          symbol: normalizedSymbol,
          message,
        },
        {
          status: 502,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
  });
}
