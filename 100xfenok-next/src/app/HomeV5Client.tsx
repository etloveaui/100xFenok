"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/shell/AppShell";
import TransitionLink from "@/components/TransitionLink";
import { useDashboardData } from "@/hooks/useDashboardData";
import { clamp, getRegimeClass, getRegimeLabel } from "@/lib/dashboard/formatters";
import type { DashboardSnapshot, SectorSnapshot } from "@/lib/dashboard/types";
import { formatSignedPercent } from "@/lib/format";
import {
  loadStockConnectionIndex,
  loadStockServicesIndex,
  type StockConnectionIndex,
  type StockServicesIndex,
} from "@/lib/data-entity-graph/stock-index";
import ExploreDashboard from "./explore/ExploreDashboard";
import ExploreHotTopics from "./explore/ExploreHotTopics";
import EtfUniverseCard from "./explore/EtfUniverseCard";
import MacroPlaybookCard from "./explore/MacroPlaybookCard";
import MarketEventSurfacesCard from "./explore/MarketEventSurfacesCard";
import MyWatchlistStrip from "./explore/MyWatchlistStrip";
import StockWorkbenchCard from "./explore/StockWorkbenchCard";

type RegimeForce = {
  label: string;
  value: number;
  detail: string;
  tone: "up" | "neutral" | "warn";
};

type RegimeRead = {
  label: string;
  className: string;
  score: number;
  confidence: number;
  headline: string;
  detail: string;
  forces: RegimeForce[];
};

type EntityGraphSummary = {
  stocks: number | null;
  withFilings: number | null;
  with13f: number | null;
  withIndex: number | null;
  withSingleStockEtfs: number | null;
  singleStockEtfs: number | null;
  generatedAt: string | null;
};

function buildRegimeRead(dashboard: DashboardSnapshot): RegimeRead {
  const breadthTotal = Math.max(dashboard.sectorRows.length, 1);
  const breadthRatio = dashboard.sectorUp / breadthTotal;
  const sentiment = (dashboard.fearGreedScore / 100) * 0.45;
  const breadth = breadthRatio * 0.35;
  const stability = (1 - dashboard.stressScore) * 0.2;
  const score = clamp(sentiment + breadth + stability, 0, 1);
  const total = Math.max(sentiment + breadth + stability, 0.0001);
  const className = getRegimeClass(score);

  const headline =
    className === "is-risk-on"
      ? "위험 선호가 우세합니다"
      : className === "is-risk-off"
        ? "방어 우선 구간입니다"
        : "선별 장세입니다";

  return {
    label: getRegimeLabel(score),
    className,
    score,
    confidence: Math.round(score * 100),
    headline,
    detail: `심리 ${Math.round(dashboard.fearGreedScore)} · 섹터 ${dashboard.sectorUp}/${breadthTotal} 상승 · 스트레스 ${dashboard.stressScore.toFixed(2)}`,
    forces: [
      {
        label: "심리",
        value: Math.round((sentiment / total) * 100),
        detail: `F&G ${Math.round(dashboard.fearGreedScore)} · ${dashboard.fearGreedLabel}`,
        tone: dashboard.fearGreedScore >= 55 ? "up" : dashboard.fearGreedScore < 45 ? "warn" : "neutral",
      },
      {
        label: "확산",
        value: Math.round((breadth / total) * 100),
        detail: `${dashboard.sectorUp}개 상승 · ${dashboard.sectorDown}개 하락`,
        tone: breadthRatio >= 0.55 ? "up" : breadthRatio < 0.45 ? "warn" : "neutral",
      },
      {
        label: "안정",
        value: Math.round((stability / total) * 100),
        detail: `${dashboard.stressLabel} · 10Y ${dashboard.tenYearYield.toFixed(2)}%`,
        tone: dashboard.stressTone === "low" ? "up" : dashboard.stressTone === "high" ? "warn" : "neutral",
      },
    ],
  };
}

function formatPrice(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatMetric(value: number | null | undefined, suffix = ""): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}${suffix}`;
}

function signedClass(value: number | null | undefined): "up" | "down" | "neu" {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) < 0.0001) return "neu";
  return value > 0 ? "up" : "down";
}

function pct(value: number | null | undefined, digits = 1): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return formatSignedPercent(value, { digits });
}

function formatDatePart(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

function V5MarketNow({ dashboard, dataReady, failedSources }: {
  dashboard: DashboardSnapshot;
  dataReady: boolean;
  failedSources: string[];
}) {
  const quickItems = dashboard.quickIndices.map((item) => ({
    key: item.symbol,
    label: item.symbol,
    value: formatPrice(item.price),
    change: item.change,
    meta: item.displayHorizon === "1D" ? "실시간" : "기준값",
  }));

  const items = [
    ...quickItems,
    {
      key: "vix",
      label: "VIX",
      value: dashboard.vixValue.toFixed(1),
      change: null,
      meta: dashboard.vixLabel,
    },
    {
      key: "fg",
      label: "F&G",
      value: Math.round(dashboard.fearGreedScore).toString(),
      change: null,
      meta: dashboard.fearGreedLabel,
    },
    {
      key: "ten-year",
      label: "10Y",
      value: formatMetric(dashboard.tenYearYield, "%"),
      change: null,
      meta: "국채",
    },
    {
      key: "hy",
      label: "HY",
      value: formatMetric(dashboard.hySpread, "%"),
      change: null,
      meta: "스프레드",
    },
  ];

  return (
    <section className="v5-market-now" aria-label="시장 현재값">
      <div className="v5-market-now__head">
        <span className={`v5-live-dot ${dataReady ? "is-on" : ""}`} aria-hidden="true" />
        <span>Market Now</span>
        <b>{dashboard.sectorMode === "LIVE_1D" ? "LIVE" : dashboard.sectorMode === "MIXED" ? "MIXED" : "BASE"}</b>
        <span className="v5-market-now__meta">
          {failedSources.length === 0 ? "소스 정상" : `대체 ${failedSources.length}`}
        </span>
      </div>
      <div className="v5-market-now__rail">
        {items.map((item) => (
          <div key={item.key} className="v5-quote-cell">
            <span className="v5-quote-cell__label">{item.label}</span>
            <span className="v5-quote-cell__value num">{item.value}</span>
            <span className={`v5-quote-cell__change num ${signedClass(item.change)}`}>
              {typeof item.change === "number" ? pct(item.change) : item.meta}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function V5ReadingHero({ regime, dashboard, dataReady }: {
  regime: RegimeRead;
  dashboard: DashboardSnapshot;
  dataReady: boolean;
}) {
  return (
    <section className={`v5-reading ${regime.className}`} aria-labelledby="v5-reading-title">
      <div className="v5-reading__copy">
        <div className="v5-eyebrow">
          <span className={`v5-live-dot ${dataReady ? "is-on" : ""}`} aria-hidden="true" />
          <span>{dataReady ? "동기화됨" : "확인 중"}</span>
          <span>데이터 {formatDatePart(dashboard.tickerFetchedAt)}</span>
        </div>
        <h1 id="v5-reading-title">{regime.headline}</h1>
        <p>{regime.detail}</p>
      </div>

      <div className="v5-gauge" aria-label={`시장 판독 점수 ${regime.confidence}점`}>
        <div className="v5-gauge__readout">
          <span className="num">{regime.confidence}</span>
          <small>/100</small>
          <b>{regime.label}</b>
        </div>
        <div className="v5-gauge__scale">
          <span className="v5-gauge__track" />
          <span className="v5-gauge__tick" style={{ left: "25%" }} />
          <span className="v5-gauge__tick is-mid" style={{ left: "50%" }} />
          <span className="v5-gauge__tick" style={{ left: "75%" }} />
          <span className="v5-gauge__needle" style={{ left: `${regime.confidence}%` }} />
        </div>
        <div className="v5-gauge__axis">
          <span>방어</span>
          <span>중립</span>
          <span>위험 선호</span>
        </div>
      </div>

      <div className="v5-forces">
        {regime.forces.map((force) => (
          <div key={force.label} className={`v5-force ${force.tone}`}>
            <div className="v5-force__top">
              <b>{force.label}</b>
              <span className="num">{force.value}%</span>
            </div>
            <span className="v5-force__bar">
              <i style={{ width: `${Math.max(8, force.value)}%` }} />
            </span>
            <p>{force.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function pulseTint(change: number | null): string {
  if (typeof change !== "number" || !Number.isFinite(change)) return "transparent";
  const alpha = Math.min(Math.abs(change) * 7, 0.22);
  const amount = `${Math.round(alpha * 100)}%`;
  return change >= 0
    ? `color-mix(in srgb, var(--c-up) ${amount}, transparent)`
    : `color-mix(in srgb, var(--c-down) ${amount}, transparent)`;
}

function V5MarketPulse({ dashboard }: { dashboard: DashboardSnapshot }) {
  const sectorTiles = dashboard.sectorRows
    .slice()
    .sort((a, b) => Math.abs(b.displayChange) - Math.abs(a.displayChange))
    .slice(0, 10);

  const tiles: Array<{
    key: string;
    label: string;
    value: string;
    change: number | null;
    meta: string;
  }> = [
    ...dashboard.quickIndices.map((item) => ({
      key: item.symbol,
      label: item.symbol,
      value: formatPrice(item.price),
      change: item.change,
      meta: item.displayHorizon,
    })),
    ...sectorTiles.map((sector: SectorSnapshot) => ({
      key: sector.key,
      label: sector.name,
      value: sector.quotePrice ? formatPrice(sector.quotePrice) : sector.etf,
      change: sector.displayChange,
      meta: sector.displayHorizon,
    })),
  ];

  return (
    <section className="panel v5-pulse" aria-labelledby="v5-pulse-title">
      <div className="panel-h">
        <h2 id="v5-pulse-title">시장 펄스</h2>
        <span className="desc">지수 · 섹터 · 강도</span>
        <TransitionLink href="/sectors" className="act">
          섹터 →
        </TransitionLink>
      </div>
      <div className="v5-pulse__grid">
        {tiles.map((tile) => (
          <TransitionLink
            key={tile.key}
            href={tile.key === "SPY" || tile.key === "QQQ" ? `/stock/${tile.key}` : "/sectors"}
            className="v5-pulse__tile"
            style={{ backgroundColor: pulseTint(tile.change) }}
          >
            <span className="v5-pulse__label">{tile.label}</span>
            <span className="v5-pulse__value num">{tile.value}</span>
            <span className={`v5-pulse__change num ${signedClass(tile.change)}`}>
              {pct(tile.change)}
              <small>{tile.meta}</small>
            </span>
          </TransitionLink>
        ))}
      </div>
    </section>
  );
}

function summarizeGraph(
  stockIndex: StockConnectionIndex | null,
  serviceIndex: StockServicesIndex | null,
): EntityGraphSummary {
  return {
    stocks: stockIndex?.totals?.stocks ?? null,
    withFilings: stockIndex?.totals?.with_filings ?? null,
    with13f: stockIndex?.totals?.with_sec_13f ?? null,
    withIndex: stockIndex?.totals?.with_index_membership ?? null,
    withSingleStockEtfs: serviceIndex?.totals?.with_single_stock_etfs ?? null,
    singleStockEtfs: serviceIndex?.totals?.single_stock_etfs ?? null,
    generatedAt: stockIndex?.generated_at ?? serviceIndex?.generated_at ?? null,
  };
}

function V5ConnectedServicesPanel() {
  const [summary, setSummary] = useState<EntityGraphSummary | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      loadStockConnectionIndex(controller.signal),
      loadStockServicesIndex(controller.signal),
    ])
      .then(([stockIndex, serviceIndex]) => {
        setSummary(summarizeGraph(stockIndex, serviceIndex));
        setLoaded(true);
      })
      .catch(() => {
        setSummary(null);
        setLoaded(true);
      });

    return () => controller.abort();
  }, []);

  const rows = [
    { label: "종목 키", value: summary?.stocks, href: "/screener" },
    { label: "공시", value: summary?.withFilings, href: "/stock/NVDA?tab=filings" },
    { label: "13F", value: summary?.with13f, href: "/superinvestors" },
    { label: "지수", value: summary?.withIndex, href: "/market" },
    { label: "단일주 ETF", value: summary?.singleStockEtfs ?? summary?.withSingleStockEtfs, href: "/etfs" },
  ];

  return (
    <section className="panel v5-connected" aria-labelledby="v5-connected-title">
      <div className="panel-h">
        <h2 id="v5-connected-title">연결 맵</h2>
        <span className="desc">{summary?.generatedAt ? formatDatePart(summary.generatedAt) : loaded ? "대기" : "확인 중"}</span>
      </div>
      <div className="v5-connected__grid">
        {rows.map((row) => (
          <TransitionLink key={row.label} href={row.href} className="v5-connected__item">
            <span>{row.label}</span>
            <b className="num">{typeof row.value === "number" ? row.value.toLocaleString("ko-KR") : "—"}</b>
          </TransitionLink>
        ))}
      </div>
      <div className="panel-foot">
        종목 · ETF · 13F · 공시 · 지수 멤버십
      </div>
    </section>
  );
}

export default function HomeV5Client() {
  const { dashboard, dataReady, failedSources } = useDashboardData();
  const regime = useMemo(() => buildRegimeRead(dashboard), [dashboard]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("v5") !== "1") return;
    document.cookie = "fenok_design_version=v5; Path=/; Max-Age=2592000; SameSite=Lax";
  }, []);

  return (
    <div className="fnk-shell v5-home">
      <AppShell active="explore" title="마켓 홈">
        <div className="v5-stack">
          <V5MarketNow dashboard={dashboard} dataReady={dataReady} failedSources={failedSources} />
          <V5ReadingHero regime={regime} dashboard={dashboard} dataReady={dataReady} />
          <V5MarketPulse dashboard={dashboard} />

          <div className="v5-layout">
            <div className="v5-layout__main">
              <MarketEventSurfacesCard />
              <div className="v5-two">
                <ExploreDashboard />
                <StockWorkbenchCard />
              </div>
              <div className="v5-two">
                <MacroPlaybookCard />
                <V5ConnectedServicesPanel />
              </div>
              <ExploreHotTopics />
            </div>
            <div className="v5-layout__side">
              <MyWatchlistStrip />
              <EtfUniverseCard limit={6} />
            </div>
          </div>

          <p className="data-cap">
            데이터: 실시간 시세 · 시장 신호 · 이벤트 · 섹터 · 종목 리더보드 · ETF · 13F · 연결 인덱스
          </p>
        </div>
      </AppShell>
    </div>
  );
}
