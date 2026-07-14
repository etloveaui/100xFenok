import { NextResponse } from "next/server";
import { makeDataState, type DataState } from "@/lib/data-state";
import { withResponseCache } from "@/lib/server/response-cache";

const TREASURY_API_URL =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance";
const TREASURY_CONTRACT_VERSION = "treasury-tga.v1" as const;
const TREASURY_RELEASE_TIME_ZONE = "America/New_York";
const TREASURY_RELEASE_HOUR_ET = 16;
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

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function observedFixedHoliday(year: number, month: number, day: number): string {
  const holiday = utcDate(year, month, day);
  const weekday = holiday.getUTCDay();
  if (weekday === 6) holiday.setUTCDate(holiday.getUTCDate() - 1);
  if (weekday === 0) holiday.setUTCDate(holiday.getUTCDate() + 1);
  return isoDate(holiday);
}

function nthWeekday(year: number, month: number, weekday: number, nth: number): string {
  const date = utcDate(year, month, 1);
  date.setUTCDate(1 + ((7 + weekday - date.getUTCDay()) % 7) + (nth - 1) * 7);
  return isoDate(date);
}

function lastWeekday(year: number, month: number, weekday: number): string {
  const date = utcDate(year, month + 1, 0);
  date.setUTCDate(date.getUTCDate() - ((7 + date.getUTCDay() - weekday) % 7));
  return isoDate(date);
}

function federalHolidays(year: number): Set<string> {
  return new Set([
    observedFixedHoliday(year, 1, 1),
    nthWeekday(year, 1, 1, 3),
    nthWeekday(year, 2, 1, 3),
    lastWeekday(year, 5, 1),
    observedFixedHoliday(year, 6, 19),
    observedFixedHoliday(year, 7, 4),
    nthWeekday(year, 9, 1, 1),
    nthWeekday(year, 10, 1, 2),
    observedFixedHoliday(year, 11, 11),
    nthWeekday(year, 11, 4, 4),
    observedFixedHoliday(year, 12, 25),
  ]);
}

function isTreasuryBusinessDay(value: Date): boolean {
  const weekday = value.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  const day = isoDate(value);
  const year = value.getUTCFullYear();
  return ![year - 1, year, year + 1].some((holidayYear) => federalHolidays(holidayYear).has(day));
}

function nextTreasuryBusinessDate(asOf: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return null;
  const date = new Date(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || isoDate(date) !== asOf) return null;
  do {
    date.setUTCDate(date.getUTCDate() + 1);
  } while (!isTreasuryBusinessDay(date));
  return isoDate(date);
}

function zonedDateTimeIso(date: string, hour: number, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const guess = Date.UTC(year, month - 1, day, hour);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]),
  );
  const representedAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return new Date(guess - (representedAsUtc - guess)).toISOString();
}

function treasuryReleaseDueAt(asOf: string | null): string | null {
  if (!asOf) return null;
  const nextRecordDate = nextTreasuryBusinessDate(asOf);
  const dueDate = nextRecordDate ? nextTreasuryBusinessDate(nextRecordDate) : null;
  return dueDate
    ? zonedDateTimeIso(dueDate, TREASURY_RELEASE_HOUR_ET, TREASURY_RELEASE_TIME_ZONE)
    : null;
}

function treasuryState(params: {
  source: TreasuryTgaSource;
  asOf: string | null;
  staleAfter: string | null;
}): DataState {
  if (!params.asOf || !params.staleAfter) {
    return makeDataState({
      status: "unavailable",
      label: "TGA 기준일 없음",
      detail: "Treasury 기록일을 확인할 수 없어 최신성을 판정하지 않았습니다.",
      asOf: params.asOf,
      staleAfter: params.staleAfter,
      reason: "source_date_unavailable",
    });
  }

  if (Date.now() > new Date(params.staleAfter).getTime()) {
    return makeDataState({
      status: "stale",
      label: "TGA 공표 지연",
      detail: "Treasury의 다음 영업일 16:00 ET 공표 시한을 지났지만 더 최신 기록이 없습니다.",
      asOf: params.asOf,
      staleAfter: params.staleAfter,
      reason: "source_publication_overdue",
    });
  }

  if (params.source === "treasury-fiscaldata-fallback") {
    return makeDataState({
      status: "ready",
      label: "Treasury 직접 확인",
      detail: "Treasury의 다음 영업일 16:00 ET 공표 일정 안에 있는 최신 기록입니다. 정적 DataPack 대신 FiscalData에서 직접 확인했습니다.",
      asOf: params.asOf,
      staleAfter: params.staleAfter,
      reason: "mirror_unavailable_or_empty",
    });
  }

  return makeDataState({
    status: "ready",
    label: "DataPack 미러",
    detail: "Treasury의 다음 영업일 16:00 ET 공표 일정 안에 있는 최신 기록입니다.",
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
  const lastUpdated = options.lastUpdated ?? new Date().toISOString();
  const staleAfter = treasuryReleaseDueAt(asOf);
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
