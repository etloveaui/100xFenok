"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import DataProvenanceNote from "@/components/DataProvenanceNote";
import { DataStateBadge } from "@/components/DataStateNotice";
import TransitionLink from "@/components/TransitionLink";
import { CpDataTable, type CpDataTableColumn } from "@/components/canvas-plus/kit";
import { EmptyState, EvidenceRail, Panel, useDelayedLoading } from "@/components/ui";
import { okabeItoPalette } from "@/lib/chart-theme";
import { formatAsOf, freshnessDataState } from "@/lib/data-state";
import { MarketChartFrame, type MarketChartRange } from "@/lib/market-valuation/charts/MarketChartFrame";
import type { MarketChartSeries } from "@/lib/market-valuation/charts/types";
import {
  MACRO_CATALOG_CURATED_AT,
  MACRO_CATALOG_SERIES_COUNT,
  MACRO_CHART_PRESETS,
  MACRO_GROUP_LABELS,
  MACRO_SERIES_CATALOG,
  MACRO_TRANSFORM_LABELS,
  seriesById,
} from "@/lib/macro-chart/registry";
import {
  DEFAULT_MACRO_CONTEXT_ID,
  MACRO_CONTEXTS,
  macroContextFromParam,
  macroContextIdForPreset,
  type MacroContextId,
  type MacroWorkbenchContext,
} from "@/lib/macro-chart/context";
import { buildMarketSeries, loadMacroSeries, transformedUnitGroupLabel, unitLabel } from "@/lib/macro-chart/loader";
import { stooqSeriesIdFromInput } from "@/lib/macro-chart/stooq";
import { transformUnitLabel } from "@/lib/macro-chart/transforms";
import { ROUTES, withQuery } from "@/lib/routes";
import type { LoadedMacroSeries } from "@/lib/macro-chart/loader";
import type {
  MacroAggregation,
  MacroOutputFrequency,
  MacroSeriesDefinition,
  MacroSeriesViewOptions,
  MacroValueTransform,
} from "@/lib/macro-chart/types";

const DEFAULT_PRESET_ID = "risk-liquidity";
const DEFAULT_RANGE_ID = "5Y";
const MAX_SELECTED_SERIES = 8;
const MAX_FORMULA_SERIES = 3;
const USER_PRESET_STORAGE_KEY = "100xfenok.macroChart.userPresets.v1";
const MACRO_RANGES: readonly MarketChartRange[] = [
  { id: "3M", label: "3M", months: 3 },
  { id: "6M", label: "6M", months: 6 },
  { id: "1Y", label: "1Y", months: 12 },
  { id: "3Y", label: "3Y", months: 36 },
  { id: "5Y", label: "5Y", months: 60 },
  { id: "10Y", label: "10Y", months: 120 },
  { id: "MAX", label: "전체" },
];
const MACRO_RANGE_IDS = new Set(MACRO_RANGES.map((range) => range.id));
const MACRO_TRANSFORM_IDS = new Set<MacroValueTransform>(["raw", "change", "pctChange", "yoy", "rebase100"]);
const MACRO_FREQUENCY_IDS = new Set<MacroOutputFrequency>(["daily", "weekly", "monthly", "quarterly"]);
const MACRO_AGGREGATION_IDS = new Set<MacroAggregation>(["average", "sum", "end"]);
const MACRO_AXIS_IDS = new Set(["auto", "left", "right"]);
const MACRO_COLOR_OPTIONS = okabeItoPalette.slice(0, 6);
const MACRO_TEN_YEAR_COLOR = okabeItoPalette[1];
const MACRO_FORMULA_OPERATORS = new Set<string>(["subtract", "ratio", "scale"]);
const MACRO_FORMULA_LABELS: Record<MacroFormulaOperator, string> = {
  subtract: "a − b",
  ratio: "a / b",
  scale: "a × k",
};

type LoadState =
  | { status: "idle" | "loading" }
  | { status: "ready"; series: MarketChartSeries[]; loaded: LoadedMacroSeries[] }
  | { status: "error"; message: string };

type SelectedMacroSeries = {
  id: string;
  transform?: MacroValueTransform;
  frequency?: MacroOutputFrequency;
  aggregation?: MacroAggregation;
  color?: string;
};
type MacroAxisId = "auto" | "left" | "right";
type MacroFormulaOperator = "subtract" | "ratio" | "scale";
type MacroFormulaSeries = {
  id: string;
  leftId: string;
  rightId?: string;
  scalar?: number;
  operator: MacroFormulaOperator;
};

function normalizeFormulaOperator(value: string): MacroFormulaOperator | null {
  if (value === "spread") return "subtract";
  return MACRO_FORMULA_OPERATORS.has(value) ? value as MacroFormulaOperator : null;
}

type InitialChartState = {
  selected: SelectedMacroSeries[];
  rangeId: string;
  hiddenIds: string[];
  axisById: Record<string, MacroAxisId>;
  formulas: MacroFormulaSeries[];
  macroContextId: MacroContextId;
};

type MacroAnalysisLens = {
  id: string;
  label: string;
  detail: string;
  state: Omit<InitialChartState, "macroContextId">;
};

type MarketCompareLens = {
  id: string;
  label: string;
  detail: string;
  state: InitialChartState;
};

type MacroConnectionLink = {
  id: string;
  label: string;
  detail: string;
  href: (context: MacroWorkbenchContext) => string;
  groups: readonly MacroSeriesDefinition["group"][];
};

type UserMacroPreset = {
  id: string;
  name: string;
  selected: SelectedMacroSeries[];
  rangeId: string;
  hiddenIds: string[];
  axisById: Record<string, MacroAxisId>;
  formulas: MacroFormulaSeries[];
  macroContextId?: MacroContextId;
  updatedAt: string;
};

type MacroSurfaceState = "loading" | "empty" | "error" | "stale" | "ready";
type MacroTableRow = {
  date: string;
  values: Record<string, number | null>;
};
type UserPresetReadResult = {
  presets: UserMacroPreset[];
  persistent: boolean;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function cloneSelection(selection: readonly SelectedMacroSeries[]) {
  return selection.map((item) => withSeriesDefaults({ ...item }));
}

function stq(symbol: string) {
  return `stq~${symbol}`;
}

function defaultSelection(): SelectedMacroSeries[] {
  return cloneSelection(MACRO_CHART_PRESETS.find((preset) => preset.id === DEFAULT_PRESET_ID)?.series ?? []);
}

function coerceTransform(value: string | undefined, fallback: MacroValueTransform, legacyChange = false): MacroValueTransform {
  if (legacyChange && value === "change") return "pctChange";
  return value && MACRO_TRANSFORM_IDS.has(value as MacroValueTransform)
    ? (value as MacroValueTransform)
    : fallback;
}

function serializeTransform(value: MacroValueTransform) {
  return value;
}

function coerceFrequency(value: string | undefined, fallback: MacroOutputFrequency): MacroOutputFrequency {
  return value && MACRO_FREQUENCY_IDS.has(value as MacroOutputFrequency)
    ? (value as MacroOutputFrequency)
    : fallback;
}

function coerceAggregation(value: string | undefined): MacroAggregation {
  return value && MACRO_AGGREGATION_IDS.has(value as MacroAggregation)
    ? (value as MacroAggregation)
    : "average";
}

function withSeriesDefaults(item: SelectedMacroSeries): SelectedMacroSeries {
  const definition = seriesById(item.id);
  return {
    ...item,
    frequency: item.frequency ?? definition?.frequency,
    aggregation: item.aggregation ?? "average",
    color: item.color ?? (item.id === "DGS10" ? MACRO_TEN_YEAR_COLOR : undefined),
  };
}

function parseKnownHiddenIds(raw: string | null, knownIds: readonly string[]) {
  if (!raw) return [];
  const selectedIds = new Set(knownIds);
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

function formulaId(leftId: string, operator: MacroFormulaOperator, operand: string | number) {
  return `formula-${operator}-${leftId}-${operand}`;
}

type MacroFormulaPreset = {
  id: string;
  label: string;
  leftId: string;
  rightId: string;
  operator: "subtract";
};

const MACRO_FORMULA_PRESET_CANDIDATES: readonly MacroFormulaPreset[] = [
  { id: "yield-curve-10y-2y", label: "10Y − 2Y", leftId: "DGS10", rightId: "DGS2", operator: "subtract" },
  { id: "credit-spread-hy-ig", label: "HY − IG", leftId: "HY_spread", rightId: "IG_spread", operator: "subtract" },
];

const AVAILABLE_MACRO_FORMULA_PRESETS = MACRO_FORMULA_PRESET_CANDIDATES.filter(
  (preset) => Boolean(seriesById(preset.leftId) && seriesById(preset.rightId)),
);

const MACRO_ANALYSIS_LENSES: readonly MacroAnalysisLens[] = [
  {
    id: "risk-liquidity",
    label: "리스크·유동성 렌즈",
    detail: "주식, 변동성, 재정 유동성, 금리, 신용을 한 번에 본다.",
    state: {
      selected: [
        { id: "sp500", transform: "rebase100" },
        { id: "vix", transform: "raw" },
        { id: "tga", transform: "rebase100" },
        { id: "DGS10", transform: "raw" },
        { id: "HY_spread", transform: "raw" },
        { id: "M2SL", transform: "yoy" },
      ],
      rangeId: "10Y",
      hiddenIds: ["vix"],
      axisById: { vix: "right", DGS10: "right", HY_spread: "right" },
      formulas: [
        {
          id: formulaId("sp500", "ratio", "DGS10"),
          leftId: "sp500",
          rightId: "DGS10",
          operator: "ratio",
        },
      ],
    },
  },
  {
    id: "bank-credit",
    label: "은행·신용 렌즈",
    detail: "은행 신용, 예금, 자본비율, HY 스프레드, 장기금리를 묶는다.",
    state: {
      selected: [
        { id: "bank_credit", transform: "yoy" },
        { id: "deposits", transform: "yoy" },
        { id: "fdic_tier1", transform: "raw" },
        { id: "HY_spread", transform: "raw" },
        { id: "DGS10", transform: "raw" },
      ],
      rangeId: "10Y",
      hiddenIds: [],
      axisById: { fdic_tier1: "right", HY_spread: "right", DGS10: "right" },
      formulas: [
        {
          id: formulaId("bank_credit", "subtract", "deposits"),
          leftId: "bank_credit",
          rightId: "deposits",
          operator: "subtract",
        },
      ],
    },
  },
  {
    id: "activity",
    label: "경기활동 렌즈",
    detail: "OECD CLI와 PMI/ISM 제조·서비스를 같은 축에서 본다.",
    state: {
      selected: [
        { id: "oecd_cli_us", transform: "raw" },
        { id: "pmi_mfg_us_sp", transform: "raw" },
        { id: "ism_mfg_headline", transform: "raw" },
        { id: "ism_services_headline", transform: "raw" },
      ],
      rangeId: "MAX",
      hiddenIds: [],
      axisById: {},
      formulas: [],
    },
  },
  {
    id: "crypto-liquidity",
    label: "크립토 유동성 렌즈",
    detail: "스테이블코인 공급, 나스닥, S&P 500, 크립토 심리를 비교한다.",
    state: {
      selected: [
        { id: "stablecoins", transform: "rebase100" },
        { id: "nasdaq", transform: "rebase100" },
        { id: "sp500", transform: "rebase100" },
        { id: "crypto_fear_greed", transform: "raw" },
        { id: "vix", transform: "raw" },
      ],
      rangeId: "5Y",
      hiddenIds: ["vix"],
      axisById: { crypto_fear_greed: "right", vix: "right" },
      formulas: [
        {
          id: formulaId("nasdaq", "ratio", "stablecoins"),
          leftId: "nasdaq",
          rightId: "stablecoins",
          operator: "ratio",
        },
      ],
    },
  },
];

const MACRO_TOP_LENSES = [
  {
    id: "risk-liquidity",
    label: "리스크·유동성",
    state: {
      selected: [
        { id: "sp500", transform: "rebase100" as const },
        { id: "DGS10", transform: "raw" as const },
        { id: "HY_spread", transform: "raw" as const },
        { id: "M2SL", transform: "yoy" as const },
      ],
      rangeId: "10Y",
      axisById: { DGS10: "right" as const, HY_spread: "right" as const, M2SL: "right" as const },
      macroContextId: "risk-liquidity" as const,
    },
  },
  {
    id: "growth",
    label: "성장",
    state: {
      selected: [
        { id: "GDP", transform: "yoy" as const },
        { id: "oecd_cli_us", transform: "raw" as const },
        { id: "ism_mfg_headline", transform: "raw" as const },
        { id: "ism_services_headline", transform: "raw" as const },
      ],
      rangeId: "10Y",
      axisById: { GDP: "right" as const },
      macroContextId: "activity" as const,
    },
  },
  { id: "inflation", label: "인플레이션", unavailable: "인플레이션 시리즈가 카탈로그에 없습니다" },
  {
    id: "rates-credit",
    label: "금리·신용",
    state: {
      selected: [
        { id: "DGS10", transform: "raw" as const },
        { id: "HY_spread", transform: "raw" as const },
        { id: "SOFR", transform: "raw" as const },
        { id: "IORB", transform: "raw" as const },
      ],
      rangeId: "5Y",
      axisById: {},
      macroContextId: "bank-credit" as const,
    },
  },
  { id: "collection", label: "내 컬렉션", collection: true },
] as const;

const MARKET_COMPARE_LENSES: readonly MarketCompareLens[] = [
  {
    id: "returns",
    label: "수익률 비교",
    detail: "SPY, QQQ, IWM을 같은 100 기준으로 비교한다.",
    state: {
      selected: [
        { id: stq("SPY.US"), transform: "rebase100" },
        { id: stq("QQQ.US"), transform: "rebase100" },
        { id: stq("IWM.US"), transform: "rebase100" },
      ],
      rangeId: "5Y",
      hiddenIds: [],
      axisById: {},
      formulas: [],
      macroContextId: "risk-liquidity",
    },
  },
  {
    id: "price",
    label: "실제 가격",
    detail: "NVDA, AAPL, MSFT의 달러 가격 레벨을 직접 본다.",
    state: {
      selected: [
        { id: stq("NVDA.US"), transform: "raw" },
        { id: stq("AAPL.US"), transform: "raw" },
        { id: stq("MSFT.US"), transform: "raw" },
      ],
      rangeId: "3Y",
      hiddenIds: [],
      axisById: {},
      formulas: [],
      macroContextId: "risk-liquidity",
    },
  },
  {
    id: "benchmark",
    label: "벤치마크 대비",
    detail: "QQQ/SPY 상대강도와 M2를 함께 본다.",
    state: {
      selected: [
        { id: stq("SPY.US"), transform: "rebase100" },
        { id: stq("QQQ.US"), transform: "rebase100" },
        { id: "M2SL", transform: "yoy" },
      ],
      rangeId: "10Y",
      hiddenIds: [],
      axisById: { M2SL: "right" },
      formulas: [
        {
          id: formulaId(stq("QQQ.US"), "ratio", stq("SPY.US")),
          leftId: stq("QQQ.US"),
          rightId: stq("SPY.US"),
          operator: "ratio",
        },
      ],
      macroContextId: "risk-liquidity",
    },
  },
  {
    id: "macro-stock",
    label: "매크로+종목",
    detail: "NVDA와 M2를 같은 차트에서 결합한다.",
    state: {
      selected: [
        { id: stq("NVDA.US"), transform: "rebase100" },
        { id: "M2SL", transform: "yoy" },
      ],
      rangeId: "10Y",
      hiddenIds: [],
      axisById: { [stq("NVDA.US")]: "right" },
      formulas: [
        {
          id: formulaId(stq("NVDA.US"), "ratio", "M2SL"),
          leftId: stq("NVDA.US"),
          rightId: "M2SL",
          operator: "ratio",
        },
      ],
      macroContextId: "risk-liquidity",
    },
  },
];

const MACRO_CONNECTION_LINKS: readonly MacroConnectionLink[] = [
  {
    id: "screener",
    label: "스크리너",
    detail: "매크로 렌즈를 종목 조건으로 이어서 좁힌다.",
    href: (context) => context.screenerHref,
    groups: ["equity", "rates", "credit", "liquidity", "banking", "activity", "sentiment"],
  },
  {
    id: "etfs",
    label: "ETF 센터",
    detail: "국면을 ETF 자산군, 레버리지, 단일종목 ETF로 연결한다.",
    href: (context) => context.etfHref,
    groups: ["equity", "rates", "credit", "liquidity", "activity", "sentiment"],
  },
  {
    id: "market-structure",
    label: "시장 구조",
    detail: "밸류에이션·리스크 구조 차트와 비교한다.",
    href: (context) => withQuery(ROUTES.marketStructure, { macro: context.id }),
    groups: ["equity", "rates", "credit", "liquidity"],
  },
  {
    id: "events",
    label: "이벤트",
    detail: "실적, 분할, 장전·시간외 움직임으로 이어 본다.",
    href: (context) => withQuery(ROUTES.marketEvents, { macro: context.id }),
    groups: ["equity", "sentiment", "activity"],
  },
  {
    id: "portfolio",
    label: "포트폴리오",
    detail: "내 보유 종목의 연결 데이터와 대조한다.",
    href: (context) => withQuery(ROUTES.portfolio, { macro: context.id }),
    groups: ["equity", "rates", "credit", "liquidity", "banking", "activity", "sentiment"],
  },
] as const;

function parseFormulaSeries(raw: string | null, selected: readonly SelectedMacroSeries[]) {
  if (!raw) return [];
  const selectedIds = new Set(selected.map((item) => item.id));
  const seen = new Set<string>();
  return raw
    .split(",")
    .map((token) => token.split(":").map((part) => part.trim()))
    .map((parts): MacroFormulaSeries | false => {
      if (parts.length !== 3) return false;
      const [rawOperator, leftId, operand] = parts;
      const operator = normalizeFormulaOperator(rawOperator);
      if (!operator || !selectedIds.has(leftId)) return false;
      const scalar = operator === "scale" ? Number(operand) : undefined;
      if (operator === "scale" && (typeof scalar !== "number" || !Number.isFinite(scalar) || scalar === 0)) return false;
      if (operator !== "scale" && (leftId === operand || !selectedIds.has(operand))) return false;
      const normalizedOperand = operator === "scale" ? scalar! : operand;
      const id = formulaId(leftId, operator, normalizedOperand);
      if (seen.has(id)) return false;
      seen.add(id);
      return {
        id,
        leftId,
        rightId: operator === "scale" ? undefined : operand,
        scalar: operator === "scale" ? scalar : undefined,
        operator,
      } satisfies MacroFormulaSeries;
    })
    .filter((formula): formula is MacroFormulaSeries => formula !== false)
    .slice(0, MAX_FORMULA_SERIES);
}

function formulaParam(formulas: readonly MacroFormulaSeries[]) {
  return formulas.map((formula) => `${formula.operator}:${formula.leftId}:${formula.operator === "scale" ? formula.scalar : formula.rightId}`).join(",");
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

function selectedWithUrlOptions(selected: readonly SelectedMacroSeries[], params: URLSearchParams) {
  const transforms = params.get("transform")?.split(",") ?? [];
  const legacyChange = params.get("transformVersion") !== "2";
  const frequencies = params.get("frequency")?.split(",") ?? [];
  const aggregations = params.get("aggregation")?.split(",") ?? [];
  const colors = params.get("color")?.split(",") ?? [];
  return selected.map((item, index) => {
    const definition = seriesById(item.id);
    return withSeriesDefaults({
      ...item,
      transform: coerceTransform(transforms[index], item.transform ?? definition?.defaultTransform ?? "raw", legacyChange),
      frequency: coerceFrequency(frequencies[index], item.frequency ?? definition?.frequency ?? "daily"),
      aggregation: coerceAggregation(aggregations[index] ?? item.aggregation),
      color: MACRO_COLOR_OPTIONS.includes(colors[index] as (typeof MACRO_COLOR_OPTIONS)[number])
        ? colors[index]
        : item.color,
    });
  });
}

function selectedViewOptions(selected: readonly SelectedMacroSeries[]) {
  return new Map<string, MacroSeriesViewOptions>(selected.map((item) => [
    item.id,
    { frequency: item.frequency, aggregation: item.aggregation },
  ]));
}

function safeReadUserPresets(): UserPresetReadResult {
  if (typeof window === "undefined") return { presets: [], persistent: false };
  try {
    const raw = window.localStorage.getItem(USER_PRESET_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return { presets: [], persistent: false };
    const presets = parsed
      .map((item): UserMacroPreset | null => {
        if (!item || typeof item !== "object") return null;
        const record = item as Partial<UserMacroPreset>;
        const selected = Array.isArray(record.selected)
          ? record.selected
              .filter((entry): entry is SelectedMacroSeries =>
                Boolean(entry && typeof entry.id === "string" && seriesById(entry.id)),
              )
              .map((entry) => {
                const definition = seriesById(entry.id)!;
                return withSeriesDefaults({
                  id: entry.id,
                  transform: coerceTransform(entry.transform, definition.defaultTransform ?? "raw"),
                  frequency: coerceFrequency(entry.frequency, definition.frequency),
                  aggregation: coerceAggregation(entry.aggregation),
                  color: entry.color && MACRO_COLOR_OPTIONS.includes(entry.color as (typeof MACRO_COLOR_OPTIONS)[number])
                    ? entry.color
                    : undefined,
                });
              })
              .slice(0, MAX_SELECTED_SERIES)
          : [];
        if (!selected.length || typeof record.name !== "string") return null;
        const formulas = Array.isArray(record.formulas)
          ? parseFormulaSeries(
              record.formulas
                .filter(
                  (entry): entry is MacroFormulaSeries =>
                    Boolean(
                      entry &&
                        typeof entry.leftId === "string" &&
                        typeof entry.operator === "string" &&
                        (entry.operator === "scale" ? typeof entry.scalar === "number" : typeof entry.rightId === "string"),
                    ),
                )
                .map((entry) => formulaParam([entry]))
                .join(","),
              selected,
            )
          : [];
        const knownIds = [...selected.map((entry) => entry.id), ...formulas.map((entry) => entry.id)];
        return {
          id: typeof record.id === "string" ? record.id : `preset-${Date.now()}`,
          name: record.name.slice(0, 32),
          selected: cloneSelection(selected),
          rangeId: MACRO_RANGE_IDS.has(record.rangeId ?? "") ? record.rangeId! : DEFAULT_RANGE_ID,
          hiddenIds: Array.isArray(record.hiddenIds)
            ? parseKnownHiddenIds(record.hiddenIds.filter((value): value is string => typeof value === "string").join(","), knownIds)
            : [],
          axisById: parseAxisById(selected.map((entry) => record.axisById?.[entry.id] ?? "auto").join(","), selected),
          formulas,
          macroContextId: macroContextFromParam(record.macroContextId)?.id,
          updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString(),
        };
      })
      .filter((item): item is UserMacroPreset => item !== null)
      .slice(0, 8);
    return { presets, persistent: true };
  } catch {
    return { presets: [], persistent: false };
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

type MacroChartInitialMode = "macro" | "stock-compare";

function stockCompareDefaultState(): InitialChartState {
  const base = MARKET_COMPARE_LENSES[0]?.state;
  return {
    selected: cloneSelection(base?.selected ?? []),
    rangeId: base?.rangeId ?? DEFAULT_RANGE_ID,
    hiddenIds: [...(base?.hiddenIds ?? [])],
    axisById: { ...(base?.axisById ?? {}) },
    formulas: [...(base?.formulas ?? [])],
    macroContextId: base?.macroContextId ?? DEFAULT_MACRO_CONTEXT_ID,
  };
}

function defaultChartState(initialMode: MacroChartInitialMode = "macro"): InitialChartState {
  if (initialMode === "stock-compare") return stockCompareDefaultState();
  return {
    selected: defaultSelection(),
    rangeId: DEFAULT_RANGE_ID,
    hiddenIds: [],
    axisById: {},
    formulas: [],
    macroContextId: DEFAULT_MACRO_CONTEXT_ID,
  };
}

function initialChartStateFromUrl(fallback: InitialChartState): InitialChartState {
  if (typeof window === "undefined") return fallback;
  const params = new URLSearchParams(window.location.search);
  const preset = MACRO_CHART_PRESETS.find((item) => item.id === params.get("preset"));
  const macroContextId = macroContextFromParam(params.get("macro"))?.id ?? macroContextIdForPreset(preset?.id);
  const rangeParam = params.get("range") ?? "";
  const rangeId = MACRO_RANGE_IDS.has(rangeParam) ? rangeParam : DEFAULT_RANGE_ID;
  if (preset) {
    const selected = selectedWithUrlOptions(cloneSelection(preset.series), params);
    const formulas = parseFormulaSeries(params.get("formula"), selected);
    return {
      selected,
      rangeId,
      hiddenIds: parseKnownHiddenIds(params.get("hidden"), [...selected.map((item) => item.id), ...formulas.map((item) => item.id)]),
      axisById: parseAxisById(params.get("axis"), selected),
      formulas,
      macroContextId,
    };
  }
  const ids = params.get("series")?.split(",").map((id) => id.trim()).filter(Boolean) ?? [];
  if (!ids.length) return { ...fallback, rangeId, macroContextId };
  const selected = selectedWithUrlOptions(ids
    .filter((id) => seriesById(id))
    .slice(0, MAX_SELECTED_SERIES)
    .map((id, index) => ({
      id,
      transform: coerceTransform(
        params.get("transform")?.split(",")[index],
        seriesById(id)?.defaultTransform ?? "raw",
      ),
    })), params);
  const finalSelected = selected.length ? selected : fallback.selected;
  const formulas = parseFormulaSeries(params.get("formula"), finalSelected);
  return {
    selected: finalSelected,
    rangeId,
    hiddenIds: parseKnownHiddenIds(params.get("hidden"), [...finalSelected.map((item) => item.id), ...formulas.map((item) => item.id)]),
    axisById: parseAxisById(params.get("axis"), finalSelected),
    formulas,
    macroContextId,
  };
}

function selectedTransformMap(selected: readonly SelectedMacroSeries[]) {
  return new Map(selected.map((item) => [item.id, item.transform ?? seriesById(item.id)?.defaultTransform ?? "raw"]));
}

function sourceKindLabel(definition: MacroSeriesDefinition | undefined) {
  if (!definition) return "computed";
  return definition.sourceKind === "stooq" ? "market-symbol" : "data-spine";
}

const MACRO_SOURCE_DISPLAY_LABELS: Record<NonNullable<MacroSeriesDefinition["sourceKind"]> | "local-json", string> = {
  "local-json": "100x 기본 데이터",
  stooq: "시장 심볼",
};

const MACRO_FREQUENCY_DISPLAY_LABELS: Record<MacroSeriesDefinition["frequency"], string> = {
  daily: "일간",
  weekly: "주간",
  monthly: "월간",
  quarterly: "분기",
};

const MACRO_UNIT_DISPLAY_LABELS: Record<MacroSeriesDefinition["unit"], string> = {
  index: "지수",
  score: "점수",
  percent: "%",
  spread: "스프레드",
  usd_billion: "$B",
  usd_million: "$M",
  usd: "$",
  contracts: "계약",
};

function sourceDisplayLabel(definition: MacroSeriesDefinition | undefined) {
  if (!definition) return "계산";
  const key = definition.sourceKind ?? "local-json";
  return MACRO_SOURCE_DISPLAY_LABELS[key] ?? "100x 기본 데이터";
}

function frequencyDisplayLabel(definition: MacroSeriesDefinition | undefined) {
  return definition?.frequency ?? "computed";
}

function definitionMetaLabel(definition: MacroSeriesDefinition) {
  return `${sourceDisplayLabel(definition)} · ${MACRO_GROUP_LABELS[definition.group]} · ${MACRO_UNIT_DISPLAY_LABELS[definition.unit]} · ${MACRO_FREQUENCY_DISPLAY_LABELS[definition.frequency]}`;
}

function formatValue(value: number | null) {
  if (value === null) return "—";
  const abs = Math.abs(value);
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: abs >= 100 ? 0 : abs >= 10 ? 1 : 2,
  }).format(value);
}

const MACRO_FREQUENCY_LABELS: Record<MacroOutputFrequency, string> = {
  daily: "일",
  weekly: "주",
  monthly: "월",
  quarterly: "분기",
};

const MACRO_AGGREGATION_LABELS: Record<MacroAggregation, string> = {
  average: "평균",
  sum: "합",
  end: "기말",
};

const MACRO_FREQUENCY_RANK: Record<MacroOutputFrequency, number> = {
  daily: 0,
  weekly: 1,
  monthly: 2,
  quarterly: 3,
};

function frequencyAvailable(definition: MacroSeriesDefinition, frequency: MacroOutputFrequency) {
  return MACRO_FREQUENCY_RANK[frequency] >= MACRO_FREQUENCY_RANK[definition.frequency];
}

function latestStepChange(series: MarketChartSeries) {
  const finite = series.points.filter((point) => typeof point.value === "number" && Number.isFinite(point.value));
  const latest = finite.at(-1)?.value;
  const previous = finite.at(-2)?.value;
  return typeof latest === "number" && typeof previous === "number" ? latest - previous : null;
}

function sourceSummary(definitions: readonly MacroSeriesDefinition[]) {
  const files = new Set(definitions.map((item) => item.sourcePath.replace("/data/", "")));
  return `${definitions.length}개 시리즈 · ${files.size}개 데이터 파일`;
}

function downloadCsv(series: readonly MarketChartSeries[], selected: readonly SelectedMacroSeries[], rangeId: string) {
  const labels = new Set<string>();
  for (const item of series) {
    for (const point of item.points) labels.add(point.label);
  }
  const dates = [...labels].sort((a, b) => a.localeCompare(b));
  const valuesBySeries = series.map((item) => new Map(item.points.map((point) => [point.label, point.value])));
  const frequencyById = new Map(selected.map((item) => [item.id, item.frequency ?? seriesById(item.id)?.frequency]));
  const aggregationById = new Map(selected.map((item) => [item.id, item.aggregation ?? "average"]));
  const header = [
    "date",
    ...series.map((item) => tableSeriesHeader(item, selected, rangeLabel(rangeId))),
  ];
  const sourceRow = ["__meta_source", ...series.map((item) => sourceKindLabel(seriesById(item.id)))];
  const frequencyRow = ["__meta_frequency", ...series.map((item) => frequencyById.get(item.id) ?? frequencyDisplayLabel(seriesById(item.id)))];
  const aggregationRow = ["__meta_aggregation", ...series.map((item) => aggregationById.get(item.id) ?? "computed")];
  const rows = dates.map((date) => [
    date,
    ...valuesBySeries.map((values) => {
      const value = values.get(date);
      return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
    }),
  ]);
  const csv = [header, sourceRow, frequencyRow, aggregationRow, ...rows]
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

function waitForPaint() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

async function downloadChartPng() {
  await waitForPaint();
  const canvases = [...document.querySelectorAll<HTMLCanvasElement>('.cpw5-macro-chart-rows [role="group"][aria-label*="매크로 시계열 비교 차트"] canvas')];
  if (!canvases.length) return false;
  const gap = 16;
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = Math.max(...canvases.map((canvas) => canvas.width));
  exportCanvas.height = canvases.reduce((height, canvas) => height + canvas.height, 0) + gap * (canvases.length - 1);
  const ctx = exportCanvas.getContext("2d");
  if (!ctx) return false;
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--c-panel").trim() || "Canvas";
  ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  let y = 0;
  for (const canvas of canvases) {
    ctx.drawImage(canvas, 0, y);
    y += canvas.height + gap;
  }
  const link = document.createElement("a");
  link.href = exportCanvas.toDataURL("image/png");
  link.download = `100xfenok-macro-chart-${new Date().toISOString().slice(0, 10)}.png`;
  link.click();
  return true;
}

function applyAxisOverrides(series: readonly MarketChartSeries[], axisById: Record<string, MacroAxisId>) {
  return series.map((item) => {
    const axis = axisById[item.id] ?? "auto";
    if (axis === "left") return { ...item, yAxisId: "y" as const };
    if (axis === "right") return { ...item, yAxisId: "y1" as const };
    return item;
  });
}

function applySeriesColors(series: readonly MarketChartSeries[], selected: readonly SelectedMacroSeries[]) {
  const colorById = new Map(selected.map((item) => [item.id, item.color]));
  return series.map((item) => ({ ...item, color: colorById.get(item.id) ?? item.color }));
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
  if (units.length === 0) return "% / 스프레드";
  if (units.length === 1) return units[0];
  return "보조축";
}

function formatFormulaScalar(value: number | undefined) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 }).format(value ?? 1);
}

function formulaLabel(formula: MacroFormulaSeries) {
  const left = seriesById(formula.leftId)?.shortLabel ?? formula.leftId;
  if (formula.operator === "scale") return `${left} × ${formatFormulaScalar(formula.scalar)}`;
  const rightId = formula.rightId ?? "";
  const right = seriesById(rightId)?.shortLabel ?? rightId;
  if (formula.operator === "ratio") return `${left} / ${right}`;
  return `${left} − ${right}`;
}

function formulaSeriesMetadata(
  formula: MacroFormulaSeries,
  left: MarketChartSeries,
  right: MarketChartSeries | null,
) {
  const leftUnit = left.unitGroup ?? "level";
  if (formula.operator === "ratio") {
    return { unitGroup: "ratio", unitLabel: "비율", yAxisId: "y1" as const };
  }
  if (formula.operator === "scale") {
    return { unitGroup: leftUnit, unitLabel: transformedUnitGroupLabel(leftUnit), yAxisId: left.yAxisId ?? "y" };
  }
  const rightUnit = right?.unitGroup ?? leftUnit;
  const sameUnit = leftUnit === rightUnit;
  return {
    unitGroup: sameUnit ? leftUnit : "derived",
    unitLabel: sameUnit ? transformedUnitGroupLabel(leftUnit) : "합성값",
    yAxisId: sameUnit ? left.yAxisId ?? "y" : "y" as const,
  };
}

function buildFormulaSeries(baseSeries: readonly MarketChartSeries[], formulas: readonly MacroFormulaSeries[]) {
  const byId = new Map(baseSeries.map((item) => [item.id, item]));
  return formulas
    .map((formula): MarketChartSeries | null => {
      const left = byId.get(formula.leftId);
      const right = formula.operator === "scale" ? null : formula.rightId ? byId.get(formula.rightId) ?? null : null;
      if (!left || (formula.operator !== "scale" && !right)) return null;
      const rightByLabel = new Map(right?.points.map((point) => [point.label, point.value]) ?? []);
      const points = left.points.flatMap((point) => {
        if (typeof point.value !== "number") return [{ label: point.label, value: null }];
        if (formula.operator === "scale") {
          return [{ label: point.label, value: point.value * (formula.scalar ?? 1) }];
        }
        if (!rightByLabel.has(point.label)) return [];
        const rightValue = rightByLabel.get(point.label);
        if (typeof rightValue !== "number") return [{ label: point.label, value: null }];
        if (formula.operator === "ratio") {
          return [{
            label: point.label,
            value: rightValue === 0 ? null : point.value / rightValue,
          }];
        }
        return [{
          label: point.label,
          value: point.value - rightValue,
        }];
      });
      if (!points.some((point) => typeof point.value === "number" && Number.isFinite(point.value))) return null;
      const displayFormula = formulaLabel(formula);
      const metadata = formulaSeriesMetadata(formula, left, right);
      return {
        id: formula.id,
        label: `${displayFormula} · ${metadata.unitLabel}`,
        formulaLabel: displayFormula,
        unitLabel: metadata.unitLabel,
        color: okabeItoPalette[(baseSeries.length + formulas.indexOf(formula)) % okabeItoPalette.length],
        colorToken: "fairValue",
        yAxisId: metadata.yAxisId,
        unitGroup: metadata.unitGroup,
        paletteIndex: baseSeries.length + formulas.indexOf(formula),
        lineRole: "secondary",
        points,
      };
    })
    .filter((item): item is MarketChartSeries => item !== null);
}

function sparklineSegments(series: MarketChartSeries) {
  const finiteValues = series.points.flatMap((point) =>
    typeof point.value === "number" && Number.isFinite(point.value) ? [point.value] : [],
  );
  if (finiteValues.length < 2) return [];
  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);
  const span = max - min || 1;
  const denominator = Math.max(series.points.length - 1, 1);
  const segments: string[] = [];
  let active: string[] = [];
  const flush = () => {
    if (active.length >= 2) segments.push(active.join(" "));
    active = [];
  };
  series.points.forEach((point, index) => {
    if (typeof point.value !== "number" || !Number.isFinite(point.value)) {
      flush();
      return;
    }
    const x = (index / denominator) * 100;
    const y = 29 - ((point.value - min) / span) * 26;
    active.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  });
  flush();
  return segments;
}

function LensSparkline({ series, state }: { series?: MarketChartSeries; state: MacroSurfaceState }) {
  const segments = series ? sparklineSegments(series) : [];
  if (state === "loading") {
    return <div className="cpw5-macro-lens-sparkline cpw5-macro-lens-sparkline--loading" data-macro-v2-lens-sparkline="loading" aria-hidden />;
  }
  if (!segments.length) {
    return <div className="cpw5-macro-lens-sparkline cpw5-macro-lens-sparkline--empty" data-macro-v2-lens-sparkline="empty">불러오면 미리보기를 표시합니다.</div>;
  }
  return (
    <svg className="cpw5-macro-lens-sparkline" data-macro-v2-lens-sparkline="ready" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden>
      {segments.map((points, index) => (
        <polyline key={index} fill="none" stroke="var(--cp-accent)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" points={points} />
      ))}
    </svg>
  );
}

function buildMacroTableRows(series: readonly MarketChartSeries[]): MacroTableRow[] {
  const dates = new Set<string>();
  const pointsBySeries = new Map<string, Map<string, number | null>>();
  for (const item of series) {
    const points = new Map<string, number | null>();
    for (const point of item.points) {
      dates.add(point.label);
      points.set(point.label, point.value);
    }
    pointsBySeries.set(item.id, points);
  }
  return [...dates]
    .sort((left, right) => right.localeCompare(left))
    .map((date) => ({
      date,
      values: Object.fromEntries(series.map((item) => [item.id, pointsBySeries.get(item.id)?.get(date) ?? null])),
    }));
}

function tableSeriesHeader(
  series: MarketChartSeries,
  selected: readonly SelectedMacroSeries[],
  windowLabel: string,
) {
  if (series.formulaLabel) return `${series.formulaLabel} · 합성 · ${windowLabel}`;
  const selection = selected.find((item) => item.id === series.id);
  const definition = seriesById(series.id);
  const transform = selection?.transform ?? definition?.defaultTransform ?? "raw";
  return `${definition?.shortLabel ?? series.label} · ${MACRO_TRANSFORM_LABELS[transform]} · ${windowLabel}`;
}

function DelayedMacroTableSkeleton() {
  const show = useDelayedLoading(true, 120);
  if (!show) return null;
  return (
    <div className="cpw5-macro-table-skeleton" aria-label="변환 후 표 데이터를 준비하는 중입니다">
      <i /><i /><i />
    </div>
  );
}

type MacroChartRow = {
  id: string;
  series: MarketChartSeries[];
  yAxisTitle: string;
  y1AxisTitle?: string;
};

function buildChartRows(
  series: readonly MarketChartSeries[],
  autoGroupAxes = true,
  axisById: Record<string, MacroAxisId> = {},
): MacroChartRow[] {
  const groups = [...new Set(series.map((item) => item.unitGroup ?? "level"))];
  if (!autoGroupAxes) {
    return [{
      id: "manual-axis",
      series: [...series],
      yAxisTitle: "왼쪽 축",
      y1AxisTitle: series.some((item) => item.yAxisId === "y1") ? "오른쪽 축" : undefined,
    }];
  }
  if (groups.length <= 2) {
    return [{
      id: groups.join("-") || "empty",
      series: series.map((item) => ({
        ...item,
        yAxisId: axisById[item.id] === "right"
          ? "y1"
          : axisById[item.id] === "left"
            ? "y"
            : groups.indexOf(item.unitGroup ?? "level") === 1 ? "y1" : "y",
      })),
      yAxisTitle: transformedUnitGroupLabel(groups[0] ?? "level"),
      y1AxisTitle: groups[1] ? transformedUnitGroupLabel(groups[1]) : undefined,
    }];
  }
  return groups.map((group) => ({
    id: group,
    series: series.filter((item) => (item.unitGroup ?? "level") === group).map((item) => ({
      ...item,
      yAxisId: axisById[item.id] === "right" ? "y1" : "y",
    })),
    yAxisTitle: transformedUnitGroupLabel(group),
    y1AxisTitle: series.some((item) => (item.unitGroup ?? "level") === group && axisById[item.id] === "right")
      ? "오른쪽 축"
      : undefined,
  }));
}

function supportsLogScale(series: readonly MarketChartSeries[]) {
  const values = series.flatMap((item) => item.points.map((point) => point.value));
  return values.some((value) => typeof value === "number" && Number.isFinite(value)) &&
    values.every((value) => value === null || (typeof value === "number" && value > 0));
}

function finiteRange(series: MarketChartSeries) {
  const values = series.points.flatMap((point) => typeof point.value === "number" && Number.isFinite(point.value) ? [point.value] : []);
  return values.length ? { min: Math.min(...values), max: Math.max(...values) } : null;
}

function rangeLabel(rangeId: string) {
  return MACRO_RANGES.find((range) => range.id === rangeId)?.label ?? rangeId;
}

function latestFiniteLabel(series: readonly MarketChartSeries[], hiddenIds: readonly string[]) {
  const hidden = new Set(hiddenIds);
  let latest: string | null = null;
  for (const item of series) {
    if (hidden.has(item.id)) continue;
    for (const point of item.points) {
      if (typeof point.value !== "number" || !Number.isFinite(point.value)) continue;
      if (latest === null || point.label > latest) latest = point.label;
    }
  }
  return latest;
}

function latestFinitePoint(series: MarketChartSeries) {
  for (let index = series.points.length - 1; index >= 0; index -= 1) {
    const point = series.points[index];
    if (typeof point?.value === "number" && Number.isFinite(point.value)) return point;
  }
  return null;
}

function firstFinitePoint(series: MarketChartSeries) {
  return series.points.find((point) => typeof point.value === "number" && Number.isFinite(point.value)) ?? null;
}

function seriesDelta(series: MarketChartSeries) {
  const first = firstFinitePoint(series);
  const latest = latestFinitePoint(series);
  if (!first || !latest || typeof first.value !== "number" || typeof latest.value !== "number") return null;
  const firstValue = first.value;
  const latestValue = latest.value;
  return {
    first,
    latest,
    firstValue,
    latestValue,
    delta: latestValue - firstValue,
  };
}

function deltaTone(delta: number | null | undefined): "positive" | "negative" | "warning" | "neutral" {
  if (delta == null || Math.abs(delta) < 0.01) return "neutral";
  return delta > 0 ? "positive" : "negative";
}

function movementPhrase(delta: number | null | undefined) {
  if (delta == null || Math.abs(delta) < 0.01) return "거의 움직이지 않았습니다";
  return delta > 0 ? "올랐습니다" : "내렸습니다";
}

function movementLead(delta: number | null | undefined, hasSecondary: boolean) {
  if (!hasSecondary) return movementPhrase(delta);
  if (delta == null || Math.abs(delta) < 0.01) return "거의 움직이지 않았고";
  return delta > 0 ? "올랐고" : "내렸고";
}

function movementConnector(delta: number | null | undefined) {
  if (delta == null || Math.abs(delta) < 0.01) return "횡보했습니다";
  return delta > 0 ? "올랐습니다" : "내렸습니다";
}

function verdictSeriesName(series: MarketChartSeries) {
  const definition = seriesById(series.id);
  if (!definition) return series.label.split("·")[0]?.trim() || series.label;
  if (definition.id === "sp500") return "S&P 500 지수";
  if (definition.id === "nasdaq") return "나스닥 지수";
  if (definition.id === "DGS10") return "미 10년물 금리";
  if (definition.id === "HY_spread") return "하이일드 스프레드";
  if (definition.id === "M2SL") return "M2 유동성";
  if (definition.group === "equity") return `${definition.shortLabel} 지수`;
  return definition.description || definition.label || definition.shortLabel;
}

function verdictValue(series: MarketChartSeries, value: number) {
  const definition = seriesById(series.id);
  const formatted = formatValue(value);
  if (definition?.unit === "percent" || definition?.unit === "spread" || series.label.includes("%")) {
    return `${formatted}%`;
  }
  return formatted;
}

function verdictRelationshipLabel(primaryDelta: number, secondaryDelta: number | null | undefined, context: MacroWorkbenchContext) {
  if (secondaryDelta == null || Math.abs(secondaryDelta) < 0.01) return `${context.label} 흐름은 보조 지표 확인이 더 필요합니다.`;
  if (Math.abs(primaryDelta) < 0.01) return `${context.label} 흐름은 아직 방향성이 약합니다.`;
  return primaryDelta * secondaryDelta > 0
    ? `${context.label} 흐름은 같은 방향입니다.`
    : `${context.label} 흐름은 엇갈린 방향입니다.`;
}

function signedPercent(value: number) {
  return `${value > 0 ? "+" : ""}${formatValue(value)}%`;
}

function verdictLeadValue(
  series: MarketChartSeries,
  delta: NonNullable<ReturnType<typeof seriesDelta>>,
  transform: MacroValueTransform | undefined,
  hasSecondary: boolean,
) {
  if (transform === "rebase100") {
    return `기준 100 대비 ${signedPercent(delta.delta)}${hasSecondary ? "이고" : "입니다"}`;
  }
  return `${verdictValue(series, delta.latestValue)}로 ${movementLead(delta.delta, hasSecondary)}`;
}

function verdictSecondaryValue(
  series: MarketChartSeries,
  delta: NonNullable<ReturnType<typeof seriesDelta>>,
  transform: MacroValueTransform | undefined,
) {
  if (transform === "rebase100") return `기준 100 대비 ${signedPercent(delta.delta)}입니다`;
  return `${verdictValue(series, delta.latestValue)}로 ${movementConnector(delta.delta)}`;
}

function macroVerdictText(params: {
  context: MacroWorkbenchContext;
  visibleSeries: readonly MarketChartSeries[];
  selected: readonly SelectedMacroSeries[];
  rangeId: string;
  latestVisibleDate: string | null;
}) {
  const [primary, secondary] = params.visibleSeries;
  const primaryDelta = primary ? seriesDelta(primary) : null;
  const secondaryDelta = secondary ? seriesDelta(secondary) : null;
  const latestLabel = formatAsOf(params.latestVisibleDate) ?? "기준일 확인 중";

  if (!primary || !primaryDelta) {
    return {
      tone: "warning" as const,
      lead: `${params.context.shortLabel} 렌즈의 시리즈를 불러오는 중입니다.`,
      detail: `${latestLabel} · 기간 ${rangeLabel(params.rangeId)} · 선택한 지표가 준비되면 최신값과 방향을 계산합니다.`,
      primaryValue: "—",
      secondaryValue: "—",
    };
  }

  const tone = deltaTone(primaryDelta.delta);
  const primaryName = verdictSeriesName(primary);
  const primaryValue = verdictValue(primary, primaryDelta.latestValue);
  const relationship = verdictRelationshipLabel(primaryDelta.delta, secondaryDelta?.delta, params.context);
  const primaryTransform = params.selected.find((item) => item.id === primary.id)?.transform;
  const secondaryTransform = secondary ? params.selected.find((item) => item.id === secondary.id)?.transform : undefined;
  const secondaryClause = secondary && secondaryDelta
    ? `, ${verdictSeriesName(secondary)}는 ${verdictSecondaryValue(secondary, secondaryDelta, secondaryTransform)}`
    : "";

  return {
    tone,
    lead: `${primaryName}는 ${verdictLeadValue(primary, primaryDelta, primaryTransform, Boolean(secondary && secondaryDelta))}${secondaryClause} — ${relationship}`,
    detail: `${latestLabel} · ${rangeLabel(params.rangeId)} 구간의 실제 로드 시리즈에서 계산했습니다.`,
    primaryValue: `${primaryName} ${primaryValue}`,
    secondaryValue: secondary && secondaryDelta ? `${verdictSeriesName(secondary)} ${verdictValue(secondary, secondaryDelta.latestValue)}` : "보조 시리즈 없음",
  };
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
          ? "border-[var(--c-brand)] bg-[var(--c-brand)] text-white"
          : "border-slate-200 bg-white text-slate-700 hover:border-brand-interactive",
      )}
    >
      <span className="min-w-0">
        <span className="block truncate text-xs font-black">{item.shortLabel}</span>
        <span className={cx("block truncate text-[10px] font-semibold", active ? "text-white" : "text-slate-600")}>
          {definitionMetaLabel(item)}
        </span>
      </span>
      <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black", active ? "bg-white text-[var(--c-brand)]" : "bg-slate-100 text-slate-700")}>
        {active ? "선택" : "추가"}
      </span>
    </button>
  );
}

function DelayedMacroChartSkeleton() {
  const show = useDelayedLoading(true, 120);
  if (!show) return null;
  return (
    <div className="cpw5-macro-chart-skeleton" aria-label="차트 데이터를 불러오는 중입니다">
      <span className="sr-only">차트 데이터를 불러오는 중입니다.</span>
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}

export default function MacroChartClient({ initialMode = "macro" }: { initialMode?: MacroChartInitialMode }) {
  const stockCompareMode = initialMode === "stock-compare";
  const headerEyebrow = stockCompareMode ? "Multi Chart" : "Macro Chart";
  const headerTitle = stockCompareMode ? "시장 비교" : "매크로 차트";
  const headerDescription = stockCompareMode
    ? "주식, ETF, 지수, 매크로 시리즈를 같은 시간축으로 맞춰 수익률·가격·상대강도를 비교합니다."
    : "지수, 유동성, 금리, 신용, 심리, 경기지표와 시장 심볼을 같은 시간축으로 맞춰 비교합니다.";
  const [{
    selected: initialSelected,
    rangeId: initialRangeId,
    hiddenIds: initialHiddenIds,
    axisById: initialAxisById,
    formulas: initialFormulas,
    macroContextId: initialMacroContextId,
  }] = useState(() => defaultChartState(initialMode));
  const [selected, setSelected] = useState<SelectedMacroSeries[]>(initialSelected);
  const [rangeId, setRangeId] = useState(initialRangeId);
  const [hiddenIds, setHiddenIds] = useState<string[]>(initialHiddenIds);
  const [axisById, setAxisById] = useState<Record<string, MacroAxisId>>(initialAxisById);
  const [formulas, setFormulas] = useState<MacroFormulaSeries[]>(initialFormulas);
  const [macroContextId, setMacroContextId] = useState<MacroContextId>(initialMacroContextId);
  const [formulaLeftId, setFormulaLeftId] = useState(initialSelected[0]?.id ?? "");
  const [formulaRightId, setFormulaRightId] = useState(initialSelected[1]?.id ?? "");
  const [formulaOperator, setFormulaOperator] = useState<MacroFormulaOperator>("subtract");
  const [formulaScalar, setFormulaScalar] = useState("1");
  const [formulaNotice, setFormulaNotice] = useState<string | null>(null);
  const [userPresets, setUserPresets] = useState<UserMacroPreset[]>([]);
  const [collectionStorageMode, setCollectionStorageMode] = useState<"local" | "session">("local");
  const [renamingPresetId, setRenamingPresetId] = useState<string | null>(null);
  const [renamePresetDraft, setRenamePresetDraft] = useState("");
  const [clientStateReady, setClientStateReady] = useState(false);
  const [presetName, setPresetName] = useState("나의 매크로 뷰");
  const [presetNotice, setPresetNotice] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [stooqTickerInput, setStooqTickerInput] = useState("");
  const [stooqTickerNotice, setStooqTickerNotice] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const [loadRetryKey, setLoadRetryKey] = useState(0);
  const [seriesEditorOpen, setSeriesEditorOpen] = useState(stockCompareMode);
  const [limitNotice, setLimitNotice] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeTopLensId, setActiveTopLensId] = useState("risk-liquidity");
  const [editingSeriesId, setEditingSeriesId] = useState<string | null>(null);
  const [logScale, setLogScale] = useState(false);
  const [autoGroupAxes, setAutoGroupAxes] = useState(true);
  const [tableOpen, setTableOpen] = useState(false);

  const selectedDefinitions = useMemo(
    () => selected.map((item) => seriesById(item.id)).filter((item): item is MacroSeriesDefinition => Boolean(item)),
    [selected],
  );
  const transformMap = useMemo(() => selectedTransformMap(selected), [selected]);
  const viewOptions = useMemo(() => selectedViewOptions(selected), [selected]);
  const selectedIds = useMemo(() => new Set(selected.map((item) => item.id)), [selected]);
  const formulaIds = useMemo(() => new Set(formulas.map((formula) => formula.id)), [formulas]);
  const chartSeriesIds = useMemo(
    () => new Set([...selectedIds, ...formulaIds]),
    [formulaIds, selectedIds],
  );
  const visibleHiddenIds = useMemo(
    () => hiddenIds.filter((id) => chartSeriesIds.has(id)),
    [chartSeriesIds, hiddenIds],
  );
  const visibleAxisOverrides = useMemo(
    () => Object.entries(axisById).filter(([id, axis]) => selectedIds.has(id) && axis !== "auto").length,
    [axisById, selectedIds],
  );
  const rightAxisTitle = useMemo(
    () => explicitRightAxisTitle(selectedDefinitions, axisById),
    [axisById, selectedDefinitions],
  );
  const currentFormulaLeftId = selectedIds.has(formulaLeftId) ? formulaLeftId : selected[0]?.id ?? "";
  const currentFormulaRightId =
    selectedIds.has(formulaRightId) && formulaRightId !== currentFormulaLeftId
      ? formulaRightId
      : selected.find((item) => item.id !== currentFormulaLeftId)?.id ?? "";

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextState = initialChartStateFromUrl(defaultChartState(initialMode));
      setSelected(nextState.selected);
      setRangeId(nextState.rangeId);
      setHiddenIds(nextState.hiddenIds);
      setAxisById(nextState.axisById);
      setFormulas(nextState.formulas);
      setMacroContextId(nextState.macroContextId);
      setFormulaLeftId(nextState.selected[0]?.id ?? "");
      setFormulaRightId(nextState.selected[1]?.id ?? "");
      const params = new URLSearchParams(window.location.search);
      setLogScale(params.get("log") === "1");
      setAutoGroupAxes(params.get("axes") !== "manual");
      const storedPresets = safeReadUserPresets();
      setUserPresets(storedPresets.presets);
      setCollectionStorageMode(storedPresets.persistent ? "local" : "session");
      setClientStateReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialMode]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(queryInput), 180);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  useEffect(() => {
    if (!clientStateReady || !selectedDefinitions.length) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setLoadState({ status: "loading" });
    });
    const selectedRange = MACRO_RANGES.find((range) => range.id === rangeId);
    loadMacroSeries(selectedDefinitions, transformMap, { months: selectedRange?.months }, viewOptions)
      .then((loaded) => {
        if (cancelled) return;
        const series = buildMarketSeries(loaded, { alignDates: false, preserveCadenceGaps: true });
        if (!series.length && loaded.some((item) => item.error)) {
          setLoadState({ status: "error", message: "선택한 시리즈를 모두 불러오지 못했습니다." });
          return;
        }
        setLoadState({ status: "ready", series, loaded });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // Technical detail stays in the console; users get the honest Korean label (H-2).
        console.error("[macro-chart] series load failed", error);
        setLoadState({ status: "error", message: "거시 지표 데이터 오류" });
      });
    return () => {
      cancelled = true;
    };
  }, [clientStateReady, loadRetryKey, rangeId, selectedDefinitions, transformMap, viewOptions]);

  useEffect(() => {
    if (!clientStateReady || typeof window === "undefined") return;
    const params = new URLSearchParams();
    params.set("macro", macroContextId);
    params.set("series", selected.map((item) => item.id).join(","));
    params.set("transform", selected.map((item) => serializeTransform(item.transform ?? seriesById(item.id)?.defaultTransform ?? "raw")).join(","));
    params.set("transformVersion", "2");
    params.set("frequency", selected.map((item) => item.frequency ?? seriesById(item.id)?.frequency ?? "daily").join(","));
    params.set("aggregation", selected.map((item) => item.aggregation ?? "average").join(","));
    if (selected.some((item) => item.color)) params.set("color", selected.map((item) => item.color ?? "").join(","));
    params.set("range", rangeId);
    if (visibleHiddenIds.length) params.set("hidden", visibleHiddenIds.join(","));
    const axis = axisParam(selected, axisById);
    if (axis) params.set("axis", axis);
    const formula = formulaParam(formulas);
    if (formula) params.set("formula", formula);
    if (logScale) params.set("log", "1");
    if (!autoGroupAxes) params.set("axes", "manual");
    const next = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, "", next);
  }, [autoGroupAxes, axisById, clientStateReady, formulas, logScale, macroContextId, rangeId, selected, visibleHiddenIds]);

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
  const typeaheadCatalog = useMemo(() => {
    if (query.trim()) return filteredCatalog.slice(0, 8);
    const popularIds = ["sp500", "DGS10", "HY_spread", "M2SL"];
    const relatedGroups = new Set(selectedDefinitions.map((item) => item.group));
    const popular = popularIds.map((id) => seriesById(id)).filter((item): item is MacroSeriesDefinition => Boolean(item));
    const related = MACRO_SERIES_CATALOG.filter(
      (item) => relatedGroups.has(item.group) && !popularIds.includes(item.id) && !selectedIds.has(item.id),
    ).slice(0, 4);
    return [...popular, ...related];
  }, [filteredCatalog, query, selectedDefinitions, selectedIds]);

  const applyChartState = useCallback((state: InitialChartState) => {
    const nextSelected = cloneSelection(state.selected).slice(0, MAX_SELECTED_SERIES);
    const nextSelectedIds = new Set(nextSelected.map((item) => item.id));
    const nextFormulas = state.formulas.filter((formula) =>
      nextSelectedIds.has(formula.leftId) &&
      (formula.operator === "scale" || Boolean(formula.rightId && nextSelectedIds.has(formula.rightId))),
    );
    const nextChartIds = new Set([...nextSelectedIds, ...nextFormulas.map((formula) => formula.id)]);
    setSelected(nextSelected);
    setRangeId(MACRO_RANGE_IDS.has(state.rangeId) ? state.rangeId : DEFAULT_RANGE_ID);
    setHiddenIds([...new Set(state.hiddenIds)].filter((id) => nextChartIds.has(id)));
    setAxisById(
      Object.fromEntries(
        Object.entries(state.axisById).filter(([id, axis]) => nextSelectedIds.has(id) && axis !== "auto"),
      ),
    );
    setFormulas(nextFormulas);
    setMacroContextId(state.macroContextId);
    setLimitNotice(null);
    setPresetNotice(null);
    setFormulaNotice(null);
    setExportNotice(null);
    setStooqTickerNotice(null);
  }, []);

  const toggleSeries = useCallback((id: string) => {
    setActiveTopLensId("custom");
    if (selected.some((item) => item.id === id)) {
      setSelected((prev) => prev.filter((item) => item.id !== id));
      setHiddenIds((prev) => prev.filter((hiddenId) => hiddenId !== id));
      setAxisById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setFormulas((prev) => prev.filter((formula) => formula.leftId !== id && formula.rightId !== id));
      setLimitNotice(null);
      return;
    }
    const definition = seriesById(id);
    if (!definition) return;
    if (selected.length >= MAX_SELECTED_SERIES) {
      setLimitNotice(`비교 시리즈는 최대 ${MAX_SELECTED_SERIES}개까지 선택할 수 있습니다.`);
      return;
    }
    setSelected((prev) => [...prev, withSeriesDefaults({ id, transform: definition.defaultTransform ?? "raw" })]);
    setLimitNotice(null);
  }, [selected]);

  const addStooqSeries = useCallback(() => {
    setActiveTopLensId("custom");
    const id = stooqSeriesIdFromInput(stooqTickerInput);
    if (!id) {
      setStooqTickerNotice("심볼 형식을 확인하세요. 예: NVDA, SPY.US, 005930.KS");
      return;
    }
    if (selected.some((item) => item.id === id)) {
      setStooqTickerNotice("이미 선택한 시장 심볼입니다.");
      return;
    }
    const definition = seriesById(id);
    if (!definition) {
      setStooqTickerNotice("시장 심볼을 만들지 못했습니다.");
      return;
    }
    if (selected.length >= MAX_SELECTED_SERIES) {
      setLimitNotice(`비교 시리즈는 최대 ${MAX_SELECTED_SERIES}개까지 선택할 수 있습니다.`);
      setStooqTickerNotice(null);
      return;
    }
    setSelected((prev) => [...prev, withSeriesDefaults({ id, transform: definition.defaultTransform ?? "raw" })]);
    setStooqTickerInput("");
    setStooqTickerNotice(`${definition.shortLabel} 추가됨`);
    setLimitNotice(null);
  }, [selected, stooqTickerInput]);

  const setTransform = useCallback((id: string, transform: MacroValueTransform) => {
    setSelected((prev) => prev.map((item) => (item.id === id ? { ...item, transform } : item)));
  }, []);

  const setFrequency = useCallback((id: string, frequency: MacroOutputFrequency) => {
    setSelected((prev) => prev.map((item) => (item.id === id ? { ...item, frequency } : item)));
  }, []);

  const setAggregation = useCallback((id: string, aggregation: MacroAggregation) => {
    setSelected((prev) => prev.map((item) => (item.id === id ? { ...item, aggregation } : item)));
  }, []);

  const setSeriesColor = useCallback((id: string, color: string) => {
    setSelected((prev) => prev.map((item) => (item.id === id ? { ...item, color } : item)));
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
        formulas: [],
        macroContextId: macroContextIdForPreset(preset.id),
      });
    }
  }, [applyChartState, rangeId]);

  const applyUserPreset = useCallback((preset: UserMacroPreset) => {
    applyChartState({
      selected: cloneSelection(preset.selected),
      rangeId: preset.rangeId,
      hiddenIds: preset.hiddenIds,
      axisById: preset.axisById,
      formulas: preset.formulas,
      macroContextId: preset.macroContextId ?? macroContextId,
    });
    setPresetName(preset.name);
    window.setTimeout(() => document.querySelector('[data-macro-chart-hero="true"]')?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }, [applyChartState, macroContextId]);

  const applyAnalysisLens = useCallback((lens: MacroAnalysisLens) => {
    applyChartState({ ...lens.state, macroContextId: macroContextFromParam(lens.id)?.id ?? DEFAULT_MACRO_CONTEXT_ID });
    setPresetName(`${lens.label.replace(" 렌즈", "")} 뷰`);
    window.setTimeout(() => document.querySelector('[data-macro-chart-hero="true"]')?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }, [applyChartState]);

  const applyTopLens = useCallback((lens: (typeof MACRO_TOP_LENSES)[number]) => {
    setActiveTopLensId(lens.id);
    if ("unavailable" in lens) {
      setLimitNotice(lens.unavailable);
      return;
    }
    if ("collection" in lens) {
      setSeriesEditorOpen(true);
      window.setTimeout(() => document.querySelector('[data-macro-chart-collections="true"]')?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
      return;
    }
    if ("state" in lens) {
      applyChartState({
        selected: cloneSelection(lens.state.selected),
        rangeId: lens.state.rangeId,
        hiddenIds: [],
        axisById: lens.state.axisById,
        formulas: [],
        macroContextId: lens.state.macroContextId,
      });
      setPresetName(`${lens.label} 뷰`);
    }
  }, [applyChartState]);

  const copyShareLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setExportNotice("공유 링크가 복사되었습니다.");
    } catch {
      setExportNotice("링크 복사를 지원하지 않는 브라우저입니다.");
    }
  }, []);

  const applyMarketCompareLens = useCallback((lens: MarketCompareLens) => {
    applyChartState(lens.state);
    setPresetName(`${lens.label} 뷰`);
    setSeriesEditorOpen(true);
  }, [applyChartState]);

  const applyFormulaPreset = useCallback((preset: MacroFormulaPreset) => {
    const presetFormulaId = formulaId(preset.leftId, preset.operator, preset.rightId);
    if (formulas.length >= MAX_FORMULA_SERIES && !formulas.some((formula) => formula.id === presetFormulaId)) {
      setFormulaNotice(`합성 시리즈는 최대 ${MAX_FORMULA_SERIES}개까지 추가할 수 있습니다.`);
      return;
    }
    const missingIds = [preset.leftId, preset.rightId].filter((id) => !selected.some((item) => item.id === id));
    if (selected.length + missingIds.length > MAX_SELECTED_SERIES) {
      setFormulaNotice(`프리셋 적용에는 ${missingIds.length}개 시리즈 자리가 더 필요합니다.`);
      return;
    }
    const nextFormula: MacroFormulaSeries = {
      id: presetFormulaId,
      leftId: preset.leftId,
      rightId: preset.rightId,
      operator: preset.operator,
    };
    setSelected((previous) => [
      ...previous,
      ...missingIds.map((id) => withSeriesDefaults({ id, transform: seriesById(id)?.defaultTransform ?? "raw" })),
    ]);
    setFormulas((previous) => previous.some((formula) => formula.id === nextFormula.id)
      ? previous
      : [...previous, nextFormula].slice(0, MAX_FORMULA_SERIES));
    setFormulaNotice(`${preset.label} 합성식 추가됨`);
  }, [formulas, selected]);

  const addFormula = useCallback(() => {
    const nextFormulaScalar = Number(formulaScalar);
    if (!currentFormulaLeftId) {
      setFormulaNotice("시리즈를 먼저 선택하세요.");
      return;
    }
    if (formulaOperator !== "scale" && (!currentFormulaRightId || currentFormulaLeftId === currentFormulaRightId)) {
      setFormulaNotice("서로 다른 시리즈 2개를 선택하세요.");
      return;
    }
    if (formulaOperator === "scale" && (!Number.isFinite(nextFormulaScalar) || nextFormulaScalar === 0)) {
      setFormulaNotice("k에는 0이 아닌 숫자를 입력하세요.");
      return;
    }
    if (formulas.length >= MAX_FORMULA_SERIES) {
      setFormulaNotice(`합성 시리즈는 최대 ${MAX_FORMULA_SERIES}개까지 추가할 수 있습니다.`);
      return;
    }
    const nextFormula: MacroFormulaSeries = {
      id: formulaId(currentFormulaLeftId, formulaOperator, formulaOperator === "scale" ? nextFormulaScalar : currentFormulaRightId),
      leftId: currentFormulaLeftId,
      rightId: formulaOperator === "scale" ? undefined : currentFormulaRightId,
      scalar: formulaOperator === "scale" ? nextFormulaScalar : undefined,
      operator: formulaOperator,
    };
    if (formulas.some((formula) => formula.id === nextFormula.id)) {
      setFormulaNotice("이미 추가한 합성식입니다.");
      return;
    }
    setFormulas((prev) => [...prev, nextFormula]);
    setFormulaNotice("합성 시리즈 추가됨");
  }, [currentFormulaLeftId, currentFormulaRightId, formulaOperator, formulaScalar, formulas]);

  const removeFormula = useCallback((formulaIdToRemove: string) => {
    setFormulas((prev) => prev.filter((formula) => formula.id !== formulaIdToRemove));
    setHiddenIds((prev) => prev.filter((id) => id !== formulaIdToRemove));
    setFormulaNotice("합성 시리즈 삭제됨");
  }, []);

  const commitUserPresetList = useCallback((next: UserMacroPreset[], successMessage: string) => {
    const persistent = writeUserPresets(next);
    setUserPresets(next);
    setCollectionStorageMode(persistent ? "local" : "session");
    setPresetNotice(persistent ? successMessage : `${successMessage} · 이 브라우저 세션에만 저장됨`);
  }, []);

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
      formulas,
      macroContextId,
      updatedAt: new Date().toISOString(),
    };
    const next = [nextPreset, ...userPresets.filter((preset) => preset.name !== name)].slice(0, 8);
    commitUserPresetList(next, "컬렉션 저장됨");
  }, [axisById, commitUserPresetList, formulas, macroContextId, presetName, rangeId, selected, userPresets, visibleHiddenIds]);

  const deleteUserPreset = useCallback((presetId: string) => {
    const next = userPresets.filter((preset) => preset.id !== presetId);
    commitUserPresetList(next, "컬렉션에서 삭제됨");
    if (renamingPresetId === presetId) {
      setRenamingPresetId(null);
      setRenamePresetDraft("");
    }
  }, [commitUserPresetList, renamingPresetId, userPresets]);

  const startRenameUserPreset = useCallback((preset: UserMacroPreset) => {
    setRenamingPresetId(preset.id);
    setRenamePresetDraft(preset.name);
    setPresetNotice(null);
  }, []);

  const renameUserPreset = useCallback((presetId: string) => {
    const name = renamePresetDraft.trim().slice(0, 32);
    if (!name) {
      setPresetNotice("새 컬렉션 이름을 입력하세요.");
      return;
    }
    if (userPresets.some((preset) => preset.id !== presetId && preset.name === name)) {
      setPresetNotice("같은 이름의 컬렉션이 이미 있습니다.");
      return;
    }
    const next = userPresets.map((preset) => preset.id === presetId
      ? { ...preset, name, updatedAt: new Date().toISOString() }
      : preset);
    commitUserPresetList(next, "컬렉션 이름 변경됨");
    setRenamingPresetId(null);
    setRenamePresetDraft("");
  }, [commitUserPresetList, renamePresetDraft, userPresets]);

  const activeLoadState = useMemo<LoadState>(
    () => (selectedDefinitions.length ? loadState : { status: "ready", series: [], loaded: [] }),
    [loadState, selectedDefinitions.length],
  );
  const ready = activeLoadState.status === "ready";
  const chartSeries = useMemo(() => {
    if (activeLoadState.status !== "ready") return [];
    const baseSeries = applyAxisOverrides(applySeriesColors(activeLoadState.series, selected), axisById);
    return [...baseSeries, ...buildFormulaSeries(baseSeries, formulas)];
  }, [activeLoadState, axisById, formulas, selected]);
  const chartRows = useMemo(() => buildChartRows(chartSeries, autoGroupAxes, axisById), [autoGroupAxes, axisById, chartSeries]);
  const canUseLogScale = useMemo(() => supportsLogScale(chartSeries), [chartSeries]);
  useEffect(() => {
    if (logScale && !canUseLogScale) setLogScale(false);
  }, [canUseLogScale, logScale]);
  const failedLoadedSeries = useMemo(
    () => activeLoadState.status === "ready" ? activeLoadState.loaded.filter((item) => item.error || !item.transformedPoints.length) : [],
    [activeLoadState],
  );
  const healthyLoadedSeries = useMemo(
    () => activeLoadState.status === "ready" ? activeLoadState.loaded.filter((item) => !item.error && item.transformedPoints.length) : [],
    [activeLoadState],
  );
  const evidenceFreshness = activeLoadState.status === "loading" || activeLoadState.status === "idle"
    ? "pending"
    : activeLoadState.status === "error"
      ? "error"
      : failedLoadedSeries.length
        ? "partial"
        : chartSeries.length
          ? "fresh"
          : "stale";
  const selectedSourceCount = useMemo(
    () => new Set(selectedDefinitions.map((definition) => definition.sourcePath)).size,
    [selectedDefinitions],
  );
  const hasStooqSelection = useMemo(
    () => selectedDefinitions.some((definition) => definition.sourceKind === "stooq"),
    [selectedDefinitions],
  );
  const selectedGroupKeys = useMemo(
    () => [...new Set(selectedDefinitions.map((definition) => definition.group))],
    [selectedDefinitions],
  );
  const selectedGroupLabels = useMemo(
    () => selectedGroupKeys.map((group) => MACRO_GROUP_LABELS[group]).join(" · "),
    [selectedGroupKeys],
  );
  const latestVisibleDate = useMemo(
    () => latestFiniteLabel(chartSeries, visibleHiddenIds),
    [chartSeries, visibleHiddenIds],
  );
  const visibleChartSeriesCount = Math.max(chartSeries.length - visibleHiddenIds.length, 0);
  const connectionLinks = useMemo(() => {
    const groups = new Set(selectedGroupKeys);
    const context = MACRO_CONTEXTS[macroContextId];
    const links = MACRO_CONNECTION_LINKS
      .filter((link) => link.groups.some((group) => groups.has(group)))
      .map((link) => ({ ...link, href: link.href(context) }));
    return [
      ...links,
      {
        id: "stock",
        label: `대표 종목 ${context.stockSymbol}`,
        detail: `${context.label} 렌즈를 ${context.stockLabel} 상세로 이어 본다.`,
        href: context.stockHref,
      },
    ];
  }, [macroContextId, selectedGroupKeys]);
  const activeMacroContext = MACRO_CONTEXTS[macroContextId];
  const visibleChartSeries = useMemo(
    () => chartSeries.filter((series) => !visibleHiddenIds.includes(series.id)),
    [chartSeries, visibleHiddenIds],
  );
  const macroVerdict = useMemo(
    () => macroVerdictText({ context: activeMacroContext, visibleSeries: visibleChartSeries, selected, rangeId, latestVisibleDate }),
    [activeMacroContext, latestVisibleDate, rangeId, selected, visibleChartSeries],
  );
  const freshnessState = useMemo(
    () =>
      freshnessDataState({
        asOf: latestVisibleDate ?? MACRO_CATALOG_CURATED_AT,
        readyLabel: "기준일 확인",
        readyDetail: `${activeMacroContext.label} 렌즈의 최신 표시 기준입니다.`,
        maxAgeDays: 45,
      }),
    [activeMacroContext.label, latestVisibleDate],
  );
  const analysisCards = useMemo(
    () => [
      {
        label: "최근 기준일",
        value: latestVisibleDate ?? "—",
        detail: `${visibleChartSeriesCount}개 표시 · 기간 ${rangeLabel(rangeId)}`,
      },
      {
        label: "연결 데이터",
        value: `${selectedDefinitions.length}/${MACRO_CATALOG_SERIES_COUNT}`,
        detail: `${selectedSourceCount}개 파일 · ${selectedGroupLabels || "그룹 없음"}`,
      },
      {
        label: "워크벤치",
        value: `합성 ${formulas.length}개`,
        detail: visibleHiddenIds.length
          ? `숨김 ${visibleHiddenIds.length}개 · 축 고정 ${visibleAxisOverrides}개`
          : `축 고정 ${visibleAxisOverrides}개`,
      },
    ],
    [
      formulas.length,
      latestVisibleDate,
      rangeId,
      selectedDefinitions.length,
      selectedGroupLabels,
      selectedSourceCount,
      visibleAxisOverrides,
      visibleChartSeriesCount,
      visibleHiddenIds.length,
    ],
  );
  const chartSeriesById = useMemo(() => new Map(chartSeries.map((item) => [item.id, item])), [chartSeries]);
  const legendItems = useMemo(() => selected.map((item, index) => {
    const definition = seriesById(item.id);
    const series = chartSeriesById.get(item.id);
    return {
      selection: item,
      definition,
      series,
      color: item.color ?? series?.color ?? okabeItoPalette[index % okabeItoPalette.length],
      unit: definition ? transformUnitLabel(item.transform ?? definition.defaultTransform ?? "raw", unitLabel(definition.unit)) : "—",
      latest: series ? latestFinitePoint(series)?.value ?? null : null,
      change: series ? latestStepChange(series) : null,
    };
  }), [chartSeriesById, selected]);
  const formulaLegendItems = useMemo(() => formulas.map((formula) => {
    const series = chartSeriesById.get(formula.id);
    return {
      formula,
      series,
      color: series?.color ?? okabeItoPalette[(selected.length + formulas.indexOf(formula)) % okabeItoPalette.length],
      latest: series ? latestFinitePoint(series)?.value ?? null : null,
      change: series ? latestStepChange(series) : null,
    };
  }), [chartSeriesById, formulas, selected.length]);
  const lensPreviewById = useMemo(() => new Map(MACRO_ANALYSIS_LENSES.map((lens) => {
    const previewSeries = lens.state.selected
      .map((item) => chartSeriesById.get(item.id))
      .find((item) => item && sparklineSegments(item).length > 0);
    const state: MacroSurfaceState = activeLoadState.status === "loading" || activeLoadState.status === "idle"
      ? "loading"
      : activeLoadState.status === "error"
        ? "error"
        : previewSeries
          ? evidenceFreshness === "partial" || evidenceFreshness === "stale" ? "stale" : "ready"
          : "empty";
    return [lens.id, { series: previewSeries, state }] as const;
  })), [activeLoadState.status, chartSeriesById, evidenceFreshness]);
  const collectionState: MacroSurfaceState = !clientStateReady
    ? "loading"
    : collectionStorageMode === "session"
      ? "stale"
      : userPresets.length
        ? "ready"
        : "empty";
  const tableRows = useMemo(() => buildMacroTableRows(visibleChartSeries), [visibleChartSeries]);
  const tableHeaders = useMemo(
    () => visibleChartSeries.map((series) => tableSeriesHeader(series, selected, rangeLabel(rangeId))),
    [rangeId, selected, visibleChartSeries],
  );
  const tableHeaderSummary = tableHeaders.join(" · ") || "표시 시리즈 없음";
  const tableColumns = useMemo<readonly CpDataTableColumn<MacroTableRow>[]>(() => [
    { key: "date", header: "날짜", align: "left" },
    ...visibleChartSeries.map((series, index) => ({
      key: series.id,
      header: tableHeaders[index] ?? series.label,
      render: (row: MacroTableRow) => formatValue(row.values[series.id] ?? null),
    })),
  ], [tableHeaders, visibleChartSeries]);
  const tableState: MacroSurfaceState = activeLoadState.status === "loading" || activeLoadState.status === "idle"
    ? "loading"
    : activeLoadState.status === "error"
      ? "error"
      : tableRows.length === 0
        ? "empty"
        : evidenceFreshness === "partial" || evidenceFreshness === "stale"
          ? "stale"
          : "ready";

  return (
    <div
      className="canvas-plus cpw5-macro-shell"
      data-macro-chart-workbench="true"
      data-multichart-workbench={stockCompareMode ? "true" : undefined}
      data-multichart-mode={stockCompareMode ? "stock-compare" : undefined}
    >
      <section className="cpw5-hero cpw5-macro-hero" data-macro-chart-hero="true">
        <div className="cpw5-hero__top">
          <p className="cpw5-hero__eyebrow">{headerEyebrow}</p>
          <div className="cpw5-hero__trust-row">
            <DataStateBadge state={freshnessState} className="cpw5-macro-data-badge" />
            <span className="cpw5-hero__trust-chip">
              <span className="cpw5-hero__trust-label">카탈로그</span>
              <span className="cpw5-hero__trust-value">{MACRO_CATALOG_SERIES_COUNT}개</span>
            </span>
          </div>
        </div>

        <div className="cpw5-macro-hero__copy">
          <h1 className="cpw5-macro-title">{headerTitle}</h1>
          <p className="cpw5-hero__verdict cpw5-macro-verdict" data-macro-chart-verdict="true">
            <span className="cpw5-macro-verdict__text" data-movement-tone={macroVerdict.tone}>{macroVerdict.lead}</span>
          </p>
          <p className="cpw5-hero__sub">{macroVerdict.detail}</p>
          <p className="cpw5-macro-description">{headerDescription}</p>
        </div>

        <Panel className="cpw5-macro-chart-card">
          <div className="cpw5-macro-v2-topbar" data-macro-v2-topbar="true">
            <div className="cpw5-macro-v2-search" data-macro-v2-typeahead="true">
              <label className="sr-only" htmlFor="macro-v2-series-search">시리즈 검색</label>
              <input
                id="macro-v2-series-search"
                value={queryInput}
                onFocus={() => setSearchOpen(true)}
                onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
                onChange={(event) => {
                  setQueryInput(event.target.value);
                  setSearchOpen(true);
                }}
                placeholder="시리즈 추가 · M2, 10Y, HY..."
                className="cpw5-macro-v2-search__input"
                autoComplete="off"
              />
              {searchOpen ? (
                <div className="cpw5-macro-v2-typeahead" role="listbox" aria-label="인기 · 연관 시리즈">
                  <span>인기 · 연관</span>
                  {typeaheadCatalog.map((item) => {
                    const active = selectedIds.has(item.id);
                    return (
                      <button key={item.id} type="button" role="option" aria-selected={active} onMouseDown={(event) => event.preventDefault()} onClick={() => { toggleSeries(item.id); setSearchOpen(false); }}>
                        <b>{item.shortLabel}</b>
                        <small>{MACRO_GROUP_LABELS[item.group]} · {unitLabel(item.unit)}</small>
                        <strong>{active ? "선택됨" : "+ 추가"}</strong>
                      </button>
                    );
                  })}
                  {typeaheadCatalog.length === 0 ? <p>검색 결과가 없습니다.</p> : null}
                </div>
              ) : null}
            </div>

            <div className="cpw5-macro-v2-lenses" role="group" aria-label="분석 렌즈">
              {MACRO_TOP_LENSES.map((lens) => (
                <button
                  key={lens.id}
                  type="button"
                  onClick={() => applyTopLens(lens)}
                  aria-pressed={activeTopLensId === lens.id}
                  data-unavailable={"unavailable" in lens ? "true" : undefined}
                >
                  {lens.label}
                </button>
              ))}
            </div>

            <div className="cpw5-macro-v2-global" data-macro-v2-global-controls="true" aria-label="차트 전역 설정">
              <button type="button" disabled aria-pressed="false" title="이벤트 피드 없음">침체 음영</button>
              <button type="button" disabled aria-pressed="false" title="이벤트 피드 없음">이벤트</button>
              <button type="button" disabled={!canUseLogScale} aria-pressed={logScale} onClick={() => setLogScale((value) => !value)} title={canUseLogScale ? undefined : "0 이하 값이 있어 로그 축을 사용할 수 없습니다"}>로그</button>
              <button type="button" aria-pressed={autoGroupAxes} onClick={() => setAutoGroupAxes((value) => !value)}>축 그룹 자동</button>
              <span data-macro-v2-event-state="unavailable">이벤트 피드 없음</span>
            </div>

            <div className="cpw5-macro-v2-actions">
              <div className="cpw5-macro-v2-ranges" role="group" aria-label="기간 선택">
                {MACRO_RANGES.map((range) => (
                  <button key={range.id} type="button" aria-pressed={range.id === rangeId} onClick={() => setRangeId(range.id)}>{range.label}</button>
                ))}
              </div>
              <div className="cpw5-macro-v2-export" role="group" aria-label="공유 및 내보내기">
                <button type="button" onClick={copyShareLink}>링크</button>
                <button type="button" onClick={async () => setExportNotice((await downloadChartPng()) ? "PNG 저장됨" : "차트가 준비되지 않았습니다.")} disabled={!ready || chartSeries.length === 0}>PNG</button>
                <button
                  type="button"
                  onClick={() => {
                    if (!ready) return;
                    downloadCsv(chartSeries, selected, rangeId);
                    setExportNotice(`${rangeLabel(rangeId)} 변환 CSV 저장됨`);
                  }}
                  disabled={!ready || chartSeries.length === 0}
                >CSV</button>
              </div>
            </div>
          </div>
          {exportNotice ? (
            <p className="cpw5-macro-export-note" role="status">
              {exportNotice}
            </p>
          ) : null}
          {limitNotice ? <p className="cpw5-macro-export-note" role="status">{limitNotice}</p> : null}

          {activeTopLensId === "inflation" ? (
            <div data-macro-v2-lens-empty="inflation">
              <EmptyState
                reason="인플레이션 시리즈가 카탈로그에 없습니다"
                nextRefresh="카탈로그에 CPI 계열이 연결되면 이 렌즈를 사용할 수 있습니다"
              />
            </div>
          ) : activeLoadState.status === "error" ? (
            <div className="cpw5-macro-error" role="alert">
              <p>차트 데이터를 불러오지 못했습니다.</p>
              <span>{activeLoadState.message}</span>
              <button type="button" onClick={() => setLoadRetryKey((value) => value + 1)}>
                다시 시도
              </button>
            </div>
          ) : activeLoadState.status === "loading" ? (
            <DelayedMacroChartSkeleton />
          ) : activeLoadState.status === "ready" && chartSeries.length ? (
            <div className="cpw5-macro-v2-stage">
              <div className="cpw5-macro-v2-legend" data-macro-v2-legend-overlay="true" aria-label="차트 범례와 시리즈 편집">
                {legendItems.map(({ selection, definition, series, color, unit, latest, change }) => definition ? (
                  <div key={selection.id} className="cpw5-macro-v2-legend__item">
                    <button
                      type="button"
                      className="cpw5-macro-v2-legend__chip"
                      aria-expanded={editingSeriesId === selection.id}
                      onClick={() => setEditingSeriesId((current) => current === selection.id ? null : selection.id)}
                    >
                      <i aria-hidden style={{ backgroundColor: color }} />
                      <span><b>{definition.shortLabel}</b><small>{unit}</small></span>
                      <span><strong>{formatValue(latest)}</strong><small className={change === null ? undefined : change >= 0 ? "positive" : "negative"}>{change === null ? "—" : `${change >= 0 ? "+" : ""}${formatValue(change)}`}</small></span>
                    </button>
                    {editingSeriesId === selection.id ? (
                      <div className="cpw5-macro-v2-editor" data-macro-v2-series-editor="true" role="dialog" aria-label={`${definition.shortLabel} 편집`}>
                        <div className="cpw5-macro-v2-editor__head">
                          <span><i aria-hidden style={{ backgroundColor: color }} /><b>{definition.shortLabel}</b></span>
                          <button type="button" onClick={() => setEditingSeriesId(null)} aria-label="편집 닫기">×</button>
                        </div>
                        <fieldset>
                          <legend>변환</legend>
                          <div className="cpw5-macro-v2-segments">
                            {Object.entries(MACRO_TRANSFORM_LABELS).map(([value, label]) => (
                              <button key={value} type="button" aria-pressed={(selection.transform ?? definition.defaultTransform ?? "raw") === value} onClick={() => setTransform(selection.id, value as MacroValueTransform)}>{label}</button>
                            ))}
                          </div>
                        </fieldset>
                        <fieldset>
                          <legend>빈도</legend>
                          <div className="cpw5-macro-v2-segments">
                            {(["daily", "weekly", "monthly"] as const).map((frequency) => (
                              <button key={frequency} type="button" disabled={!frequencyAvailable(definition, frequency)} aria-pressed={(selection.frequency ?? definition.frequency) === frequency} onClick={() => setFrequency(selection.id, frequency)}>{MACRO_FREQUENCY_LABELS[frequency]}</button>
                            ))}
                            {definition.frequency === "quarterly" ? <button type="button" aria-pressed={selection.frequency === "quarterly"} onClick={() => setFrequency(selection.id, "quarterly")}>분기</button> : null}
                          </div>
                          <div className="cpw5-macro-v2-aggregation" aria-label="집계">
                            <span>집계</span>
                            {(["average", "sum", "end"] as const).map((aggregation) => (
                              <button key={aggregation} type="button" aria-pressed={(selection.aggregation ?? "average") === aggregation} onClick={() => setAggregation(selection.id, aggregation)}>{MACRO_AGGREGATION_LABELS[aggregation]}</button>
                            ))}
                          </div>
                        </fieldset>
                        <fieldset>
                          <legend>축</legend>
                          <div className="cpw5-macro-v2-segments">
                            {([['auto', '자동 그룹'], ['left', '왼쪽'], ['right', '오른쪽']] as const).map(([axis, label]) => (
                              <button key={axis} type="button" aria-pressed={(axisById[selection.id] ?? "auto") === axis} onClick={() => setAxis(selection.id, axis)}>{label}</button>
                            ))}
                          </div>
                        </fieldset>
                        <fieldset>
                          <legend>색</legend>
                          <div className="cpw5-macro-v2-colors">
                            {MACRO_COLOR_OPTIONS.map((option) => (
                              <button key={option} type="button" aria-label={`색 ${option}`} aria-pressed={color === option} onClick={() => setSeriesColor(selection.id, option)} style={{ backgroundColor: option }} />
                            ))}
                          </div>
                        </fieldset>
                        <button type="button" className="cpw5-macro-v2-remove" onClick={() => { toggleSeries(selection.id); setEditingSeriesId(null); }}>제거</button>
                        {!series ? <p>이 시리즈는 현재 관측값을 불러오지 못했습니다.</p> : null}
                      </div>
                    ) : null}
                  </div>
                ) : null)}
                {formulaLegendItems.map(({ formula, series, color, latest, change }) => (
                  <div key={formula.id} className="cpw5-macro-v2-legend__item" data-macro-v2-derived-legend={formula.operator}>
                    <div className="cpw5-macro-v2-legend__chip">
                      <i aria-hidden style={{ backgroundColor: color }} />
                      <span>
                        <b>{formulaLabel(formula)}</b>
                        <small>{series?.unitLabel ?? "합성값"} · {series?.yAxisId === "y1" ? "오른쪽 축" : "왼쪽 축"}</small>
                      </span>
                      <span>
                        <strong>{formatValue(latest)}</strong>
                        <small className={change === null ? undefined : change >= 0 ? "positive" : "negative"}>{change === null ? "—" : `${change >= 0 ? "+" : ""}${formatValue(change)}`}</small>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="cpw5-macro-chart-rows" data-macro-chart-row-count={chartRows.length}>
              {chartRows.map((row, rowIndex) => (
                <div key={row.id} data-macro-chart-unit-group={row.id}>
                  <MarketChartFrame
                    ariaLabel={`매크로 시계열 비교 차트 ${rowIndex + 1}`}
                    series={row.series}
                    ranges={MACRO_RANGES}
                    defaultRangeId={DEFAULT_RANGE_ID}
                    rangeId={rangeId}
                    showRangeControls={false}
                    showLegend={false}
                    togglableSeries={false}
                    hiddenSeriesIds={visibleHiddenIds}
                    onRangeChange={setRangeId}
                    onHiddenSeriesChange={(nextHiddenIds) => {
                      const rowIds = new Set(row.series.map((item) => item.id));
                      setHiddenIds((previous) => [
                        ...previous.filter((id) => !rowIds.has(id)),
                        ...nextHiddenIds,
                      ].filter((id, index, all) => all.indexOf(id) === index && chartSeriesIds.has(id)));
                    }}
                    sortLabels
                    spanGaps={false}
                    xScaleMode="time"
                    seriesAreRangeFiltered
                    heightClassName="cpw5-macro-v2-plot"
                    yAxisTitle={row.yAxisTitle}
                    y1AxisTitle={row.y1AxisTitle ?? rightAxisTitle}
                    logScale={logScale}
                    formatValue={formatValue}
                    footnote={sourceSummary(selectedDefinitions)}
                    bare
                  />
                  {row.series.map((item) => {
                    const range = finiteRange(item);
                    return range ? (
                      <output
                        key={item.id}
                        className="sr-only"
                        data-macro-chart-series-range={item.id}
                        data-unit-group={item.unitGroup}
                        data-axis={item.yAxisId ?? "y"}
                        data-min={range.min}
                        data-max={range.max}
                        data-first={item.points.find((point) => typeof point.value === "number")?.value}
                      >{`${item.id}: ${range.min}..${range.max}`}</output>
                    ) : null;
                  })}
                </div>
              ))}
              <div className="cpw5-macro-series-evidence" aria-label="시리즈별 데이터 근거">
                {activeLoadState.loaded.map((item) => (
                  <span key={item.definition.id} data-series-load-state={item.error ? "failed" : "ready"}>
                    {item.definition.shortLabel} · {sourceDisplayLabel(item.definition)} · {item.error ? "불러오기 실패" : item.transformedPoints.at(-1)?.date ?? "관측 없음"}
                  </span>
                ))}
              </div>
              </div>
            </div>
          ) : (
            <EmptyState
              reason="비교할 시리즈가 없습니다"
              nextRefresh="카탈로그에서 시리즈를 선택하면 차트가 표시됩니다"
            />
          )}
          <EvidenceRail
            freshness={evidenceFreshness}
            source={[...new Set(healthyLoadedSeries.map((item) => sourceDisplayLabel(item.definition)))].join(" · ") || "데이터 확인 중"}
            asOf={latestVisibleDate ?? "—"}
            coverage={`카탈로그 ${healthyLoadedSeries.length}/${MACRO_CATALOG_SERIES_COUNT}`}
            next={failedLoadedSeries.length ? `${failedLoadedSeries.map((item) => item.definition.shortLabel).join(", ")} 재시도` : undefined}
            onRetry={activeLoadState.status === "error" || failedLoadedSeries.length ? () => setLoadRetryKey((value) => value + 1) : undefined}
          />
        </Panel>

        <div className="cpw5-tile-row cpw5-macro-metrics" aria-label="매크로 분석 요약">
          {analysisCards.map((card) => (
            <article key={card.label} className="cpw5-tile cpw5-macro-evidence-tile" data-macro-v2-tile-evidence="analysis">
              <div className="cpw5-macro-evidence-tile__body">
                <p className="cpw5-tile__label">{card.label}</p>
                <p className="cpw5-tile__value">{card.value}</p>
                <p className="cpw5-tile__sub">{card.detail}</p>
              </div>
              <EvidenceRail
                freshness={evidenceFreshness}
                source="현재 차트"
                asOf={latestVisibleDate ?? "—"}
                coverage={card.label}
              />
            </article>
          ))}
        </div>
      </section>

      <section className="cpw5-macro-lens-section" aria-label="같이 보기" data-macro-v2-lens-collection="true">
        <div className="cpw5-macro-section-head">
          <div>
            <h2>같이 보기</h2>
            <p>저장된 차트 조합을 미리 보고 영웅 차트로 불러옵니다.</p>
          </div>
          <button type="button" className="cpw5-macro-section-action" onClick={saveUserPreset} data-macro-v2-collection-save="hero">
            + 현재 차트 저장
          </button>
        </div>
        <div className="cpw5-macro-lens-row">
          {MACRO_ANALYSIS_LENSES.map((lens) => {
            const preview = lensPreviewById.get(lens.id);
            return (
              <article
                key={lens.id}
                className="cpw5-macro-lens-card cpw5-macro-evidence-tile"
                data-macro-v2-tile-evidence="lens"
                data-macro-v2-lens-preview-state={preview?.state ?? "empty"}
              >
                <button
                  type="button"
                  onClick={() => applyAnalysisLens(lens)}
                  className="cpw5-macro-lens-card__action"
                  data-macro-chart-lens={lens.id}
                >
                  <strong>{lens.label}</strong>
                  <LensSparkline series={preview?.series} state={preview?.state ?? "empty"} />
                  <span>{lens.detail}</span>
                </button>
                <EvidenceRail
                  freshness={preview?.state === "loading" ? "pending" : preview?.state === "error" ? "error" : preview?.state === "stale" ? "partial" : "fixed"}
                  source={preview?.series ? "현재 로드 시리즈" : "카탈로그 조합"}
                  asOf={preview?.series ? latestVisibleDate ?? "—" : MACRO_CATALOG_CURATED_AT}
                  coverage={preview?.series ? `${preview.series.label} 미리보기` : `${lens.state.selected.length}개 시리즈`}
                />
              </article>
            );
          })}
        </div>
      </section>

      <details
        className="cpw5-macro-table-panel"
        data-macro-v2-table-drawer="true"
        data-macro-v2-table-state={tableState}
        onToggle={(event) => setTableOpen(event.currentTarget.open)}
      >
        <summary>
          <span className="cpw5-macro-table-panel__summary">
            <span>표 보기</span>
            <b>{`변환 후 값 · ${tableHeaderSummary}`}</b>
          </span>
          <span className="cpw5-macro-table-panel__meta">
            {tableRows.length}개 관측일
            <i aria-hidden>⌄</i>
          </span>
        </summary>
        {tableOpen ? (
          <div className="cpw5-macro-table-panel__body">
            {tableState === "loading" ? (
              <DelayedMacroTableSkeleton />
            ) : tableState === "error" ? (
              <EmptyState
                reason="표 데이터를 불러오지 못했습니다"
                nextRefresh="차트 데이터와 같은 소스를 다시 불러옵니다"
                actionLabel="다시 시도"
                onAction={() => setLoadRetryKey((value) => value + 1)}
              />
            ) : tableState === "empty" ? (
              <EmptyState
                reason="표시할 변환 후 값이 없습니다"
                nextRefresh="시리즈를 선택하면 플롯된 관측값이 날짜별로 표시됩니다"
              />
            ) : (
              <>
                <div className="cpw5-macro-table-panel__tools">
                  <span>{rangeLabel(rangeId)} 창구 · 차트와 동일한 변환 후 값</span>
                  <button
                    type="button"
                    onClick={() => {
                      downloadCsv(visibleChartSeries, selected, rangeId);
                      setExportNotice(`${rangeLabel(rangeId)} 변환 CSV 저장됨`);
                    }}
                  >
                    CSV로 내보내기
                  </button>
                </div>
                <CpDataTable
                  columns={tableColumns}
                  rows={tableRows}
                  getRowKey={(row) => row.date}
                  density="compact"
                  caption={`플롯된 변환 후 값 · ${rangeLabel(rangeId)} 창구`}
                />
              </>
            )}
            <EvidenceRail
              freshness={tableState === "ready" ? "fresh" : tableState === "stale" ? "partial" : tableState === "loading" ? "pending" : tableState === "error" ? "error" : "stale"}
              source="현재 차트 표시값"
              asOf={latestVisibleDate ?? "—"}
              coverage={`${tableRows.length}개 관측일 · ${visibleChartSeries.length}개 시리즈`}
              next={tableState === "empty" ? "시리즈 선택 필요" : undefined}
              onRetry={tableState === "error" ? () => setLoadRetryKey((value) => value + 1) : undefined}
            />
          </div>
        ) : null}
      </details>

      <section className="cpw5-macro-insight-grid" aria-label="매크로 인사이트">
        <article className="cpw5-macro-insight-card">
          <span>{activeMacroContext.label}</span>
          <h2>{activeMacroContext.detail}</h2>
        </article>
        {activeMacroContext.insightBullets.slice(0, 2).map((bullet) => (
          <article key={bullet} className="cpw5-macro-insight-card">
            <span>읽는 법</span>
            <p>{bullet}</p>
          </article>
        ))}
      </section>

      <details
        className="cpw5-macro-accordion"
        open={seriesEditorOpen}
        onToggle={(event) => setSeriesEditorOpen(event.currentTarget.open)}
        data-macro-chart-series-editor="true"
      >
        <summary>
          <span className="cpw5-macro-accordion__summary">
            <span>시리즈 편집</span>
            <b>{selected.length}/{MAX_SELECTED_SERIES} 선택 · 합성 {formulas.length}개</b>
          </span>
          <span className="cpw5-macro-accordion__chevron" aria-hidden="true">⌄</span>
        </summary>
        <div className="cpw5-macro-accordion__body">
          <section className="cpw5-macro-editor-block" aria-label="빠른 프리셋">
            <div className="cpw5-macro-section-head">
              <div>
                <h2>빠른 프리셋</h2>
                <p>기본 차트 조합을 적용합니다.</p>
              </div>
            </div>
            <div className="cpw5-macro-chip-grid">
              {MACRO_CHART_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset.id)}
                  className="cpw5-macro-chip-button"
                  title={preset.description}
                  data-macro-chart-preset={preset.id}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>

          <section className="cpw5-macro-editor-block" aria-label="시장 비교 프리셋">
            <div className="cpw5-macro-section-head">
              <div>
                <h2>시장 비교</h2>
                <p>주식·ETF·지수와 매크로를 같은 시간축에서 비교합니다.</p>
              </div>
              <span>{MARKET_COMPARE_LENSES.length}개</span>
            </div>
            <div className="cpw5-macro-chip-grid">
              {MARKET_COMPARE_LENSES.map((lens) => (
                <article key={lens.id} className="cpw5-macro-compare-card cpw5-macro-evidence-tile" data-macro-v2-tile-evidence="compare">
                  <button
                    type="button"
                    onClick={() => applyMarketCompareLens(lens)}
                    className="cpw5-macro-compare-card__action"
                    data-macro-chart-market-lens={lens.id}
                  >
                    <strong>{lens.label}</strong>
                    <span>{lens.detail}</span>
                  </button>
                  <EvidenceRail
                    freshness="fixed"
                    source="시장 비교 조합"
                    asOf={MACRO_CATALOG_CURATED_AT}
                    coverage={`${lens.state.selected.length}개 시리즈`}
                  />
                </article>
              ))}
            </div>
          </section>

          <section className="cpw5-macro-editor-block" aria-label="시리즈 검색">
            <div className="cpw5-macro-section-head">
              <div>
                <h2>시리즈 검색</h2>
                <p>{filteredCatalog.length}개 표시 · 시장 심볼 직접 추가 가능</p>
              </div>
            </div>
            <div id="macro-series-picker-panel" className="cpw5-macro-picker">
              <label className="sr-only" htmlFor="macro-series-search">
                시리즈 검색
              </label>
              <input
                id="macro-series-search"
                value={queryInput}
                onChange={(event) => setQueryInput(event.target.value)}
                placeholder="M2, VIX, PMI..."
                className="cpw5-macro-input"
                data-macro-chart-search="true"
              />
              <div className="cpw5-macro-symbol-add">
                <label className="sr-only" htmlFor="macro-stooq-ticker">
                  시장 심볼 추가
                </label>
                <div className="cpw5-macro-inline-form">
                  <input
                    id="macro-stooq-ticker"
                    value={stooqTickerInput}
                    onChange={(event) => setStooqTickerInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addStooqSeries();
                      }
                    }}
                    placeholder="NVDA, SPY.US..."
                    className="cpw5-macro-input"
                    data-macro-chart-symbol-input="true"
                  />
                  <button
                    type="button"
                    onClick={addStooqSeries}
                    className="cpw5-macro-primary-button"
                    data-macro-chart-symbol-add="true"
                  >
                    + 티커 추가
                  </button>
                </div>
                <p className="cpw5-macro-status" role="status">
                  {stooqTickerNotice ?? "주식·ETF·지수 심볼을 같은 차트에 추가합니다."}
                </p>
              </div>
              <div className="cpw5-macro-status" role="status">
                {limitNotice ??
                  (activeLoadState.status === "loading"
                    ? "선택한 시리즈 데이터를 불러오는 중입니다."
                    : `최대 ${MAX_SELECTED_SERIES}개까지 비교할 수 있습니다.`)}
              </div>
              <div className="cpw5-macro-picker-list">
                {filteredCatalog.map((item) => (
                  <PickerButton
                    key={item.id}
                    item={item}
                    active={selected.some((selectedItem) => selectedItem.id === item.id)}
                    onClick={() => toggleSeries(item.id)}
                  />
                ))}
                {filteredCatalog.length === 0 ? (
                  <EmptyState reason="검색 결과가 없습니다" nextRefresh="검색어를 바꾸면 다른 시리즈가 표시됩니다" />
                ) : null}
              </div>
            </div>
          </section>

          <section className="cpw5-macro-editor-block">
            <div className="cpw5-macro-section-head">
              <div>
                <h2>합성 시리즈</h2>
                <p>현재 변환값을 a와 b로 두고 a − b, a / b, a × k를 계산합니다.</p>
              </div>
              <span>{formulas.length}/{MAX_FORMULA_SERIES}</span>
            </div>
            {AVAILABLE_MACRO_FORMULA_PRESETS.length ? (
              <div className="cpw5-macro-chip-grid" data-macro-v2-formula-presets="guarded">
                {AVAILABLE_MACRO_FORMULA_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="cpw5-macro-chip-button"
                    onClick={() => applyFormulaPreset(preset)}
                  >
                    <strong>{preset.label}</strong>
                    <span>필요 시 두 시리즈를 함께 추가합니다.</span>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="cpw5-macro-form-grid">
              <select
                value={currentFormulaLeftId}
                onChange={(event) => setFormulaLeftId(event.target.value)}
                disabled={selected.length < 2}
                className="cpw5-macro-select"
                aria-label="합성 왼쪽 시리즈"
                data-macro-chart-formula-control="left"
              >
                {selected.map((item) => (
                  <option key={item.id} value={item.id}>
                    a · {seriesById(item.id)?.shortLabel ?? item.id}
                  </option>
                ))}
              </select>
              <select
                value={formulaOperator}
                onChange={(event) => setFormulaOperator(event.target.value as MacroFormulaOperator)}
                disabled={selected.length < 2}
                className="cpw5-macro-select"
                aria-label="합성 계산식"
                data-macro-chart-formula-control="operator"
              >
                <option value="subtract">{MACRO_FORMULA_LABELS.subtract}</option>
                <option value="ratio">{MACRO_FORMULA_LABELS.ratio}</option>
                <option value="scale">{MACRO_FORMULA_LABELS.scale}</option>
              </select>
              {formulaOperator === "scale" ? (
                <input
                  type="number"
                  value={formulaScalar}
                  step="any"
                  onChange={(event) => setFormulaScalar(event.currentTarget.value)}
                  className="cpw5-macro-input"
                  aria-label="합성 배수 k"
                  data-macro-chart-formula-control="scalar"
                />
              ) : (
                <select
                  value={currentFormulaRightId}
                  onChange={(event) => setFormulaRightId(event.target.value)}
                  disabled={selected.length < 2}
                  className="cpw5-macro-select"
                  aria-label="합성 오른쪽 시리즈"
                  data-macro-chart-formula-control="right"
                >
                  {selected
                    .filter((item) => item.id !== currentFormulaLeftId)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        b · {seriesById(item.id)?.shortLabel ?? item.id}
                      </option>
                    ))}
                </select>
              )}
              <button
                type="button"
                onClick={addFormula}
                disabled={(formulaOperator === "scale" ? selected.length < 1 : selected.length < 2) || formulas.length >= MAX_FORMULA_SERIES}
                className="cpw5-macro-primary-button"
                data-macro-chart-formula-control="add"
              >
                합성 추가
              </button>
            </div>
            <div className="cpw5-macro-status" role="status">
              {formulaNotice ?? "현재 변환값 기준으로 계산합니다."}
            </div>
            <div className="cpw5-macro-formula-list">
              {formulas.length ? (
                formulas.map((formula) => (
                  <div key={formula.id} className="cpw5-macro-selected-row">
                    <span>
                      {formulaLabel(formula)}
                    </span>
                    <b>
                      {MACRO_FORMULA_LABELS[formula.operator]} · {chartSeriesById.get(formula.id)?.unitLabel ?? "합성값"}
                    </b>
                    <button
                      type="button"
                      onClick={() => removeFormula(formula.id)}
                      aria-label={`${formulaLabel(formula)} 삭제`}
                    >
                      삭제
                    </button>
                  </div>
                ))
              ) : (
                <p className="cpw5-macro-empty-small">합성 시리즈가 없습니다.</p>
              )}
            </div>
          </section>

          <section
            className="cpw5-macro-editor-block cpw5-macro-collection-editor"
            data-macro-chart-collections="true"
            data-macro-v2-collection-state={collectionState}
          >
            <div className="cpw5-macro-section-head">
              <div>
                <h2>내 컬렉션</h2>
                <p>현재 차트의 선택·변환·기간·숨김·축·합성식을 저장합니다.</p>
              </div>
              <span>{userPresets.length}/8</span>
            </div>
            <div className="cpw5-macro-inline-form">
              <label className="sr-only" htmlFor="macro-user-preset-name">
                컬렉션 이름
              </label>
              <input
                id="macro-user-preset-name"
                value={presetName}
                onChange={(event) => setPresetName(event.target.value)}
                maxLength={32}
                className="cpw5-macro-input"
              />
              <button
                type="button"
                onClick={saveUserPreset}
                className="cpw5-macro-primary-button"
              >
                현재 차트 저장
              </button>
            </div>
            <div className="cpw5-macro-status" role="status">
              {presetNotice ?? (collectionStorageMode === "session"
                ? "브라우저 저장소를 사용할 수 없어 이 세션에서만 유지합니다."
                : "저장한 차트는 이 브라우저에서 다시 불러올 수 있습니다.")}
            </div>
            <div className="cpw5-macro-formula-list">
              {userPresets.length ? (
                userPresets.map((preset) => renamingPresetId === preset.id ? (
                  <div key={preset.id} className="cpw5-macro-selected-row cpw5-macro-collection-row" data-collection-editing="true">
                    <input
                      value={renamePresetDraft}
                      onChange={(event) => setRenamePresetDraft(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") renameUserPreset(preset.id);
                        if (event.key === "Escape") {
                          setRenamingPresetId(null);
                          setRenamePresetDraft("");
                        }
                      }}
                      maxLength={32}
                      className="cpw5-macro-input"
                      aria-label={`${preset.name} 새 이름`}
                      autoFocus
                    />
                    <button type="button" onClick={() => renameUserPreset(preset.id)} data-macro-v2-collection-action="rename">
                      확인
                    </button>
                    <button type="button" onClick={() => { setRenamingPresetId(null); setRenamePresetDraft(""); }}>
                      취소
                    </button>
                  </div>
                ) : (
                  <div key={preset.id} className="cpw5-macro-selected-row cpw5-macro-collection-row">
                    <button type="button" onClick={() => applyUserPreset(preset)} title={preset.name}>
                      <span>{preset.name}</span>
                      <b>{preset.selected.length}개 · {preset.rangeId}</b>
                    </button>
                    <button type="button" onClick={() => startRenameUserPreset(preset)} data-macro-v2-collection-action="rename" aria-label={`${preset.name} 이름 변경`}>
                      이름 변경
                    </button>
                    <button type="button" onClick={() => deleteUserPreset(preset.id)} aria-label={`${preset.name} 삭제`}>
                      삭제
                    </button>
                  </div>
                ))
              ) : (
                <p className="cpw5-macro-empty-small">저장한 차트가 없습니다.</p>
              )}
            </div>
          </section>

          <section className="cpw5-macro-editor-block">
            <div className="cpw5-macro-section-head">
              <div>
                <h2>선택 시리즈</h2>
                <p>변환과 좌·우 축 고정을 조정합니다.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelected([]);
                  setHiddenIds([]);
                  setAxisById({});
                  setFormulas([]);
                  setLimitNotice(null);
                  setFormulaNotice(null);
                  setStooqTickerNotice(null);
                }}
                className="cpw5-macro-secondary-button"
              >
                비우기
              </button>
            </div>
            <div className="cpw5-macro-formula-list">
              {selected.length === 0 ? (
                <p className="cpw5-macro-empty-small">시리즈가 없습니다.</p>
              ) : (
                selected.map((item) => {
                  const definition = seriesById(item.id);
                  if (!definition) return null;
                  const current = item.transform ?? definition.defaultTransform ?? "raw";
                  return (
                    <div key={item.id} className="cpw5-macro-series-control">
                      <div className="cpw5-macro-series-control__head">
                        <span>{definition.shortLabel}</span>
                        <button
                          type="button"
                          onClick={() => toggleSeries(item.id)}
                        >
                          제거
                        </button>
                      </div>
                      <div className="cpw5-macro-form-grid">
                        <select
                          value={current}
                          onChange={(event) => setTransform(item.id, event.target.value as MacroValueTransform)}
                          className="cpw5-macro-select"
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
                          className="cpw5-macro-select"
                          aria-label={`${definition.shortLabel} 축`}
                        >
                          <option value="auto">축 자동</option>
                          <option value="left">좌축</option>
                          <option value="right">우축</option>
                        </select>
                      </div>
                      <p>{definitionMetaLabel(definition)}</p>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </details>

      <details className="cpw5-macro-accordion" data-macro-chart-connection-editor="true">
        <summary>
          <span className="cpw5-macro-accordion__summary">
            <span>연결 탐색</span>
            <b>{connectionLinks.length + 3}개 링크</b>
          </span>
          <span className="cpw5-macro-accordion__chevron" aria-hidden="true">⌄</span>
        </summary>
        <div className="cpw5-macro-accordion__body">
          <div className="cpw5-macro-connection-grid">
            <TransitionLink href={activeMacroContext.screenerHref} data-macro-chart-context-link="screener">
              <strong>스크리너</strong>
              <span>{activeMacroContext.screenerPreset} 조건으로 종목을 좁힙니다.</span>
            </TransitionLink>
            <TransitionLink href={activeMacroContext.etfHref} data-macro-chart-context-link="etf">
              <strong>ETF 센터</strong>
              <span>{activeMacroContext.shortLabel} 국면을 ETF 자산군으로 봅니다.</span>
            </TransitionLink>
            <TransitionLink href={activeMacroContext.stockHref} data-macro-chart-context-link="stock">
              <strong>{activeMacroContext.stockSymbol}</strong>
              <span>{activeMacroContext.stockLabel} 상세로 이어 봅니다.</span>
            </TransitionLink>
            {connectionLinks.map((link) => (
              <TransitionLink key={link.id} href={link.href} data-macro-chart-connection-link={link.id}>
                <strong>{link.label}</strong>
                <span>{link.detail}</span>
              </TransitionLink>
            ))}
          </div>
        </div>
      </details>

      <DataProvenanceNote
        className="cpw5-macro-provenance"
        title="데이터 연결"
        details={[
          selectedDefinitions.length ? sourceSummary(selectedDefinitions) : null,
          `기간 ${rangeId}`,
          visibleHiddenIds.length ? `${visibleHiddenIds.length}개 시리즈 숨김` : null,
          visibleAxisOverrides ? `${visibleAxisOverrides}개 축 고정` : null,
          formulas.length ? `${formulas.length}개 합성 시리즈` : null,
          hasStooqSelection ? "시장 심볼은 외부 데이터 경로를 경유합니다" : null,
          `카탈로그 ${MACRO_CATALOG_CURATED_AT} · ${MACRO_CATALOG_SERIES_COUNT}개 시리즈`,
          "CSV는 선택 기간·변환 후 실제 표시값 기준",
          "URL로 선택값·기간·숨김·축 상태 공유 가능",
        ]}
      >
        공개 데이터 소스와 승인된 시장 심볼 데이터만 읽고, 브라우저에서 선택한 시리즈를 정렬·변환합니다.
      </DataProvenanceNote>

      <div className="cpw5-macro-cta-row">
        <TransitionLink href={activeMacroContext.screenerHref}>스크리너로 보기</TransitionLink>
        <TransitionLink href={activeMacroContext.etfHref}>ETF로 보기</TransitionLink>
        <TransitionLink href={activeMacroContext.stockHref}>{activeMacroContext.stockSymbol} 상세</TransitionLink>
        <span>투자 조언 아님 · 데이터 기준 {formatAsOf(latestVisibleDate) ?? MACRO_CATALOG_CURATED_AT}</span>
      </div>
    </div>
  );
}
