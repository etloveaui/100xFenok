/**
 * Data Lab 설정
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
    DAMODARAN_ERP: '/data/damodaran/erp.json',
    DAMODARAN_EVSALES: '/data/damodaran/ev_sales.json',
    GLOBAL_SCOUTER: '/data/global-scouter/stocks.json'
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
