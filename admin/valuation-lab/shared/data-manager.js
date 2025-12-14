/**
 * 공통 DataManager
 *
 * 데이터 로드, 에러 처리, 배치 fetch 기능
 * CacheManager와 연동하여 3-Tier 캐싱 적용
 *
 * @module data-manager
 */

const DataManager = (function() {

  // 설정
  const CONFIG = {
    TIMEOUT: 10000,       // 10초 타임아웃
    RETRY_COUNT: 2,       // 재시도 횟수
    RETRY_DELAY: 1000     // 재시도 간격 (ms)
  };

  /**
   * 타임아웃 fetch
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
   * 재시도 로직이 포함된 fetch
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
   * 단일 벤치마크 데이터 로드 (캐싱 적용)
   * @param {string} fileKey - CONSTANTS.FILES의 키 (US, SECTORS, etc.)
   * @returns {Promise<Object>}
   */
  async function loadBenchmark(fileKey) {
    const file = CONSTANTS.FILES[fileKey];
    if (!file) {
      throw new Error(`Unknown file key: ${fileKey}`);
    }

    const url = `${CONSTANTS.DATA_BASE}/${file}`;
    const cacheKey = `benchmark_${fileKey}`;

    return CacheManager.get(cacheKey, () => fetchWithRetry(url));
  }

  /**
   * 다중 벤치마크 데이터 배치 로드
   * @param {string[]} fileKeys - 파일 키 배열
   * @returns {Promise<Object>} { US: data, SECTORS: data, ... }
   */
  async function loadBenchmarks(fileKeys) {
    const results = {};
    const promises = fileKeys.map(async (key) => {
      try {
        results[key] = await loadBenchmark(key);
      } catch (error) {
        console.error(`[DataManager] Failed to load ${key}:`, error);
        results[key] = null;
      }
    });

    await Promise.all(promises);
    return results;
  }

  /**
   * 모든 벤치마크 데이터 로드
   * @returns {Promise<Object>}
   */
  async function loadAllBenchmarks() {
    return loadBenchmarks(Object.keys(CONSTANTS.FILES));
  }

  /**
   * 섹션 키 목록 반환
   * @param {Object} data - 벤치마크 데이터 (전체)
   * @returns {string[]}
   */
  function getSectionKeys(data) {
    if (!data || !data.sections) return [];
    return Object.keys(data.sections);
  }

  /**
   * 특정 섹션 데이터 반환
   * @param {Object} data - 벤치마크 데이터 (전체)
   * @param {string} sectionKey - 섹션 키 (예: 'sp500', 'nasdaq100')
   * @returns {Object|null} { name, name_en, data: [...] }
   */
  function getSection(data, sectionKey) {
    if (!data || !data.sections) return null;
    return data.sections[sectionKey] || null;
  }

  /**
   * 특정 섹션의 시계열 데이터 배열 반환
   * @param {Object} data - 벤치마크 데이터 (전체)
   * @param {string} sectionKey - 섹션 키
   * @returns {Array}
   */
  function getSectionData(data, sectionKey) {
    const section = getSection(data, sectionKey);
    return section?.data || [];
  }

  /**
   * 특정 심볼 데이터 추출 (구버전 호환)
   * @param {Object|Array} data - 벤치마크 데이터 또는 배열
   * @param {string} symbol - 심볼 (예: 'SPY')
   * @returns {Object|null}
   */
  function getSymbolData(data, symbol) {
    // 배열인 경우 (구버전 호환)
    if (Array.isArray(data)) {
      return data.find(item => item.symbol === symbol || item.ticker === symbol) || null;
    }
    // sections 구조인 경우 - 심볼명과 일치하는 섹션 찾기
    if (data && data.sections) {
      const key = symbol.toLowerCase();
      if (data.sections[key]) {
        return data.sections[key];
      }
    }
    return null;
  }

  /**
   * 최신 데이터 추출 (날짜 기준)
   * @param {Array} dataArray - 시계열 데이터 배열
   * @returns {Object|null}
   */
  function getLatestData(dataArray) {
    if (!Array.isArray(dataArray) || dataArray.length === 0) return null;

    // date 필드 기준 정렬 후 최신 반환
    const sorted = [...dataArray].sort((a, b) => {
      const dateA = new Date(a.date || 0);
      const dateB = new Date(b.date || 0);
      return dateB - dateA;
    });

    return sorted[0];
  }

  /**
   * 데이터 유효성 빠른 체크
   * @param {any} data
   * @returns {boolean}
   */
  function isValidData(data) {
    return data !== null && data !== undefined &&
           (Array.isArray(data) ? data.length > 0 : Object.keys(data).length > 0);
  }

  /**
   * 에러 상태 객체 생성
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

  return {
    loadBenchmark,
    loadBenchmarks,
    loadAllBenchmarks,
    getSectionKeys,
    getSection,
    getSectionData,
    getSymbolData,
    getLatestData,
    isValidData,
    createError,
    CONFIG
  };
})();
