"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SECTOR_DEFINITIONS } from "@/lib/dashboard/constants";
import type {
  SectorRow,
  SectorDataResult,
  SectorEtfInfo,
  SectorMomentum,
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

export function useSectorData(): SectorDataResult {
  const [result, setResult] = useState<SectorDataResult>({
    rows: [],
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
      const [benchmarks, etfs, tickerSettled] = await Promise.all([
        fetchJson<BenchmarksMomentumPayload>("/data/benchmarks/summaries.json"),
        fetchJson<EtfsPayload>("/data/global-scouter/etfs/index.json"),
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

        return {
          key: sector.key,
          etf: sector.etf,
          name: sector.name,
          momentum,
          dayChange: changePercent === null ? null : changePercent / 100,
          price: num(quote?.price),
          marketState,
          etfInfo: buildEtfInfo(etfs?.etfs?.[sector.etf]),
        };
      });

      const dataReady = Boolean(benchmarks?.momentum) || Boolean(etfs?.etfs);
      const updatedAt = benchmarks?.metadata?.generated ?? null;

      if (!isMountedRef.current) return;
      setResult({ rows, dataReady, failedSources: failed, updatedAt });
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
