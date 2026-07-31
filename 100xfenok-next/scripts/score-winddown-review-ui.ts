import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  applyWindDownLocalMatchAction,
  applyWindDownReviewAction,
  createWindDownLocalMatch,
  createWindDownReviewChipExercise,
  createWindDownReviewSession,
  joinWindDownReviewChips,
  type WindDownReviewCard,
} from "../src/features/winddown/review/engine";

const digest = "a".repeat(64);
const cards: WindDownReviewCard[] = [
  {
    id: "same-label-a",
    ko: "나는 준비됐어.",
    en: "I am ready.",
    reviewCycleId: `winddown-review:${"1".repeat(64)}`,
    dueAtIso: "2026-07-31T00:00:00.000Z",
  },
  {
    id: "same-label-b",
    ko: "나는 준비됐어.",
    en: "I am ready.",
    reviewCycleId: `winddown-review:${"2".repeat(64)}`,
    dueAtIso: "2026-07-31T00:00:00.000Z",
  },
  {
    id: "third",
    ko: "조금 기다려 줘.",
    en: "Please wait a moment.",
    reviewCycleId: `winddown-review:${"3".repeat(64)}`,
    dueAtIso: "2026-07-31T00:00:00.000Z",
  },
];

const match = createWindDownLocalMatch({
  card: cards[0]!,
  cards,
  seed: "stable-review-match",
});
assert.equal(match.tiles.length, 6, "repair must always render three pairs");
assert.deepEqual(
  new Set(match.pairs.map((pair) => pair.id)),
  new Set(cards.map((card) => `card:${card.id}`)),
  "a three-card queue must repair with three real English-Korean sentence pairs",
);
assert.equal(
  new Set(match.tiles.map((tile) => tile.id)).size,
  6,
  "duplicate visible labels must still have unique tile IDs",
);
const duplicateLabelMatch = createWindDownLocalMatch({
  card: { ...cards[0]!, id: "one-word", en: "Go" },
  cards: [{ ...cards[0]!, id: "one-word", en: "Go" }],
  seed: "duplicate-label-review-match",
});
assert.ok(
  duplicateLabelMatch.tiles.filter((tile) => tile.label === "Go").length >= 2,
  "the repair fixture must contain duplicate visible labels",
);
assert.equal(
  new Set(duplicateLabelMatch.tiles.map((tile) => tile.id)).size,
  duplicateLabelMatch.tiles.length,
  "duplicate labels must never become duplicate React or reducer IDs",
);

const chipExercise = createWindDownReviewChipExercise(cards[0]!);
assert.deepEqual(
  new Set(chipExercise.chips.map((chip) => chip.id)),
  new Set(chipExercise.canonicalChipIds),
  "review chips must preserve every canonical token exactly once",
);
const chipsById = new Map(chipExercise.chips.map((chip) => [chip.id, chip]));
assert.equal(
  joinWindDownReviewChips(
    chipExercise.canonicalChipIds.flatMap((id) => {
      const chip = chipsById.get(id);
      return chip ? [chip] : [];
    }),
  ),
  "I am ready.",
  "canonical chip order must reconstruct punctuation without stray spaces",
);
const punctuationCard: WindDownReviewCard = {
  ...cards[0]!,
  id: "punctuation",
  en: 'He said "well-being costs $5…"',
};
const punctuationExercise = createWindDownReviewChipExercise(punctuationCard);
const punctuationById = new Map(
  punctuationExercise.chips.map((chip) => [chip.id, chip]),
);
assert.equal(
  joinWindDownReviewChips(
    punctuationExercise.canonicalChipIds.flatMap((id) => {
      const chip = punctuationById.get(id);
      return chip ? [chip] : [];
    }),
  ),
  punctuationCard.en,
  "quotes, hyphens, currency, and ellipses must stay readable",
);
assert.deepEqual(
  createWindDownLocalMatch({
    card: cards[0]!,
    cards: [...cards].reverse(),
    seed: "stable-review-match",
  }),
  match,
  "the local repair board must be deterministic regardless of queue order",
);

const firstLeft = match.tiles.find((tile) => tile.side === "left")!;
const wrongRight = match.tiles.find(
  (tile) => tile.side === "right" && tile.pairId !== firstLeft.pairId,
)!;
let matchStep = applyWindDownLocalMatchAction(match, {
  type: "select-tile",
  tileId: firstLeft.id,
});
assert.equal(matchStep.outcome, "selected");
matchStep = applyWindDownLocalMatchAction(matchStep.state, {
  type: "select-tile",
  tileId: wrongRight.id,
});
assert.equal(matchStep.outcome, "wrong-pair");
assert.deepEqual(
  matchStep.state.matchedPairIds,
  [],
  "a wrong pair must give feedback only and never progress a repair",
);
assert.deepEqual(
  new Set(matchStep.state.wrongTileIds),
  new Set([firstLeft.id, wrongRight.id]),
);

let solvedMatch = match;
for (const pairId of solvedMatch.pairs.map((pair) => pair.id)) {
  const left = solvedMatch.tiles.find(
    (tile) => tile.pairId === pairId && tile.side === "left",
  )!;
  const right = solvedMatch.tiles.find(
    (tile) => tile.pairId === pairId && tile.side === "right",
  )!;
  solvedMatch = applyWindDownLocalMatchAction(solvedMatch, {
    type: "select-tile",
    tileId: left.id,
  }).state;
  solvedMatch = applyWindDownLocalMatchAction(solvedMatch, {
    type: "select-tile",
    tileId: right.id,
  }).state;
}
assert.equal(solvedMatch.isComplete, true);

let review = createWindDownReviewSession({ cards, contentDigest: digest });
assert.equal(review.phase, "recall");
assert.equal(review.inputMode, "chips", "word chips must be the default mode");
review = applyWindDownReviewAction(review, {
  type: "set-input-mode",
  inputMode: "typed",
}).state;
assert.equal(review.inputMode, "typed", "typed recall must be opt-in");
review = applyWindDownReviewAction(review, {
  type: "submit-first",
  answer: "i am ready",
}).state;
assert.equal(review.phase, "grading-first");
review = applyWindDownReviewAction(review, {
  type: "first-graded",
  exact: false,
}).state;
assert.equal(review.phase, "match");
for (const pairId of review.match!.pairs.map((pair) => pair.id)) {
  const left = review.match!.tiles.find(
    (tile) => tile.pairId === pairId && tile.side === "left",
  )!;
  const right = review.match!.tiles.find(
    (tile) => tile.pairId === pairId && tile.side === "right",
  )!;
  review = applyWindDownReviewAction(review, {
    type: "select-match-tile",
    tileId: left.id,
  }).state;
  review = applyWindDownReviewAction(review, {
    type: "select-match-tile",
    tileId: right.id,
  }).state;
}
assert.equal(review.phase, "retry");
review = applyWindDownReviewAction(review, {
  type: "submit-retry",
  answer: "I am ready.",
}).state;
review = applyWindDownReviewAction(review, {
  type: "retry-graded",
  exact: true,
}).state;
assert.equal(review.phase, "committing");
assert.deepEqual(review.attempts, [
  { answer: "i am ready", revealedBefore: false },
  { answer: "I am ready.", revealedBefore: false },
]);
assert.equal(
  review.commitInput?.contentDigest,
  digest,
  "a commit must retain its original digest for a network retry",
);
assert.equal(
  review.commitInput?.reviewCycleId,
  cards[0]?.reviewCycleId,
  "a commit must retain the original cycle ID for a network retry",
);
assert.equal(
  review.commitInput?.inputMode,
  "typed",
  "the selected input mode must remain frozen through repair and retry",
);

const reveal = applyWindDownReviewAction(
  createWindDownReviewSession({ cards, contentDigest: digest }),
  { type: "reveal" },
).state;
assert.equal(reveal.phase, "committing");
assert.deepEqual(reveal.attempts, [{ answer: "", revealedBefore: true }]);
assert.equal(
  reveal.commitInput?.inputMode,
  "chips",
  "a default-mode reveal must retain chips in its receipt request",
);

const enginePath = path.join(
  process.cwd(),
  "src/features/winddown/review/engine.ts",
);
const clientPath = path.join(
  process.cwd(),
  "src/features/winddown/ui/WindDownReviewClient.tsx",
);
const pagePath = path.join(process.cwd(), "src/app/winddown/review/page.tsx");
const engine = readFileSync(enginePath, "utf8");
const client = readFileSync(clientPath, "utf8");
const page = readFileSync(pagePath, "utf8");

assert.equal(engine.includes("fetch("), false, "local reducers must not call an API");
assert.ok(
  client.includes("/api/winddown/study?mode=review") &&
    client.includes('operation: "grade-recall"') &&
    client.includes("attempt: attempts.at(-1)") &&
    client.includes("inputMode: input.inputMode") &&
    client.includes("receipt.inputMode !== input.inputMode") &&
    client.includes('operation: "commit-review-cycle"') &&
    client.includes("...input,"),
  "Review must use the flat contract: load due queue, grade one attempt, then commit frozen attempts",
);
assert.ok(
  client.includes('type: "set-input-mode"') &&
    client.includes('aria-pressed={session.inputMode === "typed"}') &&
    client.includes('enterKeyHint="done"') &&
    client.includes("event.nativeEvent.isComposing"),
  "Review must default to chips and expose an accessible, IME-safe typed opt-in",
);
assert.equal(
  client.includes("onTranscript={setAnswer}"),
  false,
  "device speech practice must never write into the scored Review answer",
);
assert.ok(
  client.includes('href="/winddown/learn"'),
  "Review completion must offer the next journey step directly",
);
assert.ok(
  client.includes('"correct", "good"'),
  "Review must recognize the server grade outcome `correct` as an exact recall",
);
assert.ok(
  client.includes("REVIEW_CYCLE_STALE") &&
    client.includes("REVIEW_CYCLE_NOT_DUE") &&
    client.includes("REVIEW_CYCLE_CONFLICT"),
  "stale, not-due, and conflict responses must reload the due queue",
);
assert.ok(
  client.includes("min-h-[44px]") &&
    !client.includes("min-h-12") &&
    client.includes("min-h-[460px]"),
  "Review controls need 44px-plus touch targets and a stable mobile card frame",
);
assert.ok(
  page.includes("verifyAdminSessionToken") && page.includes("<AdminAccessGate />"),
  "Review must retain the product authentication gate",
);

for (const forbidden of [
  "MonaVoiceCoachApp",
  "useGeminiLiveSession",
  "/api/mona-vnext/session",
  "getUserMedia",
  "WebSocket",
  "Gemini",
]) {
  assert.equal(
    `${engine}\n${client}\n${page}`.includes(forbidden),
    false,
    `model-free Review surface reaches forbidden dependency: ${forbidden}`,
  );
}

console.log(
  "PASS winddown-review-ui - deterministic local Match and exactly-once Review commit flow",
);
