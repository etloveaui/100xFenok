"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import TransitionLink from "@/components/TransitionLink";

type EventTab = "earnings" | "actions" | "ipo" | "industry" | "movers";

interface SurfaceDoc<T = EventRow> {
  fetched_at?: string | null;
  counts?: Record<string, number | null | undefined> | null;
  records?: T[];
  tables?: Array<{ records?: T[] }>;
}

type EventRow = Record<string, unknown>;
type EventSort = "date" | "symbol" | "section";
type EventDateRange = "all" | "7" | "14" | "30";
type IndustrySort = "marketCap" | "oneYear" | "oneDay" | "stocks" | "profitMargin" | "peRatio";
type IndustryTrend = "all" | "up" | "down" | "profitable" | "large";

interface DrilldownRow {
  id: string;
  section: string;
  source: string;
  symbol: string;
  title: string;
  detail: string;
  value: string;
  date: string;
  href?: string;
  searchText: string;
  valueClass?: string;
}

type DrilldownMappedRow = Pick<DrilldownRow, "title" | "detail" | "value"> & Partial<Pick<DrilldownRow, "symbol" | "href" | "valueClass">>;

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

interface EventData {
  earnings: SurfaceDoc;
  actions: SurfaceDoc;
  splits: SurfaceDoc;
  ipoCalendar: SurfaceDoc;
  ipoRecent: SurfaceDoc;
  ipoFilings: SurfaceDoc;
  ipoStats: SurfaceDoc;
  ipoWithdrawn: SurfaceDoc;
  industries: SurfaceDoc;
  technology: SurfaceDoc;
  semiconductors: SurfaceDoc;
  gainers: SurfaceDoc;
  losers: SurfaceDoc;
  active: SurfaceDoc;
  premarket: SurfaceDoc;
  afterhours: SurfaceDoc;
  gainersWeek: SurfaceDoc;
  gainersMonth: SurfaceDoc;
  losersYtd: SurfaceDoc;
}

interface MarketEventsClientProps {
  initialTab?: string;
  initialQuery?: string;
  initialSection?: string;
  initialRange?: string;
  initialFrom?: string;
  initialTo?: string;
  initialSort?: string;
  initialIndustryQuery?: string;
  initialIndustryTrend?: string;
  initialIndustrySort?: string;
}

const SURFACES: Record<keyof EventData, string> = {
  earnings: "earnings_calendar",
  actions: "actions_recent",
  splits: "actions_splits",
  ipoCalendar: "ipos_calendar",
  ipoRecent: "ipos_recent",
  ipoFilings: "ipos_filings",
  ipoStats: "ipos_statistics",
  ipoWithdrawn: "ipos_withdrawn",
  industries: "industries_all",
  technology: "sector_technology",
  semiconductors: "industry_semiconductors",
  gainers: "market_gainers",
  losers: "market_losers",
  active: "market_active",
  premarket: "market_premarket",
  afterhours: "market_afterhours",
  gainersWeek: "market_gainers_week",
  gainersMonth: "market_gainers_month",
  losersYtd: "market_losers_ytd",
};

const TABS: Array<{ key: EventTab; label: string }> = [
  { key: "earnings", label: "어닝" },
  { key: "actions", label: "기업 이벤트" },
  { key: "ipo", label: "IPO" },
  { key: "industry", label: "산업" },
  { key: "movers", label: "급등락" },
];

let cache: EventData | null = null;
let pending: Promise<EventData | null> | null = null;

function loadSurface(name: string): Promise<SurfaceDoc> {
  return fetch(`/api/data/stockanalysis/surfaces/${name}`, { cache: "no-store" })
    .then((response) => (response.ok ? response.json() as Promise<SurfaceDoc> : {}))
    .catch(() => ({}));
}

function loadEventData(): Promise<EventData | null> {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;
  pending = Promise.all(
    Object.entries(SURFACES).map(([key, surface]) => (
      loadSurface(surface).then((doc) => [key, doc] as const)
    )),
  ).then((entries) => {
    const nextData: Partial<EventData> = {};
    entries.forEach(([key, doc]) => {
      nextData[key as keyof EventData] = doc;
    });
    cache = nextData as EventData;
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

function dateText(value: unknown): string {
  const raw = text(value);
  return raw.length >= 10 ? raw.slice(0, 12) : raw;
}

function numberText(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return value.toLocaleString("ko-KR");
  return text(value);
}

function countRows(doc: SurfaceDoc | null | undefined): number {
  const counts = doc?.counts ?? {};
  const value = counts.records ?? counts.rows;
  if (typeof value === "number") return value;
  return rowsOf(doc).length;
}

function asOf(data: EventData | null): string {
  const values = data ? Object.values(data).map((doc) => doc?.fetched_at).filter(Boolean) : [];
  const first = values[0];
  return typeof first === "string" ? first.slice(0, 10) : "-";
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function validDateInput(value: string | null | undefined): string {
  const textValue = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(textValue)) return "";
  return Number.isFinite(Date.parse(textValue)) ? textValue : "";
}

function eventSortFromParam(value: string | null | undefined): EventSort {
  if (value === "symbol" || value === "section") return value;
  return "date";
}

function eventRangeFromParam(value: string | null | undefined): EventDateRange {
  if (value === "7" || value === "14" || value === "30") return value;
  return "all";
}

function eventTabFromParam(value: string | null | undefined): EventTab {
  if (value === "actions" || value === "ipo" || value === "industry" || value === "movers") return value;
  return "earnings";
}

function industrySortFromParam(value: string | null | undefined): IndustrySort {
  if (value === "oneYear" || value === "oneDay" || value === "stocks" || value === "profitMargin" || value === "peRatio") return value;
  return "marketCap";
}

function industryTrendFromParam(value: string | null | undefined): IndustryTrend {
  if (value === "up" || value === "down" || value === "profitable" || value === "large") return value;
  return "all";
}

function rowSymbol(row: EventRow): string {
  return text(row.symbol).replace(/^\$/, "").toUpperCase();
}

function stockHref(symbol: string): string {
  return `/stock/${encodeURIComponent(symbol.replace(/^\$/, "").toUpperCase())}`;
}

function pctClass(value: unknown): string {
  const raw = text(value);
  if (raw.startsWith("-")) return "down";
  if (raw !== "-") return "up";
  return "neutral";
}

function firstText(row: EventRow, keys: string[], fallback = "-"): string {
  for (const key of keys) {
    const value = text(row[key]);
    if (value !== "-") return value;
  }
  return fallback;
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
  const raw = numericValue(value);
  return raw === null ? null : raw;
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

function buildIndustryMapRows(data: EventData | null): IndustryMapRow[] {
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

function makeRow(row: EventRow, title: string, detail: string, value: string, href?: string, valueClass = "neutral") {
  const content = (
    <>
      <span className="co">
        <div className="n">{title}</div>
        <div className="tk">{detail}</div>
      </span>
      <span className={`pc num ${valueClass}`}>{value}</span>
    </>
  );
  return href ? (
    <TransitionLink key={`${href}-${title}-${detail}`} href={href} className="mv-row">
      {content}
    </TransitionLink>
  ) : (
    <div key={`${title}-${detail}`} className="mv-row">
      {content}
    </div>
  );
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

export default function MarketEventsClient({
  initialTab,
  initialQuery,
  initialSection,
  initialRange,
  initialFrom,
  initialTo,
  initialSort,
  initialIndustryQuery,
  initialIndustryTrend,
  initialIndustrySort,
}: MarketEventsClientProps) {
  const [data, setData] = useState<EventData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<EventTab>(eventTabFromParam(initialTab));
  const [query, setQuery] = useState((initialQuery ?? "").trim());
  const [sort, setSort] = useState<EventSort>(eventSortFromParam(initialSort));
  const [sectionFilter, setSectionFilter] = useState(initialSection && initialSection.trim() ? initialSection.trim() : "전체");
  const [dateRange, setDateRange] = useState<EventDateRange>(eventRangeFromParam(initialRange));
  const [fromDate, setFromDate] = useState(validDateInput(initialFrom));
  const [toDate, setToDate] = useState(validDateInput(initialTo));
  const [resultLimit, setResultLimit] = useState(40);

  useEffect(() => {
    let cancelled = false;
    loadEventData().then((next) => {
      if (!cancelled) {
        setData(next);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const tabCounts = useMemo(() => ({
    earnings: countRows(data?.earnings),
    actions: countRows(data?.actions) + countRows(data?.splits),
    ipo: countRows(data?.ipoCalendar) + countRows(data?.ipoRecent) + countRows(data?.ipoFilings) + countRows(data?.ipoStats) + countRows(data?.ipoWithdrawn),
    industry: countRows(data?.industries) + countRows(data?.technology) + countRows(data?.semiconductors),
    movers: countRows(data?.gainers) + countRows(data?.losers) + countRows(data?.active) + countRows(data?.premarket) + countRows(data?.afterhours) + countRows(data?.gainersWeek) + countRows(data?.gainersMonth) + countRows(data?.losersYtd),
  }), [data]);

  const drilldownRows = useMemo(() => buildDrilldownRows(data), [data]);
  const drilldownSections = useMemo(() => sectionOptions(drilldownRows), [drilldownRows]);
  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = drilldownRows
      .filter((row) => sectionFilter === "전체" || row.section === sectionFilter)
      .filter((row) => isWithinDateRange(row, drilldownRows, dateRange, fromDate, toDate))
      .filter((row) => !needle || row.searchText.includes(needle));
    return sortDrilldownRows(rows, sort);
  }, [dateRange, drilldownRows, fromDate, query, sectionFilter, sort, toDate]);

  const syncParams = useCallback((next: {
    query?: string;
    sectionFilter?: string;
    dateRange?: EventDateRange;
    fromDate?: string;
    toDate?: string;
    sort?: EventSort;
  }) => {
    if (typeof window === "undefined") return;
    const nextQuery = next.query ?? query;
    const nextSection = next.sectionFilter ?? sectionFilter;
    const nextRange = next.dateRange ?? dateRange;
    const nextFrom = next.fromDate ?? fromDate;
    const nextTo = next.toDate ?? toDate;
    const nextSort = next.sort ?? sort;
    const params = new URLSearchParams(window.location.search);
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    else params.delete("q");
    if (nextSection === "전체") params.delete("section");
    else params.set("section", nextSection);
    if (nextRange === "all") params.delete("range");
    else params.set("range", nextRange);
    if (nextFrom) params.set("from", nextFrom);
    else params.delete("from");
    if (nextTo) params.set("to", nextTo);
    else params.delete("to");
    if (nextSort === "date") params.delete("sort");
    else params.set("sort", nextSort);
    const queryString = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${queryString ? `?${queryString}` : ""}${window.location.hash}`);
  }, [dateRange, fromDate, query, sectionFilter, sort, toDate]);

  const syncTab = useCallback((nextTab: EventTab) => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (nextTab === "earnings") params.delete("tab");
    else params.set("tab", nextTab);
    const queryString = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${queryString ? `?${queryString}` : ""}${window.location.hash}`);
  }, []);

  return (
    <div className="data-shell-page">
      <section className="panel data-shell-header">
        <div className="data-shell-head-main">
          <p className="data-shell-kicker">시장 이벤트</p>
          <h1 className="data-shell-title">시장 이벤트</h1>
          <p className="data-shell-desc">
            어닝, 기업 이벤트, IPO, 산업 흐름, 급등락을 전용 화면에서 나눠 봅니다.
          </p>
        </div>
        <div className="data-shell-head-actions">
          <span className="data-shell-pill ok"><span />{asOf(data)}</span>
          <TransitionLink href="/market-valuation" className="data-shell-link">시장</TransitionLink>
        </div>
      </section>

      <section className="panel">
        <div className="panel-h">
          <h2>시장 이벤트</h2>
          <span className="desc">{loaded ? `${Object.keys(SURFACES).length}개 항목` : "확인 중"}</span>
        </div>
        <div className="panel-b">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="시장 이벤트 분류">
            {TABS.map((item) => {
              const selected = tab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => {
                    setTab(item.key);
                    syncTab(item.key);
                  }}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[11px] font-black transition ${
                    selected
                      ? "border-brand-interactive bg-brand-interactive text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-600 hover:border-brand-interactive hover:text-brand-interactive"
                  }`}
                >
                  <span>{item.label}</span>
                  <span className={selected ? "text-white/80" : "text-slate-400"}>{tabCounts[item.key].toLocaleString("ko-KR")}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <div style={{ marginTop: "var(--s4)" }}>
        {!loaded ? (
          <LoadingPanel />
        ) : (
          <TabPanel
            tab={tab}
            data={data}
            initialIndustryQuery={initialIndustryQuery}
            initialIndustryTrend={initialIndustryTrend}
            initialIndustrySort={initialIndustrySort}
          />
        )}
      </div>

      <div style={{ marginTop: "var(--s4)" }}>
        <EventDrilldown
          query={query}
          setQuery={setQuery}
          sort={sort}
          setSort={setSort}
          sectionFilter={sectionFilter}
          setSectionFilter={setSectionFilter}
          sections={drilldownSections}
          dateRange={dateRange}
          setDateRange={setDateRange}
          fromDate={fromDate}
          setFromDate={setFromDate}
          toDate={toDate}
          setToDate={setToDate}
          syncParams={syncParams}
          rows={filteredRows}
          totalRows={drilldownRows.length}
          limit={resultLimit}
          setLimit={setResultLimit}
        />
      </div>
    </div>
  );
}

function LoadingPanel() {
  return (
    <section className="panel">
      <div className="mv-row">
        <span className="co">
          <div className="n">시장 이벤트 확인 중</div>
          <div className="tk">어닝·기업 이벤트·IPO·산업·급등락 데이터를 읽고 있습니다</div>
        </span>
        <span className="pc num neutral">...</span>
      </div>
    </section>
  );
}

function TabPanel({
  tab,
  data,
  initialIndustryQuery,
  initialIndustryTrend,
  initialIndustrySort,
}: {
  tab: EventTab;
  data: EventData | null;
  initialIndustryQuery?: string;
  initialIndustryTrend?: string;
  initialIndustrySort?: string;
}) {
  if (tab === "earnings") return <EarningsPanel data={data} />;
  if (tab === "actions") return <ActionsPanel data={data} />;
  if (tab === "ipo") return <IpoPanel data={data} />;
  if (tab === "industry") {
    return (
      <IndustryPanel
        data={data}
        initialQuery={initialIndustryQuery}
        initialTrend={initialIndustryTrend}
        initialSort={initialIndustrySort}
      />
    );
  }
  return <MoversPanel data={data} />;
}

function rowDate(row: EventRow): string {
  return firstText(row, ["date", "ipo_date", "filing_date", "withdrawn_date", "week_of"], "-");
}

function drilldownId(source: string, row: EventRow, index: number): string {
  const symbol = rowSymbol(row) || "ROW";
  return `${source}-${symbol}-${rowDate(row)}-${index}`;
}

function makeDrilldownRow(
  source: string,
  section: string,
  row: EventRow,
  index: number,
  title: string,
  detail: string,
  value: string,
  options: { href?: string; valueClass?: string } = {},
): DrilldownRow {
  const symbol = rowSymbol(row);
  const date = rowDate(row);
  const searchText = [section, source, symbol, title, detail, value, date]
    .join(" ")
    .toLowerCase();
  return {
    id: drilldownId(source, row, index),
    section,
    source,
    symbol,
    title,
    detail,
    value,
    date,
    searchText,
    href: options.href,
    valueClass: options.valueClass ?? "neutral",
  };
}

function buildDrilldownRows(data: EventData | null): DrilldownRow[] {
  if (!data) return [];
  const rows: DrilldownRow[] = [];
  const pushRows = (
    source: string,
    section: string,
    doc: SurfaceDoc | null | undefined,
    mapper: (row: EventRow, index: number) => DrilldownMappedRow,
  ) => {
    rowsOf(doc).forEach((row, index) => {
      const mapped = mapper(row, index);
      rows.push(makeDrilldownRow(source, section, row, index, mapped.title, mapped.detail, mapped.value, {
        href: mapped.href,
        valueClass: mapped.valueClass,
      }));
    });
  };

  pushRows("earnings_calendar", "어닝", data.earnings, (row) => {
    const symbol = rowSymbol(row);
    return {
      symbol,
      title: `${symbol} · ${text(row.name)}`,
      detail: `${dateText(row.date)} · ${text(row.timing).toUpperCase()} · EPS ${numberText(row.eps_estimate)} · 매출 ${numberText(row.revenue_estimate)}`,
      value: numberText(row.market_cap),
      href: symbol ? stockHref(symbol) : undefined,
    };
  });
  pushRows("actions_recent", "기업 이벤트", data.actions, (row) => {
    const symbol = rowSymbol(row);
    return {
      symbol,
      title: `${symbol} · ${text(row.name)}`,
      detail: `${dateText(row.date)} · ${text(row.type)} · ${text(row.text)}`,
      value: text(row.other),
      href: symbol ? stockHref(symbol) : undefined,
    };
  });
  pushRows("actions_splits", "분할·병합", data.splits, (row) => {
    const symbol = rowSymbol(row);
    return {
      symbol,
      title: `${symbol} · ${text(row.company_name)}`,
      detail: `${dateText(row.date)} · ${text(row.type)}`,
      value: text(row.split_ratio),
      href: symbol ? stockHref(symbol) : undefined,
    };
  });
  pushRows("ipos_calendar", "예정 IPO", data.ipoCalendar, (row) => ({
    symbol: rowSymbol(row),
    title: `${rowSymbol(row)} · ${text(row.company_name)}`,
    detail: `${dateText(row.ipo_date)} · ${text(row.exchange)} · ${text(row.price_range)}`,
    value: text(row.deal_size),
  }));
  pushRows("ipos_recent", "최근 IPO", data.ipoRecent, (row) => ({
    symbol: rowSymbol(row),
    title: `${rowSymbol(row)} · ${text(row.company_name)}`,
    detail: `${dateText(row.ipo_date)} · 공모가 ${text(row.ipo_price)} · 현재 ${text(row.current)}`,
    value: text(row.return),
    valueClass: pctClass(row.return),
  }));
  pushRows("ipos_filings", "IPO 신청", data.ipoFilings, (row) => ({
    symbol: rowSymbol(row),
    title: `${rowSymbol(row)} · ${text(row.company_name)}`,
    detail: `${dateText(row.filing_date)} · ${text(row.price_range)}`,
    value: text(row.shares_offered),
  }));
  pushRows("ipos_statistics", "IPO 활동", data.ipoStats, (row) => {
    const symbol = rowSymbol(row);
    return {
      symbol,
      title: `${symbol} · ${text(row.name)}`,
      detail: "최근 IPO 통계에 포함된 상장",
      value: dateText(row.date),
      href: symbol ? stockHref(symbol) : undefined,
    };
  });
  pushRows("ipos_withdrawn", "IPO 철회", data.ipoWithdrawn, (row) => ({
    symbol: rowSymbol(row),
    title: `${rowSymbol(row)} · ${text(row.company_name)}`,
    detail: `${dateText(row.withdrawn_date)} · ${text(row.price_range)}`,
    value: text(row.shares_offered),
  }));
  pushRows("industries_all", "산업", data.industries, (row) => ({
    symbol: "",
    title: text(row.industry_name),
    detail: `${text(row.stocks)}개 종목 · 순이익률 ${text(row.profit_margin)} · 1년 ${text(row["1y_change"])}`,
    value: text(row.market_cap),
    valueClass: pctClass(row["1y_change"]),
  }));

  [
    ["sector_technology", "기술 섹터", data.technology],
    ["industry_semiconductors", "반도체 산업", data.semiconductors],
    ["market_gainers", "당일 상승", data.gainers],
    ["market_losers", "당일 하락", data.losers],
    ["market_active", "거래량", data.active],
    ["market_premarket", "장전 거래", data.premarket],
    ["market_afterhours", "장 마감 후", data.afterhours],
    ["market_gainers_week", "이번 주 상승", data.gainersWeek],
    ["market_gainers_month", "한 달 상승", data.gainersMonth],
    ["market_losers_ytd", "연초 이후 하락", data.losersYtd],
  ].forEach(([source, section, doc]) => {
    pushRows(source as string, section as string, doc as SurfaceDoc, (row) => {
      const symbol = rowSymbol(row);
      const value = firstText(row, ["pct_change", "change_1w", "change_1m", "change_ytd"]);
      return {
        symbol,
        title: `${symbol} · ${text(row.company_name)}`,
        detail: `가격 ${firstText(row, ["stock_price", "premkt_price", "afterhr_price"])} · 거래량 ${firstText(row, ["volume", "pre_volume"])} · 시총 ${text(row.market_cap)}`,
        value,
        href: symbol ? stockHref(symbol) : undefined,
        valueClass: pctClass(value),
      };
    });
  });
  return rows;
}

function eventTime(row: DrilldownRow): number {
  const parsed = Date.parse(row.date);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortDrilldownRows(rows: DrilldownRow[], sort: EventSort): DrilldownRow[] {
  const next = [...rows];
  if (sort === "symbol") {
    return next.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.title.localeCompare(b.title));
  }
  if (sort === "section") {
    return next.sort((a, b) => a.section.localeCompare(b.section) || eventTime(b) - eventTime(a));
  }
  return next.sort((a, b) => eventTime(b) - eventTime(a) || a.section.localeCompare(b.section));
}

function sectionOptions(rows: DrilldownRow[]): Array<{ section: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.section, (counts.get(row.section) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([section, count]) => ({ section, count }));
}

function isWithinDateRange(row: DrilldownRow, allRows: DrilldownRow[], dateRange: EventDateRange, fromDate: string, toDate: string): boolean {
  if (dateRange === "all" && !fromDate && !toDate) return true;
  const rowTime = eventTime(row);
  if (!rowTime) return false;
  if (fromDate && rowTime < Date.parse(fromDate)) return false;
  if (toDate && rowTime > Date.parse(toDate)) return false;
  if (dateRange === "all") return true;
  const maxTime = Math.max(...allRows.map(eventTime), 0);
  if (!maxTime) return true;
  const days = Number(dateRange);
  const threshold = maxTime - (days - 1) * 24 * 60 * 60 * 1000;
  return rowTime >= threshold;
}

function csvCell(value: string | number | null | undefined): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadDrilldownCsv(rows: DrilldownRow[]) {
  const cappedRows = rows.slice(0, 500);
  const header = ["분류", "자료명", "티커", "이름", "날짜", "요약", "값"];
  const lines = [
    header.map(csvCell).join(","),
    ...cappedRows.map((row) => [
      row.section,
      row.source,
      row.symbol,
      row.title,
      row.date,
      row.detail,
      row.value,
    ].map(csvCell).join(",")),
  ];
  const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `100x-market-events-${todayIso()}.csv`;
  anchor.click();
  URL.revokeObjectURL(href);
}

function EventDrilldown({
  query,
  setQuery,
  sort,
  setSort,
  sectionFilter,
  setSectionFilter,
  sections,
  dateRange,
  setDateRange,
  fromDate,
  setFromDate,
  toDate,
  setToDate,
  syncParams,
  rows,
  totalRows,
  limit,
  setLimit,
}: {
  query: string;
  setQuery: (value: string) => void;
  sort: EventSort;
  setSort: (value: EventSort) => void;
  sectionFilter: string;
  setSectionFilter: (value: string) => void;
  sections: Array<{ section: string; count: number }>;
  dateRange: EventDateRange;
  setDateRange: (value: EventDateRange) => void;
  fromDate: string;
  setFromDate: (value: string) => void;
  toDate: string;
  setToDate: (value: string) => void;
  syncParams: (next: {
    query?: string;
    sectionFilter?: string;
    dateRange?: EventDateRange;
    fromDate?: string;
    toDate?: string;
    sort?: EventSort;
  }) => void;
  rows: DrilldownRow[];
  totalRows: number;
  limit: number;
  setLimit: (value: number) => void;
}) {
  const visible = rows.slice(0, limit);
  return (
    <section className="panel">
      <div className="panel-h">
        <h2>전체 이벤트 검색</h2>
        <span className="desc">{rows.length.toLocaleString("ko-KR")} / {totalRows.toLocaleString("ko-KR")}개</span>
      </div>
      <div className="panel-b">
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_11rem_10rem_11rem_8rem]">
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              syncParams({ query: event.target.value });
              setLimit(40);
            }}
            placeholder="티커, 기업명, 산업, 이벤트 검색"
            className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-brand-interactive"
          />
          <select
            value={sectionFilter}
            onChange={(event) => {
              setSectionFilter(event.target.value);
              syncParams({ sectionFilter: event.target.value });
              setLimit(40);
            }}
            className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-brand-interactive"
            aria-label="분류"
          >
            <option value="전체">전체 분류</option>
            {sections.map((item) => (
              <option key={item.section} value={item.section}>
                {item.section} {item.count.toLocaleString("ko-KR")}
              </option>
            ))}
          </select>
          <select
            value={dateRange}
            onChange={(event) => {
              const value = event.target.value as EventDateRange;
              setDateRange(value);
              syncParams({ dateRange: value });
              setLimit(40);
            }}
            className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-brand-interactive"
            aria-label="기간"
          >
            <option value="all">전체 기간</option>
            <option value="7">최근 7일</option>
            <option value="14">최근 14일</option>
            <option value="30">최근 30일</option>
          </select>
          <select
            value={sort}
            onChange={(event) => {
              const value = event.target.value as EventSort;
              setSort(value);
              syncParams({ sort: value });
            }}
            className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-brand-interactive"
            aria-label="정렬"
          >
            <option value="date">날짜순</option>
            <option value="symbol">티커순</option>
            <option value="section">분류순</option>
          </select>
          <button
            type="button"
            onClick={() => downloadDrilldownCsv(rows)}
            disabled={!rows.length}
            className="min-h-10 rounded-lg border border-slate-200 bg-slate-900 px-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            CSV 저장
          </button>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-500">
            <span className="shrink-0">시작일</span>
            <input
              type="date"
              value={fromDate}
              onChange={(event) => {
                const value = event.target.value;
                setFromDate(value);
                syncParams({ fromDate: value });
                setLimit(40);
              }}
              className="min-w-0 flex-1 bg-transparent text-sm font-bold text-slate-700 outline-none"
            />
          </label>
          <label className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-500">
            <span className="shrink-0">종료일</span>
            <input
              type="date"
              value={toDate}
              onChange={(event) => {
                const value = event.target.value;
                setToDate(value);
                syncParams({ toDate: value });
                setLimit(40);
              }}
              className="min-w-0 flex-1 bg-transparent text-sm font-bold text-slate-700 outline-none"
            />
          </label>
        </div>
      </div>
      <div className="mv-col">
        {visible.length ? visible.map((row) => {
          const content = (
            <>
              <span className="co">
                <div className="n">{row.title}</div>
                <div className="tk">{row.section} · {row.date} · {row.detail}</div>
              </span>
              <span className={`pc num ${row.valueClass ?? "neutral"}`}>{row.value}</span>
            </>
          );
          return row.href ? (
            <TransitionLink key={row.id} href={row.href} className="mv-row">
              {content}
            </TransitionLink>
          ) : (
            <div key={row.id} className="mv-row">
              {content}
            </div>
          );
        }) : <EmptyRows label="검색 결과가 없습니다." />}
      </div>
      {rows.length > visible.length ? (
        <div className="panel-b">
          <button
            type="button"
            onClick={() => setLimit(limit + 40)}
            className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 hover:border-brand-interactive hover:text-brand-interactive"
          >
            더 보기 {visible.length.toLocaleString("ko-KR")} / {rows.length.toLocaleString("ko-KR")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function EarningsPanel({ data }: { data: EventData | null }) {
  const today = todayIso();
  const rows = rowsOf(data?.earnings)
    .filter((row) => text(row.date) >= today)
    .slice(0, 30);
  return (
    <section className="panel">
      <div className="panel-h">
        <h2>다가오는 어닝</h2>
        <span className="desc">{dateText(data?.earnings?.fetched_at)} · {countRows(data?.earnings).toLocaleString("ko-KR")}개</span>
      </div>
      <div className="mv-col">
        {rows.length ? rows.map((row) => {
          const symbol = rowSymbol(row);
          const timing = text(row.timing).toUpperCase();
          const detail = `${dateText(row.date)} · ${timing} · EPS ${numberText(row.eps_estimate)} · 매출 ${numberText(row.revenue_estimate)}`;
          return makeRow(row, `${symbol} · ${text(row.name)}`, detail, numberText(row.market_cap), symbol ? stockHref(symbol) : undefined);
        }) : <EmptyRows label="오늘 이후 어닝 일정이 없습니다." />}
      </div>
    </section>
  );
}

function ActionsPanel({ data }: { data: EventData | null }) {
  const recent = rowsOf(data?.actions).slice(0, 20);
  const splits = rowsOf(data?.splits).slice(0, 10);
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_0.85fr]">
      <section className="panel">
        <div className="panel-h">
          <h2>최근 기업 이벤트</h2>
          <span className="desc">{dateText(data?.actions?.fetched_at)} · {countRows(data?.actions).toLocaleString("ko-KR")}개</span>
        </div>
        <div className="mv-col">
          {recent.length ? recent.map((row) => {
            const symbol = rowSymbol(row);
            return makeRow(row, `${symbol} · ${text(row.name)}`, `${dateText(row.date)} · ${text(row.type)} · ${text(row.text)}`, text(row.other), symbol ? stockHref(symbol) : undefined);
          }) : <EmptyRows label="최근 기업 이벤트가 없습니다." />}
        </div>
      </section>
      <section className="panel">
        <div className="panel-h">
          <h2>분할·병합</h2>
          <span className="desc">{countRows(data?.splits).toLocaleString("ko-KR")}개</span>
        </div>
        <div className="mv-col">
          {splits.length ? splits.map((row) => {
            const symbol = rowSymbol(row);
            return makeRow(row, `${symbol} · ${text(row.company_name)}`, `${dateText(row.date)} · ${text(row.type)}`, text(row.split_ratio), symbol ? stockHref(symbol) : undefined);
          }) : <EmptyRows label="표시할 분할·병합 항목이 없습니다." />}
        </div>
      </section>
    </div>
  );
}

function IpoPanel({ data }: { data: EventData | null }) {
  const calendar = rowsOf(data?.ipoCalendar).slice(0, 12);
  const recent = rowsOf(data?.ipoRecent).slice(0, 10);
  const filings = rowsOf(data?.ipoFilings).slice(0, 10);
  const stats = rowsOf(data?.ipoStats).slice(0, 8);
  const withdrawn = rowsOf(data?.ipoWithdrawn).slice(0, 6);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="panel">
        <div className="panel-h">
          <h2>예정 IPO</h2>
          <span className="desc">{dateText(data?.ipoCalendar?.fetched_at)} · {countRows(data?.ipoCalendar).toLocaleString("ko-KR")}개</span>
        </div>
        <div className="mv-col">
          {calendar.length ? calendar.map((row) => (
            makeRow(row, `${rowSymbol(row)} · ${text(row.company_name)}`, `${dateText(row.ipo_date)} · ${text(row.exchange)} · ${text(row.price_range)}`, text(row.deal_size))
          )) : <EmptyRows label="예정 IPO가 없습니다." />}
        </div>
      </section>
      <section className="panel">
        <div className="panel-h">
          <h2>최근 상장 성과</h2>
          <span className="desc">{countRows(data?.ipoRecent).toLocaleString("ko-KR")}개</span>
        </div>
        <div className="mv-col">
          {recent.length ? recent.map((row) => (
            makeRow(row, `${rowSymbol(row)} · ${text(row.company_name)}`, `${dateText(row.ipo_date)} · 공모가 ${text(row.ipo_price)} · 현재 ${text(row.current)}`, text(row.return), undefined, pctClass(row.return))
          )) : <EmptyRows label="최근 상장 성과가 없습니다." />}
        </div>
      </section>
      <section className="panel">
        <div className="panel-h">
          <h2>신규 신청</h2>
          <span className="desc">{countRows(data?.ipoFilings).toLocaleString("ko-KR")}개</span>
        </div>
        <div className="mv-col">
          {filings.length ? filings.map((row) => (
            makeRow(row, `${rowSymbol(row)} · ${text(row.company_name)}`, `${dateText(row.filing_date)} · ${text(row.price_range)}`, text(row.shares_offered))
          )) : <EmptyRows label="신규 신청 목록이 없습니다." />}
        </div>
      </section>
      <section className="panel">
        <div className="panel-h">
          <h2>IPO 활동</h2>
          <span className="desc">{dateText(data?.ipoStats?.fetched_at)} · {countRows(data?.ipoStats).toLocaleString("ko-KR")}개</span>
        </div>
        <div className="mv-col">
          {stats.length ? stats.map((row) => {
            const symbol = rowSymbol(row);
            return makeRow(row, `${symbol} · ${text(row.name)}`, "최근 IPO 통계에 포함된 상장", dateText(row.date), symbol ? stockHref(symbol) : undefined);
          }) : <EmptyRows label="IPO 활동 데이터가 없습니다." />}
        </div>
      </section>
      <section className="panel">
        <div className="panel-h">
          <h2>철회</h2>
          <span className="desc">{countRows(data?.ipoWithdrawn).toLocaleString("ko-KR")}개</span>
        </div>
        <div className="mv-col">
          {withdrawn.length ? withdrawn.map((row) => (
            makeRow(row, `${rowSymbol(row)} · ${text(row.company_name)}`, `${dateText(row.withdrawn_date)} · ${text(row.price_range)}`, text(row.shares_offered))
          )) : <EmptyRows label="철회 목록이 없습니다." />}
        </div>
      </section>
    </div>
  );
}

function IndustryPanel({
  data,
  initialQuery,
  initialTrend,
  initialSort,
}: {
  data: EventData | null;
  initialQuery?: string;
  initialTrend?: string;
  initialSort?: string;
}) {
  const [industryQuery, setIndustryQuery] = useState((initialQuery ?? "").trim());
  const [industryTrend, setIndustryTrend] = useState<IndustryTrend>(industryTrendFromParam(initialTrend));
  const [industrySort, setIndustrySort] = useState<IndustrySort>(industrySortFromParam(initialSort));
  const [industryLimit, setIndustryLimit] = useState(36);
  const syncIndustryParams = useCallback((next: {
    query?: string;
    trend?: IndustryTrend;
    sort?: IndustrySort;
  }) => {
    if (typeof window === "undefined") return;
    const nextQuery = next.query ?? industryQuery;
    const nextTrend = next.trend ?? industryTrend;
    const nextSort = next.sort ?? industrySort;
    const params = new URLSearchParams(window.location.search);
    params.set("tab", "industry");
    if (nextQuery.trim()) params.set("industry_q", nextQuery.trim());
    else params.delete("industry_q");
    if (nextTrend === "all") params.delete("industry_trend");
    else params.set("industry_trend", nextTrend);
    if (nextSort === "marketCap") params.delete("industry_sort");
    else params.set("industry_sort", nextSort);
    const queryString = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${queryString ? `?${queryString}` : ""}${window.location.hash}`);
  }, [industryQuery, industrySort, industryTrend]);
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
  const tech = rowsOf(data?.technology).slice(0, 8);
  const semiconductors = rowsOf(data?.semiconductors).slice(0, 8);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
      <section className="panel">
        <div className="panel-h">
          <h2>산업 지도</h2>
          <span className="desc">
            {filteredIndustries.length.toLocaleString("ko-KR")} / {industryRows.length.toLocaleString("ko-KR")}개
          </span>
        </div>
        <div className="panel-b">
          <div className="grid gap-2 md:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <div className="text-[11px] font-black text-slate-400">최대 산업</div>
              <div className="mt-1 truncate text-sm font-black text-slate-800">{topIndustry?.name ?? "-"}</div>
              <div className="mt-0.5 text-xs font-bold text-slate-500">{topIndustry?.marketCapRaw ?? "-"}</div>
            </div>
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2">
              <div className="text-[11px] font-black text-emerald-600">1년 상승</div>
              <div className="mt-1 text-sm font-black text-emerald-800">{risingCount.toLocaleString("ko-KR")}개 산업</div>
              <div className="mt-0.5 text-xs font-bold text-emerald-700">전체 산업 기준</div>
            </div>
            <div className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2">
              <div className="text-[11px] font-black text-sky-600">순이익률 플러스</div>
              <div className="mt-1 text-sm font-black text-sky-800">{profitableCount.toLocaleString("ko-KR")}개 산업</div>
              <div className="mt-0.5 text-xs font-bold text-sky-700">순이익률 0% 초과</div>
            </div>
          </div>
          <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_9rem_10rem_7rem]">
            <input
              value={industryQuery}
              onChange={(event) => {
                const value = event.target.value;
                setIndustryQuery(value);
                syncIndustryParams({ query: value });
                setIndustryLimit(36);
              }}
              placeholder="산업명 검색"
              className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-brand-interactive"
            />
            <select
              value={industryTrend}
              onChange={(event) => {
                const value = event.target.value as IndustryTrend;
                setIndustryTrend(value);
                syncIndustryParams({ trend: value });
                setIndustryLimit(36);
              }}
              className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-brand-interactive"
              aria-label="산업 조건"
            >
              <option value="all">전체 조건</option>
              <option value="up">1년 상승</option>
              <option value="down">1년 하락</option>
              <option value="profitable">순이익률 플러스</option>
              <option value="large">시총 1조 달러 이상</option>
            </select>
            <select
              value={industrySort}
              onChange={(event) => {
                const value = event.target.value as IndustrySort;
                setIndustrySort(value);
                syncIndustryParams({ sort: value });
              }}
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
          <div className="grid auto-rows-[116px] gap-2 md:grid-cols-3 xl:grid-cols-4">
            {visibleIndustries.length ? visibleIndustries.map((row) => {
              const tone = positiveNegativeClass(row.oneYearChange);
              const trendLabel = tone === "up" ? "상승" : tone === "down" ? "하락" : "보합";
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
              const tileClass = `flex min-w-0 flex-col justify-between rounded-lg border p-3 transition hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-interactive ${toneClass} ${spanClass}`;
              const tileContent = (
                <>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black">{row.name}</div>
                    <div className="mt-1 text-[11px] font-bold opacity-75">
                      {row.stocksRaw}개 종목 · 시총 {row.marketCapRaw}
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
                </>
              );
              return row.href ? (
                <a
                  key={row.id}
                  href={row.href}
                  target="_blank"
                  rel="noreferrer"
                  className={tileClass}
                  aria-label={`${row.name} 산업 원문 열기`}
                >
                  {tileContent}
                </a>
              ) : (
                <div key={row.id} className={tileClass}>
                  {tileContent}
                </div>
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
            <h2>기술 섹터 상위</h2>
            <span className="desc">{countRows(data?.technology).toLocaleString("ko-KR")}개</span>
          </div>
          <div className="mv-col">
            {tech.length ? tech.map((row) => {
              const symbol = rowSymbol(row);
              return makeRow(row, `${symbol} · ${text(row.company_name)}`, `거래량 ${text(row.volume)} · 매출 ${text(row.revenue)}`, text(row.market_cap), symbol ? stockHref(symbol) : undefined, pctClass(row.pct_change));
            }) : <EmptyRows label="기술 섹터 데이터가 없습니다." />}
          </div>
        </section>
        <section className="panel">
          <div className="panel-h">
            <h2>반도체 상위</h2>
            <span className="desc">{countRows(data?.semiconductors).toLocaleString("ko-KR")}개</span>
          </div>
          <div className="mv-col">
            {semiconductors.length ? semiconductors.map((row) => {
              const symbol = rowSymbol(row);
              return makeRow(row, `${symbol} · ${text(row.company_name)}`, `거래량 ${text(row.volume)} · 매출 ${text(row.revenue)}`, text(row.market_cap), symbol ? stockHref(symbol) : undefined, pctClass(row.pct_change));
            }) : <EmptyRows label="반도체 산업 데이터가 없습니다." />}
          </div>
        </section>
      </div>
    </div>
  );
}

function MoversPanel({ data }: { data: EventData | null }) {
  const groups = [
    { title: "당일 상승", doc: data?.gainers, rows: rowsOf(data?.gainers).slice(0, 10), valueKey: "pct_change" },
    { title: "당일 하락", doc: data?.losers, rows: rowsOf(data?.losers).slice(0, 10), valueKey: "pct_change" },
    { title: "거래량", doc: data?.active, rows: rowsOf(data?.active).slice(0, 10), valueKey: "pct_change" },
    { title: "장전 거래", doc: data?.premarket, rows: rowsOf(data?.premarket).slice(0, 8), valueKey: "pct_change", priceKeys: ["premkt_price", "stock_price"], volumeKeys: ["pre_volume", "volume"] },
    { title: "장 마감 후", doc: data?.afterhours, rows: rowsOf(data?.afterhours).slice(0, 8), valueKey: "pct_change", priceKeys: ["afterhr_price", "stock_price"], volumeKeys: ["volume"], extraKeys: ["afterhr_close"] },
    { title: "이번 주 상승", doc: data?.gainersWeek, rows: rowsOf(data?.gainersWeek).slice(0, 8), valueKey: "change_1w" },
    { title: "한 달 상승", doc: data?.gainersMonth, rows: rowsOf(data?.gainersMonth).slice(0, 8), valueKey: "change_1m" },
    { title: "연초 이후 하락", doc: data?.losersYtd, rows: rowsOf(data?.losersYtd).slice(0, 8), valueKey: "change_ytd" },
  ];
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {groups.map((group) => (
        <section key={group.title} className="panel">
          <div className="panel-h">
            <h2>{group.title}</h2>
            <span className="desc">{dateText(group.doc?.fetched_at)} · {countRows(group.doc).toLocaleString("ko-KR")}개</span>
          </div>
          <div className="mv-col">
            {group.rows.length ? group.rows.map((row) => {
              const symbol = rowSymbol(row);
              const value = text(row[group.valueKey]);
              const price = firstText(row, group.priceKeys ?? ["stock_price"]);
              const volume = firstText(row, group.volumeKeys ?? ["volume"]);
              const extra = firstText(row, group.extraKeys ?? []);
              const activity = extra !== "-" ? `기준가 ${extra}` : `거래량 ${volume}`;
              return makeRow(row, `${symbol} · ${text(row.company_name)}`, `가격 ${price} · ${activity} · 시총 ${text(row.market_cap)}`, value, symbol ? stockHref(symbol) : undefined, pctClass(value));
            }) : <EmptyRows label={`${group.title} 데이터가 없습니다.`} />}
          </div>
        </section>
      ))}
    </div>
  );
}
