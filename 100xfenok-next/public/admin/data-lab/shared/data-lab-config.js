/**
 * Data Lab 설정
 * v2.0.0 - DEC-063: global-scouter 모듈화 + sec-13f 통합
 */

// 동적 base path (Cloudflare Pages, localhost, GitHub Pages 호환)
const getBasePath = () => {
  const isLocal = /^(127\.0\.0\.1|localhost|192\.168\.\d+\.\d+)$/.test(location.hostname) || location.protocol === 'file:';
  const isCloudflare = location.hostname.endsWith('pages.dev');
  return (isLocal || isCloudflare) ? '' : '/100xFenok';
};

const DATA_LAB_CONFIG = {
  BASE_PATH: getBasePath(),
  FILES: {
    // Damodaran
    DAMODARAN_ERP: '/data/damodaran/erp.json',

    // Global Scouter - Core (v2.0)
    SCOUTER_METADATA: '/data/global-scouter/core/metadata.json',
    SCOUTER_DASHBOARD: '/data/global-scouter/core/dashboard.json',
    SCOUTER_INDEX: '/data/global-scouter/core/stocks_index.json',

    // SEC 13F (신규)
    SEC13F_SUMMARY: '/data/sec-13f/summary.json',
    SEC13F_BY_SECTOR: '/data/sec-13f/by_sector.json',
    SEC13F_BY_TICKER: '/data/sec-13f/by_ticker.json',

    // SlickCharts - Index Holdings (3)
    SLICK_SP500: '/data/slickcharts/sp500.json',
    SLICK_NASDAQ100: '/data/slickcharts/nasdaq100.json',
    SLICK_DOWJONES: '/data/slickcharts/dowjones.json',

    // SlickCharts - Performance (3)
    SLICK_SP500_PERFORMANCE: '/data/slickcharts/sp500-performance.json',
    SLICK_NASDAQ100_PERFORMANCE: '/data/slickcharts/nasdaq100-performance.json',
    SLICK_DOWJONES_PERFORMANCE: '/data/slickcharts/dowjones-performance.json',

    // SlickCharts - Returns (5)
    SLICK_SP500_RETURNS: '/data/slickcharts/sp500-returns.json',
    SLICK_NASDAQ100_RETURNS: '/data/slickcharts/nasdaq100-returns.json',
    SLICK_DOWJONES_RETURNS: '/data/slickcharts/dowjones-returns.json',
    SLICK_BTC_RETURNS: '/data/slickcharts/btc-returns.json',
    SLICK_ETH_RETURNS: '/data/slickcharts/eth-returns.json',

    // SlickCharts - Analysis (3)
    SLICK_SP500_ANALYSIS: '/data/slickcharts/sp500-analysis.json',
    SLICK_NASDAQ100_ANALYSIS: '/data/slickcharts/nasdaq100-analysis.json',
    SLICK_NASDAQ100_RATIO: '/data/slickcharts/nasdaq100-ratio.json',

    // SlickCharts - Yields (3)
    SLICK_SP500_YIELD: '/data/slickcharts/sp500-yield.json',
    SLICK_NASDAQ100_YIELD: '/data/slickcharts/nasdaq100-yield.json',
    SLICK_DOWJONES_YIELD: '/data/slickcharts/dowjones-yield.json',

    // SlickCharts - Drawdown/Marketcap (2)
    SLICK_SP500_DRAWDOWN: '/data/slickcharts/sp500-drawdown.json',
    SLICK_SP500_MARKETCAP: '/data/slickcharts/sp500-marketcap.json',

    // SlickCharts - Movers (2)
    SLICK_GAINERS: '/data/slickcharts/gainers.json',
    SLICK_LOSERS: '/data/slickcharts/losers.json',

    // SlickCharts - Macro (4)
    SLICK_TREASURY: '/data/slickcharts/treasury.json',
    SLICK_CURRENCY: '/data/slickcharts/currency.json',
    SLICK_INFLATION: '/data/slickcharts/inflation.json',
    SLICK_MORTGAGE: '/data/slickcharts/mortgage.json',

    // SlickCharts - Portfolio (2)
    SLICK_MAGNIFICENT7: '/data/slickcharts/magnificent7.json',
    SLICK_ETF: '/data/slickcharts/etf.json',

    // SlickCharts - Stocks Aggregated (4)
    SLICK_STOCKS_RETURNS: '/data/slickcharts/stocks-returns.json',
    SLICK_STOCKS_DIVIDENDS: '/data/slickcharts/stocks-dividends.json',
    SLICK_STOCKS_DIVIDENDS_RECENT: '/data/slickcharts/stocks-dividends-recent.json',
    SLICK_STOCKS_DIVIDENDS_HISTORICAL: '/data/slickcharts/stocks-dividends-historical.json',

    // SlickCharts - Reference (3)
    SLICK_UNIVERSE: '/data/slickcharts/universe.json',
    SLICK_SYMBOLS_ALL: '/data/slickcharts/symbols-all.json',
    SLICK_MEMBERSHIP_CHANGES: '/data/slickcharts/membership-changes.json'
  },
  PATHS: {
    SCOUTER_DETAIL: '/data/global-scouter/stocks/detail/',
    SEC13F_INVESTORS: '/data/sec-13f/investors/'
  },
  SENTIMENT: [
    { key: 'SENTIMENT_AII', path: '/data/sentiment/aaii.json' },
    { key: 'SENTIMENT_CFTC_SP500', path: '/data/sentiment/cftc-sp500.json' },
    { key: 'SENTIMENT_CNN', path: '/data/sentiment/cnn-fear-greed.json' },
    { key: 'SENTIMENT_CRYPTO', path: '/data/sentiment/crypto-fear-greed.json' },
    { key: 'SENTIMENT_MOVE', path: '/data/sentiment/move.json' },
    { key: 'SENTIMENT_VIX', path: '/data/sentiment/vix.json' }
  ],
  INDICES: [
    { key: 'INDICES_SP500', path: '/data/indices/sp500.json' },
    { key: 'INDICES_NASDAQ100', path: '/data/indices/nasdaq100.json' }
  ],
  BENCHMARKS: [
    { key: 'US', path: '/data/benchmarks/us.json' },
    { key: 'US_SECTORS', path: '/data/benchmarks/us_sectors.json' },
    { key: 'MICRO_SECTORS', path: '/data/benchmarks/micro_sectors.json' },
    { key: 'DEVELOPED', path: '/data/benchmarks/developed.json' },
    { key: 'EMERGING', path: '/data/benchmarks/emerging.json' },
    { key: 'MSCI', path: '/data/benchmarks/msci.json' }
  ]
};

// 기본 fetch
async function fetchDataLabFile(fileKey) {
  const relPath = DATA_LAB_CONFIG.FILES[fileKey];
  if (!relPath) throw new Error(`Unknown file key: ${fileKey}`);

  const url = DATA_LAB_CONFIG.BASE_PATH + relPath;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}`);
  return response.json();
}

async function fetchDataLabPath(relPath) {
  const url = DATA_LAB_CONFIG.BASE_PATH + relPath;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}`);
  return response.json();
}

// Global Scouter v2.0 헬퍼
async function fetchScouterIndex() {
  return fetchDataLabFile('SCOUTER_INDEX');
}

async function fetchScouterDashboard() {
  return fetchDataLabFile('SCOUTER_DASHBOARD');
}

async function fetchStockDetail(ticker) {
  const url = DATA_LAB_CONFIG.BASE_PATH +
              DATA_LAB_CONFIG.PATHS.SCOUTER_DETAIL +
              ticker + '.json';
  const response = await fetch(url);
  if (!response.ok) return null; // 없는 종목은 null 반환
  return response.json();
}

async function fetchStockDetails(tickers) {
  const results = await Promise.allSettled(
    tickers.map(t => fetchStockDetail(t))
  );
  return results
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value);
}

// SEC 13F 헬퍼
async function fetch13FSummary() {
  return fetchDataLabFile('SEC13F_SUMMARY');
}

async function fetchInvestor(name) {
  const url = DATA_LAB_CONFIG.BASE_PATH +
              DATA_LAB_CONFIG.PATHS.SEC13F_INVESTORS +
              name + '.json';
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Investor not found: ${name}`);
  return response.json();
}

async function fetchAllInvestors(names) {
  const results = await Promise.allSettled(
    names.map(n => fetchInvestor(n))
  );
  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);
}
