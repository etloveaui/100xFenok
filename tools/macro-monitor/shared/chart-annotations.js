/**
 * 100x Market Radar - Chart.js Annotation 헬퍼
 * @version 1.0.0
 * @description 리세션 음영 등 차트 annotation 생성
 * @requires chartjs-plugin-annotation
 */

import { getRecessionsInRange } from './recession-data.js';

// ============================================
// 리세션 음영 스타일
// ============================================
const RECESSION_STYLE = Object.freeze({
  backgroundColor: 'rgba(156, 163, 175, 0.2)', // gray-400 20%
  borderColor: 'rgba(156, 163, 175, 0.4)',     // gray-400 40%
  borderWidth: 1,
  borderDash: [2, 2],
  label: {
    display: true,
    position: 'start',
    backgroundColor: 'rgba(156, 163, 175, 0.7)',
    color: '#ffffff',
    font: { size: 9, weight: 'bold' },
    padding: 2
  }
});

// ============================================
// Annotation 생성 함수
// ============================================

/**
 * 리세션 음영 annotation 배열 생성
 * @param {string|Date} chartStart - 차트 시작일
 * @param {string|Date} chartEnd - 차트 종료일
 * @param {Object} options - 추가 옵션
 * @param {boolean} options.showLabel - 라벨 표시 여부 (기본: true)
 * @param {string} options.backgroundColor - 배경색 오버라이드
 * @returns {Object} Chart.js annotation 설정 객체
 */
export function getRecessionAnnotations(chartStart, chartEnd, options = {}) {
  const recessions = getRecessionsInRange(chartStart, chartEnd);
  const showLabel = options.showLabel !== false;

  const annotations = {};

  recessions.forEach((r, idx) => {
    annotations[`recession_${idx}`] = {
      type: 'box',
      xMin: r.start,
      xMax: r.end,
      backgroundColor: options.backgroundColor || RECESSION_STYLE.backgroundColor,
      borderColor: RECESSION_STYLE.borderColor,
      borderWidth: RECESSION_STYLE.borderWidth,
      borderDash: RECESSION_STYLE.borderDash,
      label: showLabel ? {
        ...RECESSION_STYLE.label,
        content: r.label
      } : { display: false }
    };
  });

  return annotations;
}

/**
 * 기존 annotation 객체에 리세션 추가
 * @param {Object} existingAnnotations - 기존 annotation 객체
 * @param {string|Date} chartStart - 차트 시작일
 * @param {string|Date} chartEnd - 차트 종료일
 * @param {Object} options - 추가 옵션
 * @returns {Object} 병합된 annotation 설정 객체
 */
export function mergeRecessionAnnotations(existingAnnotations, chartStart, chartEnd, options = {}) {
  const recessionAnnotations = getRecessionAnnotations(chartStart, chartEnd, options);
  return {
    ...existingAnnotations,
    ...recessionAnnotations
  };
}

/**
 * 데이터 배열에서 날짜 범위 추출
 * @param {Array} data - Chart.js 데이터 배열 [{x: date, y: value}, ...]
 * @returns {Object} { start, end }
 */
export function getDateRangeFromData(data) {
  if (!data || data.length === 0) {
    return { start: null, end: null };
  }

  const dates = data.map(d => new Date(d.x || d.date || d.t)).filter(d => !isNaN(d));
  if (dates.length === 0) {
    return { start: null, end: null };
  }

  const sorted = dates.sort((a, b) => a - b);
  return {
    start: sorted[0].toISOString().split('T')[0],
    end: sorted[sorted.length - 1].toISOString().split('T')[0]
  };
}
