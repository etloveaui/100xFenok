import type { ScreenerSortKey, ScreenerStock } from "@/lib/screener/types";

export interface CommonBasisShortTermView {
  score: number | null;
  call: ScreenerStock["fenokShortTermCommonBasisCall"];
  sourceInputCount: number | null;
  basisCode: string | null;
}

export function commonBasisShortTermView(stock: ScreenerStock): CommonBasisShortTermView {
  return {
    score: typeof stock.fenokShortTermCommonBasisScore === "number"
      && Number.isFinite(stock.fenokShortTermCommonBasisScore)
      ? Math.round(stock.fenokShortTermCommonBasisScore)
      : null,
    call: stock.fenokShortTermCommonBasisCall ?? null,
    sourceInputCount: typeof stock.fenokShortTermInputCount === "number"
      && Number.isFinite(stock.fenokShortTermInputCount)
      ? stock.fenokShortTermInputCount
      : null,
    basisCode: stock.fenokShortTermBasisCode ?? null,
  };
}

export function screenerSortValue(stock: ScreenerStock, sortKey: ScreenerSortKey): number | string | null | undefined {
  if (sortKey === "fenokConvictionScore") {
    return stock.fenokShortTermCommonBasisScore;
  }
  return stock[sortKey];
}
