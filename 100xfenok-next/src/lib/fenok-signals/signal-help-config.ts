import { edgeAxisFullLabel, edgeAxisTooltip } from "./edge-axis-labels.mjs";

export type FenokSignalHelpKey =
  | "profitability"
  | "growth"
  | "technicalFlow"
  | "upsideDownside"
  | "durabilityProfitability"
  | "upsidePotential"
  | "downsidePressure"
  | "marketSimilarity"
  | "sp500TrackingSimilarity"
  | "technicalIndicatorProxy"
  | "netOptionsProxy"
  | "offExchangeActivityProxy"
  | "shortPressureProxy"
  | "directNewsToneProxy"
  | "volumeLiquidityTrend"
  | "shortTermRelativeStrength";

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
  { min: 61, max: 80, label: "양호", tone: "up" },
  { min: 41, max: 60, label: "중립", tone: "warn" },
  { min: 0, max: 40, label: "약함", tone: "down" },
];

const DOWNSIDE_SAFETY_BANDS: FenokSignalHelpBand[] = [
  { min: 81, max: 100, label: "낮음", tone: "up" },
  { min: 61, max: 80, label: "안정", tone: "up" },
  { min: 41, max: 60, label: "보통", tone: "warn" },
  { min: 0, max: 40, label: "위험", tone: "down" },
];

const SHORT_PRESSURE_SAFETY_BANDS: FenokSignalHelpBand[] = [
  { min: 81, max: 100, label: "낮음", tone: "up" },
  { min: 61, max: 80, label: "관리", tone: "up" },
  { min: 41, max: 60, label: "중립", tone: "warn" },
  { min: 0, max: 40, label: "높음", tone: "down" },
];

function makeDefaultEntry(
  key: Exclude<FenokSignalHelpKey, "upsideDownside" | "downsidePressure" | "shortPressureProxy">,
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
    edgeAxisFullLabel("profitabilityScore"),
    edgeAxisTooltip("profitabilityScore"),
  ),
  growth: makeDefaultEntry(
    "growth",
    edgeAxisFullLabel("growthScore"),
    edgeAxisTooltip("growthScore"),
  ),
  technicalFlow: makeDefaultEntry(
    "technicalFlow",
    edgeAxisFullLabel("technicalFlowScore"),
    edgeAxisTooltip("technicalFlowScore"),
  ),
  upsideDownside: {
    key: "upsideDownside",
    label: "Fenok Edge",
    interpretation:
      "Fenok 파생 신호로 산출한 상대적 상방·하방 기대치입니다.",
    bands: [
      { min: 81, max: 100, label: "상방 우세", tone: "up" },
      { min: 61, max: 80, label: "상방 양호", tone: "up" },
      { min: 41, max: 60, label: "균형", tone: "warn" },
      { min: 0, max: 40, label: "하방 우세", tone: "down" },
    ],
  },
  durabilityProfitability: makeDefaultEntry(
    "durabilityProfitability",
    edgeAxisFullLabel("durabilityProfitabilityScore"),
    edgeAxisTooltip("durabilityProfitabilityScore"),
  ),
  upsidePotential: makeDefaultEntry(
    "upsidePotential",
    edgeAxisFullLabel("upsidePotentialScore"),
    edgeAxisTooltip("upsidePotentialScore"),
  ),
  downsidePressure: {
    key: "downsidePressure",
    label: edgeAxisFullLabel("downsidePressureScore"),
    interpretation: edgeAxisTooltip("downsidePressureScore"),
    bands: [
      { min: 81, max: 100, label: "위험", tone: "down" },
      { min: 61, max: 80, label: "주의", tone: "warn" },
      { min: 41, max: 60, label: "보통", tone: "warn" },
      { min: 0, max: 40, label: "안정", tone: "up" },
    ],
  },
  marketSimilarity: makeDefaultEntry(
    "marketSimilarity",
    edgeAxisFullLabel("marketSimilarityScore"),
    edgeAxisTooltip("marketSimilarityScore"),
  ),
  sp500TrackingSimilarity: makeDefaultEntry(
    "sp500TrackingSimilarity",
    "S&P500 추종 유사도",
    "1년 일별 수익률 기준으로 S&P500 움직임과 얼마나 비슷하게 움직였는지 산출한 Fenok 파생 축입니다.",
  ),
  technicalIndicatorProxy: makeDefaultEntry(
    "technicalIndicatorProxy",
    "기술 지표",
    "상대강도지수(RSI), 이동평균 위치, 20·60일 수익률, 거래량 확장을 묶은 Fenok 기술 지표 프록시입니다.",
  ),
  netOptionsProxy: makeDefaultEntry(
    "netOptionsProxy",
    edgeAxisFullLabel("netOptionsProxyScore"),
    edgeAxisTooltip("netOptionsProxyScore"),
  ),
  offExchangeActivityProxy: makeDefaultEntry(
    "offExchangeActivityProxy",
    edgeAxisFullLabel("offExchangeActivityProxyScore"),
    edgeAxisTooltip("offExchangeActivityProxyScore"),
  ),
  shortPressureProxy: {
    key: "shortPressureProxy",
    label: edgeAxisFullLabel("shortPressureProxyScore"),
    interpretation: edgeAxisTooltip("shortPressureProxyScore"),
    bands: [
      { min: 81, max: 100, label: "높음", tone: "down" },
      { min: 61, max: 80, label: "주의", tone: "warn" },
      { min: 41, max: 60, label: "중립", tone: "warn" },
      { min: 0, max: 40, label: "낮음", tone: "up" },
    ],
  },
  directNewsToneProxy: makeDefaultEntry(
    "directNewsToneProxy",
    "뉴스 톤",
    "허용된 뉴스·문서 소스에서 파생한 직접 뉴스 톤 프록시입니다. 소셜 원문 수집이 승인되기 전까지는 신뢰도가 낮은 보조축입니다.",
  ),
  volumeLiquidityTrend: makeDefaultEntry(
    "volumeLiquidityTrend",
    edgeAxisFullLabel("volumeLiquidityTrendScore"),
    edgeAxisTooltip("volumeLiquidityTrendScore"),
  ),
  shortTermRelativeStrength: makeDefaultEntry(
    "shortTermRelativeStrength",
    edgeAxisFullLabel("shortTermRelativeStrengthScore"),
    edgeAxisTooltip("shortTermRelativeStrengthScore"),
  ),
};

export function getSignalHelpEntry(key: FenokSignalHelpKey): FenokSignalHelpEntry {
  return FENOK_SIGNAL_HELP_REGISTRY[key];
}

export function getDisplaySignalHelpBands(
  key: FenokSignalHelpKey,
  invertedDisplay = false,
): FenokSignalHelpBand[] {
  if (!invertedDisplay) return getSignalHelpEntry(key).bands;
  if (key === "downsidePressure") return DOWNSIDE_SAFETY_BANDS;
  if (key === "shortPressureProxy") return SHORT_PRESSURE_SAFETY_BANDS;
  return getSignalHelpEntry(key).bands;
}

export function getDisplaySignalLabel(
  key: FenokSignalHelpKey,
  invertedDisplay = false,
): string {
  return edgeAxisFullLabel(`${key}Score`, invertedDisplay) ?? getSignalHelpEntry(key).label;
}

export function getDisplaySignalInterpretation(
  key: FenokSignalHelpKey,
  invertedDisplay = false,
): string {
  return edgeAxisTooltip(`${key}Score`, invertedDisplay) ?? getSignalHelpEntry(key).interpretation;
}

export function lookupBand(
  entryOrBands: FenokSignalHelpEntry | FenokSignalHelpBand[],
  score: number | null | undefined,
): FenokSignalHelpBand | null {
  if (score === null || score === undefined || Number.isNaN(score)) return null;
  const clamped = Math.max(0, Math.min(100, score));
  const bands = Array.isArray(entryOrBands) ? entryOrBands : entryOrBands.bands;
  return (
    bands.find((band) => clamped >= band.min && clamped <= band.max) ??
    null
  );
}

export function toneClass(tone: FenokSignalTone): string {
  switch (tone) {
    case "up":
      return "bg-[var(--c-up-soft)] text-[var(--c-up)]";
    case "warn":
      return "bg-[var(--c-warn-soft)] text-[var(--c-warn-ink)] border border-[var(--c-warn)]";
    case "down":
      return "bg-[var(--c-down-soft)] text-[var(--c-down)]";
    case "neutral":
      return "bg-[var(--c-surface-2)] text-[var(--c-ink-3)]";
  }
}
