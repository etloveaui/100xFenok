"use client";

import { useEffect, useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";

interface EtfUniverseRecord {
  ticker?: string;
  name?: string;
  category?: string;
  aum_raw?: string;
  aum?: number;
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

function formatNumber(value: number | null | undefined): string {
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

function asOfDate(value: string | null | undefined): string {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : "—";
}

export default function EtfUniverseCard() {
  const [doc, setDoc] = useState<EtfUniverseDoc | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("전체");

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

  const filteredRows = useMemo(() => {
    const q = query.trim().toUpperCase();
    return rows
      .filter((row) => category === "전체" || row.category === category)
      .filter((row) => !q || row.ticker.includes(q) || row.name.toUpperCase().includes(q))
      .sort((a, b) => (b.aum ?? -1) - (a.aum ?? -1))
      .slice(0, 12);
  }, [category, query, rows]);

  const total = doc?.counts?.records ?? rows.length;
  const topCategory = categories[0];

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>ETF 유니버스</h2>
        <span className="desc">{asOfDate(doc?.generated_at)} · {formatNumber(total)}개</span>
      </div>
      <div className="panel-b">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
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
            <TransitionLink key={row.ticker} href={`/stock/${encodeURIComponent(row.ticker)}`} className="mv-row">
              <span className="co">
                <div className="n">{row.name}</div>
                <div className="tk">{row.ticker} · {row.category}</div>
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
      <div className="panel-foot">
        AUM 상위 표시 · 각 행은 ETF 상세 탭으로 이동
      </div>
    </section>
  );
}
