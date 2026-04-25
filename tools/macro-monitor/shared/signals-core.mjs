/**
 * Macro Monitor computed signal core.
 *
 * This module is browser-safe and Node-safe. It owns deterministic formulas,
 * thresholds, and signal status rules used by Macro Monitor widgets and
 * data/computed/signals.json export.
 */

export const THRESHOLDS = Object.freeze({
  M2_YOY: {
    POSITIVE: 6,
    NEUTRAL: 2,
    NEGATIVE: 2
  },
  NET_LIQUIDITY: {
    POSITIVE: 50,
    NEUTRAL: 50,
    NEGATIVE: -50
  },
  STABLECOIN: {
    POSITIVE: 1.5,
    NEUTRAL: 1.0,
    NEGATIVE: 1.0
  },
  NET_LIQ_TRILLION: {
    POSITIVE: 6,
    NEUTRAL: 5
  },
  SPREAD: {
    NORMAL: 10,
    CAUTION: 20,
    WARNING: 30,
    DANGER: 30
  },
  RESERVES_GDP: {
    NORMAL: 12,
    CAUTION: 10,
    WARNING: 8,
    DANGER: 8
  },
  OVERALL: {
    EXPANDING: { netLiq: 50, m2YoY: 4 },
    CONTRACTING: { netLiq: -50, m2YoY: 2 }
  },
  DELINQUENCY: {
    NORMAL: 2,
    CAUTION: 3,
    WARNING: 4,
    DANGER: 4
  },
  TIER1_RATIO: {
    NORMAL: 12,
    CAUTION: 10,
    WARNING: 8,
    DANGER: 8
  },
  LOAN_DEPOSIT: {
    NORMAL_HIGH: 85,
    NORMAL_LOW: 60,
    CAUTION: 60,
    WARNING: 55
  },
  LOAN_GROWTH: {
    POSITIVE: 5,
    NEUTRAL: 0,
    NEGATIVE: 0
  }
});

export const STATUS = Object.freeze({
  LIQUIDITY_FLOW: {
    RISING: 'rising',
    STABLE: 'stable',
    FALLING: 'falling'
  },
  LIQUIDITY_STRESS: {
    NORMAL: 'normal',
    CAUTION: 'caution',
    WARNING: 'warning',
    DANGER: 'danger'
  }
});

export const SENTIMENT = Object.freeze({
  THRESHOLDS: {
    VIX: {
      EXTREME_FEAR: 40,
      FEAR: 30,
      NEUTRAL_LOW: 15,
      GREED: 12
    },
    CNN: {
      EXTREME_FEAR: 15,
      FEAR: 25,
      NEUTRAL_HIGH: 75,
      EXTREME_GREED: 85
    },
    CFTC: {
      EXTREME_SHORT: -180000,
      SHORT: -100000,
      LONG: 100000,
      EXTREME_LONG: 180000
    },
    MOVE: {
      STABLE: 60,
      NEUTRAL: 80,
      STRESS: 120,
      CRISIS: 150
    },
    CRYPTO: {
      EXTREME_FEAR: 10,
      FEAR: 25,
      NEUTRAL: 45,
      GREED: 75
    }
  },
  BOTTOM_CHECKS: {
    VIX: { threshold: 30, ideal: 40, compare: 'gte', label: 'VIX > 30' },
    CNN: { threshold: 25, compare: 'lte', label: 'CNN F&G < 25' },
    CFTC: { threshold: -150000, compare: 'lte', label: 'CFTC Net < -150K' },
    MOVE: { threshold: 60, compare: 'lte', label: 'MOVE < 60' },
    CRYPTO: { threshold: 20, compare: 'lte', label: 'Crypto F&G < 20' }
  },
  SCORE_RANGES: {
    EXTREME_FEAR: { min: -8, max: -5 },
    FEAR: { min: -4, max: -1 },
    NEUTRAL: { min: 0, max: 0 },
    GREED: { min: 1, max: 4 },
    EXTREME_GREED: { min: 5, max: 8 }
  },
  COLORS: {
    EXTREME_FEAR: '#7c2d12',
    FEAR: '#dc2626',
    NEUTRAL: '#f59e0b',
    GREED: '#16a34a',
    EXTREME_GREED: '#15803d'
  },
  LABELS: {
    EXTREME_FEAR: 'Extreme Fear',
    FEAR: 'Fear',
    NEUTRAL: 'Neutral',
    GREED: 'Greed',
    EXTREME_GREED: 'Extreme Greed'
  },
  GROUPS: {
    MARKET_FG: {
      name: 'Market F&G',
      indicators: ['cnn', 'aaii', 'cftc']
    },
    VOLATILITY: {
      name: 'Volatility',
      indicators: ['vix', 'move']
    },
    CRYPTO: {
      name: 'Crypto',
      indicators: ['crypto']
    },
    CNN_COMPONENTS: {
      name: 'CNN 7 Components',
      indicators: ['cnn_components']
    }
  }
});

export const COMBO_SIGNALS = Object.freeze([
  {
    id: 'vix-panic',
    name: 'VIX Panic Buy',
    category: 'buy',
    conditions: [{ indicator: 'vix', operator: '>=', value: 40, label: 'VIX >= 40' }],
    winRate: '~100%',
    avgReturn: '+35%',
    sampleSize: '20y+',
    priority: 5
  },
  {
    id: 'aaii-extreme',
    name: 'AAII Extreme Bear',
    category: 'buy',
    conditions: [{ indicator: 'aaii_bearish', operator: '>=', value: 60, label: 'Bearish >= 60%' }],
    winRate: '100%',
    avgReturn: '+27%',
    sampleSize: '1987+',
    priority: 5
  },
  {
    id: 'cnn-extreme-fear',
    name: 'CNN Extreme Fear',
    category: 'buy',
    conditions: [{ indicator: 'cnn_fg', operator: '<=', value: 10, label: 'F&G <= 10' }],
    winRate: '~90%',
    avgReturn: '+20%',
    sampleSize: '2011+',
    priority: 4
  },
  {
    id: 'triple-fear',
    name: 'Triple Fear',
    category: 'buy',
    conditions: [
      { indicator: 'vix', operator: '>=', value: 30, label: 'VIX >= 30' },
      { indicator: 'cnn_fg', operator: '<=', value: 25, label: 'CNN <= 25' },
      { indicator: 'cftc_net', operator: '<', value: -150000, label: 'CFTC < -150K' }
    ],
    winRate: '~85%',
    avgReturn: '+25%',
    sampleSize: '2011+',
    priority: 4
  },
  {
    id: 'fear-consensus',
    name: 'Fear Consensus',
    category: 'buy',
    conditions: [
      { indicator: 'vix', operator: '>=', value: 30, label: 'VIX >= 30' },
      { indicator: 'cnn_fg', operator: '<=', value: 25, label: 'CNN <= 25' }
    ],
    winRate: '84%',
    avgReturn: '+20%',
    sampleSize: '2011+',
    priority: 4
  },
  {
    id: 'aaii-spread-panic',
    name: 'AAII Spread Panic',
    category: 'buy',
    conditions: [{ indicator: 'aaii_spread', operator: '<=', value: -30, label: 'Spread <= -30' }],
    winRate: '79.5%',
    avgReturn: '+12.6%',
    sampleSize: '1987+',
    priority: 3
  },
  {
    id: 'putcall-extreme-fear',
    name: 'Put/Call Extreme',
    category: 'buy',
    conditions: [{ indicator: 'putcall_ratio', operator: '>=', value: 1.2, label: 'P/C >= 1.2' }],
    winRate: '68%',
    avgReturn: '+5%',
    sampleSize: '10y+',
    source: 'Billingsley & Chance 1988',
    priority: 3
  },
  {
    id: 'triple-greed',
    name: 'Triple Greed',
    category: 'warn',
    conditions: [
      { indicator: 'vix', operator: '<', value: 15, label: 'VIX < 15' },
      { indicator: 'cnn_fg', operator: '>=', value: 75, label: 'CNN >= 75' },
      { indicator: 'cftc_net', operator: '>', value: 150000, label: 'CFTC > 150K' }
    ],
    correctionProb: '~70%',
    sampleSize: '2011+',
    priority: 4
  },
  {
    id: 'greed-consensus',
    name: 'Greed Consensus',
    category: 'warn',
    conditions: [
      { indicator: 'vix', operator: '<', value: 15, label: 'VIX < 15' },
      { indicator: 'cnn_fg', operator: '>=', value: 75, label: 'CNN >= 75' }
    ],
    correctionProb: '~71%',
    sampleSize: '2011+',
    priority: 3
  },
  {
    id: 'putcall-complacency',
    name: 'Put/Call Low',
    category: 'warn',
    conditions: [{ indicator: 'putcall_ratio', operator: '<', value: 0.6, label: 'P/C < 0.6' }],
    correctionProb: '68%',
    sampleSize: '10y+',
    source: 'Billingsley & Chance 1988',
    priority: 3
  }
]);

const STATUS_ORDER = ['normal', 'caution', 'warning', 'danger'];

export function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function round(value, decimals = 2) {
  if (!Number.isFinite(Number(value))) return null;
  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
}

export function normalizeSeries(rows, valueKey = 'value') {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      date: row?.date,
      val: toFiniteNumber(row?.val ?? row?.[valueKey], NaN)
    }))
    .filter((row) => row.date && Number.isFinite(row.val))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getLatestPoint(series) {
  if (!Array.isArray(series) || series.length === 0) return null;
  return series[series.length - 1] ?? null;
}

export function getLatestValue(series) {
  return getLatestPoint(series)?.val ?? null;
}

export function latestDate(...seriesList) {
  const dates = seriesList
    .map((series) => getLatestPoint(series)?.date)
    .filter(Boolean)
    .sort();
  return dates[dates.length - 1] ?? null;
}

export function calculateYoY(series, periods = 52) {
  if (!Array.isArray(series) || series.length < 2) return null;
  const latest = getLatestValue(series);
  const yearAgoIdx = Math.max(0, series.length - periods);
  const yearAgo = series[yearAgoIdx]?.val;
  if (!latest || !yearAgo || yearAgo === 0) return null;
  return ((latest - yearAgo) / yearAgo) * 100;
}

export function getWorstStatus(statuses) {
  let worst = 0;
  for (const status of statuses) {
    const idx = STATUS_ORDER.indexOf(status);
    if (idx > worst) worst = idx;
  }
  return STATUS_ORDER[worst];
}

export function getAverageStatus(statuses) {
  const scores = statuses
    .map((status) => STATUS_ORDER.indexOf(status))
    .filter((idx) => idx >= 0);
  if (scores.length === 0) return 'normal';
  return STATUS_ORDER[Math.round(scores.reduce((sum, item) => sum + item, 0) / scores.length)];
}

export function getDelinquencyStatus(value) {
  if (value == null) return 'normal';
  if (value < THRESHOLDS.DELINQUENCY.NORMAL) return 'normal';
  if (value < THRESHOLDS.DELINQUENCY.CAUTION) return 'caution';
  if (value < THRESHOLDS.DELINQUENCY.WARNING) return 'warning';
  return 'danger';
}

export function getTier1Status(value) {
  if (value == null) return 'normal';
  if (value >= THRESHOLDS.TIER1_RATIO.NORMAL) return 'normal';
  if (value >= THRESHOLDS.TIER1_RATIO.CAUTION) return 'caution';
  if (value >= THRESHOLDS.TIER1_RATIO.WARNING) return 'warning';
  return 'danger';
}

export function getLoanDepositStatus(value) {
  if (value == null) return 'normal';
  if (value >= THRESHOLDS.LOAN_DEPOSIT.NORMAL_LOW && value <= THRESHOLDS.LOAN_DEPOSIT.NORMAL_HIGH) return 'normal';
  if (value > THRESHOLDS.LOAN_DEPOSIT.NORMAL_HIGH) return 'caution';
  if (value >= THRESHOLDS.LOAN_DEPOSIT.WARNING) return 'caution';
  return 'warning';
}

export function getLoanGrowthStatus(value) {
  if (value == null) return 'normal';
  if (value >= THRESHOLDS.LOAN_GROWTH.POSITIVE) return 'normal';
  if (value >= THRESHOLDS.LOAN_GROWTH.NEUTRAL) return 'caution';
  return 'warning';
}

export function getSpreadStatus(spreadBp) {
  if (spreadBp >= THRESHOLDS.SPREAD.WARNING) return 'danger';
  if (spreadBp >= THRESHOLDS.SPREAD.CAUTION) return 'warning';
  if (spreadBp >= THRESHOLDS.SPREAD.NORMAL) return 'caution';
  return 'normal';
}

export function getReservesGdpStatus(ratioPercent) {
  if (ratioPercent < THRESHOLDS.RESERVES_GDP.WARNING) return 'danger';
  if (ratioPercent < THRESHOLDS.RESERVES_GDP.CAUTION) return 'warning';
  if (ratioPercent < THRESHOLDS.RESERVES_GDP.NORMAL) return 'caution';
  return 'normal';
}

export function getM2Status(yoyPercent) {
  if (yoyPercent >= THRESHOLDS.M2_YOY.POSITIVE) return 'rising';
  if (yoyPercent >= THRESHOLDS.M2_YOY.NEUTRAL) return 'stable';
  return 'falling';
}

export function getNetLiquidityDeltaStatus(deltaB) {
  if (deltaB > THRESHOLDS.NET_LIQUIDITY.POSITIVE) return 'rising';
  if (deltaB < THRESHOLDS.NET_LIQUIDITY.NEGATIVE) return 'falling';
  return 'stable';
}

export function getScM2Status(ratioPercent) {
  if (ratioPercent >= THRESHOLDS.STABLECOIN.POSITIVE) return 'rising';
  if (ratioPercent >= THRESHOLDS.STABLECOIN.NEUTRAL) return 'stable';
  return 'falling';
}

export function getLiquidityFlowStatus(netLiquidityDeltaB, m2YoYPct) {
  const expanding = THRESHOLDS.OVERALL.EXPANDING;
  const contracting = THRESHOLDS.OVERALL.CONTRACTING;
  if (netLiquidityDeltaB > expanding.netLiq && m2YoYPct >= expanding.m2YoY) return 'rising';
  if (netLiquidityDeltaB < contracting.netLiq || m2YoYPct < contracting.m2YoY) return 'falling';
  return 'stable';
}

export function toLocalYMD(date) {
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function getWeekKeyFromDate(date) {
  const x = new Date(date);
  x.setHours(12, 0, 0, 0);
  const day = x.getDay();
  const diff = (day + 6) % 7;
  x.setDate(x.getDate() - diff);
  return toLocalYMD(x);
}

export function getWeekKeyFromYMD(ymd) {
  const parts = String(ymd).split('-').map(Number);
  return getWeekKeyFromDate(new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0));
}

export function pickCompleteWeeks(series, now = new Date()) {
  if (!Array.isArray(series) || series.length < 7) return null;
  const weeklyMap = new Map();
  for (const item of series) {
    const weekKey = getWeekKeyFromYMD(item.date);
    const existing = weeklyMap.get(weekKey);
    if (!existing || item.date > existing.date) {
      weeklyMap.set(weekKey, { ...item, weekKey });
    }
  }

  const sortedWeeks = Array.from(weeklyMap.values()).sort((a, b) => a.weekKey.localeCompare(b.weekKey));
  if (sortedWeeks.length < 2) return null;

  const todayWeekKey = getWeekKeyFromDate(now);
  const last = sortedWeeks[sortedWeeks.length - 1];
  const secondLast = sortedWeeks[sortedWeeks.length - 2];
  const thirdLast = sortedWeeks.length >= 3 ? sortedWeeks[sortedWeeks.length - 3] : null;

  if (last.weekKey === todayWeekKey) {
    return { lastComplete: secondLast, prevComplete: thirdLast ?? secondLast };
  }
  return { lastComplete: last, prevComplete: secondLast };
}

function findNearestValue(series, targetDate) {
  if (!Array.isArray(series) || series.length === 0) return 0;
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (series[i].date <= targetDate) return series[i].val;
  }
  return series[0]?.val || 0;
}

export function calculateWeeklyNetLiquidityDelta(fedBs, tga, rrp, now = new Date()) {
  if (!fedBs?.length || fedBs.length < 2 || !tga?.length || tga.length < 7) return 0;
  const completeWeeks = pickCompleteWeeks(tga, now);
  if (!completeWeeks) return calculateWeeklyNetLiquidityDeltaFallback(fedBs, tga, rrp);

  const { lastComplete, prevComplete } = completeWeeks;
  const lastWalcl = findNearestValue(fedBs, lastComplete.date) / 1000;
  const prevWalcl = findNearestValue(fedBs, prevComplete.date) / 1000;
  const lastTga = lastComplete.val / 1000;
  const prevTga = prevComplete.val / 1000;

  let lastRrp = 0;
  let prevRrp = 0;
  const rrpCompleteWeeks = Array.isArray(rrp) && rrp.length > 0 ? pickCompleteWeeks(rrp, now) : null;
  if (rrpCompleteWeeks) {
    lastRrp = rrpCompleteWeeks.lastComplete.val;
    prevRrp = rrpCompleteWeeks.prevComplete.val;
  }

  return round((lastWalcl - lastTga - lastRrp) - (prevWalcl - prevTga - prevRrp), 1) ?? 0;
}

export function calculateWeeklyNetLiquidityDeltaFallback(fedBs, tga, rrp) {
  const hasRrp = Array.isArray(rrp) && rrp.length > 0;
  const latestWalcl = (fedBs[fedBs.length - 1]?.val || 0) / 1000;
  const latestTga = (tga[tga.length - 1]?.val || 0) / 1000;
  const latestRrp = hasRrp ? (rrp[rrp.length - 1]?.val || 0) : 0;
  const prevWalcl = (fedBs[fedBs.length - 2]?.val || 0) / 1000;
  const prevTga = tga.length > 5 ? (tga[tga.length - 6]?.val || 0) / 1000 : latestTga;
  const prevRrp = hasRrp && rrp.length > 5 ? rrp[rrp.length - 6]?.val || 0 : latestRrp;
  return round((latestWalcl - latestTga - latestRrp) - (prevWalcl - prevTga - prevRrp), 1) ?? 0;
}

export function calculateLoanGrowth(loans) {
  if (!loans?.length || loans.length < 2) return 0;
  const latestVal = loans[loans.length - 1]?.val;
  const yearAgoIdx = Math.max(0, loans.length - 52);
  const yearAgoVal = loans[yearAgoIdx]?.val;
  if (!latestVal || !yearAgoVal || yearAgoVal === 0) return 0;
  return ((latestVal - yearAgoVal) / yearAgoVal) * 100;
}

export function computeBankingHealthSnapshot({ delinquency, loans, deposits, fedTier1, fdicTier1 }) {
  const latestDelinquency = getLatestValue(delinquency) || 0;
  const latestLoans = getLatestValue(loans);
  const latestDeposits = getLatestValue(deposits);
  const latestTier1 = getLatestValue(fdicTier1) || getLatestValue(fedTier1) || 0;
  const loanDepositRatio = latestDeposits > 0 ? round((latestLoans / latestDeposits) * 100, 2) : 0;
  const loanGrowth = calculateLoanGrowth(loans);

  const delStatus = getDelinquencyStatus(latestDelinquency);
  const t1Status = getTier1Status(latestTier1);
  const ldStatus = getLoanDepositStatus(loanDepositRatio);
  const lgStatus = getLoanGrowthStatus(loanGrowth);
  const overallStatus = getWorstStatus([delStatus, t1Status, ldStatus, lgStatus]);
  const overallLabels = { normal: 'Healthy', caution: 'Watch', warning: 'Caution', danger: 'Stress' };

  return {
    overallStatus,
    overallLabel: overallLabels[overallStatus],
    delinquency: { value: round(latestDelinquency, 2), status: delStatus },
    tier1: { value: round(latestTier1, 2), status: t1Status },
    loanDeposit: { value: loanDepositRatio, status: ldStatus },
    loanGrowth: { value: round(loanGrowth, 2), status: lgStatus },
    metrics: {
      delinquency_pct: round(latestDelinquency, 2),
      tier1_pct: round(latestTier1, 2),
      loan_deposit_pct: loanDepositRatio,
      loan_growth_yoy_pct: round(loanGrowth, 2)
    },
    as_of: latestDate(delinquency, loans, deposits, fedTier1, fdicTier1)
  };
}

export function computeLiquidityFlowSnapshot({ m2, fedBs, tga, rrp, stablecoin }, now = new Date()) {
  const latestM2 = toFiniteNumber(getLatestValue(m2));
  const walclB = toFiniteNumber(getLatestValue(fedBs)) / 1000;
  const tgaB = toFiniteNumber(getLatestValue(tga)) / 1000;
  const rrpB = toFiniteNumber(getLatestValue(rrp));
  const netLiquidity = walclB - tgaB - rrpB;
  const m2YoY = toFiniteNumber(calculateYoY(m2));
  const stablecoinMcap = toFiniteNumber(stablecoin?.current ?? getLatestValue(stablecoin?.series)) / 1e9;
  const scM2Ratio = latestM2 > 0 ? (stablecoinMcap / latestM2) * 100 : 0;
  const weeklyNetFlow = calculateWeeklyNetLiquidityDelta(fedBs, tga, rrp, now);
  const status = getLiquidityFlowStatus(weeklyNetFlow, m2YoY);

  return {
    status,
    overallStatus: status,
    overallLabel: status === 'rising' ? 'RISING' : status === 'falling' ? 'FALLING' : 'STABLE',
    m2YoY: round(m2YoY, 2),
    m2Total: latestM2,
    netLiquidity: round(netLiquidity, 1),
    netLiquidityDelta: weeklyNetFlow,
    weeklyNetFlow,
    stablecoinMcap,
    scM2Ratio: round(scM2Ratio, 2),
    walcl: round(walclB, 1),
    tga: round(tgaB, 1),
    rrp: round(rrpB, 1),
    netFlow: weeklyNetFlow,
    components: {
      m2_yoy: { value: round(m2YoY, 2), unit: '%', status: getM2Status(m2YoY) },
      net_liquidity_wow: { value: weeklyNetFlow, unit: 'B USD', status: getNetLiquidityDeltaStatus(weeklyNetFlow) },
      stablecoin_m2_ratio: { value: round(scM2Ratio, 2), unit: '%', status: getScM2Status(scM2Ratio) }
    },
    metrics: {
      m2_yoy_pct: round(m2YoY, 2),
      m2_total_b: round(latestM2, 1),
      net_liquidity_b: round(netLiquidity, 1),
      weekly_net_flow_b: weeklyNetFlow,
      stablecoin_mcap_b: round(stablecoinMcap, 1),
      sc_m2_ratio_pct: round(scM2Ratio, 2)
    },
    formula: 'net_liquidity_b = WALCL/1000 - TGA/1000 - RRPONTSYD',
    as_of: latestDate(m2, fedBs, tga, rrp, stablecoin?.series ?? [])
  };
}

export function computeLiquidityStressSnapshot({ sofr, iorb, reserves, gdp }) {
  const latestSofr = getLatestValue(sofr);
  const latestIorb = getLatestValue(iorb);
  const spread = latestSofr && latestIorb ? Math.round((latestSofr - latestIorb) * 100) : 0;
  const latestReserves = getLatestValue(reserves);
  const latestGdp = getLatestValue(gdp);
  const reservesGdpRatio = latestReserves && latestGdp ? round(((latestReserves / 1000) / latestGdp) * 100, 1) : 0;
  const tier1Status = getSpreadStatus(spread);
  const tier2Status = getReservesGdpStatus(reservesGdpRatio);
  const overallStatus = getAverageStatus([tier1Status, tier2Status]);
  const overallLabels = { normal: 'Normal', caution: 'Caution', warning: 'High Stress', danger: 'Critical' };

  return {
    overallStatus,
    overallLabel: overallLabels[overallStatus],
    tier1: { status: tier1Status, value: spread, unit: 'bp' },
    tier2: { status: tier2Status, value: reservesGdpRatio, unit: '%' },
    metrics: {
      sofr_iorb_spread_bp: spread,
      reserves_gdp_pct: reservesGdpRatio
    },
    formula: 'spread_bp = (SOFR - IORB) * 100; reserves_gdp_pct = (WRESBAL/1000) / GDP * 100',
    as_of: latestDate(sofr, iorb, reserves, gdp)
  };
}

export function evaluateCondition(current, operator, threshold) {
  if (current === null || current === undefined || Number.isNaN(Number(current))) return false;
  switch (operator) {
    case '>=': return current >= threshold;
    case '<=': return current <= threshold;
    case '>': return current > threshold;
    case '<': return current < threshold;
    case '==': return current === threshold;
    default: return false;
  }
}

export function isNearCondition(current, operator, threshold) {
  if (current === null || current === undefined || Number.isNaN(Number(current))) return false;
  const margin = Math.abs(threshold * 0.1) || 5;
  switch (operator) {
    case '>=': return current >= threshold - margin && current < threshold;
    case '<=': return current <= threshold + margin && current > threshold;
    case '>': return current > threshold - margin && current <= threshold;
    case '<': return current < threshold + margin && current >= threshold;
    default: return false;
  }
}

export function evaluateComboSignal(signal, currentValues) {
  let metCount = 0;
  let nearCount = 0;
  const conditionDetails = [];
  const total = signal.conditions.length;

  for (const cond of signal.conditions) {
    const current = currentValues[cond.indicator];
    if (current === undefined || current === null) {
      conditionDetails.push({ ...cond, current: null, status: 'unknown' });
      continue;
    }
    if (evaluateCondition(current, cond.operator, cond.value)) {
      metCount += 1;
      conditionDetails.push({ ...cond, current, status: 'met' });
    } else if (isNearCondition(current, cond.operator, cond.value)) {
      nearCount += 1;
      conditionDetails.push({ ...cond, current, status: 'near' });
    } else {
      conditionDetails.push({ ...cond, current, status: 'unmet' });
    }
  }

  const isNearState = metCount === total - 1 && nearCount >= 1;
  return {
    status: metCount === total ? 'active' : (isNearState ? 'near' : 'inactive'),
    conditions: conditionDetails
  };
}

export function computeSentimentSignalSnapshot(currentValues, combos = COMBO_SIGNALS) {
  const comboResults = combos.map((signal) => {
    const result = evaluateComboSignal(signal, currentValues);
    return {
      id: signal.id,
      name: signal.name,
      category: signal.category,
      priority: signal.priority,
      status: result.status,
      conditions: result.conditions,
      winRate: signal.winRate,
      avgReturn: signal.avgReturn,
      correctionProb: signal.correctionProb,
      sampleSize: signal.sampleSize,
      source: signal.source
    };
  });

  const count = (category, status) => comboResults.filter((item) => item.category === category && item.status === status).length;
  const buyActive = count('buy', 'active');
  const buyNear = count('buy', 'near');
  const warnActive = count('warn', 'active');
  const warnNear = count('warn', 'near');
  let overallStatus = 'neutral';
  if (warnActive > 0) overallStatus = 'warning';
  else if (buyActive > 0) overallStatus = 'opportunity';

  return {
    overallStatus,
    buy_active: buyActive,
    buy_near: buyNear,
    warn_active: warnActive,
    warn_near: warnNear,
    values: { ...currentValues },
    combos: comboResults
  };
}
