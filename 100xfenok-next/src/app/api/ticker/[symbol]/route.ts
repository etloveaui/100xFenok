import { NextResponse } from "next/server";
import { getTickerQuote } from "@/lib/server/ticker";

export const dynamic = "force-dynamic";
export const revalidate = false;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  try {
    const { symbol } = await params;
    const quote = await getTickerQuote(symbol);
    return NextResponse.json(quote);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "TICKER_FETCH_FAILED",
        message,
      },
      { status: 502 },
    );
  }
}
