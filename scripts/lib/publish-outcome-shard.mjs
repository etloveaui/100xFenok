// Publish-outcome evidence shard (writer side of the 2026-08-10 contract).
//
// Every REAL per-family publish outcome of scripts/publish-cloud-data-generation.mjs
// appends one record to data/admin/data-supply-state/publish-outcomes/<family>.json:
//   { schema_version, family, records: [ ... ] }
// Records are retained in observed_at order (equal timestamps keep append
// order); at most the latest 100 and 64 KiB are kept, so the LAST record is
// the latest retained outcome. Records carry {family, result, generation_id,
// receipt_id, pointer_before,
// pointer_after, gate_before, gate_after, observed_at, source_as_of, binding}.
//
// result is one of the PUBLISH_OUTCOME_RESULTS set (published, resumed,
// gate_blocked, failed). Dry-run, retention (bucket-level, no family) and
// rollback/chaos-drill modes are NOT publish outcomes and write nothing.
//
// binding (schema v2) is the joined-cycle tuple: it names the Git commit and
// acquisition artifact the published tree came from, the candidate scope
// measured at publication time, and whether the same artifact was read back
// from current origin. It is nullable because a publish can fail before any of
// those exist, and because every record written under v1 predates the field.
// v1 shards stay readable: a stored record without binding is normalized to
// binding null rather than rejected, so no historical evidence is discarded
// and no family goes unreadable while it waits for its next publish. The
// consequence is declared rather than hidden — on the next write those
// records gain an explicit null, so their serialized bytes change even though
// their evidence does not.
//
// The write is atomic (writeJsonAtomic: tmp + fsync + rename) and strictly
// additive evidence: appendPublishOutcome never touches the publish itself,
// and a shard that already exists must validate before it is merged — a
// corrupt shard is left untouched and the write fails loudly rather than
// overwriting evidence.

import fs from "node:fs";
import path from "node:path";

import { validObservedAt, writeJsonAtomic } from "./data-supply-attempt-shard.mjs";
import { canonicalJson } from "./json-canonical.mjs";

export const PUBLISH_OUTCOME_SHARD_SCHEMA = "plane-publish-outcome-shard/v2";
// Every schema this reader accepts. The writer emits PUBLISH_OUTCOME_SHARD_SCHEMA
// only; this set exists so a shard written before the binding field is still
// readable by the validator AND by the alarm side. Dropping v1 here would not
// fail loudly — it would silently stop projecting every family that has not
// republished yet, which is the failure mode this contract most needs to avoid.
export const PUBLISH_OUTCOME_SHARD_SCHEMAS_READABLE = Object.freeze([
  "plane-publish-outcome-shard/v1",
  "plane-publish-outcome-shard/v2",
]);
export const PUBLISH_OUTCOME_MAX_RECORDS = 100;
export const PUBLISH_OUTCOME_MAX_ID_LENGTH = 256;
export const PUBLISH_OUTCOME_MAX_SERIALIZED_BYTES = 64 * 1024;

// The complete record result set. published/resumed are successful real
// publishes, gate_blocked is a cost-gate refusal, failed is any other failed
// real publish attempt. These four are the only results the alarm side must
// reason about.
export const PUBLISH_OUTCOME_RESULTS = Object.freeze([
  "published",
  "resumed",
  "gate_blocked",
  "failed",
]);

const FAMILY_PATTERN = /^[a-z][a-z0-9_-]{0,95}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const GATE_VERDICTS = Object.freeze(["ok", "warn", "blocked"]);
const RECORD_KEYS = Object.freeze([
  "family",
  "result",
  "generation_id",
  "receipt_id",
  "pointer_before",
  "pointer_after",
  "gate_before",
  "gate_after",
  "observed_at",
  "source_as_of",
  "binding",
]);
const SHARD_KEYS = Object.freeze(["schema_version", "family", "records"]);

// The joined-cycle tuple. Exact keys for the same reason records have exact
// keys: a field that may be absent is a field nobody can rely on. Each value
// is individually nullable because the legs bind at different points in the
// cycle and a publish can fail between any two of them, so a half-bound tuple
// must be able to say WHICH leg is missing instead of vanishing entirely.
const BINDING_KEYS = Object.freeze([
  "git_commit",
  "artifact_digest",
  "scope_source_sha256",
  "scope_file_count",
  "scope_bytes",
  "origin_readback",
]);
// scope_source_sha256 is the publisher's own payload-only content identity for
// the tree it actually published — the same value the pointer and parity path
// compare on. A path-and-size digest was the alternative and is weaker here:
// the tuple exists to prove three legs saw ONE artifact, and only a content
// identity can carry that claim across Git, the immutable generation and the
// origin readback.
const BINDING_ID_KEYS = Object.freeze(["git_commit", "artifact_digest", "scope_source_sha256"]);
const BINDING_COUNT_KEYS = Object.freeze(["scope_file_count", "scope_bytes"]);
// confirmed: the same artifact was read back from current origin after the
// publish. unavailable: the readback ran and could not confirm. null: it was
// not attempted, which is different from attempted-and-failed and must stay
// distinguishable.
const ORIGIN_READBACK_STATES = Object.freeze(["confirmed", "unavailable"]);

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} keys must be exactly ${wanted.join(",")}`);
  }
}

function serializedShardBytes(shard) {
  return Buffer.byteLength(`${JSON.stringify(shard, null, 2)}\n`, "utf8");
}

function assertFamily(family) {
  if (typeof family !== "string" || !FAMILY_PATTERN.test(family)) {
    throw new Error(`invalid publish-outcome family: ${JSON.stringify(family)}`);
  }
}

function assertBinding(binding) {
  if (binding === null) return;
  if (typeof binding !== "object" || Array.isArray(binding)) {
    throw new Error("publish-outcome binding must be an object or null");
  }
  assertExactKeys(binding, BINDING_KEYS, "publish-outcome binding");
  for (const name of BINDING_ID_KEYS) {
    const value = binding[name];
    if (value !== null && (typeof value !== "string" || value.length === 0 || value.length > PUBLISH_OUTCOME_MAX_ID_LENGTH)) {
      throw new Error(`binding.${name} must be a non-empty string of at most ${PUBLISH_OUTCOME_MAX_ID_LENGTH} characters or null`);
    }
  }
  for (const name of BINDING_COUNT_KEYS) {
    const value = binding[name];
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error(`binding.${name} must be a non-negative safe integer or null`);
    }
  }
  if (binding.origin_readback !== null && !ORIGIN_READBACK_STATES.includes(binding.origin_readback)) {
    throw new Error(`binding.origin_readback must be one of ${ORIGIN_READBACK_STATES.join("|")} or null`);
  }
}

// Read-side migration for shards written before the binding field existed.
// A v1 record is complete evidence of what it recorded; it is missing a field
// that did not exist when it was written, which is not the same as being
// malformed. Normalizing rather than rejecting is what keeps every family
// readable through the transition instead of only the ones that republish
// first. Returns the record unchanged when it already carries binding, so a
// v2 record is never rewritten by the read path.
export function normalizePublishOutcomeRecord(record) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return record;
  if (Object.hasOwn(record, "binding")) return record;
  return { ...record, binding: null };
}

// Shared field validation for built and stored records. Keeps hand-written
// and persisted records on exactly the same shape as buildPublishOutcomeRecord.
function assertRecordFields(record, family) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("publish-outcome record must be an object");
  }
  assertExactKeys(record, RECORD_KEYS, "publish-outcome record");
  assertBinding(record.binding);
  if (record.family !== family) {
    throw new Error(`publish-outcome record family ${JSON.stringify(record.family)} does not match ${family}`);
  }
  if (!PUBLISH_OUTCOME_RESULTS.includes(record.result)) {
    throw new Error(`invalid publish-outcome result: ${JSON.stringify(record.result)}`);
  }
  if (!validObservedAt(record.observed_at)) {
    throw new Error("observed_at must be RFC3339 UTC");
  }
  if (record.observed_at.length > 32) {
    throw new Error("observed_at exceeds 32 characters");
  }
  for (const name of ["generation_id", "receipt_id"]) {
    const value = record[name] ?? null;
    if (value !== null && (typeof value !== "string" || value.length === 0 || value.length > PUBLISH_OUTCOME_MAX_ID_LENGTH)) {
      throw new Error(`${name} must be a non-empty string of at most ${PUBLISH_OUTCOME_MAX_ID_LENGTH} characters or null`);
    }
  }
  for (const name of ["pointer_before", "pointer_after"]) {
    const value = record[name] ?? null;
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error(`${name} must be a non-negative safe integer or null`);
    }
  }
  for (const name of ["gate_before", "gate_after"]) {
    const value = record[name] ?? null;
    if (value !== null && !GATE_VERDICTS.includes(value)) {
      throw new Error(`${name} must be one of ${GATE_VERDICTS.join("|")} or null`);
    }
  }
  const sourceAsOf = record.source_as_of ?? null;
  if (sourceAsOf !== null && !ISO_DAY.test(sourceAsOf)) {
    throw new Error("source_as_of must be an ISO day (YYYY-MM-DD) or null");
  }
}

// Build the joined-cycle tuple in one place so every caller emits the same key
// set. Returns null when no leg bound at all, because an all-null tuple and an
// absent tuple carry the same information and the shorter one costs no bytes.
export function buildPublishOutcomeBinding({
  gitCommit = null,
  artifactDigest = null,
  scopeSourceSha256 = null,
  scopeFileCount = null,
  scopeBytes = null,
  originReadback = null,
} = {}) {
  const binding = {
    git_commit: gitCommit,
    artifact_digest: artifactDigest,
    scope_source_sha256: scopeSourceSha256,
    scope_file_count: scopeFileCount,
    scope_bytes: scopeBytes,
    origin_readback: originReadback,
  };
  if (BINDING_KEYS.every((key) => binding[key] === null)) return null;
  assertBinding(binding);
  return binding;
}

export function buildPublishOutcomeRecord({
  family,
  result,
  generationId = null,
  receiptId = null,
  pointerBefore = null,
  pointerAfter = null,
  gateBefore = null,
  gateAfter = null,
  observedAt = null,
  sourceAsOf = null,
  binding = null,
}) {
  assertFamily(family);
  const record = {
    family,
    result,
    generation_id: generationId,
    receipt_id: receiptId,
    pointer_before: pointerBefore,
    pointer_after: pointerAfter,
    gate_before: gateBefore,
    gate_after: gateAfter,
    observed_at: observedAt ?? new Date().toISOString(),
    source_as_of: sourceAsOf,
    binding,
  };
  assertRecordFields(record, family);
  return record;
}

export function validatePublishOutcomeShard(shard, family) {
  if (shard === null || typeof shard !== "object" || Array.isArray(shard)) {
    throw new Error("publish-outcome shard must be an object");
  }
  assertExactKeys(shard, SHARD_KEYS, "publish-outcome shard");
  if (!PUBLISH_OUTCOME_SHARD_SCHEMAS_READABLE.includes(shard.schema_version)) {
    throw new Error(`unexpected publish-outcome schema_version: ${JSON.stringify(shard.schema_version)}`);
  }
  assertFamily(shard.family);
  if (family !== undefined && shard.family !== family) {
    throw new Error(`publish-outcome shard family ${JSON.stringify(shard.family)} does not match ${family}`);
  }
  if (!Array.isArray(shard.records)) {
    throw new Error("publish-outcome shard records must be an array");
  }
  if (shard.records.length > PUBLISH_OUTCOME_MAX_RECORDS) {
    throw new Error(`publish-outcome shard exceeds ${PUBLISH_OUTCOME_MAX_RECORDS} records`);
  }
  for (const record of shard.records) assertRecordFields(normalizePublishOutcomeRecord(record), shard.family);
  if (serializedShardBytes(shard) > PUBLISH_OUTCOME_MAX_SERIALIZED_BYTES) {
    throw new Error(`publish-outcome shard exceeds ${PUBLISH_OUTCOME_MAX_SERIALIZED_BYTES} serialized bytes`);
  }
  return shard;
}

function buildBoundedShard({ family, records }) {
  assertFamily(family);
  const ordered = records.map((entry, order) => {
    const record = normalizePublishOutcomeRecord(entry);
    assertRecordFields(record, family);
    return { record: structuredClone(record), order, observedAt: Date.parse(record.observed_at) };
  }).sort((left, right) => left.observedAt - right.observedAt || left.order - right.order);
  const retained = ordered.slice(-PUBLISH_OUTCOME_MAX_RECORDS).map(({ record }) => record);
  const shard = {
    schema_version: PUBLISH_OUTCOME_SHARD_SCHEMA,
    family,
    records: retained,
  };
  while (shard.records.length > 0 && serializedShardBytes(shard) > PUBLISH_OUTCOME_MAX_SERIALIZED_BYTES) {
    shard.records.shift();
  }
  validatePublishOutcomeShard(shard, family);
  return shard;
}

// Merge whole-shard snapshots without duplicating their common history. For
// each exact record identity, retain the maximum occurrence count found in any
// input shard; later shards contribute only additional occurrences. The
// caller supplies precedence (upstream first, this run second), which also
// defines deterministic append order for equal observed_at timestamps.
export function mergePublishOutcomeShards({ family, shards }) {
  assertFamily(family);
  if (!Array.isArray(shards) || shards.length === 0) throw new Error("publish-outcome shards are required");
  const merged = [];
  const retainedCounts = new Map();
  for (const shard of shards) {
    validatePublishOutcomeShard(shard, family);
    const sourceCounts = new Map();
    for (const stored of shard.records) {
      // Normalize BEFORE identity. During the v1-to-v2 transition the same
      // outcome can arrive from an upstream v1 shard and from this run's v2
      // shard; comparing raw shapes would read those as two different records
      // and append a duplicate of every historical outcome.
      const record = normalizePublishOutcomeRecord(stored);
      const identity = canonicalJson(record);
      const occurrence = (sourceCounts.get(identity) ?? 0) + 1;
      sourceCounts.set(identity, occurrence);
      if (occurrence > (retainedCounts.get(identity) ?? 0)) merged.push(structuredClone(record));
    }
    for (const [identity, count] of sourceCounts) {
      retainedCounts.set(identity, Math.max(count, retainedCounts.get(identity) ?? 0));
    }
  }
  return buildBoundedShard({ family, records: merged });
}

export function publishOutcomeShardPath(outcomesRoot, family) {
  assertFamily(family);
  return path.join(outcomesRoot, `${family}.json`);
}

// Append one publish-outcome record to the family's shard, atomically. Reads
// the existing shard when present and validates it BEFORE merging: a corrupt
// shard is never overwritten — the write throws and the caller (the
// non-blocking recordPublishOutcome in the publisher) logs and continues.
// Returns { shardPath, record, count }.
export async function appendPublishOutcome({ outcomesRoot, family, record }) {
  assertFamily(family);
  assertRecordFields(normalizePublishOutcomeRecord(record), family);
  const shardPath = publishOutcomeShardPath(outcomesRoot, family);
  let records = [];
  if (fs.existsSync(shardPath)) {
    const existing = JSON.parse(fs.readFileSync(shardPath, "utf8"));
    validatePublishOutcomeShard(existing, family);
    records = existing.records.map((entry) => structuredClone(normalizePublishOutcomeRecord(entry)));
  }
  records.push(structuredClone(record));
  const shard = buildBoundedShard({ family, records });
  writeJsonAtomic(shardPath, shard);
  return { shardPath, record, count: shard.records.length };
}
