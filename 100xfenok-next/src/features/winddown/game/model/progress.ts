/**
 * Companion progression for the WIND DOWN world tour.
 *
 * Pure functions only: no DOM, no storage, no clock. The nightly XP figure is an
 * ASSUMPTION used for forecasting text, never for granting progress, so a wrong
 * estimate can mislead a label but can never inflate a learner's real state.
 */

import type { WindDownChapter } from "./tour";
import { WIND_DOWN_CONTENT_PACK } from "./contract";
import type {
  WindDownHabitCompletionEvent,
} from "@/features/winddown/habit/domain";

const MAX_LEVEL = 400;

function safeXp(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** XP required to leave level n. Grows so one full arc lands near ninety nights. */
export function levelCost(level: number): number {
  if (!Number.isFinite(level) || level < 1) return Number.POSITIVE_INFINITY;
  return 12 + Math.floor(level * 0.55);
}

/** Cumulative XP required to reach the start of `level`. */
export function xpToReach(level: number): number {
  if (!Number.isFinite(level) || level < 1) return 0;
  const capped = Math.min(level, MAX_LEVEL);
  let total = 0;
  for (let i = 1; i < capped; i += 1) total += levelCost(i);
  return total;
}

export function levelFromXp(rawXp: number): number {
  const xp = safeXp(rawXp);
  if (!Number.isFinite(xp) || xp <= 0) return 1;
  let level = 1;
  let spent = 0;
  while (level < MAX_LEVEL && spent + levelCost(level) <= xp) {
    spent += levelCost(level);
    level += 1;
  }
  return level;
}

export function xpIntoLevel(rawXp: number): number {
  const xp = safeXp(rawXp);
  const level = levelFromXp(xp);
  return Math.max(
    0,
    Math.min(levelCost(level), xp - xpToReach(level)),
  );
}

export function xpNeededForLevel(rawXp: number): number {
  return levelCost(levelFromXp(safeXp(rawXp)));
}

/** Awarded per credited study answer and per collected star. */
export const XP_PER_CREDITED_ANSWER = 3;
export const XP_PER_COLLECTED_STAR = 2;

/** Forecast assumption only. Never used to grant XP. */
export const ASSUMED_XP_PER_NIGHT =
  XP_PER_CREDITED_ANSWER * 5 + XP_PER_COLLECTED_STAR * 2;

export type WindDownGameProgress = {
  schemaVersion: 1;
  xp: number;
  creditedAnswerCount: number;
  collectedReviewStarCount: number;
  creditedNightCount: number;
};

/**
 * Projects game XP only from immutable habit receipts. One completed Learn run
 * contributes at most five answers per KST night. The first two completed
 * Reviews become effort stars; their rating is deliberately irrelevant.
 */
export function projectWindDownGameProgress(
  events: readonly WindDownHabitCompletionEvent[],
): WindDownGameProgress {
  const seenEventIds = new Set<string>();
  const byKstDay = new Map<
    string,
    { creditedAnswers: number; reviewStars: number }
  >();

  for (const event of events) {
    if (seenEventIds.has(event.eventId)) continue;
    seenEventIds.add(event.eventId);
    const day = byKstDay.get(event.kstDay) ?? {
      creditedAnswers: 0,
      reviewStars: 0,
    };
    if (event.source.kind === "learn-credit-receipt") {
      day.creditedAnswers = Math.max(
        day.creditedAnswers,
        Math.min(5, Math.max(0, event.source.creditedActionCount)),
      );
    } else if (event.source.kind === "review-credit-receipt") {
      day.reviewStars = Math.min(2, day.reviewStars + 1);
    }
    byKstDay.set(event.kstDay, day);
  }

  let creditedAnswerCount = 0;
  let collectedReviewStarCount = 0;
  let creditedNightCount = 0;
  for (const day of byKstDay.values()) {
    creditedAnswerCount += day.creditedAnswers;
    collectedReviewStarCount += day.reviewStars;
    if (day.creditedAnswers > 0 || day.reviewStars > 0) {
      creditedNightCount += 1;
    }
  }

  return {
    schemaVersion: 1,
    xp:
      creditedAnswerCount * XP_PER_CREDITED_ANSWER
      + collectedReviewStarCount * XP_PER_COLLECTED_STAR,
    creditedAnswerCount,
    collectedReviewStarCount,
    creditedNightCount,
  };
}

export function nightsToReach(level: number, rawXp: number): number {
  const remaining = xpToReach(level) - safeXp(rawXp);
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / ASSUMED_XP_PER_NIGHT);
}

export function isChapterUnlocked(chapter: WindDownChapter, xp: number): boolean {
  return levelFromXp(xp) >= chapter.unlockLevel;
}

export function unlockedChapters(xp: number): readonly WindDownChapter[] {
  return WIND_DOWN_CONTENT_PACK.chapters.filter(
    (chapter) => isChapterUnlocked(chapter, xp),
  );
}

export function currentChapter(xp: number): WindDownChapter {
  const open = unlockedChapters(xp);
  return open.length > 0
    ? open[open.length - 1]
    : WIND_DOWN_CONTENT_PACK.chapters[0];
}

export function nextChapter(xp: number): WindDownChapter | null {
  return WIND_DOWN_CONTENT_PACK.chapters.find(
    (chapter) => !isChapterUnlocked(chapter, xp),
  ) ?? null;
}

/**
 * How built-up the current chapter's city is, 0..1.
 * Fills with nights spent inside the chapter so the world visibly grows between
 * milestones rather than jumping only when a chapter unlocks.
 */
export function chapterGrowth(rawXp: number): number {
  const xp = safeXp(rawXp);
  const here = currentChapter(xp);
  const next = nextChapter(xp);
  if (!next) return 1;
  const from = xpToReach(here.unlockLevel);
  const to = xpToReach(next.unlockLevel);
  if (to <= from) return 1;
  const ratio = (xp - from) / (to - from);
  return Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
}
