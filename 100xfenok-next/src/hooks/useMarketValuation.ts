"use client";

import { useEffect, useRef, useState } from "react";
import type {
  IndexMomentum,
  MarketIndexValuation,
  MarketEventRisk,
  MarketIndexTrend,
  MarketMacroPulse,
  MarketSentimentPulse,
  MarketSignalPulse,
  MarketStructurePulse,
  MarketTone,
  MarketValuationResult,
  MomentumSet,
  ValuationDataSource,
  ValuationDriver,
  ValuationBand,
} from "@/lib/market-valuation/types";

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
  metadata?: {
    source?: string;
    source_date?: string;
    generated_at?: string;
  };
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
  signalPulses: [],
  sentimentPulses: [],
  eventRisks: [],
  indexTrends: [],
  structurePulses: [],
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

function fmtSignedPct(value: number | null, digits = 1): string {
  if (value === null) return "—";
  const pct = value * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(digits)}%`;
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

function todayKST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

function buildEventRisks(calendar: RawCalendar | null): MarketEventRisk[] {
  const today = todayKST();
  return (Array.isArray(calendar?.events) ? calendar!.events! : [])
    .filter((event) => typeof event.date_kst === "string" && event.date_kst >= today && (event.importance === "H" || event.importance === "M"))
    .slice(0, 6)
    .map((event, index) => ({
      id: `${event.date_kst}-${event.time_kst}-${index}`,
      dateKst: event.date_kst ?? "—",
      timeKst: event.time_kst ?? "—",
      importance: event.importance ?? "M",
      category: event.category ?? "—",
      titleKo: event.title_ko ?? event.title_en ?? "이벤트",
      titleEn: event.title_en ?? null,
    }));
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

function latestReturn(doc: RawSlickReturns | null): number | null {
  const currentYear = new Date().getFullYear();
  const row = doc?.returns?.find((item) => item.year === currentYear) ?? doc?.returns?.[0];
  const value = row?.["return"];
  return finite(value) ? value / 100 : null;
}

function concentration(doc: RawSlickHoldings | null, id: string, label: string): MarketStructurePulse | null {
  const rows = Array.isArray(doc?.holdings) ? doc!.holdings! : [];
  if (rows.length === 0) return null;
  const top = rows.slice(0, 3);
  const topWeight = top.reduce((sum, row) => sum + (finite(row.weight) ? row.weight! : 0), 0);
  return {
    id,
    label,
    valueLabel: `${topWeight.toFixed(1)}%`,
    detail: top.map((row) => row.symbol ?? row.company ?? "—").join(" · "),
    updated: doc?.updated ?? null,
    tone: topWeight >= 35 ? "amber" : "slate",
  };
}

function buildStructurePulses(params: {
  sp500Holdings: RawSlickHoldings | null;
  nasdaqHoldings: RawSlickHoldings | null;
  sp500Drawdown: RawSlickDrawdown | null;
  sp500Returns: RawSlickReturns | null;
  nasdaqReturns: RawSlickReturns | null;
}): MarketStructurePulse[] {
  const drawdown = parsePercentString(params.sp500Drawdown?.current?.drawdown);
  const sp500Return = latestReturn(params.sp500Returns);
  const nasdaqReturn = latestReturn(params.nasdaqReturns);
  return [
    drawdown !== null
      ? {
          id: "sp500_drawdown",
          label: "S&P 500 고점 대비",
          valueLabel: fmtSignedPct(drawdown, 1),
          detail: `ATH ${String(params.sp500Drawdown?.current?.allTimeHigh ?? "—")} · 현 ${String(params.sp500Drawdown?.current?.price ?? "—")}`,
          updated: params.sp500Drawdown?.updated ?? null,
          tone: structureTone(drawdown),
        }
      : null,
    sp500Return !== null
      ? {
          id: "sp500_return",
          label: "S&P 500 연간",
          valueLabel: fmtSignedPct(sp500Return, 1),
          detail: "Slickcharts yearly return",
          updated: params.sp500Returns?.updated ?? null,
          tone: sp500Return >= 0 ? "emerald" : "rose",
        }
      : null,
    nasdaqReturn !== null
      ? {
          id: "nasdaq_return",
          label: "NASDAQ 100 연간",
          valueLabel: fmtSignedPct(nasdaqReturn, 1),
          detail: "Slickcharts yearly return",
          updated: params.nasdaqReturns?.updated ?? null,
          tone: nasdaqReturn >= 0 ? "emerald" : "rose",
        }
      : null,
    concentration(params.sp500Holdings, "sp500_concentration", "S&P 500 Top3 비중"),
    concentration(params.nasdaqHoldings, "nasdaq_concentration", "NASDAQ 100 Top3 비중"),
  ].filter((pulse): pulse is MarketStructurePulse => pulse !== null);
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
        activity,
        signals,
        vix,
        fearGreed,
        aaii,
        move,
        putCall,
        calendar,
        sp500Index,
        nasdaqIndex,
        sp500Holdings,
        nasdaqHoldings,
        sp500Drawdown,
        sp500Returns,
        nasdaqReturns,
      ] = await Promise.all([
        fetchJson<RawUs>("/data/benchmarks/us.json"),
        fetchJson<RawSummaries>("/data/benchmarks/summaries.json"),
        fetchJson<RawManifest>("/data/manifest.json"),
        fetchJson<RawDamodaranErp>("/data/damodaran/erp.json"),
        fetchJson<RawActivitySurveys>("/data/macro/activity-surveys.json"),
        fetchJson<RawComputedSignals>("/data/computed/signals.json"),
        fetchJson<RawSentimentPoint[]>("/data/sentiment/vix.json"),
        fetchJson<RawSentimentPoint[]>("/data/sentiment/cnn-fear-greed.json"),
        fetchJson<RawSentimentPoint[]>("/data/sentiment/aaii.json"),
        fetchJson<RawSentimentPoint[]>("/data/sentiment/move.json"),
        fetchJson<RawSentimentPoint[]>("/data/sentiment/cnn-put-call.json"),
        fetchJson<RawCalendar>("/data/calendar/usd-calendar.json"),
        fetchJson<RawIndexPoint[]>("/data/indices/sp500.json"),
        fetchJson<RawIndexPoint[]>("/data/indices/nasdaq.json"),
        fetchJson<RawSlickHoldings>("/data/slickcharts/sp500.json"),
        fetchJson<RawSlickHoldings>("/data/slickcharts/nasdaq100.json"),
        fetchJson<RawSlickDrawdown>("/data/slickcharts/sp500-drawdown.json"),
        fetchJson<RawSlickReturns>("/data/slickcharts/sp500-returns.json"),
        fetchJson<RawSlickReturns>("/data/slickcharts/nasdaq100-returns.json"),
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
        signalPulses: buildSignalPulses(signals),
        sentimentPulses: buildSentimentPulses({ vix, fearGreed, aaii, move, putCall }),
        eventRisks: buildEventRisks(calendar),
        indexTrends: buildIndexTrends(sp500Index, nasdaqIndex),
        structurePulses: buildStructurePulses({ sp500Holdings, nasdaqHoldings, sp500Drawdown, sp500Returns, nasdaqReturns }),
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
