"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import TransitionLink from "@/components/TransitionLink";

interface SurfaceResult {
  surface?: string;
  group?: string;
  rows?: number | null;
  status?: string | null;
}

interface CalendarEvent {
  date_kst: string;
  time_kst: string;
  importance: "H" | "M" | "L";
  category_label: string;
  title_ko: string;
  title_en?: string;
}

interface PrevValuesDoc {
  aliases?: Record<string, string>;
  values?: Record<string, { value?: string; asOf?: string; series?: string; key?: string; source?: string }>;
}

interface CalendarDoc {
  events?: CalendarEvent[];
}

interface StockanalysisManifest {
  surfaces?: {
    generated_at?: string | null;
    counts?: {
      surfaces_requested?: number | null;
      ok?: number | null;
      failed?: number | null;
      rows?: number | null;
    } | null;
    sample_results?: SurfaceResult[];
  } | null;
}

interface SurfaceDoc<T> {
  fetched_at?: string | null;
  counts?: {
    records?: number | null;
    rows?: number | null;
  } | null;
  records?: T[];
  tables?: Array<{
    records?: T[];
  }>;
}

interface EarningsRecord {
  date?: string;
  symbol?: string;
  name?: string;
  timing?: string | null;
  eps_estimate?: number | null;
  revenue_estimate?: number | null;
  market_cap?: number | null;
}

interface ActionRecord {
  date?: string;
  type?: string;
  symbol?: string;
  name?: string;
  company_name?: string;
  text?: string;
  split_ratio?: string;
}

interface SessionMoverRecord {
  symbol?: string;
  company_name?: string;
  pct_change?: string;
  premkt_price?: string;
  afterhr_price?: string;
  afterhr_close?: string;
  pre_volume?: string;
  market_cap?: string;
}

interface SurfaceRadarData {
  manifest: StockanalysisManifest | null;
  earnings: SurfaceDoc<EarningsRecord> | null;
  actions: SurfaceDoc<ActionRecord> | null;
  splits: SurfaceDoc<ActionRecord> | null;
  premarket: SurfaceDoc<SessionMoverRecord> | null;
  afterhours: SurfaceDoc<SessionMoverRecord> | null;
  calendar: CalendarDoc | null;
  prevValues: PrevValuesDoc | null;
}

let radarCache: SurfaceRadarData | null = null;
let radarPending: Promise<SurfaceRadarData> | null = null;
type EventTab = "macro" | "corporate" | "session";

function loadJson<T>(path: string): Promise<T | null> {
  return fetch(path, { cache: "no-store" })
    .then((response) => (response.ok ? response.json() as Promise<T> : null))
    .catch(() => null);
}

function loadRadarData(): Promise<SurfaceRadarData> {
  if (radarCache) return Promise.resolve(radarCache);
  if (radarPending) return radarPending;
  radarPending = Promise.all([
    loadJson<StockanalysisManifest>("/api/data/stockanalysis"),
    loadJson<SurfaceDoc<EarningsRecord>>("/api/data/stockanalysis/surfaces/earnings_calendar"),
    loadJson<SurfaceDoc<ActionRecord>>("/api/data/stockanalysis/surfaces/actions_recent"),
    loadJson<SurfaceDoc<ActionRecord>>("/api/data/stockanalysis/surfaces/actions_splits"),
    loadJson<SurfaceDoc<SessionMoverRecord>>("/api/data/stockanalysis/surfaces/market_premarket"),
    loadJson<SurfaceDoc<SessionMoverRecord>>("/api/data/stockanalysis/surfaces/market_afterhours"),
    loadJson<CalendarDoc>("/data/calendar/usd-calendar.json"),
    loadJson<PrevValuesDoc>("/data/calendar/prev-values.json"),
  ]).then(([manifest, earnings, actions, splits, premarket, afterhours, calendar, prevValues]) => {
    radarCache = { manifest, earnings, actions, splits, premarket, afterhours, calendar, prevValues };
    return radarCache;
  }).catch(() => {
    radarPending = null;
    return { manifest: null, earnings: null, actions: null, splits: null, premarket: null, afterhours: null, calendar: null, prevValues: null };
  });
  return radarPending;
}

function fmtNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("ko-KR") : "—";
}

function fmtCompactMoney(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  return value.toLocaleString("en-US");
}

function datePart(value: string | null | undefined): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "—";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return text;
}

function todayKST(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
  }).format(new Date());
}

function shortDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${parseInt(m)}/${parseInt(d)}`;
}

function ddayInfo(dateStr: string, today: string): { big: string; small: string; cls: string } {
  if (dateStr === today) return { big: "오늘", small: shortDate(dateStr), cls: "today" };
  const diff =
    (new Date(`${dateStr}T00:00:00+09:00`).getTime() -
      new Date(`${today}T00:00:00+09:00`).getTime()) /
    86400000;
  if (diff === 1) return { big: "내일", small: shortDate(dateStr), cls: "soon" };
  if (diff <= 3) return { big: `D-${diff}`, small: shortDate(dateStr), cls: "soon" };
  return { big: `D-${diff}`, small: shortDate(dateStr), cls: "" };
}

function shortName(value: string | null | undefined, fallback = "—", max = 34): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return fallback;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function rowsFor(surface: string, manifest: StockanalysisManifest | null): number | null {
  const results = manifest?.surfaces?.sample_results ?? [];
  const hit = results.find((item) => item.surface === surface);
  return typeof hit?.rows === "number" ? hit.rows : null;
}

function surfaceRows<T>(doc: SurfaceDoc<T> | null | undefined): T[] {
  if (Array.isArray(doc?.records)) return doc.records;
  if (Array.isArray(doc?.tables)) {
    return doc.tables.flatMap((table) => (Array.isArray(table.records) ? table.records : []));
  }
  return [];
}

function cleanTicker(value: string | null | undefined): string {
  return String(value || "").replace(/^\$/, "").trim().toUpperCase();
}

function kstDateKey(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function safeRowKey(prefix: string, index: number, ...parts: Array<string | number | null | undefined>): string {
  const body = parts
    .map((part) => (part === null || part === undefined ? "" : String(part).trim()))
    .filter(Boolean)
    .join("-");
  return `${prefix}-${body || index}`;
}

function timingLabel(value: string | null | undefined): string {
  const timing = String(value || "").trim().toLowerCase();
  if (timing === "bmo") return "장전";
  if (timing === "amc") return "장후";
  return "시간 미정";
}

function earningsDetail(row: EarningsRecord): string {
  const eps = typeof row.eps_estimate === "number" ? `EPS ${row.eps_estimate.toFixed(2)}` : "EPS —";
  const revenueEstimate = fmtCompactMoney(row.revenue_estimate);
  const revenue = `매출 ${revenueEstimate === "—" ? "—" : `$${revenueEstimate}`}`;
  return `${datePart(row.date)} · ${timingLabel(row.timing)} · ${eps} · ${revenue}`;
}

function normalizePrevKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9가-힣]+/g, " ")
    .trim()
    .replace(/\s+/g, "_");
}

function previousForEvent(event: CalendarEvent, doc: PrevValuesDoc | null) {
  const values = doc?.values ?? {};
  const aliases = doc?.aliases ?? {};
  const candidates = [event.title_en, event.title_ko]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .flatMap((value) => [value, normalizePrevKey(value), aliases[value], aliases[normalizePrevKey(value)]])
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  for (const key of candidates) {
    const resolved = aliases[key] ?? key;
    const match = values[resolved] ?? values[key];
    if (match?.value) return match;
  }
  return null;
}

function TickerRowLink({ symbol, children }: { symbol?: string | null; children: ReactNode }) {
  const ticker = cleanTicker(symbol);
  if (!ticker) return <div className="mv-row">{children}</div>;
  return (
    <TransitionLink href={`/stock/${encodeURIComponent(ticker)}`} className="mv-row">
      {children}
    </TransitionLink>
  );
}

export default function MarketEventSurfacesCard() {
  const [data, setData] = useState<SurfaceRadarData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<EventTab>("macro");

  useEffect(() => {
    let cancelled = false;
    loadRadarData().then((next) => {
      if (!cancelled) {
        setData(next);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const upcomingEarnings = useMemo(() => {
    const today = kstDateKey();
    return (data?.earnings?.records ?? [])
      .filter((row) => typeof row.date === "string" && row.date >= today)
      .sort((a, b) => {
        const dateCompare = String(a.date).localeCompare(String(b.date));
        if (dateCompare !== 0) return dateCompare;
        return (b.market_cap ?? -1) - (a.market_cap ?? -1);
      })
      .slice(0, 3);
  }, [data]);

  const upcomingMacroEvents = useMemo(() => {
    const today = todayKST();
    return (data?.calendar?.events ?? [])
      .filter((event) => event.date_kst >= today && (event.importance === "H" || event.importance === "M"))
      .slice(0, 3);
  }, [data]);

  const latestActions = useMemo(() => surfaceRows(data?.actions).slice(0, 3), [data]);
  const latestSplit = useMemo(() => surfaceRows(data?.splits)[0] ?? null, [data]);
  const premarketTop = useMemo(() => surfaceRows(data?.premarket)[0] ?? null, [data]);
  const afterhoursTop = useMemo(() => surfaceRows(data?.afterhours)[0] ?? null, [data]);

  const summary = [
    {
      label: "미국 일정",
      detail: upcomingMacroEvents[0]?.title_ko ? `${upcomingMacroEvents[0].title_ko} 다음 이벤트` : "매크로 캘린더",
      value: fmtNumber(upcomingMacroEvents.length),
      tone: upcomingMacroEvents[0]?.importance === "H" ? "up" : "neutral",
    },
    {
      label: "어닝 일정",
      detail: upcomingEarnings[0]?.date ? `${upcomingEarnings[0].date} 다음 이벤트` : "EPS·매출 추정",
      value: fmtNumber(rowsFor("earnings_calendar", data?.manifest ?? null) ?? data?.earnings?.counts?.records),
      tone: "neutral",
    },
    {
      label: "기업 이벤트",
      detail: latestActions[0]?.type ? String(latestActions[0].type) : "기업 이벤트",
      value: fmtNumber(rowsFor("actions_recent", data?.manifest ?? null) ?? data?.actions?.counts?.records),
      tone: "neutral",
    },
    {
      label: "주식분할",
      detail: latestSplit?.symbol ? `${latestSplit.symbol} 최근 분할` : "분할 일정",
      value: fmtNumber(rowsFor("actions_splits", data?.manifest ?? null) ?? data?.splits?.counts?.records),
      tone: "up",
    },
  ];

  const generatedAt = datePart(data?.manifest?.surfaces?.generated_at);
  const earningsAsOf = datePart(data?.earnings?.fetched_at);
  const asOf = generatedAt !== "—" ? generatedAt : earningsAsOf;
  const tabs: Array<{ key: EventTab; label: string; count: number }> = [
    { key: "macro", label: "매크로", count: upcomingMacroEvents.length },
    { key: "corporate", label: "기업", count: upcomingEarnings.length + latestActions.length },
    {
      key: "session",
      label: "장전/장후",
      count: Number(Boolean(premarketTop)) + Number(Boolean(afterhoursTop)) + Number(Boolean(latestSplit)),
    },
  ];

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>이벤트 리스크</h2>
        <span className="desc">{asOf} · KST + 어닝</span>
      </div>

      <div className="mv-col">
        {!loaded ? (
          <div className="mv-row">
            <span className="co">
              <div className="n">이벤트 리스크 확인 중</div>
              <div className="tk">일정·어닝·기업 이벤트를 읽고 있습니다</div>
            </span>
            <span className="pc num neutral">...</span>
          </div>
        ) : (
          summary.map((row) => (
            <div key={row.label} className="mv-row">
              <span className="co">
                <div className="n">{row.label}</div>
                <div className="tk">{row.detail}</div>
              </span>
              <span className={`pc num ${row.tone}`}>{row.value}</span>
            </div>
          ))
        )}
      </div>

      {loaded ? (
        <div className="mt-3 flex flex-wrap gap-2 px-[var(--panel-pad)]">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              aria-pressed={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`min-h-9 rounded-full border px-3 text-[11px] font-black uppercase tracking-wide transition ${
                activeTab === tab.key
                  ? "border-[var(--c-brand)] bg-[var(--c-brand)] text-white"
                  : "border-[var(--c-line)] bg-white text-[var(--c-ink-3)] hover:border-[var(--c-brand)] hover:text-[var(--c-brand)]"
              }`}
            >
              {tab.label} · {fmtNumber(tab.count)}
            </button>
          ))}
        </div>
      ) : null}

      {loaded && activeTab === "macro" ? (
        <div className="mv-col mt-3">
          {upcomingMacroEvents.length > 0 ? (
            upcomingMacroEvents.map((event, index) => {
              const dd = ddayInfo(event.date_kst, todayKST());
              const chipCls = dd.cls === "today" ? "today" : dd.cls === "soon" ? "tom" : "";
              const previous = previousForEvent(event, data?.prevValues ?? null);
              return (
                <div key={`${event.date_kst}-${event.time_kst}-${index}`} className="cal-row">
                  <span className={`dchip ${chipCls}`}>
                    <span className="dd">{dd.big}</span>
                    <small>{dd.small}</small>
                  </span>
                  <span className="ev">
                    <div className="t">{event.title_ko}</div>
                    <div className="m">
                      {event.category_label}
                      {previous?.value ? (
                        <span className="prev num"> · 직전 {previous.value}{previous.asOf ? ` · ${previous.asOf}` : ""}</span>
                      ) : null}
                    </div>
                  </span>
                  <span className={`imp ${event.importance === "H" ? "high" : "mid"}`}>
                    {event.importance === "H" ? "중요" : "보통"}
                  </span>
                </div>
              );
            })
          ) : (
            <div className="mv-row">
              <span className="co">
                <div className="n">표시할 주요 일정 없음</div>
                <div className="tk">KST 기준 H/M 이벤트가 없습니다</div>
              </span>
              <span className="pc num neutral">—</span>
            </div>
          )}
        </div>
      ) : null}

      {loaded && activeTab === "session" ? (
        <div className="mv-col mt-3">
          {premarketTop ? (
            <TickerRowLink symbol={premarketTop.symbol}>
              <span className="co">
                <div className="n">장전 {cleanTicker(premarketTop.symbol) || "—"}</div>
                <div className="tk">{shortName(premarketTop.company_name)} · 거래 {premarketTop.pre_volume || "—"}</div>
              </span>
              <span className="pc num up">{premarketTop.pct_change || premarketTop.premkt_price || "—"}</span>
            </TickerRowLink>
          ) : null}
          {afterhoursTop ? (
            <TickerRowLink symbol={afterhoursTop.symbol}>
              <span className="co">
                <div className="n">장후 {cleanTicker(afterhoursTop.symbol) || "—"}</div>
                <div className="tk">{shortName(afterhoursTop.company_name)} · 종가 {afterhoursTop.afterhr_close || "—"}</div>
              </span>
              <span className="pc num up">{afterhoursTop.pct_change || afterhoursTop.afterhr_price || "—"}</span>
            </TickerRowLink>
          ) : null}
          {latestSplit ? (
            <TickerRowLink symbol={latestSplit.symbol}>
              <span className="co">
                <div className="n">분할 {cleanTicker(latestSplit.symbol) || "—"}</div>
                <div className="tk">{datePart(latestSplit.date)} · {shortName(latestSplit.company_name || latestSplit.name)}</div>
              </span>
              <span className="pc num neutral">{latestSplit.split_ratio || latestSplit.type || "—"}</span>
            </TickerRowLink>
          ) : null}
          {!premarketTop && !afterhoursTop && !latestSplit ? (
            <div className="mv-row">
              <span className="co">
                <div className="n">표시할 세션 이벤트 없음</div>
                <div className="tk">장전·장후·분할 테이프가 비어 있습니다</div>
              </span>
              <span className="pc num neutral">—</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {loaded && activeTab === "corporate" ? (
        <div className="panel-b grid gap-3 lg:grid-cols-2">
          {upcomingEarnings.length > 0 ? (
            <div className="mv-col">
              <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">어닝 캘린더</div>
              {upcomingEarnings.map((row, index) => (
                <TickerRowLink key={safeRowKey("earn", index, row.symbol, row.date, row.name)} symbol={row.symbol}>
                  <span className="co">
                    <div className="n">{cleanTicker(row.symbol) || shortName(row.name)}</div>
                    <div className="tk">{earningsDetail(row)}</div>
                  </span>
                  <span className="pc num neutral">{fmtCompactMoney(row.market_cap)}</span>
                </TickerRowLink>
              ))}
            </div>
          ) : null}

          {latestActions.length > 0 ? (
            <div className="mv-col">
              <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">기업 이벤트</div>
              {latestActions.map((row, index) => (
                <TickerRowLink key={safeRowKey("action", index, row.symbol, row.date, row.type, row.text)} symbol={row.symbol}>
                  <span className="co">
                    <div className="n">{cleanTicker(row.symbol) || shortName(row.name || row.company_name)}</div>
                    <div className="tk">{datePart(row.date)} · {shortName(row.text || row.name || row.company_name, "—", 46)}</div>
                  </span>
                  <span className="pc num neutral">{row.split_ratio || row.type || "—"}</span>
                </TickerRowLink>
              ))}
            </div>
          ) : null}

          {upcomingEarnings.length === 0 && latestActions.length === 0 ? (
            <div className="mv-row lg:col-span-2">
              <span className="co">
                <div className="n">표시할 기업 이벤트 없음</div>
                <div className="tk">어닝·기업 이벤트가 비어 있습니다</div>
              </span>
              <span className="pc num neutral">—</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {loaded && (upcomingMacroEvents[0] || upcomingEarnings[0] || latestActions[0]) ? (
        <div className="panel-foot">
          {upcomingMacroEvents[0] ? (
            <span>다음 일정 {upcomingMacroEvents[0].title_ko} · {shortDate(upcomingMacroEvents[0].date_kst)}</span>
          ) : upcomingEarnings[0] ? (
            <span>다음 어닝 {upcomingEarnings[0].symbol} · {datePart(upcomingEarnings[0].date)}</span>
          ) : latestActions[0] ? (
            <span>최근 이벤트 {latestActions[0].symbol} · {shortName(latestActions[0].text)}</span>
          ) : null}
          <TransitionLink href="/admin/data-lab" className="ml-2 font-black">
            데이터 랩
          </TransitionLink>
        </div>
      ) : null}
    </section>
  );
}
