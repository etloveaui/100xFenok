export type MarketChartType = "line" | "bar";

export type MarketChartValueFormatter = (value: number | null) => string;

export type MarketChartColorToken =
  | "brand"
  | "brandAlt"
  | "info"
  | "up"
  | "down"
  | "warn"
  | "neutral"
  | "line"
  | "line2"
  | "ink"
  | "ink2"
  | "ink3"
  | "ink4"
  | "panel"
  | "surface"
  | "white"
  | "fairValue";

export interface MarketChartPoint {
  label: string;
  value: number | null;
  detail?: string;
}

export interface MarketChartSeries {
  id: string;
  label: string;
  points: readonly MarketChartPoint[];
  color?: string;
  colorToken?: MarketChartColorToken;
  negativeColor?: string;
  negativeColorToken?: MarketChartColorToken;
  hidden?: boolean;
  yAxisId?: "y" | "y1";
  chartType?: MarketChartType;
}

export interface MarketChartHoverSeriesPoint {
  seriesId: string;
  seriesLabel: string;
  value: number | null;
  detail?: string;
}

export interface MarketChartHoverPoint {
  label: string;
  index: number;
  points: MarketChartHoverSeriesPoint[];
}

export interface MarketChartEngineProps {
  type?: MarketChartType;
  series: readonly MarketChartSeries[];
  ariaLabel: string;
  className?: string;
  heightClassName?: string;
  emptyLabel?: string;
  showLegend?: boolean;
  sortLabels?: boolean;
  suggestedMin?: number;
  suggestedMax?: number;
  formatValue?: MarketChartValueFormatter;
  onHoverPoint?: (point: MarketChartHoverPoint | null) => void;
  /** Left (y) axis unit title, e.g. "TGA ($B)". Rendered only when set. */
  yAxisTitle?: string;
  /** Right (y1) axis unit title for dual-axis charts, e.g. "Stablecoin ($B)". */
  y1AxisTitle?: string;
}
