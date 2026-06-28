export type FenokSignalHelpKey =
  | "profitability"
  | "growth"
  | "technicalFlow"
  | "upsideDownside";

export type FenokSignalTone = "up" | "warn" | "down" | "neutral";

export interface FenokSignalHelpBand {
  min: number;
  max: number;
  label: string;
  tone: FenokSignalTone;
}

export interface FenokSignalHelpEntry {
  key: FenokSignalHelpKey;
  label: string;
  interpretation: string;
  bands: FenokSignalHelpBand[];
}

const DEFAULT_BANDS: FenokSignalHelpBand[] = [
  { min: 81, max: 100, label: "강함", tone: "up" },
  { min: 61, max: 80, label: "우호", tone: "up" },
  { min: 41, max: 60, label: "중립", tone: "warn" },
  { min: 0, max: 40, label: "위약", tone: "down" },
];

function makeDefaultEntry(
  key: Exclude<FenokSignalHelpKey, "upsideDownside">,
  label: string,
  interpretation: string,
): FenokSignalHelpEntry {
  return { key, label, interpretation, bands: DEFAULT_BANDS };
}

export const FENOK_SIGNAL_HELP_REGISTRY: Record<
  FenokSignalHelpKey,
  FenokSignalHelpEntry
> = {
  profitability: makeDefaultEntry(
    "profitability",
    "수익성",
    "기업의 이익 창출 능력과 자본 효율성을 종합한 Fenok 파생 신호예요.",
  ),
  growth: makeDefaultEntry(
    "growth",
    "성장",
    "향후 매출·이익 성장 잠재력을 종합한 Fenok 파생 신호예요.",
  ),
  technicalFlow: makeDefaultEntry(
    "technicalFlow",
    "기술·자금",
    "가격 모멘텀과 자금 흐름의 기술적 상태를 종합한 Fenok 파생 신호예요.",
  ),
  upsideDownside: {
    key: "upsideDownside",
    label: "Fenok Edge",
    interpretation:
      "Fenok 파생 신호로 산출한 상대적 상방/하방 기대치예요.",
    bands: [
      { min: 81, max: 100, label: "상방 우세", tone: "up" },
      { min: 61, max: 80, label: "상방 우호", tone: "up" },
      { min: 41, max: 60, label: "균형", tone: "warn" },
      { min: 0, max: 40, label: "하방 우세", tone: "down" },
    ],
  },
};

export function getSignalHelpEntry(key: FenokSignalHelpKey): FenokSignalHelpEntry {
  return FENOK_SIGNAL_HELP_REGISTRY[key];
}

export function lookupBand(
  entry: FenokSignalHelpEntry,
  score: number | null | undefined,
): FenokSignalHelpBand | null {
  if (score === null || score === undefined || Number.isNaN(score)) return null;
  const clamped = Math.max(0, Math.min(100, score));
  return (
    entry.bands.find((band) => clamped >= band.min && clamped <= band.max) ??
    null
  );
}

export function toneClass(tone: FenokSignalTone): string {
  switch (tone) {
    case "up":
      return "bg-[var(--c-up-soft)] text-[var(--c-up)]";
    case "warn":
      return "bg-[var(--c-warn-soft)] text-[var(--c-warn)]";
    case "down":
      return "bg-[var(--c-down-soft)] text-[var(--c-down)]";
    case "neutral":
      return "bg-[var(--c-surface-2)] text-[var(--c-ink-3)]";
  }
}
