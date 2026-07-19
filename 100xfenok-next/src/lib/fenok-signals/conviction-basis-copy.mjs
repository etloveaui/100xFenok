const MARKET_BASIS = Object.freeze({
  us: Object.freeze({ marketLabel: "미국", inputCount: 5, commonOnly: false }),
  korea: Object.freeze({ marketLabel: "한국", inputCount: 3, commonOnly: true }),
  asia: Object.freeze({ marketLabel: "아시아", inputCount: 3, commonOnly: true }),
});

const COMPARISON_NOTE = "시장별 입력 수가 달라 점수를 직접 비교할 수 없습니다.";
const COMMON_COMPARISON_NOTE = "동일한 공통 3개 입력 기준이므로 시장 간 직접 비교할 수 있습니다.";

function normalizeMarket(marketScope) {
  return typeof marketScope === "string" ? marketScope.trim().toLowerCase() : "";
}

export function shortTermCommonBasisCopy(marketScope, context = {}) {
  const normalized = normalizeMarket(marketScope);
  const marketLabel = MARKET_BASIS[normalized]?.marketLabel ?? "시장 미확인";
  const sourceInputCount = Number.isFinite(context.sourceInputCount) ? context.sourceInputCount : null;
  const basisCode = typeof context.basisCode === "string" && context.basisCode.trim()
    ? context.basisCode.trim()
    : null;
  const sourceContext = [
    sourceInputCount !== null ? `원천 ${sourceInputCount}개 입력` : null,
    basisCode ? `산출 기준 ${basisCode}` : null,
  ].filter(Boolean).join(" · ");

  return {
    marketScope: MARKET_BASIS[normalized] ? normalized : "unknown",
    marketLabel,
    inputCount: 3,
    sourceInputCount,
    basisCode,
    label: `${marketLabel} · 공통 3개 입력 기준`,
    detail: `${marketLabel} 종목의 단기 점수는 시장 공통 3개 입력으로 계산합니다.${sourceContext ? ` ${sourceContext}.` : ""}`,
    comparisonNote: COMMON_COMPARISON_NOTE,
  };
}

export function shortTermConvictionBasisCopy(marketScope) {
  const normalized = normalizeMarket(marketScope);
  const basis = MARKET_BASIS[normalized];
  if (!basis) {
    return {
      marketScope: "unknown",
      marketLabel: "시장 미확인",
      inputCount: null,
      label: "시장 미확인 · 입력 기준 미확인",
      detail: "시장 기준을 확인할 수 없어 반영 입력 수를 확인할 수 없습니다.",
      comparisonNote: COMPARISON_NOTE,
    };
  }

  const inputPhrase = basis.commonOnly ? `${basis.inputCount}개 공통 입력` : `${basis.inputCount}개 입력`;
  return {
    marketScope: normalized,
    marketLabel: basis.marketLabel,
    inputCount: basis.inputCount,
    label: `${basis.marketLabel} · 최대 ${inputPhrase} 기준`,
    detail: `${basis.marketLabel} 종목의 단기 점수는 최대 ${inputPhrase}까지 반영할 수 있습니다.`,
    comparisonNote: COMPARISON_NOTE,
  };
}
