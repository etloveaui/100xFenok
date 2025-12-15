/**
 * Macro Monitor - 데이터 매니저
 * localStorage 기반 캐싱 + Widget-Detail 동기화
 * @version 1.0.0
 */

class MacroDataManager {
  constructor() {
    this.prefix = 'macro_';
    this.ttl = 24 * 60 * 60 * 1000; // 24시간 (fresh)
    this.staleTtl = 7 * 24 * 60 * 60 * 1000; // 7일 (stale 경고 임계값)
  }

  /**
   * Detail에서 호출 - 계산 결과 캐시에 저장
   * @param {string} widgetId - 위젯 ID (예: 'liquidity-stress')
   * @param {object} data - 저장할 데이터
   */
  saveWidgetData(widgetId, data) {
    const cacheData = {
      data: data,
      timestamp: Date.now(),
      expires: Date.now() + this.ttl
    };

    try {
      localStorage.setItem(this.prefix + widgetId, JSON.stringify(cacheData));

      // 다른 탭/iframe에 알림 (선택적)
      window.dispatchEvent(new CustomEvent('macro-data-updated', {
        detail: { widgetId, data }
      }));

      return true;
    } catch (e) {
      console.error('[MacroDataManager] Save failed:', e);
      return false;
    }
  }

  /**
   * Widget에서 호출 - 캐시에서 데이터 읽기
   * 만료되어도 삭제하지 않고 stale 데이터 반환 (7일까지 유지)
   * @param {string} widgetId - 위젯 ID
   * @returns {object|null} - 캐시 데이터 또는 null (없음)
   */
  getWidgetData(widgetId) {
    try {
      const cached = localStorage.getItem(this.prefix + widgetId);
      if (!cached) return null;

      const { data, timestamp } = JSON.parse(cached);

      // Stale 임계값(7일) 초과 시에만 삭제
      if (Date.now() - timestamp > this.staleTtl) {
        this.clearWidgetData(widgetId);
        return null;
      }

      return data;
    } catch (e) {
      console.error('[MacroDataManager] Read failed:', e);
      return null;
    }
  }

  /**
   * 캐시 삭제
   * @param {string} widgetId - 위젯 ID
   */
  clearWidgetData(widgetId) {
    localStorage.removeItem(this.prefix + widgetId);
  }

  /**
   * 모든 매크로 캐시 삭제
   */
  clearAll() {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(this.prefix));
    keys.forEach(k => localStorage.removeItem(k));
  }

  /**
   * 캐시 상태 확인
   * @param {string} widgetId - 위젯 ID
   * @returns {object} - { exists, expired, remainingMs }
   */
  getCacheStatus(widgetId) {
    const cached = localStorage.getItem(this.prefix + widgetId);
    if (!cached) return { exists: false, expired: true, remainingMs: 0 };

    try {
      const { expires } = JSON.parse(cached);
      const now = Date.now();
      return {
        exists: true,
        expired: now > expires,
        remainingMs: Math.max(0, expires - now)
      };
    } catch (e) {
      return { exists: false, expired: true, remainingMs: 0 };
    }
  }

  /**
   * 데이터가 stale 상태인지 확인 (6시간 경과)
   * @param {string} widgetId - 위젯 ID
   * @returns {boolean} - stale 여부
   */
  isStale(widgetId) {
    const cached = localStorage.getItem(this.prefix + widgetId);
    if (!cached) return true;

    try {
      const { timestamp } = JSON.parse(cached);
      return Date.now() - timestamp > this.staleTtl;
    } catch (e) {
      return true;
    }
  }

  /**
   * Widget에서 호출 - 캐시 데이터 + stale 상태 함께 반환
   * expired(30분)되어도 삭제하지 않고, stale 여부만 표시
   * @param {string} widgetId - 위젯 ID
   * @returns {object} - { data, isStale, isFresh, ageMs }
   */
  getWidgetDataWithStale(widgetId) {
    try {
      const cached = localStorage.getItem(this.prefix + widgetId);
      if (!cached) return { data: null, isStale: true, isFresh: false, ageMs: 0 };

      const { data, timestamp, expires } = JSON.parse(cached);
      const now = Date.now();
      const ageMs = now - timestamp;

      return {
        data,
        isStale: ageMs > this.staleTtl,  // 6시간 초과
        isFresh: now <= expires,          // 30분 이내
        ageMs
      };
    } catch (e) {
      console.error('[MacroDataManager] Read with stale failed:', e);
      return { data: null, isStale: true, isFresh: false, ageMs: 0 };
    }
  }

  /**
   * 데이터 나이를 사람이 읽기 쉬운 형태로 변환
   * @param {number} ageMs - 밀리초
   * @returns {string} - "5분 전", "2시간 전" 등
   */
  static formatAge(ageMs) {
    const minutes = Math.floor(ageMs / 60000);
    if (minutes < 1) return '방금 전';
    if (minutes < 60) return `${minutes}분 전`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}시간 전`;
    const days = Math.floor(hours / 24);
    return `${days}일 전`;
  }

  /**
   * 종합 상태 계산 (Tier1 + Tier2 기반)
   * @param {string} tier1Status - Tier1 상태 (normal/caution/warning/danger)
   * @param {string} tier2Status - Tier2 상태
   * @returns {object} - { key, label, color }
   */
  static calculateOverallStatus(tier1Status, tier2Status) {
    const statusOrder = ['normal', 'caution', 'warning', 'danger'];
    const tier1Idx = statusOrder.indexOf(tier1Status);
    const tier2Idx = statusOrder.indexOf(tier2Status);

    // 둘 중 더 나쁜 상태 기준
    const worstIdx = Math.max(tier1Idx, tier2Idx);

    // 종합 상태 매핑
    const overallMap = {
      0: { key: 'normal', label: 'Normal', color: '#22c55e' },
      1: { key: 'caution', label: 'Caution', color: '#eab308' },
      2: { key: 'high_stress', label: 'High Stress', color: '#f97316' },
      3: { key: 'critical', label: 'Critical', color: '#ef4444' }
    };

    return overallMap[worstIdx] || overallMap[0];
  }

  /**
   * Spread(bp) → 상태 변환
   * @param {number} spreadBp - 스프레드 (bp)
   * @returns {string} - 상태 키
   */
  static getSpreadStatus(spreadBp) {
    if (spreadBp >= 30) return 'danger';
    if (spreadBp >= 20) return 'warning';
    if (spreadBp >= 10) return 'caution';
    return 'normal';
  }

  /**
   * Ratio(%) → 상태 변환
   * @param {number} ratioPercent - RB/GDP 비율 (%)
   * @returns {string} - 상태 키
   */
  static getRatioStatus(ratioPercent) {
    // Fed 기준: 8% 미만 위험(2019 위기), 8-10% 경계, 10-12% 주의, 12%+ 정상
    if (ratioPercent < 8) return 'danger';
    if (ratioPercent < 10) return 'warning';
    if (ratioPercent < 12) return 'caution';
    return 'normal';
  }

  // =========================================
  // Intl.NumberFormat 유틸리티
  // =========================================

  /**
   * 통화 형식 포맷 (예: $22.3T, +$39B)
   * @param {number} value - 값
   * @param {object} options - { sign: boolean, unit: 'T'|'B'|'M'|'auto', decimals: number }
   * @returns {string}
   */
  static formatCurrency(value, options = {}) {
    const { sign = false, unit = 'auto', decimals = 1 } = options;

    let absValue = Math.abs(value);
    let suffix = '';

    // 단위 결정
    if (unit === 'auto') {
      if (absValue >= 1e12) { absValue /= 1e12; suffix = 'T'; }
      else if (absValue >= 1e9) { absValue /= 1e9; suffix = 'B'; }
      else if (absValue >= 1e6) { absValue /= 1e6; suffix = 'M'; }
      else if (absValue >= 1e3) { absValue /= 1e3; suffix = 'K'; }
    } else {
      const unitMap = { 'T': 1e12, 'B': 1e9, 'M': 1e6, 'K': 1e3 };
      if (unitMap[unit]) { absValue /= unitMap[unit]; suffix = unit; }
    }

    const formatted = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(absValue);

    const prefix = sign ? (value >= 0 ? '+$' : '-$') : '$';
    return `${prefix}${formatted}${suffix}`;
  }

  /**
   * 퍼센트 형식 포맷 (예: +1.02%, -0.5%)
   * @param {number} value - 값 (이미 % 단위)
   * @param {object} options - { sign: boolean, decimals: number }
   * @returns {string}
   */
  static formatPercent(value, options = {}) {
    const { sign = false, decimals = 2 } = options;

    const formatted = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(Math.abs(value));

    const prefix = sign ? (value >= 0 ? '+' : '-') : (value < 0 ? '-' : '');
    return `${prefix}${formatted}%`;
  }

  /**
   * 일반 숫자 형식 포맷 (예: +39, -12.5)
   * @param {number} value - 값
   * @param {object} options - { sign: boolean, decimals: number, suffix: string }
   * @returns {string}
   */
  static formatNumber(value, options = {}) {
    const { sign = false, decimals = 0, suffix = '' } = options;

    const formatted = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(Math.abs(value));

    const prefix = sign ? (value >= 0 ? '+' : '-') : (value < 0 ? '-' : '');
    return `${prefix}${formatted}${suffix}`;
  }
}

// 싱글톤 인스턴스
const DataManager = new MacroDataManager();

// ES Module export (브라우저용)
export { MacroDataManager, DataManager };

// CommonJS 호환 (Node.js 테스트용)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MacroDataManager, DataManager };
}
