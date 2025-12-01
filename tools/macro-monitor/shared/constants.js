/**
 * Macro Monitor - 공통 상수
 * @version 1.0.0
 */

const MACRO_CONSTANTS = {
  // 캐시 설정
  CACHE_PREFIX: 'macro_',
  CACHE_TTL: 30 * 60 * 1000,  // 30분

  // 위젯 ID
  WIDGET_IDS: {
    LIQUIDITY_STRESS: 'liquidity-stress',
    TREASURY_SPREAD: 'treasury-spread',
    VIX: 'vix'
  },

  // 상태 정의
  STATUS: {
    NORMAL: 'normal',
    CAUTION: 'caution',
    WARNING: 'warning',
    DANGER: 'danger'
  },

  // 종합 상태 정의
  OVERALL_STATUS: {
    NORMAL: { key: 'normal', label: 'Normal', color: '#22c55e' },
    CAUTION: { key: 'caution', label: 'Caution', color: '#eab308' },
    HIGH_STRESS: { key: 'high_stress', label: 'High Stress', color: '#f97316' },
    CRITICAL: { key: 'critical', label: 'Critical', color: '#ef4444' }
  },

  // Tier 1: SOFR-IORB Spread 임계값 (bp)
  SPREAD_THRESHOLDS: {
    CAUTION: 10,   // 10bp 이상 주의
    WARNING: 20,   // 20bp 이상 경계
    DANGER: 30     // 30bp 이상 위험
  },

  // Tier 2: Reserves/GDP 임계값 (%) - Fed 기준
  RATIO_THRESHOLDS: {
    NORMAL: 12,    // 12% 이상 정상 (충분)
    CAUTION: 10,   // 10~12% 주의 (권장선 근접)
    WARNING: 8,    // 8~10% 경계 (Ample 하단)
    DANGER: 8      // 8% 미만 위험 (2019년 7%에서 위기)
  },

  // 상태 라벨 (한글)
  STATUS_LABELS: {
    normal: '정상',
    caution: '주의',
    warning: '경계',
    danger: '위험'
  },

  // 상태 색상
  STATUS_COLORS: {
    normal: '#22c55e',   // green-500
    caution: '#eab308',  // yellow-500
    warning: '#f97316',  // orange-500
    danger: '#ef4444'    // red-500
  },

  // 상태 이모지
  STATUS_EMOJI: {
    normal: '🟢',
    caution: '🟡',
    warning: '🟠',
    danger: '🔴'
  },

  // Detail 페이지 경로
  DETAIL_PATHS: {
    'liquidity-stress': 'tools/macro-monitor/details/liquidity-stress.html',
    'treasury-spread': 'tools/macro-monitor/details/treasury-spread.html',
    'vix': 'tools/macro-monitor/details/vix.html'
  }
};

// ES Module export (브라우저용)
export { MACRO_CONSTANTS };

// CommonJS 호환 (Node.js 테스트용)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MACRO_CONSTANTS;
}
