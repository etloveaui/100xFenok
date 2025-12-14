/**
 * 3-Tier Caching System
 *
 * Layer 1: Memory (즉시) - 현재 세션 내 재사용
 * Layer 2: SessionStorage (빠름) - 탭 내 지속
 * Layer 3: Fetch (느림) - 네트워크 요청
 *
 * @module cache-manager
 */

const CacheManager = (function() {
  // Layer 1: Memory Cache
  const memoryCache = new Map();

  // 캐시 설정
  const CONFIG = {
    MEMORY_TTL: 5 * 60 * 1000,      // 5분
    SESSION_TTL: 30 * 60 * 1000,    // 30분
    PREFIX: 'vlab_cache_'
  };

  /**
   * 캐시 키 생성
   * @param {string} key - 원본 키
   * @returns {string} 프리픽스 적용된 키
   */
  function getCacheKey(key) {
    return CONFIG.PREFIX + key;
  }

  /**
   * Layer 1: Memory에서 조회
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
   * Layer 1: Memory에 저장
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
   * Layer 2: SessionStorage에서 조회
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
   * Layer 2: SessionStorage에 저장
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
   * 3-Tier 캐시 조회
   * @param {string} key - 캐시 키
   * @param {Function} fetchFn - 캐시 미스 시 호출할 함수
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
      setToMemory(key, data); // L1에 승격
      return data;
    }

    // Layer 3: Fetch
    console.log(`[Cache] L3 FETCH: ${key}`);
    data = await fetchFn();

    // 양쪽에 저장
    setToMemory(key, data);
    setToSession(key, data);

    return data;
  }

  /**
   * 특정 키 캐시 무효화
   * @param {string} key
   */
  function invalidate(key) {
    memoryCache.delete(key);
    try {
      sessionStorage.removeItem(getCacheKey(key));
    } catch (e) {}
  }

  /**
   * 전체 캐시 클리어
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
   * 캐시 상태 조회
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
