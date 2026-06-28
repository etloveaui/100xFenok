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

export interface FenokSignalRadarData {
  profitabilityScore?: number | null;
  profitabilityDirection?: string | null;
  growthScore?: number | null;
  growthDirection?: string | null;
  technicalFlowScore?: number | null;
  technicalFlowDirection?: string | null;
  fenokEdgeScore?: number | null;
  fenokEdgeDirection?: string | null;
}

interface FenokSignalRadarProps {
  data: FenokSignalRadarData;
  size?: "sm" | "md";
}

interface RadarAxis {
  label: string;
  scoreKey: keyof FenokSignalRadarData;
  directionKey: keyof FenokSignalRadarData;
}

const AXES: RadarAxis[] = [
  { label: "수익성", scoreKey: "profitabilityScore", directionKey: "profitabilityDirection" },
  { label: "성장", scoreKey: "growthScore", directionKey: "growthDirection" },
  { label: "기술·자금", scoreKey: "technicalFlowScore", directionKey: "technicalFlowDirection" },
  { label: "Fenok Edge", scoreKey: "fenokEdgeScore", directionKey: "fenokEdgeDirection" },
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function directionLabel(value: string | null | undefined): string {
  if (value === "positive" || value === "upside_bias" || value === "strong" || value === "constructive") return "상";
  if (value === "negative" || value === "downside_bias" || value === "weak" || value === "stressed") return "하";
  if (value === "neutral" || value === "balanced") return "중";
  return "·";
}

const SIZE_CLASS = {
  sm: "h-[80px] w-[104px]",
  md: "h-[160px] w-[160px]",
} as const;

export function FenokSignalRadar({ data, size = "sm" }: FenokSignalRadarProps) {
  const theme = useMarketChartTheme();

  const hasAnyScore = AXES.some((axis) => isFiniteNumber(data[axis.scoreKey]));

  const values = useMemo(
    () => AXES.map((axis) => (isFiniteNumber(data[axis.scoreKey]) ? (data[axis.scoreKey] as number) : 0)),
    [data],
  );

  const chartData = useMemo<ChartData<"radar">>(
    () => ({
      labels: AXES.map((axis) => axis.label),
      datasets: [
        {
          label: "Fenok 4-신호",
          data: values,
          borderColor: theme.token("brand"),
          backgroundColor: theme.alpha("brand", 0.16),
          borderWidth: 2,
          pointRadius: size === "md" ? 3 : 2,
          pointHoverRadius: size === "md" ? 5 : 4,
          pointBackgroundColor: theme.token("brand"),
        },
      ],
    }),
    [values, theme, size],
  );

  const options = useMemo<ChartOptions<"radar">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: {
          left: size === "md" ? 12 : 8,
          right: size === "md" ? 12 : 8,
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const axis = AXES[ctx.dataIndex];
              const rawScore = data[axis.scoreKey];
              const score = isFiniteNumber(rawScore) ? Math.round(rawScore).toString() : "—";
              const direction = directionLabel(data[axis.directionKey] as string | null | undefined);
              return `${axis.label}: ${score} · ${direction}`;
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
            font: { size: size === "md" ? 11 : 9, weight: "bold" as const },
            padding: size === "md" ? 6 : 4,
          },
          ticks: { display: false },
        },
      },
    }),
    [data, theme, size],
  );

  if (!hasAnyScore) {
    return (
      <div
        className={`grid ${SIZE_CLASS[size]} place-items-center rounded-lg border border-dashed border-[var(--c-line)] bg-[var(--c-surface-2)] text-[9px] font-bold text-[var(--c-ink-3)]`}
        title="Fenok 신호 데이터 없음"
      >
        신호
        <br />
        없음
      </div>
    );
  }

  return (
    <div className={`relative ${SIZE_CLASS[size]}`}>
      <Radar data={chartData} options={options} role="img" aria-label="Fenok 4-신호 레이더" />
    </div>
  );
}
