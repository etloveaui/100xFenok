import assert from "node:assert/strict";
import {
  WINDDOWN_RECOVERY_MAX_BYTES,
  WINDDOWN_RECOVERY_SEAL_KEY,
  exportWindDownRecoverySnapshot,
  recoveryCopyNameForSnapshot,
  restoreWindDownRecoverySnapshot,
  validateWindDownRecoverySnapshot,
} from "../src/features/mona-vnext/memory/windDownRecovery";

/**
 * Stage 1 contract for the recovery primitive.
 *
 * This executable contract was written before the production module and keeps
 * the RED-to-GREEN boundary explicit. The module must satisfy these checks
 * without changing coordinator routes or initializing the learner profile as
 * a side effect of export.
 */

const PROFILE_STORAGE_KEY = "mona-vnext-learning-profile";
const PROFILE_KV_KEY = "data/mona-vnext/owner-test/learning-profile.json";
const FIXED_CREATED_AT_ISO = "2026-09-06T00:00:00.000Z";
const PAGE_SIZE = 3;

type ListOptions = {
  limit?: number;
  startAfter?: string;
  prefix?: string;
  reverse?: boolean;
};

type StorageTransaction = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  list(options?: ListOptions): Promise<Map<string, unknown>>;
};

function compareUtf8Keys(left: string, right: string): number {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const sharedLength = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = leftBytes[index] - rightBytes[index];
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

/** A deterministic synthetic SQLite DO storage with rollback and paging. */
class MemoryCoordinatorStorage {
  readonly values = new Map<string, unknown>();
  readonly listCalls: ListOptions[] = [];
  readonly writes: string[] = [];
  readonly transactionCalls: number[] = [];
  failOnPutKey: string | null = null;

  constructor(initial: Map<string, unknown> = new Map()) {
    for (const [key, value] of initial) {
      this.values.set(key, structuredClone(value));
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    return structuredClone(this.values.get(key)) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    if (key === this.failOnPutKey) {
      throw new Error(`CONTROLLED_PUT_FAILURE:${key}`);
    }
    this.writes.push(key);
    this.values.set(key, structuredClone(value));
  }

  async list(options: ListOptions = {}): Promise<Map<string, unknown>> {
    this.listCalls.push({ ...options });
    const startAfter = options.startAfter;
    const prefix = options.prefix;
    const keys = [...this.values.keys()]
      .filter((key) => !prefix || key.startsWith(prefix))
      .filter((key) => !startAfter || compareUtf8Keys(key, startAfter) > 0)
      .sort(compareUtf8Keys);
    const ordered = options.reverse ? keys.reverse() : keys;
    const page = options.limit === undefined
      ? ordered
      : ordered.slice(0, options.limit);
    return new Map(page.map((key) => [key, structuredClone(this.values.get(key))]));
  }

  async transaction<T>(callback: (transaction: StorageTransaction) => Promise<T>): Promise<T> {
    this.transactionCalls.push(this.transactionCalls.length + 1);
    const before = new Map(
      [...this.values.entries()].map(([key, value]) => [key, structuredClone(value)]),
    );
    const writeCount = this.writes.length;
    try {
      return await callback({
        get: this.get.bind(this),
        put: this.put.bind(this),
        list: this.list.bind(this),
      });
    } catch (error) {
      this.values.clear();
      for (const [key, value] of before) this.values.set(key, value);
      this.writes.splice(writeCount);
      throw error;
    }
  }
}

class MemoryLegacyKv {
  readonly reads: string[] = [];

  constructor(private readonly rawValue: string | null) {}

  async get(key: string): Promise<string | null> {
    this.reads.push(key);
    return this.rawValue;
  }
}

function buildCoordinatorRecords(includeProfile = true): Map<string, unknown> {
  const records = new Map<string, unknown>();
  if (includeProfile) {
    records.set(PROFILE_STORAGE_KEY, {
      schemaVersion: 1,
      source: "mona-vnext-fsrs",
      updatedAt: "2026-09-05T13:37:00.000Z",
      records: {
        "expression-z": {
          card: {
            state: 3,
            dueAtIso: "2026-09-04T00:00:00.000Z",
            stability: 11.25,
            difficulty: 6.75,
            reps: 17,
            lapses: 2,
          },
          lastVerdict: "variant",
          opaqueExtension: { preserved: true, sourceOrder: ["z", "a"] },
        },
      },
    });
  }
  records.set("winddown-habit-events", [
    {
      schemaVersion: 1,
      eventId: "habit-event-001",
      occurredAtIso: "2026-09-05T14:00:00.000Z",
      source: { kind: "learn-credit-receipt", receiptId: "learn-receipt-001" },
    },
  ]);
  records.set("winddown-learn-session:2026-09-05", {
    schemaVersion: 1,
    manifest: {
      sessionId: "learn-session-001",
      habitKstDay: "2026-09-05",
      seed: "2026-09-05:learn",
      cardIds: ["card-z", "card-a"],
    },
    state: { queue: [], creditedCardIds: ["card-z"], mistakes: [] },
  });
  records.set("winddown-learn-attempt:learn-session-001:1", {
    schemaVersion: 1,
    attemptId: "learn-session-001:1",
    requestDigest: "b".repeat(64),
    outcome: "correct",
    reward: 1,
    state: { isComplete: false, creditedCardIds: ["card-z"] },
    completionReceipt: null,
  });
  records.set("winddown-review-receipt:review-cycle-001", {
    schemaVersion: 1,
    reviewCycleId: "review-cycle-001",
    materialId: "expression-z",
    reviewedAt: "2026-09-05T15:00:00.000Z",
    inputMode: "typed",
    rating: "good",
    reward: 1,
    opaqueExtension: { keep: "exactly" },
  });
  records.set("winddown-voice-report:voice-session-001", {
    schemaVersion: 1,
    activity: "roleplay",
    productSessionId: "voice-session-001",
    finalDigest: "c".repeat(64),
    report: {
      turns: [{ turnSeq: 1, userText: "I am ready.", modelText: "Great." }],
      metrics: { turnCount: 1 },
    },
  });
  records.set("winddown-game-ceremony:v1", {
    schemaVersion: 1,
    slots: {
      dawn: { optionId: "option-a", committedAtIso: "2026-09-05T16:00:00.000Z" },
      dusk: null,
    },
    metadata: { source: "synthetic-fixture", keep: true },
  });

  // Unknown/future coordinator records must survive a full namespace export.
  for (let index = 1; index <= 9; index += 1) {
    const key = `winddown-future-record:${String(index).padStart(2, "0")}`;
    records.set(key, {
      schemaVersion: 1,
      recordNumber: index,
      nested: { keep: `future-${index}` },
    });
  }
  return records;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function errorHasCode(error: unknown, code: string): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === code
    || (typeof candidate.message === "string" && candidate.message.includes(code));
}

async function expectRecoveryError(
  operation: () => Promise<unknown>,
  code: string,
) {
  await assert.rejects(operation, (error: unknown) => errorHasCode(error, code));
}

function assertRawRecords(
  snapshot: { records: Array<{ key: string; value: unknown }> },
  expected: Map<string, unknown>,
) {
  assert.equal(snapshot.records.length, expected.size);
  assert.deepEqual(
    snapshot.records.map((record) => record.key),
    [...expected.keys()].sort(compareUtf8Keys),
  );
  for (const [key, value] of expected) {
    const record = snapshot.records.find((candidate) => candidate.key === key);
    assert(record, `snapshot is missing coordinator key: ${key}`);
    assert.deepEqual(record.value, value, `raw value changed for ${key}`);
    // Structural equality alone can hide key-order/JSON-byte changes.
    assert.equal(JSON.stringify(record.value), JSON.stringify(value));
  }
}

async function main() {
  const sourceRecords = buildCoordinatorRecords();
  const source = new MemoryCoordinatorStorage(sourceRecords);
  const legacy = new MemoryLegacyKv(null);

  const snapshot = await exportWindDownRecoverySnapshot({
    storage: source,
    legacyKv: legacy,
    legacyProfileKey: PROFILE_KV_KEY,
    pageSize: PAGE_SIZE,
    maxBytes: 2_000_000,
    createdAtIso: FIXED_CREATED_AT_ISO,
  });

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.kind, "winddown-coordinator-recovery-snapshot");
  assert.equal(snapshot.createdAtIso, FIXED_CREATED_AT_ISO);
  assert.equal(snapshot.recordCount, sourceRecords.size);
  assert.ok(snapshot.snapshotDigest && /^[a-f0-9]{64}$/.test(snapshot.snapshotDigest));
  assertRawRecords(snapshot, sourceRecords);
  assert.deepEqual(snapshot.legacyKvRecords, []);
  assert.equal(source.writes.length, 0, "export must never initialize or mutate the DO");
  assert.deepEqual(legacy.reads, [], "legacy KV is not read when the DO profile exists");
  assert.ok(snapshot.records.length > PAGE_SIZE, "fixture must exercise more than one page");
  assert.ok(source.listCalls.length > 1, "export must page the full SQLite namespace");
  assert(
    source.listCalls.every(
      (options) => Number.isInteger(options.limit) && options.limit! > 0 && options.limit! <= PAGE_SIZE,
    ),
    "every SQLite list call must carry a bounded page limit",
  );
  assert(
    source.listCalls.slice(1).every((options) => typeof options.startAfter === "string"),
    "subsequent pages must advance with startAfter",
  );

  const validation = validateWindDownRecoverySnapshot(snapshot);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.errors, []);

  const repeatedSnapshot = await exportWindDownRecoverySnapshot({
    storage: new MemoryCoordinatorStorage(sourceRecords),
    pageSize: PAGE_SIZE,
    maxBytes: 2_000_000,
    createdAtIso: FIXED_CREATED_AT_ISO,
  });
  assert.equal(
    repeatedSnapshot.snapshotDigest,
    snapshot.snapshotDigest,
    "fixed input and timestamp must produce a stable snapshot checksum",
  );

  const tampered = clone(snapshot);
  const tamperedRecord = tampered.records.find((record) => record.key === PROFILE_STORAGE_KEY);
  assert(tamperedRecord && tamperedRecord.value && typeof tamperedRecord.value === "object");
  (tamperedRecord.value as Record<string, unknown>).tampered = true;
  const tamperedValidation = validateWindDownRecoverySnapshot(tampered);
  assert.equal(tamperedValidation.ok, false, "value corruption must fail checksum validation");
  assert.ok(tamperedValidation.errors.length > 0);
  await expectRecoveryError(
    () => restoreWindDownRecoverySnapshot({
      storage: new MemoryCoordinatorStorage(),
      snapshot: tampered,
      targetName: recoveryCopyNameForSnapshot(snapshot.snapshotDigest),
    }),
    "WINDDOWN_RECOVERY_SNAPSHOT_INVALID",
  );

  const unknownFieldSnapshot = clone(snapshot) as typeof snapshot & {
    unknownFutureField?: unknown;
  };
  unknownFieldSnapshot.unknownFutureField = { mustNotBeIgnored: true };
  const unknownFieldValidation = validateWindDownRecoverySnapshot(unknownFieldSnapshot);
  assert.equal(unknownFieldValidation.ok, false, "unknown envelope fields must not be silently ignored");

  const poisoned = clone(snapshot);
  poisoned.records.push({
    key: WINDDOWN_RECOVERY_SEAL_KEY,
    value: { schemaVersion: 1, kind: "forged-seal", recoveryOnly: false },
  });
  const poisonedValidation = validateWindDownRecoverySnapshot(poisoned);
  assert.equal(poisonedValidation.ok, false, "uploaded snapshots cannot supply the reserved seal key");
  const poisonedTarget = new MemoryCoordinatorStorage();
  await expectRecoveryError(
    () => restoreWindDownRecoverySnapshot({
      storage: poisonedTarget,
      snapshot: poisoned,
      targetName: recoveryCopyNameForSnapshot(snapshot.snapshotDigest),
    }),
    "WINDDOWN_RECOVERY_SNAPSHOT_INVALID",
  );
  assert.equal(poisonedTarget.writes.length, 0);

  const sizeLimitedSource = new MemoryCoordinatorStorage(sourceRecords);
  await expectRecoveryError(
    () => exportWindDownRecoverySnapshot({
      storage: sizeLimitedSource,
      pageSize: PAGE_SIZE,
      maxBytes: 1,
      createdAtIso: FIXED_CREATED_AT_ISO,
    }),
    "WINDDOWN_RECOVERY_TOO_LARGE",
  );
  assert.equal(
    sizeLimitedSource.listCalls.length,
    1,
    "an over-budget page must fail before collecting the full namespace",
  );

  for (const unsafe of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, undefined, BigInt(1)]) {
    const unsafeSource = new MemoryCoordinatorStorage(
      new Map([["winddown-unsafe", { unsafe }]]),
    );
    await expectRecoveryError(
      () => exportWindDownRecoverySnapshot({
        storage: unsafeSource,
        pageSize: PAGE_SIZE,
        maxBytes: 2_000_000,
        createdAtIso: FIXED_CREATED_AT_ISO,
      }),
      "WINDDOWN_RECOVERY_JSON_UNSAFE",
    );
  }

  const legacyRaw = '{"schemaVersion":1,"source":"legacy-kv","records":{"expression-z":{"card":{"state":3}}}}\n';
  const noProfileRecords = buildCoordinatorRecords(false);
  const noProfileSource = new MemoryCoordinatorStorage(noProfileRecords);
  const fallbackKv = new MemoryLegacyKv(legacyRaw);
  const fallbackSnapshot = await exportWindDownRecoverySnapshot({
    storage: noProfileSource,
    legacyKv: fallbackKv,
    legacyProfileKey: PROFILE_KV_KEY,
    pageSize: PAGE_SIZE,
    maxBytes: 2_000_000,
    createdAtIso: FIXED_CREATED_AT_ISO,
  });
  assert.equal(
    fallbackSnapshot.records.some((record) => record.key === PROFILE_STORAGE_KEY),
    false,
    "legacy fallback must not invent a normalized DO profile record",
  );
  assert.deepEqual(fallbackSnapshot.legacyKvRecords, [
    { key: PROFILE_KV_KEY, rawValue: legacyRaw },
  ]);
  assert.deepEqual(fallbackKv.reads, [PROFILE_KV_KEY]);
  assert.equal(noProfileSource.writes.length, 0);
  assert.equal(fallbackSnapshot.snapshotDigest !== snapshot.snapshotDigest, true);
  assert.equal(validateWindDownRecoverySnapshot(fallbackSnapshot).ok, true);

  const fallbackTarget = new MemoryCoordinatorStorage();
  const fallbackTargetName = recoveryCopyNameForSnapshot(fallbackSnapshot.snapshotDigest);
  const fallbackRestore = await restoreWindDownRecoverySnapshot({
    storage: fallbackTarget,
    snapshot: fallbackSnapshot,
    targetName: fallbackTargetName,
    maxBytes: 2_000_000,
  });
  assert.equal(fallbackRestore.legacyRecordCount, 1);
  assert.equal(
    fallbackTarget.values.get(
      `winddown-recovery:legacy:${encodeURIComponent(PROFILE_KV_KEY)}`,
    ),
    legacyRaw,
    "legacy fallback must restore the original raw KV string in the separate copy",
  );

  const boundarySource = new MemoryCoordinatorStorage(
    new Map([["winddown-boundary", { payload: "b".repeat(4_900_000) }]]),
  );
  const boundaryPreview = await exportWindDownRecoverySnapshot({
    storage: boundarySource,
    pageSize: PAGE_SIZE,
    maxBytes: WINDDOWN_RECOVERY_MAX_BYTES,
    createdAtIso: FIXED_CREATED_AT_ISO,
  });
  assert.ok(
    boundaryPreview.byteCount > WINDDOWN_RECOVERY_MAX_BYTES - 200_000
      && boundaryPreview.byteCount <= WINDDOWN_RECOVERY_MAX_BYTES,
    "boundary fixture must remain valid while exercising the transport ceiling",
  );
  const boundarySnapshot = await exportWindDownRecoverySnapshot({
    storage: new MemoryCoordinatorStorage(
      new Map([["winddown-boundary", { payload: "b".repeat(4_900_000) }]]),
    ),
    pageSize: PAGE_SIZE,
    maxBytes: boundaryPreview.byteCount,
    createdAtIso: FIXED_CREATED_AT_ISO,
  });
  const boundaryTarget = new MemoryCoordinatorStorage();
  const boundaryRestore = await restoreWindDownRecoverySnapshot({
    storage: boundaryTarget,
    snapshot: boundarySnapshot,
    targetName: recoveryCopyNameForSnapshot(boundarySnapshot.snapshotDigest),
    maxBytes: boundarySnapshot.byteCount,
  });
  assert.equal(boundaryRestore.duplicate, false);
  assert.deepEqual(
    boundaryTarget.values.get("winddown-boundary"),
    boundarySnapshot.records.find((record) => record.key === "winddown-boundary")?.value,
    "a valid near-limit snapshot must restore before its internal seal metadata is counted",
  );

  const targetName = recoveryCopyNameForSnapshot(snapshot.snapshotDigest);
  assert.equal(targetName, `recoverycopy:${snapshot.snapshotDigest}`);
  const target = new MemoryCoordinatorStorage();
  const first = await restoreWindDownRecoverySnapshot({
    storage: target,
    snapshot,
    targetName,
    maxBytes: 2_000_000,
  });
  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  assert.equal(first.targetName, targetName);
  assert.equal(first.snapshotDigest, snapshot.snapshotDigest);
  assert.equal(first.recordCount, sourceRecords.size);
  assert(first.receipt && typeof first.receipt === "object");
  assert.ok(target.listCalls.length > 1, "first restore must page a complete read-back verification");
  assert.equal(
    (first.receipt as Record<string, unknown>).receiptId,
    `winddown-recovery:${snapshot.snapshotDigest}`,
  );

  for (const [key, value] of sourceRecords) {
    assert.deepEqual(target.values.get(key), value, `restore changed raw value for ${key}`);
  }
  const seal = target.values.get(WINDDOWN_RECOVERY_SEAL_KEY);
  assert(seal && typeof seal === "object" && !Array.isArray(seal));
  assert.equal((seal as Record<string, unknown>).schemaVersion, 1);
  assert.equal((seal as Record<string, unknown>).kind, "winddown-recovery-seal");
  assert.equal((seal as Record<string, unknown>).targetName, targetName);
  assert.equal((seal as Record<string, unknown>).snapshotDigest, snapshot.snapshotDigest);
  assert.equal((seal as Record<string, unknown>).recoveryOnly, true);

  const writeCountAfterFirstRestore = target.writes.length;
  const duplicate = await restoreWindDownRecoverySnapshot({
    storage: target,
    snapshot,
    targetName,
    maxBytes: 2_000_000,
  });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.receipt, first.receipt, "duplicate restore must return the verified receipt");
  assert.equal(target.writes.length, writeCountAfterFirstRestore, "duplicate restore must not write");

  target.values.set(PROFILE_STORAGE_KEY, { corruptedAfterRestore: true });
  await expectRecoveryError(
    () => restoreWindDownRecoverySnapshot({ storage: target, snapshot, targetName }),
    "WINDDOWN_RECOVERY_TARGET_CORRUPT",
  );
  assert.equal(target.writes.length, writeCountAfterFirstRestore);

  for (const unsafeTargetName of [
    PROFILE_STORAGE_KEY,
    "mona-vnext-learning-profile-qa-v1",
    "mona-vnext-learning-profile-qa",
    "production",
    "",
  ]) {
    const unsafeTarget = new MemoryCoordinatorStorage();
    await expectRecoveryError(
      () => restoreWindDownRecoverySnapshot({
        storage: unsafeTarget,
        snapshot,
        targetName: unsafeTargetName,
      }),
      "WINDDOWN_RECOVERY_TARGET_INVALID",
    );
    assert.equal(unsafeTarget.writes.length, 0);
  }

  const nonEmptyTarget = new MemoryCoordinatorStorage(
    new Map([["existing-coordinator-record", { keep: true }]]),
  );
  await expectRecoveryError(
    () => restoreWindDownRecoverySnapshot({ storage: nonEmptyTarget, snapshot, targetName }),
    "WINDDOWN_RECOVERY_TARGET_NOT_EMPTY",
  );
  assert.equal(nonEmptyTarget.writes.length, 0);

  const sizeLimitedTarget = new MemoryCoordinatorStorage();
  await expectRecoveryError(
    () => restoreWindDownRecoverySnapshot({
      storage: sizeLimitedTarget,
      snapshot,
      targetName,
      maxBytes: 1,
    }),
    "WINDDOWN_RECOVERY_TOO_LARGE",
  );
  assert.equal(sizeLimitedTarget.writes.length, 0, "size failure must happen before restore writes");

  const rollbackTarget = new MemoryCoordinatorStorage();
  rollbackTarget.failOnPutKey = [...sourceRecords.keys()][2] ?? null;
  await expectRecoveryError(
    () => restoreWindDownRecoverySnapshot({ storage: rollbackTarget, snapshot, targetName }),
    "CONTROLLED_PUT_FAILURE",
  );
  assert.equal(rollbackTarget.values.size, 0, "failed restore must roll back every record and the seal");
  assert.equal(rollbackTarget.writes.length, 0);
  assert.ok(rollbackTarget.transactionCalls.length > 0, "restore must use one atomic transaction");

  const nonEmptyCopy = new MemoryCoordinatorStorage(
    new Map([["unrelated", { keep: "do-not-overwrite" }]]),
  );
  const nonEmptyBefore = clone([...nonEmptyCopy.values.entries()]);
  await expectRecoveryError(
    () => restoreWindDownRecoverySnapshot({ storage: nonEmptyCopy, snapshot, targetName }),
    "WINDDOWN_RECOVERY_TARGET_NOT_EMPTY",
  );
  assert.deepEqual([...nonEmptyCopy.values.entries()], nonEmptyBefore);

  console.log(
    JSON.stringify(
      {
        status: "PASS",
        recordsPreserved: sourceRecords.size,
        pageSize: PAGE_SIZE,
        listPages: source.listCalls.length,
        legacyFallbackRecords: fallbackSnapshot.legacyKvRecords.length,
        snapshotDigest: snapshot.snapshotDigest,
        duplicateRestoreVerified: duplicate.duplicate,
        rollbackVerified: rollbackTarget.values.size === 0,
      },
      null,
      2,
    ),
  );
}

void main();
