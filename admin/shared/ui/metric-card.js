/**
 * MetricCard - Compact metric display component
 *
 * Displays a value with optional trend, change, and status indicator.
 * Designed for dashboard summary sections.
 *
 * @module metric-card
 * @version 1.0.0
 * @requires Formatters
 */

const MetricCard = (function() {

  // Status configurations
  const STATUS_CONFIG = {
    bullish: {
      bg: 'bg-green-50',
      border: 'border-green-200',
      text: 'text-green-700',
      accent: 'text-green-600',
      emoji: '📈'
    },
    bearish: {
      bg: 'bg-red-50',
      border: 'border-red-200',
      text: 'text-red-700',
      accent: 'text-red-600',
      emoji: '📉'
    },
    neutral: {
      bg: 'bg-amber-50',
      border: 'border-amber-200',
      text: 'text-amber-700',
      accent: 'text-amber-600',
      emoji: '➡️'
    },
    info: {
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      text: 'text-blue-700',
      accent: 'text-blue-600',
      emoji: 'ℹ️'
    },
    default: {
      bg: 'bg-slate-50',
      border: 'border-slate-200',
      text: 'text-slate-700',
      accent: 'text-slate-600',
      emoji: '📊'
    }
  };

  /**
   * Get status configuration
   * @param {string} status - bullish, bearish, neutral, info, default
   * @returns {Object}
   */
  function getStatusConfig(status) {
    return STATUS_CONFIG[status] || STATUS_CONFIG['default'];
  }

  /**
   * Format change value with sign and color
   * @param {number} change - change value
   * @param {string} format - 'number' or 'percent'
   * @returns {Object} { text, colorClass }
   */
  function formatChange(change, format = 'number') {
    if (change === null || change === undefined || isNaN(change)) {
      return { text: '-', colorClass: 'text-gray-400' };
    }

    const sign = change > 0 ? '+' : '';
    let text;

    if (format === 'percent') {
      text = `${sign}${(change * 100).toFixed(2)}%`;
    } else {
      text = `${sign}${Formatters.formatNumber(change, 2)}`;
    }

    const colorClass = change > 0 ? 'text-green-600' : change < 0 ? 'text-red-600' : 'text-gray-500';

    return { text, colorClass };
  }

  /**
   * Render a single metric card
   * @param {Object} config - Card configuration
   * @param {string} config.title - Metric title
   * @param {number|string} config.value - Main value
   * @param {number} [config.change] - Change from previous period
   * @param {string} [config.changeFormat] - 'number' or 'percent'
   * @param {string} [config.changePeriod] - e.g., 'vs last week'
   * @param {string} [config.status] - bullish, bearish, neutral, info
   * @param {string} [config.emoji] - Custom emoji (overrides status emoji)
   * @param {string} [config.subtitle] - Additional context
   * @param {string} [config.unit] - Value unit (e.g., 'x', '%')
   * @param {string} [config.size] - 'sm', 'md', 'lg' (default: 'md')
   * @returns {string} HTML string
   */
  function render(config) {
    const {
      title,
      value,
      change,
      changeFormat = 'number',
      changePeriod = '',
      status = 'default',
      emoji,
      subtitle,
      unit = '',
      size = 'md'
    } = config;

    const statusConfig = getStatusConfig(status);
    const displayEmoji = emoji || statusConfig.emoji;
    const changeInfo = formatChange(change, changeFormat);

    // Size classes
    const sizeClasses = {
      sm: { card: 'p-3', title: 'text-xs', value: 'text-xl', emoji: 'text-lg' },
      md: { card: 'p-4', title: 'text-sm', value: 'text-2xl', emoji: 'text-xl' },
      lg: { card: 'p-5', title: 'text-base', value: 'text-3xl', emoji: 'text-2xl' }
    };
    const sizes = sizeClasses[size] || sizeClasses.md;

    // Format value
    const displayValue = typeof value === 'number'
      ? Formatters.formatNumber(value, 2)
      : value;

    return `
      <div class="rounded-xl ${statusConfig.bg} border ${statusConfig.border} ${sizes.card} transition-all hover:shadow-md">
        <div class="flex items-start justify-between mb-2">
          <span class="${sizes.title} font-medium ${statusConfig.text}">${title}</span>
          <span class="${sizes.emoji}">${displayEmoji}</span>
        </div>

        <div class="flex items-baseline gap-1 mb-1">
          <span class="${sizes.value} font-bold ${statusConfig.accent}">${displayValue}</span>
          ${unit ? `<span class="text-sm text-gray-500">${unit}</span>` : ''}
        </div>

        ${change !== undefined ? `
          <div class="flex items-center gap-2 text-xs">
            <span class="${changeInfo.colorClass} font-medium">${changeInfo.text}</span>
            ${changePeriod ? `<span class="text-gray-400">${changePeriod}</span>` : ''}
          </div>
        ` : ''}

        ${subtitle ? `
          <p class="text-xs text-gray-500 mt-2 truncate" title="${subtitle}">${subtitle}</p>
        ` : ''}
      </div>
    `;
  }

  /**
   * Render multiple metric cards in a grid
   * @param {Array} metrics - Array of metric configs
   * @param {Object} options - Grid options
   * @param {number} [options.cols] - Number of columns (default: auto)
   * @param {string} [options.gap] - Gap size (default: 'gap-4')
   * @returns {string} HTML string
   */
  function renderGrid(metrics, options = {}) {
    const { cols, gap = 'gap-4' } = options;

    let gridCols = 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';
    if (cols) {
      gridCols = `grid-cols-${cols}`;
    }

    const cards = metrics.map(m => render(m)).join('');

    return `
      <div class="grid ${gridCols} ${gap}">
        ${cards}
      </div>
    `;
  }

  /**
   * Render a summary row (horizontal layout)
   * @param {Array} metrics - Array of metric configs
   * @returns {string} HTML string
   */
  function renderRow(metrics) {
    const items = metrics.map(m => {
      const statusConfig = getStatusConfig(m.status || 'default');
      const changeInfo = formatChange(m.change, m.changeFormat || 'number');
      const displayValue = typeof m.value === 'number'
        ? Formatters.formatNumber(m.value, 2)
        : m.value;

      return `
        <div class="text-center px-4 py-2">
          <div class="text-xs text-gray-500 mb-1">${m.title}</div>
          <div class="text-lg font-bold ${statusConfig.accent}">${displayValue}${m.unit || ''}</div>
          ${m.change !== undefined ? `
            <div class="text-xs ${changeInfo.colorClass}">${changeInfo.text}</div>
          ` : ''}
        </div>
      `;
    }).join('<div class="w-px bg-gray-200"></div>');

    return `
      <div class="flex items-center justify-center divide-x divide-gray-200 bg-white rounded-lg shadow-sm py-2">
        ${items}
      </div>
    `;
  }

  /**
   * Create metric from benchmark data
   * @param {Object} data - Benchmark data point
   * @param {string} metricKey - 'pe', 'pb', 'roe'
   * @param {Object} options - Additional options
   * @returns {Object} Metric config
   */
  function fromBenchmark(data, metricKey, options = {}) {
    const keyMap = {
      pe: { title: 'P/E Ratio', key: 'best_pe_ratio', unit: 'x' },
      pb: { title: 'P/B Ratio', key: 'px_to_book_ratio', unit: 'x' },
      roe: { title: 'ROE', key: 'roe', unit: '%', multiply: 100 }
    };

    const config = keyMap[metricKey] || { title: metricKey, key: metricKey, unit: '' };
    let value = data[config.key];

    if (config.multiply && value !== null && value !== undefined) {
      value = value * config.multiply;
    }

    return {
      title: options.title || config.title,
      value: value,
      unit: config.unit,
      status: options.status || 'default',
      ...options
    };
  }

  return {
    render,
    renderGrid,
    renderRow,
    fromBenchmark,
    getStatusConfig,
    formatChange,
    STATUS_CONFIG
  };
})();
