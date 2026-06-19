"use client";

import { useEffect, useRef, useState } from "react";
import {
  loadMarketStructureModel,
  marketStructurePulsesFromModel,
} from "@/lib/market-valuation/models/marketStructureModel";
import type {
  IndexMomentum,
  MarketAnnualReturn,
  MarketBondPulse,
  MarketErpInsight,
  MarketIndexValuation,
  MarketEventRisk,
  MarketIndexTrend,
  MarketMacroComponent,
  MarketMacroDepth,
  MarketMacroPulse,
  MarketSentimentPulse,
  MarketSignalPulse,
  MarketTone,
  MarketValuationResult,
  MomentumSet,
  ValuationDataSource,
  ValuationDriver,
  ValuationBand,
} from "@/lib/market-valuation/types";
import { daysUntilKstDate, todayKST } from "@/lib/market-valuation/freshness";

const FETCH_TIMEOUT_MS = 4000;

// Order = market-cap / breadth significance for display.
const INDEX_ORDER = ["sp500", "nasdaq100", "nasdaq_composite", "russell2000"] as const;

interface RawPoint {
  date?: string;
  px_last?: number;
  best_eps?: number;
  best_pe_ratio?: number;
  px_to_book_ratio?: number;
  roe?: number;
}
interface RawSection {
  name?: string;
  name_en?: string;
  data?: RawPoint[];
}
interface RawUs {
  metadata?: { version?: string };
  sections?: Record<string, RawSection | undefined>;
}
interface RawSummaryMetric {
  "1w"?: number | null;
  "1m"?: number | null;
  "3m"?: number | null;
  "6m"?: number | null;
  ytd?: number | null;
}
interface RawSummarySection {
  momentum?: {
    px_last?: RawSummaryMetric;
    best_eps?: RawSummaryMetric;
    best_pe_ratio?: RawSummaryMetric;
    px_to_book_ratio?: RawSummaryMetric;
    roe?: RawSummaryMetric;
  };
}
interface RawSummaries {
  metadata?: {
    version?: string;
    generated?: string;
    source_summary_sections?: number;
    source_summary_non_null_values?: number;
  };
  source_summaries?: Record<string, RawSummarySection | undefined>;
}
interface RawManifestFolder {
  version?: string;
  updated?: string;
  update_frequency?: string;
  source?: string;
  description?: string;
  file_count?: number;
}
interface RawManifest {
  folders?: Record<string, RawManifestFolder | undefined>;
}
interface RawDamodaranErp {
  us_erp?: number;
  countries?: Record<
    string,
    | {
        equity_risk_premium?: number;
        country_risk_premium?: number;
        default_spread?: number;
        region?: string;
        rating?: string;
      }
    | undefined
  >;
  metadata?: {
    source?: string;
    source_date?: string;
    generated_at?: string;
    country_count?: number;
  };
}
interface RawDamodaranHistoricalYear {
  tbond_rate?: number;
  implied_erp_ddm?: number;
  implied_erp_fcfe?: number;
}
interface RawDamodaranHistorical {
  metadata?: {
    source_date?: string;
    year_range?: string;
  };
  years?: Record<string, RawDamodaranHistoricalYear | undefined>;
}
interface RawActivityRecord {
  date?: string;
  period?: string;
  release_date?: string;
  values?: Record<string, unknown>;
}
interface RawActivityDataset {
  records?: RawActivityRecord[];
}
interface RawActivitySurveys {
  datasets?: Record<string, RawActivityDataset | undefined>;
}
interface RawComputedSignal {
  overallStatus?: string;
  metrics?: Record<string, unknown> | null;
  buy_active?: number | boolean | null;
  warn_active?: number | boolean | null;
}
interface RawComputedSignals {
  as_of?: string;
  signals?: Record<string, RawComputedSignal | undefined>;
}
interface RawSentimentPoint {
  date?: string;
  value?: number;
  score?: number;
  bullish?: number;
  neutral?: number;
  bearish?: number;
  rating?: string;
}
interface RawCalendarEvent {
  date_kst?: string;
  time_kst?: string;
  importance?: string;
  category?: string;
  title_ko?: string;
  title_en?: string;
}
interface RawCalendar {
  events?: RawCalendarEvent[];
}
interface RawPrevValues {
  aliases?: Record<string, string>;
  values?: Record<string, { value?: string; asOf?: string; series?: string; key?: string; source?: string } | undefined>;
}
interface RawIndexPoint {
  date?: string;
  value?: number;
}
interface RawSlickHoldings {
  count?: number;
  updated?: string;
  holdings?: Array<{ symbol?: string; company?: string; weight?: number }>;
}
interface RawSlickDrawdown {
  updated?: string;
  current?: Record<string, unknown>;
}
interface RawSlickReturns {
  updated?: string;
  returns?: Array<{ year?: number; "return"?: number }>;
}
interface RawEconomicRecord {
  date?: string;
  hys_us?: number;
  hys_em?: number;
  hys_eu?: number;
  hyy_us?: number;
  t10y?: number;
  t2y?: number;
  t10y_2y_spread?: number;
  bei_10y?: number;
  tips_10y?: number;
}
interface RawEconomicIndicators {
  source_date?: string;
  records?: RawEconomicRecord[];
}

async function fetchJson<T>(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<T | null> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Build a min/avg/max/percentile band for `current` over a numeric series. */
function buildBand(series: number[], current: number | null): ValuationBand {
  if (series.length === 0) {
    return { current, min: null, avg: null, max: null, percentile: null };
  }
  let min = series[0];
  let max = series[0];
  let sum = 0;
  for (const v of series) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const avg = sum / series.length;
  let percentile: number | null = null;
  if (current !== null) {
    const below = series.reduce((acc, v) => acc + (v <= current ? 1 : 0), 0);
    percentile = Math.round((below / series.length) * 100);
  }
  return { current, min, avg, max, percentile };
}

const EMPTY: MarketValuationResult = {
  indices: [],
  dataSources: [],
  macroPulses: [],
  macroDepths: [],
  signalPulses: [],
  sentimentPulses: [],
  eventRisks: [],
  indexTrends: [],
  structurePulses: [],
  erpInsight: null,
  bondPulses: [],
  sp500AnnualReturns: [],
  benchmarkSections: null,
  damodaranUsErp: null,
  dataReady: false,
  failed: false,
  sourceDate: null,
};

function normalizeMomentum(metric: RawSummaryMetric | undefined): MomentumSet {
  return {
    "1w": finite(metric?.["1w"]) ? metric!["1w"]! : null,
    "1m": finite(metric?.["1m"]) ? metric!["1m"]! : null,
    "3m": finite(metric?.["3m"]) ? metric!["3m"]! : null,
    "6m": finite(metric?.["6m"]) ? metric!["6m"]! : null,
    ytd: finite(metric?.ytd) ? metric!.ytd! : null,
  };
}

function buildMomentum(section: RawSummarySection | undefined): IndexMomentum | null {
  const m = section?.momentum;
  if (!m) return null;
  return {
    price: normalizeMomentum(m.px_last),
    eps: normalizeMomentum(m.best_eps),
    pe: normalizeMomentum(m.best_pe_ratio),
    pb: normalizeMomentum(m.px_to_book_ratio),
    roe: normalizeMomentum(m.roe),
  };
}

function driverFromMomentum(momentum: IndexMomentum | null): ValuationDriver | null {
  if (!momentum) return null;
  const price = momentum.price.ytd;
  const eps = momentum.eps.ytd;
  const pe = momentum.pe.ytd;
  if (price === null || eps === null || pe === null) return null;

  if (price > 0.03 && eps > 0.03 && pe <= 0) {
    return {
      label: "이익 주도 상승",
      detail: "가격은 올랐지만 P/E는 눌려 밸류 부담이 완화된 흐름",
      tone: "emerald",
    };
  }
  if (price > 0.03 && pe > eps) {
    return {
      label: "멀티플 주도 상승",
      detail: "이익보다 P/E 확장이 더 커서 밸류 부담이 커지는 흐름",
      tone: "amber",
    };
  }
  if (price < -0.03 && eps > 0 && pe < 0) {
    return {
      label: "멀티플 디레이팅",
      detail: "이익은 버티지만 시장이 지불하는 배수가 낮아진 흐름",
      tone: "slate",
    };
  }
  if (price < -0.03 && eps < 0) {
    return {
      label: "이익 훼손",
      detail: "가격과 이익 기대가 같이 내려가는 방어적 신호",
      tone: "rose",
    };
  }
  return {
    label: "혼합 구간",
    detail: "가격·이익·멀티플 방향이 뚜렷하게 한쪽으로 정렬되지 않음",
    tone: "slate",
  };
}

function sourceFromManifest(id: string, label: string, usage: string, manifest: RawManifest | null): ValuationDataSource | null {
  const folder = manifest?.folders?.[id];
  if (!folder) return null;
  return {
    id,
    label,
    source: folder.source ?? "—",
    updated: folder.updated ?? null,
    cadence: folder.update_frequency ?? null,
    coverage: folder.description ?? `${folder.file_count ?? "?"} files`,
    usage,
  };
}

function latestActivity(doc: RawActivitySurveys | null, key: string): RawActivityRecord | null {
  const rows = doc?.datasets?.[key]?.records;
  // A1 integration point: replace order-dependent latest selection with
  // loaders.latestSeriesPoint()/date-sorted model output.
  return Array.isArray(rows) && rows.length > 0 ? rows[rows.length - 1] : null;
}

function metric(record: RawActivityRecord | null, key: string): number | null {
  const value = record?.values?.[key];
  return finite(value) ? value : null;
}

function fmtNum(value: number | null, digits = 1): string {
  return value === null ? "—" : value.toFixed(digits);
}

function fmtPctPoint(value: number | null, digits = 1): string {
  return value === null ? "—" : `${value.toFixed(digits)}%`;
}

function growthTone(value: number | null): MarketTone {
  if (value === null) return "slate";
  if (value >= 52) return "emerald";
  if (value >= 50) return "slate";
  if (value >= 48) return "amber";
  return "rose";
}

function cliTone(value: number | null): MarketTone {
  if (value === null) return "slate";
  if (value >= 100.5) return "emerald";
  if (value >= 100) return "slate";
  if (value >= 99) return "amber";
  return "rose";
}

function statusTone(status: string | undefined): MarketTone {
  if (status === "stable" || status === "normal") return "emerald";
  if (status === "caution") return "amber";
  if (status === "danger" || status === "stress" || status === "warning") return "rose";
  return "slate";
}

function statusLabel(status: string | undefined): string {
  if (status === "stable") return "안정";
  if (status === "normal") return "정상";
  if (status === "neutral") return "중립";
  if (status === "caution") return "주의";
  return status ?? "—";
}

function buildMacroPulses(activity: RawActivitySurveys | null): MarketMacroPulse[] {
  const pmiM = latestActivity(activity, "pmi_manufacturing");
  const pmiS = latestActivity(activity, "pmi_services");
  const ismM = latestActivity(activity, "ism_manufacturing");
  const ismS = latestActivity(activity, "ism_services");
  const cli = latestActivity(activity, "oecd_cli");
  const cliUs = metric(cli, "united_states");

  return [
    {
      id: "pmi_manufacturing",
      label: "제조업 PMI",
      value: metric(pmiM, "global"),
      unit: "PMI",
      period: pmiM?.period ?? null,
      releaseDate: pmiM?.release_date ?? null,
      detail: `Global ${fmtNum(metric(pmiM, "global"))} · US ${fmtNum(metric(pmiM, "us_sp_global"))} · Korea ${fmtNum(metric(pmiM, "korea"))}`,
      tone: growthTone(metric(pmiM, "global")),
    },
    {
      id: "pmi_services",
      label: "서비스 PMI",
      value: metric(pmiS, "global"),
      unit: "PMI",
      period: pmiS?.period ?? null,
      releaseDate: pmiS?.release_date ?? null,
      detail: `Global ${fmtNum(metric(pmiS, "global"))} · US ${fmtNum(metric(pmiS, "us_sp_global"))} · China ${fmtNum(metric(pmiS, "china_caixin"))}`,
      tone: growthTone(metric(pmiS, "global")),
    },
    {
      id: "ism_manufacturing",
      label: "ISM 제조업",
      value: metric(ismM, "headline"),
      unit: "ISM",
      period: ismM?.period ?? null,
      releaseDate: ismM?.release_date ?? null,
      detail: `신규주문 ${fmtNum(metric(ismM, "new_orders"))} · 고용 ${fmtNum(metric(ismM, "employment"))} · 가격 ${fmtNum(metric(ismM, "prices"))}`,
      tone: growthTone(metric(ismM, "headline")),
    },
    {
      id: "ism_services",
      label: "ISM 서비스",
      value: metric(ismS, "headline"),
      unit: "ISM",
      period: ismS?.period ?? null,
      releaseDate: ismS?.release_date ?? null,
      detail: `활동 ${fmtNum(metric(ismS, "business_activity"))} · 고용 ${fmtNum(metric(ismS, "employment"))} · 가격 ${fmtNum(metric(ismS, "prices"))}`,
      tone: growthTone(metric(ismS, "headline")),
    },
    {
      id: "oecd_cli",
      label: "OECD CLI",
      value: cliUs,
      unit: "US",
      period: cli?.period ?? null,
      releaseDate: cli?.release_date ?? null,
      detail: `US ${fmtNum(cliUs, 2)} · G7 ${fmtNum(metric(cli, "g7"), 2)} · Korea ${fmtNum(metric(cli, "korea"), 2)} · China ${fmtNum(metric(cli, "china"), 2)}`,
      tone: cliTone(cliUs),
    },
  ].filter((pulse) => pulse.value !== null);
}

function activityRows(activity: RawActivitySurveys | null, key: string): RawActivityRecord[] {
  const rows = activity?.datasets?.[key]?.records;
  return Array.isArray(rows) ? rows : [];
}

function deltaFromPrevious(latest: RawActivityRecord | null, previous: RawActivityRecord | null, key: string): number | null {
  const latestValue = metric(latest, key);
  const previousValue = metric(previous, key);
  return latestValue !== null && previousValue !== null ? latestValue - previousValue : null;
}

function macroComponent(
  id: string,
  label: string,
  latest: RawActivityRecord | null,
  previous: RawActivityRecord | null,
): MarketMacroComponent | null {
  const value = metric(latest, id);
  if (value === null) return null;
  return {
    id,
    label,
    value,
    delta1m: deltaFromPrevious(latest, previous, id),
    tone: growthTone(value),
  };
}

function buildMacroDepths(activity: RawActivitySurveys | null): MarketMacroDepth[] {
  const groups = [
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
  ];

  return groups
    .map((group) => {
      const rows = activityRows(activity, group.id);
      const latest = rows[rows.length - 1] ?? null;
      const previous = rows[rows.length - 2] ?? null;
      const components = group.components
        .map(([id, label]) => macroComponent(id, label, latest, previous))
        .filter((component): component is MarketMacroComponent => component !== null);
      if (components.length === 0) return null;
      return {
        id: group.id,
        label: group.label,
        period: latest?.period ?? null,
        releaseDate: latest?.release_date ?? null,
        expansionCount: components.filter((component) => component.value !== null && component.value >= 50).length,
        contractionCount: components.filter((component) => component.value !== null && component.value < 50).length,
        components,
      };
    })
    .filter((depth): depth is MarketMacroDepth => depth !== null);
}

function percentile(series: number[], current: number | null): number | null {
  if (series.length === 0 || current === null) return null;
  const below = series.reduce((acc, value) => acc + (value <= current ? 1 : 0), 0);
  return Math.round((below / series.length) * 100);
}

function erpRegime(percentileRank: number | null): { label: string; tone: MarketTone } {
  if (percentileRank === null) return { label: "레짐 미정", tone: "slate" };
  if (percentileRank >= 80) return { label: "요구수익률 높음", tone: "emerald" };
  if (percentileRank >= 60) return { label: "보상 정상권 상단", tone: "slate" };
  if (percentileRank >= 40) return { label: "역사 중립", tone: "slate" };
  if (percentileRank >= 20) return { label: "보상 낮음", tone: "amber" };
  return { label: "낮은 ERP", tone: "rose" };
}

function buildErpInsight(current: RawDamodaranErp | null, historical: RawDamodaranHistorical | null): MarketErpInsight | null {
  const usErp = finite(current?.us_erp) ? current!.us_erp! : null;
  const countries = current?.countries && typeof current.countries === "object" ? current.countries : {};

  const historicalRows = Object.entries(historical?.years ?? {})
    .map(([year, data]) => ({
      year,
      value: finite(data?.implied_erp_fcfe) ? data!.implied_erp_fcfe! : null,
    }))
    .filter((row): row is { year: string; value: number } => row.value !== null)
    .sort((a, b) => Number(a.year) - Number(b.year));
  const historicalValues = historicalRows.map((row) => row.value);
  const latestHistorical = historicalRows[historicalRows.length - 1] ?? null;
  const historicalPercentile = percentile(historicalValues, usErp);
  const regime = erpRegime(historicalPercentile);

  if (usErp === null && !latestHistorical) return null;
  return {
    usErp,
    sourceDate: current?.metadata?.source_date ?? historical?.metadata?.source_date ?? null,
    countryCount: current?.metadata?.country_count ?? Object.keys(countries).length,
    historicalPercentile,
    latestHistoricalYear: latestHistorical?.year ?? null,
    latestHistoricalErp: latestHistorical?.value ?? null,
    historicalRows,
    regimeLabel: regime.label,
    regimeTone: regime.tone,
  };
}

function sortedEconomicRecords(economic: RawEconomicIndicators | null): RawEconomicRecord[] {
  return (Array.isArray(economic?.records) ? economic!.records! : [])
    .filter((record) => typeof record.date === "string")
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function economicValue(record: RawEconomicRecord | undefined, key: keyof RawEconomicRecord): number | null {
  const value = record?.[key];
  return finite(value) ? value : null;
}

function fmtDecimalPct(value: number | null, digits = 2): string {
  return value === null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

function fmtBpChange(delta: number | null): string {
  if (delta === null) return "4주 —";
  const bp = delta * 10000;
  const prefix = bp >= 0 ? "+" : "";
  return `4주 ${prefix}${bp.toFixed(0)}bp`;
}

function buildBondPulses(economic: RawEconomicIndicators | null): MarketBondPulse[] {
  const rows = sortedEconomicRecords(economic);
  const latest = rows[rows.length - 1];
  if (!latest) return [];
  const previous = rows[Math.max(0, rows.length - 5)];
  const hysUs = economicValue(latest, "hys_us");
  const hysPrev = economicValue(previous, "hys_us");
  const t10y = economicValue(latest, "t10y");
  const t10yPrev = economicValue(previous, "t10y");
  const curve = economicValue(latest, "t10y_2y_spread");
  const curvePrev = economicValue(previous, "t10y_2y_spread");
  const bei = economicValue(latest, "bei_10y");
  const beiPrev = economicValue(previous, "bei_10y");
  const tips = economicValue(latest, "tips_10y");

  return [
    hysUs !== null
      ? {
          id: "hys_us",
          label: "HY 스프레드",
          valueLabel: fmtDecimalPct(hysUs),
          changeLabel: fmtBpChange(hysPrev !== null ? hysUs - hysPrev : null),
          detail: `HY 수익률 ${fmtDecimalPct(economicValue(latest, "hyy_us"))}`,
          date: latest.date ?? null,
          tone: hysUs >= 0.05 ? "rose" : hysUs >= 0.035 ? "amber" : "emerald",
        }
      : null,
    t10y !== null
      ? {
          id: "t10y",
          label: "미 10년 금리",
          valueLabel: fmtDecimalPct(t10y),
          changeLabel: fmtBpChange(t10yPrev !== null ? t10y - t10yPrev : null),
          detail: `2년 ${fmtDecimalPct(economicValue(latest, "t2y"))}`,
          date: latest.date ?? null,
          tone: t10y >= 0.05 ? "amber" : "slate",
        }
      : null,
    curve !== null
      ? {
          id: "curve",
          label: "10Y-2Y 곡선",
          valueLabel: fmtDecimalPct(curve),
          changeLabel: fmtBpChange(curvePrev !== null ? curve - curvePrev : null),
          detail: curve < 0 ? "역전 구간" : "양의 기울기",
          date: latest.date ?? null,
          tone: curve < 0 ? "rose" : curve < 0.005 ? "amber" : "slate",
        }
      : null,
    bei !== null
      ? {
          id: "bei",
          label: "10Y 기대물가",
          valueLabel: fmtDecimalPct(bei),
          changeLabel: fmtBpChange(beiPrev !== null ? bei - beiPrev : null),
          detail: `10Y TIPS ${fmtDecimalPct(tips)}`,
          date: latest.date ?? null,
          tone: bei >= 0.03 ? "amber" : bei <= 0.015 ? "rose" : "slate",
        }
      : null,
  ].filter((pulse): pulse is MarketBondPulse => pulse !== null);
}

function buildAnnualReturns(doc: RawSlickReturns | null): MarketAnnualReturn[] {
  return (Array.isArray(doc?.returns) ? doc!.returns! : [])
    .map((row) => ({
      year: finite(row.year) ? row.year : null,
      returnPct: finite(row["return"]) ? row["return"] : null,
    }))
    .filter((row): row is MarketAnnualReturn => row.year !== null && row.returnPct !== null)
    .sort((a, b) => a.year - b.year);
}

function m(signals: RawComputedSignals | null, id: string, key: string): number | null {
  const value = signals?.signals?.[id]?.metrics?.[key];
  return finite(value) ? value : null;
}

function buildSignalPulses(signals: RawComputedSignals | null): MarketSignalPulse[] {
  const defs = [
    {
      id: "liquidity_flow",
      label: "유동성 흐름",
      detail: `M2 YoY ${fmtPctPoint(m(signals, "liquidity_flow", "m2_yoy_pct"))} · 주간 순유동성 ${fmtNum(m(signals, "liquidity_flow", "weekly_net_flow_b"))}B`,
    },
    {
      id: "liquidity_stress",
      label: "유동성 스트레스",
      detail: `SOFR-IORB ${fmtNum(m(signals, "liquidity_stress", "sofr_iorb_spread_bp"), 0)}bp · Reserves/GDP ${fmtPctPoint(m(signals, "liquidity_stress", "reserves_gdp_pct"))}`,
    },
    {
      id: "banking_health",
      label: "은행 건전성",
      detail: `Tier1 ${fmtPctPoint(m(signals, "banking_health", "tier1_pct"))} · 연체 ${fmtPctPoint(m(signals, "banking_health", "delinquency_pct"))}`,
    },
    {
      id: "sentiment_signal",
      label: "센티먼트 신호",
      detail: `buy ${signals?.signals?.sentiment_signal?.buy_active ? "on" : "off"} · warn ${signals?.signals?.sentiment_signal?.warn_active ? "on" : "off"}`,
    },
  ];

  return defs
    .map((def) => {
      const status = signals?.signals?.[def.id]?.overallStatus;
      if (!status) return null;
      return {
        ...def,
        status,
        statusLabel: statusLabel(status),
        asOf: signals?.as_of ?? null,
        tone: statusTone(status),
      };
    })
    .filter((pulse): pulse is MarketSignalPulse => pulse !== null);
}

function latestPoint(rows: RawSentimentPoint[] | null): RawSentimentPoint | null {
  return Array.isArray(rows) && rows.length > 0 ? rows[rows.length - 1] : null;
}

function sentimentTone(id: string, value: number | null, rating?: string): MarketTone {
  if (value === null) return "slate";
  if (id === "vix") return value >= 30 ? "rose" : value >= 20 ? "amber" : "slate";
  if (id === "fear_greed") return value < 25 ? "rose" : value < 45 ? "amber" : value <= 55 ? "slate" : "emerald";
  if (id === "move") return value >= 120 ? "rose" : value >= 90 ? "amber" : "slate";
  if (id === "put_call") return rating?.includes("fear") ? "amber" : "slate";
  if (id === "aaii_spread") return value <= -20 ? "rose" : value < 0 ? "amber" : "slate";
  return "slate";
}

function buildSentimentPulses(params: {
  vix: RawSentimentPoint[] | null;
  fearGreed: RawSentimentPoint[] | null;
  aaii: RawSentimentPoint[] | null;
  move: RawSentimentPoint[] | null;
  putCall: RawSentimentPoint[] | null;
}): MarketSentimentPulse[] {
  const vix = latestPoint(params.vix);
  const fearGreed = latestPoint(params.fearGreed);
  const aaii = latestPoint(params.aaii);
  const move = latestPoint(params.move);
  const putCall = latestPoint(params.putCall);
  const aaiiSpread = finite(aaii?.bullish) && finite(aaii?.bearish) ? aaii!.bullish! - aaii!.bearish! : null;

  return [
    {
      id: "vix",
      label: "VIX",
      value: finite(vix?.value) ? vix!.value! : null,
      valueLabel: fmtNum(finite(vix?.value) ? vix!.value! : null, 1),
      date: vix?.date ?? null,
      detail: "주식 변동성",
      tone: sentimentTone("vix", finite(vix?.value) ? vix!.value! : null),
    },
    {
      id: "fear_greed",
      label: "Fear & Greed",
      value: finite(fearGreed?.score) ? fearGreed!.score! : null,
      valueLabel: fmtNum(finite(fearGreed?.score) ? fearGreed!.score! : null, 1),
      date: fearGreed?.date ?? null,
      detail: "CNN 공포·탐욕",
      tone: sentimentTone("fear_greed", finite(fearGreed?.score) ? fearGreed!.score! : null),
    },
    {
      id: "aaii_spread",
      label: "AAII",
      value: aaiiSpread,
      valueLabel: fmtPctPoint(aaiiSpread),
      date: aaii?.date ?? null,
      detail: `Bull ${fmtPctPoint(finite(aaii?.bullish) ? aaii!.bullish! : null)} · Bear ${fmtPctPoint(finite(aaii?.bearish) ? aaii!.bearish! : null)}`,
      tone: sentimentTone("aaii_spread", aaiiSpread),
    },
    {
      id: "move",
      label: "MOVE",
      value: finite(move?.value) ? move!.value! : null,
      valueLabel: fmtNum(finite(move?.value) ? move!.value! : null, 1),
      date: move?.date ?? null,
      detail: "채권 변동성",
      tone: sentimentTone("move", finite(move?.value) ? move!.value! : null),
    },
    {
      id: "put_call",
      label: "Put/Call",
      value: finite(putCall?.value) ? putCall!.value! : null,
      valueLabel: fmtNum(finite(putCall?.value) ? putCall!.value! : null, 2),
      date: putCall?.date ?? null,
      detail: putCall?.rating ?? "옵션 심리",
      tone: sentimentTone("put_call", finite(putCall?.value) ? putCall!.value! : null, putCall?.rating),
    },
  ].filter((pulse) => pulse.value !== null);
}

function previousValueForEvent(event: RawCalendarEvent, prevValues: RawPrevValues | null) {
  const values = prevValues?.values ?? {};
  const aliases = prevValues?.aliases ?? {};
  const normalizePrevKey = (value: unknown) => String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9가-힣]+/g, " ")
    .trim()
    .replace(/\s+/g, "_");
  const candidates = [event.title_en, event.title_ko]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .flatMap((value) => [value, normalizePrevKey(value), aliases[value], aliases[normalizePrevKey(value)]])
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  for (const key of candidates) {
    const resolved = aliases[key] ?? key;
    const match = values[resolved] ?? values[key];
    if (match) {
      return {
        value: typeof match.value === "string" ? match.value : null,
        asOf: typeof match.asOf === "string" ? match.asOf : null,
        series: typeof match.series === "string" ? match.series : null,
      };
    }
  }
  return { value: null, asOf: null, series: null };
}

function buildEventRisks(calendar: RawCalendar | null, prevValues: RawPrevValues | null): MarketEventRisk[] {
  const today = todayKST();
  return (Array.isArray(calendar?.events) ? calendar!.events! : [])
    .filter((event) => typeof event.date_kst === "string" && event.date_kst >= today && (event.importance === "H" || event.importance === "M"))
    .map((event, index) => {
      const previous = previousValueForEvent(event, prevValues);
      const daysUntil = daysUntilKstDate(event.date_kst, today);
      return {
        id: `${event.date_kst}-${event.time_kst}-${index}`,
        dateKst: event.date_kst ?? "—",
        timeKst: event.time_kst ?? "—",
        isToday: daysUntil === 0,
        daysUntil,
        importance: event.importance ?? "M",
        category: event.category ?? "—",
        titleKo: event.title_ko ?? event.title_en ?? "이벤트",
        titleEn: event.title_en ?? null,
        previousValue: previous.value,
        previousAsOf: previous.asOf,
        previousSeries: previous.series,
      };
    })
    .sort((a, b) => {
      const dayDelta = (a.daysUntil ?? Number.MAX_SAFE_INTEGER) - (b.daysUntil ?? Number.MAX_SAFE_INTEGER);
      if (dayDelta !== 0) return dayDelta;
      return (a.importance === "H" ? 0 : 1) - (b.importance === "H" ? 0 : 1);
    })
    .slice(0, 6);
}

function buildTrend(id: string, label: string, rows: RawIndexPoint[] | null): MarketIndexTrend | null {
  const series = (Array.isArray(rows) ? rows : []).filter((point) => typeof point.date === "string" && finite(point.value));
  const latest = series[series.length - 1];
  if (!latest) return null;
  const oneYearBase = series[Math.max(0, series.length - 253)];
  const fiveYearBase = series[Math.max(0, series.length - 1261)];
  const high = series.reduce((max, point) => Math.max(max, point.value!), latest.value!);
  const ret = (base: RawIndexPoint | undefined): number | null => {
    if (!base || !finite(base.value) || !finite(latest.value) || base.value === 0) return null;
    return latest.value / base.value - 1;
  };
  return {
    id,
    label,
    latestDate: latest.date ?? null,
    latestValue: latest.value ?? null,
    oneYearReturn: ret(oneYearBase),
    fiveYearReturn: ret(fiveYearBase),
    drawdownFromHigh: finite(latest.value) && high > 0 ? latest.value! / high - 1 : null,
  };
}

function buildIndexTrends(sp500: RawIndexPoint[] | null, nasdaq: RawIndexPoint[] | null): MarketIndexTrend[] {
  return [
    buildTrend("sp500", "S&P 500", sp500),
    buildTrend("nasdaq", "NASDAQ", nasdaq),
  ].filter((trend): trend is MarketIndexTrend => trend !== null);
}

export function useMarketValuation(): MarketValuationResult {
  const [result, setResult] = useState<MarketValuationResult>(EMPTY);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    void (async () => {
      const [
        raw,
        summaries,
        manifest,
        damodaran,
        historicalErp,
        activity,
        signals,
        vix,
        fearGreed,
        aaii,
        move,
        putCall,
        calendar,
        prevValues,
        sp500Index,
        nasdaqIndex,
        sp500Holdings,
        nasdaqHoldings,
        sp500Drawdown,
        sp500Returns,
        nasdaqReturns,
        economic,
        marketStructureModel,
      ] = await Promise.all([
        fetchJson<RawUs>("/data/benchmarks/us.json"),
        fetchJson<RawSummaries>("/data/benchmarks/summaries.json"),
        fetchJson<RawManifest>("/data/manifest.json"),
        fetchJson<RawDamodaranErp>("/data/damodaran/erp.json"),
        fetchJson<RawDamodaranHistorical>("/data/damodaran/historical_erp.json"),
        fetchJson<RawActivitySurveys>("/data/macro/activity-surveys.json"),
        fetchJson<RawComputedSignals>("/data/computed/signals.json"),
        fetchJson<RawSentimentPoint[]>("/data/sentiment/vix.json"),
        fetchJson<RawSentimentPoint[]>("/data/sentiment/cnn-fear-greed.json"),
        fetchJson<RawSentimentPoint[]>("/data/sentiment/aaii.json"),
        fetchJson<RawSentimentPoint[]>("/data/sentiment/move.json"),
        fetchJson<RawSentimentPoint[]>("/data/sentiment/cnn-put-call.json"),
        fetchJson<RawCalendar>("/data/calendar/usd-calendar.json"),
        fetchJson<RawPrevValues>("/data/calendar/prev-values.json"),
        fetchJson<RawIndexPoint[]>("/data/indices/sp500.json"),
        fetchJson<RawIndexPoint[]>("/data/indices/nasdaq.json"),
        fetchJson<RawSlickHoldings>("/data/slickcharts/sp500.json"),
        fetchJson<RawSlickHoldings>("/data/slickcharts/nasdaq100.json"),
        fetchJson<RawSlickDrawdown>("/data/slickcharts/sp500-drawdown.json"),
        fetchJson<RawSlickReturns>("/data/slickcharts/sp500-returns.json"),
        fetchJson<RawSlickReturns>("/data/slickcharts/nasdaq100-returns.json"),
        fetchJson<RawEconomicIndicators>("/data/global-scouter/indicators/economic.json"),
        loadMarketStructureModel(),
      ]);
      if (!isMountedRef.current) return;

      if (!raw?.sections) {
        setResult({ ...EMPTY, failed: true });
        return;
      }

      const indices: MarketIndexValuation[] = [];
      for (const id of INDEX_ORDER) {
        const section = raw.sections[id];
        const data = Array.isArray(section?.data) ? section!.data : [];
        if (data.length === 0) continue;

        const latest = data[data.length - 1];
        const peSeries = data.map((p) => p.best_pe_ratio).filter(finite);
        const pbSeries = data.map((p) => p.px_to_book_ratio).filter(finite);
        const momentum = buildMomentum(summaries?.source_summaries?.[id]);

        indices.push({
          id,
          name: section?.name ?? id,
          nameEn: section?.name_en ?? id,
          price: finite(latest?.px_last) ? latest!.px_last! : null,
          date: typeof latest?.date === "string" ? latest!.date! : null,
          pe: buildBand(peSeries, finite(latest?.best_pe_ratio) ? latest!.best_pe_ratio! : null),
          pb: buildBand(pbSeries, finite(latest?.px_to_book_ratio) ? latest!.px_to_book_ratio! : null),
          eps: finite(latest?.best_eps) ? latest!.best_eps! : null,
          roe: finite(latest?.roe) ? latest!.roe! : null,
          momentum,
          driver: driverFromMomentum(momentum),
          points: data.length,
        });
      }

      const dataSources = [
        sourceFromManifest("benchmarks", "Bloomberg Benchmarks", "지수 P/E·P/B·ROE·EPS 역사 밴드와 변화 분해", manifest),
        sourceFromManifest("yardney", "Yardeni Bond PER", "회사채 금리 기반 S&P 500 적정가와 프리미엄", manifest),
        sourceFromManifest("damodaran", "Damodaran ERP", "주식위험프리미엄과 금리 대비 요구수익률 앵커", manifest),
        sourceFromManifest("macro", "Macro/FRED/PMI", "PMI·ISM·OECD CLI 성장 펄스", manifest),
        sourceFromManifest("computed", "Computed Signals", "유동성·스트레스·은행·센티먼트 가공 신호", manifest),
        sourceFromManifest("sentiment", "Sentiment", "VIX·Fear & Greed·AAII·MOVE·Put/Call", manifest),
        sourceFromManifest("calendar", "USD Calendar", "다가오는 고중요 이벤트 리스크", manifest),
        sourceFromManifest("indices", "Index Series", "S&P/Nasdaq 추세와 고점 대비 위치", manifest),
        sourceFromManifest("slickcharts", "SlickCharts", "지수 집중도·drawdown·연간 수익률", manifest),
      ].filter((source): source is ValuationDataSource => source !== null);

      setResult({
        indices,
        dataSources,
        macroPulses: buildMacroPulses(activity),
        macroDepths: buildMacroDepths(activity),
        signalPulses: buildSignalPulses(signals),
        sentimentPulses: buildSentimentPulses({ vix, fearGreed, aaii, move, putCall }),
        eventRisks: buildEventRisks(calendar, prevValues),
        indexTrends: buildIndexTrends(sp500Index, nasdaqIndex),
        structurePulses: marketStructurePulsesFromModel(marketStructureModel, { sp500Holdings, nasdaqHoldings, sp500Drawdown, sp500Returns, nasdaqReturns }),
        erpInsight: buildErpInsight(damodaran, historicalErp),
        bondPulses: buildBondPulses(economic),
        sp500AnnualReturns: buildAnnualReturns(sp500Returns),
        benchmarkSections: summaries?.metadata?.source_summary_sections ?? null,
        damodaranUsErp: finite(damodaran?.us_erp) ? damodaran!.us_erp! : null,
        dataReady: indices.length > 0,
        failed: indices.length === 0,
        sourceDate: raw.metadata?.version ?? null,
      });
    })();

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return result;
}
