import {
  Rating,
  State,
  createEmptyCard,
  fsrs,
  type Card,
  type CardInput,
} from "ts-fsrs";
import type {
  MonaVnextLearningEvent,
  MonaVnextLearningRating,
} from "@/features/mona-vnext/memory/srsBridge";

export type MonaVnextSerializedFsrsCard = {
  dueAtIso: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: State;
  lastReviewAtIso?: string;
};

export type MonaVnextLearningRecord = {
  expressionId: string;
  lastVerdict: MonaVnextLearningEvent["verdict"];
  lastRating: MonaVnextLearningRating;
  lastReviewedAt: string;
  card: MonaVnextSerializedFsrsCard;
};

export type MonaVnextLearningProfile = {
  schemaVersion: 1;
  source: "mona-vnext-fsrs";
  updatedAt: string | null;
  records: Record<string, MonaVnextLearningRecord>;
  appliedEventIds: string[];
};

const scheduler = fsrs({ enable_fuzz: false });
const MAX_PROFILE_RECORDS = 1000;
const MAX_APPLIED_EVENT_IDS = 4000;

function finiteNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function integer(value: unknown, fallback = 0) {
  return Math.max(0, Math.round(finiteNumber(value, fallback)));
}

function validIso(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeState(value: unknown): State {
  return value === State.Learning || value === State.Review || value === State.Relearning
    ? value
    : State.New;
}

function serializeCard(card: Card): MonaVnextSerializedFsrsCard {
  return {
    dueAtIso: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    ...(card.last_review ? { lastReviewAtIso: card.last_review.toISOString() } : {}),
  };
}

function deserializeCard(card: MonaVnextSerializedFsrsCard): CardInput {
  return {
    due: card.dueAtIso,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    ...(card.lastReviewAtIso ? { last_review: card.lastReviewAtIso } : {}),
  };
}

function normalizeCard(value: unknown): MonaVnextSerializedFsrsCard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const dueAtIso = validIso(record.dueAtIso);
  if (!dueAtIso) return null;
  const lastReviewAtIso = validIso(record.lastReviewAtIso);
  return {
    dueAtIso,
    stability: Math.max(0, finiteNumber(record.stability)),
    difficulty: Math.max(0, finiteNumber(record.difficulty)),
    elapsedDays: integer(record.elapsedDays),
    scheduledDays: integer(record.scheduledDays),
    learningSteps: integer(record.learningSteps),
    reps: integer(record.reps),
    lapses: integer(record.lapses),
    state: normalizeState(record.state),
    ...(lastReviewAtIso ? { lastReviewAtIso } : {}),
  };
}

function normalizeRating(value: unknown): MonaVnextLearningRating | null {
  return value === "again" || value === "hard" || value === "good" ? value : null;
}

function normalizeVerdict(value: unknown): MonaVnextLearningEvent["verdict"] | null {
  return value === "miss" || value === "close" || value === "canonical" || value === "variant"
    ? value
    : null;
}

function eventId(event: MonaVnextLearningEvent) {
  return `${event.sessionId}:${event.expressionId}:${event.atIso}`;
}

function toFsrsRating(rating: MonaVnextLearningRating) {
  if (rating === "again") return Rating.Again;
  if (rating === "hard") return Rating.Hard;
  return Rating.Good;
}

export function createEmptyMonaVnextLearningProfile(): MonaVnextLearningProfile {
  return {
    schemaVersion: 1,
    source: "mona-vnext-fsrs",
    updatedAt: null,
    records: {},
    appliedEventIds: [],
  };
}

export function normalizeMonaVnextLearningProfile(value: unknown): MonaVnextLearningProfile {
  const empty = createEmptyMonaVnextLearningProfile();
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty;
  const source = value as Record<string, unknown>;
  const rawRecords = source.records && typeof source.records === "object" && !Array.isArray(source.records)
    ? source.records as Record<string, unknown>
    : {};
  const records: Record<string, MonaVnextLearningRecord> = {};

  for (const [key, raw] of Object.entries(rawRecords).slice(-MAX_PROFILE_RECORDS)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const expressionId = typeof record.expressionId === "string"
      ? record.expressionId.trim().slice(0, 120)
      : key.trim().slice(0, 120);
    const lastVerdict = normalizeVerdict(record.lastVerdict);
    const lastRating = normalizeRating(record.lastRating);
    const lastReviewedAt = validIso(record.lastReviewedAt);
    const card = normalizeCard(record.card);
    if (!expressionId || !lastVerdict || !lastRating || !lastReviewedAt || !card) continue;
    records[expressionId] = {
      expressionId,
      lastVerdict,
      lastRating,
      lastReviewedAt,
      card,
    };
  }

  const appliedEventIds = Array.isArray(source.appliedEventIds)
    ? source.appliedEventIds
      .filter((item): item is string => typeof item === "string" && item.length > 0)
      .slice(-MAX_APPLIED_EVENT_IDS)
    : [];

  return {
    ...empty,
    updatedAt: validIso(source.updatedAt),
    records,
    appliedEventIds,
  };
}

export function applyMonaVnextLearningEvents(
  current: MonaVnextLearningProfile,
  events: MonaVnextLearningEvent[],
): MonaVnextLearningProfile {
  const profile = normalizeMonaVnextLearningProfile(current);
  const records = { ...profile.records };
  const appliedEventIds = [...profile.appliedEventIds];
  const seen = new Set(appliedEventIds);
  let updatedAt = profile.updatedAt;

  for (const event of events) {
    const id = eventId(event);
    if (seen.has(id)) continue;
    const reviewedAt = validIso(event.atIso);
    if (!reviewedAt) continue;
    const reviewedDate = new Date(reviewedAt);
    const previous = records[event.expressionId];
    const baseCard = previous
      ? deserializeCard(previous.card)
      : createEmptyCard(reviewedDate);
    const result = scheduler.next(baseCard, reviewedDate, toFsrsRating(event.rating));
    records[event.expressionId] = {
      expressionId: event.expressionId,
      lastVerdict: event.verdict,
      lastRating: event.rating,
      lastReviewedAt: reviewedAt,
      card: serializeCard(result.card),
    };
    seen.add(id);
    appliedEventIds.push(id);
    updatedAt = !updatedAt || reviewedAt > updatedAt ? reviewedAt : updatedAt;
  }

  const recordEntries = Object.entries(records)
    .sort((a, b) => a[1].lastReviewedAt.localeCompare(b[1].lastReviewedAt))
    .slice(-MAX_PROFILE_RECORDS);
  return {
    ...profile,
    updatedAt,
    records: Object.fromEntries(recordEntries),
    appliedEventIds: appliedEventIds.slice(-MAX_APPLIED_EVENT_IDS),
  };
}

export function classifyMonaVnextLearningProfile(
  profile: MonaVnextLearningProfile,
  now = new Date(),
) {
  const nowMs = now.getTime();
  const records = Object.values(normalizeMonaVnextLearningProfile(profile).records);
  const sorted = records.sort((a, b) => (
    Date.parse(a.card.dueAtIso) - Date.parse(b.card.dueAtIso)
      || a.expressionId.localeCompare(b.expressionId)
  ));
  return {
    dueExpressionIds: sorted
      .filter((record) => Date.parse(record.card.dueAtIso) <= nowMs)
      .map((record) => record.expressionId),
    deferredExpressionIds: sorted
      .filter((record) => Date.parse(record.card.dueAtIso) > nowMs)
      .map((record) => record.expressionId),
  };
}
