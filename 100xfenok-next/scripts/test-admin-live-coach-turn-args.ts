import assert from "node:assert/strict";
import { resolveCoachTurnArgsForTranscript } from "../src/lib/admin-live/coach-turn-args";

function testEmptyModelAttemptUsesPendingTranscript() {
  const resolved = resolveCoachTurnArgsForTranscript(
    { attemptText: "", intent: "repeat_target" },
    {
      pendingFinalTranscripts: [{ inputTurnId: 1, text: "왜 영어 안 보여 줘?", atMs: 100 }],
      lastConsumedInputTurnId: null,
    },
  );

  assert.equal(resolved.args.attemptText, "왜 영어 안 보여 줘?");
  assert.equal(resolved.args.intent, "repeat_target");
  assert.equal(resolved.didOverride, true);
  assert.equal(resolved.overrideReason, "empty-model-attempt");
  assert.equal(resolved.skippedReason, null);
  assert.equal(resolved.consumeInputTurnId, 1);
  assert.equal(resolved.telemetry.inputTurnId, 1);
  assert.equal(resolved.telemetry.modelAttemptTextLen, 0);
  assert.equal(resolved.telemetry.transcriptTextLen, "왜 영어 안 보여 줘?".length);
}

function testConsumedTranscriptDoesNotReplay() {
  const resolved = resolveCoachTurnArgsForTranscript(
    { attemptText: "" },
    {
      pendingFinalTranscripts: [{ inputTurnId: 1, text: "왜 영어 안 보여 줘?" }],
      lastConsumedInputTurnId: 1,
    },
  );

  assert.equal(resolved.args.attemptText, "");
  assert.equal(resolved.didOverride, false);
  assert.equal(resolved.overrideReason, null);
  assert.equal(resolved.skippedReason, "stale-or-consumed-transcript");
  assert.equal(resolved.consumeInputTurnId, null);
  assert.equal(resolved.telemetry.inputTurnId, null);
}

function testMismatchPrefersFinalTranscript() {
  const resolved = resolveCoachTurnArgsForTranscript(
    { attemptText: "Buena, ¿cómo estamos?" },
    {
      pendingFinalTranscripts: [{ inputTurnId: 2, text: "영어 왜 안 보여주냐고?" }],
      lastConsumedInputTurnId: 1,
    },
  );

  assert.equal(resolved.args.attemptText, "영어 왜 안 보여주냐고?");
  assert.equal(resolved.didOverride, true);
  assert.equal(resolved.overrideReason, "model-transcript-mismatch");
  assert.equal(resolved.consumeInputTurnId, 2);
}

const tests = [
  testEmptyModelAttemptUsesPendingTranscript,
  testConsumedTranscriptDoesNotReplay,
  testMismatchPrefersFinalTranscript,
];

for (const test of tests) {
  test();
}

console.log(`admin live coach-turn arg tests passed: ${tests.length}`);
