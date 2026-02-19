/**
 * Common Formatters (Unified)
 *
 * Number, percent, date, signal formatting utilities
 *
 * @module formatters
 * @version 3.0.0 (unified for admin/shared)
 */

const Formatters = (function() {

  /**
   * Format number
   * @param {number} num - number
   * @param {number} decimals - decimal places (default: 2)
   * @param {string} fallback - fallback for null/undefined (default: '-')
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
   * Format percent
   * @param {number} num - number (0.15 = 15%)
   * @param {number} decimals - decimal places (default: 1)
   * @param {boolean} showSign - show +/- sign (default: false)
   * @param {string} fallback - fallback for null/undefined
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
   * Format date
   * @param {string|Date} date - date
   * @param {string} format - format ('YYYY-MM-DD', 'MM/DD', 'YYYY.MM.DD')
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
      case 'YYYY.MM.DD':
        return `${year}.${month}.${day}`;
      case 'MMM DD, YYYY':
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      default:
        return `${year}-${month}-${day}`;
    }
  }

  /**
   * Format signal (percentile-based)
   * @param {number} percentile - percentile (0-100)
   * @param {Object} thresholds - threshold object
   * @returns {Object} { signal, label, color }
   */
  function formatSignal(percentile, thresholds = { CHEAP: 30, EXPENSIVE: 70 }) {
    if (percentile === null || percentile === undefined || isNaN(percentile)) {
      return { signal: '⚪', label: 'N/A', color: 'gray' };
    }

    if (percentile <= thresholds.CHEAP) {
      return { signal: '🟢', label: 'Good', color: 'green' };
    } else if (percentile >= thresholds.EXPENSIVE) {
      return { signal: '🔴', label: 'Warning', color: 'red' };
    } else {
      return { signal: '🟡', label: 'Normal', color: 'yellow' };
    }
  }

  /**
   * Format file count
   * @param {number} count
   * @returns {string}
   */
  function formatFileCount(count) {
    if (count === null || count === undefined || isNaN(count)) {
      return '-';
    }
    return `${formatNumber(count, 0)} files`;
  }

  /**
   * Format compact number (K, M, B)
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

  /**
   * Format bytes to human readable
   * @param {number} bytes
   * @returns {string}
   */
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Format version string
   * @param {string} version
   * @returns {string}
   */
  function formatVersion(version) {
    if (!version) return '-';
    return `v${version}`;
  }

  return {
    formatNumber,
    formatPercent,
    formatDate,
    formatSignal,
    formatFileCount,
    formatCompact,
    formatBytes,
    formatVersion
  };
})();
