"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ConsensusData,
  EnhancedConsensusData,
  SummaryData,
  ByTickerData,
  SectorHoldingsData,
  InvestorData,
  SuperInvestorsDataResult,
} from "@/lib/superinvestors/types";

const FETCH_TIMEOUT_MS = 6000;

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

const EMPTY: SuperInvestorsDataResult = {
  consensus: null,
  enhancedConsensus: null,
  summary: null,
  byTicker: null,
  bySector: null,
  dataReady: false,
  failed: false,
  quarter: null,
  excludedStale: [],
};

export function use13FData(): SuperInvestorsDataResult {
  const [result, setResult] = useState<SuperInvestorsDataResult>(EMPTY);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    void (async () => {
      const [consensus, summary, byTicker, enhancedConsensus, bySector] = await Promise.all([
        fetchJson<ConsensusData>("/data/sec-13f/analytics/consensus.json"),
        fetchJson<SummaryData>("/data/sec-13f/summary.json"),
        fetchJson<ByTickerData>("/data/sec-13f/by_ticker.json"),
        fetchJson<EnhancedConsensusData>("/data/sec-13f/analytics/enhanced_consensus.json"),
        fetchJson<SectorHoldingsData>("/data/sec-13f/by_sector.json"),
      ]);

      if (!isMountedRef.current) return;

      const anyFailed = !consensus && !summary && !byTicker;
      const consensusFailed = !consensus?.consensus;

      if (anyFailed || consensusFailed) {
        setResult({ ...EMPTY, failed: true });
        return;
      }

      setResult({
        consensus,
        enhancedConsensus,
        summary,
        byTicker,
        bySector,
        dataReady: true,
        failed: false,
        quarter: consensus?.metadata?.quarter ?? null,
        excludedStale: consensus?.metadata?.excluded_stale_investors ?? [],
      });
    })();

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return result;
}

const INVESTOR_CACHE = new Map<string, InvestorData>();

export function useInvestorDetail(name: string | null) {
  const [data, setData] = useState<InvestorData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!name) {
      setData(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const run = async () => {
      const cached = INVESTOR_CACHE.get(name);
      if (cached !== undefined) {
        setData(cached);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const r = await fetchJson<InvestorData>(`/data/sec-13f/investors/${name}.json`);
        if (r) INVESTOR_CACHE.set(name, r);
        if (!cancelled) setData(r);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [name]);

  return { data, loading };
}
