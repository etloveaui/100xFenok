import type { FenokSignalsSummaryRecord } from "@/features/stock-analyzer/data/fenok-signals-summary-provider";
import { FenokSignalRadar } from "@/components/screener/FenokSignalRadar";
import FenokSignalHelpPopover from "@/components/screener/FenokSignalHelpPopover";
import type { FenokSignalHelpKey } from "@/lib/fenok-signals/signal-help-config";

interface FenokSignalLensCardProps {
  record: FenokSignalsSummaryRecord | null | undefined;
}

type SignalKey =
  | "profitability"
  | "durabilityProfitability"
  | "growth"
  | "technicalFlow"
  | "upsidePotential"
  | "downsidePressure";

interface SignalConfig {
  key: SignalKey;
  label: string;
  scoreKey: keyof FenokSignalsSummaryRecord;
  directionKey: keyof FenokSignalsSummaryRecord;
  interpretation: string;
  helpKey: FenokSignalHelpKey;
  inverted?: boolean;
  coverageKey?: keyof FenokSignalsSummaryRecord;
}

const SIGNALS: SignalConfig[] = [
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
  if (value === "constructive") return "우호";
  if (value === "neutral") return "중립";
  if (value === "weak") return "약함";
  if (value === "stressed") return "압박";
  return value.replaceAll("_", " ");
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

function scoreBarColor(score: number | null, inverted = false): string {
  if (score === null || score === undefined) return "bg-[var(--c-line)]";
  if (inverted) {
    if (score >= 70) return "bg-[var(--c-down)]";
    if (score >= 50) return "bg-[var(--c-warn)]";
    return "bg-[var(--c-up)]";
  }
  if (score >= 70) return "bg-[var(--c-up)]";
  if (score >= 50) return "bg-[var(--c-warn)]";
  return "bg-[var(--c-down)]";
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

export default function FenokSignalLensCard({ record }: FenokSignalLensCardProps) {
  if (!record) return null;

  const chips = SIGNALS.map((signal) => {
    const scoreValue = record[signal.scoreKey];
    const score = isFiniteNumber(scoreValue) ? scoreValue : null;
    const directionValue = record[signal.directionKey];
    const direction = typeof directionValue === "string" ? directionValue : null;
    const coverageValue = signal.coverageKey ? record[signal.coverageKey] : null;
    const coverage = isFiniteNumber(coverageValue) ? coverageValue : null;
    return { ...signal, score, direction, coverage };
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
            매수권유 아님
          </span>
        </div>
      </div>

      <div className="p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-black tabular-nums ${convictionTone(convictionCall)}`}
              title="Fenok 4-신호 동등가중 종합 점수"
            >
              <span aria-hidden="true">{convictionCallKo(convictionCall)}</span>
              {convictionScore ?? "—"}
            </span>
            <span className="text-[10px] font-bold text-[var(--c-ink-3)]">
              Fenok 4-신호 동등가중 종합
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
              const width = chip.score === null ? 0 : Math.max(0, Math.min(100, chip.score));
              const directionText = directionKo(chip.key, chip.direction);
              return (
                <div key={chip.key} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="text-xs font-black text-[var(--c-ink)]">{chip.label}</span>
                      <FenokSignalHelpPopover
                        signal={chip.helpKey}
                        score={chip.score}
                        direction={chip.direction}
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
                      {formatScore(chip.score)}
                      {directionText ? (
                        <span className="ml-1 text-[10px] font-bold text-[var(--c-ink-3)]">
                          {directionText}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--c-surface-2)]">
                    <div
                      className={`h-full rounded-full transition-all ${scoreBarColor(chip.score, chip.inverted)}`}
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
        Fenok 파생 프록시 · 매수권유 아님 · as_of {formatAsOf(record.asOf)} · coverage{" "}
        {formatCoverage(record.coverageRatio)}
      </p>
    </section>
  );
}
