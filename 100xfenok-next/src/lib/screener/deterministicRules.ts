import type { ScreenerStock } from "./types";

export interface InterpretationResult {
  badge: string;
  badgeClass: string;
  text: string;
}

export function interpretStockMetrics(stock: ScreenerStock): InterpretationResult {
  const pe = stock.peForward ?? stock.per ?? null;
  const roe = stock.roeFy1 ?? (stock.roe ? stock.roe * 100 : null);
  const opm = stock.operatingMarginFy1 ?? (stock.opm ? stock.opm * 100 : null);
  const epsGrowth = stock.epsGrowthFy1 ?? null;
  const revenueGrowth = stock.revenueGrowthFy1 ?? null;
  const divYield = stock.dividendYield ? stock.dividendYield * 100 : null;
  const return12m = stock.return12m ? stock.return12m * 100 : null;
  const momentum3m = stock.momentum3m ? stock.momentum3m * 100 : null;

  // 1. Underpriced Compounding Growth (저평가 우량 성장주)
  if (pe !== null && pe > 0 && pe < 22 && roe !== null && roe >= 15 && epsGrowth !== null && epsGrowth >= 15) {
    return {
      badge: "저평가 우량 성장주",
      badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
      text: `예상 PER ${pe.toFixed(1)}배, FY+1 ROE ${roe.toFixed(1)}%, 예상 EPS 성장률 ${epsGrowth.toFixed(1)}%가 함께 잡힙니다. Feno 기준으로는 밸류 부담이 과하지 않은 성장·수익성 조합으로 먼저 읽을 수 있습니다.`,
    };
  }

  // 2. High-Yield Value Champion (고배당 가치 우량주)
  if (divYield !== null && divYield >= 3.0 && roe !== null && roe >= 10 && pe !== null && pe < 18) {
    return {
      badge: "고배당 가치 우량주",
      badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
      text: `배당수익률 ${divYield.toFixed(1)}%, FY+1 ROE ${roe.toFixed(1)}%, 예상 PER ${pe.toFixed(1)}배 조합입니다. 배당 매력과 자본 효율이 같이 보이므로, 다음에는 배당 지속성과 현금흐름을 함께 확인하는 쪽이 좋습니다.`,
    };
  }

  // 3. Momentum Leadership (강한 시세 주도주)
  if (momentum3m !== null && momentum3m >= 10 && return12m !== null && return12m >= 25) {
    return {
      badge: "강한 시세 주도주",
      badgeClass: "border-rose-200 bg-rose-50 text-rose-700",
      text: `최근 3개월 모멘텀 ${momentum3m.toFixed(1)}%, 12개월 수익률 ${return12m.toFixed(1)}%입니다. 가격 흐름이 이미 강한 축에 있으므로, 추격보다는 실적 상향과 밸류 부담을 같이 확인해야 합니다.`,
    };
  }

  // 4. Stable Quality Cash Cow (안정적 현금 창출 기업)
  if (roe !== null && roe >= 12 && opm !== null && opm >= 15 && pe !== null && pe < 25) {
    return {
      badge: "안정적 현금 창출 기업",
      badgeClass: "border-sky-200 bg-sky-50 text-sky-700",
      text: `FY+1 영업이익률 ${opm.toFixed(1)}%, ROE ${roe.toFixed(1)}%, 예상 PER ${pe.toFixed(1)}배입니다. 수익성과 가격 부담이 균형권에 있어, 현금흐름과 마진 유지 여부가 핵심 확인 포인트입니다.`,
    };
  }

  // 5. Turnaround & Recovery Candidate (실적 턴어라운드 후보)
  if (epsGrowth !== null && epsGrowth >= 25 && (revenueGrowth === null || revenueGrowth >= 10) && (pe === null || pe > 25 || pe < 0)) {
    return {
      badge: "턴어라운드 기대주",
      badgeClass: "border-violet-200 bg-violet-50 text-violet-700",
      text: `예상 EPS 성장률 ${epsGrowth.toFixed(1)}%가 크게 잡히지만, PER은 높거나 적자 구간일 수 있습니다. 실적 반등 가능성은 보이되, 실제 매출 회복과 마진 개선이 따라오는지 확인해야 합니다.`,
    };
  }

  // Default: Observation (관찰 대상 기업)
  const scoreDesc = stock.actionScore != null ? `액션 점수 ${Math.round(stock.actionScore)}점 수준으로 ` : "";
  return {
    badge: "관찰 대상 기업",
    badgeClass: "border-slate-200 bg-slate-50 text-slate-600",
    text: `${scoreDesc}현재 주요 지표가 한쪽으로 강하게 기울지는 않습니다. 이익 추정 변화, 밸류 위치, 가격 흐름 중 무엇이 먼저 개선되는지 관찰하는 종목으로 분류합니다.`,
  };
}
