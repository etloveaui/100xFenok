/**
 * SlickCharts Config for Valuation Lab
 * v1.0.0 - #155: Historical Returns & Dividends Integration
 */

// Dynamic base path (Cloudflare Pages, localhost, GitHub Pages compatible)
const getSlickBasePath = () => {
  const isLocal = /^(127\.0\.0\.1|localhost|192\.168\.\d+\.\d+)$/.test(location.hostname) || location.protocol === 'file:';
  const isCloudflare = location.hostname.endsWith('pages.dev');
  return (isLocal || isCloudflare) ? '' : '/100xFenok';
};

const SLICKCHARTS_CONFIG = {
  DATA_BASE: getSlickBasePath() + '/data/slickcharts',

  FILES: {
    // ===== STOCKS DATA (7 files) =====
    STOCKS_RETURNS: 'stocks-returns.json',              // ~641KB, 516 stocks, 47yr returns
    STOCKS_DIVIDENDS_RECENT: 'stocks-dividends-recent.json',  // ~540KB, 5yr dividends
    STOCKS_DIVIDENDS_HISTORICAL: 'stocks-dividends-historical.json', // ~1.4MB, 13yr dividends
    STOCKS_DIVIDENDS: 'stocks-dividends.json',
    UNIVERSE: 'universe.json',
    SYMBOLS_ALL: 'symbols-all.json',
    SYMBOLS: 'symbols.json',
    MEMBERSHIP_CHANGES: 'membership-changes.json',

    // ===== INDEX HOLDINGS (4 files) =====
    SP500: 'sp500.json',
    NASDAQ100: 'nasdaq100.json',
    DOWJONES: 'dowjones.json',
    MAGNIFICENT7: 'magnificent7.json',

    // ===== INDEX RETURNS (3 files) =====
    SP500_RETURNS: 'sp500-returns.json',
    NASDAQ100_RETURNS: 'nasdaq100-returns.json',
    DOWJONES_RETURNS: 'dowjones-returns.json',

    // ===== INDEX PERFORMANCE (3 files) =====
    SP500_PERFORMANCE: 'sp500-performance.json',
    NASDAQ100_PERFORMANCE: 'nasdaq100-performance.json',
    DOWJONES_PERFORMANCE: 'dowjones-performance.json',

    // ===== INDEX YIELD (4 files) =====
    SP500_YIELD: 'sp500-yield.json',
    NASDAQ100_YIELD: 'nasdaq100-yield.json',
    DOWJONES_YIELD: 'dowjones-yield.json',
    NASDAQ100_RATIO: 'nasdaq100-ratio.json',

    // ===== INDEX ANALYSIS (4 files) =====
    SP500_ANALYSIS: 'sp500-analysis.json',
    NASDAQ100_ANALYSIS: 'nasdaq100-analysis.json',
    SP500_DRAWDOWN: 'sp500-drawdown.json',
    SP500_MARKETCAP: 'sp500-marketcap.json',

    // ===== DAILY MOVERS (2 files) =====
    GAINERS: 'gainers.json',
    LOSERS: 'losers.json',

    // ===== RATES (3 files) =====
    TREASURY: 'treasury.json',
    MORTGAGE: 'mortgage.json',
    INFLATION: 'inflation.json',

    // ===== CRYPTO (3 files) =====
    CURRENCY: 'currency.json',
    BTC_RETURNS: 'btc-returns.json',
    ETH_RETURNS: 'eth-returns.json',

    // ===== SPECIAL (3 files) =====
    BERKSHIRE: 'berkshire.json',
    ETF: 'etf.json',
    SCHEMA: 'schema.json'
  },

  // Individual stock file loader (516 files in stocks/ folder)
  STOCK_FILES: {
    BASE_PATH: 'stocks/',
    getStockUrl: function(symbol) {
      return `${SLICKCHARTS_CONFIG.DATA_BASE}/stocks/${symbol}.json`;
    }
  },

  // Load strategy: 3-Tier caching + split files
  LOAD_STRATEGY: {
    INITIAL: ['STOCKS_RETURNS', 'STOCKS_DIVIDENDS_RECENT'],  // Load first
    LAZY: ['STOCKS_DIVIDENDS_HISTORICAL'],                   // Load on demand
    REFERENCE: ['SP500_RETURNS'],                            // Comparison data
    MOVERS: ['GAINERS', 'LOSERS'],                           // Daily movers
    INDICES: {
      HOLDINGS: ['SP500', 'NASDAQ100', 'DOWJONES', 'MAGNIFICENT7'],
      RETURNS: ['SP500_RETURNS', 'NASDAQ100_RETURNS', 'DOWJONES_RETURNS'],
      PERFORMANCE: ['SP500_PERFORMANCE', 'NASDAQ100_PERFORMANCE', 'DOWJONES_PERFORMANCE'],
      YIELD: ['SP500_YIELD', 'NASDAQ100_YIELD', 'DOWJONES_YIELD', 'NASDAQ100_RATIO'],
      ANALYSIS: ['SP500_ANALYSIS', 'NASDAQ100_ANALYSIS', 'SP500_DRAWDOWN', 'SP500_MARKETCAP']
    },
    ECONOMY: ['TREASURY', 'MORTGAGE', 'INFLATION', 'CURRENCY', 'BTC_RETURNS', 'ETH_RETURNS'],
    SPECIAL: ['BERKSHIRE', 'ETF', 'MEMBERSHIP_CHANGES']
  },

  // Default filter settings
  DEFAULTS: {
    MIN_YEARS: 5,           // Minimum years of data
    MAX_YEARS: 47,          // Maximum years (1977-2024)
    DEFAULT_YEARS: 20,      // Default display years
    MAX_COMPARE: 5,         // Max stocks to compare
    PAGE_SIZE: 50           // Results per page
  },

  // Column definitions for returns table
  COLUMNS: {
    TICKER: 'symbol',
    YEARS: 'yearsCount',
    CAGR: 'cagr',
    BEST_YEAR: 'bestYear',
    WORST_YEAR: 'worstYear',
    VOLATILITY: 'volatility',
    DIV_YIELD: 'dividendYield',
    DIV_GROWTH: 'dividendGrowth'
  }
};

/**
 * Fetch SlickCharts data file
 * @param {string} fileKey - Key from SLICKCHARTS_CONFIG.FILES
 * @returns {Promise<Object>} JSON data
 */
async function fetchSlickChartsData(fileKey) {
  const file = SLICKCHARTS_CONFIG.FILES[fileKey];
  if (!file) throw new Error(`Unknown file key: ${fileKey}`);

  const url = `${SLICKCHARTS_CONFIG.DATA_BASE}/${file}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}`);
  return response.json();
}

/**
 * Fetch individual stock detail from stocks/{symbol}.json
 * @param {string} symbol - Stock ticker symbol (e.g., 'AAPL', 'MSFT')
 * @returns {Promise<Object>} Stock detail data including current, metrics_history, returns, dividends
 */
async function fetchStockDetail(symbol) {
  const url = SLICKCHARTS_CONFIG.STOCK_FILES.getStockUrl(symbol);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch stock ${symbol}`);
  return response.json();
}

/**
 * Calculate CAGR (Compound Annual Growth Rate)
 * @param {Array} returns - Array of yearly returns (as decimals, e.g., 0.12 = 12%)
 * @param {number} years - Number of years to calculate
 * @returns {number|null} CAGR as decimal
 */
function calcCAGR(returns, years = null) {
  if (!returns || !returns.length) return null;

  const data = years ? returns.slice(0, years) : returns;
  if (data.length === 0) return null;

  // Geometric mean: product of (1 + return) ^ (1/n) - 1
  let product = 1;
  for (const r of data) {
    if (r === null || r === undefined) continue;
    product *= (1 + r);
  }

  return Math.pow(product, 1 / data.length) - 1;
}

/**
 * Calculate volatility (standard deviation of returns)
 * @param {Array} returns - Array of yearly returns
 * @returns {number|null} Volatility as decimal
 */
function calcVolatility(returns) {
  if (!returns || returns.length < 2) return null;

  const validReturns = returns.filter(r => r !== null && r !== undefined);
  if (validReturns.length < 2) return null;

  const mean = validReturns.reduce((a, b) => a + b, 0) / validReturns.length;
  const squaredDiffs = validReturns.map(r => Math.pow(r - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / validReturns.length;

  return Math.sqrt(variance);
}

/**
 * Calculate dividend growth CAGR
 * @param {Array} dividends - Array of yearly dividend amounts
 * @param {number} years - Number of years to calculate
 * @returns {number|null} Dividend growth CAGR as decimal
 */
function calcDividendGrowth(dividends, years = null) {
  if (!dividends || dividends.length < 2) return null;

  const data = years ? dividends.slice(0, years) : dividends;
  const valid = data.filter(d => d !== null && d !== undefined && d > 0);
  if (valid.length < 2) return null;

  const latest = valid[0];
  const earliest = valid[valid.length - 1];
  const n = valid.length - 1;

  if (earliest <= 0) return null;

  return Math.pow(latest / earliest, 1 / n) - 1;
}

/**
 * Find best and worst years
 * @param {Array} returns - Array of yearly returns with year info
 * @returns {Object} { best: { year, return }, worst: { year, return } }
 */
function findBestWorstYears(returns) {
  if (!returns || !returns.length) return { best: null, worst: null };

  let best = { year: null, return: -Infinity };
  let worst = { year: null, return: Infinity };

  for (const r of returns) {
    if (r.return === null || r.return === undefined) continue;
    if (r.return > best.return) {
      best = { year: r.year, return: r.return };
    }
    if (r.return < worst.return) {
      worst = { year: r.year, return: r.return };
    }
  }

  return {
    best: best.year ? best : null,
    worst: worst.year ? worst : null
  };
}

/**
 * Format percentage for display
 * @param {number} value - Value as decimal
 * @param {boolean} showSign - Whether to show + sign
 * @returns {string} Formatted percentage
 */
function formatPct(value, showSign = true) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const pct = (value * 100).toFixed(1);
  return showSign && value >= 0 ? `+${pct}%` : `${pct}%`;
}

/**
 * Format year count
 * @param {number} years - Number of years
 * @returns {string} Formatted string
 */
function formatYears(years) {
  if (!years) return '-';
  return `${years}yr`;
}
