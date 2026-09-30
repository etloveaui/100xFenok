/**
 * Side-effect-free public projector for the data health KPI runtime block.
 *
 * projectPublicKpi(rootDoc, nowIso) returns a deep copy of rootDoc with the
 * runtime block reduced to a public allowlist and freshness flags evaluated at
 * nowIso. Admin-only per-file recovery provenance is reduced to public-safe
 * lane/count/retry summaries; generic natural-recovery rows use an explicit
 * field allowlist. Other non-runtime shape passes through unchanged.
 *
 * sync-static-overrides applies this allowlist after copying the canonical
 * data tree. Projection remains a pure function of (rootDoc, nowIso).
 */

import { PUBLIC_RUNTIME_DENY_KEYS } from "./kpi-contract-constants.mjs";
import { classifyRuntimeSlotRecoveries, classifyRuntimeSlots } from "./kpi-runtime-slots.mjs";
import { LANE_REGISTRY } from "./lane-registry.mjs";

export const PUBLIC_PROJECTION_VERSION = "kpi_runtime_projection.v2";

// Canonical deny-key list lives in kpi-contract-constants.mjs; re-exported here
// for existing importers of the projection module.
export { PUBLIC_RUNTIME_DENY_KEYS };

const PUBLIC_PRE_ACTIVATION_LANE_IDS = new Set(
  LANE_REGISTRY.lanes
    .filter((lane) => lane.public_mirror_allowed !== false)
    .map((lane) => lane.id),
);

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

// Public summaries accept only named scalar fields, never nested private state.
function publicScalars(row, fields) {
  return Object.fromEntries(fields.filter((key) => Object.hasOwn(row ?? {}, key)
    && (row[key] === null || ["string", "number", "boolean"].includes(typeof row[key])))
    .map((key) => [key, row[key]]));
}

function publicStrings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

const COUNT_FIELDS = ["keys", "tracked", "active", "eligible", "untracked", "pending_acquisition",
  "fresh", "lkg", "pending_history", "unavailable", "terminal", "retry", "failed", "stale"];
const RESULT_FIELDS = ["attempted", "successes", "failed", "skipped", "fetch_attempts"];
const FAILURE_FIELDS = ["key", "ticker", "symbol", "artifact_kind", "entity", "observed_at",
  "failure_observed_at", "failure_kind", "reason", "error", "scope", "data_loss"];

function publicCounts(row, fields = COUNT_FIELDS) {
  return Object.fromEntries(fields.filter((key) => Number.isFinite(row?.[key]) && row[key] >= 0)
    .map((key) => [key, row[key]]));
}

function publicResults(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  return {
    ...publicCounts(row, RESULT_FIELDS),
    errors: (Array.isArray(row.errors) ? row.errors : [])
      .map((error) => publicScalars(error, FAILURE_FIELDS)),
  };
}

function projectLaneRecoveryDetails(doc) {
  for (const lane of Array.isArray(doc?.lanes) ? doc.lanes : []) {
    const details = lane?.details;
    if (!details || typeof details !== "object" || Array.isArray(details)) continue;
    delete details.last_attempt;
    if (details.last_result && typeof details.last_result === "object") {
      details.last_result = publicScalars(details.last_result,
        ["observed_at", "outcome", "failure_class", "attempts_used", "latency_ms", "error"]);
    }
    if (Array.isArray(details.recovery_recovered)) {
      details.recovery_recovered = details.recovery_recovered.map((row) => publicScalars(row,
        ["key", "resolution_state", "retry", "recovered_at", "lkg_source_as_of", "source_as_of"]));
    }
    const recovery = details.recovery;
    if (!recovery || typeof recovery !== "object" || Array.isArray(recovery)) continue;
    if (recovery.lane_id === "slickcharts" && typeof recovery.composite_state === "string") {
      details.recovery = {
        lane_id: "slickcharts",
        ...publicScalars(recovery, ["generated_at", "composite_state"]),
        members: Object.fromEntries(["daily", "weekly", "monthly", "history", "symbols"]
          .filter((member) => recovery.members?.[member])
          .map((member) => [member, {
          ...publicScalars(recovery.members[member], ["resolution_state", "retry", "source_as_of"]),
          ...publicCounts(recovery.members[member].bundle, ["file_count"]),
          last_failure: recovery.members[member].last_failure
            ? publicScalars(recovery.members[member].last_failure, FAILURE_FIELDS) : null,
        }])),
        retry_members: publicStrings(recovery.retry_members)
          .filter((member) => ["daily", "weekly", "monthly", "history", "symbols"].includes(member)),
        current_attempt: recovery.current_attempt
          ? publicScalars(recovery.current_attempt, ["observed_at", "member_id", "decision"])
          : null,
      };
      continue;
    }
    details.recovery = {
      ...publicScalars(recovery, ["lane_id", "generated_at", "oldest_source_as_of", "oldest_source_ticker"]),
      keys: publicStrings(recovery.keys),
      counts: publicCounts(recovery.counts),
      retry_keys: publicStrings(recovery.retry_keys),
      ...(Array.isArray(recovery.retry_symbols) ? { retry_symbols: publicStrings(recovery.retry_symbols) } : {}),
      ...(Array.isArray(recovery.retry_artifacts) ? { retry_artifacts: recovery.retry_artifacts
        .map((row) => publicScalars(row, ["artifact_kind", "entity"])) } : {}),
      ...(Array.isArray(recovery.lkg_details) ? { lkg_details: recovery.lkg_details
        .map((row) => publicScalars(row, ["key", "symbol", "source_as_of", "failure_observed_at",
          "failure_kind", "retry", "source_age_business_days"])) } : {}),
      ...(Array.isArray(recovery.degraded_details) ? { degraded_details: recovery.degraded_details
        .map((row) => publicScalars(row, [...FAILURE_FIELDS, "resolution_state", "source_as_of", "failure_count"])) } : {}),
      ...(recovery.latest_failure ? { latest_failure: publicScalars(recovery.latest_failure, FAILURE_FIELDS) } : {}),
      ...(recovery.current_results ? { current_results: publicResults(recovery.current_results) } : {}),
      // Producer LKG indexes still carry real attempt counts. Yahoo and
      // StockAnalysis now expose current_results, with no run-credit state.
      ...(!recovery.current_results && recovery.current_attempt ? { current_attempt: {
        ...publicScalars(recovery.current_attempt, ["observed_at"]),
        ...publicCounts(recovery.current_attempt, RESULT_FIELDS),
        failed_keys: publicStrings(recovery.current_attempt.failed_keys),
      } } : {}),
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
  const preActivationMembers = Array.isArray(diagnostic?.pre_activation_members)
    ? diagnostic.pre_activation_members
    : [];
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
    pre_activation_lane_ids: [...new Set(preActivationMembers
      .filter((row) => typeof row?.lane_id === "string"
        && PUBLIC_PRE_ACTIVATION_LANE_IDS.has(row.lane_id))
      .map((row) => row.lane_id))].sort(),
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
