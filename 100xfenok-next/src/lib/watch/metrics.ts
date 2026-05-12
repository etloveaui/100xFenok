import type { DashboardSnapshot } from "@/lib/dashboard/types";
import type { MetricDef, WatchableMetric } from "./types";

function spy(s: DashboardSnapshot): number | null {
  return s.quickIndices.find((q) => q.symbol === "SPY")?.price ?? null;
}
function qqq(s: DashboardSnapshot): number | null {
  return s.quickIndices.find((q) => q.symbol === "QQQ")?.price ?? null;
}

export const METRIC_DEFS: MetricDef[] = [
  { k: "VIX", label: "VIX", unit: "", get: (s) => s.vixValue },
  { k: "FG", label: "F&G", unit: "", get: (s) => s.fearGreedScore },
  { k: "SOFR", label: "SOFR", unit: "%", get: () => null }, // not in snapshot yet
  { k: "HY", label: "HY OAS", unit: "%", get: (s) => s.hySpread },
  { k: "SPY", label: "SPY", unit: "$", get: spy },
  { k: "QQQ", label: "QQQ", unit: "$", get: qqq },
  { k: "US10Y", label: "US 10Y", unit: "%", get: (s) => s.tenYearYield },
  { k: "BTC", label: "BTC", unit: "$", get: () => null },
  { k: "CRYPTOFG", label: "Crypto F&G", unit: "", get: (s) => s.cryptoFearGreed },
];

export function metricByKey(key: WatchableMetric): MetricDef | undefined {
  return METRIC_DEFS.find((m) => m.k === key);
}

export const PRESET_WATCHES: Array<{
  metric: WatchableMetric;
  op: ">" | ">=" | "<" | "<=";
  threshold: number;
  hint: string;
}> = [
  { metric: "VIX", op: ">", threshold: 25, hint: "VIX 25 돌파 (변동성 급등)" },
  { metric: "FG", op: "<", threshold: 30, hint: "F&G 30 하회 (극도 공포)" },
  { metric: "FG", op: ">=", threshold: 80, hint: "F&G 80 이상 (극도 탐욕)" },
  { metric: "SOFR", op: ">", threshold: 5, hint: "SOFR 5% 돌파" },
  { metric: "HY", op: ">", threshold: 4, hint: "HY OAS 4% 돌파 (크레딧 스트레스)" },
];
