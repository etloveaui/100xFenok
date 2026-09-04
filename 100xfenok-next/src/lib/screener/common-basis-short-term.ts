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
  // The legacy column key renders Short and Long separately but sorts by the
  // explicitly named Short value. It used to sort by the common-basis figure,
  // which the data contract calls a composition disclosure — the list then
  // displayed one score and ranked by another, and this is the default sort for
  // the fenokPicks preset.
  if (sortKey === "fenokConvictionScore") {
    return stock.fenokShortTermConvictionScore;
  }
  // Discover Q2 (short-over-long) ranks by the short-minus-long gap, which is a
  // derived value with no stock field. Either leg missing sorts nulls-last via
  // the shared comparator.
  if (sortKey === "edgeGap") {
    const short = typeof stock.fenokShortTermScore === "number" && Number.isFinite(stock.fenokShortTermScore)
      ? stock.fenokShortTermScore
      : null;
    const long = typeof stock.fenokLongTermScore === "number" && Number.isFinite(stock.fenokLongTermScore)
      ? stock.fenokLongTermScore
      : null;
    if (short === null || long === null) return null;
    return short - long;
  }
  return stock[sortKey as Exclude<ScreenerSortKey, "edgeGap">];
}
