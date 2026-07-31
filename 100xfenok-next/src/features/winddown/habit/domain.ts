import {
  isWindDownVoiceCleanFinalizedTurn,
} from "@/features/winddown/voice/product";
import {
  isWindDownVoiceReport,
  type WindDownVoiceReport,
} from "@/features/winddown/voice/report";
import {
  normalizeWindDownVoiceJourneyTargets,
  windDownVoiceJourneyTargetEvidence,
  type WindDownVoiceJourneyTarget,
} from "@/features/winddown/voice/journeyTarget";

/**
 * The habit ledger is deliberately separate from SRS, XP, and UI state. A
 * completion is an immutable fact backed by a persisted receipt, never a
 * button press, a Match-only result, or an optimistic browser update.
 */
export const WIND_DOWN_HABIT_SCHEMA_VERSION = 1 as const;
export const WIND_DOWN_HABIT_CONSTELLATION_NIGHTS = 7 as const;
export const WIND_DOWN_HABIT_MAX_QUEST_HISTORY = 28 as const;
export const WIND_DOWN_HABIT_MAX_PROJECTION_EVENTS = 1_000 as const;
export const WIND_DOWN_HABIT_DAY_CUTOFF_HOUR_KST = 5 as const;
export const WIND_DOWN_HABIT_DAY_CUTOFF_MINUTE_KST = 30 as const;

export type WindDownHabitActivity =
  | "learn"
  | "review"
  | "roleplay"
  | "live-talk";

export type WindDownHabitLearnCreditReceipt = {
  schemaVersion: 1;
  activity: "learn";
  receiptId: string;
  sessionId: string;
  persistedAtIso: string;
  /** A completed Learn run has the five credited deterministic exercises. */
  creditedActionCount: number;
  completion: "five-exercises";
  persisted: true;
};

export type WindDownHabitReviewCreditReceipt = {
  schemaVersion: 1;
  reviewCycleId: string;
  requestDigest: string;
  materialId: string;
  reviewedAt: string;
  rating: "again" | "hard" | "good";
  reward: 0 | 1;
  inputMode?: "chips" | "typed";
};

export type WindDownHabitVoiceReportReceipt = {
  schemaVersion: 1;
  activity: "roleplay" | "live-talk";
  productSessionId: string;
  finalDigest: string;
  committedAtIso: string;
  report: WindDownVoiceReport;
  journeyTargets?: WindDownVoiceJourneyTarget[];
};

export type WindDownHabitCompletionInput =
  | { kind: "learn-credit-receipt"; receipt: WindDownHabitLearnCreditReceipt }
  | { kind: "review-credit-receipt"; receipt: WindDownHabitReviewCreditReceipt }
  | { kind: "voice-report-receipt"; receipt: WindDownHabitVoiceReportReceipt };

export type WindDownHabitCompletionSource =
  | {
      kind: "learn-credit-receipt";
      receiptId: string;
      sessionId: string;
      creditedActionCount: number;
    }
  | {
      kind: "review-credit-receipt";
      reviewCycleId: string;
      materialId: string;
    }
  | {
      kind: "voice-report-receipt";
      activity: "roleplay" | "live-talk";
      productSessionId: string;
      finalDigest: string;
      cleanFinalizedLearnerTurnCount: number;
      journeyMaterialIds: string[];
      matchedJourneyMaterialId: string | null;
    };

export type WindDownHabitCompletionEvent = {
  schemaVersion: typeof WIND_DOWN_HABIT_SCHEMA_VERSION;
  eventId: string;
  activity: WindDownHabitActivity;
  occurredAtIso: string;
  kstDay: string;
  source: WindDownHabitCompletionSource;
};

export type WindDownHabitConstellationCell = {
  kstDay: string;
  completed: boolean;
  activities: WindDownHabitActivity[];
  completionEventIds: string[];
};

export type WindDownHabitProjection = {
  schemaVersion: typeof WIND_DOWN_HABIT_SCHEMA_VERSION;
  currentKstDay: string;
  streak: {
    /** The run can be carried from yesterday until tonight's KST completion. */
    anchoredKstDay: string | null;
    nights: number;
  };
  constellation: WindDownHabitConstellationCell[];
  /** Actual receipt-backed events only, newest first, capped for mobile. */
  questHistory: WindDownHabitCompletionEvent[];
};

export type WindDownHabitAppendResult = {
  duplicate: boolean;
  events: WindDownHabitCompletionEvent[];
};

export type WindDownHabitErrorCode =
  | "INVALID_HABIT_COMPLETION_INPUT"
  | "UNQUALIFIED_HABIT_COMPLETION"
  | "INVALID_HABIT_EVENT"
  | "HABIT_EVENT_CONFLICT"
  | "INVALID_HABIT_PROJECTION";

export class WindDownHabitError extends Error {
  constructor(readonly code: WindDownHabitErrorCode) {
    super(code);
    this.name = "WindDownHabitError";
  }
}

const SAFE_ID = /^[A-Za-z0-9._:-]{1,160}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const KST_DAY = /^\d{4}-\d{2}-\d{2}$/;
const LEARN_RECEIPT_KEYS = new Set([
  "schemaVersion",
  "activity",
  "receiptId",
  "sessionId",
  "persistedAtIso",
  "creditedActionCount",
  "completion",
  "persisted",
]);
const REVIEW_RECEIPT_KEYS = new Set([
  "schemaVersion",
  "reviewCycleId",
  "requestDigest",
  "materialId",
  "reviewedAt",
  "rating",
  "reward",
  "inputMode",
]);
const LEGACY_REVIEW_RECEIPT_KEYS = new Set(
  [...REVIEW_RECEIPT_KEYS].filter((key) => key !== "inputMode"),
);

function invalid(code: WindDownHabitErrorCode): never {
  throw new WindDownHabitError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: ReadonlySet<string>) {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function safeId(value: unknown, maxLength = 160) {
  return typeof value === "string"
    && value.length <= maxLength
    && SAFE_ID.test(value)
    ? value
    : null;
}

function canonicalIso(value: unknown) {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

/**
 * A Wind Down night closes at 05:30 KST, so a completion after midnight but
 * before the cutoff still belongs to the previous bedtime.
 */
export function getWindDownHabitKstDay(value: Date) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return invalid("INVALID_HABIT_PROJECTION");
  }
  const kstMinusCutoffMinutes =
    (9 * 60)
    - (WIND_DOWN_HABIT_DAY_CUTOFF_HOUR_KST * 60)
    - WIND_DOWN_HABIT_DAY_CUTOFF_MINUTE_KST;
  return new Date(
    value.getTime() + kstMinusCutoffMinutes * 60_000,
  ).toISOString().slice(0, 10);
}

function asKstDay(value: unknown) {
  if (typeof value !== "string" || !KST_DAY.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
    ? value
    : null;
}

function cloneSource(source: WindDownHabitCompletionSource): WindDownHabitCompletionSource {
  return source.kind === "learn-credit-receipt"
    ? {
        kind: source.kind,
        receiptId: source.receiptId,
        sessionId: source.sessionId,
        creditedActionCount: source.creditedActionCount,
      }
    : source.kind === "review-credit-receipt"
      ? {
          kind: source.kind,
          reviewCycleId: source.reviewCycleId,
          materialId: source.materialId,
        }
      : {
          kind: source.kind,
          activity: source.activity,
          productSessionId: source.productSessionId,
          finalDigest: source.finalDigest,
          cleanFinalizedLearnerTurnCount: source.cleanFinalizedLearnerTurnCount,
          journeyMaterialIds: [...source.journeyMaterialIds],
          matchedJourneyMaterialId: source.matchedJourneyMaterialId,
        };
}

function freezeEvent(event: WindDownHabitCompletionEvent): WindDownHabitCompletionEvent {
  return Object.freeze({
    ...event,
    source: Object.freeze(cloneSource(event.source)),
  });
}

function activityForSource(source: WindDownHabitCompletionSource): WindDownHabitActivity {
  return source.kind === "learn-credit-receipt"
    ? "learn"
    : source.kind === "review-credit-receipt"
      ? "review"
      : source.activity;
}

function eventIdFor(source: WindDownHabitCompletionSource) {
  if (source.kind === "learn-credit-receipt") {
    return `winddown-habit:learn:${source.receiptId}`;
  }
  if (source.kind === "review-credit-receipt") {
    return `winddown-habit:review:${source.reviewCycleId}`;
  }
  return `winddown-habit:${activityForSource(source)}:${source.productSessionId}`;
}

function validateLearnReceipt(value: unknown): {
  receiptId: string;
  sessionId: string;
  persistedAtIso: string;
  creditedActionCount: number;
} | null {
  if (!isRecord(value) || !hasExactKeys(value, LEARN_RECEIPT_KEYS)) {
    return null;
  }
  const receiptId = safeId(value.receiptId);
  const sessionId = safeId(value.sessionId);
  const persistedAtIso = canonicalIso(value.persistedAtIso);
  const creditedActionCount = typeof value.creditedActionCount === "number"
    ? value.creditedActionCount
    : null;
  if (
    value.schemaVersion !== 1
    || value.activity !== "learn"
    || !receiptId
    || !sessionId
    || !persistedAtIso
    || creditedActionCount === null
    || !Number.isInteger(creditedActionCount)
    || creditedActionCount < 5
    || creditedActionCount > 20
    || value.completion !== "five-exercises"
    || value.persisted !== true
  ) return null;
  return { receiptId, sessionId, persistedAtIso, creditedActionCount };
}

function validateReviewReceipt(value: unknown): {
  reviewCycleId: string;
  materialId: string;
  reviewedAtIso: string;
} | null {
  if (
    !isRecord(value)
    || (
      !hasExactKeys(value, REVIEW_RECEIPT_KEYS)
      && !hasExactKeys(value, LEGACY_REVIEW_RECEIPT_KEYS)
    )
  ) return null;
  const reviewCycleId = safeId(value.reviewCycleId);
  const materialId = safeId(value.materialId, 120);
  const reviewedAtIso = canonicalIso(value.reviewedAt);
  if (
    value.schemaVersion !== 1
    || !reviewCycleId
    || !materialId
    || typeof value.requestDigest !== "string"
    || !SHA256_HEX.test(value.requestDigest)
    || !reviewedAtIso
    || (value.rating !== "again" && value.rating !== "hard" && value.rating !== "good")
    || (value.reward !== 0 && value.reward !== 1)
    || (
      value.inputMode !== undefined
      && value.inputMode !== "chips"
      && value.inputMode !== "typed"
    )
    || (value.inputMode === "chips" && value.rating === "good")
  ) return null;
  return { reviewCycleId, materialId, reviewedAtIso };
}

function validateVoiceReceipt(value: unknown): {
  activity: "roleplay" | "live-talk";
  productSessionId: string;
  finalDigest: string;
  committedAtIso: string;
  cleanFinalizedLearnerTurnCount: number;
  journeyMaterialIds: string[];
  matchedJourneyMaterialId: string | null;
} | null {
  if (!isRecord(value)) return null;
  const expectedKeys = new Set([
    "schemaVersion",
    "activity",
    "productSessionId",
    "finalDigest",
    "committedAtIso",
    "report",
    "journeyTargets",
  ]);
  const keys = Object.keys(value);
  if (
    (keys.length !== expectedKeys.size && keys.length !== expectedKeys.size - 1)
    || !keys.every((key) => expectedKeys.has(key))
  ) return null;
  const activity = value.activity === "roleplay" || value.activity === "live-talk"
    ? value.activity
    : null;
  const productSessionId = safeId(value.productSessionId);
  const finalDigest = typeof value.finalDigest === "string" && SHA256_HEX.test(value.finalDigest)
    ? value.finalDigest
    : null;
  const committedAtIso = canonicalIso(value.committedAtIso);
  const journeyTargets = normalizeWindDownVoiceJourneyTargets(
    value.journeyTargets ?? [],
  );
  if (
    value.schemaVersion !== 1
    || !activity
    || !productSessionId
    || !finalDigest
    || !committedAtIso
    || !journeyTargets
    || (activity === "live-talk" && journeyTargets.length > 0)
    || !isWindDownVoiceReport(value.report)
    || value.report.activity !== activity
    || value.report.productSessionId !== productSessionId
  ) return null;
  const cleanFinalizedLearnerTurnCount = value.report.turns.filter(
    isWindDownVoiceCleanFinalizedTurn,
  ).length;
  if (cleanFinalizedLearnerTurnCount < 1) return null;
  const targetEvidence = windDownVoiceJourneyTargetEvidence({
    targets: journeyTargets,
    turns: value.report.turns,
  });
  if (activity === "roleplay" && !targetEvidence) return null;
  return {
    activity,
    productSessionId,
    finalDigest,
    committedAtIso,
    cleanFinalizedLearnerTurnCount,
    journeyMaterialIds: journeyTargets.map((target) => target.materialId),
    matchedJourneyMaterialId: targetEvidence?.materialId ?? null,
  };
}

/**
 * Converts only a server-persisted credit or committed voice receipt into the
 * append-only habit fact. This is intentionally the sole public constructor.
 */
export function createWindDownHabitCompletionEvent(
  input: unknown,
): WindDownHabitCompletionEvent {
  if (!isRecord(input) || Object.keys(input).length !== 2 || !Object.prototype.hasOwnProperty.call(input, "kind") || !Object.prototype.hasOwnProperty.call(input, "receipt")) {
    return invalid("INVALID_HABIT_COMPLETION_INPUT");
  }

  if (input.kind === "learn-credit-receipt") {
    const receipt = validateLearnReceipt(input.receipt);
    if (!receipt) return invalid("UNQUALIFIED_HABIT_COMPLETION");
    const source: WindDownHabitCompletionSource = {
      kind: "learn-credit-receipt",
      receiptId: receipt.receiptId,
      sessionId: receipt.sessionId,
      creditedActionCount: receipt.creditedActionCount,
    };
    return freezeEvent({
      schemaVersion: WIND_DOWN_HABIT_SCHEMA_VERSION,
      eventId: eventIdFor(source),
      activity: "learn",
      occurredAtIso: receipt.persistedAtIso,
      kstDay: getWindDownHabitKstDay(new Date(receipt.persistedAtIso)),
      source,
    });
  }

  if (input.kind === "review-credit-receipt") {
    const receipt = validateReviewReceipt(input.receipt);
    if (!receipt) return invalid("UNQUALIFIED_HABIT_COMPLETION");
    const source: WindDownHabitCompletionSource = {
      kind: "review-credit-receipt",
      reviewCycleId: receipt.reviewCycleId,
      materialId: receipt.materialId,
    };
    return freezeEvent({
      schemaVersion: WIND_DOWN_HABIT_SCHEMA_VERSION,
      eventId: eventIdFor(source),
      activity: "review",
      occurredAtIso: receipt.reviewedAtIso,
      kstDay: getWindDownHabitKstDay(new Date(receipt.reviewedAtIso)),
      source,
    });
  }

  if (input.kind === "voice-report-receipt") {
    const receipt = validateVoiceReceipt(input.receipt);
    if (!receipt) return invalid("UNQUALIFIED_HABIT_COMPLETION");
    const source: WindDownHabitCompletionSource = {
      kind: "voice-report-receipt",
      activity: receipt.activity,
      productSessionId: receipt.productSessionId,
      finalDigest: receipt.finalDigest,
      cleanFinalizedLearnerTurnCount: receipt.cleanFinalizedLearnerTurnCount,
      journeyMaterialIds: receipt.journeyMaterialIds,
      matchedJourneyMaterialId: receipt.matchedJourneyMaterialId,
    };
    return freezeEvent({
      schemaVersion: WIND_DOWN_HABIT_SCHEMA_VERSION,
      eventId: eventIdFor(source),
      activity: receipt.activity,
      occurredAtIso: receipt.committedAtIso,
      kstDay: getWindDownHabitKstDay(new Date(receipt.committedAtIso)),
      source,
    });
  }

  return invalid("INVALID_HABIT_COMPLETION_INPUT");
}

function normalizeSource(value: unknown): WindDownHabitCompletionSource | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  if (value.kind === "learn-credit-receipt") {
    const expected = new Set(["kind", "receiptId", "sessionId", "creditedActionCount"]);
    const receiptId = safeId(value.receiptId);
    const sessionId = safeId(value.sessionId);
    if (
      !hasExactKeys(value, expected)
      || !receiptId
      || !sessionId
      || !Number.isInteger(value.creditedActionCount)
      || (value.creditedActionCount as number) < 5
      || (value.creditedActionCount as number) > 20
    ) return null;
    return {
      kind: value.kind,
      receiptId,
      sessionId,
      creditedActionCount: value.creditedActionCount as number,
    };
  }
  if (value.kind === "review-credit-receipt") {
    const expected = new Set(["kind", "reviewCycleId", "materialId"]);
    const reviewCycleId = safeId(value.reviewCycleId);
    const materialId = safeId(value.materialId, 120);
    return hasExactKeys(value, expected) && reviewCycleId && materialId
      ? { kind: value.kind, reviewCycleId, materialId }
      : null;
  }
  if (value.kind === "voice-report-receipt") {
    const expected = new Set([
      "kind",
      "activity",
      "productSessionId",
      "finalDigest",
      "cleanFinalizedLearnerTurnCount",
      "journeyMaterialIds",
      "matchedJourneyMaterialId",
    ]);
    const productSessionId = safeId(value.productSessionId);
    const finalDigest = typeof value.finalDigest === "string" && SHA256_HEX.test(value.finalDigest)
      ? value.finalDigest
      : null;
    const journeyMaterialIds = Array.isArray(value.journeyMaterialIds)
      && value.journeyMaterialIds.length <= 2
      && value.journeyMaterialIds.every(
        (id) => typeof id === "string" && Boolean(safeId(id, 120)),
      )
      ? value.journeyMaterialIds as string[]
      : null;
    return hasExactKeys(value, expected)
      && productSessionId
      && (value.activity === "roleplay" || value.activity === "live-talk")
      && finalDigest
      && journeyMaterialIds
      && (
        value.matchedJourneyMaterialId === null
        || (
          typeof value.matchedJourneyMaterialId === "string"
          && journeyMaterialIds.includes(value.matchedJourneyMaterialId)
        )
      )
      && (
        value.activity !== "roleplay"
        || (
          journeyMaterialIds.length > 0
          && typeof value.matchedJourneyMaterialId === "string"
        )
      )
      && Number.isInteger(value.cleanFinalizedLearnerTurnCount)
      && (value.cleanFinalizedLearnerTurnCount as number) >= 1
      && (value.cleanFinalizedLearnerTurnCount as number) <= 24
      ? {
          kind: value.kind,
          activity: value.activity,
          productSessionId,
          finalDigest,
          cleanFinalizedLearnerTurnCount: value.cleanFinalizedLearnerTurnCount as number,
          journeyMaterialIds,
          matchedJourneyMaterialId: value.matchedJourneyMaterialId as string | null,
        }
      : null;
  }
  return null;
}

/** Validates a reloaded immutable event before it may affect a streak. */
export function normalizeWindDownHabitCompletionEvent(
  value: unknown,
): WindDownHabitCompletionEvent {
  if (!isRecord(value)) return invalid("INVALID_HABIT_EVENT");
  const expected = new Set([
    "schemaVersion",
    "eventId",
    "activity",
    "occurredAtIso",
    "kstDay",
    "source",
  ]);
  const source = normalizeSource(value.source);
  const occurredAtIso = canonicalIso(value.occurredAtIso);
  const kstDay = asKstDay(value.kstDay);
  if (
    !hasExactKeys(value, expected)
    || value.schemaVersion !== WIND_DOWN_HABIT_SCHEMA_VERSION
    || !source
    || !occurredAtIso
    || !kstDay
    || (value.activity !== "learn" && value.activity !== "review" && value.activity !== "roleplay" && value.activity !== "live-talk")
    || value.eventId !== eventIdFor(source)
    || kstDay !== getWindDownHabitKstDay(new Date(occurredAtIso))
  ) return invalid("INVALID_HABIT_EVENT");
  const expectedActivity = source.kind === "voice-report-receipt"
    ? activityForSource(source)
    : source.kind === "learn-credit-receipt"
      ? "learn"
      : "review";
  if (value.activity !== expectedActivity) return invalid("INVALID_HABIT_EVENT");
  return freezeEvent({
    schemaVersion: WIND_DOWN_HABIT_SCHEMA_VERSION,
    eventId: value.eventId,
    activity: value.activity,
    occurredAtIso,
    kstDay,
    source,
  });
}

function compareEvents(left: WindDownHabitCompletionEvent, right: WindDownHabitCompletionEvent) {
  return left.occurredAtIso.localeCompare(right.occurredAtIso)
    || left.eventId.localeCompare(right.eventId);
}

function stableEventJson(event: WindDownHabitCompletionEvent) {
  return JSON.stringify(event);
}

function uniqueEvents(values: readonly unknown[]): WindDownHabitCompletionEvent[] {
  if (values.length > WIND_DOWN_HABIT_MAX_PROJECTION_EVENTS) {
    return invalid("INVALID_HABIT_PROJECTION");
  }
  const byId = new Map<string, WindDownHabitCompletionEvent>();
  for (const value of values) {
    const event = normalizeWindDownHabitCompletionEvent(value);
    const existing = byId.get(event.eventId);
    if (existing && stableEventJson(existing) !== stableEventJson(event)) {
      return invalid("HABIT_EVENT_CONFLICT");
    }
    byId.set(event.eventId, event);
  }
  return [...byId.values()].sort(compareEvents);
}

/**
 * Append preserves existing immutable history. A retry with the same event is
 * a no-op; a different value under the same receipt identity is a conflict.
 */
export function appendWindDownHabitCompletionEvent(
  existing: readonly unknown[],
  candidate: unknown,
): WindDownHabitAppendResult {
  if (!Array.isArray(existing)) return invalid("INVALID_HABIT_PROJECTION");
  const event = normalizeWindDownHabitCompletionEvent(candidate);
  const events = uniqueEvents(existing);
  const sameId = events.find((item) => item.eventId === event.eventId);
  if (sameId) {
    if (stableEventJson(sameId) !== stableEventJson(event)) {
      return invalid("HABIT_EVENT_CONFLICT");
    }
    return { duplicate: true, events };
  }
  return { duplicate: false, events: [...events, event].sort(compareEvents) };
}

function addDays(kstDay: string, days: number) {
  const date = new Date(`${kstDay}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function anchoredStreak(eventsByDay: ReadonlyMap<string, WindDownHabitCompletionEvent[]>, currentKstDay: string) {
  const yesterday = addDays(currentKstDay, -1);
  const anchor = eventsByDay.has(currentKstDay)
    ? currentKstDay
    : eventsByDay.has(yesterday)
      ? yesterday
      : null;
  if (!anchor) return { anchoredKstDay: null, nights: 0 };
  let day = anchor;
  let nights = 0;
  while (eventsByDay.has(day)) {
    nights += 1;
    day = addDays(day, -1);
  }
  return { anchoredKstDay: anchor, nights };
}

/**
 * Reprojects a mobile-safe habit view from receipt-backed immutable facts. It
 * never writes state and produces the same result regardless of input order.
 */
export function projectWindDownHabit(input: {
  events: readonly unknown[];
  now?: Date;
}): WindDownHabitProjection {
  const inputRecord = input as unknown as Record<string, unknown>;
  if (
    !input
    || typeof input !== "object"
    || !Object.keys(inputRecord).every((key) => key === "events" || key === "now")
    || !Array.isArray(input.events)
  ) {
    return invalid("INVALID_HABIT_PROJECTION");
  }
  const now = input.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    return invalid("INVALID_HABIT_PROJECTION");
  }
  const events = uniqueEvents(input.events);
  const currentKstDay = getWindDownHabitKstDay(now);
  const eventsByDay = new Map<string, WindDownHabitCompletionEvent[]>();
  for (const event of events) {
    const bucket = eventsByDay.get(event.kstDay) ?? [];
    bucket.push(event);
    eventsByDay.set(event.kstDay, bucket);
  }
  const firstNight = addDays(currentKstDay, -(WIND_DOWN_HABIT_CONSTELLATION_NIGHTS - 1));
  const constellation = Array.from(
    { length: WIND_DOWN_HABIT_CONSTELLATION_NIGHTS },
    (_, index) => {
      const kstDay = addDays(firstNight, index);
      const completed = eventsByDay.get(kstDay) ?? [];
      return {
        kstDay,
        completed: completed.length > 0,
        activities: [...new Set(completed.map((event) => event.activity))],
        completionEventIds: completed.map((event) => event.eventId),
      };
    },
  );
  return {
    schemaVersion: WIND_DOWN_HABIT_SCHEMA_VERSION,
    currentKstDay,
    streak: anchoredStreak(eventsByDay, currentKstDay),
    constellation,
    questHistory: [...events]
      .sort((left, right) => compareEvents(right, left))
      .slice(0, WIND_DOWN_HABIT_MAX_QUEST_HISTORY),
  };
}
