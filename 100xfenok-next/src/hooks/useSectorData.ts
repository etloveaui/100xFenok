"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SECTOR_DEFINITIONS } from "@/lib/dashboard/constants";
import type { QuotePayload } from "@/lib/quote-contract";
import type {
  SectorRow,
  SectorDataResult,
  SectorEtfInfo,
  SectorMomentum,
  SectorSmartMoney,
  SectorValuationBand,
  MomentumWindow,
} from "@/lib/sectors/types";

const FETCH_TIMEOUT_MS = 2500;
const TICKER_TIMEOUT_MS = 3200;
const REFRESH_MS = 10 * 60 * 1000;

const MOMENTUM_KEYS: ReadonlyArray<MomentumWindow> = ["1w", "1m", "3m", "6m", "ytd"];

interface BenchmarksMomentumPayload {
  momentum?: Record<string, Record<string, number | null> | undefined>;
  metadata?: { generated?: string; version?: string };
}
interface RawEtf {
  ticker?: string;
  category?: string;
  market_cap?: number;
  returns?: Record<string, number>;
  cagr?: Record<string, number>;
  beta?: number;
  expense_ratio?: number;
}
interface EtfsPayload {
  source_date?: string;
  generated_at?: string;
  etfs?: Record<string, RawEtf | undefined>;
}
interface UsSectorPoint {
  date?: string;
  best_pe_ratio?: number;
  px_to_book_ratio?: number;
  roe?: number;
}
interface UsSectorsPayload {
  metadata?: { generated?: string; version?: string; source?: string };
  sections?: Record<string, { data?: UsSectorPoint[] } | undefined>;
}
interface UsBenchmarksPayload {
  metadata?: { generated?: string; version?: string; source?: string };
  sections?: Record<string, { data?: UsSectorPoint[] } | undefined>;
}
interface SectorHistory {
  quarters?: string[];
  series?: Record<string, number[] | undefined>;
}
interface PortfolioViewsPayload {
  metadata?: {
    quarter?: string;
    generated_at?: string;
    cohort_count?: number;
    disclaimer?: string;
  };
  total?: { sector_history?: SectorHistory };
}
interface BySectorEntry {
  avg_weight?: number;
  top_holdings?: string[];
}
interface BySectorPayload {
  _meta?: unknown;
  [sector: string]: BySectorEntry | unknown;
}

// HTTP cache intentional: static /data/*.json has Cache-Control max-age=300;
// ticker /api/* has its own s-maxage. Mirrors useDashboardData fetch policy.
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

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sourceDate(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function latestRowDate(points: UsSectorPoint[] | undefined): string | null {
  if (!Array.isArray(points) || points.length === 0) return null;
  return points
    .map((point) => sourceDate(point.date))
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1) ?? null;
}

function completeOldestSourceDate(values: Array<string | null>): string | null {
  if (values.length === 0 || values.some((value) => value === null)) return null;
  return (values as string[]).sort().at(0) ?? null;
}

function quoteSourceDate(quote: QuotePayload | null | undefined): string | null {
  const stateAsOf = sourceDate(quote?.state?.asOf);
  if (stateAsOf) return stateAsOf;

  const raw = quote as unknown as { regularMarketTime?: unknown } | null | undefined;
  if (typeof raw?.regularMarketTime !== "number" || !Number.isFinite(raw.regularMarketTime) || raw.regularMarketTime <= 0) {
    return null;
  }
  const milliseconds = raw.regularMarketTime > 10_000_000_000
    ? raw.regularMarketTime
    : raw.regularMarketTime * 1000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function quarterEndSourceDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-Q([1-4])$/.exec(value.trim());
  if (!match) return null;
  const [, year, quarter] = match;
  const ends: Record<string, string> = {
    "1": "03-31",
    "2": "06-30",
    "3": "09-30",
    "4": "12-31",
  };
  return `${year}-${ends[quarter]}`;
}

function buildEtfInfo(raw: RawEtf | undefined): SectorEtfInfo | null {
  if (!raw) return null;
  return {
    ticker: raw.ticker ?? "",
    category: raw.category ?? null,
    marketCap: num(raw.market_cap),
    returns: raw.returns ?? {},
    cagr: raw.cagr ?? {},
    beta: num(raw.beta),
    expenseRatio: num(raw.expense_ratio),
  };
}

function buildPeBand(points: UsSectorPoint[] | undefined, latest: number | null): SectorValuationBand | null {
  if (latest === null || !Array.isArray(points)) return null;
  const values = points
    .map((point) => num(point.best_pe_ratio))
    .filter((value): value is number => value !== null && value > 0);
  if (values.length < 2) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return null;
  const belowOrEqual = sorted.filter((value) => value <= latest).length;
  return {
    min,
    max,
    percentile: Math.min(1, Math.max(0, (belowOrEqual - 1) / (sorted.length - 1))),
  };
}

function normalizeSectorName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "_");
}

const SECTOR_KEY_ALIASES: Record<string, string> = {
  technology: "information_technology",
  information_technology: "information_technology",
  healthcare: "health_care",
  health_care: "health_care",
};

function toSectorKey(value: string): string {
  const normalized = normalizeSectorName(value);
  return SECTOR_KEY_ALIASES[normalized] ?? normalized;
}

function buildSmartMoneyMap(
  portfolioViews: PortfolioViewsPayload | null,
  bySector: BySectorPayload | null,
): Record<string, SectorSmartMoney> {
  const result: Record<string, SectorSmartMoney> = {};
  const history = portfolioViews?.total?.sector_history;
  const quarters = Array.isArray(history?.quarters) ? history.quarters : [];
  const series = history?.series && typeof history.series === "object" ? history.series : {};
  const latestIndex = Math.max(0, quarters.length - 1);
  const backIndex = Math.max(0, quarters.length - 5);

  for (const [sectorLabel, values] of Object.entries(series)) {
    if (!Array.isArray(values) || values.length === 0) continue;
    const key = toSectorKey(sectorLabel);
    const latest = num(values[latestIndex]);
    const back = num(values[backIndex]);
    result[key] = {
      sectorLabel,
      weight: latest,
      delta4q: latest !== null && back !== null ? latest - back : null,
      avgHoldingWeight: null,
      topHoldings: [],
    };
  }

  if (bySector && typeof bySector === "object") {
    for (const [sectorLabel, raw] of Object.entries(bySector)) {
      if (sectorLabel === "_meta" || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const entry = raw as BySectorEntry;
      const key = toSectorKey(sectorLabel);
      const prev = result[key] ?? {
        sectorLabel,
        weight: null,
        delta4q: null,
        avgHoldingWeight: null,
        topHoldings: [],
      };
      result[key] = {
        ...prev,
        avgHoldingWeight: num(entry.avg_weight),
        topHoldings: Array.isArray(entry.top_holdings)
          ? entry.top_holdings.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 5)
          : [],
      };
    }
  }

  return result;
}

export function useSectorData(): SectorDataResult {
  const [result, setResult] = useState<SectorDataResult>({
    rows: [],
    benchmarkMomentum: null,
    dataReady: false,
    benchmarksReady: false,
    etfsReady: false,
    valuationReady: false,
    failedSources: [],
    updatedAt: null,
    sourceMeta: {
      benchmarksGenerated: null,
      valuationGenerated: null,
      valuationSource: null,
      valuationVersion: null,
      valuationLatestDate: null,
      smartMoneyQuarter: null,
      smartMoneyGeneratedAt: null,
      smartMoneyCohortCount: null,
      smartMoneyDisclaimer: null,
      etfMissing: [],
    },
  });
  const inFlightRef = useRef(false);
  const isMountedRef = useRef(true);

  const load = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const etfSymbols = SECTOR_DEFINITIONS.map((sector) => sector.etf);
      const [benchmarks, usBenchmarks, etfs, usSectors, portfolioViews, bySector, tickerSettled] = await Promise.all([
        fetchJson<BenchmarksMomentumPayload>("/data/benchmarks/summaries.json"),
        fetchJson<UsBenchmarksPayload>("/data/benchmarks/us.json"),
        fetchJson<EtfsPayload>("/data/global-scouter/etfs/index.json"),
        fetchJson<UsSectorsPayload>("/data/benchmarks/us_sectors.json"),
        fetchJson<PortfolioViewsPayload>("/data/sec-13f/analytics/portfolio_views.json"),
        fetchJson<BySectorPayload>("/data/sec-13f/by_sector.json"),
        Promise.allSettled(
          etfSymbols.map(async (symbol) => ({
            symbol,
            quote: await fetchJson<QuotePayload>(`/api/ticker/${symbol}`, TICKER_TIMEOUT_MS),
          })),
        ),
      ]);

      const tickerMap: Record<string, QuotePayload | null> = {};
      tickerSettled.forEach((settled) => {
        if (settled.status === "fulfilled") {
          tickerMap[settled.value.symbol] = settled.value.quote;
        }
      });

      const failed: string[] = [];
      if (!benchmarks?.momentum) failed.push("benchmarks");
      if (!etfs?.etfs) failed.push("etfs");
      if (!usSectors?.sections) failed.push("us_sectors");
      if (!portfolioViews?.total?.sector_history) failed.push("portfolio_views");
      if (!bySector) failed.push("by_sector");

      const benchmarksReady = Boolean(benchmarks?.momentum);
      const etfsReady = Boolean(etfs?.etfs);
      const valuationReady = Boolean(usSectors?.sections);
      const benchmarkMomentum: SectorMomentum | null = benchmarks?.momentum?.sp500
        ? Object.fromEntries(MOMENTUM_KEYS.map((key) => [key, num(benchmarks.momentum?.sp500?.[key])]))
        : null;
      const smartMoneyMap = buildSmartMoneyMap(portfolioViews, bySector);
      const valuationLatestDate = completeOldestSourceDate(
        SECTOR_DEFINITIONS.map((sector) => latestRowDate(usSectors?.sections?.[sector.key]?.data)),
      );
      const benchmarkSourceDate = completeOldestSourceDate([
        latestRowDate(usBenchmarks?.sections?.sp500?.data),
        valuationLatestDate,
      ]);
      let tickerFailed = false;

      const rows: SectorRow[] = SECTOR_DEFINITIONS.map((sector) => {
        const rawMomentum = benchmarks?.momentum?.[sector.key];
        const momentum: SectorMomentum = {};
        for (const key of MOMENTUM_KEYS) {
          momentum[key] = num(rawMomentum?.[key]);
        }
        const quote = tickerMap[sector.etf];
        if (!quote) {
          tickerFailed = true;
          failed.push(`ticker:${sector.etf}`);
        }
        const changePercent = num(quote?.changePercent);
        const marketState =
          typeof quote?.marketState === "string" && quote.marketState.trim().length > 0
            ? quote.marketState.toUpperCase()
            : null;

        const valData = usSectors?.sections?.[sector.key]?.data;
        const valLatest = Array.isArray(valData) && valData.length > 0 ? valData[valData.length - 1] : null;
        const pe = num(valLatest?.best_pe_ratio);
        const etfInfo = buildEtfInfo(etfs?.etfs?.[sector.etf]);

        return {
          key: sector.key,
          etf: sector.etf,
          name: sector.name,
          momentum,
          dayChange: changePercent === null ? null : changePercent / 100,
          price: num(quote?.price),
          marketState,
          etfInfo,
          valuation: valLatest
            ? { pe, pb: num(valLatest.px_to_book_ratio), roe: num(valLatest.roe), peBand: buildPeBand(valData, pe) }
            : null,
          smartMoney: smartMoneyMap[sector.key] ?? null,
        };
      });

      if (tickerFailed) failed.push("ticker");
      const dataReady = benchmarksReady || etfsReady || valuationReady;
      const tickerSourceFloor = completeOldestSourceDate(
        SECTOR_DEFINITIONS.map((sector) => quoteSourceDate(tickerMap[sector.etf])),
      );
      const smartMoneySourceDate = portfolioViews && bySector
        ? quarterEndSourceDate(portfolioViews.metadata?.quarter)
        : null;
      const updatedAt = completeOldestSourceDate([
        benchmarkSourceDate,
        sourceDate(etfs?.source_date),
        smartMoneySourceDate,
        tickerSourceFloor,
      ]);
      if (updatedAt === null) failed.push("source_clock");
      const sourceMeta = {
        benchmarksGenerated: benchmarks?.metadata?.generated ?? null,
        valuationGenerated: usSectors?.metadata?.generated ?? null,
        valuationSource: usSectors?.metadata?.source ?? null,
        valuationVersion: usSectors?.metadata?.version ?? null,
        valuationLatestDate,
        smartMoneyQuarter: portfolioViews?.metadata?.quarter ?? null,
        smartMoneyGeneratedAt: portfolioViews?.metadata?.generated_at ?? null,
        smartMoneyCohortCount: num(portfolioViews?.metadata?.cohort_count),
        smartMoneyDisclaimer: portfolioViews?.metadata?.disclaimer ?? null,
        etfMissing: rows.filter((row) => !row.etfInfo).map((row) => row.etf),
      };

      if (!isMountedRef.current) return;
      setResult({
        rows,
        benchmarkMomentum,
        dataReady,
        benchmarksReady,
        etfsReady,
        valuationReady,
        failedSources: failed,
        updatedAt,
        sourceMeta,
      });
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    void load();
    const refreshId = window.setInterval(() => {
      void load();
    }, REFRESH_MS);

    return () => {
      isMountedRef.current = false;
      window.clearInterval(refreshId);
    };
  }, [load]);

  return result;
}
