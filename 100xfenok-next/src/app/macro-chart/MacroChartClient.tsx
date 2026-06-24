"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import DataProvenanceNote from "@/components/DataProvenanceNote";
import { MarketChartFrame, type MarketChartRange } from "@/lib/market-valuation/charts/MarketChartFrame";
import type { MarketChartSeries } from "@/lib/market-valuation/charts/types";
import {
  MACRO_CHART_PRESETS,
  MACRO_GROUP_LABELS,
  MACRO_SERIES_CATALOG,
  MACRO_TRANSFORM_LABELS,
  seriesById,
} from "@/lib/macro-chart/catalog";
import { buildMarketSeries, loadMacroSeries, unitLabel } from "@/lib/macro-chart/loader";
import type { LoadedMacroSeries } from "@/lib/macro-chart/loader";
import type { MacroSeriesDefinition, MacroValueTransform } from "@/lib/macro-chart/types";

const DEFAULT_PRESET_ID = "risk-liquidity";
const MACRO_RANGES: readonly MarketChartRange[] = [
  { id: "1Y", label: "1Y", months: 12 },
  { id: "5Y", label: "5Y", months: 60 },
  { id: "10Y", label: "10Y", months: 120 },
  { id: "MAX", label: "전체" },
] as const;

type LoadState =
  | { status: "idle" | "loading" }
  | { status: "ready"; series: MarketChartSeries[]; loaded: LoadedMacroSeries[] }
  | { status: "error"; message: string };

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function defaultSelection() {
  return MACRO_CHART_PRESETS.find((preset) => preset.id === DEFAULT_PRESET_ID)?.series ?? [];
}

function initialSelectionFromUrl() {
  if (typeof window === "undefined") return defaultSelection();
  const params = new URLSearchParams(window.location.search);
  const preset = MACRO_CHART_PRESETS.find((item) => item.id === params.get("preset"));
  if (preset) return preset.series;
  const ids = params.get("series")?.split(",").map((id) => id.trim()).filter(Boolean) ?? [];
  if (!ids.length) return defaultSelection();
  const transforms = params.get("transform")?.split(",") ?? [];
  return ids
    .filter((id) => seriesById(id))
    .slice(0, 8)
    .map((id, index) => ({
      id,
      transform: (transforms[index] as MacroValueTransform | undefined) ?? seriesById(id)?.defaultTransform ?? "raw",
    }));
}

function selectedTransformMap(selected: readonly { id: string; transform?: MacroValueTransform }[]) {
  return new Map(selected.map((item) => [item.id, item.transform ?? seriesById(item.id)?.defaultTransform ?? "raw"]));
}

function formatValue(value: number | null) {
  if (value === null) return "—";
  const abs = Math.abs(value);
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: abs >= 100 ? 0 : abs >= 10 ? 1 : 2,
  }).format(value);
}

function sourceSummary(definitions: readonly MacroSeriesDefinition[]) {
  const files = new Set(definitions.map((item) => item.sourcePath.replace("/data/", "")));
  return `${definitions.length}개 시리즈 · ${files.size}개 데이터 파일`;
}

function downloadCsv(loaded: readonly LoadedMacroSeries[]) {
  const labels = new Set<string>();
  for (const item of loaded) {
    for (const point of item.transformedPoints) labels.add(point.date);
  }
  const dates = [...labels].sort((a, b) => a.localeCompare(b));
  const valuesBySeries = loaded.map((item) => new Map(item.transformedPoints.map((point) => [point.date, point.value])));
  const header = ["date", ...loaded.map((item) => `${item.definition.id}_${item.transform}`)];
  const rows = dates.map((date) => [
    date,
    ...valuesBySeries.map((values) => {
      const value = values.get(date);
      return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
    }),
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `100xfenok-macro-chart-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function PickerButton({
  item,
  active,
  onClick,
}: {
  item: MacroSeriesDefinition;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "flex min-h-14 w-full items-start justify-between gap-2 rounded-lg border px-3 py-2 text-left transition",
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-700 hover:border-brand-interactive",
      )}
    >
      <span className="min-w-0">
        <span className="block truncate text-xs font-black">{item.shortLabel}</span>
        <span className={cx("block truncate text-[10px] font-semibold", active ? "text-slate-200" : "text-slate-600")}>
          {MACRO_GROUP_LABELS[item.group]} · {unitLabel(item.unit)} · {item.frequency}
        </span>
      </span>
      <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black", active ? "bg-white text-slate-900" : "bg-slate-100 text-slate-700")}>
        {active ? "선택" : "추가"}
      </span>
    </button>
  );
}

export default function MacroChartClient() {
  const [selected, setSelected] = useState(() => initialSelectionFromUrl());
  const [query, setQuery] = useState("");
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });

  const selectedDefinitions = useMemo(
    () => selected.map((item) => seriesById(item.id)).filter((item): item is MacroSeriesDefinition => Boolean(item)),
    [selected],
  );
  const transformMap = useMemo(() => selectedTransformMap(selected), [selected]);

  useEffect(() => {
    if (!selectedDefinitions.length) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setLoadState({ status: "loading" });
    });
    loadMacroSeries(selectedDefinitions, transformMap)
      .then((loaded) => {
        if (cancelled) return;
        setLoadState({ status: "ready", series: buildMarketSeries(loaded), loaded });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadState({ status: "error", message: error instanceof Error ? error.message : "macro series load failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDefinitions, transformMap]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    params.set("series", selected.map((item) => item.id).join(","));
    params.set("transform", selected.map((item) => item.transform ?? seriesById(item.id)?.defaultTransform ?? "raw").join(","));
    const next = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, "", next);
  }, [selected]);

  const filteredCatalog = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return MACRO_SERIES_CATALOG;
    return MACRO_SERIES_CATALOG.filter((item) =>
      [item.id, item.label, item.shortLabel, item.description, MACRO_GROUP_LABELS[item.group]]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [query]);

  const toggleSeries = useCallback((id: string) => {
    setSelected((prev) => {
      if (prev.some((item) => item.id === id)) return prev.filter((item) => item.id !== id);
      const definition = seriesById(id);
      if (!definition) return prev;
      return [...prev, { id, transform: definition.defaultTransform ?? "raw" }].slice(-8);
    });
  }, []);

  const setTransform = useCallback((id: string, transform: MacroValueTransform) => {
    setSelected((prev) => prev.map((item) => (item.id === id ? { ...item, transform } : item)));
  }, []);

  const applyPreset = useCallback((presetId: string) => {
    const preset = MACRO_CHART_PRESETS.find((item) => item.id === presetId);
    if (preset) setSelected([...preset.series]);
  }, []);

  const activeLoadState: LoadState = selectedDefinitions.length
    ? loadState
    : { status: "ready", series: [], loaded: [] };
  const ready = activeLoadState.status === "ready";

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">Macro Chart</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 md:text-3xl">매크로 차트</h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
              지수, 유동성, 금리, 신용, 심리, 경기지표를 같은 시간축으로 맞춰 비교합니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {MACRO_CHART_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.id)}
                className="min-h-9 rounded-md border border-slate-200 bg-slate-50 px-3 text-xs font-black text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive"
                title={preset.description}
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => ready && downloadCsv(activeLoadState.loaded)}
              disabled={!ready || activeLoadState.loaded.length === 0}
              className="min-h-9 rounded-md bg-slate-900 px-3 text-xs font-black text-white transition hover:bg-brand-interactive disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-700"
            >
              CSV 저장
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          {activeLoadState.status === "error" ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">
              차트 데이터를 불러오지 못했습니다. {activeLoadState.message}
            </div>
          ) : activeLoadState.status === "loading" ? (
            <div className="flex h-96 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm font-black text-slate-500">
              차트 준비 중
            </div>
          ) : activeLoadState.status === "ready" && activeLoadState.series.length ? (
            <MarketChartFrame
              ariaLabel="매크로 시계열 비교 차트"
              series={activeLoadState.series}
              ranges={MACRO_RANGES}
              defaultRangeId="5Y"
              sortLabels
              heightClassName="h-[30rem]"
              yAxisTitle="기준값 / 지수"
              y1AxisTitle="% / spread"
              formatValue={formatValue}
              footnote={sourceSummary(selectedDefinitions)}
            />
          ) : (
            <div className="flex h-96 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm font-black text-slate-500">
              비교할 시리즈를 선택하세요.
            </div>
          )}
          <DataProvenanceNote
            className="mt-3"
            title="데이터 연결"
            details={[
              selectedDefinitions.length ? sourceSummary(selectedDefinitions) : null,
              "URL로 선택값 공유 가능",
            ]}
          >
            public data spine의 정적 JSON만 읽고, 브라우저에서 선택한 시리즈를 정렬·변환합니다.
          </DataProvenanceNote>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <label className="block text-[11px] font-black uppercase tracking-[0.12em] text-slate-500" htmlFor="macro-series-search">
              시리즈 검색
            </label>
            <input
              id="macro-series-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="M2, VIX, PMI..."
              className="mt-2 min-h-10 w-full rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-brand-interactive"
            />
            <div className="mt-3 max-h-[32rem] space-y-2 overflow-y-auto pr-1">
              {filteredCatalog.map((item) => (
                <PickerButton
                  key={item.id}
                  item={item}
                  active={selected.some((selectedItem) => selectedItem.id === item.id)}
                  onClick={() => toggleSeries(item.id)}
                />
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-black text-slate-900">선택 시리즈</h2>
              <button
                type="button"
                onClick={() => setSelected([])}
                className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-black text-slate-500 hover:border-brand-interactive hover:text-brand-interactive"
              >
                비우기
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {selected.length === 0 ? (
                <p className="rounded-lg bg-slate-50 p-3 text-xs font-semibold text-slate-500">시리즈가 없습니다.</p>
              ) : (
                selected.map((item) => {
                  const definition = seriesById(item.id);
                  if (!definition) return null;
                  const current = item.transform ?? definition.defaultTransform ?? "raw";
                  return (
                    <div key={item.id} className="rounded-lg border border-slate-200 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-xs font-black text-slate-800">{definition.shortLabel}</span>
                        <button
                          type="button"
                          onClick={() => toggleSeries(item.id)}
                          className="rounded-md px-2 py-1 text-[11px] font-black text-slate-500 hover:bg-slate-100"
                        >
                          제거
                        </button>
                      </div>
                      <select
                        value={current}
                        onChange={(event) => setTransform(item.id, event.target.value as MacroValueTransform)}
                        className="mt-2 min-h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-black text-slate-700"
                        aria-label={`${definition.shortLabel} 변환`}
                      >
                        {Object.entries(MACRO_TRANSFORM_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
