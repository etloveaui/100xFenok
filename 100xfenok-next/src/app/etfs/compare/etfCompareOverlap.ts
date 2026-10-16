import { normalizeForFilePath } from "@/lib/ticker";

export interface EtfHolding {
  rank?: number | null;
  symbol?: string | null;
  name?: string | null;
  weight_pct?: number | null;
  // Issuer exposure portfolios label their weights explicitly; such rows are not
  // portfolio market-value weights and must not be compared as if they were.
  weight_basis?: string | null;
}

export interface EtfPayload {
  ticker?: string;
  fetched_at?: string | null;
  detail_status?: string | null;
  normalized?: {
    holdings?: EtfHolding[];
    holding_count?: number | null;
    holdings_updated?: string | null;
    overview?: Record<string, unknown> | null;
    performance?: {
      tr1m?: number | null;
      trYTD?: number | null;
      tr1y?: number | null;
      cagr5y?: number | null;
      cagr10y?: number | null;
    } | null;
  } | null;
}

export interface EtfCompareRow {
  ticker: string;
  data: EtfPayload | null;
  failed: boolean;
}

export interface HoldingEntry {
  key: string;
  symbol: string;
  name: string;
  weight: number;
}

export type PairAvailability = "ready" | "unavailable";

export interface PairOverlap {
  left: EtfCompareRow;
  right: EtfCompareRow;
  common: Array<{
    key: string;
    symbol: string;
    name: string;
    leftWeight: number;
    rightWeight: number;
    minWeight: number;
  }>;
  overlapWeight: number | null;
  availability: PairAvailability;
}

export const MAX_COMPARE_TICKERS = 4;

export function cleanSymbol(value: string): string {
  return normalizeForFilePath(value);
}

export function parseTickers(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(/[\s,]+/)
    .map(cleanSymbol)
    .filter((symbol) => /^[A-Z][A-Z0-9.-]{0,7}$/.test(symbol))
    .filter((symbol) => {
      if (seen.has(symbol)) return false;
      seen.add(symbol);
      return true;
    })
    .slice(0, MAX_COMPARE_TICKERS);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function holdingKey(holding: EtfHolding): string | null {
  const symbol = typeof holding.symbol === "string" ? cleanSymbol(holding.symbol) : "";
  if (/^[A-Z][A-Z0-9.-]{0,7}$/.test(symbol)) return `S:${symbol}`;
  const name = typeof holding.name === "string" ? holding.name.trim().toUpperCase() : "";
  if (!name || name === "—" || name.includes("CASH") || name.includes("TREASURY")) return null;
  return `N:${name.replace(/\s+/g, " ").slice(0, 80)}`;
}

/**
 * Collapse duplicate keys into one exposure per key. A fund can publish several
 * rows with the same key (for example eight same-name swap legs); keeping only
 * the last row in a Map made the overlap depend on row order and under-counted
 * the exposure of the repeated legs.
 */
function aggregateEntries(entries: HoldingEntry[]): Map<string, HoldingEntry> {
  const aggregated = new Map<string, HoldingEntry>();
  for (const entry of entries) {
    const existing = aggregated.get(entry.key);
    aggregated.set(
      entry.key,
      existing ? { ...existing, weight: existing.weight + entry.weight } : { ...entry },
    );
  }
  return aggregated;
}

export function holdingEntries(row: EtfCompareRow): HoldingEntry[] {
  const holdings = Array.isArray(row.data?.normalized?.holdings) ? row.data.normalized.holdings : [];
  return holdings.slice(0, 25).flatMap((holding) => {
    const key = holdingKey(holding);
    const weight = isFiniteNumber(holding.weight_pct) ? holding.weight_pct : null;
    if (!key || weight === null || weight < 0) return [];
    const symbol = typeof holding.symbol === "string" && holding.symbol.trim() ? cleanSymbol(holding.symbol) : "—";
    return [{
      key,
      symbol,
      name: typeof holding.name === "string" && holding.name.trim() ? holding.name.trim() : symbol,
      weight,
    }];
  });
}

/**
 * True when a fund publishes signed provider weights (issuer exposure or issuer
 * portfolio weights) rather than positive-only market-value weights. Ordinary
 * overlap math drops negative rows and min()-es positives, which is not defined
 * for these bases, so such a pair uses the existing unavailable outcome.
 */
export const SIGNED_PROVIDER_WEIGHT_BASES = ["provider_exposure_signed", "provider_portfolio_weight_signed"];

export function hasExposureBasis(row: EtfCompareRow): boolean {
  const holdings = Array.isArray(row.data?.normalized?.holdings) ? row.data.normalized.holdings : [];
  return holdings.some((holding) =>
    typeof holding?.weight_basis === "string" && SIGNED_PROVIDER_WEIGHT_BASES.includes(holding.weight_basis));
}

export function overlapFor(left: EtfCompareRow, right: EtfCompareRow): PairOverlap {
  const leftEntries = holdingEntries(left);
  const rightEntries = holdingEntries(right);
  // Exposure and portfolio weights are different measures, so a pair that
  // involves either uses the existing unavailable outcome instead of comparing
  // them or reporting a misleading zero.
  const exposurePair = hasExposureBasis(left) || hasExposureBasis(right);
  const unavailable = exposurePair || left.failed || right.failed
    || leftEntries.length === 0 || rightEntries.length === 0;
  if (unavailable) {
    return {
      left,
      right,
      common: [],
      overlapWeight: null,
      availability: "unavailable",
    };
  }

  const leftMap = aggregateEntries(leftEntries);
  const common = [...aggregateEntries(rightEntries).values()]
    .flatMap((rightEntry) => {
      const leftEntry = leftMap.get(rightEntry.key);
      if (!leftEntry) return [];
      const minWeight = Math.min(Math.max(leftEntry.weight, 0), Math.max(rightEntry.weight, 0));
      return [{
        key: rightEntry.key,
        symbol: leftEntry.symbol !== "—" ? leftEntry.symbol : rightEntry.symbol,
        name: leftEntry.name !== "—" ? leftEntry.name : rightEntry.name,
        leftWeight: leftEntry.weight,
        rightWeight: rightEntry.weight,
        minWeight,
      }];
    })
    .sort((a, b) => b.minWeight - a.minWeight);

  return {
    left,
    right,
    common,
    overlapWeight: common.reduce((sum, item) => sum + item.minWeight, 0),
    availability: "ready",
  };
}

export function pairOverlaps(rows: EtfCompareRow[]): PairOverlap[] {
  const pairs: PairOverlap[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const left = rows[i];
      const right = rows[j];
      if (left && right) pairs.push(overlapFor(left, right));
    }
  }
  return pairs;
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCompareCsv(rows: EtfCompareRow[], overlaps: PairOverlap[] = pairOverlaps(rows)): string {
  const header = [
    "section",
    "ticker",
    "left_ticker",
    "right_ticker",
    "symbol",
    "name",
    "left_weight_pct",
    "right_weight_pct",
    "overlap_weight_pct",
    "holdings_as_of",
    "detail_status",
    "availability",
  ];
  const summaryRows = rows.map((row) => [
    "summary",
    row.ticker,
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    row.data?.normalized?.holdings_updated ?? "",
    row.data?.detail_status ?? "",
    "",
  ]);
  const overlapRows = overlaps.flatMap<(string | number | null)[]>((pair) => {
    if (pair.availability === "unavailable") {
      return [[
        "overlap",
        "",
        pair.left.ticker,
        pair.right.ticker,
        "",
        "",
        "",
        "",
        null,
        "",
        "",
        pair.availability,
      ]];
    }
    if (pair.common.length === 0) {
      return [[
        "overlap",
        "",
        pair.left.ticker,
        pair.right.ticker,
        "",
        "",
        "",
        "",
        0,
        "",
        "",
        pair.availability,
      ]];
    }
    return pair.common.map((item) => [
      "overlap",
      "",
      pair.left.ticker,
      pair.right.ticker,
      item.symbol,
      item.name,
      item.leftWeight,
      item.rightWeight,
      item.minWeight,
      "",
      "",
      pair.availability,
    ]);
  });
  return [header, ...summaryRows, ...overlapRows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}
