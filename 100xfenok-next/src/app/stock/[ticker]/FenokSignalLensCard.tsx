import type { FenokSignalsSummaryRecord } from "@/features/stock-analyzer/data/fenok-signals-summary-provider";

interface FenokSignalLensCardProps {
  record: FenokSignalsSummaryRecord | null | undefined;
}

type SignalKey =
  | "profitability"
  | "growth"
  | "technicalFlow"
  | "upsideDownside"
  | "marketSimilarity";

interface SignalConfig {
  key: SignalKey;
  label: string;
  scoreKey: keyof FenokSignalsSummaryRecord;
  directionKey: keyof FenokSignalsSummaryRecord;
}

const SIGNALS: SignalConfig[] = [
  {
    key: "profitability",
    label: "수익성",
    scoreKey: "profitabilityScore",
    directionKey: "profitabilityDirection",
  },
  {
    key: "growth",
    label: "성장",
    scoreKey: "growthScore",
    directionKey: "growthDirection",
  },
  {
    key: "technicalFlow",
    label: "가격 흐름",
    scoreKey: "technicalFlowScore",
    directionKey: "technicalFlowDirection",
  },
  {
    key: "upsideDownside",
    label: "상방/하방",
    scoreKey: "upsideDownsideScore",
    directionKey: "upsideDownsideDirection",
  },
  {
    key: "marketSimilarity",
    label: "유사 종목",
    scoreKey: "marketSimilarityScore",
    directionKey: "marketSimilarityDirection",
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
  if (key === "marketSimilarity" && value === "peer_comparable") return "비교 가능";
  if (value === "strong") return "강함";
  if (value === "constructive") return "우호";
  if (value === "neutral") return "중립";
  if (value === "weak") return "약함";
  if (value === "stressed") return "압박";
  return value.replaceAll("_", " ");
}

function scoreTone(score: number | null, confidence: string | null | undefined): string {
  if (score === null || confidence === "low") {
    return "border-slate-200 bg-slate-50 text-slate-500";
  }
  if (score >= 70) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (score <= 30) return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-slate-200 bg-white text-slate-800";
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
  return value === null ? "-" : Math.round(value).toString();
}

export default function FenokSignalLensCard({ record }: FenokSignalLensCardProps) {
  if (!record) return null;

  const chips = SIGNALS.map((signal) => {
    const scoreValue = record[signal.scoreKey];
    const score = isFiniteNumber(scoreValue) ? scoreValue : null;
    const directionValue = record[signal.directionKey];
    const direction = typeof directionValue === "string" ? directionValue : null;
    return {
      ...signal,
      score,
      direction,
    };
  });
  const hasSignal = chips.some((chip) => chip.score !== null);
  if (!hasSignal) return null;

  const confidence = record.confidence ?? null;

  return (
    <section className="panel overflow-hidden border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[11px] font-black uppercase tracking-[0.08em] text-slate-900">
            Fenok 신호 렌즈
          </h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black text-slate-600">
            {confidenceKo(confidence)}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
        {chips.map((chip) => (
          <div
            key={chip.key}
            className={`min-h-16 rounded-lg border px-2.5 py-2 ${scoreTone(chip.score, confidence)}`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 text-[10px] font-black text-current">{chip.label}</span>
              <span className="orbitron shrink-0 text-sm font-black tabular-nums">{formatScore(chip.score)}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[9px] font-black">
              <span>{directionKo(chip.key, chip.direction)}</span>
              {chip.score === null || confidence === "low" ? (
                <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-slate-500">프록시 낮음</span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <p className="border-t border-slate-100 px-3 py-2 text-[10px] font-bold text-slate-500">
        Fenok 파생 프록시 · as_of {formatAsOf(record.asOf)} · coverage {formatCoverage(record.coverageRatio)}
      </p>
    </section>
  );
}
