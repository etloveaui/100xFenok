// PMI/ISM/OECD activity-surveys adapter (FORGE Slice B, Codex/cx-9).
//
// The ledger already used the latest activity rows. This model exposes the full
// monthly depth as chartable series while preserving the ISM component diffusion
// summary that was useful in the original card grid.

import {
  MARKET_SOURCES,
  buildCoverageEntry,
  loadSummary,
  sortSeriesByDate,
  type MarketSourceConfig,
} from "./loaders";
import type { MarketModel, SeriesPoint } from "./types";
import type { MarketTone } from "../types";

const SOURCE_ID = "activitySurveys" as const;

interface RawActivityRecord {
  date?: string;
  period?: string;
  release_date?: string;
  values?: Record<string, number | null | undefined>;
}

interface RawActivityDataset {
  records?: RawActivityRecord[];
}

interface RawActivitySurveys {
  datasets?: Record<string, RawActivityDataset>;
}

interface DatasetConfig {
  id: string;
  label: string;
  unit: string;
  valueKeys: readonly string[];
  valueLabel: string;
  axis: "activity" | "cli";
  color: string;
}

export interface PmiActivityDatasetModel {
  id: string;
  label: string;
  unit: string;
  valueLabel: string;
  axis: "activity" | "cli";
  color: string;
  latestDate: string | null;
  latestPeriod: string | null;
  latestReleaseDate: string | null;
  latestValue: number | null;
  series: SeriesPoint[];
}

export interface PmiActivityComponent {
  id: string;
  label: string;
  value: number | null;
  delta1m: number | null;
  tone: MarketTone;
}

export interface PmiActivityInternalGroup {
  id: string;
  label: string;
  period: string | null;
  releaseDate: string | null;
  expansionCount: number;
  contractionCount: number;
  components: PmiActivityComponent[];
}

export interface PmiActivityLatest {
  period: string | null;
  releaseDate: string | null;
  expansionCount: number;
  contractionCount: number;
}

export interface PmiActivityModel extends MarketModel<PmiActivityLatest> {
  datasets: PmiActivityDatasetModel[];
  internals: PmiActivityInternalGroup[];
}

const DATASETS: readonly DatasetConfig[] = [
  {
    id: "pmi_manufacturing",
    label: "제조업 PMI",
    unit: "PMI",
    valueKeys: ["global", "us_sp_global"],
    valueLabel: "Global 우선",
    axis: "activity",
    color: "#0072B2",
  },
  {
    id: "pmi_services",
    label: "서비스 PMI",
    unit: "PMI",
    valueKeys: ["global", "us_sp_global"],
    valueLabel: "Global 우선",
    axis: "activity",
    color: "#56B4E9",
  },
  {
    id: "ism_manufacturing",
    label: "ISM 제조업",
    unit: "ISM",
    valueKeys: ["headline"],
    valueLabel: "Headline",
    axis: "activity",
    color: "#E69F00",
  },
  {
    id: "ism_services",
    label: "ISM 서비스",
    unit: "ISM",
    valueKeys: ["headline"],
    valueLabel: "Headline",
    axis: "activity",
    color: "#D55E00",
  },
  {
    id: "oecd_cli",
    label: "OECD CLI 미국",
    unit: "CLI",
    valueKeys: ["united_states"],
    valueLabel: "US",
    axis: "cli",
    color: "#6b7280",
  },
];

const INTERNAL_GROUPS = [
  {
    id: "ism_manufacturing",
    label: "ISM 제조업 내부",
    components: [
      ["new_orders", "신규주문"],
      ["production", "생산"],
      ["employment", "고용"],
      ["supplier_deliveries", "공급"],
      ["inventories", "재고"],
      ["customers_inventories", "고객재고"],
      ["prices", "가격"],
      ["backlog_orders", "수주잔고"],
      ["new_export_orders", "수출주문"],
      ["imports", "수입"],
    ] as const,
  },
  {
    id: "ism_services",
    label: "ISM 서비스 내부",
    components: [
      ["business_activity", "활동"],
      ["new_orders", "신규주문"],
      ["employment", "고용"],
      ["supplier_deliveries", "공급"],
      ["inventories", "재고"],
      ["prices", "가격"],
      ["backlog_orders", "수주잔고"],
      ["new_export_orders", "수출주문"],
      ["imports", "수입"],
      ["inventory_sentiment", "재고심리"],
    ] as const,
  },
] as const;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function metric(row: RawActivityRecord | null | undefined, key: string): number | null {
  const value = row?.values?.[key];
  return finite(value) ? value : null;
}

function firstMetric(row: RawActivityRecord | null | undefined, keys: readonly string[]): {
  key: string | null;
  value: number | null;
} {
  for (const key of keys) {
    const value = metric(row, key);
    if (value !== null) return { key, value };
  }
  return { key: null, value: null };
}

function rowsOf(doc: RawActivitySurveys, id: string): RawActivityRecord[] {
  const rows = doc.datasets?.[id]?.records;
  return Array.isArray(rows)
    ? [...rows].filter((row) => typeof row.date === "string").sort((a, b) => String(a.date).localeCompare(String(b.date)))
    : [];
}

function growthTone(value: number | null): MarketTone {
  if (value === null) return "slate";
  if (value >= 52) return "emerald";
  if (value >= 50) return "slate";
  if (value >= 48) return "amber";
  return "rose";
}

function delta(latest: RawActivityRecord | null, previous: RawActivityRecord | null, key: string): number | null {
  const latestValue = metric(latest, key);
  const previousValue = metric(previous, key);
  return latestValue !== null && previousValue !== null ? latestValue - previousValue : null;
}

function buildDataset(doc: RawActivitySurveys, config: DatasetConfig): PmiActivityDatasetModel | null {
  const rows = rowsOf(doc, config.id);
  const points: SeriesPoint[] = [];
  for (const row of rows) {
    const { key, value } = firstMetric(row, config.valueKeys);
    if (!row.date || value === null) continue;
    points.push({
      date: row.date,
      value,
      period: row.period ?? row.date,
      release_date: row.release_date ?? "",
      source_metric: key ?? "",
    });
  }
  const series = sortSeriesByDate(points);
  if (series.length === 0) return null;

  const latest = series[series.length - 1] ?? null;
  return {
    id: config.id,
    label: config.label,
    unit: config.unit,
    valueLabel: config.valueLabel,
    axis: config.axis,
    color: config.color,
    latestDate: latest?.date ?? null,
    latestPeriod: typeof latest?.period === "string" ? latest.period : null,
    latestReleaseDate: typeof latest?.release_date === "string" ? latest.release_date : null,
    latestValue: latest?.value ?? null,
    series,
  };
}

function buildInternals(doc: RawActivitySurveys): PmiActivityInternalGroup[] {
  const groups: PmiActivityInternalGroup[] = [];
  for (const group of INTERNAL_GROUPS) {
    const rows = rowsOf(doc, group.id);
    const latest = rows[rows.length - 1] ?? null;
    const previous = rows[rows.length - 2] ?? null;
    const components: PmiActivityComponent[] = [];
    for (const [id, label] of group.components) {
      const value = metric(latest, id);
      if (value === null) continue;
      components.push({
        id,
        label,
        value,
        delta1m: delta(latest, previous, id),
        tone: growthTone(value),
      });
    }
    if (components.length === 0) continue;
    groups.push({
      id: group.id,
      label: group.label,
      period: latest?.period ?? null,
      releaseDate: latest?.release_date ?? null,
      expansionCount: components.filter((component) => component.value !== null && component.value >= 50).length,
      contractionCount: components.filter((component) => component.value !== null && component.value < 50).length,
      components,
    });
  }
  return groups;
}

export async function pmiActivityModel(nowIso?: string): Promise<PmiActivityModel | null> {
  const config: MarketSourceConfig = MARKET_SOURCES[SOURCE_ID];
  const doc = await loadSummary<RawActivitySurveys>(config.source);
  if (!doc) return null;

  const meta = await buildCoverageEntry(SOURCE_ID, nowIso);
  if (!meta) return null;

  const datasets = DATASETS.map((dataset) => buildDataset(doc, dataset)).filter(
    (dataset): dataset is PmiActivityDatasetModel => dataset !== null,
  );
  if (datasets.length === 0) return null;

  const internals = buildInternals(doc);
  const series = sortSeriesByDate(
    datasets.flatMap((dataset) =>
      dataset.series.map((point) => ({ ...point, source_id: dataset.id })),
    ),
  );
  const latestDataset = datasets
    .filter((dataset) => dataset.latestDate)
    .sort((a, b) => String(a.latestDate).localeCompare(String(b.latestDate)))
    .at(-1);
  const expansionCount = datasets.filter((dataset) => {
    if (dataset.latestValue === null) return false;
    return dataset.axis === "cli" ? dataset.latestValue >= 100 : dataset.latestValue >= 50;
  }).length;

  return {
    source: config.source,
    rawSource: config.rawSource,
    latest: {
      period: latestDataset?.latestPeriod ?? null,
      releaseDate: latestDataset?.latestReleaseDate ?? null,
      expansionCount,
      contractionCount: Math.max(0, datasets.length - expansionCount),
    },
    series,
    meta,
    datasets,
    internals,
  };
}
