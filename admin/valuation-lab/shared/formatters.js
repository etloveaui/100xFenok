/**
 * 공통 Formatters
 *
 * 숫자, 퍼센트, 날짜, 신호등 등 포맷팅 유틸리티
 *
 * @module formatters
 */

const Formatters = (function() {

  /**
   * 숫자 포맷팅
   * @param {number} num - 숫자
   * @param {number} decimals - 소수점 자릿수 (기본: 2)
   * @param {string} fallback - null/undefined 시 반환값 (기본: '-')
   * @returns {string}
   */
  function formatNumber(num, decimals = 2, fallback = '-') {
    if (num === null || num === undefined || isNaN(num)) {
      return fallback;
    }
    return num.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  /**
   * 퍼센트 포맷팅
   * @param {number} num - 숫자 (0.15 = 15%)
   * @param {number} decimals - 소수점 자릿수 (기본: 1)
   * @param {boolean} showSign - 부호 표시 여부 (기본: false)
   * @param {string} fallback - null/undefined 시 반환값
   * @returns {string}
   */
  function formatPercent(num, decimals = 1, showSign = false, fallback = '-') {
    if (num === null || num === undefined || isNaN(num)) {
      return fallback;
    }
    const pct = num * 100;
    const formatted = pct.toFixed(decimals);
    const sign = showSign && pct > 0 ? '+' : '';
    return `${sign}${formatted}%`;
  }

  /**
   * 날짜 포맷팅
   * @param {string|Date} date - 날짜
   * @param {string} format - 포맷 ('YYYY-MM-DD', 'MM/DD', 'YYYY년 MM월')
   * @returns {string}
   */
  function formatDate(date, format = 'YYYY-MM-DD') {
    if (!date) return '-';

    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '-';

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    switch (format) {
      case 'YYYY-MM-DD':
        return `${year}-${month}-${day}`;
      case 'MM/DD':
        return `${month}/${day}`;
      case 'YYYY년 MM월':
        return `${year}년 ${parseInt(month)}월`;
      case 'YYYY.MM.DD':
        return `${year}.${month}.${day}`;
      default:
        return `${year}-${month}-${day}`;
    }
  }

  /**
   * 신호등 포맷팅 (분위수 기반)
   * @param {number} percentile - 분위수 (0-100)
   * @param {Object} thresholds - 임계값 객체
   * @returns {Object} { signal: '🟢'|'🟡'|'🔴', label: string, color: string }
   */
  function formatSignal(percentile, thresholds = { CHEAP: 30, EXPENSIVE: 70 }) {
    if (percentile === null || percentile === undefined || isNaN(percentile)) {
      return { signal: '⚪', label: 'N/A', color: 'gray' };
    }

    if (percentile <= thresholds.CHEAP) {
      return { signal: '🟢', label: '저평가', color: 'green' };
    } else if (percentile >= thresholds.EXPENSIVE) {
      return { signal: '🔴', label: '고평가', color: 'red' };
    } else {
      return { signal: '🟡', label: '적정', color: 'yellow' };
    }
  }

  /**
   * P/E 비율 포맷팅
   * @param {number} pe - P/E 비율
   * @returns {string}
   */
  function formatPE(pe) {
    if (pe === null || pe === undefined || isNaN(pe) || pe <= 0) {
      return '-';
    }
    return pe.toFixed(1) + 'x';
  }

  /**
   * P/B 비율 포맷팅
   * @param {number} pb - P/B 비율
   * @returns {string}
   */
  function formatPB(pb) {
    if (pb === null || pb === undefined || isNaN(pb) || pb <= 0) {
      return '-';
    }
    return pb.toFixed(2) + 'x';
  }

  /**
   * 큰 숫자 축약 (K, M, B)
   * @param {number} num
   * @param {number} decimals
   * @returns {string}
   */
  function formatCompact(num, decimals = 1) {
    if (num === null || num === undefined || isNaN(num)) {
      return '-';
    }

    const absNum = Math.abs(num);
    const sign = num < 0 ? '-' : '';

    if (absNum >= 1e12) {
      return sign + (absNum / 1e12).toFixed(decimals) + 'T';
    } else if (absNum >= 1e9) {
      return sign + (absNum / 1e9).toFixed(decimals) + 'B';
    } else if (absNum >= 1e6) {
      return sign + (absNum / 1e6).toFixed(decimals) + 'M';
    } else if (absNum >= 1e3) {
      return sign + (absNum / 1e3).toFixed(decimals) + 'K';
    }
    return sign + absNum.toFixed(decimals);
  }

  return {
    formatNumber,
    formatPercent,
    formatDate,
    formatSignal,
    formatPE,
    formatPB,
    formatCompact
  };
})();
