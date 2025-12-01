/**
 * Macro Monitor - 데이터 매니저
 * localStorage 기반 캐싱 + Widget-Detail 동기화
 * @version 1.0.0
 */

class MacroDataManager {
  constructor() {
    this.prefix = 'macro_';
    this.ttl = 30 * 60 * 1000; // 30분
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
   * @param {string} widgetId - 위젯 ID
   * @returns {object|null} - 캐시 데이터 또는 null (만료/없음)
   */
  getWidgetData(widgetId) {
    try {
      const cached = localStorage.getItem(this.prefix + widgetId);
      if (!cached) return null;

      const { data, expires } = JSON.parse(cached);

      // 만료 체크
      if (Date.now() > expires) {
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
    if (ratioPercent < 8) return 'danger';
    if (ratioPercent < 9) return 'warning';
    if (ratioPercent < 10) return 'caution';
    if (ratioPercent < 11) return 'caution';
    return 'normal';
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
