import { getCloudflareContext } from "@opennextjs/cloudflare";

export const DATA_SUPPLY_UNAVAILABLE_DATASET = "fenok_data_supply_unavailable";
export const DATA_SUPPLY_TELEMETRY_SCHEMA_VERSION = "data-supply-unavailable/v1";

type CacheStatus = "HIT" | "MISS" | "UNKNOWN";

interface AnalyticsEnginePoint {
  indexes: string[];
  blobs: string[];
  doubles: number[];
}

interface AnalyticsEngineDataset {
  writeDataPoint(point: AnalyticsEnginePoint): void;
}

interface TelemetryContext {
  env: {
    DATA_SUPPLY_ANALYTICS?: AnalyticsEngineDataset;
  };
  ctx: {
    waitUntil(promise: Promise<unknown>): void;
  };
}

type ContextResolver = () => TelemetryContext;

export interface TypedUnavailableTelemetryInput {
  ticker: string;
  cacheStatus: string | null;
  stateObservedAt: string;
  now?: Date;
}

function normalizeCacheStatus(value: string | null): CacheStatus {
  return value === "HIT" || value === "MISS" ? value : "UNKNOWN";
}

export function unavailableStateAgeHours(stateObservedAt: string, now = new Date()): number {
  const observedAt = Date.parse(stateObservedAt);
  if (!Number.isFinite(observedAt) || !Number.isFinite(now.getTime())) return 0;
  return Math.max(0, (now.getTime() - observedAt) / 3_600_000);
}

export function buildTypedUnavailableDataPoint(input: TypedUnavailableTelemetryInput): AnalyticsEnginePoint {
  const now = input.now ?? new Date();
  return {
    indexes: [input.ticker],
    blobs: [
      now.toISOString().slice(0, 10),
      input.ticker,
      "etf",
      "unavailable",
      normalizeCacheStatus(input.cacheStatus),
      DATA_SUPPLY_TELEMETRY_SCHEMA_VERSION,
    ],
    doubles: [unavailableStateAgeHours(input.stateObservedAt, now)],
  };
}

function defaultContextResolver(): TelemetryContext {
  return getCloudflareContext() as unknown as TelemetryContext;
}

export function recordTypedUnavailableResponse(
  input: TypedUnavailableTelemetryInput,
  resolveContext: ContextResolver = defaultContextResolver,
): void {
  try {
    const context = resolveContext();
    const dataset = context.env.DATA_SUPPLY_ANALYTICS;
    if (!dataset) return;

    const write = Promise.resolve()
      .then(() => dataset.writeDataPoint(buildTypedUnavailableDataPoint(input)))
      .catch(() => undefined);
    context.ctx.waitUntil(write);
  } catch {
    // Telemetry is strictly fail-open: context, binding, quota, and write failures
    // must never affect the typed-unavailable response path.
  }
}
