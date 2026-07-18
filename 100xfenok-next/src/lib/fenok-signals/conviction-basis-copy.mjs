const MARKET_BASIS = Object.freeze({
  us: Object.freeze({ marketLabel: "미국", inputCount: 5, commonOnly: false }),
  korea: Object.freeze({ marketLabel: "한국", inputCount: 3, commonOnly: true }),
  asia: Object.freeze({ marketLabel: "아시아", inputCount: 3, commonOnly: true }),
});

const COMPARISON_NOTE = "시장별 입력 수가 달라 점수를 직접 비교할 수 없습니다.";

export function shortTermConvictionBasisCopy(marketScope) {
  const normalized = typeof marketScope === "string" ? marketScope.trim().toLowerCase() : "";
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
