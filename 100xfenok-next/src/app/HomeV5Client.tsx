"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/shell/AppShell";
import TickerChip from "@/components/TickerChip";
import TransitionLink from "@/components/TransitionLink";
import ConnectedView from "@/components/connected/ConnectedView";
import LeadStoryCard from "@/components/connected/LeadStoryCard";
import { TraversalTrailProvider, useTraversalTrail } from "@/components/connected/useTraversalTrail";
import { useDashboardData } from "@/hooks/useDashboardData";
import { clamp, getRegimeClass, getRegimeLabel } from "@/lib/dashboard/formatters";
import type { DashboardSnapshot, SectorSnapshot } from "@/lib/dashboard/types";
import { formatSignedPercent } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import {
  getStockConnection,
  getStockServices,
  loadStockConnectionIndex,
  loadStockServicesIndex,
  type StockConnectionEntry,
  type StockConnectionIndex,
  type StockServicesEntry,
  type StockServicesIndex,
} from "@/lib/data-entity-graph/stock-index";
import {
  loadByTickerHolders,
  loadInvestorHoldings,
  type HolderDetail,
  type InvestorFiling,
  type InvestorHolding,
  type InvestorResult,
  type TickerHoldersResult,
} from "@/lib/connected/connected-loaders";
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

type ConnectionTileId = "smart-money" | "etf-exposure" | "sector-leaders" | "recent-filings";

type ConnectionCandidate = {
  ticker: string;
  label: string;
  href: string;
  stat: string;
  meta: string;
  entry: StockConnectionEntry;
  services: StockServicesEntry | null;
};

type ConnectionTile = {
  id: ConnectionTileId;
  label: string;
  description: string;
  value: string;
  meta: string;
  tone: "blue" | "violet" | "cyan" | "amber" | "emerald";
  candidates: ConnectionCandidate[];
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
          <div
            key={tile.key}
            className="v5-pulse__tile"
            style={{ backgroundColor: pulseTint(tile.change) }}
          >
            <span className="v5-pulse__label">
              {tile.key === "SPY" || tile.key === "QQQ" ? <TickerChip ticker={tile.key} label={tile.label} variant="inline" /> : tile.label}
            </span>
            <span className="v5-pulse__value num">{tile.value}</span>
            <span className={`v5-pulse__change num ${signedClass(tile.change)}`}>
              {pct(tile.change)}
              <small>{tile.meta}</small>
            </span>
          </div>
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

function formatCompactCount(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value >= 1000) return value.toLocaleString("ko-KR");
  return value.toString();
}

function formatMoney(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(0)}M`;
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatInvestorName(value: string): string {
  return value
    .split("_")
    .map((part) => part ? `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}` : "")
    .join(" ");
}

function latestFiling(filings: InvestorFiling[]): InvestorFiling | null {
  return filings
    .slice()
    .sort((a, b) => (b.quarter || b.filing_date).localeCompare(a.quarter || a.filing_date))
    [0] ?? null;
}

function entryScore(entry: StockConnectionEntry): number {
  return (entry.connection_count ?? 0) * 100 + (entry.service_count ?? 0) * 8 + (entry.confidence?.rank ?? 0);
}

function asEntries(stockIndex: StockConnectionIndex | null): StockConnectionEntry[] {
  return Object.values(stockIndex?.stocks ?? {})
    .filter((entry): entry is StockConnectionEntry => !!entry?.ticker)
    .sort((a, b) => entryScore(b) - entryScore(a));
}

function makeCandidate(
  entry: StockConnectionEntry,
  serviceIndex: StockServicesIndex | null,
  stat: string,
  meta: string,
  href?: string,
): ConnectionCandidate {
  return {
    ticker: entry.ticker,
    label: entry.label || entry.ticker,
    href: href ?? entry.route ?? ROUTES.stock(entry.ticker),
    stat,
    meta,
    entry,
    services: getStockServices(serviceIndex, entry.ticker),
  };
}

function sectorLeaderCandidates(
  entries: StockConnectionEntry[],
  serviceIndex: StockServicesIndex | null,
): ConnectionCandidate[] {
  const bySector = new Map<string, StockConnectionEntry[]>();
  for (const entry of entries) {
    const sector = entry.canonical_sector;
    if (!sector) continue;
    const list = bySector.get(sector) ?? [];
    list.push(entry);
    bySector.set(sector, list);
  }

  return Array.from(bySector.entries())
    .map(([sector, sectorEntries]) => {
      const leader = sectorEntries.slice().sort((a, b) => entryScore(b) - entryScore(a))[0];
      return leader ? makeCandidate(leader, serviceIndex, `${sectorEntries.length}종목`, sector) : null;
    })
    .filter((candidate): candidate is ConnectionCandidate => candidate !== null)
    .sort((a, b) => entryScore(b.entry) - entryScore(a.entry))
    .slice(0, 3);
}

function buildConnectionTiles(
  stockIndex: StockConnectionIndex | null,
  serviceIndex: StockServicesIndex | null,
): { summary: EntityGraphSummary; tiles: ConnectionTile[] } {
  const summary = summarizeGraph(stockIndex, serviceIndex);
  const entries = asEntries(stockIndex);
  const smartMoney = entries
    .filter((entry) => entry.flags?.sec_13f)
    .slice(0, 3)
    .map((entry) => makeCandidate(entry, serviceIndex, `${entry.connection_count ?? 0}연결`, entry.as_of?.sec_13f ?? "13F"));
  const etfExposure = entries
    .filter((entry) => (entry.service_count ?? 0) > 0)
    .sort((a, b) => (b.service_count ?? 0) - (a.service_count ?? 0) || entryScore(b) - entryScore(a))
    .slice(0, 3)
    .map((entry) => makeCandidate(entry, serviceIndex, `${entry.service_count ?? 0}개 ETF`, entry.canonical_sector ?? "ETF"));
  const sectorLeaders = sectorLeaderCandidates(entries, serviceIndex);
  const recentFilings = entries
    .filter((entry) => entry.flags?.filings)
    .sort((a, b) => (b.as_of?.filings ?? "").localeCompare(a.as_of?.filings ?? "") || entryScore(b) - entryScore(a))
    .slice(0, 3)
    .map((entry) => makeCandidate(entry, serviceIndex, entry.as_of?.filings ?? "공시", entry.canonical_sector ?? "EDGAR", ROUTES.stockFilings(entry.ticker)));

  return {
    summary,
    tiles: [
      {
        id: "smart-money",
        label: "스마트머니 겹침",
        description: "13F 보유자가 겹치는 종목에서 시작",
        value: formatCompactCount(summary.with13f),
        meta: "13F overlap",
        tone: "violet",
        candidates: smartMoney,
      },
      {
        id: "etf-exposure",
        label: "ETF 노출",
        description: "단일종목 ETF가 붙은 고노출 종목",
        value: formatCompactCount(summary.singleStockEtfs ?? summary.withSingleStockEtfs),
        meta: "ETF exposure",
        tone: "cyan",
        candidates: etfExposure,
      },
      {
        id: "sector-leaders",
        label: "섹터 → 리더",
        description: "섹터 분기점에서 대표 종목으로 이동",
        value: formatCompactCount(summary.withIndex),
        meta: "sector junction",
        tone: "amber",
        candidates: sectorLeaders,
      },
      {
        id: "recent-filings",
        label: "최근 공시",
        description: "공시가 갱신된 종목으로 바로 진입",
        value: formatCompactCount(summary.withFilings),
        meta: "link-only",
        tone: "emerald",
        candidates: recentFilings,
      },
    ],
  };
}

function V5ConnectionConsole() {
  return (
    <TraversalTrailProvider>
      <V5ConnectionConsoleInner />
    </TraversalTrailProvider>
  );
}

function V5ConnectionConsoleInner() {
  const [stockIndex, setStockIndex] = useState<StockConnectionIndex | null>(null);
  const [serviceIndex, setServiceIndex] = useState<StockServicesIndex | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [activeTileId, setActiveTileId] = useState<ConnectionTileId | null>(null);
  const [selectedTickers, setSelectedTickers] = useState<Partial<Record<ConnectionTileId, string>>>({});
  const { trail, pushTrail, popTrailTo } = useTraversalTrail();

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      loadStockConnectionIndex(controller.signal),
      loadStockServicesIndex(controller.signal),
    ])
      .then(([nextStockIndex, nextServiceIndex]) => {
        setStockIndex(nextStockIndex);
        setServiceIndex(nextServiceIndex);
        setLoaded(true);
      })
      .catch(() => {
        setStockIndex(null);
        setServiceIndex(null);
        setLoaded(true);
      });

    return () => controller.abort();
  }, []);

  const { summary, tiles } = useMemo(() => buildConnectionTiles(stockIndex, serviceIndex), [serviceIndex, stockIndex]);

  function selectedCandidate(tile: ConnectionTile): ConnectionCandidate | null {
    const selectedTicker = selectedTickers[tile.id] ?? tile.candidates[0]?.ticker;
    return tile.candidates.find((candidate) => candidate.ticker === selectedTicker) ?? tile.candidates[0] ?? null;
  }

  function openTile(tile: ConnectionTile) {
    const nextOpen = activeTileId === tile.id ? null : tile.id;
    setActiveTileId(nextOpen);
    const candidate = selectedCandidate(tile);
    if (nextOpen && candidate) {
      setSelectedTickers((current) => ({ ...current, [tile.id]: candidate.ticker }));
      pushTrail({ id: `ticker:${candidate.ticker}`, label: candidate.ticker, kind: "ticker", href: candidate.href });
    }
  }

  function selectCandidate(tile: ConnectionTile, candidate: ConnectionCandidate) {
    setSelectedTickers((current) => ({ ...current, [tile.id]: candidate.ticker }));
    pushTrail({ id: `ticker:${candidate.ticker}`, label: candidate.ticker, kind: "ticker", href: candidate.href });
  }

  return (
    <section className="panel v5-connected v5-connection-console" aria-labelledby="v5-connected-title">
      <div className="panel-h">
        <h2 id="v5-connected-title">연결 콘솔</h2>
        <span className="desc">{summary.generatedAt ? formatDatePart(summary.generatedAt) : loaded ? "대기" : "확인 중"}</span>
      </div>
      <div className="v5-connection-console__rows">
        {tiles.map((tile) => {
          const isOpen = activeTileId === tile.id;
          const candidate = selectedCandidate(tile);
          return (
            <div key={tile.id} className={`v5-connection-row is-${tile.tone} ${isOpen ? "is-open" : ""}`}>
              <div className="v5-connection-row__main">
                <div className="v5-connection-row__copy">
                  <span>{tile.label}</span>
                  <p>{tile.description}</p>
                </div>
                <div className="v5-connection-row__metric">
                  <b className="num">{tile.value}</b>
                  <small>{tile.meta}</small>
                </div>
                <button
                  type="button"
                  className="v5-peek-button"
                  aria-expanded={isOpen}
                  onClick={() => openTile(tile)}
                >
                  {isOpen ? "[peek ▴]" : "[peek ▾]"}
                </button>
              </div>
              {isOpen && candidate ? (
                <V5ConnectionPeekDrawer
                  tile={tile}
                  selected={candidate}
                  stockIndex={stockIndex}
                  serviceIndex={serviceIndex}
                  onSelect={(next) => selectCandidate(tile, next)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      {trail.length > 0 ? (
        <div className="v5-traversal-trail" aria-label="연결 이동 경로">
          {trail.map((item, index) => (
            <button key={`${item.id}-${index}`} type="button" onClick={() => popTrailTo(index)}>
              {item.label ?? item.id}
            </button>
          ))}
        </div>
      ) : null}
      <div className="panel-foot">
        종목 · ETF · 13F · 공시 · 지수 멤버십
      </div>
    </section>
  );
}

function V5ConnectionPeekDrawer({
  tile,
  selected,
  stockIndex,
  serviceIndex,
  onSelect,
}: {
  tile: ConnectionTile;
  selected: ConnectionCandidate;
  stockIndex: StockConnectionIndex | null;
  serviceIndex: StockServicesIndex | null;
  onSelect: (candidate: ConnectionCandidate) => void;
}) {
  const entry = getStockConnection(stockIndex, selected.ticker) ?? selected.entry;
  const services = getStockServices(serviceIndex, selected.ticker) ?? selected.services;

  return (
    <div className="v5-connection-drawer" data-testid="v5-connection-drawer">
      <div className="v5-connection-drawer__candidates" aria-label={`${tile.label} 후보`}>
        {tile.candidates.slice(0, 3).map((candidate) => (
          <button
            key={candidate.ticker}
            type="button"
            className={candidate.ticker === selected.ticker ? "is-active" : ""}
            onClick={() => onSelect(candidate)}
          >
            <span>{candidate.ticker}</span>
            <b>{candidate.stat}</b>
            <small>{candidate.meta}</small>
          </button>
        ))}
      </div>
      <ConnectedView ticker={selected.ticker} entry={entry} services={services} variant="drawer" compact />
      {tile.id === "smart-money" ? <V5SmartMoneyTwoHop ticker={selected.ticker} label={selected.label} /> : null}
      <div className="v5-connection-drawer__footer">
        역방향
        <TransitionLink href={ROUTES.stock(selected.ticker)}>{selected.ticker} 전체 보기</TransitionLink>
        <TransitionLink href="/superinvestors">13F 맵</TransitionLink>
      </div>
    </div>
  );
}

function V5SmartMoneyTwoHop({ ticker, label }: { ticker: string; label: string }) {
  const [holders, setHolders] = useState<TickerHoldersResult | null | undefined>(undefined);
  const [selectedHolder, setSelectedHolder] = useState<HolderDetail | null>(null);
  const [investor, setInvestor] = useState<InvestorResult | null | undefined>(undefined);
  const { pushTrail } = useTraversalTrail();

  useEffect(() => {
    let cancelled = false;
    setHolders(undefined);
    setSelectedHolder(null);
    setInvestor(undefined);
    const timer = window.setTimeout(() => {
      loadByTickerHolders(ticker).then((next) => {
        if (!cancelled) setHolders(next);
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ticker]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedHolder) {
      setInvestor(undefined);
      return () => { cancelled = true; };
    }
    setInvestor(undefined);
    const timer = window.setTimeout(() => {
      loadInvestorHoldings(selectedHolder.investor).then((next) => {
        if (!cancelled) setInvestor(next);
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [selectedHolder]);

  const topHolders = (holders?.holder_details ?? [])
    .slice()
    .sort((a, b) => b.market_value - a.market_value)
    .slice(0, 3);
  const filing = investor ? latestFiling(investor.filings) : null;
  const seenHoldingTickers = new Set<string>();
  const otherHoldings = (filing?.holdings ?? [])
    .filter((holding): holding is InvestorHolding & { ticker: string } => typeof holding.ticker === "string" && holding.ticker.length > 0 && holding.ticker !== ticker)
    .slice()
    .sort((a, b) => (b.market_value ?? 0) - (a.market_value ?? 0))
    .filter((holding) => {
      const key = holding.ticker.toUpperCase();
      if (seenHoldingTickers.has(key)) return false;
      seenHoldingTickers.add(key);
      return true;
    })
    .slice(0, 3);

  function selectHolder(holder: HolderDetail) {
    setSelectedHolder(holder);
    pushTrail({ id: `holder:${holder.investor}`, label: formatInvestorName(holder.investor), kind: "13f-holder" });
  }

  return (
    <div className="v5-two-hop" data-testid="v5-two-hop">
      <div className="v5-two-hop__head">
        <span>13F two-hop</span>
        <b>{label}</b>
      </div>
      {holders === undefined ? (
        <p className="v5-two-hop__empty">보유자 확인 중...</p>
      ) : topHolders.length > 0 ? (
        <div className="v5-holder-list" aria-label={`${ticker} 상위 보유자`}>
          {topHolders.map((holder) => (
            <button
              key={holder.investor}
              type="button"
              className={selectedHolder?.investor === holder.investor ? "is-active" : ""}
              onClick={() => selectHolder(holder)}
            >
              <span>{formatInvestorName(holder.investor)}</span>
              <b>{formatMoney(holder.market_value)}</b>
              <small>{holder.weight > 0 ? `${(holder.weight * 100).toFixed(1)}% weight` : "13F holder"}</small>
            </button>
          ))}
        </div>
      ) : (
        <p className="v5-two-hop__empty">13F 보유자 데이터가 없습니다.</p>
      )}

      {selectedHolder ? (
        <div className="v5-holder-nested" data-testid="v5-holder-nested">
          <div className="v5-holder-nested__head">
            <span>{formatInvestorName(selectedHolder.investor)} 다른 보유</span>
            <small>{filing?.quarter ?? (investor === undefined ? "확인 중" : "데이터 없음")}</small>
          </div>
          {investor === undefined ? (
            <p className="v5-two-hop__empty">포트폴리오 확인 중...</p>
          ) : otherHoldings.length > 0 ? (
            <div className="v5-holder-holdings">
              {otherHoldings.map((holding) => (
                <div
                  key={`${selectedHolder.investor}-${holding.ticker}`}
                >
                  <span onClick={() => pushTrail({ id: `ticker:${holding.ticker}`, label: holding.ticker, kind: "ticker", href: ROUTES.stock(holding.ticker) })}>
                    <TickerChip ticker={holding.ticker} variant="inline" />
                  </span>
                  <b>{formatMoney(holding.market_value)}</b>
                  <small>{holding.company ?? holding.name ?? "holding"}</small>
                </div>
              ))}
            </div>
          ) : (
            <p className="v5-two-hop__empty">표시할 다른 보유 종목이 없습니다.</p>
          )}
        </div>
      ) : null}
    </div>
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
          <LeadStoryCard />

          <div className="v5-layout">
            <div className="v5-layout__main">
              <MarketEventSurfacesCard />
              <div className="v5-two">
                <ExploreDashboard />
                <StockWorkbenchCard />
              </div>
              <div className="v5-two">
                <MacroPlaybookCard />
                <V5ConnectionConsole />
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
