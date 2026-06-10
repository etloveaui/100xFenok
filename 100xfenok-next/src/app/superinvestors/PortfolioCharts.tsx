"use client";

import { useMemo, useState } from "react";
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement } from "chart.js";
import { TreemapController, TreemapElement } from "chartjs-chart-treemap";
import type { ChartData } from "chart.js";
import { Doughnut, Bar, Chart } from "react-chartjs-2";
import { sectorColor, sectorLabelKo } from "@/lib/design/sectorMap";
import type { CanonicalSector } from "@/lib/design/sectorMap";
import type { PortfolioRow, PortfolioViewsData } from "@/lib/superinvestors/types";

ChartJS.register(
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  TreemapController,
  TreemapElement,
);

// ---------------------------------------------------------------------------
// Module-level portfolio views cache
// ---------------------------------------------------------------------------

let pvCache: PortfolioViewsData | null = null;
let pvPromise: Promise<PortfolioViewsData | null> | null = null;

export function loadPortfolioViews(): Promise<PortfolioViewsData | null> {
  if (pvCache) return Promise.resolve(pvCache);
  if (pvPromise) return pvPromise;
  pvPromise = fetch("/data/sec-13f/analytics/portfolio_views.json")
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<PortfolioViewsData>;
    })
    .then((data) => {
      pvCache = data;
      return data;
    })
    .catch(() => {
      pvPromise = null;
      return null;
    });
  return pvPromise;
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function interpolate(hexA: string, hexB: string, t: number): string {
  const a = [1, 3, 5].map((i) => parseInt(hexA.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(hexB.slice(i, i + 2), 16));
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
}

function retColor(ret: number | null): string {
  if (ret === null) return "#f1f5f9"; // slate-100
  const clamped = Math.max(-0.1, Math.min(0.1, ret));
  const t = (clamped + 0.1) / 0.2; // 0..1
  if (t < 0.5) return interpolate("#f43f5e", "#e2e8f0", t * 2); // rose-500 → slate-200
  return interpolate("#e2e8f0", "#059669", (t - 0.5) * 2); // slate-200 → emerald-600
}

function retStr(ret: number | null): string {
  if (ret === null) return "—";
  const pct = (ret * 100).toFixed(1);
  return ret >= 0 ? `+${pct}%` : `${pct}%`;
}

// ---------------------------------------------------------------------------
// PortfolioTreemap
// ---------------------------------------------------------------------------

interface TreemapProps {
  rows: PortfolioRow[];
  quarterLabel: string;
}

export function PortfolioTreemap({ rows, quarterLabel }: TreemapProps) {
  const data = useMemo(() => {
    const displayRows = rows.filter((r) => r.weight > 0);
    return {
      datasets: [
        {
          label: "Portfolio",
          tree: displayRows.map((r) => ({
            value: r.weight,
            _data: r,
          })),
          key: "value",
          labels: displayRows.map((r) => {
            if (r.weight >= 0.04) return `${r.ticker}\n${retStr(r.ret)}`;
            if (r.weight >= 0.015) return r.ticker;
            return "";
          }),
          backgroundColor: displayRows.map((r) => retColor(r.ret)),
          borderColor: "#ffffff",
          borderWidth: 2,
          spacing: 1,
        },
      ],
    };
  }, [rows]);

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          callbacks: {
            title(items: Array<{ raw: { _data: PortfolioRow } }>) {
              const d = items[0]?.raw?._data;
              if (!d) return "";
              return `${d.name} (${d.ticker})`;
            },
            label(item: { raw: { _data: PortfolioRow } }) {
              const d = item.raw._data;
              return [
                `비중: ${(d.weight * 100).toFixed(2)}%`,
                `수익률(3개월): ${retStr(d.ret)}`,
                `섹터: ${sectorLabelKo(d.sector as CanonicalSector)}`,
              ];
            },
          },
        },
        legend: { display: false },
      },
    }),
    [],
  );

  return (
    <div>
      <div className="relative" style={{ height: 420 }}>
        {/* @ts-expect-error treemap type from chartjs-chart-treemap */}
        <Chart type="treemap" data={data} options={options} />
      </div>
      {/* Legend strip */}
      <div className="mt-2">
        <div className="flex items-center justify-center gap-2 text-[10px] font-bold text-slate-500">
          <span>손실</span>
          <span
            className="inline-block h-3 w-32 rounded"
            style={{
              background: "linear-gradient(to right, #f43f5e, #e2e8f0, #059669)",
            }}
          />
          <span>수익</span>
        </div>
        <p className="mt-1 text-center text-[10px] font-semibold text-slate-400">
          수익률 = 최근 3개월 (분기말 이후 근사) · {quarterLabel} 기준
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SectorMixPanel
// ---------------------------------------------------------------------------

interface SectorMixProps {
  currentSectors: Record<string, number>;
  history: Record<string, number[]>;
  quarters: string[];
}

export function SectorMixPanel({ currentSectors, history, quarters }: SectorMixProps) {
  const [view, setView] = useState<"current" | "history">("current");

  // --- Current doughnut ---
  const doughnutData = useMemo(() => {
    const entries = Object.entries(currentSectors)
      .filter(([, w]) => w >= 0.01)
      .sort((a, b) => b[1] - a[1]);
    // Aggregate sub-1% into "기타"
    const otherW = Object.entries(currentSectors)
      .filter(([, w]) => w < 0.01)
      .reduce((sum, [, w]) => sum + w, 0);
    const labels = entries.map(([s]) => sectorLabelKo(s as CanonicalSector));
    const colors = entries.map(([s]) => sectorColor(s as CanonicalSector));
    const data = entries.map(([, w]) => w);
    if (otherW > 0) {
      labels.push("기타");
      colors.push("#94a3b8");
      data.push(otherW);
    }
    return {
      labels,
      datasets: [{ data, backgroundColor: colors, borderColor: "#ffffff", borderWidth: 2 }],
    };
  }, [currentSectors]);

  const doughnutOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          callbacks: {
            label(item: { label: string; raw: unknown }) {
              return `${item.label}: ${(Number(item.raw) * 100).toFixed(1)}%`;
            },
          },
        },
        legend: {
          position: "right" as const,
          labels: {
            font: { size: 11, weight: "bold" as const },
            padding: 8,
            usePointStyle: true,
            pointStyleWidth: 8,
          },
        },
      },
    }),
    [],
  );

  // --- History stacked bar ---
  const barData = useMemo(() => {
    const sectors = Object.keys(history);
    // Show label every 4th quarter
    const xLabels = quarters.map((q, i) => (i % 4 === 0 ? q : ""));
    const datasets = sectors.map((s) => ({
      label: sectorLabelKo(s as CanonicalSector),
      data: history[s],
      backgroundColor: sectorColor(s as CanonicalSector),
    }));
    return { labels: xLabels, datasets };
  }, [history, quarters]);

  const barOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          callbacks: {
            label(item: { dataset: { label?: string }; raw: unknown }) {
              return `${item.dataset.label ?? ""}: ${(Number(item.raw) * 100).toFixed(1)}%`;
            },
          },
        },
        legend: {
          position: "right" as const,
          labels: {
            font: { size: 10, weight: "bold" as const },
            padding: 6,
            usePointStyle: true,
            pointStyleWidth: 8,
          },
        },
      },
      scales: {
        x: { stacked: true, ticks: { font: { size: 9 }, maxRotation: 60 } },
        y: { stacked: true, max: 1, ticks: { callback: (v: string | number) => `${(Number(v) * 100).toFixed(0)}%` } },
      },
    }),
    [],
  );

  return (
    <div>
      {/* Toggle */}
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setView("current")}
          className={`inline-flex min-h-8 items-center rounded-full border px-3 text-[11px] font-black uppercase tracking-[0.1em] transition ${
            view === "current"
              ? "border-brand-interactive bg-brand-interactive/5 text-brand-interactive"
              : "border-slate-200 bg-white text-slate-600 hover:border-brand-interactive hover:text-brand-interactive"
          }`}
        >
          현재 구성
        </button>
        <button
          type="button"
          onClick={() => setView("history")}
          className={`inline-flex min-h-8 items-center rounded-full border px-3 text-[11px] font-black uppercase tracking-[0.1em] transition ${
            view === "history"
              ? "border-brand-interactive bg-brand-interactive/5 text-brand-interactive"
              : "border-slate-200 bg-white text-slate-600 hover:border-brand-interactive hover:text-brand-interactive"
          }`}
        >
          분기 변화
        </button>
      </div>

      {/* Chart */}
      <div style={{ height: 380 }}>
        {view === "current" ? (
          <Doughnut data={doughnutData} options={doughnutOptions} />
        ) : (
          <Bar data={barData as ChartData<"bar">} options={barOptions} />
        )}
      </div>
    </div>
  );
}
