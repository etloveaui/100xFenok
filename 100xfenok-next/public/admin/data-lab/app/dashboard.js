/**
 * Dashboard - Main orchestrator for Data Lab
 *
 * Coordinates data loading, state management, and UI rendering.
 * Manifest-driven - no hardcoded data sources.
 *
 * @module dashboard
 * @version 1.0.0
 */

const DataLabUI = (function() {

  /**
   * Initialize the dashboard
   */
  async function init() {
    console.log('[DataLab] Initializing...');
    const startTime = performance.now();

    // Initialize renderer with DOM references
    Renderer.init({
      summaryContainer: document.getElementById('summary-container'),
      opsContainer: document.getElementById('ops-container'),
      depthContainer: document.getElementById('depth-container'),
      stockFieldContainer: document.getElementById('stock-field-container'),
      cardsContainer: document.getElementById('cards-container'),
      detailsPanel: document.getElementById('details-panel'),
      timestampEl: document.getElementById('last-updated')
    });

    // Show loading state
    Renderer.renderLoading();
    Renderer.renderOpsLoading();
    Renderer.renderDepthLoading();
    Renderer.renderStockFieldLoading();

    // Subscribe to state changes
    setupStateSubscriptions();

    // Load data
    try {
      await loadAllData();
      loadDepthCoverage();
      loadStockFieldManifest();
      runOpsChecks();
      const loadTime = Math.round(performance.now() - startTime);
      StateManager.set('loadTime', loadTime);
      console.log(`[DataLab] Initialized in ${loadTime}ms`);
    } catch (error) {
      console.error('[DataLab] Initialization failed:', error);
      StateManager.setError(error);
    }
  }

  /**
   * Setup state subscriptions for reactive UI updates
   */
  function setupStateSubscriptions() {
    // Loading state
    StateManager.subscribe('loading', (loading) => {
      if (loading) {
        Renderer.renderLoading();
      }
    });

    // Error state
    StateManager.subscribe('error', (error) => {
      if (error) {
        Renderer.renderError(error);
      }
    });

    // Summary/Health update
    StateManager.subscribe('summary', () => {
      const state = StateManager.getAll();
      if (state.summary && state.health) {
        Renderer.renderSummary(state.summary, state.health);
      }
    });

    // Folders update
    StateManager.subscribe('folders', () => {
      const state = StateManager.getAll();
      if (Object.keys(state.folders).length > 0) {
        Renderer.renderCards(state.folders, state.schemas, state.freshness);
      }
    });

    // Details panel
    StateManager.subscribe('selectedFolder', (folderName) => {
      if (folderName) {
        const state = StateManager.getAll();
        Renderer.renderDetails(
          folderName,
          state.folders[folderName],
          state.schemas[folderName],
          state.freshness[folderName]
        );
      } else {
        Renderer.hideDetails();
      }
    });

    // Timestamp update
    StateManager.subscribe('lastUpdated', (timestamp) => {
      Renderer.updateTimestamp(timestamp);
    });
  }

  /**
   * Load all data from manifest
   */
  async function loadAllData() {
    // Load manifest first
    const manifest = await ManifestLoader.loadManifest();
    StateManager.set('manifest', manifest);

    // Get all folders with schemas
    const foldersWithSchemas = await ManifestLoader.getAllFoldersWithSchemas();

    // Check freshness for all folders
    const folderConfigs = {};
    Object.entries(foldersWithSchemas).forEach(([name, data]) => {
      if (data.config) {
        folderConfigs[name] = {
          updated: data.config.updated,
          update_frequency: data.config.update_frequency
        };
      }
    });

    const freshnessResults = FreshnessChecker.checkAllFolders(folderConfigs);

    // Update state (triggers UI updates)
    StateManager.setFolderData(foldersWithSchemas, freshnessResults);
  }

  /**
   * Refresh data
   */
  async function refresh() {
    console.log('[DataLab] Refreshing...');

    // Clear cache
    ManifestLoader.clearCache();
    CacheManager.clear();

    // Reset state and reload
    StateManager.reset();
    await init();
  }

  /**
   * Run read-only operational checks.
   */
  async function runOpsChecks() {
    if (!window.OpsConsole) {
      Renderer.renderOpsUnavailable('OpsConsole module is not loaded.');
      return;
    }

    try {
      const results = await OpsConsole.run();
      Renderer.renderOpsResults(results);
    } catch (error) {
      console.error('[DataLab] Ops checks failed:', error);
      Renderer.renderOpsUnavailable(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Load generated data usage/depth coverage proof.
   */
  async function loadDepthCoverage() {
    try {
      const basePath = window.ManifestLoader?.getBasePath?.() || '';
      const response = await fetch(`${basePath}/data/admin/data-usage-manifest.json`, {
        headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) {
        throw new Error(`data-usage-manifest returned ${response.status}`);
      }
      const manifest = await response.json();
      Renderer.renderDepthCoverage(manifest);
    } catch (error) {
      console.warn('[DataLab] Depth coverage unavailable:', error);
      Renderer.renderDepthUnavailable(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Load stock field usage manifest for Feno Stock Lens audit.
   */
  async function loadStockFieldManifest() {
    try {
      const basePath = window.ManifestLoader?.getBasePath?.() || '';
      const response = await fetch(`${basePath}/data/admin/stock-field-usage-manifest.json`, {
        headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) {
        throw new Error(`stock-field-usage-manifest returned ${response.status}`);
      }
      const manifest = await response.json();
      Renderer.renderStockFieldManifest(manifest);
    } catch (error) {
      console.warn('[DataLab] Stock field manifest unavailable:', error);
      Renderer.renderStockFieldUnavailable(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Show folder details
   * @param {string} folderName
   */
  function showFolderDetails(folderName) {
    StateManager.selectFolder(folderName);
  }

  /**
   * Close folder details
   */
  function closeDetails() {
    StateManager.closeDetails();
  }

  function setStockFieldStatus(status) {
    Renderer.setStockFieldStatus(status);
  }

  function setStockFieldDataset(datasetId) {
    Renderer.setStockFieldDataset(datasetId);
  }

  function setStockFieldPage(page) {
    Renderer.setStockFieldPage(page);
  }

  function toggleStockFieldDebug() {
    Renderer.toggleStockFieldDebug();
  }

  /**
   * Get dashboard stats
   * @returns {Object}
   */
  function getStats() {
    const state = StateManager.getAll();
    return {
      foldersCount: Object.keys(state.folders).length,
      schemasCount: Object.keys(state.schemas).filter(k => state.schemas[k]).length,
      loadTime: state.loadTime,
      lastUpdated: state.lastUpdated,
      health: state.health,
      ops: window.OpsConsole?.getLastResults?.() || null,
      depth: 'data/admin/data-usage-manifest.json',
      stockFieldManifest: 'data/admin/stock-field-usage-manifest.json',
      cache: {
        manifest: ManifestLoader.getCacheStats(),
        data: CacheManager.getStats()
      }
    };
  }

  /**
   * Export state for debugging
   * @returns {Object}
   */
  function debug() {
    return {
      state: StateManager.getDebugInfo(),
      stats: getStats()
    };
  }

  // Public API
  return {
    init,
    refresh,
    showFolderDetails,
    closeDetails,
    getStats,
    runOpsChecks,
    setStockFieldStatus,
    setStockFieldDataset,
    setStockFieldPage,
    toggleStockFieldDebug,
    debug
  };
})();

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  DataLabUI.init();
});
