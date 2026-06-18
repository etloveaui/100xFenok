"use client";

import { useEffect, useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";

type EventTab = "earnings" | "actions" | "ipo" | "industry" | "movers";

interface SurfaceDoc<T = EventRow> {
  fetched_at?: string | null;
  counts?: Record<string, number | null | undefined> | null;
  records?: T[];
  tables?: Array<{ records?: T[] }>;
}

type EventRow = Record<string, unknown>;

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
  gainers: SurfaceDoc;
  losers: SurfaceDoc;
  active: SurfaceDoc;
  premarket: SurfaceDoc;
  afterhours: SurfaceDoc;
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
  gainers: "market_gainers",
  losers: "market_losers",
  active: "market_active",
  premarket: "market_premarket",
  afterhours: "market_afterhours",
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

export default function MarketEventsClient() {
  const [data, setData] = useState<EventData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<EventTab>("earnings");

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
    industry: countRows(data?.industries),
    movers: countRows(data?.gainers) + countRows(data?.losers) + countRows(data?.active),
  }), [data]);

  return (
    <div className="data-shell-page">
      <section className="panel data-shell-header">
        <div className="data-shell-head-main">
          <p className="data-shell-kicker">Market Events</p>
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
                  onClick={() => setTab(item.key)}
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
        {!loaded ? <LoadingPanel /> : <TabPanel tab={tab} data={data} />}
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

function TabPanel({ tab, data }: { tab: EventTab; data: EventData | null }) {
  if (tab === "earnings") return <EarningsPanel data={data} />;
  if (tab === "actions") return <ActionsPanel data={data} />;
  if (tab === "ipo") return <IpoPanel data={data} />;
  if (tab === "industry") return <IndustryPanel data={data} />;
  return <MoversPanel data={data} />;
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
            return makeRow(row, `${symbol} · ${text(row.name)}`, `${dateText(row.date)} · IPO 활동 포착`, text(row.exchange), symbol ? stockHref(symbol) : undefined);
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

function IndustryPanel({ data }: { data: EventData | null }) {
  const industries = rowsOf(data?.industries).slice(0, 30);
  const tech = rowsOf(data?.technology).slice(0, 10);
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_0.85fr]">
      <section className="panel">
        <div className="panel-h">
          <h2>산업 지도</h2>
          <span className="desc">{dateText(data?.industries?.fetched_at)} · {countRows(data?.industries).toLocaleString("ko-KR")}개</span>
        </div>
        <div className="mv-col">
          {industries.length ? industries.map((row) => (
            makeRow(row, text(row.industry_name), `${text(row.stocks)}개 종목 · 이익률 ${text(row.profit_margin)} · 1년 ${text(row["1y_change"])}`, text(row.market_cap), undefined, pctClass(row["1y_change"]))
          )) : <EmptyRows label="산업 데이터가 없습니다." />}
        </div>
      </section>
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
    </div>
  );
}

function MoversPanel({ data }: { data: EventData | null }) {
  const groups = [
    { title: "상승", doc: data?.gainers, rows: rowsOf(data?.gainers).slice(0, 10) },
    { title: "하락", doc: data?.losers, rows: rowsOf(data?.losers).slice(0, 10) },
    { title: "거래량", doc: data?.active, rows: rowsOf(data?.active).slice(0, 10) },
    { title: "프리마켓", doc: data?.premarket, rows: rowsOf(data?.premarket).slice(0, 8) },
    { title: "애프터마켓", doc: data?.afterhours, rows: rowsOf(data?.afterhours).slice(0, 8) },
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
              return makeRow(row, `${symbol} · ${text(row.company_name)}`, `가격 ${text(row.stock_price)} · 거래량 ${text(row.volume)} · 시총 ${text(row.market_cap)}`, text(row.pct_change), symbol ? stockHref(symbol) : undefined, pctClass(row.pct_change));
            }) : <EmptyRows label={`${group.title} 데이터가 없습니다.`} />}
          </div>
        </section>
      ))}
    </div>
  );
}
