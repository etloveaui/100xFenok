"use client";

import { useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import { useScreenerData } from "@/hooks/useScreenerData";
import type { ScreenerSortKey, SortDir, ScreenerStock } from "@/lib/screener/types";
import { formatPercent, formatSignedPercentDecimal } from "@/lib/dashboard/formatters";
import { bandPct, bandClass, bandLabel, BAND_CHEAP, BAND_RICH } from "@/lib/screener/bands";
import StockDetailPanel from "./StockDetailPanel";

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
  { key: "roe", label: "ROE", align: "right" },
  { key: "opm", label: "OPM", align: "right" },
  { key: "eps", label: "EPS", align: "right" },
  { key: "growthRate", label: "3M", align: "right" },
  { key: "momentum1m", label: "1M", align: "right" },
  { key: "momentum6m", label: "6M", align: "right" },
  { key: "momentum12m", label: "12M", align: "right" },
  { key: "rank", label: "Rank", align: "right" },
  { key: "perBandCurrent", label: "PER밴드", align: "left" },
  { key: "peForward", label: "Fwd PER", align: "right" },
  { key: "epsForward", label: "Fwd EPS", align: "right" },
  { key: "dividendTtm", label: "Div TTM", align: "right" },
  { key: "ret1y", label: "1Y", align: "right" },
  { key: "ret3y", label: "3Y", align: "right" },
  { key: "ret5y", label: "5Y", align: "right" },
];

type ColumnPreset = "basic" | "value" | "momentum" | "dividend";

const PRESET_KEYS: Record<ColumnPreset, ScreenerSortKey[]> = {
  basic: ["ticker", "name", "sector", "country", "price", "marketCap", "per", "pbr", "dividendYield", "return12m"],
  value: ["ticker", "name", "sector", "per", "peForward", "pbr", "roe", "opm", "eps", "perBandCurrent", "rank"],
  momentum: ["ticker", "name", "sector", "growthRate", "momentum1m", "momentum6m", "momentum12m", "rank"],
  dividend: ["ticker", "name", "sector", "dividendYield", "dividendTtm", "ret1y", "ret3y", "ret5y", "per", "pbr", "marketCap"],
};

const PRESET_LABEL: Record<ColumnPreset, string> = {
  basic: "기본",
  value: "밸류",
  momentum: "모멘텀",
  dividend: "배당",
};

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
  return value === null ? "—" : formatPercent(value * 100, 2);
}
function fmtRoe(value: number | null): string {
  return value === null ? "—" : formatPercent(value * 100, 1);
}
function fmtOpm(value: number | null): string {
  return value === null ? "—" : formatPercent(value * 100, 1);
}
function fmtEps(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}
function fmtRank(value: number | null): string {
  return value === null ? "—" : value.toLocaleString();
}

function getMomentumClass(value: number | null): string {
  if (value === null) return "text-slate-300";
  return value >= 0 ? "text-emerald-600" : "text-rose-600";
}

const BADGE_CLASS_MAP: Record<string, string> = {
  emerald: "bg-emerald-100 text-emerald-700",
  slate: "bg-slate-100 text-slate-600",
  rose: "bg-rose-100 text-rose-700",
};

const DOT_CLASS_MAP: Record<string, string> = {
  emerald: "bg-emerald-500",
  slate: "bg-slate-500",
  rose: "bg-rose-500",
};

function PerBandBar({ current, min, avg, max }: { current: number | null; min: number | null; avg: number | null; max: number | null }) {
  if (current === null || min === null || max === null || min >= max) {
    return <span className="text-slate-300">—</span>;
  }
  const pct = bandPct(current, min, max);
  const avgPct = avg !== null ? bandPct(avg, min, max) : null;
  const cls = bandClass(pct);
  const label = bandLabel(pct);
  const badgeClass = BADGE_CLASS_MAP[cls];
  const dotClass = DOT_CLASS_MAP[cls];
  const title = `현재 ${current.toFixed(1)} · 평균 ${avg?.toFixed(1) ?? "—"} · 8Y ${min.toFixed(1)}~${max.toFixed(1)} · ${Math.round(pct * 100)}%`;

  return (
    <div className="inline-flex items-center gap-2" title={title}>
      <div className="relative h-2 w-16 rounded-full bg-slate-200">
        {avgPct !== null && (
          <div className="absolute top-0 h-full w-px bg-slate-400" style={{ left: `${avgPct * 100}%` }} />
        )}
        <div
          className={cx("absolute top-1/2 h-2.5 w-2.5 rounded-full border-2 border-white", dotClass)}
          style={{ left: `${pct * 100}%`, transform: "translate(-50%, -50%)" }}
        />
      </div>
      <span className={cx("orbitron tabular-nums rounded px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide", badgeClass)}>
        {label} {Math.round(pct * 100)}%
      </span>
    </div>
  );
}

function renderCell(stock: ScreenerStock, key: ScreenerSortKey): React.ReactNode {
  switch (key) {
    case "ticker":
      return <span className="text-sm font-black text-slate-950">{stock.ticker}</span>;
    case "name":
      return <span className="block max-w-[180px] truncate text-sm font-semibold text-slate-700">{stock.name}</span>;
    case "sector":
      return <span className="text-xs font-bold text-slate-500">{stock.sector || "—"}</span>;
    case "country":
      return <span className="text-xs font-bold text-slate-500">{COUNTRY_LABEL[stock.country] ?? stock.country ?? "—"}</span>;
    case "price":
      return <span className="orbitron tabular-nums text-slate-900">{stock.price === null ? "—" : `$${stock.price.toFixed(2)}`}</span>;
    case "marketCap":
      return <span className="orbitron tabular-nums text-slate-700">{fmtMarketCap(stock.marketCap)}</span>;
    case "per":
      return <span className="orbitron tabular-nums text-slate-900">{fmtNum(stock.per, 1)}</span>;
    case "pbr":
      return <span className="orbitron tabular-nums text-slate-700">{fmtNum(stock.pbr, 2)}</span>;
    case "dividendYield":
      return <span className="orbitron tabular-nums text-slate-600">{fmtYield(stock.dividendYield)}</span>;
    case "return12m":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.return12m))}>{fmtSignedPct(stock.return12m)}</span>;
    case "roe":
      return <span className="orbitron tabular-nums text-slate-900">{fmtRoe(stock.roe)}</span>;
    case "opm":
      return <span className="orbitron tabular-nums text-slate-700">{fmtOpm(stock.opm)}</span>;
    case "eps":
      return <span className="orbitron tabular-nums text-slate-900">{fmtEps(stock.eps)}</span>;
    case "growthRate":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.growthRate))}>{fmtSignedPct(stock.growthRate)}</span>;
    case "momentum1m":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.momentum1m))}>{fmtSignedPct(stock.momentum1m)}</span>;
    case "momentum6m":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.momentum6m))}>{fmtSignedPct(stock.momentum6m)}</span>;
    case "momentum12m":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.momentum12m))}>{fmtSignedPct(stock.momentum12m)}</span>;
    case "rank":
      return <span className="orbitron tabular-nums text-slate-600">{fmtRank(stock.rank)}</span>;
    case "perBandCurrent":
      return <PerBandBar current={stock.perBandCurrent} min={stock.perBandMin} avg={stock.perBandAvg} max={stock.perBandMax} />;
    case "peForward":
      return <span className="orbitron tabular-nums text-slate-900">{fmtNum(stock.peForward, 1)}</span>;
    case "epsForward":
      return <span className="orbitron tabular-nums text-slate-700">{fmtEps(stock.epsForward)}</span>;
    case "dividendTtm":
      return <span className="orbitron tabular-nums text-slate-600">{stock.dividendTtm === null ? "—" : `$${stock.dividendTtm.toFixed(2)}`}</span>;
    case "ret1y":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.ret1y))}>{fmtSignedPct(stock.ret1y)}</span>;
    case "ret3y":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.ret3y))}>{fmtSignedPct(stock.ret3y)}</span>;
    case "ret5y":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.ret5y))}>{fmtSignedPct(stock.ret5y)}</span>;
    default:
      return "—";
  }
}

export default function ScreenerClient() {
  const { stocks, dataReady, failed, sourceDate, sectors, countries } = useScreenerData();

  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("");
  const [country, setCountry] = useState("");
  const [perMax, setPerMax] = useState("");
  const [profitableOnly, setProfitableOnly] = useState(false);
  const [bandFilter, setBandFilter] = useState<"" | "cheap" | "fair" | "rich">("");
  const [sortKey, setSortKey] = useState<ScreenerSortKey>("marketCap");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);

  const [preset, setPreset] = useState<ColumnPreset>(() => {
    if (typeof window === "undefined") return "basic";
    const saved = localStorage.getItem("screener-preset") as ColumnPreset | null;
    return saved && PRESET_KEYS[saved] ? saved : "basic";
  });

  const activeColumns = useMemo(() => {
    const keys = new Set(PRESET_KEYS[preset]);
    return COLUMNS.filter((c) => keys.has(c.key));
  }, [preset]);

  function handlePresetChange(next: ColumnPreset) {
    setPreset(next);
    localStorage.setItem("screener-preset", next);
    // Reset sort to a column that exists in the new preset
    const validKeys = PRESET_KEYS[next];
    if (!validKeys.includes(sortKey)) {
      setSortKey("marketCap");
      setSortDir("desc");
    }
  }

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
      if (perMaxValid && (stock.per === null || stock.per <= 0 || stock.per > (perMaxValue as number))) return false;
      if (bandFilter) {
        if (stock.perBandCurrent === null || stock.perBandMin === null || stock.perBandMax === null) return false;
        const pct = bandPct(stock.perBandCurrent, stock.perBandMin, stock.perBandMax);
        if (bandFilter === "cheap" && pct > BAND_CHEAP) return false;
        if (bandFilter === "fair" && (pct <= BAND_CHEAP || pct >= BAND_RICH)) return false;
        if (bandFilter === "rich" && pct < BAND_RICH) return false;
      }
      return true;
    });
  }, [stocks, search, sector, country, perMax, profitableOnly, bandFilter]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  const stateKey = `${search}|${sector}|${country}|${perMax}|${profitableOnly}|${bandFilter}|${sortKey}|${sortDir}|${preset}`;
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
    setBandFilter("");
  }

  const hasFilters = Boolean(search || sector || country || perMax || profitableOnly || bandFilter);

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
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">PER 밴드</span>
            <select
              value={bandFilter}
              onChange={(event) => setBandFilter(event.target.value as "" | "cheap" | "fair" | "rich")}
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
            >
              <option value="">전체 밴드</option>
              <option value="cheap">저평가 (하위 25%)</option>
              <option value="fair">적정 (중간 50%)</option>
              <option value="rich">고평가 (상위 25%)</option>
            </select>
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

      {/* Preset selector */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">뷰</span>
        {(Object.keys(PRESET_KEYS) as ColumnPreset[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => handlePresetChange(p)}
            className={cx(
              "inline-flex min-h-7 items-center rounded-full px-3 text-[11px] font-black uppercase tracking-[0.1em] transition",
              preset === p
                ? "border border-brand-interactive bg-brand-interactive/10 text-brand-interactive"
                : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900",
            )}
          >
            {PRESET_LABEL[p]}
          </button>
        ))}
      </div>

      {/* Table */}
      <section className={cx("rounded-[1.5rem] border border-slate-200 bg-white p-2 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)] sm:p-3", !dataReady && "opacity-60")}>
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">
                {activeColumns.map((column) => {
                  const active = column.key === sortKey;
                  return (
                    <th
                      key={column.key}
                      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                      className={cx("px-2 py-2", column.align === "right" ? "text-right" : "text-left")}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className={cx(
                          "inline-flex items-center gap-1 transition hover:text-slate-900",
                          column.align === "right" && "flex-row-reverse",
                          active && "text-brand-interactive",
                        )}
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
                <>
                  <tr
                    key={stock.ticker}
                    onClick={() =>
                      setExpandedTicker((prev) => (prev === stock.ticker ? null : stock.ticker))
                    }
                    className="cursor-pointer border-b border-slate-100 transition last:border-0 hover:bg-slate-50"
                  >
                    {activeColumns.map((column) => (
                      <td
                        key={column.key}
                        className={cx("px-2 py-2", column.align === "right" ? "text-right" : "text-left")}
                      >
                        {renderCell(stock, column.key)}
                      </td>
                    ))}
                  </tr>
                  {expandedTicker === stock.ticker ? (
                    <tr key={`${stock.ticker}-detail`}>
                      <td colSpan={activeColumns.length} className="p-0">
                        <StockDetailPanel ticker={stock.ticker} />
                      </td>
                    </tr>
                  ) : null}
                </>
              ))}
              {dataReady && pageRows.length === 0 ? (
                <tr>
                  <td colSpan={activeColumns.length} className="px-2 py-10 text-center text-sm font-semibold text-slate-500">
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
