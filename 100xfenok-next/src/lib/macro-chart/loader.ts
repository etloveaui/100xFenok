"use client";

import type { MarketChartSeries } from "@/lib/market-valuation/charts/types";
import { alignMacroPoints, buildAlignedLabels, downsampleMacroPoints } from "./align";
import { applyMacroTransform, transformUnitLabel } from "./transforms";
import type {
  MacroRawPoint,
  MacroSeriesAccessor,
  MacroSeriesDefinition,
  MacroSeriesUnitKind,
  MacroValueTransform,
} from "./types";

type JsonRecord = Record<string, unknown>;
type StooqCacheRecord = { ts?: number; data?: MacroRawPoint[] };

const STOOQ_PROXY_BASE = "https://stooq-proxy.etloveaui.workers.dev";
const STOOQ_CACHE_TTL_MS = 86_400_000;
const STOOQ_INPUT_SYMBOL_PATTERN = /^[A-Za-z0-9.^-]{1,16}(?:\.[A-Za-z]{1,4})?$/;
const STOOQ_RESOLVED_SYMBOL_PATTERN = /^[a-z0-9.^-]{1,16}(?:\.[a-z]{1,4})?$/;

export interface LoadedMacroSeries {
  definition: MacroSeriesDefinition;
  transform: MacroValueTransform;
  rawPoints: MacroRawPoint[];
  transformedPoints: MacroRawPoint[];
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number | null {
  const next = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(next) ? next : null;
}

function sourceKind(definition: MacroSeriesDefinition) {
  return definition.sourceKind ?? "local-json";
}

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function toStooqSymbol(symbol: string): string | null {
  const raw = symbol.trim();
  if (!STOOQ_INPUT_SYMBOL_PATTERN.test(raw)) return null;
  if (raw.startsWith("^")) return raw.toLowerCase();
  if (/^[0-9]{6}\.KS$/i.test(raw)) return `${raw.slice(0, 6).toLowerCase()}.kr`;
  if (/\.[A-Za-z]{1,4}$/.test(raw)) return raw.toLowerCase();
  return `${raw.toLowerCase()}.us`;
}

function stooqProxyUrl(stooqSymbol: string) {
  const proxyBase = STOOQ_PROXY_BASE.endsWith("/") ? STOOQ_PROXY_BASE : `${STOOQ_PROXY_BASE}/`;
  const upstream = `https://stooq.com/q/d/l/?s=${stooqSymbol}&i=d`;
  return `${proxyBase}${encodeURIComponent(upstream)}`;
}

export function parseStooqDailyCsv(csv: string): MacroRawPoint[] {
  const lines = csv.trim().split(/\r?\n/);
  const [header, ...rows] = lines;
  if (!header || !header.toLowerCase().startsWith("date,")) throw new Error("Stooq CSV format");
  return rows
    .map((line) => {
      const fields = line.split(",");
      const date = fields[0]?.trim();
      const close = asNumber(fields[4]);
      if (!date || close === null) return null;
      return { date, value: close };
    })
    .filter((point): point is MacroRawPoint => point !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function readCachedStooqPoints(cacheKey: string): MacroRawPoint[] | null {
  const storage = browserStorage();
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(cacheKey) || "{}") as StooqCacheRecord;
    if (!parsed.ts || Date.now() - parsed.ts >= STOOQ_CACHE_TTL_MS || !Array.isArray(parsed.data)) return null;
    return parsed.data.filter((point): point is MacroRawPoint => {
      return Boolean(point && typeof point.date === "string" && typeof point.value === "number" && Number.isFinite(point.value));
    });
  } catch {
    return null;
  }
}

function writeCachedStooqPoints(cacheKey: string, data: readonly MacroRawPoint[]) {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // Storage is an opportunistic browser-local speedup, never a data contract.
  }
}

async function loadStooqRawPoints(definition: MacroSeriesDefinition): Promise<MacroRawPoint[]> {
  const symbol = definition.stooqSymbol ?? definition.sourcePath.replace(/^stooq:/, "") ?? definition.id;
  const stooqSymbol = toStooqSymbol(symbol);
  if (!stooqSymbol || !STOOQ_RESOLVED_SYMBOL_PATTERN.test(stooqSymbol)) throw new Error(`Invalid Stooq symbol: ${symbol}`);
  const cacheKey = `stooq_cache_${stooqSymbol}`;
  const cached = readCachedStooqPoints(cacheKey);
  if (cached) return cached;
  const response = await fetch(stooqProxyUrl(stooqSymbol));
  if (!response.ok) throw new Error(`Stooq proxy ${response.status}`);
  const points = parseStooqDailyCsv(await response.text());
  writeCachedStooqPoints(cacheKey, points);
  return points;
}

function rowsToPoints(rows: readonly unknown[], valueKey: string, dateKey = "date"): MacroRawPoint[] {
  return rows
    .map((row) => {
      const record = asRecord(row);
      const date = record[dateKey];
      const value = asNumber(record[valueKey]);
      if (typeof date !== "string" || value === null) return null;
      return { date, value };
    })
    .filter((point): point is MacroRawPoint => point !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function extractActivity(payload: unknown, accessor: Extract<MacroSeriesAccessor, { kind: "activity" }>) {
  const root = asRecord(payload);
  const datasets = asRecord(root.datasets);
  const dataset = asRecord(datasets[accessor.dataset]);
  const rows = asArray(dataset.records);
  return rowsToPoints(
    rows.map((row) => {
      const record = asRecord(row);
      const values = asRecord(record.values);
      return {
        date: record[accessor.dateKey ?? "date"],
        value: values[accessor.valueKey],
      };
    }),
    "value",
  );
}

function extractPoints(payload: unknown, accessor: MacroSeriesAccessor): MacroRawPoint[] {
  if (accessor.kind === "array") {
    return rowsToPoints(asArray(payload), accessor.valueKey, accessor.dateKey);
  }
  if (accessor.kind === "arrayDerived") {
    return rowsToPoints(
      asArray(payload).map((row) => {
        const record = asRecord(row);
        if (accessor.derive === "aaii_spread") {
          const bullish = asNumber(record.bullish);
          const bearish = asNumber(record.bearish);
          return {
            date: record[accessor.dateKey ?? "date"],
            value: bullish === null || bearish === null ? null : bullish - bearish,
          };
        }
        return row;
      }),
      "value",
    );
  }
  if (accessor.kind === "seriesObject") {
    const root = asRecord(payload);
    const series = asRecord(root.series);
    return rowsToPoints(asArray(series[accessor.seriesKey]), accessor.valueKey ?? "value", accessor.dateKey);
  }
  if (accessor.kind === "seriesArray") {
    const root = asRecord(payload);
    return rowsToPoints(asArray(root.series), accessor.valueKey ?? "value", accessor.dateKey);
  }
  if (accessor.kind === "dataArray") {
    const root = asRecord(payload);
    return rowsToPoints(asArray(root.data), accessor.valueKey ?? "value", accessor.dateKey);
  }
  return extractActivity(payload, accessor);
}

export async function loadMacroSeries(
  definitions: readonly MacroSeriesDefinition[],
  transforms: ReadonlyMap<string, MacroValueTransform>,
): Promise<LoadedMacroSeries[]> {
  const payloads = new Map<string, unknown>();
  await Promise.all(
    [...new Set(definitions.filter((definition) => sourceKind(definition) === "local-json").map((definition) => definition.sourcePath))].map(async (sourcePath) => {
      const response = await fetch(sourcePath, { cache: "force-cache" });
      if (!response.ok) throw new Error(`${sourcePath} ${response.status}`);
      payloads.set(sourcePath, await response.json());
    }),
  );

  return Promise.all(definitions.map(async (definition) => {
    const rawPoints =
      sourceKind(definition) === "stooq"
        ? await loadStooqRawPoints(definition)
        : extractPoints(payloads.get(definition.sourcePath), definition.accessor);
    const transform = transforms.get(definition.id) ?? definition.defaultTransform ?? "raw";
    const transformedPoints = downsampleMacroPoints(applyMacroTransform(rawPoints, transform, definition));
    return { definition, transform, rawPoints, transformedPoints };
  }));
}

export function unitLabel(unit: MacroSeriesUnitKind): string {
  if (unit === "percent") return "%";
  if (unit === "spread") return "spread";
  if (unit === "usd_billion") return "$B";
  if (unit === "usd_million") return "$M";
  if (unit === "usd") return "$";
  if (unit === "contracts") return "contracts";
  if (unit === "score") return "score";
  return "index";
}

export function buildMarketSeries(items: readonly LoadedMacroSeries[]): MarketChartSeries[] {
  const labels = buildAlignedLabels(items.map((item) => item.transformedPoints));
  const hasMixedRawUnits = new Set(
    items
      .filter((item) => item.transform === "raw")
      .map((item) => unitLabel(item.definition.unit)),
  ).size > 1;

  return items.map((item) => {
    const transformedUnit = transformUnitLabel(item.transform, unitLabel(item.definition.unit));
    const yAxisId =
      item.transform === "raw" && hasMixedRawUnits && (item.definition.unit === "percent" || item.definition.unit === "spread")
        ? "y1"
        : "y";
    return {
      id: item.definition.id,
      label: `${item.definition.shortLabel} · ${transformedUnit}`,
      colorToken: item.definition.colorToken,
      yAxisId,
      points: alignMacroPoints(item.transformedPoints, labels),
    };
  });
}
