/**
 * Side-effect-free public projector for the data health KPI runtime block.
 *
 * projectPublicKpi(rootDoc, nowIso) returns a deep copy of rootDoc with the
 * runtime block reduced to a public allowlist and freshness flags evaluated at
 * nowIso. Admin-only per-file recovery provenance is reduced to public-safe
 * lane/count/retry summaries. Other non-runtime shape passes through unchanged.
 *
 * Consumers (contract §4): the builder's public-mirror write, sync-static-overrides
 * post-copy, and the checker's equality recompute. All three must agree, so the
 * projection must be a pure function of (rootDoc, nowIso).
 */

import { PUBLIC_RUNTIME_DENY_KEYS } from "./kpi-contract-constants.mjs";
import { classifyRuntimeSlots } from "./kpi-runtime-slots.mjs";

export const PUBLIC_PROJECTION_VERSION = "kpi_runtime_projection.v2";

// Canonical deny-key list lives in kpi-contract-constants.mjs; re-exported here
// for existing importers of the projection module.
export { PUBLIC_RUNTIME_DENY_KEYS };

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function projectLaneRecoveryDetails(doc) {
  for (const lane of Array.isArray(doc?.lanes) ? doc.lanes : []) {
    const recovery = lane?.details?.recovery;
    if (!recovery || typeof recovery !== "object" || Array.isArray(recovery)) continue;
    lane.details.recovery = {
      lane_id: recovery.lane_id ?? null,
      generated_at: recovery.generated_at ?? null,
      keys: Array.isArray(recovery.keys) ? recovery.keys : [],
      counts: recovery.counts ?? null,
      retry_keys: Array.isArray(recovery.retry_keys) ? recovery.retry_keys : [],
    };
  }
}

function ageHours(fromIso, nowIso) {
  const from = new Date(fromIso).getTime();
  const now = new Date(nowIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(now)) return null;
  return (now - from) / 3600000;
}

/**
 * Project a root runtime block into the public allowlist evaluated at nowIso.
 * Returns the public runtime object only (allowlist).
 */
export function projectRuntime(runtime, nowIso) {
  const producerContext = runtime && typeof runtime === "object" ? runtime.producer_context : null;
  const cadence = (runtime && typeof runtime === "object" && runtime.cadence) || {};
  const builtAt = producerContext && producerContext.built_at ? producerContext.built_at : null;
  const hardMaxAgeHours = Number(cadence.hard_max_age_hours);
  const slotClassification = classifyRuntimeSlots(runtime);
  const missedSlotCount = slotClassification.missed_slot_keys.length;
  const recoveredMissedSlotCount = slotClassification.recovered_missed_slot_keys.length;
  const unrecoveredMissedSlotCount = slotClassification.unrecovered_missed_slot_keys.length;

  let hardAgeOk = false;
  if (builtAt && Number.isFinite(hardMaxAgeHours)) {
    const age = ageHours(builtAt, nowIso);
    hardAgeOk = age != null && age <= hardMaxAgeHours;
  }
  const slotStatus = slotClassification.status;
  const verdict = hardAgeOk ? slotStatus : "blocked";
  const fresh = hardAgeOk && slotStatus !== "blocked";
  const statusMessage = !hardAgeOk
    ? "Producer timestamp is missing or exceeds the hard-age limit."
    : slotStatus === "ready"
      ? "No retained missed slots; the current producer snapshot is fresh."
      : slotStatus === "degraded"
        ? `${recoveredMissedSlotCount} retained missed slot(s) recovered by later authoritative ready full snapshot(s).`
        : `${unrecoveredMissedSlotCount} retained missed slot(s) have no later authoritative ready full-snapshot recovery.`;

  return {
    projection: PUBLIC_PROJECTION_VERSION,
    built_at: builtAt,
    evaluated_at: nowIso,
    verdict,
    slot_status: slotStatus,
    status_message: statusMessage,
    fresh,
    missed_slot_count: missedSlotCount,
    recovered_missed_slot_count: recoveredMissedSlotCount,
    unrecovered_missed_slot_count: unrecoveredMissedSlotCount,
    hard_age_ok: hardAgeOk,
  };
}

/**
 * Deep-copy rootDoc and replace runtime with its public projection.
 * v1 / runtime-less documents pass through unchanged.
 */
export function projectPublicKpi(rootDoc, nowIso) {
  if (!rootDoc || typeof rootDoc !== "object") return rootDoc;
  const doc = deepClone(rootDoc);
  projectLaneRecoveryDetails(doc);
  if (!("runtime" in doc) || doc.runtime == null) return doc;
  doc.runtime = projectRuntime(doc.runtime, nowIso);
  return doc;
}
