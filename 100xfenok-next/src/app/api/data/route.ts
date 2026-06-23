import { NextResponse } from "next/server";
import { addMinutesIso, makeDataState, type DataState } from "@/lib/data-state";
import { withResponseCache } from "@/lib/server/response-cache";

const TREASURY_API_URL =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance";
const TREASURY_CONTRACT_VERSION = "treasury-tga.v1" as const;
const TREASURY_STALE_AFTER_MINUTES = 60 * 72;
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

type TreasuryTgaSource = "treasury-tga-datapack" | "treasury-fiscaldata-fallback";

interface TreasuryTgaMirrorResult {
  rows: TreasuryTgaRow[];
  updated: string | null;
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

async function fetchTreasuryMirrorRows(request: Request, start: string): Promise<TreasuryTgaMirrorResult> {
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

  return {
    updated: typeof payload.updated === "string" && payload.updated.trim().length > 0
      ? payload.updated
      : null,
    rows: rows
      .filter((row) => typeof row.date === "string" && row.date >= start && row.val !== null && row.val !== undefined)
      .map((row) => ({
        record_date: row.date as string,
        open_today_bal: String(row.val),
      })),
  };
}

function latestTreasuryRecordDate(data: TreasuryTgaRow[]): string | null {
  return data.reduce<string | null>((latest, row) => {
    if (!row.record_date) return latest;
    return latest === null || row.record_date > latest ? row.record_date : latest;
  }, null);
}

function treasuryState(params: {
  source: TreasuryTgaSource;
  asOf: string | null;
  staleAfter: string | null;
}): DataState {
  if (params.source === "treasury-fiscaldata-fallback") {
    return makeDataState({
      status: "ready",
      label: "Treasury 직접 확인",
      detail: "정적 DataPack 미러가 비어 있거나 응답하지 않아 Treasury FiscalData에서 직접 확인한 값입니다.",
      asOf: params.asOf,
      staleAfter: params.staleAfter,
      reason: "mirror_unavailable_or_empty",
    });
  }

  return makeDataState({
    status: "ready",
    label: "DataPack 미러",
    detail: "예약 갱신된 Treasury TGA DataPack 미러에서 응답했습니다.",
    asOf: params.asOf,
    staleAfter: params.staleAfter,
  });
}

function treasuryResponse(
  source: TreasuryTgaSource,
  data: TreasuryTgaRow[],
  options: { lastUpdated?: string | null } = {},
): Response {
  const asOf = latestTreasuryRecordDate(data);
  const lastUpdated = options.lastUpdated ?? asOf ?? new Date().toISOString();
  const staleAfter = addMinutesIso(lastUpdated, TREASURY_STALE_AFTER_MINUTES);
  return NextResponse.json(
    {
      schemaVersion: TREASURY_CONTRACT_VERSION,
      dataset: "treasury-tga",
      source,
      data,
      lastUpdated,
      staleAfter,
      state: treasuryState({ source, asOf, staleAfter }),
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
    const mirror = await fetchTreasuryMirrorRows(request, start);
    if (mirror.rows.length > 0) {
      return treasuryResponse("treasury-tga-datapack", mirror.rows, {
        lastUpdated: mirror.updated,
      });
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
        schemaVersion: TREASURY_CONTRACT_VERSION,
        dataset: "treasury-tga",
        error: "TREASURY_DATA_UNAVAILABLE",
        details: rejected,
        state: makeDataState({
          status: "error",
          label: "TGA 확인 실패",
          detail: "정적 DataPack 미러와 Treasury FiscalData fallback 모두 응답하지 않았습니다.",
          reason: "treasury_data_unavailable",
        }),
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
