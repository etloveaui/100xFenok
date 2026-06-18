"use client";

import { useEffect, useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
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
import { renderYfTab, FiftyTwoWeekBar, SummaryScoreCard, ThreeSecondSummary, loadIndustryBenchmarks, resolveIndustryBench, formatMoney, formatCompactMoney } from "./StockTabs";
import type { IndustryBench } from "./StockTabs";
import WatchStar from "@/components/WatchStar";
import { formatSignedPercent } from "@/lib/format";
import TickerSurfaceEventsCard, { loadTickerSurfaces, type TickerSurfacePayload } from "./TickerSurfaceEventsCard";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// stocks_analyzer.json module-level cache
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

function loadAnalyzer(): Promise<Record<string, AnalyzerRow> | null> {
  if (analyzerCache) return Promise.resolve(analyzerCache);
  if (analyzerPromise) return analyzerPromise;
  analyzerPromise = fetch("/data/global-scouter/core/stocks_analyzer.json")
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      const map: Record<string, AnalyzerRow> = {};
      const rows = Array.isArray((data as any)?.data) ? (data as any).data : [];
      for (const r of rows) {
        if (typeof r?.symbol === "string" && r.symbol.trim()) {
          map[r.symbol.trim().toUpperCase()] = r;
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
  const symbol = ticker.trim().toUpperCase();
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
  const symbol = ticker.trim().toUpperCase();
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
  const symbol = ticker.trim().toUpperCase();
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
  const symbol = ticker.trim().toUpperCase();
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
type StockTab = "overview" | "etf" | "financials" | "statistics" | "ownership" | "estimates";
const ESTIMATE_LABELS: Record<string, string> = { fy1: "FY+1", fy2: "FY+2", fy3: "FY+3" };

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
      <div className="truncate text-[8px] font-bold tabular-nums text-slate-400" title={axisLabel}>
        {axisLabel}
      </div>
      <div className="relative flex gap-[2px]" style={{ height: 72 }}>
        <span
          className="pointer-events-none absolute left-0 right-0 border-t border-slate-300/80"
          style={{ top: `${zeroPct}%` }}
        />
        {bars.map((bar) => {
          const s = shape(bar.value);
          const barColor = isFiniteNumber(bar.value) && bar.value < 0 ? "#f43f5e" : color;
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
                    backgroundColor: bar.estimate ? `${barColor}40` : barColor,
                    border: bar.estimate ? `2px dashed ${barColor}` : undefined,
                  }}
                />
              ) : null}
              <span
                className="pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-black tabular-nums text-slate-700 opacity-0 shadow-sm transition-opacity group-focus:opacity-100 group-hover:opacity-100"
                style={{ top: `${tooltipTop}%` }}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex text-[8px] font-bold text-slate-400">
        {bars.map((bar) => (
          <span key={bar.key} className={`flex-1 text-center ${bar.estimate ? "text-slate-400" : ""}`}>
            {bar.label}
          </span>
        ))}
      </div>
      <div className="flex text-[8px] font-black tabular-nums text-slate-500">
        {bars.map((bar) => (
          <span key={`${bar.key}-value`} className={`min-w-0 flex-1 truncate text-center ${bar.estimate ? "text-slate-400" : ""}`}>
            {isFiniteNumber(bar.value) ? formatValue(bar.value) : "—"}
          </span>
        ))}
      </div>
      <div className="flex min-w-0 justify-between gap-2 text-[9px] font-black tabular-nums text-slate-500">
        <span className="min-w-0 truncate">
          최신 {latestActual ? `${latestActual.label} ${formatValue(latestActual.value as number)}` : "—"}
        </span>
        <span className="min-w-0 truncate text-slate-400">
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
            {estKeys.map((k) => <th key={k} className="px-2 py-1.5 text-right bg-slate-50 text-slate-400">{ESTIMATE_LABELS[k] ?? k.toUpperCase()}</th>)}
          </tr>
        </thead>
        <tbody>
          {validRows.map((row) => (
            <tr key={row.label} className="border-b border-slate-100 last:border-b-0">
              <td className="px-2 py-1.5 text-[10px] font-bold text-slate-700">{row.label}</td>
              {row.actuals!.map((v, i) => (
                <td key={i} className="px-2 py-1.5 text-right orbitron tabular-nums font-semibold text-slate-900">{isFiniteNumber(v) ? row.fmt(v) : "—"}</td>
              ))}
              {estKeys.map((k) => (
                <td key={k} className="px-2 py-1.5 text-right bg-slate-50 orbitron tabular-nums font-semibold text-slate-500">
                  {isFiniteNumber(row.estimates?.[k]) ? row.fmt(row.estimates![k] as number) : "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[9px] font-semibold text-slate-400">E = 시장 예상치</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GuruSection
// ---------------------------------------------------------------------------

function GuruSection({ f13Entries, ticker }: { f13Entries: F13Entry[] | null; ticker: string }) {
  const [tradesChip, setTradesChip] = useState<{ bought?: any; sold?: any } | null>(null);
  const tradeInvestorName = (value: any) => {
    if (typeof value === "string") return value;
    if (typeof value?.name === "string") return value.name;
    if (typeof value?.id === "string") return value.id;
    return null;
  };
  const tradeAmount = (value: unknown) => formatCompactMoney(value, "USD");

  useEffect(() => {
    let cancelled = false;
    loadTradesRanking().then((data) => {
      if (cancelled || !data) return;
      const upper = ticker.toUpperCase();
      const b = data.bought.find((r: any) => r?.ticker === upper);
      const s = data.sold.find((r: any) => r?.ticker === upper);
      setTradesChip({ bought: b, sold: s });
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

  return (
    <section>
      <h2 className="mb-3 text-[13px] font-black uppercase tracking-[0.12em] text-slate-500">투자 대가 동향</h2>
      <div className="mb-3 flex flex-wrap gap-2">
        {tradesChip?.bought ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.06em] text-emerald-700">
            최근 분기 투자 대가 순매수 {isFiniteNumber(tradesChip.bought.rank) ? `#${tradesChip.bought.rank} · ` : ""}{tradeAmount(tradesChip.bought.amount)} ({tradesChip.bought.investors_count}명)
            {tradesChip.bought.new_count > 0 ? ` · 신규 ${tradesChip.bought.new_count}명` : ""}
            {tradeInvestorName(tradesChip.bought.top_investor) ? ` · 대표 ${tradeInvestorName(tradesChip.bought.top_investor)}` : ""}
          </span>
        ) : tradesChip?.sold ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.06em] text-rose-700">
            최근 분기 투자 대가 순매도 {isFiniteNumber(tradesChip.sold.rank) ? `#${tradesChip.sold.rank} · ` : ""}{tradeAmount(tradesChip.sold.amount)} ({tradesChip.sold.investors_count}명)
            {tradesChip.sold.exit_count > 0 ? ` · 청산 ${tradesChip.sold.exit_count}명` : ""}
            {tradeInvestorName(tradesChip.sold.top_investor) ? ` · 대표 ${tradeInvestorName(tradesChip.sold.top_investor)}` : ""}
          </span>
        ) : null}
      </div>
      {holders.length > 0 ? (
        <div className="-mx-1 overflow-x-auto px-1">
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
                    <TransitionLink href="/superinvestors" className="text-[10px] font-black text-brand-interactive hover:underline">
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
  const benchValue = isFiniteNumber(benchmark?.value) ? benchmark.value : null;
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-slate-500">{label}</span>
        <span className="orbitron tabular-nums text-sm font-black text-slate-900">{value}</span>
      </div>
      {finiteValues(data).length >= 2 ? <div className="mt-1"><Sparkline data={data} color={color} years={years} estimates={estimates ?? undefined} formatValue={formatValue} /></div> : null}
      {(isFiniteNumber(nextEstimate) || benchValue !== null) ? (
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] font-black tabular-nums text-slate-400">
          {isFiniteNumber(nextEstimate) ? (
            <span>추정 {ESTIMATE_LABELS[nextEstimateKey!] ?? nextEstimateKey!.toUpperCase()} {formatValue(nextEstimate)}</span>
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
      <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-500">{label}</span>
      <span className="orbitron tabular-nums text-xs font-black text-slate-900">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StockDetailClient main
// ---------------------------------------------------------------------------

export default function StockDetailClient({ ticker, assetHint }: { ticker: string; assetHint?: "stock" | "etf" }) {
  const symbol = ticker.trim().toUpperCase();
  const [row, setRow] = useState<AnalyzerRow | null | undefined>(undefined);
  const { data: marketFacts, loading: marketFactsLoading } = useMarketFacts(symbol, assetHint !== "etf");
  const canLoadStockData = row !== undefined && row !== null;
  const { detail, loading: detailLoading } = useStockDetail(symbol, canLoadStockData);
  const f13Entries = use13FData(symbol);
  const canonical = row ? resolveSector(null, row.sector) : null;
  const years: string[] = Array.isArray(detail?.years) ? detail.years : [];
  const rowPerBand = validAnalyzerPerBand(row);
  const detailPerBands = validDetailPerBands(detail?.per_bands);
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
  const [stockTab, setStockTab] = useState<StockTab>("overview");
  const [etfData, setEtfData] = useState<StockanalysisEtfPayload | null | undefined>(undefined);
  const [etfSurfaceData, setEtfSurfaceData] = useState<TickerSurfacePayload | null | undefined>(undefined);
  const [stockAuxData, setStockAuxData] = useState<StockanalysisStockPayload | null | undefined>(undefined);
  const [financialCandidate, setFinancialCandidate] = useState<StockanalysisFinancialPayload | null | undefined>(undefined);
  const marketFactsAssetType = marketFacts?.asset_type;

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
    const shouldLoadEtfData = assetHint === "etf" || marketFactsAssetType === "etf";
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
  }, [assetHint, marketFactsAssetType, symbol]);

  useEffect(() => {
    let cancelled = false;
    const shouldLoadEtfSurfaceData = assetHint === "etf" || marketFactsAssetType === "etf";
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
  }, [assetHint, marketFactsAssetType, symbol]);

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
  const activeStockTab: StockTab = !isEtfAsset && stockTab === "etf"
    ? "overview"
    : isEtfOnlyAsset && stockTab === "overview"
      ? "etf"
      : stockTab;
  const stockTabs: Array<{ id: StockTab; label: string }> = [
    ...(!isEtfOnlyAsset ? [{ id: "overview" as const, label: "요약" }] : []),
    ...(isEtfAsset ? [{ id: "etf" as const, label: "ETF" }] : []),
    ...(yfAvailable
      ? [
          { id: "financials" as const, label: "재무" },
          { id: "statistics" as const, label: "통계" },
          { id: "ownership" as const, label: "보유기관" },
          { id: "estimates" as const, label: "추정치" },
        ]
      : []),
  ];

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
                  <h1>{displayAssetName}</h1>
                  <WatchStar ticker={symbol} className="stock-star" />
                </div>
                <div className="stock-meta">
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
            <div className="stock-tabs" role="tablist" aria-label={`${symbol} 상세 탭`}>
              {stockTabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setStockTab(t.id)}
                  className={`stock-tab ${activeStockTab === t.id ? "on" : ""}`}
                  aria-current={activeStockTab === t.id ? "page" : undefined}
                >
                  {t.label}
                </button>
              ))}
              {etfData === undefined ? <span className="stock-tab-note">ETF 상세 로딩 중...</span> : null}
            </div>
          </section>
          <div className="stock-body">
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
                <TransitionLink href={isEtfAsset ? "/etfs" : "/screener"} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">← {isEtfAsset ? "ETF 목록으로 이동" : "스크리너로 이동"}</TransitionLink>
                <TransitionLink href={`/portfolio?ticker=${encodeURIComponent(symbol)}`} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">포트폴리오에서 보기</TransitionLink>
              </footer>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="stock-shell">
        <div className="panel stock-empty">
          <p className="text-lg font-black text-slate-700">해당 티커를 찾을 수 없습니다</p>
          <p className="mt-2 text-sm font-semibold text-slate-500">{symbol} — stocks_analyzer.json에 존재하지 않는 티커입니다.</p>
          <TransitionLink href="/screener" className="mt-4 inline-flex min-h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive">← 스크리너에서 보기</TransitionLink>
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

  function renderStockDataTab() {
    if (activeStockTab === "overview") return null;
    if (activeStockTab === "etf") {
      return (
        <div className="stock-main-stack">
          <EtfDataPanel ticker={symbol} data={etfData} loading={etfData === undefined} marketFacts={marketFacts} />
          <footer className="stock-footer">
            <TransitionLink href={isEtfAsset ? "/etfs" : `/screener?ticker=${encodeURIComponent(symbol)}`} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">← {isEtfAsset ? "ETF 목록에서 보기" : "스크리너에서 보기"}</TransitionLink>
            <TransitionLink href={`/portfolio?ticker=${encodeURIComponent(symbol)}`} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">포트폴리오에서 보기</TransitionLink>
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
                    ["매출", numberSeries(detail.income_statement?.revenue), detail.income_statement_estimates?.revenue, "#10b981"],
                    ["영업이익", numberSeries(detail.income_statement?.operating_income), detail.income_statement_estimates?.operating_income, "#06b6d4"],
                    ["순이익", numberSeries(detail.income_statement?.net_income), detail.income_statement_estimates?.net_income, "#8b5cf6"],
                    ["FCF", numberSeries(detail.cash_flow?.fcf), detail.cash_flow_estimates?.fcf, "#f59e0b"],
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
                        <MetricWithSpark label="매출총이익률" value={fmtWholePct(lastFinite((detail.profitability as any)?.gross_margin))} data={(detail.profitability as any)?.gross_margin ?? []} estimates={profitabilityEstimates?.gross_margin} color="#14b8a6" years={years} formatValue={fmtWholePct} />
                        <MetricWithSpark label="영업이익률" value={fmtWholePct(lastFinite((detail.profitability as any)?.operating_margin))} data={(detail.profitability as any)?.operating_margin ?? []} estimates={profitabilityEstimates?.operating_margin} color="#06b6d4" years={years} benchmark={industryBench ? { label: "산업", value: benchPct(industryBench.operating_margin) } : null} formatValue={fmtWholePct} />
                        <MetricWithSpark label="순이익률" value={fmtWholePct(lastFinite((detail.profitability as any)?.net_margin))} data={(detail.profitability as any)?.net_margin ?? []} estimates={profitabilityEstimates?.net_margin} color="#6366f1" years={years} benchmark={industryBench ? { label: "산업", value: benchPct(industryBench.net_margin) } : null} formatValue={fmtWholePct} />
                        <MetricWithSpark label="ROE" value={fmtWholePct(lastFinite((detail.profitability as any)?.roe))} data={(detail.profitability as any)?.roe ?? []} estimates={profitabilityEstimates?.roe} color="#8b5cf6" years={years} benchmark={industryBench ? { label: "산업", value: benchPct(industryBench.roe) } : null} formatValue={fmtWholePct} />
                        <MetricWithSpark label="ROA" value={fmtWholePct(lastFinite((detail.profitability as any)?.roa))} data={(detail.profitability as any)?.roa ?? []} estimates={profitabilityEstimates?.roa} color="#0ea5e9" years={years} formatValue={fmtWholePct} />
                      </div>
                      {industryBench && isFiniteNumber(industryBench.cost_of_capital) ? (
                        <p className="mt-2 text-[10px] font-semibold text-slate-400">
                          다모다란 산업 자본비용 {fmtWholePct(industryBench.cost_of_capital * 100)}
                        </p>
                      ) : null}
                    </div>
                    <div>
                      <h4 className="mb-2 text-[11px] font-black tracking-[0.08em] text-slate-500">성장률 (YoY)</h4>
                      <div className="space-y-3">
                        <MetricWithSpark label="매출 성장률" value={fmtWholeSignedPct(lastFinite((detail.growth as any)?.revenue_growth))} data={toFractionSeries((detail.growth as any)?.revenue_growth)} estimates={estimateSeries(detail.growth_estimates?.revenue_growth, 100)} color="#10b981" years={years} formatValue={fmtPct} />
                        <MetricWithSpark label="EPS 성장률" value={fmtWholeSignedPct(lastFinite((detail.growth as any)?.eps_growth))} data={toFractionSeries((detail.growth as any)?.eps_growth)} estimates={estimateSeries(detail.growth_estimates?.eps_growth, 100)} color="#f59e0b" years={years} formatValue={fmtPct} />
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
              <p className="text-sm font-black text-slate-700">상세 데이터를 불러올 수 없습니다</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">상세 데이터를 준비 중입니다. 잠시 후 다시 확인해 주세요.</p>
            </div>
          </SectionCard>
        )}
        <footer className="stock-footer">
          <TransitionLink href={`/screener?ticker=${encodeURIComponent(symbol)}`} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">← 스크리너에서 보기</TransitionLink>
          <TransitionLink href={`/superinvestors?tab=by-ticker&ticker=${encodeURIComponent(symbol)}`} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">투자자 보유 보기</TransitionLink>
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
              <h1>{displayName}</h1>
              <WatchStar ticker={symbol} className="stock-star" />
            </div>
            <div className="stock-meta">
              <span className="num">{symbol}</span>
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
            <span className="delay">데이터 지연 가능</span>
          </div>
        </div>
        <div className="stock-tabs" role="tablist" aria-label={`${symbol} 상세 탭`}>
          {stockTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setStockTab(t.id)}
              className={`stock-tab ${activeStockTab === t.id ? "on" : ""}`}
              aria-current={activeStockTab === t.id ? "page" : undefined}
            >
              {t.label}
            </button>
          ))}
          {isEtfAsset && etfData === undefined ? <span className="stock-tab-note">ETF 상세 로딩 중...</span> : !yfLoaded ? <span className="stock-tab-note">보조 데이터 로딩 중...</span> : !yfAvailable ? <span className="stock-tab-note">보조 데이터 수집 전</span> : null}
        </div>
      </section>

      <div className="stock-body">
        <div className="stock-summary-stack">
          {yfAvailable ? (
            <ThreeSecondSummary
              data={yfData}
              perBand={rowPerBand}
              guruCount={f13Entries ? new Set(f13Entries.map((e) => e.investor)).size : 0}
              industry={industryBench}
            />
          ) : null}
          {yfAvailable ? <FiftyTwoWeekBar info={yfData.info} /> : null}
          {yfAvailable ? (
            <SummaryScoreCard
              data={yfData}
              perBand={rowPerBand}
              industry={industryBench}
            />
          ) : null}
          {!isEtfAsset || marketFacts ? <MarketFactsDepth ticker={symbol} compact /> : null}
          <TickerSurfaceEventsCard ticker={symbol} assetKind={isEtfAsset ? "etf" : "stock"} compact />
      </div>

      {activeStockTab !== "overview" ? renderStockDataTab() : (
      <div className="stock-overview-grid">
        {/* LEFT RAIL (280px sticky) */}
        <aside className="stock-side">
          <div className="panel stock-side-panel">
            <div className="panel-b">
            <div className="mb-3">
              <h1 className="text-lg font-black tracking-tight text-slate-950">{row ? row.companyName : "..."}</h1>
              <p className="orbitron text-sm font-black text-slate-400">{symbol}</p>
            </div>
            {canonical ? (
              <div className="mb-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-700">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: sectorColor(canonical) }} />
                  {sectorLabelKo(canonical)}
                </span>
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
                    <p className="text-[10px] font-semibold uppercase tracking-[0.05em] opacity-70">PER 밴드 위치</p>
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
                      <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">{item.label}</p>
                      <p className="orbitron mt-1 min-w-0 break-words text-base font-black tabular-nums text-slate-950">{item.value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-4">
                  {[
                    ["재무", "매출·FCF·상세"],
                    ["통계", "밸류·수익성"],
                    ["추정치", "FY+1~3·변화"],
                    ["보유기관", "13F 투자자"],
                  ].map(([label, desc]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setStockTab(label === "재무" ? "financials" : label === "통계" ? "statistics" : label === "추정치" ? "estimates" : "ownership")}
                      className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left transition hover:border-brand-interactive hover:bg-white"
                    >
                      <span className="block text-[11px] font-black text-slate-800">{label}</span>
                      <span className="mt-0.5 block text-[10px] font-semibold text-slate-400">{desc}</span>
                    </button>
                  ))}
                </div>
              </SectionCard>
              <StockAuxiliaryPanel data={stockAuxData} loading={stockAuxData === undefined} currency={displayCurrency} />
            </>
          ) : (
            <SectionCard>
              <div className="py-8 text-center">
                <p className="text-sm font-black text-slate-700">상세 데이터를 불러올 수 없습니다</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">상세 데이터를 준비 중입니다. 잠시 후 다시 확인해 주세요.</p>
              </div>
            </SectionCard>
          )}

          <footer className="stock-footer">
            <TransitionLink href={`/screener?ticker=${encodeURIComponent(symbol)}`} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">← 스크리너에서 보기</TransitionLink>
            <TransitionLink href={`/superinvestors?tab=by-ticker&ticker=${encodeURIComponent(symbol)}`} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">투자자 보유 보기</TransitionLink>
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
      <SectionCard title="보조 데이터 체크">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => <div key={item} className="h-20 rounded-xl bg-slate-100" />)}
        </div>
      </SectionCard>
    );
  }

  if (!data) {
    return (
      <SectionCard title="보조 데이터 체크">
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4">
          <p className="text-sm font-semibold text-slate-500">보조 데이터 수집 전입니다.</p>
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
    { label: "시가총액", value: stockOverviewText(overview.marketCap), note: "보조 데이터" },
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
    <SectionCard title="보조 데이터 체크">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-500">주요 지표를 기존 분석 데이터와 교차 확인합니다.</p>
        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-black text-slate-500">
          {fmtDateish(data.fetched_at)}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric) => (
          <div key={`${metric.label}-${metric.value}`} className="rounded-xl border border-slate-200 bg-white/70 px-3 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">{metric.label}</p>
            <p className="orbitron mt-1 min-w-0 break-words text-base font-black tabular-nums text-slate-950">{metric.value}</p>
            {metric.note !== "—" ? <p className="mt-1 min-w-0 break-words text-[10px] font-semibold text-slate-400">{metric.note}</p> : null}
          </div>
        ))}
      </div>
      {(annualFieldCount > 0 || quarterlyFieldCount > 0) ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-500">
          재무 보강 파일: 연간 {annualFieldCount.toLocaleString("ko-KR")}필드 · 분기 {quarterlyFieldCount.toLocaleString("ko-KR")}필드
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
        <p className="mt-1 text-sm font-semibold text-slate-500">교차검증용 재무 데이터 수집 전입니다.</p>
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
            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">{group.label} 커버리지</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Object.entries(group.data).map(([key, info]) => (
                <div key={`${group.label}-${key}`} className="rounded-md bg-slate-50 px-2 py-2">
                  <p className="text-[10px] font-bold text-slate-500">{financialStatementLabel(key)}</p>
                  <p className="orbitron mt-0.5 text-xs font-black tabular-nums text-slate-900">
                    {fmtCandidateCount(info?.field_count)}필드
                  </p>
                  <p className="mt-0.5 text-[10px] font-semibold text-slate-400">
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
    ? "상세 구성 수집 전 · 신규 상장 목록 기준"
    : detailStatus === "universe_only"
      ? "상세 구성 수집 전 · ETF 목록 기준"
      : null;

  const cards = [
    { label: "가격", value: price !== null ? formatMoney(price, currency) : "—", note: fmtDateish(quote.u) },
    { label: "당일 변화", value: fmtEtfSignedPct(changePct), note: rawText(quote.ex) },
    { label: "운용자산", value: totalAssets !== null ? formatCompactMoney(totalAssets, currency) : rawText(overview.aum), note: "운용자산" },
    { label: "NAV", value: rawText(overview.nav), note: "순자산가치" },
    { label: "보수율", value: expenseRatio !== null ? fmtEtfPct(expenseRatio) : rawText(overview.expenseRatio), note: "Expense" },
    { label: "배당률", value: dividendYield !== null ? fmtEtfPct(dividendYield) : rawText(overview.dividendYield), note: "Yield" },
    { label: "베타", value: beta !== null ? beta.toFixed(2) : rawText(overview.beta), note: "민감도" },
    { label: "설정일", value: rawText(overview.inception), note: "Inception" },
    { label: "표시 종목", value: `${holdings.length.toLocaleString()} / ${holdingCount.toLocaleString()}`, note: fmtDateish(holdingsUpdated) },
    { label: "표시 비중 합계", value: holdings.length > 0 ? fmtEtfPct(totalWeight) : "—", note: "표시 항목 기준" },
  ].filter((card) => card.value !== "—");

  if (!data && !marketFacts) {
    return (
      <SectionCard title="ETF 상세">
        <div className="py-8 text-center">
          <p className="text-sm font-black text-slate-700">ETF 상세 데이터는 아직 없습니다</p>
          <p className="mt-1 text-xs font-semibold text-slate-500">신규 ETF는 보유 구성이 열리기 전까지 목록과 가격 정보를 먼저 표시합니다.</p>
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
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {cards.map((card) => (
            <div key={`${card.label}-${card.value}`} className="rounded-xl border border-slate-200 bg-white/70 px-3 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">{card.label}</p>
              <p className="orbitron mt-1 min-w-0 break-words text-base font-black tabular-nums text-slate-950">{card.value}</p>
              {card.note !== "—" ? <p className="mt-1 min-w-0 break-words text-[10px] font-semibold text-slate-400">{card.note}</p> : null}
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
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
    return <p className="text-sm font-semibold text-slate-400">보유 데이터 없음</p>;
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
                <td className="px-2 py-2 text-right orbitron tabular-nums text-[11px] font-bold text-slate-400">{item.rank ?? index + 1}</td>
                <td className="px-2 py-2 font-bold text-slate-800">{item.name ?? "—"}</td>
                <td className="px-2 py-2 orbitron tabular-nums text-[11px] font-black text-slate-500">{item.symbol ?? "—"}</td>
                <td className={`px-2 py-2 text-right orbitron tabular-nums text-xs font-black ${weightClass}`}>{fmtEtfPct(weight)}</td>
                <td className="px-2 py-2 text-right orbitron tabular-nums text-[11px] font-semibold text-slate-600">{fmtShares(item.shares)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {currency ? <p className="mt-2 text-[10px] font-semibold text-slate-400">표시 통화: {currency}</p> : null}
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
  if (!items.length) return <p className="text-sm font-semibold text-slate-400">{empty}</p>;
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
  if (!rows.length) return <p className="text-sm font-semibold text-slate-400">가격 히스토리 없음</p>;
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
              <span className="hidden max-w-full truncate text-[9px] font-bold text-slate-400 sm:block">{(point.t ?? "").slice(5, 7)}</span>
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
