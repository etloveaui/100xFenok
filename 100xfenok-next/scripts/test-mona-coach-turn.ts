import assert from "node:assert/strict";
import { buildCoachSnapshot } from "../src/lib/server/mona-coach/coach-turn";
import type { StudySnapshot } from "../src/lib/server/mona-study-tools";

// Minimal StudySnapshot fixture: one due weak note, one due best3, one new bank item, curriculum focus.
const study = {
  studyDate: "2026-06-15",
  loadedAt: "2026-06-14T00:00:00Z",
  sessions: [],
  best3: [
    {
      ko: "비가 억수같이 쏟아져.",
      en: "It's raining heavily.",
      note: null,
      firstSeen: "2026-06-10",
      sessions: ["2026-06-10"],
      box: 2,
      due: "2026-06-10",
      lastResult: "correct",
    },
  ],
  weakNotes: [
    {
      ko: "그게 내가 할 수 있게 해줘.",
      tried: "It lacks me.",
      correct: "It lets me.",
      missCount: 2,
      lastSeen: "2026-06-13",
      note: null,
      firstSeen: "2026-06-12",
      sessions: ["2026-06-13"],
      box: 1,
      due: "2026-06-13",
      lastResult: "wrong",
    },
  ],
  learnerProfile: null,
  curriculum: { nextFocus: "lets" },
  expressionBank: [
    {
      ko: "대충 이런 느낌이야.",
      en: "That's the general idea.",
      note: null,
      theme: "free",
      register: "casual",
      sourceId: "ppalmo-1",
      difficulty: 1,
    },
  ],
} as unknown as StudySnapshot;

function testMapsAllSources() {
  const { snapshot } = buildCoachSnapshot(study);
  assert.equal(snapshot.items.length, 3, "weak + best3 + bank = 3 items");
  const ids = snapshot.items.map((i) => i.itemId);
  assert.ok(ids.includes("it lets me."));
  assert.ok(ids.includes("it's raining heavily."));
  assert.ok(ids.includes("that's the general idea."));
}

function testSrsDuePriorityQueues() {
  const { queues } = buildCoachSnapshot(study);
  // both weak and best3 are due (due date <= studyDate)
  assert.deepEqual(queues.dueWeak, ["it lets me."]);
  assert.deepEqual(queues.dueBest3, ["it's raining heavily."]);
  assert.deepEqual(queues.newBank, ["that's the general idea."]);
}

function testCurriculumFocusMatch() {
  const { queues } = buildCoachSnapshot(study);
  // nextFocus "lets" must surface the "It lets me." item
  assert.ok(queues.curriculumFocus.includes("it lets me."));
}

function testNotDueIsExcludedFromDueQueue() {
  const future = {
    ...study,
    best3: [{ ...(study.best3 as unknown[])[0] as Record<string, unknown>, due: "2026-06-30" }],
  } as unknown as StudySnapshot;
  const { queues } = buildCoachSnapshot(future);
  assert.equal(queues.dueBest3.length, 0, "future-due best3 is not in dueBest3");
}

function testExcludeFromNewSkipsTodayPassed() {
  // Same-day re-entry: an item already passed earlier today must not be re-dealt as new.
  const { queues } = buildCoachSnapshot(study, new Set(["that's the general idea."]));
  assert.equal(queues.newBank.length, 0, "today-passed bank item is excluded from newBank");
  // due review items are unaffected (review on re-entry is fine)
  assert.deepEqual(queues.dueWeak, ["it lets me."]);
}

function testDifficultyGateBlocksHardAndLong() {
  // G3: Mona is at the assembly stage — difficulty-3 and long (>8 words) items must not be dealt as new.
  const hardStudy = {
    ...study,
    expressionBank: [
      { ko: "쉬운거", en: "Easy one.", note: null, theme: "free", register: "casual", sourceId: "a", difficulty: 1 },
      { ko: "어려운거", en: "This is far too advanced for now.", note: null, theme: "free", register: "casual", sourceId: "b", difficulty: 3 },
      { ko: "긴거", en: "one two three four five six seven eight nine ten", note: null, theme: "free", register: "casual", sourceId: "c", difficulty: 1, wordCount: 10 },
    ],
  } as unknown as StudySnapshot;
  const { queues } = buildCoachSnapshot(hardStudy);
  assert.ok(queues.newBank.includes("easy one."), "easy item kept");
  assert.ok(!queues.newBank.includes("this is far too advanced for now."), "difficulty-3 item blocked");
  assert.ok(!queues.newBank.some((id) => id.startsWith("one two three")), "10-word item blocked");
}

function testReviewWarmupCapped() {
  // G2: review warmup is capped (most-overdue first), not a flood.
  const manyDue = {
    ...study,
    best3: ["a", "b", "c", "d"].map((x, i) => ({
      ko: x,
      en: `Best ${x}.`,
      note: null,
      firstSeen: "",
      sessions: [],
      box: 2,
      due: `2026-06-0${i + 1}`,
      lastResult: "correct",
    })),
  } as unknown as StudySnapshot;
  const { queues } = buildCoachSnapshot(manyDue);
  assert.equal(queues.dueBest3.length, 3, "review warmup capped at 3");
  assert.equal(queues.dueBest3[0], "best a.", "most overdue first");
}

function testAcceptedAlternativesLoaded() {
  // B-A: bank sibling seeds an accepted alternative; stored best3 alternatives are loaded (cats-and-dogs fix).
  const altStudy = {
    ...study,
    best3: [{
      ko: "비", en: "It's raining heavily.", note: null, firstSeen: "", sessions: [],
      box: 2, due: "2026-06-10", lastResult: "correct", acceptedAlternatives: ["It's pouring."],
    }],
    expressionBank: [{
      ko: "x", en: "It's raining cats and dogs.", note: null, theme: "free", register: "casual",
      sourceId: "a", difficulty: 1, sibling: { ko: "y", en: "It's raining heavily." },
    }],
  } as unknown as StudySnapshot;
  const { snapshot } = buildCoachSnapshot(altStudy);
  const best3Item = snapshot.items.find((item) => item.itemId === "it's raining heavily.");
  assert.ok(best3Item?.acceptedAlternatives.includes("It's pouring."), "stored best3 alternative loaded");
  const bankItem = snapshot.items.find((item) => item.itemId === "it's raining cats and dogs.");
  assert.ok(bankItem?.acceptedAlternatives.includes("It's raining heavily."), "bank sibling seeded as alternative");
}

function testLevelProgressionAllowsHarderAfterTwoWeeks() {
  // G4: after 2+ weeks (>=14 sessions), the difficulty gate relaxes (assembly -> expansion stage).
  const advancedStudy = {
    ...study,
    sessions: Array.from({ length: 15 }, (_unused, i) => ({
      date: `2026-05-${String(i + 1).padStart(2, "0")}`,
      theme: null,
      best3: [],
      weakMisses: [],
      summary: null,
      savedAt: "",
    })),
    expressionBank: [{
      ko: "어려운거", en: "Not in the traditional sense.", note: null, theme: "free",
      register: "casual", sourceId: "x", difficulty: 3,
    }],
  } as unknown as StudySnapshot;
  const { queues } = buildCoachSnapshot(advancedStudy);
  assert.ok(queues.newBank.includes("not in the traditional sense."), "difficulty-3 allowed after 2+ weeks");
}

function testSundayIsReviewOnly() {
  // G3 weekday corner: Sunday (복습) = review/test day — no new material, deeper review queue.
  const sunday = { ...study, studyDate: "2026-06-14" } as unknown as StudySnapshot;
  const { queues } = buildCoachSnapshot(sunday);
  assert.equal(queues.newBank.length, 0, "no new material on review day");
  assert.ok(queues.dueWeak.length + queues.dueBest3.length > 0, "review items present on review day");
}

const tests = [
  testMapsAllSources,
  testSrsDuePriorityQueues,
  testCurriculumFocusMatch,
  testNotDueIsExcludedFromDueQueue,
  testExcludeFromNewSkipsTodayPassed,
  testDifficultyGateBlocksHardAndLong,
  testReviewWarmupCapped,
  testAcceptedAlternativesLoaded,
  testLevelProgressionAllowsHarderAfterTwoWeeks,
  testSundayIsReviewOnly,
];

for (const test of tests) {
  test();
}

console.log(`mona coach-turn mapper tests passed: ${tests.length}`);
