/**
 * Valuation Lab Configuration
 *
 * Centralized config for all 7 data folders and workstreams.
 * Based on Data Lab pattern (DEC-108).
 *
 * @module vlab-config
 * @version 1.0.0
 */

const VLAB_CONFIG = {
  // ========================================
  // Data Folders (from manifest.json)
  // ========================================
  FOLDERS: {
    benchmarks: {
      label: 'Benchmarks',
      description: 'Layer 0~1B 완료 · 20/20',
      status: 'review',
      statusLabel: '검토 대기',
      color: 'amber',
      files: [
        '/data/benchmarks/us.json',
        '/data/benchmarks/us_sectors.json',
        '/data/benchmarks/micro_sectors.json',
        '/data/benchmarks/developed.json',
        '/data/benchmarks/emerging.json',
        '/data/benchmarks/msci.json'
      ],
      tools: [
        { href: 'signal-light.html', label: '신호등' },
        { href: 'one-liner.html', label: '1문장' },
        { href: 'percentile.html', label: '분위수' },
        { href: 'card.html', label: '카드' }
      ],
      expansions: [
        { href: 'expansion/regime-presets.html', label: '국면 프리셋' },
        { href: 'expansion/composite-report.html', label: 'Composite' }
      ]
    },

    'global-scouter': {
      label: 'Global Scouter',
      description: 'A~E 대시보드/스크리너',
      status: 'expansion',
      statusLabel: '확장 검증',
      color: 'indigo',
      files: [
        '/data/global-scouter/core/metadata.json',
        '/data/global-scouter/core/dashboard.json',
        '/data/global-scouter/core/stocks_index.json'
      ],
      tools: [
        { href: 'expansion/dashboard.html', label: '통합 대시보드' },
        { href: 'expansion/per-band.html', label: 'PER 밴드' },
        { href: 'expansion/sector-gap.html', label: '섹터 갭' },
        { href: 'expansion/eps-growth.html', label: 'EPS 성장' }
      ]
    },

    damodaran: {
      label: 'Damodaran',
      description: 'ERP/EV 벤치마크',
      status: 'expansion',
      statusLabel: '확장 검증',
      color: 'indigo',
      files: [
        '/data/damodaran/erp.json',
        '/data/damodaran/industries.json',
        '/data/damodaran/betas.json',
        '/data/damodaran/margins.json'
      ],
      tools: [
        { href: 'expansion/damodaran-hub.html', label: '허브' },
        { href: 'expansion/erp-rank.html', label: 'ERP 랭킹' },
        { href: 'expansion/ev-sales.html', label: 'EV/Sales' }
      ]
    },

    'sec-13f': {
      label: 'SEC 13F',
      description: '유명 투자자 포트폴리오 (17명)',
      status: 'ready',
      statusLabel: '준비 중',
      color: 'gray',
      files: [
        '/data/sec-13f/summary.json',
        '/data/sec-13f/by_sector.json',
        '/data/sec-13f/by_ticker.json'
      ],
      tools: [],
      info: [
        { icon: 'fa-user-tie', text: 'Warren Buffett, Michael Burry, Bill Ackman...' },
        { icon: 'fa-chart-pie', text: '분기별 포지션 변동 추적' },
        { icon: 'fa-database', text: '데이터 준비됨 · 기능 개발 대기' }
      ]
    },

    indices: {
      label: 'Indices',
      description: 'S&P 500, NASDAQ 100 지수',
      status: 'ready',
      statusLabel: '데이터 준비',
      color: 'sky',
      files: [
        '/data/indices/sp500.json',
        '/data/indices/nasdaq100.json'
      ],
      tools: [],
      info: [
        { icon: 'fa-chart-line', text: '지수 가격 데이터' },
        { icon: 'fa-calendar', text: '일별 종가 시계열' }
      ]
    },

    sentiment: {
      label: 'Sentiment',
      description: '시장 심리 지표 (6개 소스)',
      status: 'ready',
      statusLabel: '데이터 준비',
      color: 'purple',
      files: [
        '/data/sentiment/aaii.json',
        '/data/sentiment/cftc-sp500.json',
        '/data/sentiment/cnn-fear-greed.json',
        '/data/sentiment/crypto-fear-greed.json',
        '/data/sentiment/move.json',
        '/data/sentiment/vix.json'
      ],
      tools: [],
      info: [
        { icon: 'fa-brain', text: 'AAII, CNN Fear & Greed' },
        { icon: 'fa-chart-area', text: 'VIX, MOVE Index' },
        { icon: 'fa-bitcoin', text: 'Crypto Fear & Greed' }
      ]
    },

    slickcharts: {
      label: 'SlickCharts',
      description: '32 scrapers · 100% coverage',
      status: 'ready',
      statusLabel: '데이터 준비',
      color: 'emerald',
      files: [
        '/data/slickcharts/sp500.json',
        '/data/slickcharts/nasdaq100.json',
        '/data/slickcharts/dowjones.json',
        '/data/slickcharts/sp500-returns.json',
        '/data/slickcharts/stocks-returns.json'
      ],
      tools: [],
      info: [
        { icon: 'fa-list', text: '지수 구성종목 (S&P 500, NASDAQ 100, Dow Jones)' },
        { icon: 'fa-percent', text: '연간 수익률 (47년 히스토리)' },
        { icon: 'fa-coins', text: '배당 데이터 (13년 히스토리)' }
      ]
    }
  },

  // ========================================
  // Status Colors
  // ========================================
  STATUS_COLORS: {
    review: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-100' },
    expansion: { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-100' },
    ready: { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-100' },
    verified: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-100' }
  },

  // ========================================
  // Pipeline Stages
  // ========================================
  PIPELINE: [
    { stage: 1, label: '데이터 검증', status: 'verified', note: 'Data Lab로 통합' },
    { stage: 2, label: 'MVP 테스트', status: 'review', note: 'Benchmarks 완료' },
    { stage: 3, label: '확장 검증', status: 'expansion', note: 'Global Scouter / Damodaran' },
    { stage: 4, label: '배포', status: 'ready', note: '승인 대상 확정 전' }
  ],

  // ========================================
  // Checklist Items
  // ========================================
  CHECKLIST: {
    benchmarks: { label: 'Benchmarks', items: ['데이터 검증 ✅', 'UI 테스트 ⏳', '문서 ⏳'] },
    'global-scouter': { label: 'Global Scouter', items: ['데이터 검증 ✅', 'UX 점검 ⏳', '운영 기준 ⏳'] },
    damodaran: { label: 'Damodaran', items: ['데이터 검증 ✅', '활용 전략 ⏳', '운영 기준 ⏳'] },
    'sec-13f': { label: 'SEC 13F', items: ['데이터 준비 ✅', '위젯 개발 ⏳', 'UI 테스트 ⏳'] },
    indices: { label: 'Indices', items: ['데이터 검증 ✅', '차트 개발 ⏳', '통합 ⏳'] },
    sentiment: { label: 'Sentiment', items: ['데이터 검증 ✅', '위젯 개발 ⏳', '대시보드 ⏳'] },
    slickcharts: { label: 'SlickCharts', items: ['스크래퍼 완료 ✅', '파이프라인 ✅', 'UI 개발 ⏳'] }
  }
};

// Helper functions
function getBasePath() {
  const isLocal = /^(127\.0\.0\.1|localhost|192\.168\.\d+\.\d+)$/.test(location.hostname) || location.protocol === 'file:';
  const isCloudflare = location.hostname.endsWith('pages.dev');
  return (isLocal || isCloudflare) ? '' : '/100xFenok';
}

function getFolderConfig(folderName) {
  return VLAB_CONFIG.FOLDERS[folderName] || null;
}

function getAllFolders() {
  return Object.keys(VLAB_CONFIG.FOLDERS);
}

function getStatusColor(status) {
  return VLAB_CONFIG.STATUS_COLORS[status] || VLAB_CONFIG.STATUS_COLORS.ready;
}
