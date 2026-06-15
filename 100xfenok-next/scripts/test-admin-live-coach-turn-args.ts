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

function testMismatchKeepsModelAttemptAndConsumesTranscript() {
  const resolved = resolveCoachTurnArgsForTranscript(
    { attemptText: "I need at least 10." },
    {
      pendingFinalTranscripts: [{ inputTurnId: 2, text: "Buena, ¿cómo estamos?" }],
      lastConsumedInputTurnId: 1,
    },
  );

  assert.equal(resolved.args.attemptText, "I need at least 10.");
  assert.equal(resolved.didOverride, false);
  assert.equal(resolved.overrideReason, null);
  assert.equal(resolved.skippedReason, "model-transcript-mismatch-kept");
  assert.equal(resolved.consumeInputTurnId, 2);
}

function testControlIntentKeepsArgsAndConsumesTranscript() {
  const resolved = resolveCoachTurnArgsForTranscript(
    { attemptText: "", intent: "next_material" },
    {
      pendingFinalTranscripts: [{ inputTurnId: 3, text: "다음 거" }],
      lastConsumedInputTurnId: 2,
    },
  );

  assert.equal(resolved.args.attemptText, "");
  assert.equal(resolved.args.intent, "next_material");
  assert.equal(resolved.didOverride, false);
  assert.equal(resolved.overrideReason, null);
  assert.equal(resolved.skippedReason, "control-intent-kept");
  assert.equal(resolved.consumeInputTurnId, 3);
  assert.equal(resolved.telemetry.inputTurnId, 3);
}

const tests = [
  testEmptyModelAttemptUsesPendingTranscript,
  testConsumedTranscriptDoesNotReplay,
  testMismatchKeepsModelAttemptAndConsumesTranscript,
  testControlIntentKeepsArgsAndConsumesTranscript,
];

for (const test of tests) {
  test();
}

console.log(`admin live coach-turn arg tests passed: ${tests.length}`);
