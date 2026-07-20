/**
 * Side-effect-free public projector for the data health KPI runtime block.
 *
 * projectPublicKpi(rootDoc, nowIso) returns a deep copy of rootDoc with the
 * runtime block reduced to a public allowlist and freshness flags evaluated at
 * nowIso. Admin-only per-file recovery provenance is reduced to public-safe
 * lane/count/retry summaries; generic natural-recovery rows use an explicit
 * field allowlist. Other non-runtime shape passes through unchanged.
 *
 * Consumers (contract §4): the builder's public-mirror write, sync-static-overrides
 * post-copy, and the checker's equality recompute. All three must agree, so the
 * projection must be a pure function of (rootDoc, nowIso).
 */

import { PUBLIC_RUNTIME_DENY_KEYS } from "./kpi-contract-constants.mjs";
import { classifyRuntimeSlotRecoveries, classifyRuntimeSlots } from "./kpi-runtime-slots.mjs";

export const PUBLIC_PROJECTION_VERSION = "kpi_runtime_projection.v2";

// Canonical deny-key list lives in kpi-contract-constants.mjs; re-exported here
// for existing importers of the projection module.
export { PUBLIC_RUNTIME_DENY_KEYS };

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function projectLaneRecoveryDetails(doc) {
  for (const lane of Array.isArray(doc?.lanes) ? doc.lanes : []) {
    // #365 P2: last_attempt is public-safe metadata EXCEPT the run_id runtime
    // identity (same policy as recovery.current_attempt) — redact it for the
    // public mirror, leaving event_name + observed_at.
    const lastAttempt = lane?.details?.last_attempt;
    if (lastAttempt && typeof lastAttempt === "object" && !Array.isArray(lastAttempt)) {
      lane.details.last_attempt = {
        event_name: lastAttempt.event_name ?? null,
        observed_at: lastAttempt.observed_at ?? null,
      };
    }
    const recovered = lane?.details?.recovery_recovered;
    if (Array.isArray(recovered)) {
      lane.details.recovery_recovered = recovered.map((row) => ({
        key: row?.key ?? null,
        resolution_state: row?.resolution_state ?? null,
        retry: row?.retry ?? null,
        recovered_from_run_id: row?.recovered_from_run_id ?? null,
        recovery_run_id: row?.recovery_run_id ?? null,
        recovery_run_attempt: row?.recovery_run_attempt ?? null,
        recovery_event_name: row?.recovery_event_name ?? null,
        recovered_at: row?.recovered_at ?? null,
        lkg_source_as_of: row?.lkg_source_as_of ?? null,
        source_as_of: row?.source_as_of ?? null,
      }));
    }
    const recovery = lane?.details?.recovery;
    if (!recovery || typeof recovery !== "object" || Array.isArray(recovery)) continue;
    lane.details.recovery = {
      lane_id: recovery.lane_id ?? null,
      generated_at: recovery.generated_at ?? null,
      keys: Array.isArray(recovery.keys) ? recovery.keys : [],
      counts: recovery.counts ?? null,
      retry_keys: Array.isArray(recovery.retry_keys) ? recovery.retry_keys : [],
      promotion_deferral_details: Array.isArray(recovery.promotion_deferral_details)
        ? recovery.promotion_deferral_details.map((row) => ({
            key: row?.key ?? null,
            event_name: row?.event_name ?? null,
            observed_at: row?.observed_at ?? null,
            source_as_of: row?.source_as_of ?? null,
            reason: row?.reason ?? null,
          }))
        : [],
      current_attempt: recovery.current_attempt ? {
        event_name: recovery.current_attempt.event_name ?? null,
        observed_at: recovery.current_attempt.observed_at ?? null,
        promotion_deferrals: recovery.current_attempt.promotion_deferrals ?? 0,
        promotion_deferral_keys: Array.isArray(recovery.current_attempt.promotion_deferral_keys)
          ? recovery.current_attempt.promotion_deferral_keys
          : [],
      } : null,
    };
  }
}

function ageHours(fromIso, nowIso) {
  const from = new Date(fromIso).getTime();
  const now = new Date(nowIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(now)) return null;
  return (now - from) / 3600000;
}

function projectFetchCronSkipDetection(diagnostic) {
  const rows = Array.isArray(diagnostic?.rows) ? diagnostic.rows : [];
  const laneIds = (state) => [...new Set(rows
    .filter((row) => row?.state === state && typeof row?.lane_id === "string")
    .map((row) => row.lane_id))].sort();
  return {
    schema_version: diagnostic?.schema_version ?? null,
    mode: diagnostic?.mode ?? null,
    evaluated_at: diagnostic?.evaluated_at ?? null,
    status: diagnostic?.status ?? null,
    deployment_blocking: diagnostic?.deployment_blocking === true,
    counts: deepClone(diagnostic?.counts ?? null),
    suspected_skip_lane_ids: laneIds("suspected_skip"),
    attempt_gap_lane_ids: laneIds("attempt_gap"),
  };
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
  const recoveryEvidence = classifyRuntimeSlotRecoveries(runtime);
  const missedSlotCount = slotClassification.missed_slot_keys.length;
  const recoveredMissedSlotCount = slotClassification.recovered_missed_slot_keys.length;
  const unrecoveredMissedSlotCount = slotClassification.unrecovered_missed_slot_keys.length;
  const blockingUnrecoveredMissedSlotCount = slotClassification.blocking_unrecovered_missed_slot_keys.length;
  const laneLocalUnrecoveredMissedSlotCount = slotClassification.lane_local_unrecovered_missed_slot_keys.length;
  const dispatchRecoveryCount = recoveryEvidence.filter((entry) => entry.recovered_by === "dispatch_snapshot").length;
  const scheduledRecoveryCount = recoveryEvidence.filter((entry) => entry.recovered_by === "scheduled_slot").length;
  const recoverySuffix = dispatchRecoveryCount > 0
    ? ` Recovery evidence: dispatch_snapshot:${dispatchRecoveryCount}, scheduled_slot:${scheduledRecoveryCount}.`
    : "";

  let hardAgeOk = false;
  if (builtAt && Number.isFinite(hardMaxAgeHours)) {
    const age = ageHours(builtAt, nowIso);
    hardAgeOk = age != null && age <= hardMaxAgeHours;
  }
  const slotStatus = slotClassification.status;
  const verdict = hardAgeOk ? slotStatus : "blocked";
  const fresh = hardAgeOk && slotStatus !== "blocked";
  const publicationHalted = slotStatus === "blocked";
  const statusMessage = !hardAgeOk
    ? "Producer timestamp is missing or exceeds the hard-age limit."
    : slotStatus === "ready"
      ? "No retained missed slots; the current producer snapshot is fresh."
      : slotStatus === "degraded"
        ? laneLocalUnrecoveredMissedSlotCount > 0
          ? `${laneLocalUnrecoveredMissedSlotCount} retained missed slot(s) remain lane-local degradation for incremental/owner-gated workflow(s); deployment_blocking:false.${recoveredMissedSlotCount > 0 ? ` ${recoveredMissedSlotCount} other retained miss(es) recovered.${recoverySuffix}` : ""}`
          : `${recoveredMissedSlotCount} retained missed slot(s) recovered by later authoritative ready full snapshot(s).${recoverySuffix}`
        : `Publication halted: ${blockingUnrecoveredMissedSlotCount} retained full-snapshot missed slot(s) have no later authoritative ready recovery.`;

  return {
    projection: PUBLIC_PROJECTION_VERSION,
    built_at: builtAt,
    evaluated_at: nowIso,
    verdict,
    slot_status: slotStatus,
    status_message: statusMessage,
    publication_halted: publicationHalted,
    deployment_blocking: publicationHalted,
    fresh,
    missed_slot_count: missedSlotCount,
    recovered_missed_slot_count: recoveredMissedSlotCount,
    unrecovered_missed_slot_count: unrecoveredMissedSlotCount,
    blocking_unrecovered_missed_slot_count: blockingUnrecoveredMissedSlotCount,
    lane_local_unrecovered_missed_slot_count: laneLocalUnrecoveredMissedSlotCount,
    hard_age_ok: hardAgeOk,
    ...(runtime?.fetch_cron_skip_detection
      ? { fetch_cron_skip_detection: projectFetchCronSkipDetection(runtime.fetch_cron_skip_detection) }
      : {}),
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
