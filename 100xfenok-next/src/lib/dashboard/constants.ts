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

export const QUICK_INDEX_DEFINITIONS: QuickIndexDefinition[] = [
  { symbol: 'SPY', fallback: 0.0085 },
  { symbol: 'QQQ', fallback: 0.0112 },
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
  fearGreedScore: 72,
  fearGreedLabel: '탐욕',
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
