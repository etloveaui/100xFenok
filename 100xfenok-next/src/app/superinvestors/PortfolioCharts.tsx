"use client";

import { useMemo, useState } from "react";
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, LineElement, PointElement, ScatterController } from "chart.js";
import { TreemapController, TreemapElement } from "chartjs-chart-treemap";
import type { ChartData, ChartOptions } from "chart.js";
import { Doughnut, Bar, Line, Chart, Scatter } from "react-chartjs-2";
import { sectorColor, sectorLabelKo } from "@/lib/design/sectorMap";
import type { CanonicalSector } from "@/lib/design/sectorMap";
import type { PerformanceSeries, PortfolioRow, PortfolioViewsData } from "@/lib/superinvestors/types";
import { useMarketChartTheme } from "@/lib/market-valuation/charts/chartTheme";

type MaybeNumber = number | null | undefined;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

ChartJS.register(
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ScatterController,
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

function retStr(ret: MaybeNumber): string {
  if (!isFiniteNumber(ret)) return "—";
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

type TreemapLeaf = { raw?: { _data?: PortfolioRow } };

function leafRow(ctx: TreemapLeaf): PortfolioRow | null {
  return ctx.raw?._data ?? null;
}

export function PortfolioTreemap({ rows, quarterLabel }: TreemapProps) {
  const chartTheme = useMarketChartTheme();
  const data = useMemo(() => {
    const displayRows = rows.filter((r) => isFiniteNumber(r.weight) && r.weight > 0);
    return {
      datasets: [
        {
          label: "포트폴리오",
          // chartjs-chart-treemap contract: `tree` (flat objects) + `key`;
          // generated leaf points expose the source object at `raw._data`.
          tree: displayRows as unknown as number[],
          key: "weight",
          data: [],
          borderColor: chartTheme.token("panel"),
          borderWidth: 1,
          spacing: 1,
          backgroundColor: (ctx: TreemapLeaf) => {
            const d = leafRow(ctx);
            return d ? chartTheme.returnColor(d.ret) : chartTheme.token("surface");
          },
          // `labels` must be the plugin's object config (NOT an array).
          labels: {
            display: true,
            color: (ctx: TreemapLeaf) => {
              const d = leafRow(ctx);
              return chartTheme.returnTextColor(d?.ret);
            },
            font: { size: 11, weight: "bold" as const },
            formatter: (ctx: TreemapLeaf) => {
              const d = leafRow(ctx);
              if (!d) return "";
              const name = d.ticker === "_OTHERS" ? "기타" : d.ticker;
              if (d.ticker === "_OTHERS") return name;
              if (d.weight >= 0.04) return [name, retStr(d.ret)];
              if (d.weight >= 0.015) return name;
              return "";
            },
          },
        },
      ],
    };
  }, [rows, chartTheme]);

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          callbacks: {
            title(items: TreemapLeaf[]) {
              const d = items[0] ? leafRow(items[0]) : null;
              if (!d) return "";
              return `${d.name} (${d.ticker})`;
            },
            label(item: TreemapLeaf) {
              const d = leafRow(item);
              if (!d) return "";
              return [
                `비중: ${isFiniteNumber(d.weight) ? (d.weight * 100).toFixed(2) : "—"}%`,
                `분기말 이후 수익률: ${retStr(d.ret)}`,
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
      <div className="relative h-[300px] sm:h-[420px]">
        <Chart
          type="treemap"
          data={data as unknown as ChartData<"treemap">}
          options={options as unknown as ChartOptions<"treemap">}
          role="img"
          aria-label={`${quarterLabel} 포트폴리오 보유 비중과 수익률 트리맵`}
        />
      </div>
      {/* Legend strip */}
      <div className="mt-2">
        <div className="flex items-center justify-center gap-2 text-[10px] font-bold text-slate-500">
          <span>손실</span>
          <span
            className="inline-block h-3 w-32 rounded"
            style={{
              background: chartTheme.returnGradient,
            }}
          />
          <span>수익</span>
        </div>
        <p className="mt-1 text-center text-[10px] font-semibold text-[var(--c-ink-3)]">
          수익률 = 분기말 종가 → 현재 (배당 조정) · {quarterLabel} 기준
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PerformanceChart — guru portfolio index vs SPY (base 100)
// ---------------------------------------------------------------------------

interface PerformanceChartProps {
  performance: PerformanceSeries;
  investorName: string;
}

export function PerformanceChart({ performance, investorName }: PerformanceChartProps) {
  const chartTheme = useMarketChartTheme();
  const dates = useMemo(
    () => (Array.isArray(performance.dates) ? performance.dates : []),
    [performance.dates],
  );
  const portfolio = useMemo(
    () => (Array.isArray(performance.portfolio) ? performance.portfolio.filter(isFiniteNumber) : []),
    [performance.portfolio],
  );
  const spy = useMemo(
    () => (Array.isArray(performance.spy) ? performance.spy.filter(isFiniteNumber) : null),
    [performance.spy],
  );

  const data = useMemo(() => {
    const labels = dates.slice(-portfolio.length).map((d) => d.slice(0, 7));
    const datasets = [
      {
        label: investorName,
        data: portfolio,
        borderColor: chartTheme.token("brand"),
        backgroundColor: chartTheme.alpha("brand", 0.08),
        borderWidth: 2,
        pointRadius: 0,
        pointHitRadius: 8,
        tension: 0.25,
        fill: true,
      },
    ];
    if (spy && spy.length > 0) {
      datasets.push({
        label: "SPY",
        data: spy as number[],
        borderColor: chartTheme.token("neutral"),
        backgroundColor: "transparent",
        borderWidth: 1.5,
        pointRadius: 0,
        pointHitRadius: 8,
        tension: 0.25,
        fill: false,
      } as (typeof datasets)[number]);
    }
    return { labels, datasets };
  }, [dates, portfolio, spy, investorName, chartTheme]);

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index" as const, intersect: false },
      plugins: {
        tooltip: {
          callbacks: {
            label(item: { dataset: { label?: string }; raw: unknown }) {
              const v = Number(item.raw);
              const ret = v - 100;
              return `${item.dataset.label ?? ""}: ${v.toFixed(1)} (${ret >= 0 ? "+" : ""}${ret.toFixed(1)}%)`;
            },
          },
        },
        legend: {
          position: "top" as const,
          align: "end" as const,
          labels: { color: chartTheme.token("ink2"), font: { size: 11, weight: "bold" as const }, usePointStyle: true, pointStyleWidth: 8, boxHeight: 6 },
        },
      },
      scales: {
        x: { ticks: { color: chartTheme.token("ink3"), font: { size: 9 }, maxTicksLimit: 8 } },
        y: { ticks: { color: chartTheme.token("ink3"), font: { size: 10 } } },
      },
    }),
    [chartTheme],
  );

  if (portfolio.length === 0) {
    return (
      <div className="grid h-[220px] place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-xs font-bold text-[var(--c-ink-3)]">
        성과 차트 데이터가 없습니다
      </div>
    );
  }

  const last = portfolio.at(-1) ?? 100;
  const spyLast = spy?.at(-1) ?? null;
  const alpha = spyLast != null ? last - spyLast : null;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">성과 vs SPY</p>
        {alpha != null ? (
          <p className={`text-[11px] font-bold ${alpha >= 0 ? "text-[var(--c-up)]" : "text-[var(--c-down)]"}`}>
            {alpha >= 0 ? "SPY 대비 앞섬" : "SPY 대비 뒤처짐"} {Math.abs(alpha).toFixed(1)}p
          </p>
        ) : null}
      </div>
      <div className="mt-2 h-[220px] sm:h-[260px]">
        <Line
          data={data as ChartData<"line">}
          options={options}
          role="img"
          aria-label={`${investorName} 포트폴리오 성과와 SPY 비교 차트`}
        />
      </div>
      <p className="mt-1 text-center text-[10px] font-semibold text-[var(--c-ink-3)]">
        분기 공시 롱 포지션을 분기말 매수·리밸런싱 없이 보유로 가정한 추정 (지수 100 = 첫 분기말, 배당 조정)
      </p>
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
  const chartTheme = useMarketChartTheme();

  // --- Current doughnut ---
  const doughnutData = useMemo(() => {
    const entries = Object.entries(currentSectors)
      .filter(([, w]) => isFiniteNumber(w) && w >= 0.01)
      .sort((a, b) => b[1] - a[1]);
    // Aggregate sub-1% into "기타"
    const otherW = Object.entries(currentSectors)
      .filter(([, w]) => isFiniteNumber(w) && w < 0.01)
      .reduce((sum, [, w]) => sum + w, 0);
    const labels = entries.map(([s]) => sectorLabelKo(s as CanonicalSector));
    const colors = entries.map(([s]) => sectorColor(s as CanonicalSector));
    const data = entries.map(([, w]) => w);
    if (otherW > 0) {
      labels.push("기타");
      colors.push(chartTheme.token("neutral"));
      data.push(otherW);
    }
    return {
      labels,
      datasets: [{ data, backgroundColor: colors, borderColor: chartTheme.token("panel"), borderWidth: 2 }],
    };
  }, [currentSectors, chartTheme]);

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
      data: Array.isArray(history[s]) ? history[s].map((v) => (isFiniteNumber(v) ? v : null)) : [],
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
              if (!isFiniteNumber(item.raw)) return `${item.dataset.label ?? ""}: 데이터 없음`;
              return `${item.dataset.label ?? ""}: ${(item.raw * 100).toFixed(1)}%`;
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
          aria-pressed={view === "current"}
          className={`inline-flex min-h-11 items-center rounded-full border px-3 text-[11px] font-black uppercase tracking-[0.1em] transition sm:min-h-8 ${
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
          aria-pressed={view === "history"}
          className={`inline-flex min-h-11 items-center rounded-full border px-3 text-[11px] font-black uppercase tracking-[0.1em] transition sm:min-h-8 ${
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
          <Doughnut
            data={doughnutData}
            options={doughnutOptions}
            role="img"
            aria-label="현재 섹터 구성 도넛 차트"
          />
        ) : (
          <Bar
            data={barData as ChartData<"bar">}
            options={barOptions}
            role="img"
            aria-label="분기별 섹터 구성 변화 막대 차트"
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RiskReturnScatter — cross-guru annualized return vs volatility
// ---------------------------------------------------------------------------

interface ScatterPoint {
  x: number;
  y: number;
  investor: string;
}

function computeAnnualizedRiskReturn(performance: PerformanceSeries): { annReturn: number; annVol: number } | null {
  const dates = performance.dates;
  const values = performance.portfolio;
  if (!Array.isArray(dates) || !Array.isArray(values) || dates.length !== values.length || values.length < 3) {
    return null;
  }
  const firstValue = values[0];
  const lastValue = values[values.length - 1];
  if (!isFiniteNumber(firstValue) || firstValue <= 0 || !isFiniteNumber(lastValue) || lastValue <= 0) {
    return null;
  }
  const firstDate = new Date(dates[0]).getTime();
  const lastDate = new Date(dates[dates.length - 1]).getTime();
  if (Number.isNaN(firstDate) || Number.isNaN(lastDate) || lastDate <= firstDate) {
    return null;
  }
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
  const years = (lastDate - firstDate) / msPerYear;
  if (years <= 0) return null;

  const annReturn = Math.pow(lastValue / firstValue, 1 / years) - 1;

  const periodReturns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const cur = values[i];
    if (isFiniteNumber(prev) && prev > 0 && isFiniteNumber(cur) && cur > 0) {
      periodReturns.push(cur / prev - 1);
    }
  }
  if (periodReturns.length < 2) return null;
  const mean = periodReturns.reduce((a, b) => a + b, 0) / periodReturns.length;
  const variance = periodReturns.reduce((sum, r) => sum + (r - mean) * (r - mean), 0) / (periodReturns.length - 1);
  const annVol = Math.sqrt(variance) * Math.sqrt(periodReturns.length / years);

  if (!Number.isFinite(annReturn) || !Number.isFinite(annVol)) return null;
  return { annReturn, annVol };
}

interface RiskReturnScatterProps {
  data: PortfolioViewsData;
}

export function RiskReturnScatter({ data }: RiskReturnScatterProps) {
  const chartTheme = useMarketChartTheme();

  const { investorPoints, spyPoint } = useMemo(() => {
    const points: ScatterPoint[] = [];
    for (const [id, view] of Object.entries(data.investors)) {
      if (!view.performance) continue;
      const calc = computeAnnualizedRiskReturn(view.performance);
      if (!calc) continue;
      points.push({
        x: calc.annVol,
        y: calc.annReturn,
        investor: view.name || id,
      });
    }
    points.sort((a, b) => b.y - a.y);

    let spy: ScatterPoint | null = null;
    for (const view of Object.values(data.investors)) {
      const perf = view.performance;
      const spySeries = perf?.spy;
      if (!perf || !spySeries || !Array.isArray(spySeries) || spySeries.length === 0) continue;
      const calc = computeAnnualizedRiskReturn({
        dates: perf.dates,
        portfolio: spySeries,
        spy: null,
        coverage: [],
      });
      if (calc) {
        spy = { x: calc.annVol, y: calc.annReturn, investor: "SPY" };
        break;
      }
    }
    return { investorPoints: points, spyPoint: spy };
  }, [data]);

  const chartData = useMemo<ChartData<"scatter">>(() => {
    const datasets: ChartData<"scatter">["datasets"] = [
      {
        label: "투자자",
        data: investorPoints as unknown as ChartData<"scatter">["datasets"][0]["data"],
        backgroundColor: chartTheme.token("brand"),
        pointRadius: 5,
        pointHoverRadius: 7,
      },
    ];
    if (spyPoint) {
      datasets.push({
        label: "SPY",
        data: [spyPoint] as unknown as ChartData<"scatter">["datasets"][0]["data"],
        backgroundColor: chartTheme.token("neutral"),
        pointRadius: 7,
        pointHoverRadius: 9,
        pointStyle: "rectRot" as const,
      });
    }
    return { datasets };
  }, [investorPoints, spyPoint, chartTheme]);

  const options = useMemo<ChartOptions<"scatter">>(() => {
    const pctAxis = {
      callback: (value: string | number) => `${(Number(value) * 100).toFixed(0)}%`,
      color: chartTheme.token("ink3"),
      font: { size: 10 },
    };
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "point", intersect: false },
      plugins: {
        legend: {
          position: "top",
          align: "end",
          labels: {
            color: chartTheme.token("ink2"),
            font: { size: 11, weight: "bold" as const },
            usePointStyle: true,
            pointStyleWidth: 8,
            boxHeight: 6,
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const p = ctx.raw as ScatterPoint;
              const ret = p.y * 100;
              const vol = p.x * 100;
              return `${p.investor}: 연수익률 ${ret >= 0 ? "+" : ""}${ret.toFixed(1)}%, 연변동성 ${vol.toFixed(1)}%`;
            },
          },
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "연변동성 (annualized volatility)",
            color: chartTheme.token("ink3"),
            font: { size: 11, weight: "bold" as const },
          },
          ticks: pctAxis,
        },
        y: {
          title: {
            display: true,
            text: "연수익률 (annualized return)",
            color: chartTheme.token("ink3"),
            font: { size: 11, weight: "bold" as const },
          },
          ticks: pctAxis,
        },
      },
    };
  }, [chartTheme]);

  if (investorPoints.length === 0) {
    return (
      <div className="grid h-[220px] place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-xs font-bold text-[var(--c-ink-3)]">
        리스크-수익 데이터가 없습니다
      </div>
    );
  }

  return (
    <div>
      <div className="relative h-[300px] sm:h-[420px]">
        <Scatter
          data={chartData}
          options={options}
          role="img"
          aria-label="투자자별 연수익률 대비 연변동성 산점도"
        />
      </div>
      <p className="mt-2 text-center text-[10px] font-semibold text-[var(--c-ink-3)]">
        좌상단(고수익·저변동성)에 가까울수록 리스크 조정 수익 우수 · 13F 롱 포트폴리오 기준
      </p>
    </div>
  );
}
