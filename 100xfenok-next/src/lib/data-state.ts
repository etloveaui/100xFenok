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
  pending: "대기",
  unavailable: "확인 불가",
  error: "오류",
};

export function formatDataDate(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
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
