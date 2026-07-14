"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import TickerChip from "@/components/TickerChip";
import TransitionLink from "@/components/TransitionLink";
import { DATA_STATE_LABELS } from "@/lib/data-state";
import { ROUTES } from "@/lib/routes";
import { formatCurrencyCompact } from "@/lib/format";

interface SurfaceDoc<T = EventRow> {
  fetched_at?: string | null;
  source_as_of?: string | null;
  source_as_of_reason?: string | null;
  counts?: Record<string, number | null | undefined> | null;
  records?: T[];
  tables?: Array<{ records?: T[] }>;
}

type EventRow = Record<string, unknown>;
type IndustrySort = "marketCap" | "oneYear" | "oneDay" | "stocks" | "profitMargin" | "peRatio";
type IndustryTrend = "all" | "up" | "down" | "profitable" | "large";

interface IndustryData {
  industries: SurfaceDoc;
  technology: SurfaceDoc;
  semiconductors: SurfaceDoc;
}

interface IndustryMapRow {
  id: string;
  name: string;
  href: string;
  stocks: number | null;
  stocksRaw: string;
  marketCap: number | null;
  marketCapRaw: string;
  divYieldRaw: string;
  peRatio: number | null;
  peRatioRaw: string;
  profitMargin: number | null;
  profitMarginRaw: string;
  oneDayChange: number | null;
  oneDayRaw: string;
  oneYearChange: number | null;
  oneYearRaw: string;
  sizePct: number;
  searchText: string;
}

interface LocalIndustrySurface {
  id: string;
  title: string;
  description: string;
  doc: SurfaceDoc | null | undefined;
  rows: EventRow[];
}

const INDUSTRY_SURFACES: Record<keyof IndustryData, string> = {
  industries: "industries_all",
  technology: "sector_technology",
  semiconductors: "industry_semiconductors",
};

let cache: IndustryData | null = null;
let pending: Promise<IndustryData | null> | null = null;

function loadSurface(name: string): Promise<SurfaceDoc> {
  return fetch(`/api/data/stockanalysis/surfaces/${name}`, { cache: "no-store" })
    .then((response) => (response.ok ? response.json() as Promise<SurfaceDoc> : {}))
    .catch(() => ({}));
}

function loadIndustryData(): Promise<IndustryData | null> {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;
  pending = Promise.all(
    Object.entries(INDUSTRY_SURFACES).map(([key, surface]) => (
      loadSurface(surface).then((doc) => [key, doc] as const)
    )),
  ).then((entries) => {
    const nextData: Partial<IndustryData> = {};
    entries.forEach(([key, doc]) => {
      nextData[key as keyof IndustryData] = doc;
    });
    cache = nextData as IndustryData;
    return cache;
  }).catch(() => null);
  return pending;
}

function rowsOf<T extends EventRow = EventRow>(doc: SurfaceDoc<T> | null | undefined): T[] {
  const records = Array.isArray(doc?.records) ? doc.records : [];
  const tableRows = Array.isArray(doc?.tables)
    ? doc.tables.flatMap((table) => (Array.isArray(table?.records) ? table.records : []))
    : [];
  return [...records, ...tableRows];
}

function text(value: unknown, fallback = "-"): string {
  if (value === null || value === undefined) return fallback;
  const next = String(value).trim();
  return next && next !== "-" ? next : fallback;
}

function surfaceTimeLabel(doc: SurfaceDoc | null | undefined): string {
  const sourceDate = typeof doc?.source_as_of === "string" ? doc.source_as_of.trim().slice(0, 10) : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(sourceDate)) return `기준 ${sourceDate}`;
  const collectedDate = typeof doc?.fetched_at === "string" ? doc.fetched_at.trim().slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(collectedDate) ? `수집 ${collectedDate}` : "원천 기준일 미제공";
}

function countRows(doc: SurfaceDoc | null | undefined): number {
  const counts = doc?.counts ?? {};
  const value = counts.records ?? counts.rows;
  if (typeof value === "number") return value;
  return rowsOf(doc).length;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function numericValue(value: unknown): number | null {
  const raw = text(value, "").replace(/,/g, "").replace(/%$/, "").trim();
  if (!raw) return null;
  const matched = raw.match(/^(-?\d+(?:\.\d+)?)([KMBT])?$/i);
  if (!matched) return null;
  const number = Number(matched[1]);
  if (!Number.isFinite(number)) return null;
  const unit = matched[2]?.toUpperCase();
  const multiplier = unit === "T" ? 1_000_000_000_000
    : unit === "B" ? 1_000_000_000
      : unit === "M" ? 1_000_000
        : unit === "K" ? 1_000
          : 1;
  return number * multiplier;
}

function ratioValue(value: unknown): number | null {
  return numericValue(value);
}

function positiveNegativeClass(value: number | null): string {
  if (value === null) return "neutral";
  if (value < 0) return "down";
  if (value > 0) return "up";
  return "neutral";
}

function compareNumbers(a: number | null, b: number | null, direction: "asc" | "desc" = "desc"): number {
  const emptyA = a === null || !Number.isFinite(a);
  const emptyB = b === null || !Number.isFinite(b);
  if (emptyA && emptyB) return 0;
  if (emptyA) return 1;
  if (emptyB) return -1;
  return direction === "asc" ? a - b : b - a;
}

function rowSymbol(row: EventRow): string {
  return text(row.symbol).replace(/^\$/, "").toUpperCase();
}

function buildIndustryMapRows(data: IndustryData | null): IndustryMapRow[] {
  const baseRows = rowsOf(data?.industries);
  const maxMarketCap = Math.max(
    ...baseRows.map((row) => numericValue(row.market_cap) ?? 0),
    1,
  );
  return baseRows.map((row, index) => {
    const name = text(row.industry_name);
    const marketCap = numericValue(row.market_cap);
    const oneYearChange = ratioValue(row["1y_change"]);
    const oneDayChange = ratioValue(row["1d_change"]);
    const profitMargin = ratioValue(row.profit_margin);
    const peRatio = ratioValue(row.pe_ratio);
    const stocks = numericValue(row.stocks);
    const sizePct = marketCap === null ? 6 : Math.max(6, Math.min(100, Math.round((marketCap / maxMarketCap) * 100)));
    return {
      id: `${name}-${index}`,
      name,
      href: text(row.industry_name_href, ""),
      stocks,
      stocksRaw: text(row.stocks),
      marketCap,
      marketCapRaw: text(row.market_cap),
      divYieldRaw: text(row.div_yield),
      peRatio,
      peRatioRaw: text(row.pe_ratio),
      profitMargin,
      profitMarginRaw: text(row.profit_margin),
      oneDayChange,
      oneDayRaw: text(row["1d_change"]),
      oneYearChange,
      oneYearRaw: text(row["1y_change"]),
      sizePct,
      searchText: [name, row.industry_name_href, row.stocks, row.market_cap, row.profit_margin, row["1d_change"], row["1y_change"]]
        .map((value) => text(value, ""))
        .join(" ")
        .toLowerCase(),
    };
  });
}

function sortIndustryRows(rows: IndustryMapRow[], sort: IndustrySort): IndustryMapRow[] {
  const next = [...rows];
  if (sort === "oneYear") return next.sort((a, b) => compareNumbers(a.oneYearChange, b.oneYearChange) || a.name.localeCompare(b.name));
  if (sort === "oneDay") return next.sort((a, b) => compareNumbers(a.oneDayChange, b.oneDayChange) || a.name.localeCompare(b.name));
  if (sort === "stocks") return next.sort((a, b) => compareNumbers(a.stocks, b.stocks) || a.name.localeCompare(b.name));
  if (sort === "profitMargin") return next.sort((a, b) => compareNumbers(a.profitMargin, b.profitMargin) || a.name.localeCompare(b.name));
  if (sort === "peRatio") return next.sort((a, b) => compareNumbers(a.peRatio, b.peRatio, "asc") || a.name.localeCompare(b.name));
  return next.sort((a, b) => compareNumbers(a.marketCap, b.marketCap) || a.name.localeCompare(b.name));
}

function filterIndustryRows(rows: IndustryMapRow[], query: string, trend: IndustryTrend): IndustryMapRow[] {
  const needle = query.trim().toLowerCase();
  return rows
    .filter((row) => !needle || row.searchText.includes(needle))
    .filter((row) => {
      if (trend === "up") return row.oneYearChange !== null && row.oneYearChange >= 0;
      if (trend === "down") return row.oneYearChange !== null && row.oneYearChange < 0;
      if (trend === "profitable") return row.profitMargin !== null && row.profitMargin > 0;
      if (trend === "large") return row.marketCap !== null && row.marketCap >= 1_000_000_000_000;
      return true;
    });
}

function hasIndustryConstituentDetail(row: IndustryMapRow | null | undefined): boolean {
  return row?.name.toLowerCase() === "semiconductors";
}

function industryDetailStatus(row: IndustryMapRow | null | undefined): string {
  if (!row) return "-";
  return hasIndustryConstituentDetail(row) ? "구성종목 상세 있음" : "기본 정보";
}

function industryConstituentRows(data: IndustryData | null, row: IndustryMapRow | null | undefined): EventRow[] {
  if (!row || !hasIndustryConstituentDetail(row)) return [];
  return rowsOf(data?.semiconductors);
}

function localIndustrySurfaces(data: IndustryData | null): LocalIndustrySurface[] {
  return [
    {
      id: "technology",
      title: "기술 섹터 구성종목",
      description: "섹터 단위 구성종목 표본",
      doc: data?.technology,
      rows: rowsOf(data?.technology),
    },
    {
      id: "semiconductors",
      title: "반도체 산업 구성종목",
      description: "산업 단위 구성종목 상세",
      doc: data?.semiconductors,
      rows: rowsOf(data?.semiconductors),
    },
  ];
}

function csvCell(value: string | number | null | undefined): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadIndustryCsv(rows: IndustryMapRow[]) {
  const header = ["산업", "종목 수", "시가총액", "배당수익률", "PER", "순이익률", "1일 변화", "1년 변화", "참고 링크"];
  const lines = [
    header.map(csvCell).join(","),
    ...rows.map((row) => [
      row.name,
      row.stocksRaw,
      row.marketCapRaw,
      row.divYieldRaw,
      row.peRatioRaw,
      row.profitMarginRaw,
      row.oneDayRaw,
      row.oneYearRaw,
      row.href,
    ].map(csvCell).join(",")),
  ];
  const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `100x-industry-map-${todayIso()}.csv`;
  anchor.click();
  URL.revokeObjectURL(href);
}

function EmptyRows({ label }: { label: string }) {
  return (
    <div className="mv-row">
      <span className="co">
        <div className="n">표시할 데이터 없음</div>
        <div className="tk">{label}</div>
      </span>
      <span className="pc num neutral">-</span>
    </div>
  );
}

function IndustryConstituentList({
  rows,
  limit = 8,
  emptyLabel,
}: {
  rows: EventRow[];
  limit?: number;
  emptyLabel: string;
}) {
  const visible = rows.slice(0, limit);
  return (
    <div className="mv-col">
      {visible.length ? visible.map((row, index) => {
        const symbol = rowSymbol(row);
        return (
          <div key={`${symbol || index}-${index}`} className="mv-row">
            <span className="co">
              <div className="n">{symbol ? <TickerChip ticker={symbol} variant="inline" /> : index + 1} · {text(row.company_name)}</div>
              <div className="tk">거래량 {text(row.volume)} · 매출 {text(row.revenue)}</div>
            </span>
            <span className="pc num neutral">{text(row.market_cap)}</span>
          </div>
        );
      }) : <EmptyRows label={emptyLabel} />}
    </div>
  );
}

export default function IndustryMapPanel({ bridgeText }: { bridgeText?: string | null } = {}) {
  const [data, setData] = useState<IndustryData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [industryQuery, setIndustryQuery] = useState("");
  const [industryTrend, setIndustryTrend] = useState<IndustryTrend>("all");
  const [industrySort, setIndustrySort] = useState<IndustrySort>("marketCap");
  const [industryLimit, setIndustryLimit] = useState(36);
  const [selectedIndustryId, setSelectedIndustryId] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadIndustryData().then((next) => {
      if (!cancelled) {
        setData(next);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const industryRows = useMemo(() => buildIndustryMapRows(data), [data]);
  const filteredIndustries = useMemo(() => (
    sortIndustryRows(filterIndustryRows(industryRows, industryQuery, industryTrend), industrySort)
  ), [industryQuery, industryRows, industrySort, industryTrend]);
  const visibleIndustries = filteredIndustries.slice(0, industryLimit);
  const topIndustry = useMemo(() => sortIndustryRows(industryRows, "marketCap")[0], [industryRows]);
  const risingCount = useMemo(() => (
    industryRows.filter((row) => row.oneYearChange !== null && row.oneYearChange >= 0).length
  ), [industryRows]);
  const profitableCount = useMemo(() => (
    industryRows.filter((row) => row.profitMargin !== null && row.profitMargin > 0).length
  ), [industryRows]);
  const selectedIndustry = useMemo(() => (
    industryRows.find((row) => row.id === selectedIndustryId)
    ?? filteredIndustries[0]
    ?? topIndustry
    ?? null
  ), [filteredIndustries, industryRows, selectedIndustryId, topIndustry]);
  const selectedConstituents = useMemo(() => industryConstituentRows(data, selectedIndustry), [data, selectedIndustry]);
  const localSurfaces = useMemo(() => localIndustrySurfaces(data), [data]);
  const localSurfaceCount = localSurfaces.filter((surface) => surface.rows.length > 0).length;

  if (!loaded) {
    return (
      <section className="panel">
        <div className="mv-row">
          <span className="co">
            <div className="n">{DATA_STATE_LABELS.pending}</div>
            <div className="tk">산업별 요약과 구성종목 자료를 읽고 있습니다</div>
          </span>
          <span className="pc num neutral">...</span>
        </div>
      </section>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
      {bridgeText ? (
        <p className="cpw5-sectors-bridge xl:col-span-2">{bridgeText}</p>
      ) : null}
      <section className="panel">
        <div className="panel-h">
          <h2>산업 지도</h2>
          <span className="desc">
            {filteredIndustries.length.toLocaleString("ko-KR")} / {industryRows.length.toLocaleString("ko-KR")}개
          </span>
        </div>
        <div className="panel-b">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 py-2 text-[12px] font-bold text-[var(--c-ink-3)]">
            <span>GICS 산업명은 표준 분류명 그대로 표시합니다. 시장 이벤트의 산업 흐름은 이 섹터 화면에서 이어서 확인합니다.</span>
            <TransitionLink href={ROUTES.marketEvents} className="font-black text-brand-interactive hover:underline">
              이벤트 보기
            </TransitionLink>
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <div className="text-[11px] font-black text-slate-600">가장 큰 산업</div>
              <div className="mt-1 truncate text-sm font-black text-slate-800">{topIndustry?.name ?? "-"}</div>
              <div className="mt-0.5 text-xs font-bold text-slate-500">{topIndustry?.marketCap !== null && topIndustry?.marketCap !== undefined ? formatCurrencyCompact(topIndustry.marketCap, "USD") : "—"}</div>
            </div>
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2">
              <div className="text-[11px] font-black text-emerald-800">1년 상승</div>
              <div className="mt-1 text-sm font-black text-emerald-800">{risingCount.toLocaleString("ko-KR")}개 산업</div>
              <div className="mt-0.5 text-xs font-bold text-emerald-700">전체 산업 기준</div>
            </div>
            <div className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2">
              <div className="text-[11px] font-black text-sky-800">순이익률 플러스</div>
              <div className="mt-1 text-sm font-black text-sky-800">{profitableCount.toLocaleString("ko-KR")}개 산업</div>
              <div className="mt-0.5 text-xs font-bold text-sky-700">순이익률 0% 초과</div>
            </div>
            <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 md:col-span-3">
              <div className="text-[11px] font-black text-brand-navy">구성종목 상세</div>
              <div className="mt-1 text-sm font-black text-brand-navy">{localSurfaceCount.toLocaleString("ko-KR")}개 자료</div>
              <div className="mt-0.5 text-xs font-bold text-brand-navy">
                산업 전체는 요약 기준, 구성종목 상세는 현재 기술 섹터와 반도체 산업부터 제공합니다.
              </div>
            </div>
          </div>
          <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_9rem_10rem_7rem]">
            <input
              value={industryQuery}
              onChange={(event) => {
                setIndustryQuery(event.target.value);
                setIndustryLimit(36);
              }}
              placeholder="산업명 검색"
              className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-brand-interactive"
            />
            <select
              value={industryTrend}
              onChange={(event) => {
                setIndustryTrend(event.target.value as IndustryTrend);
                setIndustryLimit(36);
              }}
              className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-brand-interactive"
              aria-label="산업 조건"
            >
              <option value="all">전체 조건</option>
              <option value="up">1년 상승</option>
              <option value="down">1년 하락</option>
              <option value="profitable">순이익률 플러스</option>
              <option value="large">시총 $1T 이상</option>
            </select>
            <select
              value={industrySort}
              onChange={(event) => setIndustrySort(event.target.value as IndustrySort)}
              className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-brand-interactive"
              aria-label="산업 정렬"
            >
              <option value="marketCap">시가총액순</option>
              <option value="oneYear">1년 변화순</option>
              <option value="oneDay">1일 변화순</option>
              <option value="stocks">종목 수순</option>
              <option value="profitMargin">순이익률순</option>
              <option value="peRatio">PER 낮은순</option>
            </select>
            <button
              type="button"
              onClick={() => downloadIndustryCsv(filteredIndustries)}
              disabled={!filteredIndustries.length}
              className="min-h-10 rounded-lg border border-slate-200 bg-slate-900 px-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              CSV 저장
            </button>
          </div>
        </div>
        <div className="panel-b pt-0">
          <div className="grid auto-rows-[132px] gap-2 md:grid-cols-3 xl:grid-cols-4">
            {visibleIndustries.length ? visibleIndustries.map((row) => {
              const tone = positiveNegativeClass(row.oneYearChange);
              const trendLabel = tone === "up" ? "상승" : tone === "down" ? "하락" : "보합";
              const selected = selectedIndustry?.id === row.id;
              const spanClass = row.marketCap !== null && row.marketCap >= 5_000_000_000_000
                ? "md:col-span-2 md:row-span-2"
                : row.marketCap !== null && row.marketCap >= 1_000_000_000_000
                  ? "md:col-span-2"
                  : "";
              const toneClass = tone === "up"
                ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                : tone === "down"
                  ? "border-rose-200 bg-rose-50 text-rose-950"
                  : "border-slate-200 bg-slate-50 text-slate-800";
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setSelectedIndustryId(row.id)}
                  className={`flex min-w-0 flex-col justify-between rounded-lg border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-interactive ${toneClass} ${spanClass} ${selected ? "ring-2 ring-brand-interactive" : ""}`}
                  aria-pressed={selected}
                  aria-label={`${row.name} 산업 요약 보기`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black">{row.name}</div>
                    <div className="mt-1 text-[11px] font-bold opacity-95">
                      {row.stocksRaw}개 종목 · 시총 {row.marketCap !== null ? formatCurrencyCompact(row.marketCap, "USD") : "—"}
                    </div>
                    <div className="mt-2 inline-flex rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-black opacity-90">
                      {industryDetailStatus(row)}
                    </div>
                  </div>
                  <div>
                    <div className="grid grid-cols-3 gap-2 text-[11px] font-black">
                      <span>1일 {row.oneDayRaw}</span>
                      <span>{trendLabel} · 1년 {row.oneYearRaw}</span>
                      <span>순이익률 {row.profitMarginRaw}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/70">
                      <div
                        className={tone === "down" ? "h-full rounded-full bg-rose-500" : tone === "up" ? "h-full rounded-full bg-emerald-500" : "h-full rounded-full bg-slate-400"}
                        style={{ width: `${row.sizePct}%` } as CSSProperties}
                      />
                    </div>
                  </div>
                </button>
              );
            }) : <EmptyRows label="조건에 맞는 산업이 없습니다." />}
          </div>
          {filteredIndustries.length > visibleIndustries.length ? (
            <button
              type="button"
              onClick={() => setIndustryLimit(industryLimit + 36)}
              className="mt-3 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 hover:border-brand-interactive hover:text-brand-interactive"
            >
              더 보기 {visibleIndustries.length.toLocaleString("ko-KR")} / {filteredIndustries.length.toLocaleString("ko-KR")}
            </button>
          ) : null}
        </div>
      </section>

      <div className="grid gap-4">
        <section className="panel">
          <div className="panel-h">
            <h2>선택 산업</h2>
            <span className="desc">{industryDetailStatus(selectedIndustry)}</span>
          </div>
          <div className="panel-b">
            {selectedIndustry ? (
              <div className="grid gap-2">
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <div className="text-[11px] font-black text-slate-600">산업</div>
                  <div className="mt-1 text-base font-black text-slate-900">{selectedIndustry.name}</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">
                    {selectedIndustry.stocksRaw}개 종목 · 시총 {selectedIndustry.marketCap !== null ? formatCurrencyCompact(selectedIndustry.marketCap, "USD") : "—"} · PER {selectedIndustry.peRatioRaw}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[10px] font-black text-slate-600">1일</div>
                    <div className={`mt-1 text-sm font-black ${positiveNegativeClass(selectedIndustry.oneDayChange) === "down" ? "text-rose-700" : "text-emerald-700"}`}>
                      {selectedIndustry.oneDayRaw}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[10px] font-black text-slate-600">1년</div>
                    <div className={`mt-1 text-sm font-black ${positiveNegativeClass(selectedIndustry.oneYearChange) === "down" ? "text-rose-700" : "text-emerald-700"}`}>
                      {selectedIndustry.oneYearRaw}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[10px] font-black text-slate-600">순이익률</div>
                    <div className={`mt-1 text-sm font-black ${positiveNegativeClass(selectedIndustry.profitMargin) === "down" ? "text-rose-700" : "text-emerald-700"}`}>
                      {selectedIndustry.profitMarginRaw}
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs font-bold text-brand-navy">
                  {hasIndustryConstituentDetail(selectedIndustry)
                    ? `구성종목 상세 ${selectedConstituents.length.toLocaleString("ko-KR")}개를 제공합니다.`
                    : "이 산업은 현재 요약 지표만 제공합니다. 구성종목 상세는 데이터 수집 범위를 넓히며 순차적으로 붙입니다."}
                </div>
                {selectedIndustry.href ? (
                  <a
                    href={selectedIndustry.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 hover:border-brand-interactive hover:text-brand-interactive"
                  >
                    원문 보기
                  </a>
                ) : null}
              </div>
            ) : <EmptyRows label="산업을 선택할 수 없습니다." />}
          </div>
        </section>

        <section className="panel">
          <div className="panel-h">
            <h2>선택 산업 구성종목</h2>
            <span className="desc">{selectedConstituents.length.toLocaleString("ko-KR")}개</span>
          </div>
          <IndustryConstituentList
            rows={selectedConstituents}
            emptyLabel="이 산업은 아직 구성종목 상세가 없습니다."
          />
        </section>

        {localSurfaces.map((surface) => (
          <section key={surface.id} className="panel">
            <div className="panel-h">
              <h2>{surface.title}</h2>
              <span className="desc">{surfaceTimeLabel(surface.doc)} · {countRows(surface.doc).toLocaleString("ko-KR")}개</span>
            </div>
            <div className="panel-b pb-0 pt-2 text-xs font-bold text-slate-500">
              {surface.description}
            </div>
            <IndustryConstituentList rows={surface.rows} emptyLabel={`${surface.title} 데이터가 없습니다.`} />
          </section>
        ))}
      </div>
    </div>
  );
}
