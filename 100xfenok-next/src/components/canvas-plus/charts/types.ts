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

export type CpPriceChartProps = {
  kind: CpChartKind;
  data: readonly CpChartDatum[];
  title: string;
  summary: string;
  ariaLabel?: string;
  range?: CpChartRange;
  height?: number;
  density?: "compact" | "default" | "comfy";
  showGrid?: boolean;
  showCrosshair?: boolean;
  showVolume?: boolean;
  className?: string;
  emptyLabel?: string;
};
