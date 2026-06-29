import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { withResponseCache } from "@/lib/server/response-cache";
import { normalizeForFilePath } from "@/lib/ticker";

const ETF_SIGNAL_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
} as const;

const SIGNALS_PATH = path.join(process.cwd(), "public", "data", "computed", "fenok_etf_signals_summary.json");

export const dynamic = "force-dynamic";
export const revalidate = false;

type EtfSignalRow = {
  ticker?: string;
  company?: string | null;
  asset_type?: string;
  category?: string | null;
  aum?: number | null;
  expense_ratio?: number | null;
  dividend_yield?: number | null;
  beta?: number | null;
  scores?: Record<string, number | null | undefined>;
  scored_signal_count?: number | null;
};

type EtfSignalSummaryPayload = {
  schema_version?: number | string;
  generated_at?: string;
  formula_version?: string;
  coverage?: Record<string, unknown>;
  rows?: EtfSignalRow[];
};

function cleanTicker(value: unknown): string {
  return normalizeForFilePath(String(value ?? ""));
}

async function loadEtfSignalsSummary(): Promise<EtfSignalSummaryPayload | null> {
  try {
    const raw = await readFile(SIGNALS_PATH, "utf8");
    const parsed = JSON.parse(raw) as EtfSignalSummaryPayload;
    return Array.isArray(parsed.rows) ? parsed : null;
  } catch {
    return null;
  }
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
    const payload = await loadEtfSignalsSummary();
    const row = payload?.rows?.find((item) => cleanTicker(item.ticker) === normalizedTicker) ?? null;

    if (!payload || !row) {
      return NextResponse.json(
        {
          error: "FENOK_ETF_SIGNAL_NOT_FOUND",
          ticker: normalizedTicker,
        },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      {
        schema_version: "fenok-etf-signal-route/v0.1",
        ticker: normalizedTicker,
        generated_at: payload.generated_at ?? null,
        formula_version: payload.formula_version ?? null,
        coverage: payload.coverage ?? null,
        caveat: "Separate ETF lane. SCORED but not PUBLIC/DAILY/GATED; not a stock score.",
        row,
      },
      { headers: ETF_SIGNAL_CACHE_HEADERS },
    );
  });
}
