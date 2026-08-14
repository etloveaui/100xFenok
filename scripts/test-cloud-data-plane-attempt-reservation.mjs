import assert from "node:assert/strict";

import {
  ATTEMPT_COUNTER_SCHEMA,
  ATTEMPT_RESERVATION_SCHEMA,
  admissionKey,
  classifyReservationRows,
  counterKey,
  reservationRowSizes,
  reserveAttemptAdmission,
} from "./lib/cloud-data-plane-attempt-reservation.mjs";
import { ATTEMPT_ID_MAX_LENGTH } from "./lib/cloud-data-plane-attempt-record.mjs";

const FAMILY = "stockanalysis-etf";
const ROTATION = "2026-08-14";
const GEN = "gen-2026-08-14";
const NOW = "2026-08-14T12:00:00.000Z";
const WINDOW = 6 * 3600;

// Models one atomic coordinator transaction over a keyed store. It counts
// commits so a test can prove that two keys still mean ONE commit, and counts
// reads and writes so the D1 cost of the split is measured rather than asserted.
function makeCoordinator(seed = {}) {
  const data = new Map(Object.entries(seed));
  let commits = 0;
  let reads = 0;
  let writes = 0;
  return {
    data,
    commits: () => commits,
    reads: () => reads,
    writes: () => writes,
    async transaction(run) {
      const staged = new Map();
      let touched = false;
      const result = await run({
        async get(key) { reads += 1; return staged.has(key) ? staged.get(key) : (data.has(key) ? data.get(key) : null); },
        async put(key, value) { writes += 1; touched = true; staged.set(key, value); },
      });
      // Commit is all-or-nothing: staged writes land together or not at all.
      if (touched) { for (const [key, value] of staged) data.set(key, value); commits += 1; }
      return result;
    },
  };
}

async function reserve(coordinator, overrides = {}) {
  return reserveAttemptAdmission({
    transaction: coordinator.transaction,
    family: FAMILY,
    rotationKey: ROTATION,
    generationId: GEN,
    attemptId: "attempt-1",
    now: NOW,
    admissionReservationCap: 3,
    resumeWindowSeconds: WINDOW,
    ...overrides,
  });
}

async function assertRejects(run, fragment) {
  await assert.rejects(run, (error) => {
    assert.match(error.message, new RegExp(fragment));
    return true;
  });
}

// --- required inputs, none defaulted ---
{
  const coordinator = makeCoordinator();
  await assertRejects(() => reserve(coordinator, { admissionReservationCap: undefined }), "refusing to admit without an enforced bound");
  await assertRejects(() => reserve(coordinator, { resumeWindowSeconds: undefined }), "bound to the resume window");
  await assertRejects(() => reserve(coordinator, { now: "nope" }), "now must be a parsable instant");
  await assertRejects(() => reserveAttemptAdmission({ family: FAMILY }), "transaction function is required");
  await assertRejects(() => reserve(coordinator, { attemptId: "a".repeat(129) }), `over the ${ATTEMPT_ID_MAX_LENGTH}-character identifier bound`);
  assert.equal(coordinator.commits(), 0, "a refused reservation must not write");
}

// --- split rows, one commit ---
{
  const coordinator = makeCoordinator();
  const result = await reserve(coordinator);
  assert.equal(result.admitted, true);
  assert.equal(result.consumed_unit, true);
  assert.equal(result.used, 1);

  // Two keys, one commit. This is the property the split had to preserve.
  assert.equal(coordinator.commits(), 1);
  assert.equal(coordinator.writes(), 2, "admission row and counter row");
  const aKey = admissionKey({ family: FAMILY, rotationKey: ROTATION, attemptId: "attempt-1" });
  const cKey = counterKey({ family: FAMILY, rotationKey: ROTATION });
  assert.equal(coordinator.data.get(aKey).attempt_id, "attempt-1");
  assert.equal(coordinator.data.get(cKey).schema_version, ATTEMPT_COUNTER_SCHEMA);
  assert.equal(coordinator.data.get(cKey).admitted_count, 1);
  // The admission row is keyed by its own identity, so the lookup is a keyed read.
  assert.equal(aKey, `reservations/${FAMILY}/${ROTATION}/attempt-1`);
}

// --- an exact open retry costs no unit and no write ---
{
  const coordinator = makeCoordinator();
  await reserve(coordinator);
  const before = coordinator.writes();
  const retry = await reserve(coordinator);
  assert.equal(retry.admitted, true);
  assert.equal(retry.consumed_unit, false);
  assert.equal(retry.reason, "already_reserved");
  assert.equal(retry.used, 1);
  assert.equal(coordinator.writes(), before, "a retry writes nothing");
  assert.equal(coordinator.commits(), 1);

  await assertRejects(() => reserve(coordinator, { generationId: "gen-other" }), "already reserved for generation");
}

// --- a stale retry past the resume window fails closed ---
{
  const aKey = admissionKey({ family: FAMILY, rotationKey: ROTATION, attemptId: "attempt-1" });
  const stale = makeCoordinator({
    [aKey]: {
      schema_version: "cloud-data-plane-attempt-admission/v1",
      family: FAMILY, generation_id: GEN, attempt_id: "attempt-1",
      admitted_at: "2026-08-14T00:00:00.000Z", state: "open",
    },
  });
  // Twelve hours old against a six-hour window: no longer resumable, so it is a
  // stale id reappearing rather than a retry in flight.
  await assertRejects(() => reserve(stale), "past the 21600s resume window; a stale retry cannot be admitted");
  assert.equal(stale.commits(), 0);

  // A terminal reservation is not resurrected either.
  for (const state of ["finalized", "failed"]) {
    const terminal = makeCoordinator({
      [aKey]: {
        schema_version: "cloud-data-plane-attempt-admission/v1",
        family: FAMILY, generation_id: GEN, attempt_id: "attempt-1", admitted_at: NOW, state,
      },
    });
    await assertRejects(() => reserve(terminal), `already ${state}; a terminal reservation cannot be retried`);
  }
}

// --- the cap refuses before anything is written ---
{
  const coordinator = makeCoordinator();
  for (const attemptId of ["a", "b", "c"]) await reserve(coordinator, { attemptId });
  assert.equal(coordinator.commits(), 3);

  const writesBefore = coordinator.writes();
  const refused = await reserve(coordinator, { attemptId: "d" });
  assert.equal(refused.admitted, false);
  assert.equal(refused.reason, "cap_exhausted");
  assert.equal(refused.admission, null, "a refused attempt gets no admission, so it cannot start writing objects");
  assert.equal(coordinator.writes(), writesBefore, "a refusal writes nothing");

  // At a full cap an exact open retry is still admitted: it is not a new attempt.
  const retryAtCap = await reserve(coordinator, { attemptId: "b" });
  assert.equal(retryAtCap.admitted, true);
  assert.equal(retryAtCap.consumed_unit, false);
}

// --- a counter or row from the wrong family/rotation is a fault, not a fresh budget ---
{
  const cKey = counterKey({ family: FAMILY, rotationKey: ROTATION });
  const cases = [
    [{ [cKey]: { schema_version: ATTEMPT_COUNTER_SCHEMA, family: "other", rotation_key: ROTATION, admitted_count: 0 } }, "belongs to family other"],
    [{ [cKey]: { schema_version: ATTEMPT_COUNTER_SCHEMA, family: FAMILY, rotation_key: "2026-08-13", admitted_count: 0 } }, "belongs to rotation 2026-08-13"],
    [{ [cKey]: { schema_version: "x", family: FAMILY, rotation_key: ROTATION, admitted_count: 0 } }, "counter schema must be"],
    [{ [cKey]: { schema_version: ATTEMPT_COUNTER_SCHEMA, family: FAMILY, rotation_key: ROTATION, admitted_count: -1 } }, "non-negative integer"],
  ];
  for (const [seed, fragment] of cases) await assertRejects(() => reserve(makeCoordinator(seed)), fragment);

  // An admission row whose contents disagree with its key is two identities.
  const aKey = admissionKey({ family: FAMILY, rotationKey: ROTATION, attemptId: "attempt-1" });
  await assertRejects(
    () => reserve(makeCoordinator({
      [aKey]: {
        schema_version: "cloud-data-plane-attempt-admission/v1",
        family: FAMILY, generation_id: GEN, attempt_id: "someone-else", admitted_at: NOW, state: "open",
      },
    })),
    "is for attempt someone-else",
  );
}

// --- the split makes the cap independent of row size ---
{
  const worst = reservationRowSizes({ idLength: ATTEMPT_ID_MAX_LENGTH });
  assert.equal(worst.id_length, 128);
  assert.ok(worst.admission_row_bytes < worst.declared_row_bytes, `admission row ${worst.admission_row_bytes} must fit ${worst.declared_row_bytes}`);
  assert.ok(worst.counter_row_bytes < worst.declared_row_bytes, `counter row ${worst.counter_row_bytes} must fit ${worst.declared_row_bytes}`);
  assert.equal(worst.cap_independent, true);

  // The point of the rebuild: a large cap is now writable, where the single-array
  // shape held exactly one reservation at this identifier length.
  const coordinator = makeCoordinator();
  for (let index = 0; index < 25; index += 1) {
    const result = await reserve(coordinator, { attemptId: `attempt-${index}`, admissionReservationCap: 25 });
    assert.equal(result.admitted, true, `attempt ${index} must be admissible at a cap of 25`);
  }
  assert.equal(coordinator.data.get(counterKey({ family: FAMILY, rotationKey: ROTATION })).admitted_count, 25);
}

// --- reservation rows have a bounded lifecycle, bound to the resume window ---
{
  const row = (attemptId, admittedAt) => ({
    schema_version: "cloud-data-plane-attempt-admission/v1",
    family: FAMILY, generation_id: GEN, attempt_id: attemptId, admitted_at: admittedAt, state: "open",
  });
  assert.throws(() => classifyReservationRows({ rows: [row("a", NOW)], now: NOW }), /bound to the resume window/);

  const classified = classifyReservationRows({
    rows: [row("fresh", "2026-08-14T11:00:00.000Z"), row("stale", "2026-08-13T00:00:00.000Z")],
    now: NOW,
    resumeWindowSeconds: WINDOW,
  });
  assert.equal(classified.schema_version, ATTEMPT_RESERVATION_SCHEMA);
  assert.deepEqual(classified.live_attempt_ids, ["fresh"]);
  assert.deepEqual(classified.expired_reservations.map((r) => r.attempt_id), ["stale"]);
  // No fifth owner number: the same window governs prepared-receipt protection,
  // retry staleness and reservation-row pruning.
  assert.equal(classified.resume_window_seconds, WINDOW);
}

// --- the counter is an ADMISSION count; no release path exists ---
{
  const module = await import("./lib/cloud-data-plane-attempt-reservation.mjs");
  assert.equal(typeof module.releaseAttemptReservation, "undefined", "no release path exists; the bound is admissions, not failures");
}

// --- coordinator-owned pruning ---
{
  const { pruneExpiredReservations } = await import("./lib/cloud-data-plane-attempt-reservation.mjs");
  const cKey = counterKey({ family: FAMILY, rotationKey: ROTATION });
  const aKey = (id) => admissionKey({ family: FAMILY, rotationKey: ROTATION, attemptId: id });
  const admissionRow = (id, admittedAt) => ({
    schema_version: "cloud-data-plane-attempt-admission/v1",
    family: FAMILY, generation_id: GEN, attempt_id: id, admitted_at: admittedAt, state: "open",
  });

  // A store with list and delete, plus a foreign key the pruner must never touch.
  function makePruneCoordinator(seed) {
    const data = new Map(Object.entries(seed));
    const deleted = [];
    return {
      data, deleted,
      async transaction(run) {
        return run({
          async get(key) { return data.has(key) ? data.get(key) : null; },
          async list(prefix) {
            return [...data.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value }));
          },
          async delete(key) { deleted.push(key); data.delete(key); },
        });
      },
    };
  }

  const seed = () => ({
    [cKey]: { schema_version: ATTEMPT_COUNTER_SCHEMA, family: FAMILY, rotation_key: ROTATION, admitted_count: 3, updated_at: NOW },
    [aKey("stale")]: admissionRow("stale", "2026-08-13T00:00:00.000Z"),
    [aKey("fresh")]: admissionRow("fresh", "2026-08-14T11:00:00.000Z"),
    // The R2 detail authority's namespace. The pruner must not list or delete it.
    "attempts/stockanalysis-etf/gen-1/x.json": { not: "ours" },
  });

  const prune = (coordinator, overrides = {}) => pruneExpiredReservations({
    transaction: coordinator.transaction,
    family: FAMILY, rotationKey: ROTATION, now: NOW, resumeWindowSeconds: WINDOW,
    ...overrides,
  });

  // Required inputs, no defaults.
  await assertRejects(() => prune(makePruneCoordinator(seed()), { resumeWindowSeconds: undefined }), "bound to the resume window");
  await assertRejects(() => prune(makePruneCoordinator(seed()), { now: "nope" }), "now must be a parsable instant");
  await assertRejects(() => pruneExpiredReservations({ family: FAMILY, rotationKey: ROTATION }), "transaction function is required");

  // Dry run is the default: it reports and deletes nothing.
  const dry = makePruneCoordinator(seed());
  const dryResult = await prune(dry);
  assert.equal(dryResult.dry_run, true);
  assert.deepEqual(dryResult.pruned.map((r) => r.attempt_id), ["stale"]);
  assert.deepEqual(dryResult.retained.map((r) => r.attempt_id), ["fresh"]);
  assert.equal(dryResult.retained[0].reason, "still resumable");
  assert.equal(dry.deleted.length, 0, "a dry run must delete nothing");

  // Real prune removes only the expired row; the counter is NOT decremented.
  const live = makePruneCoordinator(seed());
  const result = await prune(live, { dryRun: false });
  assert.deepEqual(live.deleted, [aKey("stale")]);
  assert.equal(live.data.get(cKey).admitted_count, 3, "pruning rows must never return units");
  assert.equal(result.counter_decremented, false);
  assert.equal(result.counter_removed, false, "a rotation with a live row keeps its counter");
  // The other authority's record is untouched and was never in scope.
  assert.equal(live.data.has("attempts/stockanalysis-etf/gen-1/x.json"), true);
  assert.equal(result.authority, "attempt_reservation");
  assert.ok(result.scope_prefix.startsWith("reservations/"));

  // The counter goes only when the rotation itself is past the window and no
  // live row remains.
  const onlyStale = makePruneCoordinator({
    [cKey]: { schema_version: ATTEMPT_COUNTER_SCHEMA, family: FAMILY, rotation_key: ROTATION, admitted_count: 3, updated_at: NOW },
    [aKey("stale")]: admissionRow("stale", "2026-08-13T00:00:00.000Z"),
  });
  const swept = await prune(onlyStale, { dryRun: false, rotationStartedAt: "2026-08-13T00:00:00.000Z" });
  assert.equal(swept.counter_removed, true);
  assert.equal(onlyStale.data.has(cKey), false);

  // Without a rotation start the counter is kept rather than removed on a guess.
  const noStart = makePruneCoordinator({
    [cKey]: { schema_version: ATTEMPT_COUNTER_SCHEMA, family: FAMILY, rotation_key: ROTATION, admitted_count: 3, updated_at: NOW },
    [aKey("stale")]: admissionRow("stale", "2026-08-13T00:00:00.000Z"),
  });
  const kept = await prune(noStart, { dryRun: false });
  assert.equal(kept.counter_removed, false);
  assert.equal(noStart.data.has(cKey), true);

  // Ambiguous clocks abort the whole prune rather than skipping one row: this
  // authority deletes, and a deleter cannot be permissive about time.
  const future = makePruneCoordinator({ [aKey("ahead")]: admissionRow("ahead", "2026-08-20T00:00:00.000Z") });
  await assertRejects(() => prune(future, { dryRun: false }), "refusing to prune under an ambiguous clock");
  assert.equal(future.deleted.length, 0, "an aborted prune deletes nothing");

  const futureRotation = makePruneCoordinator({
    [cKey]: { schema_version: ATTEMPT_COUNTER_SCHEMA, family: FAMILY, rotation_key: ROTATION, admitted_count: 1, updated_at: NOW },
  });
  await assertRejects(
    () => prune(futureRotation, { dryRun: false, rotationStartedAt: "2026-08-20T00:00:00.000Z" }),
    "refusing to prune under an ambiguous clock",
  );

  // Malformed stored state fails closed.
  const malformed = makePruneCoordinator({ [aKey("bad")]: { schema_version: "x" } });
  await assertRejects(() => prune(malformed, { dryRun: false }), "admission schema must be");
}

process.stdout.write("test-cloud-data-plane-attempt-reservation: ok\n");
