"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  type ChartData,
  type ChartOptions,
  Filler,
  Legend,
  LineElement,
  PointElement,
  RadialLinearScale,
  RadarController,
  Tooltip,
} from "chart.js";
import { Radar } from "react-chartjs-2";
import { useMarketChartTheme } from "@/lib/market-valuation/charts/chartTheme";

ChartJS.register(
  RadialLinearScale,
  RadarController,
  Filler,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
);

export interface FenokSignalRadarHexagonAxis {
  label: string;
  score: number | null;
  direction?: string | null;
  tier?: string | null;
  /** Full honest label for tooltips/legends (spokes use the short `label`). */
  fullLabel?: string | null;
}

export interface FenokSignalRadarHexagonProps {
  title: string;
  axes: FenokSignalRadarHexagonAxis[];
  size?: "md" | "lg";
  emptyLabel?: string;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function directionLabel(value: string | null | undefined): string {
  if (value === "positive" || value === "upside_bias" || value === "strong" || value === "constructive") return "상";
  if (value === "negative" || value === "downside_bias" || value === "weak" || value === "stressed") return "하";
  if (value === "neutral" || value === "balanced") return "중";
  return "·";
}

function tierLabel(value: string | null | undefined): string {
  if (!value || value === "unavailable") return "";
  if (value === "strong") return "강함";
  if (value === "constructive") return "우호";
  if (value === "neutral") return "중립";
  if (value === "weak") return "약함";
  if (value === "stressed") return "압박";
  return value.replaceAll("_", " ");
}

const SIZE_CLASS = {
  md: "h-[200px] w-[200px]",
  lg: "h-[280px] w-[280px]",
} as const;

const LAYOUT_PADDING = {
  md: 12,
  lg: 16,
} as const;

const POINT_LABEL_PADDING = {
  md: 6,
  lg: 8,
} as const;

const FONT_SIZE = {
  md: 10,
  lg: 11,
} as const;

export function FenokSignalRadarHexagon({ title, axes, size = "lg", emptyLabel }: FenokSignalRadarHexagonProps) {
  const theme = useMarketChartTheme();

  const safeAxes = useMemo(
    () => axes.slice(0, 6).map((axis) => ({ ...axis, score: isFiniteNumber(axis.score) ? axis.score : null })),
    [axes],
  );

  const hasAnyScore = safeAxes.some((axis) => axis.score !== null);

  const values = useMemo(
    () => safeAxes.map((axis) => (axis.score !== null ? axis.score : 0)),
    [safeAxes],
  );

  const chartData = useMemo<ChartData<"radar">>(
    () => ({
      labels: safeAxes.map((axis) => axis.label),
      datasets: [
        {
          label: title,
          data: values,
          borderColor: theme.token("brand"),
          backgroundColor: theme.alpha("brand", 0.16),
          borderWidth: 2,
          pointRadius: size === "lg" ? 4 : 3,
          pointHoverRadius: size === "lg" ? 6 : 5,
          pointBackgroundColor: theme.token("brand"),
        },
      ],
    }),
    [safeAxes, values, theme, title, size],
  );

  const options = useMemo<ChartOptions<"radar">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: LAYOUT_PADDING[size],
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const axis = safeAxes[ctx.dataIndex];
              const score = axis.score !== null ? Math.round(axis.score).toString() : "—";
              const direction = directionLabel(axis.direction);
              const tier = tierLabel(axis.tier);
              const name = axis.fullLabel ?? axis.label;
              const parts = [`${name}: ${score}`, direction, tier].filter(Boolean);
              return parts.join(" · ");
            },
          },
        },
      },
      scales: {
        r: {
          min: 0,
          max: 100,
          angleLines: { color: theme.token("line") },
          grid: { color: theme.token("line") },
          pointLabels: {
            color: theme.token("ink2"),
            font: { size: FONT_SIZE[size], weight: "bold" as const },
            padding: POINT_LABEL_PADDING[size],
            callback: (value: string | string[]) => {
              const text = Array.isArray(value) ? value.join(" ") : value;
              if (text.includes(" ")) return text.split(" ");
              return text;
            },
          },
          ticks: { display: false },
        },
      },
    }),
    [safeAxes, theme, size],
  );

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-[11px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">
        {title}
      </span>
      {hasAnyScore ? (
        <div className={`relative ${SIZE_CLASS[size]}`}>
          <Radar data={chartData} options={options} role="img" aria-label={`${title} 6축 레이더`} />
        </div>
      ) : (
        <div
          className={`grid ${SIZE_CLASS[size]} place-items-center rounded-lg border border-dashed border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 text-center text-[10px] font-bold text-[var(--c-ink-3)]`}
          title="신호 데이터 없음"
        >
          {emptyLabel ?? (
            <>
              신호
              <br />
              없음
            </>
          )}
        </div>
      )}
    </div>
  );
}
