"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import TransitionLink from "@/components/TransitionLink";

interface SurfaceResult {
  surface?: string;
  group?: string;
  rows?: number | null;
  status?: string | null;
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

interface NewEtfRecord {
  s?: string;
  n?: string;
  inceptionDate?: string;
  price?: number;
  change?: number;
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
  newEtfs: SurfaceDoc<NewEtfRecord> | null;
  earnings: SurfaceDoc<EarningsRecord> | null;
  actions: SurfaceDoc<ActionRecord> | null;
  splits: SurfaceDoc<ActionRecord> | null;
  premarket: SurfaceDoc<SessionMoverRecord> | null;
  afterhours: SurfaceDoc<SessionMoverRecord> | null;
}

let radarCache: SurfaceRadarData | null = null;
let radarPending: Promise<SurfaceRadarData> | null = null;

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
    loadJson<SurfaceDoc<NewEtfRecord>>("/api/data/stockanalysis/surfaces/new_etfs"),
    loadJson<SurfaceDoc<EarningsRecord>>("/api/data/stockanalysis/surfaces/earnings_calendar"),
    loadJson<SurfaceDoc<ActionRecord>>("/api/data/stockanalysis/surfaces/actions_recent"),
    loadJson<SurfaceDoc<ActionRecord>>("/api/data/stockanalysis/surfaces/actions_splits"),
    loadJson<SurfaceDoc<SessionMoverRecord>>("/api/data/stockanalysis/surfaces/market_premarket"),
    loadJson<SurfaceDoc<SessionMoverRecord>>("/api/data/stockanalysis/surfaces/market_afterhours"),
  ]).then(([manifest, newEtfs, earnings, actions, splits, premarket, afterhours]) => {
    radarCache = { manifest, newEtfs, earnings, actions, splits, premarket, afterhours };
    return radarCache;
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

function rowsForGroup(group: string, manifest: StockanalysisManifest | null): number | null {
  const results = manifest?.surfaces?.sample_results ?? [];
  const rows = results
    .filter((item) => item.group === group && item.status === "ok")
    .map((item) => (typeof item.rows === "number" ? item.rows : 0));
  return rows.length ? rows.reduce((sum, value) => sum + value, 0) : null;
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

  const latestActions = useMemo(() => surfaceRows(data?.actions).slice(0, 3), [data]);
  const latestEtfs = useMemo(() => surfaceRows(data?.newEtfs).slice(0, 3), [data]);
  const latestSplit = useMemo(() => surfaceRows(data?.splits)[0] ?? null, [data]);
  const premarketTop = useMemo(() => surfaceRows(data?.premarket)[0] ?? null, [data]);
  const afterhoursTop = useMemo(() => surfaceRows(data?.afterhours)[0] ?? null, [data]);

  const summary = [
    {
      label: "신규 ETF",
      detail: latestEtfs[0]?.s ? `${latestEtfs[0].s} 최근 등록` : "상장 감시",
      value: fmtNumber(rowsFor("new_etfs", data?.manifest ?? null) ?? data?.newEtfs?.counts?.records),
      tone: "up",
    },
    {
      label: "어닝 일정",
      detail: upcomingEarnings[0]?.date ? `${upcomingEarnings[0].date} 다음 이벤트` : "EPS·매출 추정",
      value: fmtNumber(rowsFor("earnings_calendar", data?.manifest ?? null) ?? data?.earnings?.counts?.records),
      tone: "neutral",
    },
    {
      label: "기업 이벤트",
      detail: latestActions[0]?.type ? String(latestActions[0].type) : "액션 테이프",
      value: fmtNumber(rowsFor("actions_recent", data?.manifest ?? null) ?? data?.actions?.counts?.records),
      tone: "neutral",
    },
    {
      label: "ETF 스크리너",
      detail: "AUM·자산군·보유수",
      value: fmtNumber(rowsFor("etf_screener", data?.manifest ?? null)),
      tone: "up",
    },
    {
      label: "IPO 레이더",
      detail: "상장·철회·통계",
      value: fmtNumber(rowsForGroup("ipo", data?.manifest ?? null)),
      tone: "neutral",
    },
    {
      label: "시장 무버",
      detail: "장전·장후·주간·월간",
      value: fmtNumber(rowsForGroup("market_movers", data?.manifest ?? null)),
      tone: "neutral",
    },
    {
      label: "산업 지도",
      detail: "섹터·업종 구성",
      value: fmtNumber(rowsForGroup("industry", data?.manifest ?? null)),
      tone: "up",
    },
  ];

  const asOf =
    datePart(data?.manifest?.surfaces?.generated_at)
    || datePart(data?.newEtfs?.fetched_at)
    || datePart(data?.earnings?.fetched_at);

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>시장 이벤트 레이더</h2>
        <span className="desc">{asOf} · {fmtNumber(data?.manifest?.surfaces?.counts?.surfaces_requested)}개 표면</span>
      </div>

      <div className="mv-col">
        {!loaded ? (
          <div className="mv-row">
            <span className="co">
              <div className="n">이벤트 데이터 확인 중</div>
              <div className="tk">로컬 데이터팩을 읽고 있습니다</div>
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

      {loaded && (premarketTop || afterhoursTop || latestSplit) ? (
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
        </div>
      ) : null}

      {loaded && (upcomingEarnings.length > 0 || latestActions.length > 0) ? (
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
        </div>
      ) : null}

      {upcomingEarnings[0] || latestActions[0] || latestEtfs[0] ? (
        <div className="panel-foot">
          {upcomingEarnings[0] ? (
            <span>다음 어닝 {upcomingEarnings[0].symbol} · {datePart(upcomingEarnings[0].date)}</span>
          ) : latestEtfs[0] ? (
            <span>최근 ETF {latestEtfs[0].s} · {shortName(latestEtfs[0].n)}</span>
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
