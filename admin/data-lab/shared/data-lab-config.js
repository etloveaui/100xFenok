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
    DAMODARAN_EVSALES: '/data/damodaran/ev_sales.json',

    // Global Scouter - Core (v2.0)
    SCOUTER_METADATA: '/data/global-scouter/core/metadata.json',
    SCOUTER_DASHBOARD: '/data/global-scouter/core/dashboard.json',
    SCOUTER_INDEX: '/data/global-scouter/core/stocks_index.json',

    // SEC 13F (신규)
    SEC13F_SUMMARY: '/data/sec-13f/summary.json',
    SEC13F_BY_SECTOR: '/data/sec-13f/by_sector.json',
    SEC13F_BY_TICKER: '/data/sec-13f/by_ticker.json',

    // SlickCharts (Phase 5)
    SLICK_GAINERS: '/data/slickcharts/gainers.json',
    SLICK_LOSERS: '/data/slickcharts/losers.json',
    SLICK_TREASURY: '/data/slickcharts/treasury.json',
    SLICK_CURRENCY: '/data/slickcharts/currency.json',
    SLICK_SP500: '/data/slickcharts/sp500.json',
    SLICK_NASDAQ100: '/data/slickcharts/nasdaq100.json',
    SLICK_DOWJONES: '/data/slickcharts/dowjones.json'
  },
  PATHS: {
    SCOUTER_DETAIL: '/data/global-scouter/stocks/detail/',
    SEC13F_INVESTORS: '/data/sec-13f/investors/'
  },
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
