"use client";

import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";

import type { StockAnalyzerChartModel } from "@/lib/stock-analyzer/types";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
);

const chartPalette = [
  "rgba(27, 115, 211, 0.75)",
  "rgba(34, 197, 94, 0.75)",
  "rgba(245, 158, 11, 0.75)",
  "rgba(99, 102, 241, 0.75)",
];

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: "top" as const,
    },
  },
  scales: {
    x: {
      ticks: {
        maxRotation: 0,
      },
    },
  },
};

function getChartData(model: StockAnalyzerChartModel) {
  const labels = model.series[0]?.points.map((point) => String(point.x)) ?? [];

  const datasets = model.series.map((series, index) => ({
    label: series.label,
    data: series.points.map((point) => point.y),
    borderColor: series.color ?? chartPalette[index % chartPalette.length],
    backgroundColor: series.color ?? chartPalette[index % chartPalette.length],
    tension: 0.24,
  }));

  return { labels, datasets };
}

interface StockAnalyzerChartsProps {
  charts: readonly StockAnalyzerChartModel[];
}

export function StockAnalyzerCharts({ charts }: StockAnalyzerChartsProps) {
  return (
    <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
      {charts.map((chart) => {
        const data = getChartData(chart);
        const isLine = chart.config.chartType === "line";

        return (
          <article key={chart.config.chartId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-black text-slate-700">{chart.config.title}</h2>
            <div className="mt-3 h-72 w-full">
              {isLine ? <Line data={data} options={chartOptions} /> : <Bar data={data} options={chartOptions} />}
            </div>
          </article>
        );
      })}
    </section>
  );
}
