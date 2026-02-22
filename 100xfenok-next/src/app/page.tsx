'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type TouchEvent } from 'react';
import Link from 'next/link';
import WidgetConsoleFrame from '@/components/WidgetConsoleFrame';

type TabId = 'overview' | 'sectors' | 'liquidity' | 'sentiment';
type TabMotion = 'next' | 'prev' | 'direct';

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

const periods = ['1D', '1W', '1M', 'YTD', '1Y'];
const TAB_SEQUENCE: TabId[] = ['overview', 'sectors', 'liquidity', 'sentiment'];
const TAB_LABELS: Record<TabId, string> = {
  overview: 'Overview',
  sectors: 'Sectors',
  liquidity: 'Liquidity',
  sentiment: 'Sentiment',
};
const TAB_BUTTON_IDS: Record<TabId, string> = {
  overview: 'tab-overview',
  sectors: 'tab-sectors',
  liquidity: 'tab-liquidity',
  sentiment: 'tab-sentiment',
};
const TAB_PANEL_IDS: Record<TabId, string> = {
  overview: 'panel-overview',
  sectors: 'panel-sectors',
  liquidity: 'panel-liquidity',
  sentiment: 'panel-sentiment',
};
const SWIPE_HINT_DISMISS_KEY = 'fenok_swipe_hint_dismissed_v1';
const CLIENT_FETCH_TIMEOUT_MS = 5500;

const SECTOR_DEFINITIONS: SectorDefinition[] = [
  { key: 'information_technology', etf: 'XLK', name: 'Tech', fallback: 0.0234 },
  { key: 'financials', etf: 'XLF', name: 'Financials', fallback: 0.0156 },
  { key: 'health_care', etf: 'XLV', name: 'Health Care', fallback: 0.0089 },
  { key: 'energy', etf: 'XLE', name: 'Energy', fallback: -0.0123 },
  { key: 'industrials', etf: 'XLI', name: 'Industrials', fallback: 0.0045 },
  { key: 'communication_services', etf: 'XLC', name: 'Communication', fallback: 0.0112 },
  { key: 'consumer_discretionary', etf: 'XLY', name: 'Discretionary', fallback: -0.0067 },
  { key: 'consumer_staples', etf: 'XLP', name: 'Staples', fallback: 0.0012 },
  { key: 'real_estate', etf: 'XLRE', name: 'Real Estate', fallback: -0.0034 },
  { key: 'materials', etf: 'XLB', name: 'Materials', fallback: 0.0078 },
  { key: 'utilities', etf: 'XLU', name: 'Utilities', fallback: -0.0189 },
];

const QUICK_INDEX_DEFINITIONS: QuickIndexDefinition[] = [
  { symbol: 'SPY', fallback: 0.0085 },
  { symbol: 'QQQ', fallback: 0.0112 },
];

const DEFAULT_DASHBOARD: DashboardSnapshot = {
  fearGreedScore: 72,
  fearGreedLabel: 'GREED',
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
  liquidityFlowLabel: 'Bank credit flow acceleration',
  liquidityBars: [60, 75, 90, 70, 85, 100].map((height) => ({ delta: 1, height })),
  loanDepositRatio: 71.5,
  vixValue: 14.2,
  vixLabel: 'Low',
  putCallValue: 0.78,
  putCallLabel: 'Neutral',
  cryptoFearGreed: 78,
  cryptoLabel: 'Greed',
  bankingTone: 'stable',
  bankingLabel: 'Stable',
  bankingSummary: 'Delinq 1.47% · Tier1 14.17% · LDR 71.5%',
  stressScore: 0.12,
  stressTone: 'low',
  stressLabel: 'Low Risk',
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

function formatTimeLabel(value: string | null): string {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function getFearGreedLabel(score: number): string {
  if (score >= 75) return 'EXTREME GREED';
  if (score >= 55) return 'GREED';
  if (score >= 45) return 'NEUTRAL';
  if (score >= 25) return 'FEAR';
  return 'EXTREME FEAR';
}

function getVixLabel(value: number): string {
  if (value < 15) return 'Low';
  if (value < 22) return 'Moderate';
  if (value < 30) return 'Elevated';
  return 'High';
}

function getPutCallLabel(value: number, rating?: string): string {
  if (rating && rating.trim().length > 0) {
    return rating
      .toLowerCase()
      .split(' ')
      .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
      .join(' ');
  }
  if (value < 0.7) return 'Greed';
  if (value <= 1) return 'Neutral';
  return 'Fear';
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

function getHeatmapToneClass(change: number, horizon: '1D' | '1M'): string {
  const strongPositive = horizon === '1D' ? 0.012 : 0.025;
  const positive = horizon === '1D' ? 0.007 : 0.012;
  const softPositive = horizon === '1D' ? 0.003 : 0.006;
  const strongNegative = horizon === '1D' ? -0.012 : -0.02;
  const negative = horizon === '1D' ? -0.007 : -0.012;
  const softNegative = horizon === '1D' ? -0.003 : -0.006;

  if (change >= strongPositive) return 'heatmap-positive-strong';
  if (change >= positive) return 'heatmap-positive';
  if (change >= softPositive) return 'heatmap-positive-soft';
  if (change > 0) return 'heatmap-positive-faint';
  if (change <= strongNegative) return 'heatmap-negative-strong';
  if (change <= negative) return 'heatmap-negative';
  if (change <= softNegative) return 'heatmap-negative-soft';
  if (change < 0) return 'heatmap-negative-faint';
  return 'heatmap-neutral';
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    target.isContentEditable
  );
}

function isTabId(value: string): value is TabId {
  return TAB_SEQUENCE.includes(value as TabId);
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
  const cryptoLabel = cryptoLatest?.classification?.trim() || fallback.cryptoLabel;

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
    ? 'Bank credit flow acceleration'
    : 'Bank credit flow deceleration';

  const delinquency = lastValue(payload.quarterlyBanking?.series?.DRALACBN, 1.47);
  const tier1 = lastValue(payload.quarterlyBanking?.series?.BOGZ1FL010000016Q, 14.17);

  const delinquencySeverity = delinquency >= 4 ? 3 : delinquency >= 3 ? 2 : delinquency >= 2 ? 1 : 0;
  const tier1Severity = tier1 < 8 ? 3 : tier1 < 10 ? 2 : tier1 < 12 ? 1 : 0;
  const ratioSeverity = loanDepositRatio > 85 || loanDepositRatio < 55 ? 2 : loanDepositRatio < 60 ? 1 : 0;
  const bankingSeverity = Math.max(delinquencySeverity, tier1Severity, ratioSeverity);

  let bankingTone: BankingTone = 'stable';
  let bankingLabel = 'Stable';
  if (bankingSeverity === 1) {
    bankingTone = 'watch';
    bankingLabel = 'Watch';
  } else if (bankingSeverity >= 2) {
    bankingTone = 'stress';
    bankingLabel = 'Stress';
  }

  const bankingSummary = `Delinq ${delinquency.toFixed(2)}% · Tier1 ${tier1.toFixed(2)}% · LDR ${loanDepositRatio.toFixed(1)}%`;

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
  const stressLabel = stressTone === 'low' ? 'Low Risk' : stressTone === 'medium' ? 'Guard' : 'High Risk';

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
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    if (typeof window === 'undefined') return 'overview';
    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    return requestedTab && isTabId(requestedTab) ? requestedTab : 'overview';
  });
  const [tabMotion, setTabMotion] = useState<TabMotion>('direct');
  const [activePeriod, setActivePeriod] = useState('1W');
  const [isPeriodMenuOpen, setIsPeriodMenuOpen] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardSnapshot>(DEFAULT_DASHBOARD);
  const [isDataConnected, setIsDataConnected] = useState(false);
  const [isRefreshingData, setIsRefreshingData] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [liveSourceStats, setLiveSourceStats] = useState<{ live: number; total: number }>({ live: 0, total: 0 });
  const [showSwipeHint, setShowSwipeHint] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem(SWIPE_HINT_DISMISS_KEY) !== '1';
    } catch {
      return true;
    }
  });
  const periodMenuRef = useRef<HTMLDivElement>(null);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const loadInFlightRef = useRef(false);
  const isMountedRef = useRef(true);

  const loadOverviewData = useCallback(async () => {
    if (loadInFlightRef.current) {
      return;
    }
    loadInFlightRef.current = true;
    setIsRefreshingData(true);

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

      const sourcePayloads = [
        fearGreed,
        vix,
        putCall,
        crypto,
        summaries,
        weeklyBanking,
        quarterlyBanking,
        dailyBanking,
        ...Object.values(sectorTicker),
        ...Object.values(indexTicker),
      ];
      const liveSourceCount = sourcePayloads.filter((payload) => payload !== null).length;

      if (!isMountedRef.current) {
        return;
      }

      setDashboard(nextSnapshot);
      setIsDataConnected(liveSourceCount > 0);
      setLiveSourceStats({
        live: liveSourceCount,
        total: sourcePayloads.length,
      });
      setLastSyncedAt(new Date().toISOString());
    } finally {
      loadInFlightRef.current = false;
      if (isMountedRef.current) {
        setIsRefreshingData(false);
      }
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
    const url = new URL(window.location.href);
    if (activeTab === 'overview') {
      url.searchParams.delete('tab');
    } else {
      url.searchParams.set('tab', activeTab);
    }
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, [activeTab]);

  useEffect(() => {
    if (!isPeriodMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!periodMenuRef.current) return;
      if (!periodMenuRef.current.contains(event.target as Node)) {
        setIsPeriodMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsPeriodMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isPeriodMenuOpen]);

  const dismissSwipeHint = useCallback(() => {
    setShowSwipeHint(false);
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(SWIPE_HINT_DISMISS_KEY, '1');
    } catch {
      // ignore storage failures
    }
  }, []);

  const selectTab = useCallback((nextTab: TabId) => {
    if (nextTab === activeTab) return;
    const currentIndex = TAB_SEQUENCE.indexOf(activeTab);
    const nextIndex = TAB_SEQUENCE.indexOf(nextTab);
    if (currentIndex >= 0 && nextIndex >= 0) {
      setTabMotion(nextIndex > currentIndex ? 'next' : 'prev');
    } else {
      setTabMotion('direct');
    }
    setActiveTab(nextTab);
  }, [activeTab]);

  const handleSwipeTabChange = useCallback((direction: 'next' | 'prev') => {
    const currentIndex = TAB_SEQUENCE.indexOf(activeTab);
    if (currentIndex < 0) return;
    const offset = direction === 'next' ? 1 : -1;
    const nextIndex = currentIndex + offset;
    if (nextIndex < 0 || nextIndex >= TAB_SEQUENCE.length) return;
    setTabMotion(direction);
    setActiveTab(TAB_SEQUENCE[nextIndex]);
    if (showSwipeHint) {
      dismissSwipeHint();
    }
  }, [activeTab, dismissSwipeHint, showSwipeHint]);

  const handleTabKeyNavigation = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>, currentTab: TabId) => {
    const currentIndex = TAB_SEQUENCE.indexOf(currentTab);
    if (currentIndex < 0) return;

    let targetIndex = currentIndex;
    if (event.key === 'ArrowRight') {
      targetIndex = Math.min(currentIndex + 1, TAB_SEQUENCE.length - 1);
    } else if (event.key === 'ArrowLeft') {
      targetIndex = Math.max(currentIndex - 1, 0);
    } else if (event.key === 'Home') {
      targetIndex = 0;
    } else if (event.key === 'End') {
      targetIndex = TAB_SEQUENCE.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextTab = TAB_SEQUENCE[targetIndex];
    if (!nextTab) return;

    selectTab(nextTab);
    window.requestAnimationFrame(() => {
      const tabButton = document.getElementById(TAB_BUTTON_IDS[nextTab]);
      if (tabButton instanceof HTMLButtonElement) {
        tabButton.focus();
      }
    });
  }, [selectTab]);

  const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
    const first = event.touches[0];
    if (!first) return;
    touchStartXRef.current = first.clientX;
    touchStartYRef.current = first.clientY;
  };

  const handleTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const first = event.changedTouches[0];
    if (!first || touchStartXRef.current === null || touchStartYRef.current === null) return;

    const deltaX = first.clientX - touchStartXRef.current;
    const deltaY = first.clientY - touchStartYRef.current;

    touchStartXRef.current = null;
    touchStartYRef.current = null;

    const horizontalIntent = Math.abs(deltaX) > 60 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2;
    if (!horizontalIntent) return;

    handleSwipeTabChange(deltaX < 0 ? 'next' : 'prev');
  };

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (!event.altKey || event.metaKey || event.ctrlKey) return;

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        handleSwipeTabChange('next');
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        handleSwipeTabChange('prev');
        return;
      }

      const numeric = Number(event.key);
      if (Number.isNaN(numeric) || numeric < 1 || numeric > TAB_SEQUENCE.length) return;
      event.preventDefault();
      const selected = TAB_SEQUENCE[numeric - 1];
      if (selected) selectTab(selected);
    };

    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  }, [handleSwipeTabChange, selectTab]);

  const sectorTopRows = [...dashboard.sectorRows]
    .sort((left, right) => right.displayChange - left.displayChange)
    .slice(0, 3);
  const spyIndex = dashboard.quickIndices.find((item) => item.symbol === 'SPY') ?? DEFAULT_DASHBOARD.quickIndices[0];
  const qqqIndex = dashboard.quickIndices.find((item) => item.symbol === 'QQQ') ?? DEFAULT_DASHBOARD.quickIndices[1];
  const activeTabIndex = TAB_SEQUENCE.indexOf(activeTab);
  const prevTab = activeTabIndex > 0 ? TAB_SEQUENCE[activeTabIndex - 1] : null;
  const nextTab = activeTabIndex >= 0 && activeTabIndex < TAB_SEQUENCE.length - 1 ? TAB_SEQUENCE[activeTabIndex + 1] : null;
  const sectorPanelModeLabel = dashboard.sectorMode === 'LIVE_1D'
    ? `LIVE 1D · ${dashboard.sectorLiveCount}/${dashboard.sectorRows.length} sectors`
    : dashboard.sectorMode === 'MIXED'
      ? `MIXED · ${dashboard.sectorLiveCount}/${dashboard.sectorRows.length} live`
      : 'BASE 1M · Treemap by Market Cap';
  const sectorPanelMetaClass = dashboard.sectorMode === 'LIVE_1D'
    ? 'is-live'
    : dashboard.sectorMode === 'MIXED'
      ? 'is-mixed'
      : 'is-fallback';
  const sectorPanelTimestamp = dashboard.sectorMode !== 'BASE_1M'
    ? formatTimeLabel(dashboard.tickerFetchedAt)
    : '--';

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
  const regimeLabel = regimeScore >= 0.62 ? 'RISK-ON' : regimeScore >= 0.45 ? 'BALANCED' : 'RISK-OFF';
  const regimeClass = regimeScore >= 0.62 ? 'is-risk-on' : regimeScore >= 0.45 ? 'is-balanced' : 'is-risk-off';
  const regimeConfidence = Math.round(regimeScore * 100);

  const liquidityPillClass = dashboard.liquidityFlow >= 0 ? 'is-positive' : 'is-negative';
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

  const tabPanelModeLabel = isDataConnected ? 'LIVE DATA' : 'FALLBACK';
  const commandSyncLabel = lastSyncedAt ? formatTimeLabel(lastSyncedAt) : '--';
  const commandSourceCoverage = liveSourceStats.total > 0
    ? `${liveSourceStats.live}/${liveSourceStats.total}`
    : '--';

  return (
    <main className="container mx-auto overflow-x-hidden px-3 py-3 sm:px-4 sm:py-4">
      <section className="command-toolbar" role="toolbar" aria-label="Dashboard controls">
        <div className="command-main">
          <div className="tab-pills tab-pills-compact" role="tablist" aria-label="View tabs">
            <button
              id={TAB_BUTTON_IDS.overview}
              type="button"
              role="tab"
              aria-selected={activeTab === 'overview'}
              aria-controls={TAB_PANEL_IDS.overview}
              tabIndex={activeTab === 'overview' ? 0 : -1}
              className={`tab-pill ${activeTab === 'overview' ? 'active' : ''}`}
              onClick={() => selectTab('overview')}
              onKeyDown={(event) => handleTabKeyNavigation(event, 'overview')}
            >
              Overview
            </button>
            <button
              id={TAB_BUTTON_IDS.sectors}
              type="button"
              role="tab"
              aria-selected={activeTab === 'sectors'}
              aria-controls={TAB_PANEL_IDS.sectors}
              tabIndex={activeTab === 'sectors' ? 0 : -1}
              className={`tab-pill ${activeTab === 'sectors' ? 'active' : ''}`}
              onClick={() => selectTab('sectors')}
              onKeyDown={(event) => handleTabKeyNavigation(event, 'sectors')}
            >
              Sectors
            </button>
            <button
              id={TAB_BUTTON_IDS.liquidity}
              type="button"
              role="tab"
              aria-selected={activeTab === 'liquidity'}
              aria-controls={TAB_PANEL_IDS.liquidity}
              tabIndex={activeTab === 'liquidity' ? 0 : -1}
              className={`tab-pill ${activeTab === 'liquidity' ? 'active' : ''}`}
              onClick={() => selectTab('liquidity')}
              onKeyDown={(event) => handleTabKeyNavigation(event, 'liquidity')}
            >
              Liquidity
            </button>
            <button
              id={TAB_BUTTON_IDS.sentiment}
              type="button"
              role="tab"
              aria-selected={activeTab === 'sentiment'}
              aria-controls={TAB_PANEL_IDS.sentiment}
              tabIndex={activeTab === 'sentiment' ? 0 : -1}
              className={`tab-pill ${activeTab === 'sentiment' ? 'active' : ''}`}
              onClick={() => selectTab('sentiment')}
              onKeyDown={(event) => handleTabKeyNavigation(event, 'sentiment')}
            >
              Sentiment
            </button>
          </div>

          <div className="period-menu-wrap" ref={periodMenuRef}>
            <button
              type="button"
              className="period-trigger"
              aria-haspopup="menu"
              aria-expanded={isPeriodMenuOpen}
              onClick={() => setIsPeriodMenuOpen((prev) => !prev)}
            >
              <i className="fas fa-calendar-days" aria-hidden="true" />
              <span>{activePeriod}</span>
              <i
                className={`fas fa-chevron-down text-[10px] transition-transform ${isPeriodMenuOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>

            {isPeriodMenuOpen && (
              <div className="period-menu" role="menu" aria-label="Time period">
                {periods.map((period) => (
                  <button
                    type="button"
                    key={period}
                    role="menuitemradio"
                    aria-checked={activePeriod === period}
                    className={`period-option ${activePeriod === period ? 'active' : ''}`}
                    onClick={() => {
                      setActivePeriod(period);
                      setIsPeriodMenuOpen(false);
                    }}
                  >
                    {period}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="command-meta" aria-live="polite">
          <span className={`command-live-pill ${isDataConnected ? 'is-live' : 'is-fallback'}`}>
            {isDataConnected ? 'LIVE DATA' : 'FALLBACK DATA'}
          </span>
          <span className="command-meta-chip">Sources {commandSourceCoverage}</span>
          <span className="command-meta-chip">Updated {commandSyncLabel}</span>
          <button
            type="button"
            className="command-refresh-btn"
            onClick={() => {
              void loadOverviewData();
            }}
            disabled={isRefreshingData}
            aria-label="데이터 새로고침"
          >
            <i className={`fas fa-rotate-right ${isRefreshingData ? 'is-spinning' : ''}`} aria-hidden="true" />
            <span>{isRefreshingData ? 'Syncing' : 'Refresh'}</span>
          </button>
        </div>
      </section>

      <div className="tab-scene-status sm:hidden" aria-live="polite">
        <span className="tab-scene-status-step">{activeTabIndex + 1}/{TAB_SEQUENCE.length}</span>
        <strong className="tab-scene-status-title">{TAB_LABELS[activeTab]}</strong>
        <span className="tab-scene-status-neighbor">
          {prevTab ? `← ${TAB_LABELS[prevTab]}` : '←'}
          {' · '}
          {nextTab ? `${TAB_LABELS[nextTab]} →` : '→'}
        </span>
      </div>

      {showSwipeHint ? (
        <button
          type="button"
          className="mb-2 px-1 text-[11px] font-semibold text-slate-500 sm:hidden"
          onClick={dismissSwipeHint}
          aria-label="스와이프 안내 닫기"
        >
          좌우 스와이프로 탭 전환
        </button>
      ) : null}

      <section
        key={activeTab}
        id={TAB_PANEL_IDS[activeTab]}
        role="tabpanel"
        aria-labelledby={TAB_BUTTON_IDS[activeTab]}
        className={`tab-scene tab-scene-${tabMotion}`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {activeTab === 'overview' && (
          <>
            <Link
              href="/posts/2026-02-21_tariff-ruling-comprehensive.html"
              className="group block w-full rounded-2xl overflow-hidden mb-4
                        bg-gradient-to-r from-red-50 via-amber-50/80 to-slate-50
                        border border-red-200/50 hover:border-amber-300/70
                        shadow-sm hover:shadow-lg transition-all duration-300"
            >
              <div className="flex items-start gap-3 px-3 py-3 sm:items-center sm:gap-4 sm:px-5 sm:py-4">
                <span className="text-2xl flex-shrink-0">&#9878;</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider
                                     bg-red-100 text-red-700 px-2 py-0.5 rounded-full
                                     animate-pulse">Breaking</span>
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

            <div className="hero-zone min-w-0">
              <div className="bento-card p-4">
                <h3 className="text-xs font-bold text-slate-600 tracking-widest mb-2 orbitron">FEAR &amp; GREED</h3>
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
              </div>

              <div className="bento-card p-4">
                <h3 className="text-xs font-bold text-slate-600 tracking-widest mb-2 orbitron">MARKET REGIME</h3>
                <div className="flex items-center justify-between">
                  <div className={`regime-badge ${regimeClass}`}>
                    <i className="fas fa-rocket text-xs" />
                    <span>{regimeLabel}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-600">Confidence</p>
                    <p className="text-xl font-bold text-emerald-800 orbitron">{regimeConfidence}%</p>
                  </div>
                </div>
              </div>

              <div className="bento-card p-4 quick-indices-card">
                <h3 className="text-xs font-bold text-slate-600 tracking-widest mb-2 orbitron">QUICK INDICES</h3>
                <div className="quick-indices-scroll">
                  <div className="index-item">
                    <span className="text-xs text-slate-600">SPY</span>
                    <svg className="sparkline" viewBox="0 0 60 20" aria-hidden="true"><polyline fill="none" stroke="#22c55e" strokeWidth="1.5" points="0,16 10,14 20,12 30,10 40,11 50,6 60,4" /></svg>
                    <span className={`font-bold text-sm ${spyIndex.change >= 0 ? 'text-emerald-800' : 'text-red-700'}`}>
                      {formatSignedPercentDecimal(spyIndex.change)}
                    </span>
                    <span className="index-live-detail">{spyIndex.price !== null ? `$${spyIndex.price.toFixed(2)} · ` : ''}{spyIndex.displayHorizon}</span>
                  </div>
                  <div className="index-item">
                    <span className="text-xs text-slate-600">QQQ</span>
                    <svg className="sparkline" viewBox="0 0 60 20" aria-hidden="true"><polyline fill="none" stroke="#22c55e" strokeWidth="1.5" points="0,18 10,16 20,12 30,10 40,8 50,6 60,3" /></svg>
                    <span className={`font-bold text-sm ${qqqIndex.change >= 0 ? 'text-emerald-800' : 'text-red-700'}`}>
                      {formatSignedPercentDecimal(qqqIndex.change)}
                    </span>
                    <span className="index-live-detail">{qqqIndex.price !== null ? `$${qqqIndex.price.toFixed(2)} · ` : ''}{qqqIndex.displayHorizon}</span>
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

            <div className="overview-widget-grid mb-4">
              <article className="overview-widget-card overview-widget-card--sector">
                <header className="overview-widget-head">
                  <div>
                    <p className="overview-widget-kicker orbitron">SECTOR SNAPSHOT</p>
                    <h3 className="overview-widget-subtitle">Breadth Expansion</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => selectTab('sectors')}
                    className="overview-widget-action"
                    aria-label="섹터 히트맵 보기"
                  >
                    Heatmap
                  </button>
                </header>
                <div className="overview-breadth">
                  <div className="overview-breadth-ledger">
                    <span className="overview-dot is-up" aria-hidden="true" />
                    <span className="overview-breadth-value">{dashboard.sectorUp} Up</span>
                    <span className="overview-dot is-down" aria-hidden="true" />
                    <span className="overview-breadth-value is-down">{dashboard.sectorDown} Down</span>
                  </div>
                  <div className="overview-chip-row">
                    {sectorTopRows.map((sector) => (
                      <span key={sector.key} className={`overview-chip ${sector.displayChange >= 0 ? 'is-up' : 'is-down'}`}>
                        {sector.etf} {formatSignedPercentDecimal(sector.displayChange, 1)}
                        <em className="overview-chip-horizon">{sector.displayHorizon}</em>
                      </span>
                    ))}
                  </div>
                </div>
              </article>

              <article className="overview-widget-card overview-widget-card--liquidity">
                <header className="overview-widget-head">
                  <div>
                    <p className="overview-widget-kicker orbitron">LIQUIDITY FLOW</p>
                    <h3 className="overview-widget-subtitle">Funding Pulse</h3>
                  </div>
                  <span className={`overview-status-pill ${liquidityPillClass}`}>
                    {dashboard.liquidityFlow >= 0 ? 'WoW +' : 'WoW -'}
                  </span>
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
                <button
                  type="button"
                  onClick={() => selectTab('liquidity')}
                  className="overview-widget-link"
                  aria-label="Liquidity 탭 열기"
                >
                  Open Liquidity Console
                </button>
              </article>

              <article className="overview-widget-card overview-widget-card--sentiment">
                <header className="overview-widget-head">
                  <div>
                    <p className="overview-widget-kicker orbitron">SENTIMENT</p>
                    <h3 className="overview-widget-subtitle">Risk Appetite</h3>
                  </div>
                  <span className={`overview-status-pill ${isDataConnected ? 'is-positive' : ''}`}>{isDataConnected ? 'Live' : 'Fallback'}</span>
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
                <button
                  type="button"
                  onClick={() => selectTab('sentiment')}
                  className="overview-widget-link"
                  aria-label="Sentiment 탭 열기"
                >
                  Open Sentiment Console
                </button>
              </article>
            </div>

            <div className="overview-widget-grid overview-widget-grid--secondary">
              <article className="overview-widget-card overview-widget-card--banking">
                <header className="overview-widget-head">
                  <div>
                    <p className="overview-widget-kicker orbitron">BANKING HEALTH</p>
                    <h3 className="overview-widget-subtitle">Funding Stress Guard</h3>
                  </div>
                </header>
                <div className="overview-health-row">
                  <span className={`overview-pulse-dot ${bankingDotClass}`} aria-hidden="true" />
                  <strong>{dashboard.bankingLabel}</strong>
                </div>
                <p className="overview-metric-sub">{dashboard.bankingSummary}</p>
              </article>

              <article className="overview-widget-card overview-widget-card--stress">
                <header className="overview-widget-head">
                  <div>
                    <p className="overview-widget-kicker orbitron">STRESS INDEX</p>
                    <h3 className="overview-widget-subtitle">Spread Monitor</h3>
                  </div>
                  <span className={`overview-status-pill ${stressPillClass}`}>{dashboard.stressLabel}</span>
                </header>
                <div className="overview-health-row">
                  <strong className="overview-metric-main orbitron">{dashboard.stressScore.toFixed(2)}</strong>
                </div>
                <p className="overview-metric-sub">HY {formatPercent(dashboard.hySpread, 2)} · UST10Y {formatPercent(dashboard.tenYearYield, 2)}</p>
              </article>
            </div>
          </>
        )}

        {activeTab === 'sectors' && (
          <div className="heatmap-panel">
            <div className="heatmap-panel-head">
              <div>
                <p className="heatmap-panel-kicker orbitron">SECTOR HEATMAP</p>
                <h3 className="heatmap-panel-title">Market Cap Weighted Map</h3>
              </div>
              <span className={`heatmap-panel-meta ${sectorPanelMetaClass}`}>
                {sectorPanelModeLabel}
                {dashboard.sectorMode !== 'BASE_1M' && sectorPanelTimestamp !== '--' ? ` · ${sectorPanelTimestamp}` : ''}
              </span>
            </div>
            <div className="heatmap-legend" aria-label="섹터 히트맵 범례">
              <span className="heatmap-legend-chip is-risk-on">Risk-On</span>
              <span className="heatmap-legend-chip is-neutral">Neutral</span>
              <span className="heatmap-legend-chip is-risk-off">Risk-Off</span>
            </div>
            <div className="heatmap-grid">
              {dashboard.sectorRows.map((sector) => {
                const pinClass = sector.etf === 'XLK' ? 'xlk' : sector.etf === 'XLF' ? 'xlf' : '';
                const marketStateMeta = getMarketStateMeta(sector.marketState);
                return (
                  <div key={sector.key} className={`heatmap-cell ${pinClass} ${getHeatmapToneClass(sector.displayChange, sector.displayHorizon)}`}>
                    <span className="font-bold text-lg">{sector.etf}</span>
                    <span className="text-xs">{sector.name}</span>
                    <span className="font-bold text-xs">{formatSignedPercentDecimal(sector.displayChange)}</span>
                    <span className="heatmap-cell-horizon">{sector.displayHorizon}</span>
                    {sector.quotePrice !== null ? (
                      <span className="heatmap-cell-price">${sector.quotePrice.toFixed(2)}</span>
                    ) : null}
                    {marketStateMeta ? (
                      <span className={`market-state-badge heatmap-market-state ${marketStateMeta.className}`}>
                        {marketStateMeta.label}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'liquidity' && (
          <section className="insight-tab-panel">
            <header className="insight-tab-head">
              <div>
                <p className="insight-tab-kicker orbitron">LIQUIDITY DETAIL</p>
                <h3 className="insight-tab-title">Flow Engine Console</h3>
              </div>
              <span className={`insight-tab-badge ${isDataConnected ? 'is-live' : 'is-fallback'}`}>{tabPanelModeLabel}</span>
            </header>
            <div className="insight-tab-metrics">
              <article className="insight-tab-metric-card">
                <span>Loan Flow WoW</span>
                <strong>{formatSignedBillions(dashboard.liquidityFlow)}</strong>
              </article>
              <article className="insight-tab-metric-card">
                <span>Loan/Deposit</span>
                <strong>{formatPercent(dashboard.loanDepositRatio)}</strong>
              </article>
              <article className="insight-tab-metric-card">
                <span>Banking Tone</span>
                <strong>{dashboard.bankingLabel}</strong>
              </article>
            </div>
            <div className="insight-tab-frame">
              <WidgetConsoleFrame
                src="/tools/macro-monitor/widgets/liquidity-flow.html"
                title="Liquidity Flow"
                widgetId="liquidity-flow"
                timeoutMs={12000}
              />
            </div>
          </section>
        )}

        {activeTab === 'sentiment' && (
          <section className="insight-tab-panel insight-tab-panel--sentiment">
            <header className="insight-tab-head">
              <div>
                <p className="insight-tab-kicker orbitron">SENTIMENT DETAIL</p>
                <h3 className="insight-tab-title">Risk Monitor Console</h3>
              </div>
              <span className={`insight-tab-badge ${isDataConnected ? 'is-live' : 'is-fallback'}`}>{tabPanelModeLabel}</span>
            </header>
            <div className="insight-tab-metrics">
              <article className="insight-tab-metric-card">
                <span>VIX</span>
                <strong>{dashboard.vixValue.toFixed(2)}</strong>
              </article>
              <article className="insight-tab-metric-card">
                <span>Put/Call</span>
                <strong>{dashboard.putCallValue.toFixed(2)}</strong>
              </article>
              <article className="insight-tab-metric-card">
                <span>CNN F&amp;G</span>
                <strong>{Math.round(dashboard.fearGreedScore)}</strong>
              </article>
            </div>
            <div className="insight-tab-frame">
              <WidgetConsoleFrame
                src="/tools/macro-monitor/widgets/sentiment-signal.html"
                title="Sentiment Signal"
                widgetId="sentiment-signal"
                timeoutMs={12000}
              />
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
