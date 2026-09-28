/* 100x Light System — chart theme (one engine, Slice 1d)
 * lightweight-charts + chart.js share the same constants. No card frame.
 * bg #ffffff text #191919 grid #D6DCDE up #1aa86f down #e84a5a vol #e2e8f0 line #1B73D3
 */

export const lightChartTheme = {
  bg: "#ffffff",
  text: "#191919",
  grid: "#D6DCDE",
  up: "#1aa86f",
  down: "#e84a5a",
  volume: "#e2e8f0",
  accent: "#1B73D3",
} as const;

/** Color-blind-safe categorical sequence shared by every chart engine. */
export const okabeItoPalette = [
  "#0072B2",
  "#E69F00",
  "#009E73",
  "#D55E00",
  "#CC79A7",
  "#56B4E9",
  "#F0E442",
  "#000000",
] as const;

export type LightChartTheme = typeof lightChartTheme;

/* lightweight-charts options factory */
export function lwChartOptions(theme: LightChartTheme = lightChartTheme) {
  return {
    layout: { background: { color: theme.bg }, textColor: theme.text },
    grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
    rightPriceScale: { borderColor: theme.grid },
    timeScale: { borderColor: theme.grid },
  } as const;
}

export function lwCandlestickSeriesOptions(theme: LightChartTheme = lightChartTheme) {
  return {
    upColor: theme.up,
    downColor: theme.down,
    borderUpColor: theme.up,
    borderDownColor: theme.down,
    wickUpColor: theme.up,
    wickDownColor: theme.down,
  } as const;
}

export function lwLineSeriesOptions(theme: LightChartTheme = lightChartTheme) {
  return { color: theme.accent, lineWidth: 2 as const } as const;
}

export function lwVolumeSeriesOptions(theme: LightChartTheme = lightChartTheme) {
  return { color: theme.volume, priceScaleId: "" as const, priceLineVisible: false } as const;
}

/* chart.js (sparklines) — same palette, no card frame */
export function chartJsSparklineOptions(theme: LightChartTheme = lightChartTheme, up = true) {
  return {
    type: "line" as const,
    data: {},
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false as const,
      plugins: { legend: { display: false } as const },
      scales: {
        x: { display: false, grid: { display: false, color: theme.grid } },
        y: { display: false, grid: { display: false, color: theme.grid } },
      },
      elements: {
        line: { borderColor: up ? theme.up : theme.down, borderWidth: 1.5, tension: 0.3 },
        point: { radius: 0 },
      },
    },
  };
}

export function chartJsColors(theme: LightChartTheme = lightChartTheme) {
  return {
    line: theme.accent,
    up: theme.up,
    down: theme.down,
    grid: theme.grid,
    text: theme.text,
    volume: theme.volume,
  };
}
