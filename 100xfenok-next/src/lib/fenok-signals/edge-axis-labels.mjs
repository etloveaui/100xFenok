/**
 * Plain .mjs on purpose: the app imports this and so does the node label-budget
 * gate, so the invariant is checked against the exact file the product ships
 * rather than a transpiled copy of it. `conviction-basis-copy.mjs` beside this
 * file is the existing precedent.
 *
 * The one place the twelve Fenok Edge axes get their short spoke label, and the
 * one place the radar's label budget is computed.
 *
 * Two surfaces draw these axes: the screener hexagon (`StockDetailPanel`) and
 * the stock-detail radar (`StockDetailClient`). Only the screener had short
 * labels, as a module-private const the radar could not reach, so the radar
 * painted full labels into a fixed viewBox with no room for them. The clip was
 * scale-invariant: no viewport width ever recovered a character, because the
 * box and the label ring were chosen in different files with no relationship
 * between them.
 *
 * Do not add a second copy of these strings, and do not hand-pick a character
 * cap. The budget below is DERIVED from the same geometry the renderer uses, so
 * changing a renderer constant changes the budget, and the label-budget test
 * fails the build rather than letting a new axis truncate silently.
 */

// Full labels and interpretations share the same raw/inverted display contract.
export const EDGE_AXIS_LABELS = {
  "profitabilityScore": {
    "label": "수익성",
    "tooltip": "기업의 이익 창출 능력과 자본 효율성을 종합한 Fenok 파생 신호입니다."
  },
  "growthScore": {
    "label": "성장",
    "tooltip": "향후 매출·이익 성장 잠재력을 종합한 Fenok 파생 신호입니다."
  },
  "technicalFlowScore": {
    "label": "가격 모멘텀",
    "tooltip": "12개월·연간 수익률과 모멘텀의 일관성을 종합한 Fenok 파생 신호입니다. 자금 유입·유출 데이터는 사용하지 않습니다. 해당 입력이 없으면 전일 종가 대비 현재가 변화를 제한적으로 사용합니다."
  },
  "durabilityProfitabilityScore": {
    "label": "내구 수익성",
    "tooltip": "수익성의 지속 가능성과 재무적 내구력을 종합한 Fenok 파생 신호입니다."
  },
  "upsidePotentialScore": {
    "label": "상승 잠재력",
    "tooltip": "Fenok 파생 신호로 산출한 상대적 상승 잠재력입니다."
  },
  "downsidePressureScore": {
    "label": "하락 위험",
    "tooltip": "Fenok 파생 신호로 산출한 상대적 하락 압력 축입니다. 점수가 높을수록 위험이 큽니다.",
    "invertedLabel": "하락 안정도",
    "invertedTooltip": "화면 점수는 하락 위험 원점수를 뒤집어 표시한 점수입니다. 높을수록 하락 위험이 낮다는 뜻입니다."
  },
  "marketSimilarityScore": {
    "label": "동종군 유사도(참고)",
    "tooltip": "시가총액·가치평가·수익성·성장·모멘텀 등 7개 지표 프로필을 비교해 가장 가까운 최대 3개 종목과의 유사도를 평균한 참고축입니다. 같은 시장·섹터를 우선하며 비교 종목이 부족하면 범위를 넓힙니다. 주가 상관관계가 아니며 Long Edge 평균에서는 제외합니다."
  },
  "netOptionsProxyScore": {
    "label": "옵션 콜·풋 쏠림",
    "tooltip": "미국 옵션청산회사(OCC)가 공개하는 옵션 거래량 조회 데이터의 콜·풋 거래량만 이용한 Fenok 파생 프록시입니다. 실제 옵션 자금 흐름이나 옵션 가격 통합 데이터(OPRA), 매수·매도 주체 방향은 아닙니다."
  },
  "offExchangeActivityProxyScore": {
    "label": "장외거래 비중(참고)",
    "tooltip": "미국 금융산업규제청(FINRA) 계열 공개 데이터에서 파생한 장외거래 활동 참고 프록시입니다. Short Edge 평균에서는 제외하며, 실시간 다크풀 의도 신호로 해석하면 안 됩니다."
  },
  "shortPressureProxyScore": {
    "label": "공매도 부담",
    "tooltip": "공개된 공매도 거래량·공매도 활동 데이터를 이용한 Fenok 파생 압력 축입니다. 점수가 높을수록 공매도 관련 압력이 큰 쪽입니다.",
    "invertedLabel": "공매도 부담 완화",
    "invertedTooltip": "화면 점수는 공매도 거래량 압력 원점수를 뒤집어 표시한 점수입니다. 높을수록 공매도 부담이 낮다는 뜻입니다."
  },
  "volumeLiquidityTrendScore": {
    "label": "거래량·유동성 추세",
    "tooltip": "로컬 시가·고가·저가·종가·거래량(OHLCV) 데이터에서 파생한 거래량·유동성 추세 프록시입니다. 실제 주문 흐름은 아닙니다."
  },
  "shortTermRelativeStrengthScore": {
    "label": "단기 상대 강도",
    "tooltip": "20·60거래일 수익률과 S&P500 ETF(SPY) 대비 상대 강도를 이용한 Fenok 파생 프록시입니다. 과열·과매도를 나타내는 RSI와는 다른 지표이며 예측 신호가 아닙니다."
  }
};

export function edgeAxisFullLabel(scoreKey, invertedDisplay = false) {
  const entry = EDGE_AXIS_LABELS[scoreKey];
  return (invertedDisplay ? entry?.invertedLabel : null) ?? entry?.label ?? null;
}

export function edgeAxisTooltip(scoreKey, invertedDisplay = false) {
  const entry = EDGE_AXIS_LABELS[scoreKey];
  return (invertedDisplay ? entry?.invertedTooltip : null) ?? entry?.tooltip ?? null;
}

export const EDGE_AXIS_SPOKE_LABELS = {
  // long horizon
  profitabilityScore: "수익성",
  growthScore: "성장",
  upsidePotentialScore: "상방",
  downsidePressureScore: "하방안정",
  marketSimilarityScore: "동종군",
  durabilityProfitabilityScore: "내구",
  // short horizon
  technicalFlowScore: "모멘텀",
  volumeLiquidityTrendScore: "거래",
  shortTermRelativeStrengthScore: "강도",
  netOptionsProxyScore: "옵션",
  offExchangeActivityProxyScore: "장외",
  shortPressureProxyScore: "숏완화",
};

export function edgeAxisSpokeLabel(scoreKey) {
  return EDGE_AXIS_SPOKE_LABELS[scoreKey] ?? null;
}

/** The radar's drawing geometry. `renderRadar` reads these; nothing restates them. */
export const EDGE_RADAR_GEOMETRY = {
  viewBoxWidth: 260,
  viewBoxHeight: 244,
  cx: 130,
  cy: 122,
  maxR: 76,
  /** Label ring offset beyond `maxR`. */
  labelRingOffset: 28,
  axisCount: 6,
  fontSizePx: 11,
  /** Baseline offset of the value line below the name line. */
  valueLineDy: 12,
};

/**
 * Approximate rendered width in SVG units at a given font size.
 *
 * Deliberately a table rather than a browser measurement: the invariant has to
 * hold at build time, where no layout engine exists. The ratios are the
 * conservative side of a bold sans face — full-width Hangul at 1.0em, digits at
 * 0.57em, punctuation and spaces narrower. A face that renders NARROWER than
 * this passes a budget it would also pass visually; one that renders wider is
 * exactly the case this exists to catch.
 */
export function approximateTextWidth(text, fontSizePx) {
  let em = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === " ") em += 0.27;
    else if (code >= 0x1100 && code <= 0xd7ff) em += 1.0; // Hangul and CJK
    else if (code >= 0xff00 && code <= 0xffef) em += 1.0; // full-width forms
    else if (ch >= "0" && ch <= "9") em += 0.57;
    else if ("()[]{}·.,:;'\"|!".includes(ch)) em += 0.34;
    else em += 0.6;
  }
  return em * fontSizePx;
}

/**
 * How much horizontal room one line of a side-axis label actually has.
 *
 * The four side anchors of a six-axis chart sit at `cx ± (maxR + offset)·cos30°`,
 * which for the current constants is 39.93 units from the box edge. With
 * `textAnchor="middle"` a label may spend that clearance on each side, so the
 * usable run is twice it.
 *
 * Outward alignment was the shape originally agreed and it is WORSE, measured:
 * flush to the edge, a label may only run back to the outer extent of the
 * drawing before painting over the rings, which is 52.00 units against 79.87.
 * Middle alignment is kept for that reason.
 */
export function sideAxisLineBudget(geometry = EDGE_RADAR_GEOMETRY) {
  const { cx, maxR, labelRingOffset, viewBoxWidth, axisCount } = geometry;
  if (axisCount !== 6) {
    throw new Error("side-anchor geometry is derived for a six-axis chart");
  }
  const ringRadius = maxR + labelRingOffset;
  const sideAnchorDx = ringRadius * Math.cos((30 * Math.PI) / 180);
  const clearance = viewBoxWidth - (cx + sideAnchorDx);
  if (clearance <= 0) {
    throw new Error("the label ring reaches past the viewBox; no budget exists");
  }
  return clearance * 2;
}

/**
 * The two lines the radar paints for one axis.
 *
 * Splitting the value onto its own line is what makes every axis fit without
 * losing a word: on one line the long-horizon reference axis needs 87.2 units
 * against a budget of 79.87, and on two the widest line in the whole set is
 * 65.4. Nothing is renamed and nothing is dropped.
 */
export function edgeAxisRadarLines(spokeLabel, referenceOnly, score) {
  return [
    `${spokeLabel}${referenceOnly ? " (참고)" : ""}`,
    score !== null ? String(Math.round(score)) : "—",
  ];
}
