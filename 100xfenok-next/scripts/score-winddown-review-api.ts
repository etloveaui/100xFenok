import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  applyMonaVnextLearningEvents,
  createEmptyMonaVnextLearningProfile,
} from "../src/features/mona-vnext/memory/fsrsLearningProfile";
import {
  handleMonaVnextProfileCoordinatorRequest,
  type WindDownReviewCoordinatorState,
} from "../src/features/mona-vnext/memory/learningProfileCoordinator";
import {
  MonaVnextProfileCoordinatorError,
} from "../src/features/mona-vnext/memory/learningProfileCoordinatorClient";
import { buildLearningEvent } from "../src/features/mona-vnext/memory/srsBridge";
import {
  buildWindDownReviewCards,
  createWindDownReviewCycleId,
  gradeWindDownReviewAttemptState,
  WindDownReviewCycleError,
  type WindDownReviewCycleInput,
} from "../src/features/winddown/server/reviewCycle";
import {
  executeWindDownReviewApiRequest,
} from "../src/features/winddown/server/reviewApi";

async function main() {
  const digest = "a".repeat(64);
  const learnedAt = "2026-07-01T00:00:00.000Z";
  const materials = [
    {
      id: "material-a",
      ko: "준비됐어요.",
      en: "I am ready.",
      acceptedVariants: ["I'm ready."],
      state: "prompt" as const,
    },
    {
      id: "material-b",
      ko: "도움이 필요해요.",
      en: "I need help.",
      acceptedVariants: [],
      state: "prompt" as const,
    },
  ];
  const learned = materials.map((material) =>
    buildLearningEvent({
      expressionId: material.id,
      verdict: "canonical",
      atIso: learnedAt,
      sessionId: `review-api-fixture:${material.id}`,
    })
  );
  assert(learned.every(Boolean));
  const dueProfile = applyMonaVnextLearningEvents(
    createEmptyMonaVnextLearningProfile(),
    learned.filter((event): event is NonNullable<typeof event> => Boolean(event)),
  );
  const dueRecord = dueProfile.records[materials[0].id];
  assert(dueRecord);
  const nowIso = new Date(
    Math.max(
      ...Object.values(dueProfile.records).map((record) =>
        Date.parse(record.card.dueAtIso)
      ),
    ) + 60_000,
  ).toISOString();
  const reviewCycleId = await createWindDownReviewCycleId({
    materialId: materials[0].id,
    contentDigest: digest,
    record: dueRecord,
  });

  const reviewProfile = structuredClone(dueProfile);
  reviewProfile.records[materials[1].id].card.dueAtIso = new Date(
    Date.parse(nowIso) + 86_400_000,
  ).toISOString();
  const cards = await buildWindDownReviewCards({
    cards: [
      {
        ...materials[0],
        reviewCycleId: "client-forged",
        dueAtIso: "2099-01-01T00:00:00.000Z",
      } as (typeof materials)[number] & {
        reviewCycleId: string;
        dueAtIso: string;
      },
      materials[1],
      { id: "fresh", ko: "새 항목", en: "Fresh.", state: "prompt" as const },
    ],
    profile: reviewProfile,
    contentDigest: digest,
    nowIso,
  });
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.id, materials[0].id);
  assert.equal(cards[0]?.reviewCycleId, reviewCycleId);
  assert.equal(cards[0]?.dueAtIso, dueRecord.card.dueAtIso);
  assert.notEqual(cards[0]?.reviewCycleId, "client-forged");

  const gradeBase = {
    profile: dueProfile,
    material: materials[0],
    currentContentDigest: digest,
    nowIso,
  };
  const profileBeforeGrade = structuredClone(dueProfile);
  const correct = await gradeWindDownReviewAttemptState({
    ...gradeBase,
    input: {
      schemaVersion: 1,
      activity: "review",
      reviewCycleId,
      materialId: materials[0].id,
      contentDigest: digest,
      attempt: { answer: "I'm ready.", revealedBefore: false },
    },
  });
  assert.deepEqual(correct, { outcome: "correct", needsRepair: false });
  assert.deepEqual(dueProfile, profileBeforeGrade, "grade-recall must not mutate FSRS");
  assert.equal(JSON.stringify(correct).includes("match"), false);

  const miss = await gradeWindDownReviewAttemptState({
    ...gradeBase,
    input: {
      schemaVersion: 1,
      activity: "review",
      reviewCycleId,
      materialId: materials[0].id,
      contentDigest: digest,
      attempt: { answer: "not yet", revealedBefore: false },
    },
  });
  assert.deepEqual(miss, { outcome: "miss", needsRepair: true });
  const revealed = await gradeWindDownReviewAttemptState({
    ...gradeBase,
    input: {
      schemaVersion: 1,
      activity: "review",
      reviewCycleId,
      materialId: materials[0].id,
      contentDigest: digest,
      attempt: { answer: "", revealedBefore: true },
    },
  });
  assert.deepEqual(revealed, { outcome: "revealed", needsRepair: true });
  await assert.rejects(
    () =>
      gradeWindDownReviewAttemptState({
        ...gradeBase,
        input: {
          schemaVersion: 1,
          activity: "review",
          reviewCycleId: `winddown-review:${"f".repeat(64)}`,
          materialId: materials[0].id,
          contentDigest: digest,
          attempt: { answer: "I am ready.", revealedBefore: false },
        },
      }),
    (error) =>
      error instanceof WindDownReviewCycleError &&
      error.code === "REVIEW_CYCLE_STALE",
  );

  class MemoryDurableState implements WindDownReviewCoordinatorState {
    private readonly values = new Map<string, unknown>();
    private chain = Promise.resolve();

    readonly storage = {
      get: async <T>(key: string) => this.values.get(key) as T | undefined,
      put: async <T>(key: string, value: T) => {
        this.values.set(key, value);
      },
      transaction: async <T>(
        callback: (transaction: {
          get<U>(key: string): Promise<U | undefined>;
          put<U>(key: string, value: U): Promise<void>;
        }) => Promise<T>,
      ) => callback(this.storage),
    };

    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
      const current = this.chain.then(callback);
      this.chain = current.then(() => undefined, () => undefined);
      return current;
    }
  }

  const commitInput: WindDownReviewCycleInput = {
    schemaVersion: 1,
    activity: "review",
    reviewCycleId,
    materialId: materials[0].id,
    contentDigest: digest,
    attempts: [{ answer: "I am ready.", revealedBefore: false }],
  };
  const coordinatorCommand = {
    operation: "commit-review-cycle",
    input: commitInput,
    material: materials[0],
    activeMaterialIds: materials.map((material) => material.id),
    currentContentDigest: digest,
    nowIso,
  };
  const coordinatorRequest = (command: Record<string, unknown>) =>
    new Request("https://winddown.internal/profile-coordinator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
  const coordinatorState = new MemoryDurableState();
  let mirrorRaw = JSON.stringify(dueProfile);
  const coordinatorEnv = {
    MONA_VNEXT_KV: {
      get: async () => mirrorRaw,
      put: async (_key: string, value: string) => {
        mirrorRaw = value;
      },
    },
  };
  const commitResponse = await coordinatorState.blockConcurrencyWhile(() =>
    handleMonaVnextProfileCoordinatorRequest(
      coordinatorState,
      coordinatorEnv,
      coordinatorRequest(coordinatorCommand),
    )
  );
  assert.equal(commitResponse.status, 200);
  const committed = await commitResponse.json() as Record<string, unknown>;
  assert.equal(committed.duplicate, false);
  assert.equal(committed.remainingDueCount, 1);
  assert.equal(
    committed.nextDueAtIso,
    dueProfile.records[materials[1].id].card.dueAtIso,
  );
  const duplicateResponse = await coordinatorState.blockConcurrencyWhile(() =>
    handleMonaVnextProfileCoordinatorRequest(
      coordinatorState,
      coordinatorEnv,
      coordinatorRequest(coordinatorCommand),
    )
  );
  const duplicate = await duplicateResponse.json() as Record<string, unknown>;
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.receipt, committed.receipt);
  const conflictResponse = await coordinatorState.blockConcurrencyWhile(() =>
    handleMonaVnextProfileCoordinatorRequest(
      coordinatorState,
      coordinatorEnv,
      coordinatorRequest({
        ...coordinatorCommand,
        input: {
          ...commitInput,
          attempts: [{ answer: "changed", revealedBefore: false }],
        },
      }),
    )
  );
  assert.equal(conflictResponse.status, 409);
  assert.deepEqual(await conflictResponse.json(), {
    error: "REVIEW_CYCLE_CONFLICT",
  });

  const retryState = new MemoryDurableState();
  let mirrorAttempts = 0;
  const retryEnv = {
    MONA_VNEXT_KV: {
      get: async () => JSON.stringify(dueProfile),
      put: async () => {
        mirrorAttempts += 1;
        if (mirrorAttempts === 1) throw new Error("KV_MIRROR_WRITE_FAILED");
      },
    },
  };
  await assert.rejects(
    () =>
      retryState.blockConcurrencyWhile(() =>
        handleMonaVnextProfileCoordinatorRequest(
          retryState,
          retryEnv,
          coordinatorRequest(coordinatorCommand),
        )
      ),
    /KV_MIRROR_WRITE_FAILED/,
  );
  const retryResponse = await retryState.blockConcurrencyWhile(() =>
    handleMonaVnextProfileCoordinatorRequest(
      retryState,
      retryEnv,
      coordinatorRequest(coordinatorCommand),
    )
  );
  const retry = await retryResponse.json() as Record<string, unknown>;
  assert.equal(retry.duplicate, true);
  assert.equal(mirrorAttempts, 2);
  assert.equal(retry.remainingDueCount, 1);

  const invalidApi = await executeWindDownReviewApiRequest(
    { operation: "grade-recall" },
    {
      gradeRecall: async () => {
        throw new WindDownReviewCycleError("INVALID_REVIEW_CYCLE", 400);
      },
      commitReviewCycle: async () => {
        throw new Error("unused");
      },
    },
  );
  assert.deepEqual(invalidApi, {
    status: 400,
    body: { error: "INVALID_REVIEW_CYCLE" },
  });
  const conflictApi = await executeWindDownReviewApiRequest(
    { operation: "commit-review-cycle" },
    {
      gradeRecall: async () => {
        throw new Error("unused");
      },
      commitReviewCycle: async () => {
        throw new MonaVnextProfileCoordinatorError(
          "REVIEW_CYCLE_CONFLICT",
          409,
        );
      },
    },
  );
  assert.deepEqual(conflictApi, {
    status: 409,
    body: { error: "REVIEW_CYCLE_CONFLICT" },
  });

  const reviewRoute = readFileSync(
    path.join(process.cwd(), "src/app/api/winddown/review/route.ts"),
    "utf8",
  );
  assert.match(reviewRoute, /ADMIN_SESSION_REQUIRED/);
  assert.match(reviewRoute, /executeWindDownReviewApiRequest/);
  const studyRoute = readFileSync(
    path.join(process.cwd(), "src/app/api/winddown/study/route.ts"),
    "utf8",
  );
  assert.match(studyRoute, /buildWindDownReviewCards/);
  assert.match(studyRoute, /contentDigest/);

  console.log(
    "PASS winddown-review-api - server cycles, no-mutation grading, atomic commit, and HTTP status fidelity",
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
