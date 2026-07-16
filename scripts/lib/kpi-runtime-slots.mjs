import { TRACKED_CRONS } from "./kpi-contract-constants.mjs";

const DEFERRAL_KEYS = Object.freeze([
  "declared_at",
  "declared_by",
  "expires_at",
  "reason",
  "slot_key",
]);

// Only an unrecovered miss in one of these full-snapshot workflows is a platform
// integrity block. Other tracked workflows are incremental/owner-gated lanes:
// their miss stays named as lane-local degradation until that same workflow_file
// later produces a satisfied slot and a ready authoritative KPI snapshot.
export const FULL_SNAPSHOT_RECOVERY_WORKFLOWS = Object.freeze({
  "update-manifest.yml": "Update Manifest",
});

const KPI_SNAPSHOT_WORKFLOW = "Update Manifest";

function parseDow(dow) {
  if (dow === "*") return null;
  const range = String(dow).match(/^(\d)-(\d)$/);
  if (range) {
    const out = new Set();
    for (let day = Number(range[1]); day <= Number(range[2]); day += 1) out.add(day % 7);
    return out;
  }
  return new Set(String(dow).split(",").map((value) => Number(value) % 7));
}

function parseCron(cron) {
  const [minute, hour, , , dow] = String(cron).trim().split(/\s+/);
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour) || dow == null) return null;
  return { minute: Number(minute), hour: Number(hour), dow: parseDow(dow) };
}

export function parseRuntimeSlotKey(slotKey) {
  if (typeof slotKey !== "string") return null;
  const at = slotKey.lastIndexOf("@");
  const colon = slotKey.indexOf(":");
  if (at <= colon || colon <= 0) return null;
  const workflow_file = slotKey.slice(0, colon);
  const cron = slotKey.slice(colon + 1, at);
  const timestamp = slotKey.slice(at + 1);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(timestamp)) return null;
  const occurrence_ms = new Date(timestamp).getTime();
  if (!Number.isFinite(occurrence_ms)) return null;
  return { workflow_file, cron, timestamp, occurrence_ms };
}

function isCanonicalTrackedSlot(parsed) {
  if (!parsed) return false;
  if (!TRACKED_CRONS.some((row) => row.workflow_file === parsed.workflow_file && row.cron === parsed.cron)) return false;
  const cron = parseCron(parsed.cron);
  if (!cron) return false;
  const occurrence = new Date(parsed.occurrence_ms);
  return occurrence.getUTCMinutes() === cron.minute
    && occurrence.getUTCHours() === cron.hour
    && (!cron.dow || cron.dow.has(occurrence.getUTCDay()));
}

export function validateCronDeferrals(cronDeferrals, { satisfiedSlotKeys = [] } = {}) {
  const errors = [];
  if (!Array.isArray(cronDeferrals)) return ["cron_deferrals must be an array"];
  const seen = new Set();
  const satisfied = new Set(Array.isArray(satisfiedSlotKeys) ? satisfiedSlotKeys : []);

  cronDeferrals.forEach((entry, index) => {
    const path = `cron_deferrals[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${path} must be an object with ${DEFERRAL_KEYS.join(", ")}`);
      return;
    }
    const keys = Object.keys(entry).sort();
    if (JSON.stringify(keys) !== JSON.stringify(DEFERRAL_KEYS)) {
      errors.push(`${path} must have exactly ${DEFERRAL_KEYS.join(", ")}`);
    }
    for (const key of ["slot_key", "reason", "declared_by", "declared_at", "expires_at"]) {
      if (typeof entry[key] !== "string" || entry[key].trim() === "") errors.push(`${path}.${key} must be a non-empty string`);
    }

    const parsed = parseRuntimeSlotKey(entry.slot_key);
    if (!isCanonicalTrackedSlot(parsed)) errors.push(`${path}.slot_key must be a canonical tracked cron occurrence`);
    if (seen.has(entry.slot_key)) errors.push(`${path}.slot_key duplicates ${entry.slot_key}`);
    seen.add(entry.slot_key);
    if (satisfied.has(entry.slot_key)) errors.push(`${path}.slot_key cannot be both satisfied and deferred`);

    const declaredMs = new Date(entry.declared_at).getTime();
    const expiresMs = new Date(entry.expires_at).getTime();
    if (!Number.isFinite(declaredMs)) errors.push(`${path}.declared_at must be a parseable timestamp`);
    if (!Number.isFinite(expiresMs)) errors.push(`${path}.expires_at must be a parseable timestamp`);
    if (parsed && Number.isFinite(declaredMs) && declaredMs >= parsed.occurrence_ms) {
      errors.push(`${path}.declared_at must be strictly before the slot occurrence (post-hoc deferral is forbidden)`);
    }
    if (parsed && Number.isFinite(expiresMs) && expiresMs <= parsed.occurrence_ms) {
      errors.push(`${path}.expires_at must be after the slot occurrence`);
    }
    if (Number.isFinite(declaredMs) && Number.isFinite(expiresMs) && expiresMs <= declaredMs) {
      errors.push(`${path}.expires_at must be after declared_at`);
    }
  });
  return errors;
}

export function assertValidCronDeferrals(cronDeferrals, options) {
  const errors = validateCronDeferrals(cronDeferrals, options);
  if (errors.length) throw new Error(`invalid cron_deferrals: ${errors.join("; ")}`);
}

function recoveryForMiss(miss, history, satisfied) {
  const parsedMiss = parseRuntimeSlotKey(miss);
  if (!parsedMiss) return null;
  return history.find((entry) => {
    const parsedRecovery = parseRuntimeSlotKey(entry?.slot_key);
    const builtAtMs = new Date(entry?.built_at).getTime();
    return isCanonicalTrackedSlot(parsedRecovery)
      && parsedRecovery.workflow_file === parsedMiss.workflow_file
      && parsedRecovery.occurrence_ms > parsedMiss.occurrence_ms
      && satisfied.has(entry.slot_key)
      && Number.isFinite(builtAtMs)
      && builtAtMs > parsedMiss.occurrence_ms
      && entry?.workflow === KPI_SNAPSHOT_WORKFLOW
      && entry?.status === "ready"
      && Number(entry?.run_attempt) === 1;
  }) ?? null;
}

export function classifyRuntimeSlots(runtime) {
  const missed = Array.isArray(runtime?.slots?.missed_slot_keys)
    ? [...new Set(runtime.slots.missed_slot_keys)].sort()
    : [];
  const history = Array.isArray(runtime?.successful_snapshot_history)
    ? runtime.successful_snapshot_history
    : [];
  const satisfied = new Set(Array.isArray(runtime?.slots?.satisfied_slot_keys)
    ? runtime.slots.satisfied_slot_keys
    : []);
  const recovered = [];
  const unrecovered = [];
  for (const miss of missed) {
    if (recoveryForMiss(miss, history, satisfied)) recovered.push(miss);
    else unrecovered.push(miss);
  }
  const blockingUnrecovered = unrecovered.filter((miss) => {
    const parsed = parseRuntimeSlotKey(miss);
    return Boolean(parsed && FULL_SNAPSHOT_RECOVERY_WORKFLOWS[parsed.workflow_file]);
  });
  const blockingSet = new Set(blockingUnrecovered);
  const laneLocalUnrecovered = unrecovered.filter((miss) => !blockingSet.has(miss));
  return {
    status: missed.length === 0 ? "ready" : blockingUnrecovered.length > 0 ? "blocked" : "degraded",
    missed_slot_keys: missed,
    recovered_missed_slot_keys: recovered,
    unrecovered_missed_slot_keys: unrecovered,
    blocking_unrecovered_missed_slot_keys: blockingUnrecovered,
    lane_local_unrecovered_missed_slot_keys: laneLocalUnrecovered,
  };
}
