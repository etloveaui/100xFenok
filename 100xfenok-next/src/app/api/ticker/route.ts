import { NextResponse } from "next/server";
import {
  QUOTE_CACHE_CONTROL,
  QUOTE_CONTRACT_VERSION,
  isValidQuoteSymbol,
  normalizeQuoteSymbol,
} from "@/lib/quote-contract";
import { withResponseCache } from "@/lib/server/response-cache";
import { getTickerQuote } from "@/lib/server/ticker";

const TICKER_CACHE_HEADERS = {
  "Cache-Control": QUOTE_CACHE_CONTROL,
} as const;

export const dynamic = "force-dynamic";
export const revalidate = false;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = normalizeQuoteSymbol(url.searchParams.get("symbol") ?? "");
  if (!symbol) {
    return NextResponse.json(
      {
        schemaVersion: QUOTE_CONTRACT_VERSION,
        error: "SYMBOL_REQUIRED",
        usage: "/api/ticker?symbol=AAPL 또는 /api/ticker/AAPL",
      },
      {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  if (!isValidQuoteSymbol(symbol)) {
    return NextResponse.json(
      {
        schemaVersion: QUOTE_CONTRACT_VERSION,
        error: "INVALID_SYMBOL",
        symbol,
        message: "Symbol must match the quote contract symbol pattern.",
      },
      {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const normalizedSymbol = symbol;
  return withResponseCache(`ticker:${normalizedSymbol}`, 15, async () => {
    try {
      const quote = await getTickerQuote(normalizedSymbol);
      return NextResponse.json(quote, { headers: TICKER_CACHE_HEADERS });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return NextResponse.json(
        {
          schemaVersion: QUOTE_CONTRACT_VERSION,
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
