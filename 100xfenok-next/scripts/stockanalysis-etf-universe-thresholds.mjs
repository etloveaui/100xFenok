export const R2_4_TRUE_PRIMARY_DETAIL_BASELINE = 4731;
export const MIN_TRUE_PRIMARY_COVERAGE_RATE = 0.99;
export const MIN_MERGED_EXPENSE_RATIO_COUNT = 5000;

export function deriveStockAnalysisEtfUniverseThresholds(truePrimaryDetailCount, lifecycleExclusionCount = 0) {
  if (!Number.isInteger(truePrimaryDetailCount) || truePrimaryDetailCount < 0) {
    throw new TypeError("truePrimaryDetailCount must be a non-negative integer");
  }
  if (!Number.isInteger(lifecycleExclusionCount) || lifecycleExclusionCount < 0 || lifecycleExclusionCount > truePrimaryDetailCount) {
    throw new TypeError("lifecycleExclusionCount must be an integer inside the detail population");
  }
  return {
    baseline_satisfied: truePrimaryDetailCount >= R2_4_TRUE_PRIMARY_DETAIL_BASELINE,
    catalog_participation_floor: Math.ceil((truePrimaryDetailCount - lifecycleExclusionCount) * MIN_TRUE_PRIMARY_COVERAGE_RATE),
    expense_ratio_floor: Math.ceil(R2_4_TRUE_PRIMARY_DETAIL_BASELINE * MIN_TRUE_PRIMARY_COVERAGE_RATE),
  };
}
