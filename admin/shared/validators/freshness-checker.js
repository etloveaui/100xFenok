/**
 * FreshnessChecker - Data freshness monitoring (Unified)
 *
 * Checks update dates against expected frequencies.
 * Returns status signals based on freshness thresholds.
 *
 * @module freshness-checker
 * @version 2.0.0 (unified for admin/shared)
 */

const FreshnessChecker = (function() {

  // Freshness thresholds by update frequency (in days)
  const THRESHOLDS = {
    'daily': { fresh: 1, stale: 3, critical: 7 },
    'weekly': { fresh: 7, stale: 14, critical: 30 },
    'monthly': { fresh: 35, stale: 60, critical: 90 },
    'quarterly': { fresh: 100, stale: 150, critical: 200 },
    'yearly': { fresh: 400, stale: 500, critical: 600 },
    'on-demand': { fresh: 30, stale: 90, critical: 180 },
    'manual': { fresh: 365, stale: 500, critical: 730 }
  };

  /**
   * Check freshness of a data source
   * @param {string} updateDate - ISO date string (e.g., '2026-01-20')
   * @param {string} frequency - update frequency from manifest
   * @returns {Object} { status, signal, daysAgo, label, color }
   */
  function checkFreshness(updateDate, frequency = 'weekly') {
    if (!updateDate) {
      return {
        status: 'unknown',
        signal: '⚪',
        daysAgo: null,
        label: 'Unknown',
        color: 'gray'
      };
    }

    const updated = new Date(updateDate);
    const now = new Date();
    const diffTime = now - updated;
    const daysAgo = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    const thresholds = THRESHOLDS[frequency] || THRESHOLDS['weekly'];

    let status, signal, label, color;

    if (daysAgo <= thresholds.fresh) {
      status = 'fresh';
      signal = '🟢';
      label = 'Fresh';
      color = 'green';
    } else if (daysAgo <= thresholds.stale) {
      status = 'stale';
      signal = '🟡';
      label = 'Stale';
      color = 'yellow';
    } else {
      status = 'critical';
      signal = '🔴';
      label = 'Critical';
      color = 'red';
    }

    return {
      status: status,
      signal: signal,
      daysAgo: daysAgo,
      label: label,
      color: color,
      threshold: thresholds,
      frequency: frequency
    };
  }

  /**
   * Format "X days ago" text
   * @param {number} daysAgo
   * @returns {string}
   */
  function formatDaysAgo(daysAgo) {
    if (daysAgo === null || daysAgo === undefined) return '-';
    if (daysAgo === 0) return 'Today';
    if (daysAgo === 1) return 'Yesterday';
    if (daysAgo < 7) return `${daysAgo} days ago`;
    if (daysAgo < 30) return `${Math.floor(daysAgo / 7)} weeks ago`;
    if (daysAgo < 365) return `${Math.floor(daysAgo / 30)} months ago`;
    return `${Math.floor(daysAgo / 365)} years ago`;
  }

  /**
   * Get CSS classes for status
   * @param {string} status - 'fresh', 'stale', 'critical', 'unknown'
   * @returns {Object} { bg, text, border }
   */
  function getStatusClasses(status) {
    const classes = {
      'fresh': {
        bg: 'bg-green-100',
        text: 'text-green-700',
        border: 'border-green-200'
      },
      'stale': {
        bg: 'bg-yellow-100',
        text: 'text-yellow-700',
        border: 'border-yellow-200'
      },
      'critical': {
        bg: 'bg-red-100',
        text: 'text-red-700',
        border: 'border-red-200'
      },
      'unknown': {
        bg: 'bg-gray-100',
        text: 'text-gray-600',
        border: 'border-gray-200'
      }
    };

    return classes[status] || classes['unknown'];
  }

  /**
   * Check freshness for all folders from manifest
   * @param {Object} folders - { folderName: { updated, update_frequency }, ... }
   * @returns {Object} { folderName: freshnessResult, ... }
   */
  function checkAllFolders(folders) {
    const results = {};

    Object.entries(folders).forEach(([name, config]) => {
      results[name] = checkFreshness(config.updated, config.update_frequency);
    });

    return results;
  }

  /**
   * Get summary of freshness status
   * @param {Object} freshnessResults - { folderName: result, ... }
   * @returns {Object} { total, fresh, stale, critical, unknown }
   */
  function getSummary(freshnessResults) {
    const summary = {
      total: 0,
      fresh: 0,
      stale: 0,
      critical: 0,
      unknown: 0
    };

    Object.values(freshnessResults).forEach(result => {
      summary.total++;
      summary[result.status]++;
    });

    return summary;
  }

  /**
   * Get overall health signal based on summary
   * @param {Object} summary
   * @returns {Object} { signal, label, description }
   */
  function getOverallHealth(summary) {
    if (summary.critical > 0) {
      return {
        signal: '🔴',
        label: 'Action Required',
        description: `${summary.critical} data source(s) critically outdated`
      };
    }

    if (summary.stale > summary.fresh) {
      return {
        signal: '🟡',
        label: 'Attention Needed',
        description: `${summary.stale} data source(s) need refresh`
      };
    }

    return {
      signal: '🟢',
      label: 'Healthy',
      description: `${summary.fresh}/${summary.total} data sources are fresh`
    };
  }

  /**
   * Check if date is within expected update window
   * @param {string} updateDate
   * @param {string} frequency
   * @returns {boolean}
   */
  function isWithinExpectedWindow(updateDate, frequency) {
    const result = checkFreshness(updateDate, frequency);
    return result.status === 'fresh';
  }

  return {
    checkFreshness,
    formatDaysAgo,
    getStatusClasses,
    checkAllFolders,
    getSummary,
    getOverallHealth,
    isWithinExpectedWindow,
    THRESHOLDS
  };
})();
