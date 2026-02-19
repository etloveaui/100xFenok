/**
 * StateManager - Reactive state management
 *
 * Centralized state with observer pattern for UI updates.
 *
 * @module state-manager
 * @version 1.0.0
 */

const StateManager = (function() {

  // Application state
  const state = {
    // Loading states
    loading: true,
    error: null,

    // Data from manifest
    manifest: null,
    folders: {},
    schemas: {},

    // Freshness results
    freshness: {},
    summary: null,
    health: null,

    // UI state
    selectedFolder: null,
    detailsOpen: false,

    // Stats
    lastUpdated: null,
    loadTime: 0
  };

  // Observers for reactive updates
  const observers = new Map();

  /**
   * Subscribe to state changes
   * @param {string} key - state key to observe ('*' for all)
   * @param {Function} callback - function to call on change
   * @returns {Function} unsubscribe function
   */
  function subscribe(key, callback) {
    if (!observers.has(key)) {
      observers.set(key, new Set());
    }
    observers.get(key).add(callback);

    // Return unsubscribe function
    return () => {
      observers.get(key).delete(callback);
    };
  }

  /**
   * Notify observers of state change
   * @param {string} key - state key that changed
   * @param {any} value - new value
   */
  function notifyObservers(key, value) {
    // Notify specific key observers
    if (observers.has(key)) {
      observers.get(key).forEach(callback => {
        try {
          callback(value, key);
        } catch (error) {
          console.error(`[StateManager] Observer error for ${key}:`, error);
        }
      });
    }

    // Notify wildcard observers
    if (observers.has('*')) {
      observers.get('*').forEach(callback => {
        try {
          callback(value, key);
        } catch (error) {
          console.error('[StateManager] Wildcard observer error:', error);
        }
      });
    }
  }

  /**
   * Set state value
   * @param {string} key - state key
   * @param {any} value - new value
   */
  function set(key, value) {
    const oldValue = state[key];
    state[key] = value;

    // Only notify if value changed
    if (oldValue !== value) {
      notifyObservers(key, value);
    }
  }

  /**
   * Get state value
   * @param {string} key - state key
   * @returns {any}
   */
  function get(key) {
    return state[key];
  }

  /**
   * Get entire state (read-only copy)
   * @returns {Object}
   */
  function getAll() {
    return { ...state };
  }

  /**
   * Batch update multiple state values
   * @param {Object} updates - { key: value, ... }
   */
  function batchUpdate(updates) {
    Object.entries(updates).forEach(([key, value]) => {
      state[key] = value;
    });

    // Notify all updated keys
    Object.entries(updates).forEach(([key, value]) => {
      notifyObservers(key, value);
    });
  }

  /**
   * Reset state to initial values
   */
  function reset() {
    const initialState = {
      loading: true,
      error: null,
      manifest: null,
      folders: {},
      schemas: {},
      freshness: {},
      summary: null,
      health: null,
      selectedFolder: null,
      detailsOpen: false,
      lastUpdated: null,
      loadTime: 0
    };

    Object.assign(state, initialState);
    notifyObservers('*', state);
  }

  /**
   * Set error state
   * @param {string|Error} error
   */
  function setError(error) {
    const message = error instanceof Error ? error.message : error;
    set('error', message);
    set('loading', false);
  }

  /**
   * Clear error state
   */
  function clearError() {
    set('error', null);
  }

  /**
   * Set loading state
   * @param {boolean} isLoading
   */
  function setLoading(isLoading) {
    set('loading', isLoading);
  }

  /**
   * Update folder data
   * @param {string} folderName
   * @param {Object} data - { config, schema, freshness }
   */
  function updateFolder(folderName, data) {
    const folders = { ...state.folders, [folderName]: data.config };
    const schemas = { ...state.schemas, [folderName]: data.schema };
    const freshness = { ...state.freshness, [folderName]: data.freshness };

    batchUpdate({ folders, schemas, freshness });
  }

  /**
   * Set all folder data at once
   * @param {Object} foldersWithSchemas - { folderName: { config, schema }, ... }
   * @param {Object} freshnessResults - { folderName: result, ... }
   */
  function setFolderData(foldersWithSchemas, freshnessResults) {
    const folders = {};
    const schemas = {};

    Object.entries(foldersWithSchemas).forEach(([name, data]) => {
      folders[name] = data.config;
      schemas[name] = data.schema;
    });

    const summary = FreshnessChecker.getSummary(freshnessResults);
    const health = FreshnessChecker.getOverallHealth(summary);

    batchUpdate({
      folders,
      schemas,
      freshness: freshnessResults,
      summary,
      health,
      loading: false,
      lastUpdated: new Date().toISOString()
    });
  }

  /**
   * Select folder for details view
   * @param {string} folderName
   */
  function selectFolder(folderName) {
    batchUpdate({
      selectedFolder: folderName,
      detailsOpen: folderName !== null
    });
  }

  /**
   * Close details view
   */
  function closeDetails() {
    batchUpdate({
      selectedFolder: null,
      detailsOpen: false
    });
  }

  /**
   * Get debug info
   * @returns {Object}
   */
  function getDebugInfo() {
    return {
      state: getAll(),
      observerCount: Array.from(observers.entries()).reduce((acc, [key, set]) => {
        acc[key] = set.size;
        return acc;
      }, {})
    };
  }

  return {
    subscribe,
    set,
    get,
    getAll,
    batchUpdate,
    reset,
    setError,
    clearError,
    setLoading,
    updateFolder,
    setFolderData,
    selectFolder,
    closeDetails,
    getDebugInfo
  };
})();
