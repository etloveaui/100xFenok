/**
 * 공통 Constants
 *
 * 임계값, 색상, 레이블 등 상수 정의
 *
 * @module constants
 */

const CONSTANTS = {

  // 데이터 경로 (절대 고정 - 스킬에서 사용)
  DATA_BASE: '/data/benchmarks',

  // 파일 목록
  FILES: {
    US: 'us.json',
    SECTORS: 'us_sectors.json',
    MICRO: 'micro_sectors.json',
    DEVELOPED: 'developed.json',
    EMERGING: 'emerging.json',
    MSCI: 'msci.json'
  },

  // 신호등 임계값 (분위수 기준)
  THRESHOLDS: {
    PERCENTILE: {
      CHEAP: 30,        // 30% 이하 = 저평가
      FAIR_LOW: 30,     // 30~70% = 적정
      FAIR_HIGH: 70,
      EXPENSIVE: 70     // 70% 이상 = 고평가
    },
    PE: {
      LOW: 10,          // P/E 10 이하 = 매우 저평가
      HIGH: 25          // P/E 25 이상 = 고평가
    },
    PB: {
      LOW: 1.0,         // P/B 1 이하 = 저평가
      HIGH: 3.0         // P/B 3 이상 = 고평가
    },
    ROE: {
      LOW: 8,           // ROE 8% 이하 = 저조
      HIGH: 15          // ROE 15% 이상 = 우수
    }
  },

  // 신호등 색상 (Tailwind CSS 클래스)
  COLORS: {
    SIGNAL: {
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
      },
      GRAY: {
        bg: 'bg-gray-100',
        text: 'text-gray-500',
        border: 'border-gray-300',
        hex: '#6b7280'
      }
    },
    CHART: {
      PRIMARY: '#3b82f6',     // blue-500
      SECONDARY: '#8b5cf6',   // violet-500
      SUCCESS: '#22c55e',     // green-500
      WARNING: '#f59e0b',     // amber-500
      DANGER: '#ef4444',      // red-500
      NEUTRAL: '#6b7280'      // gray-500
    }
  },

  // 레이블 (한글)
  LABELS: {
    SIGNAL: {
      CHEAP: '저평가',
      FAIR: '적정',
      EXPENSIVE: '고평가',
      NA: 'N/A'
    },
    METRICS: {
      PE: 'P/E',
      PB: 'P/B',
      ROE: 'ROE',
      EARNINGS_YIELD: '이익수익률',
      PERCENTILE: '분위수'
    },
    REGIONS: {
      US: '미국',
      DEVELOPED: '선진국',
      EMERGING: '신흥국',
      SECTORS: '섹터'
    }
  },

  // 분석 기간
  PERIODS: {
    HISTORY_YEARS: 15,        // 15년 히스토리
    DEFAULT_LOOKBACK: 252,    // 1년 영업일
    WEEK_52: 252              // 52주 = 252 영업일
  },

  // MVP 상태
  MVP_STATUS: {
    PENDING: 'pending',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    TESTING: 'testing'
  }
};

// Object.freeze로 불변성 보장
Object.freeze(CONSTANTS);
Object.freeze(CONSTANTS.FILES);
Object.freeze(CONSTANTS.THRESHOLDS);
Object.freeze(CONSTANTS.THRESHOLDS.PERCENTILE);
Object.freeze(CONSTANTS.THRESHOLDS.PE);
Object.freeze(CONSTANTS.THRESHOLDS.PB);
Object.freeze(CONSTANTS.THRESHOLDS.ROE);
Object.freeze(CONSTANTS.COLORS);
Object.freeze(CONSTANTS.COLORS.SIGNAL);
Object.freeze(CONSTANTS.COLORS.CHART);
Object.freeze(CONSTANTS.LABELS);
Object.freeze(CONSTANTS.PERIODS);
Object.freeze(CONSTANTS.MVP_STATUS);
