import type {
  CnnFearGreedPoint,
  NumberPoint,
  PutCallPoint,
  CryptoFearGreedPoint,
  BenchmarksSummaryPayload,
  FredSeriesPayload,
  TickerQuotePayload,
  SectorTickerMap,
  SectorSnapshot,
  QuickIndexSnapshot,
  BankingTone,
  DashboardSnapshot,
  DashboardFreshnessMap,
  DashboardFreshnessCadence,
} from './types';
import { SECTOR_DEFINITIONS, QUICK_INDEX_DEFINITIONS, DEFAULT_DASHBOARD } from './constants';
import {
  safeNumber,
  lastValue,
  average,
  clamp,
  getFearGreedLabel,
  getVixLabel,
  getPutCallLabel,
  getCryptoLabel,
  getStressTone,
} from './formatters';

function cloneFreshnessMap(seed: DashboardFreshnessMap): DashboardFreshnessMap {
  return Object.fromEntries(
    Object.entries(seed).map(([source, meta]) => [source, { ...meta }]),
  );
}

function pickTimestamp(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function pickLatestPointDate<T extends { date?: string }>(series: T[] | null | undefined): string | null {
  if (!Array.isArray(series) || series.length === 0) {
    return null;
  }
  return pickTimestamp(series[series.length - 1]?.date);
}

function hasFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasNumberSeries(series: NumberPoint[] | undefined): boolean {
  return Array.isArray(series) && series.some((point) => hasFiniteNumber(point?.value));
}

function hasFearGreedSeries(series: CnnFearGreedPoint[] | null): boolean {
  return Array.isArray(series) && series.some((point) => hasFiniteNumber(point?.score));
}

function hasPutCallSeries(series: PutCallPoint[] | null): boolean {
  return Array.isArray(series) && series.some((point) => hasFiniteNumber(point?.value));
}

function hasCryptoSeries(series: CryptoFearGreedPoint[] | null): boolean {
  return Array.isArray(series) && series.some((point) => hasFiniteNumber(point?.value));
}

function hasBenchmarkMomentum(payload: BenchmarksSummaryPayload | null): boolean {
  return !!payload?.momentum && Object.keys(payload.momentum).length > 0;
}

function hasRequiredFredSeries(payload: FredSeriesPayload | null, keys: string[]): boolean {
  if (!payload?.series) {
    return false;
  }
  return keys.every((key) => hasNumberSeries(payload.series?.[key]));
}

function pickFredUpdatedAt(payload: FredSeriesPayload | null, keys: string[]): string | null {
  const payloadUpdated = pickTimestamp(payload?.updated);
  if (payloadUpdated) {
    return payloadUpdated;
  }

  return keys
    .map((key) => pickLatestPointDate(payload?.series?.[key]))
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1) ?? null;
}

function hasTickerData(ticker: TickerQuotePayload | null | undefined): boolean {
  return hasFiniteNumber(ticker?.price)
    || hasFiniteNumber(ticker?.changePercent)
    || pickTimestamp(ticker?.fetchedAt) !== null;
}

function setFreshnessEntry(
  freshness: DashboardFreshnessMap,
  source: string,
  cadence: DashboardFreshnessCadence,
  updatedAt: string | null,
  isFallback: boolean,
) {
  freshness[source] = {
    cadence,
    updatedAt,
    isFallback,
  };
}

export function buildDashboardSnapshot(payload: {
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
  const freshness = cloneFreshnessMap(fallback.freshness);

  setFreshnessEntry(
    freshness,
    'sentiment',
    'daily',
    pickLatestPointDate(payload.fearGreed),
    !hasFearGreedSeries(payload.fearGreed),
  );
  setFreshnessEntry(
    freshness,
    'vix',
    'daily',
    pickLatestPointDate(payload.vix),
    !hasNumberSeries(payload.vix ?? undefined),
  );
  setFreshnessEntry(
    freshness,
    'putCall',
    'daily',
    pickLatestPointDate(payload.putCall),
    !hasPutCallSeries(payload.putCall),
  );
  setFreshnessEntry(
    freshness,
    'crypto',
    'daily',
    pickLatestPointDate(payload.crypto),
    !hasCryptoSeries(payload.crypto),
  );
  setFreshnessEntry(
    freshness,
    'benchmarks',
    'daily',
    pickTimestamp(payload.summaries?.metadata?.generated) ?? pickTimestamp(payload.summaries?.metadata?.version),
    !hasBenchmarkMomentum(payload.summaries),
  );
  setFreshnessEntry(
    freshness,
    'weeklyBanking',
    'weekly',
    pickFredUpdatedAt(payload.weeklyBanking, ['TOTLL', 'DPSACBW027SBOG']),
    !hasRequiredFredSeries(payload.weeklyBanking, ['TOTLL', 'DPSACBW027SBOG']),
  );
  setFreshnessEntry(
    freshness,
    'quarterlyBanking',
    'quarterly',
    pickFredUpdatedAt(payload.quarterlyBanking, ['DRALACBN', 'BOGZ1FL010000016Q']),
    !hasRequiredFredSeries(payload.quarterlyBanking, ['DRALACBN', 'BOGZ1FL010000016Q']),
  );
  setFreshnessEntry(
    freshness,
    'dailyBanking',
    'daily',
    pickFredUpdatedAt(payload.dailyBanking, ['DGS10', 'BAMLH0A0HYM2']),
    !hasRequiredFredSeries(payload.dailyBanking, ['DGS10', 'BAMLH0A0HYM2']),
  );

  const tickerEntries = new Map<string, TickerQuotePayload | null>();
  Object.entries(payload.sectorTicker).forEach(([symbol, ticker]) => {
    tickerEntries.set(symbol, ticker);
  });
  Object.entries(payload.indexTicker).forEach(([symbol, ticker]) => {
    tickerEntries.set(symbol, ticker);
  });
  tickerEntries.forEach((ticker, symbol) => {
    setFreshnessEntry(
      freshness,
      `ticker:${symbol}`,
      'realtime',
      pickTimestamp(ticker?.fetchedAt),
      !hasTickerData(ticker),
    );
  });

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
    freshness,
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
