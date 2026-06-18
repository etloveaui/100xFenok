"use client";

import { useEffect, useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";

export interface EtfUniverseRecord {
  ticker?: string;
  name?: string;
  category?: string;
  aum_raw?: string;
  aum?: number;
  classification?: EtfClassification;
  is_leveraged?: boolean;
  leverage_factor?: number | null;
  is_inverse?: boolean;
  is_single_stock?: boolean;
  underlying?: string | null;
}

export interface EtfClassification {
  is_leveraged?: boolean;
  leverage_factor?: number | null;
  is_inverse?: boolean;
  is_single_stock?: boolean;
  underlying?: string | null;
  source?: string;
  confidence?: string;
}

interface EtfUniverseDoc {
  generated_at?: string | null;
  counts?: {
    records?: number | null;
  } | null;
  records?: EtfUniverseRecord[];
}

let universeCache: EtfUniverseDoc | null = null;
let universePending: Promise<EtfUniverseDoc | null> | null = null;
export type EtfTypeFilter = "전체" | "레버리지" | "단일종목 레버리지" | "인버스";
const ETF_TYPE_PARAM: Record<EtfTypeFilter, string | null> = {
  "전체": null,
  "레버리지": "leveraged",
  "단일종목 레버리지": "single-stock",
  "인버스": "inverse",
};

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

function cleanCategory(value: string | null | undefined): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text !== "-" ? text : "미분류";
}

export function formatNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("ko-KR") : "—";
}

function formatAum(row: EtfUniverseRecord): string {
  if (typeof row.aum_raw === "string" && row.aum_raw.trim() && row.aum_raw.trim() !== "-") return row.aum_raw.trim();
  const value = typeof row.aum === "number" && Number.isFinite(row.aum) ? row.aum : null;
  if (value === null) return "—";
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  return value.toLocaleString("en-US");
}

export function asOfDate(value: string | null | undefined): string {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : "—";
}

function etfSearchText(row: EtfUniverseRecord): string {
  return [row.ticker, row.name, row.category, row.underlying, row.classification?.underlying].filter(Boolean).join(" ").toLowerCase();
}

function rowClassification(row: EtfUniverseRecord): EtfClassification | null {
  if (row.classification && typeof row.classification === "object") return row.classification;
  if (
    typeof row.is_leveraged === "boolean" ||
    typeof row.is_inverse === "boolean" ||
    typeof row.is_single_stock === "boolean" ||
    typeof row.leverage_factor === "number" ||
    typeof row.underlying === "string"
  ) {
    return {
      is_leveraged: row.is_leveraged,
      leverage_factor: row.leverage_factor,
      is_inverse: row.is_inverse,
      is_single_stock: row.is_single_stock,
      underlying: row.underlying,
    };
  }
  return null;
}

export function isLeveragedEtf(row: EtfUniverseRecord): boolean {
  const classification = rowClassification(row);
  if (typeof classification?.is_leveraged === "boolean") return classification.is_leveraged;
  const text = etfSearchText(row);
  return (
    /\b(?:1\.25x|1\.5x|2x|3x|4x)\b/i.test(text) ||
    /\bleveraged\b/i.test(text) ||
    /\bultrapro\b/i.test(text) ||
    /\bmicrosectors\b.*\b3x\b/i.test(text) ||
    /\bdaily\b.*\b(?:bull|bear|target|long|short)\b/i.test(text) ||
    /\b(?:bull|bear|long|short)\b.*\b(?:2x|3x|daily)\b/i.test(text)
  );
}

export function isSingleStockLeveragedEtf(row: EtfUniverseRecord): boolean {
  const classification = rowClassification(row);
  if (typeof classification?.is_single_stock === "boolean") return classification.is_single_stock;
  if (!isLeveragedEtf(row)) return false;
  const text = etfSearchText(row);
  return (
    /\bsingle[- ]stock\b/i.test(text) ||
    /\b(?:aapl|apple|nvda|nvidia|tsla|tesla|amd|amzn|amazon|msft|microsoft|meta|googl?|google|coin|coinbase|mstr|microstrategy|pltr|palantir|smci|super micro|avgo|broadcom|mu|nflx|netflix|hood|arm|intc|baba|aal|aaoi|abnb)\b/i.test(text)
  );
}

export function isInverseEtf(row: EtfUniverseRecord): boolean {
  const classification = rowClassification(row);
  if (typeof classification?.is_inverse === "boolean") return classification.is_inverse;
  const text = etfSearchText(row);
  return /\b(?:inverse|bear)\b/i.test(text) || /\bproshares\s+ultrashort\b/i.test(text);
}

function formatTypeHint(row: EtfUniverseRecord): string {
  const classification = rowClassification(row);
  const parts = [row.ticker, row.category];
  const factor = classification?.leverage_factor;
  if (typeof factor === "number" && Number.isFinite(factor)) {
    parts.push(`${factor.toFixed(factor % 1 === 0 ? 0 : 2)}x`);
  } else if (isLeveragedEtf(row)) {
    parts.push("레버리지");
  }
  if (classification?.is_single_stock) {
    parts.push(classification.underlying ? `단일종목 ${classification.underlying}` : "단일종목");
  }
  if (classification?.is_inverse) {
    parts.push("인버스");
  }
  return parts.filter(Boolean).join(" · ");
}

interface EtfUniverseCardProps {
  limit?: number;
  showOpenLink?: boolean;
  initialTypeFilter?: EtfTypeFilter;
  syncTypeParam?: boolean;
}

export default function EtfUniverseCard({ limit = 12, showOpenLink = true, initialTypeFilter = "전체", syncTypeParam = false }: EtfUniverseCardProps) {
  const [doc, setDoc] = useState<EtfUniverseDoc | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("전체");
  const [typeFilter, setTypeFilter] = useState<EtfTypeFilter>(initialTypeFilter);

  useEffect(() => {
    let cancelled = false;
    loadUniverse().then((nextDoc) => {
      if (!cancelled) {
        setDoc(nextDoc);
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

  const rows = useMemo(() => {
    const sourceRows = Array.isArray(doc?.records) ? doc.records : [];
    return sourceRows
      .filter((row) => typeof row.ticker === "string" && row.ticker.trim())
      .map((row) => ({
        ...row,
        ticker: row.ticker!.trim().toUpperCase(),
        name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : row.ticker!.trim().toUpperCase(),
        category: cleanCategory(row.category),
      }));
  }, [doc]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
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
    const q = query.trim().toUpperCase();
    return rows
      .filter((row) => category === "전체" || row.category === category)
      .filter((row) => {
        if (typeFilter === "레버리지") return isLeveragedEtf(row);
        if (typeFilter === "단일종목 레버리지") return isSingleStockLeveragedEtf(row);
        if (typeFilter === "인버스") return isInverseEtf(row);
        return true;
      })
      .filter((row) => !q || row.ticker.includes(q) || row.name.toUpperCase().includes(q))
      .sort((a, b) => (b.aum ?? -1) - (a.aum ?? -1))
      .slice(0, limit);
  }, [category, limit, query, rows, typeFilter]);

  const total = doc?.counts?.records ?? rows.length;
  const topCategory = categories[0];
  const typeOptions: Array<{ value: EtfTypeFilter; label: string; count: number | null }> = [
    { value: "전체", label: "전체", count: total },
    { value: "레버리지", label: "레버리지", count: typeCounts.leveraged },
    { value: "단일종목 레버리지", label: "단일종목", count: typeCounts.singleStock },
    { value: "인버스", label: "인버스", count: typeCounts.inverse },
  ];

  const handleTypeFilterChange = (nextFilter: EtfTypeFilter) => {
    setTypeFilter(nextFilter);
    if (!syncTypeParam || typeof window === "undefined") return;
    const nextUrl = new URL(window.location.href);
    const param = ETF_TYPE_PARAM[nextFilter];
    if (param) nextUrl.searchParams.set("type", param);
    else nextUrl.searchParams.delete("type");
    window.history.replaceState(null, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
  };

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>ETF 유니버스</h2>
        <span className="desc">{asOfDate(doc?.generated_at)} · {formatNumber(total)}개</span>
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
            {categories.slice(0, 16).map((item) => (
              <option key={item.name} value={item.name}>{item.name}</option>
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
        </div>

        {topCategory ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-500">
            최대 카테고리 <span className="text-slate-800">{topCategory.name}</span> · {formatNumber(topCategory.count)}개
          </div>
        ) : null}
      </div>

      <div className="mv-col">
        {!loaded ? (
          <div className="mv-row">
            <span className="co">
              <div className="n">ETF 목록 확인 중</div>
              <div className="tk">로컬 데이터팩을 읽고 있습니다</div>
            </span>
            <span className="pc num neutral">...</span>
          </div>
        ) : filteredRows.length > 0 ? (
          filteredRows.map((row) => (
            <TransitionLink key={row.ticker} href={`/etfs/${encodeURIComponent(row.ticker)}`} className="mv-row">
              <span className="co">
                <div className="n">{row.name}</div>
                <div className="tk">{formatTypeHint(row)}</div>
              </span>
              <span className="pc num neutral">{formatAum(row)}</span>
            </TransitionLink>
          ))
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
      <div className="panel-foot flex flex-wrap items-center justify-between gap-2">
        <span>AUM 상위 표시 · 각 행은 ETF 상세 탭으로 이동</span>
        {showOpenLink ? (
          <TransitionLink href="/etfs" className="font-black text-brand-interactive hover:underline">
            ETF 전체 보기
          </TransitionLink>
        ) : null}
      </div>
    </section>
  );
}
