"use client";

import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import TransitionLink from "@/components/TransitionLink";
import DataStateNotice from "@/components/DataStateNotice";
import { type FenokSignalRadarHexagonAxis } from "@/components/screener/FenokSignalRadarHexagon";
import { edgeAxisSpokeLabel } from "@/lib/fenok-signals/edge-axis-labels.mjs";
import type { FenokSignalHelpKey } from "@/lib/fenok-signals/signal-help-config";
import { getDisplaySignalHelpBands, lookupBand } from "@/lib/fenok-signals/signal-help-config";
import { shortTermCommonBasisCopy } from "@/lib/fenok-signals/conviction-basis-copy.mjs";
import { bandPct, bandClass } from "@/lib/screener/bands";
import { commonBasisShortTermView } from "@/lib/screener/common-basis-short-term";
import type { ScreenerStock } from "@/lib/screener/types";
import { interpretStockMetrics, type InterpretationReadTone } from "@/lib/screener/deterministicRules";
import {
  estimateCompletenessFromSeries,
  estimateCompletenessTone,
  hasEstimateGap,
  type EstimateCompleteness,
} from "@/lib/estimate-completeness";
import { makeDataState, type LoaderError } from "@/lib/data-state";
import {
  formatCurrency,
  formatCurrencyCompact,
  formatDecimal,
  formatInteger,
  formatMultiple,
  formatPlainPercent,
  formatSignedDecimal,
  formatSignedPercent,
  type Currency,
} from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { normalizeForEntityKey } from "@/lib/ticker";
import { fetchMarketFactsFromShard } from "@/lib/market-facts-shard.mjs";
import { Panel, PanelHeader, Row, Bar, EdgeMark, EvidenceRail } from "@/components/ui";

export type MaybeNumber = number | null | undefined;

function edgeLeadLabel(): string {
  return "단기·장기 독립 진단";
}

function formatSignalCoverage(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return "커버리지 미확인";
  return `커버리지 ${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

// ---------------------------------------------------------------------------
// Shared light-system panels (slice-4 single implementation)
// Used by the rewritten stock page AND the screener expanded rows so both
// surfaces share one implementation. No gauges/radars/donuts — EdgeMark +
// bar rows only. Every panel ends with an EvidenceRail.
// ---------------------------------------------------------------------------

export interface SharedEdgeAxisRow {
  key: string;
  label: string;
  score: number | null;
  referenceOnly?: boolean;
}

function sharedEdgeTone(score: number | null): string {
  if (!isFiniteNumber(score)) return "—";
  if (score >= 65) return "양호";
  if (score >= 45) return "관리";
  return "약함";
}

export function SharedEdgePanel({
  title,
  eyebrow = "Fenok Edge",
  shortScore,
  longScore,
  shortLabel = "단기",
  longLabel = "장기",
  shortRows,
  longRows,
  shortTitle = "단기 축",
  longTitle = "장기 축",
  summary,
  pending = false,
  source = "FENOK 신호",
  asOf = "—",
  coverage = "—",
  hero,
}: {
  title: string;
  eyebrow?: string;
  shortScore: number | null;
  longScore: number | null;
  shortLabel?: string;
  longLabel?: string;
  shortRows: SharedEdgeAxisRow[];
  longRows: SharedEdgeAxisRow[];
  shortTitle?: string;
  longTitle?: string;
  summary?: string | null;
  pending?: boolean;
  source?: string;
  asOf?: string;
  coverage?: string;
  /** 88px panel EdgeMark hero per Signature (Stock); omitted surfaces keep 22/16 only */
  hero?: Array<{ label: string; score: number | null }>;
}) {
  const hasRows = [...shortRows, ...longRows].some((row) => row.score !== null);
  const renderRows = (rows: SharedEdgeAxisRow[]) =>
    rows.map((row) => (
      <Row key={row.key}>
        <span className="truncate text-[12px] text-[var(--c-ink-2)]">{row.label}{row.referenceOnly ? " · 참고" : ""}</span>
        <Bar value={row.score ?? 0} aria-label={`${row.label} ${row.score !== null ? Math.round(row.score) : "대기"}점`} />
        <span className="flex items-center justify-end gap-2">
          {row.score !== null ? <EdgeMark score={row.score} size={16} showValue={false} /> : null}
          <strong className="tabular-nums text-[12px] font-semibold text-[var(--c-ink)]">
            {row.score !== null ? Math.round(row.score) : "—"}
          </strong>
          <span className="w-8 text-right text-[11px] text-[var(--c-ink-3)]">{sharedEdgeTone(row.score)}</span>
        </span>
      </Row>
    ));
  return (
    <Panel loading={pending}>
      <PanelHeader eyebrow={eyebrow} title={title} right={<span className="text-[11px] text-[var(--c-ink-3)]">{coverage}</span>} />
      {hero && hero.some((head) => head.score !== null) ? (
        <div className="flex items-center gap-6 px-4 pt-3">
          {hero.map((head) => head.score !== null ? (
            <span key={head.label} className="flex flex-col items-center gap-1">
              <EdgeMark score={head.score} size={88} />
              <strong className="tabular-nums text-[22px] font-semibold leading-none text-[var(--c-ink)]">
                {Math.round(head.score)}
              </strong>
              <span className="text-[11px] text-[var(--c-ink-3)]">{head.label}</span>
            </span>
          ) : null)}
        </div>
      ) : null}
      <div className="flex items-center gap-4 px-4 py-3">
        {[
          { label: shortLabel, score: shortScore },
          { label: longLabel, score: longScore },
        ].map((head) => (
          <span key={head.label} className="flex items-center gap-2">
            {head.score !== null ? <EdgeMark score={head.score} size={22} showValue={false} /> : null}
            <span className="text-[11px] text-[var(--c-ink-3)]">{head.label}</span>
            <strong className="tabular-nums text-[22px] font-semibold leading-none text-[var(--c-ink)]">
              {head.score !== null ? Math.round(head.score) : "—"}
            </strong>
          </span>
        ))}
      </div>
      {summary ? <p className="px-4 pb-2 text-[12px] text-[var(--c-ink-2)]">{summary}</p> : null}
      {shortRows.length > 0 ? (
        <div>
          <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--c-ink-3)]">{shortTitle}</p>
          {renderRows(shortRows)}
        </div>
      ) : null}
      {longRows.length > 0 ? (
        <div>
          <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--c-ink-3)]">{longTitle}</p>
          {renderRows(longRows)}
        </div>
      ) : null}
      <EvidenceRail
        freshness={pending ? "pending" : hasRows ? "fresh" : "stale"}
        source={source}
        asOf={asOf}
        coverage={coverage}
        next={hasRows || pending ? undefined : "다음 갱신 시"}
        skeletonDelayMs={120}
      />
    </Panel>
  );
}

export type SharedValuationZone = "deep-discount" | "discount" | "neutral" | "premium" | "overheated" | "trap";

export interface SharedValuationBand {
  current: number;
  min: number;
  max: number;
  avg?: number | null;
  source: string;
}

export function sharedValuationBandTone(
  band: SharedValuationBand,
  weak: boolean,
): { label: string; detail: string; zone: SharedValuationZone } {
  const pct = bandPct(band.current, band.min, band.max);
  const avgPct = isFiniteNumber(band.avg) ? bandPct(band.avg, band.min, band.max) : 0.5;
  const neutralStart = Math.max(0.18, avgPct - 0.1);
  const neutralEnd = Math.min(0.82, avgPct + 0.1);
  if (pct < neutralStart && weak) {
    return { label: "밸류트랩 점검", detail: "PER는 낮지만 성장·수익성 점수 약세가 함께 보입니다.", zone: "trap" };
  }
  if (pct < neutralStart * 0.55) {
    return { label: "강한 할인 구간", detail: "PER 밴드 하단 깊숙한 구간입니다. 다음은 성장·마진 방어를 확인합니다.", zone: "deep-discount" };
  }
  if (pct < neutralStart) {
    return { label: "할인 구간", detail: "현재 PER가 공정가치권 아래에 있습니다.", zone: "discount" };
  }
  if (pct <= neutralEnd) {
    return { label: "공정가치권", detail: "현재 PER는 평균 밴드의 ±10% 중립권입니다.", zone: "neutral" };
  }
  if (pct < neutralEnd + (1 - neutralEnd) * 0.55) {
    return { label: "프리미엄 구간", detail: "현재 PER가 공정가치권 위에 있습니다. 성장 기대와 추정치 상향을 확인합니다.", zone: "premium" };
  }
  return { label: "과열 프리미엄", detail: "PER 밴드 상단권입니다. 기대 성장과 추정치 상향이 필요합니다.", zone: "overheated" };
}

export function SharedValuationBandPanel({
  band,
  weak = false,
  pending = false,
  source = "8Y PER band",
  asOf = "—",
  coverage = "—",
}: {
  band: SharedValuationBand | null;
  weak?: boolean;
  pending?: boolean;
  source?: string;
  asOf?: string;
  coverage?: string;
}) {
  if (pending || !band) {
    return (
      <Panel loading={pending}>
        <PanelHeader eyebrow="Valuation Band" title="밸류에이션 밴드" />
        {!pending ? <p className="px-4 py-3 text-[12px] text-[var(--c-ink-3)]">밴드 데이터를 아직 확인하지 못했습니다.</p> : null}
        <EvidenceRail
          freshness={pending ? "pending" : "stale"}
          source={source}
          asOf={asOf}
          coverage={coverage}
          next={pending ? undefined : "다음 갱신 시"}
          skeletonDelayMs={120}
        />
      </Panel>
    );
  }
  const pct = bandPct(band.current, band.min, band.max);
  const clampedPct = Math.max(0, Math.min(100, pct * 100));
  const tone = sharedValuationBandTone(band, weak);
  const avgPct = isFiniteNumber(band.avg) ? bandPct(band.avg, band.min, band.max) : 0.5;
  const neutralStartPct = Math.max(18, Math.min(82, avgPct * 100 - 10));
  const neutralEndPct = Math.max(18, Math.min(82, avgPct * 100 + 10));
  const lowMidPct = neutralStartPct * 0.55;
  const highMidPct = neutralEndPct + (100 - neutralEndPct) * 0.55;
  return (
    <Panel>
      <PanelHeader
        eyebrow="Valuation Band"
        title="밸류에이션 밴드"
        right={<span className="tabular-nums text-[11px] font-semibold text-[var(--c-ink-2)]">{Math.round(clampedPct)}%</span>}
      />
      <div className="px-4 py-3">
        <div
          data-stock-valuation-band-track
          className="relative h-3 overflow-hidden rounded-full border border-[var(--c-line)] bg-white"
          role="img"
          aria-label={`PER 밴드 ${Math.round(clampedPct)}%, ${tone.label}`}
        >
          <span data-stock-valuation-zone="deep-discount" className="absolute inset-y-0 left-0 bg-[var(--c-up)] opacity-45" style={{ width: `${lowMidPct}%` }} />
          <span data-stock-valuation-zone="discount" className="absolute inset-y-0 bg-[var(--c-up)] opacity-30" style={{ left: `${lowMidPct}%`, width: `${Math.max(0, neutralStartPct - lowMidPct)}%` }} />
          <span data-stock-valuation-zone="neutral" className="absolute inset-y-0 bg-white" style={{ left: `${neutralStartPct}%`, width: `${Math.max(0, neutralEndPct - neutralStartPct)}%` }} />
          <span data-stock-valuation-zone="premium" className="absolute inset-y-0 bg-[var(--c-down)] opacity-30" style={{ left: `${neutralEndPct}%`, width: `${Math.max(0, highMidPct - neutralEndPct)}%` }} />
          <span data-stock-valuation-zone="overheated" className="absolute inset-y-0 bg-[var(--c-down)] opacity-45" style={{ left: `${highMidPct}%`, width: `${Math.max(0, 100 - highMidPct)}%` }} />
          <span className="absolute inset-y-[-3px] w-[3px] rounded-full bg-[var(--c-ink)] shadow-sm" style={{ left: `${clampedPct}%`, transform: "translateX(-1.5px)" }} />
        </div>
        <div className="mt-1 grid grid-cols-3 text-[11px] tabular-nums text-[var(--c-ink-3)]">
          <span>{band.min.toFixed(1)}x</span>
          <span className="text-center">{isFiniteNumber(band.avg) ? `${band.avg.toFixed(1)}x ±10%` : band.source}</span>
          <span className="text-right">{band.max.toFixed(1)}x</span>
        </div>
        <p data-stock-valuation-verdict={tone.zone} className="mt-2 text-[12px] text-[var(--c-ink-2)]">
          {tone.label} · 현재 PER {band.current.toFixed(1)}x · {tone.detail}
        </p>
      </div>
      <EvidenceRail freshness="fresh" source={source} asOf={asOf} coverage={coverage} skeletonDelayMs={120} />
    </Panel>
  );
}

export type NumberSeries = MaybeNumber[];
export type EstimateSeries = { fy1?: MaybeNumber; fy2?: MaybeNumber; fy3?: MaybeNumber };
const ESTIMATE_KEYS = ["fy1", "fy2", "fy3"] as const;
const FISCAL_PERIOD_LABELS = ["내년(FY+1)", "2년차(FY+2)", "3년차(FY+3)"] as const;
const CHART_WIDTH = 300;
const CHART_PAD_L = 44;
const CHART_PAD_R = 30;

type ChartTextAnchor = "start" | "middle" | "end";

export function chartValueLabelPlacement({
  x,
  y,
  rightBoundary,
  topBoundary,
  defaultXOffset,
  defaultAnchor,
}: {
  x: number;
  y: number;
  rightBoundary: number;
  topBoundary: number;
  defaultXOffset: number;
  defaultAnchor: Exclude<ChartTextAnchor, "end">;
}): { x: number; y: number; anchor: ChartTextAnchor } {
  const nearRight = x > rightBoundary - 12;
  const nearTop = y < topBoundary + 14;
  return {
    x: nearRight ? x - 6 : x + defaultXOffset,
    y: nearTop ? y + 14 : y - 10,
    anchor: nearRight ? "end" : defaultAnchor,
  };
}

function renderChartWithEstimateGap(chart: ReactNode, completeness: EstimateCompleteness | null): ReactNode {
  if (!completeness || !hasEstimateGap(completeness)) return chart;
  return (
    <div className="space-y-1">
      {chart}
      <span className={`inline-flex rounded-full px-1.5 py-[1px] text-[9px] font-black ${estimateCompletenessTone(completeness)}`}>
        {completeness.label}
      </span>
    </div>
  );
}

interface WeeklyPoint {
  date?: string;
  value?: MaybeNumber;
}

interface WeeklyConsensusRow {
  date?: string;
  price?: MaybeNumber;
  revenue_consensus?: MaybeNumber;
  revenue_change?: MaybeNumber;
  eps_consensus?: MaybeNumber;
  eps_change?: MaybeNumber;
  per?: MaybeNumber;
  pbr?: MaybeNumber;
}

interface RawFinancials {
  periods?: string[];
  income_statement?: {
    revenue?: NumberSeries;
    gross_profit?: NumberSeries;
    operating_income?: NumberSeries;
    net_income?: NumberSeries;
  };
  per_share?: { eps?: NumberSeries };
  cash_flow?: { fcf?: NumberSeries; cfo?: NumberSeries; capex?: NumberSeries };
  profitability?: {
    gross_margin?: NumberSeries;
    operating_margin?: NumberSeries;
    net_margin?: NumberSeries;
    roe?: NumberSeries;
    roa?: NumberSeries;
  };
  growth?: { revenue_growth?: NumberSeries; eps_growth?: NumberSeries };
  valuation?: { per?: NumberSeries; pbr?: NumberSeries; psr?: NumberSeries };
}

export interface DetailData {
  years: string[];
  raw_periods?: string[];
  raw_financials?: RawFinancials;
  valuation?: { per?: NumberSeries };
  income_statement: {
    revenue?: NumberSeries;
    gross_profit?: NumberSeries;
    operating_income?: NumberSeries;
    net_income?: NumberSeries;
  };
  per_share?: { eps?: NumberSeries };
  cash_flow?: { cfo?: NumberSeries; capex?: NumberSeries; fcf?: NumberSeries };
  scale_estimates?: Record<string, Record<string, MaybeNumber>>;
  profitability?: {
    gross_margin?: NumberSeries;
    operating_margin?: NumberSeries;
    net_margin?: NumberSeries;
    roe?: NumberSeries;
    roa?: NumberSeries;
  };
  growth?: { revenue_growth?: NumberSeries; eps_growth?: NumberSeries };
  per_bands?: {
    current: MaybeNumber;
    min_8y: MaybeNumber;
    avg_8y: MaybeNumber;
    max_8y: MaybeNumber;
    source: string;
  };
  valuation_estimates?: {
    per?: { fy1?: MaybeNumber; fy2?: MaybeNumber; fy3?: MaybeNumber };
  };
  income_statement_estimates?: Record<string, Record<string, MaybeNumber>>;
  cash_flow_estimates?: Record<string, Record<string, MaybeNumber>>;
  profitability_estimates?: Record<string, Record<string, MaybeNumber>>;
  growth_estimates?: Record<string, Record<string, MaybeNumber>>;
  per_share_estimates?: Record<string, Record<string, MaybeNumber>>;
  dividend_estimates?: Record<string, Record<string, MaybeNumber>>;
  dividend?: { dps?: NumberSeries };
  eps_consensus?: {
    weekly?: {
      fy_plus_1?: WeeklyPoint[];
      fy_plus_2?: WeeklyPoint[];
      fy_plus_3?: WeeklyPoint[];
    };
    weekly_change?: {
      fy_plus_1?: MaybeNumber;
      fy_plus_2?: MaybeNumber;
      fy_plus_3?: MaybeNumber;
    };
  };
  weekly_revision_history?: {
    weekly_consensus_revision?: WeeklyConsensusRow[];
  };
}

export interface F13Entry {
  investor: string;
  shares?: number;
  weight?: number;
}

type StockDetailBoundaryProps = {
  ticker: string;
  children: ReactNode;
};

type StockDetailBoundaryState = {
  hasError: boolean;
};

class StockDetailBoundary extends Component<StockDetailBoundaryProps, StockDetailBoundaryState> {
  constructor(props: StockDetailBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): StockDetailBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[StockDetailBoundary] ${this.props.ticker} detail panel crashed:`, error, info.componentStack);
  }

  componentDidUpdate(previousProps: StockDetailBoundaryProps) {
    if (previousProps.ticker !== this.props.ticker && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div role="alert" className="rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)] px-4 py-3 text-sm font-semibold text-[var(--c-ink-3)]">
          이 종목 상세를 표시하는 중 일시적 오류가 발생했습니다. 다른 종목과 스크리너 목록은 계속 사용할 수 있습니다.
        </div>
      );
    }

    return this.props.children;
  }
}

interface SlickMetricPoint {
  date?: string;
  price?: MaybeNumber;
  pe_trailing?: MaybeNumber;
  pe_forward?: MaybeNumber;
  eps_trailing?: MaybeNumber;
  eps_forward?: MaybeNumber;
  dividend_yield?: MaybeNumber;
  dividend_ttm?: MaybeNumber;
  market_cap_billions?: MaybeNumber;
}

interface SlickReturnPoint {
  year?: number;
  return?: MaybeNumber;
}

interface SlickDividendPoint {
  amount?: MaybeNumber;
  exDate?: string;
  payDate?: string;
}

interface SlickStockData {
  symbol?: string;
  company?: string;
  updated?: string;
  current?: SlickMetricPoint;
  metrics_history?: SlickMetricPoint[];
  returns?: SlickReturnPoint[];
  dividends?: SlickDividendPoint[];
}

interface MarketFactCandidate {
  value?: unknown;
  source?: string;
  as_of?: string | null;
  fetched_at?: string | null;
  confidence?: string;
  unit?: string;
}

interface MarketFact extends MarketFactCandidate {
  candidates?: MarketFactCandidate[];
  policy?: string[];
  candidate_count?: number;
}

interface MarketFactsData {
  ticker?: string;
  asset_type?: string;
  generated_at?: string;
  source_as_of?: string | null;
  source_as_of_scope?: "selected_price_fact" | string;
  source_as_of_reason?: string | null;
  identity?: {
    name?: string | null;
    exchange?: string | null;
    currency?: string | null;
    sector?: string | null;
    industry?: string | null;
    fund_family?: string | null;
    category?: string | null;
  };
  facts?: Record<string, MarketFact>;
  etf?: {
    holdings_count?: number | null;
    holdings_updated?: string | null;
    top_holdings?: Array<{
      rank?: number;
      symbol?: string;
      name?: string;
      weight_pct?: number;
      shares?: number;
    }>;
    asset_allocation?: Array<{
      key?: string;
      value?: number;
    }>;
    sectors?: Array<{
      n?: string;
      key?: string;
      w?: number;
      weight?: number;
      value?: number;
    }>;
    countries?: Array<{
      code?: string;
      country?: string;
      weight?: number;
      value?: number;
    }>;
    yahoo_funds_data_available?: boolean;
  } | null;
  sources?: Record<string, boolean>;
  source_files?: Record<string, string | null>;
}

function requireSpokeLabel(scoreKey: string): string {
  const label = edgeAxisSpokeLabel(scoreKey);
  if (label === null) {
    throw new Error(`edge axis ${scoreKey} has no spoke label in the shared map`);
  }
  return label;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

interface DetailLongTermAxis extends FenokSignalRadarHexagonAxis {
  key: string;
  helpKey: FenokSignalHelpKey;
  fullLabel: string;
  coverage: number | null;
  tooltipNote?: string | null;
  invertedDisplay?: boolean;
  referenceOnly?: boolean;
  meta: { tier: string | null; tone: "up" | "warn" | "down" | "neutral" };
}

export function rankFenokEdgeAxes<T extends { score: number | null; referenceOnly?: boolean }>(
  axes: readonly T[],
  direction: "asc" | "desc",
  limit: number,
): T[] {
  const multiplier = direction === "desc" ? -1 : 1;
  return [...axes]
    .filter((axis) => axis.score !== null && !axis.referenceOnly)
    .sort((left, right) => multiplier * ((left.score ?? 0) - (right.score ?? 0)))
    .slice(0, limit);
}

interface DetailLongTermAxisConfig {
  key: string;
  fullLabel: string;
  scoreKey: keyof ScreenerStock;
  directionKey?: keyof ScreenerStock;
  coverageKey?: keyof ScreenerStock;
  helpKey: FenokSignalHelpKey;
  invertScore?: boolean;
  tooltipNote?: string;
  referenceOnly?: boolean;
}

const DETAIL_LONG_TERM_AXIS_CONFIG: DetailLongTermAxisConfig[] = [
  {
    key: "profitability",
    fullLabel: "수익성",
    scoreKey: "profitabilityScore",
    directionKey: "profitabilityDirection",
    helpKey: "profitability",
  },
  {
    key: "growth",
    fullLabel: "성장",
    scoreKey: "growthScore",
    directionKey: "growthDirection",
    helpKey: "growth",
  },
  {
    key: "upsidePotential",
    fullLabel: "상승 잠재력",
    scoreKey: "upsidePotentialScore",
    helpKey: "upsidePotential",
  },
  {
    key: "downsidePressure",
    fullLabel: "하락 압력 완화",
    scoreKey: "downsidePressureScore",
    helpKey: "downsidePressure",
    invertScore: true,
    tooltipNote: "하락 압력을 뒤집어 표시한 점수, 높을수록 위험 낮음",
  },
  {
    key: "marketSimilarity",
    fullLabel: "동종군 유사도",
    scoreKey: "marketSimilarityScore",
    helpKey: "marketSimilarity",
    referenceOnly: true,
  },
  {
    key: "durabilityProfitability",
    fullLabel: "내구 수익성",
    scoreKey: "durabilityProfitabilityScore",
    coverageKey: "durabilityProfitabilityCoverage",
    helpKey: "durabilityProfitability",
  },
];

const DETAIL_SHORT_TERM_AXIS_CONFIG: DetailLongTermAxisConfig[] = [
  {
    key: "technicalFlow",
    fullLabel: "기술·자금 흐름",
    scoreKey: "technicalFlowScore",
    directionKey: "technicalFlowDirection",
    helpKey: "technicalFlow",
  },
  {
    key: "volumeLiquidityTrend",
    fullLabel: "거래량·유동성 추세",
    scoreKey: "volumeLiquidityTrendScore",
    directionKey: "volumeLiquidityTrendDirection",
    helpKey: "volumeLiquidityTrend",
    tooltipNote: "가격·거래량 데이터 기반 프록시, 실제 주문 흐름 아님",
  },
  {
    key: "shortTermRelativeStrength",
    fullLabel: "단기 상대 강도",
    scoreKey: "shortTermRelativeStrengthScore",
    directionKey: "shortTermRelativeStrengthDirection",
    helpKey: "shortTermRelativeStrength",
    tooltipNote: "20일/60일 SPY 대비 상대 강도 프록시",
  },
  {
    key: "netOptionsProxy",
    fullLabel: "옵션 활동 프록시",
    scoreKey: "netOptionsProxyScore",
    helpKey: "netOptionsProxy",
    tooltipNote: "미국 옵션청산회사(OCC) 공개 거래량으로 옵션 쏠림을 추정합니다. 실제 주문 흐름을 뜻하지 않습니다.",
  },
  {
    key: "offExchangeActivityProxy",
    fullLabel: "장외거래 활동 프록시",
    scoreKey: "offExchangeActivityProxyScore",
    helpKey: "offExchangeActivityProxy",
    tooltipNote: "미국 금융산업규제청(FINRA) 공개 장외 거래 데이터로 만든 보조 신호입니다. 방향성 확정 신호가 아닙니다.",
    referenceOnly: true,
  },
  {
    key: "shortPressureProxy",
    fullLabel: "숏압력 완화",
    scoreKey: "shortPressureProxyScore",
    helpKey: "shortPressureProxy",
    invertScore: true,
    tooltipNote: "숏 볼륨 압력을 뒤집어 표시한 점수, 높을수록 압력 낮음",
  },
];

function deriveDetailAxisMeta(
  score: number | null,
  helpKey: FenokSignalHelpKey,
  invertedDisplay = false,
): DetailLongTermAxis["meta"] & { direction: string | null } {
  const band = lookupBand(getDisplaySignalHelpBands(helpKey, invertedDisplay), score);
  const tier = band?.label ?? null;
  const tone = band?.tone ?? "neutral";
  let direction: string | null = null;
  if (tone === "up") direction = "constructive";
  if (tone === "warn") direction = "neutral";
  if (tone === "down") direction = "weak";
  return { tier, tone, direction };
}

function buildDetailLongTermAxes(stock: ScreenerStock): DetailLongTermAxis[] {
  return DETAIL_LONG_TERM_AXIS_CONFIG.map((config) => {
    const rawScore = stock[config.scoreKey as keyof ScreenerStock];
    let score = isFiniteNumber(rawScore) ? rawScore : null;
    if (score !== null && config.invertScore) {
      score = Math.max(0, Math.min(100, 100 - score));
    }
    const rawDirection = config.directionKey
      ? stock[config.directionKey as keyof ScreenerStock]
      : null;
    const explicitDirection =
      typeof rawDirection === "string" && rawDirection !== "unavailable" ? rawDirection : null;
    const rawCoverage = config.coverageKey
      ? stock[config.coverageKey as keyof ScreenerStock]
      : null;
    const coverage = isFiniteNumber(rawCoverage) ? rawCoverage : null;
    const meta = deriveDetailAxisMeta(score, config.helpKey, Boolean(config.invertScore));
    return {
      key: config.key,
      label: requireSpokeLabel(config.scoreKey),
      fullLabel: config.fullLabel,
      score,
      direction: explicitDirection ?? meta.direction,
      tier: meta.tier,
      helpKey: config.helpKey,
      tooltipNote: config.tooltipNote ?? null,
      coverage,
      invertedDisplay: Boolean(config.invertScore),
      referenceOnly: Boolean(config.referenceOnly),
      meta,
    };
  });
}

function buildDetailShortTermAxes(stock: ScreenerStock): DetailLongTermAxis[] {
  return DETAIL_SHORT_TERM_AXIS_CONFIG.map((config) => {
    const rawScore = stock[config.scoreKey as keyof ScreenerStock];
    let score = isFiniteNumber(rawScore) ? rawScore : null;
    if (score !== null && config.invertScore) {
      score = Math.max(0, Math.min(100, 100 - score));
    }
    const rawDirection = config.directionKey
      ? stock[config.directionKey as keyof ScreenerStock]
      : null;
    const explicitDirection =
      typeof rawDirection === "string" && rawDirection !== "unavailable" ? rawDirection : null;
    const rawCoverage = config.coverageKey
      ? stock[config.coverageKey as keyof ScreenerStock]
      : null;
    const coverage = isFiniteNumber(rawCoverage) ? rawCoverage : null;
    const meta = deriveDetailAxisMeta(score, config.helpKey, Boolean(config.invertScore));
    return {
      key: config.key,
      label: requireSpokeLabel(config.scoreKey),
      fullLabel: config.fullLabel,
      score,
      direction: explicitDirection ?? meta.direction,
      tier: meta.tier,
      helpKey: config.helpKey,
      tooltipNote: config.tooltipNote ?? null,
      coverage,
      invertedDisplay: Boolean(config.invertScore),
      meta,
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asNumberSeries(data: NumberSeries | null | undefined): NumberSeries {
  return Array.isArray(data) ? data : [];
}

function asStringSeries(data: string[] | null | undefined): string[] {
  return Array.isArray(data) ? data : [];
}

function finiteValues(data: NumberSeries | null | undefined): number[] {
  return asNumberSeries(data).filter(isFiniteNumber);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function readToneClass(tone: InterpretationReadTone): string {
  if (tone === "positive") return "border-[var(--up-border)] bg-[var(--c-up-soft)] text-[var(--c-up)]";
  if (tone === "risk") return "border-[var(--down-border)] bg-[var(--c-down-soft)] text-[var(--c-down)]";
  if (tone === "watch") return "border-[var(--warn-border)] bg-[var(--c-warn-soft)] text-[var(--c-warn)]";
  return "border-[var(--c-line)] bg-[var(--c-surface-2)] text-[var(--c-ink-2)]";
}

type ScreenerVerdictSignal = {
  id: "valuation" | "growth" | "revision" | "ownership";
  label: string;
  shortText: string;
  text: string;
  tone: InterpretationReadTone;
};

type ScreenerThreeSecondVerdict = {
  badge: string;
  badgeClass: string;
  text: string;
  signals: ScreenerVerdictSignal[];
};

type FiscalPoint = { label: string; value: number; index: number; estimate?: boolean };

function normalizeEstimates(estimates?: MaybeNumber | EstimateSeries): EstimateSeries {
  if (isFiniteNumber(estimates)) return { fy1: estimates };
  return estimates && typeof estimates === "object" ? estimates : {};
}

function buildFiscalPoints(years: string[] | null | undefined, data: NumberSeries | null | undefined, estimates?: MaybeNumber | EstimateSeries) {
  const safeYears = asStringSeries(years);
  const safeData = asNumberSeries(data);
  const actualCount = Math.max(safeYears.length, safeData.length);
  const labels = Array.from({ length: actualCount }, (_, index) => safeYears[index] ?? `P${index + 1}`);
  const points: FiscalPoint[] = safeData
    .map((value, index) => ({
      label: labels[index] ?? `P${index + 1}`,
      value,
      index,
    }))
    .filter((point): point is FiscalPoint => isFiniteNumber(point.value));
  const estimateLabels = ESTIMATE_KEYS.map((key, index) => [key, FISCAL_PERIOD_LABELS[index]] as const);
  const estimatePoints: FiscalPoint[] = [];
  estimateLabels.forEach(([key, label]) => {
    const value = normalizeEstimates(estimates)[key];
    if (isFiniteNumber(value)) {
      estimatePoints.push({ label, value, index: actualCount + estimatePoints.length, estimate: true });
    }
  });
  points.push(...estimatePoints);
  return {
    labels: [...labels, ...estimatePoints.map((point) => point.label)],
    points,
  };
}

function deriveRatioEstimates(
  existing: Record<string, MaybeNumber> | undefined,
  numerator: Record<string, MaybeNumber> | undefined,
  denominator: Record<string, MaybeNumber> | undefined,
): EstimateSeries | null {
  const next: EstimateSeries = {};
  for (const key of ESTIMATE_KEYS) {
    const existingValue = existing?.[key];
    if (isFiniteNumber(existingValue)) {
      next[key] = existingValue;
      continue;
    }
    const numeratorValue = numerator?.[key];
    const denominatorValue = denominator?.[key];
    next[key] = isFiniteNumber(numeratorValue) && isFiniteNumber(denominatorValue) && denominatorValue !== 0
      ? (numeratorValue / denominatorValue) * 100
      : null;
  }
  return Object.values(next).some(isFiniteNumber) ? next : null;
}

export function deriveProfitabilityEstimates(detail: DetailData): Record<string, EstimateSeries | null> {
  const income = detail.income_statement_estimates;
  const scale = detail.scale_estimates;
  const existing = detail.profitability_estimates;
  return {
    gross_margin: deriveRatioEstimates(existing?.gross_margin, income?.gross_profit, income?.revenue),
    operating_margin: deriveRatioEstimates(existing?.operating_margin, income?.operating_income, income?.revenue),
    net_margin: deriveRatioEstimates(existing?.net_margin, income?.net_income, income?.revenue),
    roe: deriveRatioEstimates(existing?.roe, income?.net_income, scale?.total_equity),
    roa: deriveRatioEstimates(existing?.roa, income?.net_income, scale?.total_assets),
  };
}

function lastFinite(data: NumberSeries | null | undefined): number | null {
  const values = finiteValues(data);
  return values.length > 0 ? values[values.length - 1] : null;
}

function estimateTuple(series: EstimateSeries | undefined, fallback: [MaybeNumber, MaybeNumber, MaybeNumber]): [MaybeNumber, MaybeNumber, MaybeNumber] {
  const values: [MaybeNumber, MaybeNumber, MaybeNumber] = [series?.fy1, series?.fy2, series?.fy3];
  return values.some(isFiniteNumber) ? values : fallback;
}

function averageFinite(values: MaybeNumber[]): number | null {
  const numbers = values.filter(isFiniteNumber);
  if (numbers.length === 0) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function verdictScore(tone: InterpretationReadTone): number {
  if (tone === "positive") return 1;
  if (tone === "risk") return -1;
  return 0;
}

function validPerBands(
  perBands: DetailData["per_bands"],
): perBands is { current: number; min_8y: number; avg_8y: number; max_8y: number; source: string } {
  return Boolean(
    perBands &&
      isFiniteNumber(perBands.current) &&
      isFiniteNumber(perBands.min_8y) &&
      isFiniteNumber(perBands.avg_8y) &&
      isFiniteNumber(perBands.max_8y) &&
      perBands.min_8y < perBands.max_8y,
  );
}

function buildScreenerThreeSecondVerdict({
  stock,
  detail,
  f13Count,
  interpretation,
}: {
  stock: ScreenerStock | undefined;
  detail: DetailData;
  f13Count: number;
  interpretation: ReturnType<typeof interpretStockMetrics> | null;
}): ScreenerThreeSecondVerdict | null {
  if (!stock || !interpretation) return null;

  const signals: ScreenerVerdictSignal[] = [];
  const bands = validPerBands(detail.per_bands) ? detail.per_bands : null;
  if (bands) {
    const pct = bandPct(bands.current, bands.min_8y, bands.max_8y);
    const pctLabel = `${Math.round(pct * 100)}%`;
    const avgText = isFiniteNumber(bands.avg_8y)
      ? `평균 ${bands.avg_8y.toFixed(1)}배 ${bands.current >= bands.avg_8y ? "위" : "아래"}`
      : "평균 미확인";
    const tone: InterpretationReadTone = pct <= 0.3 ? "positive" : pct >= 0.75 ? "risk" : "neutral";
    signals.push({
      id: "valuation",
      label: "밸류",
      shortText: `밴드 ${pctLabel}`,
      text: `PER은 8년 밴드의 ${pctLabel} 지점, ${avgText}입니다.`,
      tone,
    });
  }

  const revenueGrowth = estimateTuple(detail.growth_estimates?.revenue_growth, [stock.revenueGrowthFy1, stock.revenueGrowthFy2, stock.revenueGrowthFy3]);
  const epsGrowth = estimateTuple(detail.growth_estimates?.eps_growth, [stock.epsGrowthFy1, stock.epsGrowthFy2, stock.epsGrowthFy3]);
  const revAvg = averageFinite(revenueGrowth);
  const epsAvg = averageFinite(epsGrowth);
  if (revAvg !== null || epsAvg !== null) {
    const pairedPositiveYears = [0, 1, 2].filter((index) => {
      const revenue = revenueGrowth[index];
      const eps = epsGrowth[index];
      return isFiniteNumber(revenue) && revenue > 0 && isFiniteNumber(eps) && eps > 0;
    }).length;
    const tone: InterpretationReadTone =
      pairedPositiveYears >= 2 && (epsAvg ?? 0) >= 5
        ? "positive"
        : pairedPositiveYears === 0 || (epsAvg !== null && epsAvg < 0)
          ? "risk"
          : "watch";
    signals.push({
      id: "growth",
      label: "성장",
      shortText: `동시 플러스 ${pairedPositiveYears}/3`,
      text: `향후 3년(FY+1~FY+3) 중 ${pairedPositiveYears}개 연도에서 매출과 EPS가 함께 플러스입니다${epsAvg !== null ? `, EPS 평균 ${formatPlainPercent(epsAvg, { digits: 1, fraction: false })}` : ""}.`,
      tone,
    });
  }

  const revisionValues = [
    detail.eps_consensus?.weekly_change?.fy_plus_1,
    detail.eps_consensus?.weekly_change?.fy_plus_2,
    detail.eps_consensus?.weekly_change?.fy_plus_3,
  ].filter(isFiniteNumber);
  if (revisionValues.length > 0) {
    const up = revisionValues.filter((value) => value > 0.001).length;
    const down = revisionValues.filter((value) => value < -0.001).length;
    const avg = averageFinite(revisionValues.map((value) => value * 100));
    const tone: InterpretationReadTone = up >= 2 ? "positive" : down >= 2 ? "risk" : "watch";
    const direction = up >= 2 ? "상향 우세" : down >= 2 ? "하향 우세" : "혼조";
    signals.push({
      id: "revision",
      label: "수정",
      shortText: direction,
      text: `최근 EPS 추정은 상향 ${up}개, 하향 ${down}개로 ${direction}입니다${avg !== null ? `, 평균 변화 ${fmtSignedPercentPoints(avg, 2)}` : ""}.`,
      tone,
    });
  }

  if (f13Count > 0) {
    signals.push({
      id: "ownership",
      label: "13F",
      shortText: `${f13Count}명 보유`,
      text: `기관 공시 기준 ${f13Count}명이 보유 중입니다.`,
      tone: f13Count >= 3 ? "positive" : "neutral",
    });
  }

  if (signals.length === 0) return null;
  const score = signals.reduce((sum, signal) => sum + verdictScore(signal.tone), 0);
  const riskCount = signals.filter((signal) => signal.tone === "risk").length;
  const badge =
    score >= 2 && riskCount === 0
      ? "긍정 신호 우세"
      : riskCount >= 2 || score <= -1
        ? "주의 신호 우세"
        : "강점·확인 포인트 공존";
  const badgeClass =
    score >= 2 && riskCount === 0
      ? "border-[var(--up-border)] bg-[var(--c-up-soft)] text-[var(--c-up)]"
      : riskCount >= 2 || score <= -1
        ? "border-[var(--down-border)] bg-[var(--c-down-soft)] text-[var(--c-down)]"
        : "border-[var(--warn-border)] bg-[var(--c-warn-soft)] text-[var(--c-warn)]";
  const text = [`Feno 분류는 ${interpretation.badge}입니다.`, ...signals.slice(0, 3).map((signal) => signal.text)].join(" ");
  return { badge, badgeClass, text, signals };
}

function fmtPlainNumber(value: MaybeNumber, digits = 1): string {
  return formatDecimal(value, { digits });
}

function fmtSignedNumber(value: MaybeNumber, digits = 2): string {
  return formatSignedDecimal(value, { digits });
}

function fmtSignedPercentPoints(value: MaybeNumber, digits = 1): string {
  return formatSignedPercent(value, { digits, fraction: false });
}

function fmtSignedFractionPercent(value: MaybeNumber, digits = 1): string {
  return formatSignedPercent(value, { digits });
}

function fmtEps(value: MaybeNumber): string {
  return formatCurrency(value, "USD", { digits: 2 });
}

function toneText(value: MaybeNumber): string {
  if (!isFiniteNumber(value)) return "text-[var(--c-ink-3)]";
  return value >= 0 ? "text-[var(--c-up)]" : "text-[var(--c-down)]";
}

function loaderErrorDetail(error: LoaderError, subject: string): string {
  if (error.kind === "status") return `${subject}를 불러오지 못했습니다(HTTP ${error.status ?? "오류"}). 다시 시도해 주세요.`;
  if (error.kind === "parse") return `${subject}의 데이터 형식을 확인하지 못했습니다. 다시 시도해 주세요.`;
  return `${subject} 요청이 시간 초과되었습니다. 네트워크 확인 후 다시 시도해 주세요.`;
}

export function useStockDetail(ticker: string, enabled = true) {
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LoaderError | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const symbol = normalizeForEntityKey(ticker);
    if (!enabled || !symbol) {
      setDetail(null);
      setLoading(false);
      setError(null);
      return;
    }
    const run = async () => {
      setLoading(true);
      try {
        const r = await fetch(`/data/global-scouter/stocks/detail/${encodeURIComponent(symbol)}.json`);
        if (!r.ok) {
          if (!cancelled) setError({ kind: "status", status: r.status });
          return;
        }
        const d = await r.json();
        if (!cancelled) {
          setDetail(isRecord(d) ? (d as unknown as DetailData) : null);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof SyntaxError ? { kind: "parse" } : { kind: "timeout" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [ticker, enabled, retryNonce]);

  return { detail, loading, error, retry: () => setRetryNonce((n) => n + 1) };
}

const F13_CACHE = new Map<string, F13Entry[]>();

export function use13FData(ticker: string) {
  const [entries, setEntries] = useState<F13Entry[] | null>(null);
  const [error, setError] = useState<LoaderError | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const symbol = normalizeForEntityKey(ticker);
    if (!symbol) {
      Promise.resolve().then(() => {
        if (!cancelled) {
          setEntries([]);
          setError(null);
        }
      });
      return () => {
        cancelled = true;
      };
    }
    const run = async () => {
      const cached = F13_CACHE.get(symbol);
      if (cached !== undefined) {
        setEntries(cached);
        setError(null);
        return;
      }
      try {
        const r = await fetch("/data/sec-13f/by_ticker.json");
        if (!r.ok) {
          if (!cancelled) setError({ kind: "status", status: r.status });
          return;
        }
        const d = await r.json();
        const holders = Array.isArray(d?.[symbol]?.holder_details) ? d[symbol].holder_details : [];
        const seen = new Set<string>();
        const unique = holders.filter((h: { investor?: unknown }) => {
          if (typeof h.investor !== "string" || h.investor.trim() === "") return false;
          if (seen.has(h.investor)) return false;
          seen.add(h.investor);
          return true;
        }) as F13Entry[];
        F13_CACHE.set(symbol, unique);
        if (!cancelled) {
          setEntries(unique);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof SyntaxError ? { kind: "parse" } : { kind: "timeout" });
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [ticker, retryNonce]);

  return {
    entries,
    error,
    retry: () => {
      const symbol = normalizeForEntityKey(ticker);
      if (symbol) F13_CACHE.delete(symbol);
      setRetryNonce((n) => n + 1);
    },
  };
}

const SLICK_STOCK_CACHE = new Map<string, SlickStockData | null>();
const MARKET_FACTS_CACHE = new Map<string, MarketFactsData | null>();

function readSlickMetric(value: unknown): SlickMetricPoint | null {
  if (!isRecord(value)) return null;
  const point: SlickMetricPoint = {
    date: optionalString(value.date),
    price: finiteNumber(value.price),
    pe_trailing: finiteNumber(value.pe_trailing),
    pe_forward: finiteNumber(value.pe_forward),
    eps_trailing: finiteNumber(value.eps_trailing),
    eps_forward: finiteNumber(value.eps_forward),
    dividend_yield: finiteNumber(value.dividend_yield),
    dividend_ttm: finiteNumber(value.dividend_ttm),
    market_cap_billions: finiteNumber(value.market_cap_billions),
  };
  return point.date ||
    isFiniteNumber(point.price) ||
    isFiniteNumber(point.pe_trailing) ||
    isFiniteNumber(point.pe_forward) ||
    isFiniteNumber(point.market_cap_billions)
    ? point
    : null;
}

function readSlickReturn(value: unknown): SlickReturnPoint | null {
  if (!isRecord(value)) return null;
  const year = finiteNumber(value.year);
  const returnPct = finiteNumber(value.return);
  return isFiniteNumber(year) && isFiniteNumber(returnPct) ? { year, return: returnPct } : null;
}

function readSlickDividend(value: unknown): SlickDividendPoint | null {
  if (!isRecord(value)) return null;
  const point = {
    amount: finiteNumber(value.amount),
    exDate: optionalString(value.exDate),
    payDate: optionalString(value.payDate),
  };
  return isFiniteNumber(point.amount) || point.exDate || point.payDate ? point : null;
}

function normalizeSlickStock(value: unknown): SlickStockData | null {
  if (!isRecord(value)) return null;
  const current = readSlickMetric(value.current);
  const metrics = Array.isArray(value.metrics_history)
    ? value.metrics_history.map(readSlickMetric).filter((point): point is SlickMetricPoint => point !== null)
    : [];
  const returns = Array.isArray(value.returns)
    ? value.returns.map(readSlickReturn).filter((point): point is SlickReturnPoint => point !== null)
    : [];
  const dividends = Array.isArray(value.dividends)
    ? value.dividends.map(readSlickDividend).filter((point): point is SlickDividendPoint => point !== null)
    : [];
  if (!current && metrics.length === 0 && returns.length === 0 && dividends.length === 0) return null;
  return {
    symbol: optionalString(value.symbol),
    company: optionalString(value.company),
    updated: optionalString(value.updated),
    current: current ?? undefined,
    metrics_history: metrics,
    returns,
    dividends,
  };
}

export function useSlickStock(ticker: string, enabled = true) {
  const [data, setData] = useState<SlickStockData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const symbol = normalizeForEntityKey(ticker);
    if (!enabled || !symbol) {
      setData(null);
      setLoading(false);
      return;
    }
    const cached = SLICK_STOCK_CACHE.get(symbol);
    if (cached !== undefined) {
      setData(cached);
      setLoading(false);
      return;
    }

    const run = async () => {
      setLoading(true);
      try {
        const r = await fetch(`/data/slickcharts/stocks/${encodeURIComponent(symbol)}.json`);
        const parsed = r.ok ? normalizeSlickStock(await r.json()) : null;
        SLICK_STOCK_CACHE.set(symbol, parsed);
        if (!cancelled) setData(parsed);
      } catch {
        SLICK_STOCK_CACHE.set(symbol, null);
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [ticker, enabled]);

  return { data, loading };
}

function normalizeMarketFacts(value: unknown): MarketFactsData | null {
  if (!isRecord(value)) return null;
  if (!isRecord(value.facts) && !isRecord(value.identity) && !isRecord(value.etf)) return null;
  return value as unknown as MarketFactsData;
}

export function useMarketFacts(ticker: string, enabled = true) {
  const [data, setData] = useState<MarketFactsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LoaderError | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const symbol = normalizeForEntityKey(ticker);
    if (!enabled || !symbol) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const cached = MARKET_FACTS_CACHE.get(symbol);
    if (cached !== undefined) {
      setData(cached);
      setLoading(false);
      setError(null);
      return;
    }

    const run = async () => {
      setLoading(true);
      try {
        const parsed = normalizeMarketFacts(await fetchMarketFactsFromShard(symbol));
        MARKET_FACTS_CACHE.set(symbol, parsed);
        if (!cancelled) {
          setData(parsed);
          setError(null);
        }
      } catch (err) {
        // fetchMarketFactsFromShard throws Error("... status NNN") on HTTP !ok.
        const statusText = err instanceof Error ? /status (\d{3})/.exec(err.message)?.[1] : undefined;
        const status = statusText !== undefined ? Number(statusText) : null;
        if (!cancelled) {
          setError(err instanceof SyntaxError ? { kind: "parse" } : status !== null ? { kind: "status", status } : { kind: "timeout" });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [ticker, enabled, retryNonce]);

  return {
    data,
    loading,
    error,
    retry: () => {
      const symbol = normalizeForEntityKey(ticker);
      if (symbol) MARKET_FACTS_CACHE.delete(symbol);
      setRetryNonce((n) => n + 1);
    },
  };
}

function sourceLabel(source?: string): string {
  if (!source) return "출처 없음";
  if (source === "yf") return "가격·재무 기준";
  if (source === "yf.fast_info") return "빠른 가격 기준";
  if (source === "stockanalysis") return "추가 지표";
  if (source === "stockanalysis.quote") return "추가 가격 기준";
  if (source === "stockanalysis.overview") return "추가 재무 기준";
  if (source === "slickcharts") return "지수 구성 기준";
  return "확인 기준";
}

function sharedCurrency(currency: string): Currency | null {
  if (currency === "KRW" || currency === "USD") return currency;
  return null;
}

function fmtMarketMoney(value: number, currency = "USD"): string {
  const normalized = sharedCurrency(currency);
  if (normalized) return formatCurrencyCompact(value, normalized);
  const usdScaled = formatCurrencyCompact(value, "USD");
  return `${currency} ${usdScaled.startsWith("$") ? usdScaled.slice(1) : usdScaled}`;
}

function formatMarketFact(key: string, fact: MarketFact | undefined, currency = "USD"): string {
  const value = fact?.value;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (key === "price" || key === "previous_close" || key === "change") return fmtMarketMoney(value, currency);
    if (key === "market_cap" || key === "total_assets") return fmtMarketMoney(value, currency);
    if (key === "change_pct" || key === "dividend_yield" || key === "expense_ratio") return formatPlainPercent(value, { digits: 2, fraction: false });
    if (key === "trailing_pe" || key === "forward_pe") return formatMultiple(value, { digits: 1 });
    if (key === "beta") return formatDecimal(value, { digits: 2 });
    return formatInteger(value);
  }
  if (typeof value === "string" && value.trim()) return value;
  return "—";
}

function etfBreakdownLabel(row: { key?: string; n?: string; country?: string; code?: string }): string {
  return row.key ?? row.n ?? row.country ?? row.code ?? "—";
}

function etfBreakdownWeight(row: { value?: number; w?: number; weight?: number }): number | null {
  if (isFiniteNumber(row.value)) return row.value;
  if (isFiniteNumber(row.w)) return row.w;
  if (isFiniteNumber(row.weight)) return row.weight;
  return null;
}

function EtfBreakdownStrip({
  title,
  rows,
  limit,
}: {
  title: string;
  rows?: Array<{ key?: string; n?: string; country?: string; code?: string; value?: number; w?: number; weight?: number }>;
  limit: number;
}) {
  const items = (rows ?? []).slice(0, limit);
  if (items.length === 0) return null;
  return (
    <div className="min-w-0 rounded-xl border border-[var(--c-line)] bg-[var(--c-surface-2)] p-2.5">
      <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">{title}</p>
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {items.map((row, index) => {
          const weight = etfBreakdownWeight(row);
          return (
            <span key={`${title}-${index}-${etfBreakdownLabel(row)}`} className="max-w-full rounded-full bg-[var(--c-panel)] px-2 py-0.5 text-[10px] font-bold text-[var(--c-ink-3)] ring-1 ring-[var(--c-line)]">
              <span className="inline-block max-w-[9rem] truncate align-bottom">{etfBreakdownLabel(row)}</span>
              {weight !== null ? <span className="ml-1 font-black tabular-nums text-[var(--c-ink)]">{formatPlainPercent(weight, { digits: 1, fraction: false })}</span> : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function MarketFactCard({ label, field, fact, currency }: { label: string; field: string; fact?: MarketFact; currency?: string }) {
  if (!fact) return null;
  const candidateCount = fact.candidate_count ?? fact.candidates?.length ?? 1;
  return (
    <div className="min-w-0 rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)] px-3 py-2.5">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <p className="min-w-0 truncate text-[10px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">{label}</p>
        <span className="shrink-0 rounded-full bg-[var(--c-surface-2)] px-1.5 py-0.5 text-[9px] font-black text-[var(--c-ink-3)]">
          기준 {candidateCount}곳 확인
        </span>
      </div>
      <p className="mt-1 min-w-0 break-words text-base font-black tabular-nums text-[var(--c-ink)]">
        {formatMarketFact(field, fact, currency)}
      </p>
      <p className="mt-1 min-w-0 truncate text-[10px] font-bold text-[var(--c-ink-3)]" title={sourceLabel(fact.source)}>
        {sourceLabel(fact.source)}
      </p>
    </div>
  );
}

export function MarketFactsDepth({ ticker, compact = false }: { ticker: string; compact?: boolean }) {
  const { data, loading, error, retry } = useMarketFacts(ticker);
  if (loading) {
    return (
      <DataStateNotice
        state={makeDataState({
          status: "pending",
          detail: "통합 데이터와 보조 지표를 확인하고 있습니다.",
        })}
        className="mt-4"
      />
    );
  }
  if (!data) {
    if (error) {
      return (
        <DataStateNotice
          state={makeDataState({
            status: "unavailable",
            detail: loaderErrorDetail(error, "이 종목의 가격·분류·보조 지표"),
          })}
          actionLabel="지금 재시도"
          onAction={retry}
          className="mt-4"
        />
      );
    }
    return (
      <DataStateNotice
        state={makeDataState({
          status: "unavailable",
          detail: "이 종목의 가격·분류·보조 지표를 아직 찾지 못했습니다.",
        })}
        className="mt-4"
      />
    );
  }

  const facts = data.facts ?? {};
  const currency = data.identity?.currency ?? "USD";
  const primaryFields = data.asset_type === "etf"
    ? [
        ["가격", "price"],
        ["등락률", "change_pct"],
        ["순자산", "total_assets"],
        ["비용률", "expense_ratio"],
        ["베타", "beta"],
        ["배당률", "dividend_yield"],
      ]
    : [
        ["가격", "price"],
        ["등락률", "change_pct"],
        ["시가총액", "market_cap"],
        ["PER", "trailing_pe"],
        ["예상 PER", "forward_pe"],
        ["배당률", "dividend_yield"],
      ];
  const availableSources = Object.entries(data.sources ?? {})
    .filter(([, available]) => available)
    .map(([source]) => source);
  const topHoldings = (data.etf?.top_holdings ?? []).slice(0, compact ? 5 : 10);
  const breakdownLimit = compact ? 4 : 8;
  const availablePrimaryFields = primaryFields.filter(([, field]) => facts[field]);
  const sourceAsOf = typeof data.source_as_of === "string" && data.source_as_of.trim()
    ? data.source_as_of
    : null;
  const sourceAsOfReason = typeof data.source_as_of_reason === "string" && data.source_as_of_reason.trim()
    ? data.source_as_of_reason
    : null;
  const sourceAsOfReasonLabel = sourceAsOfReason === "selected price fact has no provider source date"
    ? "선택된 가격 데이터에 공급자 기준일이 없습니다."
    : "가격 기준일을 확인할 수 없습니다.";

  return (
    <div className="mt-4 rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)]/95 p-3">
      <div className="mb-3 flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-[12px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">통합 데이터</h4>
          <p className="mt-0.5 min-w-0 text-[11px] font-bold text-[var(--c-ink-3)]">
            <span className="font-black">{data.ticker ?? ticker}</span>
            {data.identity?.name ? (
              <span className="block max-w-[14rem] truncate" title={data.identity.name}>
                {data.identity.name}
              </span>
            ) : null}
            <span> · {data.asset_type === "etf" ? "ETF" : "주식"}</span>
          </p>
        </div>
        <span
          className="min-w-0 truncate text-[11px] font-bold text-[var(--c-ink-3)]"
          title={sourceAsOf ? undefined : sourceAsOfReason ?? undefined}
        >
          {sourceAsOf ? `가격 기준 ${sourceAsOf.slice(0, 10)}` : "가격 기준일 미확인"}
          {data.generated_at ? ` · 생성 ${data.generated_at.slice(0, 10)}` : ""}
        </span>
      </div>
      {availablePrimaryFields.length > 0 ? (
        <div className="grid min-w-0 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {availablePrimaryFields.map(([label, field]) => (
            <MarketFactCard key={field} label={label} field={field} fact={facts[field]} currency={currency} />
          ))}
        </div>
      ) : (
        <DataStateNotice
          state={makeDataState({
            status: "unavailable",
            label: "통합 데이터 항목 없음",
            detail: `데이터 파일은 열렸지만 표시할 핵심 가격·밸류 항목이 없습니다. ${sourceAsOf ? "" : sourceAsOfReasonLabel}`.trim(),
            asOf: sourceAsOf,
          })}
        />
      )}

      {data.asset_type === "etf" ? (
        <div className="mt-3 grid min-w-0 gap-2 md:grid-cols-3">
          <EtfBreakdownStrip title="자산 배분" rows={data.etf?.asset_allocation} limit={breakdownLimit} />
          <EtfBreakdownStrip title="섹터 비중" rows={data.etf?.sectors} limit={breakdownLimit} />
          <EtfBreakdownStrip title="국가 비중" rows={data.etf?.countries} limit={breakdownLimit} />
        </div>
      ) : null}

      {topHoldings.length > 0 ? (
        <div className="mt-3 min-w-0">
          <div className="mb-1.5 flex min-w-0 flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">ETF 상위 보유 종목</p>
            <span className="text-[10px] font-bold text-[var(--c-ink-3)]">
              {data.etf?.holdings_updated ?? "—"} · {data.etf?.holdings_count ?? topHoldings.length}개
            </span>
          </div>
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[360px] text-[11px]">
              <thead>
                <tr className="border-b border-[var(--c-line)] font-black uppercase tracking-[0.06em] text-[var(--c-ink-3)]">
                  <th className="px-2 py-1.5 text-left">보유 항목</th>
                  <th className="px-2 py-1.5 text-right">비중</th>
                  <th className="px-2 py-1.5 text-right">수량</th>
                </tr>
              </thead>
              <tbody>
                {topHoldings.map((row, index) => (
                  <tr key={`${row.rank ?? index}-${row.name ?? "holding"}`} className="border-b border-[var(--c-line-2)] last:border-b-0">
                    <td className="px-2 py-1.5 min-w-0">
                      {row.symbol ? (
                        <span className="text-xs font-black text-[var(--c-ink)]">{row.symbol}</span>
                      ) : null}
                      {row.name ? (
                        <span className="block max-w-[14rem] truncate text-[11px] font-semibold text-[var(--c-ink-3)]" title={row.name}>
                          {row.name}
                        </span>
                      ) : (
                        <span className="text-[11px] text-[var(--c-ink-3)]">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right font-black tabular-nums text-[var(--c-ink)]">
                      {formatPlainPercent(row.weight_pct, { digits: 2, fraction: false })}
                    </td>
                    <td className="px-2 py-1.5 text-right font-bold tabular-nums text-[var(--c-ink-3)]">
                      {formatInteger(row.shares)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {availableSources.map((source) => (
          <span key={source} className="rounded-full border border-[var(--c-line)] bg-[var(--c-surface-2)] px-2 py-0.5 text-[10px] font-black text-[var(--c-ink-3)]">
            {sourceLabel(source)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Sparkline({
  data,
  color,
  years = [],
  estimate,
  estimates,
  formatValue = (value) => value.toFixed(1),
}: {
  data: NumberSeries;
  color: string;
  years?: string[];
  estimate?: MaybeNumber;
  estimates?: EstimateSeries;
  formatValue?: (value: number) => string;
}) {
  const { labels, points } = buildFiscalPoints(years, data, estimates ?? estimate);
  const estimateCompleteness = estimates ? estimateCompletenessFromSeries(estimates) : null;
  const actualPoints = points.filter((point) => !point.estimate);
  const estimatePoints = points.filter((point) => point.estimate);
  const firstEstimatePoint = estimatePoints[0] ?? null;
  if (points.length < 2 || labels.length < 2) return <span className="text-xs text-[var(--c-ink-3)]">—</span>;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = CHART_WIDTH;
  const height = 96;
  const padL = CHART_PAD_L;
  const padR = CHART_PAD_R;
  const padT = 10;
  const padB = 22;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const xDenominator = Math.max(labels.length - 1, 1);
  const toX = (index: number) => padL + (index / xDenominator) * plotW;
  const toY = (value: number) => padT + plotH - ((value - min) / range) * plotH;

  const actualLine = actualPoints.map((point) => `${toX(point.index)},${toY(point.value)}`).join(" ");
  const currentPoint = actualPoints[actualPoints.length - 1] ?? null;
  const labelPoints = [currentPoint, estimatePoints[estimatePoints.length - 1] ?? firstEstimatePoint].filter(Boolean) as FiscalPoint[];
  const valueLabelPlacement = (point: FiscalPoint) => {
    const x = toX(point.index);
    const y = toY(point.value);
    return chartValueLabelPlacement({
      x,
      y,
      rightBoundary: width - padR,
      topBoundary: padT,
      defaultXOffset: 6,
      defaultAnchor: "start",
    });
  };

  const chart = (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="block w-full max-w-full overflow-visible" role="img" aria-label="FY별 추이 차트">
      <polyline points={actualLine} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {firstEstimatePoint && currentPoint ? (
        <line
          x1={toX(currentPoint.index)}
          y1={toY(currentPoint.value)}
          x2={toX(firstEstimatePoint.index)}
          y2={toY(firstEstimatePoint.value)}
          stroke={color}
          strokeWidth={2}
          strokeDasharray="4,2"
        />
      ) : null}
      {estimatePoints.length > 1 ? (
        <polyline
          points={estimatePoints.map((point) => `${toX(point.index)},${toY(point.value)}`).join(" ")}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeDasharray="4,2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {points.map((point) => {
        const x = toX(point.index);
        const y = toY(point.value);
        return (
          <circle
            key={`${point.label}-${point.index}`}
            cx={x}
            cy={y}
            r={point.estimate ? 3.5 : 3}
            fill={point.estimate ? "var(--c-panel)" : color}
            stroke={color}
            strokeWidth={point.estimate ? 2 : 1}
          >
            <title>{`${point.label} ${formatValue(point.value)}`}</title>
          </circle>
        );
      })}
      {labelPoints.map((point) => {
        const placement = valueLabelPlacement(point);
        return (
          <text
            key={`label-${point.label}`}
            x={placement.x}
            y={placement.y}
            textAnchor={placement.anchor}
            className="text-[8px] font-black fill-[var(--c-ink-3)]"
            paintOrder="stroke"
            stroke="var(--c-panel)"
            strokeWidth={3}
            strokeLinejoin="round"
          >
            {formatValue(point.value)}
          </text>
        );
      })}
      {labels.map((label, index) => (
        <text key={label} x={toX(index)} y={height - 3} textAnchor="middle" className="text-[8px] font-black fill-[var(--c-ink-3)]">
          {label}
        </text>
      ))}
    </svg>
  );

  return renderChartWithEstimateGap(chart, estimateCompleteness);
}

export function PerBandChart({
  years,
  per,
  perBands,
  estimates,
}: {
  years: string[];
  per: NumberSeries;
  perBands?: DetailData["per_bands"];
  estimates?: EstimateSeries;
}) {
  const { labels: periodLabels, points: allPerPoints } = buildFiscalPoints(years, per, estimates);
  const estimateCompleteness = estimates ? estimateCompletenessFromSeries(estimates) : null;
  const perPoints = allPerPoints.filter((point) => !point.estimate);
  const forwardPoints = allPerPoints.filter((point) => point.estimate);
  const forwardPoint = forwardPoints[0] ?? null;
  if (perPoints.length < 2) return <span className="text-xs text-[var(--c-ink-3)]">—</span>;

  const allValues = allPerPoints.map((point) => point.value);

  const bands = validPerBands(perBands) ? perBands : null;
  let yMin = Math.min(...allValues);
  let yMax = Math.max(...allValues);
  if (bands) {
    yMin = Math.min(yMin, bands.min_8y);
    yMax = Math.max(yMax, bands.max_8y);
  }
  const yPad = (yMax - yMin) * 0.1 || 1;
  yMin -= yPad;
  yMax += yPad;

  const w = CHART_WIDTH;
  const h = 132;
  const padL = CHART_PAD_L;
  const padR = CHART_PAD_R;
  const padT = 12;
  const padB = 30;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const xDenominator = Math.max(periodLabels.length - 1, 1);

  const toX = (i: number) => padL + (i / xDenominator) * plotW;
  const toY = (v: number) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const points = perPoints.map(({ value, index }) => `${toX(index)},${toY(value)}`).join(" ");

  const currentPoint = perPoints[perPoints.length - 1];
  const currentX = toX(currentPoint.index);
  const currentY = toY(currentPoint.value);
  const currentPct = bands ? bandPct(bands.current, bands.min_8y, bands.max_8y) : 0.5;
  const currentCls = bandClass(currentPct);
  const currentColor =
    currentCls === "emerald" ? "var(--c-up)" : currentCls === "rose" ? "var(--c-down)" : "var(--c-ink-3)";

  const hasForward = Boolean(forwardPoint);
  const forwardX = forwardPoint ? toX(forwardPoint.index) : 0;
  const forwardY = forwardPoint ? toY(forwardPoint.value) : 0;
  const valueLabelPoints = [
    currentPoint,
    forwardPoints[forwardPoints.length - 1] ?? forwardPoint,
  ].filter(Boolean) as FiscalPoint[];
  const perValueLabelPlacement = (point: FiscalPoint) => {
    const x = toX(point.index);
    const y = toY(point.value);
    return chartValueLabelPlacement({
      x,
      y,
      rightBoundary: w - padR,
      topBoundary: padT,
      defaultXOffset: 0,
      defaultAnchor: "middle",
    });
  };

  const chart = (
    <div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} className="block w-full max-w-full overflow-visible" role="img" aria-label="FY별 PER 밴드 차트">
        {/* Shaded band */}
        {bands && (
          <>
            <rect
              x={padL}
              y={toY(bands.max_8y)}
              width={plotW}
              height={toY(bands.min_8y) - toY(bands.max_8y)}
              fill="var(--c-surface-2)"
            />
            <rect
              x={padL}
              y={toY(bands.max_8y)}
              width={plotW}
              height={toY(bands.avg_8y) - toY(bands.max_8y)}
              fill="var(--c-down-soft)"
            />
            <rect
              x={padL}
              y={toY(bands.avg_8y)}
              width={plotW}
              height={toY(bands.min_8y) - toY(bands.avg_8y)}
              fill="var(--c-up-soft)"
            />
          </>
        )}

        {/* Avg dashed line + label */}
        {bands && (
          <>
            <line
              x1={padL}
              y1={toY(bands.avg_8y)}
              x2={padL + plotW}
              y2={toY(bands.avg_8y)}
              stroke="var(--c-ink-3)"
              strokeWidth={1}
              strokeDasharray="4,2"
            />
            <text
              x={padL + 4}
              y={Math.max(9, toY(bands.avg_8y) - 5)}
              textAnchor="start"
              className="text-[8px] font-black fill-[var(--c-ink-3)]"
              paintOrder="stroke"
              stroke="var(--c-panel)"
              strokeWidth={3}
              strokeLinejoin="round"
            >
              avg
            </text>
          </>
        )}

        {/* Grid lines */}
        {[0, 0.5, 1].map((t) => {
          const y = padT + t * plotH;
          return (
            <line
              key={t}
              x1={padL}
              y1={y}
              x2={padL + plotW}
              y2={y}
              stroke="var(--c-line)"
              strokeWidth={1}
              strokeDasharray={t === 0.5 ? undefined : "2,2"}
            />
          );
        })}

        {/* PER line */}
        <polyline
          points={points}
          fill="none"
          stroke="var(--brand-interactive)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Forward extension */}
        {hasForward && (
          <>
            <line
              x1={currentX}
              y1={currentY}
              x2={forwardX}
              y2={forwardY}
              stroke="var(--brand-interactive)"
              strokeWidth={2}
              strokeDasharray="4,2"
            />
            {forwardPoints.length > 1 ? (
              <polyline
                points={forwardPoints.map((point) => `${toX(point.index)},${toY(point.value)}`).join(" ")}
                fill="none"
                stroke="var(--brand-interactive)"
                strokeWidth={2}
                strokeDasharray="4,2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
          </>
        )}

        {/* Data points */}
        {allPerPoints.map((point) => {
          const x = toX(point.index);
          const y = toY(point.value);
          const isCurrent = !point.estimate && point.index === currentPoint.index;
          return (
            <g key={`${point.label}-${point.index}`}>
              <circle
                cx={x}
                cy={y}
                r={isCurrent ? 5 : point.estimate ? 3.5 : 3}
                fill={point.estimate ? "var(--c-panel)" : isCurrent ? currentColor : "var(--brand-interactive)"}
                stroke={point.estimate ? "var(--brand-interactive)" : "var(--c-panel)"}
                strokeWidth={2}
              >
                <title>{`${point.label} PER ${point.value.toFixed(1)}x`}</title>
              </circle>
            </g>
          );
        })}
        {valueLabelPoints.map((point) => {
          const placement = perValueLabelPlacement(point);
          return (
            <text
              key={`per-label-${point.label}`}
              x={placement.x}
              y={placement.y}
              textAnchor={placement.anchor}
              className="text-[9px] font-black fill-[var(--c-ink-2)]"
              paintOrder="stroke"
              stroke="var(--c-panel)"
              strokeWidth={3}
              strokeLinejoin="round"
            >
              {point.value.toFixed(1)}
            </text>
          );
        })}

        {/* X-axis labels */}
        {periodLabels.map((label, index) => (
          <text key={label} x={toX(index)} y={h - 8} textAnchor="middle" className="text-[9px] font-black fill-[var(--c-ink-3)]">
            {label}
          </text>
        ))}

        {/* Y-axis labels */}
        {bands && (
          <>
            <text
              x={padL - 4}
              y={toY(bands.max_8y) + 3}
              textAnchor="end"
              className="text-[8px] font-black fill-[var(--c-ink-3)] tabular-nums"
            >
              {bands.max_8y.toFixed(0)}
            </text>
            <text
              x={padL - 4}
              y={toY(bands.avg_8y) + 3}
              textAnchor="end"
              className="text-[8px] font-black fill-[var(--c-ink-3)] tabular-nums"
            >
              {bands.avg_8y.toFixed(1)}
            </text>
            <text
              x={padL - 4}
              y={toY(bands.min_8y) + 3}
              textAnchor="end"
              className="text-[8px] font-black fill-[var(--c-ink-3)] tabular-nums"
            >
              {bands.min_8y.toFixed(0)}
            </text>
          </>
        )}
      </svg>
    </div>
  );

  return renderChartWithEstimateGap(chart, estimateCompleteness);
}

export function fmtLarge(n: MaybeNumber): string {
  if (!isFiniteNumber(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}T`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)}B`;
  return `${sign}${abs}M`;
}

export function RevisionPulse({ detail, compact = false }: { detail: DetailData; compact?: boolean }) {
  const weekly = detail.eps_consensus?.weekly;
  const changes = detail.eps_consensus?.weekly_change;
  const epsRows = [
    { key: "fy1", label: `${FISCAL_PERIOD_LABELS[0]} EPS`, series: weekly?.fy_plus_1 ?? [], change: changes?.fy_plus_1 },
    { key: "fy2", label: `${FISCAL_PERIOD_LABELS[1]} EPS`, series: weekly?.fy_plus_2 ?? [], change: changes?.fy_plus_2 },
    { key: "fy3", label: `${FISCAL_PERIOD_LABELS[2]} EPS`, series: weekly?.fy_plus_3 ?? [], change: changes?.fy_plus_3 },
  ].filter((row) => row.series.length > 0);
  const historyRows = (detail.weekly_revision_history?.weekly_consensus_revision ?? [])
    .filter((row) => typeof row.date === "string")
    .slice(0, compact ? 2 : 4);

  if (epsRows.length === 0 && historyRows.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)]/95 p-3">
      <div className="mb-2 flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">추정치 변화·시장 예상</h4>
        <span className="text-[10px] font-bold text-[var(--c-ink-3)]">EPS 주간 예상</span>
      </div>
      {epsRows.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-3">
          {epsRows.map((row) => {
            const latest = row.series[0];
            const previous = row.series[1];
            return (
              <div key={row.key} className="min-w-0 rounded-lg border border-[var(--c-line-2)] bg-[var(--c-surface-2)] px-3 py-2">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[10px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">{row.label}</span>
                  <span className={`shrink-0 text-[10px] font-black tabular-nums ${toneText(row.change)}`}>
                    {fmtSignedFractionPercent(row.change)}
                  </span>
                </div>
                <p className="mt-1 text-sm font-black tabular-nums text-[var(--c-ink)]">{fmtEps(latest?.value)}</p>
                <p className="mt-1 truncate text-[9px] font-bold tabular-nums text-[var(--c-ink-3)]">
                  {latest?.date ?? "—"} · 전주 {fmtEps(previous?.value)}
                </p>
              </div>
            );
          })}
        </div>
      ) : null}
      {historyRows.length > 0 ? (
        <div className="-mx-1 mt-3 overflow-x-auto px-1">
          <table className="w-full min-w-[520px] text-[10px]">
            <thead>
              <tr className="border-b border-[var(--c-line)] font-black uppercase tracking-[0.06em] text-[var(--c-ink-3)]">
                <th className="sticky left-0 z-10 bg-[var(--c-panel)] px-2 py-1 text-left">일자</th>
                <th className="px-2 py-1 text-right">가격</th>
                <th className="px-2 py-1 text-right">매출 컨센</th>
                <th className="px-2 py-1 text-right">EPS 컨센</th>
                <th className="px-2 py-1 text-right">EPS 변화</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.map((row, index) => (
                <tr key={`${row.date}-${index}`} className="border-b border-[var(--c-line-2)] last:border-b-0">
                  <td className="sticky left-0 z-10 bg-[var(--c-panel)] px-2 py-1.5 font-bold tabular-nums text-[var(--c-ink-2)]">{row.date}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-[var(--c-ink-2)]">{fmtPlainNumber(row.price, 2)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-[var(--c-ink-2)]">{fmtLarge(row.revenue_consensus)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-[var(--c-ink-2)]">{fmtEps(row.eps_consensus)}</td>
                  <td className={`px-2 py-1.5 text-right  font-black tabular-nums ${toneText(row.eps_change)}`}>
                    {fmtSignedNumber(row.eps_change, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function RawFinancialDepth({ detail, compact = false }: { detail: DetailData; compact?: boolean }) {
  const raw = detail.raw_financials;
  const periods = raw?.periods ?? detail.raw_periods ?? [];
  const rows: Array<{ label: string; data?: NumberSeries; fmt: (value: MaybeNumber) => string }> = [
    { label: "매출", data: raw?.income_statement?.revenue, fmt: fmtLarge },
    { label: "영업이익", data: raw?.income_statement?.operating_income, fmt: fmtLarge },
    { label: "순이익", data: raw?.income_statement?.net_income, fmt: fmtLarge },
    { label: "EPS", data: raw?.per_share?.eps, fmt: fmtEps },
    { label: "매출 성장", data: raw?.growth?.revenue_growth, fmt: fmtSignedPercentPoints },
    { label: "PER", data: raw?.valuation?.per, fmt: (value) => fmtPlainNumber(value, 1) },
    { label: "PBR", data: raw?.valuation?.pbr, fmt: (value) => fmtPlainNumber(value, 2) },
    { label: "ROE", data: raw?.profitability?.roe, fmt: fmtSignedPercentPoints },
    { label: "영업마진", data: raw?.profitability?.operating_margin, fmt: fmtSignedPercentPoints },
  ];
  const validRows = rows
    .filter((row) => finiteValues(row.data).length > 0)
    .slice(0, compact ? 6 : rows.length);

  if (periods.length === 0 || validRows.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)]/95 p-3">
      <div className="mb-2 flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">실적·예상치 상세</h4>
        <span className="text-[10px] font-bold text-[var(--c-ink-3)]">과거 4년~3년차(FY+3) 표준화 데이터</span>
      </div>
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[720px] text-[10px]">
          <thead>
            <tr className="border-b border-[var(--c-line)] font-black uppercase tracking-[0.06em] text-[var(--c-ink-3)]">
              <th className="sticky left-0 z-10 bg-[var(--c-panel)] px-2 py-1.5 text-left">항목</th>
              {periods.map((period) => (
                <th key={period} className="px-2 py-1.5 text-right">{period}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {validRows.map((row) => (
              <tr key={row.label} className="border-b border-[var(--c-line-2)] last:border-b-0">
                <td className="sticky left-0 z-10 bg-[var(--c-panel)] px-2 py-1.5 font-black text-[var(--c-ink-2)]">{row.label}</td>
                {periods.map((period, index) => {
                  const value = row.data?.[index];
                  return (
                    <td key={`${row.label}-${period}`} className="px-2 py-1.5 text-right tabular-nums text-[var(--c-ink)]">
                      {row.fmt(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function hasSlickMetricValue(point: SlickMetricPoint | null | undefined) {
  return Boolean(
    point &&
      (isFiniteNumber(point.price) ||
        isFiniteNumber(point.pe_trailing) ||
        isFiniteNumber(point.pe_forward) ||
        isFiniteNumber(point.eps_forward) ||
        isFiniteNumber(point.dividend_yield) ||
        isFiniteNumber(point.market_cap_billions)),
  );
}

function slickMetricRows(data: SlickStockData): SlickMetricPoint[] {
  const rows = [data.current, ...(data.metrics_history ?? [])].filter(hasSlickMetricValue) as SlickMetricPoint[];
  const seen = new Set<string>();
  return rows.filter((row, index) => {
    const key = row.date ?? `row-${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fmtSlickMoney(value: MaybeNumber, digits = 2) {
  return formatCurrency(value, "USD", { digits });
}

function fmtSlickMarketCap(value: MaybeNumber) {
  if (!isFiniteNumber(value)) return "—";
  return formatCurrencyCompact(value * 1_000_000_000, "USD");
}

function fmtSlickMultiple(value: MaybeNumber) {
  return formatMultiple(value, { digits: 1 });
}

function fmtSlickYield(value: MaybeNumber) {
  return formatPlainPercent(value, { digits: 2, fraction: false });
}

function fmtSlickReturn(value: MaybeNumber) {
  return formatSignedPercent(value, { digits: 1, fraction: false });
}

function fmtRelativeDelta(current: MaybeNumber, previous: MaybeNumber) {
  if (!isFiniteNumber(current) || !isFiniteNumber(previous) || previous === 0) return null;
  const delta = ((current - previous) / Math.abs(previous)) * 100;
  return fmtSlickReturn(delta);
}

function SlickMetricCard({ label, value, delta }: { label: string; value: string; delta?: string | null }) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--c-line-2)] bg-[var(--c-surface-2)] px-3 py-2">
      <p className="min-w-0 truncate text-[11px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">{label}</p>
      <p className="mt-1 min-w-0 break-words text-base font-black tabular-nums text-[var(--c-ink)]">{value}</p>
      <p className="mt-1 min-h-[16px] text-[11px] font-bold tabular-nums text-[var(--c-ink-3)]">{delta ? `직전 ${delta}` : ""}</p>
    </div>
  );
}

export function PriceDividendHistoryDepth({
  ticker,
  compact = false,
  showUnavailable = false,
}: {
  ticker: string;
  compact?: boolean;
  showUnavailable?: boolean;
}) {
  const { data, loading } = useSlickStock(ticker);

  if (loading) {
    return (
      <DataStateNotice
        state={makeDataState({
          status: "pending",
          detail: "가격·배당 히스토리를 확인하고 있습니다.",
        })}
        className="mt-4"
      />
    );
  }

  if (!data) {
    return showUnavailable ? (
      <div className="mt-4 rounded-xl border border-dashed border-[var(--c-line)] bg-[var(--c-surface-2)] p-3 text-sm font-semibold text-[var(--c-ink-3)]">
        가격·배당 히스토리가 아직 수집되지 않은 티커입니다.
      </div>
    ) : null;
  }

  const metrics = slickMetricRows(data);
  const latestMetric = metrics[0] ?? null;
  const previousMetric = metrics[1] ?? null;
  const returnRows = [...(data.returns ?? [])]
    .filter((row) => isFiniteNumber(row.year) && isFiniteNumber(row.return))
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    .slice(0, compact ? 5 : 8);
  const dividendRows = [...(data.dividends ?? [])]
    .filter((row) => isFiniteNumber(row.amount) || row.exDate || row.payDate)
    .sort((a, b) => (b.exDate ?? "").localeCompare(a.exDate ?? ""))
    .slice(0, compact ? 3 : 5);
  const metricCards = latestMetric
    ? [
        {
          label: "가격",
          value: fmtSlickMoney(latestMetric.price),
          delta: fmtRelativeDelta(latestMetric.price, previousMetric?.price),
        },
        {
          label: "시총",
          value: fmtSlickMarketCap(latestMetric.market_cap_billions),
          delta: fmtRelativeDelta(latestMetric.market_cap_billions, previousMetric?.market_cap_billions),
        },
        {
          label: "PER TTM",
          value: fmtSlickMultiple(latestMetric.pe_trailing),
          delta: fmtRelativeDelta(latestMetric.pe_trailing, previousMetric?.pe_trailing),
        },
        {
          label: "PER FWD",
          value: fmtSlickMultiple(latestMetric.pe_forward),
          delta: fmtRelativeDelta(latestMetric.pe_forward, previousMetric?.pe_forward),
        },
        {
          label: "EPS FWD",
          value: fmtSlickMoney(latestMetric.eps_forward),
          delta: fmtRelativeDelta(latestMetric.eps_forward, previousMetric?.eps_forward),
        },
        {
          label: "배당률",
          value: fmtSlickYield(latestMetric.dividend_yield),
          delta: previousMetric && isFiniteNumber(latestMetric.dividend_yield) && isFiniteNumber(previousMetric.dividend_yield)
            ? `${formatSignedPercent(latestMetric.dividend_yield - previousMetric.dividend_yield, { digits: 2, fraction: false })}p`
            : null,
        },
      ]
    : [];

  if (metricCards.length === 0 && returnRows.length === 0 && dividendRows.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)]/95 p-3">
      <div className="mb-3 flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[12px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">가격·배당 히스토리</h4>
        <span className="min-w-0 truncate text-[11px] font-bold text-[var(--c-ink-3)]">
          {latestMetric?.date ?? data.updated?.slice(0, 10) ?? "—"} · 수집 데이터 기준
        </span>
      </div>

      {metricCards.length > 0 ? (
        <div className="grid min-w-0 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {metricCards.map((card) => (
            <SlickMetricCard key={card.label} {...card} />
          ))}
        </div>
      ) : null}

      <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-2">
        {returnRows.length > 0 ? (
          <div className="min-w-0">
            <p className="mb-1.5 text-[11px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">연도별 수익률</p>
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[240px] text-[11px]">
                <thead>
                  <tr className="border-b border-[var(--c-line)] font-black uppercase tracking-[0.06em] text-[var(--c-ink-3)]">
                    <th className="px-2 py-1.5 text-left">연도</th>
                    <th className="px-2 py-1.5 text-right">수익률</th>
                  </tr>
                </thead>
                <tbody>
                  {returnRows.map((row) => (
                    <tr key={row.year} className="border-b border-[var(--c-line-2)] last:border-b-0">
                      <td className="px-2 py-1.5 font-bold tabular-nums text-[var(--c-ink-2)]">{row.year}</td>
                      <td className={`px-2 py-1.5 text-right  font-black tabular-nums ${toneText(row.return)}`}>
                        {fmtSlickReturn(row.return)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {dividendRows.length > 0 ? (
          <div className="min-w-0">
            <p className="mb-1.5 text-[11px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">배당 이력</p>
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[320px] text-[11px]">
                <thead>
                  <tr className="border-b border-[var(--c-line)] font-black uppercase tracking-[0.06em] text-[var(--c-ink-3)]">
                    <th className="px-2 py-1.5 text-left">락일</th>
                    <th className="px-2 py-1.5 text-right">배당</th>
                    <th className="px-2 py-1.5 text-right">지급일</th>
                  </tr>
                </thead>
                <tbody>
                  {dividendRows.map((row, index) => (
                    <tr key={`${row.exDate ?? "ex"}-${index}`} className="border-b border-[var(--c-line-2)] last:border-b-0">
                      <td className="px-2 py-1.5 font-bold tabular-nums text-[var(--c-ink-2)]">{row.exDate ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right font-black tabular-nums text-[var(--c-ink)]">
                        {fmtSlickMoney(row.amount, 3)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-bold tabular-nums text-[var(--c-ink-3)]">{row.payDate ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ScreenerThreeSecondVerdictCard({ verdict }: { verdict: ScreenerThreeSecondVerdict }) {
  return (
    <div className="mb-4 rounded-2xl border border-[color:color-mix(in_srgb,var(--brand-interactive)_20%,transparent)] bg-[color:color-mix(in_srgb,var(--brand-interactive)_3.5%,transparent)] p-3.5 shadow-[var(--sh-sm)]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.15em] text-[var(--brand-interactive)]">3초 판정</p>
          <p className="mt-0.5 text-[10px] font-bold text-[var(--c-ink-3)]">스크리너 상세 데이터를 핵심 신호로 압축</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-black leading-none ${verdict.badgeClass}`}>
          {verdict.badge}
        </span>
      </div>
      <p className="text-[13px] font-bold leading-6 text-[var(--c-ink)]">{verdict.text}</p>
      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[color:color-mix(in_srgb,var(--brand-interactive)_10%,transparent)] pt-2.5">
        {verdict.signals.map((signal) => (
          <span key={signal.id} className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black ${readToneClass(signal.tone)}`}>
            <span>{signal.label}</span>
            <span className="min-w-0 truncate opacity-80">{signal.shortText}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function StockDetailBody({
  detail,
  f13Entries,
  ticker,
  stock,
  f13Error,
  f13Retry,
}: {
  detail: DetailData;
  f13Entries: F13Entry[] | null;
  ticker?: string;
  stock?: ScreenerStock;
  f13Error?: LoaderError | null;
  f13Retry?: () => void;
}) {
  const revenue = detail.income_statement?.revenue ?? [];
  const eps = detail.per_share?.eps ?? [];
  const per = detail.valuation?.per ?? [];
  const hasRevenue = finiteValues(revenue).length >= 2;
  const hasEps = finiteValues(eps).length >= 2;
  const hasPer = finiteValues(per).length >= 2;
  const latestRevenue = lastFinite(revenue);
  const latestEps = lastFinite(eps);

  const interpretation = stock ? interpretStockMetrics(stock, detail) : null;
  const interpretationReads = Array.isArray(interpretation?.reads) ? interpretation.reads : [];
  const threeSecondVerdict = buildScreenerThreeSecondVerdict({
    stock,
    detail,
    f13Count: f13Entries?.length ?? 0,
    interpretation,
  });

  return (
    <>
      {threeSecondVerdict ? <ScreenerThreeSecondVerdictCard verdict={threeSecondVerdict} /> : null}
      {interpretation ? (
        <div className="mb-4 rounded-2xl border border-[var(--c-line)] bg-[var(--c-panel)] p-3.5 shadow-[var(--sh-sm)]">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <span className="text-[11px] font-black uppercase tracking-[0.15em] text-[var(--c-ink-3)]">
              Fenok 자동 해석
            </span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black leading-none ${interpretation.badgeClass}`}>
              {interpretation.badge}
            </span>
          </div>
          <p className="text-xs font-semibold leading-relaxed text-[var(--c-ink-2)]">
            {interpretation.text}
          </p>
          {interpretationReads.length > 0 ? (
            <ul className="mt-3 space-y-1.5 border-t border-[var(--c-line-2)] pt-2">
              {interpretationReads.map((read) => (
                <li key={read.id} className="flex min-w-0 flex-wrap items-start gap-2 text-[11px] leading-relaxed">
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 font-black ${readToneClass(read.tone)}`}>
                    {read.label}
                  </span>
                  <span className="min-w-0 flex-1 font-semibold text-[var(--c-ink-2)]">{read.text}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {ticker ? <MarketFactsDepth ticker={ticker} compact /> : null}
      <div className="grid gap-5 sm:grid-cols-3">
        {/* PER Band Chart */}
        <div>
          <h4 className="mb-2 text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">
            PER 밴드
          </h4>
          {hasPer ? (
            <PerBandChart
              years={detail.years}
              per={per}
              perBands={detail.per_bands}
              estimates={detail.valuation_estimates?.per}
            />
          ) : (
            <span className="text-xs text-[var(--c-ink-3)]">—</span>
          )}
        </div>

        {/* Revenue Sparkline */}
        <div>
          <h4 className="mb-2 text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">
            매출 추이
          </h4>
          {hasRevenue ? (
            <>
              <Sparkline
                data={revenue}
                color="var(--c-up)"
                years={detail.years}
                estimates={detail.income_statement_estimates?.revenue}
                formatValue={fmtLarge}
              />
              <div className="tabular-nums mt-1 text-[10px] font-bold text-[var(--c-ink-3)]">
                {fmtLarge(latestRevenue)}
                {" (최신)"}
              </div>
            </>
          ) : (
            <span className="text-xs text-[var(--c-ink-3)]">—</span>
          )}
        </div>

        {/* EPS Sparkline */}
        <div>
          <h4 className="mb-2 text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">
            EPS 추이
          </h4>
          {hasEps ? (
            <>
              <Sparkline
                data={eps}
                color="var(--c-chart-eps)"
                years={detail.years}
                estimates={detail.per_share_estimates?.eps}
                formatValue={(value) => formatCurrency(value, "USD", { digits: 2 })}
              />
              <div className="tabular-nums mt-1 text-[10px] font-bold text-[var(--c-ink-3)]">
                {latestEps != null ? `${fmtEps(latestEps)} (최신)` : "—"}
              </div>
            </>
          ) : (
            <span className="text-xs text-[var(--c-ink-3)]">—</span>
          )}
        </div>
      </div>

      {ticker ? <PriceDividendHistoryDepth ticker={ticker} compact /> : null}
      <RevisionPulse detail={detail} compact />
      <RawFinancialDepth detail={detail} compact />

      {/* 13F Badges */}
      {f13Entries && f13Entries.length > 0 ? (
        <div className="mt-4">
          <h4 className="mb-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">
            기관 공시 보유
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {f13Entries.map((e) => (
              <span
                key={e.investor}
                className="inline-flex items-center rounded-full bg-[var(--c-warn-soft)] px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-[var(--c-warn)]"
              >
                {e.investor}
              </span>
            ))}
          </div>
        </div>
      ) : f13Error ? (
        <div className="mt-4">
          <h4 className="mb-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">
            기관 공시 보유
          </h4>
          <DataStateNotice
            state={makeDataState({
              status: "unavailable",
              detail: "기관 공시 보유 데이터를 불러오지 못했습니다. 다시 시도해 주세요.",
            })}
            actionLabel="지금 재시도"
            onAction={f13Retry}
          />
        </div>
      ) : null}
    </>
	  );
	}

function w4FormatPrice(value: MaybeNumber): string {
  return formatCurrency(value, "USD", { digits: 2 });
}

function w4FormatMarketCap(mn: MaybeNumber): string {
  if (!isFiniteNumber(mn)) return "—";
  return formatCurrencyCompact(mn * 1_000_000, "USD");
}

function w4FormatRatio(value: MaybeNumber, digits = 1): string {
  return formatDecimal(value, { digits });
}

function w4FormatFractionPercent(value: MaybeNumber, digits = 2): string {
  return formatPlainPercent(value, { digits });
}

function w4FormatSignedFractionPercent(value: MaybeNumber, digits = 1): string {
  return formatSignedPercent(value, { digits });
}

function w4Initials(ticker: string): string {
  return ticker.trim().slice(0, 2).toUpperCase() || "ST";
}

export default function StockDetailPanel({
  ticker,
  stock,
  canvasPlusPreview = false,
  returnTo,
  onBeforeNavigate,
}: {
  ticker: string;
  stock?: ScreenerStock;
  canvasPlusPreview?: boolean;
  returnTo?: string | null;
  onBeforeNavigate?: () => void;
}) {
  const { detail, loading, error: detailError, retry: retryDetail } = useStockDetail(ticker);
  const { entries: f13Entries, error: f13Error, retry: retryF13 } = use13FData(ticker);

  if (loading) {
    return (
      <DataStateNotice
        state={makeDataState({
          status: "pending",
          detail: "종목 상세 지표를 읽고 있습니다.",
        })}
        className="col-span-full border-t border-[var(--c-line-2)]"
      />
    );
  }

  if (!detail) {
    if (detailError) {
      return (
        <DataStateNotice
          state={makeDataState({
            status: "unavailable",
            detail: loaderErrorDetail(detailError, "이 종목의 상세 재무·추정치 데이터"),
          })}
          actionLabel="지금 재시도"
          onAction={retryDetail}
          className="col-span-full border-t border-[var(--c-line-2)]"
        />
      );
    }
    return (
      <DataStateNotice
        state={makeDataState({
          status: "unavailable",
          detail: "이 종목의 상세 재무·추정치 데이터를 아직 찾지 못했습니다.",
        })}
        className="col-span-full border-t border-[var(--c-line-2)]"
      />
    );
  }

  // fenokShortTermCommonBasisScore is a composition disclosure, not the score —
  // the data contract says so. Reading it as the headline made this panel and
  // the stock page disagree with every other surface (NVDA 53 against 61).
  const shortTerm = stock ? commonBasisShortTermView(stock) : null;
  const shortTermConvictionScore = isFiniteNumber(stock?.fenokShortTermConvictionScore)
    ? Math.round(stock.fenokShortTermConvictionScore)
    : null;
  const longTermConvictionScore = isFiniteNumber(stock?.fenokLongTermConvictionScore)
    ? Math.round(stock.fenokLongTermConvictionScore)
    : null;
  const shortTermAxes = stock ? buildDetailShortTermAxes(stock) : [];
  const longTermAxes = stock ? buildDetailLongTermAxes(stock) : [];
  const hasShortTermSignal = shortTermAxes.some((axis) => axis.score !== null);
  const hasLongTermSignal = longTermAxes.some((axis) => axis.score !== null);
  // The integrated "Fenok Edge" single score (fenokEdgeScore / direction) is
  // retired (owner mandate 2026-08-03): the panel shows the two axes — Short
  // Edge (단기) and Long Edge (장기) — as the substance.
  const edgeLead = edgeLeadLabel();
  const longDirectionalCount = longTermAxes.filter(
    (axis) => axis.key !== "marketSimilarity" && axis.score !== null,
  ).length;
  const signalCoverage = formatSignalCoverage(stock?.fenokSignalCoverageRatio);
  const shortTermBasis = shortTermCommonBasisCopy(stock?.fenokMarketScope, {
    sourceInputCount: shortTerm?.sourceInputCount ?? null,
    basisCode: shortTerm?.basisCode ?? null,
  });

  if (!canvasPlusPreview) {
  const toSharedRows = (axes: DetailLongTermAxis[]): SharedEdgeAxisRow[] =>
    axes.map((axis) => ({ key: axis.key, label: axis.fullLabel, score: axis.score, referenceOnly: axis.referenceOnly }));
  return (
    <div className="col-span-full border-t border-[var(--c-line-2)] bg-[var(--c-surface-2)]/50 px-2 py-3 sm:p-4">
      {stock && (hasShortTermSignal || hasLongTermSignal) ? (
        <div className="mb-4">
          <SharedEdgePanel
            title={edgeLead}
            shortScore={shortTermConvictionScore}
            longScore={longTermConvictionScore}
            shortRows={toSharedRows(shortTermAxes)}
            longRows={toSharedRows(longTermAxes)}
            shortTitle={`단기 축 · ${shortTermBasis.label} · ${shortTermBasis.windowLabel} · ${shortTermBasis.sourceInputCount ?? "—"}/3–5 입력`}
            longTitle={`장기 축 · 5개 방향성 축 ${longDirectionalCount}/5 · 동종군 유사도 참고축`}
            summary={`${shortTermBasis.exclusionNote} ${shortTermBasis.comparisonNote} Fenok 파생 신호 · 투자 조언이 아닙니다`.trim()}
            source="FENOK 신호"
            asOf={stock.fenokSignalAsOf ? stock.fenokSignalAsOf.slice(0, 10) : "—"}
            coverage={signalCoverage}
          />
        </div>
      ) : null}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">
          종목 상세
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <TransitionLink
            href={ROUTES.portfolioTicker(ticker)}
            className="inline-flex min-h-8 items-center rounded-full border border-[var(--c-line)] bg-[var(--c-panel)] px-3 text-[10px] font-black text-[var(--c-ink-3)] transition hover:border-[var(--brand-interactive)] hover:text-[var(--brand-interactive)]"
          >
            포트폴리오
          </TransitionLink>
          <TransitionLink
            href={ROUTES.stock(ticker, returnTo)} onClick={onBeforeNavigate}
            className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[var(--brand-interactive)] bg-[color:color-mix(in_srgb,var(--brand-interactive)_8%,transparent)] px-3 text-[10px] font-black text-[var(--brand-interactive)] transition hover:bg-[color:color-mix(in_srgb,var(--brand-interactive)_14%,transparent)]"
          >
            <span className="rounded-full bg-[var(--brand-interactive)] px-2 py-0.5 text-[9px] font-black text-white">
              {ticker}
            </span>
            종목 상세 →
          </TransitionLink>
        </div>
      </div>
      <StockDetailBoundary ticker={ticker}>
        <StockDetailBody detail={detail} f13Entries={f13Entries} ticker={ticker} stock={stock} f13Error={f13Error} f13Retry={retryF13} />
      </StockDetailBoundary>
    </div>
  );
  }

  const etfCompareHref = stock?.connection?.singleStockEtfs?.length
    ? ROUTES.etfCompareTickers(stock.connection.singleStockEtfs.map((link) => link.ticker).slice(0, 4))
    : null;

  return (
    <div className="cpw4-detail-panel">
      {stock ? (
        <>
          <div className="cpw4-detail-context">
            <div className="cpw4-detail-context__ticker">
              <span className="cpw4-detail-avatar">{w4Initials(stock.ticker)}</span>
              <div>
                <strong>{stock.ticker}</strong>
                <span>{stock.name}</span>
              </div>
            </div>
            <div className="cpw4-detail-context__metrics">
              <span>투자 신호 {stock.actionScore !== null && stock.actionScore !== undefined ? Math.round(stock.actionScore) : "—"}</span>
              <span>{w4FormatPrice(stock.price)}</span>
              <span>{w4FormatMarketCap(stock.marketCap)}</span>
              <span>PER {w4FormatRatio(stock.per)}</span>
              <span>PBR {w4FormatRatio(stock.pbr, 2)}</span>
              <span>배당 {w4FormatFractionPercent(stock.dividendYield)}</span>
              <span>12M {w4FormatSignedFractionPercent(stock.return12m)}</span>
            </div>
          </div>

          <div className="mb-4">
            <SharedEdgePanel
              title={edgeLead}
              shortScore={shortTermConvictionScore}
              longScore={longTermConvictionScore}
              shortRows={shortTermAxes.map((axis) => ({ key: axis.key, label: axis.fullLabel, score: axis.score, referenceOnly: axis.referenceOnly }))}
              longRows={longTermAxes.map((axis) => ({ key: axis.key, label: axis.fullLabel, score: axis.score, referenceOnly: axis.referenceOnly }))}
              shortTitle={`단기 축 · ${shortTermBasis.label} · ${shortTermBasis.windowLabel} · ${shortTermBasis.sourceInputCount ?? "—"}/3–5 입력`}
              longTitle={`장기 축 · 5개 방향성 축 ${longDirectionalCount}/5 · 동종군 유사도 참고축`}
              summary={`${shortTermBasis.exclusionNote} ${shortTermBasis.comparisonNote} Fenok 파생 신호 · 투자 조언이 아닙니다`.trim()}
              source="FENOK 신호"
              asOf={stock.fenokSignalAsOf ? stock.fenokSignalAsOf.slice(0, 10) : "—"}
              coverage={signalCoverage}
            />
          </div>

          <div className="cpw4-cta-row">
              <TransitionLink href={ROUTES.stock(ticker, returnTo)} onClick={onBeforeNavigate} className="cpw4-primary-cta">
                종목 상세 보기 →
              </TransitionLink>
              <TransitionLink href={ROUTES.portfolioTicker(ticker)} className="cpw4-secondary-cta">
                관심 추가
              </TransitionLink>
              {etfCompareHref ? (
                <TransitionLink href={etfCompareHref} className="cpw4-secondary-cta">
                  ETF 비교
                </TransitionLink>
              ) : (
                <span className="cpw4-secondary-cta cpw4-secondary-cta--disabled">ETF 비교</span>
              )}
              <span className="cpw4-cta-note">Fenok 파생 신호 · 투자 조언 아님</span>
            </div>
        </>
      ) : null}

      <details className="cpw4-financial-detail">
        <summary>
          <span>재무·추정치 원본 보기</span>
          <small>기존 상세 패널</small>
        </summary>
        <div className="cpw4-financial-detail__body">
          <StockDetailBoundary ticker={ticker}>
            <StockDetailBody detail={detail} f13Entries={f13Entries} ticker={ticker} stock={stock} f13Error={f13Error} f13Retry={retryF13} />
          </StockDetailBoundary>
        </div>
      </details>
    </div>
  );
}
