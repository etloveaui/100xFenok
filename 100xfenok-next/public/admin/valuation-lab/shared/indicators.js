/**
 * Indicators - 고수준 지표 계산 모듈
 *
 * DataManager + Calculations를 조합하여 실제 데이터 기반 지표 계산
 * Phase 2: Layer 1A 지표
 *
 * @module indicators
 * @requires DataManager
 * @requires Calculations
 */

const Indicators = (function() {

  // ========================================
  // Step 2.1: 간단한 지표 (#9, #15, #16)
  // ========================================

  /**
   * #9 Earnings Yield (이익수익률)
   * @param {Object} latestData - 최신 데이터 레코드
   * @returns {Object} { value, formatted, description }
   */
  function getEarningsYield(latestData) {
    const pe = latestData?.best_pe_ratio;
    const value = Calculations.earningsYield(pe);

    if (value === null) {
      return { value: null, formatted: 'N/A', description: '데이터 없음' };
    }

    return {
      value,
      formatted: Formatters.formatPercent(value, 2),
      description: `현재 주가 대비 이익 수익률 ${Formatters.formatPercent(value, 2)}`
    };
  }

  /**
   * #15 52-Week Return (1년 수익률)
   * @param {Array} sectionData - 시계열 데이터 배열
   * @returns {Object} { value, formatted, description }
   */
  function getReturn52Week(sectionData) {
    if (!sectionData || sectionData.length < 2) {
      return { value: null, formatted: 'N/A', description: '데이터 부족' };
    }

    const latest = DataManager.getLatestData(sectionData);
    const currentPrice = latest?.px_last;

    // 52주 전 데이터 찾기 (약 252 거래일)
    const targetDate = new Date(latest.date);
    targetDate.setFullYear(targetDate.getFullYear() - 1);

    // 가장 가까운 과거 데이터 찾기
    const sortedData = [...sectionData].sort((a, b) => new Date(a.date) - new Date(b.date));
    let price52WeekAgo = null;

    for (const record of sortedData) {
      const recordDate = new Date(record.date);
      if (recordDate <= targetDate && record.px_last) {
        price52WeekAgo = record.px_last;
      }
    }

    const value = Calculations.return52Week(currentPrice, price52WeekAgo);

    if (value === null) {
      return { value: null, formatted: 'N/A', description: '52주 전 데이터 없음' };
    }

    const sign = value >= 0 ? '+' : '';
    return {
      value,
      formatted: Formatters.formatPercent(value, 1, true),
      description: `52주 수익률 ${sign}${(value * 100).toFixed(1)}%`
    };
  }

  /**
   * #16 PEG Proxy (ROE 기반 PEG 대리 지표)
   * @param {Object} latestData - 최신 데이터 레코드
   * @returns {Object} { value, formatted, description, signal }
   */
  function getPEGProxy(latestData) {
    const pe = latestData?.best_pe_ratio;
    const roe = latestData?.roe;

    // ROE가 소수점 형태면 백분율로 변환 (0.15 → 15)
    const roePercent = roe && roe < 1 ? roe * 100 : roe;

    const value = Calculations.pegProxy(pe, roePercent);

    if (value === null) {
      return { value: null, formatted: 'N/A', description: '데이터 없음', signal: null };
    }

    // PEG 해석: < 1 저평가, 1~2 적정, > 2 고평가
    let signal, signalLabel;
    if (value < 1) {
      signal = '🟢';
      signalLabel = '저평가';
    } else if (value <= 2) {
      signal = '🟡';
      signalLabel = '적정';
    } else {
      signal = '🔴';
      signalLabel = '고평가';
    }

    return {
      value,
      formatted: value.toFixed(2) + 'x',
      description: `PEG ${value.toFixed(2)} (${signalLabel})`,
      signal,
      signalLabel
    };
  }

  // ========================================
  // Step 2.2: Percentile 그룹 (#10, #11, #12)
  // ========================================

  /**
   * #10 P/E Percentile (P/E 백분위수)
   * @param {Array} sectionData - 시계열 데이터 배열
   * @returns {Object} { value, formatted, signal, description }
   */
  function getPEPercentile(sectionData) {
    return _getPercentile(sectionData, 'best_pe_ratio', 'P/E');
  }

  /**
   * #11 P/B Percentile (P/B 백분위수)
   * @param {Array} sectionData - 시계열 데이터 배열
   * @returns {Object} { value, formatted, signal, description }
   */
  function getPBPercentile(sectionData) {
    return _getPercentile(sectionData, 'px_to_book_ratio', 'P/B');
  }

  /**
   * #12 ROE Percentile (ROE 백분위수)
   * ROE는 높을수록 좋으므로 신호등 로직 반전
   * @param {Array} sectionData - 시계열 데이터 배열
   * @returns {Object} { value, formatted, signal, description }
   */
  function getROEPercentile(sectionData) {
    const result = _getPercentile(sectionData, 'roe', 'ROE', true);
    return result;
  }

  /**
   * 백분위수 계산 공통 함수
   * @private
   */
  function _getPercentile(sectionData, field, label, invertSignal = false) {
    if (!sectionData || sectionData.length === 0) {
      return { value: null, formatted: 'N/A', signal: null, description: '데이터 없음' };
    }

    const values = sectionData
      .map(d => d[field])
      .filter(v => v !== null && v !== undefined && !isNaN(v));

    if (values.length === 0) {
      return { value: null, formatted: 'N/A', signal: null, description: `${label} 데이터 없음` };
    }

    const latest = DataManager.getLatestData(sectionData);
    const currentValue = latest?.[field];

    if (currentValue === null || currentValue === undefined) {
      return { value: null, formatted: 'N/A', signal: null, description: `현재 ${label} 없음` };
    }

    const value = Calculations.percentile(currentValue, values);

    // 신호등 판단 (CONSTANTS.THRESHOLDS.PERCENTILE 사용)
    const thresholds = CONSTANTS.THRESHOLDS.PERCENTILE;
    let signal, signalLabel;

    if (invertSignal) {
      // ROE: 높을수록 좋음 → 높은 백분위수 = 🟢
      if (value >= thresholds.EXPENSIVE) {
        signal = '🟢';
        signalLabel = '우수';
      } else if (value >= thresholds.CHEAP) {
        signal = '🟡';
        signalLabel = '보통';
      } else {
        signal = '🔴';
        signalLabel = '저조';
      }
    } else {
      // P/E, P/B: 낮을수록 좋음 → 낮은 백분위수 = 🟢
      if (value <= thresholds.CHEAP) {
        signal = '🟢';
        signalLabel = '저평가';
      } else if (value <= thresholds.EXPENSIVE) {
        signal = '🟡';
        signalLabel = '적정';
      } else {
        signal = '🔴';
        signalLabel = '고평가';
      }
    }

    return {
      value,
      formatted: `${value.toFixed(0)}%`,
      signal,
      signalLabel,
      description: `${label} 분위수 ${value.toFixed(0)}% (${signalLabel})`
    };
  }

  // ========================================
  // Step 2.3: 통계 그룹 (#13, #14)
  // ========================================

  /**
   * #13 P/E Z-Score
   * @param {Array} sectionData - 시계열 데이터 배열
   * @returns {Object} { value, formatted, signal, description }
   */
  function getPEZScore(sectionData) {
    if (!sectionData || sectionData.length === 0) {
      return { value: null, formatted: 'N/A', signal: null, description: '데이터 없음' };
    }

    const peValues = sectionData
      .map(d => d.best_pe_ratio)
      .filter(v => v !== null && v !== undefined && !isNaN(v));

    if (peValues.length < 2) {
      return { value: null, formatted: 'N/A', signal: null, description: 'P/E 데이터 부족' };
    }

    const latest = DataManager.getLatestData(sectionData);
    const currentPE = latest?.best_pe_ratio;

    const value = Calculations.zScoreFromArray(currentPE, peValues);

    if (value === null) {
      return { value: null, formatted: 'N/A', signal: null, description: 'Z-Score 계산 불가' };
    }

    // Z-Score 해석: |z| < 1 정상, 1~2 주의, > 2 이상치
    let signal, signalLabel;
    const absZ = Math.abs(value);

    if (absZ <= 1) {
      signal = '🟢';
      signalLabel = '정상 범위';
    } else if (absZ <= 2) {
      signal = '🟡';
      signalLabel = value > 0 ? '평균 이상' : '평균 이하';
    } else {
      signal = '🔴';
      signalLabel = value > 0 ? '고평가 이상치' : '저평가 이상치';
    }

    const sign = value >= 0 ? '+' : '';
    return {
      value,
      formatted: `${sign}${value.toFixed(2)}σ`,
      signal,
      signalLabel,
      description: `P/E Z-Score ${sign}${value.toFixed(2)} (${signalLabel})`
    };
  }

  /**
   * #14 Sector Premium (섹터 프리미엄/디스카운트)
   * @param {Object} sectorLatest - 섹터 최신 데이터
   * @param {Object} benchmarkLatest - 벤치마크(S&P500) 최신 데이터
   * @returns {Object} { value, formatted, description }
   */
  function getSectorPremium(sectorLatest, benchmarkLatest) {
    const sectorPE = sectorLatest?.best_pe_ratio;
    const benchmarkPE = benchmarkLatest?.best_pe_ratio;

    const value = Calculations.sectorPremium(sectorPE, benchmarkPE);

    if (value === null) {
      return { value: null, formatted: 'N/A', description: '데이터 없음' };
    }

    const sign = value >= 0 ? '+' : '';
    const label = value >= 0 ? '프리미엄' : '디스카운트';

    return {
      value,
      formatted: Formatters.formatPercent(value, 1, true),
      description: `S&P500 대비 ${sign}${(value * 100).toFixed(1)}% ${label}`
    };
  }

  // ========================================
  // 종합 함수
  // ========================================

  /**
   * 벤치마크 밸류에이션 종합 분석
   * @param {string} benchmark - 벤치마크 키 (예: 'US')
   * @param {string} section - 섹션 키 (예: 'sp500')
   * @returns {Promise<Object>} 종합 분석 결과
   */
  async function getValuationSummary(benchmark, section) {
    try {
      const data = await DataManager.loadBenchmark(benchmark);
      const sectionData = DataManager.getSectionData(data, section);
      const latest = DataManager.getLatestData(sectionData);

      return {
        date: latest?.date,
        earningsYield: getEarningsYield(latest),
        return52Week: getReturn52Week(sectionData),
        pegProxy: getPEGProxy(latest),
        pePercentile: getPEPercentile(sectionData),
        pbPercentile: getPBPercentile(sectionData),
        roePercentile: getROEPercentile(sectionData),
        peZScore: getPEZScore(sectionData)
      };
    } catch (error) {
      console.error('[Indicators] getValuationSummary error:', error);
      return { error: error.message };
    }
  }

  // ========================================
  // Public API
  // ========================================

  return {
    // Step 2.1
    getEarningsYield,
    getReturn52Week,
    getPEGProxy,

    // Step 2.2
    getPEPercentile,
    getPBPercentile,
    getROEPercentile,

    // Step 2.3
    getPEZScore,
    getSectorPremium,

    // 종합
    getValuationSummary
  };

})();
