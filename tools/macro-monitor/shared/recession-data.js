/**
 * 100x Market Radar - NBER 리세션 데이터
 * @version 1.0.0
 * @description 미국 경기침체 기간 (NBER 공식 기준)
 * @see https://www.nber.org/research/data/us-business-cycle-expansions-and-contractions
 */

// ============================================
// NBER 공식 리세션 기간
// ============================================
export const RECESSIONS = Object.freeze([
  // 1980년대 이후 주요 리세션
  { start: '1981-07-01', end: '1982-11-30', label: 'Early 80s' },
  { start: '1990-07-01', end: '1991-03-31', label: 'Gulf War' },
  { start: '2001-03-01', end: '2001-11-30', label: 'Dot-com' },
  { start: '2007-12-01', end: '2009-06-30', label: 'GFC' },
  { start: '2020-02-01', end: '2020-04-30', label: 'COVID' },
]);

// ============================================
// 리세션 필터링 함수
// ============================================

/**
 * 차트 범위 내 리세션만 필터링
 * @param {string|Date} chartStart - 차트 시작일
 * @param {string|Date} chartEnd - 차트 종료일
 * @returns {Array} 범위 내 리세션 배열
 */
export function getRecessionsInRange(chartStart, chartEnd) {
  const start = new Date(chartStart);
  const end = new Date(chartEnd);

  return RECESSIONS.filter(r => {
    const rStart = new Date(r.start);
    const rEnd = new Date(r.end);
    // 차트 범위와 리세션 기간이 겹치는지 확인
    return rStart <= end && rEnd >= start;
  }).map(r => {
    // 차트 범위에 맞게 클리핑
    const rStart = new Date(r.start);
    const rEnd = new Date(r.end);
    return {
      start: rStart < start ? start.toISOString().split('T')[0] : r.start,
      end: rEnd > end ? end.toISOString().split('T')[0] : r.end,
      label: r.label
    };
  });
}
