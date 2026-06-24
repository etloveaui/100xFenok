import type { MarketChartColorToken } from "@/lib/market-valuation/charts/types";

export type MacroSeriesGroup =
  | "equity"
  | "sentiment"
  | "liquidity"
  | "rates"
  | "credit"
  | "banking"
  | "activity";

export type MacroSeriesUnitKind =
  | "index"
  | "score"
  | "percent"
  | "spread"
  | "usd_billion"
  | "usd_million"
  | "usd"
  | "contracts";

export type MacroSeriesFrequency = "daily" | "weekly" | "monthly" | "quarterly";

export type MacroValueTransform = "raw" | "rebase100" | "yoy" | "change";

export type MacroSeriesAccessor =
  | {
      kind: "array";
      valueKey: string;
      dateKey?: string;
    }
  | {
      kind: "arrayDerived";
      derive: "aaii_spread";
      dateKey?: string;
    }
  | {
      kind: "seriesObject";
      seriesKey: string;
      valueKey?: string;
      dateKey?: string;
    }
  | {
      kind: "seriesArray";
      valueKey?: string;
      dateKey?: string;
    }
  | {
      kind: "dataArray";
      valueKey?: string;
      dateKey?: string;
    }
  | {
      kind: "activity";
      dataset: string;
      valueKey: string;
      dateKey?: string;
    };

export interface MacroSeriesDefinition {
  id: string;
  label: string;
  shortLabel: string;
  group: MacroSeriesGroup;
  unit: MacroSeriesUnitKind;
  frequency: MacroSeriesFrequency;
  sourcePath: string;
  accessor: MacroSeriesAccessor;
  description: string;
  defaultTransform?: MacroValueTransform;
  colorToken?: MarketChartColorToken;
}

export interface MacroPresetSeries {
  id: string;
  transform?: MacroValueTransform;
}

export interface MacroChartPreset {
  id: string;
  label: string;
  description: string;
  series: readonly MacroPresetSeries[];
}

export interface MacroRawPoint {
  date: string;
  value: number;
}
