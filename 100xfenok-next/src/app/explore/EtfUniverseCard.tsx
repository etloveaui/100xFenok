"use client";

import { useEffect, useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import { ROUTES } from "@/lib/routes";
import {
  ETF_TYPE_PARAM,
  asOfDate,
  cleanCategory,
  etfClassificationLabels,
  expenseRatioValue,
  formatAum,
  formatNumber,
  formatPercentPointsValue,
  formatTypeHint,
  isInverseEtf,
  isLeveragedEtf,
  isSingleStockLeveragedEtf,
  issuerNameFromEtfName,
  type EtfClassification,
  type EtfTypeFilter,
  type EtfUniverseRecord,
} from "./etfUniverseUtils";

export type { EtfClassification, EtfTypeFilter, EtfUniverseRecord } from "./etfUniverseUtils";
export {
  asOfDate,
  etfClassificationLabels,
  formatNumber,
  isInverseEtf,
  isLeveragedEtf,
  isSingleStockLeveragedEtf,
} from "./etfUniverseUtils";

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

interface NewEtfRecord {
  s?: string;
  n?: string;
  inceptionDate?: string;
  price?: number;
  change?: number;
  classification?: EtfClassification;
}

interface DigitalAssetEtfRecord {
  symbol?: string;
  fund_name?: string;
  assets?: string;
  stock_price?: string;
  pct_change?: string;
}

interface EtfSnapshotDoc {
  newEtfs?: {
    fetched_at?: string | null;
    counts?: {
      records?: number | null;
      rows?: number | null;
    } | null;
    records?: NewEtfRecord[];
  } | null;
  bitcoin?: {
    fetched_at?: string | null;
    counts?: {
      records?: number | null;
      rows?: number | null;
    } | null;
    records?: DigitalAssetEtfRecord[];
  } | null;
}

type EtfAumFilter = "전체" | "1,000억 달러 이상" | "100억 달러 이상" | "10억 달러 이상" | "10억 달러 미만" | "운용자산 미표시";
type EtfExpenseFilter = "전체" | "0.05% 이하" | "0.10% 이하" | "0.50% 이하" | "1.00% 이상" | "보수 미표시";
type EtfSegmentFilter = "전체" | "신규" | "디지털자산" | "레버리지" | "단일종목 레버리지" | "인버스";

const ETF_AUM_PARAM: Record<EtfAumFilter, string | null> = {
  "전체": null,
  "1,000억 달러 이상": "mega",
  "100억 달러 이상": "large",
  "10억 달러 이상": "mid",
  "10억 달러 미만": "small",
  "운용자산 미표시": "unknown",
};

const ETF_EXPENSE_PARAM: Record<EtfExpenseFilter, string | null> = {
  "전체": null,
  "0.05% 이하": "ultra-low",
  "0.10% 이하": "low",
  "0.50% 이하": "mid",
  "1.00% 이상": "high",
  "보수 미표시": "unknown",
};

function EtfClassificationBadges({ row }: { row: EtfUniverseRecord }) {
  const labels = etfClassificationLabels(row);
  if (labels.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {labels.map((label) => (
        <span
          key={label}
          className="rounded-full border border-[var(--c-line)] bg-[var(--c-surface-2)] px-2 py-0.5 text-[10px] font-black text-[var(--c-ink-3)]"
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function aumFilterFromParam(value: string | null | undefined): EtfAumFilter {
  if (value === "mega") return "1,000억 달러 이상";
  if (value === "large") return "100억 달러 이상";
  if (value === "mid") return "10억 달러 이상";
  if (value === "small") return "10억 달러 미만";
  if (value === "unknown") return "운용자산 미표시";
  return "전체";
}

function expenseFilterFromParam(value: string | null | undefined): EtfExpenseFilter {
  if (value === "ultra-low") return "0.05% 이하";
  if (value === "low") return "0.10% 이하";
  if (value === "mid") return "0.50% 이하";
  if (value === "high") return "1.00% 이상";
  if (value === "unknown") return "보수 미표시";
  return "전체";
}

function matchesAumFilter(value: number | null | undefined, filter: EtfAumFilter): boolean {
  const aum = typeof value === "number" && Number.isFinite(value) ? value : null;
  if (filter === "전체") return true;
  if (filter === "운용자산 미표시") return aum === null;
  if (aum === null) return false;
  if (filter === "1,000억 달러 이상") return aum >= 100_000_000_000;
  if (filter === "100억 달러 이상") return aum >= 10_000_000_000;
  if (filter === "10억 달러 이상") return aum >= 1_000_000_000;
  return aum < 1_000_000_000;
}

function matchesExpenseFilter(row: EtfUniverseRecord, filter: EtfExpenseFilter): boolean {
  const expense = expenseRatioValue(row);
  if (filter === "전체") return true;
  if (filter === "보수 미표시") return expense === null;
  if (expense === null) return false;
  if (filter === "0.05% 이하") return expense <= 0.05;
  if (filter === "0.10% 이하") return expense <= 0.10;
  if (filter === "0.50% 이하") return expense <= 0.50;
  return expense >= 1.00;
}

let universeCache: EtfUniverseDoc | null = null;
let universePending: Promise<EtfUniverseDoc | null> | null = null;
let snapshotCache: EtfSnapshotDoc | null = null;
let snapshotPending: Promise<EtfSnapshotDoc | null> | null = null;

function loadUniverse(): Promise<EtfUniverseDoc | null> {
  if (universeCache) return Promise.resolve(universeCache);
  if (universePending) return universePending;
  universePending = fetch("/api/data/stockanalysis/etf-universe", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() as Promise<EtfUniverseDoc> : null))
    .then((doc) => {
      universeCache = doc;
      return doc;
    })
    .catch(() => {
      universePending = null;
      return null;
    });
  return universePending;
}

function loadSnapshot(): Promise<EtfSnapshotDoc | null> {
  if (snapshotCache) return Promise.resolve(snapshotCache);
  if (snapshotPending) return snapshotPending;
  snapshotPending = fetch("/api/data/stockanalysis/etf-snapshot", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() as Promise<EtfSnapshotDoc> : null))
    .then((doc) => {
      snapshotCache = doc;
      return doc;
    })
    .catch(() => {
      snapshotPending = null;
      return null;
    });
  return snapshotPending;
}

interface EtfUniverseCardProps {
  limit?: number;
  showOpenLink?: boolean;
  initialTypeFilter?: EtfTypeFilter;
  initialNewOnly?: boolean;
  initialDigitalOnly?: boolean;
  initialAssetClassFilter?: string;
  initialIssuerFilter?: string;
  initialAumFilter?: string;
  initialExpenseFilter?: string;
  syncTypeParam?: boolean;
  enableLoadMore?: boolean;
}

export default function EtfUniverseCard({
  limit = 12,
  showOpenLink = true,
  initialTypeFilter = "전체",
  initialNewOnly = false,
  initialDigitalOnly = false,
  initialAssetClassFilter = "전체",
  initialIssuerFilter = "전체",
  initialAumFilter,
  initialExpenseFilter,
  syncTypeParam = false,
  enableLoadMore = false,
}: EtfUniverseCardProps) {
  const [doc, setDoc] = useState<EtfUniverseDoc | null>(null);
  const [snapshot, setSnapshot] = useState<EtfSnapshotDoc | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [category, setCategory] = useState("전체");
  const [assetClassFilter, setAssetClassFilter] = useState(initialAssetClassFilter);
  const [issuerFilter, setIssuerFilter] = useState(initialIssuerFilter);
  const [aumFilter, setAumFilter] = useState<EtfAumFilter>(aumFilterFromParam(initialAumFilter));
  const [expenseFilter, setExpenseFilter] = useState<EtfExpenseFilter>(expenseFilterFromParam(initialExpenseFilter));
  const [typeFilter, setTypeFilter] = useState<EtfTypeFilter>(initialTypeFilter);
  const [newOnly, setNewOnly] = useState(initialNewOnly);
  const [digitalOnly, setDigitalOnly] = useState(initialDigitalOnly);
  const [expanded, setExpanded] = useState<{ key: string; count: number }>({ key: "", count: 0 });

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadUniverse(), loadSnapshot()]).then(([nextDoc, nextSnapshot]) => {
      if (!cancelled) {
        setDoc(nextDoc);
        setSnapshot(nextSnapshot);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setDigitalOnly(initialDigitalOnly);
    setNewOnly(initialDigitalOnly ? false : initialNewOnly);
    setTypeFilter(initialNewOnly || initialDigitalOnly ? "전체" : initialTypeFilter);
  }, [initialDigitalOnly, initialNewOnly, initialTypeFilter]);

  useEffect(() => {
    setAssetClassFilter(initialAssetClassFilter);
  }, [initialAssetClassFilter]);

  useEffect(() => {
    setIssuerFilter(initialIssuerFilter);
  }, [initialIssuerFilter]);

  useEffect(() => {
    setAumFilter(aumFilterFromParam(initialAumFilter));
  }, [initialAumFilter]);

  useEffect(() => {
    setExpenseFilter(expenseFilterFromParam(initialExpenseFilter));
  }, [initialExpenseFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  const rows = useMemo(() => {
    const byTicker = new Map<string, EtfUniverseRecord>();
    const sourceRows = Array.isArray(doc?.records) ? doc.records : [];
    sourceRows
      .filter((row) => typeof row.ticker === "string" && row.ticker.trim())
      .forEach((row) => {
        const ticker = row.ticker!.trim().toUpperCase();
        byTicker.set(ticker, {
          ...row,
          ticker,
          name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : ticker,
          category: cleanCategory(row.category ?? row.assetClass),
          assetClass: cleanCategory(row.assetClass),
          issuer: issuerNameFromEtfName(row.issuer ?? row.name ?? row.ticker),
        });
      });

    for (const row of snapshot?.newEtfs?.records ?? []) {
      if (typeof row.s !== "string" || !row.s.trim()) continue;
      const ticker = row.s.trim().toUpperCase();
      const existing = byTicker.get(ticker);
      byTicker.set(ticker, {
        ...(existing ?? {
          ticker,
          name: typeof row.n === "string" && row.n.trim() ? row.n.trim() : ticker,
          category: "신규 상장",
        }),
        ticker,
        name: existing?.name ?? (typeof row.n === "string" && row.n.trim() ? row.n.trim() : ticker),
        category: existing?.category ?? "신규 상장",
        assetClass: existing?.assetClass ?? "미분류",
        issuer: existing?.issuer ?? issuerNameFromEtfName(row.n ?? ticker),
        inceptionDate: row.inceptionDate,
        price: row.price,
        change: row.change,
        classification: existing?.classification ?? row.classification,
        is_new: true,
      });
    }

    return [...byTicker.values()];
  }, [doc, snapshot]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const categoryName = cleanCategory(row.category);
      counts.set(categoryName, (counts.get(categoryName) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [rows]);

  const assetClasses = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const name = cleanCategory(row.assetClass);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  }, [rows]);

  const issuers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const name = issuerNameFromEtfName(row.issuer ?? row.name ?? row.ticker);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  }, [rows]);

  const digitalTickerSet = useMemo(() => {
    const tickers = new Set<string>();
    for (const row of snapshot?.bitcoin?.records ?? []) {
      if (typeof row.symbol === "string" && row.symbol.trim()) {
        tickers.add(row.symbol.trim().toUpperCase());
      }
    }
    return tickers;
  }, [snapshot]);

  const dropdownFilteredRows = useMemo(() => {
    return rows
      .filter((row) => category === "전체" || row.category === category)
      .filter((row) => assetClassFilter === "전체" || cleanCategory(row.assetClass) === assetClassFilter)
      .filter((row) => issuerFilter === "전체" || issuerNameFromEtfName(row.issuer ?? row.name ?? row.ticker) === issuerFilter)
      .filter((row) => matchesAumFilter(row.aum, aumFilter))
      .filter((row) => matchesExpenseFilter(row, expenseFilter));
  }, [assetClassFilter, aumFilter, category, expenseFilter, issuerFilter, rows]);

  const typeCounts = useMemo(() => {
    let leveraged = 0;
    let singleStock = 0;
    let inverse = 0;
    for (const row of dropdownFilteredRows) {
      if (isLeveragedEtf(row)) leveraged += 1;
      if (isSingleStockLeveragedEtf(row)) singleStock += 1;
      if (isInverseEtf(row)) inverse += 1;
    }
    return { leveraged, singleStock, inverse };
  }, [dropdownFilteredRows]);

  const filteredRows = useMemo(() => {
    const q = debouncedQuery.trim().toUpperCase();
    return dropdownFilteredRows
      .filter((row) => !newOnly || row.is_new === true)
      .filter((row) => !digitalOnly || digitalTickerSet.has((row.ticker ?? "").toUpperCase()))
      .filter((row) => {
        if (newOnly || digitalOnly) return true;
        if (typeFilter === "레버리지") return isLeveragedEtf(row);
        if (typeFilter === "단일종목 레버리지") return isSingleStockLeveragedEtf(row);
        if (typeFilter === "인버스") return isInverseEtf(row);
        return true;
      })
      .filter((row) => !q || (row.ticker ?? "").includes(q) || (row.name ?? "").toUpperCase().includes(q) || (row.issuer ?? "").toUpperCase().includes(q))
      .sort((a, b) => {
        if (newOnly) {
          return String(b.inceptionDate ?? "").localeCompare(String(a.inceptionDate ?? "")) || String(a.ticker ?? "").localeCompare(String(b.ticker ?? ""));
        }
        if (digitalOnly) {
          return (b.aum ?? -1) - (a.aum ?? -1) || String(a.ticker ?? "").localeCompare(String(b.ticker ?? ""));
        }
        return (b.aum ?? -1) - (a.aum ?? -1);
      });
  }, [debouncedQuery, digitalOnly, digitalTickerSet, dropdownFilteredRows, newOnly, typeFilter]);

  const total = dropdownFilteredRows.length;
  const newCount = dropdownFilteredRows.filter((row) => row.is_new === true).length;
  const digitalCount = dropdownFilteredRows.filter((row) => digitalTickerSet.has((row.ticker ?? "").toUpperCase())).length;
  const displayTotal = filteredRows.length;
  const screenerOnlyCount = doc?.counts?.screener_only ?? 0;
  const visibleLimit = newOnly || digitalOnly ? Math.max(limit, 100) : limit;
  const filterKey = `${debouncedQuery.trim()}|${category}|${assetClassFilter}|${issuerFilter}|${aumFilter}|${expenseFilter}|${typeFilter}|${newOnly ? "new" : digitalOnly ? "digital" : "all"}|${visibleLimit}`;
  const visibleCount = enableLoadMore && expanded.key === filterKey
    ? Math.max(visibleLimit, expanded.count)
    : visibleLimit;
  const visibleRows = filteredRows.slice(0, visibleCount);
  const hasMoreRows = enableLoadMore && filteredRows.length > visibleRows.length;
  const currentTopCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of dropdownFilteredRows) {
      const categoryName = cleanCategory(row.category);
      counts.set(categoryName, (counts.get(categoryName) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }))[0] ?? null;
  }, [dropdownFilteredRows]);
  const segmentOptions: Array<{ value: EtfSegmentFilter; label: string; count: number | null }> = [
    { value: "전체", label: "전체", count: total },
    { value: "신규", label: "신규", count: newCount },
    { value: "디지털자산", label: "디지털자산", count: digitalCount },
    { value: "레버리지", label: "레버리지", count: typeCounts.leveraged },
    { value: "단일종목 레버리지", label: "단일종목 레버리지", count: typeCounts.singleStock },
    { value: "인버스", label: "인버스", count: typeCounts.inverse },
  ];
  const activeSegment: EtfSegmentFilter = newOnly ? "신규" : digitalOnly ? "디지털자산" : typeFilter;

  const syncFilterParams = (next: {
    typeFilter?: EtfTypeFilter;
    newOnly?: boolean;
    digitalOnly?: boolean;
    assetClassFilter?: string;
    issuerFilter?: string;
    aumFilter?: EtfAumFilter;
    expenseFilter?: EtfExpenseFilter;
  }) => {
    if (!syncTypeParam || typeof window === "undefined") return;
    const nextFilter = next.typeFilter ?? typeFilter;
    const nextNewOnly = next.newOnly ?? newOnly;
    const nextDigitalOnly = next.digitalOnly ?? digitalOnly;
    const nextAssetClass = next.assetClassFilter ?? assetClassFilter;
    const nextIssuer = next.issuerFilter ?? issuerFilter;
    const nextAum = next.aumFilter ?? aumFilter;
    const nextExpense = next.expenseFilter ?? expenseFilter;
    const nextUrl = new URL(window.location.href);
    const param = ETF_TYPE_PARAM[nextFilter];
    if (!nextNewOnly && !nextDigitalOnly && param) nextUrl.searchParams.set("type", param);
    else nextUrl.searchParams.delete("type");
    if (nextNewOnly) nextUrl.searchParams.set("new", "1");
    else nextUrl.searchParams.delete("new");
    if (nextDigitalOnly) nextUrl.searchParams.set("digital", "1");
    else nextUrl.searchParams.delete("digital");
    if (nextAssetClass === "전체") nextUrl.searchParams.delete("asset");
    else nextUrl.searchParams.set("asset", nextAssetClass);
    if (nextIssuer === "전체") nextUrl.searchParams.delete("issuer");
    else nextUrl.searchParams.set("issuer", nextIssuer);
    const aumParam = ETF_AUM_PARAM[nextAum];
    if (aumParam) nextUrl.searchParams.set("aum", aumParam);
    else nextUrl.searchParams.delete("aum");
    const feeParam = ETF_EXPENSE_PARAM[nextExpense];
    if (feeParam) nextUrl.searchParams.set("fee", feeParam);
    else nextUrl.searchParams.delete("fee");
    window.history.replaceState(null, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
  };

  const handleSegmentChange = (nextSegment: EtfSegmentFilter) => {
    if (nextSegment === "신규") {
      setNewOnly(true);
      setDigitalOnly(false);
      setTypeFilter("전체");
      syncFilterParams({ newOnly: true, digitalOnly: false, typeFilter: "전체" });
      return;
    }
    if (nextSegment === "디지털자산") {
      setNewOnly(false);
      setDigitalOnly(true);
      setTypeFilter("전체");
      syncFilterParams({ newOnly: false, digitalOnly: true, typeFilter: "전체" });
      return;
    }
    const nextFilter = nextSegment as EtfTypeFilter;
    setNewOnly(false);
    setDigitalOnly(false);
    setTypeFilter(nextFilter);
    syncFilterParams({ newOnly: false, digitalOnly: false, typeFilter: nextFilter });
  };

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>ETF 목록</h2>
        <span className="desc">{asOfDate(newOnly ? snapshot?.newEtfs?.fetched_at : digitalOnly ? snapshot?.bitcoin?.fetched_at : doc?.screener_fetched_at ?? doc?.generated_at)} · {formatNumber(displayTotal)}개</span>
      </div>
      <div className="panel-b">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_140px_140px_170px_160px_150px]">
          <label className="sr-only" htmlFor="etf-universe-search">ETF 검색</label>
          <input
            id="etf-universe-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="티커 또는 이름 검색"
            className="min-h-11 w-full rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)] px-3 text-sm font-semibold text-[var(--c-ink-2)] outline-none transition focus:border-brand-interactive"
          />
          <label className="sr-only" htmlFor="etf-universe-category">카테고리</label>
          <select
            id="etf-universe-category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="min-h-11 w-full rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)] px-3 text-sm font-bold text-[var(--c-ink-2)] outline-none transition focus:border-brand-interactive"
          >
            <option value="전체">전체</option>
            {categories.map((item) => (
              <option key={item.name} value={item.name}>{item.name} ({formatNumber(item.count)})</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="etf-universe-asset-class">자산군</label>
          <select
            id="etf-universe-asset-class"
            value={assetClassFilter}
            onChange={(event) => {
              setAssetClassFilter(event.target.value);
              syncFilterParams({ assetClassFilter: event.target.value });
            }}
            className="min-h-11 w-full rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)] px-3 text-sm font-bold text-[var(--c-ink-2)] outline-none transition focus:border-brand-interactive"
          >
            <option value="전체">전체 자산군</option>
            {assetClasses.map((item) => (
              <option key={item.name} value={item.name}>{item.name} ({formatNumber(item.count)})</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="etf-universe-issuer">운용사</label>
          <select
            id="etf-universe-issuer"
            value={issuerFilter}
            onChange={(event) => {
              setIssuerFilter(event.target.value);
              syncFilterParams({ issuerFilter: event.target.value });
            }}
            className="min-h-11 w-full rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)] px-3 text-sm font-bold text-[var(--c-ink-2)] outline-none transition focus:border-brand-interactive"
          >
            <option value="전체">전체 운용사</option>
            {issuers.map((item) => (
              <option key={item.name} value={item.name}>{item.name} ({formatNumber(item.count)})</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="etf-universe-aum">운용자산</label>
          <select
            id="etf-universe-aum"
            value={aumFilter}
            onChange={(event) => {
              const value = event.target.value as EtfAumFilter;
              setAumFilter(value);
              syncFilterParams({ aumFilter: value });
            }}
            className="min-h-11 w-full rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)] px-3 text-sm font-bold text-[var(--c-ink-2)] outline-none transition focus:border-brand-interactive"
          >
            {Object.keys(ETF_AUM_PARAM).map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="etf-universe-expense">보수율</label>
          <select
            id="etf-universe-expense"
            value={expenseFilter}
            onChange={(event) => {
              const value = event.target.value as EtfExpenseFilter;
              setExpenseFilter(value);
              syncFilterParams({ expenseFilter: value });
            }}
            className="min-h-11 w-full rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)] px-3 text-sm font-bold text-[var(--c-ink-2)] outline-none transition focus:border-brand-interactive"
          >
            {Object.keys(ETF_EXPENSE_PARAM).map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="ETF 세그먼트">
          {segmentOptions.map((option) => {
            const selected = activeSegment === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSegmentChange(option.value)}
                aria-pressed={selected}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-[11px] font-black transition ${
                  selected
                    ? "border-[var(--c-brand)] bg-[var(--c-brand)] text-white shadow-sm"
                    : "border-[var(--c-line)] bg-white text-[var(--c-ink-3)] hover:border-[var(--c-brand)] hover:text-[var(--c-brand)]"
                }`}
              >
                <span>{option.label}</span>
                <span className={selected ? "text-white" : "text-[var(--c-ink-3)]"}>{formatNumber(option.count)}</span>
              </button>
            );
          })}
          {newOnly ? (
            <TransitionLink href={ROUTES.etfNew} className="inline-flex min-h-11 items-center rounded-full border border-[var(--c-line)] bg-[var(--c-panel)] px-3 text-[11px] font-black text-[var(--c-ink-2)] transition hover:border-brand-interactive hover:text-brand-interactive">
              신규 ETF 상세
            </TransitionLink>
          ) : null}
        </div>

        {currentTopCategory ? (
          <div className="mt-3 rounded-xl border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 py-2 text-[11px] font-bold text-[var(--c-ink-3)]">
            현재 조건에서 가장 많은 분류 <span className="text-[var(--c-ink)]">{currentTopCategory.name}</span> · {formatNumber(currentTopCategory.count)}개
            {assetClassFilter !== "전체" ? <span> · 자산군 {assetClassFilter}</span> : null}
            {issuerFilter !== "전체" ? <span> · 운용사 {issuerFilter}</span> : null}
            {aumFilter !== "전체" ? <span> · 운용자산 {aumFilter}</span> : null}
            {expenseFilter !== "전체" ? <span> · 보수율 {expenseFilter}</span> : null}
          </div>
        ) : null}
        {digitalOnly ? (
          <div className="mt-2 rounded-xl border border-[var(--c-line)] bg-white px-3 py-2 text-[11px] font-bold text-[var(--c-ink-3)]">
            디지털자산 필터는 현재 비트코인 ETF 목록과 전체 ETF 목록이 함께 확인되는 항목을 보여줍니다.
          </div>
        ) : null}
        {screenerOnlyCount > 0 ? (
          <div className="mt-2 rounded-xl border border-[var(--c-line)] bg-white px-3 py-2 text-[11px] font-bold text-[var(--c-ink-3)]">
            전체 ETF 목록과 스크리너 데이터를 합쳐 보여줍니다. 세부 데이터가 아직 없는 ETF는 기본 정보부터 먼저 표시됩니다.
            <span className="text-[var(--c-ink)]"> 스크리너에서만 확인된 항목 {formatNumber(screenerOnlyCount)}개 포함.</span>
          </div>
        ) : null}
      </div>

      <div className="mv-col">
        {!loaded ? (
          <div className="mv-row">
            <span className="co">
              <div className="n">ETF 목록 확인 중</div>
              <div className="tk">목록과 분류 데이터를 읽고 있습니다</div>
            </span>
            <span className="pc num neutral">...</span>
          </div>
        ) : filteredRows.length > 0 ? (
          visibleRows.map((row) => {
            const ticker = row.ticker ?? "";
            const name = row.name && row.name !== ticker ? row.name : null;
            const typeHint = formatTypeHint(row, { includeTicker: false });
            const detailText = name ? `${name} · ${typeHint}` : typeHint;
            return (
              <TransitionLink key={ticker} href={`/etfs/${encodeURIComponent(ticker)}`} className="mv-row">
                <span className="co">
                  <div className="n">{ticker}</div>
                  <div className="tk" title={detailText}>
                    <span className="ticker-pill" aria-hidden="true">{ticker}</span>
                    {detailText}
                  </div>
                  <EtfClassificationBadges row={row} />
                </span>
                <span className="pc num neutral">
                  {formatAum(row)}
                  {expenseRatioValue(row) !== null ? <small className="block text-[10px] font-black text-[var(--c-ink-3)]">보수 {formatPercentPointsValue(expenseRatioValue(row))}</small> : null}
                </span>
              </TransitionLink>
            );
          })
        ) : (
          <div className="mv-row">
            <span className="co">
              <div className="n">검색 결과 없음</div>
              <div className="tk">필터를 조정해 주세요</div>
            </span>
            <span className="pc num neutral">—</span>
          </div>
        )}
      </div>
      {hasMoreRows ? (
        <div className="border-t border-slate-100 px-4 py-3">
          <button
            type="button"
            onClick={() => setExpanded({
              key: filterKey,
              count: Math.min(filteredRows.length, visibleRows.length + visibleLimit),
            })}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)] px-4 text-[12px] font-black text-[var(--c-ink-2)] transition hover:border-brand-interactive hover:text-brand-interactive"
          >
            더 보기 · {formatNumber(visibleRows.length)} / {formatNumber(filteredRows.length)}
          </button>
        </div>
      ) : null}
      <div className="panel-foot flex flex-wrap items-center justify-between gap-2">
        <span>현재 조건에서 {newOnly ? "상장일순" : "운용자산순"} {formatNumber(visibleRows.length)} / {formatNumber(filteredRows.length)}개 표시 · 각 행은 상세 페이지로 이동</span>
        {showOpenLink ? (
          <TransitionLink href={ROUTES.etfs} className="font-black text-brand-interactive hover:underline">
            ETF 센터
          </TransitionLink>
        ) : null}
      </div>
    </section>
  );
}
