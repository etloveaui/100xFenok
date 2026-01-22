/**
 * Valuation Lab Dashboard UI Logic
 *
 * Handles UI rendering, interactions, and data coordination.
 * Uses Shared Modules (ManifestLoader, StatusCard) for consistency.
 *
 * @module dashboard
 * @version 2.0.0
 */

const ValuationLabUI = (function() {

  // Configuration
  const FOLDER_TOOLS = {
    benchmarks: [
      { name: 'Benchmarks Explorer', link: 'expansion/benchmarks-explorer.html', icon: 'fa-compass', desc: '36 Indices + Momentum Analysis' },
      { name: 'Sweet Spot Scanner', link: 'expansion/sweet-spot.html', icon: 'fa-crosshairs', desc: 'P/E + Momentum Sweet Spot' },
      { name: 'Valuation Card', link: 'card.html', icon: 'fa-id-card', desc: 'Index/Stock Valuation' }
    ],
    'global-scouter': [
      { name: 'Valuation Card (Stock)', link: 'card.html?mode=stock', icon: 'fa-building', desc: 'Individual Stock Analysis' },
      { name: 'Dashboard', link: 'expansion/dashboard.html', icon: 'fa-gauge-high', desc: 'Integrated Dashboard' },
      { name: 'PER Band Screener', link: 'expansion/per-band.html', icon: 'fa-chart-line', desc: 'Band Deviation Analysis' },
      { name: 'EPS Growth', link: 'expansion/eps-growth.html', icon: 'fa-arrow-trend-up', desc: 'Growth Ranking' },
      { name: 'Sector Gap', link: 'expansion/sector-gap.html', icon: 'fa-layer-group', desc: 'Sector Comparison' },
      { name: 'Stability Score', link: 'expansion/stability-score.html', icon: 'fa-shield-halved', desc: 'Low Volatility Finder' },
      { name: 'Target Price', link: 'expansion/target-price.html', icon: 'fa-bullseye', desc: 'Fair Value Calculator' }
    ],
    damodaran: [
      { name: 'Damodaran Explorer', link: 'expansion/damodaran-explorer.html', icon: 'fa-compass', desc: '96 Industries + 178 Countries + ERP History' },
      { name: 'Damodaran Hub', link: 'expansion/damodaran-hub.html', icon: 'fa-university', desc: 'Quick Overview' },
      { name: 'EV/Sales Dashboard', link: 'expansion/ev-sales.html', icon: 'fa-chart-pie', desc: 'Sector Multiples' },
      { name: 'ERP Ranking', link: 'expansion/erp-rank.html', icon: 'fa-earth-americas', desc: 'Country Risk Premiums' }
    ],
    slickcharts: [
      { name: 'Historical Returns', link: 'expansion/slickcharts-historical.html', icon: 'fa-clock-rotate-left', desc: '47yr Returns + Dividends' }
    ],
    'sec-13f': [], // Data only
    sentiment: [], // Data only
    indices: [], // Legacy or data only
    'macro-rates': [] // Virtual folder for FRED
  };

  // State
  let state = {
    folders: {}, // { name: { config, schema } }
    freshness: {}, // { name: freshnessResult }
    lastUpdated: null
  };

  // Elements
  const elements = {
    summaryContainer: document.getElementById('summary-container'),
    cardsContainer: document.getElementById('cards-container'),
    detailsPanel: document.getElementById('details-panel'),
    lastUpdated: document.getElementById('last-updated')
  };

  /**
   * Initialize Dashboard
   */
  async function init() {
    try {
      renderLoading();
      await refresh();
    } catch (error) {
      renderError(error.message);
    }
  }

  /**
   * Refresh data
   */
  async function refresh() {
    // 1. Load Manifest & Schemas
    const foldersData = await ManifestLoader.getAllFoldersWithSchemas();
    state.folders = foldersData;

    // 2. Check Freshness
    state.freshness = {};
    Object.entries(foldersData).forEach(([name, data]) => {
      state.freshness[name] = FreshnessChecker.checkFreshness(
        data.config.updated,
        data.config.update_frequency
      );
    });

    // 3. Update Last Updated
    const manifestInfo = await ManifestLoader.getManifestInfo();
    state.lastUpdated = manifestInfo.lastUpdated;
    if (elements.lastUpdated) {
      elements.lastUpdated.textContent = `Updated: ${Formatters.formatDate(state.lastUpdated)}`;
    }

    // 4. Render UI
    renderSummary();
    renderCards();
  }

  /**
   * Render Loading State
   */
  function renderLoading() {
    if (elements.cardsContainer) {
      elements.cardsContainer.innerHTML = StatusCard.renderLoading(8);
    }
  }

  /**
   * Render Error State
   */
  function renderError(message) {
    if (elements.cardsContainer) {
      elements.cardsContainer.innerHTML = StatusCard.renderError(message, 'ValuationLabUI.refresh()');
    }
  }

  /**
   * Render Summary Section
   */
  function renderSummary() {
    if (!elements.summaryContainer) return;

    // Calculate Summary Stats
    const totalFolders = Object.keys(state.folders).length;
    const totalFiles = Object.values(state.folders).reduce((sum, f) => sum + (f.config.file_count || 0), 0);
    
    // Health (Mock logic or simple aggregation)
    const criticalCount = Object.values(state.freshness).filter(f => f.status === 'critical').length;
    const health = criticalCount === 0 
      ? { signal: '🟢', description: '모든 데이터가 정상입니다.' } 
      : { signal: '🔴', description: `${criticalCount}개 소스가 주의가 필요합니다.` };

    const freshnessSummary = {
      total: totalFolders,
      fresh: Object.values(state.freshness).filter(f => f.status === 'fresh').length,
      stale: Object.values(state.freshness).filter(f => f.status === 'stale').length,
      critical: criticalCount
    };

    elements.summaryContainer.innerHTML = StatusCard.renderSummary(freshnessSummary, health);
  }

  /**
   * Render Cards Grid
   */
  function renderCards() {
    if (!elements.cardsContainer) return;

    // Define 7 target folders + custom ordering
    const targetFolders = [
      'benchmarks', 'global-scouter', 'damodaran', 
      'slickcharts', 'sec-13f', 'sentiment', 'indices'
    ];

    // Filter state.folders to only include targets
    const filteredFolders = {};
    targetFolders.forEach(name => {
      if (state.folders[name]) {
        filteredFolders[name] = state.folders[name];
      }
    });

    const html = StatusCard.renderAll(filteredFolders, state.freshness, {
      clickHandler: (folderName) => `ValuationLabUI.showDetails('${folderName}')`
    });

    elements.cardsContainer.innerHTML = html;
  }

  /**
   * Show Details Panel (Slide-in)
   * @param {string} folderName
   */
  function showDetails(folderName) {
    if (!elements.detailsPanel) return;

    const folder = state.folders[folderName];
    const fresh = state.freshness[folderName];
    const tools = FOLDER_TOOLS[folderName] || [];
    const icon = StatusCard.getIcon(folderName);
    const color = StatusCard.getColor(folderName);

    // Tools List HTML
    let toolsHtml = '';
    if (tools.length > 0) {
      toolsHtml = tools.map(tool => `
        <a href="${tool.link}" class="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:bg-${color}-50 hover:border-${color}-200 transition-colors group">
          <div class="w-8 h-8 rounded-full bg-${color}-100 flex items-center justify-center text-${color}-600 group-hover:bg-white group-hover:shadow-sm transition-all">
            <i class="fas ${tool.icon || 'fa-wrench'}"></i>
          </div>
          <div>
            <div class="font-medium text-gray-800 group-hover:text-${color}-700">${tool.name}</div>
            <div class="text-xs text-gray-500">${tool.desc}</div>
          </div>
          <i class="fas fa-arrow-right ml-auto text-gray-300 group-hover:text-${color}-400"></i>
        </a>
      `).join('');
    } else {
      toolsHtml = `
        <div class="text-center py-8 text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-200">
          <i class="fas fa-toolbox text-2xl mb-2"></i><br>
          사용 가능한 도구가 없습니다.<br>
          <span class="text-xs">(데이터 뷰어 전용)</span>
        </div>
      `;
    }

    // Metadata HTML
    const metadataHtml = `
      <div class="grid grid-cols-2 gap-4 text-sm">
        <div class="bg-gray-50 p-3 rounded-lg">
          <div class="text-gray-500 text-xs">상태</div>
          <div class="font-medium mt-1 flex items-center gap-2">
            <span class="w-2 h-2 rounded-full ${fresh.status === 'fresh' ? 'bg-green-500' : 'bg-red-500'}"></span>
            ${fresh.label}
          </div>
        </div>
        <div class="bg-gray-50 p-3 rounded-lg">
          <div class="text-gray-500 text-xs">파일 수</div>
          <div class="font-medium mt-1">${Formatters.formatNumber(folder.config.file_count, 0)}</div>
        </div>
        <div class="bg-gray-50 p-3 rounded-lg">
          <div class="text-gray-500 text-xs">업데이트</div>
          <div class="font-medium mt-1">${Formatters.formatDate(folder.config.updated)}</div>
        </div>
        <div class="bg-gray-50 p-3 rounded-lg">
          <div class="text-gray-500 text-xs">버전</div>
          <div class="font-medium mt-1">v${folder.config.version || '1.0'}</div>
        </div>
      </div>
    `;

    const html = `
      <div class="h-full flex flex-col bg-white">
        <!-- Header -->
        <div class="px-6 py-5 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-${color}-100 rounded-xl flex items-center justify-center">
              <i class="fas ${icon} text-${color}-500 text-lg"></i>
            </div>
            <div>
              <h2 class="text-lg font-bold text-gray-800">${StatusCard.capitalizeFirst(folderName.replace(/-/g, ' '))}</h2>
              <p class="text-xs text-gray-500">${folder.config.description}</p>
            </div>
          </div>
          <button onclick="ValuationLabUI.hideDetails()" class="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-colors">
            <i class="fas fa-times text-lg"></i>
          </button>
        </div>

        <!-- Scrollable Content -->
        <div class="flex-1 overflow-y-auto p-6 space-y-8">
          
          <!-- Tools Section -->
          <section>
            <h3 class="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
              <i class="fas fa-cubes text-${color}-500"></i> Available Tools
            </h3>
            <div class="space-y-3">
              ${toolsHtml}
            </div>
          </section>

          <!-- Metadata Section -->
          <section>
            <h3 class="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
              <i class="fas fa-info-circle text-${color}-500"></i> Data Info
            </h3>
            ${metadataHtml}
          </section>

          <!-- JSON Preview (Optional) -->
          <section>
             <h3 class="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
              <i class="fas fa-code text-gray-400"></i> Config
            </h3>
            <pre class="bg-slate-900 text-green-400 p-4 rounded-lg text-xs overflow-auto max-h-40">${JSON.stringify(folder.config, null, 2)}</pre>
          </section>

        </div>
      </div>
    `;

    elements.detailsPanel.innerHTML = html;
    elements.detailsPanel.classList.remove('hidden');
    
    // Add click outside listener
    setTimeout(() => {
        document.addEventListener('click', handleOutsideClick);
    }, 0);
  }

  function hideDetails() {
    if (elements.detailsPanel) {
      elements.detailsPanel.classList.add('hidden');
      document.removeEventListener('click', handleOutsideClick);
    }
  }

  function handleOutsideClick(e) {
    if (elements.detailsPanel && !elements.detailsPanel.classList.contains('hidden')) {
        const panel = elements.detailsPanel.firstElementChild; // The inner div
        // Check if click is outside the panel content (which implies clicking the overlay)
        if (elements.detailsPanel.contains(e.target) && !panel.contains(e.target)) {
            hideDetails();
        }
    }
  }

  function debug() {
    return state;
  }

  return {
    init,
    refresh,
    showDetails,
    hideDetails,
    debug
  };
})();

// Auto-init
document.addEventListener('DOMContentLoaded', ValuationLabUI.init);
