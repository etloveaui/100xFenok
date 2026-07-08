// Lazy data loaders for /market-valuation models (FORGE Slice A0b).
//
// First paint should use summary artifacts. Full raw depth remains reachable via
// loadRaw/loadRawSeries so adapters can satisfy the zero-dormant mandate without
// eagerly pulling multi-MB raw files into the ledger page.

import { buildCoverage, registerCoverage } from "./coverage";
import type {
  CoverageEntry,
  CoverageRegistry,
  DownsamplePolicy,
  ModelLoaders,
  SeriesPoint,
  Surface,
} from "./types";

const DATA_ROOT = "/data/";
const DEFAULT_TIMEOUT_MS = 4000;
const CNN_COMPONENT_KEYS = [
  "market_momentum",
  "stock_strength",
  "stock_breadth",
  "put_call",
  "volatility",
  "safe_haven",
  "junk_bond",
] as const;

type JsonRecord = Record<string, unknown>;

type CountSelector = (payload: unknown) => number;
type SeriesSelector = (payload: unknown) => SeriesPoint[];

export interface MarketSourceConfig {
  id: string;
  source: string;
  rawSource?: string;
  surface: Surface;
  downsamplePolicy: DownsamplePolicy;
  previewVisibleCount?: number;
  selectDefaultSeries?: SeriesSelector;
  selectRawSeries?: SeriesSelector;
  countDefault?: CountSelector;
  countAvailable?: CountSelector;
}

const marketStructureSummary = "computed/market_structure_index.json";

export const MARKET_SOURCES = {
  marketStructureSummary: {
    id: "marketStructureSummary",
    source: marketStructureSummary,
    surface: "ledger-default",
    downsamplePolicy: "aggregated",
    selectDefaultSeries: () => [],
    countDefault: countMarketStructureSourceFiles,
    countAvailable: countMarketStructureSourceFiles,
  },
  tga: {
    id: "tga",
    source: `${marketStructureSummary}#liquidity.tga`,
    rawSource: "macro/tga.json",
    surface: "route",
    downsamplePolicy: "trend-sampled",
    selectDefaultSeries: (payload) => selectLiquidityTrend(payload, "tga"),
  },
  stablecoins: {
    id: "stablecoins",
    source: `${marketStructureSummary}#liquidity.stablecoins`,
    rawSource: "macro/stablecoins.json",
    surface: "route",
    downsamplePolicy: "trend-sampled",
    selectDefaultSeries: (payload) => selectLiquidityTrend(payload, "stablecoins"),
  },
  aaii: {
    id: "aaii",
    source: `${marketStructureSummary}#aaii.trend`,
    rawSource: "sentiment/aaii.json",
    surface: "route",
    downsamplePolicy: "trend-sampled",
    selectDefaultSeries: (payload) => toSeriesPoints(asRecord(payload)?.aaii, "trend"),
  },
  cnnComponents: {
    id: "cnnComponents",
    source: `${marketStructureSummary}#sentimentComponents.components`,
    rawSource: "sentiment/cnn-components.json",
    surface: "route",
    downsamplePolicy: "trend-sampled",
    selectDefaultSeries: selectCnnComponentSummarySeries,
    selectRawSeries: selectCnnComponentRawSeries,
    countAvailable: countCnnComponentObservations,
  },
  activitySurveys: {
    id: "activitySurveys",
    source: "macro/activity-surveys.json",
    surface: "ledger-default",
    downsamplePolicy: "none",
    countDefault: countActivityRecords,
    countAvailable: countActivityRecords,
  },
  yardeniModel: {
    id: "yardeniModel",
    source: "yardney/yardney_model.json",
    surface: "ledger-default",
    downsamplePolicy: "none",
    selectDefaultSeries: selectYardeniSeries,
  },
  sp500AnnualReturns: {
    id: "sp500AnnualReturns",
    source: "slickcharts/sp500-returns.json",
    surface: "drawer",
    downsamplePolicy: "none",
    selectDefaultSeries: (payload) => toSeriesPoints(payload, "returns"),
  },
} satisfies Record<string, MarketSourceConfig>;

export type MarketSourceId = keyof typeof MARKET_SOURCES;

const fetchCache = new Map<string, Promise<unknown | null>>();

export function dataUrl(path: string): string {
  const trimmed = path.trim().split("#", 1)[0]?.replace(/^\/+/, "") ?? "";
  if (trimmed.startsWith("data/")) return `/${trimmed}`;
  return `${DATA_ROOT}${trimmed}`;
}

async function fetchData(path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown | null> {
  const url = dataUrl(path);
  const cached = fetchCache.get(url);
  if (cached) return cached;

  const promise = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return null;
      return (await response.json()) as unknown;
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  })();

  fetchCache.set(url, promise);
  return promise;
}

export async function loadSummary<T = unknown>(source: string): Promise<T | null> {
  return (await fetchData(source)) as T | null;
}

export async function loadRaw<T = unknown>(rawSource: string): Promise<T | null> {
  return (await fetchData(rawSource)) as T | null;
}

export const marketModelLoaders: ModelLoaders = {
  loadSummary,
  loadRaw,
};

export async function loadSummarySeries(sourceId: MarketSourceId): Promise<SeriesPoint[]> {
  const config: MarketSourceConfig = MARKET_SOURCES[sourceId];
  const payload = await loadSummary(config.source);
  return selectDefaultSeries(config, payload);
}

export async function loadRawSeries(sourceId: MarketSourceId): Promise<SeriesPoint[]> {
  const config: MarketSourceConfig = MARKET_SOURCES[sourceId];
  const payload = config.rawSource ? await loadRaw(config.rawSource) : await loadSummary(config.source);
  return selectRawSeries(config, payload);
}

export async function buildCoverageEntry(sourceId: MarketSourceId, nowIso?: string): Promise<CoverageEntry | null> {
  const config: MarketSourceConfig = MARKET_SOURCES[sourceId];
  const summary = await loadSummary(config.source);
  if (!summary) return null;

  const raw = config.rawSource ? await loadRaw(config.rawSource) : summary;
  if (!raw) return null;

  const defaultVisibleCount = countDefault(config, summary);
  const availableCount = countAvailable(config, raw);

  return buildCoverage({
    source: config.source,
    rawSource: config.rawSource,
    availableCount,
    reachableCount: availableCount,
    defaultVisibleCount,
    previewVisibleCount: config.previewVisibleCount,
    downsamplePolicy: config.downsamplePolicy,
    surface: config.surface,
    nowIso,
  });
}

export async function buildCoverageRegistry(sourceIds: MarketSourceId[] = Object.keys(MARKET_SOURCES) as MarketSourceId[]): Promise<CoverageRegistry> {
  const entries = await Promise.all(sourceIds.map((sourceId) => buildCoverageEntry(sourceId)));
  return entries.reduce<CoverageRegistry>((registry, entry) => {
    if (!entry) return registry;
    return registerCoverage(registry, entry);
  }, {});
}

export function sortSeriesByDate(points: SeriesPoint[]): SeriesPoint[] {
  return [...points].sort((a, b) => a.date.localeCompare(b.date));
}

export function latestSeriesPoint(points: SeriesPoint[]): SeriesPoint | null {
  const sorted = sortSeriesByDate(points);
  return sorted[sorted.length - 1] ?? null;
}

function selectDefaultSeries(config: MarketSourceConfig, payload: unknown): SeriesPoint[] {
  if (config.selectDefaultSeries) return sortSeriesByDate(config.selectDefaultSeries(payload));
  return sortSeriesByDate(toSeriesPoints(payload));
}

function selectRawSeries(config: MarketSourceConfig, payload: unknown): SeriesPoint[] {
  if (config.selectRawSeries) return sortSeriesByDate(config.selectRawSeries(payload));
  return sortSeriesByDate(toSeriesPoints(payload));
}

function countDefault(config: MarketSourceConfig, payload: unknown): number {
  if (config.countDefault) return config.countDefault(payload);
  return selectDefaultSeries(config, payload).length;
}

function countAvailable(config: MarketSourceConfig, payload: unknown): number {
  if (config.countAvailable) return config.countAvailable(payload);
  return selectRawSeries(config, payload).length;
}

function selectLiquidityTrend(payload: unknown, id: string): SeriesPoint[] {
  const rows = asArray(asRecord(payload)?.liquidity);
  const item = rows.map(asRecord).find((row) => row?.id === id);
  return toSeriesPoints(item, "trend");
}

function selectCnnComponentSummarySeries(payload: unknown): SeriesPoint[] {
  const components = asArray(asRecord(asRecord(payload)?.sentimentComponents)?.components).map(asRecord);
  return sortSeriesByDate(
    components.flatMap((component) => {
      const id = typeof component?.id === "string" ? component.id : "component";
      return toSeriesPoints(component, "trend").map((point) => ({
        ...point,
        component: id,
      }));
    }),
  );
}

function selectCnnComponentRawSeries(payload: unknown): SeriesPoint[] {
  return sortSeriesByDate(
    asArray(payload).flatMap((row) => {
      const record = asRecord(row);
      if (!record) return [];
      const date = dateFrom(record);
      if (!date) return [];
      return CNN_COMPONENT_KEYS.flatMap((component) => {
        const value = record[component];
        return typeof value === "number" && Number.isFinite(value)
          ? [{ date, value, component }]
          : [];
      });
    }),
  );
}

function selectYardeniSeries(payload: unknown): SeriesPoint[] {
  return asArray(asRecord(payload)?.data)
    .map(asRecord)
    .map((record) => {
      if (!record) return null;
      const date = dateFrom(record);
      const spx = record.spx;
      if (!date || typeof spx !== "number" || !Number.isFinite(spx)) return null;
      const point: SeriesPoint = { date, value: spx };
      for (const key of [
        "spx",
        "fair_value",
        "premium_pct",
        "eps",
        "bond_per",
      ] as const) {
        const value = record[key];
        if (typeof value === "number" && Number.isFinite(value)) point[key] = value;
      }
      return point;
    })
    .filter((point): point is SeriesPoint => point !== null);
}

function countActivityRecords(payload: unknown): number {
  const datasets = asRecord(asRecord(payload)?.datasets);
  if (!datasets) return 0;
  return Object.values(datasets).reduce<number>((sum, dataset) => sum + asArray(asRecord(dataset)?.records).length, 0);
}

function countMarketStructureSourceFiles(payload: unknown): number {
  return asArray(asRecord(payload)?.source_files).length;
}

function countCnnComponentObservations(payload: unknown): number {
  return toSeriesPoints(payload).reduce((sum, point) => {
    const componentCount = CNN_COMPONENT_KEYS.filter((key) => typeof point[key] === "number").length;
    return sum + Math.max(1, componentCount);
  }, 0);
}

function toSeriesPoints(payload: unknown, seriesKey?: string): SeriesPoint[] {
  const target = seriesKey ? asRecord(payload)?.[seriesKey] : payload;
  if (Array.isArray(target)) return target.map(toSeriesPoint).filter((point): point is SeriesPoint => point !== null);

  const record = asRecord(target);
  if (!record) return [];
  for (const key of ["series", "records", "returns", "data", "trend"] as const) {
    const rows = record[key];
    if (Array.isArray(rows)) return rows.map(toSeriesPoint).filter((point): point is SeriesPoint => point !== null);
  }
  return [];
}

function toSeriesPoint(row: unknown): SeriesPoint | null {
  const record = asRecord(row);
  if (!record) return null;

  const date = dateFrom(record);
  const value = primaryValue(record);
  if (!date || value === null) return null;

  const point: SeriesPoint = { date, value };
  for (const [key, rawValue] of Object.entries(record)) {
    if (rawValue === undefined || rawValue === null) continue;
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) point[key] = rawValue;
    if (typeof rawValue === "string") point[key] = rawValue;
  }
  return point;
}

function dateFrom(record: JsonRecord): string | null {
  const direct = record.date ?? record.period ?? record.record_date;
  if (typeof direct === "string" && direct.length > 0) return direct;
  if (typeof record.year === "number") return `${record.year}-12-31`;
  if (typeof record.year === "string" && record.year.length > 0) return `${record.year}-12-31`;
  return null;
}

function primaryValue(record: JsonRecord): number | null {
  for (const key of ["value", "val", "score", "return", "net"] as const) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }

  if (typeof record.bullish === "number" && typeof record.bearish === "number") {
    return record.bullish - record.bearish;
  }

  const numericValues = Object.values(record).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (numericValues.length === 0) return null;
  return numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
