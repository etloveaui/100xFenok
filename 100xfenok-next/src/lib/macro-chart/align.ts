import type { MarketChartPoint } from "@/lib/market-valuation/charts/types";
import type { MacroRawPoint } from "./types";

export function alignMacroPoints(points: readonly MacroRawPoint[], labels: readonly string[]): MarketChartPoint[] {
  if (points.length === 0 || labels.length === 0) return [];
  const byDate = new Map(points.map((point) => [point.date, point.value]));
  return labels.map((label) => ({
    label,
    value: typeof byDate.get(label) === "number" && Number.isFinite(byDate.get(label))
      ? byDate.get(label)!
      : null,
  }));
}

function dateValue(label: string): number {
  const value = Date.parse(label);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

export function buildAlignedLabels(series: ReadonlyArray<readonly MacroRawPoint[]>): string[] {
  const labels = new Set<string>();
  for (const points of series) {
    for (const point of points) labels.add(point.date);
  }
  return [...labels].sort((a, b) => dateValue(a) - dateValue(b) || a.localeCompare(b));
}

export function downsampleMacroPoints(points: readonly MacroRawPoint[], maxPoints = 1200): MacroRawPoint[] {
  if (points.length <= maxPoints) return [...points];
  const step = Math.ceil(points.length / maxPoints);
  const sampled = points.filter((_point, index) => index % step === 0);
  const last = points[points.length - 1];
  if (last && sampled[sampled.length - 1]?.date !== last.date) sampled.push(last);
  return sampled;
}
