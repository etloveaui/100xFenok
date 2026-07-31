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

  console.log(
    "PASS winddown-habit-coordinator - server-owned Learn resume, receipt, duplicate, conflict, and day gates",
  );
}

void main();
