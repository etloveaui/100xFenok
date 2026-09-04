import { edgeAxisSpokeLabel } from "@/lib/fenok-signals/edge-axis-labels.mjs";
import type { ScreenerStock } from "./types";

type EdgeDriverAxis = {
  scoreKey: keyof ScreenerStock;
  invertScore?: boolean;
  referenceOnly?: boolean;
};

// Mirrors the drawer's axis tables (StockDetailPanel
// DETAIL_LONG_TERM_AXIS_CONFIG / DETAIL_SHORT_TERM_AXIS_CONFIG): the same ten
// scored axes, the same two reference-only exclusions (장외·동종군), and the
// same 100−x inversion for 하락압력·숏압력. Labels come from the shared
// edge-axis-labels map — never restated here.
const EDGE_DRIVER_AXES: readonly EdgeDriverAxis[] = [
  { scoreKey: "profitabilityScore" },
  { scoreKey: "growthScore" },
  { scoreKey: "upsidePotentialScore" },
  { scoreKey: "downsidePressureScore", invertScore: true },
  { scoreKey: "durabilityProfitabilityScore" },
  { scoreKey: "technicalFlowScore" },
  { scoreKey: "volumeLiquidityTrendScore" },
  { scoreKey: "shortTermRelativeStrengthScore" },
  { scoreKey: "netOptionsProxyScore" },
  { scoreKey: "shortPressureProxyScore", invertScore: true },
];

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export interface EdgeDriver {
  label: string;
  score: number;
}

export function topEdgeDrivers(stock: ScreenerStock, limit = 2): EdgeDriver[] {
  return EDGE_DRIVER_AXES.map((axis) => {
    const raw = stock[axis.scoreKey];
    if (!finiteNumber(raw)) return null;
    const score = axis.invertScore ? Math.max(0, Math.min(100, 100 - raw)) : raw;
    const label = edgeAxisSpokeLabel(axis.scoreKey);
    if (label === null) return null;
    return { label, score: Math.round(score) };
  })
    .filter((driver): driver is EdgeDriver => driver !== null)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

/** "성장 82 · 수익성 76" — the top two scored axes, drawer-identical values. */
export function formatEdgeDrivers(stock: ScreenerStock): string | null {
  const drivers = topEdgeDrivers(stock);
  if (drivers.length === 0) return null;
  return drivers.map((driver) => `${driver.label} ${driver.score}`).join(" · ");
}
