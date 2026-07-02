"use client";

import { useMemo } from "react";
import AppShell from "@/components/shell/AppShell";
import TickerTypeahead from "@/components/TickerTypeahead";
import TransitionLink from "@/components/TransitionLink";
import CpBadge from "@/components/canvas-plus/CpBadge";
import CpFeatureTile from "@/components/canvas-plus/CpFeatureTile";
import CpInsightCard from "@/components/canvas-plus/CpInsightCard";
import { useDashboardData } from "@/hooks/useDashboardData";
import { clamp, formatSignedPercentDecimal, getRegimeClass, getRegimeLabel } from "@/lib/dashboard/formatters";
import type { SectorSnapshot } from "@/lib/dashboard/types";
import { EXPLORE_PRODUCT_TITLE } from "@/lib/product-nav";
import { ROUTES } from "@/lib/routes";

const GATEWAY_TILES = [
  {
    label: "종목",
    title: "종목 리포트",
    value: "검색",
    detail: "티커를 바로 열어 가격, 밸류에이션, 신호를 한 화면에서 확인합니다.",
    href: ROUTES.stock("NVDA"),
    tone: "accent",
  },
  {
    label: "스크리너",
    title: "조건 검색",
    value: "필터",
    detail: "밸류, 성장, 퀄리티, 모멘텀 조건으로 후보 종목을 좁힙니다.",
    href: ROUTES.screener,
    tone: "positive",
  },
  {
    label: "ETF",
    title: "ETF 센터",
    value: "비교",
    detail: "ETF 분류, 테마, 보유 구조를 비교하며 시장 노출을 점검합니다.",
    href: ROUTES.etfs,
    tone: "neutral",
  },
  {
    label: "포트폴리오",
    title: "보유 점검",
    value: "리뷰",
    detail: "관심 종목과 보유 비중을 시장 흐름과 함께 다시 봅니다.",
    href: ROUTES.portfolio,
    tone: "warning",
  },
] as const;

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

function sectorHorizonLabel(horizon: SectorSnapshot["displayHorizon"]): string {
  return horizon === "1D" ? "1일" : "1개월";
}

function sectorModeLabel(mode: "LIVE_1D" | "MIXED" | "BASE_1M"): string {
  if (mode === "LIVE_1D") return "실시간 1일 기준";
  if (mode === "MIXED") return "실시간+1개월 혼합";
  return "1개월 기준";
}

function sectorMoveLabel(sector: SectorSnapshot | undefined): string {
  if (!sector) return "불러오는 중";
  return `${sector.name} ${formatSignedPercentDecimal(sector.displayChange, 1)} (${sectorHorizonLabel(sector.displayHorizon)})`;
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
    } as const;
  }, [dashboard]);

  const strongestSector = dashboard.sectorRows
    .slice()
    .sort((a, b) => b.displayChange - a.displayChange)[0];
  const weakestSector = dashboard.sectorRows
    .slice()
    .sort((a, b) => a.displayChange - b.displayChange)[0];

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

            <section className="cp-poc__feature-grid" aria-label="홈 주요 화면">
              {GATEWAY_TILES.map((tile) => (
                <TransitionLink
                  key={tile.label}
                  href={tile.href}
                  className="cp-home-gateway-link"
                  data-home-feature-tile
                >
                  <CpFeatureTile
                    label={tile.label}
                    title={tile.title}
                    value={tile.value}
                    detail={tile.detail}
                    tone={tile.tone}
                  />
                </TransitionLink>
              ))}
            </section>

            <section className="cp-poc__insight-grid" aria-label="홈 시장 요약">
              <CpInsightCard
                title="오늘의 시장 요약"
                meta="심리·섹터·스트레스"
                badge={`${regime.confidence}/100`}
                tone={regime.tone}
                rows={[
                  { label: "시장 구간", value: regime.label, tone: regime.tone },
                  { label: "상승 섹터", value: `${regime.breadth}%`, tone: regime.breadth >= 55 ? "positive" : "warning" },
                  { label: "Fear & Greed", value: `${dashboard.fearGreedScore}`, tone: dashboard.fearGreedScore >= 65 ? "warning" : "neutral" },
                ]}
              />
              <CpInsightCard
                title="다음 확인 포인트"
                meta="섹터 흐름과 데이터 상태"
                badge={failedSources.length === 0 ? "정상" : "확인"}
                tone={failedSources.length === 0 ? "positive" : "warning"}
                rows={[
                  { label: "강한 섹터", value: sectorMoveLabel(strongestSector), tone: "positive" },
                  { label: "약한 섹터", value: sectorMoveLabel(weakestSector), tone: "warning" },
                  { label: "섹터 기준", value: sectorModeLabel(dashboard.sectorMode), tone: dataReady ? "positive" : "neutral" },
                ]}
              />
            </section>
          </div>
        </div>
      </AppShell>
    </div>
  );
}
