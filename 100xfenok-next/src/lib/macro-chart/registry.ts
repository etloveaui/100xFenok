import catalogJson from "../../../public/data/catalog/macro-series.json";

import type { MacroChartPreset, MacroSeriesAccessor, MacroSeriesDefinition, MacroValueTransform } from "./types";
import { stooqSeriesDefinitionFromId } from "./stooq";

type CatalogSeries = {
  id: string;
  label: string;
  group: MacroSeriesDefinition["group"];
  unit: MacroSeriesDefinition["unit"];
  frequency: MacroSeriesDefinition["frequency"];
  source_path: string;
  path_shape: string;
  short_label?: string;
  description?: string;
  default_transform?: MacroValueTransform;
};

type CatalogPreset = {
  id: string;
  label: string;
  description?: string;
  series: string[];
};

const catalog = catalogJson as unknown as {
  curated_at: string;
  series: CatalogSeries[];
  presets: CatalogPreset[];
};

function accessorFromPathShape(pathShape: string): MacroSeriesAccessor {
  if (pathShape.includes("bullish-bearish")) return { kind: "arrayDerived", derive: "aaii_spread" };
  const activity = pathShape.match(/^\$\.datasets\.([^.]+)\.records\[\]\.values\.([^\s]+)$/);
  if (activity) return { kind: "activity", dataset: activity[1], valueKey: activity[2] };
  const seriesObject = pathShape.match(/^\$\.series\.([^[]+)\[\]/);
  if (seriesObject) return { kind: "seriesObject", seriesKey: seriesObject[1] };
  if (pathShape.startsWith("$.series[]")) return { kind: "seriesArray", valueKey: "val" };
  if (pathShape.startsWith("$.data[]")) return { kind: "dataArray", valueKey: "value" };
  const valueKey = pathShape.includes(",score") ? "score" : pathShape.includes(",net") ? "net" : "value";
  return { kind: "array", valueKey };
}

function presetSeries(token: string) {
  const [id, transform] = token.split(":");
  return { id, transform: transform as MacroValueTransform };
}

export const MACRO_SERIES_CATALOG: readonly MacroSeriesDefinition[] = catalog.series.map((item) => ({
  id: item.id,
  label: item.label,
  shortLabel: item.short_label ?? item.label,
  group: item.group,
  unit: item.unit,
  frequency: item.frequency,
  sourcePath: item.source_path,
  accessor: accessorFromPathShape(item.path_shape),
  description: item.description ?? item.label,
  defaultTransform: item.default_transform,
}));

export const MACRO_CHART_PRESETS: readonly MacroChartPreset[] = catalog.presets.map((preset) => ({
  id: preset.id,
  label: preset.label,
  description: preset.description ?? preset.label,
  series: preset.series.map(presetSeries),
}));

export const MACRO_GROUP_LABELS: Record<MacroSeriesDefinition["group"], string> = {
  equity: "주식",
  sentiment: "심리",
  liquidity: "유동성",
  rates: "금리",
  credit: "신용",
  banking: "은행",
  activity: "경기",
};

export const MACRO_TRANSFORM_LABELS = {
  raw: "원값",
  rebase100: "100 기준",
  yoy: "YoY",
  change: "전기 대비",
} as const;

export const MACRO_CATALOG_CURATED_AT = catalog.curated_at;
export const MACRO_CATALOG_SERIES_COUNT = catalog.series.length;

export function seriesById(id: string): MacroSeriesDefinition | undefined {
  return MACRO_SERIES_CATALOG.find((item) => item.id === id) ?? stooqSeriesDefinitionFromId(id);
}
