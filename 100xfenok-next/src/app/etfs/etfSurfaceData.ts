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
import { formatCompactNumber, formatCurrency, formatInteger } from "@/lib/format";
import { formatAsOf, isStaleAsOf, latestAsOf } from "@/lib/data-state";
import { useEffect, useState } from "react";

export type { EtfUniverseRecord } from "@/app/explore/etfUniverseUtils";

export interface EtfUniverseDoc {
  generated_at?: string | null;
  /** latest producer fetch across the merged universe + screener inputs */
  fetched_at?: string | null;
  universe_generated_at?: string | null;
  screener_fetched_at?: string | null;
  source_as_of?: string | null;
  source_as_of_reason?: string | null;
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

export interface EtfSnapshotDoc {
  source_as_of?: string | null;
  source_as_of_reason?: string | null;
  // No top-level generated_at here on purpose: the snapshot route stamps
  // request time (new Date().toISOString()), which is a serving clock, not a
  // provider publication clock. Panels must use per-subfeed fetched_at below.
  newEtfs?: {
    fetched_at?: string | null;
    source_as_of?: string | null;
    source_as_of_reason?: string | null;
    counts?: { records?: number | null; rows?: number | null } | null;
    records?: EtfNewRow[];
  } | null;
  screener?: {
    fetched_at?: string | null;
    source_as_of?: string | null;
    source_as_of_reason?: string | null;
    volumeLeaders?: EtfScreenerLeaderRow[];
    changeLeaders?: EtfScreenerLeaderRow[];
  } | null;
  bitcoin?: {
    fetched_at?: string | null;
    source_as_of?: string | null;
    source_as_of_reason?: string | null;
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
  asOfReason: string | null;
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
  ignoredGenerationTimestamp: string | null | undefined,
): EtfInsights {
  // Kept only for the existing caller signature; generation time is never a source clock.
  void ignoredGenerationTimestamp;
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

  const sourceStamps: Array<{ label: string; asOf: string | null; reason: string | null }> = [];
  if (universeCache) {
    sourceStamps.push({
      label: "ETF universe",
      asOf: typeof universeCache.source_as_of === "string" && universeCache.source_as_of.length >= 10
        ? universeCache.source_as_of.slice(0, 10)
        : null,
      reason: universeCache.source_as_of_reason ?? null,
    });
  }
  const snapshotSources = [
    ["ETF screener", snapshot?.screener],
    ["new ETFs", snapshot?.newEtfs],
    ["digital-asset ETFs", snapshot?.bitcoin],
  ] as const;
  for (const [label, surface] of snapshotSources) {
    if (!surface) continue;
    const sourceAsOf = surface.source_as_of ?? snapshot?.source_as_of;
    sourceStamps.push({
      label,
      asOf: typeof sourceAsOf === "string" && sourceAsOf.length >= 10 ? sourceAsOf.slice(0, 10) : null,
      reason: surface.source_as_of_reason ?? snapshot?.source_as_of_reason ?? null,
    });
  }
  const missingSource = sourceStamps.find((source) => source.asOf === null);
  const sourceDates = sourceStamps
    .map((source) => source.asOf)
    .filter((value): value is string => value !== null)
    .sort();
  const sourceClock = missingSource || sourceStamps.length === 0
    ? {
        asOf: null,
        reason: missingSource
          ? `${missingSource.label}: ${missingSource.reason ?? "source date unavailable"}`
          : "source date unavailable",
      }
    : { asOf: sourceDates[0] ?? null, reason: null };

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
    asOf: sourceClock.asOf,
    asOfReason: sourceClock.reason,
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
  return formatInteger(value);
}

export function fmtPriceUsd(value: number | null | undefined): string {
  return formatCurrency(value, "USD");
}

export function fmtSignedPct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function fmtVolumeCompact(value: number | null | undefined): string {
  return formatCompactNumber(value);
}

export function digitalTickersFromSnapshot(snapshot: EtfSnapshotDoc | null): Set<string> {
  return new Set(
    (snapshot?.bitcoin?.records ?? [])
      .map((row) => (typeof row.symbol === "string" ? row.symbol.trim().toUpperCase() : ""))
      .filter(Boolean),
  );
}

export function etfUniverseAsOf(universe: EtfUniverseDoc | null): string | null {
  const asOf = universe?.source_as_of;
  return typeof asOf === "string" && asOf.length >= 10 ? asOf.slice(0, 10) : null;
}

export function etfSnapshotAsOf(snapshot: EtfSnapshotDoc | null): string | null {
  if (!snapshot) return null;
  return latestAsOf([
    snapshot.screener?.source_as_of ?? snapshot.source_as_of,
    snapshot.newEtfs?.source_as_of ?? snapshot.source_as_of,
    snapshot.bitcoin?.source_as_of ?? snapshot.source_as_of,
  ]);
}

export interface EtfSnapshotSubfeedClocks {
  screener: string | null;
  newEtfs: string | null;
  bitcoin: string | null;
}

function snapshotSubfeedDate(value: string | null | undefined, snapshot: EtfSnapshotDoc | null): string | null {
  const asOf = value ?? snapshot?.source_as_of;
  return typeof asOf === "string" && asOf.length >= 10 ? asOf.slice(0, 10) : null;
}

// Per-subfeed clocks: panels that display specific subfeeds must read their
// own dates here instead of the masked latest in etfSnapshotAsOf, so a fresh
// subfeed can never hide a stale displayed sibling.
export function etfSnapshotSubfeedClocks(snapshot: EtfSnapshotDoc | null): EtfSnapshotSubfeedClocks {
  return {
    screener: snapshotSubfeedDate(snapshot?.screener?.source_as_of, snapshot),
    newEtfs: snapshotSubfeedDate(snapshot?.newEtfs?.source_as_of, snapshot),
    bitcoin: snapshotSubfeedDate(snapshot?.bitcoin?.source_as_of, snapshot),
  };
}

// Publication clocks (fh-349): every ETF provider feed carries
// source_as_of=null ("provider publishes no aggregate source date"), so the
// most truthful available stamp is the producer fetch time. It is always
// labelled 게시 (published), never 기준 (observed).

function publishedStamp(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length >= 10 ? value : null;
}

export function etfUniversePublishedAt(universe: EtfUniverseDoc | null): string | null {
  if (!universe) return null;
  return latestAsOf([
    universe.fetched_at,
    universe.universe_generated_at,
    universe.generated_at,
    universe.screener_fetched_at,
  ]);
}

export interface EtfSnapshotPublishedClocks {
  screener: string | null;
  newEtfs: string | null;
  bitcoin: string | null;
}

export function etfSnapshotPublishedClocks(snapshot: EtfSnapshotDoc | null): EtfSnapshotPublishedClocks {
  return {
    screener: publishedStamp(snapshot?.screener?.fetched_at),
    newEtfs: publishedStamp(snapshot?.newEtfs?.fetched_at),
    bitcoin: publishedStamp(snapshot?.bitcoin?.fetched_at),
  };
}

function earliestStamp(values: Array<string | null | undefined>): string | null {
  const raws = values.filter((value): value is string => typeof value === "string" && value.length >= 10);
  if (raws.length === 0) return null;
  return [...raws].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0] ?? null;
}

/** Completeness floor over every displayed surface input (fh-349). */
export function etfSurfacePublishedFloor(
  universe: EtfUniverseDoc | null,
  snapshot: EtfSnapshotDoc | null,
): string | null {
  const sub = etfSnapshotPublishedClocks(snapshot);
  return earliestStamp([etfUniversePublishedAt(universe), sub.screener, sub.newEtfs, sub.bitcoin]);
}

export type EtfClockKind = "observed" | "published" | "unknown";

/**
 * Resolve which clock a rail label shows: provider observation date wins;
 * otherwise the producer publication time (labelled 게시 downstream); else
 * unknown ("제공자 미공개" downstream).
 */
export function etfClockKind(observed: string | null, published: string | null): EtfClockKind {
  if (observed) return "observed";
  if (published) return "published";
  return "unknown";
}

/** EvidenceRail asOf date: observed date, else publication date (the rail's
 * asOfKind prefix renders 게시 downstream), else emptyLabel. */
export function etfRailClockDate(
  observed: string | null,
  published: string | null,
  emptyLabel = "제공자 미공개",
): string {
  return formatAsOf(observed) ?? formatAsOf(published) ?? emptyLabel;
}

/** Inline block clock: 기준 <date>, else 게시 <date>, else 미공개. */
export function etfInlineClockLabel(observed: string | null, published: string | null): string {
  const observedLabel = formatAsOf(observed);
  if (observedLabel) return `기준 ${observedLabel}`;
  const publishedLabel = formatAsOf(published);
  if (publishedLabel) return `게시 ${publishedLabel}`;
  return "미공개";
}

export function isEtfClockStale(asOf: string | null): boolean {
  return isStaleAsOf(asOf);
}

export interface EtfSurfaceData {
  loaded: boolean;
  /** both feeds failed — page-level fatal */
  failed: boolean;
  /** etf-universe feed settled with a document */
  universeOk: boolean;
  /** etf-snapshot feed settled with a document */
  snapshotOk: boolean;
  universe: EtfUniverseDoc | null;
  rows: EtfUniverseRecord[];
  snapshot: EtfSnapshotDoc | null;
  reload: () => void;
}

export function useEtfSurfaceData(): EtfSurfaceData {
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<{ loaded: boolean; universe: EtfUniverseDoc | null; snapshot: EtfSnapshotDoc | null }>({
    loaded: false,
    universe: null,
    snapshot: null,
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadEtfUniverse(), loadEtfSnapshot()]).then(([universe, snapshot]) => {
      if (cancelled) return;
      // A failed retry never overwrites LKG with null: each feed keeps its
      // previous document unless the fresh fetch settled with one, so every
      // dependent panel keeps showing prior values instead of flashing empty.
      setState((prev) => ({
        loaded: true,
        universe: universe ?? prev.universe,
        snapshot: snapshot ?? prev.snapshot,
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const universeOk = state.universe !== null;
  const snapshotOk = state.snapshot !== null;

  return {
    loaded: state.loaded,
    failed: state.loaded && !universeOk && !snapshotOk,
    universeOk,
    snapshotOk,
    universe: state.universe,
    rows: state.loaded ? normalizeUniverseRows(state.universe, state.snapshot) : [],
    snapshot: state.snapshot,
    reload: () => {
      clearEtfSurfaceCaches();
      setReloadKey((value) => value + 1);
    },
  };
}

export function openEtfEvidence(path: string) {
  window.open(path, "_blank", "noopener");
}
