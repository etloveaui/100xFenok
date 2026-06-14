import assert from "node:assert/strict";
import {
  createMonaCoachState,
  runMonaCoachTurn,
  type MonaCoachItem,
  type MonaCoachSnapshot,
} from "../src/lib/server/mona-coach/session-machine";

function item(overrides: Partial<MonaCoachItem> & Pick<MonaCoachItem, "itemId" | "ko" | "enCanonical">): MonaCoachItem {
  return {
    acceptedAlternatives: [],
    pattern: null,
    pronHint: null,
    difficulty: 1,
    sibling: null,
    variations: [],
    source: "bank",
    ...overrides,
  };
}

const rainCats = item({
  itemId: "rain-cats",
  ko: "비가 억수같이 쏟아져.",
  enCanonical: "It's raining cats and dogs.",
  acceptedAlternatives: ["It's raining heavily."],
});

const relax = item({
  itemId: "relax",
  ko: "그게 나를 쉬게 해줘.",
  enCanonical: "That lets me relax.",
});

const feeling = item({
  itemId: "feeling",
  ko: "대충 이런 느낌이야.",
  enCanonical: "That's the general idea.",
});

const letsMe = item({
  itemId: "lets-me",
  ko: "그게 내가 할 수 있게 해줘.",
  enCanonical: "It lets me.",
});

const letYou = item({
  itemId: "let-you",
  ko: "그게 너를 하게 해줘?",
  enCanonical: "Does it let you?",
});

const rainHeavy = item({
  itemId: "rain-heavy",
  ko: "비가 억수같이 쏟아져.",
  enCanonical: "It's raining heavily.",
  acceptedAlternatives: ["It's raining cats and dogs."],
});

const snapshot: MonaCoachSnapshot = {
  version: "test",
  items: [rainCats, relax, feeling, letsMe, letYou, rainHeavy],
};

function baseState(current: MonaCoachItem = rainCats) {
  return createMonaCoachState({
    sessionId: "test-session",
    studyDate: "2026-06-14",
    snapshotVersion: "test",
    current,
    queues: {
      newBank: [relax.itemId, feeling.itemId],
    },
  });
}

function testWrongAttemptMayNotPraise() {
  const result = runMonaCoachTurn({
    snapshot,
    state: baseState(relax),
    learnerTranscript: "That likes me relax.",
  });

  assert.equal(result.intent, "attempt");
  assert.equal(result.attemptEval?.verdict, "wrong");
  assert.equal(result.mayPraise, false);
  assert.equal(result.state.turn.mayPraise, false);
  assert.equal(result.saveReviewDelta.type, "attempt");
  assert.equal(result.saveReviewDelta.weak, true);
}

function testChallengeKeepsTargetLocked() {
  const state = baseState(rainCats);
  const beforeTarget = state.current?.enCanonical;
  const result = runMonaCoachTurn({
    snapshot,
    state,
    learnerTranscript: "야, 처음에 cats and dogs 쓰라며. 왜 이제 와서 heavily가 더 자연스럽다고 말해?",
  });

  assert.equal(result.intent, "challenge");
  assert.equal(result.mayPraise, false);
  assert.equal(result.state.current?.itemId, rainCats.itemId);
  assert.equal(result.state.current?.enCanonical, beforeTarget);
  assert.match(result.spokenGuidance, /cats and dogs/);
  assert.doesNotMatch(result.spokenGuidance, /heavily가 더 자연/);
}

function testRepeatPromptReturnsExactPrompt() {
  const result = runMonaCoachTurn({
    snapshot,
    state: baseState(rainCats),
    learnerTranscript: "뭐라고? 질문이 뭐지?",
  });

  assert.equal(result.intent, "repeat_prompt");
  assert.equal(result.mayPraise, false);
  assert.equal(result.spokenGuidance, rainCats.ko);
  assert.equal(result.cardCommand?.type, "showCard");
  assert.equal(result.cardCommand?.state, "prompt");
  assert.equal(result.cardCommand?.ko, rainCats.ko);
  assert.equal(result.saveReviewDelta.type, "none");
}

function testNextSwitchesCard() {
  const result = runMonaCoachTurn({
    snapshot,
    state: baseState(rainCats),
    learnerTranscript: "앞 문장 넘어가 봐.",
  });

  assert.equal(result.intent, "next_material");
  assert.equal(result.mayPraise, false);
  assert.equal(result.state.current?.itemId, relax.itemId);
  assert.equal(result.cardCommand?.itemId, relax.itemId);
  assert.equal(result.cardCommand?.state, "prompt");
  assert.equal(result.nextExpectedState, "attempt");
  assert.equal(result.saveReviewDelta.type, "none");
}

// --- Claude share: prove the brain handles every documented real-log failure (CONTRACT section 13) ---

function testItLacksMeIsWrongNoPraise() {
  // mqd9rh0u:seq999 — "It lacks me" for target "It lets me" must never be praised.
  const result = runMonaCoachTurn({ snapshot, state: baseState(letsMe), learnerTranscript: "It lacks me." });
  assert.equal(result.intent, "attempt");
  assert.equal(result.attemptEval?.verdict, "wrong");
  assert.equal(result.mayPraise, false);
  assert.match(result.spokenGuidance, /let/);
}

function testDoesItLikeYouIsWrongNoPraise() {
  // mqd9rh0u:seq1257 — "Does it like you?" for target "Does it let you?" must not get "완벽".
  const result = runMonaCoachTurn({ snapshot, state: baseState(letYou), learnerTranscript: "Does it like you?" });
  assert.equal(result.attemptEval?.verdict, "wrong");
  assert.equal(result.mayPraise, false);
}

function testIWasRainingIsWrongNoPraise() {
  // mqd9j9d5:seq303 — "I was raining heavily" must not be praised as a good past tense.
  const result = runMonaCoachTurn({ snapshot, state: baseState(rainHeavy), learnerTranscript: "I was raining heavily." });
  assert.equal(result.attemptEval?.verdict, "wrong");
  assert.equal(result.mayPraise, false);
}

function testAcceptedAlternativeIsCorrect() {
  // mq9fyv3r:seq72 / mqd9fg8p — a previously-accepted alternative must be accepted, not reversed/denied.
  const result = runMonaCoachTurn({ snapshot, state: baseState(rainCats), learnerTranscript: "It's raining heavily." });
  assert.equal(result.attemptEval?.verdict, "correct");
  assert.equal(result.attemptEval?.matchedAlternative, "It's raining heavily.");
  assert.equal(result.mayPraise, true);
}

function testGarbledIsUnintelligibleNoSave() {
  // STT garbage must not be built upon or praised.
  const result = runMonaCoachTurn({ snapshot, state: baseState(rainCats), learnerTranscript: "...???" });
  assert.equal(result.intent, "garbled");
  assert.equal(result.mayPraise, false);
  assert.equal(result.saveReviewDelta.type, "none");
}

function testStopClosesWithoutSave() {
  // explicit stop only — never premature close.
  const result = runMonaCoachTurn({ snapshot, state: baseState(rainCats), learnerTranscript: "이제 그만할래." });
  assert.equal(result.intent, "stop");
  assert.equal(result.nextExpectedState, "stop");
  assert.equal(result.saveReviewDelta.type, "none");
  assert.equal(result.mayPraise, false);
}

function testFrustrationAcknowledgedNoPraise() {
  // mqdg0nv7:seq269 — "너는 업데이트가 안 됐나 봐" is frustration, not lesson input.
  const result = runMonaCoachTurn({ snapshot, state: baseState(rainCats), learnerTranscript: "너는 업데이트가 안 됐나 봐. 어?" });
  assert.equal(result.intent, "frustration");
  assert.equal(result.mayPraise, false);
}

function testBringOwnEntersFreeMode() {
  // Mona project_instructions: "오늘 이 말 못 했어:[KO]" jumps to free mode, not evaluated as an attempt.
  const result = runMonaCoachTurn({
    snapshot,
    state: baseState(rainCats),
    learnerTranscript: "오늘 이 말 영어로 못 했어. 비행기 놓쳤어.",
  });
  assert.equal(result.intent, "bring_own");
  assert.equal(result.mayPraise, false);
  assert.match(result.spokenGuidance, /^FREE_MODE:/);
  assert.equal(result.attemptEval, null);
}

function testFreeTalkModeNoDrilling() {
  // Friday free-talking: 1-minute monologue, no card drilling; FREETALK_MODE marker for the model.
  const state = createMonaCoachState({
    sessionId: "ft", studyDate: "2026-06-12", snapshotVersion: "test",
    sessionMode: "freetalk", current: rainCats,
  });
  const result = runMonaCoachTurn({ snapshot, state, learnerTranscript: "I went to the office today and it was busy." });
  assert.match(result.spokenGuidance, /^FREETALK_MODE:/);
  assert.equal(result.cardCommand, null);
  assert.equal(result.mayPraise, false);
}

const tests = [
  testWrongAttemptMayNotPraise,
  testFreeTalkModeNoDrilling,
  testChallengeKeepsTargetLocked,
  testRepeatPromptReturnsExactPrompt,
  testNextSwitchesCard,
  testBringOwnEntersFreeMode,
  testItLacksMeIsWrongNoPraise,
  testDoesItLikeYouIsWrongNoPraise,
  testIWasRainingIsWrongNoPraise,
  testAcceptedAlternativeIsCorrect,
  testGarbledIsUnintelligibleNoSave,
  testStopClosesWithoutSave,
  testFrustrationAcknowledgedNoPraise,
];

for (const test of tests) {
  test();
}

console.log(`mona coach session-machine tests passed: ${tests.length}`);
