"use client";

import { useEffect, useMemo, useState } from "react";
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
  text?: string;
}

interface SurfaceRadarData {
  manifest: StockanalysisManifest | null;
  newEtfs: SurfaceDoc<NewEtfRecord> | null;
  earnings: SurfaceDoc<EarningsRecord> | null;
  actions: SurfaceDoc<ActionRecord> | null;
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
  ]).then(([manifest, newEtfs, earnings, actions]) => {
    radarCache = { manifest, newEtfs, earnings, actions };
    return radarCache;
  });
  return radarPending;
}

function fmtNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("ko-KR") : "—";
}

function datePart(value: string | null | undefined): string {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : "—";
}

function shortName(value: string | null | undefined, fallback = "—"): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return fallback;
  return text.length > 34 ? `${text.slice(0, 33)}…` : text;
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
    const today = new Date().toISOString().slice(0, 10);
    return (data?.earnings?.records ?? [])
      .filter((row) => typeof row.date === "string" && row.date >= today)
      .sort((a, b) => {
        const dateCompare = String(a.date).localeCompare(String(b.date));
        if (dateCompare !== 0) return dateCompare;
        return (b.market_cap ?? -1) - (a.market_cap ?? -1);
      })
      .slice(0, 3);
  }, [data]);

  const latestActions = useMemo(() => (data?.actions?.records ?? []).slice(0, 3), [data]);
  const latestEtfs = useMemo(() => (data?.newEtfs?.records ?? []).slice(0, 3), [data]);

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

      {upcomingEarnings[0] || latestActions[0] || latestEtfs[0] ? (
        <div className="panel-foot">
          {upcomingEarnings[0] ? (
            <span>다음 어닝 {upcomingEarnings[0].symbol} · {datePart(upcomingEarnings[0].date)}</span>
          ) : latestEtfs[0] ? (
            <span>최근 ETF {latestEtfs[0].s} · {shortName(latestEtfs[0].n)}</span>
          ) : latestActions[0] ? (
            <span>최근 이벤트 {latestActions[0].symbol} · {shortName(latestActions[0].text)}</span>
          ) : null}
          <TransitionLink href="/admin/data-lab" style={{ marginLeft: 8, fontWeight: 900 }}>
            데이터 랩
          </TransitionLink>
        </div>
      ) : null}
    </section>
  );
}
