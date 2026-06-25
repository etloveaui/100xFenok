import type { ScreenerStock } from "./types";
import { bandLabel, bandPct, normalizeBandTuple } from "./bands";

type MaybeNumber = number | null | undefined;
type EstimateSeries = { fy1?: MaybeNumber; fy2?: MaybeNumber; fy3?: MaybeNumber };
type WeeklyChange = { fy_plus_1?: MaybeNumber; fy_plus_2?: MaybeNumber; fy_plus_3?: MaybeNumber };

export type InterpretationReadTone = "positive" | "neutral" | "watch" | "risk";

export interface InterpretationRead {
  id: "peTrend" | "growthConsistency" | "revisionDirection" | "bandPosition" | "confidence";
  label: string;
  text: string;
  shortText: string;
  tone: InterpretationReadTone;
}

export interface InterpretationContext {
  valuation_estimates?: { per?: EstimateSeries };
  growth_estimates?: { revenue_growth?: EstimateSeries; eps_growth?: EstimateSeries };
  eps_consensus?: { weekly_change?: WeeklyChange };
  per_bands?: {
    current?: MaybeNumber;
    min_8y?: MaybeNumber;
    avg_8y?: MaybeNumber;
    max_8y?: MaybeNumber;
  };
}

export interface InterpretationResult {
  badge: string;
  badgeClass: string;
  text: string;
  reads: InterpretationRead[];
  estimateSummary: string | null;
}

function validNumbers(values: Array<number | null | undefined>): number[] {
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function nonIncreasing(values: number[]): boolean {
  if (values.length < 2) return false;
  return values.every((value, index) => index === 0 || value <= values[index - 1]);
}

function firstFinite(values: Array<MaybeNumber>): number | null {
  return values.find((value): value is number => typeof value === "number" && Number.isFinite(value)) ?? null;
}

function estimateValues(series: EstimateSeries | undefined, fallback: [MaybeNumber, MaybeNumber, MaybeNumber]): [MaybeNumber, MaybeNumber, MaybeNumber] {
  const detailValues: [MaybeNumber, MaybeNumber, MaybeNumber] = [series?.fy1, series?.fy2, series?.fy3];
  return validNumbers(detailValues).length > 0 ? detailValues : fallback;
}

function signedPercent(value: number, digits = 1): string {
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${Math.abs(value).toFixed(digits)}%`;
}

function confidenceKo(label: string | null | undefined): string {
  if (label === "high") return "높음";
  if (label === "medium") return "중간";
  if (label === "low") return "낮음";
  return "미정";
}

function confidenceSentence(label: string | null | undefined): string {
  if (label === "high") return "높습니다";
  if (label === "medium") return "중간입니다";
  if (label === "low") return "낮습니다";
  return "아직 정해지지 않았습니다";
}

function buildEstimateReads(stock: ScreenerStock, context?: InterpretationContext): InterpretationRead[] {
  const reads: InterpretationRead[] = [];
  const peSeries = estimateValues(context?.valuation_estimates?.per, [stock.forwardPeFy1, stock.forwardPeFy2, stock.forwardPeFy3]);
  const revenueGrowthSeries = estimateValues(context?.growth_estimates?.revenue_growth, [stock.revenueGrowthFy1, stock.revenueGrowthFy2, stock.revenueGrowthFy3]);
  const epsGrowthSeries = estimateValues(context?.growth_estimates?.eps_growth, [stock.epsGrowthFy1, stock.epsGrowthFy2, stock.epsGrowthFy3]);

  const peFy1 = peSeries[0];
  const peFy3 = peSeries[2] ?? firstFinite([peSeries[1], peSeries[0]]);
  if (typeof peFy1 === "number" && Number.isFinite(peFy1) && typeof peFy3 === "number" && Number.isFinite(peFy3)) {
    const drop = peFy3 < peFy1;
    const rise = peFy3 > peFy1 * 1.15;
    reads.push({
      id: "peTrend",
      label: "PER 흐름",
      text: `예상 PER은 FY+1 ${peFy1.toFixed(1)}배에서 FY+3 ${peFy3.toFixed(1)}배로 ${drop ? "낮아집니다" : rise ? "높아집니다" : "큰 변화가 없습니다"}.`,
      shortText: `PER ${peFy1.toFixed(1)}→${peFy3.toFixed(1)}배`,
      tone: drop ? "positive" : rise ? "risk" : "neutral",
    });
  }

  const revAvg = average(validNumbers(revenueGrowthSeries));
  const epsAvg = average(validNumbers(epsGrowthSeries));
  if (revAvg !== null || epsAvg !== null) {
    const pairedPositiveYears = [0, 1, 2].filter((index) => {
      const revenue = revenueGrowthSeries[index];
      const eps = epsGrowthSeries[index];
      return typeof revenue === "number" && revenue > 0 && typeof eps === "number" && eps > 0;
    }).length;
    const tone: InterpretationReadTone =
      pairedPositiveYears >= 2 && (revAvg ?? 0) >= 5 && (epsAvg ?? 0) >= 5
        ? "positive"
        : pairedPositiveYears === 0
          ? "risk"
          : "watch";
    const revText = revAvg !== null ? `매출 평균 ${revAvg.toFixed(1)}%` : "매출 평균 —";
    const epsText = epsAvg !== null ? `EPS 평균 ${epsAvg.toFixed(1)}%` : "EPS 평균 —";
    reads.push({
      id: "growthConsistency",
      label: "성장 지속성",
      text: `FY+1~3 ${revText}, ${epsText}이며, 3개 연도 중 ${pairedPositiveYears}개 연도에서 매출과 EPS가 함께 플러스입니다.`,
      shortText: `성장 동시 플러스 ${pairedPositiveYears}/3`,
      tone,
    });
  }

  const revisionValues = validNumbers([
    context?.eps_consensus?.weekly_change?.fy_plus_1,
    context?.eps_consensus?.weekly_change?.fy_plus_2,
    context?.eps_consensus?.weekly_change?.fy_plus_3,
  ]);
  if (revisionValues.length > 0) {
    const threshold = 0.001;
    const up = revisionValues.filter((value) => value > threshold).length;
    const down = revisionValues.filter((value) => value < -threshold).length;
    const avgRevision = average(revisionValues.map((value) => value * 100));
    const direction = up >= 2 ? "상향 우세" : down >= 2 ? "하향 우세" : "혼조·보합";
    reads.push({
      id: "revisionDirection",
      label: "EPS 수정",
      text: `최근 주간 EPS 추정은 FY+1~3 중 상향 ${up}개, 하향 ${down}개로 ${direction}입니다${avgRevision !== null ? ` 평균 변화는 ${signedPercent(avgRevision, 2)}` : ""}.`,
      shortText: `EPS ${direction}`,
      tone: up >= 2 ? "positive" : down >= 2 ? "risk" : "watch",
    });
  }

  const currentBand = context?.per_bands?.current ?? stock.perBandCurrent;
  const minBand = context?.per_bands?.min_8y ?? stock.perBandMin;
  const maxBand = context?.per_bands?.max_8y ?? stock.perBandMax;
  const avgBand = context?.per_bands?.avg_8y ?? stock.perBandAvg;
  const bandTuple = normalizeBandTuple(currentBand, minBand, maxBand);
  if (bandTuple) {
    const [current, min, max] = bandTuple;
    const pct = bandPct(current, min, max);
    const label = bandLabel(pct);
    const avgText = typeof avgBand === "number" && Number.isFinite(avgBand) ? `, 평균 ${avgBand.toFixed(1)}배 ${current >= avgBand ? "위" : "아래"}` : "";
    reads.push({
      id: "bandPosition",
      label: "밴드 위치",
      text: `현재 PER은 8년 범위의 ${Math.round(pct * 100)}% 지점(${label})입니다${avgText}.`,
      shortText: `밴드 ${Math.round(pct * 100)}%(${label})`,
      tone: pct <= 0.25 ? "positive" : pct >= 0.75 ? "risk" : "neutral",
    });
  }

  if (stock.confidenceLabel || stock.lowEvidence != null) {
    const lowEvidence = stock.lowEvidence === true || stock.confidenceLabel === "low";
    reads.push({
      id: "confidence",
      label: "신뢰도",
      text: lowEvidence
        ? `데이터 신뢰도는 ${confidenceSentence(stock.confidenceLabel)}. 결측·근거 부족 가능성이 있어 원자료 확인을 우선해야 합니다.`
        : `데이터 신뢰도는 ${confidenceSentence(stock.confidenceLabel)}. 현재 해석은 기존 커버리지 안에서 사용할 수 있습니다.`,
      shortText: `신뢰 ${confidenceKo(stock.confidenceLabel)}`,
      tone: lowEvidence ? "watch" : stock.confidenceLabel === "high" ? "positive" : "neutral",
    });
  }

  return reads;
}

function estimateSummary(reads: InterpretationRead[]): string | null {
  const priority = ["peTrend", "growthConsistency", "revisionDirection", "bandPosition"] as const;
  const selected = priority
    .map((id) => reads.find((read) => read.id === id)?.shortText)
    .filter((value): value is string => Boolean(value))
    .slice(0, 2);
  return selected.length > 0 ? selected.join(" · ") : null;
}

function withReads(result: Omit<InterpretationResult, "reads" | "estimateSummary">, reads: InterpretationRead[]): InterpretationResult {
  return { ...result, reads, estimateSummary: estimateSummary(reads) };
}

export function interpretStockMetrics(stock: ScreenerStock, context?: InterpretationContext): InterpretationResult {
  const pe = stock.forwardPeFy1 ?? stock.peForward ?? stock.per ?? null;
  const roe = stock.roeFy1 ?? (stock.roe ? stock.roe * 100 : null);
  const opm = stock.operatingMarginFy1 ?? (stock.opm ? stock.opm * 100 : null);
  const epsGrowth = stock.epsGrowthFy1 ?? null;
  const revenueGrowth = stock.revenueGrowthFy1 ?? null;
  const forwardPeSeries = validNumbers([stock.forwardPeFy1, stock.forwardPeFy2, stock.forwardPeFy3]);
  const epsGrowthSeries = validNumbers([stock.epsGrowthFy1, stock.epsGrowthFy2, stock.epsGrowthFy3]);
  const revenueGrowthSeries = validNumbers([stock.revenueGrowthFy1, stock.revenueGrowthFy2, stock.revenueGrowthFy3]);
  const roeSeries = validNumbers([stock.roeFy1, stock.roeFy2, stock.roeFy3]);
  const avgEpsGrowth = average(epsGrowthSeries);
  const avgRevenueGrowth = average(revenueGrowthSeries);
  const avgRoe = average(roeSeries);
  const divYield = stock.dividendYield ? stock.dividendYield * 100 : null;
  const return12m = stock.return12m ? stock.return12m * 100 : null;
  const momentum3m = stock.momentum3m ? stock.momentum3m * 100 : null;
  const reads = buildEstimateReads(stock, context);

  // 1. Underpriced Compounding Growth (저평가 우량 성장주)
  if (pe !== null && pe > 0 && pe < 22 && roe !== null && roe >= 15 && epsGrowth !== null && epsGrowth >= 15) {
    const multiYearText =
      avgRevenueGrowth !== null && avgEpsGrowth !== null
        ? ` FY+1~3 평균 매출 성장률 ${avgRevenueGrowth.toFixed(1)}%, EPS 성장률 ${avgEpsGrowth.toFixed(1)}%도 같이 확인됩니다.`
        : "";
    return withReads({
      badge: "저평가 우량 성장주",
      badgeClass: "border-[var(--up-border)] bg-[var(--c-up-soft)] text-[var(--c-up)]",
      text: `예상 PER ${pe.toFixed(1)}배, FY+1 ROE ${roe.toFixed(1)}%, 예상 EPS 성장률 ${epsGrowth.toFixed(1)}%가 함께 잡힙니다.${multiYearText} Feno 기준으로는 밸류 부담이 과하지 않은 성장·수익성 조합으로 먼저 읽을 수 있습니다.`,
    }, reads);
  }

  // 2. Multi-year growth visibility (3년 성장 가시성)
  if (
    avgEpsGrowth !== null &&
    avgEpsGrowth >= 10 &&
    avgRevenueGrowth !== null &&
    avgRevenueGrowth >= 5 &&
    epsGrowthSeries.filter((value) => value > 0).length >= 2 &&
    revenueGrowthSeries.filter((value) => value > 0).length >= 2 &&
    (forwardPeSeries.length < 2 || nonIncreasing(forwardPeSeries))
  ) {
    const peTrend = forwardPeSeries.length >= 2 ? `예상 PER이 ${forwardPeSeries[0].toFixed(1)}배에서 ${forwardPeSeries.at(-1)?.toFixed(1)}배로 낮아지는 흐름이고, ` : "";
    const roeText = avgRoe !== null ? `평균 ROE ${avgRoe.toFixed(1)}%까지 같이 보입니다.` : "수익성은 별도 확인이 필요합니다.";
    return withReads({
      badge: "3년 성장 가시성",
      badgeClass: "border-[var(--up-border)] bg-[var(--c-up-soft)] text-[var(--c-up)]",
      text: `${peTrend}FY+1~3 평균 매출 성장률 ${avgRevenueGrowth.toFixed(1)}%, EPS 성장률 ${avgEpsGrowth.toFixed(1)}%입니다. 단년 기저효과보다 3년 추정치가 이어지는지를 먼저 읽는 구간이며, ${roeText}`,
    }, reads);
  }

  // 2. High-Yield Value Champion (고배당 가치 우량주)
  if (divYield !== null && divYield >= 3.0 && roe !== null && roe >= 10 && pe !== null && pe < 18) {
    return withReads({
      badge: "고배당 가치 우량주",
      badgeClass: "border-[var(--warn-border)] bg-[var(--c-warn-soft)] text-[var(--c-warn)]",
      text: `배당수익률 ${divYield.toFixed(1)}%, FY+1 ROE ${roe.toFixed(1)}%, 예상 PER ${pe.toFixed(1)}배 조합입니다. 배당 매력과 자본 효율이 같이 보이므로, 다음에는 배당 지속성과 현금흐름을 함께 확인하는 쪽이 좋습니다.`,
    }, reads);
  }

  // 3. Momentum Leadership (강한 시세 주도주)
  if (momentum3m !== null && momentum3m >= 10 && return12m !== null && return12m >= 25) {
    return withReads({
      badge: "강한 시세 주도주",
      badgeClass: "border-[var(--down-border)] bg-[var(--c-down-soft)] text-[var(--c-down)]",
      text: `최근 3개월 모멘텀 ${momentum3m.toFixed(1)}%, 12개월 수익률 ${return12m.toFixed(1)}%입니다. 가격 흐름이 이미 강한 축에 있으므로, 추격보다는 실적 상향과 밸류 부담을 같이 확인해야 합니다.`,
    }, reads);
  }

  // 4. Stable Quality Cash Cow (안정적 현금 창출 기업)
  if (roe !== null && roe >= 12 && opm !== null && opm >= 15 && pe !== null && pe < 25) {
    return withReads({
      badge: "안정적 현금 창출 기업",
      badgeClass: "border-[var(--c-info-border)] bg-[var(--c-info-soft)] text-[var(--c-info)]",
      text: `FY+1 영업이익률 ${opm.toFixed(1)}%, ROE ${roe.toFixed(1)}%, 예상 PER ${pe.toFixed(1)}배입니다. 수익성과 가격 부담이 균형권에 있어, 현금흐름과 마진 유지 여부가 핵심 확인 포인트입니다.`,
    }, reads);
  }

  // 5. Turnaround & Recovery Candidate (실적 턴어라운드 후보)
  if (epsGrowth !== null && epsGrowth >= 25 && (revenueGrowth === null || revenueGrowth >= 10) && (pe === null || pe > 25 || pe < 0)) {
    return withReads({
      badge: "턴어라운드 기대주",
      badgeClass: "border-[var(--c-recovery-border)] bg-[var(--c-recovery-soft)] text-[var(--c-recovery)]",
      text: `예상 EPS 성장률 ${epsGrowth.toFixed(1)}%가 크게 잡히지만, PER은 높거나 적자 구간일 수 있습니다. 실적 반등 가능성은 보이되, 실제 매출 회복과 마진 개선이 따라오는지 확인해야 합니다.`,
    }, reads);
  }

  // Default: Observation (관찰 대상 기업)
  const scoreDesc = stock.actionScore != null ? `액션 점수 ${Math.round(stock.actionScore)}점 수준으로 ` : "";
  return withReads({
    badge: "관찰 대상 기업",
    badgeClass: "border-[var(--c-line)] bg-[var(--c-surface-2)] text-[var(--c-ink-2)]",
    text: `${scoreDesc}현재 주요 지표가 한쪽으로 강하게 기울지는 않습니다. 이익 추정 변화, 밸류 위치, 가격 흐름 중 무엇이 먼저 개선되는지 관찰하는 종목으로 분류합니다.`,
  }, reads);
}
