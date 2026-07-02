export type CpChartKind = "line" | "area" | "candlestick" | "sparkline";

export type CpChartRange = "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y" | "MAX";

export type CpChartDatum = {
  time: string;
  value?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
};

export type CpW4AnnualReturn = {
  year: string;
  returnPct: number;
};

export type CpW4IndexComparison = {
  label: string;
  returnPct: number;
};

export type CpPriceChartProps = {
  kind: CpChartKind;
  data: readonly CpChartDatum[];
  title: string;
  summary: string;
  headingLevel?: "h2" | "h3";
  ariaLabel?: string;
  range?: CpChartRange;
  height?: number;
  density?: "compact" | "default" | "comfy";
  showGrid?: boolean;
  showCrosshair?: boolean;
  showVolume?: boolean;
  volumeTone?: "directional" | "muted";
  hideHeader?: boolean;
  composition?: "default" | "w4";
  symbol?: string;
  currency?: string;
  annualReturns?: readonly CpW4AnnualReturn[];
  indexComparisons?: readonly CpW4IndexComparison[];
  footnote?: string;
  className?: string;
  emptyLabel?: string;
};
