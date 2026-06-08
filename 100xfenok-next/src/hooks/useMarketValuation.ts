"use client";

import { useEffect, useRef, useState } from "react";
import type {
  MarketIndexValuation,
  MarketValuationResult,
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
  dataReady: false,
  failed: false,
  sourceDate: null,
};

export function useMarketValuation(): MarketValuationResult {
  const [result, setResult] = useState<MarketValuationResult>(EMPTY);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    void (async () => {
      const raw = await fetchJson<RawUs>("/data/benchmarks/us.json");
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

        indices.push({
          id,
          name: section?.name ?? id,
          nameEn: section?.name_en ?? id,
          price: finite(latest?.px_last) ? latest!.px_last! : null,
          date: typeof latest?.date === "string" ? latest!.date! : null,
          pe: buildBand(peSeries, finite(latest?.best_pe_ratio) ? latest!.best_pe_ratio! : null),
          pb: buildBand(pbSeries, finite(latest?.px_to_book_ratio) ? latest!.px_to_book_ratio! : null),
          roe: finite(latest?.roe) ? latest!.roe! : null,
          points: data.length,
        });
      }

      setResult({
        indices,
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
