/**
 * Common DataManager (Unified)
 *
 * Data loading, error handling, batch fetch
 * Integrates with CacheManager for 3-tier caching
 * Supports manifest-driven data loading
 *
 * @module data-manager
 * @version 3.0.0 (unified for admin/shared)
 */

const DataManager = (function() {

  // Config
  const CONFIG = {
    TIMEOUT: 10000,       // 10 second timeout
    RETRY_COUNT: 2,       // retry count
    RETRY_DELAY: 1000     // retry delay (ms)
  };

  /**
   * Fetch with timeout
   * @param {string} url
   * @param {number} timeout
   * @returns {Promise<Response>}
   */
  async function fetchWithTimeout(url, timeout = CONFIG.TIMEOUT) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Fetch with retry logic
   * @param {string} url
   * @param {number} retries
   * @returns {Promise<any>}
   */
  async function fetchWithRetry(url, retries = CONFIG.RETRY_COUNT) {
    let lastError;

    for (let i = 0; i <= retries; i++) {
      try {
        const response = await fetchWithTimeout(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.json();
      } catch (error) {
        lastError = error;
        console.warn(`[DataManager] Fetch failed (attempt ${i + 1}/${retries + 1}):`, url, error.message);

        if (i < retries) {
          await new Promise(r => setTimeout(r, CONFIG.RETRY_DELAY * (i + 1)));
        }
      }
    }

    throw lastError;
  }

  /**
   * Load data file with caching
   * @param {string} url - full URL
   * @param {string} cacheKey - cache key
   * @returns {Promise<Object>}
   */
  async function loadData(url, cacheKey) {
    return CacheManager.get(cacheKey, () => fetchWithRetry(url));
  }

  /**
   * Load data from manifest (dynamic path resolution)
   * Uses ManifestLoader.getBasePath() for correct path
   *
   * @param {string} folderName - folder name (e.g., 'benchmarks', 'global-scouter')
   * @param {string} fileName - file name (e.g., 'us.json', 'stocks.json')
   * @returns {Promise<Object>}
   */
  async function loadFromManifest(folderName, fileName) {
    const basePath = ManifestLoader.getBasePath();
    const url = `${basePath}/data/${folderName}/${fileName}`;
    const cacheKey = `data_${folderName}_${fileName}`;

    console.log(`[DataManager] Loading from manifest: ${folderName}/${fileName}`);
    return loadData(url, cacheKey);
  }

  /**
   * Load multiple files in parallel
   * @param {Object} files - { key: url, ... }
   * @returns {Promise<Object>} { key: data, ... }
   */
  async function loadMultiple(files) {
    const results = {};

    await Promise.all(Object.entries(files).map(async ([key, url]) => {
      try {
        results[key] = await loadData(url, `data_${key}`);
      } catch (error) {
        console.error(`[DataManager] Failed to load ${key}:`, error);
        results[key] = null;
      }
    }));

    return results;
  }

  /**
   * Load multiple files from manifest in parallel
   * @param {Array<{folder: string, file: string}>} sources
   * @returns {Promise<Object>} { 'folder/file': data, ... }
   */
  async function loadMultipleFromManifest(sources) {
    const results = {};

    await Promise.all(sources.map(async ({ folder, file }) => {
      const key = `${folder}/${file}`;
      try {
        results[key] = await loadFromManifest(folder, file);
      } catch (error) {
        console.error(`[DataManager] Failed to load ${key}:`, error);
        results[key] = null;
      }
    }));

    return results;
  }

  /**
   * Get latest data from array (by date)
   * @param {Array} dataArray - time series data array
   * @returns {Object|null}
   */
  function getLatestData(dataArray) {
    if (!Array.isArray(dataArray) || dataArray.length === 0) return null;

    const sorted = [...dataArray].sort((a, b) => {
      const dateA = new Date(a.date || 0);
      const dateB = new Date(b.date || 0);
      return dateB - dateA;
    });

    return sorted[0];
  }

  /**
   * Quick data validity check
   * @param {any} data
   * @returns {boolean}
   */
  function isValidData(data) {
    return data !== null && data !== undefined &&
           (Array.isArray(data) ? data.length > 0 : Object.keys(data).length > 0);
  }

  /**
   * Create error state object
   * @param {string} message
   * @param {string} code
   * @returns {Object}
   */
  function createError(message, code = 'UNKNOWN') {
    return {
      error: true,
      message: message,
      code: code,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Extract update date from data
   * @param {Object} data
   * @returns {string|null}
   */
  function extractUpdateDate(data) {
    if (!data) return null;

    // Try common date field names
    const dateFields = ['updated', 'last_updated', 'updated_at', 'date', 'generated_at', 'source_date'];

    for (const field of dateFields) {
      if (data[field]) return data[field];
      if (data.metadata && data.metadata[field]) return data.metadata[field];
    }

    // Try to get from data array
    if (Array.isArray(data) && data.length > 0 && data[0].date) {
      const latest = getLatestData(data);
      return latest?.date;
    }

    return null;
  }

  /**
   * Count records in data
   * @param {Object|Array} data
   * @returns {number}
   */
  function countRecords(data) {
    if (!data) return 0;

    if (Array.isArray(data)) {
      return data.length;
    }

    // Check common count patterns
    if (data.count) return data.count;
    if (data.metadata?.count) return data.metadata.count;

    // Count keys in object
    if (typeof data === 'object') {
      // Exclude metadata keys
      const dataKeys = Object.keys(data).filter(k =>
        !['metadata', 'version', 'updated', 'schema'].includes(k)
      );
      return dataKeys.length;
    }

    return 0;
  }

  // ========================================
  // Valuation Lab Benchmark Functions
  // ========================================

  /**
   * Benchmark name to filename mapping
   */
  const BENCHMARK_FILES = {
    'US': 'us.json',
    'SECTORS': 'us_sectors.json',
    'EMERGING': 'emerging.json',
    'DEVELOPED': 'developed.json',
    'MSCI': 'msci.json',
    'MICRO': 'micro_sectors.json'
  };

  /**
   * Load benchmark data by name
   * @param {string} benchmark - benchmark name (US, SECTORS, EMERGING, etc.)
   * @returns {Promise<Object>}
   */
  async function loadBenchmark(benchmark) {
    const fileName = BENCHMARK_FILES[benchmark.toUpperCase()];
    if (!fileName) {
      throw new Error(`Unknown benchmark: ${benchmark}`);
    }
    return loadFromManifest('benchmarks', fileName);
  }

  /**
   * Get section keys from benchmark data
   * @param {Object} data - benchmark data object
   * @returns {Array<string>} - array of section keys (e.g., ['sp500', 'nasdaq100', ...])
   */
  function getSectionKeys(data) {
    if (!data || typeof data !== 'object') return [];

    // Benchmark data has nested structure: { metadata: {}, sections: { sp500: {...}, ... } }
    if (data.sections && typeof data.sections === 'object') {
      return Object.keys(data.sections);
    }

    // Fallback for flat structure (legacy compatibility)
    const excludeKeys = ['metadata', 'version', 'updated', 'schema', 'source', 'description'];
    return Object.keys(data).filter(key => !excludeKeys.includes(key.toLowerCase()));
  }

  /**
   * Get section data array from benchmark data
   * @param {Object} data - benchmark data object
   * @param {string} section - section key (e.g., 'sp500')
   * @returns {Array} - time series data array
   */
  function getSectionData(data, section) {
    if (!data || !section) return [];

    // Benchmark data structure: { sections: { sp500: { name: '...', data: [...] } } }
    if (data.sections && data.sections[section]) {
      return data.sections[section].data || [];
    }

    // Fallback for flat structure (legacy compatibility)
    if (data[section] && Array.isArray(data[section].data)) {
      return data[section].data;
    }
    if (data[section] && Array.isArray(data[section])) {
      return data[section];
    }

    return [];
  }

  /**
   * Get section info (name, metadata) from benchmark data
   * @param {Object} data - benchmark data object
   * @param {string} section - section key (e.g., 'sp500')
   * @returns {Object} - section info { name, name_en, ... }
   */
  function getSectionInfo(data, section) {
    if (!data || !section) return null;

    if (data.sections && data.sections[section]) {
      const { data: _, ...info } = data.sections[section];
      return info;
    }

    return null;
  }

  return {
    fetchWithTimeout,
    fetchWithRetry,
    loadData,
    loadFromManifest,
    loadMultiple,
    loadMultipleFromManifest,
    getLatestData,
    isValidData,
    createError,
    extractUpdateDate,
    countRecords,
    // Valuation Lab Benchmark functions
    loadBenchmark,
    getSectionKeys,
    getSectionData,
    getSectionInfo,
    BENCHMARK_FILES,
    CONFIG
  };
})();
