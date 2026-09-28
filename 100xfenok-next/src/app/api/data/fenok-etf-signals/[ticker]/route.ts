import { NextResponse } from "next/server";
import { getFenokEtfSignalsSummary } from "@/lib/server/data-loader";
import { buildEtfSignalRouteResponse } from "@/lib/server/fenok-etf-signal-route";
import { withResponseCache } from "@/lib/server/response-cache";
import { normalizeForFilePath } from "@/lib/ticker";

export const dynamic = "force-dynamic";
export const revalidate = false;

function cleanTicker(value: unknown): string {
  return normalizeForFilePath(String(value ?? ""));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await params;
  const normalizedTicker = cleanTicker(ticker);

  if (!normalizedTicker || !/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(normalizedTicker)) {
    return NextResponse.json(
      {
        error: "FENOK_ETF_SIGNAL_BAD_REQUEST",
        message: "Use /api/data/fenok-etf-signals/SPY.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  return withResponseCache(`fenok-etf-signals:${normalizedTicker}`, 300, async () => {
    return buildEtfSignalRouteResponse(await getFenokEtfSignalsSummary(), normalizedTicker);
  });
}
