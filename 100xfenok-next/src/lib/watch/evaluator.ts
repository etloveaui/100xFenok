import type { DashboardSnapshot } from "@/lib/dashboard/types";
import { metricByKey } from "./metrics";
import type { Alert, Watch, WatchOp } from "./types";

/** Alerts older than this window allow the watch to re-fire. */
const REFIRE_COOLDOWN_MS = 60 * 60 * 1000; // 60 minutes

function check(observed: number, op: WatchOp, threshold: number): boolean {
  if (op === ">") return observed > threshold;
  if (op === ">=") return observed >= threshold;
  if (op === "<") return observed < threshold;
  if (op === "<=") return observed <= threshold;
  return Math.abs(observed - threshold) < 1e-9;
}

/**
 * Evaluate every watch against the current snapshot. De-duplication is
 * keyed on **persisted alerts**, not an in-memory Set, so a page reload
 * no longer double-fires a watch that already triggered earlier in the
 * same hour. Audit finding (code-reviewer + silent-failure-hunter,
 * 2026-05-12).
 *
 * - `recentAlerts`: subset of `alerts` from useWatchStorage. The caller
 *   should pass alerts within the last hour (or the whole list — old
 *   alerts auto-fall outside the cooldown by `firedAt` comparison).
 */
export function evaluateWatches(
  snapshot: DashboardSnapshot,
  watches: Watch[],
  recentAlerts: Alert[],
): Alert[] {
  if (watches.length === 0) return [];
  const now = Date.now();
  const recentByWatch = new Map<string, number>();
  for (const alert of recentAlerts) {
    const t = Date.parse(alert.firedAt);
    if (Number.isNaN(t)) continue;
    if (now - t > REFIRE_COOLDOWN_MS) continue;
    const prev = recentByWatch.get(alert.watchId) ?? 0;
    if (t > prev) recentByWatch.set(alert.watchId, t);
  }

  // Intra-batch dedup: a watch only fires once per evaluate() call.
  const firedInBatch = new Set<string>();
  const fired: Alert[] = [];
  for (const watch of watches) {
    if (firedInBatch.has(watch.id)) continue;
    if (recentByWatch.has(watch.id)) continue; // cooled down
    const def = metricByKey(watch.metric);
    if (!def) continue;
    const observed = def.get(snapshot);
    if (observed == null || Number.isNaN(observed)) continue;
    if (!check(observed, watch.op, watch.threshold)) continue;
    firedInBatch.add(watch.id);
    fired.push({
      id: `${watch.id}-${now}`,
      watchId: watch.id,
      metric: watch.metric,
      op: watch.op,
      threshold: watch.threshold,
      observed,
      firedAt: new Date(now).toISOString(),
      read: false,
    });
  }
  return fired;
}
