import { NextResponse } from "next/server";
import { getTickerQuote } from "@/lib/server/ticker";

const TICKER_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=15, stale-while-revalidate=45",
} as const;

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const revalidate = false;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  try {
    const { symbol } = await params;
    const quote = await getTickerQuote(symbol);
    return NextResponse.json(quote, { headers: TICKER_CACHE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "TICKER_FETCH_FAILED",
        message,
      },
      {
        status: 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
