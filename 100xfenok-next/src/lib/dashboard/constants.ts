import type {
  SectorDefinition,
  QuickIndexDefinition,
  DashboardSnapshot,
  DashboardFreshnessCadence,
  DashboardFreshnessMap,
  DashboardSourceFreshness,
} from './types';

export const CLIENT_FETCH_TIMEOUT_MS = 2500;
export const FOCUS_REFRESH_STALE_MS = 3 * 60 * 1000;

export const SECTOR_DEFINITIONS: SectorDefinition[] = [
  { key: 'information_technology', etf: 'XLK', name: '정보기술', fallback: 0 },
  { key: 'financials', etf: 'XLF', name: '금융', fallback: 0 },
  { key: 'health_care', etf: 'XLV', name: '헬스케어', fallback: 0 },
  { key: 'energy', etf: 'XLE', name: '에너지', fallback: 0 },
  { key: 'industrials', etf: 'XLI', name: '산업재', fallback: 0 },
  { key: 'communication_services', etf: 'XLC', name: '커뮤니케이션', fallback: 0 },
  { key: 'consumer_discretionary', etf: 'XLY', name: '자유소비재', fallback: 0 },
  { key: 'consumer_staples', etf: 'XLP', name: '필수소비재', fallback: 0 },
  { key: 'real_estate', etf: 'XLRE', name: '부동산', fallback: 0 },
  { key: 'materials', etf: 'XLB', name: '소재', fallback: 0 },
  { key: 'utilities', etf: 'XLU', name: '유틸리티', fallback: 0 },
];

export const QUICK_INDEX_DEFINITIONS: QuickIndexDefinition[] = [
  { symbol: 'SPY' },
  { symbol: 'QQQ' },
  { symbol: 'DIA' },
];

function fallbackFreshness(cadence: DashboardFreshnessCadence): DashboardSourceFreshness {
  return {
    cadence,
    updatedAt: null,
    isFallback: true,
  };
}

function createDefaultFreshnessMap(): DashboardFreshnessMap {
  const tickerSymbols = Array.from(new Set([
    ...SECTOR_DEFINITIONS.map((sector) => sector.etf),
    ...QUICK_INDEX_DEFINITIONS.map((item) => item.symbol),
  ]));

  const tickerFreshness = Object.fromEntries(
    tickerSymbols.map((symbol) => [`ticker:${symbol}`, fallbackFreshness('realtime')]),
  );

  return {
    sentiment: fallbackFreshness('daily'),
    vix: fallbackFreshness('daily'),
    putCall: fallbackFreshness('daily'),
    crypto: fallbackFreshness('daily'),
    benchmarks: fallbackFreshness('daily'),
    weeklyBanking: fallbackFreshness('weekly'),
    quarterlyBanking: fallbackFreshness('quarterly'),
    dailyBanking: fallbackFreshness('daily'),
    ...tickerFreshness,
  };
}

export const DEFAULT_DASHBOARD: DashboardSnapshot = {
  judgmentInputsReady: false,
  sectorInputsReady: false,
  fearGreedScore: 0,
  fearGreedLabel: '데이터 대기',
  freshness: createDefaultFreshnessMap(),
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
  sectorUp: 0,
  sectorDown: 0,
  sectorMode: 'BASE_1M',
  sectorLiveCount: 0,
  tickerFetchedAt: null,
  quickIndices: QUICK_INDEX_DEFINITIONS.map((item) => ({
    symbol: item.symbol,
    price: null,
    change: 0,
    displayHorizon: 'BASE',
    marketState: null,
    fetchedAt: null,
    isLive: false,
  })),
  liquidityFlow: 0,
  liquidityFlowLabel: '데이터 대기',
  liquidityBars: [],
  loanDepositRatio: 0,
  vixValue: 0,
  vixLabel: '데이터 대기',
  vixHistory: [],
  putCallValue: 0,
  putCallLabel: '데이터 대기',
  cryptoFearGreed: 0,
  cryptoLabel: '데이터 대기',
  bankingTone: 'stable',
  bankingLabel: '데이터 대기',
  bankingSummary: '데이터 대기',
  stressScore: 0,
  stressTone: 'low',
  stressLabel: '데이터 대기',
  tenYearYield: 0,
  hySpread: 0,
};
