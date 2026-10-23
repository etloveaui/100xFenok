import type { SeriesPoint } from "./signals-core";
import type { MarketChartSeries } from "@/lib/market-valuation/charts/types";

export function valueAt(series: readonly SeriesPoint[], date: string): number | null {
  let low = 0;
  let high = series.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (series[middle].date <= date) { found = middle; low = middle + 1; }
    else high = middle - 1;
  }
  return found < 0 ? null : series[found].val;
}

export function weekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

export function completeWeeks<T extends { date: string }>(rows: readonly T[], now = new Date()): T[] {
  const currentWeek = weekStart(now.toISOString().slice(0, 10));
  const weeks = new Map<string, T>();
  for (const row of rows) {
    const week = weekStart(row.date);
    if (week < currentWeek) weeks.set(week, row);
  }
  return [...weeks.values()];
}

export function yearOverYear(rows: readonly SeriesPoint[]): SeriesPoint[] {
  const byMonth = new Map(rows.map((row) => [row.date.slice(0, 7), row.val]));
  return rows.flatMap((row) => {
    const prior = byMonth.get(`${Number(row.date.slice(0, 4)) - 1}${row.date.slice(4, 7)}`);
    return prior == null || prior === 0 ? [] : [{ date: row.date, val: (row.val / prior - 1) * 100 }];
  });
}

export function chartSeries(id: string, label: string, rows: readonly SeriesPoint[], axis: "y" | "y1" = "y", scale = 1): MarketChartSeries {
  return { id, label, yAxisId: axis, points: rows.map((row) => ({ label: row.date, value: row.val * scale })) };
}

export function displayNumber(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export const DETAIL_RANGES = [
  { id: "1M", label: "1M", months: 1 }, { id: "3M", label: "3M", months: 3 },
  { id: "6M", label: "6M", months: 6 }, { id: "1Y", label: "1Y", months: 12 },
  { id: "3Y", label: "3Y", months: 36 }, { id: "5Y", label: "5Y", months: 60 }, { id: "MAX", label: "전체" },
];
