"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  type AreaData,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type Time,
} from "lightweight-charts";

import type { CpChartDatum, CpPriceChartProps } from "@/components/canvas-plus/charts/types";

function cpClassNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function readCpToken(container: HTMLElement, tokenName: string, fallbackToken?: string): string {
  const scope = container.closest(".canvas-plus") ?? document.documentElement;
  const scopeStyles = getComputedStyle(scope);
  const rootStyles = getComputedStyle(document.documentElement);
  const value = scopeStyles.getPropertyValue(tokenName).trim();
  if (value) return value;
  if (fallbackToken) {
    const fallback = scopeStyles.getPropertyValue(fallbackToken).trim() || rootStyles.getPropertyValue(fallbackToken).trim();
    if (fallback) return fallback;
  }
  return rootStyles.getPropertyValue(tokenName).trim() || "currentColor";
}

function toLineData(data: readonly CpChartDatum[]): LineData<Time>[] {
  return data
    .filter((datum): datum is CpChartDatum & { value: number } => Number.isFinite(datum.value))
    .map((datum) => ({ time: datum.time, value: datum.value }));
}

function toAreaData(data: readonly CpChartDatum[]): AreaData<Time>[] {
  return data
    .filter((datum): datum is CpChartDatum & { value: number } => Number.isFinite(datum.value))
    .map((datum) => ({ time: datum.time, value: datum.value }));
}

function toCandlestickData(data: readonly CpChartDatum[]): CandlestickData<Time>[] {
  return data
    .filter(
      (datum): datum is CpChartDatum & { open: number; high: number; low: number; close: number } =>
        Number.isFinite(datum.open) &&
        Number.isFinite(datum.high) &&
        Number.isFinite(datum.low) &&
        Number.isFinite(datum.close),
    )
    .map((datum) => ({
      time: datum.time,
      open: datum.open,
      high: datum.high,
      low: datum.low,
      close: datum.close,
    }));
}

function toVolumeData(data: readonly CpChartDatum[], positiveColor: string, negativeColor: string): HistogramData<Time>[] {
  return data
    .filter((datum): datum is CpChartDatum & { volume: number } => Number.isFinite(datum.volume))
    .map((datum) => {
      const isDownBar = typeof datum.open === "number" && typeof datum.close === "number" && datum.close < datum.open;
      return {
        time: datum.time,
        value: datum.volume,
        color: isDownBar ? negativeColor : positiveColor,
      };
    });
}

export function CpPriceChartImpl({
  kind,
  data,
  title,
  summary,
  headingLevel = "h2",
  ariaLabel,
  range = "1Y",
  height = 280,
  density = "default",
  showGrid = true,
  showCrosshair = true,
  showVolume = false,
  className,
  emptyLabel = "차트 데이터 없음",
}: CpPriceChartProps) {
  const shellRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(() => typeof window !== "undefined" && !("IntersectionObserver" in window));
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const hasData = useMemo(() => {
    if (kind === "candlestick") {
      return data.some(
        (datum) =>
          Number.isFinite(datum.open) &&
          Number.isFinite(datum.high) &&
          Number.isFinite(datum.low) &&
          Number.isFinite(datum.close),
      );
    }
    return data.some((datum) => Number.isFinite(datum.value));
  }, [data, kind]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    if (!("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px 0px" },
    );

    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (event: MediaQueryListEvent) => setPrefersReducedMotion(event.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const container = canvasRef.current;
    if (!container || !isVisible || !hasData) return;

    const backgroundColor = readCpToken(container, "--cp-chart-bg", "--cp-surface");
    const textColor = readCpToken(container, "--cp-chart-axis", "--cp-text-muted");
    const gridColor = readCpToken(container, "--cp-chart-grid", "--cp-divider");
    const crosshairColor = readCpToken(container, "--cp-chart-crosshair", "--cp-text-soft");
    const lineColor = readCpToken(container, "--cp-chart-line-1", "--cp-accent");
    const areaColor = readCpToken(container, "--cp-chart-line-2", "--cp-accent");
    const positiveColor = readCpToken(container, "--cp-chart-positive-line", "--cp-positive");
    const negativeColor = readCpToken(container, "--cp-chart-negative-line", "--cp-negative");

    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { color: backgroundColor },
        textColor,
      },
      grid: {
        vertLines: { color: showGrid && !prefersReducedMotion ? gridColor : "transparent" },
        horzLines: { color: showGrid && !prefersReducedMotion ? gridColor : "transparent" },
      },
      crosshair: {
        horzLine: { color: showCrosshair ? crosshairColor : "transparent", visible: showCrosshair },
        vertLine: { color: showCrosshair ? crosshairColor : "transparent", visible: showCrosshair },
      },
      rightPriceScale: {
        borderColor: gridColor,
      },
      timeScale: {
        borderColor: gridColor,
        timeVisible: false,
        secondsVisible: false,
      },
    });

    if (kind === "candlestick") {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: positiveColor,
        downColor: negativeColor,
        borderUpColor: positiveColor,
        borderDownColor: negativeColor,
        wickUpColor: positiveColor,
        wickDownColor: negativeColor,
      });
      series.setData(toCandlestickData(data));

      if (showVolume) {
        const volumeSeries = chart.addSeries(HistogramSeries, {
          priceFormat: { type: "volume" },
          priceScaleId: "",
        });
        volumeSeries.setData(toVolumeData(data, positiveColor, negativeColor));
        chart.priceScale("").applyOptions({
          scaleMargins: {
            top: 0.78,
            bottom: 0,
          },
        });
      }
    } else if (kind === "area") {
      const series = chart.addSeries(AreaSeries, {
        lineColor: areaColor,
        topColor: areaColor,
        bottomColor: backgroundColor,
        lineWidth: 2,
      });
      series.setData(toAreaData(data));
    } else {
      const series = chart.addSeries(LineSeries, {
        color: kind === "sparkline" ? positiveColor : lineColor,
        lineWidth: kind === "sparkline" ? 1 : 2,
        priceLineVisible: kind !== "sparkline",
        lastValueVisible: kind !== "sparkline",
      });
      series.setData(toLineData(data));
      if (kind === "sparkline") {
        chart.applyOptions({
          rightPriceScale: { visible: false },
          timeScale: { visible: false },
        });
      }
    }

    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      chart.resize(Math.max(240, Math.round(entry.contentRect.width)), height);
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [data, hasData, height, isVisible, kind, prefersReducedMotion, showCrosshair, showGrid, showVolume]);

  const HeadingTag = headingLevel;

  return (
    <section
      ref={shellRef}
      className={cpClassNames("cp-chart-shell", className)}
      data-cp-price-chart
      data-chart-kind={kind}
      data-chart-range={range}
      data-density={density}
      aria-label={ariaLabel ?? title}
    >
      <header className="cp-chart-shell__header">
        <div>
          <HeadingTag className="cp-chart-shell__title">{title}</HeadingTag>
          <p className="cp-chart-summary" data-cp-price-chart-summary>
            {summary}
          </p>
        </div>
        <span className="cp-chart-shell__range">{range}</span>
      </header>

      {!hasData ? <p className="cp-chart-fallback">{emptyLabel}</p> : null}
      {hasData && !isVisible ? <div className="cp-chart-skeleton" aria-hidden="true" /> : null}
      {hasData ? (
        <div
          ref={canvasRef}
          className="cp-chart-shell__canvas"
          data-cp-price-chart-canvas
          data-reduced-motion={prefersReducedMotion ? "true" : "false"}
          style={{ minHeight: height }}
        />
      ) : null}
    </section>
  );
}
