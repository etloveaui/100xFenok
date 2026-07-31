import assert from "node:assert/strict";
import {
  chapterGrowth,
  projectWindDownGameProgress,
  xpIntoLevel,
  xpNeededForLevel,
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
import {
  SCENE_PAINTERS,
} from "../src/features/winddown/game/ui/scenes";
import {
  buildWindDownCeremonyOptionCatalog,
  commitWindDownCeremonyChoice,
  createEmptyWindDownCeremonyRecord,
  normalizeWindDownCeremonyProjection,
  normalizeWindDownCeremonyRecord,
  projectWindDownCeremony,
  projectUnavailableWindDownCeremony,
} from "../src/features/winddown/game/model/ceremony";

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
assert(
  WIND_DOWN_CONTENT_PACK.chapters.every(
    (chapter) => typeof SCENE_PAINTERS[chapter.scene] === "function",
  ),
  "every chapter scene key must resolve to a concrete painter",
);
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

for (const adversarialXp of [
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  -1,
  1_000_000_000,
]) {
  const width =
    (xpIntoLevel(adversarialXp) / xpNeededForLevel(adversarialXp)) * 100;
  assert(
    Number.isFinite(width) && width >= 0 && width <= 100,
    `progress width must remain finite and bounded for xp=${adversarialXp}`,
  );
  const growth = chapterGrowth(adversarialXp);
  assert(
    Number.isFinite(growth) && growth >= 0 && growth <= 1,
    `chapter growth must remain finite and bounded for xp=${adversarialXp}`,
  );
}

const ceremonyRecord = createEmptyWindDownCeremonyRecord();
const ceremonyMaterial = {
  schemaVersion: 1 as const,
  contentDigest: "a".repeat(64),
  entries: [
    { id: "learned-sleep", en: "I need to sleep on it." },
    { id: "learned-light", en: "I can see the first light." },
    { id: "learned-dream", en: "We are chasing the same dream." },
  ],
};
const fallbackCatalog = buildWindDownCeremonyOptionCatalog({
  material: ceremonyMaterial,
  mastery: [],
  record: ceremonyRecord,
  currentLevel: 7,
});
const lockedCeremony = commitWindDownCeremonyChoice({
  record: ceremonyRecord,
  selection: { slotId: "group", optionId: "lumen" },
  currentLevel: 6,
  committedAtIso: "2026-07-31T12:00:00.000Z",
  catalog: fallbackCatalog,
});
assert.equal(lockedCeremony.status, "locked");

const committedCeremony = commitWindDownCeremonyChoice({
  record: ceremonyRecord,
  selection: { slotId: "group", optionId: "lumen" },
  currentLevel: 7,
  committedAtIso: "2026-07-31T12:00:00.000Z",
  catalog: fallbackCatalog,
});
assert.equal(committedCeremony.status, "committed");
if (committedCeremony.status !== "committed") {
  throw new Error("expected a committed ceremony");
}
assert.equal(
  commitWindDownCeremonyChoice({
    record: committedCeremony.record,
    selection: { slotId: "group", optionId: "lumen" },
    currentLevel: 7,
    committedAtIso: "2026-07-31T12:01:00.000Z",
    catalog: fallbackCatalog,
  }).status,
  "duplicate",
);
assert.equal(
  commitWindDownCeremonyChoice({
    record: committedCeremony.record,
    selection: { slotId: "group", optionId: "moonrise" },
    currentLevel: 7,
    committedAtIso: "2026-07-31T12:01:00.000Z",
    catalog: fallbackCatalog,
  }).status,
  "conflict",
);
const ceremonyProjection = projectWindDownCeremony(
  committedCeremony.record,
  7,
  fallbackCatalog,
);
assert(normalizeWindDownCeremonyProjection(ceremonyProjection));
assert.deepEqual(
  projectWindDownCeremony(ceremonyRecord, 1, fallbackCatalog).slots.map(
    (slot) => slot.options.length,
  ),
  [0, 0, 0],
  "locked ceremony names must stay hidden until the receipt level reveals them",
);
assert(
  normalizeWindDownCeremonyRecord({
    ...committedCeremony.record,
    catalogVersion: "0.9.0",
    choices: {
      group: {
        ...committedCeremony.choice,
        optionId: "retired-option",
        label: "A Retired but Stored Name",
      },
    },
  }),
  "a valid stored choice must survive later catalog revisions",
);
assert.equal(
  normalizeWindDownCeremonyProjection({
    ...ceremonyProjection,
    currentLevel: 6,
  }),
  null,
  "a projection whose unlock flags disagree with receipt level must fail closed",
);
assert(
  normalizeWindDownCeremonyProjection(
    projectUnavailableWindDownCeremony(ceremonyRecord, 7),
  ),
  "material outage must remain an explicit valid projection rather than breaking the tour",
);
const masteryMaterialEntries = [
  ...ceremonyMaterial.entries,
  { id: "learned-minute", en: "Could you give me a minute?" },
  { id: "learned-tomorrow", en: "I will figure it out tomorrow." },
  { id: "learned-ready", en: "We are ready for this." },
  { id: "learned-home", en: "I am finally home." },
  { id: "learned-start", en: "Let's start from here." },
  { id: "learned-night", en: "It was a beautiful night." },
];
const masteryEvidence = masteryMaterialEntries.map((entry, index) => ({
  materialId: entry.id,
  reviewedAtIso: `2026-07-2${index + 1}T12:00:00.000Z`,
  stability: 100 - index,
  successfulReviewCount: index < 3 ? 2 : 3,
}));
const masteryCatalog = buildWindDownCeremonyOptionCatalog({
  material: { ...ceremonyMaterial, entries: masteryMaterialEntries },
  mastery: masteryEvidence,
  record: ceremonyRecord,
  currentLevel: 13,
});
assert.equal(masteryCatalog.slots.group.source, "mastery-derived");
assert.equal(masteryCatalog.slots.group.options.length, 3);
assert.deepEqual(
  masteryCatalog.slots.group.options.map((option) => option.label),
  ["SLEEP", "LIGHT", "DREAM"],
  "group candidates must use a meaningful learned-phrase root, not lead verbs such as NEED",
);
assert.deepEqual(
  masteryCatalog.slots["debut-song"].options.map((option) => option.label),
  ["Give Me A Minute", "Figure It Out Tomorrow", "Ready For This"],
);
assert.deepEqual(
  masteryCatalog.slots.fandom.options.map((option) => option.label),
  ["HOME CREW", "START CREW", "NIGHT CREW"],
);
assert.deepEqual(
  buildWindDownCeremonyOptionCatalog({
    material: { ...ceremonyMaterial, entries: masteryMaterialEntries },
    mastery: masteryEvidence.slice(0, 8),
    record: ceremonyRecord,
    currentLevel: 13,
  }).slots.fandom.source,
  "fallback-insufficient-mastery",
  "fallback must count unique post-exclusion slices, not raw eligible expressions",
);
assert.deepEqual(
  buildWindDownCeremonyOptionCatalog({
    material: { ...ceremonyMaterial, entries: masteryMaterialEntries },
    mastery: [...masteryEvidence].reverse(),
    record: ceremonyRecord,
    currentLevel: 13,
  }),
  masteryCatalog,
  "mastery option generation must be deterministic regardless of input order",
);
const levelSevenCatalog = buildWindDownCeremonyOptionCatalog({
  material: { ...ceremonyMaterial, entries: masteryMaterialEntries },
  mastery: masteryEvidence,
  record: ceremonyRecord,
  currentLevel: 7,
});
assert.equal(levelSevenCatalog.slots.group.source, "mastery-derived");
assert.deepEqual(
  levelSevenCatalog.slots.group.options.map((option) => option.label),
  ["SLEEP", "LIGHT", "DREAM"],
  "the visible group ceremony must receive the strongest eligible phrases",
);
assert.equal(
  levelSevenCatalog.slots["debut-song"].source,
  "fallback-insufficient-mastery",
  "a locked debut-song ceremony must not consume mastery",
);
assert.equal(
  levelSevenCatalog.slots.fandom.source,
  "fallback-insufficient-mastery",
  "a locked fandom ceremony must not consume mastery",
);
const allStrongMasteryEvidence = masteryEvidence.map((evidence) => ({
  ...evidence,
  successfulReviewCount: 3,
}));
const committedGroupCatalog = buildWindDownCeremonyOptionCatalog({
  material: { ...ceremonyMaterial, entries: masteryMaterialEntries },
  mastery: allStrongMasteryEvidence,
  record: committedCeremony.record,
  currentLevel: 13,
});
assert.deepEqual(
  committedGroupCatalog.slots.group.options,
  fallbackCatalog.slots.group.options,
  "a committed group ceremony must retain three static options without consuming mastery",
);
assert.deepEqual(
  committedGroupCatalog.slots["debut-song"].options.map(
    (option) => option.label,
  ),
  ["Sleep On It", "See The First Light", "Chasing The Same Dream"],
  "a committed group must leave the three strongest qualifying phrases for debut-song",
);
assert.deepEqual(
  committedGroupCatalog.slots.fandom.options.map((option) => option.label),
  ["MINUTE CREW", "TOMORROW CREW", "READY CREW"],
  "later active slots must remain exclusive after skipping a committed group",
);
assert(
  normalizeWindDownCeremonyProjection(
    projectWindDownCeremony(
      committedCeremony.record,
      13,
      committedGroupCatalog,
    ),
  ),
  "a committed unlocked slot must keep three static options so the ready projection remains valid",
);

console.log(
  "PASS winddown-game-progress - receipt XP and one-time ceremonies are capped, idempotent, and deterministic",
);
