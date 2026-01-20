/**
 * 공통 Constants
 *
 * 임계값, 색상, 레이블 등 상수 정의
 *
 * @module constants
 */

const VALUATION_CONFIG = {
  THRESHOLDS: {
    PERCENTILE: { CHEAP: 30, FAIR_LOW: 30, FAIR_HIGH: 70, EXPENSIVE: 70 },
    PE: { LOW: 10, HIGH: 25 },
    PB: { LOW: 1.0, HIGH: 3.0 },
    ROE: { LOW: 8, HIGH: 15 }
  },
  COLORS: {
    GOOD: '#22c55e',
    NEUTRAL: '#eab308',
    WARNING: '#ef4444'
  },
  LABELS: {
    CHEAP: 'Undervalued',
    FAIR: 'Fair Value',
    EXPENSIVE: 'Overvalued'
  },
  // 신호등 색상 (Tailwind CSS 클래스) - Legacy Support
  SIGNAL_COLORS: {
    GREEN: {
      bg: 'bg-green-100',
      text: 'text-green-600',
      border: 'border-green-500',
      hex: '#16a34a'
    },
    YELLOW: {
      bg: 'bg-yellow-100',
      text: 'text-yellow-600',
      border: 'border-yellow-500',
      hex: '#ca8a04'
    },
    RED: {
      bg: 'bg-red-100',
      text: 'text-red-600',
      border: 'border-red-500',
      hex: '#dc2626'
    }
  }
};

// Legacy compatibility for existing modules using CONSTANTS
const CONSTANTS = VALUATION_CONFIG;

