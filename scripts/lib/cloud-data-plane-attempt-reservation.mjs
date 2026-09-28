import { canonicalJson } from "./json-canonical.mjs";
import {
  ATTEMPT_ID_MAX_LENGTH,
  ATTEMPT_LEDGER_BYTE_CEILING,
  buildAttemptAdmission,
  validateAttemptAdmission,
} from "./cloud-data-plane-attempt-record.mjs";

export const ATTEMPT_RESERVATION_SCHEMA = "cloud-data-plane-attempt-reservation/v1";
export const ATTEMPT_COUNTER_SCHEMA = "cloud-data-plane-attempt-counter/v1";
export const RESERVATION_PREFIX = "reservations";

function fail(message) {
  throw new Error(`cloud-data-plane attempt reservation: ${message}`);
}

function requireId(value, context) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]+$/.test(value)) fail(`${context} must be a non-empty safe identifier`);
  if (value.length > ATTEMPT_ID_MAX_LENGTH) {
    fail(`${context} is ${value.length} characters, over the ${ATTEMPT_ID_MAX_LENGTH}-character identifier bound`);
  }
  return value;
}

function instantMs(value, context) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail(`${context} must be a parsable instant`);
  return Date.parse(value);
}

export function counterKey({ family, rotationKey } = {}) {
  return `${RESERVATION_PREFIX}/${requireId(family, "family")}/${requireId(rotationKey, "rotationKey")}`;
}

export function admissionKey({ family, rotationKey, attemptId } = {}) {
  return `${counterKey({ family, rotationKey })}/${requireId(attemptId, "attemptId")}`;
}

/**
 * Admit an attempt and consume one reservation unit, in one transaction.
 *
 * SHAPE: a small counter row plus one row per admission, both written inside a
 * single atomic coordinator transaction. The earlier version kept every
 * reservation in one growing array, which measured out at exactly ONE
 * reservation once identifiers were held to their contract maximum of 128
 * characters — a cap mechanism that only works when identifiers happen to be
 * short is not a bound. Neither row here grows with the cap.
 *
 * The idempotency lookup is a keyed read of the attempt's own row rather than a
 * scan, which is what a coordinator does well anyway.
 *
 * NAMING, because the difference is load-bearing: this counts **admissions**,
 * not failures. At admission time the attempt has no outcome, so the counter
 * bounds how many attempts may be opened in a rotation, over-approximating how
 * many may fail. Nothing is ever released — a successful attempt still holds its
 * unit. A failure-only cap would need a terminal settlement protocol with
 * defined crash semantics, and that is NOT built here.
 *
 * Atomicity is the other half: admission row and counter increment commit
 * together. Two writes would leave a window where an attempt is admitted without
 * being counted, or counted without being admitted, and a crash in that window
 * is the case this whole mechanism exists for.
 */
export async function reserveAttemptAdmission({
  transaction,
  family,
  rotationKey,
  generationId,
  attemptId,
  now,
  admissionReservationCap,
  resumeWindowSeconds,
} = {}) {
  if (typeof transaction !== "function") fail("a transaction function is required; this module performs no I/O on its own");
  requireId(family, "family");
  requireId(rotationKey, "rotationKey");
  const nowMs = instantMs(now, "now");
  // The same window that bounds prepared-receipt protection also bounds how long
  // a reservation stays retryable. One owner number governs both, so they cannot
  // drift into disagreement — a reservation outliving its resumability would
  // refuse a legitimate new attempt id forever.
  if (!Number.isFinite(resumeWindowSeconds) || resumeWindowSeconds <= 0) {
    fail("resumeWindowSeconds is required and must be positive; reservation retryability is bound to the resume window");
  }
  // Owner policy with no default. An absent cap must refuse admission rather
  // than admit without counting, which would be an unbounded count wearing the
  // appearance of an enforced one.
  if (!Number.isInteger(admissionReservationCap) || admissionReservationCap <= 0) {
    fail("admissionReservationCap is required and must be a positive integer; refusing to admit without an enforced bound");
  }

  const admission = buildAttemptAdmission({ family, generationId, attemptId, admittedAt: now });
  const cKey = counterKey({ family, rotationKey });
  const aKey = admissionKey({ family, rotationKey, attemptId });

  return transaction(async (store) => {
    if (typeof store?.get !== "function" || typeof store?.put !== "function") {
      fail("the transaction must supply a store with get and put");
    }

    // One keyed read, not a scan.
    const existingRaw = await store.get(aKey);
    if (existingRaw !== null && existingRaw !== undefined) {
      const existing = normalizeAdmissionRow(existingRaw, { family, rotationKey, attemptId });
      // Only an EXACT OPEN retry qualifies. A different generation under the same
      // attempt id is an identity collision, and a terminal reservation must not
      // be resurrected — re-admitting it would let one id spend a unit, settle,
      // and start again for free.
      if (existing.generation_id !== generationId) {
        fail(`attempt ${attemptId} is already reserved for generation ${existing.generation_id}, not ${generationId}`);
      }
      if (existing.state !== "open") {
        fail(`attempt ${attemptId} is already ${existing.state}; a terminal reservation cannot be retried`);
      }
      // Past the resume horizon the attempt is no longer resumable, so this is
      // not a retry of something in flight — it is a stale id reappearing, and
      // admitting it would reuse a unit the rotation already spent.
      const ageSeconds = (nowMs - instantMs(existing.admitted_at, `stored admission ${attemptId} admitted_at`)) / 1000;
      if (ageSeconds > resumeWindowSeconds) {
        fail(`attempt ${attemptId} was admitted ${Math.floor(ageSeconds)}s ago, past the ${resumeWindowSeconds}s resume window; a stale retry cannot be admitted`);
      }
      const counter = normalizeCounter(await store.get(cKey), { family, rotationKey });
      return {
        schema_version: ATTEMPT_RESERVATION_SCHEMA,
        admitted: true,
        consumed_unit: false,
        reason: "already_reserved",
        admission: existing,
        used: counter.admitted_count,
        cap: admissionReservationCap,
      };
    }

    const counter = normalizeCounter(await store.get(cKey), { family, rotationKey });
    if (counter.admitted_count >= admissionReservationCap) {
      // Refuse before any object write. An attempt that cannot be counted must
      // not create objects, because those objects are the unbounded set the cap
      // exists to prevent.
      return {
        schema_version: ATTEMPT_RESERVATION_SCHEMA,
        admitted: false,
        consumed_unit: false,
        reason: "cap_exhausted",
        admission: null,
        used: counter.admitted_count,
        cap: admissionReservationCap,
      };
    }

    const nextCounter = { ...counter, admitted_count: counter.admitted_count + 1, updated_at: now };
    assertRowFits(admission, `admission row ${aKey}`);
    assertRowFits(nextCounter, `counter row ${cKey}`);

    // Both writes inside the one transaction.
    await store.put(aKey, admission);
    await store.put(cKey, nextCounter);

    return {
      schema_version: ATTEMPT_RESERVATION_SCHEMA,
      admitted: true,
      consumed_unit: true,
      reason: "admitted",
      admission,
      used: nextCounter.admitted_count,
      cap: admissionReservationCap,
    };
  });
}

function assertRowFits(row, context) {
  const bytes = canonicalJson(row).length;
  if (bytes > ATTEMPT_LEDGER_BYTE_CEILING) {
    fail(`${context} is ${bytes} bytes, over the ${ATTEMPT_LEDGER_BYTE_CEILING}-byte declared row`);
  }
  return bytes;
}

function normalizeCounter(current, { family, rotationKey }) {
  if (current === null || current === undefined) {
    return { schema_version: ATTEMPT_COUNTER_SCHEMA, family, rotation_key: rotationKey, admitted_count: 0, updated_at: null };
  }
  if (typeof current !== "object") fail("stored counter is not an object");
  if (current.schema_version !== ATTEMPT_COUNTER_SCHEMA) fail(`stored counter schema must be ${ATTEMPT_COUNTER_SCHEMA}`);
  // A counter read from the wrong rotation or family would silently authorise a
  // fresh budget of attempts, so a mismatch is a fault rather than a reset.
  if (current.family !== family) fail(`stored counter belongs to family ${current.family}, not ${family}`);
  if (current.rotation_key !== rotationKey) fail(`stored counter belongs to rotation ${current.rotation_key}, not ${rotationKey}`);
  if (!Number.isInteger(current.admitted_count) || current.admitted_count < 0) fail("stored counter admitted_count must be a non-negative integer");
  return current;
}

function normalizeAdmissionRow(current, { family, rotationKey, attemptId }) {
  if (typeof current !== "object" || current === null) fail("stored admission row is not an object");
  validateAttemptAdmission(current);
  // Cross-field invariants: the row is stored under a key derived from its own
  // identity, so a row whose contents disagree with its key is two identities
  // for one reservation.
  if (current.family !== family) fail(`stored admission at ${rotationKey} belongs to family ${current.family}, not ${family}`);
  if (current.attempt_id !== attemptId) fail(`stored admission is for attempt ${current.attempt_id}, not ${attemptId}`);
  return current;
}

/**
 * Reservation rows are bound to the resume window, not kept forever.
 *
 * The window is the same value that bounds prepared-receipt protection: past it
 * an attempt can no longer be resumed, so its reservation row has nothing left
 * to make idempotent. Binding the two means one owner number governs both rather
 * than two that can drift into disagreement — a reservation outliving its
 * resumability would refuse a legitimate new attempt id forever.
 */
export function classifyReservationRows({ rows, now, resumeWindowSeconds } = {}) {
  if (!Array.isArray(rows)) fail("rows must be an array");
  if (!Number.isFinite(resumeWindowSeconds) || resumeWindowSeconds <= 0) {
    fail("resumeWindowSeconds is required and must be positive; reservation retention is bound to the resume window");
  }
  const nowMs = instantMs(now, "now");
  const live = [];
  const expired = [];
  for (const row of rows) {
    validateAttemptAdmission(row);
    const ageSeconds = (nowMs - instantMs(row.admitted_at, `admission ${row.attempt_id} admitted_at`)) / 1000;
    if (ageSeconds > resumeWindowSeconds) expired.push({ attempt_id: row.attempt_id, generation_id: row.generation_id, age_seconds: Math.floor(ageSeconds) });
    else live.push(row.attempt_id);
  }
  live.sort();
  expired.sort((left, right) => (left.attempt_id < right.attempt_id ? -1 : left.attempt_id > right.attempt_id ? 1 : 0));
  return { schema_version: ATTEMPT_RESERVATION_SCHEMA, resume_window_seconds: resumeWindowSeconds, now, live_attempt_ids: live, expired_reservations: expired };
}

/**
 * Prune reservation rows the resume window has expired, inside the coordinator.
 *
 * THE COUNTER IS NEVER DECREMENTED. Pruning removes rows; it does not return
 * units. If it did, a rotation could evade its cap simply by waiting: admit,
 * let the window pass, prune, admit again. The counter is the rotation's spend
 * and it stays spent — rows are storage, units are budget, and the two must not
 * be confused because they expire on different terms.
 *
 * The counter row itself is only removed when the whole rotation is past the
 * window and no live admission row remains, so a rotation still in flight never
 * loses the record of what it has spent.
 *
 * Rotation is supplied by the caller. Nothing here reads a clock.
 */
export async function pruneExpiredReservations({
  transaction,
  family,
  rotationKey,
  rotationStartedAt,
  now,
  resumeWindowSeconds,
  dryRun = true,
} = {}) {
  if (typeof transaction !== "function") fail("a transaction function is required; this module performs no I/O on its own");
  requireId(family, "family");
  requireId(rotationKey, "rotationKey");
  const nowMs = instantMs(now, "now");
  if (!Number.isFinite(resumeWindowSeconds) || resumeWindowSeconds <= 0) {
    fail("resumeWindowSeconds is required and must be positive; reservation pruning is bound to the resume window");
  }
  const cKey = counterKey({ family, rotationKey });
  const prefix = `${cKey}/`;

  return transaction(async (store) => {
    if (typeof store?.list !== "function" || typeof store?.delete !== "function" || typeof store?.get !== "function") {
      fail("the transaction must supply a store with get, list and delete");
    }
    const rows = await store.list(prefix);
    if (!Array.isArray(rows)) fail("store.list must return an array of { key, value }");

    const pruned = [];
    const retained = [];
    for (const row of rows) {
      if (typeof row?.key !== "string" || !row.key.startsWith(prefix)) {
        fail(`listed key ${row?.key} is outside this rotation's reservation prefix`);
      }
      const attemptId = row.key.slice(prefix.length);
      const admission = normalizeAdmissionRow(row.value, { family, rotationKey, attemptId });
      const ageSeconds = (nowMs - instantMs(admission.admitted_at, `admission ${attemptId} admitted_at`)) / 1000;
      // An ambiguous clock aborts the whole prune. Retaining the single bad row
      // and proceeding would still delete the others under a clock nobody trusts,
      // and this authority deletes — a reader can be permissive, a deleter cannot.
      if (ageSeconds < 0) {
        fail(`admission ${attemptId} is dated ${admission.admitted_at}, ahead of ${now}; refusing to prune under an ambiguous clock`);
      }
      if (ageSeconds <= resumeWindowSeconds) {
        retained.push({ attempt_id: attemptId, age_seconds: Math.floor(ageSeconds), reason: "still resumable" });
        continue;
      }
      if (!dryRun) await store.delete(row.key);
      pruned.push({ attempt_id: attemptId, generation_id: admission.generation_id, age_seconds: Math.floor(ageSeconds) });
    }

    let counterRemoved = false;
    const counter = await store.get(cKey);
    if (counter !== null && counter !== undefined && retained.length === 0) {
      const rotationAge = rotationStartedAt === undefined || rotationStartedAt === null
        ? null
        : (nowMs - instantMs(rotationStartedAt, "rotationStartedAt")) / 1000;
      // Without a rotation start the counter is kept: removing it would erase the
      // rotation's spend on a guess, and a kept counter costs one small row.
      if (rotationAge !== null && rotationAge < 0) {
        fail(`rotation ${rotationKey} started ${rotationStartedAt}, ahead of ${now}; refusing to prune under an ambiguous clock`);
      }
      if (rotationAge !== null && rotationAge > resumeWindowSeconds) {
        if (!dryRun) await store.delete(cKey);
        counterRemoved = true;
      }
    }

    return {
      schema_version: ATTEMPT_RESERVATION_SCHEMA,
      // This authority owns the reservations prefix and nothing else. The R2
      // attempt-detail lifecycle owns attempts/ and neither may delete the
      // other's records; the prefixes make that structural rather than agreed.
      authority: "attempt_reservation",
      scope_prefix: prefix,
      dry_run: dryRun,
      family,
      rotation_key: rotationKey,
      resume_window_seconds: resumeWindowSeconds,
      evaluated_at: now,
      pruned,
      retained,
      counter_removed: counterRemoved,
      // Stated because it is the property most likely to be assumed wrong.
      counter_decremented: false,
    };
  });
}

/**
 * With split rows neither row grows with the cap, so the cap is no longer bounded
 * by the row size. Returned so the claim is measured rather than asserted.
 */
export function reservationRowSizes({ idLength = ATTEMPT_ID_MAX_LENGTH, admittedAt = "2026-08-14T00:00:00.000Z" } = {}) {
  if (!Number.isInteger(idLength) || idLength <= 0 || idLength > ATTEMPT_ID_MAX_LENGTH) {
    fail(`idLength must be a positive integer no greater than ${ATTEMPT_ID_MAX_LENGTH}`);
  }
  const pad = (prefix) => prefix + "a".repeat(Math.max(0, idLength - prefix.length));
  const family = pad("f");
  const rotationKey = pad("r");
  const admission = buildAttemptAdmission({ family, generationId: pad("g"), attemptId: pad("a"), admittedAt });
  const counter = { schema_version: ATTEMPT_COUNTER_SCHEMA, family, rotation_key: rotationKey, admitted_count: 999_999, updated_at: admittedAt };
  return {
    id_length: idLength,
    admission_row_bytes: canonicalJson(admission).length,
    counter_row_bytes: canonicalJson(counter).length,
    declared_row_bytes: ATTEMPT_LEDGER_BYTE_CEILING,
    cap_independent: true,
  };
}
