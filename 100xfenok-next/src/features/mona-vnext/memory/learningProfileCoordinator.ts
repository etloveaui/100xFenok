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
import {
  isWindDownVoiceReport,
  type WindDownVoiceReport,
} from "@/features/winddown/voice/report";
import {
  applyWindDownLearnAction,
  createWindDownLearnSession,
  type WindDownLearnAction,
  type WindDownLearnCard,
  type WindDownLearnState,
} from "@/features/winddown/learn/engine";
import {
  appendWindDownHabitCompletionEvent,
  createWindDownHabitCompletionEvent,
  getWindDownHabitKstDay,
  projectWindDownHabit,
  WindDownHabitError,
  type WindDownHabitCompletionEvent,
  type WindDownHabitLearnCreditReceipt,
} from "@/features/winddown/habit/domain";
import {
  projectWindDownGameProgress,
} from "@/features/winddown/game/model/progress";
import {
  normalizeWindDownLearnSessionManifest,
  type WindDownLearnSessionManifest,
} from "@/features/winddown/server/learnSessionProof";
import {
  normalizeWindDownVoiceJourneyTargets,
  type WindDownVoiceJourneyTarget,
} from "@/features/winddown/voice/journeyTarget";

const PROFILE_STORAGE_KEY = "mona-vnext-learning-profile";
const RECEIPT_STORAGE_PREFIX = "winddown-review-receipt:";
const VOICE_REPORT_STORAGE_PREFIX = "winddown-voice-report:";
const HABIT_EVENTS_STORAGE_KEY = "winddown-habit-events";
const LEARN_SESSION_STORAGE_PREFIX = "winddown-learn-session:";
const LEARN_ATTEMPT_STORAGE_PREFIX = "winddown-learn-attempt:";
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
    }
  | {
      operation: "commit-voice-report";
      receipt: WindDownVoiceReportReceipt;
    }
  | {
      operation: "read-winddown-habit";
      nowIso: string;
    }
  | {
      operation: "commit-learn-attempt";
      manifest: WindDownLearnSessionManifest;
      cards: WindDownLearnCard[];
      attemptId: string;
      action: WindDownLearnAction;
      nowIso: string;
    };

export type WindDownVoiceReportReceipt = {
  schemaVersion: 1;
  activity: "roleplay" | "live-talk";
  productSessionId: string;
  finalDigest: string;
  committedAtIso: string;
  report: WindDownVoiceReport;
  journeyTargets?: WindDownVoiceJourneyTarget[];
};

type StoredWindDownLearnSession = {
  schemaVersion: 1;
  manifest: WindDownLearnSessionManifest;
  state: WindDownLearnState;
};

type StoredWindDownLearnAttempt = {
  schemaVersion: 1;
  attemptId: string;
  requestDigest: string;
  outcome: "miss" | "practice" | "correct" | "complete";
  reward: 0 | 1;
  state: WindDownLearnState;
  completionReceipt: WindDownHabitLearnCreditReceipt | null;
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

function voiceReportKey(productSessionId: string) {
  return `${VOICE_REPORT_STORAGE_PREFIX}${productSessionId}`;
}

function learnSessionKey(habitKstDay: string) {
  return `${LEARN_SESSION_STORAGE_PREFIX}${habitKstDay}`;
}

function learnAttemptKey(attemptId: string) {
  return `${LEARN_ATTEMPT_STORAGE_PREFIX}${attemptId}`;
}

function normalizeNowIso(value: unknown) {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function normalizeLearnAttemptId(value: unknown) {
  return typeof value === "string"
    && /^[A-Za-z0-9._:-]{1,160}$/.test(value)
    ? value
    : null;
}

function normalizeLearnAction(value: unknown): WindDownLearnAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (
    source.type === "choose-meaning"
    && Object.keys(source).length === 3
    && typeof source.cardId === "string"
    && typeof source.choiceId === "string"
  ) {
    return {
      type: source.type,
      cardId: source.cardId,
      choiceId: source.choiceId,
    };
  }
  if (
    source.type === "submit-sentence"
    && Object.keys(source).length === 3
    && typeof source.cardId === "string"
    && Array.isArray(source.tokenIds)
    && source.tokenIds.length <= 20
    && source.tokenIds.every((tokenId) => typeof tokenId === "string")
  ) {
    return {
      type: source.type,
      cardId: source.cardId,
      tokenIds: source.tokenIds,
    };
  }
  return null;
}

function sameLearnManifestIdentity(
  left: WindDownLearnSessionManifest,
  right: WindDownLearnSessionManifest,
) {
  return left.sessionId === right.sessionId
    && left.habitKstDay === right.habitKstDay
    && left.seed === right.seed
    && left.contentDigest === right.contentDigest
    && JSON.stringify(left.cardIds) === JSON.stringify(right.cardIds);
}

function normalizeLearnCards(
  value: unknown,
  manifest: WindDownLearnSessionManifest,
) {
  if (!Array.isArray(value) || value.length !== 5) return null;
  const cards: WindDownLearnCard[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const source = item as Record<string, unknown>;
    if (
      typeof source.id !== "string"
      || typeof source.ko !== "string"
      || typeof source.en !== "string"
    ) return null;
    cards.push({
      id: source.id,
      ko: source.ko,
      en: source.en,
      ...(Array.isArray(source.acceptedVariants)
        ? {
            acceptedVariants: source.acceptedVariants.filter(
              (item): item is string => typeof item === "string",
            ),
          }
        : {}),
    });
  }
  const cardIds = cards.map((card) => card.id);
  return cardIds.length === manifest.cardIds.length
    && cardIds.every((id, index) => id === manifest.cardIds[index])
    ? cards
    : null;
}

async function readHabitEvents(storage: StorageTransactionLike) {
  return (await storage.get<WindDownHabitCompletionEvent[]>(
    HABIT_EVENTS_STORAGE_KEY,
  )) ?? [];
}

async function appendHabitEvent(
  transaction: StorageTransactionLike,
  candidate: WindDownHabitCompletionEvent,
) {
  const appended = appendWindDownHabitCompletionEvent(
    await readHabitEvents(transaction),
    candidate,
  );
  await transaction.put(HABIT_EVENTS_STORAGE_KEY, appended.events);
  return appended;
}

function normalizeVoiceReportReceipt(value: unknown): WindDownVoiceReportReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const receiptKeys = new Set([
    "schemaVersion",
    "activity",
    "productSessionId",
    "finalDigest",
    "committedAtIso",
    "report",
    "journeyTargets",
  ]);
  const keys = Object.keys(source);
  if (
    (keys.length !== receiptKeys.size && keys.length !== receiptKeys.size - 1)
    || !keys.every((key) => receiptKeys.has(key))
  ) return null;
  const productSessionId =
    typeof source.productSessionId === "string"
      ? source.productSessionId.trim()
      : "";
  const finalDigest =
    typeof source.finalDigest === "string" ? source.finalDigest.trim() : "";
  const committedAtIso =
    typeof source.committedAtIso === "string" ? source.committedAtIso.trim() : "";
  const committedAtMs = Date.parse(committedAtIso);
  const journeyTargets = normalizeWindDownVoiceJourneyTargets(
    source.journeyTargets ?? [],
  );
  if (
    source.schemaVersion !== 1 ||
    (source.activity !== "roleplay" && source.activity !== "live-talk") ||
    !/^[A-Za-z0-9._-]{8,160}$/.test(productSessionId) ||
    !/^[a-f0-9]{64}$/.test(finalDigest) ||
    !Number.isFinite(committedAtMs) ||
    !journeyTargets ||
    (source.activity === "live-talk" && journeyTargets.length > 0) ||
    !isWindDownVoiceReport(source.report) ||
    source.report.activity !== source.activity ||
    source.report.productSessionId !== productSessionId
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    activity: source.activity,
    productSessionId,
    finalDigest,
    committedAtIso: new Date(committedAtMs).toISOString(),
    report: source.report,
    journeyTargets,
  };
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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

  if (body.operation === "read-learning-profile") {
    const initializedProfile = await initialProfile(state, env);
    return noStoreJson({
      ok: true,
      operation: body.operation,
      profile: initializedProfile,
    });
  }

  if (body.operation === "read-winddown-habit") {
    const nowIso = normalizeNowIso(body.nowIso);
    if (!nowIso) {
      return noStoreJson({ error: "INVALID_PROFILE_COORDINATOR_COMMAND" }, 400);
    }
    const events = await readHabitEvents(state.storage);
    const projection = projectWindDownHabit({
      events,
      now: new Date(nowIso),
    });
    const game = projectWindDownGameProgress(events);
    const activeLearn =
      (await state.storage.get<StoredWindDownLearnSession>(
        learnSessionKey(projection.currentKstDay),
      )) ?? null;
    return noStoreJson({
      ok: true,
      operation: body.operation,
      projection,
      game,
      activeLearn,
    });
  }

  if (body.operation === "commit-learn-attempt") {
    await initialProfile(state, env);
    const manifest = normalizeWindDownLearnSessionManifest(body.manifest);
    const attemptId = normalizeLearnAttemptId(body.attemptId);
    const action = normalizeLearnAction(body.action);
    const nowIso = normalizeNowIso(body.nowIso);
    const cards = manifest ? normalizeLearnCards(body.cards, manifest) : null;
    if (
      !manifest
      || !attemptId
      || !action
      || !nowIso
      || !cards
      || manifest.habitKstDay !== getWindDownHabitKstDay(new Date(nowIso))
      || Date.parse(manifest.issuedAtIso) > Date.parse(nowIso) + 30_000
      || Date.parse(manifest.expiresAtIso) <= Date.parse(nowIso)
    ) {
      return noStoreJson({ error: "INVALID_WINDDOWN_LEARN_ATTEMPT" }, 400);
    }
    const requestDigest = await sha256Hex(JSON.stringify({
      manifest: {
        sessionId: manifest.sessionId,
        habitKstDay: manifest.habitKstDay,
        seed: manifest.seed,
        cardIds: manifest.cardIds,
        contentDigest: manifest.contentDigest,
      },
      action,
    }));
    const result = await state.storage.transaction(async (transaction) => {
      const existingAttempt =
        (await transaction.get<StoredWindDownLearnAttempt>(
          learnAttemptKey(attemptId),
        )) ?? null;
      if (existingAttempt) {
        if (existingAttempt.requestDigest === requestDigest) {
          const profile = existingAttempt.reward === 1
            ? (await transaction.get<MonaVnextLearningProfile>(
                PROFILE_STORAGE_KEY,
              )) ?? createEmptyMonaVnextLearningProfile()
            : null;
          return {
              status: 200,
              duplicate: true,
              // A previous response can fail after the authoritative DO
              // transaction but before the KV mirror. Re-mirror credited
              // duplicates so a safe retry repairs that split state.
              profileDirty: existingAttempt.reward === 1,
              profile,
              receipt: existingAttempt,
            };
        }
        return {
          status: 409,
          duplicate: false,
          profileDirty: false,
          profile: null,
          receipt: existingAttempt,
        };
      }

      const sessionKey = learnSessionKey(manifest.habitKstDay);
      const existingSession =
        (await transaction.get<StoredWindDownLearnSession>(sessionKey)) ?? null;
      if (
        existingSession
        && !sameLearnManifestIdentity(existingSession.manifest, manifest)
      ) {
        return {
          status: 409,
          duplicate: false,
          profileDirty: false,
          profile: null,
          receipt: null,
        };
      }
      const currentState = existingSession?.state
        ?? createWindDownLearnSession({ cards, seed: manifest.seed });
      const applied = applyWindDownLearnAction(currentState, action);
      if (applied.outcome === "invalid") {
        return {
          status: 400,
          duplicate: false,
          profileDirty: false,
          profile: null,
          receipt: null,
        };
      }

      let profile =
        (await transaction.get<MonaVnextLearningProfile>(
          PROFILE_STORAGE_KEY,
        )) ?? createEmptyMonaVnextLearningProfile();
      let profileDirty = false;
      if (applied.reward === 1) {
        const recovered = currentState.mistakes.some(
          (mistake) => mistake.card.id === action.cardId,
        );
        const learningEvent = buildLearningEvent({
          expressionId: action.cardId,
          verdict: recovered ? "close" : "canonical",
          atIso: nowIso,
          sessionId: `winddown:${manifest.sessionId}:${attemptId}`,
        });
        if (!learningEvent) {
          return {
            status: 400,
            duplicate: false,
            profileDirty: false,
            profile: null,
            receipt: null,
          };
        }
        profile = applyMonaVnextLearningEvents(profile, [learningEvent]);
        profileDirty = true;
        await transaction.put(PROFILE_STORAGE_KEY, profile);
      }

      let completionReceipt: WindDownHabitLearnCreditReceipt | null = null;
      if (applied.state.isComplete) {
        completionReceipt = {
          schemaVersion: 1,
          activity: "learn",
          receiptId: `winddown-learn:${manifest.sessionId}`,
          sessionId: manifest.sessionId,
          persistedAtIso: nowIso,
          creditedActionCount: applied.state.creditedCardIds.length,
          completion: "five-exercises",
          persisted: true,
        };
        await appendHabitEvent(
          transaction,
          createWindDownHabitCompletionEvent({
            kind: "learn-credit-receipt",
            receipt: completionReceipt,
          }),
        );
      }

      const storedSession: StoredWindDownLearnSession = {
        schemaVersion: 1,
        manifest,
        state: applied.state,
      };
      const receipt: StoredWindDownLearnAttempt = {
        schemaVersion: 1,
        attemptId,
        requestDigest,
        outcome: applied.outcome,
        reward: applied.reward,
        state: applied.state,
        completionReceipt,
      };
      await transaction.put(sessionKey, storedSession);
      await transaction.put(learnAttemptKey(attemptId), receipt);
      return {
        status: 200,
        duplicate: false,
        profileDirty,
        profile,
        receipt,
      };
    });
    if (result.status === 409) {
      return noStoreJson({ error: "WINDDOWN_LEARN_ATTEMPT_CONFLICT" }, 409);
    }
    if (result.status === 400 || !result.receipt) {
      return noStoreJson({ error: "INVALID_WINDDOWN_LEARN_ATTEMPT" }, 400);
    }
    if (result.profileDirty && result.profile) {
      await mirrorProfile(env, result.profile);
    }
    return noStoreJson({
      ok: true,
      operation: body.operation,
      duplicate: result.duplicate,
      persisted: true,
      outcome: result.receipt.outcome,
      reward: result.receipt.reward,
      state: result.receipt.state,
      completionReceipt: result.receipt.completionReceipt,
    });
  }

  if (body.operation === "append-learning-events") {
    await initialProfile(state, env);
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
    await initialProfile(state, env);
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
        await appendHabitEvent(
          transaction,
          createWindDownHabitCompletionEvent({
            kind: "review-credit-receipt",
            receipt: committed.receipt,
          }),
        );
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

  if (body.operation === "commit-voice-report") {
    const receipt = normalizeVoiceReportReceipt(body.receipt);
    if (!receipt) {
      return noStoreJson({ error: "INVALID_WINDDOWN_VOICE_REPORT_RECEIPT" }, 400);
    }
    if (
      receipt.finalDigest !==
      await sha256Hex(JSON.stringify(receipt.report))
    ) {
      return noStoreJson({ error: "WINDDOWN_VOICE_REPORT_DIGEST_MISMATCH" }, 400);
    }
    const result = await state.storage.transaction(async (transaction) => {
      const key = voiceReportKey(receipt.productSessionId);
      const existing =
        (await transaction.get<WindDownVoiceReportReceipt>(key)) ?? null;
      if (existing) {
        if (
          existing.finalDigest !== receipt.finalDigest ||
          existing.activity !== receipt.activity
        ) {
          return {
            status: 409,
            duplicate: false,
            habitCredited: false,
            receipt: existing,
          };
        }
        let habitCredited = false;
        try {
          await appendHabitEvent(
            transaction,
            createWindDownHabitCompletionEvent({
              kind: "voice-report-receipt",
              receipt: existing,
            }),
          );
          habitCredited = true;
        } catch (error) {
          if (
            !(error instanceof WindDownHabitError)
            || error.code !== "UNQUALIFIED_HABIT_COMPLETION"
          ) throw error;
        }
        return {
          status: 200,
          duplicate: true,
          habitCredited,
          receipt: existing,
        };
      }
      await transaction.put(key, receipt);
      let habitCredited = false;
      try {
        await appendHabitEvent(
          transaction,
          createWindDownHabitCompletionEvent({
            kind: "voice-report-receipt",
            receipt,
          }),
        );
        habitCredited = true;
      } catch (error) {
        if (
          !(error instanceof WindDownHabitError)
          || error.code !== "UNQUALIFIED_HABIT_COMPLETION"
        ) throw error;
      }
      return {
        status: 200,
        duplicate: false,
        habitCredited,
        receipt,
      };
    });
    if (result.status === 409) {
      return noStoreJson({ error: "WINDDOWN_VOICE_REPORT_CONFLICT" }, 409);
    }
    return noStoreJson({
      ok: true,
      operation: body.operation,
      duplicate: result.duplicate,
      habitCredited: result.habitCredited,
      receipt: result.receipt,
    });
  }

  return noStoreJson({ error: "INVALID_PROFILE_COORDINATOR_COMMAND" }, 400);
}
