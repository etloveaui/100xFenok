// One axis for methods that disagree.
//
// The page carries several valuation methods and, until now, stacked their
// conclusions without relating them. Two of them produce a LEVEL comparable to a
// price — a bond-PER fair value and a residual-income band — and those two can
// share an axis. Multiples and percentiles cannot: they are ordinal, and putting
// them on a cardinal axis would invent a comparison that does not exist.
//
// The trap this module exists to close: each producer computed its answer
// against its OWN price on its OWN date. Yardeni's premium is measured against
// the S&P close it read; the RIM band against the close it read a week later.
// Publishing those two percentages side by side compares two different
// questions and calls it a disagreement. So nothing here trusts a published
// percentage. Every reading is re-derived as `implied level / anchor price - 1`
// against ONE anchor, and each reading carries its own as-of so the reader can
// see which dates were mixed.
//
// The output is deliberately not a verdict. It is a set of readings plus the
// reasons any method was withheld. A caller that wants one number will not find
// one here: no midpoint is computed in this file, and a band never collapses.

export type MethodologyKind = "point" | "band";

export interface MethodologyReading {
  /** Two words, because it has to fit next to the number it labels. */
  lens: string;
  kind: MethodologyKind;
  /** Fraction against the anchor. Equal for a point reading. */
  lowPct: number;
  highPct: number;
  /** The levels the fractions came from, so the axis can label them. */
  impliedLow: number;
  impliedHigh: number;
  /** What question this method answers over what period. */
  horizon: string;
  confidence: string | null;
  /** The method's own clock, which is usually NOT the anchor's. */
  asOf: string;
}

export interface WithheldMethodology {
  lens: string;
  reason: string;
}

export interface MethodologyAxisView {
  indexId: string;
  label: string;
  /** Every reading is measured against this price on this date. */
  anchorPrice: number;
  anchorAsOf: string;
  readings: MethodologyReading[];
  withheld: WithheldMethodology[];
  /** True when two readings do not overlap at all — the page's real content. */
  disagrees: boolean;
  /** Widest disagreement in percentage points, null below two readings. */
  spreadPp: number | null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** A level becomes a fraction only against a positive anchor. */
function toPct(level: number, anchor: number): number {
  return level / anchor - 1;
}

export interface RimRowInput {
  id: string;
  label: string;
  asOf: string;
  currentPrice: number | null;
  range: { low: number; high: number };
  confidence: string | null;
}

export interface YardeniInput {
  date: string;
  fairValue: number;
}

export const RIM_LENS = "9년 잔존가치";
export const RIM_HORIZON = "9년 명시적 예측 뒤 잔존가치, 컨센서스 이익 경로";
export const YARDENI_LENS = "채권 대비";
export const YARDENI_HORIZON = "현재 금리 국면에서 채권 PER × 이익";

/**
 * Build one index's axis.
 *
 * The RIM row supplies the anchor because it is the only input that carries a
 * dated price for every index in scope. Yardeni covers the S&P alone and is
 * re-derived against that same anchor rather than contributing its own price.
 */
export function buildMethodologyAxis({
  rim,
  yardeni,
}: {
  rim: RimRowInput;
  yardeni?: YardeniInput | null;
}): MethodologyAxisView | null {
  // No anchor, no axis. Every reading is a fraction of this number, so an
  // absent or malformed price withholds the whole index rather than letting one
  // method render against an implied zero.
  if (!isFiniteNumber(rim.currentPrice) || rim.currentPrice <= 0) return null;
  if (!isIsoDay(rim.asOf)) return null;

  const anchorPrice = rim.currentPrice;
  const readings: MethodologyReading[] = [];
  const withheld: WithheldMethodology[] = [];

  if (
    isFiniteNumber(rim.range.low)
    && isFiniteNumber(rim.range.high)
    && rim.range.low < rim.range.high
  ) {
    readings.push({
      lens: RIM_LENS,
      kind: "band",
      lowPct: toPct(rim.range.low, anchorPrice),
      highPct: toPct(rim.range.high, anchorPrice),
      impliedLow: rim.range.low,
      impliedHigh: rim.range.high,
      horizon: RIM_HORIZON,
      confidence: rim.confidence,
      asOf: rim.asOf,
    });
  } else {
    withheld.push({ lens: RIM_LENS, reason: "밴드 양 끝이 갖춰지지 않았습니다" });
  }

  if (yardeni) {
    if (!isFiniteNumber(yardeni.fairValue) || yardeni.fairValue <= 0) {
      withheld.push({ lens: YARDENI_LENS, reason: "적정 수준을 읽지 못했습니다" });
    } else if (!isIsoDay(yardeni.date)) {
      withheld.push({ lens: YARDENI_LENS, reason: "기준일이 없습니다" });
    } else {
      // Re-derived against the anchor. The producer's own premium_pct is
      // deliberately not read: it was measured against a different close.
      const pct = toPct(yardeni.fairValue, anchorPrice);
      readings.push({
        lens: YARDENI_LENS,
        kind: "point",
        lowPct: pct,
        highPct: pct,
        impliedLow: yardeni.fairValue,
        impliedHigh: yardeni.fairValue,
        horizon: YARDENI_HORIZON,
        confidence: null,
        asOf: yardeni.date,
      });
    }
  }

  // Disagreement is measured as non-overlap of intervals, not as a difference of
  // midpoints — a wide band and a point inside it agree, however far apart their
  // centres are.
  let disagrees = false;
  let spreadPp: number | null = null;
  if (readings.length >= 2) {
    const lows = readings.map((r) => r.lowPct);
    const highs = readings.map((r) => r.highPct);
    disagrees = readings.some((a) => readings.some((b) => a.highPct < b.lowPct || b.highPct < a.lowPct));
    spreadPp = (Math.max(...highs) - Math.min(...lows)) * 100;
  }

  return {
    indexId: rim.id,
    label: rim.label,
    anchorPrice,
    anchorAsOf: rim.asOf,
    readings,
    withheld,
    disagrees,
    spreadPp,
  };
}
