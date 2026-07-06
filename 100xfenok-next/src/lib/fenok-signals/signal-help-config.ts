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
    "수익성",
    "기업의 이익 창출 능력과 자본 효율성을 종합한 Fenok 파생 신호입니다.",
  ),
  growth: makeDefaultEntry(
    "growth",
    "성장",
    "향후 매출·이익 성장 잠재력을 종합한 Fenok 파생 신호입니다.",
  ),
  technicalFlow: makeDefaultEntry(
    "technicalFlow",
    "기술·자금",
    "가격 모멘텀과 자금 흐름의 기술적 상태를 종합한 Fenok 파생 신호입니다.",
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
    "내구 수익성",
    "수익성의 지속 가능성과 재무적 내구력을 종합한 Fenok 파생 신호입니다.",
  ),
  upsidePotential: makeDefaultEntry(
    "upsidePotential",
    "상승 잠재력",
    "Fenok 파생 신호로 산출한 상대적 상승 잠재력입니다.",
  ),
  downsidePressure: {
    key: "downsidePressure",
    label: "하락 압력",
    interpretation:
      "Fenok 파생 신호로 산출한 상대적 하락 압력 축입니다. 점수가 높을수록 위험이 큽니다.",
    bands: [
      { min: 81, max: 100, label: "위험", tone: "down" },
      { min: 61, max: 80, label: "주의", tone: "warn" },
      { min: 41, max: 60, label: "보통", tone: "warn" },
      { min: 0, max: 40, label: "안정", tone: "up" },
    ],
  },
  marketSimilarity: makeDefaultEntry(
    "marketSimilarity",
    "동종군 유사도",
    "동종 섹터·산업군의 대표 종목들과 움직임이 얼마나 비슷한지 산출한 Fenok 파생 축입니다.",
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
    "옵션 프록시",
    "미국 옵션청산회사(OCC)가 공개하는 옵션 거래량 조회 데이터의 콜·풋 거래량만 이용한 Fenok 파생 프록시입니다. 실제 옵션 자금 흐름이나 옵션 가격 통합 데이터(OPRA), 매수·매도 주체 방향은 아닙니다.",
  ),
  offExchangeActivityProxy: makeDefaultEntry(
    "offExchangeActivityProxy",
    "장외거래",
    "미국 금융산업규제청(FINRA) 계열 공개 데이터에서 파생한 장외거래 활동 프록시입니다. 실시간 다크풀 의도 신호로 해석하면 안 됩니다.",
  ),
  shortPressureProxy: {
    key: "shortPressureProxy",
    label: "숏 압력",
    interpretation:
      "공개된 공매도 거래량·공매도 활동 데이터를 이용한 Fenok 파생 압력 축입니다. 점수가 높을수록 공매도 관련 압력이 큰 쪽입니다.",
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
    "거래량·유동성",
    "로컬 시가·고가·저가·종가·거래량(OHLCV) 데이터에서 파생한 거래량·유동성 추세 프록시입니다. 실제 주문 흐름은 아닙니다.",
  ),
  shortTermRelativeStrength: makeDefaultEntry(
    "shortTermRelativeStrength",
    "상대 강도",
    "로컬 20일·60일 수익률과 S&P500 ETF(SPY) 대비 상대 강도를 이용한 Fenok 파생 프록시입니다. 예측 신호가 아닙니다.",
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
  if (invertedDisplay && key === "downsidePressure") return "하락 압력 완화";
  if (invertedDisplay && key === "shortPressureProxy") return "숏압력 완화";
  return getSignalHelpEntry(key).label;
}

export function getDisplaySignalInterpretation(
  key: FenokSignalHelpKey,
  invertedDisplay = false,
): string {
  const entry = getSignalHelpEntry(key);
  if (!invertedDisplay) return entry.interpretation;
  if (key === "downsidePressure") {
    return "화면 점수는 하락 압력 원점수를 뒤집어 표시한 점수입니다. 높을수록 하락 위험이 낮다는 뜻입니다.";
  }
  if (key === "shortPressureProxy") {
    return "화면 점수는 공매도 거래량 압력 원점수를 뒤집어 표시한 점수입니다. 높을수록 공매도 압력이 낮다는 뜻입니다.";
  }
  return entry.interpretation;
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
