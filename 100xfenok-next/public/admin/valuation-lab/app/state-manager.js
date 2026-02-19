/**
 * Valuation Lab StateManager
 *
 * Centralized state management with observer pattern.
 * Based on Data Lab pattern (DEC-108).
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

    // Folder data (7 folders from VLAB_CONFIG)
    folders: {},
    folderStatus: {},

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

    return () => {
      observers.get(key).delete(callback);
    };
  }

  /**
   * Notify observers of state change
   */
  function notifyObservers(key, value) {
    if (observers.has(key)) {
      observers.get(key).forEach(callback => {
        try {
          callback(value, key);
        } catch (error) {
          console.error(`[StateManager] Observer error for ${key}:`, error);
        }
      });
    }

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
   */
  function set(key, value) {
    const oldValue = state[key];
    state[key] = value;

    if (oldValue !== value) {
      notifyObservers(key, value);
    }
  }

  /**
   * Get state value
   */
  function get(key) {
    return state[key];
  }

  /**
   * Get entire state (read-only copy)
   */
  function getAll() {
    return { ...state };
  }

  /**
   * Batch update multiple state values
   */
  function batchUpdate(updates) {
    Object.entries(updates).forEach(([key, value]) => {
      state[key] = value;
    });

    Object.entries(updates).forEach(([key, value]) => {
      notifyObservers(key, value);
    });
  }

  /**
   * Set loading state
   */
  function setLoading(isLoading) {
    set('loading', isLoading);
  }

  /**
   * Set error state
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
   * Update single folder status
   */
  function updateFolderStatus(folderName, status) {
    const folderStatus = { ...state.folderStatus, [folderName]: status };
    set('folderStatus', folderStatus);
  }

  /**
   * Set folder data
   */
  function setFolderData(folderName, data) {
    const folders = { ...state.folders, [folderName]: data };
    set('folders', folders);
    updateFolderStatus(folderName, { loaded: true, error: null });
  }

  /**
   * Set folder error
   */
  function setFolderError(folderName, error) {
    updateFolderStatus(folderName, { loaded: false, error: error.message || error });
  }

  /**
   * Initialize all folders
   */
  async function initialize() {
    const startTime = Date.now();
    setLoading(true);
    clearError();

    const folderNames = getAllFolders();
    const basePath = getBasePath();

    console.log('[StateManager] Initializing with folders:', folderNames);

    // Load first file from each folder to verify connectivity
    const loadPromises = folderNames.map(async (folderName) => {
      const config = getFolderConfig(folderName);
      if (!config || !config.files || config.files.length === 0) {
        updateFolderStatus(folderName, { loaded: true, error: null, fileCount: 0 });
        return;
      }

      try {
        // Try loading first file to verify folder
        const firstFile = config.files[0];
        const response = await fetch(basePath + firstFile);

        if (response.ok) {
          const data = await response.json();
          setFolderData(folderName, {
            firstFile: data,
            fileCount: config.files.length,
            verified: true
          });
          console.log(`[StateManager] ${folderName}: OK (${config.files.length} files)`);
        } else {
          setFolderError(folderName, `HTTP ${response.status}`);
          console.warn(`[StateManager] ${folderName}: Failed (${response.status})`);
        }
      } catch (error) {
        setFolderError(folderName, error.message);
        console.error(`[StateManager] ${folderName}: Error`, error);
      }
    });

    await Promise.allSettled(loadPromises);

    const loadTime = Date.now() - startTime;
    batchUpdate({
      loading: false,
      lastUpdated: new Date().toISOString(),
      loadTime
    });

    console.log(`[StateManager] Initialization complete in ${loadTime}ms`);
  }

  /**
   * Select folder for focus/highlight
   */
  function selectFolder(folderName) {
    batchUpdate({
      selectedFolder: folderName,
      detailsOpen: folderName !== null
    });
  }

  /**
   * Close details/selection
   */
  function closeDetails() {
    batchUpdate({
      selectedFolder: null,
      detailsOpen: false
    });
  }

  /**
   * Get debug info
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
    setLoading,
    setError,
    clearError,
    updateFolderStatus,
    setFolderData,
    setFolderError,
    initialize,
    selectFolder,
    closeDetails,
    getDebugInfo
  };
})();
