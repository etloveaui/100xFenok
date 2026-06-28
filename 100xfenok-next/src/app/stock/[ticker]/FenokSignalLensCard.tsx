import type { FenokSignalsSummaryRecord } from "@/features/stock-analyzer/data/fenok-signals-summary-provider";
import { FenokSignalRadar } from "@/components/screener/FenokSignalRadar";

interface FenokSignalLensCardProps {
  record: FenokSignalsSummaryRecord | null | undefined;
}

type SignalKey = "profitability" | "growth" | "technicalFlow" | "upsideDownside";

interface SignalConfig {
  key: SignalKey;
  label: string;
  scoreKey: keyof FenokSignalsSummaryRecord;
  directionKey: keyof FenokSignalsSummaryRecord;
  interpretation: string;
}

const SIGNALS: SignalConfig[] = [
  {
    key: "profitability",
    label: "수익성",
    scoreKey: "profitabilityScore",
    directionKey: "profitabilityDirection",
    interpretation: "기업의 이익 창출 능력과 자본 효율성",
  },
  {
    key: "growth",
    label: "성장",
    scoreKey: "growthScore",
    directionKey: "growthDirection",
    interpretation: "향후 매출·이익 성장 잠재력",
  },
  {
    key: "technicalFlow",
    label: "기술·자금",
    scoreKey: "technicalFlowScore",
    directionKey: "technicalFlowDirection",
    interpretation: "가격 모멘텀과 자금 흐름의 기술적 상태",
  },
  {
    key: "upsideDownside",
    label: "Fenok Edge",
    scoreKey: "upsideDownsideScore",
    directionKey: "upsideDownsideDirection",
    interpretation: "상대적 상방/하방 기대의 파생 프록시",
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
  if (!value || value === "unavailable") return "미확인";
  if (key === "upsideDownside") {
    if (value === "upside_bias") return "상방 우위";
    if (value === "downside_bias") return "하방 압력";
    if (value === "balanced") return "균형";
  }
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
  if (call === "concentrated") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (call === "mixed") return "border-cyan-200 bg-cyan-50 text-cyan-700";
  if (call === "diluted") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-500";
}

function scoreTone(score: number | null): string {
  if (score === null || score === undefined) return "bg-slate-100";
  if (score >= 70) return "bg-emerald-500";
  if (score >= 50) return "bg-cyan-500";
  if (score >= 30) return "bg-amber-500";
  return "bg-rose-500";
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
    return { ...signal, score, direction };
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
              return (
                <div key={chip.key} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="text-xs font-black text-[var(--c-ink)]">{chip.label}</span>
                      <span className="truncate text-[10px] font-semibold text-[var(--c-ink-3)]">
                        {chip.interpretation}
                      </span>
                    </div>
                    <span className="orbitron shrink-0 text-sm font-black tabular-nums text-[var(--c-ink)]">
                      {formatScore(chip.score)}
                      <span className="ml-1 text-[10px] font-bold text-[var(--c-ink-3)]">
                        {directionKo(chip.key, chip.direction)}
                      </span>
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--c-surface-2)]">
                    <div
                      className={`h-full rounded-full transition-all ${scoreTone(chip.score)}`}
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
