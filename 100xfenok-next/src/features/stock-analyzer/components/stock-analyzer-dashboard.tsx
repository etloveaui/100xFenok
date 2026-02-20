"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";

import type {
  StockAnalyzerRecord,
  StockAnalyzerTab,
} from "@/lib/stock-analyzer/types";
import { useStockAnalyzerStore } from "@/features/stock-analyzer/store/use-stock-analyzer-store";

const StockAnalyzerCharts = dynamic(
  () =>
    import("@/features/stock-analyzer/components/stock-analyzer-charts").then(
      (module) => module.StockAnalyzerCharts,
    ),
  {
    ssr: false,
    loading: () => (
      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-sm">
        차트 모듈을 로드하는 중입니다...
      </section>
    ),
  },
);

const tabs: { id: StockAnalyzerTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "growth", label: "Growth" },
  { id: "ranking", label: "Ranking" },
  { id: "eps", label: "EPS" },
  { id: "portfolio", label: "Portfolio" },
  { id: "compare", label: "Compare" },
];

function formatNumber(value: number | undefined, maximumFractionDigits = 1): string {
  if (value === undefined || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(value);
}

function formatPercent(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "-";
  return `${(value * 100).toFixed(2)}%`;
}

function findSelectedRecord(
  records: readonly StockAnalyzerRecord[],
  symbol: string | undefined,
): StockAnalyzerRecord | undefined {
  if (!symbol) return undefined;
  return records.find((record) => record.symbol === symbol);
}

export function StockAnalyzerDashboard() {
  const dashboard = useStockAnalyzerStore((state) => state.dashboard);
  const initialize = useStockAnalyzerStore((state) => state.initialize);
  const refresh = useStockAnalyzerStore((state) => state.refresh);
  const setTab = useStockAnalyzerStore((state) => state.setTab);
  const updateFilters = useStockAnalyzerStore((state) => state.updateFilters);
  const resetFilters = useStockAnalyzerStore((state) => state.resetFilters);
  const selectSymbol = useStockAnalyzerStore((state) => state.selectSymbol);
  const [heavyPanelsReady, setHeavyPanelsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let idleId: number | null = null;

    const boot = () => {
      if (!cancelled) {
        void initialize();
      }
    };

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(() => boot(), { timeout: 1200 });
    } else {
      timeoutId = setTimeout(() => boot(), 180);
    }

    return () => {
      cancelled = true;
      if (idleId !== null && typeof window !== "undefined" && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };
  }, [initialize]);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let idleId: number | null = null;

    const activate = () => setHeavyPanelsReady(true);

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(() => activate(), { timeout: 1800 });
    } else {
      timeoutId = setTimeout(() => activate(), 900);
    }

    return () => {
      if (idleId !== null && typeof window !== "undefined" && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };
  }, []);

  const sectors = useMemo(() => {
    return [...new Set(dashboard.records.map((record) => record.sector).filter(Boolean))]
      .map((sector) => String(sector))
      .sort((a, b) => a.localeCompare(b));
  }, [dashboard.records]);

  const selectedRecord = useMemo(() => {
    return findSelectedRecord(dashboard.filteredRecords, dashboard.selectedSymbol);
  }, [dashboard.filteredRecords, dashboard.selectedSymbol]);

  const averageGrowth = useMemo(() => {
    const values = dashboard.filteredRecords
      .map((record) => record.growthRate)
      .filter((value): value is number => typeof value === "number");

    if (values.length === 0) return undefined;

    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }, [dashboard.filteredRecords]);

  const averagePer = useMemo(() => {
    const values = dashboard.filteredRecords
      .map((record) => record.per)
      .filter((value): value is number => typeof value === "number");

    if (values.length === 0) return undefined;

    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }, [dashboard.filteredRecords]);

  const shouldRenderHeavyPanels =
    heavyPanelsReady || dashboard.activeTab !== "overview";
  const visibleRows = shouldRenderHeavyPanels
    ? dashboard.filteredRecords.slice(0, 50)
    : dashboard.filteredRecords.slice(0, 12);

  return (
    <main className="container mx-auto overflow-x-hidden px-4 py-4" data-stock-analyzer-native="true">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
              STOCK ANALYZER NATIVE
            </p>
            <h1 className="mt-1 text-xl font-black text-slate-800 sm:text-2xl">
              Week3 Phase 6-2 Pilot Dashboard
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              기존 도구와 병행 운영. 데이터 공급/필터/차트/대시보드 모듈을 네이티브로 분리했습니다.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
            >
              Refresh
            </button>
            <Link
              href="/tools/stock-analyzer"
              className="min-h-11 rounded-lg border border-blue-200 bg-blue-50 px-3 text-sm font-bold text-blue-700 transition hover:bg-blue-100"
            >
              Legacy View
            </Link>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTab(tab.id)}
              className={`min-h-11 rounded-full px-4 text-sm font-bold transition ${
                dashboard.activeTab === tab.id
                  ? "bg-brand-navy text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="xl:col-span-2">
            <span className="mb-1 block text-xs font-semibold text-slate-500">검색</span>
            <input
              type="search"
              value={dashboard.filters.query}
              onChange={(event) => updateFilters({ query: event.target.value })}
              placeholder="티커/회사명/섹터"
              className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-700 outline-none transition focus:border-brand-interactive"
            />
          </label>

          <label>
            <span className="mb-1 block text-xs font-semibold text-slate-500">섹터</span>
            <select
              value={dashboard.filters.sectors[0] ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                updateFilters({ sectors: value ? [value] : [] });
              }}
              className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-700"
            >
              <option value="">전체</option>
              {sectors.map((sector) => (
                <option key={sector} value={sector}>
                  {sector}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="mb-1 block text-xs font-semibold text-slate-500">정렬 기준</span>
            <select
              value={dashboard.filters.sortKey}
              onChange={(event) => updateFilters({ sortKey: event.target.value })}
              className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-700"
            >
              <option value="marketCap">Market Cap</option>
              <option value="growthRate">Growth</option>
              <option value="per">PER</option>
              <option value="rank">Rank</option>
              <option value="symbol">Ticker</option>
            </select>
          </label>

          <label>
            <span className="mb-1 block text-xs font-semibold text-slate-500">정렬 순서</span>
            <select
              value={dashboard.filters.sortOrder}
              onChange={(event) =>
                updateFilters({ sortOrder: event.target.value as "asc" | "desc" })
              }
              className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-700"
            >
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={resetFilters}
            className="min-h-10 rounded-lg bg-slate-100 px-3 text-xs font-bold text-slate-700 transition hover:bg-slate-200"
          >
            필터 초기화
          </button>
          <span className="text-xs text-slate-500">
            Last updated: {dashboard.lastUpdatedAt ? new Date(dashboard.lastUpdatedAt).toLocaleString() : "-"}
          </span>
        </div>
      </section>

      {dashboard.errorMessage && (
        <section className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {dashboard.errorMessage}
        </section>
      )}

      <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Universe</p>
          <p className="mt-1 text-2xl font-black text-slate-800">{formatNumber(dashboard.records.length, 0)}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Filtered</p>
          <p className="mt-1 text-2xl font-black text-slate-800">{formatNumber(dashboard.filteredRecords.length, 0)}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Avg 3M Growth</p>
          <p className="mt-1 text-2xl font-black text-emerald-600">{formatPercent(averageGrowth)}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Avg PER</p>
          <p className="mt-1 text-2xl font-black text-blue-700">{formatNumber(averagePer, 2)}</p>
        </article>
      </section>

      {shouldRenderHeavyPanels ? (
        <StockAnalyzerCharts charts={dashboard.charts} />
      ) : (
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-black text-slate-700">Quick Snapshot</h2>
          <p className="mt-1 text-xs text-slate-500">
            초기 렌더 성능을 위해 차트는 유휴 시간에 순차 로드됩니다.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            {dashboard.filteredRecords.slice(0, 6).map((record) => (
              <div key={record.symbol} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-sm font-bold text-slate-800">{record.symbol}</p>
                <p className="text-xs text-slate-600">{record.companyName}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-black text-slate-700">Filtered Universe</h2>
            <span className="text-xs text-slate-500">
              {shouldRenderHeavyPanels ? "Top 50 rows" : "Top 12 rows (quick mode)"}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-2">Ticker</th>
                  <th className="py-2 pr-2">Company</th>
                  <th className="py-2 pr-2">Sector</th>
                  <th className="py-2 pr-2">Market Cap</th>
                  <th className="py-2 pr-2">Growth</th>
                  <th className="py-2 pr-2">PER</th>
                  <th className="py-2 pr-2">Rank</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((record) => (
                  <tr
                    key={record.symbol}
                    onClick={() => selectSymbol(record.symbol)}
                    className={`cursor-pointer border-b border-slate-100 transition hover:bg-blue-50/50 ${
                      dashboard.selectedSymbol === record.symbol ? "bg-blue-50" : ""
                    }`}
                  >
                    <td className="py-2 pr-2 font-bold text-slate-800">{record.symbol}</td>
                    <td className="py-2 pr-2 text-slate-700">{record.companyName}</td>
                    <td className="py-2 pr-2 text-slate-600">{record.sector ?? "-"}</td>
                    <td className="py-2 pr-2 text-slate-600">{formatNumber(record.marketCap, 0)}</td>
                    <td className="py-2 pr-2 text-slate-600">{formatPercent(record.growthRate)}</td>
                    <td className="py-2 pr-2 text-slate-600">{formatNumber(record.per, 2)}</td>
                    <td className="py-2 pr-2 text-slate-600">{formatNumber(record.rank, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-black text-slate-700">Selected Snapshot</h2>

          {selectedRecord ? (
            <div className="mt-3 space-y-2 text-sm">
              <p className="text-xl font-black text-slate-800">{selectedRecord.symbol}</p>
              <p className="text-slate-600">{selectedRecord.companyName}</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-slate-50 p-2">
                  <p className="text-slate-400">Sector</p>
                  <p className="font-bold text-slate-700">{selectedRecord.sector ?? "-"}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <p className="text-slate-400">Market Cap</p>
                  <p className="font-bold text-slate-700">{formatNumber(selectedRecord.marketCap, 0)}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <p className="text-slate-400">3M Growth</p>
                  <p className="font-bold text-emerald-600">{formatPercent(selectedRecord.growthRate)}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <p className="text-slate-400">PER</p>
                  <p className="font-bold text-blue-700">{formatNumber(selectedRecord.per, 2)}</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">
              테이블 행을 선택하면 스냅샷이 표시됩니다.
            </p>
          )}
        </article>
      </section>

      {dashboard.isLoading && (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-500">
          데이터를 불러오는 중입니다...
        </section>
      )}
    </main>
  );
}
