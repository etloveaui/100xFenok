export type EtfResolutionState = "fresh_primary" | "fresh_fallback" | "lkg_primary" | "lkg_fallback" | "unavailable";

export interface EtfDataSupply {
  security_lifecycle?: {
    status: "closed" | "renamed";
    effective_date: string;
    successor_ticker: string | null;
    reason: string;
    primary_reference: string;
    last_source_as_of: string | null;
  };
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
  | { kind: "shard_infrastructure_unavailable"; data: null; dataSupply: null }
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

// Retained Yahoo selections predate the weighted-row/lowercase-history
// contract. Adapt their own captured values for display; never fetch a newer
// value, mutate the immutable object, or change its source/resolution clocks.
function yahooDetailForDisplay(record: Record<string, unknown>): Record<string, unknown> {
  if (record.schema_version !== "yf-etf-detail/v1") return record;
  const normalized = asRecord(record.normalized);
  if (!normalized) return record;
  const yahoo = asRecord(asRecord(record.raw)?.yf);
  const info = asRecord(yahoo?.info) ?? {};
  const fundOverview = asRecord(asRecord(yahoo?.funds_data)?.fund_overview);
  const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
  const weights = (value: unknown) => {
    const mapping = asRecord(value);
    return mapping ? Object.entries(mapping).filter(([, weight]) => finite(weight))
      .map(([key, weight]) => ({ key, value: (weight as number) * 100 })) : value;
  };
  const history = (value: unknown) => Array.isArray(value) ? value.map((value) => {
    const row = asRecord(value);
    if (!row) return value;
    const result = { ...row };
    for (const field of ["open", "high", "low", "close", "volume"]) {
      const legacy = row[field[0].toUpperCase() + field.slice(1)];
      if (!finite(result[field]) && finite(legacy)) result[field] = legacy;
    }
    return result;
  }) : value;
  const overview = { ...asRecord(normalized.overview) };
  for (const [field, providerField] of Object.entries({
    name: "longName", provider: "fundFamily", peRatio: "trailingPE",
    sharesOut: "sharesOutstanding", etf_website: "website",
  })) {
    const value = info[providerField] ?? (field === "name" ? info.shortName : field === "provider" ? fundOverview?.family : null);
    if (overview[field] == null && (finite(value) || typeof value === "string" && value.trim())) overview[field] = value;
  }
  const quote = { ...asRecord(normalized.quote) };
  for (const [field, providerField] of Object.entries({ h52: "fiftyTwoWeekHigh", l52: "fiftyTwoWeekLow" })) {
    if (!finite(quote[field]) && finite(info[providerField])) quote[field] = info[providerField];
  }
  const periods = asRecord(normalized.history_periods);
  return { ...record, normalized: {
    ...normalized, overview, quote,
    asset_allocation: weights(normalized.asset_allocation),
    sectors: weights(normalized.sectors),
    history: history(normalized.history),
    ...(periods ? { history_periods: Object.fromEntries(Object.entries(periods).map(([key, rows]) => [key, history(rows)])) } : {}),
  } };
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
        || record.fallback_depth !== (
          state === "fresh_primary" ? 0 : state === "lkg_fallback" ? 2 : 1
        )
        || !isTimestamp(record.source_as_of)
        || !isTimestamp(record.selected_at)
        || !Number.isInteger(record.source_age_days)
        || (record.source_age_days as number) < 0)
    || (unavailable
      ? record.reason_code !== null || record.recovery_transition !== "unavailable"
      : typeof record.reason_code !== "string" || !record.reason_code || record.recovery_transition !== null)
    || !isSha256(record.projection_digest)
  ) return null;
  if (record.security_lifecycle !== undefined) {
    const lifecycle = asRecord(record.security_lifecycle);
    if (!lifecycle || !["closed", "renamed"].includes(String(lifecycle.status))
      || !isTimestamp(lifecycle.effective_date)
      || typeof lifecycle.reason !== "string" || !lifecycle.reason
      || typeof lifecycle.primary_reference !== "string" || !lifecycle.primary_reference
      || (lifecycle.last_source_as_of !== null && !isTimestamp(lifecycle.last_source_as_of))
      || (lifecycle.status === "closed" ? lifecycle.successor_ticker !== null
        : typeof lifecycle.successor_ticker !== "string" || !/^[A-Z0-9][A-Z0-9.-]*$/.test(lifecycle.successor_ticker))) return null;
  }
  return record as unknown as EtfDataSupply;
}

export function getEtfDataSupplyPresentation(dataSupply: EtfDataSupply | null): EtfDataSupplyPresentation {
  if (dataSupply?.security_lifecycle) {
    const lifecycle = dataSupply.security_lifecycle;
    return {
      label: lifecycle.status === "renamed" ? "티커 변경" : "거래 종료",
      description: lifecycle.status === "renamed"
        ? `현재 티커는 ${lifecycle.successor_ticker}입니다.`
        : "공식 공시에 따라 거래가 종료된 종목입니다.",
      sourceDate: lifecycle.last_source_as_of,
      ageDays: null,
      degraded: true,
    };
  }
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

export async function parseEtfApiResponse<T>(
  response: Response,
  expectedTicker: string,
): Promise<EtfApiResult<T>> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    return { kind: "failed", data: null, dataSupply: null };
  }
  const record = asRecord(payload);
  const dataSupply = parseEtfDataSupply(record?.data_supply);
  if (response.status === 503 && record?.error === "STOCKANALYSIS_ETF_SHARD_UNAVAILABLE") {
    return { kind: "shard_infrastructure_unavailable", data: null, dataSupply: null };
  }
  if (response.status === 503 && record?.error === "DATA_SUPPLY_UNAVAILABLE" && dataSupply?.resolution_state === "unavailable") {
    return { kind: "unavailable", data: null, dataSupply };
  }
  if (response.status === 410 && record?.ticker === expectedTicker && dataSupply?.security_lifecycle
    && record.error === (dataSupply.security_lifecycle.status === "renamed"
      ? "DATA_SUPPLY_SECURITY_RENAMED" : "DATA_SUPPLY_SECURITY_CLOSED")) {
    return { kind: "unavailable", data: null, dataSupply };
  }
  if (!response.ok) {
    return response.status === 404
      ? { kind: "missing", data: null, dataSupply: null }
      : { kind: "failed", data: null, dataSupply: null };
  }
  if (
    !record
    || typeof record.error === "string"
    || record.asset_type !== "etf"
    || typeof record.ticker !== "string"
    || !record.ticker.trim()
    || record.ticker !== expectedTicker
  ) return { kind: "failed", data: null, dataSupply: null };
  return { kind: "ok", data: yahooDetailForDisplay(record) as T, dataSupply };
}

export function isLegacyEtfDetailCompatibilityActive(
  now = new Date(),
  expiresAt: string | null = ETF_DETAIL_COMPAT_EXPIRES_AT,
): boolean {
  if (!expiresAt) return false;
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && now.getTime() < expiry;
}
