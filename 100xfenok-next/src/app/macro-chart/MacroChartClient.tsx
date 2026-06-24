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
const DEFAULT_RANGE_ID = "5Y";
const MAX_SELECTED_SERIES = 8;
const USER_PRESET_STORAGE_KEY = "100xfenok.macroChart.userPresets.v1";
const MACRO_RANGES: readonly MarketChartRange[] = [
  { id: "1Y", label: "1Y", months: 12 },
  { id: "5Y", label: "5Y", months: 60 },
  { id: "10Y", label: "10Y", months: 120 },
  { id: "MAX", label: "전체" },
] as const;
const MACRO_RANGE_IDS = new Set(MACRO_RANGES.map((range) => range.id));
const MACRO_TRANSFORM_IDS = new Set<MacroValueTransform>(["raw", "rebase100", "yoy", "change"]);
const MACRO_AXIS_IDS = new Set(["auto", "left", "right"]);

type LoadState =
  | { status: "idle" | "loading" }
  | { status: "ready"; series: MarketChartSeries[]; loaded: LoadedMacroSeries[] }
  | { status: "error"; message: string };

type SelectedMacroSeries = { id: string; transform?: MacroValueTransform };
type MacroAxisId = "auto" | "left" | "right";

type InitialChartState = {
  selected: SelectedMacroSeries[];
  rangeId: string;
  hiddenIds: string[];
  axisById: Record<string, MacroAxisId>;
};

type UserMacroPreset = {
  id: string;
  name: string;
  selected: SelectedMacroSeries[];
  rangeId: string;
  hiddenIds: string[];
  axisById: Record<string, MacroAxisId>;
  updatedAt: string;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function cloneSelection(selection: readonly SelectedMacroSeries[]) {
  return selection.map((item) => ({ id: item.id, transform: item.transform }));
}

function defaultSelection(): SelectedMacroSeries[] {
  return cloneSelection(MACRO_CHART_PRESETS.find((preset) => preset.id === DEFAULT_PRESET_ID)?.series ?? []);
}

function coerceTransform(value: string | undefined, fallback: MacroValueTransform): MacroValueTransform {
  return value && MACRO_TRANSFORM_IDS.has(value as MacroValueTransform)
    ? (value as MacroValueTransform)
    : fallback;
}

function parseHiddenIds(raw: string | null, selected: readonly SelectedMacroSeries[]) {
  if (!raw) return [];
  const selectedIds = new Set(selected.map((item) => item.id));
  const seen = new Set<string>();
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => {
      if (!selectedIds.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

function parseAxisById(raw: string | null, selected: readonly SelectedMacroSeries[]) {
  if (!raw) return {};
  if (raw.includes(":")) {
    const selectedIds = new Set(selected.map((item) => item.id));
    return Object.fromEntries(
      raw
        .split(",")
        .map((token) => token.split(":").map((part) => part.trim()))
        .filter(
          (entry): entry is [string, MacroAxisId] =>
            entry.length === 2 &&
            selectedIds.has(entry[0]) &&
            MACRO_AXIS_IDS.has(entry[1]) &&
            entry[1] !== "auto",
        ),
    );
  }
  const axes = raw.split(",");
  return Object.fromEntries(
    selected
      .map((item, index) => [item.id, axes[index]] as const)
      .filter((entry): entry is readonly [string, MacroAxisId] => MACRO_AXIS_IDS.has(entry[1] ?? "") && entry[1] !== "auto"),
  );
}

function safeReadUserPresets(): UserMacroPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(USER_PRESET_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): UserMacroPreset | null => {
        if (!item || typeof item !== "object") return null;
        const record = item as Partial<UserMacroPreset>;
        const selected = Array.isArray(record.selected)
          ? record.selected
              .filter((entry): entry is SelectedMacroSeries =>
                Boolean(entry && typeof entry.id === "string" && seriesById(entry.id)),
              )
              .slice(0, MAX_SELECTED_SERIES)
          : [];
        if (!selected.length || typeof record.name !== "string") return null;
        return {
          id: typeof record.id === "string" ? record.id : `preset-${Date.now()}`,
          name: record.name.slice(0, 32),
          selected: cloneSelection(selected),
          rangeId: MACRO_RANGE_IDS.has(record.rangeId ?? "") ? record.rangeId! : DEFAULT_RANGE_ID,
          hiddenIds: Array.isArray(record.hiddenIds)
            ? parseHiddenIds(record.hiddenIds.filter((value): value is string => typeof value === "string").join(","), selected)
            : [],
          axisById: parseAxisById(selected.map((entry) => record.axisById?.[entry.id] ?? "auto").join(","), selected),
          updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString(),
        };
      })
      .filter((item): item is UserMacroPreset => item !== null)
      .slice(0, 8);
  } catch {
    return [];
  }
}

function writeUserPresets(presets: readonly UserMacroPreset[]) {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(USER_PRESET_STORAGE_KEY, JSON.stringify(presets.slice(0, 8)));
    return true;
  } catch {
    return false;
  }
}

function initialChartStateFromUrl(): InitialChartState {
  const fallback = {
    selected: defaultSelection(),
    rangeId: DEFAULT_RANGE_ID,
    hiddenIds: [],
    axisById: {},
  };
  if (typeof window === "undefined") return fallback;
  const params = new URLSearchParams(window.location.search);
  const preset = MACRO_CHART_PRESETS.find((item) => item.id === params.get("preset"));
  const rangeParam = params.get("range") ?? "";
  const rangeId = MACRO_RANGE_IDS.has(rangeParam) ? rangeParam : DEFAULT_RANGE_ID;
  if (preset) {
    const selected = cloneSelection(preset.series);
    return {
      selected,
      rangeId,
      hiddenIds: parseHiddenIds(params.get("hidden"), selected),
      axisById: parseAxisById(params.get("axis"), selected),
    };
  }
  const ids = params.get("series")?.split(",").map((id) => id.trim()).filter(Boolean) ?? [];
  if (!ids.length) return { ...fallback, rangeId };
  const transforms = params.get("transform")?.split(",") ?? [];
  const selected = ids
    .filter((id) => seriesById(id))
    .slice(0, MAX_SELECTED_SERIES)
    .map((id, index) => ({
      id,
      transform: coerceTransform(
        transforms[index],
        seriesById(id)?.defaultTransform ?? "raw",
      ),
    }));
  return {
    selected: selected.length ? selected : fallback.selected,
    rangeId,
    hiddenIds: parseHiddenIds(params.get("hidden"), selected),
    axisById: parseAxisById(params.get("axis"), selected),
  };
}

function selectedTransformMap(selected: readonly SelectedMacroSeries[]) {
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

function applyAxisOverrides(series: readonly MarketChartSeries[], axisById: Record<string, MacroAxisId>) {
  return series.map((item) => {
    const axis = axisById[item.id] ?? "auto";
    if (axis === "left") return { ...item, yAxisId: "y" as const };
    if (axis === "right") return { ...item, yAxisId: "y1" as const };
    return item;
  });
}

function axisParam(selected: readonly SelectedMacroSeries[], axisById: Record<string, MacroAxisId>) {
  return selected
    .map((item) => {
      const axis = axisById[item.id] ?? "auto";
      return axis === "auto" ? null : `${item.id}:${axis}`;
    })
    .filter((item): item is string => Boolean(item))
    .join(",");
}

function explicitRightAxisTitle(definitions: readonly MacroSeriesDefinition[], axisById: Record<string, MacroAxisId>) {
  const units = [
    ...new Set(
      definitions
        .filter((definition) => axisById[definition.id] === "right")
        .map((definition) => unitLabel(definition.unit)),
    ),
  ];
  if (units.length === 0) return "% / spread";
  if (units.length === 1) return units[0];
  return "보조축";
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
  const [{
    selected: initialSelected,
    rangeId: initialRangeId,
    hiddenIds: initialHiddenIds,
    axisById: initialAxisById,
  }] = useState(() => initialChartStateFromUrl());
  const [selected, setSelected] = useState<SelectedMacroSeries[]>(initialSelected);
  const [rangeId, setRangeId] = useState(initialRangeId);
  const [hiddenIds, setHiddenIds] = useState<string[]>(initialHiddenIds);
  const [axisById, setAxisById] = useState<Record<string, MacroAxisId>>(initialAxisById);
  const [userPresets, setUserPresets] = useState<UserMacroPreset[]>(() => safeReadUserPresets());
  const [presetName, setPresetName] = useState("나의 매크로 뷰");
  const [presetNotice, setPresetNotice] = useState<string | null>(null);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const [loadRetryKey, setLoadRetryKey] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [limitNotice, setLimitNotice] = useState<string | null>(null);

  const selectedDefinitions = useMemo(
    () => selected.map((item) => seriesById(item.id)).filter((item): item is MacroSeriesDefinition => Boolean(item)),
    [selected],
  );
  const transformMap = useMemo(() => selectedTransformMap(selected), [selected]);
  const selectedIds = useMemo(() => new Set(selected.map((item) => item.id)), [selected]);
  const visibleHiddenIds = useMemo(
    () => hiddenIds.filter((id) => selectedIds.has(id)),
    [hiddenIds, selectedIds],
  );
  const visibleAxisOverrides = useMemo(
    () => Object.entries(axisById).filter(([id, axis]) => selectedIds.has(id) && axis !== "auto").length,
    [axisById, selectedIds],
  );
  const rightAxisTitle = useMemo(
    () => explicitRightAxisTitle(selectedDefinitions, axisById),
    [axisById, selectedDefinitions],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(queryInput), 180);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

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
  }, [loadRetryKey, selectedDefinitions, transformMap]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    params.set("series", selected.map((item) => item.id).join(","));
    params.set("transform", selected.map((item) => item.transform ?? seriesById(item.id)?.defaultTransform ?? "raw").join(","));
    params.set("range", rangeId);
    if (visibleHiddenIds.length) params.set("hidden", visibleHiddenIds.join(","));
    const axis = axisParam(selected, axisById);
    if (axis) params.set("axis", axis);
    const next = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, "", next);
  }, [axisById, rangeId, selected, visibleHiddenIds]);

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

  const applyChartState = useCallback((state: InitialChartState) => {
    const nextSelected = cloneSelection(state.selected).slice(0, MAX_SELECTED_SERIES);
    const nextSelectedIds = new Set(nextSelected.map((item) => item.id));
    setSelected(nextSelected);
    setRangeId(MACRO_RANGE_IDS.has(state.rangeId) ? state.rangeId : DEFAULT_RANGE_ID);
    setHiddenIds([...new Set(state.hiddenIds)].filter((id) => nextSelectedIds.has(id)));
    setAxisById(
      Object.fromEntries(
        Object.entries(state.axisById).filter(([id, axis]) => nextSelectedIds.has(id) && axis !== "auto"),
      ),
    );
    setLimitNotice(null);
    setPresetNotice(null);
  }, []);

  const toggleSeries = useCallback((id: string) => {
    if (selected.some((item) => item.id === id)) {
      setSelected((prev) => prev.filter((item) => item.id !== id));
      setHiddenIds((prev) => prev.filter((hiddenId) => hiddenId !== id));
      setAxisById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setLimitNotice(null);
      return;
    }
    const definition = seriesById(id);
    if (!definition) return;
    if (selected.length >= MAX_SELECTED_SERIES) {
      setLimitNotice(`비교 시리즈는 최대 ${MAX_SELECTED_SERIES}개까지 선택할 수 있습니다.`);
      return;
    }
    setSelected((prev) => [...prev, { id, transform: definition.defaultTransform ?? "raw" }]);
    setLimitNotice(null);
  }, [selected]);

  const setTransform = useCallback((id: string, transform: MacroValueTransform) => {
    setSelected((prev) => prev.map((item) => (item.id === id ? { ...item, transform } : item)));
  }, []);

  const setAxis = useCallback((id: string, axis: MacroAxisId) => {
    setAxisById((prev) => {
      const next = { ...prev };
      if (axis === "auto") delete next[id];
      else next[id] = axis;
      return next;
    });
  }, []);

  const applyPreset = useCallback((presetId: string) => {
    const preset = MACRO_CHART_PRESETS.find((item) => item.id === presetId);
    if (preset) {
      applyChartState({
        selected: cloneSelection(preset.series),
        rangeId,
        hiddenIds: [],
        axisById: {},
      });
    }
  }, [applyChartState, rangeId]);

  const applyUserPreset = useCallback((preset: UserMacroPreset) => {
    applyChartState({
      selected: cloneSelection(preset.selected),
      rangeId: preset.rangeId,
      hiddenIds: preset.hiddenIds,
      axisById: preset.axisById,
    });
  }, [applyChartState]);

  const saveUserPreset = useCallback(() => {
    if (!selected.length) {
      setPresetNotice("시리즈를 먼저 선택하세요.");
      return;
    }
    const name = (presetName.trim() || "나의 매크로 뷰").slice(0, 32);
    const nextSelectedIds = new Set(selected.map((item) => item.id));
    const nextPreset: UserMacroPreset = {
      id: `user-${Date.now().toString(36)}`,
      name,
      selected: cloneSelection(selected),
      rangeId,
      hiddenIds: visibleHiddenIds,
      axisById: Object.fromEntries(Object.entries(axisById).filter(([id]) => nextSelectedIds.has(id))),
      updatedAt: new Date().toISOString(),
    };
    const next = [nextPreset, ...userPresets.filter((preset) => preset.name !== name)].slice(0, 8);
    if (writeUserPresets(next)) {
      setUserPresets(next);
      setPresetNotice("프리셋 저장됨");
    } else {
      setPresetNotice("브라우저 저장소에 저장하지 못했습니다.");
    }
  }, [axisById, presetName, rangeId, selected, userPresets, visibleHiddenIds]);

  const deleteUserPreset = useCallback((presetId: string) => {
    const next = userPresets.filter((preset) => preset.id !== presetId);
    if (writeUserPresets(next)) {
      setUserPresets(next);
      setPresetNotice("프리셋 삭제됨");
    } else {
      setPresetNotice("브라우저 저장소를 갱신하지 못했습니다.");
    }
  }, [userPresets]);

  const handleHiddenSeriesChange = useCallback((nextHiddenIds: string[]) => {
    setHiddenIds([...new Set(nextHiddenIds)].filter((id) => selectedIds.has(id)));
  }, [selectedIds]);

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
          {selectedDefinitions.length ? (
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1 xl:hidden" aria-label="선택된 매크로 시리즈">
              {selected.map((item) => {
                const definition = seriesById(item.id);
                if (!definition) return null;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleSeries(item.id)}
                    className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-black text-slate-700"
                    aria-label={`${definition.shortLabel} 제거`}
                  >
                    {definition.shortLabel}
                    <span aria-hidden className="text-slate-400">×</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {activeLoadState.status === "error" ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">
              <p>차트 데이터를 불러오지 못했습니다.</p>
              <p className="mt-1 text-xs font-semibold text-rose-600">{activeLoadState.message}</p>
              <button
                type="button"
                onClick={() => setLoadRetryKey((value) => value + 1)}
                className="mt-3 min-h-9 rounded-md bg-rose-700 px-3 text-xs font-black text-white transition hover:bg-rose-800"
              >
                다시 시도
              </button>
            </div>
          ) : activeLoadState.status === "loading" ? (
            <div className="flex h-[22rem] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm font-black text-slate-500 sm:h-[26rem] lg:h-[30rem]">
              차트 준비 중
            </div>
          ) : activeLoadState.status === "ready" && activeLoadState.series.length ? (
            <MarketChartFrame
              ariaLabel="매크로 시계열 비교 차트"
              series={applyAxisOverrides(activeLoadState.series, axisById)}
              ranges={MACRO_RANGES}
              defaultRangeId={DEFAULT_RANGE_ID}
              rangeId={rangeId}
              hiddenSeriesIds={visibleHiddenIds}
              onRangeChange={setRangeId}
              onHiddenSeriesChange={handleHiddenSeriesChange}
              sortLabels
              heightClassName="h-[22rem] sm:h-[26rem] lg:h-[30rem]"
              yAxisTitle="기준값 / 지수"
              y1AxisTitle={rightAxisTitle}
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
              `기간 ${rangeId}`,
              visibleHiddenIds.length ? `${visibleHiddenIds.length}개 시리즈 숨김` : null,
              visibleAxisOverrides ? `${visibleAxisOverrides}개 축 고정` : null,
              "URL로 선택값·기간·숨김·축 상태 공유 가능",
            ]}
          >
            public data spine의 정적 JSON만 읽고, 브라우저에서 선택한 시리즈를 정렬·변환합니다.
          </DataProvenanceNote>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">시리즈 검색</p>
                <p className="mt-1 text-xs font-bold text-slate-500">
                  {selected.length}/{MAX_SELECTED_SERIES} 선택 · {filteredCatalog.length}개 표시
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPickerOpen((value) => !value)}
                aria-controls="macro-series-picker-panel"
                aria-expanded={pickerOpen}
                className="min-h-10 shrink-0 rounded-md border border-slate-200 px-3 text-xs font-black text-slate-700 xl:hidden"
              >
                {pickerOpen ? "닫기" : "열기"}
              </button>
            </div>
            <div id="macro-series-picker-panel" className={cx("mt-3", pickerOpen ? "block" : "hidden xl:block")}>
              <label className="sr-only" htmlFor="macro-series-search">
                시리즈 검색
              </label>
              <input
                id="macro-series-search"
                value={queryInput}
                onChange={(event) => setQueryInput(event.target.value)}
                placeholder="M2, VIX, PMI..."
                className="min-h-10 w-full rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-brand-interactive"
              />
              <div className="mt-2 min-h-5 text-[11px] font-bold text-slate-500" role="status">
                {limitNotice ??
                  (activeLoadState.status === "loading"
                    ? "선택한 시리즈 데이터를 불러오는 중입니다."
                    : `최대 ${MAX_SELECTED_SERIES}개까지 비교할 수 있습니다.`)}
              </div>
              <div className="mt-3 max-h-[22rem] space-y-2 overflow-y-auto pr-1 sm:max-h-[28rem] xl:max-h-[32rem]">
                {filteredCatalog.map((item) => (
                  <PickerButton
                    key={item.id}
                    item={item}
                    active={selected.some((selectedItem) => selectedItem.id === item.id)}
                    onClick={() => toggleSeries(item.id)}
                  />
                ))}
                {filteredCatalog.length === 0 ? (
                  <p className="rounded-lg bg-slate-50 p-3 text-xs font-semibold text-slate-500">검색 결과가 없습니다.</p>
                ) : null}
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-black text-slate-900">내 프리셋</h2>
              <span className="text-[11px] font-bold text-slate-500">{userPresets.length}/8</span>
            </div>
            <div className="mt-3 flex gap-2">
              <label className="sr-only" htmlFor="macro-user-preset-name">
                프리셋 이름
              </label>
              <input
                id="macro-user-preset-name"
                value={presetName}
                onChange={(event) => setPresetName(event.target.value)}
                maxLength={32}
                className="min-h-10 min-w-0 flex-1 rounded-md border border-slate-200 px-3 text-xs font-bold text-slate-800 outline-none transition focus:border-brand-interactive"
              />
              <button
                type="button"
                onClick={saveUserPreset}
                className="min-h-10 shrink-0 rounded-md bg-slate-900 px-3 text-xs font-black text-white transition hover:bg-brand-interactive"
              >
                저장
              </button>
            </div>
            <div className="mt-2 min-h-5 text-[11px] font-bold text-slate-500" role="status">
              {presetNotice ?? "현재 선택·기간·숨김·축을 저장합니다."}
            </div>
            <div className="mt-2 space-y-2">
              {userPresets.length ? (
                userPresets.map((preset) => (
                  <div key={preset.id} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2">
                    <button
                      type="button"
                      onClick={() => applyUserPreset(preset)}
                      className="min-w-0 flex-1 text-left"
                      title={preset.name}
                    >
                      <span className="block truncate text-xs font-black text-slate-800">{preset.name}</span>
                      <span className="block truncate text-[11px] font-semibold text-slate-500">
                        {preset.selected.length}개 · {preset.rangeId}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteUserPreset(preset.id)}
                      className="min-h-8 shrink-0 rounded-md px-2 text-[11px] font-black text-slate-500 hover:bg-slate-100"
                      aria-label={`${preset.name} 삭제`}
                    >
                      삭제
                    </button>
                  </div>
                ))
              ) : (
                <p className="rounded-lg bg-slate-50 p-3 text-xs font-semibold text-slate-500">저장한 프리셋이 없습니다.</p>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-black text-slate-900">선택 시리즈</h2>
              <button
                type="button"
                onClick={() => {
                  setSelected([]);
                  setHiddenIds([]);
                  setAxisById({});
                  setLimitNotice(null);
                }}
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
                          className="min-h-8 rounded-md px-2 py-1 text-[11px] font-black text-slate-500 hover:bg-slate-100"
                        >
                          제거
                        </button>
                      </div>
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                        <select
                          value={current}
                          onChange={(event) => setTransform(item.id, event.target.value as MacroValueTransform)}
                          className="min-h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-black text-slate-700"
                          aria-label={`${definition.shortLabel} 변환`}
                        >
                          {Object.entries(MACRO_TRANSFORM_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <select
                          value={axisById[item.id] ?? "auto"}
                          onChange={(event) => setAxis(item.id, event.target.value as MacroAxisId)}
                          className="min-h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-black text-slate-700"
                          aria-label={`${definition.shortLabel} 축`}
                        >
                          <option value="auto">축 자동</option>
                          <option value="left">좌축</option>
                          <option value="right">우축</option>
                        </select>
                      </div>
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
