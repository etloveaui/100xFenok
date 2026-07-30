import {
  applyMonaVnextLearningEvents,
  createEmptyMonaVnextLearningProfile,
  normalizeMonaVnextLearningProfile,
  type MonaVnextLearningProfile,
} from "@/features/mona-vnext/memory/fsrsLearningProfile";
import {
  buildLearningEvent,
  type MonaVnextLearningEvent,
} from "@/features/mona-vnext/memory/srsBridge";
import { MONA_VNEXT_DATA_NAMESPACE } from "@/features/mona-vnext/memory/monaVnextNamespace";
import {
  commitWindDownReviewCycleState,
  summarizeWindDownReviewQueue,
  WindDownReviewCycleError,
  type WindDownReviewCycleInput,
  type WindDownReviewCycleMaterial,
  type WindDownReviewCycleReceipt,
} from "@/features/winddown/server/reviewCycle";

const PROFILE_STORAGE_KEY = "mona-vnext-learning-profile";
const RECEIPT_STORAGE_PREFIX = "winddown-review-receipt:";
const PROFILE_KV_KEY =
  `data/${MONA_VNEXT_DATA_NAMESPACE}/owner-test/learning-profile.json`;

type KvNamespaceLike = {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { metadata?: Record<string, unknown> },
  ): Promise<unknown>;
};

type StorageTransactionLike = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
};

export type WindDownReviewCoordinatorState = {
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
  storage: StorageTransactionLike & {
    transaction<T>(
      callback: (transaction: StorageTransactionLike) => Promise<T>,
    ): Promise<T>;
  };
};

export type WindDownReviewCoordinatorEnv = {
  MONA_VNEXT_KV: KvNamespaceLike;
};

export type MonaVnextProfileCoordinatorCommand =
  | {
      operation: "read-learning-profile";
    }
  | {
      operation: "append-learning-events";
      learningEvents: MonaVnextLearningEvent[];
    }
  | {
      operation: "commit-review-cycle";
      input: WindDownReviewCycleInput;
      material: WindDownReviewCycleMaterial | null;
      activeMaterialIds: string[];
      currentContentDigest: string;
      nowIso: string;
    };

function noStoreJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function normalizeLearningEvents(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return null;
  const events: MonaVnextLearningEvent[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const source = item as Record<string, unknown>;
    const event = buildLearningEvent({
      expressionId:
        typeof source.expressionId === "string"
          ? source.expressionId.trim().slice(0, 120)
          : "",
      verdict:
        source.verdict === "canonical" ||
        source.verdict === "variant" ||
        source.verdict === "close" ||
        source.verdict === "miss"
          ? source.verdict
          : "garbage",
      atIso:
        typeof source.atIso === "string"
          ? source.atIso.trim().slice(0, 80)
          : "",
      sessionId:
        typeof source.sessionId === "string"
          ? source.sessionId.trim().slice(0, 160)
          : "",
    });
    if (!event || !event.expressionId || !event.atIso || !event.sessionId) {
      return null;
    }
    events.push(event);
  }
  return events;
}

async function initialProfile(
  state: WindDownReviewCoordinatorState,
  env: WindDownReviewCoordinatorEnv,
) {
  const stored = await state.storage.get<MonaVnextLearningProfile>(
    PROFILE_STORAGE_KEY,
  );
  if (stored) return normalizeMonaVnextLearningProfile(stored);
  const raw = await env.MONA_VNEXT_KV.get(PROFILE_KV_KEY);
  const profile = raw
    ? normalizeMonaVnextLearningProfile(JSON.parse(raw))
    : createEmptyMonaVnextLearningProfile();
  await state.storage.put(PROFILE_STORAGE_KEY, profile);
  return profile;
}

async function mirrorProfile(
  env: WindDownReviewCoordinatorEnv,
  profile: MonaVnextLearningProfile,
) {
  await env.MONA_VNEXT_KV.put(
    PROFILE_KV_KEY,
    `${JSON.stringify(
      {
        ...profile,
        namespace: MONA_VNEXT_DATA_NAMESPACE,
        tester: "owner",
        productionWriteEnabled: false,
      },
      null,
      2,
    )}\n`,
    { metadata: { contentType: "application/json; charset=utf-8" } },
  );
}

function receiptKey(reviewCycleId: string) {
  return `${RECEIPT_STORAGE_PREFIX}${reviewCycleId}`;
}

function normalizeActiveMaterialIds(value: unknown) {
  if (!Array.isArray(value) || value.length > 2_000) return null;
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const normalized = item.trim();
    if (!normalized || normalized.length > 120) return null;
    ids.push(normalized);
  }
  return [...new Set(ids)];
}

export async function handleMonaVnextProfileCoordinatorRequest(
  state: WindDownReviewCoordinatorState,
  env: WindDownReviewCoordinatorEnv,
  request: Request,
) {
  if (request.method !== "POST") {
    return noStoreJson({ error: "METHOD_NOT_ALLOWED" }, 405);
  }
  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!body || typeof body.operation !== "string") {
    return noStoreJson({ error: "INVALID_PROFILE_COORDINATOR_COMMAND" }, 400);
  }

  const initializedProfile = await initialProfile(state, env);

  if (body.operation === "read-learning-profile") {
    return noStoreJson({
      ok: true,
      operation: body.operation,
      profile: initializedProfile,
    });
  }

  if (body.operation === "append-learning-events") {
    const events = normalizeLearningEvents(body.learningEvents);
    if (!events) {
      return noStoreJson({ error: "INVALID_LEARNING_EVENTS" }, 400);
    }
    const profile = await state.storage.transaction(async (transaction) => {
      const current =
        (await transaction.get<MonaVnextLearningProfile>(
          PROFILE_STORAGE_KEY,
        )) ?? createEmptyMonaVnextLearningProfile();
      const next = applyMonaVnextLearningEvents(current, events);
      await transaction.put(PROFILE_STORAGE_KEY, next);
      return next;
    });
    await mirrorProfile(env, profile);
    return noStoreJson({
      ok: true,
      operation: body.operation,
      appliedEventCount: events.length,
      updatedAt: profile.updatedAt,
    });
  }

  if (body.operation === "commit-review-cycle") {
    const input = body.input;
    const inputRecord =
      input && typeof input === "object" && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {};
    const cycleId =
      typeof inputRecord.reviewCycleId === "string"
        ? inputRecord.reviewCycleId
        : "";
    const activeMaterialIds = normalizeActiveMaterialIds(body.activeMaterialIds);
    if (!activeMaterialIds) {
      return noStoreJson({ error: "INVALID_PROFILE_COORDINATOR_COMMAND" }, 400);
    }
    try {
      const result = await state.storage.transaction(async (transaction) => {
        const profile =
          (await transaction.get<MonaVnextLearningProfile>(
            PROFILE_STORAGE_KEY,
          )) ?? createEmptyMonaVnextLearningProfile();
        const existingReceipt = cycleId
          ? (await transaction.get<WindDownReviewCycleReceipt>(
              receiptKey(cycleId),
            )) ?? null
          : null;
        const committed = await commitWindDownReviewCycleState({
          profile,
          existingReceipt,
          input,
          material:
            body.material &&
            typeof body.material === "object" &&
            !Array.isArray(body.material)
              ? (body.material as WindDownReviewCycleMaterial)
              : null,
          currentContentDigest:
            typeof body.currentContentDigest === "string"
              ? body.currentContentDigest
              : "",
          nowIso: typeof body.nowIso === "string" ? body.nowIso : "",
        });
        if (!committed.duplicate) {
          await transaction.put(PROFILE_STORAGE_KEY, committed.profile);
          await transaction.put(
            receiptKey(committed.receipt.reviewCycleId),
            committed.receipt,
          );
        }
        return {
          ...committed,
          ...summarizeWindDownReviewQueue({
            profile: committed.profile,
            nowIso:
              typeof body.nowIso === "string" ? body.nowIso : "",
            activeMaterialIds,
          }),
        };
      });
      // The DO copy is authoritative. Re-mirroring duplicates repairs a prior
      // response interrupted after the atomic DO transaction.
      await mirrorProfile(env, result.profile);
      return noStoreJson({
        ok: true,
        operation: body.operation,
        duplicate: result.duplicate,
        receipt: result.receipt,
        remainingDueCount: result.remainingDueCount,
        nextDueAtIso: result.nextDueAtIso,
      });
    } catch (error) {
      if (error instanceof WindDownReviewCycleError) {
        return noStoreJson({ error: error.code }, error.status);
      }
      throw error;
    }
  }

  return noStoreJson({ error: "INVALID_PROFILE_COORDINATOR_COMMAND" }, 400);
}
