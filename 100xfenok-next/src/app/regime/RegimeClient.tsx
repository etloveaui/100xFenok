"use client";

import MarketSectionNav from "@/components/market/MarketSectionNav";
import TransitionLink from "@/components/TransitionLink";
import { Bar, EmptyState, EvidenceRail, Panel, PanelHeader, Pill } from "@/components/ui";
import { useMarketValuation } from "@/hooks/useMarketValuation";
import { DATA_STATE_LABELS, formatAsOf, isStaleAsOf } from "@/lib/data-state";
import type {
  MarketBondPulse,
  MarketIndexValuation,
  MarketMacroPulse,
  MarketSentimentPulse,
  MarketSignalPulse,
  MarketStructurePulse,
  MarketTone,
} from "@/lib/market-valuation/types";
import { ROUTES } from "@/lib/routes";

type Pulse = {
  id: string;
  label: string;
  valueLabel: string;
  detail: string;
  asOf: string | null;
  tone: MarketTone;
};

type Axis = {
  id: string;
  title: string;
  summary: string;
  tone: MarketTone;
  pulses: Pulse[];
  ready: boolean;
  floor: string | null;
};

type PillTone = "neutral" | "up" | "down" | "warn";

type RegimeAction = {
  key: string;
  label: string;
  detail: string;
  href: string;
};

const REGIME_ACTIONS: RegimeAction[] = [
  {
    key: "events",
    label: "이벤트 확인",
    detail: "이번 주 리스크 일정",
    href: ROUTES.marketEvents,
  },
  {
    key: "sectors",
    label: "섹터 강도 확인",
    detail: "국면과 맞는 업종 강도",
    href: ROUTES.sectors,
  },
  {
    key: "screener",
    label: "스크리너 압축",
    detail: "조건에 맞는 종목 후보",
    href: ROUTES.screener,
  },
  {
    key: "portfolio",
    label: "포트폴리오 점검",
    detail: "내 보유와 위험 노출점",
    href: ROUTES.portfolio,
  },
];

const AXIS_SUMMARIES: Record<string, string> = {
  structure: "고점 대비 위치와 상위 종목 집중도를 함께 봅니다.",
  signals: "가공 신호가 안정, 주의, 경계 중 어디에 놓였는지 확인합니다.",
  macro: "PMI와 금리·스프레드가 성장과 스트레스를 어떻게 가르는지 봅니다.",
  valuation: "지수 멀티플 부담과 주식위험프리미엄 보상을 같이 봅니다.",
};

function toneRank(tone: MarketTone): number {
  if (tone === "rose") return 3;
  if (tone === "amber") return 2;
  if (tone === "emerald") return 1;
  return 0;
}

function strongestTone(pulses: Pulse[]): MarketTone {
  return pulses.reduce<MarketTone>((top, pulse) => (toneRank(pulse.tone) > toneRank(top) ? pulse.tone : top), "slate");
}

function toneLabel(tone: MarketTone): string {
  if (tone === "rose") return "경계";
  if (tone === "amber") return "주의";
  if (tone === "emerald") return "양호";
  return "중립";
}

function axisPillTone(tone: MarketTone): PillTone {
  if (tone === "rose") return "down";
  if (tone === "amber") return "warn";
  if (tone === "emerald") return "up";
  return "neutral";
}

function axisLabelClass(tone: MarketTone): string {
  if (tone === "rose") return "rgm-down";
  if (tone === "amber") return "rgm-warn";
  if (tone === "emerald") return "rgm-up";
  return "rgm-mute";
}

function formatNumber(value: number | null, digits = 1): string {
  return value === null ? "-" : value.toFixed(digits);
}

function formatPercent(value: number | null, digits = 1): string {
  return value === null ? "-" : `${value.toFixed(digits)}%`;
}

function formatRatePercent(value: number | null, digits = 2): string {
  return value === null ? "-" : `${(value * 100).toFixed(digits)}%`;
}

function axisBarClass(tone: MarketTone): string {
  if (tone === "rose") return "rgm-bar-down";
  if (tone === "amber") return "rgm-bar-warn";
  if (tone === "emerald") return "rgm-bar-up";
  return "";
}

/**
 * Oldest present observation date. Unlike a completeness floor, undated feeds
 * (market structure carries no observation date) are excluded instead of
 * collapsing the whole floor to null; the exclusion is disclosed separately.
 */
function oldestDatedSourceDate(values: Array<string | null>): string | null {
  const dated = values.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (dated.length === 0) return null;
  return dated.sort().at(0) ?? null;
}

function signalStatusLabel(item: MarketSignalPulse): string {
  const labels: Record<string, string> = {
    stable: "안정",
    normal: "정상",
    neutral: "중립",
    caution: "주의",
    danger: "위험",
    stress: "스트레스",
    warning: "경고",
    rising: "상승",
    falling: "하락",
  };
  return labels[item.status] ?? item.statusLabel;
}

function readableDetail(value: string): string {
  return value
    .replace(/Slickcharts yearly return/gi, "연도 기준 수익률")
    .replace(/^ATH /, "고점 ")
    .replace(/ · 현 /g, " · 현재 ")
    .replace(/buy on/gi, "매수 신호 켜짐")
    .replace(/buy off/gi, "매수 신호 꺼짐")
    .replace(/warn on/gi, "경고 신호 켜짐")
    .replace(/warn off/gi, "경고 신호 꺼짐")
    .replace(/\bGlobal\b/g, "글로벌")
    .replace(/\bKorea\b/g, "한국")
    .replace(/\bChina\b/g, "중국");
}

function readablePulseLabel(value: string): string {
  const labels: Record<string, string> = {
    "Fear & Greed": "공포·탐욕",
    "S&P 500 Fwd P/E": "S&P 500 선행 P/E",
    "S&P 500 연간": "S&P 500 연간 수익률",
    "NASDAQ 100 연간": "NASDAQ 100 연간 수익률",
  };
  return labels[value] ?? "기타 신호";
}

function valuationTone(percentile: number | null): MarketTone {
  if (percentile === null) return "slate";
  if (percentile >= 80) return "rose";
  if (percentile >= 60) return "amber";
  if (percentile <= 25) return "emerald";
  return "slate";
}

function valuationLabel(percentile: number | null): string {
  if (percentile === null) return DATA_STATE_LABELS.unavailable;
  if (percentile >= 80) return "역사적으로 높은 구간";
  if (percentile >= 60) return "평균보다 높은 구간";
  if (percentile <= 25) return "부담이 낮은 구간";
  return "역사적 중간 구간";
}

function toSignalPulse(item: MarketSignalPulse): Pulse {
  return {
    id: item.id,
    label: readablePulseLabel(item.label),
    valueLabel: signalStatusLabel(item),
    detail: readableDetail(item.detail),
    asOf: item.asOf,
    tone: item.tone,
  };
}

function toStructurePulse(item: MarketStructurePulse): Pulse {
  return {
    id: item.id,
    label: readablePulseLabel(item.label),
    valueLabel: item.valueLabel,
    detail: readableDetail(item.detail),
    // SlickCharts `updated` is the collection clock. The current structure
    // payloads carry no observation date, so freshness must remain unknown.
    asOf: null,
    tone: item.tone,
  };
}

function toMacroPulse(item: MarketMacroPulse): Pulse {
  return {
    id: item.id,
    label: item.label,
    valueLabel: `${formatNumber(item.value)} ${item.unit}`.trim(),
    detail: readableDetail(item.detail),
    asOf: item.releaseDate ?? item.period,
    tone: item.tone,
  };
}

function toSentimentPulse(item: MarketSentimentPulse): Pulse {
  return {
    id: item.id,
    label: readablePulseLabel(item.label),
    valueLabel: item.valueLabel,
    detail: readableDetail(item.detail),
    asOf: item.date,
    tone: item.tone,
  };
}

function toBondPulse(item: MarketBondPulse): Pulse {
  return {
    id: item.id,
    label: item.label,
    valueLabel: item.valueLabel,
    detail: readableDetail(`${item.changeLabel} · ${item.detail}`),
    asOf: item.date,
    tone: item.tone,
  };
}

function sp500ValuationPulse(index: MarketIndexValuation | undefined): Pulse | null {
  if (!index) return null;
  const percentile = index.pe.percentile;
  return {
    id: "sp500_fwd_pe",
    label: readablePulseLabel("S&P 500 Fwd P/E"),
    valueLabel: index.pe.current === null ? "-" : `${index.pe.current.toFixed(1)}배`,
    detail: `${valuationLabel(percentile)} · 역사 백분위 ${formatPercent(percentile, 0)}`,
    asOf: index.date,
    tone: valuationTone(percentile),
  };
}

function toneCounts(pulses: Pulse[]) {
  return {
    alert: pulses.filter((pulse) => pulse.tone === "rose").length,
    caution: pulses.filter((pulse) => pulse.tone === "amber").length,
    friendly: pulses.filter((pulse) => pulse.tone === "emerald").length,
  };
}

/**
 * Composite position — a pure client-side transform of already-loaded tone counts
 * (friendlyCount − cautionCount − alertCount×2, normalized to 0-100). No new data source;
 * a true numeric regime score is not emitted by the hook. Returns null when there is
 * nothing to read: callers gate bodies on null instead of rendering a neutral 50.
 */
function gaugeReading(pulses: Pulse[]) {
  const { alert, caution, friendly } = toneCounts(pulses);
  const total = pulses.length;
  if (total === 0) {
    return null;
  }
  const raw = friendly - caution - alert * 2;
  const min = -2 * total;
  const max = total;
  const percent = ((raw - min) / (max - min)) * 100;
  const position = percent < 20 ? "경계" : percent < 40 ? "주의" : percent < 60 ? "중립" : percent < 80 ? "양호" : "강한 양호";
  return { percent, position, alert, caution, friendly, total };
}

function reload() {
  window.location.reload();
}

function openEvidence(path: string) {
  window.open(path, "_blank", "noopener");
}

function headerSentence(
  axes: Axis[],
  gauge: ReturnType<typeof gaugeReading>,
  loading: boolean,
  failed: boolean,
): string {
  if (loading) return "시장 신호를 불러오는 중입니다.";
  if (failed) return "시장 국면 데이터를 불러오지 못했습니다. 다시 시도해 주세요.";
  if (gauge === null) return "표시할 신호가 아직 없습니다. 다음 마감 후 다시 확인해 주세요.";
  const hot = axes.filter((axis) => axis.pulses.length > 0 && (axis.tone === "rose" || axis.tone === "amber"));
  if (hot.length === 0) {
    return `긍정 신호 ${gauge.friendly}개 · ${gauge.position} 국면 — 전 축에서 과열 징후가 없습니다.`;
  }
  return `긍정 ${gauge.friendly} · 주의 ${gauge.caution} · 경계 ${gauge.alert} — ${gauge.position} 국면, ${hot.map((axis) => axis.title).join("·")} 축을 함께 확인하세요.`;
}

function CompositePanel({
  axes,
  gauge,
  loading,
  failed,
  ready,
  partial,
  stale,
  floor,
}: {
  axes: Axis[];
  gauge: ReturnType<typeof gaugeReading>;
  loading: boolean;
  failed: boolean;
  ready: boolean;
  partial: boolean;
  stale: boolean;
  floor: string | null;
}) {
  const score = gauge === null ? null : Math.round(gauge.percent);
  const emptyActive = failed || (!loading && !ready);
  return (
    <Panel
      loading={loading}
      empty={emptyActive}
      emptyReason={failed ? "시장 국면 데이터를 불러오지 못했습니다" : "표시할 신호가 아직 없습니다"}
      emptyNextRefresh="다음 마감 후 갱신"
      emptyActionLabel="다시 시도"
      onEmptyAction={reload}
    >
      {ready && gauge !== null && score !== null && (
        <div data-regime-headline>
          <PanelHeader
            eyebrow="Market Regime"
            title="종합 판독"
            right={<Pill tone={floor ? "neutral" : "warn"}>{floor ? `기준 ${formatAsOf(floor)}` : "기준일 확인 필요"}</Pill>}
          />
          <div className="rgm-score">
            <div className="rgm-score-num">
              <span className="tabular-nums rgm-score-value">{score}</span>
              <span className="rgm-score-unit">/ 100 · {gauge.position}</span>
              <span className="rgm-score-counts tabular-nums">
                긍정 {gauge.friendly} · 주의 {gauge.caution} · 경계 {gauge.alert}
              </span>
            </div>
            <div className="rgm-meters">
              {axes.map((axis) => {
                const axisScore = gaugeReading(axis.pulses);
                const axisPercent = axisScore === null ? null : Math.round(axisScore.percent);
                return (
                  <div className="rgm-meter" key={axis.id}>
                    <div className="rgm-meter-top">
                      <span className="rgm-meter-label">{axis.title}</span>
                      {axisPercent !== null ? (
                        <span className="tabular-nums rgm-meter-value">
                          {axisPercent} <span className={axisLabelClass(axis.tone)}>{toneLabel(axis.tone)}</span>
                        </span>
                      ) : (
                        <span className="rgm-meter-nodata">신호 없음</span>
                      )}
                    </div>
                    {axisPercent !== null && (
                      <Bar
                        value={axisPercent}
                        className={axisBarClass(axis.tone)}
                        aria-label={`${axis.title} 점수`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <EvidenceRail
        freshness={loading ? "pending" : failed || !ready ? "error" : partial ? "partial" : stale ? "stale" : "fresh"}
        source="국면 판독 엔진"
        asOf={floor ? (formatAsOf(floor) ?? floor) : "—"}
        coverage={gauge === null ? "0개 신호" : `${gauge.total}개 신호`}
        onRetry={failed || stale || partial ? reload : undefined}
        onEvidence={ready && !failed ? () => openEvidence("/data/computed/signals.json") : undefined}
      />
    </Panel>
  );
}

function AxisTablePanel({
  axes,
  loading,
  failed,
  ready,
  partial,
  stale,
  floor,
  undatedStructure,
}: {
  axes: Axis[];
  loading: boolean;
  failed: boolean;
  ready: boolean;
  partial: boolean;
  stale: boolean;
  floor: string | null;
  undatedStructure: boolean;
}) {
  const readyAxes = axes.filter((axis) => axis.ready).length;
  return (
    <Panel
      loading={loading}
      empty={failed || (!loading && !ready)}
      emptyReason={failed ? "축별 신호 요약을 불러오지 못했습니다" : "표시할 신호가 아직 없습니다"}
      emptyNextRefresh="다음 마감 후 갱신"
      emptyActionLabel="다시 시도"
      onEmptyAction={reload}
    >
      {ready && (
        <>
          <PanelHeader eyebrow="Axis Breakdown" title="축별 신호 요약" right={<Pill>4개 축</Pill>} />
          <div role="table" aria-label="축별 신호 요약">
            <div className="rgm-thead" role="row">
              <span role="columnheader">축</span>
              <span role="columnheader">요약</span>
              <span role="columnheader">신호수</span>
              <span role="columnheader">상태</span>
            </div>
            {axes.map((axis) => (
              <div className="rgm-trow" role="row" key={axis.id} data-regime-axis-summary-card={axis.id}>
                <span className="rgm-axis" role="cell">{axis.title}</span>
                <span className="rgm-sum" role="cell">{axis.summary}</span>
                <span className="tabular-nums" role="cell">{axis.pulses.length}개</span>
                <span role="cell">
                  {axis.pulses.length > 0 ? (
                    <Pill tone={axisPillTone(axis.tone)}>{toneLabel(axis.tone)}</Pill>
                  ) : (
                    <Pill tone="neutral">신호 없음</Pill>
                  )}
                </span>
              </div>
            ))}
          </div>
          {undatedStructure && (
            <div className="rgm-floor-note" data-regime-floor-note>
              시장 구조 신호는 관측일이 제공되지 않아 기준일 계산에서 제외됩니다.
            </div>
          )}
        </>
      )}
      <EvidenceRail
        freshness={loading ? "pending" : failed || !ready ? "error" : partial ? "partial" : stale ? "stale" : "fresh"}
        source="국면 판독 엔진"
        asOf={floor ? (formatAsOf(floor) ?? floor) : "—"}
        coverage={`${readyAxes}/4 축`}
        onRetry={failed || stale || partial ? reload : undefined}
        onEvidence={ready && !failed ? () => openEvidence("/data/computed/signals.json") : undefined}
      />
    </Panel>
  );
}

function HistoryPanel() {
  // BLOCKED: no dated regime feed or archive type exists, so the 12-week strip
  // can never render. Shared EmptyState with reason + next refresh, never null.
  return (
    <Panel>
      <div data-regime-history>
        <PanelHeader eyebrow="Regime History" title="국면 히스토리 — 최근 12주" right={<Pill>주간</Pill>} />
        <EmptyState
          reason="날짜별 국면 피드가 아직 없어 히스토리를 표시할 수 없습니다"
          nextRefresh="피드 연결 후 주간 갱신"
        />
        <EvidenceRail freshness="pending" source="국면 판독 엔진 아카이브" asOf="—" coverage="0/12주" />
      </div>
    </Panel>
  );
}

function ActionsPanel({
  loading,
  failed,
  partial,
  floor,
}: {
  loading: boolean;
  failed: boolean;
  partial: boolean;
  floor: string | null;
}) {
  return (
    <Panel>
      <PanelHeader eyebrow="Next Actions" title="다음 확인" right={<Pill>4개</Pill>} />
      <div data-regime-action-rail>
        {REGIME_ACTIONS.map((action) => (
          <TransitionLink
            key={action.key}
            href={action.href}
            className="rgm-arow"
            data-regime-action={action.key}
          >
            <span className="rgm-atext">
              <span className="rgm-alabel">{action.label}</span>
              <span className="rgm-adetail">{action.detail}</span>
            </span>
            <span className="rgm-abtn" aria-hidden="true">열기</span>
          </TransitionLink>
        ))}
      </div>
      <EvidenceRail
        freshness={loading ? "pending" : failed ? "error" : !floor || partial ? "partial" : "fresh"}
        source="국면 엔진"
        asOf={floor ? (formatAsOf(floor) ?? floor) : "—"}
        coverage="4/4"
        onRetry={failed || partial ? reload : undefined}
        onEvidence={failed ? undefined : () => openEvidence("/data/computed/signals.json")}
      />
    </Panel>
  );
}

export default function RegimeClient() {
  const {
    indices,
    macroPulses,
    signalPulses,
    sentimentPulses,
    structurePulses,
    erpInsight,
    bondPulses,
    dataSources,
    dataReady,
    failed,
    feedReady,
    sourceDate,
  } = useMarketValuation();

  const sp500 = indices.find((index) => index.id === "sp500");
  const valuationPulse = sp500ValuationPulse(sp500);
  const erpPulse: Pulse | null = erpInsight
    ? {
        id: "erp",
        label: "주식위험프리미엄",
        valueLabel: erpInsight.regimeLabel,
        detail: `미국 ERP ${formatRatePercent(erpInsight.usErp)} · 역사 백분위 ${formatPercent(erpInsight.historicalPercentile, 0)}`,
        asOf: erpInsight.sourceDate,
        tone: erpInsight.regimeTone,
      }
    : null;

  const structurePulseList = structurePulses.slice(0, 4).map(toStructurePulse);
  const signalPulseList = signalPulses.map(toSignalPulse);
  const macroPulseList = [...macroPulses.slice(0, 3).map(toMacroPulse), ...bondPulses.slice(0, 2).map(toBondPulse)];
  const valuationPulseList = [valuationPulse, erpPulse, ...sentimentPulses.slice(0, 2).map(toSentimentPulse)].filter((item): item is Pulse => item !== null);

  const axes: Axis[] = [
    {
      id: "structure",
      title: "시장 구조",
      summary: AXIS_SUMMARIES.structure,
      pulses: structurePulseList,
      tone: strongestTone(structurePulseList),
      ready: feedReady.structure,
      floor: oldestDatedSourceDate(structurePulseList.map((pulse) => pulse.asOf)),
    },
    {
      id: "signals",
      title: "유동성·리스크",
      summary: AXIS_SUMMARIES.signals,
      pulses: signalPulseList,
      tone: strongestTone(signalPulseList),
      ready: feedReady.computed,
      floor: oldestDatedSourceDate(signalPulseList.map((pulse) => pulse.asOf)),
    },
    {
      id: "macro",
      title: "경기·금리",
      summary: AXIS_SUMMARIES.macro,
      pulses: macroPulseList,
      tone: strongestTone(macroPulseList),
      ready: feedReady.macro || feedReady.bond,
      floor: oldestDatedSourceDate(macroPulseList.map((pulse) => pulse.asOf)),
    },
    {
      id: "valuation",
      title: "밸류에이션·보상",
      summary: AXIS_SUMMARIES.valuation,
      pulses: valuationPulseList,
      tone: strongestTone(valuationPulseList),
      ready: feedReady.valuation || feedReady.erp || feedReady.sentiment,
      floor: oldestDatedSourceDate(valuationPulseList.map((pulse) => pulse.asOf)),
    },
  ];

  const allPulses = axes.flatMap((axis) => axis.pulses);
  const gauge = gaugeReading(allPulses);
  const requiredSourceIds = ["benchmarks", "yardney", "damodaran", "macro", "computed", "sentiment", "indices", "slickcharts"];
  const visibleSources = dataSources.filter((source) => requiredSourceIds.includes(source.id));
  const sourceById = new Map(visibleSources.map((source) => [source.id, source]));
  // Panel floor from dated clocks only: structure pulses carry no observation
  // date, so they are excluded here and disclosed via the floor note instead of
  // collapsing the whole floor to null.
  const floor = oldestDatedSourceDate([
    sourceDate,
    ...allPulses.map((pulse) => pulse.asOf),
    ...requiredSourceIds.map((id) => sourceById.get(id)?.updated ?? null),
  ]);

  const isLoading = !dataReady && !failed;
  const ready = !isLoading && !failed && gauge !== null;
  const partial = ready && (axes.some((axis) => !axis.ready) || floor === null);
  const stale = ready && !partial && isStaleAsOf(floor);
  const undatedStructure = axes[0].pulses.length > 0;

  return (
    <div className="rgm" data-regime-surface>
      <div className="rgm-head">
        <div className="rgm-title-block">
          <h1 className="rgm-title">시장 국면</h1>
          <span className="rgm-verdict">{headerSentence(axes, gauge, isLoading, failed)}</span>
        </div>
        <div className="rgm-tabs">
          <MarketSectionNav active="regime" />
        </div>
      </div>

      <CompositePanel axes={axes} gauge={gauge} loading={isLoading} failed={failed} ready={ready} partial={partial} stale={stale} floor={floor} />
      <AxisTablePanel axes={axes} loading={isLoading} failed={failed} ready={ready} partial={partial} stale={stale} floor={floor} undatedStructure={undatedStructure} />
      <HistoryPanel />
      <ActionsPanel loading={isLoading} failed={failed} partial={partial} floor={floor} />
    </div>
  );
}
