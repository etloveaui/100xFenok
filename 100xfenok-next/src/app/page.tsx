'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

type NumberPoint = {
  date: string;
  value: number;
};

type CnnFearGreedPoint = {
  date: string;
  score: number;
};

type PutCallPoint = {
  date: string;
  value: number;
  rating?: string;
};

type CryptoFearGreedPoint = {
  date: string;
  value: number;
  classification?: string;
};

type BenchmarksSummaryPayload = {
  momentum?: Record<string, { '1m'?: number }>;
};

type FredSeriesPayload = {
  series?: Record<string, NumberPoint[]>;
};

type TickerQuotePayload = {
  symbol?: string;
  price?: number;
  changePercent?: number;
  marketState?: string;
  fetchedAt?: string;
  source?: string;
};

type SectorTickerMap = Record<string, TickerQuotePayload | null>;

type SectorDefinition = {
  key: string;
  etf: string;
  name: string;
  fallback: number;
};

type QuickIndexDefinition = {
  symbol: 'SPY' | 'QQQ';
  fallback: number;
};

type SectorSnapshot = {
  key: string;
  etf: string;
  name: string;
  oneMonth: number;
  dayChange: number | null;
  displayChange: number;
  displayHorizon: '1D' | '1M';
  quotePrice: number | null;
  marketState: string | null;
};

type QuickIndexSnapshot = {
  symbol: 'SPY' | 'QQQ';
  price: number | null;
  change: number;
  displayHorizon: '1D' | 'BASE';
  marketState: string | null;
};

type LiquidityBar = {
  delta: number;
  height: number;
};

type BankingTone = 'stable' | 'watch' | 'stress';
type StressTone = 'low' | 'medium' | 'high';

type DashboardSnapshot = {
  fearGreedScore: number;
  fearGreedLabel: string;
  sectorRows: SectorSnapshot[];
  sectorUp: number;
  sectorDown: number;
  sectorMode: 'LIVE_1D' | 'MIXED' | 'BASE_1M';
  sectorLiveCount: number;
  tickerFetchedAt: string | null;
  quickIndices: QuickIndexSnapshot[];
  liquidityFlow: number;
  liquidityFlowLabel: string;
  liquidityBars: LiquidityBar[];
  loanDepositRatio: number;
  vixValue: number;
  vixLabel: string;
  putCallValue: number;
  putCallLabel: string;
  cryptoFearGreed: number;
  cryptoLabel: string;
  bankingTone: BankingTone;
  bankingLabel: string;
  bankingSummary: string;
  stressScore: number;
  stressTone: StressTone;
  stressLabel: string;
  tenYearYield: number;
  hySpread: number;
};

const CLIENT_FETCH_TIMEOUT_MS = 5500;
const FOCUS_REFRESH_STALE_MS = 3 * 60 * 1000;

const SECTOR_DEFINITIONS: SectorDefinition[] = [
  { key: 'information_technology', etf: 'XLK', name: 'Tech', fallback: 0.0234 },
  { key: 'financials', etf: 'XLF', name: '금융', fallback: 0.0156 },
  { key: 'health_care', etf: 'XLV', name: '헬스케어', fallback: 0.0089 },
  { key: 'energy', etf: 'XLE', name: '에너지', fallback: -0.0123 },
  { key: 'industrials', etf: 'XLI', name: '산업재', fallback: 0.0045 },
  { key: 'communication_services', etf: 'XLC', name: '커뮤니케이션', fallback: 0.0112 },
  { key: 'consumer_discretionary', etf: 'XLY', name: '자유소비재', fallback: -0.0067 },
  { key: 'consumer_staples', etf: 'XLP', name: '필수소비재', fallback: 0.0012 },
  { key: 'real_estate', etf: 'XLRE', name: '부동산', fallback: -0.0034 },
  { key: 'materials', etf: 'XLB', name: '소재', fallback: 0.0078 },
  { key: 'utilities', etf: 'XLU', name: '유틸리티', fallback: -0.0189 },
];

const QUICK_INDEX_DEFINITIONS: QuickIndexDefinition[] = [
  { symbol: 'SPY', fallback: 0.0085 },
  { symbol: 'QQQ', fallback: 0.0112 },
];

const DEFAULT_DASHBOARD: DashboardSnapshot = {
  fearGreedScore: 72,
  fearGreedLabel: '탐욕',
  sectorRows: SECTOR_DEFINITIONS.map((sector) => ({
    key: sector.key,
    etf: sector.etf,
    name: sector.name,
    oneMonth: sector.fallback,
    dayChange: null,
    displayChange: sector.fallback,
    displayHorizon: '1M',
    quotePrice: null,
    marketState: null,
  })),
  sectorUp: 7,
  sectorDown: 4,
  sectorMode: 'BASE_1M',
  sectorLiveCount: 0,
  tickerFetchedAt: null,
  quickIndices: QUICK_INDEX_DEFINITIONS.map((item) => ({
    symbol: item.symbol,
    price: null,
    change: item.fallback,
    displayHorizon: 'BASE',
    marketState: null,
  })),
  liquidityFlow: 87,
  liquidityFlowLabel: '대출 흐름이 개선되고 있습니다.',
  liquidityBars: [60, 75, 90, 70, 85, 100].map((height) => ({ delta: 1, height })),
  loanDepositRatio: 71.5,
  vixValue: 14.2,
  vixLabel: '낮음',
  putCallValue: 0.78,
  putCallLabel: '중립',
  cryptoFearGreed: 78,
  cryptoLabel: '탐욕',
  bankingTone: 'stable',
  bankingLabel: '안정',
  bankingSummary: '연체율 1.47% · 자본비율 14.17% · 예대율 71.5%',
  stressScore: 0.12,
  stressTone: 'low',
  stressLabel: '낮음',
  tenYearYield: 4.08,
  hySpread: 2.88,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function lastValue(series: NumberPoint[] | undefined, fallback = 0): number {
  if (!Array.isArray(series) || series.length === 0) return fallback;
  return safeNumber(series[series.length - 1]?.value, fallback);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, item) => acc + item, 0) / values.length;
}

function formatSignedBillions(value: number): string {
  const absValue = Math.abs(value);
  const precision = absValue >= 100 ? 0 : 1;
  const prefix = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${prefix}$${absValue.toFixed(precision)}B`;
}

function formatSignedPercentDecimal(value: number, digits = 2): string {
  const percent = value * 100;
  const prefix = percent > 0 ? '+' : percent < 0 ? '-' : '';
  return `${prefix}${Math.abs(percent).toFixed(digits)}%`;
}

function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

function getFearGreedLabel(score: number): string {
  if (score >= 75) return '극단적 탐욕';
  if (score >= 55) return '탐욕';
  if (score >= 45) return '중립';
  if (score >= 25) return '공포';
  return '극단적 공포';
}

function getVixLabel(value: number): string {
  if (value < 15) return '낮음';
  if (value < 22) return '보통';
  if (value < 30) return '높음';
  return '매우 높음';
}

function getPutCallLabel(value: number, rating?: string): string {
  if (rating && rating.trim().length > 0) {
    const normalized = rating.trim().toLowerCase();
    if (normalized.includes('greed')) return '탐욕';
    if (normalized.includes('fear')) return '공포';
    if (normalized.includes('neutral')) return '중립';
    return rating.trim();
  }
  if (value < 0.7) return '탐욕';
  if (value <= 1) return '중립';
  return '공포';
}

function getCryptoLabel(label?: string | null): string {
  const normalized = (label || '').trim().toLowerCase();
  if (normalized.includes('extreme fear')) return '극단적 공포';
  if (normalized.includes('fear')) return '공포';
  if (normalized.includes('neutral')) return '중립';
  if (normalized.includes('greed')) return '탐욕';
  return label?.trim() || '중립';
}

function getStressTone(score: number): StressTone {
  if (score < 0.33) return 'low';
  if (score < 0.66) return 'medium';
  return 'high';
}

function getMarketStateMeta(marketState: string | null): { label: string; className: string } | null {
  if (!marketState) return null;
  if (marketState.includes('REGULAR')) return { label: 'LIVE', className: 'state-regular' };
  if (marketState.includes('PRE')) return { label: 'PRE', className: 'state-pre' };
  if (marketState.includes('POST')) return { label: 'POST', className: 'state-post' };
  if (marketState.includes('CLOSED')) return { label: 'CLOSED', className: 'state-closed' };
  return null;
}

function getRegimeLabel(score: number): string {
  if (score >= 0.62) return '위험 선호';
  if (score >= 0.45) return '중립';
  return '방어';
}

function getRegimeClass(score: number): string {
  if (score >= 0.62) return 'is-risk-on';
  if (score >= 0.45) return 'is-balanced';
  return 'is-risk-off';
}

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

function buildDashboardSnapshot(payload: {
  fearGreed: CnnFearGreedPoint[] | null;
  vix: NumberPoint[] | null;
  putCall: PutCallPoint[] | null;
  crypto: CryptoFearGreedPoint[] | null;
  summaries: BenchmarksSummaryPayload | null;
  weeklyBanking: FredSeriesPayload | null;
  quarterlyBanking: FredSeriesPayload | null;
  dailyBanking: FredSeriesPayload | null;
  sectorTicker: SectorTickerMap;
  indexTicker: SectorTickerMap;
}): DashboardSnapshot {
  const fallback = DEFAULT_DASHBOARD;

  const sectorRows = SECTOR_DEFINITIONS.map((sector) => {
    const momentum = payload.summaries?.momentum?.[sector.key]?.['1m'];
    const oneMonth = safeNumber(momentum, sector.fallback);
    const ticker = payload.sectorTicker[sector.etf];
    const dayChange = typeof ticker?.changePercent === 'number' && Number.isFinite(ticker.changePercent)
      ? ticker.changePercent / 100
      : null;
    const displayHorizon: SectorSnapshot['displayHorizon'] = dayChange === null ? '1M' : '1D';
    const displayChange = dayChange ?? oneMonth;
    const quotePrice = typeof ticker?.price === 'number' && Number.isFinite(ticker.price)
      ? ticker.price
      : null;
    const marketState = typeof ticker?.marketState === 'string' && ticker.marketState.trim().length > 0
      ? ticker.marketState.toUpperCase()
      : null;

    return {
      key: sector.key,
      etf: sector.etf,
      name: sector.name,
      oneMonth,
      dayChange,
      displayChange,
      displayHorizon,
      quotePrice,
      marketState,
    };
  });

  const sectorUp = sectorRows.filter((sector) => sector.displayChange > 0).length;
  const sectorDown = sectorRows.filter((sector) => sector.displayChange < 0).length;
  const sectorLiveCount = sectorRows.filter((sector) => sector.displayHorizon === '1D').length;
  const sectorMode: DashboardSnapshot['sectorMode'] = sectorLiveCount === 0
    ? 'BASE_1M'
    : sectorLiveCount === sectorRows.length
      ? 'LIVE_1D'
      : 'MIXED';
  const tickerFetchedAtCandidates = Object.values(payload.sectorTicker)
    .map((quote) => quote?.fetchedAt)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort();
  const tickerFetchedAt = tickerFetchedAtCandidates.at(-1) ?? null;

  const quickIndices: QuickIndexSnapshot[] = QUICK_INDEX_DEFINITIONS.map((item, index): QuickIndexSnapshot => {
    const ticker = payload.indexTicker[item.symbol];
    const fallbackQuick: QuickIndexSnapshot = fallback.quickIndices[index] ?? {
      symbol: item.symbol,
      price: null,
      change: item.fallback,
      displayHorizon: 'BASE' as const,
      marketState: null,
    };
    const liveChange = typeof ticker?.changePercent === 'number' && Number.isFinite(ticker.changePercent)
      ? ticker.changePercent / 100
      : null;
    const price = typeof ticker?.price === 'number' && Number.isFinite(ticker.price)
      ? ticker.price
      : fallbackQuick.price;
    const marketState = typeof ticker?.marketState === 'string' && ticker.marketState.trim().length > 0
      ? ticker.marketState.toUpperCase()
      : fallbackQuick.marketState;

    return {
      symbol: item.symbol,
      price,
      change: liveChange ?? fallbackQuick.change,
      displayHorizon: liveChange === null ? 'BASE' : '1D',
      marketState,
    };
  });

  const fearGreedLatest = payload.fearGreed?.[payload.fearGreed.length - 1];
  const fearGreedScore = safeNumber(fearGreedLatest?.score, fallback.fearGreedScore);
  const fearGreedLabel = getFearGreedLabel(fearGreedScore);

  const vixLatest = payload.vix?.[payload.vix.length - 1];
  const vixValue = safeNumber(vixLatest?.value, fallback.vixValue);
  const vixLabel = getVixLabel(vixValue);

  const putCallLatest = payload.putCall?.[payload.putCall.length - 1];
  const putCallValue = safeNumber(putCallLatest?.value, fallback.putCallValue);
  const putCallLabel = getPutCallLabel(putCallValue, putCallLatest?.rating);

  const cryptoLatest = payload.crypto?.[payload.crypto.length - 1];
  const cryptoFearGreed = safeNumber(cryptoLatest?.value, fallback.cryptoFearGreed);
  const cryptoLabel = getCryptoLabel(cryptoLatest?.classification) || fallback.cryptoLabel;

  const loans = payload.weeklyBanking?.series?.TOTLL ?? [];
  const deposits = payload.weeklyBanking?.series?.DPSACBW027SBOG ?? [];
  const latestLoans = lastValue(loans);
  const previousLoans = loans.length >= 2 ? safeNumber(loans[loans.length - 2]?.value, latestLoans) : latestLoans;
  const liquidityFlow = loans.length >= 2 ? latestLoans - previousLoans : fallback.liquidityFlow;

  const loanDeltas = loans
    .slice(Math.max(0, loans.length - 7))
    .map((point, index, array) => (index === 0 ? null : safeNumber(point.value, 0) - safeNumber(array[index - 1]?.value, 0)))
    .filter((delta): delta is number => delta !== null);

  const fallbackBars = fallback.liquidityBars;
  const activeDeltas = loanDeltas.length > 0 ? loanDeltas : fallbackBars.map((bar) => bar.delta);
  const maxAbsDelta = Math.max(...activeDeltas.map((delta) => Math.abs(delta)), 1);
  const liquidityBars = activeDeltas.map((delta, index) => {
    const fallbackHeight = fallbackBars[index]?.height ?? 60;
    return {
      delta,
      height: Math.round(clamp((Math.abs(delta) / maxAbsDelta) * 100, 24, 100) || fallbackHeight),
    };
  });

  const latestDeposits = lastValue(deposits);
  const loanDepositRatio = latestLoans > 0 && latestDeposits > 0
    ? (latestLoans / latestDeposits) * 100
    : fallback.loanDepositRatio;

  const liquidityFlowLabel = liquidityFlow >= 0
    ? '대출 흐름이 개선되고 있습니다.'
    : '대출 흐름이 둔화되고 있습니다.';

  const delinquency = lastValue(payload.quarterlyBanking?.series?.DRALACBN, 1.47);
  const tier1 = lastValue(payload.quarterlyBanking?.series?.BOGZ1FL010000016Q, 14.17);

  const delinquencySeverity = delinquency >= 4 ? 3 : delinquency >= 3 ? 2 : delinquency >= 2 ? 1 : 0;
  const tier1Severity = tier1 < 8 ? 3 : tier1 < 10 ? 2 : tier1 < 12 ? 1 : 0;
  const ratioSeverity = loanDepositRatio > 85 || loanDepositRatio < 55 ? 2 : loanDepositRatio < 60 ? 1 : 0;
  const bankingSeverity = Math.max(delinquencySeverity, tier1Severity, ratioSeverity);

  let bankingTone: BankingTone = 'stable';
  let bankingLabel = '안정';
  if (bankingSeverity === 1) {
    bankingTone = 'watch';
    bankingLabel = '주의';
  } else if (bankingSeverity >= 2) {
    bankingTone = 'stress';
    bankingLabel = '경계';
  }

  const bankingSummary = `연체율 ${delinquency.toFixed(2)}% · 자본비율 ${tier1.toFixed(2)}% · 예대율 ${loanDepositRatio.toFixed(1)}%`;

  const dgs10Series = payload.dailyBanking?.series?.DGS10 ?? [];
  const hySeries = payload.dailyBanking?.series?.BAMLH0A0HYM2 ?? [];
  const tenYearYield = lastValue(dgs10Series, fallback.tenYearYield);
  const hySpread = lastValue(hySeries, fallback.hySpread);

  const recentTenYear = dgs10Series.slice(-20).map((point) => safeNumber(point.value, tenYearYield));
  const tenYearAverage = recentTenYear.length > 0 ? average(recentTenYear) : tenYearYield;
  const tenYearDeviation = Math.abs(tenYearYield - tenYearAverage);

  const hyNormalized = clamp((hySpread - 2.5) / 3.5, 0, 1);
  const rateNormalized = clamp(tenYearDeviation / 0.8, 0, 1);
  const stressScore = Number((hyNormalized * 0.8 + rateNormalized * 0.2).toFixed(2));
  const stressTone = getStressTone(stressScore);
  const stressLabel = stressTone === 'low' ? '낮음' : stressTone === 'medium' ? '주의' : '높음';

  return {
    fearGreedScore,
    fearGreedLabel,
    sectorRows,
    sectorUp,
    sectorDown,
    sectorMode,
    sectorLiveCount,
    tickerFetchedAt,
    quickIndices,
    liquidityFlow,
    liquidityFlowLabel,
    liquidityBars,
    loanDepositRatio,
    vixValue,
    vixLabel,
    putCallValue,
    putCallLabel,
    cryptoFearGreed,
    cryptoLabel,
    bankingTone,
    bankingLabel,
    bankingSummary,
    stressScore,
    stressTone,
    stressLabel,
    tenYearYield,
    hySpread,
  };
}

export default function Home() {
  const [dashboard, setDashboard] = useState<DashboardSnapshot>(DEFAULT_DASHBOARD);
  const loadInFlightRef = useRef(false);
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
        fetchJson<FredSeriesPayload>('/data/fred-banking-weekly.json'),
        fetchJson<FredSeriesPayload>('/data/fred-banking-quarterly.json'),
        fetchJson<FredSeriesPayload>('/data/fred-banking-daily.json'),
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

      if (!isMountedRef.current) {
        return;
      }

      setDashboard(nextSnapshot);
      lastSyncedEpochRef.current = Date.now();
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

  const sectorTopRows = [...dashboard.sectorRows]
    .sort((left, right) => right.displayChange - left.displayChange)
    .slice(0, 4);
  const sectorLeaders = [...dashboard.sectorRows]
    .sort((left, right) => right.displayChange - left.displayChange)
    .slice(0, 3);
  const sectorLaggards = [...dashboard.sectorRows]
    .sort((left, right) => left.displayChange - right.displayChange)
    .slice(0, 3);
  const spyIndex = dashboard.quickIndices.find((item) => item.symbol === 'SPY') ?? DEFAULT_DASHBOARD.quickIndices[0];
  const qqqIndex = dashboard.quickIndices.find((item) => item.symbol === 'QQQ') ?? DEFAULT_DASHBOARD.quickIndices[1];
  const spyMarketStateMeta = getMarketStateMeta(spyIndex.marketState);
  const qqqMarketStateMeta = getMarketStateMeta(qqqIndex.marketState);

  const fearGreedOffset = Number((126 * (1 - clamp(dashboard.fearGreedScore, 0, 100) / 100)).toFixed(2));
  const fearGreedBadgeClass = dashboard.fearGreedScore >= 55
    ? 'bg-green-100 text-green-800'
    : dashboard.fearGreedScore <= 45
      ? 'bg-red-100 text-red-700'
      : 'bg-amber-100 text-amber-800';

  const breadthTotal = Math.max(dashboard.sectorRows.length, 1);
  const breadthRatio = dashboard.sectorUp / breadthTotal;
  const regimeScore = clamp(
    dashboard.fearGreedScore / 100 * 0.45 + breadthRatio * 0.35 + (1 - dashboard.stressScore) * 0.2,
    0,
    1,
  );
  const regimeLabel = getRegimeLabel(regimeScore);
  const regimeClass = getRegimeClass(regimeScore);
  const regimeConfidence = Math.round(regimeScore * 100);

  const liquidityPillClass = dashboard.liquidityFlow >= 0 ? 'is-positive' : 'is-negative';
  const liquidityPillLabel = dashboard.liquidityFlow >= 0 ? '개선' : '둔화';
  const stressPillClass = dashboard.stressTone === 'low'
    ? 'is-positive'
    : dashboard.stressTone === 'medium'
      ? 'is-warning'
      : 'is-negative';
  const bankingDotClass = dashboard.bankingTone === 'stable'
    ? 'is-stable'
    : dashboard.bankingTone === 'watch'
      ? 'is-watch'
      : 'is-stress';

  const sectorDetailHref = '/sectors';
  const liquidityRadarDetailHref = '/radar?path=tools%2Fmacro-monitor%2Fdetails%2Fliquidity-flow.html';
  const sentimentRadarDetailHref = '/radar?path=tools%2Fmacro-monitor%2Fdetails%2Fsentiment-signal%2Findex.html';
  const bankingRadarDetailHref = '/radar?path=tools%2Fmacro-monitor%2Fdetails%2Fbanking-health.html';
  const stressRadarDetailHref = '/radar?path=tools%2Fmacro-monitor%2Fdetails%2Fliquidity-stress.html';
  const quickIndexDetail = (item: QuickIndexSnapshot) => {
    if (item.price === null) return '기본 데이터';
    return item.displayHorizon === '1D' ? `$${item.price.toFixed(2)} · 당일` : `$${item.price.toFixed(2)}`;
  };

  return (
    <div className="container mx-auto overflow-x-hidden px-3 py-3 sm:px-4 sm:py-4">
      <Link
        href="/posts/2026-02-21_tariff-ruling-comprehensive.html"
        className="group block w-full rounded-2xl overflow-hidden mb-4 bg-gradient-to-r from-red-50 via-amber-50/80 to-slate-50 border border-red-200/50 hover:border-amber-300/70 shadow-sm hover:shadow-lg transition-all duration-300"
      >
        <div className="flex items-start gap-3 px-3 py-3 sm:items-center sm:gap-4 sm:px-5 sm:py-4">
          <span className="text-2xl flex-shrink-0">&#9878;</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700 px-2 py-0.5 rounded-full animate-pulse">
                주요 분석
              </span>
              <span className="text-[10px] text-slate-600 font-mono">2026.02.21</span>
            </div>
            <p className="text-sm font-bold text-slate-800 line-clamp-2">
              IEEPA 관세 위헌 판결 — 종합 분석
            </p>
            <p className="text-xs text-slate-600 line-clamp-2">
              대법원 6-3 위헌 · 트럼프 122조 10% 즉시 서명 · 국가별 관세 영향 · 포트폴리오 함의
            </p>
          </div>
          <div className="hidden min-[420px]:block flex-shrink-0 text-slate-300 group-hover:text-amber-600 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </Link>

      <section className="mb-4">
        <div className="hero-zone min-w-0">
          <div className="bento-card p-4">
            <h3 className="text-xs font-bold text-slate-600 tracking-widest mb-2 orbitron">시장 심리</h3>
            <div className="flex items-center gap-3">
              <div className="relative w-16 h-8">
                <svg viewBox="0 0 100 50" className="w-full h-full" aria-hidden="true">
                  <defs>
                    <linearGradient id="gaugeFinal" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#ef4444" />
                      <stop offset="50%" stopColor="#eab308" />
                      <stop offset="100%" stopColor="#22c55e" />
                    </linearGradient>
                  </defs>
                  <path d="M 10 45 A 40 40 0 0 1 90 45" fill="none" stroke="#e2e8f0" strokeWidth="6" strokeLinecap="round" />
                  <path
                    d="M 10 45 A 40 40 0 0 1 90 45"
                    fill="none"
                    stroke="url(#gaugeFinal)"
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray="126"
                    strokeDashoffset={fearGreedOffset}
                  />
                </svg>
              </div>
              <span className="text-2xl font-bold text-brand-navy orbitron">{Math.round(dashboard.fearGreedScore)}</span>
              <span className={`px-2 py-0.5 rounded-full font-bold text-xs ${fearGreedBadgeClass}`}>{dashboard.fearGreedLabel}</span>
            </div>
            <p className="mt-3 text-sm text-slate-600">
              공포·탐욕 지수와 변동성 흐름을 합쳐 시장의 온도를 요약합니다.
            </p>
          </div>

          <div className="bento-card p-4">
            <h3 className="text-xs font-bold text-slate-600 tracking-widest mb-2 orbitron">시장 국면</h3>
            <div className="flex items-center justify-between gap-3">
              <div className={`regime-badge ${regimeClass}`}>
                <i className="fas fa-rocket text-xs" />
                <span>{regimeLabel}</span>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-600">신호 강도</p>
                <p className="text-xl font-bold text-emerald-800 orbitron">{regimeConfidence}%</p>
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-600">
              심리, 섹터 확산, 스트레스 지표를 합쳐 현재 시장의 방향성을 보여줍니다.
            </p>
          </div>

          <div className="bento-card p-4 quick-indices-card">
            <h3 className="text-xs font-bold text-slate-600 tracking-widest mb-2 orbitron">빠른 지표</h3>
            <div className="quick-indices-scroll">
              <div className="index-item">
                <span className="text-xs text-slate-600">SPY</span>
                <svg className="sparkline" viewBox="0 0 60 20" aria-hidden="true"><polyline fill="none" stroke="#22c55e" strokeWidth="1.5" points="0,16 10,14 20,12 30,10 40,11 50,6 60,4" /></svg>
                <span className={`font-bold text-sm ${spyIndex.change >= 0 ? 'text-emerald-800' : 'text-red-700'}`}>
                  {formatSignedPercentDecimal(spyIndex.change)}
                </span>
                <span className="index-live-detail">{quickIndexDetail(spyIndex)}</span>
                {spyMarketStateMeta ? (
                  <span className={`market-state-badge index-market-state ${spyMarketStateMeta.className}`}>
                    {spyMarketStateMeta.label}
                  </span>
                ) : null}
              </div>
              <div className="index-item">
                <span className="text-xs text-slate-600">QQQ</span>
                <svg className="sparkline" viewBox="0 0 60 20" aria-hidden="true"><polyline fill="none" stroke="#22c55e" strokeWidth="1.5" points="0,18 10,16 20,12 30,10 40,8 50,6 60,3" /></svg>
                <span className={`font-bold text-sm ${qqqIndex.change >= 0 ? 'text-emerald-800' : 'text-red-700'}`}>
                  {formatSignedPercentDecimal(qqqIndex.change)}
                </span>
                <span className="index-live-detail">{quickIndexDetail(qqqIndex)}</span>
                {qqqMarketStateMeta ? (
                  <span className={`market-state-badge index-market-state ${qqqMarketStateMeta.className}`}>
                    {qqqMarketStateMeta.label}
                  </span>
                ) : null}
              </div>
              <div className="index-item">
                <span className="text-xs text-slate-600">UST10Y</span>
                <svg className="sparkline" viewBox="0 0 60 20" aria-hidden="true"><polyline fill="none" stroke="#ef4444" strokeWidth="1.5" points="0,8 10,9 20,10 30,11 40,12 50,13 60,14" /></svg>
                <span className="font-bold text-slate-700 text-sm">{formatPercent(dashboard.tenYearYield, 2)}</span>
              </div>
              <div className="index-item">
                <span className="text-xs text-slate-600">HY OAS</span>
                <svg className="sparkline" viewBox="0 0 60 20" aria-hidden="true"><polyline fill="none" stroke="#f59e0b" strokeWidth="1.5" points="0,12 10,11 20,10 30,9 40,10 50,11 60,12" /></svg>
                <span className="font-bold text-amber-800 text-sm">{formatPercent(dashboard.hySpread, 2)}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="overview-widget-grid mb-4">
        <article className="overview-widget-card overview-widget-card--sector">
          <header className="overview-widget-head">
            <div>
              <p className="overview-widget-kicker orbitron">섹터 흐름</p>
              <h3 className="overview-widget-subtitle">Breadth Expansion</h3>
              <p className="overview-source-meta">최근 강세와 약세 섹터를 한눈에 요약합니다.</p>
            </div>
          </header>
          <div className="overview-breadth">
            <div className="overview-breadth-ledger">
              <span className="overview-dot is-up" aria-hidden="true" />
              <span className="overview-breadth-value">상승 {dashboard.sectorUp}</span>
              <span className="overview-dot is-down" aria-hidden="true" />
              <span className="overview-breadth-value is-down">하락 {dashboard.sectorDown}</span>
            </div>
            <div className="overview-chip-row">
              {sectorTopRows.map((sector) => (
                <span key={sector.key} className={`overview-chip ${sector.displayChange >= 0 ? 'is-up' : 'is-down'}`}>
                  {sector.etf} {formatSignedPercentDecimal(sector.displayChange, 1)}
                </span>
              ))}
            </div>
          </div>
          <div className="sector-insight-strip mt-4" aria-label="섹터 요약">
            <article className="sector-insight-card">
              <h4 className="sector-insight-title">강한 섹터</h4>
              <div className="sector-insight-list">
                {sectorLeaders.map((sector) => (
                  <div key={`leader-${sector.key}`} className="sector-insight-row">
                    <span className="sector-insight-symbol">{sector.etf}</span>
                    <strong className="sector-insight-value is-up">{formatSignedPercentDecimal(sector.displayChange, 1)}</strong>
                  </div>
                ))}
              </div>
            </article>
            <article className="sector-insight-card">
              <h4 className="sector-insight-title">약한 섹터</h4>
              <div className="sector-insight-list">
                {sectorLaggards.map((sector) => (
                  <div key={`laggard-${sector.key}`} className="sector-insight-row">
                    <span className="sector-insight-symbol">{sector.etf}</span>
                    <strong className="sector-insight-value is-down">{formatSignedPercentDecimal(sector.displayChange, 1)}</strong>
                  </div>
                ))}
              </div>
            </article>
          </div>
          <Link href={sectorDetailHref} className="overview-widget-link">
            시장 랩 보기
          </Link>
        </article>

        <article className="overview-widget-card overview-widget-card--liquidity">
          <header className="overview-widget-head">
            <div>
              <p className="overview-widget-kicker orbitron">유동성</p>
              <h3 className="overview-widget-subtitle">Funding Pulse</h3>
              <p className="overview-source-meta">대출과 예금 흐름으로 유동성 방향을 봅니다.</p>
            </div>
            <span className={`overview-status-pill ${liquidityPillClass}`}>{liquidityPillLabel}</span>
          </header>
          <div className="overview-metric-stack">
            <p className="overview-metric-main orbitron">{formatSignedBillions(dashboard.liquidityFlow)}</p>
            <p className="overview-metric-sub">{dashboard.liquidityFlowLabel}</p>
          </div>
          <div className="overview-mini-bars" aria-hidden="true">
            {dashboard.liquidityBars.map((bar, index) => (
              <span
                key={`${bar.delta}-${index}`}
                className={bar.delta >= 0 ? 'is-up' : 'is-down'}
                style={{ height: `${bar.height}%` }}
              />
            ))}
          </div>
          <p className="overview-metric-sub mt-3">예대율 {formatPercent(dashboard.loanDepositRatio)}</p>
          <Link href={liquidityRadarDetailHref} className="overview-widget-link">
            상세 분석
          </Link>
        </article>

        <article className="overview-widget-card overview-widget-card--sentiment">
          <header className="overview-widget-head">
            <div>
              <p className="overview-widget-kicker orbitron">투자 심리</p>
              <h3 className="overview-widget-subtitle">Risk Appetite</h3>
              <p className="overview-source-meta">변동성과 옵션, 암호화폐 심리를 함께 봅니다.</p>
            </div>
          </header>
          <div className="overview-stat-list">
            <p className="overview-stat-row">
              <span>VIX</span>
              <strong className="text-emerald-800">{dashboard.vixValue.toFixed(2)} <em>{dashboard.vixLabel}</em></strong>
            </p>
            <p className="overview-stat-row">
              <span>Put/Call</span>
              <strong className="text-slate-700">{dashboard.putCallValue.toFixed(2)} <em>{dashboard.putCallLabel}</em></strong>
            </p>
            <p className="overview-stat-row">
              <span>Crypto F&amp;G</span>
              <strong className="text-brand-gold">{Math.round(dashboard.cryptoFearGreed)} <em>{dashboard.cryptoLabel}</em></strong>
            </p>
          </div>
          <Link href={sentimentRadarDetailHref} className="overview-widget-link">
            상세 분석
          </Link>
        </article>
      </section>

      <section className="overview-widget-grid overview-widget-grid--secondary">
        <article className="overview-widget-card overview-widget-card--banking">
          <header className="overview-widget-head">
            <div>
              <p className="overview-widget-kicker orbitron">금융 건전성</p>
              <h3 className="overview-widget-subtitle">Funding Stress Guard</h3>
              <p className="overview-source-meta">연체율, 예대율, 자본비율로 은행권 상태를 봅니다.</p>
            </div>
          </header>
          <div className="overview-health-row">
            <span className={`overview-pulse-dot ${bankingDotClass}`} aria-hidden="true" />
            <strong>{dashboard.bankingLabel}</strong>
          </div>
          <p className="overview-metric-sub">{dashboard.bankingSummary}</p>
          <Link href={bankingRadarDetailHref} className="overview-widget-link">
            상세 분석
          </Link>
        </article>

        <article className="overview-widget-card overview-widget-card--stress">
          <header className="overview-widget-head">
            <div>
              <p className="overview-widget-kicker orbitron">시장 스트레스</p>
              <h3 className="overview-widget-subtitle">Stress Monitor</h3>
              <p className="overview-source-meta">금리와 하이일드 스프레드로 위험 강도를 봅니다.</p>
            </div>
            <span className={`overview-status-pill ${stressPillClass}`}>{dashboard.stressLabel}</span>
          </header>
          <div className="overview-health-row">
            <strong className="overview-metric-main orbitron">{dashboard.stressScore.toFixed(2)}</strong>
          </div>
          <p className="overview-metric-sub">HY {formatPercent(dashboard.hySpread, 2)} · UST10Y {formatPercent(dashboard.tenYearYield, 2)}</p>
          <Link href={stressRadarDetailHref} className="overview-widget-link">
            상세 분석
          </Link>
        </article>
      </section>
    </div>
  );
}
