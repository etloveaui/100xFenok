"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import TickerChip from "@/components/TickerChip";
import MarketSectionNav from "@/components/market/MarketSectionNav";
import { ROUTES } from "@/lib/routes";
import { EmptyState } from "@/components/ui";
import { EVENTS_STALE_LABEL, isEventBoardStale } from "@/lib/market-events/freshness";
import MarketEventsTimeline from "./MarketEventsTimeline";

interface SurfaceDoc<T = EventRow> {
  surface?: string;
  fetched_at?: string | null;
  source_as_of?: string | null;
  source_as_of_reason?: string | null;
  counts?: Record<string, number | null | undefined> | null;
  records?: T[];
  tables?: Array<{ records?: T[] }>;
  load_failed?: boolean;
  status_code?: number;
}

type EventRow = Record<string, unknown>;
type EventSort = "date" | "symbol" | "section";
type EventDateRange = "all" | "7" | "14" | "30";

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

interface EventData {
  earnings: SurfaceDoc;
  actions: SurfaceDoc;
  splits: SurfaceDoc;
  ipoCalendar: SurfaceDoc;
  ipoRecent: SurfaceDoc;
  ipoFilings: SurfaceDoc;
  ipoStats: SurfaceDoc;
  ipoWithdrawn: SurfaceDoc;
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
  gainers: "market_gainers",
  losers: "market_losers",
  active: "market_active",
  premarket: "market_premarket",
  afterhours: "market_afterhours",
  gainersWeek: "market_gainers_week",
  gainersMonth: "market_gainers_month",
  losersYtd: "market_losers_ytd",
};

let cache: EventData | null = null;
let pending: Promise<EventData | null> | null = null;

function loadSurface(name: string): Promise<SurfaceDoc> {
  return fetch(`/api/data/stockanalysis/surfaces/${name}`, { cache: "no-store" })
    .then((response) => (
      response.ok
        ? response.json() as Promise<SurfaceDoc>
        : { surface: name, load_failed: true, status_code: response.status }
    ))
    .then((doc) => ({ ...doc, surface: doc.surface ?? name }))
    .catch(() => ({ surface: name, load_failed: true }));
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

function normalizedDate(value: string | null | undefined): string | null {
  const textValue = typeof value === "string" ? value.trim() : "";
  return /^(\d{4}-\d{2}-\d{2})/.exec(textValue)?.[1] ?? null;
}

function completeDateFloor(values: Array<string | null | undefined>): string | null {
  if (values.length === 0) return null;
  const dates = values.map(normalizedDate);
  if (dates.some((value) => value === null)) return null;
  return (dates as string[]).sort().at(0) ?? null;
}

function eventTimeLabel(data: EventData | null): string {
  const docs = data ? Object.values(data) : [];
  if (docs.length === 0) return "원천 기준일 미제공";
  const sourceFloor = completeDateFloor(docs.map((doc) => doc?.source_as_of));
  if (sourceFloor) return `기준 ${sourceFloor}`;
  const collectionFloor = completeDateFloor(docs.map((doc) => doc?.fetched_at));
  return collectionFloor ? `수집 ${collectionFloor}` : "원천 기준일 미제공";
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

function rowSymbol(row: EventRow): string {
  return text(row.symbol).replace(/^\$/, "").toUpperCase();
}

function stockHref(symbol: string): string {
  return ROUTES.stock(symbol.replace(/^\$/, "").toUpperCase());
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

function rowTitle(title: string, symbol?: string) {
  if (!symbol) return title;
  const rest = title.startsWith(`${symbol} · `) ? title.slice(symbol.length + 3) : title;
  return (
    <>
      <TickerChip ticker={symbol} variant="inline" />
      {rest ? ` · ${rest}` : null}
    </>
  );
}

function EmptyRows({ label }: { label: string }) {
  return <EmptyState reason={label} nextRefresh="다음 갱신 시" />;
}

export default function MarketEventsClient({
  initialQuery,
  initialSection,
  initialRange,
  initialFrom,
  initialTo,
  initialSort,
}: MarketEventsClientProps) {
  const [data, setData] = useState<EventData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState((initialQuery ?? "").trim());
  const [sort, setSort] = useState<EventSort>(eventSortFromParam(initialSort));
  const [sectionFilter, setSectionFilter] = useState(initialSection && initialSection.trim() ? initialSection.trim() : "전체");
  const [dateRange, setDateRange] = useState<EventDateRange>(eventRangeFromParam(initialRange));
  const [fromDate, setFromDate] = useState(validDateInput(initialFrom));
  const [toDate, setToDate] = useState(validDateInput(initialTo));
  const [resultLimit, setResultLimit] = useState(40);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => {
    cache = null;
    pending = null;
    setReloadKey((key) => key + 1);
  }, []);

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
  }, [reloadKey]);

  const boardStale = useMemo(
    () => loaded && isEventBoardStale(data ? Object.values(data) : []),
    [data, loaded],
  );

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

  return (
    <div className="data-shell-page" data-market-events-surface="true" data-market-events-route-owner="event-catalyst-center">
      <section className="panel data-shell-header">
        <div className="data-shell-head-main">
          <p className="data-shell-kicker">시장 이벤트</p>
          <h1 className="data-shell-title">시장 이벤트</h1>
          <p className="data-shell-desc">
            어닝·배당 일정을 타임라인에서 보고, IPO를 포함한 전체 이벤트를 검색합니다.
          </p>
        </div>
        <div className="data-shell-head-actions">
          <span className={`data-shell-pill${loaded ? (boardStale ? " warn" : " ok") : ""}`}><span />{eventTimeLabel(data)}{boardStale ? ` · ${EVENTS_STALE_LABEL}` : ""}</span>
          <MarketSectionNav active="events" />
        </div>
      </section>

      <div style={{ marginTop: "var(--s4)" }}>
        <MarketEventsTimeline
          loaded={loaded}
          earnings={data?.earnings ?? null}
          actions={data?.actions ?? null}
          splits={data?.splits ?? null}
          ipoCalendar={data?.ipoCalendar ?? null}
          onRetry={reload}
        />
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
  [
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
    <section className="panel" data-market-events-drilldown="true">
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
            placeholder="티커, 기업명, 이벤트 검색"
            className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-brand-interactive"
            data-market-events-search="true"
          />
          <select
            value={sectionFilter}
            onChange={(event) => {
              setSectionFilter(event.target.value);
              syncParams({ sectionFilter: event.target.value });
              setLimit(40);
            }}
            className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-brand-interactive"
            aria-label="분류"
            data-market-events-section-filter="true"
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
            className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-brand-interactive"
            aria-label="기간"
            data-market-events-range-filter="true"
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
            className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-brand-interactive"
            aria-label="정렬"
            data-market-events-sort="true"
          >
            <option value="date">날짜순</option>
            <option value="symbol">티커순</option>
            <option value="section">분류순</option>
          </select>
          <button
            type="button"
            onClick={() => downloadDrilldownCsv(rows)}
            disabled={!rows.length}
            className="min-h-11 rounded-lg border border-slate-200 bg-slate-900 px-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
            data-market-events-csv-action="true"
          >
            CSV 저장
          </button>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label
            className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-500"
            data-market-events-from-date="true"
          >
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
          <label
            className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-500"
            data-market-events-to-date="true"
          >
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
          return (
            <div
              key={row.id}
              className="mv-row"
              data-market-events-drilldown-row={row.section}
            >
              <span className="co">
                <div className="n">{rowTitle(row.title, row.symbol)}</div>
                <div className="tk">{row.section} · {row.date} · {row.detail}</div>
              </span>
              <span className={`pc num ${row.valueClass ?? "neutral"}`}>{row.value}</span>
            </div>
          );
        }) : <EmptyRows label="검색 결과가 없습니다." />}
      </div>
      {rows.length > visible.length ? (
        <div className="panel-b">
          <button
            type="button"
            onClick={() => setLimit(limit + 40)}
            className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 hover:border-brand-interactive hover:text-brand-interactive"
            data-market-events-load-more="true"
          >
            더 보기 {visible.length.toLocaleString("ko-KR")} / {rows.length.toLocaleString("ko-KR")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
