// Shared data loader + aggregation for the /etfs CANVAS+ W5 route.
// Fetches the same two surfaces the legacy panels used (etf-universe, etf-snapshot)
// once per page load and derives the hero verdict + Tier 2/3 inputs from real fields
// only (see docs brief `_tmp/w5-briefs/brief-etfs.md` section G for the data-reality check).

import {
  cleanCategory,
  expenseRatioValue,
  isInverseEtf,
  isLeveragedEtf,
  isSingleStockLeveragedEtf,
  issuerNameFromEtfName,
  type EtfUniverseRecord,
} from "@/app/explore/etfUniverseUtils";

export type { EtfUniverseRecord } from "@/app/explore/etfUniverseUtils";

interface EtfUniverseDoc {
  generated_at?: string | null;
  screener_fetched_at?: string | null;
  counts?: {
    records?: number | null;
    etf_universe?: number | null;
    etf_screener?: number | null;
    screener_only?: number | null;
  } | null;
  records?: EtfUniverseRecord[];
}

export interface EtfScreenerLeaderRow {
  s?: string;
  n?: string;
  assetClass?: string;
  aum?: number;
  price?: number;
  change?: number;
  volume?: number;
  holdings?: number;
}

interface EtfNewRow {
  s?: string;
  n?: string;
  inceptionDate?: string;
  price?: number;
  change?: number;
}

interface EtfBitcoinRow {
  symbol?: string;
}

interface EtfSnapshotDoc {
  newEtfs?: {
    fetched_at?: string | null;
    counts?: { records?: number | null; rows?: number | null } | null;
    records?: EtfNewRow[];
  } | null;
  screener?: {
    fetched_at?: string | null;
    volumeLeaders?: EtfScreenerLeaderRow[];
    changeLeaders?: EtfScreenerLeaderRow[];
  } | null;
  bitcoin?: {
    fetched_at?: string | null;
    records?: EtfBitcoinRow[];
  } | null;
}

let universeCache: EtfUniverseDoc | null = null;
let universePending: Promise<EtfUniverseDoc | null> | null = null;
let snapshotCache: EtfSnapshotDoc | null = null;
let snapshotPending: Promise<EtfSnapshotDoc | null> | null = null;

function fetchJson<T>(url: string): Promise<T | null> {
  return fetch(url, { cache: "no-store" })
    .then((res) => (res.ok ? (res.json() as Promise<T>) : null))
    .catch(() => null);
}

export function loadEtfUniverse(): Promise<EtfUniverseDoc | null> {
  if (universeCache) return Promise.resolve(universeCache);
  if (universePending) return universePending;
  universePending = fetchJson<EtfUniverseDoc>("/api/data/stockanalysis/etf-universe").then((doc) => {
    universeCache = doc;
    universePending = null;
    return doc;
  });
  return universePending;
}

export function loadEtfSnapshot(): Promise<EtfSnapshotDoc | null> {
  if (snapshotCache) return Promise.resolve(snapshotCache);
  if (snapshotPending) return snapshotPending;
  snapshotPending = fetchJson<EtfSnapshotDoc>("/api/data/stockanalysis/etf-snapshot").then((doc) => {
    snapshotCache = doc;
    snapshotPending = null;
    return doc;
  });
  return snapshotPending;
}

export function clearEtfSurfaceCaches() {
  universeCache = null;
  universePending = null;
  snapshotCache = null;
  snapshotPending = null;
}

export function normalizeUniverseRows(doc: EtfUniverseDoc | null, snapshot: EtfSnapshotDoc | null): EtfUniverseRecord[] {
  const byTicker = new Map<string, EtfUniverseRecord>();
  const sourceRows = Array.isArray(doc?.records) ? doc.records : [];
  for (const row of sourceRows) {
    if (typeof row.ticker !== "string" || !row.ticker.trim()) continue;
    const ticker = row.ticker.trim().toUpperCase();
    byTicker.set(ticker, {
      ...row,
      ticker,
      name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : ticker,
      category: cleanCategory(row.category ?? row.assetClass),
      assetClass: cleanCategory(row.assetClass),
      issuer: issuerNameFromEtfName(row.issuer ?? row.name ?? row.ticker),
    });
  }
  for (const row of snapshot?.newEtfs?.records ?? []) {
    if (typeof row.s !== "string" || !row.s.trim()) continue;
    const ticker = row.s.trim().toUpperCase();
    const existing = byTicker.get(ticker);
    byTicker.set(ticker, {
      ...(existing ?? { ticker, name: row.n?.trim() || ticker, category: "신규 상장" }),
      ticker,
      name: existing?.name ?? (row.n?.trim() || ticker),
      category: existing?.category ?? "신규 상장",
      assetClass: existing?.assetClass ?? "미분류",
      issuer: existing?.issuer ?? issuerNameFromEtfName(row.n ?? ticker),
      inceptionDate: row.inceptionDate,
      price: row.price,
      change: row.change,
      is_new: true,
    });
  }
  return [...byTicker.values()];
}

export type EtfCompositionBucketKey = "equity" | "fixedIncome" | "commodity" | "digital" | "other";

export interface EtfCompositionBucket {
  key: EtfCompositionBucketKey;
  label: string;
  count: number;
  pct: number;
}

export interface EtfInsights {
  totalCount: number;
  newCount: number;
  leverageInverseCount: number;
  leverageInversePct: number;
  compositionBuckets: EtfCompositionBucket[];
  dominantBucket: EtfCompositionBucket | null;
  topMoversCount: number;
  topMoversLeverageInverseCount: number;
  volumeLeadersTop3: EtfScreenerLeaderRow[];
  changeLeadersTop3: EtfScreenerLeaderRow[];
  asOf: string | null;
}

const BUCKET_LABELS: Record<EtfCompositionBucketKey, string> = {
  equity: "주식형",
  fixedIncome: "채권형",
  commodity: "원자재",
  digital: "디지털자산",
  other: "기타",
};

/**
 * Bucket priority: an ETF held in the bitcoin/digital-asset surface counts as
 * "digital" even if its raw `category` is Equity/Alternatives, so buckets stay
 * mutually exclusive and sum to the real universe count (no double counting).
 */
function bucketForRow(row: EtfUniverseRecord, digitalTickers: ReadonlySet<string>): EtfCompositionBucketKey {
  const ticker = (row.ticker ?? "").toUpperCase();
  if (digitalTickers.has(ticker)) return "digital";
  const category = row.category ?? row.assetClass;
  if (category === "Equity") return "equity";
  if (category === "Fixed Income") return "fixedIncome";
  if (category === "Commodity") return "commodity";
  return "other";
}

export function computeEtfInsights(
  rows: EtfUniverseRecord[],
  snapshot: EtfSnapshotDoc | null,
  universeGeneratedAt: string | null | undefined,
): EtfInsights {
  const digitalTickers = new Set(
    (snapshot?.bitcoin?.records ?? [])
      .map((row) => (typeof row.symbol === "string" ? row.symbol.trim().toUpperCase() : ""))
      .filter(Boolean),
  );

  const bucketCounts: Record<EtfCompositionBucketKey, number> = {
    equity: 0,
    fixedIncome: 0,
    commodity: 0,
    digital: 0,
    other: 0,
  };
  let leverageInverseCount = 0;
  for (const row of rows) {
    bucketCounts[bucketForRow(row, digitalTickers)] += 1;
    if (isLeveragedEtf(row) || isInverseEtf(row)) leverageInverseCount += 1;
  }

  const totalCount = rows.length || 1;
  const compositionBuckets: EtfCompositionBucket[] = (Object.keys(bucketCounts) as EtfCompositionBucketKey[])
    .map((key) => ({
      key,
      label: BUCKET_LABELS[key],
      count: bucketCounts[key],
      pct: Math.round((bucketCounts[key] / totalCount) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count);

  const volumeLeaders = snapshot?.screener?.volumeLeaders ?? [];
  const changeLeaders = snapshot?.screener?.changeLeaders ?? [];
  const classificationByTicker = new Map(rows.map((row) => [(row.ticker ?? "").toUpperCase(), row]));
  const topMoverTickers = new Set(
    [...volumeLeaders, ...changeLeaders]
      .map((row) => (typeof row.s === "string" ? row.s.trim().toUpperCase() : ""))
      .filter(Boolean),
  );
  let topMoversLeverageInverseCount = 0;
  for (const ticker of topMoverTickers) {
    const row = classificationByTicker.get(ticker);
    if (row && (isLeveragedEtf(row) || isInverseEtf(row))) topMoversLeverageInverseCount += 1;
  }

  const newCount = rows.filter((row) => row.is_new === true).length || (snapshot?.newEtfs?.counts?.records ?? 0);

  const asOfCandidates = [universeGeneratedAt, snapshot?.screener?.fetched_at, snapshot?.newEtfs?.fetched_at]
    .filter((value): value is string => typeof value === "string" && value.length >= 10)
    .sort();

  return {
    totalCount: rows.length,
    newCount,
    leverageInverseCount,
    leverageInversePct: Math.round((leverageInverseCount / totalCount) * 1000) / 10,
    compositionBuckets,
    dominantBucket: compositionBuckets[0] ?? null,
    topMoversCount: topMoverTickers.size,
    topMoversLeverageInverseCount,
    volumeLeadersTop3: volumeLeaders.slice(0, 3),
    changeLeadersTop3: changeLeaders.slice(0, 3),
    asOf: asOfCandidates[0] ?? null,
  };
}

export {
  cleanCategory,
  expenseRatioValue,
  isInverseEtf,
  isLeveragedEtf,
  isSingleStockLeveragedEtf,
  issuerNameFromEtfName,
};

export function fmtCompactNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("ko-KR") : "-";
}

export function fmtPriceUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value >= 100 ? `$${value.toFixed(0)}` : `$${value.toFixed(2)}`;
}

export function fmtSignedPct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function fmtVolumeCompact(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString("ko-KR");
}
