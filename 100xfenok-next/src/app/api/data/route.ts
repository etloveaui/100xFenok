import { NextResponse } from "next/server";
import { withResponseCache } from "@/lib/server/response-cache";

const TREASURY_API_URL =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance";
const TREASURY_ACCOUNT_TYPES = [
  "Federal Reserve Account",
  "Treasury General Account (TGA)",
  "Treasury General Account (TGA) Opening Balance",
] as const;

interface TreasuryTgaRow {
  record_date: string;
  open_today_bal: string;
}

interface TreasuryTgaMirrorPayload {
  updated?: string;
  source?: string;
  endpoint?: string;
  series?: Array<{ date?: string; val?: number | string | null }>;
}

export const dynamic = "force-dynamic";
export const revalidate = false;

function isValidDateParam(value: string | null): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function fetchTreasuryRows(start: string, accountType: string) {
  const url = new URL(TREASURY_API_URL);
  url.searchParams.set(
    "filter",
    `account_type:eq:${accountType},record_date:gte:${start}`,
  );
  url.searchParams.set("sort", "record_date");
  url.searchParams.set("page[size]", "10000");
  url.searchParams.set("fields", "record_date,open_today_bal");

  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`TREASURY_FETCH_FAILED:${response.status}:${accountType}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{ record_date?: string; open_today_bal?: string | null }>;
  };

  return Array.isArray(payload.data) ? payload.data : [];
}

async function fetchTreasuryMirrorRows(request: Request, start: string): Promise<TreasuryTgaRow[]> {
  const response = await fetch(new URL("/data/macro/tga.json", request.url), {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`TREASURY_MIRROR_FETCH_FAILED:${response.status}`);
  }

  const payload = (await response.json()) as TreasuryTgaMirrorPayload;
  const rows = Array.isArray(payload.series) ? payload.series : [];

  return rows
    .filter((row) => typeof row.date === "string" && row.date >= start && row.val !== null && row.val !== undefined)
    .map((row) => ({
      record_date: row.date as string,
      open_today_bal: String(row.val),
    }));
}

function treasuryResponse(source: string, data: TreasuryTgaRow[]): Response {
  return NextResponse.json(
    {
      source,
      data,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600",
      },
    },
  );
}

async function getTreasuryTgaResponse(request: Request, start: string): Promise<Response> {
  try {
    const mirrorRows = await fetchTreasuryMirrorRows(request, start);
    if (mirrorRows.length > 0) {
      return treasuryResponse("treasury-tga-datapack", mirrorRows);
    }
  } catch {
    // Fall through to the live FiscalData fallback when the static mirror is unavailable.
  }

  const settled = await Promise.allSettled(
    TREASURY_ACCOUNT_TYPES.map((accountType) =>
      fetchTreasuryRows(start, accountType),
    ),
  );

  const merged = new Map<string, string>();

  settled.forEach((result) => {
    if (result.status !== "fulfilled") return;

    result.value.forEach((row) => {
      if (!row?.record_date || !row?.open_today_bal || row.open_today_bal === "null") {
        return;
      }
      merged.set(row.record_date, row.open_today_bal);
    });
  });

  if (merged.size === 0) {
    const rejected = settled
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) =>
        result.reason instanceof Error ? result.reason.message : String(result.reason),
      );

    return NextResponse.json(
      {
        error: "TREASURY_DATA_UNAVAILABLE",
        details: rejected,
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const data = Array.from(merged.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([record_date, open_today_bal]) => ({ record_date, open_today_bal }));

  return treasuryResponse("treasury-fiscaldata-fallback", data);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dataset = searchParams.get("dataset");

  if (dataset !== "treasury-tga") {
    return NextResponse.json(
      {
        error: "UNSUPPORTED_DATASET",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const start = searchParams.get("start");
  if (!isValidDateParam(start)) {
    return NextResponse.json(
      {
        error: "INVALID_START_DATE",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  return withResponseCache(
    `treasury-tga:${start}`,
    1800,
    () => getTreasuryTgaResponse(request, start),
  );
}
