export type EtfResolutionState = "fresh_primary" | "fresh_fallback" | "lkg_primary" | "lkg_fallback" | "unavailable";

export interface EtfDataSupply {
  enrollment_state: "enrolled";
  resolution_state: EtfResolutionState;
  provider_role: "primary" | "fallback" | null;
  fallback_depth: number | null;
  source_as_of: string | null;
  selected_at: string | null;
  source_age_days: number | null;
  reason_code: string | null;
  recovery_transition: "unavailable" | null;
  projection_digest: string;
}

export type EtfApiResult<T> =
  | { kind: "ok"; data: T; dataSupply: EtfDataSupply | null }
  | { kind: "unavailable"; data: null; dataSupply: EtfDataSupply }
  | { kind: "missing"; data: null; dataSupply: null }
  | { kind: "failed"; data: null; dataSupply: null };

export interface EtfDataSupplyPresentation {
  label: string | null;
  description: string | null;
  sourceDate: string | null;
  ageDays: number | null;
  degraded: boolean;
}

export const ETF_DETAIL_COMPAT_EXPIRES_AT = "2026-07-25T00:00:00Z";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function parseEtfDataSupply(value: unknown): EtfDataSupply | null {
  const record = asRecord(value);
  if (!record || record.enrollment_state !== "enrolled") return null;
  const state = record.resolution_state;
  if (
    state !== "fresh_primary"
    && state !== "fresh_fallback"
    && state !== "lkg_primary"
    && state !== "lkg_fallback"
    && state !== "unavailable"
  ) return null;
  const expectedRole = state.endsWith("primary") ? "primary" : state.endsWith("fallback") ? "fallback" : null;
  const unavailable = state === "unavailable";
  if (
    record.provider_role !== expectedRole
    || (unavailable
      ? record.fallback_depth !== null || record.source_as_of !== null || record.source_age_days !== null || record.selected_at !== null
      : !Number.isInteger(record.fallback_depth)
        || (expectedRole === "primary" && record.fallback_depth !== 0)
        || (expectedRole === "fallback" && (record.fallback_depth as number) < 1)
        || !isTimestamp(record.source_as_of)
        || !isTimestamp(record.selected_at)
        || !Number.isInteger(record.source_age_days)
        || (record.source_age_days as number) < 0)
    || (unavailable
      ? record.reason_code !== null || record.recovery_transition !== "unavailable"
      : typeof record.reason_code !== "string" || !record.reason_code || record.recovery_transition !== null)
    || !isSha256(record.projection_digest)
  ) return null;
  return record as unknown as EtfDataSupply;
}

export function getEtfDataSupplyPresentation(dataSupply: EtfDataSupply | null): EtfDataSupplyPresentation {
  if (!dataSupply || dataSupply.resolution_state === "fresh_primary") {
    return { label: null, description: null, sourceDate: dataSupply?.source_as_of ?? null, ageDays: dataSupply?.source_age_days ?? null, degraded: false };
  }
  if (dataSupply.resolution_state === "fresh_fallback") {
    return {
      label: "보조 공급원 최신값",
      description: "주 공급원 대신 검증된 보조 공급원의 최신값을 표시합니다.",
      sourceDate: dataSupply.source_as_of,
      ageDays: dataSupply.source_age_days,
      degraded: true,
    };
  }
  if (dataSupply.resolution_state === "unavailable") {
    return {
      label: "세부 데이터 일시 이용 불가",
      description: "검증된 ETF 세부 값이 없어 독립 요약만 표시하거나 빈 상태로 안내합니다.",
      sourceDate: null,
      ageDays: null,
      degraded: true,
    };
  }
  return {
    label: "마지막 확인값",
    description: "현재 공급원이 지연되어 마지막으로 검증된 값을 원래 기준일과 함께 표시합니다.",
    sourceDate: dataSupply.source_as_of,
    ageDays: dataSupply.source_age_days,
    degraded: true,
  };
}

export async function parseEtfApiResponse<T>(response: Response): Promise<EtfApiResult<T>> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    return { kind: "failed", data: null, dataSupply: null };
  }
  const record = asRecord(payload);
  const dataSupply = parseEtfDataSupply(record?.data_supply);
  if (response.status === 503 && record?.error === "DATA_SUPPLY_UNAVAILABLE" && dataSupply?.resolution_state === "unavailable") {
    return { kind: "unavailable", data: null, dataSupply };
  }
  if (!response.ok) {
    return response.status === 404
      ? { kind: "missing", data: null, dataSupply: null }
      : { kind: "failed", data: null, dataSupply: null };
  }
  if (!record) return { kind: "failed", data: null, dataSupply: null };
  return { kind: "ok", data: record as T, dataSupply };
}

export function isLegacyEtfDetailCompatibilityActive(
  now = new Date(),
  expiresAt: string | null = ETF_DETAIL_COMPAT_EXPIRES_AT,
): boolean {
  if (!expiresAt) return false;
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && now.getTime() < expiry;
}
