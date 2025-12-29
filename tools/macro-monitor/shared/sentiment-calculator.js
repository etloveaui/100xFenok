/**
 * Sentiment Calculator - Signal Score 계산 및 상태 판정
 * @version 1.0.0
 * @description Phase 4-C: Market Sentiment Widget 핵심 로직
 */

import { SENTIMENT } from './constants.js';

const { THRESHOLDS, SCORE_RANGES, COLORS, LABELS, LABELS_EN, BOTTOM_CHECKS } = SENTIMENT;

// ============================================
// 개별 지표 점수 계산 (-2 ~ +2)
// ============================================

/**
 * VIX 점수 계산
 * 높을수록 공포 → 음수 점수
 * @param {number} value - VIX 값
 * @returns {number} -2 ~ +1
 */
export function calculateVixScore(value) {
  if (value == null) return 0;
  const t = THRESHOLDS.VIX;
  if (value >= t.EXTREME_FEAR) return -2;  // VIX >= 40
  if (value >= t.FEAR) return -1;          // VIX >= 30
  if (value < t.GREED) return 1;           // VIX < 12
  return 0;                                // 12-30: 중립
}

/**
 * CNN Fear & Greed 점수 계산
 * 0-100 스케일, 낮을수록 공포
 * @param {number} value - CNN F&G 값 (0-100)
 * @returns {number} -2 ~ +2
 */
export function calculateCnnScore(value) {
  if (value == null) return 0;
  const t = THRESHOLDS.CNN;
  if (value <= t.EXTREME_FEAR) return -2;  // <= 15
  if (value <= t.FEAR) return -1;          // <= 25
  if (value >= t.EXTREME_GREED) return 2;  // >= 85
  if (value >= t.NEUTRAL_HIGH) return 1;   // >= 75
  return 0;                                // 25-75: 중립
}

/**
 * CFTC Net Position 점수 계산
 * 순매도(음수)가 클수록 공포
 * @param {number} value - CFTC Net Position
 * @returns {number} -2 ~ +2
 */
export function calculateCftcScore(value) {
  if (value == null) return 0;
  const t = THRESHOLDS.CFTC;
  if (value <= t.EXTREME_SHORT) return -2;  // <= -180K
  if (value <= t.SHORT) return -1;          // <= -100K
  if (value >= t.EXTREME_LONG) return 2;    // >= 180K
  if (value >= t.LONG) return 1;            // >= 100K
  return 0;                                 // -100K ~ 100K: 중립
}

/**
 * MOVE Index 점수 계산
 * 높을수록 채권 시장 변동성 → 스트레스
 * @param {number} value - MOVE Index 값
 * @returns {number} -2 ~ +1
 */
export function calculateMoveScore(value) {
  if (value == null) return 0;
  const t = THRESHOLDS.MOVE;
  if (value >= t.CRISIS) return -2;   // >= 150
  if (value >= t.STRESS) return -1;   // >= 120
  if (value <= t.STABLE) return 1;    // <= 60
  return 0;                           // 60-120: 중립
}

/**
 * Crypto Fear & Greed 점수 계산
 * 0-100 스케일, 낮을수록 공포
 * @param {number} value - Crypto F&G 값 (0-100)
 * @returns {number} -2 ~ +1
 */
export function calculateCryptoScore(value) {
  if (value == null) return 0;
  const t = THRESHOLDS.CRYPTO;
  if (value <= t.EXTREME_FEAR) return -2;  // <= 10
  if (value <= t.FEAR) return -1;          // <= 25
  if (value >= t.GREED) return 1;          // >= 75
  return 0;                                // 25-75: 중립
}

// ============================================
// Signal Score 종합 계산 (-8 ~ +8)
// ============================================

/**
 * 종합 Signal Score 계산
 * @param {object} data - { vix, cnn, cftc, move, crypto }
 * @returns {number} -8 ~ +8
 */
export function calculateSignalScore(data) {
  const vixScore = calculateVixScore(data.vix);
  const cnnScore = calculateCnnScore(data.cnn);
  const cftcScore = calculateCftcScore(data.cftc);
  const moveScore = calculateMoveScore(data.move);
  const cryptoScore = calculateCryptoScore(data.crypto);

  const total = vixScore + cnnScore + cftcScore + moveScore + cryptoScore;

  // 범위 제한 (-8 ~ +8)
  return Math.max(-8, Math.min(8, total));
}

/**
 * 상세 점수 분해 반환
 * @param {object} data - { vix, cnn, cftc, move, crypto }
 * @returns {object} - 각 지표별 점수 및 총점
 */
export function calculateScoreBreakdown(data) {
  return {
    vix: { value: data.vix, score: calculateVixScore(data.vix) },
    cnn: { value: data.cnn, score: calculateCnnScore(data.cnn) },
    cftc: { value: data.cftc, score: calculateCftcScore(data.cftc) },
    move: { value: data.move, score: calculateMoveScore(data.move) },
    crypto: { value: data.crypto, score: calculateCryptoScore(data.crypto) },
    total: calculateSignalScore(data)
  };
}

// ============================================
// 상태 판정
// ============================================

/**
 * Signal Score → 상태 문자열
 * @param {number} score - Signal Score (-8 ~ +8)
 * @returns {string} - 'EXTREME_FEAR' | 'FEAR' | 'NEUTRAL' | 'GREED' | 'EXTREME_GREED'
 */
export function getSignalStatus(score) {
  if (score <= SCORE_RANGES.EXTREME_FEAR.max) return 'EXTREME_FEAR';
  if (score <= SCORE_RANGES.FEAR.max) return 'FEAR';
  if (score === 0) return 'NEUTRAL';
  if (score <= SCORE_RANGES.GREED.max) return 'GREED';
  return 'EXTREME_GREED';
}

/**
 * 상태 → 색상 코드
 * @param {string} status - 상태 문자열
 * @returns {string} - HEX 색상
 */
export function getStatusColor(status) {
  return COLORS[status] || COLORS.NEUTRAL;
}

/**
 * 상태 → 라벨 (한글)
 * @param {string} status - 상태 문자열
 * @returns {string} - 한글 라벨
 */
export function getStatusLabel(status) {
  return LABELS[status] || '중립';
}

/**
 * 상태 → 라벨 (영문)
 * @param {string} status - 상태 문자열
 * @returns {string} - 영문 라벨
 */
export function getStatusLabelEn(status) {
  return LABELS_EN[status] || 'Neutral';
}

// ============================================
// Segment Bar 마커 위치 계산
// ============================================

/**
 * Signal Score → 마커 위치 (0-100%)
 * @param {number} score - Signal Score (-8 ~ +8)
 * @returns {number} - 0 ~ 100 (%)
 */
export function calculateMarkerPosition(score) {
  // -8 → 0%, 0 → 50%, +8 → 100%
  const clampedScore = Math.max(-8, Math.min(8, score));
  return ((clampedScore + 8) / 16) * 100;
}

/**
 * Score에 따른 CSS 클래스 반환
 * @param {number} score - Signal Score
 * @returns {string} - CSS 클래스명 (fear | neutral | greed)
 */
export function getScoreCssClass(score) {
  if (score < 0) return 'fear';
  if (score > 0) return 'greed';
  return 'neutral';
}

// ============================================
// 바닥 확인 체크리스트
// ============================================

/**
 * 바닥 확인 조건 체크
 * @param {object} data - { vix, cnn, cftc, move, crypto }
 * @returns {object} - { checks: [...], count: n, total: 5, percentage: n% }
 */
export function checkBottomConditions(data) {
  const checks = [];

  // VIX > 30
  const vixCheck = {
    key: 'VIX',
    label: BOTTOM_CHECKS.VIX.label,
    value: data.vix,
    threshold: BOTTOM_CHECKS.VIX.threshold,
    ideal: BOTTOM_CHECKS.VIX.ideal,
    passed: data.vix != null && data.vix >= BOTTOM_CHECKS.VIX.threshold,
    isIdeal: data.vix != null && data.vix >= (BOTTOM_CHECKS.VIX.ideal || BOTTOM_CHECKS.VIX.threshold)
  };
  checks.push(vixCheck);

  // CNN F&G < 25
  const cnnCheck = {
    key: 'CNN',
    label: BOTTOM_CHECKS.CNN.label,
    value: data.cnn,
    threshold: BOTTOM_CHECKS.CNN.threshold,
    passed: data.cnn != null && data.cnn <= BOTTOM_CHECKS.CNN.threshold
  };
  checks.push(cnnCheck);

  // CFTC Net < -150K
  const cftcCheck = {
    key: 'CFTC',
    label: BOTTOM_CHECKS.CFTC.label,
    value: data.cftc,
    threshold: BOTTOM_CHECKS.CFTC.threshold,
    passed: data.cftc != null && data.cftc <= BOTTOM_CHECKS.CFTC.threshold
  };
  checks.push(cftcCheck);

  // MOVE < 60
  const moveCheck = {
    key: 'MOVE',
    label: BOTTOM_CHECKS.MOVE.label,
    value: data.move,
    threshold: BOTTOM_CHECKS.MOVE.threshold,
    passed: data.move != null && data.move <= BOTTOM_CHECKS.MOVE.threshold
  };
  checks.push(moveCheck);

  // Crypto F&G < 20
  const cryptoCheck = {
    key: 'CRYPTO',
    label: BOTTOM_CHECKS.CRYPTO.label,
    value: data.crypto,
    threshold: BOTTOM_CHECKS.CRYPTO.threshold,
    passed: data.crypto != null && data.crypto <= BOTTOM_CHECKS.CRYPTO.threshold
  };
  checks.push(cryptoCheck);

  const passedCount = checks.filter(c => c.passed).length;

  return {
    checks,
    count: passedCount,
    total: 5,
    percentage: Math.round((passedCount / 5) * 100)
  };
}

// ============================================
// 그룹별 점수 계산
// ============================================

/**
 * 그룹별 종합 점수 계산
 * @param {string} groupKey - 'MARKET_FG' | 'VOLATILITY' | 'CRYPTO' | 'CNN_COMPONENTS'
 * @param {object} data - 전체 데이터
 * @returns {number} - 그룹 점수
 */
export function calculateGroupScore(groupKey, data) {
  switch (groupKey) {
    case 'MARKET_FG':
      return calculateCnnScore(data.cnn) + calculateCftcScore(data.cftc);
    case 'VOLATILITY':
      return calculateVixScore(data.vix) + calculateMoveScore(data.move);
    case 'CRYPTO':
      return calculateCryptoScore(data.crypto);
    case 'CNN_COMPONENTS':
      // CNN 7 Components의 평균을 기반으로 계산
      if (data.cnnComponents) {
        const avg = Object.values(data.cnnComponents).reduce((a, b) => a + b, 0) / 7;
        return calculateCnnScore(avg);
      }
      return 0;
    default:
      return 0;
  }
}

// ============================================
// 유틸리티
// ============================================

/**
 * CFTC 값 포맷팅 (K 단위)
 * @param {number} value - CFTC 값
 * @returns {string} - 포맷된 문자열
 */
export function formatCftcValue(value) {
  if (value == null) return 'N/A';
  const absK = Math.abs(value / 1000).toFixed(0);
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${absK}K`;
}

/**
 * 값 포맷팅 (소수점)
 * @param {number} value - 값
 * @param {number} decimals - 소수점 자릿수
 * @returns {string}
 */
export function formatValue(value, decimals = 1) {
  if (value == null) return 'N/A';
  return value.toFixed(decimals);
}

// ============================================
// Export All
// ============================================
export const SentimentCalculator = {
  calculateVixScore,
  calculateCnnScore,
  calculateCftcScore,
  calculateMoveScore,
  calculateCryptoScore,
  calculateSignalScore,
  calculateScoreBreakdown,
  getSignalStatus,
  getStatusColor,
  getStatusLabel,
  getStatusLabelEn,
  calculateMarkerPosition,
  getScoreCssClass,
  checkBottomConditions,
  calculateGroupScore,
  formatCftcValue,
  formatValue
};

// CommonJS 호환
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SentimentCalculator, ...SentimentCalculator };
}
