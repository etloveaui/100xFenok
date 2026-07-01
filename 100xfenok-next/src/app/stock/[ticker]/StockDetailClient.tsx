"use client";

import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
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

function writeStockTabUrl(tab: StockTab, mode: "push" | "replace"): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (tab === "overview") {
    url.searchParams.delete("tab");
  } else {
    url.searchParams.set("tab", tab);
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
function rawText(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (isFiniteNumber(value)) return value.toLocaleString();
  return "—";
}
function factNumber(source: any, key: string): number | null {
  const value = source?.facts?.[key]?.value;
  return isFiniteNumber(value) ? value : null;
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
) {
  const pct = bandPct(band.current, band.min, band.max);
  const cls = bandClass(pct);
  const weakScores = [
    signalLens?.profitabilityScore,
    signalLens?.growthScore,
    signalLens?.longTermScore,
  ].filter((score): score is number => isFiniteNumber(score) && score < 45);
  const valueTrapWatch = cls === "emerald" && weakScores.length > 0;

  if (valueTrapWatch) {
    return {
      label: "밸류트랩 점검",
      detail: "PER는 낮지만 성장·수익성 점수 약세가 함께 보입니다.",
      chipClass: "border-amber-200 bg-amber-50 text-amber-700",
      fillClass: "bg-amber-500",
    };
  }
  if (cls === "emerald") {
    return {
      label: "역사 대비 싼 구간",
      detail: "PER 밴드 하단권입니다. 다음은 성장·마진 방어를 확인합니다.",
      chipClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
      fillClass: "bg-emerald-500",
    };
  }
  if (cls === "rose") {
    return {
      label: "프리미엄 구간",
      detail: "PER 밴드 상단권입니다. 기대 성장과 추정치 상향이 필요합니다.",
      chipClass: "border-rose-200 bg-rose-50 text-rose-700",
      fillClass: "bg-rose-500",
    };
  }
  return {
    label: "적정 범위",
    detail: "현재 PER는 역사 밴드 중간권입니다.",
    chipClass: "border-slate-200 bg-slate-50 text-slate-700",
    fillClass: "bg-brand-interactive",
  };
}

function ValuationBandSummaryCard({
  band,
  signalLens,
}: {
  band: ValuationBandSummary | null;
  signalLens: FenokSignalsSummaryRecord | null | undefined;
}) {
  if (!band) return null;
  const pct = bandPct(band.current, band.min, band.max);
  const clampedPct = Math.max(0, Math.min(100, pct * 100));
  const tone = valuationBandTone(band, signalLens);

  return (
    <div data-stock-summary-module="valuation-band" className="rounded-lg border border-[var(--c-line)] bg-[var(--c-panel)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">밸류에이션 판정</p>
          <p className="mt-1 text-sm font-black text-slate-900">{tone.label}</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black tabular-nums ${tone.chipClass}`}>
          밴드 {Math.round(clampedPct)}%
        </span>
      </div>
      <div className="mt-3">
        <div className="relative h-2 rounded-full bg-slate-100">
          <span className={`absolute top-0 h-2 w-2 -translate-x-1/2 rounded-full ${tone.fillClass}`} style={{ left: `${clampedPct}%` }} />
        </div>
        <div className="mt-1 grid grid-cols-3 text-[9px] font-black tabular-nums text-slate-500">
          <span>{band.min.toFixed(1)}x</span>
          <span className="text-center">{isFiniteNumber(band.avg) ? `${band.avg.toFixed(1)}x avg` : band.source}</span>
          <span className="text-right">{band.max.toFixed(1)}x</span>
        </div>
      </div>
      <p className="mt-2 text-[11px] font-semibold leading-5 text-slate-600">
        현재 PER {band.current.toFixed(1)}x · {tone.detail}
      </p>
    </div>
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
  const rows: Array<{ label: string; actuals: NumberSeries | null; estimates: Record<string, MaybeNumber> | null; fmt: (v: number) => string }> = [
    { label: "매출", actuals: numberSeries(detail.income_statement?.revenue), estimates: detail.income_statement_estimates?.revenue ?? null, fmt: s },
    { label: "영업이익", actuals: numberSeries(detail.income_statement?.operating_income), estimates: detail.income_statement_estimates?.operating_income ?? null, fmt: s },
    { label: "순이익", actuals: numberSeries(detail.income_statement?.net_income), estimates: detail.income_statement_estimates?.net_income ?? null, fmt: s },
    { label: "EPS", actuals: numberSeries(detail.per_share?.eps), estimates: detail.per_share_estimates?.eps ?? null, fmt: usd },
    { label: "FCF", actuals: numberSeries(detail.cash_flow?.fcf), estimates: detail.cash_flow_estimates?.fcf ?? null, fmt: s },
    { label: "DPS", actuals: numberSeries(detail.dividend?.dps), estimates: detail.dividend_estimates?.dps ?? null, fmt: usd },
  ];
  const validRows = rows.filter((r) => finiteValues(r.actuals).length > 0);
  if (validRows.length === 0) return null;

  return (
    <div className="-mx-1 mt-3 overflow-x-auto px-1">
      <table className="w-full min-w-[500px] text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500">
            <th className="px-2 py-1.5 text-left" />
            {years.map((y) => <th key={y} className="px-2 py-1.5 text-right">{y}</th>)}
            {estKeys.map((k) => (
              <th key={k} className="px-2 py-1.5 text-right bg-slate-50 text-slate-500">
                <MetricHelp label={ESTIMATE_LABELS[k] ?? k.toUpperCase()} metricKey={k} align="right" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {validRows.map((row) => {
            const completeness = estimateCompletenessFromSeries(row.estimates);
            const showGap = hasEstimateGap(completeness);
            return (
              <tr key={row.label} className="border-b border-slate-100 last:border-b-0">
                <td className="px-2 py-1.5 text-[10px] font-bold text-slate-700">
                  <span className="block">{row.label}</span>
                  {showGap ? (
                    <span className={`mt-0.5 inline-flex rounded-full px-1.5 py-[1px] text-[9px] font-black ${estimateCompletenessTone(completeness)}`}>
                      {completeness.label}
                    </span>
                  ) : null}
                </td>
                {row.actuals!.map((v, i) => (
                  <td key={i} className="px-2 py-1.5 text-right orbitron tabular-nums font-semibold text-slate-900">{isFiniteNumber(v) ? row.fmt(v) : "—"}</td>
                ))}
                {estKeys.map((k) => (
                  <td key={k} className="px-2 py-1.5 text-right bg-slate-50 orbitron tabular-nums font-semibold text-slate-500">
                    {isFiniteNumber(row.estimates?.[k]) ? row.fmt(row.estimates![k] as number) : "—"}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1 text-[9px] font-semibold text-slate-500">E = 시장 예상치</p>
    </div>
  );
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
            {quarter ?? "최근 분기"}{generatedAt ? ` · ${generatedAt}` : ""}
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
        <p className="mt-2 text-[9px] font-semibold text-slate-500">13F는 분기말 스냅샷 기반이며 최대 45일 지연될 수 있습니다.</p>
      </div>
      {holders.length > 0 ? (
        <div data-smart-money-section="holdings" className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[320px] text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500">
                <th className="px-2 py-1.5 text-left">투자자</th>
                <th className="px-2 py-1.5 text-right">주식수</th>
                <th className="px-2 py-1.5 text-right">비중</th>
              </tr>
            </thead>
            <tbody>
              {holders.map((h) => (
                <tr key={h.investor} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-2 py-1.5">
                    <TransitionLink href={ROUTES.superinvestors} className="text-[10px] font-black text-brand-interactive hover:underline">
                      {h.investor}
                    </TransitionLink>
                  </td>
                  <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs font-semibold text-slate-900">
                    {h.shares > 0 ? h.shares.toLocaleString() : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs font-semibold text-slate-700">
                    {h.weight > 0 ? `${(h.weight * 100).toFixed(2)}%` : "—"}
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
// StockDetailClient main
// ---------------------------------------------------------------------------

export default function StockDetailClient({
  ticker,
  assetHint,
  initialTab,
}: {
  ticker: string;
  assetHint?: "stock" | "etf";
  initialTab?: StockTab;
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
  const marketFactsAssetType = marketFacts?.asset_type;
  const selectStockTab = useCallback((tab: StockTab, mode: "push" | "replace" = "push") => {
    setStockTab(tab);
    writeStockTabUrl(tab, mode);
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
  const sectorFilterHref = row?.sector
    ? `${ROUTES.screener}?sector=${encodeURIComponent(row.sector)}`
    : ROUTES.screener;

  function renderStockDataTab() {
    if (activeStockTab === "overview") return null;
    if (activeStockTab === "filings") {
      return <EdgarSummaryClient ticker={symbol} embedded />;
    }
    if (activeStockTab === "etf") {
      return (
        <div className="stock-main-stack">
          <EtfDataPanel ticker={symbol} data={etfData} loading={etfData === undefined} marketFacts={marketFacts} />
          <footer className="stock-footer">
            <TransitionLink href={isEtfAsset ? ROUTES.etfs : ROUTES.screenerTicker(symbol)} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">← {isEtfAsset ? "ETF 목록에서 보기" : "스크리너에서 보기"}</TransitionLink>
            <TransitionLink href={ROUTES.portfolioTicker(symbol)} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">포트폴리오에서 보기</TransitionLink>
          </footer>
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
              <SectionCard title="추정치 변화">
                <RevisionPulse detail={detail} />
                <CompactFinancialTable detail={detail} years={years} />
                <p data-stock-estimate-disclosure="true" className="mt-3 text-[10px] font-semibold leading-4 text-slate-500">
                  출처: StockAnalysis/Yahoo 계열 추정치 정규화 데이터. EPS 기준(희석/조정 여부)은 제공자 원문 확인이 필요합니다.
                </p>
              </SectionCard>
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
        <footer className="stock-footer">
          <TransitionLink href={ROUTES.screenerTicker(symbol)} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">← 스크리너에서 보기</TransitionLink>
          <TransitionLink href={ROUTES.superinvestorsByTicker(symbol)} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">투자자 보유 보기</TransitionLink>
          <TransitionLink href={ROUTES.portfolioTicker(symbol)} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">포트폴리오에서 보기</TransitionLink>
        </footer>
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
          {fmtDateish(data.fetched_at)}
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
          {fmtDateish(data.fetched_at)}
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
