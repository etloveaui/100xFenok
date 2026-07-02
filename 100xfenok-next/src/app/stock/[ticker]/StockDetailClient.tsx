"use client";

import { Fragment, type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import CpButton from "@/components/canvas-plus/CpButton";
import CpPriceChart from "@/components/canvas-plus/charts/CpPriceChart";
import type { CpChartDatum } from "@/components/canvas-plus/charts/types";
import DataStateNotice, { DataStateBadge } from "@/components/DataStateNotice";
import MarketQuickLinks from "@/components/market/MarketQuickLinks";
import ConnectedView from "@/components/connected/ConnectedView";
import { resolveSector, sectorColor, sectorLabelKo } from "@/lib/design/sectorMap";
import { bandPct, bandClass } from "@/lib/screener/bands";
import {
  useStockDetail,
  use13FData,
  Sparkline,
  PerBandChart,
  RevisionPulse,
  RawFinancialDepth,
  PriceDividendHistoryDepth,
  MarketFactsDepth,
  useMarketFacts,
  fmtLarge,
  deriveProfitabilityEstimates,
} from "@/app/screener/StockDetailPanel";
import type { F13Entry } from "@/app/screener/StockDetailPanel";
import EdgarSummaryClient from "@/components/filings/EdgarSummaryClient";
import {
  loadEdgarKoreanSummariesForTicker,
  edgarFilingsForTicker,
  type EdgarKoreanSummaryFilingEntry,
} from "@/lib/edgarKoreanSummaries";
import { renderYfTab, FiftyTwoWeekBar, SummaryScoreCard, ThreeSecondSummary, loadIndustryBenchmarks, resolveIndustryBench, formatMoney, formatCompactMoney } from "./StockTabs";
import type { IndustryBench } from "./StockTabs";
import WatchStar from "@/components/WatchStar";
import MetricHelp from "@/components/MetricHelp";
import { formatSignedPercent } from "@/lib/format";
import { makeDataState } from "@/lib/data-state";
import { ROUTES } from "@/lib/routes";
import { normalizeForEntityKey } from "@/lib/ticker";
import TickerSurfaceEventsCard, { loadTickerSurfaces, type TickerSurfacePayload } from "./TickerSurfaceEventsCard";
import ExternalSourceLinks from "@/components/ExternalSourceLinks";
import { estimateCompletenessFromSeries, estimateCompletenessTone, hasEstimateGap } from "@/lib/estimate-completeness";
import { StaticStockAnalyzerDataProvider } from "@/features/stock-analyzer/data/static-data-provider";
import type { StockAnalyzerRecord } from "@/lib/stock-analyzer/types";
import {
  getStockConnection,
  getStockServices,
  loadStockConnectionIndex,
  loadStockServicesIndex,
  type StockConnectionEntry,
  type StockServicesEntry,
} from "@/lib/data-entity-graph/stock-index";
import {
  loadFenokSignalsSummaryMap,
  type FenokSignalsSummaryRecord,
} from "@/features/stock-analyzer/data/fenok-signals-summary-provider";
import FenokSignalLensCard from "./FenokSignalLensCard";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Stock analyzer provider module-level cache
// ---------------------------------------------------------------------------

interface AnalyzerRow {
  symbol: string;
  companyName: string;
  sector: string;
  price: number | null;
  marketCap: number | null;
  per: number | null;
  pbr: number | null;
  dividendYield: number | null;
  return12m: number | null;
  perBandCurrent: number | null;
  perBandMin: number | null;
  perBandAvg: number | null;
  perBandMax: number | null;
}

let analyzerCache: Record<string, AnalyzerRow> | null = null;
let analyzerPromise: Promise<Record<string, AnalyzerRow> | null> | null = null;
const stockAnalyzerProvider = new StaticStockAnalyzerDataProvider();

function analyzerNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toAnalyzerRow(record: StockAnalyzerRecord): AnalyzerRow {
  return {
    symbol: record.symbol,
    companyName: record.companyName,
    sector: record.sector ?? "",
    price: analyzerNumber(record.price),
    marketCap: analyzerNumber(record.marketCap),
    per: analyzerNumber(record.per),
    pbr: analyzerNumber(record.pbr),
    dividendYield: analyzerNumber(record.dividendYield),
    return12m: analyzerNumber(record.return12m),
    perBandCurrent: analyzerNumber(record.perBandCurrent),
    perBandMin: analyzerNumber(record.perBandMin),
    perBandAvg: analyzerNumber(record.perBandAvg),
    perBandMax: analyzerNumber(record.perBandMax),
  };
}

function loadAnalyzer(): Promise<Record<string, AnalyzerRow> | null> {
  if (analyzerCache) return Promise.resolve(analyzerCache);
  if (analyzerPromise) return analyzerPromise;
  analyzerPromise = stockAnalyzerProvider
    .load()
    .then((records) => {
      const map: Record<string, AnalyzerRow> = {};
      for (const record of records) {
        if (record.symbol.trim()) {
          map[normalizeForEntityKey(record.symbol)] = toAnalyzerRow(record);
        }
      }
      analyzerCache = map;
      return map;
    })
    .catch(() => { analyzerPromise = null; return null; });
  return analyzerPromise;
}

// ---------------------------------------------------------------------------
// yf finance data module-level cache
// ---------------------------------------------------------------------------

const yfCache: Record<string, any> = {};
const yfPending: Record<string, Promise<any | null>> = {};

function loadYfFinance(ticker: string): Promise<any | null> {
  const symbol = normalizeForEntityKey(ticker);
  if (!symbol) return Promise.resolve(null);
  if (symbol in yfCache) return Promise.resolve(yfCache[symbol] || null);
  if (symbol in yfPending) return yfPending[symbol];
  const p = fetch(`/data/yf/finance/${encodeURIComponent(symbol)}.json`)
    .then((res) => (res.ok ? res.json() : null))
    .then((d) => {
      yfCache[symbol] = d && typeof d === "object" && !Array.isArray(d) ? d.data ?? null : null;
      delete yfPending[symbol];
      return yfCache[symbol];
    })
    .catch(() => { delete yfPending[symbol]; return null; });
  yfPending[symbol] = p;
  return p;
}

// ---------------------------------------------------------------------------
// Stockanalysis ETF asset data
// ---------------------------------------------------------------------------

interface StockanalysisEtfHolding {
  rank?: number | null;
  symbol?: string | null;
  name?: string | null;
  weight_pct?: number | null;
  shares?: number | string | null;
  raw?: Record<string, unknown>;
}

interface StockanalysisWeightedRow {
  key?: string | null;
  n?: string | null;
  country?: string | null;
  code?: string | null;
  value?: number | null;
  w?: number | null;
  weight?: number | null;
}

interface StockanalysisHistoryPoint {
  t?: string | null;
  o?: number | null;
  h?: number | null;
  l?: number | null;
  c?: number | null;
  v?: number | null;
  ch?: number | null;
}

interface StockanalysisEtfPayload {
  ticker?: string;
  asset_type?: string;
  fetched_at?: string;
  detail_status?: string;
  normalized?: {
    holdings?: StockanalysisEtfHolding[];
    asset_allocation?: StockanalysisWeightedRow[] | null;
    sectors?: StockanalysisWeightedRow[] | null;
    countries?: StockanalysisWeightedRow[] | null;
    holding_count?: number | null;
    holdings_updated?: string | null;
    overview?: Record<string, unknown> | null;
    quote?: Record<string, unknown> | null;
    history?: StockanalysisHistoryPoint[];
  };
}

interface StockanalysisFinancialRow {
  field?: string | null;
  title?: string | null;
  values?: unknown[];
}

interface StockanalysisFinancialStatement {
  periods?: string[];
  rows?: StockanalysisFinancialRow[];
}

interface StockanalysisFinancialPayload {
  ticker?: string;
  fetched_at?: string;
  role?: string;
  statements?: {
    annual?: Record<string, StockanalysisFinancialStatement | null | undefined>;
    quarterly?: Record<string, StockanalysisFinancialStatement | null | undefined>;
  };
  summary?: Record<string, Record<string, { field_count?: number | null; period_count?: number | null; period?: string | null } | null | undefined>>;
}

interface StockanalysisStockPayload {
  ticker?: string;
  asset_type?: string;
  fetched_at?: string;
  normalized?: {
    overview?: Record<string, unknown> | null;
    quote?: Record<string, unknown> | null;
    history?: StockanalysisHistoryPoint[];
    financials?: {
      fetched_at?: string | null;
      summary?: StockanalysisFinancialPayload["summary"];
    } | null;
  };
}

function loadStockanalysisEtf(ticker: string): Promise<StockanalysisEtfPayload | null> {
  const symbol = normalizeForEntityKey(ticker);
  if (!symbol) return Promise.resolve(null);
  return fetch(`/api/data/stockanalysis/etfs/${encodeURIComponent(symbol)}`, { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => (
      data && typeof data === "object" && !Array.isArray(data)
        ? data as StockanalysisEtfPayload
        : null
    ))
    .catch(() => null);
}

function loadStockanalysisStock(ticker: string): Promise<StockanalysisStockPayload | null> {
  const symbol = normalizeForEntityKey(ticker);
  if (!symbol) return Promise.resolve(null);
  return fetch(`/api/data/stockanalysis/stocks/${encodeURIComponent(symbol)}`, { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => (
      data && typeof data === "object" && !Array.isArray(data)
        ? data as StockanalysisStockPayload
        : null
    ))
    .catch(() => null);
}

function loadStockanalysisFinancials(ticker: string): Promise<StockanalysisFinancialPayload | null> {
  const symbol = normalizeForEntityKey(ticker);
  if (!symbol) return Promise.resolve(null);
  return fetch(`/api/data/stockanalysis/financials/${encodeURIComponent(symbol)}`, { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => (
      data && typeof data === "object" && !Array.isArray(data)
        ? data as StockanalysisFinancialPayload
        : null
    ))
    .catch(() => null);
}

// ---------------------------------------------------------------------------
// trades_ranking cache
// ---------------------------------------------------------------------------

type TradesCache = { bought: any[]; sold: any[]; metadata: any };
type SmartMoneyTrade = any & { action: "buy" | "sell" };

let tradesCache: TradesCache | null = null;
let tradesPromise: Promise<TradesCache | null> | null = null;

function loadTradesRanking(): Promise<TradesCache | null> {
  if (tradesCache) return Promise.resolve(tradesCache);
  if (tradesPromise) return tradesPromise;
  tradesPromise = fetch("/data/sec-13f/analytics/trades_ranking.json")
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      tradesCache = {
        bought: Array.isArray(data?.bought) ? data.bought : [],
        sold: Array.isArray(data?.sold) ? data.sold : [],
        metadata: data?.metadata ?? null,
      };
      return tradesCache;
    })
    .catch(() => { tradesPromise = null; return null; });
  return tradesPromise;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

type MaybeNumber = number | null | undefined;
type NumberSeries = MaybeNumber[];
type StockTab = "overview" | "etf" | "financials" | "statistics" | "ownership" | "estimates" | "filings";
type StockTabItem = { id: StockTab; label: string; badge?: string };
const STOCK_CHART_RANGES = ["1M", "3M", "6M", "1Y", "MAX"] as const;
type StockChartRange = (typeof STOCK_CHART_RANGES)[number];
const STOCK_CHART_RANGE_MONTHS: Partial<Record<StockChartRange, number>> = {
  "1M": 1,
  "3M": 3,
  "6M": 6,
  "1Y": 12,
};
const ESTIMATE_LABELS: Record<string, string> = { fy1: "FY+1", fy2: "FY+2", fy3: "FY+3" };
const STOCK_TAB_VALUES: StockTab[] = ["overview", "etf", "statistics", "estimates", "financials", "ownership", "filings"];

function stockTabDomSafe(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "ticker";
}

function stockTabId(symbol: string, tab: StockTab): string {
  return `stock-${stockTabDomSafe(symbol)}-tab-${tab}`;
}

function stockPanelId(symbol: string, tab: StockTab): string {
  return `stock-${stockTabDomSafe(symbol)}-panel-${tab}`;
}

function isStockTab(value: string | null | undefined): value is StockTab {
  return typeof value === "string" && STOCK_TAB_VALUES.includes(value as StockTab);
}

function stockTabFromLocation(): StockTab {
  if (typeof window === "undefined") return "overview";
  const value = new URLSearchParams(window.location.search).get("tab");
  return isStockTab(value) ? value : "overview";
}

function writeStockTabUrl(tab: StockTab, mode: "push" | "replace", hash?: string | null): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (tab === "overview") {
    url.searchParams.delete("tab");
  } else {
    url.searchParams.set("tab", tab);
  }
  if (hash !== undefined) {
    url.hash = hash ?? "";
  }
  const nextHref = `${url.pathname}${url.search}${url.hash}`;
  const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextHref === currentHref) return;
  if (mode === "push") window.history.pushState(window.history.state, "", nextHref);
  else window.history.replaceState(window.history.state, "", nextHref);
}

function StockTabsNav({
  symbol,
  tabs,
  activeTab,
  onSelect,
  note,
}: {
  symbol: string;
  tabs: StockTabItem[];
  activeTab: StockTab;
  onSelect: (tab: StockTab) => void;
  note?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef(new Map<StockTab, HTMLButtonElement>());
  const [canScroll, setCanScroll] = useState(false);
  const [focusedTab, setFocusedTab] = useState<StockTab>(activeTab);
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTab);
  const focusedInTabs = tabs.some((tab) => tab.id === focusedTab);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const update = () => setCanScroll(node.scrollWidth > node.clientWidth + 1);
    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(node);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [tabs.length, note]);

  useEffect(() => {
    setFocusedTab(activeTab);
  }, [activeTab]);

  function moveTo(currentIndex: number, delta: number) {
    if (tabs.length === 0) return;
    const baseIndex = currentIndex >= 0 ? currentIndex : activeIndex >= 0 ? activeIndex : 0;
    const nextIndex = delta === 0 ? baseIndex : baseIndex + delta;
    const normalizedIndex = (nextIndex + tabs.length) % tabs.length;
    const nextTab = tabs[normalizedIndex] ?? tabs[0];
    if (!nextTab) return;
    setFocusedTab(nextTab.id);
    onSelect(nextTab.id);
    requestAnimationFrame(() => {
      buttonRefs.current.get(nextTab.id)?.focus();
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveTo(index, 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveTo(index, -1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveTo(0, 0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveTo(tabs.length - 1, 0);
    }
  }

  return (
    <div ref={ref} className={`stock-tabs ${canScroll ? "can-scroll" : ""}`} role="tablist" aria-label={`${symbol} 상세 탭`} aria-orientation="horizontal">
      {tabs.map((t, index) => {
        const selected = activeTab === t.id;
        const focusable = focusedTab === t.id || (selected && !focusedInTabs) || (activeIndex < 0 && !focusedInTabs && index === 0);
        return (
          <button
            key={t.id}
            ref={(node) => {
              if (node) buttonRefs.current.set(t.id, node);
              else buttonRefs.current.delete(t.id);
            }}
            id={stockTabId(symbol, t.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={stockPanelId(symbol, t.id)}
            tabIndex={focusable ? 0 : -1}
            onClick={() => {
              setFocusedTab(t.id);
              onSelect(t.id);
            }}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`stock-tab ${selected ? "on" : ""}`}
          >
            <span className="block">{t.label}</span>
            {t.badge ? <span className="mt-0.5 block text-[10px] font-black text-blue-600">{t.badge}</span> : null}
          </button>
        );
      })}
      {note ? <span className="stock-tab-note">{note}</span> : null}
    </div>
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteValues(data: unknown): number[] {
  return Array.isArray(data) ? data.filter(isFiniteNumber) : [];
}

function numberSeries(data: unknown): NumberSeries {
  return Array.isArray(data) ? data.map((value) => (isFiniteNumber(value) ? value : null)) : [];
}

function lastFinite(data: NumberSeries | null | undefined): number | null {
  const values = finiteValues(data);
  return values.length > 0 ? values[values.length - 1] : null;
}

function fmtMcap(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}T`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}B`;
  return `$${n.toFixed(0)}M`;
}
function fmtPct(n: number): string {
  return formatSignedPercent(n, { digits: 1 });
}
function fmtDivYield(n: number): string { return `${(n * 100).toFixed(2)}%`; }
function fmtWholePct(n: MaybeNumber): string { return isFiniteNumber(n) ? `${n.toFixed(1)}%` : "—"; }
function fmtWholeSignedPct(n: MaybeNumber): string { return isFiniteNumber(n) ? fmtPct(n / 100) : "—"; }
function fmtEtfPct(n: MaybeNumber): string {
  if (!isFiniteNumber(n)) return "—";
  const abs = Math.abs(n);
  return `${n.toFixed(abs >= 100 ? 1 : abs >= 10 ? 2 : 2)}%`;
}
function fmtEtfSignedPct(n: MaybeNumber): string {
  return isFiniteNumber(n) ? formatSignedPercent(n, { digits: 2, fraction: false }) : "—";
}
function fmtShares(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!isFiniteNumber(value)) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: value >= 1000 ? 0 : 2 });
}
function fmtDateish(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "—";
  return value.trim();
}
function fmtKstMinute(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.trim();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}
function rawText(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (isFiniteNumber(value)) return value.toLocaleString();
  return "—";
}
function factNumber(source: any, key: string): number | null {
  const value = source?.facts?.[key]?.value;
  return isFiniteNumber(value) ? value : null;
}

function stockHistoryDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isFinite(date.getTime()) ? date : null;
}

function stockHistoryToChartData(history: StockanalysisHistoryPoint[] | null | undefined): CpChartDatum[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter(
      (point): point is StockanalysisHistoryPoint & { t: string; o: number; h: number; l: number; c: number } =>
        typeof point.t === "string" &&
        isFiniteNumber(point.o) &&
        isFiniteNumber(point.h) &&
        isFiniteNumber(point.l) &&
        isFiniteNumber(point.c),
    )
    .map((point) => ({
      time: point.t,
      open: point.o,
      high: point.h,
      low: point.l,
      close: point.c,
      value: point.c,
      volume: isFiniteNumber(point.v) ? point.v : undefined,
    }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

function filterStockChartRange(data: readonly CpChartDatum[], range: StockChartRange): CpChartDatum[] {
  if (range === "MAX" || data.length <= 1) return [...data];
  const latest = stockHistoryDate(data[data.length - 1]?.time ?? "");
  if (!latest) return [...data];
  const cutoff = new Date(latest);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - (STOCK_CHART_RANGE_MONTHS[range] ?? 12));
  const filtered = data.filter((point) => {
    const date = stockHistoryDate(point.time);
    return date ? date >= cutoff : false;
  });
  return filtered.length > 0 ? filtered : [...data];
}

function stockChartSummary(data: readonly CpChartDatum[], currency: string, range: StockChartRange): string {
  const closes = data
    .map((point) => (isFiniteNumber(point.close) ? point.close : null))
    .filter(isFiniteNumber);
  if (closes.length < 2) {
    return `${range} 가격 캔들 ${closes.length.toLocaleString("ko-KR")}개 · OHLCV 데이터 대기`;
  }
  const first = closes[0];
  const last = closes[closes.length - 1];
  const change = first !== 0 ? (last - first) / Math.abs(first) : 0;
  return `${range} 종가 ${formatMoney(last, currency)} · 구간 변화 ${formatSignedPercent(change, { digits: 1 })}`;
}

function resolveFenokEdgeScore(record: FenokSignalsSummaryRecord | null | undefined): number | null {
  const candidates = [
    record?.convictionScore,
    record?.longTermScore,
    record?.longTermConvictionScore,
    record?.shortTermScore,
    record?.shortTermConvictionScore,
  ];
  const score = candidates.find(isFiniteNumber);
  return isFiniteNumber(score) ? Math.max(0, Math.min(100, Math.round(score))) : null;
}

function fenokEdgeLabel(score: number | null): string {
  if (!isFiniteNumber(score)) return "점수 대기";
  if (score >= 80) return "강한 우위";
  if (score >= 65) return "우위";
  if (score >= 50) return "중립";
  if (score >= 35) return "관망";
  return "약세";
}

function formatCoverageRatio(value: MaybeNumber): string {
  if (!isFiniteNumber(value)) return "커버리지 대기";
  const pct = value <= 1 ? value * 100 : value;
  return `${Math.round(pct)}% 커버리지`;
}

function surfaceRowsReturned(payload: TickerSurfacePayload | null | undefined): number {
  const value = payload?.counts?.rows_returned;
  return isFiniteNumber(value) ? value : 0;
}

function parseSurfaceNumber(value: unknown): number | null {
  if (isFiniteNumber(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[%,$]/g, "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanSurfaceText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text !== "-" ? text : null;
}

function firstEtfSurfaceRow(payload: TickerSurfacePayload | null | undefined): { label: string | null; row: Record<string, unknown> } | null {
  const surfaces = payload?.sections?.etfs ?? [];
  for (const surface of surfaces) {
    for (const row of surface.matches ?? []) {
      if (row && typeof row === "object" && !Array.isArray(row)) {
        return { label: surface.label ?? null, row };
      }
    }
  }
  return null;
}

function etfSurfaceFallback(payload: TickerSurfacePayload | null | undefined, symbol: string) {
  const match = firstEtfSurfaceRow(payload);
  const row = match?.row ?? null;
  return {
    name: cleanSurfaceText(row?.n) ?? cleanSurfaceText(row?.fund_name) ?? cleanSurfaceText(row?.name) ?? symbol,
    category: cleanSurfaceText(row?.assetClass) ?? match?.label ?? "ETF 목록",
    price: parseSurfaceNumber(row?.price ?? row?.stock_price),
    changePct: parseSurfaceNumber(row?.change ?? row?.pct_change),
    inceptionDate: cleanSurfaceText(row?.inceptionDate),
  };
}

function toFractionSeries(data: NumberSeries | null | undefined): NumberSeries {
  return (data ?? []).map((value) => (isFiniteNumber(value) ? value / 100 : null));
}

function estimateSeries(data: unknown, divisor = 1): Record<string, MaybeNumber> | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const next: Record<string, MaybeNumber> = {};
  for (const key of ["fy1", "fy2", "fy3"]) {
    const value = record[key];
    next[key] = isFiniteNumber(value) ? value / divisor : null;
  }
  return Object.values(next).some(isFiniteNumber) ? next : null;
}

function validAnalyzerPerBand(row: AnalyzerRow | null | undefined) {
  if (
    !row ||
    !isFiniteNumber(row.perBandCurrent) ||
    !isFiniteNumber(row.perBandMin) ||
    !isFiniteNumber(row.perBandMax) ||
    row.perBandMin >= row.perBandMax
  ) {
    return null;
  }
  return { current: row.perBandCurrent, min: row.perBandMin, max: row.perBandMax };
}

function validDetailPerBands(perBands: any) {
  if (
    !perBands ||
    !isFiniteNumber(perBands.current) ||
    !isFiniteNumber(perBands.min_8y) ||
    !isFiniteNumber(perBands.avg_8y) ||
    !isFiniteNumber(perBands.max_8y) ||
    perBands.min_8y >= perBands.max_8y
  ) {
    return null;
  }
  return perBands as { current: number; min_8y: number; avg_8y: number; max_8y: number };
}

function perBandPositionText(current: number, min: number, max: number): string {
  const pct = bandPct(current, min, max);
  const cls = bandClass(pct);
  const verdict = cls === "emerald" ? "역사적 저평가" : cls === "rose" ? "역사적 고평가" : "적정 범위";
  return `${(pct * 100).toFixed(0)}% · ${verdict}`;
}
function perBandPositionColor(current: number, min: number, max: number): string {
  const cls = bandClass(bandPct(current, min, max));
  return cls === "emerald" ? "text-emerald-700 bg-emerald-50"
    : cls === "rose" ? "text-rose-700 bg-rose-50"
    : "text-slate-700 bg-slate-50";
}

type ValuationBandSummary = {
  current: number;
  min: number;
  max: number;
  avg?: number | null;
  source: string;
};

type ValuationBandTone = {
  label: string;
  detail: string;
  chipClass: string;
  fillClass: string;
  zone: "deep-discount" | "discount" | "neutral" | "premium" | "overheated" | "trap";
};

function resolveValuationBandSummary(
  rowPerBand: ReturnType<typeof validAnalyzerPerBand>,
  detailPerBands: ReturnType<typeof validDetailPerBands>,
): ValuationBandSummary | null {
  if (detailPerBands) {
    return {
      current: detailPerBands.current,
      min: detailPerBands.min_8y,
      max: detailPerBands.max_8y,
      avg: detailPerBands.avg_8y,
      source: "8Y PER band",
    };
  }
  return rowPerBand ? { ...rowPerBand, source: "Screener PER band" } : null;
}

function valuationBandTone(
  band: ValuationBandSummary,
  signalLens: FenokSignalsSummaryRecord | null | undefined,
): ValuationBandTone {
  const pct = bandPct(band.current, band.min, band.max);
  const avgPct = isFiniteNumber(band.avg) ? bandPct(band.avg, band.min, band.max) : 0.5;
  const neutralStart = Math.max(0.18, avgPct - 0.1);
  const neutralEnd = Math.min(0.82, avgPct + 0.1);
  const weakScores = [
    signalLens?.profitabilityScore,
    signalLens?.growthScore,
    signalLens?.longTermScore,
  ].filter((score): score is number => isFiniteNumber(score) && score < 45);
  const valueTrapWatch = pct < neutralStart && weakScores.length > 0;

  if (valueTrapWatch) {
    return {
      label: "밸류트랩 점검",
      detail: "PER는 낮지만 성장·수익성 점수 약세가 함께 보입니다.",
      chipClass: "border-amber-200 bg-amber-50 text-amber-700",
      fillClass: "bg-amber-500",
      zone: "trap",
    };
  }
  if (pct < neutralStart * 0.55) {
    return {
      label: "강한 할인 구간",
      detail: "PER 밴드 하단 깊숙한 구간입니다. 다음은 성장·마진 방어를 확인합니다.",
      chipClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
      fillClass: "bg-emerald-500",
      zone: "deep-discount",
    };
  }
  if (pct < neutralStart) {
    return {
      label: "할인 구간",
      detail: "현재 PER가 공정가치권 아래에 있습니다.",
      chipClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
      fillClass: "bg-emerald-500",
      zone: "discount",
    };
  }
  if (pct <= neutralEnd) {
    return {
      label: "공정가치권",
      detail: "현재 PER는 평균 밴드의 ±10% 중립권입니다.",
      chipClass: "border-slate-200 bg-white text-slate-700",
      fillClass: "bg-slate-900",
      zone: "neutral",
    };
  }
  if (pct < neutralEnd + (1 - neutralEnd) * 0.55) {
    return {
      label: "프리미엄 구간",
      detail: "현재 PER가 공정가치권 위에 있습니다. 성장 기대와 추정치 상향을 확인합니다.",
      chipClass: "border-rose-200 bg-rose-50 text-rose-700",
      fillClass: "bg-rose-500",
      zone: "premium",
    };
  }
  return {
    label: "과열 프리미엄",
    detail: "PER 밴드 상단권입니다. 기대 성장과 추정치 상향이 필요합니다.",
    chipClass: "border-rose-200 bg-rose-50 text-rose-700",
    fillClass: "bg-rose-600",
    zone: "overheated",
  };
}

function ValuationBandSummaryCard({
  band,
  signalLens,
  variant = "default",
}: {
  band: ValuationBandSummary | null;
  signalLens: FenokSignalsSummaryRecord | null | undefined;
  variant?: "default" | "canvasPlusRail";
}) {
  if (!band) return null;
  const pct = bandPct(band.current, band.min, band.max);
  const clampedPct = Math.max(0, Math.min(100, pct * 100));
  const tone = valuationBandTone(band, signalLens);
  const avgPct = isFiniteNumber(band.avg) ? bandPct(band.avg, band.min, band.max) : 0.5;
  const neutralStartPct = Math.max(18, Math.min(82, avgPct * 100 - 10));
  const neutralEndPct = Math.max(18, Math.min(82, avgPct * 100 + 10));
  const lowMidPct = neutralStartPct * 0.55;
  const highMidPct = neutralEndPct + (100 - neutralEndPct) * 0.55;

  if (variant === "canvasPlusRail") {
    return (
      <article data-stock-summary-module="valuation-band" className="cp-stock-rail-card cp-stock-valuation-card">
        <header className="cp-stock-rail-card__header">
          <div>
            <p className="cp-stock-rail-eyebrow">Valuation Band</p>
            <h2>밸류에이션 밴드</h2>
          </div>
          <span data-tone={tone.zone}>{Math.round(clampedPct)}%</span>
        </header>
        <div
          data-stock-valuation-band-track
          className="cp-stock-valuation-track"
          aria-label={`PER 밴드 ${Math.round(clampedPct)}%, ${tone.label}`}
        >
          <span data-zone="deep-discount" data-stock-valuation-zone="deep-discount" style={{ width: `${lowMidPct}%` }} />
          <span data-zone="discount" data-stock-valuation-zone="discount" style={{ left: `${lowMidPct}%`, width: `${Math.max(0, neutralStartPct - lowMidPct)}%` }} />
          <span data-zone="neutral" data-stock-valuation-zone="neutral" style={{ left: `${neutralStartPct}%`, width: `${Math.max(0, neutralEndPct - neutralStartPct)}%` }} />
          <span data-zone="premium" data-stock-valuation-zone="premium" style={{ left: `${neutralEndPct}%`, width: `${Math.max(0, highMidPct - neutralEndPct)}%` }} />
          <span data-zone="overheated" data-stock-valuation-zone="overheated" style={{ left: `${highMidPct}%`, width: `${Math.max(0, 100 - highMidPct)}%` }} />
          <i style={{ left: `${clampedPct}%` }} />
        </div>
        <div className="cp-stock-valuation-labels">
          <span>{band.min.toFixed(1)}x</span>
          <strong>{band.current.toFixed(1)}x</strong>
          <span>{band.max.toFixed(1)}x</span>
        </div>
        <p data-stock-valuation-verdict={tone.zone} className="cp-stock-rail-card__summary">{tone.label} · {tone.detail}</p>
      </article>
    );
  }

  return (
    <div data-stock-summary-module="valuation-band" className="rounded-lg border border-[var(--c-line)] bg-[var(--c-panel)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">밸류에이션 판정</p>
          <p data-stock-valuation-verdict={tone.zone} className="mt-1 text-sm font-black text-slate-900">{tone.label}</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black tabular-nums ${tone.chipClass}`}>
          밴드 {Math.round(clampedPct)}%
        </span>
      </div>
      <div className="mt-3">
        <div
          data-stock-valuation-band-track
          className="relative h-3 overflow-hidden rounded-full border border-slate-200 bg-white"
          aria-label={`PER 밴드 ${Math.round(clampedPct)}%, ${tone.label}`}
        >
          <span data-stock-valuation-zone="deep-discount" className="absolute inset-y-0 left-0 bg-emerald-600/45" style={{ width: `${lowMidPct}%` }} />
          <span data-stock-valuation-zone="discount" className="absolute inset-y-0 bg-emerald-400/28" style={{ left: `${lowMidPct}%`, width: `${Math.max(0, neutralStartPct - lowMidPct)}%` }} />
          <span data-stock-valuation-zone="neutral" className="absolute inset-y-0 bg-white" style={{ left: `${neutralStartPct}%`, width: `${Math.max(0, neutralEndPct - neutralStartPct)}%` }} />
          <span data-stock-valuation-zone="premium" className="absolute inset-y-0 bg-rose-300/30" style={{ left: `${neutralEndPct}%`, width: `${Math.max(0, highMidPct - neutralEndPct)}%` }} />
          <span data-stock-valuation-zone="overheated" className="absolute inset-y-0 bg-rose-500/45" style={{ left: `${highMidPct}%`, width: `${Math.max(0, 100 - highMidPct)}%` }} />
          <span className="absolute inset-y-[-3px] w-[3px] rounded-full bg-slate-900 shadow-sm" style={{ left: `${clampedPct}%`, transform: "translateX(-1.5px)" }} />
          <span className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ${tone.fillClass}`} style={{ left: `${clampedPct}%` }} />
        </div>
        <div className="mt-1 grid grid-cols-3 text-[9px] font-black tabular-nums text-slate-500">
          <span>{band.min.toFixed(1)}x</span>
          <span className="text-center">{isFiniteNumber(band.avg) ? `${band.avg.toFixed(1)}x ±10%` : band.source}</span>
          <span className="text-right">{band.max.toFixed(1)}x</span>
        </div>
      </div>
      <p className="mt-2 text-[11px] font-semibold leading-5 text-slate-600">
        현재 PER {band.current.toFixed(1)}x · {tone.detail}
      </p>
    </div>
  );
}

function FenokEdgeDonutCard({ record }: { record: FenokSignalsSummaryRecord | null | undefined }) {
  const score = resolveFenokEdgeScore(record);
  const coverage = record?.lensCoverageRatio ?? record?.coverageRatio;
  const asOfLabel = fmtKstMinute(record?.asOf);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = score === null ? circumference : circumference * (1 - score / 100);
  const gradientId = `cp-stock-edge-gauge-gradient-${stockTabDomSafe(record?.symbol ?? "stock")}`;
  const rows = [
    { label: "수익성", value: record?.profitabilityScore },
    { label: "성장성", value: record?.growthScore },
    { label: "수급", value: record?.technicalFlowScore },
    { label: "리스크", value: record?.downsidePressureScore },
  ];

  return (
    <article className="cp-stock-rail-card cp-stock-edge-card">
      <header className="cp-stock-rail-card__header">
        <div>
          <p className="cp-stock-rail-eyebrow">Fenok Edge</p>
          <h2>종합 신호 점수</h2>
        </div>
        <span>{formatCoverageRatio(coverage)}</span>
      </header>
      <div className="cp-edge-gauge cp-stock-edge-gauge" data-tone={score !== null && score >= 65 ? "positive" : "neutral"}>
        <svg viewBox="0 0 120 120" role="img" aria-label={`Fenok Edge ${score ?? "대기"}점`}>
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="20%" x2="100%" y2="80%">
              <stop offset="0%" stopColor="var(--cp-positive)" />
              <stop offset="100%" stopColor="var(--cp-accent)" />
            </linearGradient>
          </defs>
          <circle className="cp-edge-gauge__track" cx="60" cy="60" r={radius} />
          <circle
            className="cp-edge-gauge__progress"
            cx="60"
            cy="60"
            r={radius}
            style={{ stroke: `url(#${gradientId})`, strokeDasharray: circumference, strokeDashoffset: offset }}
          />
        </svg>
        <div className="cp-edge-gauge__score">
          <strong>{score ?? "—"}</strong>
          <span>{fenokEdgeLabel(score)}</span>
        </div>
      </div>
      <div className="cp-stock-edge-rows">
        {rows.map((row) => (
          <div key={row.label}>
            <span>{row.label}</span>
            <strong>{isFiniteNumber(row.value) ? Math.round(row.value) : "—"}</strong>
          </div>
        ))}
      </div>
      <p className="cp-stock-rail-card__summary">
        {asOfLabel ? `신호 기준 ${asOfLabel}` : record === undefined ? "신호 로딩 중" : "신호 데이터 대기"}
      </p>
    </article>
  );
}

function FinancialSnapshotRail({
  data,
  loading,
  currency,
}: {
  data: StockanalysisFinancialPayload | null | undefined;
  loading: boolean;
  currency: string;
}) {
  if (loading) {
    return (
      <article className="cp-stock-rail-card cp-stock-financial-snapshot" aria-busy="true">
        <header className="cp-stock-rail-card__header">
          <div>
            <p className="cp-stock-rail-eyebrow">Financials</p>
            <h2>TTM 재무 스냅샷</h2>
          </div>
        </header>
        <div className="cp-stock-skeleton-stack">
          {[0, 1, 2].map((item) => <span key={item} />)}
        </div>
      </article>
    );
  }

  const annual = data?.statements?.annual ?? {};
  const metrics = [
    {
      label: "매출",
      value: formatCandidateMetric(firstFiniteValue(findFinancialRow(annual.income, ["revenue"])), currency),
      note: "최근 12개월",
    },
    {
      label: "영업이익",
      value: formatCandidateMetric(firstFiniteValue(findFinancialRow(annual.income, ["operatingIncome"])), currency),
      note: "영업 체력",
    },
    {
      label: "FCF",
      value: formatCandidateMetric(firstFiniteValue(findFinancialRow(annual.cash_flow, ["fcf", "leveredFCF", "unleveredFCF"])) ?? firstFiniteValue(findFinancialRow(annual.income, ["fcf"])), currency),
      note: "현금 창출",
    },
  ];

  return (
    <article className="cp-stock-rail-card cp-stock-financial-snapshot">
      <header className="cp-stock-rail-card__header">
        <div>
          <p className="cp-stock-rail-eyebrow">Financials</p>
          <h2>TTM 재무 스냅샷</h2>
        </div>
        <span>{fmtKstMinute(data?.fetched_at) ?? "—"}</span>
      </header>
      <div className="cp-stock-financial-list">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <em>{metric.note}</em>
          </div>
        ))}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// MiniBarChart — HTML/CSS bar chart for 재무 추이
// ---------------------------------------------------------------------------

function MiniBarChart({
  actuals, estimates, years, color, formatValue = fmtLarge,
}: {
  actuals: NumberSeries;
  estimates: Record<string, MaybeNumber> | null;
  years: string[];
  color: string;
  formatValue?: (value: number) => string;
}) {
  const estKeys: string[] = [];
  if (estimates) for (const k of ["fy1", "fy2", "fy3"]) {
    if (isFiniteNumber(estimates[k])) estKeys.push(k);
  }
  const bars = [
    ...actuals.map((value, i) => ({
      key: `actual-${i}`,
      label: (years[years.length - actuals.length + i] ?? years[i] ?? "").replace("FY", ""),
      value,
      estimate: false,
    })),
    ...estKeys.map((key) => ({
      key,
      label: ESTIMATE_LABELS[key] ?? key.toUpperCase(),
      value: estimates?.[key] ?? null,
      estimate: true,
    })),
  ];
  const allVals = finiteValues(bars.map((b) => b.value));
  if (allVals.length === 0) return <span className="text-xs text-slate-300">—</span>;
  const minVal = Math.min(...allVals, 0);
  const maxVal = Math.max(...allVals, 0);
  const range = maxVal - minVal || 1;
  const clampPct = (v: number) => Math.max(0, Math.min(100, v));
  const yPct = (v: number) => clampPct(((maxVal - v) / range) * 100);
  const zeroPct = yPct(0);
  const shape = (value: MaybeNumber) => {
    if (!isFiniteNumber(value)) return null;
    if (value === 0) return { top: clampPct(Math.min(zeroPct, 98)), height: 2 };
    const y = yPct(value);
    const height = Math.max(2, Math.abs(y - zeroPct));
    const top = value > 0 ? Math.min(y, 100 - height) : Math.min(zeroPct, 100 - height);
    return { top: clampPct(top), height: clampPct(height) };
  };
  const latestActual = [...bars].reverse().find((bar) => !bar.estimate && isFiniteNumber(bar.value));
  const nextEstimate = bars.find((bar) => bar.estimate && isFiniteNumber(bar.value));
  const axisLabel = `범위 ${formatValue(minVal)}~${formatValue(maxVal)} · 0선 ${formatValue(0)}`;

  return (
    <div className="space-y-1">
      <div className="truncate text-[8px] font-bold tabular-nums text-slate-500" title={axisLabel}>
        {axisLabel}
      </div>
      <div className="relative flex gap-[2px]" style={{ height: 72 }}>
        <span
          className="pointer-events-none absolute left-0 right-0 border-t border-slate-300/80"
          style={{ top: `${zeroPct}%` }}
        />
        {bars.map((bar) => {
          const s = shape(bar.value);
          const barColor = isFiniteNumber(bar.value) && bar.value < 0 ? "var(--c-down)" : color;
          const estimateBarColor = `color-mix(in srgb, ${barColor} 28%, transparent)`;
          const label = `${bar.label}${bar.estimate ? " 추정" : ""} ${isFiniteNumber(bar.value) ? formatValue(bar.value) : "—"}`;
          const tooltipTop = s ? Math.max(0, s.top - 18) : 0;
          return (
            <div
              key={bar.key}
              className="group relative h-full flex-1 outline-none"
              title={label}
              aria-label={label}
              tabIndex={0}
            >
              {s ? (
                <div
                  className="absolute left-0 right-0 rounded-sm"
                  style={{
                    top: `${s.top}%`,
                    height: `${s.height}%`,
                    backgroundColor: bar.estimate ? estimateBarColor : barColor,
                    border: bar.estimate ? `2px dashed ${barColor}` : undefined,
                  }}
                />
              ) : null}
              <span
                className="pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--c-line)] bg-[var(--c-panel)] px-1.5 py-0.5 text-[10px] font-black tabular-nums text-[var(--c-ink-2)] opacity-0 shadow-sm transition-opacity group-focus:opacity-100 group-hover:opacity-100"
                style={{ top: `${tooltipTop}%` }}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex text-[8px] font-bold text-slate-500">
        {bars.map((bar) => (
          <span key={bar.key} className={`flex-1 text-center ${bar.estimate ? "text-slate-500" : ""}`}>
            {bar.label}
          </span>
        ))}
      </div>
      <div className="flex text-[8px] font-black tabular-nums text-slate-500">
        {bars.map((bar) => (
          <span key={`${bar.key}-value`} className={`min-w-0 flex-1 truncate text-center ${bar.estimate ? "text-slate-500" : ""}`}>
            {isFiniteNumber(bar.value) ? formatValue(bar.value) : "—"}
          </span>
        ))}
      </div>
      <div className="flex min-w-0 justify-between gap-2 text-[9px] font-black tabular-nums text-slate-500">
        <span className="min-w-0 truncate">
          최신 {latestActual ? `${latestActual.label} ${formatValue(latestActual.value as number)}` : "—"}
        </span>
        <span className="min-w-0 truncate text-slate-500">
          추정 {nextEstimate ? `${nextEstimate.label} ${formatValue(nextEstimate.value as number)}` : "—"}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CompactFinancialTable
// ---------------------------------------------------------------------------

function CompactFinancialTable({ detail, years }: { detail: any; years: string[] }) {
  const estKeys = ["fy1", "fy2", "fy3"];
  const s = (n: number) => n >= 1000 ? fmtLarge(n) : `${n.toFixed(1)}`;
  const usd = (n: number) => `$${n.toFixed(2)}`;
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const rows: Array<{ label: string; actuals: NumberSeries | null; estimates: Record<string, MaybeNumber> | null; fmt: (v: number) => string; color: string }> = [
    { label: "매출", actuals: numberSeries(detail.income_statement?.revenue), estimates: detail.income_statement_estimates?.revenue ?? null, fmt: s, color: "var(--c-up)" },
    { label: "영업이익", actuals: numberSeries(detail.income_statement?.operating_income), estimates: detail.income_statement_estimates?.operating_income ?? null, fmt: s, color: "var(--c-info)" },
    { label: "순이익", actuals: numberSeries(detail.income_statement?.net_income), estimates: detail.income_statement_estimates?.net_income ?? null, fmt: s, color: "var(--c-recovery)" },
    { label: "EPS", actuals: numberSeries(detail.per_share?.eps), estimates: detail.per_share_estimates?.eps ?? null, fmt: usd, color: "var(--c-brand)" },
    { label: "FCF", actuals: numberSeries(detail.cash_flow?.fcf), estimates: detail.cash_flow_estimates?.fcf ?? null, fmt: s, color: "var(--c-warn)" },
    { label: "DPS", actuals: numberSeries(detail.dividend?.dps), estimates: detail.dividend_estimates?.dps ?? null, fmt: usd, color: "var(--c-info)" },
  ];
  const validRows = rows.filter((r) => finiteValues(r.actuals).length > 0);
  if (validRows.length === 0) return null;

  return (
    <div className="-mx-1 mt-3 overflow-x-auto px-1">
      <table data-stock-financial-table="compact" className="w-full min-w-[500px] text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500">
            <th className="sticky left-0 z-20 min-w-[5.5rem] bg-[var(--c-panel)] px-2 py-1.5 text-left shadow-[2px_0_0_var(--c-line-2)]" />
            {years.map((y) => <th key={y} className="px-2 py-1.5 text-right">{y}</th>)}
            {estKeys.map((k) => (
              <th
                key={k}
                data-stock-financial-estimate-column="header"
                data-stock-financial-estimate-key={k}
                className="border-l border-dashed border-slate-200 bg-sky-50/70 px-2 py-1.5 text-right text-slate-600"
              >
                <MetricHelp label={`${ESTIMATE_LABELS[k] ?? k.toUpperCase()}(E)`} metricKey={k} align="right" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {validRows.map((row) => {
            const completeness = estimateCompletenessFromSeries(row.estimates);
            const showGap = hasEstimateGap(completeness);
            const isExpanded = expandedRow === row.label;
            return (
              <Fragment key={row.label}>
                <tr className="border-b border-slate-100 last:border-b-0">
                  <td className="sticky left-0 z-10 min-w-[5.5rem] bg-[var(--c-panel)] px-2 py-1.5 text-[10px] font-bold text-slate-700 shadow-[2px_0_0_var(--c-line-2)]">
                    <span className="block">{row.label}</span>
                    <button
                      type="button"
                      data-stock-financial-row-chart-button
                      aria-expanded={isExpanded}
                      aria-label={`${row.label} 추이 차트 ${isExpanded ? "접기" : "펼치기"}`}
                      onClick={() => setExpandedRow(isExpanded ? null : row.label)}
                      className="mt-1 inline-flex min-h-7 min-w-9 items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-[9px] font-black text-slate-600 transition hover:border-brand-interactive hover:text-brand-interactive"
                    >
                      추이
                    </button>
                    {showGap ? (
                      <span className={`mt-1 inline-flex rounded-full px-1.5 py-[1px] text-[9px] font-black ${estimateCompletenessTone(completeness)}`}>
                        {completeness.label}
                      </span>
                    ) : null}
                  </td>
                  {row.actuals!.map((v, i) => (
                    <td key={i} className="px-2 py-1.5 text-right orbitron tabular-nums font-semibold text-slate-900">{isFiniteNumber(v) ? row.fmt(v) : "—"}</td>
                  ))}
                  {estKeys.map((k) => (
                    <td
                      key={k}
                      data-stock-financial-estimate-column="cell"
                      data-stock-financial-estimate-key={k}
                      className="border-l border-dashed border-slate-100 bg-sky-50/60 px-2 py-1.5 text-right orbitron tabular-nums font-semibold text-slate-600"
                    >
                      {isFiniteNumber(row.estimates?.[k]) ? row.fmt(row.estimates![k] as number) : "—"}
                    </td>
                  ))}
                </tr>
                {isExpanded ? (
                  <tr data-stock-financial-row-chart-panel={row.label} className="border-b border-slate-100 bg-slate-50/70">
                    <td className="sticky left-0 z-10 bg-slate-50 px-2 py-2 text-[10px] font-black text-slate-500 shadow-[2px_0_0_var(--c-line-2)]">
                      차트
                    </td>
                    <td colSpan={years.length + estKeys.length} className="px-2 py-2">
                      <MiniBarChart actuals={row.actuals ?? []} estimates={row.estimates} years={years} color={row.color} formatValue={row.fmt} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <p data-stock-financial-estimate-legend className="mt-1 text-[9px] font-semibold text-slate-500">
        (E) = 시장 예상치 · 점선 배경은 실제 실적과 분리된 추정 구간
      </p>
    </div>
  );
}

function DividendPanel({
  detail,
  yfData,
  years,
  currency,
  highlight,
}: {
  detail: any;
  yfData: any;
  years: string[];
  currency: string;
  highlight: boolean;
}) {
  const info = yfData?.info && typeof yfData.info === "object" ? yfData.info : {};
  const dividendYield = isFiniteNumber(info.dividendYield) ? info.dividendYield : null; // yf finance uses percent points here.
  const payoutRatio = isFiniteNumber(info.payoutRatio) ? info.payoutRatio : null;
  const dpsSeries = numberSeries(detail?.dividend?.dps);
  const dpsValues = finiteValues(dpsSeries);
  const latestDps = lastFinite(dpsSeries);
  const estimateDps = detail?.dividend_estimates?.dps ?? null;
  const nextDps = ["fy1", "fy2", "fy3"]
    .map((key) => estimateDps?.[key])
    .find((value) => isFiniteNumber(value)) ?? null;
  const dividends = yfData?.dividends && typeof yfData.dividends === "object" && !Array.isArray(yfData.dividends)
    ? yfData.dividends
    : null;
  const dividendDates = dividends ? Object.keys(dividends).sort() : [];
  const historyValue = dividendDates.length > 0
    ? `${dividendDates.length.toLocaleString()}회`
    : dpsValues.length > 0
      ? `${dpsValues.length}년 DPS`
      : "—";
  const historyNote = dividendDates.length > 0
    ? `${dividendDates[0]} ~ ${dividendDates[dividendDates.length - 1]}`
    : dpsValues.length > 0
      ? "StockAnalysis DPS series"
      : "배당 데이터 없음";
  const hasDividendData = dividendYield !== null || payoutRatio !== null || dpsValues.length > 0 || dividendDates.length > 0;

  return (
    <section
      id="dividend"
      data-stock-dividend-panel
      tabIndex={-1}
      className={`mt-5 scroll-mt-24 rounded-lg border p-3 transition ${
        highlight ? "border-emerald-400 bg-emerald-50/80 shadow-[var(--sh-sm)]" : "border-slate-200 bg-slate-50/60"
      }`}
      aria-label="배당 분석"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-[11px] font-black tracking-[0.08em] text-slate-700">배당 분석</h4>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            배당수익률, 배당성향, DPS 이력을 재무 흐름과 함께 확인합니다.
          </p>
        </div>
        {!hasDividendData ? (
          <span data-stock-dividend-empty className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-black text-slate-500">
            배당 데이터 없음
          </span>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div data-stock-dividend-metric="yield" className="rounded-md border border-slate-200 bg-white px-3 py-2">
          <p className="text-[10px] font-bold text-slate-500">배당수익률</p>
          <p className="orbitron tabular-nums text-sm font-black text-slate-900">{dividendYield !== null ? `${dividendYield.toFixed(2)}%` : "—"}</p>
          <p className="mt-1 text-[10px] font-semibold text-slate-500">Yahoo Finance 기준</p>
        </div>
        <div data-stock-dividend-metric="payout" className="rounded-md border border-slate-200 bg-white px-3 py-2">
          <p className="text-[10px] font-bold text-slate-500">배당성향</p>
          <p className="orbitron tabular-nums text-sm font-black text-slate-900">{payoutRatio !== null ? `${(payoutRatio * 100).toFixed(1)}%` : "—"}</p>
          <p className="mt-1 text-[10px] font-semibold text-slate-500">순이익 대비 지급 비율</p>
        </div>
        <div data-stock-dividend-metric="history" className="rounded-md border border-slate-200 bg-white px-3 py-2">
          <p className="text-[10px] font-bold text-slate-500">배당 이력</p>
          <p className="orbitron tabular-nums text-sm font-black text-slate-900">{historyValue}</p>
          <p className="mt-1 text-[10px] font-semibold text-slate-500">{historyNote}</p>
        </div>
      </div>

      {dpsValues.length > 0 ? (
        <div data-stock-dividend-history-chart className="mt-4 border-t border-slate-200 pt-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-black tracking-[0.08em] text-slate-500">DPS 추이</p>
            <p className="text-[10px] font-semibold text-slate-500">
              최근 {latestDps !== null ? formatMoney(latestDps, currency) : "—"} · 추정 {isFiniteNumber(nextDps) ? formatMoney(nextDps, currency) : "—"}
            </p>
          </div>
          <MiniBarChart actuals={dpsSeries} estimates={estimateDps} years={years} color="var(--c-info)" formatValue={(value) => formatMoney(value, currency)} />
        </div>
      ) : (
        <p data-stock-dividend-empty className="mt-4 rounded-md border border-dashed border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500">
          이 티커에서는 DPS 시계열을 찾지 못했습니다. 수익률/성향 값이 없으면 배당 분석은 빈 상태로 유지됩니다.
        </p>
      )}
    </section>
  );
}

function StockEstimatesPanel({
  detail,
  years,
  currency,
  variant = "default",
}: {
  detail: any;
  years: string[];
  currency: string;
  variant?: "default" | "canvasPlus";
}) {
  const [granularity, setGranularity] = useState<"annual" | "quarterly">("annual");
  const fy1Per = detail.valuation_estimates?.per?.fy1;
  const fy1Revenue = detail.income_statement_estimates?.revenue?.fy1;
  const fy1Eps = detail.per_share_estimates?.eps?.fy1;
  const fy1RevenueGrowth = detail.growth_estimates?.revenue_growth?.fy1;
  const fy1EpsGrowth = detail.growth_estimates?.eps_growth?.fy1;
  const epsChange = detail.eps_consensus?.weekly_change?.fy_plus_1;
  const consensusCards = [
    { label: "FY+1 PER", value: isFiniteNumber(fy1Per) ? `${fy1Per.toFixed(1)}x` : "—", note: "밸류 컨센서스" },
    { label: "FY+1 매출", value: isFiniteNumber(fy1Revenue) ? fmtLarge(fy1Revenue) : "—", note: "연간 추정" },
    { label: "FY+1 EPS", value: isFiniteNumber(fy1Eps) ? formatMoney(fy1Eps, currency) : "—", note: "비GAAP 여부 원문 확인" },
    { label: "매출 성장", value: fmtWholeSignedPct(fy1RevenueGrowth), note: "FY+1 YoY" },
    { label: "EPS 성장", value: fmtWholeSignedPct(fy1EpsGrowth), note: "FY+1 YoY" },
    { label: "EPS 변화", value: isFiniteNumber(epsChange) ? fmtPct(epsChange) : "—", note: "최근 주간 변화" },
  ];

  const body = (
    <>
      <div data-stock-estimates-consensus-summary className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {consensusCards.map((card) => (
          <div key={card.label} data-stock-estimates-consensus-card className="rounded-xl border border-slate-200 bg-white/80 px-3 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">{card.label}</p>
            <p className="orbitron mt-1 text-base font-black tabular-nums text-slate-950">{card.value}</p>
            <p className="mt-1 text-[10px] font-semibold text-slate-500">{card.note}</p>
          </div>
        ))}
      </div>
      <div data-stock-estimates-granularity-control className="mt-4 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
        {[
          { key: "annual" as const, label: "연간" },
          { key: "quarterly" as const, label: "분기" },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            data-stock-estimates-granularity={item.key}
            aria-pressed={granularity === item.key}
            onClick={() => setGranularity(item.key)}
            className={`min-h-9 rounded-md px-3 text-[11px] font-black transition ${
              granularity === item.key
                ? "bg-white text-slate-950 shadow-sm"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {granularity === "annual" ? (
        <div data-stock-estimates-annual-panel data-stock-estimates-detail-table className="mt-3">
          <RevisionPulse detail={detail} />
          <CompactFinancialTable detail={detail} years={years} />
        </div>
      ) : (
        <div data-stock-estimates-quarterly-panel className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3">
          <p className="text-[11px] font-black text-slate-800">분기 추정치 연결 대기</p>
          <p className="mt-1 text-[10px] font-semibold leading-4 text-slate-500">
            현재 공개 추정치 정규화는 FY+1~3 연간 축을 우선 표시합니다. 분기 컨센서스가 들어오면 같은 순서로 요약 → 변화 → 상세 표를 채웁니다.
          </p>
        </div>
      )}
      <p data-stock-estimate-disclosure="true" className="mt-3 text-[10px] font-semibold leading-4 text-slate-500">
        출처: StockAnalysis/Yahoo 계열 추정치 정규화 데이터. EPS 기준(희석/조정 여부)은 제공자 원문 확인이 필요합니다.
      </p>
    </>
  );

  if (variant === "canvasPlus") return body;

  return <SectionCard title="추정치 변화">{body}</SectionCard>;
}

// ---------------------------------------------------------------------------
// GuruSection
// ---------------------------------------------------------------------------

function GuruSection({ f13Entries, ticker }: { f13Entries: F13Entry[] | null; ticker: string }) {
  const [tradesChip, setTradesChip] = useState<{ bought?: any; sold?: any; metadata?: any } | null>(null);
  const tradeInvestorName = (value: any) => {
    if (typeof value === "string") return value;
    if (typeof value?.name === "string") return value.name;
    if (typeof value?.id === "string") return value.id;
    return null;
  };
  const tradeAmount = (value: unknown) => formatCompactMoney(value, "USD");
  const tradeQuarter = (metadata: any) => {
    const quarter = typeof metadata?.quarter === "string" && metadata.quarter.trim() ? metadata.quarter.trim() : null;
    const generatedAt = typeof metadata?.generated_at === "string" && metadata.generated_at.trim()
      ? metadata.generated_at.slice(0, 10)
      : null;
    return { quarter, generatedAt };
  };
  const tradeRows = useMemo<SmartMoneyTrade[]>(() => {
    const rows: SmartMoneyTrade[] = [];
    if (tradesChip?.bought) rows.push({ ...tradesChip.bought, action: "buy" });
    if (tradesChip?.sold) rows.push({ ...tradesChip.sold, action: "sell" });
    return rows.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
  }, [tradesChip]);

  useEffect(() => {
    let cancelled = false;
    loadTradesRanking().then((data) => {
      if (cancelled || !data) return;
      const upper = ticker.toUpperCase();
      const b = data.bought.find((r: any) => r?.ticker === upper);
      const s = data.sold.find((r: any) => r?.ticker === upper);
      setTradesChip({ bought: b, sold: s, metadata: data.metadata });
    });
    return () => { cancelled = true; };
  }, [ticker]);

  const holders = useMemo(() => {
    if (!f13Entries || f13Entries.length === 0) return [];
    const byInv = new Map<string, { shares: number; weight: number }>();
    for (const e of f13Entries) {
      if (typeof e.investor !== "string" || e.investor.trim() === "") continue;
      const cur = byInv.get(e.investor);
      const shares = isFiniteNumber(e.shares) ? e.shares : 0;
      const weight = isFiniteNumber(e.weight) ? e.weight : 0;
      if (cur) { cur.shares += shares; cur.weight += weight; }
      else { byInv.set(e.investor, { shares, weight }); }
    }
    return [...byInv.entries()].map(([investor, v]) => ({ investor, ...v }))
      .sort((a, b) => b.weight - a.weight).slice(0, 10);
  }, [f13Entries]);

  if ((!f13Entries || f13Entries.length === 0) && !tradesChip?.bought && !tradesChip?.sold) return null;
  const { quarter, generatedAt } = tradeQuarter(tradesChip?.metadata);
  const reportBasisLabel = [quarter ?? "최근 분기", generatedAt].filter(Boolean).join(" · ");
  const holderCount = f13Entries
    ? new Set(f13Entries.map((entry) => entry.investor).filter((investor) => typeof investor === "string" && investor.trim() !== "")).size
    : 0;

  return (
    <section data-smart-money-section="root">
      <h2 className="mb-3 text-[13px] font-black uppercase tracking-[0.12em] text-slate-500">투자 대가 동향</h2>
      <div data-smart-money-section="diff" className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">분기 매매 변화</p>
            <p className="mt-1 text-sm font-black text-slate-900">
              {holderCount > 0 ? `${holderCount}개 투자자 보유` : "보유자 집계 중"}
              {tradeRows.length > 0 ? ` · ${tradeRows.length}개 최근 변화 포착` : ""}
            </p>
          </div>
          <span data-smart-money-asof className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-black text-slate-500">
            {reportBasisLabel}
          </span>
        </div>
        {tradeRows.length > 0 ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {tradeRows.map((trade) => {
              const isBuy = trade.action === "buy";
              const countLabel = isBuy ? "매수 참여" : "매도 참여";
              const eventCount = isBuy ? trade.new_count : trade.exit_count;
              const eventLabel = isBuy ? "신규" : "청산";
              const investorName = tradeInvestorName(trade.top_investor);
              return (
                <div
                  key={trade.action}
                  className={`rounded-lg border px-3 py-2 ${isBuy ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`text-[10px] font-black uppercase tracking-[0.08em] ${isBuy ? "text-emerald-700" : "text-rose-700"}`}>
                      {isBuy ? "순매수 변화" : "순매도 변화"}
                    </span>
                    <span className={`rounded-full bg-white/75 px-2 py-0.5 text-[9px] font-black tabular-nums ${isBuy ? "text-emerald-700" : "text-rose-700"}`}>
                      {isFiniteNumber(trade.rank) ? `#${trade.rank}` : "rank —"}
                    </span>
                  </div>
                  <p className="mt-1 orbitron text-base font-black tabular-nums text-slate-950">{tradeAmount(trade.amount)}</p>
                  <p className="mt-1 text-[10px] font-bold text-slate-600">
                    {countLabel} {isFiniteNumber(trade.investors_count) ? `${trade.investors_count}명` : "—"}
                    {isFiniteNumber(eventCount) && eventCount > 0 ? ` · ${eventLabel} ${eventCount}명` : ""}
                  </p>
                  {investorName ? <p className="mt-1 truncate text-[10px] font-semibold text-slate-500">대표 {investorName}</p> : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-[11px] font-semibold text-slate-500">최근 분기 순매수·순매도 랭킹에는 포함되지 않았습니다.</p>
        )}
        <p data-smart-money-lag-disclosure className="mt-2 text-[9px] font-semibold text-slate-500">
          13F는 분기말 스냅샷 기반이며 최대 45일 지연될 수 있습니다. 보유자별 표는 같은 기준분기/생성일로 읽어야 합니다.
        </p>
      </div>
      {holders.length > 0 ? (
        <div data-smart-money-section="holdings" className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[410px] text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500">
                <th className="px-2 py-1.5 text-left">투자자</th>
                <th className="px-2 py-1.5 text-right">주식수</th>
                <th className="px-2 py-1.5 text-right">비중</th>
                <th data-smart-money-report-date-column className="px-2 py-1.5 text-right">공시/기준</th>
              </tr>
            </thead>
            <tbody>
              {holders.map((h) => (
                <tr key={h.investor} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-2 py-1.5">
                    <TransitionLink
                      href={ROUTES.superinvestorsGuru(h.investor)}
                      data-smart-money-investor-profile-link
                      aria-label={`${h.investor} 투자자 포트폴리오 보기`}
                      className="inline-flex flex-col text-left text-[10px] font-black text-brand-interactive hover:underline"
                    >
                      <span>{h.investor}</span>
                      <span className="text-[9px] font-black uppercase tracking-[0.08em] text-slate-400">포트폴리오</span>
                    </TransitionLink>
                  </td>
                  <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs font-semibold text-slate-900">
                    {h.shares > 0 ? h.shares.toLocaleString() : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs font-semibold text-slate-700">
                    {h.weight > 0 ? `${(h.weight * 100).toFixed(2)}%` : "—"}
                  </td>
                  <td data-smart-money-report-date-cell className="px-2 py-1.5 text-right text-[10px] font-black text-slate-500">
                    {reportBasisLabel}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// MetricWithSpark
// ---------------------------------------------------------------------------

function MetricWithSpark({ label, value, data, estimates, color, years, benchmark, formatValue = (n) => n.toFixed(1) }: {
  label: string;
  value: string;
  data: NumberSeries;
  estimates?: Record<string, MaybeNumber> | null;
  color: string;
  years: string[];
  benchmark?: { label: string; value: MaybeNumber } | null;
  formatValue?: (n: number) => string;
}) {
  const nextEstimateKey = ["fy1", "fy2", "fy3"].find((key) => isFiniteNumber(estimates?.[key])) ?? null;
  const nextEstimate = nextEstimateKey ? estimates?.[nextEstimateKey] : null;
  const estimateCompleteness = estimateCompletenessFromSeries(estimates);
  const showEstimateCompleteness = estimates !== undefined && hasEstimateGap(estimateCompleteness);
  const benchValue = isFiniteNumber(benchmark?.value) ? benchmark.value : null;
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <MetricHelp label={label} className="text-[10px] font-bold text-slate-500" />
        <span className="orbitron tabular-nums text-sm font-black text-slate-900">{value}</span>
      </div>
      {finiteValues(data).length >= 2 ? <div className="mt-1"><Sparkline data={data} color={color} years={years} estimates={estimates ?? undefined} formatValue={formatValue} /></div> : null}
      {(showEstimateCompleteness || isFiniteNumber(nextEstimate) || benchValue !== null) ? (
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] font-black tabular-nums text-slate-500">
          {showEstimateCompleteness ? (
            <span className={`rounded-full px-1.5 py-[1px] ${estimateCompletenessTone(estimateCompleteness)}`}>
              {estimateCompleteness.label}
            </span>
          ) : null}
          {isFiniteNumber(nextEstimate) ? (
            <span>{ESTIMATE_LABELS[nextEstimateKey!] ?? nextEstimateKey!.toUpperCase()} {formatValue(nextEstimate)}</span>
          ) : null}
          {benchValue !== null ? <span>{benchmark?.label ?? "산업"} {formatValue(benchValue)}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KV
// ---------------------------------------------------------------------------

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <MetricHelp label={label} className="text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-500" />
      <span className="orbitron tabular-nums text-xs font-black text-slate-900">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// W4 stock-tab surface redesign — shared SVG/format helpers
// ---------------------------------------------------------------------------

function polarPoint(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function radarPolygonPoints(scores: Array<number | null>, cx: number, cy: number, maxR: number): string {
  const n = scores.length;
  if (n === 0) return "";
  return scores
    .map((score, i) => {
      const r = (maxR * Math.max(0, Math.min(100, score ?? 0))) / 100;
      const [x, y] = polarPoint(cx, cy, r, (360 / n) * i);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function axisToneClass(score: number | null): "positive" | "warning" | "negative" | "neutral" {
  if (!isFiniteNumber(score)) return "neutral";
  if (score >= 70) return "positive";
  if (score >= 45) return "warning";
  return "negative";
}

function axisToneLabel(tone: ReturnType<typeof axisToneClass>): string {
  if (tone === "positive") return "양호";
  if (tone === "warning") return "관리";
  if (tone === "negative") return "약함";
  return "—";
}

function tradeInvestorNameOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as Record<string, unknown>).name === "string") return (value as Record<string, unknown>).name as string;
  if (value && typeof value === "object" && typeof (value as Record<string, unknown>).id === "string") return (value as Record<string, unknown>).id as string;
  return null;
}

// ---------------------------------------------------------------------------
// W4 재무(Financials) tab surface
// ---------------------------------------------------------------------------

function FinancialsHeroCp({
  detail, years, currency, financialCandidate, profitabilityEstimates,
}: {
  detail: any;
  years: string[];
  currency: string;
  financialCandidate: StockanalysisFinancialPayload | null | undefined;
  profitabilityEstimates: ReturnType<typeof deriveProfitabilityEstimates> | null;
}) {
  const revenueActual = numberSeries(detail.income_statement?.revenue);
  const revenueEstimates = detail.income_statement_estimates?.revenue ?? null;
  const marginActual = numberSeries((detail.profitability as any)?.operating_margin);
  const marginEstimatesRaw = profitabilityEstimates?.operating_margin ?? null;
  const revVals = finiteValues(revenueActual);
  if (revVals.length === 0) return null;

  const annual = financialCandidate?.statements?.annual ?? {};
  // financialCandidate is raw currency units (formatCompactMoney); revenueActual (detail.*) is
  // pre-scaled to millions (fmtLarge) — keep the two paired with their own formatter.
  const ttmRevenueCandidate = firstFiniteValue(findFinancialRow(annual.income, ["revenue"]));
  const ttmRevenueDetail = lastFinite(revenueActual);
  const ttmRevenueText = isFiniteNumber(ttmRevenueCandidate)
    ? formatCompactMoney(ttmRevenueCandidate, currency)
    : isFiniteNumber(ttmRevenueDetail)
      ? `$${fmtLarge(ttmRevenueDetail)}`
      : "—";
  const firstRev = revVals[0];
  const lastRev = revVals[revVals.length - 1];
  const growthMultiple = firstRev > 0 ? lastRev / firstRev : null;
  const yoyGrowth = revVals.length >= 2 && revVals[revVals.length - 2] !== 0
    ? (lastRev - revVals[revVals.length - 2]) / Math.abs(revVals[revVals.length - 2])
    : null;
  const marginVals = finiteValues(marginActual);
  const firstMargin = marginVals[0] ?? null;
  const lastMargin = marginVals[marginVals.length - 1] ?? null;
  const marginTrendUp = firstMargin !== null && lastMargin !== null ? lastMargin >= firstMargin : null;

  const estKeys = ["fy1", "fy2", "fy3"] as const;
  const revBars = [
    ...revenueActual.map((v, i) => ({
      label: (years[years.length - revenueActual.length + i] ?? years[i] ?? "").replace("FY", ""),
      value: v,
      estimate: false,
    })),
    ...estKeys.filter((k) => isFiniteNumber(revenueEstimates?.[k])).map((k) => ({
      label: ESTIMATE_LABELS[k] ?? k.toUpperCase(),
      value: revenueEstimates![k] as number,
      estimate: true,
    })),
  ];
  const marginBars = [
    ...marginActual.map((v) => ({ value: v, estimate: false })),
    ...estKeys.filter((k) => isFiniteNumber(marginEstimatesRaw?.[k])).map((k) => ({ value: marginEstimatesRaw![k] as number, estimate: true })),
  ];

  const revValsAll = finiteValues(revBars.map((b) => b.value));
  const maxRev = Math.max(...revValsAll, 1);
  const W = 1000, H = 300, padL = 8, padR = 8, padT = 34, padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = revBars.length;
  const slot = n > 0 ? plotW / n : plotW;
  const barW = Math.max(20, slot * 0.56);
  const xCenterFor = (i: number) => padL + slot * i + slot / 2;
  const yForRev = (v: number) => padT + plotH - (maxRev > 0 ? (Math.max(0, v) / maxRev) * plotH : 0);
  const marginValsAll = finiteValues(marginBars.map((b) => b.value));
  const maxMargin = Math.max(...marginValsAll, 10);
  const yForMargin = (v: number) => padT + plotH - (maxMargin > 0 ? (Math.max(0, v) / maxMargin) * plotH : 0);
  const firstEstimateIndex = revBars.findIndex((b) => b.estimate);

  const actualMarginPoints = marginBars
    .map((b, i) => (!b.estimate && isFiniteNumber(b.value) ? { x: xCenterFor(i), y: yForMargin(b.value) } : null))
    .filter((p): p is { x: number; y: number } => p !== null);
  const estimateMarginPoints = marginBars
    .map((b, i) => (b.estimate && isFiniteNumber(b.value) ? { x: xCenterFor(i), y: yForMargin(b.value) } : null))
    .filter((p): p is { x: number; y: number } => p !== null);
  const marginBridgePoint = actualMarginPoints.length > 0 ? actualMarginPoints[actualMarginPoints.length - 1] : null;
  const toPointsStr = (pts: Array<{ x: number; y: number }>) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const verdictParts: string[] = [];
  if (growthMultiple !== null && growthMultiple > 1.05) verdictParts.push(`매출은 ${years.length}년간 ${growthMultiple.toFixed(1)}배`);
  else if (growthMultiple !== null && growthMultiple > 0 && growthMultiple < 0.95) verdictParts.push(`매출은 ${years.length}년간 ${(1 / growthMultiple).toFixed(1)}배 축소`);
  if (firstMargin !== null && lastMargin !== null) {
    verdictParts.push(`영업이익률은 ${firstMargin.toFixed(0)}%대에서 ${lastMargin.toFixed(0)}%${marginTrendUp ? "까지 확장" : "로 후퇴"}`);
  }

  return (
    <section className="cpw4-hero" data-stock-tab-card="financial-trend">
      <div className="cpw4-hero__top">
        <p className="cpw4-hero__eyebrow">재무 · FINANCIALS</p>
        {yoyGrowth !== null ? (
          <span className={`cpw4-badge ${yoyGrowth >= 0 ? "cpw4-badge--positive" : "cpw4-badge--negative"}`}>
            {yoyGrowth >= 0 ? "▲" : "▼"} {fmtPct(yoyGrowth)} YoY
          </span>
        ) : null}
      </div>
      <div className="cpw4-hero__top" style={{ marginTop: -6 }}>
        <span className="cpw4-hero__number" style={{ fontSize: 34 }}>{ttmRevenueText}</span>
        <span style={{ fontSize: 14, fontWeight: 750, color: "var(--cp-text-muted)" }}>매출(최근 회계연도)</span>
      </div>
      {verdictParts.length > 0 ? <h2 className="cpw4-hero__verdict">{verdictParts.join(", ")}</h2> : null}
      <div className="cpw4-fin-chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="매출 및 영업이익률 추이">
          {firstEstimateIndex >= 0 ? (
            <rect
              x={xCenterFor(firstEstimateIndex) - slot / 2}
              y={padT}
              width={Math.max(0, padL + plotW - (xCenterFor(firstEstimateIndex) - slot / 2))}
              height={plotH}
              fill="var(--cp-surface-strong)"
              opacity="0.5"
            />
          ) : null}
          <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke="var(--cp-divider)" strokeWidth={1} />
          {revBars.map((bar, i) => {
            if (!isFiniteNumber(bar.value)) return null;
            const x = xCenterFor(i) - barW / 2;
            const y = yForRev(bar.value);
            const h = Math.max(2, padT + plotH - y);
            return (
              <g key={`${bar.label}-${i}`}>
                <rect
                  x={x} y={y} width={barW} height={h} rx={4}
                  fill="var(--cp-positive)"
                  opacity={bar.estimate ? 0.32 : 1}
                  stroke={bar.estimate ? "var(--cp-positive)" : "none"}
                  strokeDasharray={bar.estimate ? "3 3" : undefined}
                  strokeWidth={bar.estimate ? 1.5 : 0}
                />
                <text x={xCenterFor(i)} y={Math.max(14, y - 8)} textAnchor="middle" fontSize="12" fontWeight={bar.estimate ? 600 : 800} fill={bar.estimate ? "var(--cp-text-muted)" : "var(--cp-text-strong)"}>
                  ${fmtLarge(bar.value)}
                </text>
                <text x={xCenterFor(i)} y={padT + plotH + 20} textAnchor="middle" fontSize="11.5" fontWeight={bar.estimate ? 600 : 700} fill={bar.estimate ? "var(--cp-text-soft)" : "var(--cp-text-muted)"}>
                  {bar.label}{bar.estimate ? "E" : ""}
                </text>
              </g>
            );
          })}
          {actualMarginPoints.length >= 2 ? (
            <polyline points={toPointsStr(actualMarginPoints)} fill="none" stroke="var(--cp-chart-line-2)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          ) : null}
          {marginBridgePoint && estimateMarginPoints.length > 0 ? (
            <polyline points={toPointsStr([marginBridgePoint, ...estimateMarginPoints])} fill="none" stroke="var(--cp-chart-line-2)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" strokeDasharray="5 4" />
          ) : null}
          {[...actualMarginPoints, ...estimateMarginPoints].map((p, i, arr) => (
            <circle key={i} cx={p.x} cy={p.y} r={i < actualMarginPoints.length ? 3.5 : 3} fill="var(--cp-chart-line-2)" opacity={i < actualMarginPoints.length ? 1 : 0.75} />
          ))}
        </svg>
        <div className="cpw4-fin-chart-legend">
          <span><span className="swatch" style={{ background: "var(--cp-positive)" }} />매출 · 실적</span>
          <span><span className="swatch" style={{ background: "var(--cp-positive)", opacity: 0.32, border: "1.5px dashed var(--cp-positive)" }} />매출 · 컨센서스 추정</span>
          <span><span className="line" />영업이익률(선)</span>
        </div>
      </div>
    </section>
  );
}

function FinancialsTilesCp({
  detail, financialCandidate, currency,
}: {
  detail: any;
  financialCandidate: StockanalysisFinancialPayload | null | undefined;
  currency: string;
}) {
  const annual = financialCandidate?.statements?.annual ?? {};
  // financialCandidate values are raw currency units (formatCompactMoney); detail.* series are
  // pre-scaled to millions (fmtLarge) — pick source and formatter together to avoid unit mismatch.
  const opIncomeCandidate = firstFiniteValue(findFinancialRow(annual.income, ["operatingIncome"]));
  const opIncomeDetail = lastFinite(numberSeries(detail.income_statement?.operating_income));
  const opIncomeText = isFiniteNumber(opIncomeCandidate) ? formatCompactMoney(opIncomeCandidate, currency) : isFiniteNumber(opIncomeDetail) ? `$${fmtLarge(opIncomeDetail)}` : "—";
  const opMarginLast = lastFinite(numberSeries((detail.profitability as any)?.operating_margin));
  const netMarginLast = lastFinite(numberSeries((detail.profitability as any)?.net_margin));
  const roeLast = lastFinite(numberSeries((detail.profitability as any)?.roe));
  const roaLast = lastFinite(numberSeries((detail.profitability as any)?.roa));
  const fcfCandidate = firstFiniteValue(findFinancialRow(annual.cash_flow, ["fcf", "leveredFCF", "unleveredFCF"]));
  const fcfDetail = lastFinite(numberSeries(detail.cash_flow?.fcf));
  const fcfText = isFiniteNumber(fcfCandidate) ? formatCompactMoney(fcfCandidate, currency) : isFiniteNumber(fcfDetail) ? `$${fmtLarge(fcfDetail)}` : "—";

  const tiles = [
    { label: "영업이익", value: opIncomeText, sub: opMarginLast !== null ? `영업이익률 ${opMarginLast.toFixed(1)}%` : undefined },
    { label: "순이익률", value: netMarginLast !== null ? `${netMarginLast.toFixed(1)}%` : "—", sub: [roeLast !== null ? `ROE ${roeLast.toFixed(1)}%` : null, roaLast !== null ? `ROA ${roaLast.toFixed(1)}%` : null].filter(Boolean).join(" · ") || undefined },
    { label: "잉여현금흐름(FCF)", value: fcfText, sub: "영업활동 현금창출" },
  ];
  if (!tiles.some((t) => t.value !== "—")) return null;

  return (
    <div className="cpw4-tile-row">
      {tiles.map((t) => (
        <div className="cpw4-tile" key={t.label}>
          <p className="cpw4-tile__label">{t.label}</p>
          <p className="cpw4-tile__value">{t.value}</p>
          {t.sub ? <p className="cpw4-tile__sub">{t.sub}</p> : null}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// W4 밸류(Valuation/statistics) tab surface
// ---------------------------------------------------------------------------

function ValuationHeroCp({ detailPerBands }: { detailPerBands: { current: number; min_8y: number; avg_8y: number; max_8y: number } }) {
  const { current, min_8y, max_8y, avg_8y } = detailPerBands;
  if (max_8y <= min_8y) return null;
  const pct = bandPct(current, min_8y, max_8y);
  const avgPct = bandPct(avg_8y, min_8y, max_8y);
  const clampedPct = Math.max(0, Math.min(100, pct * 100));
  const diffFromAvg = avg_8y !== 0 ? (current - avg_8y) / avg_8y : 0;
  const zoneLabel = clampedPct < 30 ? "저평가 구간" : clampedPct > 70 ? "고평가 구간" : "평균 밴드 · 중립권";
  const zoneClass = clampedPct < 30 ? "up" : clampedPct > 70 ? "down" : "warn";
  const verdictDetail = Math.abs(diffFromAvg) < 0.03
    ? `현재 PER ${current.toFixed(1)}x는 8년 밸류에이션 밴드의 평균과 거의 일치합니다 — 싸지도, 비싸지도 않은 자리입니다.`
    : diffFromAvg < 0
      ? `현재 PER ${current.toFixed(1)}x는 8년 평균(${avg_8y.toFixed(1)}x) 대비 ${fmtPct(Math.abs(diffFromAvg))} 낮은 자리입니다.`
      : `현재 PER ${current.toFixed(1)}x는 8년 평균(${avg_8y.toFixed(1)}x) 대비 ${fmtPct(diffFromAvg)} 높은 자리입니다.`;

  const W = 1160, trackX = 30, trackW = 1100, trackY = 76, trackH = 34;
  const markerX = trackX + (clampedPct / 100) * trackW;
  const avgX = trackX + Math.max(0, Math.min(100, avgPct * 100)) / 100 * trackW;
  const gradMid = `${Math.max(5, Math.min(95, avgPct * 100)).toFixed(1)}%`;

  return (
    <section className="cpw4-hero" data-stock-tab-card="valuation-band">
      <div className="cpw4-hero__top">
        <p className="cpw4-hero__eyebrow">VALUATION · PER 밴드 위치 (8년)</p>
        <span className="cpw4-val-current-tag"><span className="l">현재 PER</span><span className="v">{current.toFixed(1)}x</span></span>
      </div>
      <h2 className="cpw4-hero__verdict">지금 가격은 <span className={zoneClass}>{zoneLabel}</span>입니다</h2>
      <p className="cpw4-hero__sub">{verdictDetail}</p>
      <div className="cpw4-val-gauge-wrap">
        <svg viewBox={`0 0 ${W} 168`} role="img" aria-label={`PER 밸류에이션 밴드: 최저 ${min_8y.toFixed(1)}배, 평균 ${avg_8y.toFixed(1)}배, 현재 ${current.toFixed(1)}배, 최고 ${max_8y.toFixed(1)}배`}>
          <defs>
            <linearGradient id="cpw4-val-band-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--cp-positive)" />
              <stop offset={gradMid} stopColor="var(--cp-warning)" />
              <stop offset="100%" stopColor="var(--cp-negative)" />
            </linearGradient>
          </defs>
          <rect x={trackX} y={trackY} width={trackW} height={trackH} rx={trackH / 2} fill="url(#cpw4-val-band-grad)" />
          <line x1={avgX} y1={trackY} x2={avgX} y2={trackY + trackH} stroke="#ffffff" strokeWidth={2} opacity={0.85} />
          <line x1={markerX} y1={40} x2={markerX} y2={trackY} stroke="var(--cp-text-strong)" strokeWidth={1.5} strokeDasharray="2 3" />
          <rect x={Math.max(0, markerX - 65)} y={8} width={130} height={30} rx={8} fill="var(--cp-text-strong)" />
          <text x={markerX} y={28} textAnchor="middle" fontSize="14" fontWeight="800" fill="#fff">현재 {current.toFixed(1)}x</text>
          <circle cx={markerX} cy={trackY + trackH / 2} r={9} fill="#fff" stroke="var(--cp-text-strong)" strokeWidth={3} />
          <line x1={trackX} y1={trackY + trackH} x2={trackX} y2={trackY + trackH + 10} stroke="var(--cp-border-strong)" strokeWidth={1.5} />
          <line x1={trackX + trackW} y1={trackY + trackH} x2={trackX + trackW} y2={trackY + trackH + 10} stroke="var(--cp-border-strong)" strokeWidth={1.5} />
          <text x={trackX} y={140} fontSize="16" fontWeight="800" fill="var(--cp-text-strong)">{min_8y.toFixed(1)}x</text>
          <text x={trackX} y={156} fontSize="11" fill="var(--cp-text-soft)">8년 최저</text>
          <text x={trackX + trackW} y={140} textAnchor="end" fontSize="16" fontWeight="800" fill="var(--cp-text-strong)">{max_8y.toFixed(1)}x</text>
          <text x={trackX + trackW} y={156} textAnchor="end" fontSize="11" fill="var(--cp-text-soft)">8년 최고</text>
        </svg>
      </div>
    </section>
  );
}

function ValuationBodyCp({
  yfData, industryBench, detail, profitabilityEstimates, currency,
}: {
  yfData: any;
  industryBench: IndustryBench | null;
  detail: any;
  profitabilityEstimates: ReturnType<typeof deriveProfitabilityEstimates> | null;
  currency: string;
  years: string[];
}) {
  const info = yfData?.info ?? {};
  const trailingPE = isFiniteNumber(info.trailingPE) ? info.trailingPE : null;
  const forwardPE = isFiniteNumber(info.forwardPE) ? info.forwardPE : null;
  const perDeltaPct = trailingPE && forwardPE && trailingPE !== 0 ? (forwardPE - trailingPE) / trailingPE : null;
  const pbr = isFiniteNumber(info.priceToBook) ? info.priceToBook : null;
  const peg = isFiniteNumber(info.pegRatio) ? info.pegRatio : null;
  const evEbitda = isFiniteNumber(info.enterpriseToEbitda) ? info.enterpriseToEbitda : null;
  const evRevenue = isFiniteNumber(info.enterpriseToRevenue) ? info.enterpriseToRevenue : null;

  const rrTiles: Array<{ label: string; body: ReactNode; cap: string }> = [];
  if (trailingPE !== null || forwardPE !== null) {
    rrTiles.push({
      label: "PER TTM → FWD",
      body: (
        <div className="flow">
          <span className="from">{trailingPE !== null ? `${trailingPE.toFixed(1)}x` : "—"}</span>
          <span className="arrow">→</span>
          <span className="to">{forwardPE !== null ? `${forwardPE.toFixed(1)}x` : "—"}</span>
        </div>
      ),
      cap: perDeltaPct !== null ? `선행 PER 컨센서스 반영 시 배수 ${fmtPct(perDeltaPct)}` : "선행 PER 컨센서스 기준",
    });
  }
  if (pbr !== null) rrTiles.push({ label: "PBR", body: <div className="hero-num">{pbr.toFixed(1)}<span className="unit">x</span></div>, cap: isFiniteNumber(info.bookValue) ? `주당 장부가 ${formatMoney(info.bookValue, currency)}` : "Yahoo Finance 기준" });
  if (peg !== null) rrTiles.push({ label: "PEG", body: <div className="hero-num">{peg.toFixed(2)}</div>, cap: peg < 1 ? "1.0 미만 = 이익 성장 대비 저평가 신호" : "1.0 이상 = 이익 성장 대비 프리미엄" });
  if (evEbitda !== null) rrTiles.push({ label: "EV / EBITDA", body: <div className="hero-num">{evEbitda.toFixed(1)}<span className="unit">x</span></div>, cap: evRevenue !== null ? `EV/매출 ${evRevenue.toFixed(1)}x` : "Yahoo Finance 기준" });

  const industryChips: Array<{ label: string; stock: number; ind: number; isFraction: boolean; lowerBetter: boolean }> = [];
  if (industryBench) {
    const push = (label: string, stock: unknown, ind: unknown, isFraction: boolean, lowerBetter: boolean) => {
      const s = isFiniteNumber(stock) ? stock : null;
      const i = isFiniteNumber(ind) ? ind : null;
      if (s !== null && i !== null) industryChips.push({ label, stock: s, ind: i, isFraction, lowerBetter });
    };
    push("PER (TTM)", info.trailingPE, industryBench.trailing_pe, false, true);
    push("FY+1 PER", info.forwardPE, industryBench.forward_pe, false, true);
    push("ROE", info.returnOnEquity, industryBench.roe, true, false);
    push("영업이익률", info.operatingMargins, industryBench.operating_margin, true, false);
    push("순이익률", info.profitMargins, industryBench.net_margin, true, false);
  }

  const profRows = [
    { label: "매출총이익률", now: lastFinite(numberSeries((detail?.profitability as any)?.gross_margin)), fy1: isFiniteNumber(profitabilityEstimates?.gross_margin?.fy1) ? profitabilityEstimates!.gross_margin!.fy1 : null, industry: null as number | null, signed: false },
    { label: "영업이익률", now: lastFinite(numberSeries((detail?.profitability as any)?.operating_margin)), fy1: isFiniteNumber(profitabilityEstimates?.operating_margin?.fy1) ? profitabilityEstimates!.operating_margin!.fy1 : null, industry: isFiniteNumber(industryBench?.operating_margin) ? industryBench!.operating_margin! * 100 : null, signed: false },
    { label: "순이익률", now: lastFinite(numberSeries((detail?.profitability as any)?.net_margin)), fy1: isFiniteNumber(profitabilityEstimates?.net_margin?.fy1) ? profitabilityEstimates!.net_margin!.fy1 : null, industry: isFiniteNumber(industryBench?.net_margin) ? industryBench!.net_margin! * 100 : null, signed: false },
    { label: "ROE", now: lastFinite(numberSeries((detail?.profitability as any)?.roe)), fy1: isFiniteNumber(profitabilityEstimates?.roe?.fy1) ? profitabilityEstimates!.roe!.fy1 : null, industry: isFiniteNumber(industryBench?.roe) ? industryBench!.roe! * 100 : null, signed: false },
    { label: "ROA", now: lastFinite(numberSeries((detail?.profitability as any)?.roa)), fy1: isFiniteNumber(profitabilityEstimates?.roa?.fy1) ? profitabilityEstimates!.roa!.fy1 : null, industry: null, signed: false },
    { label: "매출 성장률", now: lastFinite(numberSeries((detail?.growth as any)?.revenue_growth)), fy1: isFiniteNumber(detail?.growth_estimates?.revenue_growth?.fy1) ? detail.growth_estimates.revenue_growth.fy1 : null, industry: null, signed: true },
    { label: "EPS 성장률", now: lastFinite(numberSeries((detail?.growth as any)?.eps_growth)), fy1: isFiniteNumber(detail?.growth_estimates?.eps_growth?.fy1) ? detail.growth_estimates.eps_growth.fy1 : null, industry: null, signed: true },
  ].filter((r) => r.now !== null || r.fy1 !== null);

  const roeNow = lastFinite(numberSeries((detail?.profitability as any)?.roe));
  const wacc = isFiniteNumber(industryBench?.cost_of_capital) ? industryBench!.cost_of_capital! * 100 : null;

  if (rrTiles.length === 0 && industryChips.length === 0 && profRows.length === 0) return null;

  return (
    <>
      {rrTiles.length > 0 ? (
        <section data-stock-tab-card="valuation-rerating">
          <div className="cpw4-section-head" style={{ marginBottom: 10 }}>
            <h3>리레이팅 — 이익 성장이 배수를 어떻게 눌렀나</h3>
            <span>Yahoo Finance 밸류 지표</span>
          </div>
          <div className="cpw4-rerating-row">
            {rrTiles.map((t) => (
              <div className="cpw4-rr-tile" key={t.label}>
                <span className="l">{t.label}</span>
                {t.body}
                <span className="cap">{t.cap}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {industryChips.length > 0 && industryBench ? (
        <section data-stock-tab-card="profitability-growth">
          <div className="cpw4-section-head" style={{ marginBottom: 10 }}>
            <h3>산업 대비 ({industryBench.name}, 다모다란{isFiniteNumber(industryBench.num_firms) ? ` ${industryBench.num_firms}개사` : ""})</h3>
            <span>TTM 기준</span>
          </div>
          <div className="cpw4-dchip-row">
            {industryChips.map((c) => {
              const fmt = (v: number) => (c.isFraction ? `${(v * 100).toFixed(1)}%` : `${v.toFixed(1)}x`);
              const better = c.lowerBetter ? c.stock < c.ind : c.stock > c.ind;
              const deltaPct = c.ind !== 0 ? (c.stock - c.ind) / Math.abs(c.ind) : null;
              return (
                <div className="cpw4-dchip" key={c.label}>
                  <div className="cpw4-dchip-main">
                    <span className="l">{c.label}</span>
                    <span className="v">{fmt(c.stock)}<span className="vs">vs 산업</span>{fmt(c.ind)}</span>
                  </div>
                  {deltaPct !== null ? <span className={`cpw4-badge ${better ? "cpw4-badge--positive" : "cpw4-badge--negative"}`}>{fmtPct(deltaPct)}</span> : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {profRows.length > 0 ? (
        <section data-stock-tab-card="profitability-growth-detail">
          <div className="cpw4-section-head" style={{ marginBottom: 10 }}>
            <h3>수익성 · 성장 — 현재 → FY+1(E)</h3>
            <span>스톡분석 재무 데이터 · 산업 비교 병기</span>
          </div>
          <div className="cpw4-metric-grid">
            {profRows.map((r) => {
              const now = r.now;
              const fy1 = r.fy1;
              const delta = now !== null && fy1 !== null ? fy1 - now : null;
              const maxV = Math.max(Math.abs(now ?? 0), Math.abs(fy1 ?? 0), 1);
              return (
                <div className="cpw4-metric-cell" key={r.label}>
                  <span className="label">{r.label}</span>
                  <div className="cpw4-metric-row">
                    <span className="now">{now !== null ? `${r.signed && now >= 0 ? "+" : ""}${now.toFixed(1)}` : "—"}<span className="unit">%</span></span>
                    {fy1 !== null ? (
                      <span className="cpw4-metric-fy">
                        FY+1 <strong>{r.signed && fy1 >= 0 ? "+" : ""}{fy1.toFixed(1)}%</strong>
                        {delta !== null ? <span className={`cpw4-metric-delta ${delta >= 0 ? "cpw4-metric-delta--positive" : "cpw4-metric-delta--warn"}`}>{delta >= 0 ? "▲" : "▼"}{Math.abs(delta).toFixed(1)}%p</span> : null}
                      </span>
                    ) : null}
                    {isFiniteNumber(r.industry) ? <span className="cpw4-badge cpw4-badge--neutral">산업 {r.industry.toFixed(1)}%</span> : null}
                  </div>
                  {now !== null && fy1 !== null ? (
                    <div className="cpw4-metric-bars">
                      <div className="cpw4-metric-bar-row"><span className="cpw4-metric-bar-tag">현재</span><span className="cpw4-metric-bar-track"><span className="cpw4-metric-bar-fill cpw4-metric-bar-fill--now" style={{ width: `${Math.min(100, (Math.abs(now) / maxV) * 100)}%` }} /></span></div>
                      <div className="cpw4-metric-bar-row"><span className="cpw4-metric-bar-tag">FY+1</span><span className="cpw4-metric-bar-track"><span className={`cpw4-metric-bar-fill ${delta !== null && delta >= 0 ? "cpw4-metric-bar-fill--positive" : "cpw4-metric-bar-fill--warn"}`} style={{ width: `${Math.min(100, (Math.abs(fy1) / maxV) * 100)}%` }} /></span></div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {roeNow !== null && wacc !== null ? (
            <p className="cpw4-insight-line" style={{ marginTop: 12 }}>
              ROE <b>{roeNow.toFixed(1)}%</b>가 자본비용(WACC) <b>{wacc.toFixed(1)}%</b>를 {roeNow >= wacc ? "웃돕니다" : "밑돕니다"} — 자본을 굴릴수록 가치를 {roeNow >= wacc ? "만들어내는" : "갉아먹는"} 스프레드입니다.
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// W4 추정치(Estimates) tab surface
// ---------------------------------------------------------------------------

function EstimatesHeroCp({ yfData, detail, currency }: { yfData: any; detail: any; currency: string }) {
  const targets = yfData?.analyst_price_targets ?? {};
  const current = isFiniteNumber(targets.current) ? targets.current : null;
  const mean = isFiniteNumber(targets.mean) ? targets.mean : null;
  const low = isFiniteNumber(targets.low) ? targets.low : null;
  const upsidePct = current && mean && current !== 0 ? (mean - current) / current : null;

  const epsActual = lastFinite(numberSeries(detail?.per_share?.eps));
  const epsEst = detail?.per_share_estimates?.eps ?? null;
  const epsPoints = [
    { label: "FY0(실적)", value: epsActual, estimate: false },
    { label: "FY+1(E)", value: isFiniteNumber(epsEst?.fy1) ? epsEst.fy1 : null, estimate: true },
    { label: "FY+2(E)", value: isFiniteNumber(epsEst?.fy2) ? epsEst.fy2 : null, estimate: true },
    { label: "FY+3(E)", value: isFiniteNumber(epsEst?.fy3) ? epsEst.fy3 : null, estimate: true },
  ].filter((p): p is { label: string; value: number; estimate: boolean } => isFiniteNumber(p.value));
  const epsCumGrowth = epsPoints.length >= 2 && epsPoints[0].value !== 0
    ? (epsPoints[epsPoints.length - 1].value - epsPoints[0].value) / Math.abs(epsPoints[0].value)
    : null;

  if (current === null && epsPoints.length === 0) return null;
  const maxEps = Math.max(...epsPoints.map((p) => p.value), 1);
  const chartW = 860, chartH = 130, baseY = 100, barW = 70;
  const slotW = epsPoints.length > 0 ? chartW / epsPoints.length : chartW;

  return (
    <section className="cpw4-hero" data-stock-tab-card="estimates-consensus">
      <p className="cpw4-hero__eyebrow">ESTIMATES · 시장 전망</p>
      <div className="cpw4-est-hero-grid">
        <div>
          {upsidePct !== null ? (
            <>
              <h2 className="cpw4-hero__verdict" style={{ fontSize: 21 }}>시장은 여전히 <span className={upsidePct >= 0 ? "up" : "down"}>{upsidePct >= 0 ? "위쪽" : "아래쪽"}</span>을 본다</h2>
              <div className="cpw4-est-headline">
                <span className={`num ${upsidePct < 0 ? "down" : ""}`}>{fmtPct(upsidePct)}</span>
                <span className="lbl">목표가 여력</span>
              </div>
              <p className="cpw4-hero__sub">
                애널리스트 평균 목표가 <b>{formatMoney(mean, currency)}</b>는 현재가 <b>{formatMoney(current, currency)}</b>보다 {fmtPct(Math.abs(upsidePct))} {upsidePct >= 0 ? "높습니다" : "낮습니다"}.
                {" "}{low !== null && current !== null ? (low >= current ? "최저 목표도 현재가를 밑돌지 않아, 하방 컨센서스는 아직 형성되지 않았습니다." : `최저 목표(${formatMoney(low, currency)})는 현재가 아래에 있습니다.`) : ""}
              </p>
            </>
          ) : (
            <p className="cpw4-hero__sub">애널리스트 목표가 컨센서스를 아직 확인하지 못했습니다.</p>
          )}
        </div>
        {epsPoints.length > 0 ? (
          <>
            <div className="cpw4-divider-v" />
            <div>
              <div className="cpw4-eps-trio-head">
                <span className="cpw4-eps-trio-title">EPS 실적 → 컨센서스 (FY0 → FY+3)</span>
                {epsCumGrowth !== null ? <span className="cpw4-badge cpw4-badge--neutral">누적 {fmtPct(epsCumGrowth)}</span> : null}
              </div>
              <div className="cpw4-eps-chart">
                <svg viewBox={`0 0 ${chartW} ${chartH}`} role="img" aria-label="EPS 실적 대비 컨센서스 추이">
                  <line x1={0} y1={baseY} x2={chartW} y2={baseY} stroke="var(--cp-divider)" strokeWidth={1} />
                  {epsPoints.map((p, i) => {
                    const h = maxEps > 0 ? Math.max(6, (p.value / maxEps) * (baseY - 20)) : 6;
                    const x = i * slotW + (slotW - barW) / 2;
                    const y = baseY - h;
                    const isLast = i === epsPoints.length - 1;
                    return (
                      <g key={p.label}>
                        <rect x={x} y={y} width={barW} height={h} rx={6}
                          fill={p.estimate ? `color-mix(in srgb, var(--cp-positive) ${28 + i * 22}%, var(--cp-surface-strong))` : "var(--cp-surface-strong)"}
                          stroke={p.estimate ? "none" : "var(--cp-border-strong)"} strokeWidth={p.estimate ? 0 : 1} />
                        <text x={x + barW / 2} y={Math.max(12, y - 8)} textAnchor="middle" fontSize={isLast ? 16 : 14} fontWeight={isLast ? 850 : 800} fill={isLast ? "var(--cp-positive)" : "var(--cp-text-strong)"}>
                          {formatMoney(p.value, currency)}
                        </text>
                        <text x={x + barW / 2} y={chartH - 4} textAnchor="middle" fontSize="11" fill="var(--cp-text-soft)">{p.label}</text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function EstimatesBandCp({ yfData, currency }: { yfData: any; currency: string }) {
  const targets = yfData?.analyst_price_targets ?? {};
  const low = isFiniteNumber(targets.low) ? targets.low : null;
  const high = isFiniteNumber(targets.high) ? targets.high : null;
  const mean = isFiniteNumber(targets.mean) ? targets.mean : null;
  const current = isFiniteNumber(targets.current) ? targets.current : null;
  if (low === null || high === null || mean === null || current === null || high <= low) return null;
  const pctFor = (v: number) => Math.max(0, Math.min(100, ((v - low) / (high - low)) * 100));
  const currentPct = pctFor(current);
  const meanPct = pctFor(mean);
  const upsidePct = current !== 0 ? (mean - current) / current : null;
  const W = 1000, trackY = 52, trackX = 40, trackW = 920, trackH = 10;
  const currentX = trackX + (currentPct / 100) * trackW;
  const meanX = trackX + (meanPct / 100) * trackW;

  return (
    <section className="cp-stock-tab-card" data-stock-tab-card="estimates-target-band">
      <header className="cp-stock-tab-card__header">
        <div><p className="cp-stock-rail-eyebrow">Target Range</p><h2>애널리스트 목표가 범위</h2></div>
      </header>
      <div className="cp-stock-tab-card__body cpw4-band-svg">
        <svg viewBox={`0 0 ${W} 118`} role="img" aria-label={`목표가 범위 최저 ${formatMoney(low, currency)}, 현재가 ${formatMoney(current, currency)}, 평균 목표 ${formatMoney(mean, currency)}, 최고 ${formatMoney(high, currency)}`}>
          <rect x={trackX} y={trackY} width={trackW} height={trackH} rx={5} fill="var(--cp-surface-muted)" stroke="var(--cp-border)" />
          <rect x={trackX} y={trackY} width={Math.max(0, currentX - trackX)} height={trackH} rx={5} fill="var(--cp-border-strong)" />
          <rect x={currentX} y={trackY} width={Math.max(0, meanX - currentX)} height={trackH} fill="var(--cp-positive)" />
          <rect x={meanX} y={trackY} width={Math.max(0, trackX + trackW - meanX)} height={trackH} rx={5} fill="var(--cp-warning-soft)" />
          <circle cx={currentX} cy={trackY + trackH / 2} r={9} fill="var(--cp-text-strong)" stroke="#fff" strokeWidth={3} />
          <text x={currentX} y={98} textAnchor="middle" fontSize="12" fill="var(--cp-text-soft)">현재가</text>
          <text x={currentX} y={113} textAnchor="middle" fontSize="13" fontWeight="800" fill="var(--cp-text-strong)">{formatMoney(current, currency)}</text>
          <line x1={meanX} y1={20} x2={meanX} y2={trackY} stroke="var(--cp-positive)" strokeWidth={2} />
          <circle cx={meanX} cy={trackY + trackH / 2} r={10} fill="var(--cp-positive)" stroke="#fff" strokeWidth={3} />
          <text x={meanX} y={16} textAnchor="middle" fontSize="14" fontWeight="850" fill="var(--cp-positive)">평균 목표 {formatMoney(mean, currency)}</text>
          {upsidePct !== null ? <text x={meanX} y={113} textAnchor="middle" fontSize="13" fontWeight="800" fill="var(--cp-positive)">{fmtPct(upsidePct)}</text> : null}
          <text x={trackX} y={34} fontSize="12" fontWeight="700" fill="var(--cp-text-muted)">최저 {formatMoney(low, currency)}</text>
          <text x={trackX + trackW} y={34} textAnchor="end" fontSize="12" fontWeight="700" fill="var(--cp-text-muted)">최고 {formatMoney(high, currency)}</text>
        </svg>
      </div>
    </section>
  );
}

function EstimatesGrowthTilesCp({ detail, currency }: { detail: any; currency: string }) {
  const revActual = lastFinite(numberSeries(detail?.income_statement?.revenue));
  const revFy1 = isFiniteNumber(detail?.income_statement_estimates?.revenue?.fy1) ? detail.income_statement_estimates.revenue.fy1 : null;
  const epsActual = lastFinite(numberSeries(detail?.per_share?.eps));
  const epsFy1 = isFiniteNumber(detail?.per_share_estimates?.eps?.fy1) ? detail.per_share_estimates.eps.fy1 : null;
  const revGrowth = isFiniteNumber(detail?.growth_estimates?.revenue_growth?.fy1) ? detail.growth_estimates.revenue_growth.fy1 : null;
  const epsGrowth = isFiniteNumber(detail?.growth_estimates?.eps_growth?.fy1) ? detail.growth_estimates.eps_growth.fy1 : null;

  const tiles = [
    { label: "FY+1 매출 성장 (YoY)", growth: revGrowth, now: revActual, next: revFy1, fmt: (v: number) => `$${fmtLarge(v)}` },
    { label: "FY+1 EPS 성장 (YoY)", growth: epsGrowth, now: epsActual, next: epsFy1, fmt: (v: number) => formatMoney(v, currency) },
  ].filter((t) => isFiniteNumber(t.next));
  if (tiles.length === 0) return null;

  return (
    <div className="cpw4-tile-row">
      {tiles.map((t) => {
        const maxV = Math.max(t.now ?? 0, t.next ?? 0, 1);
        const nowH = maxV > 0 ? Math.max(6, ((t.now ?? 0) / maxV) * 44) : 6;
        const nextH = maxV > 0 ? Math.max(6, ((t.next ?? 0) / maxV) * 44) : 6;
        return (
          <div className="cpw4-tile" key={t.label}>
            <div className="cpw4-metric-row" style={{ marginBottom: 0 }}>
              <p className="cpw4-tile__label" style={{ marginBottom: 0 }}>{t.label}</p>
              {isFiniteNumber(t.growth) ? <span className={`cpw4-badge ${t.growth >= 0 ? "cpw4-badge--positive" : "cpw4-badge--negative"}`}>{fmtWholeSignedPct(t.growth)}</span> : null}
            </div>
            <p className="cpw4-tile__value" style={{ marginTop: 6 }}>{isFiniteNumber(t.next) ? t.fmt(t.next) : "—"}</p>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 14, marginTop: 8 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 10.5, color: "var(--cp-text-soft)", fontWeight: 700 }}>{isFiniteNumber(t.now) ? t.fmt(t.now) : "—"}</span>
                <div style={{ width: 20, height: nowH, borderRadius: "4px 4px 0 0", background: "var(--cp-surface-strong)" }} />
                <span style={{ fontSize: 10, color: "var(--cp-text-soft)" }}>FY0</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 10.5, color: "var(--cp-positive)", fontWeight: 800 }}>{isFiniteNumber(t.next) ? t.fmt(t.next) : "—"}</span>
                <div style={{ width: 20, height: nextH, borderRadius: "4px 4px 0 0", background: "var(--cp-positive)" }} />
                <span style={{ fontSize: 10, color: "var(--cp-text-soft)" }}>FY+1(E)</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EstimatesRecoCp({ yfData }: { yfData: any }) {
  const recs = Array.isArray(yfData?.recommendations) ? yfData.recommendations : [];
  const lastRec = recs.length > 0 ? recs[recs.length - 1] : null;
  if (!lastRec) return null;
  const segs: Array<[string, string, string]> = [
    ["strongBuy", "적극매수", "var(--cp-positive)"],
    ["buy", "매수", "color-mix(in srgb, var(--cp-positive) 46%, #ffffff)"],
    ["hold", "보유", "var(--cp-surface-strong)"],
    ["sell", "매도", "color-mix(in srgb, var(--cp-negative) 46%, #ffffff)"],
    ["strongSell", "적극매도", "var(--cp-negative)"],
  ];
  const total = segs.reduce((s, [key]) => s + (Number(lastRec[key]) || 0), 0);
  if (total === 0) return null;
  const bullish = (Number(lastRec.strongBuy) || 0) + (Number(lastRec.buy) || 0);
  const bullishRatio = bullish / total;
  const overall = bullishRatio >= 0.7 ? "Strong Buy" : bullishRatio >= 0.5 ? "Buy" : bullishRatio >= 0.3 ? "Hold" : "Sell 우세";

  return (
    <section className="cp-stock-tab-card" data-stock-tab-card="estimates-recommendation">
      <header className="cp-stock-tab-card__header">
        <div><p className="cp-stock-rail-eyebrow">Analyst Recommendations</p><h2>애널리스트 추천 분포</h2></div>
        <span className="cpw4-badge cpw4-badge--positive">종합: {overall}</span>
      </header>
      <div className="cp-stock-tab-card__body">
        <div className="cpw4-reco-bar">
          {segs.map(([key, label, color]) => {
            const count = Number(lastRec[key]) || 0;
            const pct = (count / total) * 100;
            if (pct === 0) return null;
            return (
              <div key={key} className="cpw4-reco-seg" style={{ width: `${pct}%`, background: color }}>
                {pct > 8 ? `${label} ${count}` : ""}
              </div>
            );
          })}
        </div>
        <div className="cpw4-reco-legend">
          {segs.filter(([key]) => (Number(lastRec[key]) || 0) > 0).map(([key, label, color]) => (
            <span key={key}><span className="dot" style={{ background: color }} />{label} {Number(lastRec[key])}명</span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// W4 보유기관(Ownership) tab surface
// ---------------------------------------------------------------------------

function OwnershipHeroCp({
  f13Entries, ticker, yfData, displayPrice, currency,
}: {
  f13Entries: F13Entry[] | null;
  ticker: string;
  yfData: any;
  displayPrice: number | null;
  currency: string;
}) {
  const [tradesChip, setTradesChip] = useState<{ bought?: any; sold?: any; metadata?: any } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTradesRanking().then((data) => {
      if (cancelled || !data) return;
      const upper = ticker.toUpperCase();
      const b = data.bought.find((r: any) => r?.ticker === upper);
      const s = data.sold.find((r: any) => r?.ticker === upper);
      setTradesChip({ bought: b, sold: s, metadata: data.metadata });
    });
    return () => { cancelled = true; };
  }, [ticker]);

  const holders = useMemo(() => {
    if (!f13Entries || f13Entries.length === 0) return [];
    const byInv = new Map<string, { shares: number; weight: number }>();
    for (const e of f13Entries) {
      if (typeof e.investor !== "string" || e.investor.trim() === "") continue;
      const cur = byInv.get(e.investor);
      const shares = isFiniteNumber(e.shares) ? e.shares : 0;
      const weight = isFiniteNumber(e.weight) ? e.weight : 0;
      if (cur) { cur.shares += shares; cur.weight += weight; }
      else byInv.set(e.investor, { shares, weight });
    }
    return [...byInv.entries()].map(([investor, v]) => ({ investor, ...v })).sort((a, b) => b.weight - a.weight);
  }, [f13Entries]);

  const top10 = holders.slice(0, 10);
  const holderCount = holders.length;
  const totalShares = holders.reduce((s, h) => s + h.shares, 0);
  const guruValueApprox = isFiniteNumber(displayPrice) && totalShares > 0 ? displayPrice * totalShares : null;

  const boughtAmount = isFiniteNumber(tradesChip?.bought?.amount) ? tradesChip.bought.amount : null;
  const soldAmount = isFiniteNumber(tradesChip?.sold?.amount) ? tradesChip.sold.amount : null;
  const hasFlow = boughtAmount !== null || soldAmount !== null;
  const netFlow = hasFlow ? (boughtAmount ?? 0) - (soldAmount ?? 0) : null;
  const isNetSell = netFlow !== null && netFlow < 0;
  const flowRatio = boughtAmount && soldAmount ? (isNetSell ? soldAmount / boughtAmount : boughtAmount / soldAmount) : null;

  const quarter = typeof tradesChip?.metadata?.quarter === "string" && tradesChip.metadata.quarter.trim() ? tradesChip.metadata.quarter.trim() : null;
  const generatedAt = typeof tradesChip?.metadata?.generated_at === "string" && tradesChip.metadata.generated_at.trim() ? tradesChip.metadata.generated_at.slice(0, 10) : null;
  const reportBasisLabel = [quarter ?? "최근 분기", generatedAt].filter(Boolean).join(" · ");

  const mh = yfData?.major_holders ?? {};
  const institutionsPct = isFiniteNumber(mh.institutionsPercentHeld) ? mh.institutionsPercentHeld * 100 : null;
  const institutionsFloatPct = isFiniteNumber(mh.institutionsFloatPercentHeld) ? mh.institutionsFloatPercentHeld * 100 : null;
  const insidersPct = isFiniteNumber(mh.insidersPercentHeld) ? mh.insidersPercentHeld * 100 : null;
  const institutionsCount = isFiniteNumber(mh.institutionsCount) ? mh.institutionsCount : null;

  if (holderCount === 0 && !hasFlow && institutionsPct === null) return null;

  const maxFlow = Math.max(boughtAmount ?? 0, soldAmount ?? 0, 1);
  const sellWidthPct = soldAmount !== null ? Math.max(6, (soldAmount / maxFlow) * 100) : 0;
  const buyWidthPct = boughtAmount !== null ? Math.max(6, (boughtAmount / maxFlow) * 100) : 0;

  const donutPct = institutionsPct !== null ? Math.max(0, Math.min(100, institutionsPct)) : null;
  const donutR = 44;
  const donutCirc = 2 * Math.PI * donutR;
  const donutOffset = donutPct !== null ? donutCirc * (1 - donutPct / 100) : donutCirc;

  return (
    <>
      <section className="cpw4-hero" id="guru-section" data-stock-tab-card="ownership-guru">
        <div className="cpw4-hero__top">
          <p className="cpw4-hero__eyebrow">
            13F 기관 자금 흐름{reportBasisLabel ? ` · ${reportBasisLabel}` : ""}{holderCount > 0 ? ` · 보유 ${holderCount}곳` : ""}
          </p>
          {hasFlow ? (
            <div className="cpw4-own-net">
              <div className="l">{isNetSell ? "순매도 규모" : "순매수 규모"}</div>
              <div className={`v ${isNetSell ? "down" : "up"}`}>{isNetSell ? "-" : "+"}{formatCompactMoney(Math.abs(netFlow ?? 0), "USD")}</div>
              <div className="r">매도 {formatCompactMoney(soldAmount ?? 0, "USD")} − 매수 {formatCompactMoney(boughtAmount ?? 0, "USD")}</div>
            </div>
          ) : null}
        </div>
        <h2 className="cpw4-hero__verdict">
          {hasFlow ? (
            <>이번 분기, 대형 기관은 <span className={isNetSell ? "down" : "up"}>{isNetSell ? "팔고 있습니다" : "사고 있습니다"}</span></>
          ) : (
            "이번 분기 랭킹 데이터에서 이 종목의 매매 흐름을 특정하지 못했습니다"
          )}
        </h2>
        {hasFlow && flowRatio !== null ? (
          <p className="cpw4-hero__sub">
            추종 대가 {holderCount > 0 ? `${holderCount}곳` : "다수"} 중 {isNetSell ? "매도" : "매수"} 참여가 우세 — {isNetSell ? "매도" : "매수"} 금액이 {isNetSell ? "매수" : "매도"}의 <b>{flowRatio.toFixed(1)}배</b>에 달합니다.
          </p>
        ) : null}
        {hasFlow ? (
          <div className="cpw4-own-flow-svg">
            <svg viewBox="0 0 1000 100" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`매도 ${formatCompactMoney(soldAmount ?? 0, "USD")} 대 매수 ${formatCompactMoney(boughtAmount ?? 0, "USD")}`}>
              <line x1="500" y1="4" x2="500" y2="96" stroke="var(--cp-border-strong)" strokeWidth={2} />
              <line x1="30" y1="66" x2="970" y2="66" stroke="var(--cp-divider)" strokeWidth={1} />
              {soldAmount !== null ? (
                <>
                  <rect x={500 - (sellWidthPct / 100) * 460} y="48" width={(sellWidthPct / 100) * 460} height="24" rx="6" fill="var(--cp-negative)" />
                  <text x={500 - (sellWidthPct / 100) * 460 + 10} y="65" fontSize="13" fontWeight="800" fill="#fff">매도 {formatCompactMoney(soldAmount, "USD")}</text>
                  <text x={500 - (sellWidthPct / 100) * 460} y="42" fontSize="11" fontWeight="700" fill="var(--cp-text-soft)">
                    참여 {isFiniteNumber(tradesChip?.sold?.investors_count) ? tradesChip.sold.investors_count : "—"}곳{isFiniteNumber(tradesChip?.sold?.exit_count) && tradesChip.sold.exit_count > 0 ? ` · 청산 ${tradesChip.sold.exit_count}곳` : ""}
                  </text>
                </>
              ) : null}
              {boughtAmount !== null ? (
                <>
                  <rect x="500" y="48" width={(buyWidthPct / 100) * 460} height="24" rx="6" fill="var(--cp-positive)" />
                  <text x={500 + (buyWidthPct / 100) * 460 - 10} y="65" fontSize="13" fontWeight="800" fill="#fff" textAnchor="end">매수 {formatCompactMoney(boughtAmount, "USD")}</text>
                  <text x="500" y="42" fontSize="11" fontWeight="700" fill="var(--cp-text-soft)">
                    참여 {isFiniteNumber(tradesChip?.bought?.investors_count) ? tradesChip.bought.investors_count : "—"}곳{isFiniteNumber(tradesChip?.bought?.new_count) && tradesChip.bought.new_count > 0 ? ` · 신규 ${tradesChip.bought.new_count}곳` : ""}
                  </text>
                </>
              ) : null}
            </svg>
          </div>
        ) : null}
        <div className="cpw4-chip-row">
          {holderCount > 0 ? <div className="cpw4-chip"><strong>{holderCount}</strong><span>보유 Guru 기관 수</span></div> : null}
          {isFiniteNumber(tradesChip?.sold?.investors_count) ? <div className="cpw4-chip"><strong>{tradesChip.sold.investors_count}</strong><span>이번 분기 매도 참여</span></div> : null}
          {isFiniteNumber(tradesChip?.bought?.investors_count) ? <div className="cpw4-chip"><strong>{tradesChip.bought.investors_count}</strong><span>이번 분기 매수 참여</span></div> : null}
          {isFiniteNumber(tradesChip?.sold?.exit_count) && tradesChip.sold.exit_count > 0 ? <div className="cpw4-chip"><strong>{tradesChip.sold.exit_count}</strong><span>완전 청산(포지션 제로)</span></div> : null}
          {guruValueApprox !== null ? <div className="cpw4-chip"><strong>{formatCompactMoney(guruValueApprox, "USD")}</strong><span>Guru 합산 보유 평가액(근사)</span></div> : null}
        </div>
      </section>

      <div className="cpw4-own-body-grid">
        <section className="cp-stock-tab-card" data-stock-tab-card="ownership-holders">
          <header className="cp-stock-tab-card__header">
            <div><p className="cp-stock-rail-eyebrow">13F Guru</p><h2>Top Guru 보유 비중</h2></div>
            <span style={{ fontSize: 11.5, color: "var(--cp-text-soft)", fontWeight: 650 }}>포트폴리오 내 {ticker} 비중 기준{reportBasisLabel ? ` · ${reportBasisLabel}` : ""}</span>
          </header>
          <div className="cp-stock-tab-card__body">
            {top10.length > 0 ? (
              <>
                <div className="cpw4-holder-cols">
                  <span>#</span><span>투자자</span><span>포트폴리오 비중</span><span className="right">비중</span><span className="right">주식수</span><span className="right">공시 기준</span>
                </div>
                {top10.map((h, i) => {
                  const maxWeight = top10[0]?.weight || 1;
                  const barPct = maxWeight > 0 ? Math.max(4, (h.weight / maxWeight) * 100) : 0;
                  return (
                    <div className="cpw4-holder-row" key={h.investor}>
                      <div className={`cpw4-holder-rank ${i < 3 ? "cpw4-holder-rank--top" : ""}`}>{i + 1}</div>
                      <TransitionLink href={ROUTES.superinvestorsGuru(h.investor)} className="cpw4-holder-name" title={h.investor}>{h.investor}</TransitionLink>
                      <div className="cpw4-holder-track"><div className="cpw4-holder-fill" style={{ width: `${barPct}%` }} /></div>
                      <div className="cpw4-holder-pct right">{h.weight > 0 ? `${(h.weight * 100).toFixed(2)}%` : "—"}</div>
                      <div className="cpw4-holder-shares right">{h.shares > 0 ? `${h.shares.toLocaleString()}주` : "—"}</div>
                      <div className="cpw4-holder-quarter right">{quarter ?? "—"}</div>
                    </div>
                  );
                })}
              </>
            ) : (
              <p style={{ fontSize: 12.5, color: "var(--cp-text-muted)" }}>13F 보유자 데이터를 찾지 못했습니다.</p>
            )}
          </div>
        </section>

        <div style={{ display: "grid", gap: 16 }}>
          {isFiniteNumber(tradesChip?.sold?.exit_count) && tradesChip.sold.exit_count > 0 ? (
            <section className="cpw4-own-changes">
              <div className="cpw4-own-changes__eyebrow">최근 주요 변화{reportBasisLabel ? ` · ${reportBasisLabel}` : ""}</div>
              <div className="cpw4-own-changes__headline">완전 청산 <strong>{tradesChip.sold.exit_count}건</strong></div>
              <div className="cpw4-own-changes__sub">매도 참여 {isFiniteNumber(tradesChip?.sold?.investors_count) ? tradesChip.sold.investors_count : "—"}곳 중 {tradesChip.sold.exit_count}곳은 포지션을 아예 제로로 정리했습니다</div>
              {tradeInvestorNameOf(tradesChip?.sold?.top_investor) ? (
                <div className="cpw4-own-change-row">
                  <div>
                    <div className="cpw4-own-change-name">{tradeInvestorNameOf(tradesChip.sold.top_investor)}</div>
                    <div className="cpw4-own-change-desc">이번 분기 최대 매도 참여자 · 전량 청산 여부는 개별 확인 필요</div>
                  </div>
                  <span className="cpw4-badge cpw4-badge--negative">매도 랭크 #{isFiniteNumber(tradesChip.sold.rank) ? tradesChip.sold.rank : "—"}</span>
                </div>
              ) : null}
            </section>
          ) : null}

          {institutionsPct !== null || institutionsCount !== null ? (
            <section className="cp-stock-tab-card" data-stock-tab-card="ownership-institutional-summary">
              <header className="cp-stock-tab-card__header">
                <div><p className="cp-stock-rail-eyebrow">Institutional</p><h2>기관 보유 요약</h2></div>
                <span style={{ fontSize: 11, color: "var(--cp-text-soft)" }}>Yahoo Finance</span>
              </header>
              <div className="cp-stock-tab-card__body">
                <div className="cpw4-own-gauge-wrap">
                  {donutPct !== null ? (
                    <svg width="104" height="104" viewBox="0 0 104 104">
                      <circle cx="52" cy="52" r={donutR} fill="none" stroke="var(--cp-surface-strong)" strokeWidth="12" />
                      <circle cx="52" cy="52" r={donutR} fill="none" stroke="var(--cp-accent-strong)" strokeWidth="12" strokeLinecap="round"
                        strokeDasharray={donutCirc} strokeDashoffset={donutOffset} transform="rotate(-90 52 52)" />
                      <text x="52" y="48" textAnchor="middle" fontSize="20" fontWeight="800" fill="var(--cp-text-strong)">{donutPct.toFixed(1)}%</text>
                      <text x="52" y="65" textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--cp-text-soft)">기관보유</text>
                    </svg>
                  ) : null}
                  <p className="cpw4-own-gauge-sub">
                    {institutionsCount !== null ? <>기관투자자 <strong>{institutionsCount.toLocaleString()}곳</strong>이 {ticker}를 보유 중이며, </> : null}
                    {donutPct !== null ? <>발행주식의 <strong>{donutPct.toFixed(1)}%</strong>를 쥐고 있습니다.</> : null}
                  </p>
                </div>
                <div className="cpw4-own-tiles">
                  {institutionsFloatPct !== null ? <div className="cpw4-own-tile"><div className="v">{institutionsFloatPct.toFixed(1)}%</div><div className="l">유동주 기준 기관 보유율</div></div> : null}
                  {insidersPct !== null ? <div className="cpw4-own-tile"><div className="v">{insidersPct.toFixed(1)}%</div><div className="l">내부자 보유율</div></div> : null}
                  {institutionsCount !== null ? <div className="cpw4-own-tile"><div className="v">{institutionsCount.toLocaleString()}</div><div className="l">보유 기관 총 수</div></div> : null}
                  {holderCount > 0 ? <div className="cpw4-own-tile"><div className="v">{holderCount}</div><div className="l">추종 Guru 기관 수</div></div> : null}
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <p className="cpw4-disclaimer">13F는 분기말 스냅샷 기반이며 최대 45일 지연될 수 있습니다{reportBasisLabel ? ` · ${reportBasisLabel} 데이터` : ""}. Guru 합산 보유 평가액은 현재가 × 보유주식수 근사치입니다.</p>
    </>
  );
}

// ---------------------------------------------------------------------------
// W4 공시(Filings) tab surface — consumes edgarKoreanSummaries lib directly
// ---------------------------------------------------------------------------

interface EdgarFilingArtifactLite {
  summaryKo?: {
    oneLine?: string;
    keyPoints?: Array<{ text: string; stance: string }>;
    riskChanges?: Array<{ text: string; stance: string }>;
    financialHighlights?: Array<{ text: string; stance: string }>;
  };
}

const FILING_STANCE_LABEL: Record<string, string> = {
  fact: "사실",
  management_claim: "경영진 언급",
  feno_interpretation: "Feno 해석",
};
const FILING_STANCE_CLASS: Record<string, string> = {
  fact: "cpw4-filing-tag-fact",
  management_claim: "cpw4-filing-tag-claim",
  feno_interpretation: "cpw4-filing-tag-note",
};

function filingFormBadgeClass(form: string): string {
  if (form === "8-K" || form === "6-K") return "cpw4-badge--warning";
  return "cpw4-badge--neutral";
}

function FilingsHeroFeedCp({ ticker }: { ticker: string }) {
  const [filings, setFilings] = useState<EdgarKoreanSummaryFilingEntry[] | null>(null);
  const [heroArtifact, setHeroArtifact] = useState<EdgarFilingArtifactLite | null | undefined>(undefined);
  const [feedArtifacts, setFeedArtifacts] = useState<Record<string, EdgarFilingArtifactLite | null>>({});

  useEffect(() => {
    let cancelled = false;
    setFilings(null);
    setHeroArtifact(undefined);
    setFeedArtifacts({});
    loadEdgarKoreanSummariesForTicker(ticker).then((manifest) => {
      if (cancelled) return;
      setFilings(edgarFilingsForTicker(manifest, ticker));
    });
    return () => { cancelled = true; };
  }, [ticker]);

  const readyFilings = useMemo(() => (filings ?? []).filter((f) => f.summaryPath), [filings]);
  const heroFiling = readyFilings[0] ?? null;
  const feedFilings = useMemo(() => readyFilings.slice(1, 3), [readyFilings]);
  const feedKey = feedFilings.map((f) => f.summaryPath).join(",");

  useEffect(() => {
    let cancelled = false;
    if (!heroFiling?.summaryPath) {
      setHeroArtifact(null);
      return () => { cancelled = true; };
    }
    setHeroArtifact(undefined);
    fetch(heroFiling.summaryPath, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled) setHeroArtifact(data); })
      .catch(() => { if (!cancelled) setHeroArtifact(null); });
    return () => { cancelled = true; };
  }, [heroFiling?.summaryPath]);

  useEffect(() => {
    let cancelled = false;
    feedFilings.forEach((filing) => {
      if (!filing.summaryPath) return;
      const path = filing.summaryPath;
      fetch(path, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => { if (!cancelled) setFeedArtifacts((prev) => (path in prev ? prev : { ...prev, [path]: data })); })
        .catch(() => { if (!cancelled) setFeedArtifacts((prev) => (path in prev ? prev : { ...prev, [path]: null })); });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedKey]);

  if (filings === null) return <div className="cp-stock-tab-loading"><SkeletonSection /></div>;
  if (filings.length === 0) {
    return (
      <section className="cp-stock-tab-card">
        <div className="cp-stock-tab-card__body">
          <p className="text-sm font-semibold text-slate-700">연결된 한글 공시 요약이 없습니다.</p>
          <p className="mt-2 text-sm text-slate-500">{ticker}의 10-K, 10-Q, 8-K 한글 요약이 준비되면 이 탭에 자동으로 표시됩니다.</p>
          <ExternalSourceLinks ticker={ticker} kind="filing" statusLine="연결된 한글 공시 요약 없음" className="mt-4" />
        </div>
      </section>
    );
  }

  const readyCount = readyFilings.length;
  const readyRatio = filings.length > 0 ? readyCount / filings.length : 0;
  const gaugeR = 32, gaugeCirc = 2 * Math.PI * gaugeR;
  const gaugeOffset = gaugeCirc * (1 - readyRatio);
  const dateRange = filings.length > 0 ? `${filings[filings.length - 1].filingDate} ~ ${filings[0].filingDate}` : "";
  const otherFilings = filings.filter((f) => f !== heroFiling && !feedFilings.includes(f));
  const otherReady = otherFilings.filter((f) => f.summaryPath);
  const otherPending = otherFilings.filter((f) => !f.summaryPath);

  return (
    <>
      <div className="cpw4-filing-section-head">
        <div>
          <p className="cpw4-hero__eyebrow">EDGAR · LLM 한글 요약</p>
          <h2 className="cpw4-hero__verdict" style={{ fontSize: 22 }}>공시가 지금 이 종목에 의미하는 것</h2>
          <p className="cpw4-hero__sub">최근 {filings.length}건 공시 · {dateRange}</p>
          <p className="cpw4-filing-ai-caption"><span className="dot" />AI가 SEC 원문 공시를 분석해 한국어로 번역·요약합니다 · 투자 판단의 단독 근거로 쓰지 마세요</p>
        </div>
        <div className="cpw4-filing-coverage-gauge">
          <svg width="76" height="76" viewBox="0 0 76 76">
            <circle cx="38" cy="38" r={gaugeR} fill="none" stroke="var(--cp-divider)" strokeWidth="9" />
            <circle cx="38" cy="38" r={gaugeR} fill="none" stroke="var(--cp-accent)" strokeWidth="9" strokeLinecap="round"
              strokeDasharray={gaugeCirc} strokeDashoffset={gaugeOffset} transform="rotate(-90 38 38)" />
            <text x="38" y="34" textAnchor="middle" fontSize="14" fontWeight="800" fill="var(--cp-text-strong)">{Math.round(readyRatio * 100)}%</text>
            <text x="38" y="48" textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--cp-text-soft)">요약 완료</text>
          </svg>
          <div>
            <div className="lbl">한글 요약 완료</div>
            <div className="val">{readyCount}<small>&nbsp;/&nbsp;{filings.length}건</small></div>
          </div>
        </div>
      </div>

      {heroFiling ? (
        <section className="cpw4-hero" id="filing-hero" data-stock-tab-card="filings-hero">
          <div className="cpw4-hero__top">
            <span className={`cpw4-badge ${filingFormBadgeClass(heroFiling.form)}`}>{heroFiling.form}</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--cp-text-muted)" }}>{heroFiling.filingDate} 접수</span>
            <span className="cpw4-badge cpw4-badge--warning">가장 중요한 최근 공시</span>
          </div>
          {heroArtifact === undefined ? (
            <p className="cpw4-hero__sub">요약을 불러오는 중입니다…</p>
          ) : (
            <>
              <h2 className="cpw4-hero__verdict">{heroArtifact?.summaryKo?.oneLine ?? heroFiling.summaryOneLine ?? heroFiling.title}</h2>
              {heroArtifact?.summaryKo?.keyPoints && heroArtifact.summaryKo.keyPoints.length > 0 ? (
                <div className="cpw4-filing-hero-bullets">
                  {heroArtifact.summaryKo.keyPoints.slice(0, 2).map((bullet, i) => (
                    <div className="cpw4-filing-bullet" key={i}>
                      <span className={`tag ${FILING_STANCE_CLASS[bullet.stance] ?? "cpw4-filing-tag-fact"}`}>{FILING_STANCE_LABEL[bullet.stance] ?? "핵심"}</span>
                      <span>{bullet.text}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          )}
          <div className="cpw4-chip-row" style={{ marginTop: 4 }}>
            <a href={heroFiling.sourceUrl} target="_blank" rel="noreferrer" className="cpw4-badge cpw4-badge--neutral">원문 보기</a>
            {heroFiling.translationPath ? <a href={heroFiling.translationPath} className="cpw4-badge cpw4-badge--neutral">번역 보기</a> : null}
          </div>
        </section>
      ) : null}

      {feedFilings.length > 0 ? (
        <section data-stock-tab-card="filings-feed">
          <div className="cpw4-section-head" style={{ marginBottom: 10 }}><h3>공시 피드 · 최근 상세 요약</h3></div>
          <div className="cpw4-filing-feed-grid">
            {feedFilings.map((filing) => {
              const artifact = filing.summaryPath ? feedArtifacts[filing.summaryPath] : null;
              const bullets = [
                ...(artifact?.summaryKo?.financialHighlights ?? []),
                ...(artifact?.summaryKo?.riskChanges ?? []),
              ].slice(0, 1);
              return (
                <article className="cpw4-filing-feed-card" key={filing.accession}>
                  <div className="cpw4-filing-feed-head">
                    <span className={`cpw4-badge ${filingFormBadgeClass(filing.form)}`}>{filing.form}</span>
                    <span className="date">{filing.filingDate} 접수</span>
                  </div>
                  <p className="cpw4-filing-feed-headline">{artifact?.summaryKo?.oneLine ?? filing.summaryOneLine ?? filing.title}</p>
                  {bullets.map((bullet, i) => (
                    <div className="cpw4-filing-bullet" key={i}>
                      <span className={`tag ${FILING_STANCE_CLASS[bullet.stance] ?? "cpw4-filing-tag-fact"}`}>{FILING_STANCE_LABEL[bullet.stance] ?? "핵심"}</span>
                      <span>{bullet.text}</span>
                    </div>
                  ))}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {filings.length > 1 ? <FilingsTimelineCp filings={filings} heroFiling={heroFiling} /> : null}

      {otherFilings.length > 0 ? (
        <section data-stock-tab-card="filings-other">
          <div className="cpw4-section-head" style={{ marginBottom: 10 }}><h3>그 외 공시 ({otherFilings.length}건)</h3></div>
          <div className="cpw4-filing-other-cols">
            {otherReady.length > 0 ? (
              <div>
                <p className="cpw4-filing-other-group-title">요약 완료 · 원문 참고 ({otherReady.length}건)</p>
                {otherReady.map((f) => (
                  <div className="cpw4-filing-other-row" id={`other-${f.accession}`} key={f.accession}>
                    <span className={`cpw4-badge ${filingFormBadgeClass(f.form)}`}>{f.form}</span>
                    <span className="date">{f.filingDate}</span>
                    <span className="stat stat--ready">요약 완료</span>
                    <a href={f.sourceUrl} target="_blank" rel="noreferrer" className="cta">원문 보기</a>
                  </div>
                ))}
              </div>
            ) : null}
            {otherPending.length > 0 ? (
              <div>
                <p className="cpw4-filing-other-group-title">요약 대기 ({otherPending.length}건)</p>
                {otherPending.map((f) => (
                  <div className="cpw4-filing-other-row" key={f.accession}>
                    <span className="cpw4-badge cpw4-badge--neutral">{f.form}</span>
                    <span className="date">{f.filingDate}</span>
                    <span className="stat stat--pending">요약 대기</span>
                    <a href={f.sourceUrl} target="_blank" rel="noreferrer" className="cta">원문 보기</a>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <p className="cpw4-disclaimer">EDGAR 공시 원문 · Fenok LLM 한글 요약(자동 생성) · 투자 판단의 참고 자료이며 매수·매도 권유가 아닙니다.</p>
    </>
  );
}

function FilingsTimelineCp({ filings, heroFiling }: { filings: EdgarKoreanSummaryFilingEntry[]; heroFiling: EdgarKoreanSummaryFilingEntry | null }) {
  const sorted = [...filings].sort((a, b) => a.filingDate.localeCompare(b.filingDate));
  const dates = sorted.map((f) => new Date(f.filingDate).getTime()).filter((t) => Number.isFinite(t));
  if (dates.length === 0) return null;
  const minT = Math.min(...dates);
  const maxT = Math.max(...dates);
  const span = Math.max(1, maxT - minT);
  const W = 1200, padX = 90;
  const xFor = (dateStr: string) => {
    const t = new Date(dateStr).getTime();
    if (!Number.isFinite(t)) return padX;
    return padX + ((t - minT) / span) * (W - padX - 40);
  };
  const periodicLaneY = 52, eightKLaneY = 102;
  const isPeriodic = (form: string) => form === "10-K" || form === "10-Q" || form === "20-F";

  return (
    <section data-stock-tab-card="filings-timeline">
      <div className="cpw4-section-head" style={{ marginBottom: 8 }}><h3>공시 캘린더 · {filings.length}건</h3></div>
      <svg className="cpw4-filing-timeline-svg" viewBox={`0 0 ${W} 150`} preserveAspectRatio="xMidYMid meet">
        <line x1={padX} y1={periodicLaneY} x2={W - 40} y2={periodicLaneY} stroke="var(--cp-divider)" strokeWidth={1} />
        <line x1={padX} y1={eightKLaneY} x2={W - 40} y2={eightKLaneY} stroke="var(--cp-divider)" strokeWidth={1} />
        <text x={4} y={periodicLaneY + 4} fontSize="11.5" fontWeight="700" fill="var(--cp-text-soft)">10-K/Q</text>
        <text x={4} y={eightKLaneY + 4} fontSize="11.5" fontWeight="700" fill="var(--cp-text-soft)">8-K 등</text>
        {sorted.map((f) => {
          const x = xFor(f.filingDate);
          const y = isPeriodic(f.form) ? periodicLaneY : eightKLaneY;
          const ready = Boolean(f.summaryPath);
          const isHero = Boolean(heroFiling && f.accession === heroFiling.accession);
          const anchor = ready ? (isHero ? "#filing-hero" : `#other-${f.accession}`) : undefined;
          const dot = (
            <>
              <circle cx={x} cy={y} r={isHero ? 8 : 6} fill={ready ? (isPeriodic(f.form) ? "var(--cp-chart-line-2)" : "var(--cp-warning)") : "var(--cp-surface)"}
                stroke={ready ? "none" : "var(--cp-neutral)"} strokeWidth={ready ? 0 : 1.6} strokeDasharray={ready ? undefined : "2 1.6"}>
                <title>{`${f.form} · ${f.filingDate} · ${ready ? "요약 완료" : "요약 대기"}`}</title>
              </circle>
              {isHero ? <circle cx={x} cy={y} r={11} fill="none" stroke="var(--cp-warning)" strokeWidth={2} opacity={0.6} /> : null}
            </>
          );
          return anchor ? <a href={anchor} key={f.accession}>{dot}</a> : <g key={f.accession}>{dot}</g>;
        })}
      </svg>
      <div className="cpw4-filing-timeline-legend">
        <span><span className="dot" style={{ background: "var(--cp-chart-line-2)" }} />10-K/10-Q 요약 완료</span>
        <span><span className="dot" style={{ background: "var(--cp-warning)" }} />8-K 등 요약 완료</span>
        <span><span className="dot" style={{ border: "1.6px dashed var(--cp-neutral)", background: "transparent" }} />요약 대기</span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// W4 Fenok Edge — overview 탭 full-width 섹션
// ---------------------------------------------------------------------------

interface EdgeAxisRow { key: string; label: string; score: number | null; inverted: boolean; group: "short" | "long" }

const EDGE_SHORT_AXES: Array<{ key: keyof FenokSignalsSummaryRecord; label: string; inverted?: boolean }> = [
  { key: "technicalFlowScore", label: "기술·자금 흐름" },
  { key: "volumeLiquidityTrendScore", label: "거래량·유동성" },
  { key: "shortTermRelativeStrengthScore", label: "단기 상대강도" },
  { key: "netOptionsProxyScore", label: "옵션 활동" },
  { key: "offExchangeActivityProxyScore", label: "장외거래" },
  { key: "shortPressureProxyScore", label: "숏압력 완화", inverted: true },
];
const EDGE_LONG_AXES: Array<{ key: keyof FenokSignalsSummaryRecord; label: string; inverted?: boolean }> = [
  { key: "profitabilityScore", label: "수익성" },
  { key: "growthScore", label: "성장" },
  { key: "upsidePotentialScore", label: "상승 잠재력" },
  { key: "downsidePressureScore", label: "하락 압력(안정)", inverted: true },
  { key: "marketSimilarityScore", label: "동종군 유사성" },
  { key: "durabilityProfitabilityScore", label: "내구 수익성" },
];

function buildEdgeAxes(record: FenokSignalsSummaryRecord, config: typeof EDGE_SHORT_AXES, group: "short" | "long"): EdgeAxisRow[] {
  return config.map((c) => {
    const raw = record[c.key];
    const rawScore = isFiniteNumber(raw) ? raw : null;
    const score = rawScore !== null && c.inverted ? Math.max(0, Math.min(100, 100 - rawScore)) : rawScore;
    return { key: c.key as string, label: c.label, score, inverted: Boolean(c.inverted), group };
  });
}

function FenokEdgeSectionCp({ record }: { record: FenokSignalsSummaryRecord | null | undefined; symbol: string }) {
  if (!record) return null;
  const shortAxes = buildEdgeAxes(record, EDGE_SHORT_AXES, "short");
  const longAxes = buildEdgeAxes(record, EDGE_LONG_AXES, "long");
  const allAxes = [...shortAxes, ...longAxes];
  if (!allAxes.some((a) => a.score !== null)) return null;

  const shortScore = isFiniteNumber(record.shortTermConvictionScore) ? record.shortTermConvictionScore
    : isFiniteNumber(record.shortTermScore) ? record.shortTermScore : null;
  const longScore = isFiniteNumber(record.longTermConvictionScore) ? record.longTermConvictionScore
    : isFiniteNumber(record.longTermScore) ? record.longTermScore : null;
  const compositeScoreRaw = isFiniteNumber(record.convictionScore) ? record.convictionScore
    : shortScore !== null && longScore !== null ? (shortScore + longScore) / 2
    : shortScore ?? longScore;

  const round = (v: number | null) => (v === null ? null : Math.round(Math.max(0, Math.min(100, v))));
  const compositeR = round(compositeScoreRaw);
  const shortR = round(shortScore);
  const longR = round(longScore);

  const compositeVerdict = shortR !== null && longR !== null
    ? (shortR >= longR + 12 ? "단기 신호가 장기 펀더멘털을 앞섭니다" : longR >= shortR + 12 ? "장기 펀더멘털이 단기 신호를 앞섭니다" : "단기 신호와 장기 펀더멘털이 균형을 이룹니다")
    : "신호 커버리지가 제한적입니다";
  const compositeTone: "positive" | "warning" | "neutral" = shortR !== null && longR !== null && Math.abs(shortR - longR) >= 12
    ? (longR > shortR ? "positive" : "warning")
    : "neutral";

  const rankedAxes = allAxes.filter((a) => a.score !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const best = rankedAxes[0] ?? null;
  const worst = rankedAxes[rankedAxes.length - 1] ?? null;
  const asOfLabel = fmtKstMinute(record.asOf);
  const coverage = record.lensCoverageRatio ?? record.coverageRatio;

  const gaugeR = 90, gaugeCirc = Math.PI * gaugeR;
  const semiGauge = (score: number | null) => {
    const clamped = score === null ? 0 : Math.max(0, Math.min(100, score));
    return { filled: gaugeCirc * (clamped / 100), total: gaugeCirc };
  };
  const shortGauge = semiGauge(shortR);
  const longGauge = semiGauge(longR);
  const donutR2 = 70, donutCirc2 = 2 * Math.PI * donutR2;
  const donutOffset2 = compositeR === null ? donutCirc2 : donutCirc2 * (1 - compositeR / 100);

  function renderRadar(axes: EdgeAxisRow[], color: string, label: string) {
    const cx = 130, cy = 122, maxR = 76;
    const points = radarPolygonPoints(axes.map((a) => a.score), cx, cy, maxR);
    return (
      <svg viewBox="0 0 260 244" role="img" aria-label={`${label} 6축 레이더`}>
        {[1, 0.75, 0.5, 0.25].map((level) => (
          <polygon key={level} points={radarPolygonPoints(axes.map(() => 100 * level), cx, cy, maxR)} fill="none" stroke="var(--cp-divider)" strokeWidth={1} opacity={0.55} />
        ))}
        {axes.map((_, i) => {
          const [x, y] = polarPoint(cx, cy, maxR, (360 / axes.length) * i);
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--cp-divider)" opacity={0.55} />;
        })}
        <polygon points={points} fill={`color-mix(in srgb, ${color} 16%, transparent)`} stroke={color} strokeWidth={2} strokeLinejoin="round" />
        {axes.map((a, i) => {
          const r = (maxR * Math.max(0, Math.min(100, a.score ?? 0))) / 100;
          const [x, y] = polarPoint(cx, cy, r, (360 / axes.length) * i);
          return <circle key={a.key} cx={x} cy={y} r={3} fill={color} />;
        })}
        {axes.map((a, i) => {
          const [x, y] = polarPoint(cx, cy, maxR + 28, (360 / axes.length) * i);
          return (
            <text key={`${a.key}-label`} x={x} y={y} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--cp-text-soft)">
              {a.label} {a.score !== null ? Math.round(a.score) : "—"}
            </text>
          );
        })}
      </svg>
    );
  }

  function renderAxisGroup(axes: EdgeAxisRow[], groupClass: "short" | "long", title: string) {
    return (
      <div>
        <div className={`cpw4-edge-axis-group-title cpw4-edge-axis-group-title--${groupClass}`}><span className="dot" />{title}</div>
        {axes.map((a) => {
          const tone = axisToneClass(a.score);
          return (
            <div className="cpw4-edge-axis-row" key={a.key}>
              <span className="cpw4-edge-axis-name">{a.label}</span>
              <span className="cpw4-edge-axis-track"><span className={`cpw4-edge-axis-fill cpw4-edge-axis-fill--${tone}`} style={{ width: `${a.score ?? 0}%` }} /></span>
              <span className="cpw4-edge-axis-value">{a.score !== null ? Math.round(a.score) : "—"}</span>
              <span className={`cpw4-edge-axis-tone cpw4-edge-axis-tone--${tone}`}>{axisToneLabel(tone)}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <section className="cpw4-edge-section" data-stock-tab-card="fenok-edge-overview">
      <div className="cpw4-edge-head">
        <div>
          <p className="cpw4-hero__eyebrow">FENOK EDGE · 단기·장기 진단</p>
          <h2 className="cpw4-hero__verdict" style={{ fontSize: 22 }}>{compositeVerdict}</h2>
          <p className="cpw4-hero__sub">
            {best ? <>최강 신호는 <b>{best.label}</b>({Math.round(best.score ?? 0)}), </> : null}
            {worst ? <>최약 신호는 <b>{worst.label}</b>({Math.round(worst.score ?? 0)})입니다.</> : null}
          </p>
        </div>
        <div className="cpw4-edge-head-right">
          <div className="cpw4-edge-meta-row">
            {record.confidence ? <span className="cpw4-badge cpw4-badge--positive">신뢰 {record.confidence === "high" ? "높음" : record.confidence === "medium" ? "중간" : "낮음"}</span> : null}
            {isFiniteNumber(coverage) ? <span className="cpw4-badge cpw4-badge--neutral">커버리지 {formatCoverageRatio(coverage)}</span> : null}
          </div>
          <span style={{ fontSize: 11, color: "var(--cp-text-soft)" }}>FENOK 파생 신호 · 매수 권유 아님</span>
        </div>
      </div>

      <div className="cpw4-edge-hero-row">
        <div className="cpw4-edge-score-card cpw4-edge-score-card--composite">
          <span className="cpw4-edge-score-label">종합 컨빅션</span>
          <div className="cpw4-edge-gauge-wrap" style={{ width: 176, aspectRatio: "1 / 1" }}>
            <svg viewBox="0 0 176 176">
              <circle cx="88" cy="88" r={donutR2} fill="none" stroke="var(--cp-surface-strong)" strokeWidth="16" />
              <circle cx="88" cy="88" r={donutR2} fill="none" stroke="var(--cp-neutral)" strokeWidth="16" strokeLinecap="round"
                strokeDasharray={donutCirc2} strokeDashoffset={donutOffset2} transform="rotate(-90 88 88)" />
            </svg>
            <div className="cpw4-edge-gauge-value"><strong>{compositeR ?? "—"}</strong><span>/ 100</span></div>
          </div>
          <span className={`cpw4-badge cpw4-badge--${compositeTone}`}>{compositeTone === "positive" ? "장기 우세" : compositeTone === "warning" ? "단기 우세" : "균형"}</span>
          <p className="cpw4-edge-score-read">{compositeVerdict}</p>
        </div>

        <div className="cpw4-edge-score-card cpw4-edge-score-card--short">
          <span className="cpw4-edge-score-label">SHORT EDGE · 단기</span>
          <div className="cpw4-edge-gauge-wrap" style={{ width: 220, aspectRatio: "220 / 132" }}>
            <svg viewBox="0 0 220 132">
              <path d="M 20 110 A 90 90 0 0 1 200 110" fill="none" stroke="var(--cp-surface-strong)" strokeWidth="16" strokeLinecap="round" />
              <path d="M 20 110 A 90 90 0 0 1 200 110" fill="none" stroke="var(--cp-warning)" strokeWidth="16" strokeLinecap="round" strokeDasharray={`${shortGauge.filled} ${shortGauge.total}`} />
            </svg>
            <div className="cpw4-edge-gauge-value" style={{ bottom: 6 }}><strong>{shortR ?? "—"}</strong><span>/100</span></div>
          </div>
          <p className="cpw4-edge-score-read">단기 6축 평균 신호입니다. {worst && worst.group === "short" ? <>가장 약한 축은 <b>{worst.label}</b>({Math.round(worst.score ?? 0)})입니다.</> : null}</p>
        </div>

        <div className="cpw4-edge-score-card cpw4-edge-score-card--long">
          <span className="cpw4-edge-score-label">LONG EDGE · 장기</span>
          <div className="cpw4-edge-gauge-wrap" style={{ width: 220, aspectRatio: "220 / 132" }}>
            <svg viewBox="0 0 220 132">
              <path d="M 20 110 A 90 90 0 0 1 200 110" fill="none" stroke="var(--cp-surface-strong)" strokeWidth="16" strokeLinecap="round" />
              <path d="M 20 110 A 90 90 0 0 1 200 110" fill="none" stroke="var(--cp-positive)" strokeWidth="16" strokeLinecap="round" strokeDasharray={`${longGauge.filled} ${longGauge.total}`} />
            </svg>
            <div className="cpw4-edge-gauge-value" style={{ bottom: 6 }}><strong>{longR ?? "—"}</strong><span>/100</span></div>
          </div>
          <p className="cpw4-edge-score-read">장기 6축 평균 신호입니다. {best && best.group === "long" ? <>가장 강한 축은 <b>{best.label}</b>({Math.round(best.score ?? 0)})입니다.</> : null}</p>
        </div>
      </div>

      {best || worst ? (
        <div className="cpw4-edge-signal-strip">
          {best ? <div className="cpw4-edge-signal-chip cpw4-edge-signal-chip--best"><span className="tag">최강 신호</span><div className="body"><span className="name">{best.label}</span></div><span className="val">{Math.round(best.score ?? 0)}</span></div> : null}
          {worst ? <div className="cpw4-edge-signal-chip cpw4-edge-signal-chip--worst"><span className="tag">최약 신호</span><div className="body"><span className="name">{worst.label}</span></div><span className="val">{Math.round(worst.score ?? 0)}</span></div> : null}
        </div>
      ) : null}

      <div className="cpw4-edge-radar-row">
        <div className="cpw4-edge-radar-card">
          <div className="cpw4-edge-radar-head"><div className="cpw4-edge-radar-title cpw4-edge-radar-title--short">SHORT-TERM 6축</div><div className="cpw4-edge-radar-sub">기술·거래·강도·옵션·장외·숏완화</div></div>
          <div className="cpw4-edge-radar-svg">{renderRadar(shortAxes, "var(--cp-warning)", "단기")}</div>
        </div>
        <div className="cpw4-edge-radar-card">
          <div className="cpw4-edge-radar-head"><div className="cpw4-edge-radar-title cpw4-edge-radar-title--long">LONG-TERM 6축</div><div className="cpw4-edge-radar-sub">수익성·성장·상방·하방·동종군·내구</div></div>
          <div className="cpw4-edge-radar-svg">{renderRadar(longAxes, "var(--cp-positive)", "장기")}</div>
        </div>
      </div>

      <div className="cpw4-edge-axis-groups">
        {renderAxisGroup(shortAxes, "short", "단기 축 (SHORT · 6)")}
        {renderAxisGroup(longAxes, "long", "장기 축 (LONG · 6)")}
      </div>

      <div className="cpw4-edge-footnote">
        <span>FENOK 신호 한눈에 보기 · 매수 권유 아님</span>
        <span>{asOfLabel ? `기준 ${asOfLabel}` : "기준일 미확인"}{isFiniteNumber(coverage) ? ` · 데이터 커버리지 ${formatCoverageRatio(coverage)}` : ""}</span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// StockDetailClient main
// ---------------------------------------------------------------------------

export default function StockDetailClient({
  ticker,
  assetHint,
  initialTab,
  enableCanvasPlusPreview = false,
}: {
  ticker: string;
  assetHint?: "stock" | "etf";
  initialTab?: StockTab;
  enableCanvasPlusPreview?: boolean;
}) {
  const symbol = normalizeForEntityKey(ticker);
  const [row, setRow] = useState<AnalyzerRow | null | undefined>(undefined);
  const { data: marketFacts, loading: marketFactsLoading } = useMarketFacts(symbol, assetHint !== "etf");
  const canLoadStockData = row !== undefined && row !== null;
  const { detail, loading: detailLoading } = useStockDetail(symbol, canLoadStockData);
  const f13Entries = use13FData(symbol);
  const canonical = row ? resolveSector(null, row.sector) : null;
  const years: string[] = Array.isArray(detail?.years) ? detail.years : [];
  const rowPerBand = validAnalyzerPerBand(row);
  const detailPerBands = validDetailPerBands(detail?.per_bands);
  const valuationBandSummary = resolveValuationBandSummary(rowPerBand, detailPerBands);
  const profitabilityEstimates = detail ? deriveProfitabilityEstimates(detail) : null;

  useEffect(() => {
    let cancelled = false;
    if (assetHint === "etf") {
      Promise.resolve().then(() => {
        if (!cancelled) setRow(null);
      });
      return () => { cancelled = true; };
    }
    loadAnalyzer().then((map) => { if (!cancelled) setRow(map?.[symbol] ?? null); });
    return () => { cancelled = true; };
  }, [assetHint, symbol]);

  const rowLoading = row === undefined;
  const [yfData, setYfData] = useState<any | undefined>(undefined);
  const [stockTab, setStockTab] = useState<StockTab>(initialTab ?? "overview");
  const [etfData, setEtfData] = useState<StockanalysisEtfPayload | null | undefined>(undefined);
  const [etfSurfaceData, setEtfSurfaceData] = useState<TickerSurfacePayload | null | undefined>(undefined);
  const [stockAuxData, setStockAuxData] = useState<StockanalysisStockPayload | null | undefined>(undefined);
  const [financialCandidate, setFinancialCandidate] = useState<StockanalysisFinancialPayload | null | undefined>(undefined);
  const [connectionEntry, setConnectionEntry] = useState<StockConnectionEntry | null | undefined>(undefined);
  const [stockServicesEntry, setStockServicesEntry] = useState<StockServicesEntry | null | undefined>(undefined);
  const [fenokSignalLens, setFenokSignalLens] = useState<FenokSignalsSummaryRecord | null | undefined>(undefined);
  const [stockChartRange, setStockChartRange] = useState<StockChartRange>("1Y");
  const [highlightDividend, setHighlightDividend] = useState(false);
  const marketFactsAssetType = marketFacts?.asset_type;
  const selectStockTab = useCallback((tab: StockTab, mode: "push" | "replace" = "push", hash: string | null = null) => {
    setStockTab(tab);
    writeStockTabUrl(tab, mode, hash);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setConnectionEntry(undefined);
    });
    loadStockConnectionIndex()
      .then((index) => {
        if (!cancelled) setConnectionEntry(getStockConnection(index, symbol));
      })
      .catch(() => {
        if (!cancelled) setConnectionEntry(null);
      });
    return () => { cancelled = true; };
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setStockServicesEntry(undefined);
    });
    loadStockServicesIndex()
      .then((index) => {
        if (!cancelled) setStockServicesEntry(getStockServices(index, symbol));
      })
      .catch(() => {
        if (!cancelled) setStockServicesEntry(null);
      });
    return () => { cancelled = true; };
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setFenokSignalLens(undefined);
    });
    loadFenokSignalsSummaryMap()
      .then((map) => {
        if (!cancelled) setFenokSignalLens(map.get(symbol) ?? null);
      })
      .catch(() => {
        if (!cancelled) setFenokSignalLens(null);
      });
    return () => { cancelled = true; };
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    if (!canLoadStockData) {
      Promise.resolve().then(() => {
        if (!cancelled) setYfData(row === null ? null : undefined);
      });
      return () => { cancelled = true; };
    }
    loadYfFinance(symbol).then((d) => { if (!cancelled) setYfData(d ?? null); });
    return () => { cancelled = true; };
  }, [symbol, canLoadStockData, row]);

  useEffect(() => {
    let cancelled = false;
    const shouldLoadEtfData = assetHint === "etf" || marketFactsAssetType === "etf" || (row === null && !marketFactsLoading);
    if (!shouldLoadEtfData) {
      Promise.resolve().then(() => {
        if (!cancelled) setEtfData(null);
      });
      return () => { cancelled = true; };
    }
    Promise.resolve().then(() => {
      if (!cancelled) setEtfData(undefined);
    });
    loadStockanalysisEtf(symbol).then((d) => { if (!cancelled) setEtfData(d); });
    return () => { cancelled = true; };
  }, [assetHint, marketFactsAssetType, marketFactsLoading, row, symbol]);

  useEffect(() => {
    let cancelled = false;
    const shouldLoadEtfSurfaceData = assetHint === "etf" || marketFactsAssetType === "etf" || (row === null && !marketFactsLoading);
    if (!shouldLoadEtfSurfaceData) {
      Promise.resolve().then(() => {
        if (!cancelled) setEtfSurfaceData(null);
      });
      return () => { cancelled = true; };
    }
    Promise.resolve().then(() => {
      if (!cancelled) setEtfSurfaceData(undefined);
    });
    loadTickerSurfaces(symbol, "etf").then((d) => { if (!cancelled) setEtfSurfaceData(d); });
    return () => { cancelled = true; };
  }, [assetHint, marketFactsAssetType, marketFactsLoading, row, symbol]);

  useEffect(() => {
    let cancelled = false;
    if (assetHint === "etf" || !canLoadStockData) {
      Promise.resolve().then(() => {
        if (!cancelled) setStockAuxData(null);
      });
      return () => { cancelled = true; };
    }
    Promise.resolve().then(() => {
      if (!cancelled) setStockAuxData(undefined);
    });
    loadStockanalysisStock(symbol).then((d) => { if (!cancelled) setStockAuxData(d); });
    return () => { cancelled = true; };
  }, [assetHint, canLoadStockData, symbol]);

  useEffect(() => {
    let cancelled = false;
    if (assetHint === "etf") {
      Promise.resolve().then(() => {
        if (!cancelled) setFinancialCandidate(null);
      });
      return () => { cancelled = true; };
    }
    Promise.resolve().then(() => {
      if (!cancelled) setFinancialCandidate(undefined);
    });
    loadStockanalysisFinancials(symbol).then((d) => { if (!cancelled) setFinancialCandidate(d); });
    return () => { cancelled = true; };
  }, [assetHint, symbol]);

  const [benchDoc, setBenchDoc] = useState<Awaited<ReturnType<typeof loadIndustryBenchmarks>>>(null);
  useEffect(() => {
    let cancelled = false;
    loadIndustryBenchmarks().then((doc) => { if (!cancelled) setBenchDoc(doc); });
    return () => { cancelled = true; };
  }, []);
  const industryBench: IndustryBench | null = useMemo(
    () => resolveIndustryBench(benchDoc, yfData?.info?.industry),
    [benchDoc, yfData],
  );
  const benchPct = (value: MaybeNumber) => (isFiniteNumber(value) ? value * 100 : null);

  const yfLoaded = yfData !== undefined;
  const yfAvailable = yfData != null;
  const hasEtfSurfaceData = surfaceRowsReturned(etfSurfaceData) > 0;
  const etfSurface = etfSurfaceFallback(etfSurfaceData, symbol);
  const isEtfAsset = assetHint === "etf" || marketFacts?.asset_type === "etf" || etfData?.asset_type === "etf" || hasEtfSurfaceData;
  const isEtfOnlyAsset = isEtfAsset && !row;
  const showFilingsTab = !isEtfAsset;
  const activeStockTab: StockTab = !isEtfAsset && stockTab === "etf"
    ? "overview"
    : !showFilingsTab && stockTab === "filings"
      ? (isEtfOnlyAsset ? "etf" : "overview")
      : isEtfOnlyAsset && stockTab === "overview"
        ? "etf"
        : stockTab;
  const stockTabs: StockTabItem[] = [
    ...(!isEtfOnlyAsset ? [{ id: "overview" as const, label: "요약" }] : []),
    ...(isEtfAsset ? [{ id: "etf" as const, label: "ETF" }] : []),
    ...(yfAvailable
      ? [
          { id: "statistics" as const, label: "밸류" },
          { id: "estimates" as const, label: "추정치" },
          { id: "financials" as const, label: "재무" },
          { id: "ownership" as const, label: "보유기관" },
        ]
      : []),
    ...(showFilingsTab ? [{ id: "filings" as const, label: "공시" }] : []),
  ];

  useEffect(() => {
    if (activeStockTab !== "financials" || typeof window === "undefined" || window.location.hash !== "#dividend") return;
    const raf = window.requestAnimationFrame(() => {
      const panel = document.getElementById("dividend");
      if (!panel) return;
      panel.scrollIntoView({ block: "start", behavior: "smooth" });
      setHighlightDividend(true);
      window.setTimeout(() => setHighlightDividend(false), 1800);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [activeStockTab, detail, detailLoading]);

  useEffect(() => {
    function handlePopState() {
      setStockTab(stockTabFromLocation());
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    writeStockTabUrl(activeStockTab, "replace");
  }, [activeStockTab]);

  // Unknown ticker
  if (!rowLoading && !row) {
    if (marketFactsLoading || etfData === undefined || etfSurfaceData === undefined) {
      return (
        <div className="stock-shell">
          <div className="panel stock-empty">
            <p className="text-lg font-black text-slate-700">통합 데이터 확인 중</p>
            <p className="mt-2 text-sm font-semibold text-slate-500">{symbol} 통합 데이터를 확인하고 있습니다.</p>
          </div>
        </div>
      );
    }
    if (marketFacts || etfData || hasEtfSurfaceData) {
      const identity = marketFacts?.identity ?? {};
      const quote = etfData?.normalized?.quote ?? {};
      const etfOverview = etfData?.normalized?.overview ?? {};
      const displayAssetName = identity.name ?? cleanSurfaceText(etfOverview.name) ?? etfSurface.name;
      const price = factNumber(marketFacts, "price") ?? (isFiniteNumber(quote.p) ? quote.p : null) ?? etfSurface.price;
      const changePct = factNumber(marketFacts, "change_pct") ?? (isFiniteNumber(quote.cp) ? quote.cp : null) ?? etfSurface.changePct;
      const category = identity.category ?? cleanSurfaceText(etfOverview.category) ?? etfSurface.category;
      const delayText = fmtDateish(quote.u) !== "—"
        ? fmtDateish(quote.u)
        : etfSurface.inceptionDate
          ? `신규 ETF ${etfSurface.inceptionDate}`
          : "데이터 지연 가능";
      return (
        <div className="stock-shell">
          <section className="stock-entity panel">
            <div className="stock-entity-in">
              <span className="stock-logo">{symbol.slice(0, 1)}</span>
              <div className="stock-id">
                <div className="stock-name">
                  <h1>{symbol}</h1>
                  <WatchStar ticker={symbol} className="stock-star" />
                </div>
                <div className="stock-meta">
                  <span className="entity-name" title={displayAssetName}>{displayAssetName}</span>
                  <span className="x">·</span>
                  <span className="num">{symbol}</span>
                  {isEtfAsset || marketFacts?.asset_type ? (
                    <>
                      <span className="x">·</span>
                      <span>{isEtfAsset ? "ETF" : marketFacts?.asset_type}</span>
                    </>
                  ) : null}
                  {category ? (
                    <>
                      <span className="x">·</span>
                      <span>{category}</span>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="stock-price">
                <span className="big num">{price !== null ? formatMoney(price, identity.currency ?? "USD") : "—"}</span>
                {changePct !== null ? <span className={`stock-chip num ${changePct >= 0 ? "up" : "down"}`}>{fmtEtfSignedPct(changePct)}</span> : null}
                <span className="delay">{delayText}</span>
              </div>
            </div>
            <MarketQuickLinks className="stock-market-links" />
            <StockTabsNav
              symbol={symbol}
              tabs={stockTabs}
              activeTab={activeStockTab}
              onSelect={selectStockTab}
              note={etfData === undefined ? "ETF 상세 로딩 중..." : null}
            />
          </section>
          <div
            id={stockPanelId(symbol, activeStockTab)}
            role="tabpanel"
            aria-labelledby={stockTabId(symbol, activeStockTab)}
            tabIndex={0}
            className="stock-body"
          >
            {activeStockTab === "etf" ? (
              <div className="stock-summary-stack">
                {marketFacts ? <MarketFactsDepth ticker={symbol} compact /> : null}
                <TickerSurfaceEventsCard ticker={symbol} assetKind="etf" compact />
              </div>
            ) : null}
            <div className="stock-main-stack">
              {activeStockTab === "etf" ? (
                <EtfDataPanel ticker={symbol} data={etfData} loading={etfData === undefined} marketFacts={marketFacts} />
              ) : (
                <MarketFactsDepth ticker={symbol} />
              )}
              <footer className="stock-footer">
                <TransitionLink href={isEtfAsset ? ROUTES.etfs : ROUTES.screener} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">← {isEtfAsset ? "ETF 목록으로 이동" : "스크리너로 이동"}</TransitionLink>
                <TransitionLink href={ROUTES.portfolioTicker(symbol)} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">포트폴리오에서 보기</TransitionLink>
              </footer>
            </div>
          </div>
        </div>
      );
    }
    if (assetHint === "etf") {
      return (
        <div className="stock-shell">
          <div className="panel stock-empty">
            <DataStateNotice
              state={makeDataState({
                status: "unavailable",
                label: "ETF 상세 데이터 준비 중",
                detail: `${symbol} — 목록에는 잡혔지만 보유 구성과 가격 정보가 아직 충분히 연결되지 않았습니다.`,
              })}
            />
            <ExternalSourceLinks ticker={symbol} kind="etf" statusLine="ETF 상세 준비 전" className="mt-4" />
            <TransitionLink href={ROUTES.etfs} className="mt-4 inline-flex min-h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive">← ETF 목록에서 보기</TransitionLink>
          </div>
        </div>
      );
    }
    return (
      <div className="stock-shell">
        <div className="panel stock-empty">
          <DataStateNotice
            state={makeDataState({
              status: "unavailable",
              label: "해당 티커를 찾을 수 없습니다",
              detail: `${symbol} — 아직 데이터에 등록되지 않았거나 갱신 전인 티커입니다.`,
            })}
          />
          <ExternalSourceLinks ticker={symbol} kind="stock" statusLine="종목 데이터 준비 전" className="mt-4" />
          <TransitionLink href={ROUTES.screener} className="mt-4 inline-flex min-h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive">← 스크리너에서 보기</TransitionLink>
        </div>
      </div>
    );
  }

  const displayName = row?.companyName ?? symbol;
  const displayCurrency = typeof yfData?.info?.currency === "string" ? yfData.info.currency : "USD";
  const yfCurrentPrice = isFiniteNumber(yfData?.info?.currentPrice) ? yfData.info.currentPrice : null;
  const analyzerPrice = isFiniteNumber(row?.price) ? row.price : null;
  const displayPrice = yfCurrentPrice ?? analyzerPrice;
  const priceText = displayPrice !== null ? formatMoney(displayPrice, displayCurrency) : "—";
  const hasSlickChartsTicker = !symbol.includes(".");
  const yfMarketCap = isFiniteNumber(yfData?.info?.marketCap) ? yfData.info.marketCap : null;
  const marketCapText = yfMarketCap !== null
    ? formatCompactMoney(yfMarketCap, displayCurrency)
    : isFiniteNumber(row?.marketCap)
      ? fmtMcap(row.marketCap)
      : "—";
  const marketCapLabel = yfMarketCap !== null ? "시가총액" : "시가총액(USD)";
  const returnText = isFiniteNumber(row?.return12m) ? fmtPct(row.return12m) : null;
  const returnUp = (row?.return12m ?? 0) >= 0;
  const priceDataState = makeDataState({
    status: marketFactsLoading
      ? "pending"
      : displayPrice !== null && marketFacts
        ? "ready"
        : displayPrice !== null
          ? "partial"
          : "unavailable",
    label: marketFactsLoading
      ? "가격 확인 중"
      : displayPrice !== null
        ? "가격 표시됨"
        : "가격 없음",
    detail: displayPrice !== null
      ? "가격은 지연 가능 시세입니다."
      : "표시할 가격 데이터를 찾지 못했습니다.",
    asOf: typeof marketFacts?.generated_at === "string" ? marketFacts.generated_at : null,
  });
  const stockChartData = stockHistoryToChartData(stockAuxData?.normalized?.history);
  const rangedStockChartData = filterStockChartRange(stockChartData, stockChartRange);
  const stockChartCopy = stockChartSummary(rangedStockChartData, displayCurrency, stockChartRange);
  const marketChangePct = factNumber(marketFacts, "change_pct");
  const heroChangeText = marketChangePct !== null ? fmtEtfSignedPct(marketChangePct) : returnText ? `12M ${returnText}` : "변화율 대기";
  const heroChangeUp = marketChangePct !== null ? marketChangePct >= 0 : returnUp;
  const previewMetricCards = [
    { label: "시가총액", value: marketCapText, note: marketCapLabel },
    { label: "PER", value: isFiniteNumber(row?.per) ? `${row.per.toFixed(1)}x` : "—", note: "현재" },
    { label: "PBR", value: isFiniteNumber(row?.pbr) ? `${row.pbr.toFixed(2)}x` : "—", note: "장부가" },
    { label: "12M 수익률", value: returnText ?? "—", note: "후행 성과" },
  ];
  const sectorFilterHref = row?.sector
    ? `${ROUTES.screener}?sector=${encodeURIComponent(row.sector)}`
    : ROUTES.screener;

  if (enableCanvasPlusPreview && !isEtfOnlyAsset) {
    const contextLine = [
      displayName,
      canonical ? sectorLabelKo(canonical) : null,
      row?.sector ?? null,
      marketCapText !== "—" ? `${marketCapLabel} ${marketCapText}` : null,
    ].filter(Boolean).join(" · ");

    return (
      <div className="stock-shell canvas-plus cp-stock-detail-preview" data-canvas-plus data-canvas-plus-stock-detail-preview>
        <section className="cp-stock-detail-hero" aria-label={`${symbol} CANVAS+ 종목 요약`}>
          <div className="cp-stock-detail-hero__identity">
            <span className="cp-stock-detail-logo">{symbol.slice(0, 1)}</span>
            <div>
              <div className="cp-stock-detail-title-row">
                <h1>{symbol}</h1>
                <WatchStar ticker={symbol} className="stock-star" />
              </div>
              <p>{contextLine || "종목 컨텍스트 로딩 중"}</p>
            </div>
          </div>
          <div className="cp-stock-detail-price">
            <span className="cp-stock-detail-price__value">{priceText}</span>
            <span className="cp-stock-detail-price__chip" data-tone={heroChangeUp ? "positive" : "negative"}>{heroChangeText}</span>
            <DataStateBadge state={priceDataState} />
          </div>
          <div className="cp-stock-detail-hero__links">
            <MarketQuickLinks className="stock-market-links" />
          </div>
          <StockTabsNav
            symbol={symbol}
            tabs={stockTabs}
            activeTab={activeStockTab}
            onSelect={selectStockTab}
            note={isEtfAsset && etfData === undefined ? "ETF 상세 로딩 중..." : !yfLoaded ? "추가 지표 로딩 중..." : !yfAvailable ? "추가 지표 준비 중" : null}
          />
        </section>

        {activeStockTab === "overview" ? (
          <>
          <div
            id={stockPanelId(symbol, activeStockTab)}
            role="tabpanel"
            aria-labelledby={stockTabId(symbol, activeStockTab)}
            tabIndex={0}
            className="cp-stock-detail-body"
          >
            <main className="cp-stock-detail-main">
              <section className="cp-stock-chart-card" data-stock-preview-module="price-chart">
                <header className="cp-stock-chart-card__header">
                  <div>
                    <p className="cp-stock-rail-eyebrow">Price Action</p>
                    <h2>가격 차트</h2>
                  </div>
                  <div className="cp-stock-range-tabs" role="group" aria-label="가격 차트 기간">
                    {STOCK_CHART_RANGES.map((range) => (
                      <CpButton
                        key={range}
                        density="compact"
                        variant={range === stockChartRange ? "primary" : "ghost"}
                        aria-pressed={range === stockChartRange}
                        onClick={() => setStockChartRange(range)}
                      >
                        {range}
                      </CpButton>
                    ))}
                  </div>
                </header>
                <CpPriceChart
                  kind="candlestick"
                  range={stockChartRange}
                  height={420}
                  density="comfy"
                  title={`${symbol} OHLCV`}
                  summary={stockChartCopy}
                  headingLevel="h3"
                  data={rangedStockChartData}
                  showVolume
                  className="cp-stock-price-chart"
                  emptyLabel={stockAuxData === undefined ? "가격 이력 로딩 중..." : "표시할 가격 이력이 없습니다."}
                />
              </section>

              <section className="cp-stock-showcase-metrics" aria-label="핵심 지표">
                {previewMetricCards.map((card) => (
                  <div key={card.label}>
                    <span>{card.label}</span>
                    <strong>{card.value}</strong>
                    <em>{card.note}</em>
                  </div>
                ))}
              </section>

              {detailLoading ? (
                <div className="cp-stock-preview-loading">
                  <SkeletonSection />
                </div>
              ) : detail ? (
                <section className="cp-stock-action-strip" data-stock-summary-module="summary-score" aria-label="상세 분석 바로가기">
                  {[
                    { axis: "밸류에이션", label: "밸류", desc: "PER 밴드·수익성", tab: "statistics" as const },
                    { axis: "미래 성장", label: "추정치", desc: "FY+1~3 변화", tab: "estimates" as const },
                    { axis: "과거 실적", label: "재무", desc: "매출·FCF 상세", tab: "financials" as const },
                    { axis: "재무 건전성", label: "건전성", desc: "마진·현금흐름", tab: "financials" as const },
                    { axis: "배당", label: "배당", desc: "배당 이력", tab: "financials" as const, hash: "#dividend" },
                  ].map(({ axis, label, desc, tab, hash }) => (
                    <button
                      key={axis}
                      type="button"
                      data-stock-summary-axis-link
                      data-stock-summary-axis={axis}
                      data-stock-summary-axis-tab={tab}
                      onClick={() => selectStockTab(tab, "push", hash ?? null)}
                    >
                      <strong>{label}</strong>
                      <span>{desc}</span>
                    </button>
                  ))}
                </section>
              ) : (
                <section className="cp-stock-action-strip cp-stock-action-strip--empty">
                  <DataStateNotice
                    state={makeDataState({
                      status: "unavailable",
                      label: "상세 데이터 준비 중",
                      detail: "상세 재무·추정치 데이터를 아직 충분히 연결하지 못했습니다.",
                    })}
                  />
                </section>
              )}
            </main>

            <aside className="cp-stock-right-rail" aria-label={`${symbol} 우측 요약`}>
              <ValuationBandSummaryCard band={valuationBandSummary} signalLens={fenokSignalLens} variant="canvasPlusRail" />
              <FenokEdgeDonutCard record={fenokSignalLens} />
              <FinancialSnapshotRail data={financialCandidate} loading={financialCandidate === undefined} currency={displayCurrency} />
            </aside>
          </div>
          <FenokEdgeSectionCp record={fenokSignalLens} symbol={symbol} />
          </>
        ) : (
          <div
            id={stockPanelId(symbol, activeStockTab)}
            role="tabpanel"
            aria-labelledby={stockTabId(symbol, activeStockTab)}
            tabIndex={0}
            className="cp-stock-detail-body cp-stock-tab-shell"
          >
            <main className="cp-stock-detail-main cp-stock-tab-body">
              {activeStockTab === "financials"
                ? renderFinancialsCpTab()
                : activeStockTab === "statistics"
                ? renderStatisticsCpTab()
                : activeStockTab === "estimates"
                ? renderEstimatesCpTab()
                : activeStockTab === "ownership"
                ? renderOwnershipCpTab()
                : activeStockTab === "filings"
                ? renderFilingsCpTab()
                : renderStockDataTab(false)}
            </main>
          </div>
        )}

        <footer className="cp-stock-detail-footer">
          <TransitionLink href={ROUTES.screenerTicker(symbol)}>스크리너에서 보기</TransitionLink>
          <TransitionLink href={ROUTES.superinvestorsByTicker(symbol)}>투자자 보유 보기</TransitionLink>
          <TransitionLink href={ROUTES.portfolioTicker(symbol)}>포트폴리오에서 보기</TransitionLink>
        </footer>
      </div>
    );
  }

  function renderStockDataTab(showFooter: boolean = true) {
    if (activeStockTab === "overview") return null;
    if (activeStockTab === "filings") {
      return <EdgarSummaryClient ticker={symbol} embedded />;
    }
    if (activeStockTab === "etf") {
      return (
        <div className="stock-main-stack">
          <EtfDataPanel ticker={symbol} data={etfData} loading={etfData === undefined} marketFacts={marketFacts} />
          {showFooter ? (
            <footer className="stock-footer">
              <TransitionLink href={isEtfAsset ? ROUTES.etfs : ROUTES.screenerTicker(symbol)} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">← {isEtfAsset ? "ETF 목록에서 보기" : "스크리너에서 보기"}</TransitionLink>
              <TransitionLink href={ROUTES.portfolioTicker(symbol)} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">포트폴리오에서 보기</TransitionLink>
            </footer>
          ) : null}
        </div>
      );
    }
    return (
      <div className="grid gap-4">
        {yfAvailable ? (
          <section className="panel stock-tab-panel">
            <div className="panel-b">{renderYfTab(activeStockTab, yfData, industryBench)}</div>
          </section>
        ) : null}
        {detailLoading ? (
          <div className="space-y-4">
            <SkeletonSection />
            <SkeletonSection />
          </div>
        ) : detail ? (
          <>
            {activeStockTab === "financials" ? (
              <SectionCard title="재무 추이">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {([
                    ["매출", numberSeries(detail.income_statement?.revenue), detail.income_statement_estimates?.revenue, "var(--c-up)"],
                    ["영업이익", numberSeries(detail.income_statement?.operating_income), detail.income_statement_estimates?.operating_income, "var(--c-info)"],
                    ["순이익", numberSeries(detail.income_statement?.net_income), detail.income_statement_estimates?.net_income, "var(--c-recovery)"],
                    ["FCF", numberSeries(detail.cash_flow?.fcf), detail.cash_flow_estimates?.fcf, "var(--c-warn)"],
                  ] as Array<[string, NumberSeries | undefined, Record<string, MaybeNumber> | undefined, string]>).map(([label, actuals, estimates, color]) => (
                    <div key={label}>
                      <p className="mb-1 text-[10px] font-bold text-slate-500">{label}</p>
                      <MiniBarChart actuals={actuals ?? []} estimates={estimates ?? null} years={years} color={color} />
                    </div>
                  ))}
                </div>
	                <div className="mt-5 border-t border-slate-100 pt-4">
	                  <h4 className="mb-2 text-[11px] font-black tracking-[0.08em] text-slate-500">실적 추이 · 추정</h4>
	                  <CompactFinancialTable detail={detail} years={years} />
	                </div>
	                <DividendPanel detail={detail} yfData={yfData} years={years} currency={displayCurrency} highlight={highlightDividend} />
	                <FinancialCandidatePanel data={financialCandidate} loading={financialCandidate === undefined} currency={displayCurrency} />
	                <RawFinancialDepth detail={detail} />
	              </SectionCard>
            ) : null}

            {activeStockTab === "statistics" ? (
              <>
                <SectionCard title="밸류에이션">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <h4 className="mb-2 text-[11px] font-black tracking-[0.08em] text-slate-500">PER 밴드 (8Y)</h4>
                      {finiteValues(detail.valuation?.per).length >= 2 ? (
                        <PerBandChart years={detail.years} per={numberSeries(detail.valuation?.per)} perBands={detail.per_bands} estimates={detail.valuation_estimates?.per} />
                      ) : <span className="text-xs text-slate-300">—</span>}
                    </div>
                    {detailPerBands ? (
                      <div>
                        <h4 className="mb-2 text-[11px] font-black tracking-[0.08em] text-slate-500">PER 밴드 위치</h4>
                        <div className="space-y-2">
                          {[{ label: "최고", v: detailPerBands.max_8y }, { label: "평균", v: detailPerBands.avg_8y }, { label: "현재", v: detailPerBands.current, highlight: true }, { label: "최저", v: detailPerBands.min_8y }].map(({ label, v, highlight }) => {
                            const range = detailPerBands.max_8y - detailPerBands.min_8y || 1;
                            const pct = Math.min(100, Math.max(0, ((v - detailPerBands.min_8y) / range) * 100));
                            const barColor = highlight ? "bg-brand-interactive" : "bg-slate-300";
                            const textColor = highlight ? "text-slate-900" : "text-slate-500";
                            return (
                              <div key={label} className="flex items-center gap-2">
                                <span className={`w-10 text-right text-[10px] font-semibold ${highlight ? "font-black text-brand-interactive" : "text-slate-500"}`}>{label}</span>
                                <div className="relative h-3 flex-1 rounded-full bg-slate-100">
                                  <div className={`absolute top-0 h-3 rounded-full ${barColor}`} style={{ left: `${pct}%`, width: "3px", transform: "translateX(-1.5px)" }} />
                                </div>
                                <span className={`w-14 text-xs orbitron tabular-nums font-bold ${textColor}`}>{v.toFixed(1)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </SectionCard>
                <SectionCard title="수익성·성장">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <h4 className="mb-2 text-[11px] font-black tracking-[0.08em] text-slate-500">수익성</h4>
                      <div className="space-y-3">
                        <MetricWithSpark label="매출총이익률" value={fmtWholePct(lastFinite((detail.profitability as any)?.gross_margin))} data={(detail.profitability as any)?.gross_margin ?? []} estimates={profitabilityEstimates?.gross_margin} color="var(--c-up)" years={years} formatValue={fmtWholePct} />
                        <MetricWithSpark label="영업이익률" value={fmtWholePct(lastFinite((detail.profitability as any)?.operating_margin))} data={(detail.profitability as any)?.operating_margin ?? []} estimates={profitabilityEstimates?.operating_margin} color="var(--c-info)" years={years} benchmark={industryBench ? { label: "산업", value: benchPct(industryBench.operating_margin) } : null} formatValue={fmtWholePct} />
                        <MetricWithSpark label="순이익률" value={fmtWholePct(lastFinite((detail.profitability as any)?.net_margin))} data={(detail.profitability as any)?.net_margin ?? []} estimates={profitabilityEstimates?.net_margin} color="var(--c-brand)" years={years} benchmark={industryBench ? { label: "산업", value: benchPct(industryBench.net_margin) } : null} formatValue={fmtWholePct} />
                        <MetricWithSpark label="ROE" value={fmtWholePct(lastFinite((detail.profitability as any)?.roe))} data={(detail.profitability as any)?.roe ?? []} estimates={profitabilityEstimates?.roe} color="var(--c-recovery)" years={years} benchmark={industryBench ? { label: "산업", value: benchPct(industryBench.roe) } : null} formatValue={fmtWholePct} />
                        <MetricWithSpark label="ROA" value={fmtWholePct(lastFinite((detail.profitability as any)?.roa))} data={(detail.profitability as any)?.roa ?? []} estimates={profitabilityEstimates?.roa} color="var(--c-info)" years={years} formatValue={fmtWholePct} />
                      </div>
                      {industryBench && isFiniteNumber(industryBench.cost_of_capital) ? (
                        <p className="mt-2 text-[10px] font-semibold text-slate-500">
                          다모다란 산업 자본비용 {fmtWholePct(industryBench.cost_of_capital * 100)}
                        </p>
                      ) : null}
                    </div>
                    <div>
                      <h4 className="mb-2 text-[11px] font-black tracking-[0.08em] text-slate-500">성장률 (YoY)</h4>
                      <div className="space-y-3">
                        <MetricWithSpark label="매출 성장률" value={fmtWholeSignedPct(lastFinite((detail.growth as any)?.revenue_growth))} data={toFractionSeries((detail.growth as any)?.revenue_growth)} estimates={estimateSeries(detail.growth_estimates?.revenue_growth, 100)} color="var(--c-up)" years={years} formatValue={fmtPct} />
                        <MetricWithSpark label="EPS 성장률" value={fmtWholeSignedPct(lastFinite((detail.growth as any)?.eps_growth))} data={toFractionSeries((detail.growth as any)?.eps_growth)} estimates={estimateSeries(detail.growth_estimates?.eps_growth, 100)} color="var(--c-warn)" years={years} formatValue={fmtPct} />
                      </div>
                    </div>
                  </div>
                </SectionCard>
                <SectionCard title="가격·수익률·배당">
                  {hasSlickChartsTicker ? (
                    <PriceDividendHistoryDepth ticker={symbol} showUnavailable />
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-500">
                      일부 보조 통계는 미국 티커 중심으로 수집됩니다.
                    </div>
                  )}
                </SectionCard>
              </>
            ) : null}

            {activeStockTab === "estimates" ? (
              <StockEstimatesPanel detail={detail} years={years} currency={displayCurrency} />
            ) : null}

            {activeStockTab === "ownership" ? (
              <div id="guru-section">
                <SectionCard>
                  <GuruSection f13Entries={f13Entries} ticker={symbol} />
                </SectionCard>
              </div>
            ) : null}
          </>
        ) : (
          <SectionCard>
            <div className="py-8 text-center">
              <DataStateNotice
                state={makeDataState({
                  status: "unavailable",
                  label: "상세 데이터 준비 중",
                  detail: "상세 재무·추정치 데이터를 아직 충분히 연결하지 못했습니다.",
                })}
              />
              <ExternalSourceLinks ticker={symbol} kind="stock" statusLine="종목 상세 준비 중" className="mx-auto mt-4 max-w-xl" />
            </div>
          </SectionCard>
        )}
        {showFooter ? (
          <footer className="stock-footer">
            <TransitionLink href={ROUTES.screenerTicker(symbol)} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">← 스크리너에서 보기</TransitionLink>
            <TransitionLink href={ROUTES.superinvestorsByTicker(symbol)} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">투자자 보유 보기</TransitionLink>
            <TransitionLink href={ROUTES.portfolioTicker(symbol)} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">포트폴리오에서 보기</TransitionLink>
          </footer>
        ) : null}
      </div>
    );
  }

  // Canvas-plus S1 exemplar: 재무 tab restyled with cp-stock-tab-* card surfaces.
  // Reuses CompactFinancialTable / DividendPanel / FinancialCandidatePanel / RawFinancialDepth
  // and the yf FinancialsTab block verbatim — wrapper-level restyle only.
  // W4 재무 tab: hero (TTM 매출 + verdict + 매출/영업이익률 콤보 차트) → 스냅샷 타일
  // → 배당 카드 → 전체 재무제표 아코디언 (CompactFinancialTable/yf/FinancialCandidate/RawDepth).
  function renderFinancialsCpTab() {
    return (
      <div className="cp-stock-tab-financials">
        {detailLoading ? (
          <div className="cp-stock-tab-loading">
            <SkeletonSection />
            <SkeletonSection />
          </div>
        ) : detail ? (
          <>
            <FinancialsHeroCp detail={detail} years={years} currency={displayCurrency} financialCandidate={financialCandidate} profitabilityEstimates={profitabilityEstimates} />
            <FinancialsTilesCp detail={detail} financialCandidate={financialCandidate} currency={displayCurrency} />

            <section className="cp-stock-tab-card" data-stock-tab-card="dividend">
              <div className="cp-stock-tab-card__body cp-stock-tab-card__body--flush">
                <DividendPanel detail={detail} yfData={yfData} years={years} currency={displayCurrency} highlight={highlightDividend} />
              </div>
            </section>

            <details className="cpw4-accordion" open>
              <summary>
                <span>
                  전체 재무제표 보기
                  <div className="cpw4-accordion__meta">추정 그리드 · 손익계산서 · 재무상태표 · 현금흐름표 — 실적 + 컨센서스</div>
                </span>
                <span className="cpw4-accordion__chev">▸</span>
              </summary>
              <div className="cpw4-accordion__body">
                <div>
                  <h3 className="cp-stock-tab-card__subheading">실적 추이 · 추정</h3>
                  <CompactFinancialTable detail={detail} years={years} />
                </div>
                {yfAvailable ? (
                  <div data-stock-tab-card="financials-yf">
                    <h3 className="cp-stock-tab-card__subheading">Yahoo Finance 재무제표 상세</h3>
                    {renderYfTab("financials", yfData, industryBench)}
                  </div>
                ) : null}
                <div data-stock-tab-card="financial-candidate">
                  <h3 className="cp-stock-tab-card__subheading">재무 보강 데이터 (교차검증)</h3>
                  <FinancialCandidatePanel data={financialCandidate} loading={financialCandidate === undefined} currency={displayCurrency} />
                </div>
                <div data-stock-tab-card="raw-financial-depth">
                  <h3 className="cp-stock-tab-card__subheading">원본 재무 데이터 상세</h3>
                  <RawFinancialDepth detail={detail} />
                </div>
              </div>
            </details>
          </>
        ) : (
          <section className="cp-stock-tab-card">
            <div className="cp-stock-tab-card__body">
              <div className="py-8 text-center">
                <DataStateNotice
                  state={makeDataState({
                    status: "unavailable",
                    label: "상세 데이터 준비 중",
                    detail: "상세 재무·추정치 데이터를 아직 충분히 연결하지 못했습니다.",
                  })}
                />
                <ExternalSourceLinks ticker={symbol} kind="stock" statusLine="종목 상세 준비 중" className="mx-auto mt-4 max-w-xl" />
              </div>
            </div>
          </section>
        )}
      </div>
    );
  }

  // W4 밸류 tab: hero (PER 8Y 밴드 그라디언트 + 판정 문장) → 리레이팅 타일 → 산업 대비
  // 델타 칩 → 수익성/성장 FY+1 그리드 + WACC 인사이트 → 가격·배당/전체지표 아코디언.
  function renderStatisticsCpTab() {
    return (
      <div className="cp-stock-tab-financials">
        {detailLoading ? (
          <div className="cp-stock-tab-loading">
            <SkeletonSection />
            <SkeletonSection />
          </div>
        ) : detail ? (
          <>
            {detailPerBands ? (
              <ValuationHeroCp detailPerBands={detailPerBands} />
            ) : finiteValues(detail.valuation?.per).length >= 2 ? (
              <section className="cp-stock-tab-card" data-stock-tab-card="valuation-band">
                <header className="cp-stock-tab-card__header">
                  <div>
                    <p className="cp-stock-rail-eyebrow">Valuation</p>
                    <h2>PER 밸류에이션</h2>
                  </div>
                </header>
                <div className="cp-stock-tab-card__body">
                  <PerBandChart years={detail.years} per={numberSeries(detail.valuation?.per)} perBands={detail.per_bands} estimates={detail.valuation_estimates?.per} />
                </div>
              </section>
            ) : null}

            <ValuationBodyCp yfData={yfData} industryBench={industryBench} detail={detail} profitabilityEstimates={profitabilityEstimates} currency={displayCurrency} years={years} />

            <details className="cpw4-accordion" data-stock-tab-card="price-dividend">
              <summary>
                <span>가격·수익률·배당 히스토리<div className="cpw4-accordion__meta">SlickCharts 가격/배당 이력</div></span>
                <span className="cpw4-accordion__chev">▸</span>
              </summary>
              <div className="cpw4-accordion__body">
                {hasSlickChartsTicker ? (
                  <PriceDividendHistoryDepth ticker={symbol} showUnavailable />
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-500">
                    일부 보조 통계는 미국 티커 중심으로 수집됩니다.
                  </div>
                )}
              </div>
            </details>

            <details className="cpw4-accordion" data-stock-tab-card="statistics-yf" open>
              <summary>
                <span>밸류 지표 상세 보기 (Yahoo 전체 지표)<div className="cpw4-accordion__meta">밸류에이션 · 수익성 · 재무건전성 · 배당 · 거래·규모</div></span>
                <span className="cpw4-accordion__chev">▸</span>
              </summary>
              <div className="cpw4-accordion__body">
                {yfAvailable ? renderYfTab("statistics", yfData, industryBench) : <p className="text-sm text-slate-500">Yahoo Finance 데이터가 아직 준비되지 않았습니다.</p>}
              </div>
            </details>
          </>
        ) : (
          <section className="cp-stock-tab-card">
            <div className="cp-stock-tab-card__body">
              <div className="py-8 text-center">
                <DataStateNotice
                  state={makeDataState({
                    status: "unavailable",
                    label: "상세 데이터 준비 중",
                    detail: "상세 재무·추정치 데이터를 아직 충분히 연결하지 못했습니다.",
                  })}
                />
                <ExternalSourceLinks ticker={symbol} kind="stock" statusLine="종목 상세 준비 중" className="mx-auto mt-4 max-w-xl" />
              </div>
            </div>
          </section>
        )}
      </div>
    );
  }

  // W4 추정치 tab: hero (목표가 여력 + EPS FY0→FY+3 컨센서스 바) → 목표가 범위 밴드
  // → FY+1 성장 타일 → 추천 분포 → 연간/분기 상세 아코디언.
  function renderEstimatesCpTab() {
    return (
      <div className="cp-stock-tab-financials">
        {detailLoading || yfData === undefined ? (
          <div className="cp-stock-tab-loading">
            <SkeletonSection />
            <SkeletonSection />
          </div>
        ) : detail || yfAvailable ? (
          <>
            {detail ? <EstimatesHeroCp yfData={yfData} detail={detail} currency={displayCurrency} /> : null}
            {yfAvailable ? <EstimatesBandCp yfData={yfData} currency={displayCurrency} /> : null}
            {detail ? <EstimatesGrowthTilesCp detail={detail} currency={displayCurrency} /> : null}
            {yfAvailable ? <EstimatesRecoCp yfData={yfData} /> : null}

            <details className="cpw4-accordion" data-stock-tab-card="estimates-yf">
              <summary>
                <span>연간·분기 추정 상세 보기<div className="cpw4-accordion__meta">FY-4~FY+3 실적/추정 그리드 · 애널리스트 EPS·매출 추정 상세</div></span>
                <span className="cpw4-accordion__chev">▸</span>
              </summary>
              <div className="cpw4-accordion__body">
                {detail ? (
                  <div data-stock-tab-card="estimates-consensus">
                    <h3 className="cp-stock-tab-card__subheading">추정치 변화</h3>
                    <StockEstimatesPanel detail={detail} years={years} currency={displayCurrency} variant="canvasPlus" />
                  </div>
                ) : null}
                {yfAvailable ? (
                  <div>
                    <h3 className="cp-stock-tab-card__subheading">Yahoo Finance 애널리스트 추정치 상세</h3>
                    {renderYfTab("estimates", yfData, industryBench)}
                  </div>
                ) : null}
              </div>
            </details>
          </>
        ) : (
          <section className="cp-stock-tab-card">
            <div className="cp-stock-tab-card__body">
              <div className="py-8 text-center">
                <DataStateNotice
                  state={makeDataState({
                    status: "unavailable",
                    label: "상세 데이터 준비 중",
                    detail: "상세 재무·추정치 데이터를 아직 충분히 연결하지 못했습니다.",
                  })}
                />
                <ExternalSourceLinks ticker={symbol} kind="stock" statusLine="종목 상세 준비 중" className="mx-auto mt-4 max-w-xl" />
              </div>
            </div>
          </section>
        )}
      </div>
    );
  }

  // W4 보유기관 tab: hero (13F 매수/매도 흐름 대칭 바 + 청산 콜아웃 + Top Guru 표)
  // → 기관 보유 요약 도넛 → Yahoo 상세 아코디언.
  function renderOwnershipCpTab() {
    return (
      <div className="cp-stock-tab-financials">
        {detailLoading ? (
          <div className="cp-stock-tab-loading">
            <SkeletonSection />
            <SkeletonSection />
          </div>
        ) : detail ? (
          <>
            <OwnershipHeroCp f13Entries={f13Entries} ticker={symbol} yfData={yfData} displayPrice={displayPrice} currency={displayCurrency} />

            {yfAvailable ? (
              <details className="cpw4-accordion" data-stock-tab-card="ownership-yf">
                <summary>
                  <span>기관 보유 상세 보기 (Yahoo Finance)<div className="cpw4-accordion__meta">기관 보유 TOP 10 · 지분율·주식수·증감</div></span>
                  <span className="cpw4-accordion__chev">▸</span>
                </summary>
                <div className="cpw4-accordion__body">
                  {renderYfTab("ownership", yfData, industryBench)}
                </div>
              </details>
            ) : null}
          </>
        ) : (
          <section className="cp-stock-tab-card">
            <div className="cp-stock-tab-card__body">
              <div className="py-8 text-center">
                <DataStateNotice
                  state={makeDataState({
                    status: "unavailable",
                    label: "상세 데이터 준비 중",
                    detail: "상세 재무·추정치 데이터를 아직 충분히 연결하지 못했습니다.",
                  })}
                />
                <ExternalSourceLinks ticker={symbol} kind="stock" statusLine="종목 상세 준비 중" className="mx-auto mt-4 max-w-xl" />
              </div>
            </div>
          </section>
        )}
      </div>
    );
  }

  // W4 공시 tab: hero (요약완료율 게이지 + 최중요 최근 공시 인사이트 카드) → 공시 피드
  // → 공시 캘린더 타임라인 → 나머지 공시 목록. edgarKoreanSummaries lib 직접 소비.
  function renderFilingsCpTab() {
    return (
      <div className="cp-stock-tab-financials" data-stock-tab-card="filings">
        <FilingsHeroFeedCp ticker={symbol} />
      </div>
    );
  }

  return (
    <div className="stock-shell">
      <section className="stock-entity panel">
        <div className="stock-entity-in">
          <span className="stock-logo">{symbol.slice(0, 1)}</span>
          <div className="stock-id">
            <div className="stock-name">
              <h1>{symbol}</h1>
              <WatchStar ticker={symbol} className="stock-star" />
            </div>
            <div className="stock-meta">
              <span className="entity-name" title={displayName}>{displayName}</span>
              {canonical ? (
                <>
                  <span className="x">·</span>
                  <span>{sectorLabelKo(canonical)}</span>
                </>
              ) : null}
              {row?.sector ? (
                <>
                  <span className="x">·</span>
                  <span>{row.sector}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="stock-price">
            <span className="big num">{priceText}</span>
            {returnText ? <span className={`stock-chip num ${returnUp ? "up" : "down"}`}>12M {returnText}</span> : null}
            <DataStateBadge state={priceDataState} />
          </div>
        </div>
        <MarketQuickLinks className="stock-market-links" />
        <StockTabsNav
          symbol={symbol}
          tabs={stockTabs}
          activeTab={activeStockTab}
          onSelect={selectStockTab}
          note={isEtfAsset && etfData === undefined ? "ETF 상세 로딩 중..." : !yfLoaded ? "추가 지표 로딩 중..." : !yfAvailable ? "추가 지표 준비 중" : null}
        />
      </section>

      <div
        id={stockPanelId(symbol, activeStockTab)}
        role="tabpanel"
        aria-labelledby={stockTabId(symbol, activeStockTab)}
        tabIndex={0}
        className="stock-body"
      >
        {activeStockTab === "overview" ? (
          <div className="stock-summary-stack">
            {yfAvailable ? (
              <div data-stock-summary-module="summary-score">
                <SummaryScoreCard
	                  data={yfData}
	                  perBand={rowPerBand}
	                  industry={industryBench}
	                  onAreaSelect={(tab, hash) => selectStockTab(tab, "push", hash ?? null)}
	                />
              </div>
            ) : null}
            <ValuationBandSummaryCard band={valuationBandSummary} signalLens={fenokSignalLens} />
            {yfAvailable ? (
              <div data-stock-summary-module="three-second-summary">
                <ThreeSecondSummary
                  data={yfData}
                  perBand={rowPerBand}
                  guruCount={f13Entries ? new Set(f13Entries.map((e) => e.investor)).size : 0}
                  industry={industryBench}
                />
              </div>
            ) : null}
            {yfAvailable ? <FiftyTwoWeekBar info={yfData.info} /> : null}
            {!isEtfAsset ? <FenokSignalLensCard record={fenokSignalLens} /> : null}
            {!isEtfAsset || marketFacts ? <MarketFactsDepth ticker={symbol} compact /> : null}
            <TickerSurfaceEventsCard ticker={symbol} assetKind={isEtfAsset ? "etf" : "stock"} compact />
            {!isEtfAsset ? <ConnectedView ticker={symbol} entry={connectionEntry} services={stockServicesEntry} variant="page" compact /> : null}
          </div>
        ) : null}

        {activeStockTab !== "overview" ? renderStockDataTab() : (
          <div className="stock-overview-grid">
        {/* LEFT RAIL (280px sticky) */}
        <aside className="stock-side">
          <div className="panel stock-side-panel">
            <div className="panel-b">
            <div className="mb-3">
              <h1 className="text-lg font-black tracking-tight text-slate-950">{symbol}</h1>
              <p className="text-sm font-bold text-slate-500">{row ? row.companyName : "..."}</p>
            </div>
            {canonical ? (
              <div className="mb-3">
                <TransitionLink href={sectorFilterHref} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 text-[10px] font-bold text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: sectorColor(canonical) }} />
                  {sectorLabelKo(canonical)}
                </TransitionLink>
              </div>
            ) : null}
            {row && !rowLoading ? (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                {/* scouter rows carry null price/ratios for non-US listings */}
                <KV label="현재가" value={priceText} />
                <KV label={marketCapLabel} value={marketCapText} />
                <KV label="PER" value={isFiniteNumber(row.per) ? row.per.toFixed(1) : "—"} />
                <KV label="PBR" value={isFiniteNumber(row.pbr) ? row.pbr.toFixed(2) : "—"} />
                <KV label="배당률" value={isFiniteNumber(row.dividendYield) ? fmtDivYield(row.dividendYield) : "—"} />
                <KV label="12개월 수익률" value={isFiniteNumber(row.return12m) ? fmtPct(row.return12m) : "—"} />
                {rowPerBand ? (
                  <div className={`rounded-lg px-2.5 py-1.5 ${perBandPositionColor(rowPerBand.current, rowPerBand.min, rowPerBand.max)}`}>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-600">PER 밴드 위치</p>
                    <p className="orbitron tabular-nums text-sm font-black">{perBandPositionText(rowPerBand.current, rowPerBand.min, rowPerBand.max)}</p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">{[1,2,3,4,5,6].map((i) => <div key={i} className="h-5 w-full rounded bg-slate-200" />)}</div>
            )}
            {f13Entries && f13Entries.length > 0 ? (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <a href="#guru-section" className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.06em] text-amber-700 transition hover:bg-amber-100">
                  투자 대가 {new Set(f13Entries.map((e) => e.investor)).size}명 보유
                </a>
              </div>
            ) : null}
            </div>
          </div>
        </aside>

        {/* MAIN CONTENT */}
        <div className="stock-main-stack">
          {detailLoading ? (
            <div className="space-y-8">
              <SkeletonSection />
            </div>
          ) : detail ? (
            <>
              <SectionCard title="핵심 스냅샷">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {[
                    { label: "PER 밴드", value: detailPerBands ? perBandPositionText(detailPerBands.current, detailPerBands.min_8y, detailPerBands.max_8y) : "—" },
                    { label: "FY+1 PER", value: isFiniteNumber(detail.valuation_estimates?.per?.fy1) ? `${detail.valuation_estimates.per.fy1.toFixed(1)}x` : "—" },
                    { label: "FY+1 매출 성장", value: fmtWholeSignedPct(detail.growth_estimates?.revenue_growth?.fy1) },
                    { label: "FY+1 EPS 성장", value: fmtWholeSignedPct(detail.growth_estimates?.eps_growth?.fy1) },
                    { label: "최근 매출", value: fmtLarge(lastFinite(numberSeries(detail.income_statement?.revenue))) },
                    { label: "최근 EPS", value: formatMoney(lastFinite(numberSeries(detail.per_share?.eps)), displayCurrency) },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border border-slate-200 bg-white/70 px-3 py-3">
                      <MetricHelp label={item.label} className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500" />
                      <p className="orbitron mt-1 min-w-0 break-words text-base font-black tabular-nums text-slate-950">{item.value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-4">
                  {[
                    { label: "밸류", desc: "PER 밴드·수익성", tab: "statistics" as const },
                    { label: "추정치", desc: "FY+1~3·변화", tab: "estimates" as const },
                    { label: "재무", desc: "매출·FCF·상세", tab: "financials" as const },
                    { label: "보유기관", desc: "13F 투자자", tab: "ownership" as const },
                  ].map(({ label, desc, tab }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => selectStockTab(tab)}
                      className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left transition hover:border-brand-interactive hover:bg-white"
                    >
                      <span className="block text-[11px] font-black text-slate-800">{label}</span>
                      <span className="mt-0.5 block text-[10px] font-semibold text-slate-500">{desc}</span>
                    </button>
                  ))}
                </div>
              </SectionCard>
              <StockAuxiliaryPanel data={stockAuxData} loading={stockAuxData === undefined} currency={displayCurrency} />
            </>
          ) : (
            <SectionCard>
              <div className="py-8 text-center">
                <DataStateNotice
                  state={makeDataState({
                    status: "unavailable",
                    label: "상세 데이터 준비 중",
                    detail: "상세 재무·추정치 데이터를 아직 충분히 연결하지 못했습니다.",
                  })}
                />
                <ExternalSourceLinks ticker={symbol} kind="stock" statusLine="종목 상세 준비 중" className="mx-auto mt-4 max-w-xl" />
              </div>
            </SectionCard>
          )}

          <footer className="stock-footer">
            <TransitionLink href={ROUTES.screenerTicker(symbol)} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">← 스크리너에서 보기</TransitionLink>
            <TransitionLink href={ROUTES.superinvestorsByTicker(symbol)} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">투자자 보유 보기</TransitionLink>
          </footer>
        </div>
      </div>
      )}
      </div>
    </div>
  );
}

function SectionCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="panel stock-section">
      {title ? <div className="panel-h"><h2>{title}</h2></div> : null}
      <div className="panel-b">{children}</div>
    </section>
  );
}

function SkeletonSection() {
  return (
    <div className="panel stock-section">
      <div className="panel-b">
      <div className="h-5 w-1/3 rounded bg-slate-200" />
      <div className="mt-3 h-32 rounded bg-slate-200" />
      </div>
    </div>
  );
}

const FINANCIAL_STATEMENT_LABELS: Record<string, string> = {
  income: "손익",
  balance_sheet: "재무상태",
  cash_flow: "현금흐름",
  ratios: "비율",
};

function financialStatementLabel(key: string): string {
  return FINANCIAL_STATEMENT_LABELS[key] ?? key.replace(/_/g, " ");
}

function findFinancialRow(statement: StockanalysisFinancialStatement | null | undefined, fields: string[]) {
  const rows = Array.isArray(statement?.rows) ? statement.rows : [];
  return rows.find((row) => typeof row.field === "string" && fields.includes(row.field));
}

function firstFiniteValue(row: StockanalysisFinancialRow | undefined): number | null {
  if (!Array.isArray(row?.values)) return null;
  for (const value of row.values) {
    if (isFiniteNumber(value)) return value;
  }
  return null;
}

function formatCandidateMetric(value: number | null, currency: string, kind: "money" | "multiple" | "pct" = "money") {
  if (!isFiniteNumber(value)) return "—";
  if (kind === "multiple") return `${value.toFixed(value >= 10 ? 1 : 2)}x`;
  if (kind === "pct") return fmtEtfPct(value * 100);
  return formatCompactMoney(value, currency);
}

function fmtCandidateCount(value: unknown): string {
  return isFiniteNumber(value) ? value.toLocaleString("ko-KR") : "—";
}

function stockOverviewText(value: unknown): string {
  return rawText(value);
}

function quoteMoney(value: unknown, currency: string): string {
  return isFiniteNumber(value) ? formatMoney(value, currency) : rawText(value);
}

function StockAuxiliaryPanel({
  data,
  loading,
  currency,
}: {
  data: StockanalysisStockPayload | null | undefined;
  loading: boolean;
  currency: string;
}) {
  if (loading) {
    return (
      <SectionCard title="추가 지표 체크">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => <div key={item} className="h-20 rounded-xl bg-slate-100" />)}
        </div>
      </SectionCard>
    );
  }

  if (!data) {
    return (
      <SectionCard title="추가 지표 체크">
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4">
          <p className="text-sm font-semibold text-slate-500">추가 지표가 아직 준비되지 않았습니다.</p>
        </div>
      </SectionCard>
    );
  }

  const overview = data.normalized?.overview ?? {};
  const quote = data.normalized?.quote ?? {};
  const financials = data.normalized?.financials;
  const financialSummary = financials?.summary;
  const annualFieldCount = Object.values(financialSummary?.annual ?? {})
    .reduce((sum, item) => sum + (isFiniteNumber(item?.field_count) ? item.field_count : 0), 0);
  const quarterlyFieldCount = Object.values(financialSummary?.quarterly ?? {})
    .reduce((sum, item) => sum + (isFiniteNumber(item?.field_count) ? item.field_count : 0), 0);
  const metrics = [
    { label: "최근가", value: quoteMoney(quote.p, currency), note: fmtDateish(quote.u) },
    { label: "시가총액", value: stockOverviewText(overview.marketCap), note: "추가 지표" },
    { label: "매출", value: stockOverviewText(overview.revenue), note: stockOverviewText(overview.revenue_type).toUpperCase() },
    { label: "순이익", value: stockOverviewText(overview.netIncome), note: "최근 12개월" },
    { label: "EPS", value: stockOverviewText(overview.eps), note: "희석 기준" },
    { label: "PER", value: stockOverviewText(overview.peRatio), note: "현재" },
    { label: "Forward PER", value: stockOverviewText(overview.forwardPE), note: "시장 예상" },
    { label: "목표가", value: stockOverviewText(overview.target), note: stockOverviewText(overview.analysts) },
    { label: "배당", value: stockOverviewText(overview.dividend), note: "예상/최근 기준" },
    { label: "베타", value: stockOverviewText(overview.beta), note: "시장 민감도" },
  ].filter((item) => item.value !== "—");

  return (
    <SectionCard title="추가 지표 체크">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-500">주요 지표를 기존 분석 데이터와 교차 확인합니다.</p>
        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-black text-slate-500">
          {fmtKstMinute(data.fetched_at) ?? "—"}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric) => (
          <div key={`${metric.label}-${metric.value}`} className="rounded-xl border border-slate-200 bg-white/70 px-3 py-3">
            <MetricHelp label={metric.label} className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500" />
            <p className="orbitron mt-1 min-w-0 break-words text-base font-black tabular-nums text-slate-950">{metric.value}</p>
            {metric.note !== "—" ? <p className="mt-1 min-w-0 break-words text-[10px] font-semibold text-slate-500">{metric.note}</p> : null}
          </div>
        ))}
      </div>
      {(annualFieldCount > 0 || quarterlyFieldCount > 0) ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-500">
          재무 보강 범위: 연간 {annualFieldCount.toLocaleString("ko-KR")}개 항목 · 분기 {quarterlyFieldCount.toLocaleString("ko-KR")}개 항목
        </div>
      ) : null}
    </SectionCard>
  );
}

function FinancialCandidatePanel({
  data,
  loading,
  currency,
}: {
  data: StockanalysisFinancialPayload | null | undefined;
  loading: boolean;
  currency: string;
}) {
  if (loading) {
    return (
      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="h-4 w-32 rounded bg-slate-200" />
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((item) => <div key={item} className="h-16 rounded bg-white" />)}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mt-5 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4">
        <p className="text-[11px] font-black tracking-[0.08em] text-slate-500">재무 보강 데이터</p>
        <p className="mt-1 text-sm font-semibold text-slate-500">재무 지표가 아직 준비되지 않았습니다.</p>
      </div>
    );
  }

  const annual = data.statements?.annual ?? {};
  const quarterly = data.statements?.quarterly ?? {};
  const summaryGroups = [
    { label: "연간", data: data.summary?.annual ?? {} },
    { label: "분기", data: data.summary?.quarterly ?? {} },
  ];
  const metrics = [
    {
      label: "TTM 매출",
      value: formatCandidateMetric(firstFiniteValue(findFinancialRow(annual.income, ["revenue"])), currency),
    },
    {
      label: "TTM 순이익",
      value: formatCandidateMetric(firstFiniteValue(findFinancialRow(annual.income, ["netIncome", "netincCompany"])), currency),
    },
    {
      label: "TTM FCF",
      value: formatCandidateMetric(firstFiniteValue(findFinancialRow(annual.cash_flow, ["fcf", "leveredFCF", "unleveredFCF"])), currency),
    },
    {
      label: "최근 PER",
      value: formatCandidateMetric(firstFiniteValue(findFinancialRow(annual.ratios, ["pe"])), currency, "multiple"),
    },
    {
      label: "최근 분기 매출",
      value: formatCandidateMetric(firstFiniteValue(findFinancialRow(quarterly.income, ["revenue"])), currency),
    },
    {
      label: "최근 분기 FCF",
      value: formatCandidateMetric(firstFiniteValue(findFinancialRow(quarterly.cash_flow, ["fcf", "leveredFCF", "unleveredFCF"])), currency),
    },
  ];

  return (
    <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-black tracking-[0.08em] text-slate-500">재무 보강 데이터</p>
          <p className="mt-1 text-xs font-semibold text-slate-500">교차검증용 · 가치평가 입력 아님</p>
        </div>
        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-black text-slate-500">
          {fmtKstMinute(data.fetched_at) ?? "—"}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">{metric.label}</p>
            <p className="orbitron mt-1 min-w-0 break-words text-sm font-black tabular-nums text-slate-950">{metric.value}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {summaryGroups.map((group) => (
          <div key={group.label} className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">{group.label} 데이터 범위</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Object.entries(group.data).map(([key, info]) => (
                <div key={`${group.label}-${key}`} className="rounded-md bg-slate-50 px-2 py-2">
                  <p className="text-[10px] font-bold text-slate-500">{financialStatementLabel(key)}</p>
                  <p className="orbitron mt-0.5 text-xs font-black tabular-nums text-slate-900">
                    {fmtCandidateCount(info?.field_count)}개 항목
                  </p>
                  <p className="mt-0.5 text-[10px] font-semibold text-slate-500">
                    {fmtCandidateCount(info?.period_count)}기간
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EtfDataPanel({
  ticker,
  data,
  loading,
  marketFacts,
}: {
  ticker: string;
  data: StockanalysisEtfPayload | null | undefined;
  loading: boolean;
  marketFacts: any;
}) {
  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonSection />
        <SkeletonSection />
      </div>
    );
  }

  const normalized = data?.normalized ?? {};
  const overview = normalized.overview ?? {};
  const quote = normalized.quote ?? {};
  const currency = typeof marketFacts?.identity?.currency === "string" ? marketFacts.identity.currency : "USD";
  const price = factNumber(marketFacts, "price") ?? (isFiniteNumber(quote.p) ? quote.p : null);
  const changePct = factNumber(marketFacts, "change_pct") ?? (isFiniteNumber(quote.cp) ? quote.cp : null);
  const totalAssets = factNumber(marketFacts, "total_assets");
  const expenseRatio = factNumber(marketFacts, "expense_ratio");
  const dividendYield = factNumber(marketFacts, "dividend_yield");
  const beta = factNumber(marketFacts, "beta");
  const holdingsFromFacts = Array.isArray(marketFacts?.etf?.top_holdings)
    ? marketFacts.etf.top_holdings as StockanalysisEtfHolding[]
    : [];
  const holdings = Array.isArray(normalized.holdings) && normalized.holdings.length > 0
    ? normalized.holdings
    : holdingsFromFacts;
  const holdingCount = isFiniteNumber(normalized.holding_count)
    ? normalized.holding_count
    : isFiniteNumber(marketFacts?.etf?.holdings_count)
      ? marketFacts.etf.holdings_count
      : holdings.length;
  const holdingsUpdated = normalized.holdings_updated ?? marketFacts?.etf?.holdings_updated ?? null;
  const history = Array.isArray(normalized.history) ? normalized.history : [];
  const assetAllocation = normalized.asset_allocation ?? marketFacts?.etf?.asset_allocation ?? null;
  const sectors = normalized.sectors ?? marketFacts?.etf?.sectors ?? null;
  const countries = normalized.countries ?? marketFacts?.etf?.countries ?? null;
  const totalWeight = holdings.reduce((sum, item) => sum + (isFiniteNumber(item.weight_pct) ? item.weight_pct : 0), 0);
  const website = typeof overview.etf_website === "string" && overview.etf_website.trim() ? overview.etf_website.trim() : null;
  const detailStatus = typeof data?.detail_status === "string" ? data.detail_status : null;
  const detailStatusText = detailStatus === "surface_only"
    ? "보유 구성 확인 전 · 신규 상장 정보로 요약 표시"
    : detailStatus === "universe_only"
      ? "보유 구성 확인 전 · ETF 기본 정보로 요약 표시"
      : detailStatus === "yf_fallback"
        ? "가격 정보 연결됨 · 보유 구성은 확인된 항목부터 반영"
      : null;
  const holdingsDate = fmtDateish(holdingsUpdated);
  const quoteDate = fmtDateish(quote.u);
  const externalSourceAsOf = holdingsDate !== "—"
    ? holdingsDate
    : quoteDate !== "—"
      ? quoteDate
      : fmtDateish(data?.fetched_at);

  const cards = [
    { label: "가격", value: price !== null ? formatMoney(price, currency) : "—", note: fmtDateish(quote.u) },
    { label: "당일 변화", value: fmtEtfSignedPct(changePct), note: rawText(quote.ex) },
    { label: "운용자산", value: totalAssets !== null ? formatCompactMoney(totalAssets, currency) : rawText(overview.aum), note: "운용자산" },
    { label: "NAV", value: rawText(overview.nav), note: "순자산가치" },
    { label: "보수율", value: expenseRatio !== null ? fmtEtfPct(expenseRatio) : rawText(overview.expenseRatio), note: "총보수" },
    { label: "배당률", value: dividendYield !== null ? fmtEtfPct(dividendYield) : rawText(overview.dividendYield), note: "분배금 기준" },
    { label: "베타", value: beta !== null ? beta.toFixed(2) : rawText(overview.beta), note: "민감도" },
    { label: "설정일", value: rawText(overview.inception), note: "Inception" },
    { label: "표시 종목", value: `${holdings.length.toLocaleString()} / ${holdingCount.toLocaleString()}`, note: fmtDateish(holdingsUpdated) },
    { label: "표시 비중 합계", value: holdings.length > 0 ? fmtEtfPct(totalWeight) : "—", note: "표시 항목 기준" },
  ].filter((card) => card.value !== "—");

  if (!data && !marketFacts) {
    return (
      <SectionCard title="ETF 상세">
        <div className="py-8 text-center">
          <DataStateNotice
            state={makeDataState({
              status: "unavailable",
              label: "ETF 상세 데이터 미수집",
              detail: "신규 ETF는 상세 데이터가 열리기 전에도 목록과 가격 정보를 먼저 확인할 수 있습니다.",
            })}
          />
          <ExternalSourceLinks ticker={ticker} kind="etf" statusLine="ETF 상세 데이터 미수집" className="mx-auto mt-4 max-w-xl" />
        </div>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      <SectionCard title="ETF 핵심 지표">
        {detailStatusText ? (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-black text-amber-800">
            {detailStatusText}
          </div>
        ) : null}
        {detailStatusText ? (
          <ExternalSourceLinks
            ticker={ticker}
            kind="etf"
            statusLine={detailStatusText}
            asOf={externalSourceAsOf}
            compact
            className="mb-3"
          />
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {cards.map((card) => (
            <div key={`${card.label}-${card.value}`} className="rounded-xl border border-slate-200 bg-white/70 px-3 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">{card.label}</p>
              <p className="orbitron mt-1 min-w-0 break-words text-base font-black tabular-nums text-slate-950">{card.value}</p>
              {card.note !== "—" ? <p className="mt-1 min-w-0 break-words text-[10px] font-semibold text-slate-500">{card.note}</p> : null}
            </div>
          ))}
        </div>
        {website ? (
          <a
            href={website}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex min-h-8 items-center rounded-full border border-slate-200 bg-slate-50 px-3 text-[10px] font-black uppercase tracking-[0.08em] text-slate-600 transition hover:border-brand-interactive hover:bg-white hover:text-brand-interactive"
          >
            운용사 웹사이트
          </a>
        ) : null}
      </SectionCard>

      <SectionCard title="보유·스왑 구성">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
          <span>{ticker} · {holdings.length.toLocaleString()}개 표시</span>
          <span>{fmtDateish(holdingsUpdated) !== "—" ? `기준 ${fmtDateish(holdingsUpdated)}` : "기준일 미표시"}</span>
        </div>
        <EtfHoldingsTable holdings={holdings} currency={currency} />
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="자산 분해">
          <EtfWeightedList rows={assetAllocation} empty="자산 분해 데이터 없음" />
        </SectionCard>
        <SectionCard title="섹터 분해">
          <EtfWeightedList rows={sectors} empty="섹터 데이터 없음" />
        </SectionCard>
        <SectionCard title="국가 분해">
          <EtfWeightedList rows={countries} empty="국가 데이터 없음" />
        </SectionCard>
      </div>

      <SectionCard title="가격 히스토리">
        <EtfHistoryView history={history} currency={currency} />
      </SectionCard>
    </div>
  );
}

function EtfHoldingsTable({ holdings, currency }: { holdings: StockanalysisEtfHolding[]; currency: string }) {
  if (!holdings.length) {
    return (
      <DataStateNotice
        state={makeDataState({
          status: "unavailable",
          label: "보유 구성 없음",
          detail: "이 ETF의 보유 종목·스왑 구성이 아직 수집되지 않았습니다.",
        })}
      />
    );
  }
  return (
    <div className="-mx-1 max-h-[560px] overflow-auto px-1">
      <table className="w-full min-w-[620px] text-xs">
        <thead className="sticky top-0 z-10 bg-white">
          <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500">
            <th className="px-2 py-2 text-right">#</th>
            <th className="px-2 py-2 text-left">종목/계약</th>
            <th className="px-2 py-2 text-left">티커</th>
            <th className="px-2 py-2 text-right">비중</th>
            <th className="px-2 py-2 text-right">수량</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((item, index) => {
            const weight = isFiniteNumber(item.weight_pct) ? item.weight_pct : null;
            const weightClass = weight !== null && weight < 0 ? "text-rose-600" : "text-slate-900";
            return (
              <tr key={`${item.rank ?? index}-${item.symbol ?? ""}-${item.name ?? ""}`} className="border-b border-slate-100 last:border-b-0">
                <td className="px-2 py-2 text-right orbitron tabular-nums text-[11px] font-bold text-slate-500">{item.rank ?? index + 1}</td>
                <td className="px-2 py-2 font-bold text-slate-800">{item.name ?? "—"}</td>
                <td className="px-2 py-2 orbitron tabular-nums text-[11px] font-black text-slate-500">{item.symbol ?? "—"}</td>
                <td className={`px-2 py-2 text-right orbitron tabular-nums text-xs font-black ${weightClass}`}>{fmtEtfPct(weight)}</td>
                <td className="px-2 py-2 text-right orbitron tabular-nums text-[11px] font-semibold text-slate-600">{fmtShares(item.shares)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {currency ? <p className="mt-2 text-[10px] font-semibold text-slate-500">표시 통화: {currency}</p> : null}
    </div>
  );
}

function weightedRowName(row: StockanalysisWeightedRow): string {
  return row.key ?? row.n ?? row.country ?? row.code ?? "—";
}

function weightedRowValue(row: StockanalysisWeightedRow): number | null {
  if (isFiniteNumber(row.value)) return row.value;
  if (isFiniteNumber(row.w)) return row.w;
  if (isFiniteNumber(row.weight)) return row.weight;
  return null;
}

function EtfWeightedList({ rows, empty }: { rows: StockanalysisWeightedRow[] | null | undefined; empty: string }) {
  const items = Array.isArray(rows) ? rows.filter((row) => weightedRowValue(row) !== null) : [];
  if (!items.length) {
    return (
      <DataStateNotice
        state={makeDataState({
          status: "unavailable",
          label: empty,
          detail: "분해 항목은 데이터 갱신 후 표시됩니다.",
        })}
      />
    );
  }
  return (
    <div className="space-y-2">
      {items.map((row, index) => {
        const value = weightedRowValue(row) ?? 0;
        const width = Math.min(100, Math.abs(value));
        return (
          <div key={`${weightedRowName(row)}-${index}`}>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate font-bold text-slate-700">{weightedRowName(row)}</span>
              <span className={`orbitron tabular-nums font-black ${value < 0 ? "text-rose-600" : "text-slate-900"}`}>{fmtEtfPct(value)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-2 rounded-full ${value < 0 ? "bg-rose-400" : "bg-brand-interactive"}`} style={{ width: `${width}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EtfHistoryView({ history, currency }: { history: StockanalysisHistoryPoint[]; currency: string }) {
  const rows = history.filter((point) => isFiniteNumber(point.c));
  if (!rows.length) {
    return (
      <DataStateNotice
        state={makeDataState({
          status: "unavailable",
          label: "가격 히스토리 없음",
          detail: "이 ETF의 월간 가격 이력은 아직 수집되지 않았습니다.",
        })}
      />
    );
  }
  const chronological = [...rows].reverse();
  const closes = chronological.map((point) => point.c).filter(isFiniteNumber);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
      <div className="flex h-40 items-end gap-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
        {chronological.map((point, index) => {
          const close = isFiniteNumber(point.c) ? point.c : min;
          const height = 10 + ((close - min) / range) * 90;
          const up = isFiniteNumber(point.ch) ? point.ch >= 0 : true;
          return (
            <div key={`${point.t ?? "month"}-${index}`} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${point.t}: ${formatMoney(close, currency)}`}>
              <div className={`w-full rounded-t ${up ? "bg-emerald-400" : "bg-rose-400"}`} style={{ height: `${height}%` }} />
              <span className="hidden max-w-full truncate text-[9px] font-bold text-slate-500 sm:block">{(point.t ?? "").slice(5, 7)}</span>
            </div>
          );
        })}
      </div>
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[360px] text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500">
              <th className="px-2 py-2 text-left">월</th>
              <th className="px-2 py-2 text-right">종가</th>
              <th className="px-2 py-2 text-right">변화</th>
              <th className="px-2 py-2 text-right">거래량</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((point, index) => (
              <tr key={`${point.t ?? "row"}-${index}`} className="border-b border-slate-100 last:border-b-0">
                <td className="px-2 py-2 font-bold text-slate-700">{point.t ?? "—"}</td>
                <td className="px-2 py-2 text-right orbitron tabular-nums font-black text-slate-900">{formatMoney(point.c, currency)}</td>
                <td className={`px-2 py-2 text-right orbitron tabular-nums font-black ${isFiniteNumber(point.ch) && point.ch < 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmtEtfSignedPct(point.ch)}</td>
                <td className="px-2 py-2 text-right orbitron tabular-nums font-semibold text-slate-500">{fmtShares(point.v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
