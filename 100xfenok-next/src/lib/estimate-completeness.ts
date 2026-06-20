export type EstimatePeriodKey = "fy1" | "fy2" | "fy3";

export type EstimateSeriesLike = Partial<Record<EstimatePeriodKey, number | null | undefined>>;

export interface EstimateCompleteness {
  available: number;
  total: number;
  label: string;
}

export const ESTIMATE_PERIOD_KEYS: readonly EstimatePeriodKey[] = ["fy1", "fy2", "fy3"];

function isFiniteEstimate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function estimateCompletenessFromValues(values: Array<number | null | undefined>): EstimateCompleteness {
  const total = values.length;
  const available = values.filter(isFiniteEstimate).length;
  return {
    available,
    total,
    label: `추정 ${available}/${total}`,
  };
}

export function estimateCompletenessFromSeries(series: EstimateSeriesLike | null | undefined): EstimateCompleteness {
  return estimateCompletenessFromValues(ESTIMATE_PERIOD_KEYS.map((key) => series?.[key] ?? null));
}

export function estimateCompletenessTone(completeness: EstimateCompleteness): string {
  if (completeness.available === completeness.total) return "bg-emerald-50 text-emerald-700";
  if (completeness.available > 0) return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-500";
}

export function hasEstimateGap(completeness: EstimateCompleteness): boolean {
  return completeness.available < completeness.total;
}
