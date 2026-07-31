import assert from "node:assert/strict";
import {
  WIND_DOWN_HABIT_CONSTELLATION_NIGHTS,
  WIND_DOWN_HABIT_MAX_QUEST_HISTORY,
  WindDownHabitError,
  appendWindDownHabitCompletionEvent,
  createWindDownHabitCompletionEvent,
  normalizeWindDownHabitCompletionEvent,
  projectWindDownHabit,
} from "../src/features/winddown/habit/domain";
import {
  createWindDownLiveTalkDescriptor,
  createWindDownRoleplayDescriptor,
} from "../src/features/winddown/voice/product";
import {
  windDownVoiceJourneyTargetEvidence,
} from "../src/features/winddown/voice/journeyTarget";
import { buildWindDownVoiceReport } from "../src/features/winddown/voice/report";

const digest = "a".repeat(64);
const now = new Date("2026-07-31T12:00:00.000Z");

function learnReceipt(id: string, persistedAtIso: string) {
  return {
    schemaVersion: 1 as const,
    activity: "learn" as const,
    receiptId: `learn-receipt-${id}`,
    sessionId: `learn-session-${id}`,
    persistedAtIso,
    creditedActionCount: 5,
    completion: "five-exercises" as const,
    persisted: true as const,
  };
}

function reviewReceipt(id: string, reviewedAt: string) {
  return {
    schemaVersion: 1 as const,
    reviewCycleId: `winddown-review:${id.padEnd(64, "b")}`,
    requestDigest: digest,
    materialId: `material-${id}`,
    reviewedAt,
    rating: "good" as const,
    reward: 1 as const,
  };
}

function voiceReceipt(activity: "roleplay" | "live-talk", id: string, clean = true) {
  const conversationId = `conversation-${activity}-${id}`;
  const report = buildWindDownVoiceReport({
    schemaVersion: 1,
    productSessionId: `voice-session-${activity}-${id}`,
    activity,
    descriptor: activity === "roleplay"
      ? createWindDownRoleplayDescriptor("cafe-order")
      : createWindDownLiveTalkDescriptor("open-evening"),
    conversationIds: [conversationId],
    sessionProofs: [`${"A".repeat(80)}.${"a".repeat(64)}`],
    startedAtIso: "2026-07-31T11:00:00.000Z",
    stoppedAtIso: "2026-07-31T11:02:00.000Z",
    completionReason: "learner-stop",
    turns: [{
      conversationId,
      turnSeq: 1,
      userText: clean ? "I would like a decaf coffee, thank you." : "I would like a decaf coffee.",
      modelText: "Of course.",
      finalized: true,
      sttDrift: false,
      interrupted: !clean,
    }],
    metrics: { turnCount: 1, interruptionCount: clean ? 0 : 1 },
  });
  return {
    schemaVersion: 1 as const,
    activity,
    productSessionId: report.productSessionId,
    finalDigest: digest,
    committedAtIso: "2026-07-31T11:02:00.000Z",
    report,
    journeyTargets: activity === "roleplay"
      ? [{
          materialId: "material-tonight",
          en: "I would like a decaf coffee",
          acceptedVariants: [],
        }]
      : [],
  };
}

function expectError(callback: () => unknown, code: WindDownHabitError["code"]) {
  assert.throws(
    callback,
    (error) => error instanceof WindDownHabitError && error.code === code,
  );
}

const beforeCutoff = createWindDownHabitCompletionEvent({
  kind: "learn-credit-receipt",
  receipt: learnReceipt("before-cutoff", "2026-07-30T20:29:59.999Z"),
});
const atCutoff = createWindDownHabitCompletionEvent({
  kind: "learn-credit-receipt",
  receipt: learnReceipt("at-cutoff", "2026-07-30T20:30:00.000Z"),
});
assert.equal(beforeCutoff.kstDay, "2026-07-30");
assert.equal(atCutoff.kstDay, "2026-07-31");
assert(Object.isFrozen(atCutoff));
assert(Object.isFrozen(atCutoff.source));

const review = createWindDownHabitCompletionEvent({
  kind: "review-credit-receipt",
  receipt: reviewReceipt("review-1", "2026-07-29T15:00:00.000Z"),
});
assert.equal(review.activity, "review");

const roleplay = createWindDownHabitCompletionEvent({
  kind: "voice-report-receipt",
  receipt: voiceReceipt("roleplay", "one"),
});
const liveTalk = createWindDownHabitCompletionEvent({
  kind: "voice-report-receipt",
  receipt: voiceReceipt("live-talk", "one"),
});
assert.equal(roleplay.activity, "roleplay");
assert.equal(liveTalk.activity, "live-talk");

expectError(
  () => createWindDownHabitCompletionEvent({ kind: "match", receipt: {} }),
  "INVALID_HABIT_COMPLETION_INPUT",
);
expectError(
  () => createWindDownHabitCompletionEvent({
    kind: "learn-credit-receipt",
    receipt: { ...learnReceipt("match-only", "2026-07-31T00:00:00.000Z"), activity: "match" },
  }),
  "UNQUALIFIED_HABIT_COMPLETION",
);
expectError(
  () => createWindDownHabitCompletionEvent({
    kind: "learn-credit-receipt",
    receipt: { ...learnReceipt("garbage", "2026-07-31T00:00:00.000Z"), verdict: "garbage" },
  }),
  "UNQUALIFIED_HABIT_COMPLETION",
);
expectError(
  () => createWindDownHabitCompletionEvent({
    kind: "learn-credit-receipt",
    receipt: { ...learnReceipt("unpersisted", "2026-07-31T00:00:00.000Z"), persisted: false },
  }),
  "UNQUALIFIED_HABIT_COMPLETION",
);
expectError(
  () => createWindDownHabitCompletionEvent({
    kind: "learn-credit-receipt",
    receipt: { ...learnReceipt("short", "2026-07-31T00:00:00.000Z"), creditedActionCount: 4 },
  }),
  "UNQUALIFIED_HABIT_COMPLETION",
);
expectError(
  () => createWindDownHabitCompletionEvent({
    kind: "review-credit-receipt",
    receipt: { ...reviewReceipt("invalid", "2026-07-31T00:00:00.000Z"), reward: -1 },
  }),
  "UNQUALIFIED_HABIT_COMPLETION",
);
const againReview = createWindDownHabitCompletionEvent({
  kind: "review-credit-receipt",
  receipt: {
    ...reviewReceipt("again", "2026-07-31T00:00:00.000Z"),
    rating: "again" as const,
    reward: 0 as const,
  },
});
assert.equal(againReview.activity, "review", "honest Again work counts as a reviewed item");
const chipsReview = createWindDownHabitCompletionEvent({
  kind: "review-credit-receipt",
  receipt: {
    ...reviewReceipt("chips", "2026-07-31T00:01:00.000Z"),
    rating: "hard",
    inputMode: "chips",
  },
});
assert.equal(
  chipsReview.activity,
  "review",
  "current Review receipts with inputMode remain qualified habit evidence",
);
expectError(
  () => createWindDownHabitCompletionEvent({
    kind: "review-credit-receipt",
    receipt: {
      ...reviewReceipt("chips-good", "2026-07-31T00:02:00.000Z"),
      inputMode: "chips",
    },
  }),
  "UNQUALIFIED_HABIT_COMPLETION",
);
expectError(
  () => createWindDownHabitCompletionEvent({
    kind: "voice-report-receipt",
    receipt: voiceReceipt("roleplay", "interrupted", false),
  }),
  "UNQUALIFIED_HABIT_COMPLETION",
);
expectError(
  () => createWindDownHabitCompletionEvent({
    kind: "voice-report-receipt",
    receipt: {
      ...voiceReceipt("roleplay", "missed-tonight-target"),
      journeyTargets: [{
        materialId: "material-tonight",
        en: "This phrase never appears",
        acceptedVariants: [],
      }],
    },
  }),
  "UNQUALIFIED_HABIT_COMPLETION",
);
assert.equal(
  windDownVoiceJourneyTargetEvidence({
    targets: [{
      materialId: "material-boundary",
      en: "I am ready",
      acceptedVariants: [],
    }],
    turns: [{
      userText: "I am readying the room.",
      finalized: true,
      sttDrift: false,
      interrupted: false,
    }],
  }),
  null,
  "a longer word must not satisfy a tonight phrase by substring",
);
assert.equal(
  windDownVoiceJourneyTargetEvidence({
    targets: [{
      materialId: "material-secret",
      en: "I am ready",
      acceptedVariants: [],
    }],
    turns: [{
      userText: `I am ready access_token=${"a".repeat(24)}`,
      finalized: true,
      sttDrift: false,
      interrupted: false,
    }],
  }),
  null,
  "unsafe transcript text must never qualify a tonight phrase",
);
const unfinalizedVoice = voiceReceipt("live-talk", "unfinalized");
unfinalizedVoice.report = {
  ...unfinalizedVoice.report,
  turns: unfinalizedVoice.report.turns.map((turn) => ({ ...turn, finalized: false })),
};
expectError(
  () => createWindDownHabitCompletionEvent({
    kind: "voice-report-receipt",
    receipt: unfinalizedVoice,
  }),
  "UNQUALIFIED_HABIT_COMPLETION",
);

const firstAppend = appendWindDownHabitCompletionEvent([], atCutoff);
assert.equal(firstAppend.duplicate, false);
const duplicateAppend = appendWindDownHabitCompletionEvent(firstAppend.events, atCutoff);
assert.equal(duplicateAppend.duplicate, true);
assert.equal(duplicateAppend.events.length, 1, "a retried immutable event never increments the habit");

const july29 = createWindDownHabitCompletionEvent({
  kind: "learn-credit-receipt",
  receipt: learnReceipt("july29", "2026-07-28T20:30:00.000Z"),
});
const july31 = createWindDownHabitCompletionEvent({
  kind: "learn-credit-receipt",
  receipt: learnReceipt("july31", "2026-07-30T20:30:00.000Z"),
});
const gapped = projectWindDownHabit({ events: [july29, july31], now });
assert.equal(gapped.streak.nights, 1, "a missing KST night breaks the contiguous streak");
assert.equal(gapped.streak.anchoredKstDay, "2026-07-31");
assert.equal(gapped.constellation.length, WIND_DOWN_HABIT_CONSTELLATION_NIGHTS);
assert.deepEqual(
  gapped.constellation.map((cell) => cell.kstDay),
  ["2026-07-25", "2026-07-26", "2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31"],
);

const contiguous = projectWindDownHabit({
  events: [
    createWindDownHabitCompletionEvent({
      kind: "learn-credit-receipt",
      receipt: learnReceipt("july30", "2026-07-29T20:30:00.000Z"),
    }),
    july29,
    july31,
  ],
  now,
});
assert.equal(contiguous.streak.nights, 3);
assert.deepEqual(
  contiguous.constellation.find((cell) => cell.kstDay === "2026-07-31"),
  {
    kstDay: "2026-07-31",
    completed: true,
    activities: ["learn"],
    completionEventIds: [july31.eventId],
  },
);

const manyEvents = Array.from({ length: WIND_DOWN_HABIT_MAX_QUEST_HISTORY + 9 }, (_, index) =>
  createWindDownHabitCompletionEvent({
    kind: "learn-credit-receipt",
    receipt: learnReceipt(
      `history-${index}`,
      new Date(Date.UTC(2026, 5, 1 + index, 15, 0, 0)).toISOString(),
    ),
  })
);
const historyProjection = projectWindDownHabit({ events: manyEvents, now });
assert.equal(historyProjection.questHistory.length, WIND_DOWN_HABIT_MAX_QUEST_HISTORY);
assert.deepEqual(
  projectWindDownHabit({ events: [...manyEvents].reverse(), now }),
  historyProjection,
  "refresh/reprojection must be independent of ledger order",
);
assert.deepEqual(
  projectWindDownHabit({ events: [...manyEvents, manyEvents[0]], now }),
  historyProjection,
  "a duplicate persisted event must not change the projection",
);

const conflicting = {
  ...atCutoff,
  occurredAtIso: "2026-08-01T20:30:00.000Z",
  kstDay: "2026-08-02",
};
normalizeWindDownHabitCompletionEvent(conflicting);
expectError(
  () => appendWindDownHabitCompletionEvent([atCutoff], conflicting),
  "HABIT_EVENT_CONFLICT",
);

console.log("PASS winddown-habit - receipt-gated KST habit projection is idempotent and deterministic");
