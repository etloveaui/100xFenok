import type { FenokSignalsSummaryRecord } from "@/features/stock-analyzer/data/fenok-signals-summary-provider";
import { FenokSignalRadar, type FenokSignalRadarAxis } from "@/components/screener/FenokSignalRadar";
import { FenokSignalRadarHexagon, type FenokSignalRadarHexagonAxis } from "@/components/screener/FenokSignalRadarHexagon";
import FenokSignalHelpPopover from "@/components/screener/FenokSignalHelpPopover";
import type { FenokSignalHelpKey } from "@/lib/fenok-signals/signal-help-config";
import { getDisplaySignalHelpBands, lookupBand, toneClass } from "@/lib/fenok-signals/signal-help-config";
import { directionKo as axisDirectionKo } from "@/lib/fenok-signals/direction-ko";

interface FenokSignalLensCardProps {
  record: FenokSignalsSummaryRecord | null | undefined;
}

type SignalKey =
  | "profitability"
  | "durabilityProfitability"
  | "growth"
  | "upsidePotential"
  | "downsidePressure"
  | "technicalFlow"
  | "technicalIndicatorProxy"
  | "netOptionsProxy"
  | "offExchangeActivityProxy"
  | "shortPressureProxy"
  | "directNewsToneProxy"
  | "volumeLiquidityTrend"
  | "shortTermRelativeStrength";

interface SignalConfig {
  key: SignalKey;
  label: string;
  scoreKey: keyof FenokSignalsSummaryRecord;
  helpKey: FenokSignalHelpKey;
  inverted?: boolean;
  contextual?: boolean;
  coverageKey?: keyof FenokSignalsSummaryRecord;
}

interface LegacySignalConfig extends SignalConfig {
  directionKey: keyof FenokSignalsSummaryRecord;
  interpretation: string;
}

interface SignalMetric extends SignalConfig {
  score: number | null;
  coverage: number | null;
}

interface SignalGroupConfig {
  key: "long" | "short";
  title: string;
  scoreKey: keyof FenokSignalsSummaryRecord;
  signals: SignalConfig[];
}

const LONG_TERM_SIGNALS: SignalConfig[] = [
  { key: "profitability", label: "수익성", scoreKey: "profitabilityScore", helpKey: "profitability" },
  {
    key: "durabilityProfitability",
    label: "내구성",
    scoreKey: "durabilityProfitabilityScore",
    helpKey: "durabilityProfitability",
    coverageKey: "durabilityProfitabilityCoverage",
  },
  { key: "growth", label: "성장", scoreKey: "growthScore", helpKey: "growth" },
  { key: "upsidePotential", label: "상방", scoreKey: "upsidePotentialScore", helpKey: "upsidePotential" },
  { key: "downsidePressure", label: "하방 압력", scoreKey: "downsidePressureScore", helpKey: "downsidePressure", inverted: true },
];

const SHORT_TERM_SIGNALS: SignalConfig[] = [
  { key: "technicalFlow", label: "기술·자금", scoreKey: "technicalFlowScore", helpKey: "technicalFlow" },
  {
    key: "volumeLiquidityTrend",
    label: "거래량",
    scoreKey: "volumeLiquidityTrendScore",
    helpKey: "volumeLiquidityTrend",
  },
  {
    key: "shortTermRelativeStrength",
    label: "상대강도",
    scoreKey: "shortTermRelativeStrengthScore",
    helpKey: "shortTermRelativeStrength",
  },
  { key: "netOptionsProxy", label: "옵션", scoreKey: "netOptionsProxyScore", helpKey: "netOptionsProxy" },
  {
    key: "offExchangeActivityProxy",
    label: "장외거래",
    scoreKey: "offExchangeActivityProxyScore",
    helpKey: "offExchangeActivityProxy",
    contextual: true,
  },
  {
    key: "shortPressureProxy",
    label: "숏 압력",
    scoreKey: "shortPressureProxyScore",
    helpKey: "shortPressureProxy",
    inverted: true,
  },
];

const SIGNAL_GROUPS: SignalGroupConfig[] = [
  { key: "long", title: "Long-Term", scoreKey: "longTermScore", signals: LONG_TERM_SIGNALS },
  { key: "short", title: "Short-Term", scoreKey: "shortTermScore", signals: SHORT_TERM_SIGNALS },
];

const LEGACY_SIGNALS: LegacySignalConfig[] = [
  {
    key: "profitability",
    label: "수익성",
    scoreKey: "profitabilityScore",
    directionKey: "profitabilityDirection",
    interpretation: "기업의 이익 창출 능력과 자본 효율성",
    helpKey: "profitability",
  },
  {
    key: "durabilityProfitability",
    label: "내구 수익성",
    scoreKey: "durabilityProfitabilityScore",
    directionKey: "durabilityProfitabilityScore",
    interpretation: "수익성의 지속 가능성과 재무적 내구력",
    helpKey: "durabilityProfitability",
    coverageKey: "durabilityProfitabilityCoverage",
  },
  {
    key: "growth",
    label: "성장",
    scoreKey: "growthScore",
    directionKey: "growthDirection",
    interpretation: "향후 매출·이익 성장 잠재력",
    helpKey: "growth",
  },
  {
    key: "technicalFlow",
    label: "기술·자금",
    scoreKey: "technicalFlowScore",
    directionKey: "technicalFlowDirection",
    interpretation: "가격 모멘텀과 자금 흐름의 기술적 상태",
    helpKey: "technicalFlow",
  },
  {
    key: "upsidePotential",
    label: "상방 잠재력",
    scoreKey: "upsidePotentialScore",
    directionKey: "upsidePotentialScore",
    interpretation: "상대적 상방 기대를 요약한 파생 프록시",
    helpKey: "upsidePotential",
  },
  {
    key: "downsidePressure",
    label: "하방 압력",
    scoreKey: "downsidePressureScore",
    directionKey: "downsidePressureScore",
    interpretation: "상대적 하방 위험을 요약한 리스크 축",
    helpKey: "downsidePressure",
    inverted: true,
  },
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function confidenceKo(value: string | null | undefined): string {
  switch (value) {
    case "high":
      return "신뢰 높음";
    case "medium":
      return "신뢰 중간";
    case "low":
      return "신뢰 낮음";
    default:
      return "신뢰 미정";
  }
}

function convictionCallKo(call: FenokSignalsSummaryRecord["convictionCall"]): string {
  if (call === "concentrated") return "집중";
  if (call === "mixed") return "혼재";
  if (call === "diluted") return "희석";
  return "미정";
}

function convictionTone(call: FenokSignalsSummaryRecord["convictionCall"]): string {
  if (call === "concentrated") return "border-[var(--up-border)] bg-[var(--c-up-soft)] text-[var(--c-up)]";
  if (call === "mixed") return "border-cyan-200 bg-cyan-50 text-cyan-700";
  if (call === "diluted") return "border-[var(--c-warn)] bg-[var(--c-warn-soft)] text-[var(--c-warn)]";
  return "border-[var(--c-line)] bg-[var(--c-surface-2)] text-[var(--c-ink-3)]";
}

function directionKo(key: SignalKey, value: string | null | undefined): string {
  if (!value || value === "unavailable") {
    if (key === "durabilityProfitability" || key === "upsidePotential" || key === "downsidePressure") {
      return "";
    }
    return "미확인";
  }
  if (value === "upside_bias") return "상방 편중";
  if (value === "downside_bias") return "하방 편중";
  if (value === "balanced") return "균형";
  if (value === "strong") return "강함";
  if (value === "constructive") return "양호";
  if (value === "neutral") return "중립";
  if (value === "weak") return "약함";
  if (value === "stressed") return "압력 큼";
  return value.replaceAll("_", " ");
}

function legacyScoreBarColor(score: number | null, inverted = false): string {
  if (score === null || score === undefined) return "bg-[var(--c-line)]";
  const displayScore = inverted ? 100 - score : score;
  if (displayScore >= 70) return "bg-[var(--c-up)]";
  if (displayScore >= 50) return "bg-[var(--c-warn)]";
  return "bg-[var(--c-down)]";
}

function displayedScore(score: number | null, inverted = false): number | null {
  if (score === null) return null;
  return Math.max(0, Math.min(100, inverted ? 100 - score : score));
}

function metricDisplayScore(metric: SignalMetric): number | null {
  return displayedScore(metric.score, metric.inverted);
}

function directionFromDisplayScore(score: number | null): string | null {
  if (score === null) return "unavailable";
  if (score >= 70) return "constructive";
  if (score >= 45) return "neutral";
  return "weak";
}

function legacyDirection(score: number | null, inverted: boolean, rawDirection: string | null): string | null {
  if (!inverted) return rawDirection;
  return directionFromDisplayScore(displayedScore(score, true));
}

function legacyMetricLabel(signal: LegacySignalConfig): string {
  if (signal.key === "downsidePressure" && signal.inverted) return "하락 압력 완화";
  if (signal.key === "shortPressureProxy" && signal.inverted) return "숏압력 완화";
  return signal.label;
}

function legacyMetricInterpretation(signal: LegacySignalConfig): string {
  if (signal.key === "downsidePressure" && signal.inverted) return "하락 압력을 뒤집어 표시한 점수, 높을수록 위험 낮음";
  if (signal.key === "shortPressureProxy" && signal.inverted) return "숏 볼륨 압력을 뒤집어 표시한 점수, 높을수록 압력 낮음";
  return signal.interpretation;
}

function scoreBarColor(metric: SignalMetric): string {
  const score = metricDisplayScore(metric);
  if (score === null) return "bg-[var(--c-line)]";
  if (metric.contextual) return "bg-[var(--c-brand)]";
  if (score >= 70) return "bg-[var(--c-up)]";
  if (score >= 50) return "bg-[var(--c-warn)]";
  return "bg-[var(--c-down)]";
}

function scoreTone(metric: SignalMetric): string {
  const score = metricDisplayScore(metric);
  if (score === null) return "text-[var(--c-ink-3)]";
  if (metric.contextual) return "text-[var(--c-brand)]";
  if (score >= 70) return "text-[var(--c-up)]";
  if (score >= 50) return "text-[var(--c-warn)]";
  return "text-[var(--c-down)]";
}

function scoreLabel(metric: SignalMetric): string {
  const score = metricDisplayScore(metric);
  if (score === null) return "미확인";
  if (metric.contextual) {
    if (score >= 70) return "높음";
    if (score >= 45) return "보통";
    return "낮음";
  }
  if (metric.inverted) {
    if (score >= 70) return "압력 낮음";
    if (score >= 50) return "주의";
    return "압력 높음";
  }
  if (score >= 70) return "강함";
  if (score >= 50) return "양호";
  if (score >= 40) return "중립";
  return "약함";
}

function radarDirection(metric: SignalMetric): string | null {
  const score = metricDisplayScore(metric);
  if (score === null) return "unavailable";
  if (metric.contextual) {
    if (score >= 70) return "strong";
    if (score >= 45) return "neutral";
    return "weak";
  }
  return directionFromDisplayScore(score);
}

function aggregateScore(metrics: SignalMetric[], fallback: unknown): number | null {
  if (isFiniteNumber(fallback)) return fallback;
  let total = 0;
  let count = 0;
  for (const metric of metrics) {
    if (metric.score === null || metric.contextual) continue;
    total += metricDisplayScore(metric) ?? 0;
    count += 1;
  }
  return count ? total / count : null;
}

function formatAsOf(value: string | null | undefined): string {
  if (!value) return "미확인";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function formatCoverage(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return "미확인";
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function formatScore(value: number | null): string {
  return value === null ? "—" : Math.round(value).toString();
}

function metricFromConfig(record: FenokSignalsSummaryRecord, signal: SignalConfig): SignalMetric {
  const scoreValue = record[signal.scoreKey];
  const coverageValue = signal.coverageKey ? record[signal.coverageKey] : null;
  return {
    ...signal,
    score: isFiniteNumber(scoreValue) ? scoreValue : null,
    coverage: isFiniteNumber(coverageValue) ? coverageValue : null,
  };
}

function metricRadarAxis(metric: SignalMetric): FenokSignalRadarAxis {
  return {
    label: metric.label,
    score: metricDisplayScore(metric),
    direction: radarDirection(metric),
  };
}

function SignalMetricRow({ metric }: { metric: SignalMetric }) {
  const displayScore = metricDisplayScore(metric);
  const width = displayScore === null ? 0 : Math.max(0, Math.min(100, displayScore));
  return (
    <div className="min-w-0 rounded-lg border border-[var(--c-line)] bg-[var(--c-panel)] px-2.5 py-2">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[11px] font-black text-[var(--c-ink)]">{metric.label}</span>
            <FenokSignalHelpPopover
              signal={metric.helpKey}
              score={displayScore}
              direction={radarDirection(metric)}
              invertedDisplay={metric.inverted}
            />
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5">
            <span className={`text-[9px] font-black ${scoreTone(metric)}`}>{scoreLabel(metric)}</span>
            {metric.coverage !== null ? (
              <span
                className="rounded bg-[var(--c-surface-2)] px-1 py-0.5 text-[9px] font-bold text-[var(--c-ink-3)]"
                title={`데이터 커버리지 ${formatCoverage(metric.coverage)}`}
              >
                데이터 {formatCoverage(metric.coverage)}
              </span>
            ) : null}
          </div>
        </div>
        <span className={`orbitron shrink-0 text-sm font-black tabular-nums ${scoreTone(metric)}`}>
          {formatScore(displayScore)}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--c-surface-2)]">
        <div className={`h-full rounded-full transition-all ${scoreBarColor(metric)}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function SignalGroupPanel({
  group,
  metrics,
  groupScore,
}: {
  group: SignalGroupConfig;
  metrics: SignalMetric[];
  groupScore: number | null;
}) {
  const availableCount = metrics.filter((metric) => metric.score !== null).length;
  const scoreMetric: SignalMetric = {
    key: group.key === "long" ? "upsidePotential" : "technicalFlow",
    label: group.title,
    scoreKey: group.scoreKey,
    helpKey: group.key === "long" ? "upsidePotential" : "technicalFlow",
    score: groupScore,
    coverage: null,
  };

  return (
    <div className="min-w-0 rounded-lg border border-[var(--c-line)] bg-[var(--c-surface-2)] p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-black uppercase tracking-[0.08em] text-[var(--c-ink)]">{group.title}</h3>
          <p className="mt-0.5 text-[10px] font-bold text-[var(--c-ink-3)]">
            {availableCount}/{metrics.length} axes
          </p>
        </div>
        <span className={`inline-flex min-w-14 items-center justify-center rounded-full border px-2 py-1 text-sm font-black tabular-nums ${convictionTone(null)} ${scoreTone(scoreMetric)}`}>
          {formatScore(groupScore)}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-[172px_1fr]">
        <div className="flex justify-center sm:justify-start">
          <FenokSignalRadar axes={metrics.map(metricRadarAxis)} size="md" ariaLabel={`Fenok ${group.title} 신호 레이더`} />
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
          {metrics.map((metric) => (
            <SignalMetricRow key={metric.key} metric={metric} />
          ))}
        </div>
      </div>
    </div>
  );
}

function hasLensUiData(record: FenokSignalsSummaryRecord): boolean {
  return [
    record.lensCoverageRatio,
    record.longTermScore,
    record.shortTermScore,
    record.profitabilityScore,
    record.growthScore,
    record.upsidePotentialScore,
    record.downsidePressureScore,
    record.marketSimilarityScore,
    record.technicalIndicatorProxyScore,
    record.netOptionsProxyScore,
    record.offExchangeActivityProxyScore,
    record.shortPressureProxyScore,
    record.volumeLiquidityTrendScore,
    record.shortTermRelativeStrengthScore,
  ].some(isFiniteNumber);
}

function LegacyFenokSignalLensCard({ record }: { record: FenokSignalsSummaryRecord }) {
  const chips = LEGACY_SIGNALS.map((signal) => {
    const scoreValue = record[signal.scoreKey];
    const score = isFiniteNumber(scoreValue) ? scoreValue : null;
    const directionValue = record[signal.directionKey];
    const direction = typeof directionValue === "string" ? directionValue : null;
    const coverageValue = signal.coverageKey ? record[signal.coverageKey] : null;
    const coverage = isFiniteNumber(coverageValue) ? coverageValue : null;
    const displayScore = displayedScore(score, signal.inverted);
    return {
      ...signal,
      label: legacyMetricLabel(signal),
      interpretation: legacyMetricInterpretation(signal),
      score,
      displayScore,
      direction: legacyDirection(score, Boolean(signal.inverted), direction),
      coverage,
    };
  });
  const hasSignal = chips.some((chip) => chip.score !== null);
  if (!hasSignal) return null;

  const confidence = record.confidence ?? null;
  const convictionScore = isFiniteNumber(record.convictionScore) ? Math.round(record.convictionScore) : null;
  const convictionCall = record.convictionCall ?? null;
  const radarData = {
    profitabilityScore: record.profitabilityScore,
    profitabilityDirection: record.profitabilityDirection,
    growthScore: record.growthScore,
    growthDirection: record.growthDirection,
    technicalFlowScore: record.technicalFlowScore,
    technicalFlowDirection: record.technicalFlowDirection,
    fenokEdgeScore: record.upsideDownsideScore,
    fenokEdgeDirection: record.upsideDownsideDirection,
  };

  return (
    <section className="panel overflow-hidden border border-[var(--c-line)] bg-[var(--c-panel)] shadow-[var(--sh-sm)]">
      <div className="border-b border-[var(--c-line-2)] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-[11px] font-black uppercase tracking-[0.08em] text-[var(--c-ink)]">
              Fenok 신호 분석
            </h2>
            <span className="rounded-full bg-[var(--c-surface-2)] px-2 py-0.5 text-[9px] font-black text-[var(--c-ink-3)]">
              {confidenceKo(confidence)}
            </span>
          </div>
          <span className="text-[9px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">
            매수 권유 아님
          </span>
        </div>
      </div>

      <div className="p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-black tabular-nums ${convictionTone(convictionCall)}`}
              title="Fenok 4-신호 동일가중 종합 점수"
            >
              <span aria-hidden="true">{convictionCallKo(convictionCall)}</span>
              {convictionScore ?? "—"}
            </span>
            <span className="text-[10px] font-bold text-[var(--c-ink-3)]">
              Fenok 4-신호 동일가중 종합
            </span>
          </div>
          <span className="text-[10px] font-bold text-[var(--c-ink-3)]">
            as_of {formatAsOf(record.asOf)} · coverage {formatCoverage(record.coverageRatio)}
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
          <div className="flex justify-center sm:justify-start">
            <FenokSignalRadar data={radarData} size="md" />
          </div>

          <div className="grid content-center gap-3">
            {chips.map((chip) => {
              const width = chip.displayScore === null ? 0 : Math.max(0, Math.min(100, chip.displayScore));
              const directionText = directionKo(chip.key, chip.direction);
              return (
                <div key={chip.key} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="text-xs font-black text-[var(--c-ink)]">{chip.label}</span>
                      <FenokSignalHelpPopover
                        signal={chip.helpKey}
                        score={chip.displayScore}
                        direction={chip.direction}
                        invertedDisplay={chip.inverted}
                      />
                      {chip.coverageKey && chip.coverage !== null ? (
                        <span
                          className="shrink-0 rounded bg-[var(--c-surface-2)] px-1 py-0.5 text-[9px] font-bold text-[var(--c-ink-3)]"
                          title={`내구 수익성 데이터 커버리지 ${formatCoverage(chip.coverage)}`}
                        >
                          데이터 {formatCoverage(chip.coverage)}
                        </span>
                      ) : null}
                      <span className="truncate text-[10px] font-semibold text-[var(--c-ink-3)]">
                        {chip.interpretation}
                      </span>
                    </div>
                    <span className="orbitron shrink-0 text-sm font-black tabular-nums text-[var(--c-ink)]">
                      {formatScore(chip.displayScore)}
                      {directionText ? (
                        <span className="ml-1 text-[10px] font-bold text-[var(--c-ink-3)]">
                          {directionText}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--c-surface-2)]">
                    <div
                      className={`h-full rounded-full transition-all ${legacyScoreBarColor(chip.score, chip.inverted)}`}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p className="border-t border-[var(--c-line-2)] bg-[var(--c-surface-2)]/50 px-4 py-2 text-[10px] font-bold text-[var(--c-ink-3)]">
        Fenok 파생 프록시 · 매수 권유 아님 · as_of {formatAsOf(record.asOf)} · coverage{" "}
        {formatCoverage(record.coverageRatio)}
      </p>
    </section>
  );
}

interface LongTermAxisConfig {
  key: string;
  spokeLabel: string;
  fullLabel: string;
  scoreKey: keyof FenokSignalsSummaryRecord;
  directionKey?: keyof FenokSignalsSummaryRecord;
  coverageKey?: keyof FenokSignalsSummaryRecord;
  helpKey: FenokSignalHelpKey;
  invertScore?: boolean;
  tooltipNote?: string;
}

interface LongTermAxis extends FenokSignalRadarHexagonAxis {
  key: string;
  helpKey: FenokSignalHelpKey;
  fullLabel: string;
  coverage: number | null;
  tooltipNote?: string | null;
  invertedDisplay?: boolean;
  meta: {
    tier: string | null;
    tone: "up" | "warn" | "down" | "neutral";
  };
}

const LONG_TERM_AXIS_CONFIG: LongTermAxisConfig[] = [
  {
    key: "profitability",
    spokeLabel: "수익성",
    fullLabel: "수익성",
    scoreKey: "profitabilityScore",
    directionKey: "profitabilityDirection",
    helpKey: "profitability",
  },
  {
    key: "growth",
    spokeLabel: "성장",
    fullLabel: "성장",
    scoreKey: "growthScore",
    directionKey: "growthDirection",
    helpKey: "growth",
  },
  {
    key: "upsidePotential",
    spokeLabel: "상방",
    fullLabel: "상승 잠재력",
    scoreKey: "upsidePotentialScore",
    helpKey: "upsidePotential",
  },
  {
    key: "downsidePressure",
    spokeLabel: "하락완화",
    fullLabel: "하락 압력 완화",
    scoreKey: "downsidePressureScore",
    helpKey: "downsidePressure",
    invertScore: true,
    tooltipNote: "하락 압력을 뒤집어 표시한 점수, 높을수록 위험 낮음",
  },
  {
    key: "marketSimilarity",
    spokeLabel: "동종군",
    fullLabel: "동종군 유사도",
    scoreKey: "marketSimilarityScore",
    helpKey: "marketSimilarity",
  },
  {
    key: "durabilityProfitability",
    spokeLabel: "내구",
    fullLabel: "내구 수익성",
    scoreKey: "durabilityProfitabilityScore",
    coverageKey: "durabilityProfitabilityCoverage",
    helpKey: "durabilityProfitability",
  },
];

interface ShortTermAxisConfig {
  key: string;
  spokeLabel: string;
  fullLabel: string;
  scoreKey: keyof FenokSignalsSummaryRecord;
  directionKey?: keyof FenokSignalsSummaryRecord;
  helpKey: FenokSignalHelpKey;
  invertScore?: boolean;
  tooltipNote?: string;
}

interface ShortTermAxis extends FenokSignalRadarHexagonAxis {
  key: string;
  helpKey: FenokSignalHelpKey;
  fullLabel: string;
  coverage: number | null;
  tooltipNote?: string | null;
  meta: {
    tier: string | null;
    tone: "up" | "warn" | "down" | "neutral";
  };
}

const SHORT_TERM_AXIS_CONFIG: ShortTermAxisConfig[] = [
  {
    key: "technicalFlow",
    spokeLabel: "기술·자금",
    fullLabel: "기술·자금 흐름",
    scoreKey: "technicalFlowScore",
    directionKey: "technicalFlowDirection",
    helpKey: "technicalFlow",
  },
  {
    key: "volumeLiquidityTrend",
    spokeLabel: "거래량",
    fullLabel: "거래량·유동성 추세",
    scoreKey: "volumeLiquidityTrendScore",
    directionKey: "volumeLiquidityTrendDirection",
    helpKey: "volumeLiquidityTrend",
    tooltipNote: "로컬 OHLCV 프록시, 실제 주문 흐름 아님",
  },
  {
    key: "shortTermRelativeStrength",
    spokeLabel: "상대강도",
    fullLabel: "단기 상대 강도",
    scoreKey: "shortTermRelativeStrengthScore",
    directionKey: "shortTermRelativeStrengthDirection",
    helpKey: "shortTermRelativeStrength",
    tooltipNote: "20일/60일 SPY 대비 상대 강도 프록시",
  },
  {
    key: "netOptionsProxy",
    spokeLabel: "옵션",
    fullLabel: "옵션 활동 프록시",
    scoreKey: "netOptionsProxyScore",
    helpKey: "netOptionsProxy",
    tooltipNote: "OCC 옵션 거래량 편향, 실제 플로우 아님",
  },
  {
    key: "offExchangeActivityProxy",
    spokeLabel: "장외거래",
    fullLabel: "장외거래 활동 프록시",
    scoreKey: "offExchangeActivityProxyScore",
    helpKey: "offExchangeActivityProxy",
    tooltipNote: "FINRA 공개 데이터 파생, 다크풀/방향 신호 아님",
  },
  {
    key: "shortPressureProxy",
    spokeLabel: "숏완화",
    fullLabel: "숏압력 완화",
    scoreKey: "shortPressureProxyScore",
    helpKey: "shortPressureProxy",
    invertScore: true,
    tooltipNote: "숏 볼륨 압력을 뒤집어 표시한 점수, 높을수록 압력 낮음",
  },
];

function deriveAxisMeta(
  score: number | null,
  helpKey: FenokSignalHelpKey,
  invertedDisplay = false,
): { tier: string | null; tone: LongTermAxis["meta"]["tone"]; direction: string | null } {
  const band = lookupBand(getDisplaySignalHelpBands(helpKey, invertedDisplay), score);
  const tier = band?.label ?? null;
  const tone = band?.tone ?? "neutral";
  let direction: string | null = null;
  if (tone === "up") direction = "constructive";
  if (tone === "warn") direction = "neutral";
  if (tone === "down") direction = "weak";
  return { tier, tone, direction };
}

function buildLongTermAxes(record: FenokSignalsSummaryRecord): LongTermAxis[] {
  return LONG_TERM_AXIS_CONFIG.map((config) => {
    const rawScore = record[config.scoreKey];
    let score = isFiniteNumber(rawScore) ? rawScore : null;
    if (score !== null && config.invertScore) {
      score = Math.max(0, Math.min(100, 100 - score));
    }
    const rawDirection = config.directionKey ? record[config.directionKey] : null;
    const explicitDirection =
      typeof rawDirection === "string" && rawDirection !== "unavailable" ? rawDirection : null;
    const rawCoverage = config.coverageKey ? record[config.coverageKey] : null;
    const coverage = isFiniteNumber(rawCoverage) ? rawCoverage : null;
    const meta = deriveAxisMeta(score, config.helpKey, Boolean(config.invertScore));
    return {
      key: config.key,
      label: config.spokeLabel,
      fullLabel: config.fullLabel,
      score,
      direction: explicitDirection ?? meta.direction,
      tier: meta.tier,
      helpKey: config.helpKey,
      coverage,
      tooltipNote: config.tooltipNote ?? null,
      invertedDisplay: Boolean(config.invertScore),
      meta,
    };
  });
}

function buildShortTermAxes(record: FenokSignalsSummaryRecord): ShortTermAxis[] {
  return SHORT_TERM_AXIS_CONFIG.map((config) => {
    const rawScore = record[config.scoreKey];
    let score = isFiniteNumber(rawScore) ? rawScore : null;
    if (score !== null && config.invertScore) {
      score = Math.max(0, Math.min(100, 100 - score));
    }
    const rawDirection = config.directionKey ? record[config.directionKey] : null;
    const explicitDirection =
      typeof rawDirection === "string" && rawDirection !== "unavailable" ? rawDirection : null;
    const meta = deriveAxisMeta(score, config.helpKey, Boolean(config.invertScore));
    return {
      key: config.key,
      label: config.spokeLabel,
      fullLabel: config.fullLabel,
      score,
      direction: explicitDirection ?? meta.direction,
      tier: meta.tier,
      helpKey: config.helpKey,
      tooltipNote: config.tooltipNote ?? null,
      coverage: null,
      invertedDisplay: Boolean(config.invertScore),
      meta,
    };
  });
}

function LongTermAxisLegend({ axis }: { axis: LongTermAxis }) {
  const width = axis.score === null ? 0 : Math.max(0, Math.min(100, axis.score));
  const scoreText = formatScore(axis.score);
  const tierText = axis.meta.tier ?? "미확인";
  const directionText = axisDirectionKo(axis.direction, "미확인");
  const ariaLabel = `${axis.fullLabel}: ${scoreText}점, ${directionText}, ${tierText}${axis.tooltipNote ? ` · ${axis.tooltipNote}` : ""}`;
  return (
    <div
      aria-label={ariaLabel}
      className="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--c-line)] bg-[var(--c-panel)] px-2.5 py-2"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-black text-[var(--c-ink)]">
          {axis.fullLabel}
        </div>
        {axis.tooltipNote ? (
          <div className="truncate text-[10px] font-semibold text-[var(--c-ink-2)]">
            {axis.tooltipNote}
          </div>
        ) : null}
        {axis.coverage !== null ? (
          <div className="truncate text-[10px] font-semibold text-[var(--c-ink-2)]">
            데이터 {formatCoverage(axis.coverage)}
          </div>
        ) : null}
      </div>
      <FenokSignalHelpPopover
        signal={axis.helpKey}
        score={axis.score}
        direction={axis.direction}
        invertedDisplay={axis.invertedDisplay}
      />
      {axis.meta.tier && axis.score !== null ? (
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black ${toneClass(axis.meta.tone)}`}
        >
          {axis.meta.tier}
        </span>
      ) : null}
      <span className="orbitron shrink-0 text-sm font-black tabular-nums text-[var(--c-ink)]">
        {scoreText}
      </span>
      <div className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-[var(--c-surface-2)] sm:block">
        <div
          className={`h-full rounded-full ${
            axis.meta.tone === "up"
              ? "bg-[var(--c-up)]"
              : axis.meta.tone === "warn"
                ? "bg-[var(--c-warn)]"
                : axis.meta.tone === "down"
                  ? "bg-[var(--c-down)]"
                  : "bg-[var(--c-line)]"
          }`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

export default function FenokSignalLensCard({ record }: FenokSignalLensCardProps) {
  if (!record) return null;

  if (!hasLensUiData(record)) {
    return <LegacyFenokSignalLensCard record={record} />;
  }

  const longTermAxes = buildLongTermAxes(record);
  const shortTermAxes = buildShortTermAxes(record);
  const hasLongTermSignal = longTermAxes.some((axis) => axis.score !== null);
  const hasShortTermSignal = shortTermAxes.some((axis) => axis.score !== null);
  const coverage = record.lensCoverageRatio ?? record.coverageRatio;

  const rawLongTermCall = record.longTermConvictionCall ?? record.convictionCall;
  const longTermScore = isFiniteNumber(record.longTermConvictionScore)
    ? Math.round(record.longTermConvictionScore)
    : isFiniteNumber(record.convictionScore)
      ? Math.round(record.convictionScore)
      : null;
  const longTermCall = rawLongTermCall ?? null;

  const rawShortTermCall = record.shortTermConvictionCall ?? record.convictionCall;
  const shortTermScore = isFiniteNumber(record.shortTermConvictionScore)
    ? Math.round(record.shortTermConvictionScore)
    : isFiniteNumber(record.shortTermScore)
      ? Math.round(record.shortTermScore)
      : isFiniteNumber(record.convictionScore)
        ? Math.round(record.convictionScore)
        : null;
  const shortTermCall = rawShortTermCall ?? null;

  return (
    <section className="panel overflow-hidden border border-[var(--c-line)] bg-[var(--c-panel)] shadow-[var(--sh-sm)]">
      <div className="border-b border-[var(--c-line-2)] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="text-[11px] font-black uppercase tracking-[0.08em] text-[var(--c-ink)]">
              Fenok Signal Lens
            </h2>
            <span className="rounded-full bg-[var(--c-brand-soft)] px-2 py-0.5 text-[9px] font-black text-[var(--c-brand)]">
              장기 6축
            </span>
            <span className="rounded-full bg-[var(--c-brand-soft)] px-2 py-0.5 text-[9px] font-black text-[var(--c-brand)]">
              단기 6축
            </span>
          </div>
          <span className="text-[9px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">
            매수 권유 아님
          </span>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="flex flex-wrap justify-center gap-3">
          <div className="flex flex-col items-center gap-1.5 rounded-xl border border-[var(--c-line)] bg-[var(--c-surface-2)] px-5 py-2.5">
            <span className="text-[10px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">
              단기 Conviction
            </span>
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-base font-black tabular-nums ${convictionTone(shortTermCall)}`}
              title="Fenok 단기 6축 종합 점수"
            >
              <span>{convictionCallKo(shortTermCall)}</span>
              {shortTermScore ?? "—"}
            </span>
          </div>
          <div className="flex flex-col items-center gap-1.5 rounded-xl border border-[var(--c-line)] bg-[var(--c-surface-2)] px-5 py-2.5">
            <span className="text-[10px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">
              장기 Conviction
            </span>
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-base font-black tabular-nums ${convictionTone(longTermCall)}`}
              title="Fenok 장기 6축 종합 점수"
            >
              <span>{convictionCallKo(longTermCall)}</span>
              {longTermScore ?? "—"}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-center gap-6 lg:flex-row lg:items-start lg:justify-center">
          <FenokSignalRadarHexagon title="Short-term" axes={shortTermAxes} size="lg" />
          <FenokSignalRadarHexagon title="Long-term" axes={longTermAxes} size="lg" />
        </div>

        <p className="text-center text-[10px] font-bold text-[var(--c-ink-3)]">
          Fenok 파생 신호 · 매수 권유 아님
        </p>

        <div className="grid gap-4 lg:grid-cols-2">
          {hasShortTermSignal ? (
            <div className="space-y-2">
              <h3 className="text-[10px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">
                단기 축
              </h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {shortTermAxes.map((axis) => (
                  <LongTermAxisLegend key={axis.key} axis={axis} />
                ))}
              </div>
            </div>
          ) : null}
          {hasLongTermSignal ? (
            <div className="space-y-2">
              <h3 className="text-[10px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">
                장기 축
              </h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {longTermAxes.map((axis) => (
                  <LongTermAxisLegend key={axis.key} axis={axis} />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <p className="text-[10px] font-bold text-[var(--c-ink-3)]">
          Fenok 파생 신호 · 매수 권유 아님 · as_of {formatAsOf(record.asOf)} · coverage{" "}
          {formatCoverage(coverage)}
        </p>
      </div>

      <p className="border-t border-[var(--c-line-2)] bg-[var(--c-surface-2)]/50 px-4 py-2 text-[10px] font-bold text-[var(--c-ink-3)]">
        Fenok 파생 프록시 · 제3자 점수/원본 미사용 · as_of {formatAsOf(record.asOf)} · coverage{" "}
        {formatCoverage(coverage)}
      </p>
    </section>
  );
}
