"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import AppShell from "@/components/shell/AppShell";
import TickerTypeahead from "@/components/TickerTypeahead";
import TransitionLink from "@/components/TransitionLink";
import CpBadge from "@/components/canvas-plus/CpBadge";
import CpPriceChart from "@/components/canvas-plus/charts/CpPriceChart";
import type { CpChartDatum } from "@/components/canvas-plus/charts/types";
import { useDashboardData } from "@/hooks/useDashboardData";
import { clamp, formatSignedPercentDecimal, getRegimeClass, getRegimeLabel } from "@/lib/dashboard/formatters";
import type { DashboardSnapshot, SectorSnapshot } from "@/lib/dashboard/types";
import { EXPLORE_PRODUCT_TITLE } from "@/lib/product-nav";
import { ROUTES } from "@/lib/routes";

type RegimeTone = "positive" | "negative" | "warning" | "neutral";
type GatewayTone = "accent" | RegimeTone;
type IndexSymbol = "SPY" | "QQQ" | "DIA";

type RegimeSummary = {
  label: string;
  className: string;
  confidence: number;
  breadth: number;
  tone: RegimeTone;
};

type IndexCardDefinition = {
  symbol: IndexSymbol;
  label: string;
  detail: string;
  fallbackPrice: number;
  fallbackChangePercent: number;
};

type IndexCardViewModel = IndexCardDefinition & {
  price: number | null;
  changePercent: number | null;
  fetchedAt: string | null;
  marketState: string | null;
  chartData: CpChartDatum[];
  isLive: boolean;
};

type TickerQuoteResponse = {
  symbol?: string;
  price?: number | null;
  change?: number | null;
  changePercent?: number | null;
  fetchedAt?: string | null;
  marketState?: string | null;
};

type FinanceHistoryPoint = {
  date?: string;
  Close?: number;
  close?: number;
};

type FinanceHistoryResponse = {
  data?: {
    history_1y?: FinanceHistoryPoint[];
  };
};

const INDEX_CARDS = [
  {
    symbol: "SPY",
    label: "SPY",
    detail: "S&P 500 ETF",
    fallbackPrice: 745.76,
    fallbackChangePercent: 1.71,
  },
  {
    symbol: "QQQ",
    label: "QQQ",
    detail: "NASDAQ 100 ETF",
    fallbackPrice: 725.17,
    fallbackChangePercent: 2.05,
  },
  {
    symbol: "DIA",
    label: "DIA",
    detail: "DOW 30 ETF",
    fallbackPrice: 522.4,
    fallbackChangePercent: 0.75,
  },
] satisfies readonly IndexCardDefinition[];

const GATEWAY_TILES = [
  {
    label: "종목",
    title: "종목 리포트",
    value: "검색",
    detail: "티커를 바로 열어 가격, 밸류에이션, 신호를 한 화면에서 확인합니다.",
    href: ROUTES.stock("NVDA"),
    tone: "accent",
    icon: "⌕",
  },
  {
    label: "스크리너",
    title: "조건 검색",
    value: "필터",
    detail: "밸류, 성장, 퀄리티, 모멘텀 조건으로 후보 종목을 좁힙니다.",
    href: ROUTES.screener,
    tone: "positive",
    icon: "▦",
  },
  {
    label: "ETF",
    title: "ETF 센터",
    value: "비교",
    detail: "ETF 분류, 테마, 보유 구조를 비교하며 시장 노출을 점검합니다.",
    href: ROUTES.etfs,
    tone: "neutral",
    icon: "◌",
  },
  {
    label: "포트폴리오",
    title: "보유 점검",
    value: "리뷰",
    detail: "관심 종목과 보유 비중을 시장 흐름과 함께 다시 봅니다.",
    href: ROUTES.portfolio,
    tone: "warning",
    icon: "◫",
  },
] satisfies ReadonlyArray<{
  label: string;
  title: string;
  value: string;
  detail: string;
  href: string;
  tone: GatewayTone;
  icon: string;
}>;

function formatDatePart(value: string | null | undefined): string {
  if (!value) return "대기";
  return value.slice(0, 10);
}

function dataStateLabel(dataReady: boolean): string {
  return dataReady ? "동기화됨" : "불러오는 중";
}

function failedSourceLabel(failedCount: number): string {
  return failedCount === 0 ? "없음" : `${failedCount}개`;
}

function sectorModeLabel(mode: "LIVE_1D" | "MIXED" | "BASE_1M"): string {
  if (mode === "LIVE_1D") return "실시간 1일 기준";
  if (mode === "MIXED") return "실시간+1개월 혼합";
  return "1개월 기준";
}

function formatPriceValue(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSignedPercentUnit(value: number | null | undefined, digits = 2): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${Math.abs(value).toFixed(digits)}%`;
}

function formatMarketState(value: string | null): string {
  if (!value) return "대기";
  if (value.includes("REGULAR")) return "장중";
  if (value.includes("PRE")) return "프리";
  if (value.includes("POST")) return "마감 후";
  if (value.includes("CLOSED")) return "장 마감";
  return value;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildFallbackSparkline(price: number, changePercent: number, symbol: IndexSymbol): CpChartDatum[] {
  const seed = symbol === "SPY" ? 0.0018 : symbol === "QQQ" ? 0.0026 : 0.0012;
  const length = 24;
  const startPrice = price / Math.max(0.65, 1 + changePercent / 100);

  return Array.from({ length }, (_, index) => {
    const progress = index / (length - 1);
    const wave = Math.sin(index * 0.95) * seed + Math.cos(index * 0.42) * seed * 0.55;
    const trend = (price - startPrice) * progress;
    const value = index === length - 1 ? price : Math.max(1, startPrice + trend + price * wave);
    return {
      time: `2026-06-${String(index + 3).padStart(2, "0")}`,
      value,
    };
  });
}

function historyToChartData(payload: FinanceHistoryResponse | null): CpChartDatum[] {
  const rows = payload?.data?.history_1y;
  if (!Array.isArray(rows)) return [];

  const chartData: CpChartDatum[] = [];
  rows
    .filter((row): row is FinanceHistoryPoint & { date: string } => typeof row.date === "string")
    .slice(-36)
    .forEach((row) => {
      const close = readFiniteNumber(row.Close) ?? readFiniteNumber(row.close);
      if (close !== null) chartData.push({ time: row.date, value: close });
    });
  return chartData;
}

function fallbackIndexCard(definition: IndexCardDefinition): IndexCardViewModel {
  return {
    ...definition,
    price: definition.fallbackPrice,
    changePercent: definition.fallbackChangePercent,
    fetchedAt: null,
    marketState: null,
    chartData: buildFallbackSparkline(
      definition.fallbackPrice,
      definition.fallbackChangePercent,
      definition.symbol,
    ),
    isLive: false,
  };
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url);
  if (!response.ok) return null;
  return (await response.json()) as T;
}

async function loadIndexCard(definition: IndexCardDefinition): Promise<IndexCardViewModel> {
  const fallback = fallbackIndexCard(definition);

  try {
    const [quote, history] = await Promise.all([
      fetchJson<TickerQuoteResponse>(`/api/ticker/${definition.symbol}/`).catch(() => null),
      fetchJson<FinanceHistoryResponse>(`/data/yf/finance/${definition.symbol}.json`).catch(() => null),
    ]);
    const chartData = historyToChartData(history);
    return {
      ...definition,
      price: readFiniteNumber(quote?.price) ?? fallback.price,
      changePercent: readFiniteNumber(quote?.changePercent) ?? readFiniteNumber(quote?.change) ?? fallback.changePercent,
      fetchedAt: typeof quote?.fetchedAt === "string" ? quote.fetchedAt : fallback.fetchedAt,
      marketState: typeof quote?.marketState === "string" ? quote.marketState : fallback.marketState,
      chartData: chartData.length > 0 ? chartData : fallback.chartData,
      isLive: Boolean(quote?.fetchedAt || chartData.length > 0),
    };
  } catch {
    return fallback;
  }
}

function useIndexCards(): IndexCardViewModel[] {
  const [cards, setCards] = useState<IndexCardViewModel[]>(() => INDEX_CARDS.map(fallbackIndexCard));

  useEffect(() => {
    let cancelled = false;
    Promise.all(INDEX_CARDS.map(loadIndexCard)).then((nextCards) => {
      if (!cancelled) setCards(nextCards);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return cards;
}

function CpMarketDashboardBand({
  indexCards,
  updatedAt,
}: {
  indexCards: IndexCardViewModel[];
  updatedAt: string;
}) {
  return (
    <section className="cp-market-band" aria-label="시장 데이터 대시보드">
      <header className="cp-market-band__header">
        <div>
          <p className="cp-lab__eyebrow">오늘 브리프</p>
          <h2>시장 데이터 대시보드</h2>
        </div>
        <span className="cp-market-band__meta">업데이트 {updatedAt}</span>
      </header>

      <div className="cp-market-band__cards">
        {indexCards.map((card) => {
          const tone = (card.changePercent ?? 0) >= 0 ? "positive" : "negative";
          return (
            <article className="cp-index-card" data-tone={tone} key={card.symbol}>
              <div className="cp-index-card__topline">
                <div>
                  <span className="cp-index-card__symbol">{card.label}</span>
                  <p>{card.detail}</p>
                </div>
                <span className="cp-index-card__state">{formatMarketState(card.marketState)}</span>
              </div>
              <div className="cp-index-card__quote">
                <strong>{formatPriceValue(card.price)}</strong>
                <span>{formatSignedPercentUnit(card.changePercent)}</span>
              </div>
              <CpPriceChart
                kind="sparkline"
                data={card.chartData}
                title={`${card.label} 미니 차트`}
                summary={`${card.label} ${formatSignedPercentUnit(card.changePercent)}`}
                ariaLabel={`${card.label} 가격 흐름`}
                range="1M"
                height={92}
                density="compact"
                showGrid={false}
                showCrosshair={false}
                className="cp-index-card__chart"
                emptyLabel="차트 데이터 대기"
              />
            </article>
          );
        })}
      </div>
    </section>
  );
}

function edgeStrengthLabel(score: number): string {
  if (score >= 75) return "강한 상승";
  if (score >= 62) return "상승 우위";
  if (score >= 45) return "중립 구간";
  return "방어 구간";
}

function CpFenokEdgePanel({
  regime,
  dashboard,
}: {
  regime: RegimeSummary;
  dashboard: DashboardSnapshot;
}) {
  const radius = 47;
  const circumference = 2 * Math.PI * radius;
  const gaugeOffset = circumference * (1 - regime.confidence / 100);
  const forces = [
    {
      label: "투자 심리",
      value: Math.round(dashboard.fearGreedScore),
      detail: dashboard.fearGreedLabel,
    },
    {
      label: "섹터 확산",
      value: regime.breadth,
      detail: `${dashboard.sectorUp}개 상승`,
    },
    {
      label: "스트레스 완화",
      value: Math.round((1 - dashboard.stressScore) * 100),
      detail: dashboard.stressLabel,
    },
  ];

  return (
    <section className="cp-edge-panel" aria-label="Fenok Edge 시각화">
      <header className="cp-edge-panel__header">
        <div>
          <p className="cp-lab__eyebrow">Fenok Edge</p>
          <h2>시장 체력 점수</h2>
        </div>
        <CpBadge tone={regime.tone}>{regime.label}</CpBadge>
      </header>

      <div className="cp-edge-panel__body">
        <div className="cp-edge-gauge" data-tone={regime.tone}>
          <svg viewBox="0 0 120 120" role="img" aria-label={`Fenok Edge ${regime.confidence}점`}>
            <defs>
              <linearGradient id="cp-edge-gauge-gradient" x1="0%" y1="20%" x2="100%" y2="80%">
                <stop offset="0%" stopColor="var(--cp-chart-line-2)" />
                <stop offset="46%" stopColor="var(--cp-accent)" />
                <stop offset="100%" stopColor="var(--cp-positive)" />
              </linearGradient>
            </defs>
            <circle className="cp-edge-gauge__track" cx="60" cy="60" r={radius} />
            <circle
              className="cp-edge-gauge__progress"
              cx="60"
              cy="60"
              r={radius}
              strokeDasharray={circumference}
              strokeDashoffset={gaugeOffset}
            />
          </svg>
          <div className="cp-edge-gauge__score">
            <strong>{regime.confidence}</strong>
            <span>{edgeStrengthLabel(regime.confidence)}</span>
          </div>
        </div>

        <div className="cp-edge-forces">
          {forces.map((force) => (
            <div className="cp-edge-force" key={force.label}>
              <div className="cp-edge-force__label">
                <span>{force.label}</span>
                <strong>{force.value}</strong>
              </div>
              <div className="cp-edge-force__track" aria-hidden="true">
                <span style={{ width: `${clamp(force.value, 0, 100)}%` }} />
              </div>
              <p>{force.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function heatTone(change: number): "positive" | "negative" | "neutral" {
  if (change > 0.0005) return "positive";
  if (change < -0.0005) return "negative";
  return "neutral";
}

function heatTileStyle(change: number): CSSProperties {
  return {
    "--cp-heat-intensity": clamp(Math.abs(change) * 18, 0.16, 1).toFixed(3),
  } as CSSProperties;
}

function CpSectorHeatmap({
  sectors,
  mode,
}: {
  sectors: SectorSnapshot[];
  mode: DashboardSnapshot["sectorMode"];
}) {
  const heatSectors = sectors
    .slice()
    .sort((a, b) => Math.abs(b.displayChange) - Math.abs(a.displayChange))
    .slice(0, 11);

  return (
    <section className="cp-sector-heatmap" aria-label="섹터 히트맵">
      <header className="cp-sector-heatmap__header">
        <div>
          <p className="cp-lab__eyebrow">Sector Flow</p>
          <h2>섹터 히트맵</h2>
        </div>
        <span>{sectorModeLabel(mode)}</span>
      </header>

      <div className="cp-sector-heatmap__grid">
        {heatSectors.map((sector) => (
          <div
            className="cp-sector-heatmap__tile"
            data-tone={heatTone(sector.displayChange)}
            key={sector.key}
            style={heatTileStyle(sector.displayChange)}
          >
            <span>{sector.etf}</span>
            <strong>{sector.name}</strong>
            <em>{formatSignedPercentDecimal(sector.displayChange, 1)}</em>
          </div>
        ))}
      </div>
    </section>
  );
}

function CpGatewayCard({ tile }: { tile: (typeof GATEWAY_TILES)[number] }) {
  return (
    <TransitionLink
      href={tile.href}
      className="cp-home-gateway-link"
      data-home-feature-tile
    >
      <article className="cp-gateway-card" data-tone={tile.tone} data-cp-feature-tile>
        <div className="cp-gateway-card__topline">
          <span className="cp-gateway-card__icon" aria-hidden="true">{tile.icon}</span>
          <span>{tile.label}</span>
        </div>
        <h2>{tile.title}</h2>
        <strong>{tile.value}</strong>
        <p>{tile.detail}</p>
      </article>
    </TransitionLink>
  );
}

function CpHomeHero({
  regimeLabel,
  regimeTone,
  dataReady,
  failedCount,
  updatedAt,
}: {
  regimeLabel: string;
  regimeTone: "positive" | "negative" | "warning" | "neutral";
  dataReady: boolean;
  failedCount: number;
  updatedAt: string;
}) {
  return (
    <section className="cp-hero-search cp-home-hero" data-canvas-plus-home-hero data-home-search-first>
      <div className="cp-hero-search__copy">
        <p className="cp-lab__eyebrow">100xFenok 홈</p>
        <h1 className="cp-hero-search__title">먼저 검색하고, 오늘 볼 종목을 바로 정합니다.</h1>
        <p className="cp-hero-search__summary">
          티커 검색, 시장 판독, 주요 화면 이동을 한 번에 시작하는 투자 대시보드입니다.
        </p>
      </div>

      <div className="cp-hero-search__form">
        <span className="cp-hero-search__label">
          티커, 투자자, 기업명
        </span>
        <TickerTypeahead
          placeholder="NVDA, SPY, 워런 버핏..."
          className="cp-hero-search__input"
          formClass="cp-hero-search__control"
          showButton
          buttonLabel="열기"
          buttonClass="cp-home-search-button"
        />
      </div>

      <dl className="cp-hero-search__metrics" aria-label="홈 데이터 상태">
        <div className="cp-hero-search__metric">
          <dt>시장 판독</dt>
          <dd><CpBadge tone={regimeTone}>{regimeLabel}</CpBadge></dd>
        </div>
        <div className="cp-hero-search__metric">
          <dt>데이터 상태</dt>
          <dd>{dataStateLabel(dataReady)}</dd>
        </div>
        <div className="cp-hero-search__metric">
          <dt>확인 필요</dt>
          <dd>{failedSourceLabel(failedCount)}</dd>
        </div>
        <div className="cp-hero-search__metric">
          <dt>업데이트</dt>
          <dd>{updatedAt}</dd>
        </div>
      </dl>
    </section>
  );
}

export default function HomeCanvasPlusClient() {
  const { dashboard, dataReady, failedSources } = useDashboardData();
  const indexCards = useIndexCards();
  const regime = useMemo(() => {
    const breadthTotal = Math.max(dashboard.sectorRows.length, 1);
    const breadthRatio = dashboard.sectorUp / breadthTotal;
    const score = clamp(
      (dashboard.fearGreedScore / 100) * 0.45 +
        breadthRatio * 0.35 +
        (1 - dashboard.stressScore) * 0.2,
      0,
      1,
    );
    const className = getRegimeClass(score);
    return {
      label: getRegimeLabel(score),
      className,
      confidence: Math.round(score * 100),
      breadth: Math.round(breadthRatio * 100),
      tone: className === "is-risk-on" ? "positive" : className === "is-risk-off" ? "negative" : "warning",
    } satisfies RegimeSummary;
  }, [dashboard]);

  return (
    <div className="fnk-shell cp-home-shell">
      <AppShell active="explore" title={EXPLORE_PRODUCT_TITLE}>
        <div className="canvas-plus" data-canvas-plus data-canvas-plus-home-production>
          <div className="cp-lab cp-poc cp-home-production">
            <CpHomeHero
              regimeLabel={regime.label}
              regimeTone={regime.tone}
              dataReady={dataReady}
              failedCount={failedSources.length}
              updatedAt={formatDatePart(dashboard.tickerFetchedAt)}
            />

            <CpMarketDashboardBand
              indexCards={indexCards}
              updatedAt={formatDatePart(dashboard.tickerFetchedAt)}
            />

            <section className="cp-home-visual-grid" aria-label="홈 시장 시각화">
              <CpFenokEdgePanel regime={regime} dashboard={dashboard} />
              <CpSectorHeatmap sectors={dashboard.sectorRows} mode={dashboard.sectorMode} />
            </section>

            <section className="cp-poc__feature-grid" aria-label="홈 주요 화면">
              {GATEWAY_TILES.map((tile) => <CpGatewayCard key={tile.label} tile={tile} />)}
            </section>
          </div>
        </div>
      </AppShell>
    </div>
  );
}
