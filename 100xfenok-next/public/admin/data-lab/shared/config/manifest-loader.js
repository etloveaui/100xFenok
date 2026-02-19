/**
 * ManifestLoader - Manifest-driven data source discovery
 *
 * Reads manifest.json to discover all data sources dynamically.
 * No hardcoded paths - config-only expansion.
 *
 * @module manifest-loader
 * @version 1.0.0
 */

const ManifestLoader = (function() {

  // Cache for loaded manifest and schemas
  let manifestCache = null;
  let schemaCache = new Map();

  // Config
  const CONFIG = {
    MANIFEST_PATH: '/data/manifest.json',
    SCHEMA_FILENAME: 'schema.json',
    CACHE_TTL: 5 * 60 * 1000  // 5 minutes
  };

  /**
   * Get base path for data files (Cloudflare/GitHub/Local compatible)
   * @returns {string}
   */
  function getBasePath() {
    const isLocal = /^(127\.0\.0\.1|localhost|192\.168\.\d+\.\d+)$/.test(location.hostname) || location.protocol === 'file:';
    const isCloudflare = location.hostname.endsWith('pages.dev');
    return (isLocal || isCloudflare) ? '' : '/100xFenok';
  }

  /**
   * Load the central manifest.json
   * @returns {Promise<Object>} manifest data
   */
  async function loadManifest() {
    if (manifestCache && manifestCache.expiry > Date.now()) {
      console.log('[ManifestLoader] Cache HIT: manifest');
      return manifestCache.data;
    }

    const url = getBasePath() + CONFIG.MANIFEST_PATH;
    console.log('[ManifestLoader] Loading manifest:', url);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load manifest: ${response.status}`);
    }

    const data = await response.json();
    manifestCache = {
      data: data,
      expiry: Date.now() + CONFIG.CACHE_TTL
    };

    return data;
  }

  /**
   * Load schema.json for a specific folder
   * @param {string} folderName - folder name (e.g., 'benchmarks', 'slickcharts')
   * @returns {Promise<Object|null>} schema data or null if not found
   */
  async function loadSchema(folderName) {
    const cacheKey = `schema_${folderName}`;
    const cached = schemaCache.get(cacheKey);

    if (cached && cached.expiry > Date.now()) {
      console.log(`[ManifestLoader] Cache HIT: ${cacheKey}`);
      return cached.data;
    }

    const url = `${getBasePath()}/data/${folderName}/${CONFIG.SCHEMA_FILENAME}`;
    console.log(`[ManifestLoader] Loading schema: ${url}`);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`[ManifestLoader] No schema for ${folderName}`);
        return null;
      }

      const data = await response.json();
      schemaCache.set(cacheKey, {
        data: data,
        expiry: Date.now() + CONFIG.CACHE_TTL
      });

      return data;
    } catch (error) {
      console.warn(`[ManifestLoader] Schema load error for ${folderName}:`, error);
      return null;
    }
  }

  /**
   * Get all folder configurations from manifest
   * @returns {Promise<Object>} { folderName: folderConfig, ... }
   */
  async function getFolders() {
    const manifest = await loadManifest();
    return manifest.folders || {};
  }

  /**
   * Get folder names as array
   * @returns {Promise<string[]>}
   */
  async function getFolderNames() {
    const folders = await getFolders();
    return Object.keys(folders);
  }

  /**
   * Get folder config with its schema
   * @param {string} folderName
   * @returns {Promise<Object>} { config: {...}, schema: {...} }
   */
  async function getFolderWithSchema(folderName) {
    const folders = await getFolders();
    const config = folders[folderName];

    if (!config) {
      return { config: null, schema: null };
    }

    const schema = config.schema ? await loadSchema(folderName) : null;

    return {
      config: config,
      schema: schema
    };
  }

  /**
   * Get all folders with their schemas (parallel load)
   * @returns {Promise<Object>} { folderName: { config, schema }, ... }
   */
  async function getAllFoldersWithSchemas() {
    const folderNames = await getFolderNames();
    const results = {};

    await Promise.all(folderNames.map(async (name) => {
      results[name] = await getFolderWithSchema(name);
    }));

    return results;
  }

  /**
   * Get recent changes from manifest
   * @param {number} limit - max number of changes (default: 5)
   * @returns {Promise<Array>}
   */
  async function getRecentChanges(limit = 5) {
    const manifest = await loadManifest();
    const changes = manifest.recent_changes || [];
    return changes.slice(0, limit);
  }

  /**
   * Get manifest version info
   * @returns {Promise<Object>} { version, created, last_updated }
   */
  async function getManifestInfo() {
    const manifest = await loadManifest();
    return {
      version: manifest.manifest_version,
      created: manifest.created,
      lastUpdated: manifest.last_updated,
      purpose: manifest.purpose
    };
  }

  /**
   * Clear all caches
   */
  function clearCache() {
    manifestCache = null;
    schemaCache.clear();
    console.log('[ManifestLoader] Cache cleared');
  }

  /**
   * Get cache stats
   * @returns {Object}
   */
  function getCacheStats() {
    return {
      manifestCached: !!manifestCache,
      schemaCacheSize: schemaCache.size
    };
  }

  return {
    loadManifest,
    loadSchema,
    getFolders,
    getFolderNames,
    getFolderWithSchema,
    getAllFoldersWithSchemas,
    getRecentChanges,
    getManifestInfo,
    clearCache,
    getCacheStats,
    getBasePath,
    CONFIG
  };
})();
