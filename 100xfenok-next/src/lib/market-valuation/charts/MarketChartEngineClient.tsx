"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type {
  ActiveElement,
  ChartData,
  ChartEvent,
  ChartOptions,
  TooltipItem,
} from "chart.js";
import { Chart } from "react-chartjs-2";

import { useMarketChartTheme, type MarketChartTheme } from "./chartTheme";
import { ensureMarketChartJsRegistered } from "./chartJsRegistry";
import type {
  MarketChartEngineProps,
  MarketChartHoverPoint,
  MarketChartPoint,
  MarketChartSeries,
  MarketChartType,
} from "./types";

ensureMarketChartJsRegistered();

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function defaultFormatValue(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
  }).format(value);
}

function toFiniteNumber(value: string | number): number | null {
  const next = typeof value === "number" ? value : Number(value);
  return Number.isFinite(next) ? next : null;
}

function pointMap(series: MarketChartSeries): Map<string, MarketChartPoint> {
  return new Map(series.points.map((point) => [point.label, point]));
}

function buildLabels(series: readonly MarketChartSeries[], sortLabels: boolean): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const item of series) {
    for (const point of item.points) {
      if (seen.has(point.label)) continue;
      seen.add(point.label);
      labels.push(point.label);
    }
  }
  return sortLabels ? labels.sort((a, b) => a.localeCompare(b)) : labels;
}

function backgroundColors(
  values: Array<number | null>,
  color: string,
  negativeColor: string,
): string[] {
  return values.map((value) => (value !== null && value < 0 ? negativeColor : color));
}

function buildHoverPoint(
  label: string,
  index: number,
  series: readonly MarketChartSeries[],
): MarketChartHoverPoint {
  return {
    label,
    index,
    points: series.map((item) => {
      const point = item.points.find((candidate) => candidate.label === label);
      return {
        seriesId: item.id,
        seriesLabel: item.label,
        value: point?.value ?? null,
        detail: point?.detail,
      };
    }),
  };
}

function buildData(
  type: MarketChartType,
  series: readonly MarketChartSeries[],
  labels: readonly string[],
  theme: MarketChartTheme,
): ChartData<MarketChartType, Array<number | null>, string> {
  return {
    labels: [...labels],
    datasets: series.map((item, index) => {
      const color = theme.seriesColor(item, index);
      const negativeColor = theme.negativeColor(item);
      const pointsByLabel = pointMap(item);
      const values = labels.map((label) => pointsByLabel.get(label)?.value ?? null);
      const isLine = (item.chartType ?? type) === "line";
      return {
        type: item.chartType ?? type,
        label: item.label,
        data: values,
        borderColor: isLine ? color : backgroundColors(values, color, negativeColor),
        backgroundColor: backgroundColors(values, color, negativeColor),
        borderWidth: isLine ? 2 : 0,
        pointRadius: isLine ? 0 : undefined,
        pointHitRadius: isLine ? 10 : undefined,
        tension: isLine ? 0.24 : undefined,
        fill: false,
        spanGaps: true,
        hidden: item.hidden,
        yAxisID: item.yAxisId ?? "y",
      };
    }),
  };
}

function buildOptions({
  ariaLabel,
  formatValue,
  labels,
  onHoverPoint,
  onMouseHover,
  series,
  showLegend,
  suggestedMin,
  suggestedMax,
  yAxisTitle,
  y1AxisTitle,
  theme,
}: Required<Pick<MarketChartEngineProps, "ariaLabel" | "showLegend">> &
  Pick<
    MarketChartEngineProps,
    | "formatValue"
    | "onHoverPoint"
    | "suggestedMin"
    | "suggestedMax"
    | "yAxisTitle"
    | "y1AxisTitle"
  > & {
    labels: readonly string[];
    onMouseHover?: () => void;
    series: readonly MarketChartSeries[];
    theme: MarketChartTheme;
  }): ChartOptions<MarketChartType> {
  const valueFormatter = formatValue ?? defaultFormatValue;
  const axisTitleFont = { size: 10, weight: "bold" as const };
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "index",
      intersect: false,
    },
    onHover: (_event: ChartEvent, activeElements: ActiveElement[]) => {
      if (!onHoverPoint) return;
      onMouseHover?.();
      const active = activeElements[0];
      if (!active) {
        onHoverPoint(null);
        return;
      }
      const label = labels[active.index];
      onHoverPoint(label ? buildHoverPoint(label, active.index, series) : null);
    },
    plugins: {
      legend: {
        display: showLegend,
        position: "top",
        labels: {
          boxWidth: 10,
          boxHeight: 10,
          color: theme.token("ink2"),
          font: { size: 11, weight: "bold" },
          usePointStyle: true,
        },
      },
      tooltip: {
        mode: "index",
        intersect: false,
        callbacks: {
          title(items: TooltipItem<MarketChartType>[]) {
            return items[0]?.label ?? ariaLabel;
          },
          label(item: TooltipItem<MarketChartType>) {
            const raw = typeof item.raw === "number" ? item.raw : null;
            const label = item.dataset.label ? `${item.dataset.label}: ` : "";
            return `${label}${valueFormatter(raw)}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: theme.token("ink3"),
          font: { size: 10, weight: "bold" },
          maxRotation: 0,
          autoSkip: true,
          autoSkipPadding: 16,
        },
      },
      y: {
        suggestedMin,
        suggestedMax,
        grid: { color: theme.token("line2") },
        title: yAxisTitle
          ? { display: true, text: yAxisTitle, color: theme.token("ink3"), font: axisTitleFont }
          : undefined,
        ticks: {
          color: theme.token("ink3"),
          font: { size: 10, weight: "bold" },
          callback(value) {
            return valueFormatter(toFiniteNumber(value));
          },
        },
      },
      y1: {
        display: series.some((item) => item.yAxisId === "y1"),
        position: "right",
        grid: { drawOnChartArea: false },
        title: y1AxisTitle
          ? { display: true, text: y1AxisTitle, color: theme.token("ink3"), font: axisTitleFont }
          : undefined,
        ticks: {
          color: theme.token("ink3"),
          font: { size: 10, weight: "bold" },
          callback(value) {
            return valueFormatter(toFiniteNumber(value));
          },
        },
      },
    },
  };
}

export function MarketChartEngineClient({
  type = "line",
  series,
  ariaLabel,
  className,
  heightClassName = "h-72",
  emptyLabel = "차트 데이터 없음",
  showLegend = true,
  sortLabels = false,
  suggestedMin,
  suggestedMax,
  formatValue,
  onHoverPoint,
  yAxisTitle,
  y1AxisTitle,
}: MarketChartEngineProps) {
  const theme = useMarketChartTheme();
  const [keyboardIndex, setKeyboardIndex] = useState<number | null>(null);
  const visibleSeries = useMemo(
    () => series.filter((item) => item.points.length > 0),
    [series],
  );
  const labels = useMemo(
    () => buildLabels(visibleSeries, sortLabels),
    [visibleSeries, sortLabels],
  );
  const data = useMemo(
    () => buildData(type, visibleSeries, labels, theme),
    [type, visibleSeries, labels, theme],
  );
  const resetKeyboardHover = useMemo(
    () =>
      onHoverPoint
        ? () => {
            setKeyboardIndex(null);
          }
        : undefined,
    [onHoverPoint],
  );
  const options = useMemo(
    () =>
      buildOptions({
        ariaLabel,
        formatValue,
        labels,
        onHoverPoint,
        onMouseHover: resetKeyboardHover,
        series: visibleSeries,
        showLegend,
        suggestedMin,
        suggestedMax,
        yAxisTitle,
        y1AxisTitle,
        theme,
      }),
    [
      ariaLabel,
      formatValue,
      labels,
      onHoverPoint,
      resetKeyboardHover,
      visibleSeries,
      showLegend,
      suggestedMin,
      suggestedMax,
      yAxisTitle,
      y1AxisTitle,
      theme,
    ],
  );

  useEffect(() => {
    if (keyboardIndex !== null && keyboardIndex >= labels.length) {
      const timer = window.setTimeout(() => {
        setKeyboardIndex(null);
        onHoverPoint?.(null);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [keyboardIndex, labels.length, onHoverPoint]);

  const selectKeyboardIndex = (index: number | null) => {
    if (!onHoverPoint) return;
    if (index === null || labels.length === 0) {
      setKeyboardIndex(null);
      onHoverPoint(null);
      return;
    }
    const nextIndex = Math.min(Math.max(index, 0), labels.length - 1);
    const label = labels[nextIndex];
    if (!label) {
      setKeyboardIndex(null);
      onHoverPoint(null);
      return;
    }
    setKeyboardIndex(nextIndex);
    onHoverPoint(buildHoverPoint(label, nextIndex, visibleSeries));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onHoverPoint || labels.length === 0) return;
    const latestIndex = labels.length - 1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      selectKeyboardIndex((keyboardIndex ?? latestIndex) + 1);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      selectKeyboardIndex((keyboardIndex ?? latestIndex) - 1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      selectKeyboardIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      selectKeyboardIndex(latestIndex);
    }
  };

  if (visibleSeries.length === 0 || labels.length === 0) {
    return (
      <div
        className={cx(
          "grid min-h-48 place-items-center rounded-xl border border-dashed border-[var(--c-line)] bg-[var(--c-surface-2)] text-xs font-bold text-[var(--c-ink-2)]",
          heightClassName,
          className,
        )}
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <div
      className={cx(
        "relative min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-brand)] focus-visible:ring-offset-2",
        heightClassName,
        className,
      )}
      aria-label={`${ariaLabel}. 방향키, Home, End 키로 시점을 이동할 수 있습니다.`}
      onBlur={() => selectKeyboardIndex(null)}
      onKeyDown={handleKeyDown}
      role="group"
      tabIndex={onHoverPoint ? 0 : undefined}
    >
      <Chart type={type} data={data} options={options} aria-label={ariaLabel} role="img" />
    </div>
  );
}
