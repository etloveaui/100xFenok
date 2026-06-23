export interface EtfHolding {
  rank?: number | null;
  symbol?: string | null;
  name?: string | null;
  weight_pct?: number | null;
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
  overlapWeight: number;
}

export const MAX_COMPARE_TICKERS = 4;

export function cleanSymbol(value: string): string {
  return value.replace(/^\$/, "").trim().toUpperCase();
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

export function holdingEntries(row: EtfCompareRow): HoldingEntry[] {
  const holdings = Array.isArray(row.data?.normalized?.holdings) ? row.data.normalized.holdings : [];
  return holdings.slice(0, 25).flatMap((holding) => {
    const key = holdingKey(holding);
    const weight = isFiniteNumber(holding.weight_pct) ? holding.weight_pct : null;
    if (!key || weight === null) return [];
    const symbol = typeof holding.symbol === "string" && holding.symbol.trim() ? cleanSymbol(holding.symbol) : "—";
    return [{
      key,
      symbol,
      name: typeof holding.name === "string" && holding.name.trim() ? holding.name.trim() : symbol,
      weight,
    }];
  });
}

export function overlapFor(left: EtfCompareRow, right: EtfCompareRow): PairOverlap {
  const leftMap = new Map(holdingEntries(left).map((entry) => [entry.key, entry]));
  const rightEntries = holdingEntries(right);
  const common = rightEntries
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
