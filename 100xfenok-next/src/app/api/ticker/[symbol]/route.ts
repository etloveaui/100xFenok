import { NextResponse } from "next/server";
import {
  QUOTE_CACHE_CONTROL,
  QUOTE_CONTRACT_VERSION,
  isValidQuoteSymbol,
  normalizeQuoteSymbol,
  quoteErrorState,
} from "@/lib/quote-contract";
import { withResponseCache } from "@/lib/server/response-cache";
import { getTickerQuote } from "@/lib/server/ticker";

const TICKER_CACHE_HEADERS = {
  "Cache-Control": QUOTE_CACHE_CONTROL,
} as const;

export const dynamic = "force-dynamic";
export const revalidate = false;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;
  const normalizedSymbol = normalizeQuoteSymbol(symbol);

  if (!isValidQuoteSymbol(normalizedSymbol)) {
    return NextResponse.json(
      {
        schemaVersion: QUOTE_CONTRACT_VERSION,
        error: "INVALID_SYMBOL",
        symbol: normalizedSymbol,
        message: "Symbol must match the quote contract symbol pattern.",
        state: quoteErrorState("지원하지 않는 티커 형식입니다."),
      },
      {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

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
          state: quoteErrorState("시세 조회 경로가 응답하지 않았습니다."),
        },
        {
          status: 502,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
  });
}
