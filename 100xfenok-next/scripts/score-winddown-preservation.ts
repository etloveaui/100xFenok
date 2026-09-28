import assert from "node:assert/strict";
import { State } from "ts-fsrs";
import {
  applyMonaVnextLearningEvents,
  createEmptyMonaVnextLearningProfile,
  normalizeMonaVnextLearningProfile,
  type MonaVnextLearningProfile,
  type MonaVnextLearningRecord,
} from "../src/features/mona-vnext/memory/fsrsLearningProfile";
import {
  handleMonaVnextProfileCoordinatorRequest,
  type WindDownReviewCoordinatorEnv,
  type WindDownReviewCoordinatorState,
} from "../src/features/mona-vnext/memory/learningProfileCoordinator";
import { buildLearningEvent } from "../src/features/mona-vnext/memory/srsBridge";
import {
  createWindDownReviewCycleId,
  type WindDownReviewCycleInput,
} from "../src/features/winddown/server/reviewCycle";
import {
  createWindDownHabitCompletionEvent,
  type WindDownHabitCompletionEvent,
} from "../src/features/winddown/habit/domain";
import {
  WIND_DOWN_DO_VALUE_BYTE_LIMIT,
  WIND_DOWN_PAGE_VALUE_BYTE_LIMIT,
  WIND_DOWN_PROFILE_LEGACY_KV_SOURCE_KEY,
  WIND_DOWN_PROFILE_LEGACY_KV_SOURCE_CHUNK_PREFIX,
  WIND_DOWN_PROFILE_LEGACY_KV_SOURCE_MANIFEST_KEY,
  readMonaVnextLearningProfile,
  readWindDownLegacyKvSource,
  readWindDownHabitEvents,
} from "../src/features/mona-vnext/memory/windDownPagedStorage";

/**
 * Stage 1 regression suite for the lossless storage implementation. It keeps
 * legacy single-key rows intact, copies them forward once on the first write
 * into deterministic byte-bounded pages, and publishes a manifest only after
 * every page is present. Later writes append to a habit tail page or mutate
 * changed profile pages. Reads use a complete manifest and list cursor, or
 * the untouched legacy row when no manifest exists; a partial manifest fails
 * closed.
 *
 * Habit pages should hold immutable receipt-backed events. The coordinator
 * must load all pages for streak, XP, and game projections while leaving the
 * mobile questHistory output capped at its existing presentation limit. A
 * receipt/event idempotence index makes a retry re-use its event identity and
 * never append a second event. Review, Learn, and voice receipts stay
 * independently addressable, including their existing receipt keys.
 *
 * Profile records and applied event IDs need separate paged collections so
 * neither has a retention cap. Reconstruct the existing profile shape with
 * the exact expression IDs and FSRS fields, keep the old profile row as an
 * untouched compatibility source, mutate only changed profile pages, and
 * atomically publish page metadata after copy-forward. The Durable Object
 * remains authoritative; the KV mirror is a scoped, retryable projection that
 * carries the complete profile. A mirror failure must
 * leave the committed DO receipt/state intact so a duplicate retry repairs it.
 * When a legacy KV seed is used, persist its exact raw string under a separate
 * original-source DO key before writing any normalized profile or mirror; never
 * overwrite that source copy.
 */

const HABIT_EVENTS_STORAGE_KEY = "winddown-habit-events";
const PROFILE_STORAGE_KEY = "mona-vnext-learning-profile";
const CONTENT_DIGEST = "a".repeat(64);

type JsonBody = Record<string, unknown>;

type StorageListOptions = {
  limit?: number;
  startAfter?: string;
  prefix?: string;
  reverse?: boolean;
};

type StorageTransaction = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
};

type CoordinatorHarnessOptions = {
  legacyKvRaw?: string | null;
};

type CoordinatorHarness = {
  values: Map<string, unknown>;
  state: WindDownReviewCoordinatorState;
  env: WindDownReviewCoordinatorEnv;
  command(body: JsonBody): Promise<{
    response: Response;
    body: JsonBody;
  }>;
};

function cloneForStorage<T>(value: T): T {
  return structuredClone(value);
}

function serializedValueByteLength(value: unknown) {
  const serialized = JSON.stringify(value);
  assert.equal(typeof serialized, "string");
  return new TextEncoder().encode(serialized).byteLength;
}

function assertStorageValueFits(value: unknown) {
  assert(
    serializedValueByteLength(value) <= WIND_DOWN_DO_VALUE_BYTE_LIMIT,
    `synthetic DO value exceeds ${WIND_DOWN_DO_VALUE_BYTE_LIMIT} bytes`,
  );
}

function createCoordinatorHarness(
  seed: Record<string, unknown> = {},
  options: CoordinatorHarnessOptions = {},
): CoordinatorHarness {
  const values = new Map<string, unknown>();
  const writes: string[] = [];
  const listCalls: StorageListOptions[] = [];
  for (const [key, value] of Object.entries(seed)) {
    assertStorageValueFits(value);
    values.set(key, cloneForStorage(value));
  }

  const storage = {
    async get<T>(key: string) {
      return cloneForStorage(values.get(key)) as T | undefined;
    },
    async put<T>(key: string, value: T) {
      assertStorageValueFits(value);
      writes.push(key);
      values.set(key, cloneForStorage(value));
    },
    async list(options: StorageListOptions = {}) {
      listCalls.push({ ...options });
      const startAfter = options.startAfter;
      const prefix = options.prefix;
      const keys = [...values.keys()]
        .filter((key) => !prefix || key.startsWith(prefix))
        .filter((key) => !startAfter || key > startAfter)
        .sort((left, right) => left.localeCompare(right));
      const ordered = options.reverse ? keys.reverse() : keys;
      const page = options.limit === undefined
        ? ordered
        : ordered.slice(0, options.limit);
      return new Map(
        page.map((key) => [key, cloneForStorage(values.get(key))]),
      );
    },
    async transaction<T>(
      callback: (transaction: StorageTransaction) => Promise<T>,
    ) {
      const before = new Map(
        [...values.entries()].map(([key, value]) => [key, cloneForStorage(value)]),
      );
      const writeCount = writes.length;
      try {
        return await callback(storage);
      } catch (error) {
        values.clear();
        for (const [key, value] of before) values.set(key, value);
        writes.splice(writeCount);
        throw error;
      }
    },
  };
  const state: WindDownReviewCoordinatorState = {
    storage,
    blockConcurrencyWhile: async <T>(callback: () => Promise<T>) => callback(),
  };
  const env: WindDownReviewCoordinatorEnv = {
    MONA_VNEXT_KV: {
      async get() {
        return options.legacyKvRaw ?? null;
      },
      async put() {
        return undefined;
      },
    },
  };

  return {
    values,
    state,
    env,
    async command(body: JsonBody) {
      const response = await handleMonaVnextProfileCoordinatorRequest(
        state,
        env,
        new Request("https://winddown.internal/profile-coordinator", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      const parsed = await response.json();
      assert(parsed && typeof parsed === "object" && !Array.isArray(parsed));
      return { response, body: parsed as JsonBody };
    },
  };
}

function isoForDayOffset(offset: number, start = "2022-01-01T12:00:00.000Z") {
  const startMs = Date.parse(start);
  assert(Number.isFinite(startMs));
  return new Date(startMs + offset * 86_400_000).toISOString();
}

function syntheticLegacyHabitEvents(count: number): WindDownHabitCompletionEvent[] {
  return Array.from({ length: count }, (_, index) => {
    const serial = String(index).padStart(4, "0");
    return createWindDownHabitCompletionEvent({
      kind: "learn-credit-receipt",
      receipt: {
        schemaVersion: 1,
        activity: "learn",
        receiptId: `synthetic-legacy-receipt-${serial}`,
        sessionId: `synthetic-legacy-session-${serial}`,
        persistedAtIso: isoForDayOffset(index),
        creditedActionCount: 5,
        completion: "five-exercises",
        persisted: true,
      },
    });
  });
}

function eventIds(events: readonly WindDownHabitCompletionEvent[]) {
  return events.map((event) => event.eventId);
}

function assertSameEventIds(
  actual: readonly WindDownHabitCompletionEvent[],
  expected: readonly WindDownHabitCompletionEvent[],
) {
  assert.deepEqual(
    [...new Set(eventIds(actual))].sort(),
    [...new Set(eventIds(expected))].sort(),
  );
}

function syntheticReviewProfile(): {
  profile: MonaVnextLearningProfile;
  materialId: string;
  nowIso: string;
  input: WindDownReviewCycleInput;
  material: { id: string; en: string };
} {
  const materialId = "synthetic-review-material";
  const lastReviewedAt = "2026-01-01T12:00:00.000Z";
  const record: MonaVnextLearningRecord = {
    expressionId: materialId,
    lastVerdict: "canonical",
    lastRating: "good",
    lastReviewedAt,
    lastInputMode: "typed",
    card: {
      dueAtIso: "2026-01-02T12:00:00.000Z",
      stability: 1,
      difficulty: 5,
      elapsedDays: 1,
      scheduledDays: 1,
      learningSteps: 0,
      reps: 1,
      lapses: 0,
      state: State.Review,
      lastReviewAtIso: lastReviewedAt,
    },
  };
  const profile: MonaVnextLearningProfile = {
    ...createEmptyMonaVnextLearningProfile(),
    updatedAt: lastReviewedAt,
    records: { [materialId]: record },
  };
  const nowIso = "2026-08-01T12:00:00.000Z";
  const material = { id: materialId, en: "synthetic answer" };
  const inputBase = {
    schemaVersion: 1 as const,
    activity: "review" as const,
    materialId,
    contentDigest: CONTENT_DIGEST,
    inputMode: "typed" as const,
    attempts: [{ answer: material.en, revealedBefore: false }],
  };

  return {
    profile,
    materialId,
    nowIso,
    input: {
      ...inputBase,
      reviewCycleId: "pending",
    },
    material,
  };
}

async function reviewAppendCommand() {
  const fixture = syntheticReviewProfile();
  const record = fixture.profile.records[fixture.materialId];
  assert(record);
  const reviewCycleId = await createWindDownReviewCycleId({
    materialId: fixture.materialId,
    contentDigest: CONTENT_DIGEST,
    record,
  });
  return {
    ...fixture,
    input: {
      ...fixture.input,
      reviewCycleId,
    },
    body: {
      operation: "commit-review-cycle",
      input: {
        ...fixture.input,
        reviewCycleId,
      },
      material: fixture.material,
      activeMaterialIds: [fixture.materialId],
      currentContentDigest: CONTENT_DIGEST,
      nowIso: fixture.nowIso,
    } satisfies JsonBody,
  };
}

async function caseHabitAppendRetryPreservesHistory() {
  const fixture = await reviewAppendCommand();
  const legacyEvents = syntheticLegacyHabitEvents(1_000);
  const harness = createCoordinatorHarness({
    [PROFILE_STORAGE_KEY]: fixture.profile,
    [HABIT_EVENTS_STORAGE_KEY]: legacyEvents,
  });

  const first = await harness.command(fixture.body);
  assert.equal(first.response.status, 200);
  assert.equal(first.body.duplicate, false);
  const appendedEvent = createWindDownHabitCompletionEvent({
    kind: "review-credit-receipt",
    receipt: first.body.receipt,
  });
  const retry = await harness.command(fixture.body);
  assert.equal(retry.response.status, 200);
  assert.equal(retry.body.duplicate, true);
  const afterRetry = harness.values.get(HABIT_EVENTS_STORAGE_KEY) as
    | WindDownHabitCompletionEvent[]
    | undefined;
  assert(afterRetry);
  assert.equal(afterRetry.length, legacyEvents.length);
  assert.deepEqual(afterRetry, legacyEvents);
  const persisted = await readWindDownHabitEvents(harness.state.storage);
  assert.equal(persisted.length, legacyEvents.length + 1);
  assertSameEventIds(persisted, [...legacyEvents, appendedEvent]);

  const read = await harness.command({
    operation: "read-winddown-habit",
    nowIso: fixture.nowIso,
    ceremonyMaterial: null,
  });
  assert.equal(read.response.status, 200);
  const projection = read.body.projection as {
    questHistory: WindDownHabitCompletionEvent[];
  };
  assert.equal(
    projection.questHistory.filter(
      (event) => event.eventId === appendedEvent.eventId,
    ).length,
    1,
  );
}

async function caseHabitAppendThenReadPreservesHistory() {
  const fixture = await reviewAppendCommand();
  const legacyEvents = syntheticLegacyHabitEvents(1_000);
  const legacyProfile = cloneForStorage(fixture.profile);
  const harness = createCoordinatorHarness({
    [PROFILE_STORAGE_KEY]: fixture.profile,
    [HABIT_EVENTS_STORAGE_KEY]: legacyEvents,
  });

  const first = await harness.command(fixture.body);
  assert.equal(first.response.status, 200);
  const appendedEvent = createWindDownHabitCompletionEvent({
    kind: "review-credit-receipt",
    receipt: first.body.receipt,
  });
  const legacyRaw = harness.values.get(HABIT_EVENTS_STORAGE_KEY) as
    | WindDownHabitCompletionEvent[]
    | undefined;
  assert(legacyRaw);
  assert.equal(legacyRaw.length, 1_000);
  assert.deepEqual(legacyRaw, legacyEvents);
  assert.equal(JSON.stringify(legacyRaw), JSON.stringify(legacyEvents));
  assert.deepEqual(
    harness.values.get(PROFILE_STORAGE_KEY),
    legacyProfile,
    "profile copy-forward must leave the legacy raw row untouched",
  );
  assert.equal(
    JSON.stringify(harness.values.get(PROFILE_STORAGE_KEY)),
    JSON.stringify(legacyProfile),
  );
  const persisted = await readWindDownHabitEvents(harness.state.storage);
  assert.equal(persisted.length, legacyEvents.length + 1);
  assertSameEventIds(persisted, [...legacyEvents, appendedEvent]);

  const read = await harness.command({
    operation: "read-winddown-habit",
    nowIso: fixture.nowIso,
    ceremonyMaterial: null,
  });
  assert.equal(read.response.status, 200);
  const projection = read.body.projection as {
    questHistory: WindDownHabitCompletionEvent[];
  };
  assert.equal(projection.questHistory[0]?.eventId, appendedEvent.eventId);
  const game = read.body.game as {
    creditedAnswerCount: number;
    collectedReviewStarCount: number;
    creditedNightCount: number;
  };
  assert.equal(game.creditedAnswerCount, 1_000 * 5);
  assert.equal(game.collectedReviewStarCount, 1);
  assert.equal(game.creditedNightCount, 1_001);
  assertSameEventIds(legacyRaw, legacyEvents);
}

async function caseHabitReadPreservesLegacyEvents() {
  const legacyEvents = syntheticLegacyHabitEvents(1_001);
  const harness = createCoordinatorHarness({
    [HABIT_EVENTS_STORAGE_KEY]: legacyEvents,
  });
  const result = await harness.command({
    operation: "read-winddown-habit",
    nowIso: "2026-08-01T12:00:00.000Z",
    ceremonyMaterial: null,
  });
  assert.equal(result.response.status, 200);
  const projection = result.body.projection as {
    questHistory: WindDownHabitCompletionEvent[];
  };
  assert.equal(projection.questHistory.length, 28);
  assert.equal(
    projection.questHistory[0]?.eventId,
    legacyEvents[legacyEvents.length - 1]?.eventId,
  );
  const game = result.body.game as {
    creditedAnswerCount: number;
    creditedNightCount: number;
  };
  assert.equal(game.creditedAnswerCount, 1_001 * 5);
  assert.equal(game.creditedNightCount, 1_001);
  const stored = harness.values.get(HABIT_EVENTS_STORAGE_KEY) as
    | WindDownHabitCompletionEvent[]
    | undefined;
  assert(stored);
  assert.equal(stored.length, 1_001);
  assertSameEventIds(stored, legacyEvents);
}

function profileRecordTemplate(): MonaVnextLearningRecord {
  const seedEvent = buildLearningEvent({
    expressionId: "synthetic-profile-seed",
    verdict: "canonical",
    atIso: "2022-01-01T12:00:00.000Z",
    sessionId: "synthetic-profile-seed-session",
    inputMode: "typed",
  });
  assert(seedEvent);
  const seedProfile = applyMonaVnextLearningEvents(
    createEmptyMonaVnextLearningProfile(),
    [seedEvent],
  );
  const template = seedProfile.records[seedEvent.expressionId];
  assert(template);
  return template;
}

function syntheticProfileWithRecords(count: number): MonaVnextLearningProfile {
  const template = profileRecordTemplate();
  const records: Record<string, MonaVnextLearningRecord> = {};
  for (let index = 0; index < count; index += 1) {
    const serial = String(index).padStart(4, "0");
    const expressionId = `synthetic-profile-expression-${serial}`;
    const reviewedAt = isoForDayOffset(index);
    records[expressionId] = {
      ...template,
      expressionId,
      lastReviewedAt: reviewedAt,
      card: {
        ...template.card,
        dueAtIso: reviewedAt,
        lastReviewAtIso: reviewedAt,
        state: State.Review,
      },
    };
  }
  return {
    ...createEmptyMonaVnextLearningProfile(),
    updatedAt: isoForDayOffset(count - 1),
    records,
  };
}

async function caseProfileNormalizerPreservesRecords() {
  const rawProfile = syntheticProfileWithRecords(1_001);
  const normalized = normalizeMonaVnextLearningProfile(rawProfile);
  assert.equal(Object.keys(normalized.records).length, 1_001);
  assert(normalized.records["synthetic-profile-expression-0000"]);
  assert(normalized.records["synthetic-profile-expression-1000"]);
}

async function caseCoordinatorReadPreservesRecords() {
  const rawProfile = syntheticProfileWithRecords(1_001);
  const harness = createCoordinatorHarness({
    [PROFILE_STORAGE_KEY]: rawProfile,
  });
  const result = await harness.command({ operation: "read-learning-profile" });
  assert.equal(result.response.status, 200);
  const profile = result.body.profile as MonaVnextLearningProfile;
  assert.equal(Object.keys(profile.records).length, 1_001);
  assert(profile.records["synthetic-profile-expression-0000"]);
  assert(profile.records["synthetic-profile-expression-1000"]);
  assert.deepEqual(
    harness.values.get(PROFILE_STORAGE_KEY),
    rawProfile,
    "profile read must not rewrite the legacy raw row",
  );
  assert.equal(
    JSON.stringify(harness.values.get(PROFILE_STORAGE_KEY)),
    JSON.stringify(rawProfile),
  );
  assert.equal(
    Object.keys((await readMonaVnextLearningProfile(harness.state.storage)).records).length,
    1_001,
  );
}

async function caseLegacyKvRawSeedIsRetained() {
  const normalizedProfile = syntheticProfileWithRecords(1);
  const legacyRaw = `${JSON.stringify({
    ...normalizedProfile,
    legacyOpaque: { sourceOrder: ["z", "a"] },
  }, null, 2)}\n`;
  const harness = createCoordinatorHarness({}, { legacyKvRaw: legacyRaw });
  const result = await harness.command({ operation: "read-learning-profile" });
  assert.equal(result.response.status, 200);
  const profile = result.body.profile as MonaVnextLearningProfile;
  assert.equal(Object.keys(profile.records).length, 1);
  const rawCopies = [...harness.values.entries()].filter(
    ([key, value]) => key !== PROFILE_STORAGE_KEY && value === legacyRaw,
  );
  assert.equal(
    rawCopies.length,
    1,
    "legacy KV source must remain as an exact string under a separate DO key",
  );
}

async function caseLargeLegacyKvSeedIsPagedAndRecoverable() {
  const normalizedProfile = syntheticProfileWithRecords(1_001);
  const legacyRaw = `${JSON.stringify({
    ...normalizedProfile,
    legacyOpaque: {
      sourceOrder: ["z", "a"],
      unicodePayload: `x${"🙂".repeat(600_000)}`,
    },
  }, null, 2)}\n`;
  assert(
    serializedValueByteLength(legacyRaw) > WIND_DOWN_DO_VALUE_BYTE_LIMIT,
    "fixture must exceed the synthetic 2 MiB DO value ceiling",
  );

  const harness = createCoordinatorHarness({}, { legacyKvRaw: legacyRaw });
  const result = await harness.command({ operation: "read-learning-profile" });
  assert.equal(result.response.status, 200);
  const seeded = result.body.profile as MonaVnextLearningProfile;
  assert.equal(Object.keys(seeded.records).length, 1_001);
  for (let index = 0; index < 1_001; index += 1) {
    const expressionId = `synthetic-profile-expression-${String(index).padStart(4, "0")}`;
    assert.equal(seeded.records[expressionId]?.expressionId, expressionId);
  }

  assert.equal(
    harness.values.has(PROFILE_STORAGE_KEY),
    false,
    "an oversized KV seed must initialize active pages directly",
  );
  assert.equal(
    harness.values.has(WIND_DOWN_PROFILE_LEGACY_KV_SOURCE_KEY),
    false,
    "an oversized raw source must use ordered source pages",
  );
  const sourceManifest = harness.values.get(
    WIND_DOWN_PROFILE_LEGACY_KV_SOURCE_MANIFEST_KEY,
  ) as { chunkCount: number; byteLength: number } | undefined;
  assert(sourceManifest);
  assert(sourceManifest.chunkCount > 1);
  const sourceChunks = [...harness.values.entries()]
    .filter(([key]) => key.startsWith(WIND_DOWN_PROFILE_LEGACY_KV_SOURCE_CHUNK_PREFIX));
  assert.equal(sourceChunks.length, sourceManifest.chunkCount);
  const orderedChunkValues: string[] = [];
  for (const [, chunk] of sourceChunks.sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    assert(typeof chunk === "string");
    assert(serializedValueByteLength(chunk) <= WIND_DOWN_PAGE_VALUE_BYTE_LIMIT);
    orderedChunkValues.push(chunk);
  }
  for (let index = 1; index < orderedChunkValues.length; index += 1) {
    const previous = orderedChunkValues[index - 1];
    const current = orderedChunkValues[index];
    const previousCodeUnit = previous.charCodeAt(previous.length - 1);
    const currentCodeUnit = current.charCodeAt(0);
    assert(
      !(previousCodeUnit >= 0xd800 && previousCodeUnit <= 0xdbff
        && currentCodeUnit >= 0xdc00 && currentCodeUnit <= 0xdfff),
      "source pages must not split a UTF-16 surrogate pair",
    );
  }
  const restoredRaw = await readWindDownLegacyKvSource(harness.state.storage);
  assert.equal(restoredRaw, legacyRaw);
  assert.equal(
    new TextEncoder().encode(restoredRaw ?? "").byteLength,
    sourceManifest.byteLength,
  );

  const restoredProfile = await readMonaVnextLearningProfile(
    harness.state.storage,
  );
  assert.equal(Object.keys(restoredProfile.records).length, 1_001);
  for (let index = 0; index < 1_001; index += 1) {
    const expressionId = `synthetic-profile-expression-${String(index).padStart(4, "0")}`;
    assert.equal(restoredProfile.records[expressionId]?.expressionId, expressionId);
  }
}

function syntheticProfileWithAppliedEventIds(count: number): MonaVnextLearningProfile {
  return {
    ...createEmptyMonaVnextLearningProfile(),
    appliedEventIds: Array.from(
      { length: count },
      (_, index) => `synthetic-applied-event-${String(index).padStart(4, "0")}`,
    ),
  };
}

function syntheticNewLearningEvent() {
  const event = buildLearningEvent({
    expressionId: "synthetic-new-expression",
    verdict: "canonical",
    atIso: "2026-08-01T12:00:00.000Z",
    sessionId: "synthetic-new-session",
    inputMode: "typed",
  });
  assert(event);
  return event;
}

async function caseApplyPreservesAppliedEventIds() {
  const current = syntheticProfileWithAppliedEventIds(4_000);
  const event = syntheticNewLearningEvent();
  const expectedEventId = `${event.sessionId}:${event.expressionId}:${event.atIso}`;
  const updated = applyMonaVnextLearningEvents(current, [event]);
  assert.equal(updated.appliedEventIds.length, 4_001);
  assert.equal(updated.appliedEventIds[0], "synthetic-applied-event-0000");
  assert.equal(updated.appliedEventIds.at(-1), expectedEventId);
}

async function caseCoordinatorReadPreservesAppliedEventIds() {
  const rawProfile = syntheticProfileWithAppliedEventIds(4_001);
  const harness = createCoordinatorHarness({
    [PROFILE_STORAGE_KEY]: rawProfile,
  });
  const result = await harness.command({ operation: "read-learning-profile" });
  assert.equal(result.response.status, 200);
  const profile = result.body.profile as MonaVnextLearningProfile;
  assert.equal(profile.appliedEventIds.length, 4_001);
  assert.equal(profile.appliedEventIds[0], "synthetic-applied-event-0000");
  assert.equal(profile.appliedEventIds.at(-1), "synthetic-applied-event-4000");
  assert.deepEqual(
    harness.values.get(PROFILE_STORAGE_KEY),
    rawProfile,
    "profile read must not rewrite the legacy raw row",
  );
  assert.equal(
    JSON.stringify(harness.values.get(PROFILE_STORAGE_KEY)),
    JSON.stringify(rawProfile),
  );
  assert.equal(
    (await readMonaVnextLearningProfile(harness.state.storage)).appliedEventIds.length,
    4_001,
  );
}

type PreservationCase = {
  name: string;
  run: () => Promise<void>;
};

const cases: PreservationCase[] = [
  {
    name: "habit append 1000 -> 1001 remains retry-idempotent",
    run: caseHabitAppendRetryPreservesHistory,
  },
  {
    name: "habit append 1000 -> 1001 is readable with legacy row preserved",
    run: caseHabitAppendThenReadPreservesHistory,
  },
  {
    name: "habit read preserves 1001 legacy events",
    run: caseHabitReadPreservesLegacyEvents,
  },
  {
    name: "profile normalization preserves 1001 records",
    run: caseProfileNormalizerPreservesRecords,
  },
  {
    name: "coordinator profile read preserves 1001 records",
    run: caseCoordinatorReadPreservesRecords,
  },
  {
    name: "legacy KV seed retains exact raw source copy",
    run: caseLegacyKvRawSeedIsRetained,
  },
  {
    name: "oversized legacy KV seed is paged with exact raw recovery",
    run: caseLargeLegacyKvSeedIsPagedAndRecoverable,
  },
  {
    name: "profile apply preserves 4001 applied event IDs",
    run: caseApplyPreservesAppliedEventIds,
  },
  {
    name: "coordinator profile read preserves 4001 applied event IDs",
    run: caseCoordinatorReadPreservesAppliedEventIds,
  },
];

function errorText(error: unknown) {
  return error instanceof Error
    ? error.stack ?? error.message
    : String(error);
}

async function main() {
  let failed = 0;
  for (const testCase of cases) {
    try {
      await testCase.run();
      console.log(`PASS ${testCase.name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${testCase.name}\n${errorText(error)}`);
    }
  }
  if (failed > 0) {
    console.error(`winddown-preservation: ${failed}/${cases.length} cases failed`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS winddown-preservation: ${cases.length}/${cases.length} cases`);
}

void main().catch((error) => {
  console.error(`FAIL winddown-preservation runner\n${errorText(error)}`);
  process.exitCode = 1;
});
