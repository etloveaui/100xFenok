export type NumberPoint = {
  date: string;
  value: number;
};

export type CnnFearGreedPoint = {
  date: string;
  score: number;
};

export type PutCallPoint = {
  date: string;
  value: number;
  rating?: string;
};

export type CryptoFearGreedPoint = {
  date: string;
  value: number;
  classification?: string;
};

export type BenchmarksSummaryPayload = {
  momentum?: Record<string, { '1m'?: number }>;
};

export type FredSeriesPayload = {
  series?: Record<string, NumberPoint[]>;
};

export type TickerQuotePayload = {
  symbol?: string;
  price?: number;
  changePercent?: number;
  marketState?: string;
  fetchedAt?: string;
  source?: string;
};

export type SectorTickerMap = Record<string, TickerQuotePayload | null>;

export type SectorDefinition = {
  key: string;
  etf: string;
  name: string;
  fallback: number;
};

export type QuickIndexDefinition = {
  symbol: 'SPY' | 'QQQ';
  fallback: number;
};

export type SectorSnapshot = {
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

export type QuickIndexSnapshot = {
  symbol: 'SPY' | 'QQQ';
  price: number | null;
  change: number;
  displayHorizon: '1D' | 'BASE';
  marketState: string | null;
};

export type LiquidityBar = {
  delta: number;
  height: number;
};

export type BankingTone = 'stable' | 'watch' | 'stress';
export type StressTone = 'low' | 'medium' | 'high';

export type DashboardSnapshot = {
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
