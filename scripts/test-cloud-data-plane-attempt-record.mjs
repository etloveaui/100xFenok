import assert from "node:assert/strict";

import {
  ATTEMPT_RECORD_SCHEMA,
  createAttemptRecorder,
  persistAttemptRecord,
  validateAttemptRecord,
} from "./lib/cloud-data-plane-attempt-record.mjs";

const GEN = "gen-2026-08-14T00-00-00Z";
const ATTEMPT = "attempt-1";
const STARTED = "2026-08-14T00:00:00Z";
const SEALED = "2026-08-14T00:04:00Z";

function assertThrows(run, fragment) {
  assert.throws(run, (error) => {
    assert.match(error.message, new RegExp(fragment));
    return true;
  });
}

function recorder() {
  return createAttemptRecorder({ generationId: GEN, attemptId: ATTEMPT, startedAt: STARTED });
}

// --- identity is required and validated ---
{
  assertThrows(() => createAttemptRecorder({ attemptId: ATTEMPT, startedAt: STARTED }), "generationId must be");
  assertThrows(() => createAttemptRecorder({ generationId: GEN, startedAt: STARTED }), "attemptId must be");
  assertThrows(() => createAttemptRecorder({ generationId: GEN, attemptId: ATTEMPT }), "startedAt must be");
  assertThrows(() => createAttemptRecorder({ generationId: "bad id", attemptId: ATTEMPT, startedAt: STARTED }), "safe identifier");
}

// --- written and already-present are distinguished, never conflated ---
{
  const attempt = recorder();
  attempt.record("objects/sha256/aaa", { written: true, alreadyPresent: false });
  attempt.record("objects/sha256/bbb", { written: false, alreadyPresent: true });
  attempt.record("manifests/gen.json", { written: true, alreadyPresent: false });
  const record = attempt.seal({ sealedAt: SEALED });

  assert.equal(record.schema_version, ATTEMPT_RECORD_SCHEMA);
  assert.deepEqual(record.written_keys, ["manifests/gen.json", "objects/sha256/aaa"]);
  assert.deepEqual(record.already_present_keys, ["objects/sha256/bbb"]);
  assert.deepEqual(record.counts, { written: 2, already_present: 1 });
  assert.equal(record.generation_id, GEN);
  assert.equal(record.attempt_id, ATTEMPT);
  assert.match(record.digest, /^[0-9a-f]{64}$/);
  assert.equal(validateAttemptRecord(record), record);
}

// --- an ambiguous or contradictory outcome fails closed ---
{
  const attempt = recorder();
  assertThrows(() => attempt.record("k", { written: true, alreadyPresent: true }), "exactly one of written or alreadyPresent");
  assertThrows(() => attempt.record("k", { written: false, alreadyPresent: false }), "exactly one of written or alreadyPresent");
  assertThrows(() => attempt.record("k", { written: true }), "must state both");
  assertThrows(() => attempt.record("", { written: true, alreadyPresent: false }), "key is required");

  // Insertion status is owned here, so the checkpoint wrapper has one source of
  // truth to act on rather than a second membership map that can drift.
  assert.deepEqual(attempt.record("k", { written: true, alreadyPresent: false }), { inserted: true, outcome: "written" });
  // Recording the same outcome again is harmless; flipping it is a contradiction.
  assert.deepEqual(attempt.record("k", { written: true, alreadyPresent: false }), { inserted: false, outcome: "written" });
  assertThrows(() => attempt.record("k", { written: false, alreadyPresent: true }), "contradictory outcomes");
}

// --- sealing is one-way ---
{
  const attempt = recorder();
  attempt.record("objects/sha256/aaa", { written: true, alreadyPresent: false });
  attempt.seal({ sealedAt: SEALED });
  assertThrows(() => attempt.record("objects/sha256/ccc", { written: true, alreadyPresent: false }), "after the attempt record is sealed");
  assertThrows(() => attempt.seal({ sealedAt: SEALED }), "already sealed");
}

// --- an empty attempt is a valid record, not an error ---
{
  // A run that found every object already present wrote nothing and stranded
  // nothing. That must be expressible, or the record cannot describe the common case.
  const record = recorder().seal({ sealedAt: SEALED });
  assert.deepEqual(record.written_keys, []);
  assert.deepEqual(record.counts, { written: 0, already_present: 0 });
  assert.equal(validateAttemptRecord(record), record);
}

// --- the same content produces the same digest regardless of record order ---
{
  const first = recorder();
  first.record("b", { written: true, alreadyPresent: false });
  first.record("a", { written: true, alreadyPresent: false });
  const second = recorder();
  second.record("a", { written: true, alreadyPresent: false });
  second.record("b", { written: true, alreadyPresent: false });
  assert.equal(first.seal({ sealedAt: SEALED }).digest, second.seal({ sealedAt: SEALED }).digest);
}

// --- validation rejects tampered records ---
{
  const attempt = recorder();
  attempt.record("a", { written: true, alreadyPresent: false });
  attempt.record("b", { written: false, alreadyPresent: true });
  const base = attempt.seal({ sealedAt: SEALED });

  const tampers = [
    [{ ...base, schema_version: "x/v0" }, "schema must be"],
    [{ ...base, generation_id: "" }, "generation_id"],
    [{ ...base, written_keys: ["b", "a"] }, "must be sorted"],
    [{ ...base, written_keys: ["a", "a"], counts: { written: 2, already_present: 1 } }, "duplicates"],
    [{ ...base, already_present_keys: ["a"], counts: { written: 1, already_present: 1 } }, "cannot be both written and already present"],
    [{ ...base, counts: { written: 99, already_present: 1 } }, "counts disagree"],
    [{ ...base, sealed_at: "nope" }, "sealed_at must be"],
  ];
  for (const [value, fragment] of tampers) assertThrows(() => validateAttemptRecord(value), fragment);
}

// --- persistence: no I/O of its own, and no success without confirmed durability ---
{
  const attempt = recorder();
  attempt.record("objects/sha256/aaa", { written: true, alreadyPresent: false });
  const record = attempt.seal({ sealedAt: SEALED });

  await assert.rejects(() => persistAttemptRecord({ record }), /persistence sink is required/);
  await assert.rejects(
    () => persistAttemptRecord({ record, sink: async () => ({ durable: false }) }),
    /must not be treated as recoverable/,
  );
  await assert.rejects(
    () => persistAttemptRecord({ record, sink: async () => undefined }),
    /must not be treated as recoverable/,
  );

  const seen = [];
  const outcome = await persistAttemptRecord({
    record,
    sink: async (value) => { seen.push(value); return { durable: true, location: "attempts/gen/attempt-1.json" }; },
  });
  assert.equal(outcome.durable, true);
  assert.equal(outcome.digest, record.digest);
  assert.equal(outcome.location, "attempts/gen/attempt-1.json");
  assert.equal(seen.length, 1);
  assert.equal(seen[0], record);
}

// --- admission: durable before the first write, and small enough to be a row ---
{
  const { ATTEMPT_LEDGER_BYTE_CEILING, buildAttemptAdmission, validateAttemptAdmission } =
    await import("./lib/cloud-data-plane-attempt-record.mjs");

  const admission = buildAttemptAdmission({ family: "stockanalysis-etf", generationId: GEN, attemptId: ATTEMPT, admittedAt: STARTED });
  assert.equal(admission.state, "open");
  assert.equal(admission.generation_id, GEN);
  assert.equal(validateAttemptAdmission(admission), admission);
  // It must fit the declared ledger row, or it cannot be written before the
  // first object write, which is the only moment that makes it useful.
  assert.ok(JSON.stringify(admission).length < ATTEMPT_LEDGER_BYTE_CEILING);
  // Nothing in it grows with the payload.
  assert.deepEqual(Object.keys(admission).sort(), ["admitted_at", "attempt_id", "family", "generation_id", "schema_version", "state"]);

  assertThrows(() => buildAttemptAdmission({ generationId: GEN, attemptId: ATTEMPT, admittedAt: STARTED }), "family must be");
  assertThrows(() => validateAttemptAdmission({ ...admission, state: "maybe" }), "unknown admission state");
}

// --- the 5,605-key case: measured, and refused as a single ledger value ---
{
  const { splitAttemptRecord, attemptRecordMatchesLedger, ATTEMPT_LEDGER_BYTE_CEILING } =
    await import("./lib/cloud-data-plane-attempt-record.mjs");

  const attempt = recorder();
  for (let index = 0; index < 5605; index += 1) {
    attempt.record(`objects/sha256/${String(index).padStart(64, "0")}`, { written: true, alreadyPresent: false });
  }
  const record = attempt.seal({ sealedAt: SEALED });
  assert.equal(record.counts.written, 5605);

  // The whole record is far past a ledger row; this is the measurement that
  // forced the split rather than an assumption about it.
  assert.ok(JSON.stringify(record).length > 400_000, "the candidate's full record is hundreds of KiB");

  const { ledger, detail, ledger_bytes: ledgerBytes } = splitAttemptRecord(record, { family: "stockanalysis-etf" });
  assert.ok(ledgerBytes < ATTEMPT_LEDGER_BYTE_CEILING, `ledger part must fit the declared row, got ${ledgerBytes}`);
  assert.equal(ledger.counts.written, 5605);
  assert.equal(ledger.detail_present, true);
  assert.equal(ledger.digest, record.digest);
  assert.equal("written_keys" in ledger, false, "the key list must not ride along in the ledger row");

  // The two halves are checkable against each other, so neither is trusted alone.
  assert.equal(attemptRecordMatchesLedger({ ledger, detail }), true);
  assert.equal(attemptRecordMatchesLedger({ ledger: { ...ledger, digest: "0".repeat(64) }, detail }), false);
  assert.equal(attemptRecordMatchesLedger({ ledger: { ...ledger, counts: { written: 1, already_present: 0 } }, detail }), false);
  // Changing the identity also contradicts the recorded detail locator, which is
  // a malformed ledger rather than a mismatched pair — so it throws instead of
  // returning false. Stronger than the comparison, and the reason the locator is
  // recorded rather than re-derived by each reader.
  assertThrows(
    () => attemptRecordMatchesLedger({ ledger: { ...ledger, attempt_id: "other" }, detail }),
    "does not match this attempt's namespace key",
  );
}

// --- the declared ceiling is bound to the demand contract, not a stray literal ---
{
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const {
    ATTEMPT_LEDGER_BYTE_CEILING, PROVIDER_ROW_CEILING, assertLedgerCeilingMatchesDemand,
  } = await import("./lib/cloud-data-plane-attempt-record.mjs");

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const demand = JSON.parse(fs.readFileSync(path.join(repoRoot, "scripts", "fixtures", "cloud-data-plane", "etf-migration-demand.json"), "utf8"));
  // This is the drift test: if the demand contract moves and the module does not,
  // it fails here rather than silently asserting against a stale number.
  assert.equal(assertLedgerCeilingMatchesDemand(demand), ATTEMPT_LEDGER_BYTE_CEILING);
  assert.ok(ATTEMPT_LEDGER_BYTE_CEILING < PROVIDER_ROW_CEILING, "the declared ceiling must stay stricter than the provider one");
  assertThrows(() => assertLedgerCeilingMatchesDemand({ d1: { max_row_or_blob_bytes: 4096 } }), "source of truth");
}

// --- the ledger row establishes its own invariants ---
{
  const { splitAttemptRecord, validateAttemptLedger, attemptRecordMatchesLedger, attemptDetailKey } =
    await import("./lib/cloud-data-plane-attempt-record.mjs");

  const attempt = recorder();
  attempt.record("objects/sha256/aaa", { written: true, alreadyPresent: false });
  const record = attempt.seal({ sealedAt: SEALED });
  const { ledger, detail } = splitAttemptRecord(record, { family: "stockanalysis-etf" });

  assert.equal(ledger.detail_location, attemptDetailKey({ family: "stockanalysis-etf", generationId: GEN, attemptId: ATTEMPT }));
  assert.ok(ledger.detail_location.startsWith("attempts/"), "detail must live outside objects/ and manifests/");
  assert.equal(validateAttemptLedger(ledger), ledger);
  assert.equal(attemptRecordMatchesLedger({ ledger, detail }), true);

  // A malformed ledger must fail closed rather than pair with a valid detail.
  const ledgerTampers = [
    [{ ...ledger, schema_version: "x" }, "ledger schema must be"],
    [{ ...ledger, family: "" }, "ledger family"],
    [{ ...ledger, sealed_at: "2020-01-01T00:00:00Z" }, "precedes started_at"],
    [{ ...ledger, digest: "nothex" }, "sha256 hex"],
    [{ ...ledger, counts: { written: -1, already_present: 0 } }, "non-negative integer"],
    [{ ...ledger, detail_location: "objects/sha256/aaa" }, "does not match this attempt's namespace key"],
    [{ ...ledger, detail_present: false }, "disagrees with its own counts"],
    [{ ...ledger, detail_present: "yes" }, "must be a boolean"],
  ];
  for (const [value, fragment] of ledgerTampers) {
    assertThrows(() => validateAttemptLedger(value), fragment);
    assertThrows(() => attemptRecordMatchesLedger({ ledger: value, detail }), fragment);
  }
}

// --- crash-safe detail: bounded loss, never a silent one ---
{
  const { createCheckpointingAttemptRecorder, buildAttemptAdmission, recoverOpenAttempt } =
    await import("./lib/cloud-data-plane-attempt-record.mjs");

  assertThrows(
    () => createCheckpointingAttemptRecorder({ generationId: GEN, attemptId: ATTEMPT, startedAt: STARTED, sink: async () => ({ durable: true }) }),
    "unbounded buffer is what this exists to prevent",
  );
  assertThrows(
    () => createCheckpointingAttemptRecorder({ generationId: GEN, attemptId: ATTEMPT, startedAt: STARTED, checkpointEvery: 4 }),
    "checkpoint sink is required",
  );

  const chunks = [];
  const attempt = createCheckpointingAttemptRecorder({
    generationId: GEN, attemptId: ATTEMPT, startedAt: STARTED, checkpointEvery: 4,
    sink: async (chunk) => { chunks.push(chunk); return { durable: true }; },
  });
  for (let index = 0; index < 10; index += 1) {
    await attempt.record(`objects/sha256/${String(index).padStart(64, "0")}`, { written: true, alreadyPresent: false });
  }
  // Ten keys at a threshold of four: two durable chunks, two keys still pending.
  assert.equal(attempt.checkpointsWritten(), 2);
  assert.equal(attempt.unflushedCount(), 2);

  // Simulate the crash: no seal. What survives is the admission plus the chunks.
  const admission = buildAttemptAdmission({ family: "stockanalysis-etf", generationId: GEN, attemptId: ATTEMPT, admittedAt: STARTED });
  const recovered = recoverOpenAttempt({ admission, chunks, checkpointEvery: 4 });
  assert.equal(recovered.complete, false);
  assert.equal(recovered.recoverable, false, "an open attempt is never recoverable");
  assert.equal(recovered.known_written_keys.length, 8);
  assert.equal(recovered.unknown_key_upper_bound, 3, "the loss is bounded by the checkpoint interval and stated");
  assert.equal(recovered.checkpoints_read, 2);

  // A gap or a foreign chunk fails closed rather than under-reporting the set.
  assertThrows(() => recoverOpenAttempt({ admission, chunks: [chunks[1]], checkpointEvery: 4 }), "sequence gap");
  assertThrows(
    () => recoverOpenAttempt({ admission, chunks: [{ ...chunks[0], attempt_id: "other" }], checkpointEvery: 4 }),
    "different attempt than the admission",
  );

  // Sealing flushes the remainder and refuses if the flushed count disagrees.
  const sealed = await attempt.seal({ sealedAt: SEALED });
  assert.equal(sealed.counts.written, 10);
  assert.equal(attempt.checkpointsWritten(), 3);
  assert.equal(attempt.unflushedCount(), 0);

  // A sink that does not confirm durability stops the attempt rather than
  // letting it proceed believing its keys are recorded.
  const failing = createCheckpointingAttemptRecorder({
    generationId: GEN, attemptId: ATTEMPT, startedAt: STARTED, checkpointEvery: 1,
    sink: async () => ({ durable: false }),
  });
  await assert.rejects(() => failing.record("k", { written: true, alreadyPresent: false }), /not confirmed durable/);
}

// --- the duplicate-checkpoint defect, and its boundary case ---
{
  const { createCheckpointingAttemptRecorder } = await import("./lib/cloud-data-plane-attempt-record.mjs");
  const make = (checkpointEvery, chunks) => createCheckpointingAttemptRecorder({
    generationId: GEN, attemptId: ATTEMPT, startedAt: STARTED, checkpointEvery,
    sink: async (chunk) => { chunks.push(chunk); return { durable: true }; },
  });

  // Reported case: same key, same outcome, twice, then seal. Previously this
  // rejected a valid attempt on a count mismatch because the wrapper counted the
  // repeat that the base recorder had already folded away.
  {
    const chunks = [];
    const attempt = make(2, chunks);
    await attempt.record("k1", { written: true, alreadyPresent: false });
    await attempt.record("k1", { written: true, alreadyPresent: false });
    const sealed = await attempt.seal({ sealedAt: SEALED });
    assert.equal(sealed.counts.written, 1);
    assert.deepEqual(chunks.flatMap((chunk) => chunk.entries).map((entry) => entry.key), ["k1"]);
  }

  // Duplicate across a checkpoint boundary: the repeat arrives after its key has
  // already been flushed, so a pending-only dedupe would still double-count.
  {
    const chunks = [];
    const attempt = make(2, chunks);
    await attempt.record("a", { written: true, alreadyPresent: false });
    await attempt.record("b", { written: false, alreadyPresent: true });
    assert.equal(attempt.checkpointsWritten(), 1, "the first chunk flushed at the threshold");
    await attempt.record("a", { written: true, alreadyPresent: false }); // already flushed
    await attempt.record("c", { written: true, alreadyPresent: false });
    const sealed = await attempt.seal({ sealedAt: SEALED });
    assert.deepEqual(sealed.written_keys, ["a", "c"]);
    assert.deepEqual(sealed.already_present_keys, ["b"]);
    const flat = chunks.flatMap((chunk) => chunk.entries).map((entry) => entry.key);
    assert.deepEqual(flat, ["a", "b", "c"], "no key may appear twice across chunks");
  }

  // A contradiction must still fail, and must fail before anything is enqueued.
  {
    const chunks = [];
    const attempt = make(4, chunks);
    await attempt.record("x", { written: true, alreadyPresent: false });
    await assert.rejects(() => attempt.record("x", { written: false, alreadyPresent: true }), /contradictory outcomes/);
    const sealed = await attempt.seal({ sealedAt: SEALED });
    assert.equal(sealed.counts.written, 1);
    assert.deepEqual(chunks.flatMap((chunk) => chunk.entries).map((entry) => entry.key), ["x"]);
  }
}

// --- recovery rejects malformed chunks instead of silently dropping them ---
{
  const { buildAttemptAdmission, recoverOpenAttempt } = await import("./lib/cloud-data-plane-attempt-record.mjs");
  const admission = buildAttemptAdmission({ family: "f", generationId: GEN, attemptId: ATTEMPT, admittedAt: STARTED });
  const chunk = {
    schema_version: ATTEMPT_RECORD_SCHEMA,
    generation_id: GEN,
    attempt_id: ATTEMPT,
    sequence: 0,
    reason: "threshold",
    entries: [{ key: "a", outcome: "written" }],
  };
  assert.equal(recoverOpenAttempt({ admission, chunks: [chunk], checkpointEvery: 2 }).known_written_keys.length, 1);

  const malformed = [
    [{ ...chunk, schema_version: "x" }, "schema must be"],
    [{ ...chunk, sequence: "0" }, "non-integer sequence"],
    [{ ...chunk, entries: "nope" }, "entries must be an array"],
    [{ ...chunk, entries: [{ outcome: "written" }] }, "entry with no key"],
    [{ ...chunk, entries: [{ key: "a", outcome: "maybe" }] }, "unknown outcome"],
    [null, "is not an object"],
  ];
  for (const [value, fragment] of malformed) {
    assertThrows(() => recoverOpenAttempt({ admission, chunks: [value], checkpointEvery: 2 }), fragment);
  }
  // Chunks that disagree about a key are a contradiction surviving into recovery.
  assertThrows(
    () => recoverOpenAttempt({
      admission,
      chunks: [chunk, { ...chunk, sequence: 1, entries: [{ key: "a", outcome: "already_present" }] }],
      checkpointEvery: 2,
    }),
    "checkpoints disagree about a",
  );
}

// --- checkpointEvery is derived from policy, not chosen ---
{
  const { deriveCheckpointEvery } = await import("./lib/cloud-data-plane-attempt-record.mjs");
  const derived = deriveCheckpointEvery({
    maxUnknownKeys: 249,
    keysPerAttempt: 5605,
    attemptsPerMonth: 30,
    classAHeadroomPerMonth: 10_000,
  });
  assert.equal(derived.checkpoint_every, 250, "the interval is the tolerated unknown bound plus one");
  assert.equal(derived.checkpoints_per_attempt, Math.ceil(5605 / 250));
  assert.equal(derived.checkpoint_writes_per_month, derived.checkpoints_per_attempt * 30);
  assert.ok(derived.checkpoint_writes_per_month <= 10_000);

  // Both constraints bite: too tight an unknown bound costs more writes than the
  // budget allows, and the refusal names the trade rather than silently widening.
  assertThrows(
    () => deriveCheckpointEvery({ maxUnknownKeys: 0, keysPerAttempt: 5605, attemptsPerMonth: 30, classAHeadroomPerMonth: 10_000 }),
    "over the 10000 declared headroom",
  );
  assertThrows(() => deriveCheckpointEvery({ keysPerAttempt: 1, attemptsPerMonth: 1, classAHeadroomPerMonth: 1 }), "maxUnknownKeys is required");
  // These inputs are policy, and this test supplies illustrative values only —
  // no production interval is fixed here.
}

process.stdout.write("test-cloud-data-plane-attempt-record: ok\n");
