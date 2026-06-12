/**
 * PER band SSOT utilities.
 *
 * Source: src/lib/screener/bands.ts
 * Used by: ScreenerClient (PerBandBar + bandFilter)
 */

export const BAND_CHEAP = 0.25;
export const BAND_RICH = 0.75;

type MaybeNumber = number | null | undefined;

function finite(value: MaybeNumber): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeBandTuple(current: MaybeNumber, min: MaybeNumber, max: MaybeNumber): [number, number, number] | null {
  if (!finite(current) || !finite(min) || !finite(max)) return null;
  if (min >= max) return null;
  return [current, min, max];
}

export function bandPct(current: number, min: number, max: number): number {
  if (!normalizeBandTuple(current, min, max)) return 0.5;
  return Math.min(1, Math.max(0, (current - min) / (max - min)));
}

export function bandClass(pct: number): "emerald" | "slate" | "rose" {
  if (pct <= BAND_CHEAP) return "emerald";
  if (pct >= BAND_RICH) return "rose";
  return "slate";
}

export function bandLabel(pct: number): string {
  if (pct <= BAND_CHEAP) return "저평가";
  if (pct >= BAND_RICH) return "고평가";
  return "적정";
}
