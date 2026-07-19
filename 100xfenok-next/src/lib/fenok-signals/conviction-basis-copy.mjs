const MARKET_LABEL = Object.freeze({
  us: "미국",
  korea: "한국",
  asia: "아시아",
});

const COMMON_COMPARISON_NOTE = "동일한 공통 3개 입력 기준이므로 시장 간 직접 비교할 수 있습니다.";

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
    label: `${marketLabel} · 공통 3개 입력 기준`,
    detail: `${marketLabel} 종목의 단기 점수는 시장 공통 3개 입력으로 계산합니다.${sourceContext ? ` ${sourceContext}.` : ""}`,
    comparisonNote: COMMON_COMPARISON_NOTE,
  };
}
