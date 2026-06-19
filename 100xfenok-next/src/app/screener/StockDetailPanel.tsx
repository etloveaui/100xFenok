"use client";

import { useEffect, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import { bandPct, bandClass } from "@/lib/screener/bands";
import type { ScreenerStock } from "@/lib/screener/types";
import { interpretStockMetrics } from "@/lib/screener/deterministicRules";

export type MaybeNumber = number | null | undefined;
export type NumberSeries = MaybeNumber[];
export type EstimateSeries = { fy1?: MaybeNumber; fy2?: MaybeNumber; fy3?: MaybeNumber };
const ESTIMATE_KEYS = ["fy1", "fy2", "fy3"] as const;
const CHART_WIDTH = 300;
const CHART_PAD_L = 44;
const CHART_PAD_R = 30;

interface WeeklyPoint {
  date?: string;
  value?: MaybeNumber;
}

interface WeeklyConsensusRow {
  date?: string;
  price?: MaybeNumber;
  revenue_consensus?: MaybeNumber;
  revenue_change?: MaybeNumber;
  eps_consensus?: MaybeNumber;
  eps_change?: MaybeNumber;
  per?: MaybeNumber;
  pbr?: MaybeNumber;
}

interface RawFinancials {
  periods?: string[];
  income_statement?: {
    revenue?: NumberSeries;
    gross_profit?: NumberSeries;
    operating_income?: NumberSeries;
    net_income?: NumberSeries;
  };
  per_share?: { eps?: NumberSeries };
  cash_flow?: { fcf?: NumberSeries; cfo?: NumberSeries; capex?: NumberSeries };
  profitability?: {
    gross_margin?: NumberSeries;
    operating_margin?: NumberSeries;
    net_margin?: NumberSeries;
    roe?: NumberSeries;
    roa?: NumberSeries;
  };
  growth?: { revenue_growth?: NumberSeries; eps_growth?: NumberSeries };
  valuation?: { per?: NumberSeries; pbr?: NumberSeries; psr?: NumberSeries };
}

export interface DetailData {
  years: string[];
  raw_periods?: string[];
  raw_financials?: RawFinancials;
  valuation?: { per?: NumberSeries };
  income_statement: {
    revenue?: NumberSeries;
    gross_profit?: NumberSeries;
    operating_income?: NumberSeries;
    net_income?: NumberSeries;
  };
  per_share?: { eps?: NumberSeries };
  cash_flow?: { cfo?: NumberSeries; capex?: NumberSeries; fcf?: NumberSeries };
  scale_estimates?: Record<string, Record<string, MaybeNumber>>;
  profitability?: {
    gross_margin?: NumberSeries;
    operating_margin?: NumberSeries;
    net_margin?: NumberSeries;
    roe?: NumberSeries;
    roa?: NumberSeries;
  };
  growth?: { revenue_growth?: NumberSeries; eps_growth?: NumberSeries };
  per_bands?: {
    current: MaybeNumber;
    min_8y: MaybeNumber;
    avg_8y: MaybeNumber;
    max_8y: MaybeNumber;
    source: string;
  };
  valuation_estimates?: {
    per?: { fy1?: MaybeNumber; fy2?: MaybeNumber; fy3?: MaybeNumber };
  };
  income_statement_estimates?: Record<string, Record<string, MaybeNumber>>;
  cash_flow_estimates?: Record<string, Record<string, MaybeNumber>>;
  profitability_estimates?: Record<string, Record<string, MaybeNumber>>;
  growth_estimates?: Record<string, Record<string, MaybeNumber>>;
  per_share_estimates?: Record<string, Record<string, MaybeNumber>>;
  dividend_estimates?: Record<string, Record<string, MaybeNumber>>;
  dividend?: { dps?: NumberSeries };
  eps_consensus?: {
    weekly?: {
      fy_plus_1?: WeeklyPoint[];
      fy_plus_2?: WeeklyPoint[];
      fy_plus_3?: WeeklyPoint[];
    };
    weekly_change?: {
      fy_plus_1?: MaybeNumber;
      fy_plus_2?: MaybeNumber;
      fy_plus_3?: MaybeNumber;
    };
  };
  weekly_revision_history?: {
    weekly_consensus_revision?: WeeklyConsensusRow[];
  };
}

export interface F13Entry {
  investor: string;
  shares?: number;
  weight?: number;
}

interface SlickMetricPoint {
  date?: string;
  price?: MaybeNumber;
  pe_trailing?: MaybeNumber;
  pe_forward?: MaybeNumber;
  eps_trailing?: MaybeNumber;
  eps_forward?: MaybeNumber;
  dividend_yield?: MaybeNumber;
  dividend_ttm?: MaybeNumber;
  market_cap_billions?: MaybeNumber;
}

interface SlickReturnPoint {
  year?: number;
  return?: MaybeNumber;
}

interface SlickDividendPoint {
  amount?: MaybeNumber;
  exDate?: string;
  payDate?: string;
}

interface SlickStockData {
  symbol?: string;
  company?: string;
  updated?: string;
  current?: SlickMetricPoint;
  metrics_history?: SlickMetricPoint[];
  returns?: SlickReturnPoint[];
  dividends?: SlickDividendPoint[];
}

interface MarketFactCandidate {
  value?: unknown;
  source?: string;
  as_of?: string | null;
  fetched_at?: string | null;
  confidence?: string;
  unit?: string;
}

interface MarketFact extends MarketFactCandidate {
  candidates?: MarketFactCandidate[];
  policy?: string[];
  candidate_count?: number;
}

interface MarketFactsData {
  ticker?: string;
  asset_type?: string;
  generated_at?: string;
  identity?: {
    name?: string | null;
    exchange?: string | null;
    currency?: string | null;
    sector?: string | null;
    industry?: string | null;
    fund_family?: string | null;
    category?: string | null;
  };
  facts?: Record<string, MarketFact>;
  etf?: {
    holdings_count?: number | null;
    holdings_updated?: string | null;
    top_holdings?: Array<{
      rank?: number;
      symbol?: string;
      name?: string;
      weight_pct?: number;
      shares?: number;
    }>;
    asset_allocation?: Array<{
      key?: string;
      value?: number;
    }>;
    sectors?: Array<{
      n?: string;
      key?: string;
      w?: number;
      weight?: number;
      value?: number;
    }>;
    countries?: Array<{
      code?: string;
      country?: string;
      weight?: number;
      value?: number;
    }>;
    yahoo_funds_data_available?: boolean;
  } | null;
  sources?: Record<string, boolean>;
  source_files?: Record<string, string | null>;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteValues(data: NumberSeries | null | undefined): number[] {
  return (data ?? []).filter(isFiniteNumber);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

type FiscalPoint = { label: string; value: number; index: number; estimate?: boolean };

function normalizeEstimates(estimates?: MaybeNumber | EstimateSeries): EstimateSeries {
  if (isFiniteNumber(estimates)) return { fy1: estimates };
  return estimates && typeof estimates === "object" ? estimates : {};
}

function buildFiscalPoints(years: string[], data: NumberSeries | null | undefined, estimates?: MaybeNumber | EstimateSeries) {
  const actualCount = Math.max(years.length, data?.length ?? 0);
  const labels = Array.from({ length: actualCount }, (_, index) => years[index] ?? `P${index + 1}`);
  const points: FiscalPoint[] = (data ?? [])
    .map((value, index) => ({
      label: labels[index] ?? `P${index + 1}`,
      value,
      index,
    }))
    .filter((point): point is FiscalPoint => isFiniteNumber(point.value));
  const estimateLabels = ESTIMATE_KEYS.map((key, index) => [key, `FY+${index + 1}`] as const);
  const estimatePoints: FiscalPoint[] = [];
  estimateLabels.forEach(([key, label]) => {
    const value = normalizeEstimates(estimates)[key];
    if (isFiniteNumber(value)) {
      estimatePoints.push({ label, value, index: actualCount + estimatePoints.length, estimate: true });
    }
  });
  points.push(...estimatePoints);
  return {
    labels: [...labels, ...estimatePoints.map((point) => point.label)],
    points,
  };
}

function deriveRatioEstimates(
  existing: Record<string, MaybeNumber> | undefined,
  numerator: Record<string, MaybeNumber> | undefined,
  denominator: Record<string, MaybeNumber> | undefined,
): EstimateSeries | null {
  const next: EstimateSeries = {};
  for (const key of ESTIMATE_KEYS) {
    const existingValue = existing?.[key];
    if (isFiniteNumber(existingValue)) {
      next[key] = existingValue;
      continue;
    }
    const numeratorValue = numerator?.[key];
    const denominatorValue = denominator?.[key];
    next[key] = isFiniteNumber(numeratorValue) && isFiniteNumber(denominatorValue) && denominatorValue !== 0
      ? (numeratorValue / denominatorValue) * 100
      : null;
  }
  return Object.values(next).some(isFiniteNumber) ? next : null;
}

export function deriveProfitabilityEstimates(detail: DetailData): Record<string, EstimateSeries | null> {
  const income = detail.income_statement_estimates;
  const scale = detail.scale_estimates;
  const existing = detail.profitability_estimates;
  return {
    gross_margin: deriveRatioEstimates(existing?.gross_margin, income?.gross_profit, income?.revenue),
    operating_margin: deriveRatioEstimates(existing?.operating_margin, income?.operating_income, income?.revenue),
    net_margin: deriveRatioEstimates(existing?.net_margin, income?.net_income, income?.revenue),
    roe: deriveRatioEstimates(existing?.roe, income?.net_income, scale?.total_equity),
    roa: deriveRatioEstimates(existing?.roa, income?.net_income, scale?.total_assets),
  };
}

function lastFinite(data: NumberSeries | null | undefined): number | null {
  const values = finiteValues(data);
  return values.length > 0 ? values[values.length - 1] : null;
}

function validPerBands(
  perBands: DetailData["per_bands"],
): perBands is { current: number; min_8y: number; avg_8y: number; max_8y: number; source: string } {
  return Boolean(
    perBands &&
      isFiniteNumber(perBands.current) &&
      isFiniteNumber(perBands.min_8y) &&
      isFiniteNumber(perBands.avg_8y) &&
      isFiniteNumber(perBands.max_8y) &&
      perBands.min_8y < perBands.max_8y,
  );
}

function fmtPlainNumber(value: MaybeNumber, digits = 1): string {
  return isFiniteNumber(value) ? value.toFixed(digits) : "—";
}

function fmtSignedNumber(value: MaybeNumber, digits = 2): string {
  if (!isFiniteNumber(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function fmtSignedPercentPoints(value: MaybeNumber, digits = 1): string {
  if (!isFiniteNumber(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function fmtSignedFractionPercent(value: MaybeNumber, digits = 1): string {
  if (!isFiniteNumber(value)) return "—";
  const pct = value * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(digits)}%`;
}

function fmtEps(value: MaybeNumber): string {
  return isFiniteNumber(value) ? `$${value.toFixed(2)}` : "—";
}

function toneText(value: MaybeNumber): string {
  if (!isFiniteNumber(value)) return "text-[var(--c-ink-4)]";
  return value >= 0 ? "text-[var(--c-up)]" : "text-[var(--c-down)]";
}

export function useStockDetail(ticker: string, enabled = true) {
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const symbol = normalizeTicker(ticker);
    if (!enabled || !symbol) {
      setDetail(null);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    const run = async () => {
      setLoading(true);
      try {
        const r = await fetch(`/data/global-scouter/stocks/detail/${encodeURIComponent(symbol)}.json`);
        const d = r.ok ? await r.json() : null;
        if (!cancelled) setDetail(isRecord(d) ? (d as unknown as DetailData) : null);
      } catch {
        if (!cancelled) setDetail(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [ticker, enabled]);

  return { detail, loading };
}

const F13_CACHE = new Map<string, F13Entry[]>();

export function use13FData(ticker: string) {
  const [entries, setEntries] = useState<F13Entry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const symbol = normalizeTicker(ticker);
    if (!symbol) {
      Promise.resolve().then(() => {
        if (!cancelled) setEntries([]);
      });
      return () => {
        cancelled = true;
      };
    }
    const run = async () => {
      const cached = F13_CACHE.get(symbol);
      if (cached !== undefined) {
        setEntries(cached);
        return;
      }
      try {
        const r = await fetch("/data/sec-13f/by_ticker.json");
        const d = r.ok ? await r.json() : null;
        const holders = Array.isArray(d?.[symbol]?.holder_details) ? d[symbol].holder_details : [];
        const seen = new Set<string>();
        const unique = holders.filter((h: { investor?: unknown }) => {
          if (typeof h.investor !== "string" || h.investor.trim() === "") return false;
          if (seen.has(h.investor)) return false;
          seen.add(h.investor);
          return true;
        }) as F13Entry[];
        F13_CACHE.set(symbol, unique);
        if (!cancelled) setEntries(unique);
      } catch {
        F13_CACHE.set(symbol, []);
        if (!cancelled) setEntries([]);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  return entries;
}

const SLICK_STOCK_CACHE = new Map<string, SlickStockData | null>();
const MARKET_FACTS_CACHE = new Map<string, MarketFactsData | null>();

function readSlickMetric(value: unknown): SlickMetricPoint | null {
  if (!isRecord(value)) return null;
  const point: SlickMetricPoint = {
    date: optionalString(value.date),
    price: finiteNumber(value.price),
    pe_trailing: finiteNumber(value.pe_trailing),
    pe_forward: finiteNumber(value.pe_forward),
    eps_trailing: finiteNumber(value.eps_trailing),
    eps_forward: finiteNumber(value.eps_forward),
    dividend_yield: finiteNumber(value.dividend_yield),
    dividend_ttm: finiteNumber(value.dividend_ttm),
    market_cap_billions: finiteNumber(value.market_cap_billions),
  };
  return point.date ||
    isFiniteNumber(point.price) ||
    isFiniteNumber(point.pe_trailing) ||
    isFiniteNumber(point.pe_forward) ||
    isFiniteNumber(point.market_cap_billions)
    ? point
    : null;
}

function readSlickReturn(value: unknown): SlickReturnPoint | null {
  if (!isRecord(value)) return null;
  const year = finiteNumber(value.year);
  const returnPct = finiteNumber(value.return);
  return isFiniteNumber(year) && isFiniteNumber(returnPct) ? { year, return: returnPct } : null;
}

function readSlickDividend(value: unknown): SlickDividendPoint | null {
  if (!isRecord(value)) return null;
  const point = {
    amount: finiteNumber(value.amount),
    exDate: optionalString(value.exDate),
    payDate: optionalString(value.payDate),
  };
  return isFiniteNumber(point.amount) || point.exDate || point.payDate ? point : null;
}

function normalizeSlickStock(value: unknown): SlickStockData | null {
  if (!isRecord(value)) return null;
  const current = readSlickMetric(value.current);
  const metrics = Array.isArray(value.metrics_history)
    ? value.metrics_history.map(readSlickMetric).filter((point): point is SlickMetricPoint => point !== null)
    : [];
  const returns = Array.isArray(value.returns)
    ? value.returns.map(readSlickReturn).filter((point): point is SlickReturnPoint => point !== null)
    : [];
  const dividends = Array.isArray(value.dividends)
    ? value.dividends.map(readSlickDividend).filter((point): point is SlickDividendPoint => point !== null)
    : [];
  if (!current && metrics.length === 0 && returns.length === 0 && dividends.length === 0) return null;
  return {
    symbol: optionalString(value.symbol),
    company: optionalString(value.company),
    updated: optionalString(value.updated),
    current: current ?? undefined,
    metrics_history: metrics,
    returns,
    dividends,
  };
}

export function useSlickStock(ticker: string, enabled = true) {
  const [data, setData] = useState<SlickStockData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const symbol = normalizeTicker(ticker);
    if (!enabled || !symbol) {
      setData(null);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    const cached = SLICK_STOCK_CACHE.get(symbol);
    if (cached !== undefined) {
      setData(cached);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const run = async () => {
      setLoading(true);
      try {
        const r = await fetch(`/data/slickcharts/stocks/${encodeURIComponent(symbol)}.json`);
        const parsed = r.ok ? normalizeSlickStock(await r.json()) : null;
        SLICK_STOCK_CACHE.set(symbol, parsed);
        if (!cancelled) setData(parsed);
      } catch {
        SLICK_STOCK_CACHE.set(symbol, null);
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [ticker, enabled]);

  return { data, loading };
}

function normalizeMarketFacts(value: unknown): MarketFactsData | null {
  if (!isRecord(value)) return null;
  if (!isRecord(value.facts) && !isRecord(value.identity) && !isRecord(value.etf)) return null;
  return value as unknown as MarketFactsData;
}

export function useMarketFacts(ticker: string, enabled = true) {
  const [data, setData] = useState<MarketFactsData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const symbol = normalizeTicker(ticker);
    if (!enabled || !symbol) {
      setData(null);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    const cached = MARKET_FACTS_CACHE.get(symbol);
    if (cached !== undefined) {
      setData(cached);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const run = async () => {
      setLoading(true);
      try {
        const r = await fetch(`/data/computed/market_facts/tickers/${encodeURIComponent(symbol)}.json`);
        const parsed = r.ok ? normalizeMarketFacts(await r.json()) : null;
        MARKET_FACTS_CACHE.set(symbol, parsed);
        if (!cancelled) setData(parsed);
      } catch {
        MARKET_FACTS_CACHE.set(symbol, null);
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [ticker, enabled]);

  return { data, loading };
}

function sourceLabel(source?: string): string {
  if (!source) return "출처 없음";
  if (source === "yf") return "가격·재무 기준";
  if (source === "yf.fast_info") return "빠른 가격 기준";
  if (source === "stockanalysis") return "추가 지표";
  if (source === "stockanalysis.quote") return "추가 가격 기준";
  if (source === "stockanalysis.overview") return "추가 재무 기준";
  if (source === "slickcharts") return "지수 구성 기준";
  return "확인 기준";
}

function fmtMarketMoney(value: number, currency = "USD"): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const prefix = currency === "USD" ? "$" : `${currency} `;
  if (abs >= 1_000_000_000_000) return `${sign}${prefix}${(abs / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000) return `${sign}${prefix}${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}${prefix}${(abs / 1_000_000).toFixed(1)}M`;
  return `${sign}${prefix}${abs.toFixed(abs >= 100 ? 0 : 2)}`;
}

function formatMarketFact(key: string, fact: MarketFact | undefined, currency = "USD"): string {
  const value = fact?.value;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (key === "price" || key === "previous_close" || key === "change") return fmtMarketMoney(value, currency);
    if (key === "market_cap" || key === "total_assets") return fmtMarketMoney(value, currency);
    if (key === "change_pct" || key === "dividend_yield" || key === "expense_ratio") return `${value.toFixed(2)}%`;
    if (key === "trailing_pe" || key === "forward_pe") return `${value.toFixed(1)}x`;
    if (key === "beta") return value.toFixed(2);
    return value.toLocaleString();
  }
  if (typeof value === "string" && value.trim()) return value;
  return "—";
}

function etfBreakdownLabel(row: { key?: string; n?: string; country?: string; code?: string }): string {
  return row.key ?? row.n ?? row.country ?? row.code ?? "—";
}

function etfBreakdownWeight(row: { value?: number; w?: number; weight?: number }): number | null {
  if (isFiniteNumber(row.value)) return row.value;
  if (isFiniteNumber(row.w)) return row.w;
  if (isFiniteNumber(row.weight)) return row.weight;
  return null;
}

function EtfBreakdownStrip({
  title,
  rows,
  limit,
}: {
  title: string;
  rows?: Array<{ key?: string; n?: string; country?: string; code?: string; value?: number; w?: number; weight?: number }>;
  limit: number;
}) {
  const items = (rows ?? []).slice(0, limit);
  if (items.length === 0) return null;
  return (
    <div className="min-w-0 rounded-xl border border-[var(--c-line)] bg-[var(--c-surface-2)] p-2.5">
      <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-4)]">{title}</p>
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {items.map((row, index) => {
          const weight = etfBreakdownWeight(row);
          return (
            <span key={`${title}-${index}-${etfBreakdownLabel(row)}`} className="max-w-full rounded-full bg-[var(--c-panel)] px-2 py-0.5 text-[10px] font-bold text-[var(--c-ink-3)] ring-1 ring-[var(--c-line)]">
              <span className="inline-block max-w-[9rem] truncate align-bottom">{etfBreakdownLabel(row)}</span>
              {weight !== null ? <span className="orbitron ml-1 font-black tabular-nums text-[var(--c-ink)]">{weight.toFixed(1)}%</span> : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function MarketFactCard({ label, field, fact, currency }: { label: string; field: string; fact?: MarketFact; currency?: string }) {
  if (!fact) return null;
  const candidateCount = fact.candidate_count ?? fact.candidates?.length ?? 1;
  return (
    <div className="min-w-0 rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)] px-3 py-2.5">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <p className="min-w-0 truncate text-[10px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">{label}</p>
        <span className="shrink-0 rounded-full bg-[var(--c-surface-2)] px-1.5 py-0.5 text-[9px] font-black text-[var(--c-ink-3)]">
          기준 {candidateCount}곳 확인
        </span>
      </div>
      <p className="orbitron mt-1 min-w-0 break-words text-base font-black tabular-nums text-[var(--c-ink)]">
        {formatMarketFact(field, fact, currency)}
      </p>
      <p className="mt-1 min-w-0 truncate text-[10px] font-bold text-[var(--c-ink-4)]" title={sourceLabel(fact.source)}>
        {sourceLabel(fact.source)}
      </p>
    </div>
  );
}

export function MarketFactsDepth({ ticker, compact = false }: { ticker: string; compact?: boolean }) {
  const { data, loading } = useMarketFacts(ticker);
  if (loading) {
    return (
      <div className="mt-4 rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)]/95 p-3 text-sm font-semibold text-[var(--c-ink-3)]">
        통합 데이터 확인 중…
      </div>
    );
  }
  if (!data) return null;

  const facts = data.facts ?? {};
  const currency = data.identity?.currency ?? "USD";
  const primaryFields = data.asset_type === "etf"
    ? [
        ["가격", "price"],
        ["등락률", "change_pct"],
        ["순자산", "total_assets"],
        ["비용률", "expense_ratio"],
        ["베타", "beta"],
        ["배당률", "dividend_yield"],
      ]
    : [
        ["가격", "price"],
        ["등락률", "change_pct"],
        ["시가총액", "market_cap"],
        ["PER", "trailing_pe"],
        ["예상 PER", "forward_pe"],
        ["배당률", "dividend_yield"],
      ];
  const availableSources = Object.entries(data.sources ?? {})
    .filter(([, available]) => available)
    .map(([source]) => source);
  const topHoldings = (data.etf?.top_holdings ?? []).slice(0, compact ? 5 : 10);
  const breakdownLimit = compact ? 4 : 8;

  return (
    <div className="mt-4 rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)]/95 p-3">
      <div className="mb-3 flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-[12px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">통합 데이터</h4>
          <p className="mt-0.5 min-w-0 truncate text-[11px] font-bold text-[var(--c-ink-4)]">
            {data.identity?.name ?? data.ticker ?? ticker} · {data.asset_type === "etf" ? "ETF" : "주식"}
          </p>
        </div>
        <span className="min-w-0 truncate text-[11px] font-bold text-[var(--c-ink-4)]">
          {data.generated_at?.slice(0, 10) ?? "—"}
        </span>
      </div>
      <div className="grid min-w-0 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {primaryFields.map(([label, field]) => (
          <MarketFactCard key={field} label={label} field={field} fact={facts[field]} currency={currency} />
        ))}
      </div>

      {data.asset_type === "etf" ? (
        <div className="mt-3 grid min-w-0 gap-2 md:grid-cols-3">
          <EtfBreakdownStrip title="자산 배분" rows={data.etf?.asset_allocation} limit={breakdownLimit} />
          <EtfBreakdownStrip title="섹터 비중" rows={data.etf?.sectors} limit={breakdownLimit} />
          <EtfBreakdownStrip title="국가 비중" rows={data.etf?.countries} limit={breakdownLimit} />
        </div>
      ) : null}

      {topHoldings.length > 0 ? (
        <div className="mt-3 min-w-0">
          <div className="mb-1.5 flex min-w-0 flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">ETF 상위 보유 종목</p>
            <span className="text-[10px] font-bold text-[var(--c-ink-4)]">
              {data.etf?.holdings_updated ?? "—"} · {data.etf?.holdings_count ?? topHoldings.length}개
            </span>
          </div>
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[360px] text-[11px]">
              <thead>
                <tr className="border-b border-[var(--c-line)] font-black uppercase tracking-[0.06em] text-[var(--c-ink-4)]">
                  <th className="px-2 py-1.5 text-left">보유 항목</th>
                  <th className="px-2 py-1.5 text-right">비중</th>
                  <th className="px-2 py-1.5 text-right">수량</th>
                </tr>
              </thead>
              <tbody>
                {topHoldings.map((row, index) => (
                  <tr key={`${row.rank ?? index}-${row.name ?? "holding"}`} className="border-b border-[var(--c-line-2)] last:border-b-0">
                    <td className="px-2 py-1.5 font-bold text-[var(--c-ink-2)]">
                      <span className="block max-w-[14rem] truncate">{row.name ?? "—"}</span>
                      {row.symbol ? <span className="orbitron text-[10px] font-black text-[var(--c-ink-4)]">{row.symbol}</span> : null}
                    </td>
                    <td className="px-2 py-1.5 text-right orbitron font-black tabular-nums text-[var(--c-ink)]">
                      {isFiniteNumber(row.weight_pct) ? `${row.weight_pct.toFixed(2)}%` : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right font-bold tabular-nums text-[var(--c-ink-3)]">
                      {isFiniteNumber(row.shares) ? row.shares.toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {availableSources.map((source) => (
          <span key={source} className="rounded-full border border-[var(--c-line)] bg-[var(--c-surface-2)] px-2 py-0.5 text-[10px] font-black text-[var(--c-ink-3)]">
            {sourceLabel(source)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Sparkline({
  data,
  color,
  years = [],
  estimate,
  estimates,
  formatValue = (value) => value.toFixed(1),
}: {
  data: NumberSeries;
  color: string;
  years?: string[];
  estimate?: MaybeNumber;
  estimates?: EstimateSeries;
  formatValue?: (value: number) => string;
}) {
  const { labels, points } = buildFiscalPoints(years, data, estimates ?? estimate);
  const actualPoints = points.filter((point) => !point.estimate);
  const estimatePoints = points.filter((point) => point.estimate);
  const firstEstimatePoint = estimatePoints[0] ?? null;
  if (points.length < 2 || labels.length < 2) return <span className="text-xs text-[var(--c-ink-4)]">—</span>;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = CHART_WIDTH;
  const height = 96;
  const padL = CHART_PAD_L;
  const padR = CHART_PAD_R;
  const padT = 10;
  const padB = 22;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const xDenominator = Math.max(labels.length - 1, 1);
  const toX = (index: number) => padL + (index / xDenominator) * plotW;
  const toY = (value: number) => padT + plotH - ((value - min) / range) * plotH;

  const actualLine = actualPoints.map((point) => `${toX(point.index)},${toY(point.value)}`).join(" ");
  const currentPoint = actualPoints[actualPoints.length - 1] ?? null;
  const labelPoints = [currentPoint, estimatePoints[estimatePoints.length - 1] ?? firstEstimatePoint].filter(Boolean) as FiscalPoint[];
  const valueLabelPlacement = (point: FiscalPoint) => {
    const x = toX(point.index);
    const y = toY(point.value);
    const nearRight = x > width - padR - 12;
    const nearTop = y < padT + 14;
    return {
      x: nearRight ? x - 6 : x + 6,
      y: nearTop ? y + 14 : y - 10,
      anchor: nearRight ? "end" : "start",
    } as const;
  };

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="block w-full max-w-full overflow-visible" role="img" aria-label="FY별 추이 차트">
      <polyline points={actualLine} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {firstEstimatePoint && currentPoint ? (
        <line
          x1={toX(currentPoint.index)}
          y1={toY(currentPoint.value)}
          x2={toX(firstEstimatePoint.index)}
          y2={toY(firstEstimatePoint.value)}
          stroke={color}
          strokeWidth={2}
          strokeDasharray="4,2"
        />
      ) : null}
      {estimatePoints.length > 1 ? (
        <polyline
          points={estimatePoints.map((point) => `${toX(point.index)},${toY(point.value)}`).join(" ")}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeDasharray="4,2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {points.map((point) => {
        const x = toX(point.index);
        const y = toY(point.value);
        return (
          <circle
            key={`${point.label}-${point.index}`}
            cx={x}
            cy={y}
            r={point.estimate ? 3.5 : 3}
            fill={point.estimate ? "white" : color}
            stroke={color}
            strokeWidth={point.estimate ? 2 : 1}
          >
            <title>{`${point.label} ${formatValue(point.value)}`}</title>
          </circle>
        );
      })}
      {labelPoints.map((point) => {
        const placement = valueLabelPlacement(point);
        return (
          <text
            key={`label-${point.label}`}
            x={placement.x}
            y={placement.y}
            textAnchor={placement.anchor}
            className="text-[8px] font-black fill-slate-500"
            paintOrder="stroke"
            stroke="white"
            strokeWidth={3}
            strokeLinejoin="round"
          >
            {formatValue(point.value)}
          </text>
        );
      })}
      {labels.map((label, index) => (
        <text key={label} x={toX(index)} y={height - 3} textAnchor="middle" className="text-[8px] font-black fill-slate-400">
          {label}
        </text>
      ))}
    </svg>
  );
}

export function PerBandChart({
  years,
  per,
  perBands,
  estimates,
}: {
  years: string[];
  per: NumberSeries;
  perBands?: DetailData["per_bands"];
  estimates?: EstimateSeries;
}) {
  const { labels: periodLabels, points: allPerPoints } = buildFiscalPoints(years, per, estimates);
  const perPoints = allPerPoints.filter((point) => !point.estimate);
  const forwardPoints = allPerPoints.filter((point) => point.estimate);
  const forwardPoint = forwardPoints[0] ?? null;
  if (perPoints.length < 2) return <span className="text-xs text-[var(--c-ink-4)]">—</span>;

  const allValues = allPerPoints.map((point) => point.value);

  const bands = validPerBands(perBands) ? perBands : null;
  let yMin = Math.min(...allValues);
  let yMax = Math.max(...allValues);
  if (bands) {
    yMin = Math.min(yMin, bands.min_8y);
    yMax = Math.max(yMax, bands.max_8y);
  }
  const yPad = (yMax - yMin) * 0.1 || 1;
  yMin -= yPad;
  yMax += yPad;

  const w = CHART_WIDTH;
  const h = 132;
  const padL = CHART_PAD_L;
  const padR = CHART_PAD_R;
  const padT = 12;
  const padB = 30;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const xDenominator = Math.max(periodLabels.length - 1, 1);

  const toX = (i: number) => padL + (i / xDenominator) * plotW;
  const toY = (v: number) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const points = perPoints.map(({ value, index }) => `${toX(index)},${toY(value)}`).join(" ");

  const currentPoint = perPoints[perPoints.length - 1];
  const currentX = toX(currentPoint.index);
  const currentY = toY(currentPoint.value);
  const currentPct = bands ? bandPct(bands.current, bands.min_8y, bands.max_8y) : 0.5;
  const currentCls = bandClass(currentPct);
  const currentColor =
    currentCls === "emerald" ? "var(--c-up)" : currentCls === "rose" ? "var(--c-down)" : "var(--c-ink-3)";

  const hasForward = Boolean(forwardPoint);
  const forwardX = forwardPoint ? toX(forwardPoint.index) : 0;
  const forwardY = forwardPoint ? toY(forwardPoint.value) : 0;
  const valueLabelPoints = [
    currentPoint,
    forwardPoints[forwardPoints.length - 1] ?? forwardPoint,
  ].filter(Boolean) as FiscalPoint[];
  const perValueLabelPlacement = (point: FiscalPoint) => {
    const x = toX(point.index);
    const y = toY(point.value);
    const nearRight = x > w - padR - 12;
    const nearTop = y < padT + 14;
    return {
      x: nearRight ? x - 6 : x,
      y: nearTop ? y + 14 : y - 10,
      anchor: nearRight ? "end" : "middle",
    } as const;
  };

  return (
    <div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} className="block w-full max-w-full overflow-visible" role="img" aria-label="FY별 PER 밴드 차트">
        {/* Shaded band */}
        {bands && (
          <>
            <rect
              x={padL}
              y={toY(bands.max_8y)}
              width={plotW}
              height={toY(bands.min_8y) - toY(bands.max_8y)}
              fill="var(--c-surface-2)"
            />
            <rect
              x={padL}
              y={toY(bands.max_8y)}
              width={plotW}
              height={toY(bands.avg_8y) - toY(bands.max_8y)}
              fill="var(--c-down-soft)"
            />
            <rect
              x={padL}
              y={toY(bands.avg_8y)}
              width={plotW}
              height={toY(bands.min_8y) - toY(bands.avg_8y)}
              fill="var(--c-up-soft)"
            />
          </>
        )}

        {/* Avg dashed line + label */}
        {bands && (
          <>
            <line
              x1={padL}
              y1={toY(bands.avg_8y)}
              x2={padL + plotW}
              y2={toY(bands.avg_8y)}
              stroke="var(--c-ink-3)"
              strokeWidth={1}
              strokeDasharray="4,2"
            />
            <text
              x={padL + 4}
              y={Math.max(9, toY(bands.avg_8y) - 5)}
              textAnchor="start"
              className="text-[8px] font-black fill-slate-500"
              paintOrder="stroke"
              stroke="white"
              strokeWidth={3}
              strokeLinejoin="round"
            >
              avg
            </text>
          </>
        )}

        {/* Grid lines */}
        {[0, 0.5, 1].map((t) => {
          const y = padT + t * plotH;
          return (
            <line
              key={t}
              x1={padL}
              y1={y}
              x2={padL + plotW}
              y2={y}
              stroke="var(--c-line)"
              strokeWidth={1}
              strokeDasharray={t === 0.5 ? undefined : "2,2"}
            />
          );
        })}

        {/* PER line */}
        <polyline
          points={points}
          fill="none"
          stroke="#1B73D3"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Forward extension */}
        {hasForward && (
          <>
            <line
              x1={currentX}
              y1={currentY}
              x2={forwardX}
              y2={forwardY}
              stroke="#1B73D3"
              strokeWidth={2}
              strokeDasharray="4,2"
            />
            {forwardPoints.length > 1 ? (
              <polyline
                points={forwardPoints.map((point) => `${toX(point.index)},${toY(point.value)}`).join(" ")}
                fill="none"
                stroke="#1B73D3"
                strokeWidth={2}
                strokeDasharray="4,2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
          </>
        )}

        {/* Data points */}
        {allPerPoints.map((point) => {
          const x = toX(point.index);
          const y = toY(point.value);
          const isCurrent = !point.estimate && point.index === currentPoint.index;
          return (
            <g key={`${point.label}-${point.index}`}>
              <circle
                cx={x}
                cy={y}
                r={isCurrent ? 5 : point.estimate ? 3.5 : 3}
                fill={point.estimate ? "white" : isCurrent ? currentColor : "#1B73D3"}
                stroke={point.estimate ? "#1B73D3" : "white"}
                strokeWidth={2}
              >
                <title>{`${point.label} PER ${point.value.toFixed(1)}x`}</title>
              </circle>
            </g>
          );
        })}
        {valueLabelPoints.map((point) => {
          const placement = perValueLabelPlacement(point);
          return (
            <text
              key={`per-label-${point.label}`}
              x={placement.x}
              y={placement.y}
              textAnchor={placement.anchor}
              className="text-[9px] font-black fill-slate-600"
              paintOrder="stroke"
              stroke="white"
              strokeWidth={3}
              strokeLinejoin="round"
            >
              {point.value.toFixed(1)}
            </text>
          );
        })}

        {/* X-axis labels */}
        {periodLabels.map((label, index) => (
          <text key={label} x={toX(index)} y={h - 8} textAnchor="middle" className="text-[9px] font-black fill-slate-400">
            {label}
          </text>
        ))}

        {/* Y-axis labels */}
        {bands && (
          <>
            <text
              x={padL - 4}
              y={toY(bands.max_8y) + 3}
              textAnchor="end"
              className="text-[8px] font-black fill-slate-400 orbitron tabular-nums"
            >
              {bands.max_8y.toFixed(0)}
            </text>
            <text
              x={padL - 4}
              y={toY(bands.avg_8y) + 3}
              textAnchor="end"
              className="text-[8px] font-black fill-slate-500 orbitron tabular-nums"
            >
              {bands.avg_8y.toFixed(1)}
            </text>
            <text
              x={padL - 4}
              y={toY(bands.min_8y) + 3}
              textAnchor="end"
              className="text-[8px] font-black fill-slate-400 orbitron tabular-nums"
            >
              {bands.min_8y.toFixed(0)}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}

export function fmtLarge(n: MaybeNumber): string {
  if (!isFiniteNumber(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}T`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)}B`;
  return `${sign}${abs}M`;
}

export function RevisionPulse({ detail, compact = false }: { detail: DetailData; compact?: boolean }) {
  const weekly = detail.eps_consensus?.weekly;
  const changes = detail.eps_consensus?.weekly_change;
  const epsRows = [
    { key: "fy1", label: "FY+1 EPS", series: weekly?.fy_plus_1 ?? [], change: changes?.fy_plus_1 },
    { key: "fy2", label: "FY+2 EPS", series: weekly?.fy_plus_2 ?? [], change: changes?.fy_plus_2 },
    { key: "fy3", label: "FY+3 EPS", series: weekly?.fy_plus_3 ?? [], change: changes?.fy_plus_3 },
  ].filter((row) => row.series.length > 0);
  const historyRows = (detail.weekly_revision_history?.weekly_consensus_revision ?? [])
    .filter((row) => typeof row.date === "string")
    .slice(0, compact ? 2 : 4);

  if (epsRows.length === 0 && historyRows.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)]/95 p-3">
      <div className="mb-2 flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">추정치 변화·시장 예상</h4>
        <span className="text-[10px] font-bold text-[var(--c-ink-4)]">EPS 주간 예상</span>
      </div>
      {epsRows.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-3">
          {epsRows.map((row) => {
            const latest = row.series[0];
            const previous = row.series[1];
            return (
              <div key={row.key} className="min-w-0 rounded-lg border border-[var(--c-line-2)] bg-[var(--c-surface-2)] px-3 py-2">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[10px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">{row.label}</span>
                  <span className={`shrink-0 text-[10px] font-black tabular-nums ${toneText(row.change)}`}>
                    {fmtSignedFractionPercent(row.change)}
                  </span>
                </div>
                <p className="orbitron mt-1 text-sm font-black tabular-nums text-[var(--c-ink)]">{fmtEps(latest?.value)}</p>
                <p className="mt-1 truncate text-[9px] font-bold tabular-nums text-[var(--c-ink-4)]">
                  {latest?.date ?? "—"} · 전주 {fmtEps(previous?.value)}
                </p>
              </div>
            );
          })}
        </div>
      ) : null}
      {historyRows.length > 0 ? (
        <div className="-mx-1 mt-3 overflow-x-auto px-1">
          <table className="w-full min-w-[520px] text-[10px]">
            <thead>
              <tr className="border-b border-[var(--c-line)] font-black uppercase tracking-[0.06em] text-[var(--c-ink-4)]">
                <th className="px-2 py-1 text-left">일자</th>
                <th className="px-2 py-1 text-right">가격</th>
                <th className="px-2 py-1 text-right">매출 컨센</th>
                <th className="px-2 py-1 text-right">EPS 컨센</th>
                <th className="px-2 py-1 text-right">EPS 변화</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.map((row, index) => (
                <tr key={`${row.date}-${index}`} className="border-b border-[var(--c-line-2)] last:border-b-0">
                  <td className="px-2 py-1.5 font-bold tabular-nums text-[var(--c-ink-2)]">{row.date}</td>
                  <td className="px-2 py-1.5 text-right orbitron tabular-nums text-[var(--c-ink-2)]">{fmtPlainNumber(row.price, 2)}</td>
                  <td className="px-2 py-1.5 text-right orbitron tabular-nums text-[var(--c-ink-2)]">{fmtLarge(row.revenue_consensus)}</td>
                  <td className="px-2 py-1.5 text-right orbitron tabular-nums text-[var(--c-ink-2)]">{fmtEps(row.eps_consensus)}</td>
                  <td className={`px-2 py-1.5 text-right orbitron font-black tabular-nums ${toneText(row.eps_change)}`}>
                    {fmtSignedNumber(row.eps_change, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function RawFinancialDepth({ detail, compact = false }: { detail: DetailData; compact?: boolean }) {
  const raw = detail.raw_financials;
  const periods = raw?.periods ?? detail.raw_periods ?? [];
  const rows: Array<{ label: string; data?: NumberSeries; fmt: (value: MaybeNumber) => string }> = [
    { label: "매출", data: raw?.income_statement?.revenue, fmt: fmtLarge },
    { label: "영업이익", data: raw?.income_statement?.operating_income, fmt: fmtLarge },
    { label: "순이익", data: raw?.income_statement?.net_income, fmt: fmtLarge },
    { label: "EPS", data: raw?.per_share?.eps, fmt: fmtEps },
    { label: "매출 성장", data: raw?.growth?.revenue_growth, fmt: fmtSignedPercentPoints },
    { label: "PER", data: raw?.valuation?.per, fmt: (value) => fmtPlainNumber(value, 1) },
    { label: "PBR", data: raw?.valuation?.pbr, fmt: (value) => fmtPlainNumber(value, 2) },
    { label: "ROE", data: raw?.profitability?.roe, fmt: fmtSignedPercentPoints },
    { label: "영업마진", data: raw?.profitability?.operating_margin, fmt: fmtSignedPercentPoints },
  ];
  const validRows = rows
    .filter((row) => finiteValues(row.data).length > 0)
    .slice(0, compact ? 6 : rows.length);

  if (periods.length === 0 || validRows.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)]/95 p-3">
      <div className="mb-2 flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">실적·예상치 상세</h4>
        <span className="text-[10px] font-bold text-[var(--c-ink-4)]">FY-4 ~ FY+3 표준화 데이터</span>
      </div>
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[720px] text-[10px]">
          <thead>
            <tr className="border-b border-[var(--c-line)] font-black uppercase tracking-[0.06em] text-[var(--c-ink-4)]">
              <th className="px-2 py-1.5 text-left">항목</th>
              {periods.map((period) => (
                <th key={period} className="px-2 py-1.5 text-right">{period}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {validRows.map((row) => (
              <tr key={row.label} className="border-b border-[var(--c-line-2)] last:border-b-0">
                <td className="px-2 py-1.5 font-black text-[var(--c-ink-2)]">{row.label}</td>
                {periods.map((period, index) => {
                  const value = row.data?.[index];
                  return (
                    <td key={`${row.label}-${period}`} className="px-2 py-1.5 text-right orbitron tabular-nums text-[var(--c-ink)]">
                      {row.fmt(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function hasSlickMetricValue(point: SlickMetricPoint | null | undefined) {
  return Boolean(
    point &&
      (isFiniteNumber(point.price) ||
        isFiniteNumber(point.pe_trailing) ||
        isFiniteNumber(point.pe_forward) ||
        isFiniteNumber(point.eps_forward) ||
        isFiniteNumber(point.dividend_yield) ||
        isFiniteNumber(point.market_cap_billions)),
  );
}

function slickMetricRows(data: SlickStockData): SlickMetricPoint[] {
  const rows = [data.current, ...(data.metrics_history ?? [])].filter(hasSlickMetricValue) as SlickMetricPoint[];
  const seen = new Set<string>();
  return rows.filter((row, index) => {
    const key = row.date ?? `row-${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fmtSlickMoney(value: MaybeNumber, digits = 2) {
  return isFiniteNumber(value) ? `$${value.toFixed(digits)}` : "—";
}

function fmtSlickMarketCap(value: MaybeNumber) {
  if (!isFiniteNumber(value)) return "—";
  return value >= 1_000 ? `$${(value / 1_000).toFixed(2)}T` : `$${value.toFixed(1)}B`;
}

function fmtSlickMultiple(value: MaybeNumber) {
  return isFiniteNumber(value) ? `${value.toFixed(1)}x` : "—";
}

function fmtSlickYield(value: MaybeNumber) {
  return isFiniteNumber(value) ? `${value.toFixed(2)}%` : "—";
}

function fmtSlickReturn(value: MaybeNumber) {
  if (!isFiniteNumber(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function fmtRelativeDelta(current: MaybeNumber, previous: MaybeNumber) {
  if (!isFiniteNumber(current) || !isFiniteNumber(previous) || previous === 0) return null;
  const delta = ((current - previous) / Math.abs(previous)) * 100;
  return fmtSlickReturn(delta);
}

function SlickMetricCard({ label, value, delta }: { label: string; value: string; delta?: string | null }) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--c-line-2)] bg-[var(--c-surface-2)] px-3 py-2">
      <p className="min-w-0 truncate text-[11px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">{label}</p>
      <p className="orbitron mt-1 min-w-0 break-words text-base font-black tabular-nums text-[var(--c-ink)]">{value}</p>
      <p className="mt-1 min-h-[16px] text-[11px] font-bold tabular-nums text-[var(--c-ink-4)]">{delta ? `직전 ${delta}` : ""}</p>
    </div>
  );
}

export function PriceDividendHistoryDepth({
  ticker,
  compact = false,
  showUnavailable = false,
}: {
  ticker: string;
  compact?: boolean;
  showUnavailable?: boolean;
}) {
  const { data, loading } = useSlickStock(ticker);

  if (loading) {
    return (
      <div role="status" aria-busy="true" className="mt-4 rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)] p-3 text-sm font-semibold text-[var(--c-ink-3)]">
        가격·배당 히스토리 확인 중…
      </div>
    );
  }

  if (!data) {
    return showUnavailable ? (
      <div className="mt-4 rounded-xl border border-dashed border-[var(--c-line)] bg-[var(--c-surface-2)] p-3 text-sm font-semibold text-[var(--c-ink-3)]">
        가격·배당 히스토리가 아직 수집되지 않은 티커입니다.
      </div>
    ) : null;
  }

  const metrics = slickMetricRows(data);
  const latestMetric = metrics[0] ?? null;
  const previousMetric = metrics[1] ?? null;
  const returnRows = [...(data.returns ?? [])]
    .filter((row) => isFiniteNumber(row.year) && isFiniteNumber(row.return))
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    .slice(0, compact ? 5 : 8);
  const dividendRows = [...(data.dividends ?? [])]
    .filter((row) => isFiniteNumber(row.amount) || row.exDate || row.payDate)
    .sort((a, b) => (b.exDate ?? "").localeCompare(a.exDate ?? ""))
    .slice(0, compact ? 3 : 5);
  const metricCards = latestMetric
    ? [
        {
          label: "가격",
          value: fmtSlickMoney(latestMetric.price),
          delta: fmtRelativeDelta(latestMetric.price, previousMetric?.price),
        },
        {
          label: "시총",
          value: fmtSlickMarketCap(latestMetric.market_cap_billions),
          delta: fmtRelativeDelta(latestMetric.market_cap_billions, previousMetric?.market_cap_billions),
        },
        {
          label: "PER TTM",
          value: fmtSlickMultiple(latestMetric.pe_trailing),
          delta: fmtRelativeDelta(latestMetric.pe_trailing, previousMetric?.pe_trailing),
        },
        {
          label: "PER FWD",
          value: fmtSlickMultiple(latestMetric.pe_forward),
          delta: fmtRelativeDelta(latestMetric.pe_forward, previousMetric?.pe_forward),
        },
        {
          label: "EPS FWD",
          value: fmtSlickMoney(latestMetric.eps_forward),
          delta: fmtRelativeDelta(latestMetric.eps_forward, previousMetric?.eps_forward),
        },
        {
          label: "배당률",
          value: fmtSlickYield(latestMetric.dividend_yield),
          delta: previousMetric && isFiniteNumber(latestMetric.dividend_yield) && isFiniteNumber(previousMetric.dividend_yield)
            ? `${(latestMetric.dividend_yield - previousMetric.dividend_yield >= 0 ? "+" : "")}${(latestMetric.dividend_yield - previousMetric.dividend_yield).toFixed(2)}%p`
            : null,
        },
      ]
    : [];

  if (metricCards.length === 0 && returnRows.length === 0 && dividendRows.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)]/95 p-3">
      <div className="mb-3 flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[12px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">가격·배당 히스토리</h4>
        <span className="min-w-0 truncate text-[11px] font-bold text-[var(--c-ink-4)]">
          {latestMetric?.date ?? data.updated?.slice(0, 10) ?? "—"} · 수집 데이터 기준
        </span>
      </div>

      {metricCards.length > 0 ? (
        <div className="grid min-w-0 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {metricCards.map((card) => (
            <SlickMetricCard key={card.label} {...card} />
          ))}
        </div>
      ) : null}

      <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-2">
        {returnRows.length > 0 ? (
          <div className="min-w-0">
            <p className="mb-1.5 text-[11px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">연도별 수익률</p>
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[240px] text-[11px]">
                <thead>
                  <tr className="border-b border-[var(--c-line)] font-black uppercase tracking-[0.06em] text-[var(--c-ink-4)]">
                    <th className="px-2 py-1.5 text-left">연도</th>
                    <th className="px-2 py-1.5 text-right">수익률</th>
                  </tr>
                </thead>
                <tbody>
                  {returnRows.map((row) => (
                    <tr key={row.year} className="border-b border-[var(--c-line-2)] last:border-b-0">
                      <td className="px-2 py-1.5 font-bold tabular-nums text-[var(--c-ink-2)]">{row.year}</td>
                      <td className={`px-2 py-1.5 text-right orbitron font-black tabular-nums ${toneText(row.return)}`}>
                        {fmtSlickReturn(row.return)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {dividendRows.length > 0 ? (
          <div className="min-w-0">
            <p className="mb-1.5 text-[11px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">배당 이력</p>
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[320px] text-[11px]">
                <thead>
                  <tr className="border-b border-[var(--c-line)] font-black uppercase tracking-[0.06em] text-[var(--c-ink-4)]">
                    <th className="px-2 py-1.5 text-left">락일</th>
                    <th className="px-2 py-1.5 text-right">배당</th>
                    <th className="px-2 py-1.5 text-right">지급일</th>
                  </tr>
                </thead>
                <tbody>
                  {dividendRows.map((row, index) => (
                    <tr key={`${row.exDate ?? "ex"}-${index}`} className="border-b border-[var(--c-line-2)] last:border-b-0">
                      <td className="px-2 py-1.5 font-bold tabular-nums text-[var(--c-ink-2)]">{row.exDate ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right orbitron font-black tabular-nums text-[var(--c-ink)]">
                        {fmtSlickMoney(row.amount, 3)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-bold tabular-nums text-[var(--c-ink-3)]">{row.payDate ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function StockDetailBody({
  detail,
  f13Entries,
  ticker,
  stock,
}: {
  detail: DetailData;
  f13Entries: F13Entry[] | null;
  ticker?: string;
  stock?: ScreenerStock;
}) {
  const revenue = detail.income_statement?.revenue ?? [];
  const eps = detail.per_share?.eps ?? [];
  const per = detail.valuation?.per ?? [];
  const hasRevenue = finiteValues(revenue).length >= 2;
  const hasEps = finiteValues(eps).length >= 2;
  const hasPer = finiteValues(per).length >= 2;
  const latestRevenue = lastFinite(revenue);
  const latestEps = lastFinite(eps);

  const interpretation = stock ? interpretStockMetrics(stock) : null;

  return (
    <>
      {interpretation ? (
        <div className="mb-4 rounded-2xl border border-[var(--c-line)] bg-[var(--c-panel)] p-3.5 shadow-[0_1px_3px_0_rgba(0,0,0,0.05)]">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <span className="text-[11px] font-black uppercase tracking-[0.15em] text-[var(--c-ink-4)]">
              Feno 자동 해석
            </span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black leading-none ${interpretation.badgeClass}`}>
              {interpretation.badge}
            </span>
          </div>
          <p className="text-xs font-semibold leading-relaxed text-[var(--c-ink-2)]">
            {interpretation.text}
          </p>
        </div>
      ) : null}
      {ticker ? <MarketFactsDepth ticker={ticker} compact /> : null}
      <div className="grid gap-5 sm:grid-cols-3">
        {/* PER Band Chart */}
        <div>
          <h4 className="mb-2 text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">
            PER 밴드
          </h4>
          {hasPer ? (
            <PerBandChart
              years={detail.years}
              per={per}
              perBands={detail.per_bands}
              estimates={detail.valuation_estimates?.per}
            />
          ) : (
            <span className="text-xs text-[var(--c-ink-4)]">—</span>
          )}
        </div>

        {/* Revenue Sparkline */}
        <div>
          <h4 className="mb-2 text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">
            매출 추이
          </h4>
          {hasRevenue ? (
            <>
              <Sparkline
                data={revenue}
                color="var(--c-up)"
                years={detail.years}
                estimates={detail.income_statement_estimates?.revenue}
                formatValue={fmtLarge}
              />
              <div className="mt-1 text-[10px] font-bold text-[var(--c-ink-4)]">
                {fmtLarge(latestRevenue)}
                {" (최신)"}
              </div>
            </>
          ) : (
            <span className="text-xs text-[var(--c-ink-4)]">—</span>
          )}
        </div>

        {/* EPS Sparkline */}
        <div>
          <h4 className="mb-2 text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">
            EPS 추이
          </h4>
          {hasEps ? (
            <>
              <Sparkline
                data={eps}
                color="#8b5cf6"
                years={detail.years}
                estimates={detail.per_share_estimates?.eps}
                formatValue={(value) => `$${value.toFixed(2)}`}
              />
              <div className="mt-1 text-[10px] font-bold text-[var(--c-ink-4)]">
                {latestEps != null ? `$${latestEps.toFixed(2)} (최신)` : "—"}
              </div>
            </>
          ) : (
            <span className="text-xs text-[var(--c-ink-4)]">—</span>
          )}
        </div>
      </div>

      {ticker ? <PriceDividendHistoryDepth ticker={ticker} compact /> : null}
      <RevisionPulse detail={detail} compact />
      <RawFinancialDepth detail={detail} compact />

      {/* 13F Badges */}
      {f13Entries && f13Entries.length > 0 ? (
        <div className="mt-4">
          <h4 className="mb-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">
            기관 공시 보유
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {f13Entries.map((e) => (
              <span
                key={e.investor}
                className="inline-flex items-center rounded-full bg-[var(--c-warn-soft)] px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-[var(--c-warn)]"
              >
                {e.investor}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

export default function StockDetailPanel({ ticker, stock }: { ticker: string; stock?: ScreenerStock }) {
  const { detail, loading } = useStockDetail(ticker);
  const f13Entries = use13FData(ticker);

  if (loading) {
    return (
      <div role="status" aria-busy="true" className="col-span-full border-t border-[var(--c-line-2)] bg-[var(--c-surface-2)] px-4 py-6 text-sm text-[var(--c-ink-3)]">
        상세 데이터 로딩 중…
      </div>
    );
  }

  if (!detail) {
    return (
      <div role="alert" className="col-span-full border-t border-[var(--c-line-2)] bg-[var(--c-surface-2)] px-4 py-6 text-sm text-[var(--c-ink-3)]">
        상세 데이터를 불러올 수 없습니다.
      </div>
    );
  }

  return (
    <div className="col-span-full border-t border-[var(--c-line-2)] bg-[var(--c-surface-2)]/50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">
          종목 상세
        </span>
        <TransitionLink
          href={`/stock/${encodeURIComponent(ticker)}`}
          className="text-[10px] font-black text-brand-interactive hover:underline"
        >
          전체 화면 →
        </TransitionLink>
      </div>
      <StockDetailBody detail={detail} f13Entries={f13Entries} ticker={ticker} stock={stock} />
    </div>
  );
}
