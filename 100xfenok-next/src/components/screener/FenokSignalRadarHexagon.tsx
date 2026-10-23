// Shared axis shape used by the screener detail panel.
export interface FenokSignalRadarHexagonAxis {
  label: string;
  score: number | null;
  direction?: string | null;
  tier?: string | null;
  /** Full honest label for tooltips/legends (spokes use the short `label`). */
  fullLabel?: string | null;
  /** Extra tooltip caveat for inverted/neutral axes. */
  tooltipNote?: string | null;
  /** True when score is an inverted/safety display value, not the raw pressure value. */
  invertedDisplay?: boolean;
}
