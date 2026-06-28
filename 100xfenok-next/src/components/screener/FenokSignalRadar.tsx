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
import type { ScreenerStock } from "@/lib/screener/types";
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

interface FenokSignalRadarProps {
  stock: ScreenerStock;
}

interface RadarAxis {
  label: string;
  scoreKey: keyof ScreenerStock;
  directionKey: keyof ScreenerStock;
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

export function FenokSignalRadar({ stock }: FenokSignalRadarProps) {
  const theme = useMarketChartTheme();

  const hasAnyScore = AXES.some((axis) => isFiniteNumber(stock[axis.scoreKey]));

  const values = useMemo(
    () => AXES.map((axis) => (isFiniteNumber(stock[axis.scoreKey]) ? (stock[axis.scoreKey] as number) : 0)),
    [stock],
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
          pointRadius: 2,
          pointHoverRadius: 4,
          pointBackgroundColor: theme.token("brand"),
        },
      ],
    }),
    [values, theme],
  );

  const options = useMemo<ChartOptions<"radar">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const axis = AXES[ctx.dataIndex];
              const rawScore = stock[axis.scoreKey];
              const score = isFiniteNumber(rawScore) ? Math.round(rawScore).toString() : "—";
              const direction = directionLabel(stock[axis.directionKey] as string | null | undefined);
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
            font: { size: 9, weight: "bold" as const },
          },
          ticks: { display: false },
        },
      },
    }),
    [stock, theme],
  );

  if (!hasAnyScore) {
    return (
      <div
        className="grid h-[80px] w-[80px] place-items-center rounded-lg border border-dashed border-[var(--c-line)] bg-[var(--c-surface-2)] text-[9px] font-bold text-[var(--c-ink-3)]"
        title="Fenok 신호 데이터 없음"
      >
        신호
        <br />
        없음
      </div>
    );
  }

  return (
    <div className="relative h-[80px] w-[80px]">
      <Radar data={chartData} options={options} role="img" aria-label="Fenok 4-신호 레이더" />
    </div>
  );
}
