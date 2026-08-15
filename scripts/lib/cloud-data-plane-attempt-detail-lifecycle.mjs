import { ATTEMPT_DETAIL_PREFIX } from "./cloud-data-plane-attempt-record.mjs";

export const ATTEMPT_DETAIL_PLAN_SCHEMA = "cloud-data-plane-attempt-detail-plan/v1";
export const TERMINAL_STATES = Object.freeze(["promoted", "swept", "abandoned"]);

function fail(message) {
  throw new Error(`cloud-data-plane attempt detail lifecycle: ${message}`);
}

function instantMs(value, context) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail(`${context} must be a parsable instant`);
  return Date.parse(value);
}

/**
 * Plan the removal of attempt-detail blobs.
 *
 * A sibling authority, not an extension of payload retention. Three boundaries
 * make that real rather than declared:
 *
 * - its candidate set is drawn only from keys under `attempts/`, so it is
 *   structurally incapable of proposing an `objects/` or `manifests/` key;
 * - it consumes the SAME read-only listing payload retention already performs,
 *   because a second full-bucket scan would double a list cost we have already
 *   recorded as growing;
 * - it plans; deletion is the caller's, and dry-run is the default shape of the
 *   result rather than a mode of it.
 *
 * Fail-closed on both axes you can be wrong about: an attempt whose terminal
 * state is unknown is never a candidate, and a retention window that was not
 * supplied is refused rather than assumed. Deleting a detail whose attempt is
 * still open would destroy the only enumeration of that attempt's written keys.
 */
export function computeAttemptDetailPlan({
  objectEntries,
  resolutions,
  now,
  retentionSeconds,
} = {}) {
  if (!Array.isArray(objectEntries)) fail("objectEntries must be the shared bucket listing");
  if (!Array.isArray(resolutions)) fail("resolutions must be an array");
  if (!Number.isFinite(retentionSeconds) || retentionSeconds < 0) {
    fail("retentionSeconds is required and must be non-negative; refusing to guess a detail retention window");
  }
  const nowMs = instantMs(now, "now");

  const byKey = new Map();
  for (const row of resolutions) {
    const key = row?.detail_location;
    if (typeof key !== "string" || !key.startsWith(`${ATTEMPT_DETAIL_PREFIX}/`)) {
      fail(`a resolution names ${key}, which is not an attempt-detail key`);
    }
    if (!TERMINAL_STATES.includes(row.terminal_state)) {
      fail(`resolution for ${key} has a non-terminal or unknown state: ${row.terminal_state}`);
    }
    instantMs(row.resolved_at, `resolution for ${key} resolved_at`);
    if (byKey.has(key)) fail(`two resolutions name the same detail key: ${key}`);
    byKey.set(key, row);
  }

  const candidates = [];
  const retained = [];
  const unresolved = [];
  for (const entry of objectEntries) {
    const key = entry?.key;
    if (typeof key !== "string") fail("a listing entry has no key");
    // The structural boundary: anything outside the attempts prefix is not this
    // authority's business and is not even examined.
    if (!key.startsWith(`${ATTEMPT_DETAIL_PREFIX}/`)) continue;

    const resolution = byKey.get(key);
    if (!resolution) {
      // No terminal record means the attempt may still be open. Its detail is
      // the only enumeration of what it wrote, so it is kept and reported.
      unresolved.push({ key, size: entry.size ?? null, reason: "no terminal resolution recorded" });
      continue;
    }
    const ageSeconds = (nowMs - Date.parse(resolution.resolved_at)) / 1000;
    if (ageSeconds < 0) {
      // A resolution in the future is a clock fault; retain rather than delete.
      retained.push({ key, size: entry.size ?? null, reason: "resolved_at is in the future", terminal_state: resolution.terminal_state });
      continue;
    }
    if (ageSeconds < retentionSeconds) {
      retained.push({ key, size: entry.size ?? null, reason: "inside the retention window", terminal_state: resolution.terminal_state, age_seconds: Math.floor(ageSeconds) });
      continue;
    }
    candidates.push({
      key,
      size: entry.size ?? null,
      terminal_state: resolution.terminal_state,
      resolved_at: resolution.resolved_at,
      age_seconds: Math.floor(ageSeconds),
    });
  }

  const sortByKey = (left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  candidates.sort(sortByKey);
  retained.sort(sortByKey);
  unresolved.sort(sortByKey);

  return {
    schema_version: ATTEMPT_DETAIL_PLAN_SCHEMA,
    authority: "attempt_detail",
    evaluated_at: now,
    retention_seconds: retentionSeconds,
    // Named so a reader never has to infer the boundary from the key list.
    scope_prefix: `${ATTEMPT_DETAIL_PREFIX}/`,
    candidates,
    candidate_bytes: candidates.reduce((total, row) => total + (row.size ?? 0), 0),
    retained,
    unresolved,
  };
}

/**
 * Execute a plan through an injected deleter.
 *
 * Re-checks the prefix on every key immediately before deleting. The planner
 * already guarantees it, which is exactly why the check is cheap and worth
 * keeping: a plan that has been serialised, stored and handed back is no longer
 * the object the planner returned.
 */
export async function executeAttemptDetailPlan({ plan, deleteObject } = {}) {
  if (plan?.schema_version !== ATTEMPT_DETAIL_PLAN_SCHEMA) fail(`plan schema must be ${ATTEMPT_DETAIL_PLAN_SCHEMA}`);
  if (typeof deleteObject !== "function") fail("a deleter is required");
  const deleted = [];
  const failures = [];
  for (const candidate of plan.candidates) {
    if (!candidate.key.startsWith(`${ATTEMPT_DETAIL_PREFIX}/`)) {
      fail(`refusing to delete ${candidate.key}: outside the attempt-detail authority`);
    }
    const outcome = await deleteObject(candidate.key);
    // A delete failure is recorded, never thrown: one unreachable key must not
    // strand the rest of the batch, and the same rule already governs payload
    // retention's deleter.
    if (outcome?.ok) deleted.push({ key: candidate.key, size: candidate.size ?? null });
    else failures.push({ key: candidate.key, error: outcome?.error ?? "delete failed" });
  }
  return { deleted, failures, deleted_bytes: deleted.reduce((total, row) => total + (row.size ?? 0), 0) };
}
