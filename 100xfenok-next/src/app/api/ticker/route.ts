import { NextResponse } from "next/server";
import { getTickerQuote } from "@/lib/server/ticker";

const TICKER_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=15, stale-while-revalidate=45",
} as const;

export const runtime = "edge";
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

  try {
    const quote = await getTickerQuote(symbol);
    return NextResponse.json(quote, { headers: TICKER_CACHE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "TICKER_FETCH_FAILED",
        symbol: symbol.toUpperCase(),
        message,
      },
      {
        status: 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
