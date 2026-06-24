import { daysUntilKstDate, formatAsOf, freshnessDataState, makeDataState, todayKST, type DataState } from "@/lib/data-state";

export type StockConnectionFreshnessSource =
  | "profile"
  | "action_index"
  | "market_facts"
  | "filings"
  | "sec_13f"
  | "etf_universe";

const SOURCE_META: Record<StockConnectionFreshnessSource, { label: string; maxAgeDays?: number; quarterGraceDays?: number }> = {
  profile: { label: "프로필", maxAgeDays: 14 },
  action_index: { label: "신호", maxAgeDays: 7 },
  market_facts: { label: "시장팩트", maxAgeDays: 2 },
  filings: { label: "공시", maxAgeDays: 7 },
  sec_13f: { label: "13F", quarterGraceDays: 95 },
  etf_universe: { label: "ETF", maxAgeDays: 14 },
};

const QUARTER_RE = /^(\d{4})-Q([1-4])$/;

function quarterEndDate(value: string): string | null {
  const match = QUARTER_RE.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  const monthDay = ["03-31", "06-30", "09-30", "12-31"][quarter - 1];
  return Number.isFinite(year) && monthDay ? `${year}-${monthDay}` : null;
}

function addDays(dateValue: string, days: number): string | null {
  const time = new Date(`${dateValue}T00:00:00Z`).getTime();
  if (!Number.isFinite(time)) return null;
  const next = new Date(time + days * 24 * 60 * 60 * 1000);
  return next.toISOString().slice(0, 10);
}

function quarterFreshnessState(source: StockConnectionFreshnessSource, asOf: string, today = todayKST()): DataState | null {
  const meta = SOURCE_META[source];
  const quarterEnd = quarterEndDate(asOf);
  if (!quarterEnd || !meta.quarterGraceDays) return null;
  const staleAfter = addDays(quarterEnd, meta.quarterGraceDays);
  const daysToStale = staleAfter ? daysUntilKstDate(staleAfter, today) : null;
  const stale = daysToStale !== null && daysToStale < 0;
  const label = formatAsOf(asOf) ?? asOf;
  return makeDataState({
    status: stale ? "stale" : "ready",
    label: stale ? `${meta.label} 오래됨` : `${meta.label} 기준 확인`,
    detail: stale
      ? `${label} 기준 13F 데이터입니다. 다음 분기 갱신 여부를 확인해야 합니다.`
      : `${label} 기준 13F 데이터입니다.`,
    asOf,
    staleAfter,
  });
}

export function stockConnectionFreshnessState(
  source: StockConnectionFreshnessSource,
  asOf: string | null | undefined,
): DataState {
  const meta = SOURCE_META[source];
  const label = meta.label;
  if (typeof asOf === "string") {
    const quarterState = quarterFreshnessState(source, asOf);
    if (quarterState) return quarterState;
  }
  return freshnessDataState({
    asOf,
    maxAgeDays: meta.maxAgeDays,
    readyLabel: `${label} 기준 확인`,
    staleLabel: `${label} 오래됨`,
    unavailableLabel: `${label} 기준일 없음`,
    readyDetail: `${label} 데이터 기준일을 확인했습니다.`,
    staleDetail: `${label} 데이터가 최신 기준보다 오래됐습니다.`,
    unavailableDetail: `${label} 데이터 기준일을 확인하지 못했습니다.`,
  });
}

export function stockConnectionFreshnessLabel(source: StockConnectionFreshnessSource): string {
  return SOURCE_META[source].label;
}
