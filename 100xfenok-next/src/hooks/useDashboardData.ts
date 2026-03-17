import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CnnFearGreedPoint,
  NumberPoint,
  PutCallPoint,
  CryptoFearGreedPoint,
  BenchmarksSummaryPayload,
  FredSeriesPayload,
  TickerQuotePayload,
  SectorTickerMap,
  DashboardSnapshot,
  DashboardDataResult,
  DashboardSourceId,
} from '@/lib/dashboard/types';
import {
  CLIENT_FETCH_TIMEOUT_MS,
  FOCUS_REFRESH_STALE_MS,
  SECTOR_DEFINITIONS,
  QUICK_INDEX_DEFINITIONS,
  DEFAULT_DASHBOARD,
} from '@/lib/dashboard/constants';
import { buildDashboardSnapshot } from '@/lib/dashboard/snapshot-builder';

async function fetchJson<T>(url: string, timeoutMs = CLIENT_FETCH_TIMEOUT_MS): Promise<T | null> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
    });
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
  const lastSyncedEpochRef = useRef<number | null>(null);

  const loadOverviewData = useCallback(async () => {
    if (loadInFlightRef.current) {
      return;
    }
    loadInFlightRef.current = true;

    try {
      const tickerSymbols = [
        ...SECTOR_DEFINITIONS.map((sector) => sector.etf),
        ...QUICK_INDEX_DEFINITIONS.map((item) => item.symbol),
      ];
      const dataPromise = Promise.all([
        fetchJson<CnnFearGreedPoint[]>('/data/sentiment/cnn-fear-greed.json'),
        fetchJson<NumberPoint[]>('/data/sentiment/vix.json'),
        fetchJson<PutCallPoint[]>('/data/sentiment/cnn-put-call.json'),
        fetchJson<CryptoFearGreedPoint[]>('/data/sentiment/crypto-fear-greed.json'),
        fetchJson<BenchmarksSummaryPayload>('/data/benchmarks/summaries.json'),
        fetchJson<FredSeriesPayload>('/data/macro/fred-banking-weekly.json'),
        fetchJson<FredSeriesPayload>('/data/macro/fred-banking-quarterly.json'),
        fetchJson<FredSeriesPayload>('/data/macro/fred-banking-daily.json'),
      ]);
      const tickerPromise = Promise.allSettled(
        tickerSymbols.map(async (symbol) => ({
          symbol,
          quote: await fetchJson<TickerQuotePayload>(`/api/ticker/${symbol}`, 3200),
        })),
      );

      const [[fearGreed, vix, putCall, crypto, summaries, weeklyBanking, quarterlyBanking, dailyBanking], tickerSettled] = await Promise.all([
        dataPromise,
        tickerPromise,
      ]);

      const tickerMap: SectorTickerMap = {};
      for (const symbol of tickerSymbols) {
        tickerMap[symbol] = null;
      }
      tickerSettled.forEach((result, index) => {
        const symbol = tickerSymbols[index];
        if (!symbol || result.status !== 'fulfilled') return;
        tickerMap[symbol] = result.value.quote;
      });

      const sectorTicker: SectorTickerMap = {};
      for (const sector of SECTOR_DEFINITIONS) {
        sectorTicker[sector.etf] = tickerMap[sector.etf] ?? null;
      }

      const indexTicker: SectorTickerMap = {};
      for (const item of QUICK_INDEX_DEFINITIONS) {
        indexTicker[item.symbol] = tickerMap[item.symbol] ?? null;
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
        lastSyncedEpochRef.current = Date.now();
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
    const refreshId = window.setInterval(() => {
      void loadOverviewData();
    }, 10 * 60 * 1000);

    return () => {
      isMountedRef.current = false;
      window.clearInterval(refreshId);
    };
  }, [loadOverviewData]);

  useEffect(() => {
    const maybeRefreshIfStale = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }

      const lastSynced = lastSyncedEpochRef.current;
      if (lastSynced === null || Date.now() - lastSynced >= FOCUS_REFRESH_STALE_MS) {
        void loadOverviewData();
      }
    };

    window.addEventListener('focus', maybeRefreshIfStale);
    document.addEventListener('visibilitychange', maybeRefreshIfStale);

    return () => {
      window.removeEventListener('focus', maybeRefreshIfStale);
      document.removeEventListener('visibilitychange', maybeRefreshIfStale);
    };
  }, [loadOverviewData]);

  return {
    dashboard,
    dataReady,
    failedSources,
    freshness: dashboard.freshness,
  } satisfies DashboardDataResult;
}
