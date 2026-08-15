import type {
  PerformanceSeries,
  PortfolioViewsData,
} from "@/lib/superinvestors/types";

/**
 * Cross-investor charts use one honest shared window. Keep a five-year
 * quarterly minimum, but derive the actual dates from the current artifact
 * instead of freezing a historical quarter count in the UI.
 */
export const MIN_SHARED_OBSERVATIONS = 20;

export interface SamePeriodWindow {
  startDate: string;
  endDate: string;
  dates: string[];
  investorCount: number;
}

function isValidPerformance(
  performance: PerformanceSeries | null | undefined,
): performance is PerformanceSeries {
  return Boolean(
    performance
      && Array.isArray(performance.dates)
      && Array.isArray(performance.portfolio)
      && performance.dates.length === performance.portfolio.length
      && performance.dates.length >= MIN_SHARED_OBSERVATIONS,
  );
}

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

function sameDates(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((date, index) => date === right[index]);
}

export function getCommonSamePeriodWindow(
  data: Pick<PortfolioViewsData, "investors">,
): SamePeriodWindow | null {
  const candidates = Object.values(data.investors)
    .map((view) => view.performance)
    .filter(isValidPerformance);
  const startDate = mostCommon(candidates.map((performance) => performance.dates[0]));
  if (!startDate) return null;

  const startCandidates = candidates.filter((performance) => performance.dates[0] === startDate);
  const endDate = mostCommon(startCandidates.map((performance) => performance.dates.at(-1) ?? ""));
  if (!endDate) return null;

  const periodCandidates = startCandidates.filter(
    (performance) => performance.dates.at(-1) === endDate,
  );
  const reference = [...periodCandidates].sort(
    (left, right) => right.dates.length - left.dates.length,
  )[0];
  if (!reference) return null;

  const dates = reference.dates;
  const matching = periodCandidates.filter((performance) => sameDates(performance.dates, dates));
  if (matching.length === 0) return null;

  return { startDate, endDate, dates, investorCount: matching.length };
}

export function alignSamePeriodPerformance(
  performance: PerformanceSeries | null | undefined,
  window: SamePeriodWindow | null,
): PerformanceSeries | null {
  if (!window || !isValidPerformance(performance)) return null;
  if (performance.dates[0] !== window.startDate || performance.dates.at(-1) !== window.endDate) {
    return null;
  }
  if (!sameDates(performance.dates, window.dates)) return null;
  return performance;
}

export function formatQuarterDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-/.exec(date);
  if (!match) return date;
  const quarter = Math.ceil(Number(match[2]) / 3);
  return `${match[1]}-Q${quarter}`;
}
