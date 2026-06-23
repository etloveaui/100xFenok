const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/;
const DAY_MS = 24 * 60 * 60 * 1000;

export type DataReadinessStatus = "ready" | "partial" | "stale" | "pending" | "unavailable" | "error";

export interface DataState {
  status: DataReadinessStatus;
  label: string;
  detail: string;
  asOf?: string | null;
  staleAfter?: string | null;
  reason?: string | null;
}

export const DATA_STATE_LABELS: Record<DataReadinessStatus, string> = {
  ready: "준비됨",
  partial: "부분 준비",
  stale: "오래됨",
  pending: "확인 중",
  unavailable: "확인 불가",
  error: "오류",
};

export function todayKST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

export function dateOnly(value: string | null | undefined): string | null {
  const match = typeof value === "string" ? DATE_RE.exec(value) : null;
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function formatAsOf(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const trimmed = value.trim();
  const match = DATE_RE.exec(trimmed);
  if (!match) return trimmed;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return match[4] && match[5] ? `${date} ${match[4]}:${match[5]}` : date;
}

export function formatDataDate(value: string | null | undefined): string | null {
  return dateOnly(value) ?? formatAsOf(value);
}

export function addMinutesIso(value: string, minutes: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

export function isOlderThan(value: string | null | undefined, maxAgeMs: number, now = Date.now()): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && now - time > maxAgeMs;
}

export function daysUntilKstDate(dateValue: string | null | undefined, today = todayKST()): number | null {
  const target = dateOnly(dateValue);
  if (!target) return null;
  const [targetY, targetM, targetD] = target.split("-").map(Number);
  const [todayY, todayM, todayD] = today.split("-").map(Number);
  if (![targetY, targetM, targetD, todayY, todayM, todayD].every(Number.isFinite)) return null;
  const targetTime = Date.UTC(targetY, targetM - 1, targetD);
  const todayTime = Date.UTC(todayY, todayM - 1, todayD);
  return Math.round((targetTime - todayTime) / DAY_MS);
}

export function isStaleAsOf(value: string | null | undefined, maxAgeDays = 7, today = todayKST()): boolean {
  const diff = daysUntilKstDate(value, today);
  return diff !== null && diff < -maxAgeDays;
}

export function latestAsOf(values: Array<string | null | undefined>): string | null {
  return values
    .map((value) => ({ raw: value ?? null, key: dateOnly(value) }))
    .filter((item): item is { raw: string; key: string } => Boolean(item.raw && item.key))
    .sort((a, b) => a.key.localeCompare(b.key))
    .at(-1)?.raw ?? null;
}

export function makeDataState(params: {
  status: DataReadinessStatus;
  label?: string;
  detail: string;
  asOf?: string | null;
  staleAfter?: string | null;
  reason?: string | null;
}): DataState {
  return {
    status: params.status,
    label: params.label ?? DATA_STATE_LABELS[params.status],
    detail: params.detail,
    asOf: params.asOf ?? null,
    staleAfter: params.staleAfter ?? null,
    reason: params.reason ?? null,
  };
}

export function dataStateTone(status: DataReadinessStatus): string {
  if (status === "ready") return "ok";
  if (status === "partial" || status === "stale" || status === "pending") return "warn";
  if (status === "error") return "error";
  return "muted";
}

export function freshnessDataState(params: {
  asOf?: string | null;
  readyLabel?: string;
  staleLabel?: string;
  unavailableLabel?: string;
  readyDetail?: string;
  staleDetail?: string;
  unavailableDetail?: string;
  maxAgeDays?: number;
}): DataState {
  const asOf = params.asOf ?? null;
  const label = formatAsOf(asOf);
  if (!label) {
    return makeDataState({
      status: "unavailable",
      label: params.unavailableLabel ?? "기준일 없음",
      detail: params.unavailableDetail ?? "데이터 기준일을 확인하지 못했습니다.",
      asOf,
    });
  }
  if (isStaleAsOf(asOf, params.maxAgeDays)) {
    return makeDataState({
      status: "stale",
      label: params.staleLabel ?? "오래된 데이터",
      detail: params.staleDetail ?? `기준 ${label}. 최신 여부를 함께 확인해야 합니다.`,
      asOf,
    });
  }
  return makeDataState({
    status: "ready",
    label: params.readyLabel ?? "기준일 확인",
    detail: params.readyDetail ?? `기준 ${label}.`,
    asOf,
  });
}
