import assert from "node:assert/strict";
import {
  executeCoachTurn,
  __resetCoachSessionsForTest,
  __seedCoachSessionForTest,
} from "../src/lib/server/mona-coach/coach-turn";
import { resolveCoachTurnArgsForTranscript } from "../src/lib/admin-live/coach-turn-args";
import {
  createMonaCoachState,
  type MonaCoachItem,
  type MonaCoachSnapshot,
} from "../src/lib/server/mona-coach/session-machine";

// Integration test for the coachTurn glue (executeCoachTurn -> facade -> serialized directive).
// Seeds the session so no repository/disk load happens; drives turns that do NOT trigger an SRS write.

const item: MonaCoachItem = {
  itemId: "it lets me.",
  ko: "그게 내가 할 수 있게 해줘.",
  enCanonical: "It lets me.",
  acceptedAlternatives: [],
  pattern: null,
  pronHint: null,
  difficulty: 1,
  sibling: null,
  variations: [],
  source: "bank",
};
const snapshot: MonaCoachSnapshot = { version: "test", items: [item] };
const ctx = { sessionId: "integration-1" } as unknown as Parameters<typeof executeCoachTurn>[1];

async function testResolvedTranscriptRevealsEnglishCard() {
  __resetCoachSessionsForTest();
  const sessionId = "integration-reveal";
  const revealCtx = { sessionId } as unknown as Parameters<typeof executeCoachTurn>[1];
  const state = createMonaCoachState({
    sessionId,
    studyDate: "2026-06-14",
    snapshotVersion: "test",
    current: item,
  });
  __seedCoachSessionForTest(sessionId, state, snapshot);

  const resolved = resolveCoachTurnArgsForTranscript(
    { attemptText: "" },
    {
      pendingFinalTranscripts: [{ inputTurnId: 1, text: "왜 영어 안 보여 줘?" }],
      lastConsumedInputTurnId: null,
    },
  );
  const result = await executeCoachTurn(resolved.args, revealCtx);

  assert.equal(resolved.didOverride, true, "empty model attempt is patched from transcript");
  assert.equal(resolved.consumeInputTurnId, 1, "patched transcript is consumed exactly once");
  assert.equal(result.intent, "repeat_target", "English-card request is classified as target repeat");
  assert.equal(result.cardCommand?.state, "reveal", "English-card request reveals the target");
  assert.equal(result.cardCommand?.en, item.enCanonical, "reveal card includes English");
  assert.equal(result.spokenGuidance, item.enCanonical, "spoken guidance is the target sentence");
}

async function run() {
  __resetCoachSessionsForTest();
  const state = createMonaCoachState({
    sessionId: "integration-1",
    studyDate: "2026-06-14",
    snapshotVersion: "test",
    current: item,
  });
  __seedCoachSessionForTest("integration-1", state, snapshot);

  // wrong attempt -> wrong verdict, no praise, no card reveal
  const wrong = await executeCoachTurn({ attemptText: "It lacks me." }, ctx);
  assert.equal(wrong.verdict, "wrong", "wrong attempt evaluated as wrong");
  assert.equal(wrong.mayPraise, false, "no praise on wrong");

  // repair request -> exact prompt, prompt card, no save
  const repair = await executeCoachTurn({ attemptText: "뭐라고? 질문이 뭐지?" }, ctx);
  assert.equal(repair.intent, "repeat_prompt", "repair classified");
  assert.equal(repair.cardCommand?.state, "prompt", "repair shows prompt card");
  assert.equal(repair.cardCommand?.ko, item.ko, "repair repeats exact Korean prompt");

  // free input -> FREE_MODE marker, no eval
  const bring = await executeCoachTurn({ attemptText: "오늘 이 말 영어로 못 했어. 비행기 놓쳤어." }, ctx);
  assert.equal(bring.intent, "bring_own", "free-input classified");
  assert.ok(typeof bring.spokenGuidance === "string" && bring.spokenGuidance.startsWith("FREE_MODE:"), "free-input enters FREE_MODE");

  await testResolvedTranscriptRevealsEnglishCard();

  console.log("mona coach-turn integration tests passed: 4");
}

run().catch((error) => {
  console.error(error);
  throw error;
});
