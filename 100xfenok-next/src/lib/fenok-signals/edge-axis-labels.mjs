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

export const EDGE_AXIS_SPOKE_LABELS = {
  // long horizon
  profitabilityScore: "수익성",
  growthScore: "성장",
  upsidePotentialScore: "상방",
  downsidePressureScore: "하방",
  marketSimilarityScore: "동종군",
  durabilityProfitabilityScore: "내구",
  // short horizon
  technicalFlowScore: "기술",
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
