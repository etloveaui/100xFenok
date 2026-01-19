/**
 * 3-Tier Caching System for Data Lab
 *
 * Layer 1: Memory (instant) - current session
 * Layer 2: SessionStorage (fast) - tab persistence
 * Layer 3: Fetch (slow) - network request
 *
 * @module cache-manager
 * @version 2.0.0 (adapted from valuation-lab)
 */

const CacheManager = (function() {
  // Layer 1: Memory Cache
  const memoryCache = new Map();

  // Config
  const CONFIG = {
    MEMORY_TTL: 5 * 60 * 1000,      // 5 minutes
    SESSION_TTL: 30 * 60 * 1000,    // 30 minutes
    PREFIX: 'dlab_cache_'            // Data Lab prefix
  };

  /**
   * Generate cache key
   * @param {string} key - original key
   * @returns {string} prefixed key
   */
  function getCacheKey(key) {
    return CONFIG.PREFIX + key;
  }

  /**
   * Layer 1: Get from Memory
   * @param {string} key
   * @returns {any|null}
   */
  function getFromMemory(key) {
    const cached = memoryCache.get(key);
    if (!cached) return null;

    if (Date.now() > cached.expiry) {
      memoryCache.delete(key);
      return null;
    }
    return cached.data;
  }

  /**
   * Layer 1: Set to Memory
   * @param {string} key
   * @param {any} data
   */
  function setToMemory(key, data) {
    memoryCache.set(key, {
      data: data,
      expiry: Date.now() + CONFIG.MEMORY_TTL
    });
  }

  /**
   * Layer 2: Get from SessionStorage
   * @param {string} key
   * @returns {any|null}
   */
  function getFromSession(key) {
    try {
      const cacheKey = getCacheKey(key);
      const cached = sessionStorage.getItem(cacheKey);
      if (!cached) return null;

      const parsed = JSON.parse(cached);
      if (Date.now() > parsed.expiry) {
        sessionStorage.removeItem(cacheKey);
        return null;
      }
      return parsed.data;
    } catch (e) {
      console.warn('[Cache] SessionStorage read error:', e);
      return null;
    }
  }

  /**
   * Layer 2: Set to SessionStorage
   * @param {string} key
   * @param {any} data
   */
  function setToSession(key, data) {
    try {
      const cacheKey = getCacheKey(key);
      sessionStorage.setItem(cacheKey, JSON.stringify({
        data: data,
        expiry: Date.now() + CONFIG.SESSION_TTL
      }));
    } catch (e) {
      console.warn('[Cache] SessionStorage write error:', e);
    }
  }

  /**
   * 3-Tier cache get
   * @param {string} key - cache key
   * @param {Function} fetchFn - function to call on cache miss
   * @returns {Promise<any>}
   */
  async function get(key, fetchFn) {
    // Layer 1: Memory
    let data = getFromMemory(key);
    if (data !== null) {
      console.log(`[Cache] L1 HIT: ${key}`);
      return data;
    }

    // Layer 2: SessionStorage
    data = getFromSession(key);
    if (data !== null) {
      console.log(`[Cache] L2 HIT: ${key}`);
      setToMemory(key, data); // Promote to L1
      return data;
    }

    // Layer 3: Fetch
    console.log(`[Cache] L3 FETCH: ${key}`);
    data = await fetchFn();

    // Store in both layers
    setToMemory(key, data);
    setToSession(key, data);

    return data;
  }

  /**
   * Invalidate specific key
   * @param {string} key
   */
  function invalidate(key) {
    memoryCache.delete(key);
    try {
      sessionStorage.removeItem(getCacheKey(key));
    } catch (e) {}
  }

  /**
   * Clear all cache
   */
  function clear() {
    memoryCache.clear();
    try {
      const keys = Object.keys(sessionStorage);
      keys.forEach(k => {
        if (k.startsWith(CONFIG.PREFIX)) {
          sessionStorage.removeItem(k);
        }
      });
    } catch (e) {}
  }

  /**
   * Get cache stats
   * @returns {Object}
   */
  function getStats() {
    return {
      memorySize: memoryCache.size,
      sessionKeys: Object.keys(sessionStorage).filter(k => k.startsWith(CONFIG.PREFIX)).length
    };
  }

  return {
    get,
    invalidate,
    clear,
    getStats,
    CONFIG
  };
})();
