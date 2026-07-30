import { evaluateMonaVnextAnswerAttempt } from "@/features/mona-vnext/coach/answerMatcher";
import {
  applyMonaVnextLearningEvents,
  normalizeMonaVnextLearningProfile,
  type MonaVnextLearningProfile,
  type MonaVnextLearningRecord,
} from "@/features/mona-vnext/memory/fsrsLearningProfile";
import { buildLearningEvent } from "@/features/mona-vnext/memory/srsBridge";
import type { MonaVnextLearningRating } from "@/features/mona-vnext/memory/srsBridge";
import type { MonaVnextExpression } from "@/features/mona-vnext/coach/coachPolicy";

export const WINDDOWN_REVIEW_CYCLE_SCHEMA_VERSION = 1 as const;

export type WindDownReviewAttemptEvidence = {
  answer: string;
  revealedBefore: boolean;
};

export type WindDownReviewCycleInput = {
  schemaVersion: typeof WINDDOWN_REVIEW_CYCLE_SCHEMA_VERSION;
  activity: "review";
  reviewCycleId: string;
  materialId: string;
  contentDigest: string;
  attempts: WindDownReviewAttemptEvidence[];
};

export type WindDownReviewGradeInput = {
  schemaVersion: typeof WINDDOWN_REVIEW_CYCLE_SCHEMA_VERSION;
  activity: "review";
  reviewCycleId: string;
  materialId: string;
  contentDigest: string;
  attempt: WindDownReviewAttemptEvidence;
};

export type WindDownReviewCycleMaterial = {
  id: string;
  en: string;
  acceptedVariants?: string[];
};

export type WindDownReviewCycleReceipt = {
  schemaVersion: typeof WINDDOWN_REVIEW_CYCLE_SCHEMA_VERSION;
  reviewCycleId: string;
  requestDigest: string;
  materialId: string;
  reviewedAt: string;
  rating: MonaVnextLearningRating;
  reward: 0 | 1;
};

export type WindDownReviewCycleErrorCode =
  | "INVALID_REVIEW_CYCLE"
  | "MATERIAL_VERSION_CHANGED"
  | "MATERIAL_NOT_ACTIVE"
  | "REVIEW_CYCLE_NOT_DUE"
  | "REVIEW_CYCLE_STALE"
  | "REVIEW_CYCLE_CONFLICT";

export class WindDownReviewCycleError extends Error {
  constructor(
    readonly code: WindDownReviewCycleErrorCode,
    readonly status: 400 | 409,
  ) {
    super(code);
    this.name = "WindDownReviewCycleError";
  }
}

type CommitArgs = {
  profile: MonaVnextLearningProfile;
  existingReceipt: WindDownReviewCycleReceipt | null;
  input: unknown;
  material: WindDownReviewCycleMaterial | null;
  currentContentDigest: string;
  nowIso: string;
};

type GradeArgs = Omit<CommitArgs, "existingReceipt">;

const SAFE_ID = /^[A-Za-z0-9._:-]+$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const REVIEW_CYCLE_ID = /^winddown-review:[a-f0-9]{64}$/;
const MAX_ANSWER_LENGTH = 240;

function cleanId(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized &&
      normalized.length <= maxLength &&
      SAFE_ID.test(normalized)
    ? normalized
    : null;
}

function normalizeAttempt(value: unknown): WindDownReviewAttemptEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (
    typeof source.answer !== "string" ||
    source.answer.length > MAX_ANSWER_LENGTH ||
    typeof source.revealedBefore !== "boolean" ||
    (!source.answer.trim() && source.revealedBefore !== true)
  ) {
    return null;
  }
  return {
    answer: source.answer,
    revealedBefore: source.revealedBefore,
  };
}

function normalizeAttempts(value: unknown): WindDownReviewAttemptEvidence[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) return null;
  const attempts = value.map(normalizeAttempt);
  return attempts.every(
      (attempt): attempt is WindDownReviewAttemptEvidence => Boolean(attempt),
    )
    ? attempts
    : null;
}

export function normalizeWindDownReviewCycleInput(
  value: unknown,
): WindDownReviewCycleInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WindDownReviewCycleError("INVALID_REVIEW_CYCLE", 400);
  }
  const source = value as Record<string, unknown>;
  const reviewCycleId =
    typeof source.reviewCycleId === "string" &&
      REVIEW_CYCLE_ID.test(source.reviewCycleId)
      ? source.reviewCycleId
      : null;
  const materialId = cleanId(source.materialId, 120);
  const contentDigest =
    typeof source.contentDigest === "string" &&
      SHA256_HEX.test(source.contentDigest)
      ? source.contentDigest
      : null;
  const attempts = normalizeAttempts(source.attempts);
  if (
    source.schemaVersion !== WINDDOWN_REVIEW_CYCLE_SCHEMA_VERSION ||
    source.activity !== "review" ||
    !reviewCycleId ||
    !materialId ||
    !contentDigest ||
    !attempts
  ) {
    throw new WindDownReviewCycleError("INVALID_REVIEW_CYCLE", 400);
  }
  return {
    schemaVersion: WINDDOWN_REVIEW_CYCLE_SCHEMA_VERSION,
    activity: "review",
    reviewCycleId,
    materialId,
    contentDigest,
    attempts,
  };
}

export function normalizeWindDownReviewGradeInput(
  value: unknown,
): WindDownReviewGradeInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WindDownReviewCycleError("INVALID_REVIEW_CYCLE", 400);
  }
  const source = value as Record<string, unknown>;
  const base = normalizeWindDownReviewCycleInput({
    ...source,
    attempts: [source.attempt],
  });
  return {
    schemaVersion: base.schemaVersion,
    activity: base.activity,
    reviewCycleId: base.reviewCycleId,
    materialId: base.materialId,
    contentDigest: base.contentDigest,
    attempt: base.attempts[0],
  };
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function createWindDownReviewCycleId(args: {
  materialId: string;
  contentDigest: string;
  record: MonaVnextLearningRecord;
}) {
  const digest = await sha256(
    [
      args.materialId,
      args.contentDigest,
      args.record.lastReviewedAt,
      args.record.card.dueAtIso,
    ].join("\n"),
  );
  return `winddown-review:${digest}`;
}

export async function buildWindDownReviewCards(args: {
  cards: MonaVnextExpression[];
  profile: MonaVnextLearningProfile;
  contentDigest: string;
  nowIso: string;
}) {
  const nowMs = Date.parse(args.nowIso);
  if (!Number.isFinite(nowMs) || !SHA256_HEX.test(args.contentDigest)) {
    throw new WindDownReviewCycleError("INVALID_REVIEW_CYCLE", 400);
  }
  const profile = normalizeMonaVnextLearningProfile(args.profile);
  const cards = await Promise.all(args.cards.map(async (card) => {
    const record = profile.records[card.id];
    if (!record || Date.parse(record.card.dueAtIso) > nowMs) return null;
    return {
      ...card,
      reviewCycleId: await createWindDownReviewCycleId({
        materialId: card.id,
        contentDigest: args.contentDigest,
        record,
      }),
      dueAtIso: record.card.dueAtIso,
    };
  }));
  return cards.filter(
    (card): card is NonNullable<(typeof cards)[number]> => Boolean(card),
  );
}

async function requestDigest(input: WindDownReviewCycleInput) {
  return sha256(JSON.stringify({
    schemaVersion: input.schemaVersion,
    activity: input.activity,
    reviewCycleId: input.reviewCycleId,
    materialId: input.materialId,
    contentDigest: input.contentDigest,
    attempts: input.attempts.map((attempt) => ({
      answer: attempt.answer,
      revealedBefore: attempt.revealedBefore,
    })),
  }));
}

function isStrictRecall(
  attempt: WindDownReviewAttemptEvidence,
  material: WindDownReviewCycleMaterial,
) {
  if (attempt.revealedBefore) return false;
  const match = evaluateMonaVnextAnswerAttempt(
    attempt.answer,
    material.en,
    material.acceptedVariants ?? [],
  );
  return match.reason === "exact-normalized-match" ||
    match.reason === "accepted-variant-match";
}

function outcome(args: {
  attempts: WindDownReviewAttemptEvidence[];
  material: WindDownReviewCycleMaterial;
}) {
  const matches = args.attempts.map((attempt) =>
    evaluateMonaVnextAnswerAttempt(
      attempt.answer,
      args.material.en,
      args.material.acceptedVariants ?? [],
    )
  );
  const passed = (index: number) =>
    args.attempts
      .slice(0, index + 1)
      .every((attempt) => attempt.revealedBefore === false) &&
    Boolean(args.attempts[index] && isStrictRecall(
      args.attempts[index],
      args.material,
    ));
  if (passed(0)) {
    return {
      rating: "good" as const,
      reward: 1 as const,
      verdict: matches[0]?.tier === "variant" ? "variant" as const : "canonical" as const,
    };
  }
  if (args.attempts.length === 2 && passed(1)) {
    return {
      rating: "hard" as const,
      reward: 1 as const,
      verdict: "close" as const,
    };
  }
  return {
    rating: "again" as const,
    reward: 0 as const,
    verdict: "miss" as const,
  };
}

async function validateReviewCycleContext(args: {
  profile: MonaVnextLearningProfile;
  reviewCycleId: string;
  materialId: string;
  contentDigest: string;
  material: WindDownReviewCycleMaterial | null;
  currentContentDigest: string;
  nowIso: string;
}) {
  if (args.contentDigest !== args.currentContentDigest) {
    throw new WindDownReviewCycleError("MATERIAL_VERSION_CHANGED", 409);
  }
  if (!args.material || args.materialId !== args.material.id) {
    throw new WindDownReviewCycleError("MATERIAL_NOT_ACTIVE", 409);
  }
  const nowMs = Date.parse(args.nowIso);
  if (!Number.isFinite(nowMs)) {
    throw new WindDownReviewCycleError("INVALID_REVIEW_CYCLE", 400);
  }
  const profile = normalizeMonaVnextLearningProfile(args.profile);
  const record = profile.records[args.materialId];
  if (!record || Date.parse(record.card.dueAtIso) > nowMs) {
    throw new WindDownReviewCycleError("REVIEW_CYCLE_NOT_DUE", 409);
  }
  const expectedCycleId = await createWindDownReviewCycleId({
    materialId: args.materialId,
    contentDigest: args.contentDigest,
    record,
  });
  if (args.reviewCycleId !== expectedCycleId) {
    throw new WindDownReviewCycleError("REVIEW_CYCLE_STALE", 409);
  }
  return { nowMs, profile, material: args.material };
}

export async function gradeWindDownReviewAttemptState(args: GradeArgs) {
  const input = normalizeWindDownReviewGradeInput(args.input);
  await validateReviewCycleContext({
    profile: args.profile,
    reviewCycleId: input.reviewCycleId,
    materialId: input.materialId,
    contentDigest: input.contentDigest,
    material: args.material,
    currentContentDigest: args.currentContentDigest,
    nowIso: args.nowIso,
  });
  if (input.attempt.revealedBefore) {
    return { outcome: "revealed" as const, needsRepair: true };
  }
  if (args.material && isStrictRecall(input.attempt, args.material)) {
    return { outcome: "correct" as const, needsRepair: false };
  }
  return { outcome: "miss" as const, needsRepair: true };
}

export function summarizeWindDownReviewQueue(args: {
  profile: MonaVnextLearningProfile;
  nowIso: string;
  activeMaterialIds?: Iterable<string>;
}) {
  const nowMs = Date.parse(args.nowIso);
  if (!Number.isFinite(nowMs)) {
    throw new WindDownReviewCycleError("INVALID_REVIEW_CYCLE", 400);
  }
  const activeIds = args.activeMaterialIds
    ? new Set(args.activeMaterialIds)
    : null;
  const records = Object.values(
    normalizeMonaVnextLearningProfile(args.profile).records,
  )
    .filter((record) => !activeIds || activeIds.has(record.expressionId))
    .sort((left, right) =>
      Date.parse(left.card.dueAtIso) - Date.parse(right.card.dueAtIso) ||
      left.expressionId.localeCompare(right.expressionId)
    );
  return {
    remainingDueCount: records.filter(
      (record) => Date.parse(record.card.dueAtIso) <= nowMs,
    ).length,
    nextDueAtIso: records[0]?.card.dueAtIso ?? null,
  };
}

export async function commitWindDownReviewCycleState(args: CommitArgs) {
  const input = normalizeWindDownReviewCycleInput(args.input);
  const digest = await requestDigest(input);
  if (args.existingReceipt) {
    if (
      args.existingReceipt.reviewCycleId !== input.reviewCycleId ||
      args.existingReceipt.requestDigest !== digest
    ) {
      throw new WindDownReviewCycleError("REVIEW_CYCLE_CONFLICT", 409);
    }
    return {
      profile: normalizeMonaVnextLearningProfile(args.profile),
      receipt: args.existingReceipt,
      duplicate: true,
    };
  }

  const { nowMs, profile, material } = await validateReviewCycleContext({
    profile: args.profile,
    reviewCycleId: input.reviewCycleId,
    materialId: input.materialId,
    contentDigest: input.contentDigest,
    material: args.material,
    currentContentDigest: args.currentContentDigest,
    nowIso: args.nowIso,
  });

  const result = outcome({ attempts: input.attempts, material });
  const reviewedAt = new Date(nowMs).toISOString();
  const learningEvent = buildLearningEvent({
    expressionId: input.materialId,
    verdict: result.verdict,
    atIso: reviewedAt,
    sessionId: input.reviewCycleId,
  });
  if (!learningEvent || learningEvent.rating !== result.rating) {
    throw new WindDownReviewCycleError("INVALID_REVIEW_CYCLE", 400);
  }
  const receipt: WindDownReviewCycleReceipt = {
    schemaVersion: WINDDOWN_REVIEW_CYCLE_SCHEMA_VERSION,
    reviewCycleId: input.reviewCycleId,
    requestDigest: digest,
    materialId: input.materialId,
    reviewedAt,
    rating: result.rating,
    reward: result.reward,
  };
  return {
    profile: applyMonaVnextLearningEvents(profile, [learningEvent]),
    receipt,
    duplicate: false,
  };
}
