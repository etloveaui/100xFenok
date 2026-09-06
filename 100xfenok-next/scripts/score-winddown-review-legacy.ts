import assert from "node:assert/strict";
import {
  applyMonaVnextLearningEvents,
  createEmptyMonaVnextLearningProfile,
  type MonaVnextLearningProfile,
} from "../src/features/mona-vnext/memory/fsrsLearningProfile";
import { buildLearningEvent } from "../src/features/mona-vnext/memory/srsBridge";
import {
  handleMonaVnextProfileCoordinatorRequest,
  type WindDownReviewCoordinatorEnv,
  type WindDownReviewCoordinatorState,
} from "../src/features/mona-vnext/memory/learningProfileCoordinator";
import {
  buildWindDownStudyMaterialFromRuntimeProjection,
} from "../src/features/winddown/server/publishedMaterialAdapter";
import {
  buildWindDownReviewCards,
  commitWindDownReviewCycleState,
  createWindDownReviewCycleId,
  gradeWindDownReviewAttemptState,
  type WindDownReviewCycleInput,
} from "../src/features/winddown/server/reviewCycle";
import type { WindDownRuntimeProjection } from "../src/features/winddown/content/lkgContract";

/**
 * Stage 1 RED contract for the review alias boundary.
 *
 * `aliases` is the published runtime projection's legacyV1Id -> canonicalId
 * list. Review code resolves a canonical material id to a profile record by
 * trying the canonical key first and then the listed legacy keys. A fallback
 * hit retains the legacy record key when committing its FSRS event; it never
 * rekeys, resets, or deletes profile records. If both keys exist, canonical
 * wins for card due time, validation, cycle identity, and commit mutation.
 */
type ReviewAlias = { legacyV1Id: string; canonicalId: string };
type AliasAwareBuildArgs = Parameters<typeof buildWindDownReviewCards>[0] & {
  aliases: ReviewAlias[];
};
type AliasAwareGradeArgs = Parameters<typeof gradeWindDownReviewAttemptState>[0] & {
  aliases: ReviewAlias[];
};
type AliasAwareCommitArgs = Parameters<typeof commitWindDownReviewCycleState>[0] & {
  aliases: ReviewAlias[];
};

const buildReviewCards = buildWindDownReviewCards as unknown as (
  args: AliasAwareBuildArgs,
) => ReturnType<typeof buildWindDownReviewCards>;
const gradeReviewAttempt = gradeWindDownReviewAttemptState as unknown as (
  args: AliasAwareGradeArgs,
) => ReturnType<typeof gradeWindDownReviewAttemptState>;
const commitReviewCycle = commitWindDownReviewCycleState as unknown as (
  args: AliasAwareCommitArgs,
) => ReturnType<typeof commitWindDownReviewCycleState>;

const legacyId = "mona-life-0eee2545b954";
const canonicalId = "winddown-material-c071e288a6e7e0503aa7448e";
const aliases: ReviewAlias[] = [{ legacyV1Id: legacyId, canonicalId }];
const contentDigest = "a".repeat(64);
const material = {
  id: canonicalId,
  ko: "최선을 다하다",
  en: "Try my best",
  acceptedVariants: ["Are you trying your best?", "I tried my best."],
  state: "prompt" as const,
};
const learnedAt = "2026-07-01T00:00:00.000Z";

function learningProfile(expressionId: string, sessionId: string) {
  const event = buildLearningEvent({
    expressionId,
    verdict: "canonical",
    atIso: learnedAt,
    sessionId,
  });
  assert(event);
  return applyMonaVnextLearningEvents(
    createEmptyMonaVnextLearningProfile(),
    [event],
  );
}

function reviewInput(reviewCycleId: string): WindDownReviewCycleInput {
  return {
    schemaVersion: 1,
    activity: "review",
    reviewCycleId,
    materialId: canonicalId,
    contentDigest,
    inputMode: "typed",
    attempts: [{ answer: material.en, revealedBefore: false }],
  };
}

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

function coordinatorRequest(command: Record<string, unknown>) {
  return new Request("https://winddown.internal/profile-coordinator", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
}

async function main() {
  const failures: string[] = [];
  async function check(name: string, callback: () => Promise<void> | void) {
    try {
      await callback();
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const legacyProfile = learningProfile(legacyId, "legacy-review-fixture");
  const legacyRecord = legacyProfile.records[legacyId];
  assert(legacyRecord);
  const nowIso = new Date(Date.parse(legacyRecord.card.dueAtIso) + 60_000).toISOString();

  await check("published due selection resolves legacy id to canonical id", () => {
    const runtimeProjection: WindDownRuntimeProjection = {
      schemaVersion: 1,
      kind: "winddown-material-runtime-projection",
      projectionDigest: "b".repeat(64),
      sourceContentDigest: contentDigest,
      sourceArtifactDigest: "c".repeat(64),
      materials: [{
        id: material.id,
        ko: material.ko,
        en: material.en,
        acceptedVariants: material.acceptedVariants,
      }],
      aliases,
      quarantine: [],
      lunaQuarantinedMaterialIds: [],
      advisorOverlay: [{
        materialId: canonicalId,
        receiptDigest: "d".repeat(64),
        requestedModel: "fixture",
        responseModel: "fixture",
        evidence: ["fixture"],
        enrichment: {
          chunks: [],
          distractors: [],
          difficultyNote: null,
          scenarioTags: [],
          naturalnessFlags: [],
        },
      }],
      advisorGate: {
        sourceActiveCount: 1,
        approvedCount: 1,
        needsHumanReviewCount: 0,
        rejectCount: 0,
        quarantinedCount: 0,
      },
    };
    const selection = buildWindDownStudyMaterialFromRuntimeProjection({
      runtimeProjection,
      dueExpressionIds: [legacyId],
      deferredExpressionIds: [],
    });
    assert.deepEqual(selection.dueExpressionIds, [canonicalId]);
    assert.equal(selection.resolution.due.aliasResolvedCount, 1);
  });

  await check("review card builder includes a due legacy profile record", async () => {
    const cards = await buildReviewCards({
      cards: [material],
      profile: legacyProfile,
      contentDigest,
      nowIso,
      aliases,
    });
    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.id, canonicalId);
    assert.equal(cards[0]?.dueAtIso, legacyRecord.card.dueAtIso);
    assert.equal(
      cards[0]?.reviewCycleId,
      await createWindDownReviewCycleId({
        materialId: canonicalId,
        contentDigest,
        record: legacyRecord,
      }),
    );
  });

  const legacyCycleId = await createWindDownReviewCycleId({
    materialId: canonicalId,
    contentDigest,
    record: legacyRecord,
  });
  const legacyInput = reviewInput(legacyCycleId);

  await check("review validator accepts canonical input against a legacy record", async () => {
    assert.deepEqual(
      await gradeReviewAttempt({
        profile: legacyProfile,
        input: legacyInput,
        material,
        currentContentDigest: contentDigest,
        nowIso,
        aliases,
      }),
      { outcome: "correct", needsRepair: false },
    );
  });

  await check("review commit preserves the legacy record key", async () => {
    const before = structuredClone(legacyProfile);
    const committed = await commitReviewCycle({
      profile: legacyProfile,
      existingReceipt: null,
      input: legacyInput,
      material,
      currentContentDigest: contentDigest,
      nowIso,
      aliases,
    });
    assert.equal(committed.duplicate, false);
    assert.equal(committed.receipt.materialId, canonicalId);
    assert.equal(committed.receipt.rating, "good");
    assert.deepEqual(Object.keys(committed.profile.records), [legacyId]);
    assert.equal(committed.profile.records[legacyId]?.card.reps, before.records[legacyId]!.card.reps + 1);
    assert.equal(committed.profile.records[canonicalId], undefined);
  });

  await check("review commit retry is idempotent for a legacy-keyed record", async () => {
    const first = await commitReviewCycle({
      profile: legacyProfile,
      existingReceipt: null,
      input: legacyInput,
      material,
      currentContentDigest: contentDigest,
      nowIso,
      aliases,
    });
    const retry = await commitReviewCycle({
      profile: first.profile,
      existingReceipt: first.receipt,
      input: legacyInput,
      material,
      currentContentDigest: contentDigest,
      nowIso: new Date(Date.parse(nowIso) + 5_000).toISOString(),
      aliases,
    });
    assert.equal(retry.duplicate, true);
    assert.deepEqual(retry.receipt, first.receipt);
    assert.deepEqual(retry.profile, first.profile);
  });

  await check("canonical profile record wins a legacy collision consistently", async () => {
    const canonicalProfile = learningProfile(canonicalId, "canonical-review-fixture");
    const canonicalRecord = canonicalProfile.records[canonicalId];
    assert(canonicalRecord);
    const collisionProfile: MonaVnextLearningProfile = {
      ...canonicalProfile,
      records: {
        [legacyId]: structuredClone(legacyRecord),
        [canonicalId]: {
          ...structuredClone(canonicalRecord),
          card: {
            ...canonicalRecord.card,
            dueAtIso: "2026-09-05T00:00:00.000Z",
          },
        },
      },
    };
    const collisionNowIso = "2026-09-06T00:00:00.000Z";
    const cards = await buildReviewCards({
      cards: [material],
      profile: collisionProfile,
      contentDigest,
      nowIso: collisionNowIso,
      aliases,
    });
    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.dueAtIso, "2026-09-05T00:00:00.000Z");
    const cycleId = await createWindDownReviewCycleId({
      materialId: canonicalId,
      contentDigest,
      record: collisionProfile.records[canonicalId]!,
    });
    const committed = await commitReviewCycle({
      profile: collisionProfile,
      existingReceipt: null,
      input: reviewInput(cycleId),
      material,
      currentContentDigest: contentDigest,
      nowIso: collisionNowIso,
      aliases,
    });
    assert.equal(committed.profile.records[legacyId]?.card.reps, legacyRecord.card.reps);
    assert.equal(
      committed.profile.records[canonicalId]?.card.reps,
      collisionProfile.records[canonicalId]!.card.reps + 1,
    );
    assert.deepEqual(Object.keys(committed.profile.records).sort(), [canonicalId, legacyId].sort());
  });

  await check("coordinator retry mirrors one legacy-keyed commit after a transient failure", async () => {
    const state = new MemoryDurableState();
    let mirrorAttempts = 0;
    let mirroredProfile = JSON.stringify(legacyProfile);
    const coordinatorEnv: WindDownReviewCoordinatorEnv = {
      MONA_VNEXT_KV: {
        get: async () => JSON.stringify(legacyProfile),
        put: async (_key, value) => {
          mirrorAttempts += 1;
          if (mirrorAttempts === 1) throw new Error("KV_MIRROR_WRITE_FAILED");
          mirroredProfile = value;
        },
      },
    };
    const command = {
      operation: "commit-review-cycle",
      input: legacyInput,
      material,
      activeMaterialIds: [canonicalId],
      currentContentDigest: contentDigest,
      nowIso,
      aliases,
    };
    await assert.rejects(
      () => state.blockConcurrencyWhile(() =>
        handleMonaVnextProfileCoordinatorRequest(
          state,
          coordinatorEnv,
          coordinatorRequest(command),
        )),
      /KV_MIRROR_WRITE_FAILED/,
    );
    const response = await state.blockConcurrencyWhile(() =>
      handleMonaVnextProfileCoordinatorRequest(
        state,
        coordinatorEnv,
        coordinatorRequest(command),
      ));
    const body = await response.json() as Record<string, unknown>;
    assert.equal(response.status, 200);
    assert.equal(body.duplicate, true);
    assert.equal(mirrorAttempts, 2);
    const mirrored = JSON.parse(mirroredProfile);
    assert.deepEqual(Object.keys(mirrored.records), [legacyId]);
  });

  if (failures.length > 0) {
    throw new Error(
      `RED winddown-review-legacy (${failures.length} expected failures)\n${failures.join("\n")}`,
    );
  }
  console.log("PASS winddown-review-legacy - legacy aliases preserve FSRS schedule and keys");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
