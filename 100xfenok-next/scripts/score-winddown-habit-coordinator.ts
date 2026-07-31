import assert from "node:assert/strict";
import {
  handleMonaVnextProfileCoordinatorRequest,
  type WindDownReviewCoordinatorEnv,
  type WindDownReviewCoordinatorState,
} from "../src/features/mona-vnext/memory/learningProfileCoordinator";
import {
  createWindDownLearnSession,
  type WindDownLearnAction,
  type WindDownLearnCard,
} from "../src/features/winddown/learn/engine";
import type {
  WindDownLearnSessionManifest,
} from "../src/features/winddown/server/learnSessionProof";
import {
  createWindDownHabitCompletionEvent,
  type WindDownHabitCompletionEvent,
} from "../src/features/winddown/habit/domain";

const cards: WindDownLearnCard[] = Array.from({ length: 5 }, (_, index) => ({
  id: `learn-card-${index + 1}`,
  ko: `준비 문장 ${index + 1}`,
  en: `I am ready number ${index + 1}.`,
}));
const manifest: WindDownLearnSessionManifest = {
  schemaVersion: 1,
  sessionId: "winddown-learn-session-20260731",
  habitKstDay: "2026-07-31",
  seed: "2026-07-31:learn",
  cardIds: cards.map((card) => card.id),
  contentDigest: "a".repeat(64),
  issuedAtIso: "2026-07-31T09:00:00.000Z",
  expiresAtIso: "2026-08-01T03:00:00.000Z",
};
const ceremonyMaterial = {
  schemaVersion: 1 as const,
  contentDigest: "b".repeat(64),
  entries: [
    { id: "ceremony-material-1", en: "I need to sleep on it." },
    { id: "ceremony-material-2", en: "I can see the first light." },
    { id: "ceremony-material-3", en: "We are chasing the same dream." },
    { id: "ceremony-material-4", en: "Could you give me a minute?" },
    { id: "ceremony-material-5", en: "I will figure it out tomorrow." },
    { id: "ceremony-material-6", en: "We are ready for this." },
    { id: "ceremony-material-7", en: "I am finally home." },
    { id: "ceremony-material-8", en: "Let's start from here." },
    { id: "ceremony-material-9", en: "It was a beautiful night." },
    { id: "ceremony-hard", en: "I need poison." },
    { id: "ceremony-later-miss", en: "I regret this." },
  ],
};

function correctAction(): WindDownLearnAction {
  const state = createWindDownLearnSession({ cards, seed: manifest.seed });
  const current = state.queue[0];
  if (current.kind === "meaning-choice") {
    return {
      type: "choose-meaning",
      cardId: current.card.id,
      choiceId: current.correctChoiceId,
    };
  }
  return {
    type: "submit-sentence",
    cardId: current.card.id,
    tokenIds: current.canonicalTokenIds,
  };
}

function actionForState(value: unknown): WindDownLearnAction {
  assert(value && typeof value === "object" && !Array.isArray(value));
  const queue = (value as { queue?: unknown }).queue;
  assert(Array.isArray(queue) && queue.length > 0);
  const current = queue[0] as {
    kind: "meaning-choice" | "sentence-builder";
    card: { id: string };
    correctChoiceId?: string;
    canonicalTokenIds?: string[];
  };
  return current.kind === "meaning-choice"
    ? {
        type: "choose-meaning",
        cardId: current.card.id,
        choiceId: current.correctChoiceId ?? "",
      }
    : {
        type: "submit-sentence",
        cardId: current.card.id,
        tokenIds: current.canonicalTokenIds ?? [],
      };
}

async function main() {
  const values = new Map<string, unknown>();
  let kvWrites = 0;
  let successfulKvWrites = 0;
  let failNextKvWrite = true;
  const storage = {
    async get<T>(key: string) {
      return values.get(key) as T | undefined;
    },
    async put<T>(key: string, value: T) {
      values.set(key, structuredClone(value));
    },
    async transaction<T>(
      callback: (transaction: {
        get<U>(key: string): Promise<U | undefined>;
        put<U>(key: string, value: U): Promise<void>;
      }) => Promise<T>,
    ) {
      return callback(storage);
    },
  };
  const state: WindDownReviewCoordinatorState = {
    storage,
    blockConcurrencyWhile: async <T>(callback: () => Promise<T>) => callback(),
  };
  const env: WindDownReviewCoordinatorEnv = {
    MONA_VNEXT_KV: {
      async get() {
        return null;
      },
      async put() {
        kvWrites += 1;
        if (failNextKvWrite) {
          failNextKvWrite = false;
          throw new Error("controlled kv mirror failure");
        }
        successfulKvWrites += 1;
      },
    },
  };

  async function command(body: Record<string, unknown>) {
    const response = await handleMonaVnextProfileCoordinatorRequest(
      state,
      env,
      new Request("https://winddown.internal/profile-coordinator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    return {
      response,
      body: await response.json() as Record<string, unknown>,
    };
  }

  let action = correctAction();
  let last: Record<string, unknown> | null = null;
  for (let index = 1; index <= 5; index += 1) {
    const attempt = {
      operation: "commit-learn-attempt",
      manifest,
      cards,
      attemptId: `${manifest.sessionId}:attempt-${index}`,
      action,
      nowIso: `2026-07-31T10:0${index}:00.000Z`,
    };
    if (index === 1) {
      await assert.rejects(
        () => command(attempt),
        /controlled kv mirror failure/,
        "a failed post-transaction mirror must surface without rolling back the DO",
      );
    }
    const committed = await command(attempt);
    assert.equal(committed.response.status, 200);
    assert.equal(committed.body.persisted, true);
    assert.equal(committed.body.reward, 1);
    assert.equal(
      committed.body.duplicate,
      index === 1,
      "retry after a failed mirror must reuse the authoritative attempt receipt",
    );
    last = committed.body;
    if (index < 5) action = actionForState(committed.body.state);
  }
  assert(last);
  assert.equal(last.outcome, "complete");
  assert(last.completionReceipt);

  const duplicate = await command({
    operation: "commit-learn-attempt",
    manifest,
    cards,
    attemptId: `${manifest.sessionId}:attempt-5`,
    action,
    nowIso: "2026-07-31T10:05:00.000Z",
  });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.body.duplicate, true);

  const conflict = await command({
    operation: "commit-learn-attempt",
    manifest,
    cards,
    attemptId: `${manifest.sessionId}:attempt-5`,
    action: { ...action, cardId: "different-card" },
    nowIso: "2026-07-31T10:05:00.000Z",
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.error, "WINDDOWN_LEARN_ATTEMPT_CONFLICT");

  const habit = await command({
    operation: "read-winddown-habit",
    nowIso: "2026-07-31T10:06:00.000Z",
    ceremonyMaterial,
  });
  assert.equal(habit.response.status, 200);
  const projection = habit.body.projection as {
    currentKstDay: string;
    questHistory: Array<{ activity: string }>;
  };
  assert.equal(projection.currentKstDay, "2026-07-31");
  assert.equal(
    projection.questHistory.filter((event) => event.activity === "learn").length,
    1,
    "five persisted credits and any retries must close exactly one Learn quest",
  );
  assert.deepEqual(habit.body.game, {
    schemaVersion: 1,
    xp: 15,
    creditedAnswerCount: 5,
    collectedReviewStarCount: 0,
    creditedNightCount: 1,
  }, "the game projection must come from the same authoritative Learn receipt");
  assert.equal(kvWrites, 7, "credited duplicates retry or confirm the KV mirror");
  assert.equal(successfulKvWrites, 6, "the repaired mirror and later credited retries all persist");

  const wrongDay = await command({
    operation: "commit-learn-attempt",
    manifest: { ...manifest, sessionId: "next-session", habitKstDay: "2026-08-01" },
    cards,
    attemptId: "next-session:attempt-1",
    action: correctAction(),
    nowIso: "2026-07-31T10:07:00.000Z",
  });
  assert.equal(wrongDay.response.status, 400);

  const ceremonyEvents: WindDownHabitCompletionEvent[] = [];
  for (let night = 1; night <= 12; night += 1) {
    const day = new Date(
      Date.UTC(2026, 6, night),
    ).toISOString().slice(0, 10);
    ceremonyEvents.push(
      createWindDownHabitCompletionEvent({
        kind: "learn-credit-receipt",
        receipt: {
          schemaVersion: 1,
          activity: "learn",
          receiptId: `ceremony-learn-${night}`,
          sessionId: `ceremony-session-${night}`,
          persistedAtIso: `${day}T12:00:00.000Z`,
          creditedActionCount: 5,
          completion: "five-exercises",
          persisted: true,
        },
      }),
    );
  }
  values.set("winddown-habit-events", ceremonyEvents);

  const committedCeremony = await command({
    operation: "commit-winddown-ceremony-choice",
    slotId: "group",
    optionId: "lumen",
    ceremonyMaterial,
  });
  assert.equal(committedCeremony.response.status, 200);
  assert.equal(committedCeremony.body.duplicate, false);
  const duplicateCeremony = await command({
    operation: "commit-winddown-ceremony-choice",
    slotId: "group",
    optionId: "lumen",
    ceremonyMaterial,
  });
  assert.equal(duplicateCeremony.response.status, 200);
  assert.equal(duplicateCeremony.body.duplicate, true);
  const conflictCeremony = await command({
    operation: "commit-winddown-ceremony-choice",
    slotId: "group",
    optionId: "moonrise",
    ceremonyMaterial,
  });
  assert.equal(conflictCeremony.response.status, 409);
  assert.equal(
    conflictCeremony.body.error,
    "WINDDOWN_CEREMONY_CHOICE_CONFLICT",
  );

  const storedProfile = structuredClone(
    values.get("mona-vnext-learning-profile"),
  ) as {
    records: Record<string, {
      expressionId: string;
      lastVerdict: string;
      lastRating: string;
      lastReviewedAt: string;
      card: Record<string, unknown>;
    }>;
  };
  const templateRecord = Object.values(storedProfile.records)[0];
  assert(templateRecord);
  const masteryEvents = [...ceremonyEvents];
  ceremonyMaterial.entries.forEach((entry, index) => {
    const hard = entry.id === "ceremony-hard";
    const laterMiss = entry.id === "ceremony-later-miss";
    const reviewCycleId =
      `winddown-review:${String(index + 1).padStart(64, "0")}`;
    const reviewedAt = `2026-07-${String(10 + index).padStart(2, "0")}T12:30:00.000Z`;
    const receipt = {
      schemaVersion: 1 as const,
      reviewCycleId,
      requestDigest: String(index + 1).padStart(64, "0"),
      materialId: entry.id,
      reviewedAt,
      rating: hard ? "hard" as const : "good" as const,
      reward: 1 as const,
    };
    values.set(`winddown-review-receipt:${reviewCycleId}`, receipt);
    masteryEvents.push(
      createWindDownHabitCompletionEvent({
        kind: "review-credit-receipt",
        receipt,
      }),
    );
    storedProfile.records[entry.id] = {
      ...templateRecord,
      expressionId: entry.id,
      lastVerdict: laterMiss ? "miss" : hard ? "close" : "canonical",
      lastRating: laterMiss ? "again" : hard ? "hard" : "good",
      lastReviewedAt: reviewedAt,
      card: {
        ...templateRecord.card,
        stability: hard ? 2_000 : laterMiss ? 1_999 : 1_000 - index,
      },
    };
  });
  values.set("mona-vnext-learning-profile", storedProfile);
  values.set("winddown-habit-events", masteryEvents);
  const masteryHabit = await command({
    operation: "read-winddown-habit",
    nowIso: "2026-07-31T10:07:30.000Z",
    ceremonyMaterial,
  });
  assert.equal(masteryHabit.response.status, 200);
  const masteryCeremony = masteryHabit.body.ceremony as {
    slots: Array<{
      id: string;
      optionSource: string;
      options: Array<{ label: string }>;
    }>;
  };
  assert(
    masteryCeremony.slots.every(
      (slot) => slot.optionSource === "mastery-derived",
    ),
    "nine strict-recall receipts must produce three distinct learned option sets",
  );
  const learnedLabels = masteryCeremony.slots.flatMap(
    (slot) => slot.options.map((option) => option.label),
  );
  assert.equal(learnedLabels.length, 9);
  assert(!learnedLabels.includes("POISON"));
  assert(!learnedLabels.includes("REGRET"));

  const missingReceiptKey =
    `winddown-review-receipt:winddown-review:${"1".padStart(64, "0")}`;
  const missingReceipt = values.get(missingReceiptKey);
  assert(missingReceipt);
  values.delete(missingReceiptKey);
  const degradedMasteryHabit = await command({
    operation: "read-winddown-habit",
    nowIso: "2026-07-31T10:07:45.000Z",
    ceremonyMaterial,
  });
  assert.equal(degradedMasteryHabit.response.status, 200);
  assert.equal(
    (degradedMasteryHabit.body.ceremony as { status?: unknown }).status,
    "unavailable",
  );
  assert.deepEqual(
    degradedMasteryHabit.body.game,
    masteryHabit.body.game,
    "a ceremony-only receipt fault must preserve authoritative tour progress",
  );
  assert.deepEqual(
    degradedMasteryHabit.body.projection,
    masteryHabit.body.projection,
    "a ceremony-only receipt fault must preserve the habit action projection",
  );
  const degradedMasteryCommit = await command({
    operation: "commit-winddown-ceremony-choice",
    slotId: "debut-song",
    optionId: "first-light",
    ceremonyMaterial,
  });
  assert.equal(degradedMasteryCommit.response.status, 500);
  assert.equal(
    degradedMasteryCommit.body.error,
    "WINDDOWN_CEREMONY_MASTERY_STATE_INVALID",
  );
  values.set(missingReceiptKey, missingReceipt);

  values.set("winddown-game-ceremony:v1", {
    schemaVersion: 1,
    catalogVersion: "corrupted",
    learnerId: "mona",
    choices: {},
  });
  const corruptedCeremony = await command({
    operation: "read-winddown-habit",
    nowIso: "2026-07-31T10:08:00.000Z",
    ceremonyMaterial,
  });
  assert.equal(corruptedCeremony.response.status, 500);
  assert.equal(
    corruptedCeremony.body.error,
    "WINDDOWN_CEREMONY_STATE_INVALID",
  );

  console.log(
    "PASS winddown-habit-coordinator - server-owned Learn and ceremony receipts, duplicate, conflict, corruption, and day gates",
  );
}

void main();
