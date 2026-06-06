import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CnnFearGreedPoint,
  NumberPoint,
  PutCallPoint,
  CryptoFearGreedPoint,
  BenchmarksSummaryPayload,
  FredSeriesPayload,
  SectorTickerMap,
  DashboardSnapshot,
  DashboardDataResult,
  DashboardSourceId,
} from '@/lib/dashboard/types';
import {
  CLIENT_FETCH_TIMEOUT_MS,
  SECTOR_DEFINITIONS,
  QUICK_INDEX_DEFINITIONS,
  DEFAULT_DASHBOARD,
} from '@/lib/dashboard/constants';
import { buildDashboardSnapshot } from '@/lib/dashboard/snapshot-builder';

// HTTP cache intentional: static /data/*.json has Cache-Control max-age=300
// (see next.config.ts headers). Ticker /api/* has its own s-maxage=15.
// Browser uses ETag/304 to avoid re-downloading unchanged daily JSON.
async function fetchJson<T>(url: string, timeoutMs = CLIENT_FETCH_TIMEOUT_MS): Promise<T | null> {
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

export function useDashboardData() {
  const [dashboard, setDashboard] = useState<DashboardSnapshot>(DEFAULT_DASHBOARD);
  const [dataReady, setDataReady] = useState(false);
  const [failedSources, setFailedSources] = useState<DashboardSourceId[]>([]);
  const loadInFlightRef = useRef(false);
  const hasLiveDataRef = useRef(false);
  const isMountedRef = useRef(true);

  const loadOverviewData = useCallback(async () => {
    if (loadInFlightRef.current) {
      return;
    }
    loadInFlightRef.current = true;

    try {
      const [fearGreed, vix, putCall, crypto, summaries, weeklyBanking, quarterlyBanking, dailyBanking] = await Promise.all([
        fetchJson<CnnFearGreedPoint[]>('/data/sentiment/cnn-fear-greed.json'),
        fetchJson<NumberPoint[]>('/data/sentiment/vix.json'),
        fetchJson<PutCallPoint[]>('/data/sentiment/cnn-put-call.json'),
        fetchJson<CryptoFearGreedPoint[]>('/data/sentiment/crypto-fear-greed.json'),
        fetchJson<BenchmarksSummaryPayload>('/data/benchmarks/summaries.json'),
        fetchJson<FredSeriesPayload>('/data/macro/fred-banking-weekly.json'),
        fetchJson<FredSeriesPayload>('/data/macro/fred-banking-quarterly.json'),
        fetchJson<FredSeriesPayload>('/data/macro/fred-banking-daily.json'),
      ]);

      const sectorTicker: SectorTickerMap = {};
      for (const sector of SECTOR_DEFINITIONS) {
        sectorTicker[sector.etf] = null;
      }

      const indexTicker: SectorTickerMap = {};
      for (const item of QUICK_INDEX_DEFINITIONS) {
        indexTicker[item.symbol] = null;
      }

      const nextSnapshot = buildDashboardSnapshot({
        fearGreed,
        vix,
        putCall,
        crypto,
        summaries,
        weeklyBanking,
        quarterlyBanking,
        dailyBanking,
        sectorTicker,
        indexTicker,
      });
      const nextFailedSources = Object.entries(nextSnapshot.freshness)
        .filter(([, meta]) => meta.isFallback)
        .map(([source]) => source as DashboardSourceId);
      const hasSuccessfulSource = Object.values(nextSnapshot.freshness)
        .some((meta) => !meta.isFallback);

      if (!isMountedRef.current) {
        return;
      }

      setFailedSources(nextFailedSources);

      if (hasSuccessfulSource) {
        setDashboard(nextSnapshot);
        setDataReady(true);
        hasLiveDataRef.current = true;
        return;
      }

      if (!hasLiveDataRef.current) {
        setDashboard(nextSnapshot);
        setDataReady(false);
      } else {
        setDashboard((prev) => ({ ...prev, freshness: nextSnapshot.freshness }));
      }
    } finally {
      loadInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    void loadOverviewData();

    return () => {
      isMountedRef.current = false;
    };
  }, [loadOverviewData]);

  return {
    dashboard,
    dataReady,
    failedSources,
    freshness: dashboard.freshness,
  } satisfies DashboardDataResult;
}
