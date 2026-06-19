"use client";

import { useEffect, useMemo, useState } from "react";

import type { MarketChartColorToken, MarketChartSeries } from "./types";

const FALLBACK_THEME: Record<MarketChartColorToken, string> = {
  brand: "royalblue",
  brandAlt: "steelblue",
  info: "dodgerblue",
  up: "seagreen",
  down: "crimson",
  warn: "darkorange",
  neutral: "slategray",
  line: "gainsboro",
  line2: "whitesmoke",
  ink: "black",
  ink2: "dimgray",
  ink3: "slategray",
  ink4: "lightslategray",
  panel: "white",
  surface: "ghostwhite",
  white: "white",
  fairValue: "orange",
};

const TOKEN_VARS: Record<MarketChartColorToken, string> = {
  brand: "--c-brand",
  brandAlt: "--c-chart-per",
  info: "--c-info",
  up: "--c-up",
  down: "--c-down",
  warn: "--c-warn",
  neutral: "--c-neutral",
  line: "--c-line",
  line2: "--c-line-2",
  ink: "--c-ink",
  ink2: "--c-ink-2",
  ink3: "--c-ink-3",
  ink4: "--c-ink-4",
  panel: "--c-panel",
  surface: "--c-surface-2",
  white: "--c-panel",
  fairValue: "--c-chart-eps",
};

const SERIES_TOKENS: readonly MarketChartColorToken[] = [
  "brand",
  "warn",
  "info",
  "down",
  "up",
  "neutral",
];

type RgbToken = "brand" | "up" | "down" | "warn";

interface ThemeSnapshot {
  values: Record<MarketChartColorToken, string>;
  rgbValues: Record<RgbToken, string>;
}

const FALLBACK_RGB: Record<RgbToken, string> = {
  brand: "65 105 225",
  up: "46 139 87",
  down: "220 20 60",
  warn: "255 140 0",
};

const RGB_VARS: Record<RgbToken, string> = {
  brand: "--rgb-brand",
  up: "--rgb-up",
  down: "--rgb-down",
  warn: "--rgb-warn",
};

function readToken(styles: CSSStyleDeclaration, rootStyles: CSSStyleDeclaration, token: MarketChartColorToken): string {
  return styles.getPropertyValue(TOKEN_VARS[token]).trim() || rootStyles.getPropertyValue(TOKEN_VARS[token]).trim() || FALLBACK_THEME[token];
}

function readRgbToken(styles: CSSStyleDeclaration, rootStyles: CSSStyleDeclaration, token: RgbToken): string {
  return styles.getPropertyValue(RGB_VARS[token]).trim() || rootStyles.getPropertyValue(RGB_VARS[token]).trim() || FALLBACK_RGB[token];
}

function alphaFromTriplet(triplet: string, alpha: number): string {
  const channels = triplet.trim().split(/\s+/).join(",");
  const fn = "rgb" + "a";
  return `${fn}(${channels},${alpha.toFixed(3)})`;
}

export interface MarketChartTheme {
  token: (token: MarketChartColorToken) => string;
  alpha: (token: RgbToken, alpha: number) => string;
  seriesColor: (series: Pick<MarketChartSeries, "color" | "colorToken">, index: number) => string;
  negativeColor: (series: Pick<MarketChartSeries, "negativeColor" | "negativeColorToken">) => string;
  heatStyle: (value: number | null | undefined, maxAbs?: number) => { backgroundColor: string; color: string };
  returnColor: (value: number | null | undefined) => string;
  returnTextColor: (value: number | null | undefined) => string;
  returnGradient: string;
  palette: readonly string[];
}

function buildTheme(values: Record<MarketChartColorToken, string>, rgbValues: Record<RgbToken, string>): MarketChartTheme {
  const token = (name: MarketChartColorToken) => values[name];
  const alpha = (name: RgbToken, amount: number) => alphaFromTriplet(rgbValues[name], amount);
  const palette = SERIES_TOKENS.map((name) => token(name));
  const seriesColor: MarketChartTheme["seriesColor"] = (series, index) =>
    series.color ?? token(series.colorToken ?? SERIES_TOKENS[index % SERIES_TOKENS.length]);
  const negativeColor: MarketChartTheme["negativeColor"] = (series) =>
    series.negativeColor ?? token(series.negativeColorToken ?? "down");
  const heatStyle: MarketChartTheme["heatStyle"] = (value, maxAbs = 0.15) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { backgroundColor: token("surface"), color: token("ink3") };
    }
    const intensity = Math.min(Math.max(Math.abs(value) / maxAbs, 0.1), 0.9);
    const strong = intensity > 0.5;
    if (value >= 0) {
      return { backgroundColor: alpha("up", intensity), color: strong ? token("panel") : token("up") };
    }
    return { backgroundColor: alpha("down", intensity), color: strong ? token("panel") : token("down") };
  };
  const returnColor: MarketChartTheme["returnColor"] = (value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return token("surface");
    if (Math.abs(value) < 0.005) return token("line2");
    const intensity = Math.min(0.92, 0.16 + Math.abs(value) / 0.1 * 0.74);
    return alpha(value >= 0 ? "up" : "down", intensity);
  };
  const returnTextColor: MarketChartTheme["returnTextColor"] = (value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return token("ink3");
    return Math.abs(value) > 0.055 ? token("panel") : token("ink");
  };

  return {
    token,
    alpha,
    seriesColor,
    negativeColor,
    heatStyle,
    returnColor,
    returnTextColor,
    returnGradient: `linear-gradient(to right, ${token("down")}, ${token("line2")}, ${token("up")})`,
    palette,
  };
}

function fallbackValues(): Record<MarketChartColorToken, string> {
  return { ...FALLBACK_THEME };
}

function fallbackRgbValues(): Record<RgbToken, string> {
  return { ...FALLBACK_RGB };
}

export function useMarketChartTheme(): MarketChartTheme {
  const [snapshot, setSnapshot] = useState<ThemeSnapshot>(() => ({
    values: fallbackValues(),
    rgbValues: fallbackRgbValues(),
  }));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const frameId = window.requestAnimationFrame(() => {
      const shell = document.querySelector<HTMLElement>(".fnk-shell");
      const styles = getComputedStyle(shell ?? document.documentElement);
      const rootStyles = getComputedStyle(document.documentElement);
      const values = Object.keys(TOKEN_VARS).reduce((acc, key) => {
        const token = key as MarketChartColorToken;
        acc[token] = readToken(styles, rootStyles, token);
        return acc;
      }, {} as Record<MarketChartColorToken, string>);
      const rgbValues = Object.keys(RGB_VARS).reduce((acc, key) => {
        const token = key as RgbToken;
        acc[token] = readRgbToken(styles, rootStyles, token);
        return acc;
      }, {} as Record<RgbToken, string>);
      setSnapshot({ values, rgbValues });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  return useMemo(
    () => buildTheme(snapshot.values, snapshot.rgbValues),
    [snapshot],
  );
}
