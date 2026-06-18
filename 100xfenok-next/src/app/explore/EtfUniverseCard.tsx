"use client";

import { useEffect, useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import {
  ETF_TYPE_PARAM,
  asOfDate,
  cleanCategory,
  formatAum,
  formatNumber,
  formatTypeHint,
  isInverseEtf,
  isLeveragedEtf,
  isSingleStockLeveragedEtf,
  type EtfTypeFilter,
  type EtfUniverseRecord,
} from "./etfUniverseUtils";

export type { EtfClassification, EtfTypeFilter, EtfUniverseRecord } from "./etfUniverseUtils";
export {
  asOfDate,
  formatNumber,
  isInverseEtf,
  isLeveragedEtf,
  isSingleStockLeveragedEtf,
} from "./etfUniverseUtils";

interface EtfUniverseDoc {
  generated_at?: string | null;
  counts?: {
    records?: number | null;
  } | null;
  records?: EtfUniverseRecord[];
}

interface NewEtfRecord {
  s?: string;
  n?: string;
  inceptionDate?: string;
  price?: number;
  change?: number;
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
}

let universeCache: EtfUniverseDoc | null = null;
let universePending: Promise<EtfUniverseDoc | null> | null = null;
let snapshotCache: EtfSnapshotDoc | null = null;
let snapshotPending: Promise<EtfSnapshotDoc | null> | null = null;

function loadUniverse(): Promise<EtfUniverseDoc | null> {
  if (universeCache) return Promise.resolve(universeCache);
  if (universePending) return universePending;
  universePending = fetch("/data/stockanalysis/etf_universe.json", { cache: "no-store" })
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
  syncTypeParam?: boolean;
  enableLoadMore?: boolean;
}

export default function EtfUniverseCard({
  limit = 12,
  showOpenLink = true,
  initialTypeFilter = "전체",
  initialNewOnly = false,
  syncTypeParam = false,
  enableLoadMore = false,
}: EtfUniverseCardProps) {
  const [doc, setDoc] = useState<EtfUniverseDoc | null>(null);
  const [snapshot, setSnapshot] = useState<EtfSnapshotDoc | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [category, setCategory] = useState("전체");
  const [typeFilter, setTypeFilter] = useState<EtfTypeFilter>(initialTypeFilter);
  const [newOnly, setNewOnly] = useState(initialNewOnly);
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
    setTypeFilter(initialTypeFilter);
  }, [initialTypeFilter]);

  useEffect(() => {
    setNewOnly(initialNewOnly);
  }, [initialNewOnly]);

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
          category: cleanCategory(row.category),
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
        inceptionDate: row.inceptionDate,
        price: row.price,
        change: row.change,
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

  const typeCounts = useMemo(() => {
    let leveraged = 0;
    let singleStock = 0;
    let inverse = 0;
    for (const row of rows) {
      if (isLeveragedEtf(row)) leveraged += 1;
      if (isSingleStockLeveragedEtf(row)) singleStock += 1;
      if (isInverseEtf(row)) inverse += 1;
    }
    return { leveraged, singleStock, inverse };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = debouncedQuery.trim().toUpperCase();
    return rows
      .filter((row) => category === "전체" || row.category === category)
      .filter((row) => !newOnly || row.is_new === true)
      .filter((row) => {
        if (typeFilter === "레버리지") return isLeveragedEtf(row);
        if (typeFilter === "단일종목 레버리지") return isSingleStockLeveragedEtf(row);
        if (typeFilter === "인버스") return isInverseEtf(row);
        return true;
      })
      .filter((row) => !q || (row.ticker ?? "").includes(q) || (row.name ?? "").toUpperCase().includes(q))
      .sort((a, b) => {
        if (newOnly) {
          return String(b.inceptionDate ?? "").localeCompare(String(a.inceptionDate ?? "")) || String(a.ticker ?? "").localeCompare(String(b.ticker ?? ""));
        }
        return (b.aum ?? -1) - (a.aum ?? -1);
      });
  }, [category, debouncedQuery, newOnly, rows, typeFilter]);

  const total = doc?.counts?.records ?? rows.length;
  const newCount = snapshot?.newEtfs?.counts?.records ?? snapshot?.newEtfs?.counts?.rows ?? (snapshot?.newEtfs?.records ?? []).length;
  const displayTotal = newOnly ? newCount : total;
  const visibleLimit = newOnly ? Math.max(limit, 100) : limit;
  const filterKey = `${debouncedQuery.trim()}|${category}|${typeFilter}|${newOnly ? "new" : "all"}|${visibleLimit}`;
  const visibleCount = enableLoadMore && expanded.key === filterKey
    ? Math.max(visibleLimit, expanded.count)
    : visibleLimit;
  const visibleRows = filteredRows.slice(0, visibleCount);
  const hasMoreRows = enableLoadMore && filteredRows.length > visibleRows.length;
  const topCategory = categories[0];
  const typeOptions: Array<{ value: EtfTypeFilter; label: string; count: number | null }> = [
    { value: "전체", label: "전체", count: total },
    { value: "레버리지", label: "레버리지", count: typeCounts.leveraged },
    { value: "단일종목 레버리지", label: "단일종목 레버리지", count: typeCounts.singleStock },
    { value: "인버스", label: "인버스", count: typeCounts.inverse },
  ];

  const syncFilterParams = (nextFilter: EtfTypeFilter, nextNewOnly: boolean) => {
    if (!syncTypeParam || typeof window === "undefined") return;
    const nextUrl = new URL(window.location.href);
    const param = ETF_TYPE_PARAM[nextFilter];
    if (param) nextUrl.searchParams.set("type", param);
    else nextUrl.searchParams.delete("type");
    if (nextNewOnly) nextUrl.searchParams.set("new", "1");
    else nextUrl.searchParams.delete("new");
    window.history.replaceState(null, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
  };

  const handleTypeFilterChange = (nextFilter: EtfTypeFilter) => {
    setTypeFilter(nextFilter);
    syncFilterParams(nextFilter, newOnly);
  };

  const handleNewOnlyChange = () => {
    const nextNewOnly = !newOnly;
    setNewOnly(nextNewOnly);
    syncFilterParams(typeFilter, nextNewOnly);
  };

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>ETF 목록</h2>
        <span className="desc">{asOfDate(newOnly ? snapshot?.newEtfs?.fetched_at : doc?.generated_at)} · {formatNumber(displayTotal)}개</span>
      </div>
      <div className="panel-b">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_170px]">
          <label className="sr-only" htmlFor="etf-universe-search">ETF 검색</label>
          <input
            id="etf-universe-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="티커 또는 이름 검색"
            className="min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-brand-interactive"
          />
          <label className="sr-only" htmlFor="etf-universe-category">카테고리</label>
          <select
            id="etf-universe-category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-brand-interactive"
          >
            <option value="전체">전체</option>
            {categories.map((item) => (
              <option key={item.name} value={item.name}>{item.name} ({formatNumber(item.count)})</option>
            ))}
          </select>
        </div>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="ETF 유형">
          {typeOptions.map((option) => {
            const selected = typeFilter === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleTypeFilterChange(option.value)}
                aria-pressed={selected}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[11px] font-black transition ${
                  selected
                    ? "border-brand-interactive bg-brand-interactive text-white shadow-sm"
                    : "border-slate-200 bg-white text-slate-600 hover:border-brand-interactive hover:text-brand-interactive"
                }`}
              >
                <span>{option.label}</span>
                <span className={selected ? "text-white/80" : "text-slate-400"}>{formatNumber(option.count)}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={handleNewOnlyChange}
            aria-pressed={newOnly}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[11px] font-black transition ${
              newOnly
                ? "border-emerald-600 bg-emerald-600 text-white shadow-sm"
                : "border-slate-200 bg-white text-slate-600 hover:border-emerald-600 hover:text-emerald-700"
            }`}
          >
            <span>신규 상장</span>
            <span className={newOnly ? "text-white/80" : "text-slate-400"}>{formatNumber(newCount)}</span>
          </button>
        </div>

        {topCategory ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-500">
            가장 많은 분류 <span className="text-slate-800">{topCategory.name}</span> · {formatNumber(topCategory.count)}개
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
            return (
              <TransitionLink key={ticker} href={`/etfs/${encodeURIComponent(ticker)}`} className="mv-row">
                <span className="co">
                  <div className="n">{row.name ?? ticker}</div>
                  <div className="tk">{formatTypeHint(row)}</div>
                </span>
                <span className="pc num neutral">{formatAum(row)}</span>
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
            className="inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-[12px] font-black text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive"
          >
            더 보기 · {formatNumber(visibleRows.length)} / {formatNumber(filteredRows.length)}
          </button>
        </div>
      ) : null}
      <div className="panel-foot flex flex-wrap items-center justify-between gap-2">
        <span>현재 조건에서 {newOnly ? "상장일순" : "운용자산순"} {formatNumber(visibleRows.length)} / {formatNumber(filteredRows.length)}개 표시 · 각 행은 상세 페이지로 이동</span>
        {showOpenLink ? (
          <TransitionLink href="/etfs" className="font-black text-brand-interactive hover:underline">
            ETF 센터
          </TransitionLink>
        ) : null}
      </div>
    </section>
  );
}
