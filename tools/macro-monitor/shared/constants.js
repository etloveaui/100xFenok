/**
 * 100x Market Radar - 공통 상수
 * @version 2.0.0
 * @description Phase 4-2: 임계값/색상/상태 중앙화
 */

// ============================================
// THRESHOLDS - 임계값 (Single Source of Truth)
// ============================================
export const THRESHOLDS = Object.freeze({
  // Liquidity Flow
  M2_YOY: {
    POSITIVE: 6,    // >= 6%: 녹색
    NEUTRAL: 2,     // 2-6%: 황색
    NEGATIVE: 2     // < 2%: 적색
  },
  NET_LIQUIDITY: {
    POSITIVE: 50,   // > $50B: 녹색
    NEUTRAL: 50,    // ±$50B: 황색
    NEGATIVE: -50   // < -$50B: 적색
  },
  STABLECOIN: {
    // SC/M2 비율 기준 (%) - 리서치 문서 참조
    POSITIVE: 1.5,  // >= 1.5%: 녹색 (강한 유입)
    NEUTRAL: 1.0,   // 1.0-1.5%: 황색 (보통)
    NEGATIVE: 1.0   // < 1.0%: 적색 (유출/이탈)
  },
  NET_LIQ_TRILLION: {
    POSITIVE: 6,    // >= $6T: 녹색
    NEUTRAL: 5      // >= $5T: 황색
  },

  // Liquidity Stress
  SPREAD: {
    NORMAL: 10,     // < 10bp: 정상
    CAUTION: 20,    // 10-20bp: 주의
    WARNING: 30,    // 20-30bp: 경계
    DANGER: 30      // > 30bp: 위험
  },
  RESERVES_GDP: {
    NORMAL: 12,     // >= 12%: 정상
    CAUTION: 10,    // 10-12%: 주의
    WARNING: 8,     // 8-10%: 경계
    DANGER: 8       // < 8%: 위험
  },

  // Overall Status (Liquidity Flow)
  OVERALL: {
    EXPANDING: { netLiq: 50, m2YoY: 4 },      // Net > 50 AND M2 >= 4
    CONTRACTING: { netLiq: -50, m2YoY: 2 }   // Net < -50 OR M2 < 2
  }
});

// ============================================
// COLORS - 색상 코드
// ============================================
export const COLORS = Object.freeze({
  // 상태별 색상
  STATUS: {
    POSITIVE: '#16a34a',   // 녹색 (정상/Expanding)
    NEUTRAL: '#ca8a04',    // 황색 (중립)
    WARNING: '#ea580c',    // 주황 (경계)
    NEGATIVE: '#dc2626',   // 적색 (위험/Contracting)
  },

  // Tailwind 호환 색상 (기존 코드 호환)
  STATUS_TW: {
    normal: '#22c55e',     // green-500
    caution: '#eab308',    // yellow-500
    warning: '#f97316',    // orange-500
    danger: '#ef4444'      // red-500
  },

  // 차트 색상
  CHART: {
    M2: '#3b82f6',         // 파랑
    NET_LIQ: '#10b981',    // 청록
    STABLECOIN: '#8b5cf6', // 보라
    TGA: '#f59e0b',        // 주황
    RRP: '#ef4444',        // 빨강
    FED_BS: '#6366f1',     // 인디고
    SPREAD: '#2563eb',     // 파랑
    RESERVES: '#10b981'    // 청록
  },

  // 배지 배경색
  BADGE: {
    POSITIVE: '#dcfce7',   // green-100
    NEUTRAL: '#fef9c3',    // yellow-100
    NEGATIVE: '#fee2e2'    // red-100
  },

  // 임계선 색상 (차트)
  THRESHOLD_LINE: {
    NORMAL: '#22c55e',     // 12% (green)
    CAUTION: '#eab308',    // 10% (yellow)
    DANGER: '#dc2626'      // 8% (red)
  }
});

// ============================================
// STATUS - 상태 정의
// ============================================
export const STATUS = Object.freeze({
  LIQUIDITY_FLOW: {
    EXPANDING: 'EXPANDING',
    NEUTRAL: 'NEUTRAL',
    CONTRACTING: 'CONTRACTING'
  },
  LIQUIDITY_STRESS: {
    NORMAL: 'normal',
    CAUTION: 'caution',
    WARNING: 'warning',
    DANGER: 'danger'
  }
});

// ============================================
// ICONS - 아이콘/이모지
// ============================================
export const ICONS = Object.freeze({
  // 상태 아이콘 (트렌드)
  STATUS: {
    EXPANDING: '📈',
    NEUTRAL: '➡️',
    CONTRACTING: '📉'
  },
  // 신호등
  SIGNAL: {
    POSITIVE: '🟢',
    NEUTRAL: '🟡',
    WARNING: '🟠',
    NEGATIVE: '🔴'
  },
  // 기존 호환
  STRESS: {
    normal: '🟢',
    caution: '🟡',
    warning: '🟠',
    danger: '🔴'
  }
});

// ============================================
// CACHE - 캐시 설정
// ============================================
export const CACHE = Object.freeze({
  PREFIX: 'macro_',
  TTL: 30 * 60 * 1000,              // 30분 (ms)
  STALE_THRESHOLD: 6 * 60 * 60 * 1000  // 6시간 (ms)
});

// ============================================
// LABELS - 라벨 (한글)
// ============================================
export const LABELS = Object.freeze({
  STATUS: {
    normal: '정상',
    caution: '주의',
    warning: '경계',
    danger: '위험'
  },
  FLOW: {
    EXPANDING: '확장',
    NEUTRAL: '중립',
    CONTRACTING: '수축'
  }
});

// ============================================
// 기존 호환용 (MACRO_CONSTANTS)
// ============================================
const MACRO_CONSTANTS = {
  // 캐시 설정
  CACHE_PREFIX: CACHE.PREFIX,
  CACHE_TTL: CACHE.TTL,

  // 위젯 ID
  WIDGET_IDS: {
    LIQUIDITY_STRESS: 'liquidity-stress',
    LIQUIDITY_FLOW: 'liquidity-flow',
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
  SPREAD_THRESHOLDS: THRESHOLDS.SPREAD,

  // Tier 2: Reserves/GDP 임계값 (%) - Fed 기준
  RATIO_THRESHOLDS: THRESHOLDS.RESERVES_GDP,

  // 상태 라벨 (한글)
  STATUS_LABELS: LABELS.STATUS,

  // 상태 색상
  STATUS_COLORS: COLORS.STATUS_TW,

  // 상태 이모지
  STATUS_EMOJI: ICONS.STRESS,

  // Detail 페이지 경로
  DETAIL_PATHS: {
    'liquidity-stress': 'tools/macro-monitor/details/liquidity-stress.html',
    'liquidity-flow': 'tools/macro-monitor/details/liquidity-flow.html',
    'treasury-spread': 'tools/macro-monitor/details/treasury-spread.html',
    'vix': 'tools/macro-monitor/details/vix.html'
  }
};

// ES Module export (브라우저용)
export { MACRO_CONSTANTS };

// CommonJS 호환 (Node.js 테스트용)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MACRO_CONSTANTS, THRESHOLDS, COLORS, STATUS, ICONS, CACHE, LABELS };
}
