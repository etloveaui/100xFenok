export interface CommonBasisSignalSummarySource {
  shortTermCommonBasisScore?: number | null;
  shortTermCommonBasisCall?: "concentrated" | "mixed" | "diluted" | null;
  shortTermInputCount?: number | null;
  shortTermBasisCode?: string | null;
}

export interface CommonBasisSignalSummaryView {
  score: number | null;
  call: CommonBasisSignalSummarySource["shortTermCommonBasisCall"];
  sourceInputCount: number | null;
  basisCode: string | null;
}

export function commonBasisSignalSummaryView(record: CommonBasisSignalSummarySource): CommonBasisSignalSummaryView {
  return {
    score: typeof record.shortTermCommonBasisScore === "number"
      && Number.isFinite(record.shortTermCommonBasisScore)
      ? record.shortTermCommonBasisScore
      : null,
    call: record.shortTermCommonBasisCall ?? null,
    sourceInputCount: typeof record.shortTermInputCount === "number"
      && Number.isFinite(record.shortTermInputCount)
      ? record.shortTermInputCount
      : null,
    basisCode: record.shortTermBasisCode ?? null,
  };
}
