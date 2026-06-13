// Market Structure adapter (FORGE Slice A1).
//
// Default load uses the compact computed index. Raw depth is exposed through
// explicit per-source loadFull functions so Slice C can make UI reachability
// match loader reachability without guessing chart values.

import { buildCoverage } from "./coverage";
import {
  MARKET_SOURCES,
  loadRaw,
  loadSummary,
  latestSeriesPoint,
  sortSeriesByDate,
} from "./loaders";
import type { MarketModel, SeriesPoint } from "./types";
import type { MarketStructurePulse, MarketTone } from "../types";

interface CompactTrendPoint {
  date?: string;
  value?: number | null;
}

interface RawMarketStructureIndexDoc {
  generated_at?: string;
  source_files?: string[];
  concentration?: RawConcentrationItem[];
  benchmarkMatrix?: RawBenchmarkMatrix;
  liquidity?: RawLiquidityItem[];
  sentimentComponents?: {
    latestDate?: string | null;
    points?: number | null;
    components?: RawSentimentComponent[];
  };
  aaii?: RawAaiiSummary;
  creditRatings?: RawCreditRatings;
  magnificent7?: RawMagnificent7;
  membershipChanges?: RawMembershipChanges;
}

interface RawConcentrationItem {
  id?: string;
  label?: string;
  updated?: string | null;
  count?: number | null;
  top3Weight?: number | null;
  top10Weight?: number | null;
  leaders?: Array<{ symbol?: string; company?: string; weight?: number | null }>;
}

interface RawLiquidityItem {
  id?: string;
  label?: string;
  updated?: string | null;
  date?: string | null;
  value?: number | null;
  delta7d?: number | null;
  delta30d?: number | null;
  points?: number | null;
  trend?: CompactTrendPoint[];
}

interface RawSentimentComponent {
  id?: string;
  value?: number | null;
  delta7d?: number | null;
  trend?: CompactTrendPoint[];
}

interface RawAaiiSummary {
  latestDate?: string | null;
  points?: number | null;
  bullish?: number | null;
  neutral?: number | null;
  bearish?: number | null;
  spread?: number | null;
  trend?: CompactTrendPoint[];
}

type MarketStructurePeriodMap = Record<string, number | null>;

export interface MarketStructureBenchmarkRow {
  id: string;
  label: string;
  price: MarketStructurePeriodMap;
  eps: MarketStructurePeriodMap;
  pe: MarketStructurePeriodMap;
  pb: MarketStructurePeriodMap;
  roe: MarketStructurePeriodMap;
}

interface RawBenchmarkMatrix {
  generated?: string | null;
  rows?: Array<Partial<MarketStructureBenchmarkRow>>;
}

export interface MarketStructureBenchmarkMatrix {
  generated: string | null;
  rows: MarketStructureBenchmarkRow[];
}

export interface MarketStructureCreditTable {
  id: string;
  rows: number | null;
  bestRating: string | null;
  worstRating: string | null;
  medianSpread: number | null;
}

interface RawCreditRatings {
  sourceDate?: string | null;
  generatedAt?: string | null;
  tableCount?: number | null;
  tables?: Array<Partial<MarketStructureCreditTable>>;
}

export interface MarketStructureCreditRatings {
  sourceDate: string | null;
  generatedAt: string | null;
  tableCount: number | null;
  tables: MarketStructureCreditTable[];
}

export interface MarketStructureMag7Holding {
  rank: number | null;
  symbol: string | null;
  company: string | null;
  weight: number | null;
  changePercent: number | null;
}

interface RawMagnificent7 {
  updated?: string | null;
  totalMarketCap?: number | null;
  indexWeight?: number | null;
  totalWeight?: number | null;
  holdings?: Array<Partial<MarketStructureMag7Holding>>;
}

export interface MarketStructureMagnificent7 {
  updated: string | null;
  totalMarketCap: number | null;
  indexWeight: number | null;
  totalWeight: number | null;
  holdings: MarketStructureMag7Holding[];
}

export interface MarketStructureMembershipChange {
  date: string | null;
  index: string | null;
  added: string[];
  removed: string[];
  previousCount: number | null;
  currentCount: number | null;
}

interface RawMembershipChanges {
  updated?: string | null;
  recent?: Array<Partial<MarketStructureMembershipChange>>;
}

export interface MarketStructureMembershipChanges {
  updated: string | null;
  recent: MarketStructureMembershipChange[];
}

interface RawTgaPayload {
  series?: Array<{ date?: string; val?: number | null }>;
}

interface RawStablecoinsPayload {
  current?: number | null;
  series?: Array<{ date?: string; val?: number | null }>;
  peggedAssets?: Array<{
    id?: string;
    name?: string;
    symbol?: string;
    circulating?: { peggedUSD?: number | null };
  }>;
}

interface RawAaiiPoint {
  date?: string;
  bullish?: number | null;
  neutral?: number | null;
  bearish?: number | null;
}

interface RawCnnComponentsPoint {
  date?: string;
  market_momentum?: number | null;
  stock_strength?: number | null;
  stock_breadth?: number | null;
  put_call?: number | null;
  volatility?: number | null;
  safe_haven?: number | null;
  junk_bond?: number | null;
}

interface RawSlickHoldings {
  updated?: string;
  holdings?: Array<{ symbol?: string; company?: string; weight?: number | null }>;
}

interface RawSlickDrawdown {
  updated?: string;
  current?: Record<string, unknown>;
}

interface RawSlickReturns {
  updated?: string;
  returns?: Array<{ year?: number; "return"?: number | null }>;
}

interface LegacyStructureInputs {
  sp500Holdings: RawSlickHoldings | null;
  nasdaqHoldings: RawSlickHoldings | null;
  sp500Drawdown: RawSlickDrawdown | null;
  sp500Returns: RawSlickReturns | null;
  nasdaqReturns: RawSlickReturns | null;
}

export interface MarketStructureLiquidityModel extends MarketModel<Record<string, number | string>> {
  id: "tga" | "stablecoins";
  label: string;
  delta7d: number | null;
  delta30d: number | null;
}

export interface MarketStructureSentimentModel extends MarketModel<Record<string, number | string>> {
  id: string;
  label: string;
  delta7d: number | null;
}

export interface MarketStructureAaiiModel extends MarketModel<Record<string, number | string>> {
  bullish: number | null;
  neutral: number | null;
  bearish: number | null;
  spread: number | null;
}

export interface MarketStructureModel extends MarketModel<Record<string, number | string>> {
  generatedAt: string | null;
  concentration: RawConcentrationItem[];
  benchmarkMatrix: MarketStructureBenchmarkMatrix;
  liquidity: MarketStructureLiquidityModel[];
  sentiment: MarketStructureSentimentModel[];
  aaii: MarketStructureAaiiModel | null;
  creditRatings: MarketStructureCreditRatings;
  magnificent7: MarketStructureMagnificent7;
  membershipChanges: MarketStructureMembershipChanges;
}

const SUMMARY_SOURCE = "computed/market_structure_index.json";
const CNN_COMPONENT_FIELDS = [
  "market_momentum",
  "stock_strength",
  "stock_breadth",
  "put_call",
  "volatility",
  "safe_haven",
  "junk_bond",
] as const;

export async function loadMarketStructureModel(): Promise<MarketStructureModel | null> {
  const doc = await loadSummary<RawMarketStructureIndexDoc>(SUMMARY_SOURCE);
  if (!doc) return null;

  const concentration = Array.isArray(doc.concentration) ? doc.concentration : [];
  const liquidity = buildLiquidityModels(doc);
  const sentiment = buildSentimentModels(doc);
  const aaii = buildAaiiModel(doc);
  const series = sortSeriesByDate([
    ...liquidity.flatMap((model) => model.series.map((point) => ({ ...point, source_id: model.id }))),
    ...sentiment.flatMap((model) => model.series.map((point) => ({ ...point, source_id: model.id }))),
    ...(aaii?.series.map((point) => ({ ...point, source_id: "aaii" })) ?? []),
  ]);

  return {
    source: SUMMARY_SOURCE,
    latest: {
      generated_at: doc.generated_at ?? "",
      concentration_count: concentration.length,
      liquidity_count: liquidity.length,
      sentiment_count: sentiment.length,
    },
    series,
    meta: buildCoverage({
      source: SUMMARY_SOURCE,
      availableCount: Array.isArray(doc.source_files) ? doc.source_files.length : 0,
      reachableCount: Array.isArray(doc.source_files) ? doc.source_files.length : 0,
      defaultVisibleCount: Array.isArray(doc.source_files) ? doc.source_files.length : 0,
      downsamplePolicy: "aggregated",
      surface: "ledger-default",
    }),
    generatedAt: doc.generated_at ?? null,
    concentration,
    benchmarkMatrix: normalizeBenchmarkMatrix(doc.benchmarkMatrix),
    liquidity,
    sentiment,
    aaii,
    creditRatings: normalizeCreditRatings(doc.creditRatings),
    magnificent7: normalizeMagnificent7(doc.magnificent7),
    membershipChanges: normalizeMembershipChanges(doc.membershipChanges),
    loadFull: async () => {
      const full = await Promise.all([
        ...liquidity.map((model) => model.loadFull?.() ?? Promise.resolve([])),
        ...sentiment.map((model) => model.loadFull?.() ?? Promise.resolve([])),
        aaii?.loadFull?.() ?? Promise.resolve([]),
      ]);
      return sortSeriesByDate(full.flat());
    },
  };
}

function normalizePeriodMap(value: unknown): MarketStructurePeriodMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => (finite(entry) || entry === null ? [[key, entry]] : [])),
  );
}

function normalizeBenchmarkMatrix(raw: RawBenchmarkMatrix | undefined): MarketStructureBenchmarkMatrix {
  return {
    generated: raw?.generated ?? null,
    rows: (raw?.rows ?? []).flatMap((row) => {
      if (typeof row.id !== "string" || typeof row.label !== "string") return [];
      return [{
        id: row.id,
        label: row.label,
        price: normalizePeriodMap(row.price),
        eps: normalizePeriodMap(row.eps),
        pe: normalizePeriodMap(row.pe),
        pb: normalizePeriodMap(row.pb),
        roe: normalizePeriodMap(row.roe),
      }];
    }),
  };
}

function normalizeCreditRatings(raw: RawCreditRatings | undefined): MarketStructureCreditRatings {
  return {
    sourceDate: raw?.sourceDate ?? null,
    generatedAt: raw?.generatedAt ?? null,
    tableCount: finite(raw?.tableCount) ? raw.tableCount : null,
    tables: (raw?.tables ?? []).flatMap((table) => {
      if (typeof table.id !== "string") return [];
      return [{
        id: table.id,
        rows: finite(table.rows) ? table.rows : null,
        bestRating: typeof table.bestRating === "string" ? table.bestRating : null,
        worstRating: typeof table.worstRating === "string" ? table.worstRating : null,
        medianSpread: finite(table.medianSpread) ? table.medianSpread : null,
      }];
    }),
  };
}

function normalizeMagnificent7(raw: RawMagnificent7 | undefined): MarketStructureMagnificent7 {
  return {
    updated: raw?.updated ?? null,
    totalMarketCap: finite(raw?.totalMarketCap) ? raw.totalMarketCap : null,
    indexWeight: finite(raw?.indexWeight) ? raw.indexWeight : null,
    totalWeight: finite(raw?.totalWeight) ? raw.totalWeight : null,
    holdings: (raw?.holdings ?? []).flatMap((holding) => {
      const hasIdentity = typeof holding.symbol === "string" || typeof holding.company === "string";
      if (!hasIdentity) return [];
      return [{
        rank: finite(holding.rank) ? holding.rank : null,
        symbol: typeof holding.symbol === "string" ? holding.symbol : null,
        company: typeof holding.company === "string" ? holding.company : null,
        weight: finite(holding.weight) ? holding.weight : null,
        changePercent: finite(holding.changePercent) ? holding.changePercent : null,
      }];
    }),
  };
}

function normalizeMembershipChanges(raw: RawMembershipChanges | undefined): MarketStructureMembershipChanges {
  return {
    updated: raw?.updated ?? null,
    recent: (raw?.recent ?? []).map((change) => ({
      date: typeof change.date === "string" ? change.date : null,
      index: typeof change.index === "string" ? change.index : null,
      added: Array.isArray(change.added) ? change.added.filter((item): item is string => typeof item === "string") : [],
      removed: Array.isArray(change.removed) ? change.removed.filter((item): item is string => typeof item === "string") : [],
      previousCount: finite(change.previousCount) ? change.previousCount : null,
      currentCount: finite(change.currentCount) ? change.currentCount : null,
    })),
  };
}

export function marketStructurePulsesFromModel(
  model: MarketStructureModel | null,
  legacy: LegacyStructureInputs,
): MarketStructurePulse[] {
  const drawdown = parsePercentString(legacy.sp500Drawdown?.current?.drawdown);
  const sp500Return = latestReturnByYear(legacy.sp500Returns);
  const nasdaqReturn = latestReturnByYear(legacy.nasdaqReturns);
  return [
    drawdown !== null
      ? {
          id: "sp500_drawdown",
          label: "S&P 500 고점 대비",
          valueLabel: fmtSignedPct(drawdown, 1),
          detail: `ATH ${String(legacy.sp500Drawdown?.current?.allTimeHigh ?? "—")} · 현 ${String(legacy.sp500Drawdown?.current?.price ?? "—")}`,
          updated: legacy.sp500Drawdown?.updated ?? null,
          tone: structureTone(drawdown),
        }
      : null,
    sp500Return !== null
      ? {
          id: "sp500_return",
          label: "S&P 500 연간",
          valueLabel: fmtSignedPct(sp500Return, 1),
          detail: "Slickcharts yearly return",
          updated: legacy.sp500Returns?.updated ?? null,
          tone: sp500Return >= 0 ? "emerald" : "rose",
        }
      : null,
    nasdaqReturn !== null
      ? {
          id: "nasdaq_return",
          label: "NASDAQ 100 연간",
          valueLabel: fmtSignedPct(nasdaqReturn, 1),
          detail: "Slickcharts yearly return",
          updated: legacy.nasdaqReturns?.updated ?? null,
          tone: nasdaqReturn >= 0 ? "emerald" : "rose",
        }
      : null,
    concentrationFromModel(model, "sp500", "sp500_concentration", "S&P 500 Top3 비중") ?? concentrationFromHoldings(legacy.sp500Holdings, "sp500_concentration", "S&P 500 Top3 비중"),
    concentrationFromModel(model, "nasdaq100", "nasdaq_concentration", "NASDAQ 100 Top3 비중") ?? concentrationFromHoldings(legacy.nasdaqHoldings, "nasdaq_concentration", "NASDAQ 100 Top3 비중"),
  ].filter((pulse): pulse is MarketStructurePulse => pulse !== null);
}

function buildLiquidityModels(doc: RawMarketStructureIndexDoc): MarketStructureLiquidityModel[] {
  const rows = Array.isArray(doc.liquidity) ? doc.liquidity : [];
  return rows
    .map((row) => {
      const id = row.id === "tga" || row.id === "stablecoins" ? row.id : null;
      if (!id) return null;
      const sourceConfig = MARKET_SOURCES[id];
      const series = toExplicitTrend(row.trend);
      const latest = latestSeriesPoint(series);
      const model: MarketStructureLiquidityModel = {
        id,
        label: row.label ?? id,
        source: sourceConfig.source,
        rawSource: sourceConfig.rawSource,
        latest: {
          date: row.date ?? latest?.date ?? "",
          value: finite(row.value) ? row.value : latest?.value ?? 0,
        },
        series,
        meta: buildCoverage({
          source: sourceConfig.source,
          rawSource: sourceConfig.rawSource,
          availableCount: finite(row.points) ? row.points : series.length,
          reachableCount: finite(row.points) ? row.points : series.length,
          defaultVisibleCount: series.length,
          downsamplePolicy: "trend-sampled",
          surface: "route",
        }),
        delta7d: finite(row.delta7d) ? row.delta7d : null,
        delta30d: finite(row.delta30d) ? row.delta30d : null,
        loadFull: () => (id === "tga" ? loadTgaFullSeries() : loadStablecoinsFullSeries()),
      };
      return model;
    })
    .filter((model): model is MarketStructureLiquidityModel => model !== null);
}

function buildSentimentModels(doc: RawMarketStructureIndexDoc): MarketStructureSentimentModel[] {
  const components = Array.isArray(doc.sentimentComponents?.components) ? doc.sentimentComponents.components : [];
  return components
    .map((component) => {
      const id = typeof component.id === "string" ? component.id : null;
      if (!id) return null;
      const series = toExplicitTrend(component.trend);
      const latest = latestSeriesPoint(series);
      const model: MarketStructureSentimentModel = {
        id,
        label: id.replace(/_/g, " "),
        source: MARKET_SOURCES.cnnComponents.source,
        rawSource: MARKET_SOURCES.cnnComponents.rawSource,
        latest: {
          date: latest?.date ?? doc.sentimentComponents?.latestDate ?? "",
          value: finite(component.value) ? component.value : latest?.value ?? 0,
        },
        series,
        meta: buildCoverage({
          source: `${MARKET_SOURCES.cnnComponents.source}.${id}`,
          rawSource: MARKET_SOURCES.cnnComponents.rawSource,
          availableCount: finite(doc.sentimentComponents?.points) ? doc.sentimentComponents.points : series.length,
          reachableCount: finite(doc.sentimentComponents?.points) ? doc.sentimentComponents.points : series.length,
          defaultVisibleCount: series.length,
          downsamplePolicy: "trend-sampled",
          surface: "route",
        }),
        delta7d: finite(component.delta7d) ? component.delta7d : null,
        loadFull: () => loadCnnComponentFullSeries(id),
      };
      return model;
    })
    .filter((model): model is MarketStructureSentimentModel => model !== null);
}

function buildAaiiModel(doc: RawMarketStructureIndexDoc): MarketStructureAaiiModel | null {
  const raw = doc.aaii;
  if (!raw) return null;
  const series = toExplicitTrend(raw.trend);
  const latest = latestSeriesPoint(series);
  return {
    source: MARKET_SOURCES.aaii.source,
    rawSource: MARKET_SOURCES.aaii.rawSource,
    latest: {
      date: raw.latestDate ?? latest?.date ?? "",
      value: finite(raw.spread) ? raw.spread : latest?.value ?? 0,
    },
    series,
    meta: buildCoverage({
      source: MARKET_SOURCES.aaii.source,
      rawSource: MARKET_SOURCES.aaii.rawSource,
      availableCount: finite(raw.points) ? raw.points : series.length,
      reachableCount: finite(raw.points) ? raw.points : series.length,
      defaultVisibleCount: series.length,
      downsamplePolicy: "trend-sampled",
      surface: "route",
    }),
    bullish: finite(raw.bullish) ? raw.bullish : null,
    neutral: finite(raw.neutral) ? raw.neutral : null,
    bearish: finite(raw.bearish) ? raw.bearish : null,
    spread: finite(raw.spread) ? raw.spread : null,
    loadFull: loadAaiiFullSeries,
  };
}

async function loadTgaFullSeries(): Promise<SeriesPoint[]> {
  const payload = await loadRaw<RawTgaPayload>("macro/tga.json");
  return sortSeriesByDate(
    (payload?.series ?? []).flatMap((point) => {
      if (!point.date || !finite(point.val)) return [];
      return [{ date: point.date, value: point.val }];
    }),
  );
}

async function loadStablecoinsFullSeries(): Promise<SeriesPoint[]> {
  const payload = await loadRaw<RawStablecoinsPayload>("macro/stablecoins.json");
  return sortSeriesByDate(
    (payload?.series ?? []).flatMap((point) => {
      if (!point.date || !finite(point.val)) return [];
      return [{ date: point.date, value: point.val }];
    }),
  );
}

async function loadAaiiFullSeries(): Promise<SeriesPoint[]> {
  const payload = await loadRaw<RawAaiiPoint[]>("sentiment/aaii.json");
  return sortSeriesByDate(
    (payload ?? []).flatMap((point) => {
      if (!point.date || !finite(point.bullish) || !finite(point.bearish)) return [];
      return [{
        date: point.date,
        value: point.bullish - point.bearish,
        bullish: point.bullish,
        neutral: finite(point.neutral) ? point.neutral : 0,
        bearish: point.bearish,
      }];
    }),
  );
}

async function loadCnnComponentFullSeries(component: string): Promise<SeriesPoint[]> {
  const payload = await loadRaw<RawCnnComponentsPoint[]>("sentiment/cnn-components.json");
  if (!isCnnComponentField(component)) return [];
  return sortSeriesByDate(
    (payload ?? []).flatMap((point) => {
      const value = point[component];
      if (!point.date || !finite(value)) return [];
      return [{ date: point.date, value, component }];
    }),
  );
}

function concentrationFromModel(model: MarketStructureModel | null, id: string, pulseId: string, label: string): MarketStructurePulse | null {
  const item = model?.concentration.find((row) => row.id === id);
  if (!item) return null;
  const top3Weight = finite(item.top3Weight) ? item.top3Weight : null;
  if (top3Weight === null) return null;
  const leaders = (item.leaders ?? [])
    .slice(0, 3)
    .map((row) => row.symbol ?? row.company ?? "—")
    .join(" · ");
  return {
    id: pulseId,
    label,
    valueLabel: `${top3Weight.toFixed(1)}%`,
    detail: leaders,
    updated: item.updated ?? model?.generatedAt ?? null,
    tone: top3Weight >= 35 ? "amber" : "slate",
  };
}

function concentrationFromHoldings(doc: RawSlickHoldings | null, id: string, label: string): MarketStructurePulse | null {
  const rows = Array.isArray(doc?.holdings) ? doc.holdings : [];
  if (rows.length === 0) return null;
  const top = rows.slice(0, 3);
  const topWeight = top.reduce((sum, row) => sum + (finite(row.weight) ? row.weight : 0), 0);
  return {
    id,
    label,
    valueLabel: `${topWeight.toFixed(1)}%`,
    detail: top.map((row) => row.symbol ?? row.company ?? "—").join(" · "),
    updated: doc?.updated ?? null,
    tone: topWeight >= 35 ? "amber" : "slate",
  };
}

function toExplicitTrend(points: CompactTrendPoint[] | undefined): SeriesPoint[] {
  return sortSeriesByDate(
    (points ?? []).flatMap((point) => {
      if (!point.date || !finite(point.value)) return [];
      return [{ date: point.date, value: point.value }];
    }),
  );
}

function latestReturnByYear(doc: RawSlickReturns | null): number | null {
  const rows = (doc?.returns ?? [])
    .filter((row): row is { year: number; "return": number } => finite(row.year) && finite(row["return"]))
    .sort((a, b) => a.year - b.year);
  const currentYear = new Date().getFullYear();
  const row = rows.find((item) => item.year === currentYear) ?? rows[rows.length - 1];
  return finite(row?.["return"]) ? row["return"] / 100 : null;
}

function parsePercentString(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace("%", ""));
  return Number.isFinite(parsed) ? parsed / 100 : null;
}

function structureTone(value: number | null): MarketTone {
  if (value === null) return "slate";
  if (value <= -0.15) return "rose";
  if (value <= -0.05) return "amber";
  return "slate";
}

function fmtSignedPct(value: number | null, digits = 1): string {
  if (value === null) return "—";
  const pct = value * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(digits)}%`;
}

function isCnnComponentField(value: string): value is (typeof CNN_COMPONENT_FIELDS)[number] {
  return CNN_COMPONENT_FIELDS.includes(value as (typeof CNN_COMPONENT_FIELDS)[number]);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
