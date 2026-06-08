"use client";

import { useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import { useScreenerData } from "@/hooks/useScreenerData";
import type { ScreenerSortKey, SortDir } from "@/lib/screener/types";
import { formatPercent, formatSignedPercentDecimal } from "@/lib/dashboard/formatters";

const PAGE_SIZE = 50;

const COUNTRY_LABEL: Record<string, string> = {
  US: "미국",
  KR: "한국",
  JP: "일본",
  CN: "중국",
  HK: "홍콩",
  XX: "기타",
};

const COLUMNS: ReadonlyArray<{ key: ScreenerSortKey; label: string; align: "left" | "right" }> = [
  { key: "ticker", label: "티커", align: "left" },
  { key: "name", label: "종목", align: "left" },
  { key: "sector", label: "섹터", align: "left" },
  { key: "country", label: "국가", align: "left" },
  { key: "price", label: "가격", align: "right" },
  { key: "marketCap", label: "시총", align: "right" },
  { key: "per", label: "PER", align: "right" },
  { key: "pbr", label: "PBR", align: "right" },
  { key: "dividendYield", label: "배당", align: "right" },
  { key: "return12m", label: "12M", align: "right" },
];

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function fmtMarketCap(mn: number | null): string {
  if (mn === null) return "—";
  if (mn >= 1_000_000) return `$${(mn / 1_000_000).toFixed(2)}T`;
  if (mn >= 1_000) return `$${(mn / 1_000).toFixed(1)}B`;
  return `$${Math.round(mn)}M`;
}
function fmtNum(value: number | null, digits = 2): string {
  return value === null ? "—" : value.toFixed(digits);
}
function fmtSignedPct(value: number | null): string {
  return value === null ? "—" : formatSignedPercentDecimal(value, 1);
}
function fmtYield(value: number | null): string {
  return value === null ? "—" : formatPercent(value, 2);
}

export default function ScreenerClient() {
  const { stocks, dataReady, failed, sourceDate, sectors, countries } = useScreenerData();

  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("");
  const [country, setCountry] = useState("");
  const [perMax, setPerMax] = useState("");
  const [profitableOnly, setProfitableOnly] = useState(false);
  const [sortKey, setSortKey] = useState<ScreenerSortKey>("marketCap");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const perMaxValue = perMax.trim() === "" ? null : Number(perMax);
    const perMaxValid = perMaxValue !== null && !Number.isNaN(perMaxValue);
    return stocks.filter((stock) => {
      if (query && !stock.ticker.toLowerCase().includes(query) && !stock.name.toLowerCase().includes(query)) {
        return false;
      }
      if (sector && stock.sector !== sector) return false;
      if (country && stock.country !== country) return false;
      if (profitableOnly && (stock.per === null || stock.per <= 0)) return false;
      if (perMaxValid && (stock.per === null || stock.per > (perMaxValue as number))) return false;
      return true;
    });
  }, [stocks, search, sector, country, perMax, profitableOnly]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null || av === undefined) return 1; // nulls always last
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  // Reset to first page when filters/sort change — store-previous-render pattern (React docs).
  const stateKey = `${search}|${sector}|${country}|${perMax}|${profitableOnly}|${sortKey}|${sortDir}`;
  const [prevStateKey, setPrevStateKey] = useState(stateKey);
  if (prevStateKey !== stateKey) {
    setPrevStateKey(stateKey);
    if (page !== 0) setPage(0);
  }

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  function toggleSort(key: ScreenerSortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      const textColumn = key === "ticker" || key === "name" || key === "sector" || key === "country";
      setSortDir(textColumn ? "asc" : "desc");
    }
  }

  function resetFilters() {
    setSearch("");
    setSector("");
    setCountry("");
    setPerMax("");
    setProfitableOnly(false);
  }

  const hasFilters = Boolean(search || sector || country || perMax || profitableOnly);

  return (
    <main className="container mx-auto max-w-6xl space-y-4 overflow-x-hidden px-3 py-4 sm:px-4 sm:py-6">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-brand-interactive">Stock Screener</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">종목 스크리너</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
            글로벌 {stocks.length.toLocaleString()}개 종목을 PER·PBR·배당·수익률로 거르고 줄세웁니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {sourceDate ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {sourceDate}
            </span>
          ) : null}
          <TransitionLink
            href="/sectors"
            className="inline-flex min-h-9 items-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-[0.12em] text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive"
          >
            섹터
          </TransitionLink>
        </div>
      </header>

      {failed ? (
        <div className="rounded-[1.2rem] border border-slate-300 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
          종목 데이터를 불러오지 못했습니다.
        </div>
      ) : null}

      {/* Filter bar */}
      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)]">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">검색</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="티커 또는 종목명"
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">섹터</span>
            <select
              value={sector}
              onChange={(event) => setSector(event.target.value)}
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
            >
              <option value="">전체 섹터</option>
              {sectors.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">국가</span>
            <select
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
            >
              <option value="">전체 국가</option>
              {countries.map((code) => (
                <option key={code} value={code}>
                  {COUNTRY_LABEL[code] ?? code}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">PER 최대</span>
            <input
              type="number"
              inputMode="decimal"
              value={perMax}
              onChange={(event) => setPerMax(event.target.value)}
              placeholder="예: 20"
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-700">
            <input
              type="checkbox"
              checked={profitableOnly}
              onChange={(event) => setProfitableOnly(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-interactive"
            />
            흑자 종목만 (PER &gt; 0)
          </label>
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-slate-500">
              <strong className="orbitron text-slate-900">{sorted.length.toLocaleString()}</strong>개 종목
            </span>
            {hasFilters ? (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex min-h-8 items-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-[0.1em] text-slate-600 transition hover:border-rose-300 hover:text-rose-600"
              >
                초기화
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {/* Table */}
      <section className={cx("rounded-[1.5rem] border border-slate-200 bg-white p-2 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)] sm:p-3", !dataReady && "opacity-60")}>
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">
                {COLUMNS.map((column) => {
                  const active = column.key === sortKey;
                  return (
                    <th key={column.key} className={cx("px-2 py-2", column.align === "right" ? "text-right" : "text-left")}>
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className={cx(
                          "inline-flex items-center gap-1 transition hover:text-slate-900",
                          column.align === "right" && "flex-row-reverse",
                          active && "text-brand-interactive",
                        )}
                        aria-pressed={active}
                      >
                        {column.label}
                        <span className="text-[9px]">{active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((stock) => (
                <tr key={stock.ticker} className="border-b border-slate-100 transition last:border-0 hover:bg-slate-50">
                  <td className="px-2 py-2 text-left">
                    <span className="text-sm font-black text-slate-950">{stock.ticker}</span>
                  </td>
                  <td className="max-w-[200px] truncate px-2 py-2 text-left text-sm font-semibold text-slate-700">{stock.name}</td>
                  <td className="px-2 py-2 text-left text-xs font-bold text-slate-500">{stock.sector || "—"}</td>
                  <td className="px-2 py-2 text-left text-xs font-bold text-slate-500">{COUNTRY_LABEL[stock.country] ?? stock.country ?? "—"}</td>
                  <td className="orbitron px-2 py-2 text-right tabular-nums text-slate-900">{stock.price === null ? "—" : `$${stock.price.toFixed(2)}`}</td>
                  <td className="orbitron px-2 py-2 text-right tabular-nums text-slate-700">{fmtMarketCap(stock.marketCap)}</td>
                  <td className="orbitron px-2 py-2 text-right tabular-nums text-slate-900">{fmtNum(stock.per, 1)}</td>
                  <td className="orbitron px-2 py-2 text-right tabular-nums text-slate-700">{fmtNum(stock.pbr, 2)}</td>
                  <td className="orbitron px-2 py-2 text-right tabular-nums text-slate-600">{fmtYield(stock.dividendYield)}</td>
                  <td
                    className={cx(
                      "orbitron px-2 py-2 text-right font-black tabular-nums",
                      stock.return12m === null ? "text-slate-300" : stock.return12m >= 0 ? "text-emerald-600" : "text-rose-600",
                    )}
                  >
                    {fmtSignedPct(stock.return12m)}
                  </td>
                </tr>
              ))}
              {dataReady && pageRows.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-2 py-10 text-center text-sm font-semibold text-slate-500">
                    조건에 맞는 종목이 없습니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {sorted.length > PAGE_SIZE ? (
          <div className="mt-3 flex items-center justify-between gap-3 px-2">
            <button
              type="button"
              onClick={() => setPage((value) => Math.max(0, value - 1))}
              disabled={safePage === 0}
              className="inline-flex min-h-9 items-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700 transition enabled:hover:border-brand-interactive disabled:opacity-40"
            >
              이전
            </button>
            <span className="orbitron text-xs font-bold tabular-nums text-slate-600">
              {safePage + 1} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
              disabled={safePage >= pageCount - 1}
              className="inline-flex min-h-9 items-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700 transition enabled:hover:border-brand-interactive disabled:opacity-40"
            >
              다음
            </button>
          </div>
        ) : null}
      </section>

      <p className="px-1 text-[11px] text-slate-400">
        데이터: Global Scouter (정렬 시 결측치는 항상 뒤로 정렬). 투자 판단의 근거가 아닌 참고용입니다.
      </p>
    </main>
  );
}
