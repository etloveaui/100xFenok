"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SECTOR_DEFINITIONS } from "@/lib/dashboard/constants";
import type {
  SectorRow,
  SectorDataResult,
  SectorEtfInfo,
  SectorMomentum,
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
  etfs?: Record<string, RawEtf | undefined>;
}
interface TickerQuote {
  price?: number;
  changePercent?: number;
  marketState?: string;
}
interface UsSectorPoint {
  best_pe_ratio?: number;
  px_to_book_ratio?: number;
  roe?: number;
}
interface UsSectorsPayload {
  sections?: Record<string, { data?: UsSectorPoint[] } | undefined>;
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

export function useSectorData(): SectorDataResult {
  const [result, setResult] = useState<SectorDataResult>({
    rows: [],
    benchmarkMomentum: null,
    dataReady: false,
    failedSources: [],
    updatedAt: null,
  });
  const inFlightRef = useRef(false);
  const isMountedRef = useRef(true);

  const load = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const etfSymbols = SECTOR_DEFINITIONS.map((sector) => sector.etf);
      const [benchmarks, etfs, usSectors, tickerSettled] = await Promise.all([
        fetchJson<BenchmarksMomentumPayload>("/data/benchmarks/summaries.json"),
        fetchJson<EtfsPayload>("/data/global-scouter/etfs/index.json"),
        fetchJson<UsSectorsPayload>("/data/benchmarks/us_sectors.json"),
        Promise.allSettled(
          etfSymbols.map(async (symbol) => ({
            symbol,
            quote: await fetchJson<TickerQuote>(`/api/ticker/${symbol}`, TICKER_TIMEOUT_MS),
          })),
        ),
      ]);

      const tickerMap: Record<string, TickerQuote | null> = {};
      tickerSettled.forEach((settled) => {
        if (settled.status === "fulfilled") {
          tickerMap[settled.value.symbol] = settled.value.quote;
        }
      });

      const failed: string[] = [];
      if (!benchmarks?.momentum) failed.push("benchmarks");
      if (!etfs?.etfs) failed.push("etfs");
      if (!usSectors?.sections) failed.push("us_sectors");

      const benchmarkMomentum: SectorMomentum | null = benchmarks?.momentum?.sp500
        ? Object.fromEntries(MOMENTUM_KEYS.map((key) => [key, num(benchmarks.momentum?.sp500?.[key])]))
        : null;

      const rows: SectorRow[] = SECTOR_DEFINITIONS.map((sector) => {
        const rawMomentum = benchmarks?.momentum?.[sector.key];
        const momentum: SectorMomentum = {};
        for (const key of MOMENTUM_KEYS) {
          momentum[key] = num(rawMomentum?.[key]);
        }
        const quote = tickerMap[sector.etf];
        if (!quote) failed.push(`ticker:${sector.etf}`);
        const changePercent = num(quote?.changePercent);
        const marketState =
          typeof quote?.marketState === "string" && quote.marketState.trim().length > 0
            ? quote.marketState.toUpperCase()
            : null;

        const valData = usSectors?.sections?.[sector.key]?.data;
        const valLatest = Array.isArray(valData) && valData.length > 0 ? valData[valData.length - 1] : null;
        const pe = num(valLatest?.best_pe_ratio);

        return {
          key: sector.key,
          etf: sector.etf,
          name: sector.name,
          momentum,
          dayChange: changePercent === null ? null : changePercent / 100,
          price: num(quote?.price),
          marketState,
          etfInfo: buildEtfInfo(etfs?.etfs?.[sector.etf]),
          valuation: valLatest
            ? { pe, pb: num(valLatest.px_to_book_ratio), roe: num(valLatest.roe), peBand: buildPeBand(valData, pe) }
            : null,
        };
      });

      const dataReady = Boolean(benchmarks?.momentum) || Boolean(etfs?.etfs);
      const updatedAt = benchmarks?.metadata?.generated ?? null;

      if (!isMountedRef.current) return;
      setResult({ rows, benchmarkMomentum, dataReady, failedSources: failed, updatedAt });
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
