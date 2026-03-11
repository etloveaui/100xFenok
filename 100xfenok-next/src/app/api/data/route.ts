import { NextResponse } from "next/server";

const TREASURY_API_URL =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance";
const TREASURY_ACCOUNT_TYPES = [
  "Federal Reserve Account",
  "Treasury General Account (TGA)",
  "Treasury General Account (TGA) Opening Balance",
] as const;

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

  return NextResponse.json(
    {
      source: "treasury-fiscaldata",
      data,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600",
      },
    },
  );
}
