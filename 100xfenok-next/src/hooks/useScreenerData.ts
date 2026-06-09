"use client";

import { useEffect, useRef, useState } from "react";
import type { ScreenerStock, ScreenerDataResult } from "@/lib/screener/types";

const FETCH_TIMEOUT_MS = 4000; // single payload

interface RawStock {
  symbol?: string;
  companyName?: string;
  sector?: string;
  industry?: string;
  country?: string;
  price?: number;
  marketCap?: number;
  per?: number;
  pbr?: number;
  dividendYield?: number;
  return12m?: number;
  roe?: number;
  opm?: number;
  eps?: number;
  growthRate?: number;
  momentum1m?: number;
  momentum3m?: number;
  momentum6m?: number;
  momentum12m?: number;
  rank?: number;
  perBandCurrent?: number;
  perBandMin?: number;
  perBandAvg?: number;
  perBandMax?: number;
}
interface RawIndex {
  source_date?: string;
  data?: RawStock[];
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
      const raw = await fetchJson<RawIndex>("/data/global-scouter/core/stocks_analyzer.json");
      if (!isMountedRef.current) return;

      if (!raw?.data || !Array.isArray(raw.data)) {
        setResult({ ...EMPTY, failed: true });
        return;
      }

      const stocks: ScreenerStock[] = raw.data.map((item) => ({
        ticker: item.symbol ?? "",
        name: item.companyName ?? item.symbol ?? "",
        exchange: item.industry ?? "",
        sector: item.sector ?? "",
        country: item.country ?? "",
        price: num(item.price),
        marketCap: num(item.marketCap),
        per: num(item.per),
        pbr: num(item.pbr),
        dividendYield: num(item.dividendYield),
        return12m: num(item.return12m),
        roe: num(item.roe),
        opm: num(item.opm),
        eps: num(item.eps),
        growthRate: num(item.growthRate),
        momentum1m: num(item.momentum1m),
        momentum3m: num(item.momentum3m),
        momentum6m: num(item.momentum6m),
        momentum12m: num(item.momentum12m),
        rank: num(item.rank),
        perBandCurrent: num(item.perBandCurrent),
        perBandMin: num(item.perBandMin),
        perBandAvg: num(item.perBandAvg),
        perBandMax: num(item.perBandMax),
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
