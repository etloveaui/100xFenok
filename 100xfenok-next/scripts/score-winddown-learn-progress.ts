import assert from "node:assert/strict";
import {
  prepareWindDownLearnProgress,
  WindDownLearnProgressError,
} from "../src/features/winddown/server/learnProgress";

const digest = "a".repeat(64);
const activeMaterialIds = new Set(["material-a"]);
const base = {
  schemaVersion: 1,
  activity: "learn",
  attemptId: "attempt-1",
  sessionId: "night-2026-07-31",
  sequence: 1,
  materialId: "material-a",
  contentDigest: digest,
  occurredAt: "2026-07-30T20:12:00.000Z",
  verdict: "canonical",
};

const first = prepareWindDownLearnProgress(base, {
  currentContentDigest: digest,
  activeMaterialIds,
});
const retry = prepareWindDownLearnProgress(base, {
  currentContentDigest: digest,
  activeMaterialIds,
});
assert.deepEqual(retry, first, "a transport retry must prepare the same event");
assert.equal(first.learningEvent.rating, "good");
assert.equal(first.checkpoint.turnSeq, 1);
assert.equal(first.checkpoint.advisory.learningEvents.length, 1);
assert.ok(
  first.learningEvent.sessionId.includes("attempt-1"),
  "attempt identity must participate in the persisted event identity",
);

assert.equal(
  prepareWindDownLearnProgress(
    { ...base, verdict: "close" },
    { currentContentDigest: digest, activeMaterialIds },
  ).learningEvent.rating,
  "hard",
);
assert.equal(
  prepareWindDownLearnProgress(
    { ...base, verdict: "miss" },
    { currentContentDigest: digest, activeMaterialIds },
  ).learningEvent.rating,
  "again",
);

function expectError(value: unknown, code: WindDownLearnProgressError["code"]) {
  assert.throws(
    () =>
      prepareWindDownLearnProgress(value, {
        currentContentDigest: digest,
        activeMaterialIds,
      }),
    (error) =>
      error instanceof WindDownLearnProgressError && error.code === code,
  );
}

expectError({ ...base, materialId: "retired-material" }, "MATERIAL_NOT_ACTIVE");
expectError(
  { ...base, contentDigest: "b".repeat(64) },
  "MATERIAL_VERSION_CHANGED",
);
expectError({ ...base, sequence: 0 }, "INVALID_PROGRESS_EVENT");
expectError({ ...base, verdict: "garbage" }, "INVALID_PROGRESS_EVENT");
expectError(
  { ...base, attemptId: "contains spaces" },
  "INVALID_PROGRESS_EVENT",
);

console.log(
  "PASS winddown-learn-progress - retries are stable and stale material fails closed",
);
