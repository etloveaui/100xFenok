export const MONA_VNEXT_LIVE_THINKING_LEVEL = "low";
export const MONA_VNEXT_LIVE_DEFAULT_TEMPERATURE = 1;
export const MONA_VNEXT_LIVE_TEMPERATURES = [
  MONA_VNEXT_LIVE_DEFAULT_TEMPERATURE,
  0.55,
] as const;

export type MonaVnextLiveTemperature = typeof MONA_VNEXT_LIVE_TEMPERATURES[number];

export function normalizeMonaVnextLiveTemperature(value: unknown): MonaVnextLiveTemperature {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  return MONA_VNEXT_LIVE_TEMPERATURES.some((temperature) => temperature === numeric)
    ? numeric as MonaVnextLiveTemperature
    : MONA_VNEXT_LIVE_DEFAULT_TEMPERATURE;
}
