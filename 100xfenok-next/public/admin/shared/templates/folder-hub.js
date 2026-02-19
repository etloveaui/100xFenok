/**
 * FolderHub - Data folder dashboard template
 *
 * Provides a standard layout for folder-level MVPs with:
 * - Header with folder info and freshness
 * - Metric cards section
 * - Data visualization section
 * - File list section
 * - Links to tools
 *
 * @module folder-hub
 * @version 1.0.0
 * @requires ManifestLoader
 * @requires FreshnessChecker
 * @requires MetricCard
 * @requires TimeSeriesChart
 * @requires DataTable
 * @requires Formatters
 */

const FolderHub = (function() {

  // Folder-specific icons
  const FOLDER_ICONS = {
    'benchmarks': { icon: 'fa-chart-bar', color: 'blue' },
    'damodaran': { icon: 'fa-university', color: 'purple' },
    'global-scouter': { icon: 'fa-globe', color: 'cyan' },
    'indices': { icon: 'fa-chart-line', color: 'green' },
    'sec-13f': { icon: 'fa-file-contract', color: 'orange' },
    'sentiment': { icon: 'fa-heart-pulse', color: 'pink' },
    'slickcharts': { icon: 'fa-chart-pie', color: 'indigo' }
  };

  // Default configuration
  const DEFAULTS = {
    showMetrics: true,
    showChart: true,
    showFileList: true,
    showTools: true
  };

  /**
   * Get folder display info
   * @param {string} folderName
   * @returns {Object}
   */
  function getFolderInfo(folderName) {
    const info = FOLDER_ICONS[folderName] || { icon: 'fa-database', color: 'gray' };
    return {
      ...info,
      displayName: folderName.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    };
  }

  /**
   * Render header section
   * @param {Object} config
   * @returns {string}
   */
  function renderHeader(config) {
    const { folderName, manifest, freshness, backLink = '../' } = config;
    const info = getFolderInfo(folderName);
    const folderConfig = manifest?.folders?.[folderName] || {};

    const statusClasses = FreshnessChecker.getStatusClasses(freshness?.status || 'unknown');

    return `
      <header class="bg-white border-b shadow-sm">
        <div class="container mx-auto px-4 py-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-4">
              <div class="w-12 h-12 bg-${info.color}-100 rounded-xl flex items-center justify-center">
                <i class="fas ${info.icon} text-${info.color}-500 text-xl"></i>
              </div>
              <div>
                <h1 class="text-xl font-bold text-gray-800">${info.displayName} Hub</h1>
                <p class="text-sm text-gray-500">${folderConfig.description || ''}</p>
              </div>
            </div>

            <div class="flex items-center gap-4">
              <div class="text-right">
                <span class="text-xs px-2 py-1 rounded ${statusClasses.bg} ${statusClasses.text}">
                  ${freshness?.signal || '⚪'} ${freshness?.label || 'Unknown'}
                </span>
                <p class="text-xs text-gray-400 mt-1">
                  v${folderConfig.version || '-'} • ${folderConfig.file_count || 0} files
                </p>
              </div>
              <a href="${backLink}" class="p-2 text-gray-500 hover:text-blue-600 rounded-lg hover:bg-blue-50">
                <i class="fas fa-arrow-left"></i>
              </a>
            </div>
          </div>
        </div>
      </header>
    `;
  }

  /**
   * Render metrics section
   * @param {Array} metrics - Array of metric configs for MetricCard
   * @returns {string}
   */
  function renderMetrics(metrics) {
    if (!metrics || !metrics.length) return '';

    return `
      <section class="mb-6">
        <h2 class="text-sm font-semibold text-gray-600 mb-3">
          <i class="fas fa-tachometer-alt mr-2 text-blue-500"></i>Key Metrics
        </h2>
        ${MetricCard.renderGrid(metrics)}
      </section>
    `;
  }

  /**
   * Render chart section placeholder
   * @param {string} chartId - Container ID for chart
   * @param {string} title - Section title
   * @returns {string}
   */
  function renderChartSection(chartId, title = 'Time Series') {
    return `
      <section class="mb-6">
        <h2 class="text-sm font-semibold text-gray-600 mb-3">
          <i class="fas fa-chart-line mr-2 text-emerald-500"></i>${title}
        </h2>
        <div class="bg-white rounded-xl shadow p-4">
          <div id="${chartId}"></div>
        </div>
      </section>
    `;
  }

  /**
   * Render file list section
   * @param {Object} schema - Folder schema
   * @param {string} folderName
   * @returns {string}
   */
  function renderFileList(schema, folderName) {
    if (!schema?.files) return '';

    const files = Object.entries(schema.files).map(([filename, info]) => ({
      filename,
      description: info.description || '-',
      size: info.size_kb ? `${info.size_kb} KB` : '-',
      records: info.records_per_index || info.records || '-'
    }));

    return `
      <section class="mb-6">
        <h2 class="text-sm font-semibold text-gray-600 mb-3">
          <i class="fas fa-folder-open mr-2 text-amber-500"></i>Files (${files.length})
        </h2>
        <div id="file-list-table"></div>
        <script>
          document.addEventListener('DOMContentLoaded', function() {
            DataTable.render('#file-list-table', {
              columns: [
                { key: 'filename', label: 'File', width: '200px' },
                { key: 'description', label: 'Description' },
                { key: 'size', label: 'Size', width: '100px', align: 'right' },
                { key: 'records', label: 'Records', width: '100px', align: 'right' }
              ],
              data: ${JSON.stringify(files)},
              options: {
                pageSize: 10,
                searchable: true,
                title: null
              }
            });
          });
        </script>
      </section>
    `;
  }

  /**
   * Render tools section
   * @param {Array} tools - Array of { name, href, icon, description }
   * @returns {string}
   */
  function renderTools(tools) {
    if (!tools || !tools.length) return '';

    const toolCards = tools.map(tool => `
      <a href="${tool.href}" class="block p-4 bg-white rounded-lg shadow hover:shadow-md transition-shadow border border-gray-100">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
            <i class="fas ${tool.icon || 'fa-wrench'} text-blue-500"></i>
          </div>
          <div>
            <h3 class="font-medium text-gray-800">${tool.name}</h3>
            <p class="text-xs text-gray-500">${tool.description || ''}</p>
          </div>
        </div>
      </a>
    `).join('');

    return `
      <section class="mb-6">
        <h2 class="text-sm font-semibold text-gray-600 mb-3">
          <i class="fas fa-tools mr-2 text-purple-500"></i>Available Tools
        </h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          ${toolCards}
        </div>
      </section>
    `;
  }

  /**
   * Render complete folder hub page
   * @param {Object} config
   * @param {string} config.folderName - Folder name
   * @param {Object} config.manifest - Manifest data
   * @param {Object} config.schema - Folder schema
   * @param {Array} [config.metrics] - Metric cards
   * @param {Object} [config.chart] - Chart configuration
   * @param {Array} [config.tools] - Available tools
   * @param {Object} [config.options] - Display options
   * @returns {string}
   */
  function render(config) {
    const {
      folderName,
      manifest,
      schema,
      metrics = [],
      chart = {},
      tools = [],
      options = {}
    } = config;

    const opts = { ...DEFAULTS, ...options };
    const folderConfig = manifest?.folders?.[folderName] || {};
    const freshness = FreshnessChecker.checkFreshness(folderConfig.updated, folderConfig.update_frequency);

    const chartId = `chart-${folderName}-${Date.now()}`;

    return `
      <!DOCTYPE html>
      <html lang="ko">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${getFolderInfo(folderName).displayName} Hub - Valuation Lab</title>
        <meta name="robots" content="noindex, nofollow">
        <link rel="icon" type="image/x-icon" href="../../../favicon.ico">
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        ${chart.enabled !== false ? '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>' : ''}
      </head>
      <body class="bg-gradient-to-br from-slate-100 to-slate-200 min-h-screen">

        ${renderHeader({ folderName, manifest, freshness, backLink: options.backLink || '../' })}

        <main class="container mx-auto px-4 py-6">
          ${opts.showMetrics ? renderMetrics(metrics) : ''}
          ${opts.showChart && chart.enabled !== false ? renderChartSection(chartId, chart.title || 'Time Series') : ''}
          ${opts.showFileList ? renderFileList(schema, folderName) : ''}
          ${opts.showTools ? renderTools(tools) : ''}
        </main>

        <footer class="border-t bg-white py-4 mt-auto">
          <div class="container mx-auto px-4 text-center text-sm text-gray-500">
            <p>${getFolderInfo(folderName).displayName} Hub v1.0</p>
          </div>
        </footer>

        <!-- Shared Modules -->
        <script src="../../shared/config/manifest-loader.js"></script>
        <script src="../../shared/core/cache-manager.js"></script>
        <script src="../../shared/core/data-manager.js"></script>
        <script src="../../shared/core/formatters.js"></script>
        <script src="../../shared/validators/freshness-checker.js"></script>
        <script src="../../shared/ui/metric-card.js"></script>
        <script src="../../shared/ui/time-series-chart.js"></script>
        <script src="../../shared/ui/data-table.js"></script>

      </body>
      </html>
    `;
  }

  /**
   * Initialize hub with data loading
   * @param {string} folderName
   * @param {Object} options
   * @returns {Promise<Object>} Loaded data
   */
  async function init(folderName, options = {}) {
    try {
      // Load manifest
      const manifest = await ManifestLoader.load();

      // Load schema
      const schema = await ManifestLoader.loadSchema(folderName);

      // Check freshness
      const folderConfig = manifest.folders?.[folderName] || {};
      const freshness = FreshnessChecker.checkFreshness(
        folderConfig.updated,
        folderConfig.update_frequency
      );

      return {
        manifest,
        schema,
        freshness,
        folderConfig
      };
    } catch (error) {
      console.error(`[FolderHub] Failed to initialize ${folderName}:`, error);
      throw error;
    }
  }

  /**
   * Create standard HTML boilerplate for hub page
   * @param {string} folderName
   * @returns {string}
   */
  function getBoilerplate(folderName) {
    const info = getFolderInfo(folderName);

    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${info.displayName} Hub - Valuation Lab</title>
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" type="image/x-icon" href="../../../favicon.ico">
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
</head>
<body class="bg-gradient-to-br from-slate-100 to-slate-200 min-h-screen">
  <!-- Content will be rendered by JavaScript -->
  <div id="app">Loading...</div>

  <!-- Shared Modules -->
  <script src="../../shared/config/manifest-loader.js"></script>
  <script src="../../shared/core/cache-manager.js"></script>
  <script src="../../shared/core/data-manager.js"></script>
  <script src="../../shared/core/formatters.js"></script>
  <script src="../../shared/validators/freshness-checker.js"></script>
  <script src="../../shared/ui/metric-card.js"></script>
  <script src="../../shared/ui/time-series-chart.js"></script>
  <script src="../../shared/ui/data-table.js"></script>
  <script src="../../shared/templates/folder-hub.js"></script>

  <script>
    // Initialize hub
    (async function() {
      try {
        const data = await FolderHub.init('${folderName}');
        // Custom initialization code here
        console.log('[${info.displayName} Hub] Initialized:', data);
      } catch (error) {
        document.getElementById('app').innerHTML = \`
          <div class="flex items-center justify-center min-h-screen">
            <div class="text-center text-red-600">
              <i class="fas fa-exclamation-triangle text-4xl mb-4"></i>
              <p>Failed to load: \${error.message}</p>
            </div>
          </div>
        \`;
      }
    })();
  </script>
</body>
</html>`;
  }

  return {
    render,
    init,
    getBoilerplate,
    renderHeader,
    renderMetrics,
    renderChartSection,
    renderFileList,
    renderTools,
    getFolderInfo,
    FOLDER_ICONS,
    DEFAULTS
  };
})();
