const MARKET_LABEL = Object.freeze({
  us: "미국",
  korea: "한국",
  asia: "아시아",
});

const COMMON_COMPARISON_NOTE = "공통 3개 입력을 함께 공개하지만, 현재 축의 통화·벤치마크·고정 척도가 달라 시장 간 직접 비교는 보류합니다.";
const SHORT_TERM_WINDOW_LABEL = "20/60 trading-day 진단 프록시";
const SHORT_TERM_EXCLUSION_NOTE = "장외거래는 참고축이며 단기 점수 평균에서 제외합니다.";

function normalizeMarket(marketScope) {
  return typeof marketScope === "string" ? marketScope.trim().toLowerCase() : "";
}

export function shortTermCommonBasisCopy(marketScope, context = {}) {
  const normalized = normalizeMarket(marketScope);
  const marketLabel = MARKET_LABEL[normalized] ?? "시장 미확인";
  const sourceInputCount = Number.isFinite(context.sourceInputCount) ? context.sourceInputCount : null;
  const basisCode = typeof context.basisCode === "string" && context.basisCode.trim()
    ? context.basisCode.trim()
    : null;
  const sourceContext = [
    sourceInputCount !== null ? `원천 ${sourceInputCount}개 입력` : null,
    basisCode ? `산출 기준 ${basisCode}` : null,
  ].filter(Boolean).join(" · ");

  return {
    marketScope: MARKET_LABEL[normalized] ? normalized : "unknown",
    marketLabel,
    inputCount: 3,
    sourceInputCount,
    basisCode,
    windowLabel: SHORT_TERM_WINDOW_LABEL,
    exclusionNote: SHORT_TERM_EXCLUSION_NOTE,
    label: `${marketLabel} · 공통 3개 입력 기준`,
    detail: `${marketLabel} 종목의 ${SHORT_TERM_WINDOW_LABEL}는 시장 공통 3개 입력으로 계산합니다.${sourceContext ? ` ${sourceContext}.` : ""}`,
    comparisonNote: COMMON_COMPARISON_NOTE,
  };
}
