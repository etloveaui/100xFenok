import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  WINDDOWN_LEARN_CREDIT_TARGET,
  applyWindDownLearnAction,
  createWindDownLearnSession,
  createWindDownMeaningChoiceExercise,
  createWindDownSentenceBuilderExercise,
  isWindDownSentenceBuilderEligible,
  type WindDownLearnCard,
  type WindDownLearnExercise,
} from "../src/features/winddown/learn/engine";

const cards: WindDownLearnCard[] = [
  {
    id: "punctuation",
    ko: "나는 할 수 없어, 할 수 있니?",
    en: "I can't, can't I?",
    acceptedVariants: ["I cannot, can I?"],
  },
  { id: "b", ko: "나는 준비됐어.", en: "I am ready." },
  { id: "c", ko: "다시 말해 줄래?", en: "Could you say that again?" },
  { id: "d", ko: "조금 기다려 줘.", en: "Please wait a moment." },
  { id: "e", ko: "지금 떠나자.", en: "Let's leave now." },
];

function correctAction(exercise: WindDownLearnExercise) {
  if (exercise.kind === "meaning-choice") {
    return {
      type: "choose-meaning" as const,
      cardId: exercise.card.id,
      choiceId: exercise.correctChoiceId,
    };
  }
  return {
    type: "submit-sentence" as const,
    cardId: exercise.card.id,
    tokenIds: [...exercise.canonicalTokenIds],
  };
}

function missAction(exercise: WindDownLearnExercise) {
  if (exercise.kind === "meaning-choice") {
    const incorrect = exercise.choices.find(
      (choice) => choice.id !== exercise.correctChoiceId,
    );
    assert(incorrect, "meaning exercise must contain at least one distractor");
    return {
      type: "choose-meaning" as const,
      cardId: exercise.card.id,
      choiceId: incorrect.id,
    };
  }
  return {
    type: "submit-sentence" as const,
    cardId: exercise.card.id,
    tokenIds: [...exercise.canonicalTokenIds].reverse(),
  };
}

assert.equal(WINDDOWN_LEARN_CREDIT_TARGET, 5);

const punctuationBuilder = createWindDownSentenceBuilderExercise(
  cards[0]!,
  "punctuation-seed",
);
assert.deepEqual(
  punctuationBuilder.canonicalTokenIds.map(
    (tokenId) =>
      punctuationBuilder.tokens.find((token) => token.id === tokenId)?.text,
  ),
  ["I", "can't", ",", "can't", "I", "?"],
  "sentence builder must preserve punctuation and contractions in canonical order",
);
assert.equal(
  new Set(punctuationBuilder.tokens.map((token) => token.id)).size,
  punctuationBuilder.tokens.length,
  "duplicate text tokens need stable distinct IDs",
);
assert.deepEqual(
  createWindDownSentenceBuilderExercise(cards[0]!, "punctuation-seed"),
  punctuationBuilder,
  "sentence builder shuffle must be deterministic",
);
assert.equal(
  isWindDownSentenceBuilderEligible({
    id: "too-long",
    ko: "긴 문장",
    en: "This expression has far too many separate words to become a short builder exercise today.",
  }),
  false,
  "long expressions must not become sentence-builder exercises",
);

const meaning = createWindDownMeaningChoiceExercise(
  cards[1]!,
  cards,
  "meaning-seed",
);
assert.equal(meaning.choices.length, 4);
assert.equal(
  meaning.choices.find((choice) => choice.id === meaning.correctChoiceId)?.text,
  cards[1]!.ko,
);
assert.deepEqual(
  createWindDownMeaningChoiceExercise(
    cards[1]!,
    [...cards].reverse(),
    "meaning-seed",
  ),
  meaning,
  "meaning choices must not depend on input order",
);

const session = createWindDownLearnSession({ cards, seed: "learn-score" });
const sameSession = createWindDownLearnSession({
  cards: [...cards].reverse(),
  seed: "learn-score",
});
assert.deepEqual(
  sameSession,
  session,
  "session order and exercises must be seed-stable",
);
assert.equal(session.queue.length, WINDDOWN_LEARN_CREDIT_TARGET);
assert.equal(
  new Set(session.queue.map((exercise) => exercise.card.id)).size,
  WINDDOWN_LEARN_CREDIT_TARGET,
  "the initial quest must contain five distinct cards",
);

const invalid = applyWindDownLearnAction(session, {
  type: "choose-meaning",
  cardId: "not-the-current-card",
  choiceId: "wrong",
});
assert.equal(invalid.outcome, "invalid");
assert.equal(invalid.reward, 0);
assert.deepEqual(
  invalid.state,
  session,
  "invalid action must not mutate progress",
);

const first = session.queue[0]!;
const missed = applyWindDownLearnAction(session, missAction(first));
assert.equal(missed.outcome, "miss");
assert.equal(missed.reward, 0);
assert.notEqual(
  missed.state.queue[0]?.card.id,
  first.card.id,
  "a miss must yield at least one intervening card before retry",
);
assert.equal(
  missed.state.queue.at(-1)?.card.id,
  first.card.id,
  "the missed card must be reinserted at the tail",
);

let progressed = missed.state;
let creditedActions = 0;
while (!progressed.isComplete) {
  const current = progressed.queue[0];
  assert(current, "incomplete session must have a current exercise");
  const result = applyWindDownLearnAction(progressed, correctAction(current));
  assert(result.outcome === "correct" || result.outcome === "complete");
  assert.equal(result.reward, 1);
  creditedActions += result.reward;
  progressed = result.state;
}
assert.equal(creditedActions, WINDDOWN_LEARN_CREDIT_TARGET);
assert.equal(progressed.creditedCardIds.length, WINDDOWN_LEARN_CREDIT_TARGET);
assert.equal(
  new Set(progressed.creditedCardIds).size,
  WINDDOWN_LEARN_CREDIT_TARGET,
);
assert.deepEqual(
  progressed.completion?.mistakeRecap.map((recap) => recap.card.id),
  [first.card.id],
  "completion must retain a concise recap of missed cards",
);

const replay = applyWindDownLearnAction(progressed, correctAction(first));
assert.equal(replay.outcome, "invalid");
assert.equal(replay.reward, 0);
assert.deepEqual(
  replay.state,
  progressed,
  "retry must never double-credit a card",
);

let finalCardState = createWindDownLearnSession({
  cards,
  seed: "final-card-miss-score",
});
while (
  finalCardState.creditedCardIds.length <
  WINDDOWN_LEARN_CREDIT_TARGET - 1
) {
  const current = finalCardState.queue[0];
  assert(current, "four credits must leave one final unique card");
  finalCardState = applyWindDownLearnAction(
    finalCardState,
    correctAction(current),
  ).state;
}
const finalUniqueCard = finalCardState.queue[0]!;
const finalMiss = applyWindDownLearnAction(
  finalCardState,
  missAction(finalUniqueCard),
);
assert.equal(finalMiss.outcome, "miss");
assert.equal(finalMiss.reward, 0);
assert.notEqual(
  finalMiss.state.queue[0]?.card.id,
  finalUniqueCard.card.id,
  "even a final-card miss needs a genuinely actionable intervening practice item",
);
const interlude = finalMiss.state.queue[0]!;
assert.equal(interlude.creditPolicy, "practice-only");
assert.equal(
  finalMiss.state.creditedCardIds.includes(interlude.card.id),
  true,
  "the interlude may reuse a credited card only with explicit no-credit semantics",
);
const practiced = applyWindDownLearnAction(
  finalMiss.state,
  correctAction(interlude),
);
assert.equal(practiced.outcome, "practice");
assert.equal(practiced.reward, 0);
assert.equal(
  practiced.state.creditedCardIds.length,
  WINDDOWN_LEARN_CREDIT_TARGET - 1,
);
assert.equal(practiced.state.queue[0]?.card.id, finalUniqueCard.card.id);
const finalCredit = applyWindDownLearnAction(
  practiced.state,
  correctAction(practiced.state.queue[0]!),
);
assert.equal(finalCredit.outcome, "complete");
assert.equal(
  finalCredit.state.creditedCardIds.length,
  WINDDOWN_LEARN_CREDIT_TARGET,
);
assert.equal(
  new Set(finalCredit.state.creditedCardIds).size,
  WINDDOWN_LEARN_CREDIT_TARGET,
  "the practice-only interlude must never become a second credit",
);

const engineSource = readFileSync(
  path.join(process.cwd(), "src/features/winddown/learn/engine.ts"),
  "utf8",
);
for (const forbidden of [
  "useGeminiLiveSession",
  "Gemini",
  "getUserMedia",
  "WebSocket",
  "fetch(",
  "node:",
]) {
  assert.equal(
    engineSource.includes(forbidden),
    false,
    `Learn engine must not import or call ${forbidden}`,
  );
}

console.log(
  "PASS winddown-learn-engine - deterministic model-free exercises and five-card progress contract",
);
