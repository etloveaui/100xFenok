/**
 * StatusCard - Reusable data source status component (Unified)
 *
 * Renders status cards dynamically from manifest data.
 * Config-only - no hardcoded data sources.
 *
 * @module status-card
 * @version 2.0.0 (unified for admin/shared)
 */

const StatusCard = (function() {

  // Icons for different data source types
  const ICONS = {
    'benchmarks': 'fa-chart-bar',
    'damodaran': 'fa-university',
    'global-scouter': 'fa-globe',
    'indices': 'fa-chart-line',
    'sec-13f': 'fa-file-contract',
    'sentiment': 'fa-heart-pulse',
    'slickcharts': 'fa-chart-pie',
    'default': 'fa-database'
  };

  // Colors for different data source types
  const COLORS = {
    'benchmarks': 'blue',
    'damodaran': 'purple',
    'global-scouter': 'cyan',
    'indices': 'green',
    'sec-13f': 'orange',
    'sentiment': 'pink',
    'slickcharts': 'indigo',
    'default': 'gray'
  };

  /**
   * Get icon class for folder
   * @param {string} folderName
   * @returns {string}
   */
  function getIcon(folderName) {
    return ICONS[folderName] || ICONS['default'];
  }

  /**
   * Get color for folder
   * @param {string} folderName
   * @returns {string}
   */
  function getColor(folderName) {
    return COLORS[folderName] || COLORS['default'];
  }

  /**
   * Render single status card
   * @param {string} folderName - folder name
   * @param {Object} config - folder config from manifest
   * @param {Object} freshness - freshness check result
   * @param {Object} options - render options
   * @returns {string} HTML string
   */
  function render(folderName, config, freshness, options = {}) {
    const icon = getIcon(folderName);
    const color = getColor(folderName);
    const statusClasses = FreshnessChecker.getStatusClasses(freshness.status);

    const displayName = options.displayName || capitalizeFirst(folderName.replace(/-/g, ' '));
    const description = config.description || '';
    const fileCount = config.file_count || 0;
    const version = config.version || '-';
    const frequency = config.update_frequency || '-';

    // Customizable click handler
    const clickHandler = options.clickHandler || `StatusCard.defaultClickHandler('${folderName}')`;

    return `
      <div class="bg-white rounded-xl p-5 shadow hover:shadow-md transition-shadow"
           data-folder="${folderName}">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-${color}-100 rounded-lg flex items-center justify-center">
              <i class="fas ${icon} text-${color}-500"></i>
            </div>
            <div>
              <h3 class="font-semibold text-gray-800">${displayName}</h3>
              <p class="text-xs text-gray-500 truncate max-w-[180px]" title="${description}">${description}</p>
            </div>
          </div>
          <span class="text-xs px-2 py-1 rounded ${statusClasses.bg} ${statusClasses.text}">
            ${freshness.signal} ${freshness.label}
          </span>
        </div>

        <div class="text-sm text-gray-600 space-y-1">
          <p>
            <span class="text-gray-400">Files:</span>
            <span class="font-medium">${Formatters.formatNumber(fileCount, 0)}</span>
            <span class="text-xs text-gray-400">(${frequency})</span>
          </p>
          <p>
            <span class="text-gray-400">Updated:</span>
            <span class="font-medium">${Formatters.formatDate(config.updated)}</span>
            <span class="text-xs text-gray-400">(${FreshnessChecker.formatDaysAgo(freshness.daysAgo)})</span>
          </p>
        </div>

        <div class="mt-3 pt-3 border-t border-gray-100 flex justify-between items-center">
          <span class="text-xs text-gray-400">v${version}</span>
          <button class="text-xs text-${color}-600 hover:text-${color}-800 font-medium"
                  onclick="${clickHandler}">
            Details
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Default click handler (can be overridden)
   * @param {string} folderName
   */
  function defaultClickHandler(folderName) {
    console.log(`[StatusCard] Clicked: ${folderName}`);
    // Override this in your app
  }

  /**
   * Render all status cards
   * @param {Object} foldersWithSchemas - { folderName: { config, schema }, ... }
   * @param {Object} freshnessResults - { folderName: freshnessResult, ... }
   * @param {Object} options - render options
   * @returns {string} HTML string
   */
  function renderAll(foldersWithSchemas, freshnessResults, options = {}) {
    return Object.entries(foldersWithSchemas)
      .map(([name, data]) => render(name, data.config, freshnessResults[name] || {}, options))
      .join('');
  }

  /**
   * Render summary card
   * @param {Object} summary - freshness summary
   * @param {Object} health - overall health
   * @returns {string} HTML string
   */
  function renderSummary(summary, health) {
    return `
      <div class="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-6 text-white shadow-lg">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-lg font-semibold">Data Health Overview</h2>
            <p class="text-slate-300 text-sm">${health.description}</p>
          </div>
          <div class="text-4xl">${health.signal}</div>
        </div>

        <div class="grid grid-cols-4 gap-4 text-center">
          <div class="bg-white/10 rounded-lg p-3">
            <div class="text-2xl font-bold">${summary.total}</div>
            <div class="text-xs text-slate-300">Total</div>
          </div>
          <div class="bg-green-500/20 rounded-lg p-3">
            <div class="text-2xl font-bold text-green-400">${summary.fresh}</div>
            <div class="text-xs text-green-300">Fresh</div>
          </div>
          <div class="bg-yellow-500/20 rounded-lg p-3">
            <div class="text-2xl font-bold text-yellow-400">${summary.stale}</div>
            <div class="text-xs text-yellow-300">Stale</div>
          </div>
          <div class="bg-red-500/20 rounded-lg p-3">
            <div class="text-2xl font-bold text-red-400">${summary.critical}</div>
            <div class="text-xs text-red-300">Critical</div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render loading placeholder
   * @param {number} count - number of placeholder cards
   * @returns {string} HTML string
   */
  function renderLoading(count = 6) {
    const placeholder = `
      <div class="bg-white rounded-xl p-5 shadow animate-pulse">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-10 h-10 bg-gray-200 rounded-lg"></div>
          <div class="flex-1">
            <div class="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
            <div class="h-3 bg-gray-200 rounded w-1/2"></div>
          </div>
        </div>
        <div class="space-y-2">
          <div class="h-3 bg-gray-200 rounded w-full"></div>
          <div class="h-3 bg-gray-200 rounded w-2/3"></div>
        </div>
      </div>
    `;

    return Array(count).fill(placeholder).join('');
  }

  /**
   * Render error state
   * @param {string} message
   * @param {string} retryHandler - onclick handler for retry button
   * @returns {string} HTML string
   */
  function renderError(message, retryHandler = 'location.reload()') {
    return `
      <div class="col-span-full bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <i class="fas fa-exclamation-triangle text-red-500 text-3xl mb-3"></i>
        <h3 class="text-lg font-semibold text-red-800">Error Loading Data</h3>
        <p class="text-red-600 text-sm mt-2">${message}</p>
        <button onclick="${retryHandler}" class="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm">
          Retry
        </button>
      </div>
    `;
  }

  /**
   * Capitalize first letter of each word
   * @param {string} str
   * @returns {string}
   */
  function capitalizeFirst(str) {
    return str.replace(/\b\w/g, char => char.toUpperCase());
  }

  return {
    render,
    renderAll,
    renderSummary,
    renderLoading,
    renderError,
    defaultClickHandler,
    getIcon,
    getColor,
    capitalizeFirst,
    ICONS,
    COLORS
  };
})();
