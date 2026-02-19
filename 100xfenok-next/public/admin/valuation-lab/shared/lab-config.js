/**
 * Valuation Lab 설정
 */

// 동적 base path (Cloudflare Pages, localhost, GitHub Pages 호환)
const getBasePath = () => {
  const isLocal = /^(127\.0\.0\.1|localhost|192\.168\.\d+\.\d+)$/.test(location.hostname) || location.protocol === 'file:';
  const isCloudflare = location.hostname.endsWith('pages.dev');
  return (isLocal || isCloudflare) ? '' : '/100xFenok';
};

const LAB_CONFIG = {
  // 데이터 경로 (동적)
  DATA_BASE: getBasePath() + '/data/benchmarks',

  // 파일 목록
  FILES: {
    US: 'us.json',
    SECTORS: 'us_sectors.json',
    MICRO: 'micro_sectors.json',
    DEVELOPED: 'developed.json',
    EMERGING: 'emerging.json',
    MSCI: 'msci.json'
  },

  // MVP 기능 상태
  MVP_STATUS: {
    SIGNAL_LIGHT: 'pending',    // 신호등
    ONE_LINER: 'pending',       // 1문장 해석
    PERCENTILE: 'pending',      // 분위수 차트
    CARD: 'pending'             // 밸류에이션 카드
  },

  // 신호등 임계값 (분위수 기준)
  THRESHOLDS: {
    CHEAP: 30,      // 30% 이하 = 저평가
    FAIR_LOW: 30,   // 30~70% = 적정
    FAIR_HIGH: 70,
    EXPENSIVE: 70   // 70% 이상 = 고평가
  }
};

/**
 * 데이터 fetch 헬퍼
 * @param {string} fileKey - FILES 객체의 키
 * @returns {Promise<Object>} JSON 데이터
 */
async function fetchBenchmarkData(fileKey) {
  const file = LAB_CONFIG.FILES[fileKey];
  if (!file) throw new Error(`Unknown file key: ${fileKey}`);

  const url = `${LAB_CONFIG.DATA_BASE}/${file}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}`);
  return response.json();
}
