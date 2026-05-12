import type { DashboardSnapshot } from "@/lib/dashboard/types";
import { metricByKey } from "./metrics";
import type { Alert, Watch, WatchOp } from "./types";

function check(observed: number, op: WatchOp, threshold: number): boolean {
  if (op === ">") return observed > threshold;
  if (op === ">=") return observed >= threshold;
  if (op === "<") return observed < threshold;
  if (op === "<=") return observed <= threshold;
  return Math.abs(observed - threshold) < 1e-9;
}

/**
 * Evaluate every watch against the current snapshot. Returns the alerts
 * that newly fired (caller is responsible for de-duping vs previously
 * fired alerts in localStorage — usually by watchId + last-fire-time).
 */
export function evaluateWatches(
  snapshot: DashboardSnapshot,
  watches: Watch[],
  alreadyFiredWatchIds: Set<string>,
): Alert[] {
  const fired: Alert[] = [];
  for (const watch of watches) {
    if (alreadyFiredWatchIds.has(watch.id)) continue;
    const def = metricByKey(watch.metric);
    if (!def) continue;
    const observed = def.get(snapshot);
    if (observed == null || Number.isNaN(observed)) continue;
    if (!check(observed, watch.op, watch.threshold)) continue;
    fired.push({
      id: `${watch.id}-${Date.now()}`,
      watchId: watch.id,
      metric: watch.metric,
      op: watch.op,
      threshold: watch.threshold,
      observed,
      firedAt: new Date().toISOString(),
      read: false,
    });
  }
  return fired;
}
