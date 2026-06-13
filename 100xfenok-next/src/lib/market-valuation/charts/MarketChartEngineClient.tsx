"use client";

import { useMemo } from "react";
import type {
  ActiveElement,
  ChartData,
  ChartEvent,
  ChartOptions,
  TooltipItem,
} from "chart.js";
import { Chart } from "react-chartjs-2";

import { ensureMarketChartJsRegistered } from "./chartJsRegistry";
import type {
  MarketChartEngineProps,
  MarketChartHoverPoint,
  MarketChartPoint,
  MarketChartSeries,
  MarketChartType,
} from "./types";

ensureMarketChartJsRegistered();

const palette = [
  "#0072B2",
  "#E69F00",
  "#56B4E9",
  "#D55E00",
  "#009E73",
  "#6b7280",
] as const;

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
): ChartData<MarketChartType, Array<number | null>, string> {
  return {
    labels: [...labels],
    datasets: series.map((item, index) => {
      const color = item.color ?? palette[index % palette.length];
      const negativeColor = item.negativeColor ?? "#D55E00";
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
  series,
  showLegend,
  suggestedMin,
  suggestedMax,
  yAxisTitle,
  y1AxisTitle,
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
    series: readonly MarketChartSeries[];
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
          color: "#475569",
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
          color: "#64748b",
          font: { size: 10, weight: "bold" },
          maxRotation: 0,
          autoSkip: true,
          autoSkipPadding: 16,
        },
      },
      y: {
        suggestedMin,
        suggestedMax,
        grid: { color: "rgba(148, 163, 184, 0.22)" },
        title: yAxisTitle
          ? { display: true, text: yAxisTitle, color: "#64748b", font: axisTitleFont }
          : undefined,
        ticks: {
          color: "#64748b",
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
          ? { display: true, text: y1AxisTitle, color: "#64748b", font: axisTitleFont }
          : undefined,
        ticks: {
          color: "#64748b",
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
  const visibleSeries = useMemo(
    () => series.filter((item) => item.points.length > 0),
    [series],
  );
  const labels = useMemo(
    () => buildLabels(visibleSeries, sortLabels),
    [visibleSeries, sortLabels],
  );
  const data = useMemo(
    () => buildData(type, visibleSeries, labels),
    [type, visibleSeries, labels],
  );
  const options = useMemo(
    () =>
      buildOptions({
        ariaLabel,
        formatValue,
        labels,
        onHoverPoint,
        series: visibleSeries,
        showLegend,
        suggestedMin,
        suggestedMax,
        yAxisTitle,
        y1AxisTitle,
      }),
    [
      ariaLabel,
      formatValue,
      labels,
      onHoverPoint,
      visibleSeries,
      showLegend,
      suggestedMin,
      suggestedMax,
      yAxisTitle,
      y1AxisTitle,
    ],
  );

  if (visibleSeries.length === 0 || labels.length === 0) {
    return (
      <div
        className={cx(
          "grid min-h-48 place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-xs font-bold text-slate-400",
          heightClassName,
          className,
        )}
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className={cx("relative min-w-0", heightClassName, className)} aria-label={ariaLabel}>
      <Chart type={type} data={data} options={options} />
    </div>
  );
}
