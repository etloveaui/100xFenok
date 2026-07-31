import assert from "node:assert/strict";
import {
  projectWindDownGameProgress,
} from "../src/features/winddown/game/model/progress";
import {
  DEFAULT_LEARNER,
  WIND_DOWN_CONTENT_PACK,
  isContentPackValid,
  memberForChapter,
} from "../src/features/winddown/game/model/contract";
import type {
  WindDownHabitCompletionEvent,
} from "../src/features/winddown/habit/domain";

function learn(
  eventId: string,
  kstDay: string,
  creditedActionCount = 5,
): WindDownHabitCompletionEvent {
  return {
    schemaVersion: 1,
    eventId,
    activity: "learn",
    occurredAtIso: `${kstDay}T12:00:00.000Z`,
    kstDay,
    source: {
      kind: "learn-credit-receipt",
      receiptId: `${eventId}:receipt`,
      sessionId: `${eventId}:session`,
      creditedActionCount,
    },
  };
}

function review(
  eventId: string,
  kstDay: string,
): WindDownHabitCompletionEvent {
  return {
    schemaVersion: 1,
    eventId,
    activity: "review",
    occurredAtIso: `${kstDay}T12:01:00.000Z`,
    kstDay,
    source: {
      kind: "review-credit-receipt",
      reviewCycleId: `${eventId}:cycle`,
      materialId: `${eventId}:material`,
    },
  };
}

const firstNight = [
  learn("learn-1", "2026-07-30"),
  review("review-1", "2026-07-30"),
  review("review-2", "2026-07-30"),
  review("review-3", "2026-07-30"),
];
assert.deepEqual(projectWindDownGameProgress(firstNight), {
  schemaVersion: 1,
  xp: 19,
  creditedAnswerCount: 5,
  collectedReviewStarCount: 2,
  creditedNightCount: 1,
});

assert.deepEqual(
  projectWindDownGameProgress([...firstNight, firstNight[0]!]),
  projectWindDownGameProgress(firstNight),
  "duplicate immutable receipt events must never award game XP twice",
);

assert.equal(isContentPackValid(WIND_DOWN_CONTENT_PACK), true);
const openingMembers = WIND_DOWN_CONTENT_PACK.chapters
  .slice(0, 4)
  .map((chapter) =>
    memberForChapter(WIND_DOWN_CONTENT_PACK, DEFAULT_LEARNER, chapter.id).id
  );
assert.equal(
  new Set(openingMembers).size,
  4,
  "Mona's stable seed must rotate all four original members across scenes",
);
assert.deepEqual(
  openingMembers,
  WIND_DOWN_CONTENT_PACK.chapters
    .slice(0, 4)
    .map((chapter) =>
      memberForChapter(WIND_DOWN_CONTENT_PACK, DEFAULT_LEARNER, chapter.id).id
    ),
  "the same learner seed and chapter must select the same member",
);

const secondNight = [
  ...firstNight,
  learn("learn-2", "2026-07-31"),
  review("review-4", "2026-07-31"),
];
assert.deepEqual(projectWindDownGameProgress(secondNight), {
  schemaVersion: 1,
  xp: 36,
  creditedAnswerCount: 10,
  collectedReviewStarCount: 3,
  creditedNightCount: 2,
});

assert.deepEqual(
  projectWindDownGameProgress([
    learn("learn-overflow-a", "2026-08-01", 20),
    learn("learn-overflow-b", "2026-08-01", 20),
  ]),
  {
    schemaVersion: 1,
    xp: 15,
    creditedAnswerCount: 5,
    collectedReviewStarCount: 0,
    creditedNightCount: 1,
  },
  "one KST night must never exceed five credited Learn answers",
);

console.log(
  "PASS winddown-game-progress - receipt-backed XP is capped, idempotent, and deterministic",
);
