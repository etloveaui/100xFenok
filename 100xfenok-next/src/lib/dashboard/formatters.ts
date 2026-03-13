import type { NumberPoint, QuickIndexSnapshot, StressTone } from './types';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function lastValue(series: NumberPoint[] | undefined, fallback = 0): number {
  if (!Array.isArray(series) || series.length === 0) return fallback;
  return safeNumber(series[series.length - 1]?.value, fallback);
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, item) => acc + item, 0) / values.length;
}

export function formatSignedBillions(value: number): string {
  const absValue = Math.abs(value);
  const precision = absValue >= 100 ? 0 : 1;
  const prefix = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${prefix}$${absValue.toFixed(precision)}B`;
}

export function formatSignedPercentDecimal(value: number, digits = 2): string {
  const percent = value * 100;
  const prefix = percent > 0 ? '+' : percent < 0 ? '-' : '';
  return `${prefix}${Math.abs(percent).toFixed(digits)}%`;
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function getFearGreedLabel(score: number): string {
  if (score >= 75) return '극단적 탐욕';
  if (score >= 55) return '탐욕';
  if (score >= 45) return '중립';
  if (score >= 25) return '공포';
  return '극단적 공포';
}

export function getVixLabel(value: number): string {
  if (value < 15) return '낮음';
  if (value < 22) return '보통';
  if (value < 30) return '높음';
  return '매우 높음';
}

export function getPutCallLabel(value: number, rating?: string): string {
  if (rating && rating.trim().length > 0) {
    const normalized = rating.trim().toLowerCase();
    if (normalized.includes('greed')) return '탐욕';
    if (normalized.includes('fear')) return '공포';
    if (normalized.includes('neutral')) return '중립';
    return rating.trim();
  }
  if (value < 0.7) return '탐욕';
  if (value <= 1) return '중립';
  return '공포';
}

export function getCryptoLabel(label?: string | null): string {
  const normalized = (label || '').trim().toLowerCase();
  if (normalized.includes('extreme fear')) return '극단적 공포';
  if (normalized.includes('fear')) return '공포';
  if (normalized.includes('neutral')) return '중립';
  if (normalized.includes('greed')) return '탐욕';
  return label?.trim() || '중립';
}

export function getStressTone(score: number): StressTone {
  if (score < 0.33) return 'low';
  if (score < 0.66) return 'medium';
  return 'high';
}

export function getMarketStateMeta(marketState: string | null): { label: string; className: string } | null {
  if (!marketState) return null;
  if (marketState.includes('REGULAR')) return { label: 'LIVE', className: 'state-regular' };
  if (marketState.includes('PRE')) return { label: 'PRE', className: 'state-pre' };
  if (marketState.includes('POST')) return { label: 'POST', className: 'state-post' };
  if (marketState.includes('CLOSED')) return { label: 'CLOSED', className: 'state-closed' };
  return null;
}

export function getRegimeLabel(score: number): string {
  if (score >= 0.62) return '위험 선호';
  if (score >= 0.45) return '중립';
  return '방어';
}

export function getRegimeClass(score: number): string {
  if (score >= 0.62) return 'is-risk-on';
  if (score >= 0.45) return 'is-balanced';
  return 'is-risk-off';
}

export function quickIndexDetail(item: QuickIndexSnapshot): string {
  if (item.price === null) return '기본 데이터';
  return item.displayHorizon === '1D' ? `$${item.price.toFixed(2)} · 당일` : `$${item.price.toFixed(2)}`;
}
