import { NextResponse } from "next/server";
import { getTickerQuote } from "@/lib/server/ticker";

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
      { status: 400 },
    );
  }

  try {
    const quote = await getTickerQuote(symbol);
    return NextResponse.json(quote);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "TICKER_FETCH_FAILED",
        symbol: symbol.toUpperCase(),
        message,
      },
      { status: 502 },
    );
  }
}
