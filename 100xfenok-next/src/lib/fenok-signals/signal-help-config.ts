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
  | "directNewsToneProxy";

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
  durabilityProfitability: makeDefaultEntry(
    "durabilityProfitability",
    "내구 수익성",
    "수익성의 지속 가능성과 재무적 내구력을 종합한 Fenok 파생 신호예요.",
  ),
  upsidePotential: makeDefaultEntry(
    "upsidePotential",
    "상승 잠재력",
    "Fenok 파생 신호로 산출한 상대적 상승 잠재력이에요.",
  ),
  downsidePressure: {
    key: "downsidePressure",
    label: "하락 압력",
    interpretation:
      "Fenok 파생 신호로 산출한 상대적 하락 압력 축이에요. 점수가 높을수록 위험이 커요.",
    bands: [
      { min: 81, max: 100, label: "위험 높음", tone: "down" },
      { min: 61, max: 80, label: "위험 다소", tone: "warn" },
      { min: 41, max: 60, label: "보통", tone: "warn" },
      { min: 0, max: 40, label: "안정", tone: "up" },
    ],
  },
  marketSimilarity: makeDefaultEntry(
    "marketSimilarity",
    "동종군 유사도",
    "동종 섹터/산업군의 대표 종목들과 움직임이 얼마나 비슷한지 산출한 Fenok 파생 축이에요.",
  ),
  sp500TrackingSimilarity: makeDefaultEntry(
    "sp500TrackingSimilarity",
    "S&P500 추종 유사도",
    "1년 일별 수익률 기준으로 S&P500 움직임과 얼마나 비슷하게 움직였는지 산출한 Fenok 파생 축이에요.",
  ),
  technicalIndicatorProxy: makeDefaultEntry(
    "technicalIndicatorProxy",
    "기술 지표",
    "RSI, 이동평균 위치, 20/60일 수익률, 거래량 확장을 묶은 Fenok 기술 지표 프록시예요.",
  ),
  netOptionsProxy: makeDefaultEntry(
    "netOptionsProxy",
    "옵션 프록시",
    "공개/허용 소스의 옵션 체인과 콜·풋 성격을 이용한 Fenok 파생 프록시예요. 실제 매수·매도 주체 흐름은 아니에요.",
  ),
  offExchangeActivityProxy: makeDefaultEntry(
    "offExchangeActivityProxy",
    "오프거래소",
    "FINRA 계열 공개 데이터에서 파생한 오프거래소 활동 프록시예요. 실시간 다크풀 의도 신호로 해석하면 안 돼요.",
  ),
  shortPressureProxy: {
    key: "shortPressureProxy",
    label: "숏 압력",
    interpretation:
      "공개 short volume/short activity 데이터를 이용한 Fenok 파생 압력 축이에요. 점수가 높을수록 숏 관련 압력이 큰 쪽이에요.",
    bands: [
      { min: 81, max: 100, label: "압력 높음", tone: "down" },
      { min: 61, max: 80, label: "압력 다소", tone: "warn" },
      { min: 41, max: 60, label: "중립", tone: "warn" },
      { min: 0, max: 40, label: "압력 낮음", tone: "up" },
    ],
  },
  directNewsToneProxy: makeDefaultEntry(
    "directNewsToneProxy",
    "뉴스톤",
    "허용된 뉴스/문서 소스에서 파생한 직접 뉴스 톤 프록시예요. 소셜 원문 수집이 승인되기 전까지는 저신뢰 보조축이에요.",
  ),
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
