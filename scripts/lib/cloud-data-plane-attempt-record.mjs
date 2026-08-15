import { createHash } from "node:crypto";

import { canonicalJson } from "./json-canonical.mjs";

export const ATTEMPT_RECORD_SCHEMA = "cloud-data-plane-attempt-record/v1";
export const ATTEMPT_ADMISSION_SCHEMA = "cloud-data-plane-attempt-admission/v1";

// Measured 2026-08-14 against the candidate: a 5,605-key written list serialises
// to 459,943 bytes. Cloudflare's hard row/blob ceiling is 2,000,000, so it would
// technically fit — but the declared D1 shape for this migration is 2,000 bytes
// per row and 5,000,000 for the whole database. One such record is 230x the
// declared row and 9% of the declared database; eleven of them fill it. So the
// full list cannot be a ledger value, and this module splits the record into a
// compact ledger part and a detail part the caller stores elsewhere.
//
// The split is not only about size. The ledger part is what makes an attempt
// recoverable and must be written before the first object write; the detail is
// what makes the transient set enumerable and is only complete at the end. Two
// different durability moments, so two different records.
// This is the DECLARED migration ledger row, not the provider ceiling. The
// provider allows 2,000,000; the demand contract we are gating on declares
// 2,000, and the stricter of the two is the one a budget gate must assert
// against. The constant is duplicated from that contract, which is not a durable
// source of truth on its own — `assertLedgerCeilingMatchesDemand` exists so a
// test fails the moment the two drift apart.
export const ATTEMPT_LEDGER_BYTE_CEILING = 2000;
export const ATTEMPT_LEDGER_CEILING_SOURCE = "requestDemand.d1.max_row_or_blob_bytes";
export const PROVIDER_ROW_CEILING = 2_000_000;

export function assertLedgerCeilingMatchesDemand(demand) {
  const declared = demand?.d1?.max_row_or_blob_bytes;
  if (declared !== ATTEMPT_LEDGER_BYTE_CEILING) {
    fail(`declared ledger row is ${declared} but this module asserts ${ATTEMPT_LEDGER_BYTE_CEILING}; ${ATTEMPT_LEDGER_CEILING_SOURCE} is the source of truth`);
  }
  if (!(ATTEMPT_LEDGER_BYTE_CEILING < PROVIDER_ROW_CEILING)) {
    fail("the declared ceiling must remain stricter than the provider ceiling");
  }
  return ATTEMPT_LEDGER_BYTE_CEILING;
}

// Detail lives in its own R2 namespace, deliberately not under objects/ or
// manifests/. Two reasons: retention's candidate rule is scoped to
// objects/sha256/*, so an attempt detail can never be mistaken for a payload
// object and swept by the payload deleter; and its own lifecycle is separate
// authority, which is the condition attached to putting it in the bucket at all.
export const ATTEMPT_DETAIL_PREFIX = "attempts";

export function attemptDetailKey({ family, generationId, attemptId } = {}) {
  requireId(family, "family");
  requireId(generationId, "generationId");
  requireId(attemptId, "attemptId");
  return `${ATTEMPT_DETAIL_PREFIX}/${family}/${generationId}/${attemptId}.json`;
}

function fail(message) {
  throw new Error(`cloud-data-plane attempt record: ${message}`);
}

// Matches the generation contract's own SAFE_ID bound (1..128). Without a length
// cap here the reservation row's worst case is unbounded, so a cap calculator
// could only ever prove a size for the identifiers it happened to sample.
export const ATTEMPT_ID_MAX_LENGTH = 128;

function requireId(value, context) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]+$/.test(value)) {
    fail(`${context} must be a non-empty safe identifier`);
  }
  if (value.length > ATTEMPT_ID_MAX_LENGTH) {
    fail(`${context} is ${value.length} characters, over the ${ATTEMPT_ID_MAX_LENGTH}-character identifier bound`);
  }
  return value;
}

function requireInstant(value, context) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail(`${context} must be a parsable instant`);
  return value;
}

/**
 * Record what a publish attempt actually wrote.
 *
 * Why the distinction matters more than the count: objects are content-addressed,
 * so `putIfAbsent` either creates a key or finds the identical bytes already
 * there. Only the created keys are attributable to this attempt. An
 * already-present key belongs to whichever attempt first wrote it and may be
 * shared by any number of later generations, so treating the two the same would
 * attribute other attempts' objects to this one — the exact confusion that makes
 * a compensating deleter dangerous.
 *
 * This module records; it never deletes. The retention sweep remains the sole
 * deletion authority, and this record exists so the transient set is *known*
 * rather than inferred.
 */
/**
 * The admission record: written durably BEFORE the first object write.
 *
 * An in-memory recorder that persists only at the end cannot survive the case it
 * exists for. If the process dies mid-write, nothing on disk says an attempt was
 * ever open, so its objects are unattributable until the ordinary sweep finds
 * them unreferenced. Admission is what makes a crashed attempt knowable, and it
 * is also the unit the workflow's distinct-failure cap counts — which is why it
 * must be durable before any write, not merely before the finalize.
 *
 * Deliberately small: identity, time, and nothing that grows with the payload.
 */
export function buildAttemptAdmission({ generationId, attemptId, admittedAt, family } = {}) {
  requireId(generationId, "generationId");
  requireId(attemptId, "attemptId");
  requireId(family, "family");
  requireInstant(admittedAt, "admittedAt");
  const admission = {
    schema_version: ATTEMPT_ADMISSION_SCHEMA,
    family,
    generation_id: generationId,
    attempt_id: attemptId,
    admitted_at: admittedAt,
    state: "open",
  };
  const bytes = canonicalJson(admission).length;
  if (bytes > ATTEMPT_LEDGER_BYTE_CEILING) {
    fail(`admission record is ${bytes} bytes, over the ${ATTEMPT_LEDGER_BYTE_CEILING}-byte declared ledger row`);
  }
  return admission;
}

export function validateAttemptAdmission(value) {
  if (!value || typeof value !== "object") fail("admission must be an object");
  if (value.schema_version !== ATTEMPT_ADMISSION_SCHEMA) fail(`admission schema must be ${ATTEMPT_ADMISSION_SCHEMA}`);
  requireId(value.family, "family");
  requireId(value.generation_id, "generation_id");
  requireId(value.attempt_id, "attempt_id");
  requireInstant(value.admitted_at, "admitted_at");
  if (!["open", "finalized", "failed"].includes(value.state)) fail(`unknown admission state: ${value.state}`);
  return value;
}

export function createAttemptRecorder({ generationId, attemptId, startedAt } = {}) {
  requireId(generationId, "generationId");
  requireId(attemptId, "attemptId");
  requireInstant(startedAt, "startedAt");

  const entries = new Map();
  let sealed = false;

  return {
    /**
     * Record one object outcome. Re-recording the same key with a different
     * outcome is a contradiction, not an update: the same attempt cannot both
     * have created a key and found it already present.
     *
     * Returns `{ inserted, outcome }`. Membership is owned here and nowhere else:
     * a second structure tracking the same question is a second thing that can
     * disagree, which is exactly how the checkpoint wrapper came to double-count
     * a repeat this recorder had already folded away.
     */
    record(key, { written, alreadyPresent } = {}) {
      if (sealed) fail("cannot record after the attempt record is sealed");
      if (typeof key !== "string" || key.length === 0) fail("key is required");
      if (typeof written !== "boolean" || typeof alreadyPresent !== "boolean") {
        fail(`outcome for ${key} must state both written and alreadyPresent as booleans`);
      }
      if (written === alreadyPresent) {
        fail(`outcome for ${key} must be exactly one of written or alreadyPresent`);
      }
      const outcome = written ? "written" : "already_present";
      const prior = entries.get(key);
      if (prior && prior !== outcome) fail(`contradictory outcomes recorded for ${key}: ${prior} then ${outcome}`);
      const inserted = prior === undefined;
      entries.set(key, outcome);
      return { inserted, outcome };
    },

    /**
     * Seal and return the record. Sealing is one-way so a record cannot be
     * amended after it has been persisted and relied upon.
     */
    seal({ sealedAt } = {}) {
      requireInstant(sealedAt, "sealedAt");
      if (sealed) fail("attempt record is already sealed");
      sealed = true;
      const written = [...entries.entries()].filter(([, outcome]) => outcome === "written").map(([key]) => key).sort();
      const alreadyPresent = [...entries.entries()].filter(([, outcome]) => outcome === "already_present").map(([key]) => key).sort();
      const record = {
        schema_version: ATTEMPT_RECORD_SCHEMA,
        generation_id: generationId,
        attempt_id: attemptId,
        started_at: startedAt,
        sealed_at: sealedAt,
        // The attributable set: keys this attempt created and nothing else did.
        written_keys: written,
        // Recorded but never attributable. Kept because "we touched this and it
        // was already there" is evidence that the transient set is smaller than
        // the write count, and dropping it would make the record look worse than
        // reality without saying why.
        already_present_keys: alreadyPresent,
        counts: { written: written.length, already_present: alreadyPresent.length },
      };
      record.digest = createHash("sha256").update(canonicalJson({
        generation_id: record.generation_id,
        attempt_id: record.attempt_id,
        written_keys: record.written_keys,
        already_present_keys: record.already_present_keys,
      })).digest("hex");
      return record;
    },
  };
}

/**
 * Split a sealed record into the part the ledger can hold and the part it cannot.
 *
 * The ledger row carries identity, counts and the digest — enough to know an
 * attempt finished, how much it wrote, and whether a detail blob matches. The
 * detail carries the keys. The digest is over the detail, so a ledger row and a
 * detail blob can be checked against each other rather than trusted separately.
 */
export function splitAttemptRecord(record, { family } = {}) {
  validateAttemptRecord(record);
  requireId(family, "family");
  const ledger = {
    schema_version: ATTEMPT_RECORD_SCHEMA,
    family,
    generation_id: record.generation_id,
    attempt_id: record.attempt_id,
    started_at: record.started_at,
    sealed_at: record.sealed_at,
    counts: record.counts,
    digest: record.digest,
    detail_present: record.written_keys.length + record.already_present_keys.length > 0,
    // Recorded rather than left to be re-derived by every reader: a locator that
    // two components compute independently is a locator they can disagree about.
    detail_location: attemptDetailKey({ family, generationId: record.generation_id, attemptId: record.attempt_id }),
  };
  const bytes = canonicalJson(ledger).length;
  if (bytes > ATTEMPT_LEDGER_BYTE_CEILING) {
    fail(`ledger part is ${bytes} bytes, over the ${ATTEMPT_LEDGER_BYTE_CEILING}-byte declared row`);
  }
  return { ledger, detail: record, ledger_bytes: bytes };
}

/**
 * Check a detail blob against the ledger row that claims it.
 *
 * Without this the split would weaken the record: two stores that each look
 * plausible on their own but describe different attempts.
 */
/**
 * Establish the ledger row's own invariants.
 *
 * The matcher previously trusted the ledger's shape and only compared it to the
 * detail, so a malformed row could pair with a valid detail and be accepted. A
 * comparison is only as good as the weaker side of it.
 */
export function validateAttemptLedger(value) {
  if (!value || typeof value !== "object") fail("ledger part must be an object");
  if (value.schema_version !== ATTEMPT_RECORD_SCHEMA) fail(`ledger schema must be ${ATTEMPT_RECORD_SCHEMA}`);
  requireId(value.family, "ledger family");
  requireId(value.generation_id, "ledger generation_id");
  requireId(value.attempt_id, "ledger attempt_id");
  requireInstant(value.started_at, "ledger started_at");
  requireInstant(value.sealed_at, "ledger sealed_at");
  if (Date.parse(value.sealed_at) < Date.parse(value.started_at)) fail("ledger sealed_at precedes started_at");
  if (typeof value.detail_present !== "boolean") fail("ledger detail_present must be a boolean");
  if (typeof value.digest !== "string" || !/^[0-9a-f]{64}$/.test(value.digest)) fail("ledger digest must be a sha256 hex string");
  for (const field of ["written", "already_present"]) {
    const count = value.counts?.[field];
    if (!Number.isInteger(count) || count < 0) fail(`ledger counts.${field} must be a non-negative integer`);
  }
  const expectedLocation = attemptDetailKey({
    family: value.family,
    generationId: value.generation_id,
    attemptId: value.attempt_id,
  });
  if (value.detail_location !== expectedLocation) {
    fail(`ledger detail_location ${value.detail_location} does not match this attempt's namespace key`);
  }
  const total = value.counts.written + value.counts.already_present;
  if (value.detail_present !== (total > 0)) fail("ledger detail_present disagrees with its own counts");
  return value;
}

export function attemptRecordMatchesLedger({ ledger, detail } = {}) {
  validateAttemptLedger(ledger);
  validateAttemptRecord(detail);
  return ledger.generation_id === detail.generation_id
    && ledger.attempt_id === detail.attempt_id
    && ledger.started_at === detail.started_at
    && ledger.sealed_at === detail.sealed_at
    && ledger.digest === detail.digest
    && ledger.counts.written === detail.counts.written
    && ledger.counts.already_present === detail.counts.already_present
    && ledger.detail_present === (detail.written_keys.length + detail.already_present_keys.length > 0);
}

/**
 * A recorder whose written set survives the process that produced it.
 *
 * Admission says an attempt was opened; it does not say what that attempt wrote.
 * A death after object writes but before the final persist leaves an open attempt
 * with no enumerable key set — the exact hole this closes. Keys are flushed
 * durably every `checkpointEvery` records, so a crash leaves at most
 * `checkpointEvery - 1` keys unknown, and that remainder is a declared bound
 * rather than an open question.
 *
 * `record` is async on purpose: a checkpoint that is not awaited is not durable,
 * and a synchronous signature would let a caller believe otherwise.
 */
export function createCheckpointingAttemptRecorder({ generationId, attemptId, startedAt, checkpointEvery, sink } = {}) {
  requireId(generationId, "generationId");
  requireId(attemptId, "attemptId");
  requireInstant(startedAt, "startedAt");
  if (!Number.isInteger(checkpointEvery) || checkpointEvery <= 0) {
    fail("checkpointEvery is required and must be a positive integer; an unbounded buffer is what this exists to prevent");
  }
  if (typeof sink !== "function") fail("a checkpoint sink is required; this module performs no I/O on its own");

  const inner = createAttemptRecorder({ generationId, attemptId, startedAt });
  const pending = [];
  // Membership is not tracked here. The base recorder answers whether a record
  // was a new insertion and this wrapper acts on that answer, so there is one
  // source of truth rather than two structures that can drift. The earlier
  // version kept its own map, and the two layers disagreeing about what a repeat
  // means is precisely how a valid attempt came to fail at seal.
  let flushed = 0;
  let sequence = 0;

  const flush = async (reason) => {
    if (pending.length === 0) return null;
    const chunk = {
      schema_version: ATTEMPT_RECORD_SCHEMA,
      generation_id: generationId,
      attempt_id: attemptId,
      sequence,
      reason,
      entries: pending.map((row) => ({ ...row })),
    };
    const outcome = await sink(chunk);
    if (!outcome || outcome.durable !== true) {
      fail(`checkpoint ${sequence} was not confirmed durable; the attempt must not continue believing its written set is recorded`);
    }
    sequence += 1;
    flushed += pending.length;
    pending.length = 0;
    return chunk;
  };

  return {
    async record(key, outcome) {
      // Contradictions throw inside the base recorder, before anything is
      // enqueued. A repeat reports inserted:false and is enqueued nowhere, which
      // holds identically on both sides of a checkpoint boundary because the
      // base recorder's membership spans the whole attempt.
      const { inserted, outcome: resolved } = inner.record(key, outcome);
      if (!inserted) return;
      pending.push({ key, outcome: resolved });
      if (pending.length >= checkpointEvery) await flush("threshold");
    },
    async seal({ sealedAt } = {}) {
      await flush("seal");
      const record = inner.seal({ sealedAt });
      if (flushed !== record.counts.written + record.counts.already_present) {
        fail("checkpointed entry count disagrees with the sealed record; refusing to emit a record whose detail was not fully flushed");
      }
      return record;
    },
    checkpointsWritten: () => sequence,
    unflushedCount: () => pending.length,
  };
}

/**
 * What is known about an attempt that never finalized.
 *
 * Deliberately returns `complete: false` and no sealed record: an open attempt is
 * never recoverable, and the point of the checkpoints is that its damage is
 * bounded and enumerable, not that it can be resumed.
 */
/**
 * Derive the checkpoint interval instead of picking one.
 *
 * Two constraints, both from approved policy rather than from a test fixture:
 * the interval must keep the post-crash unknown set within the tolerated bound,
 * and the extra checkpoint writes it causes must fit the operation headroom the
 * budget already allows. A fixture's ten-key/four-interval shape is a test, not a
 * production value, and is deliberately not the source here.
 */
export function deriveCheckpointEvery({ maxUnknownKeys, keysPerAttempt, attemptsPerMonth, classAHeadroomPerMonth } = {}) {
  if (!Number.isInteger(maxUnknownKeys) || maxUnknownKeys < 0) fail("maxUnknownKeys is required and must be a non-negative integer");
  if (!Number.isInteger(keysPerAttempt) || keysPerAttempt <= 0) fail("keysPerAttempt is required and must be positive");
  if (!Number.isInteger(attemptsPerMonth) || attemptsPerMonth <= 0) fail("attemptsPerMonth is required and must be positive");
  if (!Number.isInteger(classAHeadroomPerMonth) || classAHeadroomPerMonth <= 0) fail("classAHeadroomPerMonth is required and must be positive");

  // A crash loses at most the un-flushed remainder, which is interval - 1.
  const interval = maxUnknownKeys + 1;
  const checkpointsPerAttempt = Math.ceil(keysPerAttempt / interval);
  const writesPerMonth = checkpointsPerAttempt * attemptsPerMonth;
  if (writesPerMonth > classAHeadroomPerMonth) {
    fail(`a ${interval}-key interval needs ${writesPerMonth} checkpoint writes per month, over the ${classAHeadroomPerMonth} declared headroom; raise the tolerated unknown bound or the headroom`);
  }
  return {
    checkpoint_every: interval,
    max_unknown_keys: maxUnknownKeys,
    checkpoints_per_attempt: checkpointsPerAttempt,
    checkpoint_writes_per_month: writesPerMonth,
    class_a_headroom_per_month: classAHeadroomPerMonth,
  };
}

export function recoverOpenAttempt({ admission, chunks, checkpointEvery } = {}) {
  validateAttemptAdmission(admission);
  if (!Array.isArray(chunks)) fail("chunks must be an array");
  if (!Number.isInteger(checkpointEvery) || checkpointEvery <= 0) fail("checkpointEvery is required to state the unknown bound");
  const ordered = [...chunks].sort((left, right) => (left?.sequence ?? -1) - (right?.sequence ?? -1));
  for (const [index, chunk] of ordered.entries()) {
    // A malformed chunk must not be quietly skipped: dropping it would shrink
    // known_written_keys and make the unknown bound a lie in the safe-looking
    // direction.
    if (!chunk || typeof chunk !== "object") fail(`checkpoint ${index} is not an object`);
    if (chunk.schema_version !== ATTEMPT_RECORD_SCHEMA) fail(`checkpoint ${index} schema must be ${ATTEMPT_RECORD_SCHEMA}`);
    if (!Number.isInteger(chunk.sequence)) fail(`checkpoint ${index} has a non-integer sequence`);
    if (chunk.sequence !== index) fail(`checkpoint sequence gap at ${index}: found ${chunk.sequence}`);
    if (chunk.generation_id !== admission.generation_id || chunk.attempt_id !== admission.attempt_id) {
      fail("a checkpoint belongs to a different attempt than the admission");
    }
    if (!Array.isArray(chunk.entries)) fail(`checkpoint ${index} entries must be an array`);
    for (const entry of chunk.entries) {
      if (!entry || typeof entry.key !== "string" || entry.key.length === 0) {
        fail(`checkpoint ${index} contains an entry with no key`);
      }
      if (entry.outcome !== "written" && entry.outcome !== "already_present") {
        fail(`checkpoint ${index} entry ${entry.key} has an unknown outcome: ${entry.outcome}`);
      }
    }
  }
  const known = ordered.flatMap((chunk) => chunk.entries);
  // The same key may not appear with two different outcomes across chunks; that
  // is the recorder's contradiction rule surviving into recovery.
  const outcomeByKey = new Map();
  for (const entry of known) {
    const prior = outcomeByKey.get(entry.key);
    if (prior && prior !== entry.outcome) fail(`checkpoints disagree about ${entry.key}: ${prior} then ${entry.outcome}`);
    outcomeByKey.set(entry.key, entry.outcome);
  }
  const writtenKeys = [...new Set(known.filter((row) => row.outcome === "written").map((row) => row.key))].sort();
  return {
    state: admission.state,
    complete: false,
    known_written_keys: writtenKeys,
    checkpoints_read: ordered.length,
    // The honest statement of what was lost: the last partial checkpoint.
    unknown_key_upper_bound: checkpointEvery - 1,
    recoverable: false,
  };
}

export function validateAttemptRecord(value) {
  if (!value || typeof value !== "object") fail("record must be an object");
  if (value.schema_version !== ATTEMPT_RECORD_SCHEMA) fail(`schema must be ${ATTEMPT_RECORD_SCHEMA}`);
  requireId(value.generation_id, "generation_id");
  requireId(value.attempt_id, "attempt_id");
  requireInstant(value.started_at, "started_at");
  requireInstant(value.sealed_at, "sealed_at");
  for (const field of ["written_keys", "already_present_keys"]) {
    if (!Array.isArray(value[field])) fail(`${field} must be an array`);
    const sorted = [...value[field]].sort();
    if (sorted.join(" ") !== value[field].join(" ")) fail(`${field} must be sorted`);
    if (new Set(value[field]).size !== value[field].length) fail(`${field} contains duplicates`);
  }
  const overlap = value.written_keys.filter((key) => value.already_present_keys.includes(key));
  if (overlap.length > 0) fail(`a key cannot be both written and already present: ${overlap.join(", ")}`);
  if (value.counts?.written !== value.written_keys.length || value.counts?.already_present !== value.already_present_keys.length) {
    fail("counts disagree with the recorded key lists");
  }
  return value;
}

/**
 * Persist a sealed record through a caller-supplied sink, and refuse to report
 * success unless the sink confirms.
 *
 * The sink is injected because where the record lives is an architecture
 * decision, not this module's: it must outlive the process that wrote it, and
 * the candidate locations differ in whether the record itself becomes something
 * that needs sweeping. Nothing here performs I/O on its own.
 */
export async function persistAttemptRecord({ record, sink } = {}) {
  validateAttemptRecord(record);
  if (typeof sink !== "function") fail("a persistence sink is required; this module performs no I/O on its own");
  const outcome = await sink(record);
  if (!outcome || outcome.durable !== true) {
    // The whole point of the record is that an attempt is only recoverable once
    // its written set is known to survive the attempt. A best-effort write would
    // reinstate exactly the unbounded case this closes.
    fail("sink did not confirm durability; the attempt must not be treated as recoverable");
  }
  return { durable: true, digest: record.digest, location: outcome.location ?? null };
}
