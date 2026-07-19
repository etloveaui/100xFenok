import { formatCurrencyCompact, formatDecimal, formatInteger } from "@/lib/format";

export const CP_SCREENER_ROW_TARGET = 1173;

export const CP_SCREENER_NUMERIC_FIELDS = [
  "price",
  "marketCap",
  "per",
  "pbr",
  "return12m",
  "roe",
  "opm",
  "momentum3m",
  "fenokEdge",
  "rank",
] as const;

export type CpScreenerDensity = "compact" | "default" | "comfy";
export type CpScreenerNumericField = (typeof CP_SCREENER_NUMERIC_FIELDS)[number];

export type CpScreenerRow = {
  id: string;
  ticker: string;
  name: string;
  sector: string;
  country: string;
  price: number | null;
  marketCap: number | null;
  per: number | null;
  pbr: number | null;
  return12m: number | null;
  roe: number | null;
  opm: number | null;
  momentum3m: number | null;
  fenokEdge: number | null;
  rank: number | null;
  fixtureKind: "source" | "shadow";
};

export type CpScreenerFixture = {
  rows: CpScreenerRow[];
  sourceCount: number;
  shadowCount: number;
  targetCount: number;
};

type StockAnalyzerFixtureRecord = {
  symbol?: unknown;
  companyName?: unknown;
  sector?: unknown;
  country?: unknown;
  price?: unknown;
  marketCap?: unknown;
  per?: unknown;
  pbr?: unknown;
  return12m?: unknown;
  roe?: unknown;
  opm?: unknown;
  momentum3m?: unknown;
  actionScore?: unknown;
  rank?: unknown;
};

type StockAnalyzerPayload = {
  count?: unknown;
  data?: StockAnalyzerFixtureRecord[];
};

export const CP_SCREENER_DENSITY_ROWS: Record<CpScreenerDensity, number> = {
  compact: 32,
  default: 40,
  comfy: 48,
};

export const CP_SCREENER_DENSITY_LABEL: Record<CpScreenerDensity, string> = {
  compact: "32px",
  default: "40px",
  comfy: "48px",
};

export function cpClassNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function withNudge(value: number | null, index: number, scale = 1): number | null {
  if (value === null) return null;
  const direction = index % 2 === 0 ? 1 : -1;
  return value * (1 + direction * scale * ((index % 7) + 1) * 0.002);
}

function mapRecord(record: StockAnalyzerFixtureRecord, index: number): CpScreenerRow {
  const ticker = toText(record.symbol, `SRC${index + 1}`);
  return {
    id: `source-${ticker}`,
    ticker,
    name: toText(record.companyName, ticker),
    sector: toText(record.sector, "미분류"),
    country: toText(record.country, "XX"),
    price: toFiniteNumber(record.price),
    marketCap: toFiniteNumber(record.marketCap),
    per: toFiniteNumber(record.per),
    pbr: toFiniteNumber(record.pbr),
    return12m: toFiniteNumber(record.return12m),
    roe: toFiniteNumber(record.roe),
    opm: toFiniteNumber(record.opm),
    momentum3m: toFiniteNumber(record.momentum3m),
    fenokEdge: toFiniteNumber(record.actionScore),
    rank: toFiniteNumber(record.rank),
    fixtureKind: "source",
  };
}

function makeShadowRow(row: CpScreenerRow, index: number): CpScreenerRow {
  const shadowIndex = index + 1;
  return {
    ...row,
    id: `shadow-${shadowIndex}-${row.ticker}`,
    ticker: `CP${String(shadowIndex).padStart(3, "0")}`,
    name: `${row.name} Canvas shadow`,
    price: withNudge(row.price, index),
    marketCap: withNudge(row.marketCap, index, 1.4),
    per: withNudge(row.per, index, 1.8),
    pbr: withNudge(row.pbr, index, 1.2),
    return12m: withNudge(row.return12m, index, 2.4),
    roe: withNudge(row.roe, index, 1.1),
    opm: withNudge(row.opm, index, 1.1),
    momentum3m: withNudge(row.momentum3m, index, 2.1),
    fenokEdge: row.fenokEdge === null ? null : Math.max(0, Math.min(100, row.fenokEdge + ((index % 9) - 4))),
    rank: row.rank === null ? CP_SCREENER_ROW_TARGET - index : row.rank + index + 1,
    fixtureKind: "shadow",
  };
}

export async function loadCpScreenerFixture(): Promise<CpScreenerFixture> {
  const response = await fetch("/data/global-scouter/core/stocks_analyzer.json", {
    cache: "force-cache",
  });
  if (!response.ok) {
    throw new Error(`stocks_analyzer fetch failed: ${response.status}`);
  }
  const payload = await response.json() as StockAnalyzerPayload;
  const sourceRows = Array.isArray(payload.data) ? payload.data.map(mapRecord) : [];
  const targetCount = CP_SCREENER_ROW_TARGET;
  const shadowNeeded = Math.max(0, targetCount - sourceRows.length);
  const shadowRows = sourceRows.slice(0, shadowNeeded).map(makeShadowRow);
  return {
    rows: [...sourceRows, ...shadowRows],
    sourceCount: sourceRows.length,
    shadowCount: shadowRows.length,
    targetCount,
  };
}

export function formatCompactMarketCap(value: number | null): string {
  return formatCurrencyCompact(value === null ? null : value * 1_000_000, "USD");
}

export function formatNumber(value: number | null, digits = 2): string {
  return formatDecimal(value, { digits });
}

export function formatPercent(value: number | null, digits = 1): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value * 100).toFixed(digits)}%`;
}

export function formatScore(value: number | null): string {
  return formatInteger(value);
}

export function numericTone(value: number | null): "positive" | "negative" | "neutral" {
  if (value === null || value === 0) return "neutral";
  return value > 0 ? "positive" : "negative";
}
