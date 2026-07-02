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
import type { TradesRankingData, TradesRankingRow } from "@/lib/superinvestors/types";

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
};

type IndexCardViewModel = IndexCardDefinition & {
  price: number | null;
  changePercent: number | null;
  fetchedAt: string | null;
  marketState: string | null;
  chartData: CpChartDatum[];
  isLive: boolean;
};

type InvestorHighlight = {
  key: string;
  label: string;
  ticker: string;
  meta: string;
  signal: string;
  tone: RegimeTone;
};

type RevisionMoverRow = {
  ticker?: string;
  name?: string | null;
  change_1w?: number | null;
  eps_fy1?: number | null;
  as_of?: string | null;
};

type RevisionMoversData = {
  generated_at?: string;
  up?: RevisionMoverRow[];
  down?: RevisionMoverRow[];
};

type StockMoverHighlight = {
  key: string;
  label: string;
  ticker: string;
  name: string;
  change: number;
  tone: RegimeTone;
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
  },
  {
    symbol: "QQQ",
    label: "QQQ",
    detail: "NASDAQ 100 ETF",
  },
  {
    symbol: "DIA",
    label: "DIA",
    detail: "DOW 30 ETF",
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

function maxTimestamp(values: Array<string | null | undefined>): string | null {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort()
    .at(-1) ?? null;
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

function formatRevisionMove(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return formatSignedPercentUnit(value * 100, 1);
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

function historyToChartData(payload: FinanceHistoryResponse | null): CpChartDatum[] {
  const rows = payload?.data?.history_1y;
  if (!Array.isArray(rows)) return [];

  const chartData: CpChartDatum[] = [];
  rows
    .filter((row): row is FinanceHistoryPoint & { date: string } => typeof row.date === "string")
    .slice(-21)
    .forEach((row) => {
      const close = readFiniteNumber(row.Close) ?? readFiniteNumber(row.close);
      if (close !== null) chartData.push({ time: row.date, value: close });
    });
  return chartData;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url);
  if (!response.ok) return null;
  return (await response.json()) as T;
}

async function loadIndexCardHistory(symbol: IndexSymbol): Promise<CpChartDatum[]> {
  const history = await fetchJson<FinanceHistoryResponse>(`/data/yf/finance/${symbol}.json`).catch(() => null);
  return historyToChartData(history);
}

function useIndexCardHistories(): Partial<Record<IndexSymbol, CpChartDatum[]>> {
  const [histories, setHistories] = useState<Partial<Record<IndexSymbol, CpChartDatum[]>>>({});

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      INDEX_CARDS.map(async (definition) => [definition.symbol, await loadIndexCardHistory(definition.symbol)] as const),
    ).then((entries) => {
      if (!cancelled) setHistories(Object.fromEntries(entries) as Partial<Record<IndexSymbol, CpChartDatum[]>>);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return histories;
}

function useIndexCards(dashboard: DashboardSnapshot): IndexCardViewModel[] {
  const histories = useIndexCardHistories();

  return useMemo(() => INDEX_CARDS.map((definition) => {
    const snapshot = dashboard.quickIndices.find((item) => item.symbol === definition.symbol);
    const isLiveQuote = Boolean(snapshot?.isLive && snapshot.displayHorizon === "1D");
    return {
      ...definition,
      price: isLiveQuote ? snapshot?.price ?? null : null,
      changePercent: isLiveQuote ? (snapshot?.change ?? 0) * 100 : null,
      fetchedAt: snapshot?.fetchedAt ?? null,
      marketState: isLiveQuote ? snapshot?.marketState ?? null : null,
      chartData: histories[definition.symbol] ?? [],
      isLive: isLiveQuote,
    };
  }), [dashboard.quickIndices, histories]);
}

function buildInvestorHighlights(data: TradesRankingData | null): InvestorHighlight[] {
  if (!data) return [];
  const topBought: TradesRankingRow | undefined = data.bought[0];
  const topSold: TradesRankingRow | undefined = data.sold[0];
  const topNew = data.bought
    .filter((row) => (row.new_count ?? 0) > 0)
    .sort((a, b) => (b.new_count ?? 0) - (a.new_count ?? 0) || b.amount - a.amount)[0];
  const highlights: InvestorHighlight[] = [];

  if (topBought) {
    highlights.push({
      key: "bought",
      label: "최다 매수",
      ticker: topBought.ticker,
      meta: `최대 ${topBought.top_investor.name}`,
      signal: `${topBought.investors_count}명 매수`,
      tone: "positive",
    });
  }
  if (topSold) {
    highlights.push({
      key: "sold",
      label: "최다 매도",
      ticker: topSold.ticker,
      meta: `최대 ${topSold.top_investor.name}`,
      signal: `${topSold.investors_count}명 매도`,
      tone: "negative",
    });
  }
  if (topNew) {
    highlights.push({
      key: "new",
      label: "신규 편입",
      ticker: topNew.ticker,
      meta: topNew.sector,
      signal: `${topNew.new_count ?? 0}명 신규`,
      tone: "warning",
    });
  }
  return highlights;
}

function buildStockMoverHighlights(data: RevisionMoversData | null): StockMoverHighlight[] {
  if (!data) return [];
  const up = (data.up ?? [])
    .filter((row) => row.ticker && typeof row.change_1w === "number" && Number.isFinite(row.change_1w))
    .sort((a, b) => (b.change_1w ?? 0) - (a.change_1w ?? 0))
    .slice(0, 2)
    .map((row) => ({
      key: `up-${row.ticker}`,
      label: "상향",
      ticker: row.ticker ?? "",
      name: row.name ?? "FY+1 EPS 추정치",
      change: row.change_1w ?? 0,
      tone: "positive" as RegimeTone,
    }));
  const down = (data.down ?? [])
    .filter((row) => row.ticker && typeof row.change_1w === "number" && Number.isFinite(row.change_1w))
    .sort((a, b) => (a.change_1w ?? 0) - (b.change_1w ?? 0))
    .slice(0, 2)
    .map((row) => ({
      key: `down-${row.ticker}`,
      label: "하향",
      ticker: row.ticker ?? "",
      name: row.name ?? "FY+1 EPS 추정치",
      change: row.change_1w ?? 0,
      tone: "negative" as RegimeTone,
    }));
  return [...up, ...down];
}

function useInvestorHighlights(): { highlights: InvestorHighlight[]; quarter: string; loading: boolean } {
  const [data, setData] = useState<TradesRankingData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchJson<TradesRankingData>("/data/sec-13f/analytics/trades_ranking.json")
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    highlights: buildInvestorHighlights(data),
    quarter: data?.metadata?.quarter ?? "13F",
    loading,
  };
}

function useStockMovers(): { movers: StockMoverHighlight[]; asOf: string; loading: boolean } {
  const [data, setData] = useState<RevisionMoversData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchJson<RevisionMoversData>("/data/global-scouter/core/revision_movers.json")
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const firstDatedRow = [...(data?.up ?? []), ...(data?.down ?? [])].find((row) => row.as_of);

  return {
    movers: buildStockMoverHighlights(data),
    asOf: firstDatedRow?.as_of ?? data?.generated_at ?? "추정치",
    loading,
  };
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
          const tone = card.isLive ? ((card.changePercent ?? 0) >= 0 ? "positive" : "negative") : "neutral";
          return (
            <article className="cp-index-card" data-tone={tone} key={card.symbol}>
              <div className="cp-index-card__topline">
                <div>
                  <span className="cp-index-card__symbol">{card.label}</span>
                  <p>{card.detail}</p>
                </div>
                <span className="cp-index-card__state">{card.isLive ? formatMarketState(card.marketState) : "추정치"}</span>
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
      label: "시장 스트레스",
      value: Math.round(dashboard.stressScore * 100),
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

function CpHomeSliceTwo() {
  const investor = useInvestorHighlights();
  const stockMovers = useStockMovers();
  const moverFallback: StockMoverHighlight[] = [{
    key: "pending",
    label: "대기",
    ticker: "확인 중",
    name: "실적추정 변화 데이터 확인 중",
    change: 0,
    tone: "neutral",
  }];

  return (
    <section className="cp-home-slice-two" aria-label="홈 관찰 구역">
      <div className="cp-watch-zone" data-canvas-plus-watch-zone>
        <header className="cp-watch-zone__header">
          <div>
            <p className="cp-lab__eyebrow">관찰 구역</p>
            <h2>오늘의 관찰대</h2>
          </div>
          <span>{stockMovers.loading ? "확인 중" : formatDatePart(stockMovers.asOf)}</span>
        </header>

        <div className="cp-watch-zone__indices">
          {(stockMovers.movers.length > 0 ? stockMovers.movers : moverFallback).map((mover) => {
            return (
              <TransitionLink
                href={mover.ticker === "확인 중" ? ROUTES.explore : ROUTES.stock(mover.ticker)}
                className="cp-watch-chip"
                data-tone={mover.tone}
                key={mover.key}
              >
                <span>실적추정 {mover.label}</span>
                <strong>{mover.ticker}</strong>
                <p>{mover.name}</p>
                <em>{formatRevisionMove(mover.change)}</em>
              </TransitionLink>
            );
          })}
        </div>
      </div>

      <TransitionLink href={ROUTES.superinvestors} className="cp-investor-card" data-canvas-plus-investor-card>
        <header className="cp-investor-card__header">
          <div>
            <p className="cp-lab__eyebrow">13F 신호</p>
            <h2>투자자 하이라이트</h2>
          </div>
          <span>{investor.loading ? "확인 중" : investor.quarter}</span>
        </header>

        <div className="cp-investor-card__stack">
          {(investor.highlights.length > 0 ? investor.highlights : [{
            key: "pending",
            label: "13F 대기",
            ticker: "대기",
            meta: "투자자 매매 동향 확인 중",
            signal: "-",
            tone: "neutral" as RegimeTone,
          }]).map((item) => (
            <div className="cp-investor-row" data-tone={item.tone} key={item.key}>
              <span>{item.label}</span>
              <strong>{item.ticker}</strong>
              <p>{item.meta}</p>
              <em>{item.signal}</em>
            </div>
          ))}
        </div>
      </TransitionLink>
    </section>
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
        <h1 className="cp-hero-search__title">오늘 시장의 기준점</h1>
        <p className="cp-hero-search__summary">
          검색에서 판독까지, 오늘의 후보를 한 화면에서 이어 봅니다.
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
  const indexCards = useIndexCards(dashboard);
  const indexUpdatedAt = useMemo(() => formatDatePart(maxTimestamp(indexCards.map((card) => card.fetchedAt))), [indexCards]);
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
              updatedAt={indexUpdatedAt}
            />

            <section className="cp-home-visual-grid" aria-label="홈 시장 시각화">
              <CpFenokEdgePanel regime={regime} dashboard={dashboard} />
              <CpSectorHeatmap sectors={dashboard.sectorRows} mode={dashboard.sectorMode} />
            </section>

            <CpHomeSliceTwo />

            <section className="cp-poc__feature-grid" aria-label="홈 주요 화면">
              {GATEWAY_TILES.map((tile) => <CpGatewayCard key={tile.label} tile={tile} />)}
            </section>
          </div>
        </div>
      </AppShell>
    </div>
  );
}
