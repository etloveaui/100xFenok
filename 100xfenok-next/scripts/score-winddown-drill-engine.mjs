import assert from "node:assert/strict";

import {
  WINDDOWN_DRILL_ROUND_TARGET,
  applyWindDownDrillAction,
  createWindDownDrillSession,
  replayWindDownDrillSession,
} from "../src/features/winddown/drill/engine.ts";
import {
  isWindDownDrillResponsePayload,
  isWindDownDrillStatePayload,
} from "../src/features/winddown/drill/clientContract.ts";

const cards = Array.from({ length: 8 }, (_, index) => ({
  id: `drill-${index + 1}`,
  en: `English sentence ${index + 1}`,
  ko: `한국어 문장 ${index + 1}`,
}));

const first = createWindDownDrillSession({ cards, seed: "nightly-drill" });
assert.equal(isWindDownDrillStatePayload(first), true);
assert.equal(
  isWindDownDrillStatePayload({ ...first, phase: "complete", roundIndex: 0 }),
  false,
  "a complete payload must point past all five rounds",
);
assert.equal(
  isWindDownDrillStatePayload({
    ...first,
    rounds: first.rounds.map((round, index) => index === 0
      ? { ...round, choices: [round.choices[0], round.choices[0], round.choices[2]] }
      : round),
  }),
  false,
  "a payload with duplicate visible or semantic choices must fail closed",
);
assert.equal(
  isWindDownDrillStatePayload({
    ...first,
    rounds: [
      { ...first.rounds[0], choices: [...first.rounds[0].choices, null] },
      ...first.rounds.slice(1),
    ],
  }),
  false,
  "a round with a trailing malformed choice must fail closed",
);
assert.equal(
  isWindDownDrillStatePayload({ ...first, rounds: [...first.rounds, null] }),
  false,
  "a payload with a trailing malformed round must fail closed",
);
assert.equal(
  isWindDownDrillStatePayload({
    ...first,
    rounds: first.rounds.map((round, index) => index === 0
      ? { ...round, prompt: "   " }
      : round),
  }),
  false,
  "blank round content must fail closed",
);
const drillResponse = {
  ok: true,
  schemaVersion: 1,
  mode: "drill",
  modelOpened: false,
  material: {
    source: "published-lkg",
    publicationStatus: "active",
    contentDigest: "a".repeat(64),
  },
  session: first,
};
assert.equal(isWindDownDrillResponsePayload(drillResponse), true);
assert.equal(
  isWindDownDrillResponsePayload({
    ...drillResponse,
    material: { ...drillResponse.material, contentDigest: "not-a-sha" },
  }),
  false,
  "a non-SHA-256 material digest must fail closed",
);
const repeated = createWindDownDrillSession({ cards, seed: "nightly-drill" });
assert.deepEqual(first, repeated, "the same material and seed must replay identically");
assert.deepEqual(
  createWindDownDrillSession({ cards: [...cards].reverse(), seed: "nightly-drill" }),
  first,
  "bank reorder must not change a deterministic Drill board",
);
assert.equal(first.rounds.length, WINDDOWN_DRILL_ROUND_TARGET);
assert.equal(first.phase, "prompt");
assert.equal(first.score, 0);
assert.equal(first.combo, 0);
assert.equal(first.results.length, 0);
assert.equal(
  applyWindDownDrillAction(first, {
    type: "answer",
    roundId: "wrong-round",
    choiceId: first.rounds[0].correctChoiceId,
  }),
  first,
  "invalid input must not mutate or advance the session",
);
for (const round of first.rounds) {
  assert.equal(round.choices.length, 3);
  assert.equal(new Set(round.choices.map((choice) => choice.id)).size, 3);
  assert.equal(
    new Set(round.choices.map((choice) => choice.text)).size,
    3,
    "every answer must have three visibly distinct meanings",
  );
  assert.equal(round.choices.filter((choice) => choice.id === round.correctChoiceId).length, 1);
}

const duplicateVisibleLabels = createWindDownDrillSession({
  cards: [
    ...cards,
    { id: "duplicate-ko", en: "A duplicate label.", ko: cards[0].ko },
  ],
  seed: "duplicate-visible-labels",
});
for (const round of duplicateVisibleLabels.rounds) {
  assert.equal(
    new Set(round.choices.map((choice) => choice.text)).size,
    3,
    "duplicate translations in the bank must not make an ambiguous round",
  );
}

let state = first;
for (let index = 0; index < WINDDOWN_DRILL_ROUND_TARGET; index += 1) {
  const round = state.rounds[state.roundIndex];
  assert(round, `round ${index + 1} must exist`);
  const chooseCorrect = index !== 2;
  const choiceId = chooseCorrect
    ? round.correctChoiceId
    : round.choices.find((choice) => choice.id !== round.correctChoiceId)?.id;
  assert(choiceId);
  const answered = applyWindDownDrillAction(state, {
    type: "answer",
    roundId: round.id,
    choiceId,
  });
  assert.equal(answered.phase, "feedback");
  assert.equal(answered.feedback?.correct, chooseCorrect);
  assert.equal(answered.results.length, index + 1);
  if (index === 0) {
    assert.equal(answered.score, 100);
    assert.equal(answered.combo, 1);
  }
  if (index === 1) {
    assert.equal(answered.score, 225);
    assert.equal(answered.combo, 2);
  }
  if (index === 2) {
    assert.equal(answered.score, 225);
    assert.equal(answered.combo, 0);
  }
  assert.deepEqual(
    applyWindDownDrillAction(answered, {
      type: "answer",
      roundId: round.id,
      choiceId,
    }),
    answered,
    "feedback must accept only the continue action",
  );
  state = applyWindDownDrillAction(answered, { type: "continue" });
}

assert.equal(state.phase, "complete");
assert.equal(state.roundIndex, WINDDOWN_DRILL_ROUND_TARGET);
assert.equal(state.results.length, WINDDOWN_DRILL_ROUND_TARGET);
assert.equal(state.correctCount, WINDDOWN_DRILL_ROUND_TARGET - 1);
assert.equal(state.maxCombo, 2);
assert.equal(state.score, 450);

const replay = replayWindDownDrillSession(state);
assert.equal(replay.phase, "prompt");
assert.equal(replay.score, 0);
assert.equal(replay.combo, 0);
assert.equal(replay.results.length, 0);
assert.deepEqual(replay.rounds, state.rounds, "replay must retain the deterministic board");

assert.throws(
  () => createWindDownDrillSession({ cards: cards.slice(0, 2), seed: "too-small" }),
  /winddown_drill_requires_three_unique_cards/,
);
assert.throws(
  () => createWindDownDrillSession({
    cards: [
      { id: "same-a", en: "One", ko: "같은 뜻" },
      { id: "same-b", en: "Two", ko: "같은 뜻" },
      { id: "other", en: "Three", ko: "다른 뜻" },
    ],
    seed: "too-few-visible-choices",
  }),
  /winddown_drill_requires_three_distinct_meanings/,
);

console.log("PASS winddown-drill-engine - deterministic finite scoring loop");
