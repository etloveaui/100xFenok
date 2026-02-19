/**
 * Pure Functions - 계산 함수 모음
 *
 * 모든 함수는 순수 함수 (같은 입력 = 같은 출력, 부작용 없음)
 *
 * @module calculations
 */

const Calculations = (function() {

  /**
   * Earnings Yield (이익수익률)
   * @param {number} pe - P/E 비율
   * @returns {number|null} 0~1 사이 값
   */
  function earningsYield(pe) {
    if (pe === null || pe === undefined || pe <= 0 || isNaN(pe)) {
      return null;
    }
    return 1 / pe;
  }

  /**
   * 백분위수 계산
   * @param {number} value - 현재 값
   * @param {number[]} array - 비교 배열
   * @returns {number|null} 0~100 사이 백분위수
   */
  function percentile(value, array) {
    if (value === null || value === undefined || isNaN(value)) return null;
    if (!array || !Array.isArray(array) || array.length === 0) return null;

    const validArray = array.filter(v => v !== null && v !== undefined && !isNaN(v));
    if (validArray.length === 0) return null;

    const sorted = [...validArray].sort((a, b) => a - b);
    const below = sorted.filter(v => v < value).length;

    return (below / sorted.length) * 100;
  }

  /**
   * Z-Score 계산
   * @param {number} value - 현재 값
   * @param {number} mean - 평균
   * @param {number} std - 표준편차
   * @returns {number|null}
   */
  function zScore(value, mean, std) {
    if (value === null || value === undefined || isNaN(value)) return null;
    if (mean === null || mean === undefined || isNaN(mean)) return null;
    if (std === null || std === undefined || std === 0 || isNaN(std)) return null;

    return (value - mean) / std;
  }

  /**
   * 배열 평균
   * @param {number[]} array
   * @returns {number|null}
   */
  function mean(array) {
    if (!array || !Array.isArray(array) || array.length === 0) return null;

    const validArray = array.filter(v => v !== null && v !== undefined && !isNaN(v));
    if (validArray.length === 0) return null;

    return validArray.reduce((a, b) => a + b, 0) / validArray.length;
  }

  /**
   * 배열 표준편차
   * @param {number[]} array
   * @returns {number|null}
   */
  function standardDeviation(array) {
    const avg = mean(array);
    if (avg === null) return null;

    const validArray = array.filter(v => v !== null && v !== undefined && !isNaN(v));
    const squareDiffs = validArray.map(v => Math.pow(v - avg, 2));
    const avgSquareDiff = mean(squareDiffs);

    return avgSquareDiff !== null ? Math.sqrt(avgSquareDiff) : null;
  }

  /**
   * 섹터 프리미엄/디스카운트
   * @param {number} sectorPE - 섹터 P/E
   * @param {number} basePE - 기준 P/E (예: S&P500)
   * @returns {number|null} 프리미엄 비율 (0.15 = +15%)
   */
  function sectorPremium(sectorPE, basePE) {
    if (!isValidNumber(sectorPE) || !isValidNumber(basePE) || basePE === 0) {
      return null;
    }
    return (sectorPE / basePE) - 1;
  }

  /**
   * 52주 수익률
   * @param {number} currentPrice - 현재 가격
   * @param {number} price52WeekAgo - 52주 전 가격
   * @returns {number|null}
   */
  function return52Week(currentPrice, price52WeekAgo) {
    if (!isValidNumber(currentPrice) || !isValidNumber(price52WeekAgo) || price52WeekAgo === 0) {
      return null;
    }
    return (currentPrice / price52WeekAgo) - 1;
  }

  /**
   * PEG Proxy (ROE 기반)
   * @param {number} pe - P/E 비율
   * @param {number} roe - ROE (백분율, 예: 15 = 15%)
   * @returns {number|null}
   */
  function pegProxy(pe, roe) {
    if (!isValidNumber(pe) || !isValidNumber(roe) || roe === 0) {
      return null;
    }
    // PEG = PE / Growth, ROE를 Growth 대리로 사용
    return pe / roe;
  }

  /**
   * 배열에서 Z-Score 계산 (평균/표준편차 자동 계산)
   * @param {number} value - 현재 값
   * @param {number[]} array - 비교 배열
   * @returns {number|null}
   */
  function zScoreFromArray(value, array) {
    const avg = mean(array);
    const std = standardDeviation(array);
    return zScore(value, avg, std);
  }

  /**
   * 밸류에이션 점수 종합 (가중 평균)
   * @param {Object} metrics - { pe: number, pb: number, roe: number }
   * @param {Object} weights - { pe: 0.4, pb: 0.3, roe: 0.3 }
   * @returns {number|null} 0-100 점수
   */
  function valuationScore(metrics, weights = { pe: 0.4, pb: 0.3, roe: 0.3 }) {
    const { pe, pb, roe } = metrics;
    let totalWeight = 0;
    let weightedSum = 0;

    if (isValidNumber(pe)) {
      weightedSum += pe * weights.pe;
      totalWeight += weights.pe;
    }
    if (isValidNumber(pb)) {
      weightedSum += pb * weights.pb;
      totalWeight += weights.pb;
    }
    if (isValidNumber(roe)) {
      // ROE는 역으로 (높을수록 좋음 → 낮은 분위수로 변환)
      weightedSum += (100 - roe) * weights.roe;
      totalWeight += weights.roe;
    }

    if (totalWeight === 0) return null;
    return weightedSum / totalWeight;
  }

  /**
   * 유효한 숫자인지 체크 (헬퍼)
   * @param {any} value
   * @returns {boolean}
   */
  function isValidNumber(value) {
    return value !== null && value !== undefined && !isNaN(value) && isFinite(value);
  }

  return {
    earningsYield,
    percentile,
    zScore,
    zScoreFromArray,
    mean,
    standardDeviation,
    sectorPremium,
    return52Week,
    pegProxy,
    valuationScore,
    isValidNumber
  };
})();
