/**
 * SlickCharts Validation Logic (Separated Module)
 * v1.0.0 - 2026-01-17
 *
 * Purpose: Centralized validation for all 34 SlickCharts data files
 * Categories: Index(3), Performance(3), Returns(5), Analysis(3), Yields(3),
 *            Drawdown/Marketcap(2), Movers(2), Macro(4), Portfolio(2), Stocks(4), Reference(3)
 */

// ============================================================================
// Core Validation Functions (Shared Patterns)
// ============================================================================

function validateSlickChartsSnapshot(data, dataKey) {
  const issues = [];
  if (!data?.updated) issues.push('updated 필드 누락');
  if (!data?.source) issues.push('source 필드 누락');

  const items = data?.[dataKey] || [];
  if (!Array.isArray(items)) issues.push(`${dataKey} 배열 아님`);
  else if (items.length === 0) issues.push(`${dataKey} 비어있음`);

  const count = data?.count;
  if (count && count !== items.length) issues.push(`count 불일치: ${count} vs ${items.length}`);

  return {
    ok: issues.length === 0,
    issues,
    stats: { count: items.length, updated: data?.updated }
  };
}

function validateSlickChartsCumulative(data, dataKey) {
  const issues = [];
  if (!data?.updated) issues.push('updated 필드 누락');
  if (!data?.source) issues.push('source 필드 누락');

  const history = data?.history || [];
  if (!Array.isArray(history)) issues.push('history 배열 아님');
  else if (history.length === 0) issues.push('history 비어있음');

  const latest = history[0];
  if (latest) {
    if (!latest.date) issues.push('latest entry: date 누락');
    const items = latest[dataKey] || [];
    if (!Array.isArray(items)) issues.push(`latest entry: ${dataKey} 배열 아님`);
    else if (items.length === 0) issues.push(`latest entry: ${dataKey} 비어있음`);
  }

  return {
    ok: issues.length === 0,
    issues,
    stats: {
      historyDays: history.length,
      latestCount: latest?.[dataKey]?.length || 0,
      latestDate: latest?.date,
      updated: data?.updated
    }
  };
}

function validateSlickChartsYieldType(data) {
  const issues = [];
  if (!data?.updated) issues.push('updated 필드 누락');
  if (!data?.source) issues.push('source 필드 누락');
  if (typeof data?.yield !== 'number') issues.push('yield 숫자 아님');

  return {
    ok: issues.length === 0,
    issues,
    stats: { yield: data?.yield, updated: data?.updated }
  };
}

function validateSlickChartsNestedStocks(data, nestedKey) {
  const issues = [];
  if (!data?.updated) issues.push('updated 필드 누락');
  if (!data?.source) issues.push('source 필드 누락');

  const stocks = data?.stocks || [];
  if (!Array.isArray(stocks)) issues.push('stocks 배열 아님');
  else if (stocks.length === 0) issues.push('stocks 비어있음');
  else {
    const first = stocks[0];
    if (!first?.symbol) issues.push('첫 종목 symbol 누락');
    if (!first?.[nestedKey] || !Array.isArray(first[nestedKey])) {
      issues.push(`첫 종목에 ${nestedKey} 배열 없음`);
    }
  }

  const count = data?.count;
  if (count && count !== stocks.length) issues.push(`count 불일치: ${count} vs ${stocks.length}`);

  return {
    ok: issues.length === 0,
    issues,
    stats: { stockCount: stocks.length, updated: data?.updated }
  };
}

function validateSlickChartsObjectArray(data, arrayKey) {
  const issues = [];
  if (!data?.updated) issues.push('updated 필드 누락');
  if (!data?.source) issues.push('source 필드 누락');

  const items = data?.[arrayKey] || data?.data || [];
  if (!Array.isArray(items)) issues.push(`${arrayKey || 'data'} 배열 아님`);
  else if (items.length === 0) issues.push(`${arrayKey || 'data'} 비어있음`);

  if (data?.current && typeof data.current !== 'object') {
    issues.push('current 객체 아님');
  }

  return {
    ok: issues.length === 0,
    issues,
    stats: { count: items.length, hasCurrent: !!data?.current, updated: data?.updated }
  };
}

// ============================================================================
// SlickCharts File Categories (34 files → 8 categories)
// ============================================================================

const SLICKCHARTS_CATEGORIES = {
  // Index Holdings (3) - Daily
  indexHoldings: {
    name: 'Index Holdings',
    icon: 'fa-chart-pie',
    files: [
      { key: 'SLICK_SP500', validator: 'validateSlickChartsSp500', path: 'sp500.json' },
      { key: 'SLICK_NASDAQ100', validator: 'validateSlickChartsNasdaq100', path: 'nasdaq100.json' },
      { key: 'SLICK_DOWJONES', validator: 'validateSlickChartsDowjones', path: 'dowjones.json' }
    ],
    staleDays: { warn: 2, danger: 7 }
  },

  // Performance (3) - Daily
  performance: {
    name: 'Performance',
    icon: 'fa-chart-line',
    files: [
      { key: 'SLICK_SP500_PERFORMANCE', validator: 'validateSlickChartsSp500Performance', path: 'sp500-performance.json' },
      { key: 'SLICK_NASDAQ100_PERFORMANCE', validator: 'validateSlickChartsNasdaq100Performance', path: 'nasdaq100-performance.json' },
      { key: 'SLICK_DOWJONES_PERFORMANCE', validator: 'validateSlickChartsDowjonesPerformance', path: 'dowjones-performance.json' }
    ],
    staleDays: { warn: 2, danger: 7 }
  },

  // Returns (5) - Daily
  returns: {
    name: 'Returns',
    icon: 'fa-percent',
    files: [
      { key: 'SLICK_SP500_RETURNS', validator: 'validateSlickChartsSp500Returns', path: 'sp500-returns.json' },
      { key: 'SLICK_NASDAQ100_RETURNS', validator: 'validateSlickChartsNasdaq100Returns', path: 'nasdaq100-returns.json' },
      { key: 'SLICK_DOWJONES_RETURNS', validator: 'validateSlickChartsDowjonesReturns', path: 'dowjones-returns.json' },
      { key: 'SLICK_BTC_RETURNS', validator: 'validateSlickChartsBtcReturns', path: 'btc-returns.json' },
      { key: 'SLICK_ETH_RETURNS', validator: 'validateSlickChartsEthReturns', path: 'eth-returns.json' }
    ],
    staleDays: { warn: 2, danger: 7 }
  },

  // Analysis (3) - Daily
  analysis: {
    name: 'Analysis',
    icon: 'fa-chart-area',
    files: [
      { key: 'SLICK_SP500_ANALYSIS', validator: 'validateSlickChartsSp500Analysis', path: 'sp500-analysis.json' },
      { key: 'SLICK_NASDAQ100_ANALYSIS', validator: 'validateSlickChartsNasdaq100Analysis', path: 'nasdaq100-analysis.json' },
      { key: 'SLICK_NASDAQ100_RATIO', validator: 'validateSlickChartsNasdaq100Ratio', path: 'nasdaq100-ratio.json' }
    ],
    staleDays: { warn: 2, danger: 7 }
  },

  // Yields (3) - Daily
  yields: {
    name: 'Yields',
    icon: 'fa-coins',
    files: [
      { key: 'SLICK_SP500_YIELD', validator: 'validateSlickChartsSp500Yield', path: 'sp500-yield.json' },
      { key: 'SLICK_NASDAQ100_YIELD', validator: 'validateSlickChartsNasdaq100Yield', path: 'nasdaq100-yield.json' },
      { key: 'SLICK_DOWJONES_YIELD', validator: 'validateSlickChartsDowjonesYield', path: 'dowjones-yield.json' }
    ],
    staleDays: { warn: 2, danger: 7 }
  },

  // Drawdown/Marketcap (2) - Daily
  drawdown: {
    name: 'Drawdown/Marketcap',
    icon: 'fa-chart-bar',
    files: [
      { key: 'SLICK_SP500_DRAWDOWN', validator: 'validateSlickChartsSp500Drawdown', path: 'sp500-drawdown.json' },
      { key: 'SLICK_SP500_MARKETCAP', validator: 'validateSlickChartsSp500Marketcap', path: 'sp500-marketcap.json' }
    ],
    staleDays: { warn: 7, danger: 14 }
  },

  // Movers (2) - Daily
  movers: {
    name: 'Movers',
    icon: 'fa-arrows-alt-v',
    files: [
      { key: 'SLICK_GAINERS', validator: 'validateSlickChartsGainers', path: 'gainers.json' },
      { key: 'SLICK_LOSERS', validator: 'validateSlickChartsLosers', path: 'losers.json' }
    ],
    staleDays: { warn: 2, danger: 7 }
  },

  // Macro (4) - Daily
  macro: {
    name: 'Macro',
    icon: 'fa-globe',
    files: [
      { key: 'SLICK_TREASURY', validator: 'validateSlickChartsTreasury', path: 'treasury.json' },
      { key: 'SLICK_CURRENCY', validator: 'validateSlickChartsCurrency', path: 'currency.json' },
      { key: 'SLICK_INFLATION', validator: 'validateSlickChartsInflation', path: 'inflation.json' },
      { key: 'SLICK_MORTGAGE', validator: 'validateSlickChartsMortgage', path: 'mortgage.json' }
    ],
    staleDays: { warn: 2, danger: 7 }
  },

  // Portfolio (2) - Weekly
  portfolio: {
    name: 'Portfolio',
    icon: 'fa-briefcase',
    files: [
      { key: 'SLICK_MAGNIFICENT7', validator: 'validateSlickChartsMagnificent7', path: 'magnificent7.json' },
      { key: 'SLICK_ETF', validator: 'validateSlickChartsEtf', path: 'etf.json' }
    ],
    staleDays: { warn: 7, danger: 14 }
  },

  // Stocks (4) - Weekly
  stocks: {
    name: 'Stocks',
    icon: 'fa-layer-group',
    files: [
      { key: 'SLICK_STOCKS_RETURNS', validator: 'validateSlickChartsStocksReturns', path: 'stocks-returns.json' },
      { key: 'SLICK_STOCKS_DIVIDENDS', validator: 'validateSlickChartsStocksDividends', path: 'stocks-dividends.json' },
      { key: 'SLICK_STOCKS_DIVIDENDS_RECENT', validator: 'validateSlickChartsStocksDividendsRecent', path: 'stocks-dividends-recent.json' },
      { key: 'SLICK_STOCKS_DIVIDENDS_HISTORICAL', validator: 'validateSlickChartsStocksDividendsHistorical', path: 'stocks-dividends-historical.json' }
    ],
    staleDays: { warn: 10, danger: 21 }
  },

  // Reference (3) - Weekly
  reference: {
    name: 'Reference',
    icon: 'fa-database',
    files: [
      { key: 'SLICK_UNIVERSE', validator: 'validateSlickChartsUniverse', path: 'universe.json' },
      { key: 'SLICK_SYMBOLS_ALL', validator: 'validateSlickChartsSymbolsAll', path: 'symbols-all.json' },
      { key: 'SLICK_MEMBERSHIP_CHANGES', validator: 'validateSlickChartsMembershipChanges', path: 'membership-changes.json' }
    ],
    staleDays: { warn: 10, danger: 21 }
  }
};

// ============================================================================
// Category Validators (Public API)
// ============================================================================

// Index Holdings (3)
function validateSlickChartsSp500(data) {
  return validateSlickChartsSnapshot(data, 'holdings');
}
function validateSlickChartsNasdaq100(data) {
  return validateSlickChartsSnapshot(data, 'holdings');
}
function validateSlickChartsDowjones(data) {
  return validateSlickChartsSnapshot(data, 'holdings');
}

// Performance (3)
function validateSlickChartsSp500Performance(data) {
  return validateSlickChartsSnapshot(data, 'performance');
}
function validateSlickChartsNasdaq100Performance(data) {
  return validateSlickChartsSnapshot(data, 'performance');
}
function validateSlickChartsDowjonesPerformance(data) {
  return validateSlickChartsSnapshot(data, 'performance');
}

// Returns (5)
function validateSlickChartsSp500Returns(data) {
  return validateSlickChartsSnapshot(data, 'returns');
}
function validateSlickChartsNasdaq100Returns(data) {
  return validateSlickChartsSnapshot(data, 'returns');
}
function validateSlickChartsDowjonesReturns(data) {
  return validateSlickChartsSnapshot(data, 'returns');
}
function validateSlickChartsBtcReturns(data) {
  return validateSlickChartsSnapshot(data, 'returns');
}
function validateSlickChartsEthReturns(data) {
  return validateSlickChartsSnapshot(data, 'returns');
}

// Analysis (3)
function validateSlickChartsSp500Analysis(data) {
  return validateSlickChartsSnapshot(data, 'analysis');
}
function validateSlickChartsNasdaq100Analysis(data) {
  return validateSlickChartsSnapshot(data, 'analysis');
}
function validateSlickChartsNasdaq100Ratio(data) {
  const issues = [];
  if (!data?.updated) issues.push('updated 필드 누락');
  if (!data?.source) issues.push('source 필드 누락');

  const history = data?.history || [];
  if (!Array.isArray(history)) issues.push('history 배열 아님');
  else if (history.length === 0) issues.push('history 비어있음');

  const latest = history[0];
  if (latest && typeof latest.ratio !== 'number') issues.push('latest entry: ratio 숫자 아님');

  const count = data?.count;
  if (count && count !== history.length) issues.push(`count 불일치: ${count} vs ${history.length}`);

  return {
    ok: issues.length === 0,
    issues,
    stats: { historyDays: history.length, latestRatio: latest?.ratio, updated: data?.updated }
  };
}

// Yields (3)
function validateSlickChartsSp500Yield(data) {
  return validateSlickChartsYieldType(data);
}
function validateSlickChartsNasdaq100Yield(data) {
  return validateSlickChartsYieldType(data);
}
function validateSlickChartsDowjonesYield(data) {
  return validateSlickChartsYieldType(data);
}

// Drawdown/Marketcap (2)
function validateSlickChartsSp500Drawdown(data) {
  return validateSlickChartsObjectArray(data, 'data');
}
function validateSlickChartsSp500Marketcap(data) {
  const issues = [];
  if (!data?.updated) issues.push('updated 필드 누락');
  if (!data?.source) issues.push('source 필드 누락');
  if (typeof data?.totalMarketCap !== 'number') issues.push('totalMarketCap 숫자 아님');

  return {
    ok: issues.length === 0,
    issues,
    stats: { totalMarketCap: data?.totalMarketCap, updated: data?.updated }
  };
}

// Movers (2)
function validateSlickChartsGainers(data) {
  return validateSlickChartsCumulative(data, 'gainers');
}
function validateSlickChartsLosers(data) {
  return validateSlickChartsCumulative(data, 'losers');
}

// Macro (4)
function validateSlickChartsTreasury(data) {
  return validateSlickChartsCumulative(data, 'rates');
}
function validateSlickChartsCurrency(data) {
  return validateSlickChartsCumulative(data, 'currencies');
}
function validateSlickChartsInflation(data) {
  return validateSlickChartsSnapshot(data, 'inflation');
}
function validateSlickChartsMortgage(data) {
  const issues = [];
  if (!data?.updated) issues.push('updated 필드 누락');
  if (!data?.source) issues.push('source 필드 누락');

  const rates = data?.rates || [];
  if (!Array.isArray(rates)) issues.push('rates 배열 아님');
  else if (rates.length === 0) issues.push('rates 비어있음');

  const count = data?.count;
  if (count && count !== rates.length) issues.push(`count 불일치: ${count} vs ${rates.length}`);

  return {
    ok: issues.length === 0,
    issues,
    stats: { count: rates.length, updated: data?.updated }
  };
}

// Portfolio (2)
function validateSlickChartsMagnificent7(data) {
  return validateSlickChartsSnapshot(data, 'holdings');
}
function validateSlickChartsEtf(data) {
  const issues = [];
  if (!data?.updated) issues.push('updated 필드 누락');
  if (!data?.source) issues.push('source 필드 누락');

  const ark = data?.ark || [];
  const index = data?.index || [];
  if (!Array.isArray(ark)) issues.push('ark 배열 아님');
  if (!Array.isArray(index)) issues.push('index 배열 아님');

  return {
    ok: issues.length === 0,
    issues,
    stats: { arkCount: ark.length, indexCount: index.length, updated: data?.updated }
  };
}

// Stocks (4)
function validateSlickChartsStocksReturns(data) {
  return validateSlickChartsNestedStocks(data, 'returns');
}
function validateSlickChartsStocksDividends(data) {
  return validateSlickChartsNestedStocks(data, 'dividends');
}
function validateSlickChartsStocksDividendsRecent(data) {
  return validateSlickChartsNestedStocks(data, 'dividends');
}
function validateSlickChartsStocksDividendsHistorical(data) {
  return validateSlickChartsNestedStocks(data, 'dividends');
}

// Reference (3)
function validateSlickChartsUniverse(data) {
  return validateSlickChartsSnapshot(data, 'stocks');
}
function validateSlickChartsSymbolsAll(data) {
  return validateSlickChartsSnapshot(data, 'stocks');
}
function validateSlickChartsMembershipChanges(data) {
  const issues = [];
  if (!data?.updated) issues.push('updated 필드 누락');

  const indices = data?.indices || {};
  if (typeof indices !== 'object') issues.push('indices 객체 아님');
  else if (Object.keys(indices).length === 0) issues.push('indices 비어있음');

  return {
    ok: issues.length === 0,
    issues,
    stats: { indicesCount: Object.keys(indices).length, updated: data?.updated }
  };
}

// Legacy (not in main data-lab)
function validateSlickCharts1929Crash(data) {
  return validateSlickChartsSnapshot(data, 'data');
}
function validateSlickChartsBerkshire(data) {
  return validateSlickChartsSnapshot(data, 'holdings');
}

// ============================================================================
// Category Loader Helper (Batch validate by category)
// ============================================================================

async function validateSlickChartsCategory(categoryKey, fetchDataLabFile) {
  const category = SLICKCHARTS_CATEGORIES[categoryKey];
  if (!category) {
    return { ok: false, errors: [`Unknown category: ${categoryKey}`] };
  }

  const results = [];
  let okCount = 0;
  let latestDate = null;

  for (const file of category.files) {
    try {
      const data = await fetchDataLabFile(file.key).catch(() => null);
      if (!data) {
        results.push({ file: file.path, key: file.key, ok: false, error: '로드 실패' });
        continue;
      }

      const validatorFn = window[file.validator];
      if (typeof validatorFn !== 'function') {
        results.push({ file: file.path, key: file.key, ok: false, error: `Validator not found: ${file.validator}` });
        continue;
      }

      const result = validatorFn(data);
      results.push({ file: file.path, key: file.key, ok: result.ok, error: result.issues?.join(' / '), stats: result.stats });

      if (result.ok) okCount++;

      if (result.stats?.updated && (!latestDate || new Date(result.stats.updated) > new Date(latestDate))) {
        latestDate = result.stats.updated;
      }
    } catch (err) {
      results.push({ file: file.path, key: file.key, ok: false, error: err.message });
    }
  }

  return {
    category: category.name,
    categoryKey,
    files: category.files.length,
    okCount,
    allOk: okCount === category.files.length,
    latestDate,
    results,
    staleDays: category.staleDays
  };
}

async function validateAllSlickCharts(fetchDataLabFile) {
  const categories = Object.keys(SLICKCHARTS_CATEGORIES);
  const categoryResults = [];

  for (const catKey of categories) {
    const result = await validateSlickChartsCategory(catKey, fetchDataLabFile);
    categoryResults.push(result);
  }

  const totalFiles = categoryResults.reduce((sum, r) => sum + r.files, 0);
  const totalOk = categoryResults.reduce((sum, r) => sum + r.okCount, 0);

  return {
    total: totalFiles,
    ok: totalOk,
    failed: totalFiles - totalOk,
    categories: categoryResults,
    overallLatestDate: categoryResults
      .map(r => r.latestDate)
      .filter(Boolean)
      .sort((a, b) => new Date(b) - new Date(a))[0]
  };
}

// ============================================================================
// Export for external use
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SLICKCHARTS_CATEGORIES,
    validateSlickChartsCategory,
    validateAllSlickCharts
  };
}
