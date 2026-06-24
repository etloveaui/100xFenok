import type { MacroRawPoint, MacroSeriesDefinition, MacroValueTransform } from "./types";

function isFiniteValue(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function yoyLag(definition: MacroSeriesDefinition): number {
  if (definition.frequency === "quarterly") return 4;
  if (definition.frequency === "monthly") return 12;
  if (definition.frequency === "weekly") return 52;
  return 252;
}

export function applyMacroTransform(
  points: readonly MacroRawPoint[],
  transform: MacroValueTransform,
  definition: MacroSeriesDefinition,
): MacroRawPoint[] {
  if (transform === "raw") return [...points];

  if (transform === "rebase100") {
    const base = points.find((point) => point.value !== 0 && isFiniteValue(point.value))?.value;
    if (!base) return [];
    return points.map((point) => ({
      date: point.date,
      value: (point.value / base) * 100,
    }));
  }

  if (transform === "change") {
    return points
      .map((point, index) => {
        if (index === 0) return null;
        const prev = points[index - 1]?.value;
        if (!isFiniteValue(prev) || prev === 0) return null;
        return {
          date: point.date,
          value: ((point.value - prev) / Math.abs(prev)) * 100,
        };
      })
      .filter((point): point is MacroRawPoint => point !== null);
  }

  const lag = yoyLag(definition);
  return points
    .map((point, index) => {
      const prev = points[index - lag]?.value;
      if (!isFiniteValue(prev) || prev === 0) return null;
      return {
        date: point.date,
        value: ((point.value - prev) / Math.abs(prev)) * 100,
      };
    })
    .filter((point): point is MacroRawPoint => point !== null);
}

export function transformUnitLabel(transform: MacroValueTransform, unitLabel: string): string {
  if (transform === "rebase100") return "100 기준";
  if (transform === "yoy") return "YoY %";
  if (transform === "change") return "전기 대비 %";
  return unitLabel;
}
