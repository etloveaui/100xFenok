"use client";

import { useEffect, useRef, useState } from "react";
import type { ScreenerStock, ScreenerDataResult } from "@/lib/screener/types";

const FETCH_TIMEOUT_MS = 4000; // 287KB single payload

interface RawStock {
  n?: string;
  x?: string;
  s?: string;
  c?: string;
  p?: number;
  mc?: number;
  pe?: number;
  pb?: number;
  dy?: number;
  r12?: number;
}
interface RawIndex {
  source_date?: string;
  stocks?: Record<string, RawStock | undefined>;
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

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const EMPTY: ScreenerDataResult = {
  stocks: [],
  dataReady: false,
  failed: false,
  sourceDate: null,
  sectors: [],
  countries: [],
};

export function useScreenerData(): ScreenerDataResult {
  const [result, setResult] = useState<ScreenerDataResult>(EMPTY);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    void (async () => {
      const raw = await fetchJson<RawIndex>("/data/global-scouter/core/stocks_index.json");
      if (!isMountedRef.current) return;

      if (!raw?.stocks) {
        setResult({ ...EMPTY, failed: true });
        return;
      }

      const stocks: ScreenerStock[] = Object.entries(raw.stocks).map(([ticker, item]) => ({
        ticker,
        name: item?.n ?? ticker,
        exchange: item?.x ?? "",
        sector: item?.s ?? "",
        country: item?.c ?? "",
        price: num(item?.p),
        marketCap: num(item?.mc),
        per: num(item?.pe),
        pbr: num(item?.pb),
        dividendYield: num(item?.dy),
        return12m: num(item?.r12),
      }));

      const sectors = Array.from(new Set(stocks.map((s) => s.sector).filter(Boolean))).sort();
      const countries = Array.from(new Set(stocks.map((s) => s.country).filter(Boolean))).sort();

      setResult({
        stocks,
        dataReady: true,
        failed: false,
        sourceDate: raw.source_date ?? null,
        sectors,
        countries,
      });
    })();

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return result;
}
