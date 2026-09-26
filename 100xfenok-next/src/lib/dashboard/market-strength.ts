import { clamp, getRegimeLabel } from "./formatters";
import type { DashboardSnapshot } from "./types";

/**
 * Fenok Edge "시장 체력": a short-term blend of sentiment (Fear & Greed, 45%),
 * one-day sector breadth (35%) and credit/banking stress relief (20%).
 *
 * It is not the 시황 composite on /regime (17 pulses over four axes), and it
 * must not be labelled 시황: the two read different inputs and can disagree
 * (2026-09-25: 체력 47 중립 while the composite read 71 양호). Home and
 * /changes share this one computation so a visit diff can never compare two
 * different formulas.
 */
export const MARKET_STRENGTH_NAME = "시장 체력";

export type MarketStrength = {
  /** 위험 선호 / 중립 / 방어 */
  label: string;
  /** 0-100 */
  confidence: number;
  /** Share of sectors up, 0-100. */
  breadth: number;
};

export function marketStrength(
  dashboard: Pick<DashboardSnapshot, "sectorRows" | "sectorUp" | "fearGreedScore" | "stressScore">,
): MarketStrength {
  const breadthTotal = Math.max(dashboard.sectorRows.length, 1);
  const breadthRatio = dashboard.sectorUp / breadthTotal;
  const score = clamp(
    (dashboard.fearGreedScore / 100) * 0.45 + breadthRatio * 0.35 + (1 - dashboard.stressScore) * 0.2,
    0,
    1,
  );
  return {
    label: getRegimeLabel(score),
    confidence: Math.round(score * 100),
    breadth: Math.round(breadthRatio * 100),
  };
}
