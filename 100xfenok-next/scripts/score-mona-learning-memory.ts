import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createEmptyMonaVnextLearningProfile,
  applyMonaVnextLearningEvents,
  classifyMonaVnextLearningProfile,
  normalizeMonaVnextLearningProfile,
} from "../src/features/mona-vnext/memory/fsrsLearningProfile";
import { buildLearningEvent } from "../src/features/mona-vnext/memory/srsBridge";
import {
  buildTeacherFilteredMonaVnextSessionExpressionBank,
} from "../src/features/mona-vnext/server/teacherMaterialBank";
import { listMonaVnextGeneratedExpressionEntries } from "../src/features/mona-vnext/server/expressionBank";
import {
  appendMonaVnextMemoryCheckpoint,
  readMonaVnextMemorySummary,
} from "../src/features/mona-vnext/memory/monaMemoryRepository";

const reviewedAt = "2026-07-30T13:00:00.000Z";
const verdicts = ["miss", "close", "canonical", "variant", "garbage"] as const;
const events = verdicts.map((verdict, index) => buildLearningEvent({
  expressionId: `expression-${index}`,
  verdict,
  atIso: reviewedAt,
  sessionId: "owner-learning-memory",
})).filter((event) => event !== null);

assert.equal(events.length, 4, "garbage/STT noise must not enter the learning profile");
const profile = applyMonaVnextLearningEvents(
  createEmptyMonaVnextLearningProfile(),
  events,
);
assert.equal(Object.keys(profile.records).length, 4);
assert.equal(profile.records["expression-0"].lastRating, "again");
assert.equal(profile.records["expression-1"].lastRating, "hard");
assert.equal(profile.records["expression-2"].lastRating, "good");
assert.equal(profile.records["expression-3"].lastRating, "good");

const serialized = JSON.stringify(profile);
assert.equal(serialized.includes("[object Date]"), false);
const restored = normalizeMonaVnextLearningProfile(JSON.parse(serialized));
assert.equal(restored.records["expression-2"].card.reps, 1);
assert.ok(Date.parse(restored.records["expression-2"].card.dueAtIso) > Date.parse(reviewedAt));

const dueAt = restored.records["expression-2"].card.dueAtIso;
const replayed = applyMonaVnextLearningEvents(restored, [
  buildLearningEvent({
    expressionId: "expression-2",
    verdict: "canonical",
    atIso: dueAt,
    sessionId: "owner-learning-memory-2",
  }),
].filter((event) => event !== null));
assert.equal(replayed.records["expression-2"].card.reps, 2);

const atFirstDue = classifyMonaVnextLearningProfile(
  restored,
  new Date(restored.records["expression-0"].card.dueAtIso),
);
assert.ok(atFirstDue.dueExpressionIds.includes("expression-0"));
assert.ok(atFirstDue.deferredExpressionIds.includes("expression-2"));

const allEntries = listMonaVnextGeneratedExpressionEntries();
assert.ok(allEntries.length > 22, "learning-memory selection needs spare material");
const priorityId = allEntries[0].id;
const deferredId = allEntries[1].id;
const bank = buildTeacherFilteredMonaVnextSessionExpressionBank({
  seed: "learning-memory-priority",
  count: 20,
  prioritizedExpressionIds: [priorityId],
  deferredExpressionIds: [deferredId],
});
assert.equal(bank.entries[0]?.id, priorityId, "due review must be first in the next session");
assert.equal(bank.entries.some((entry) => entry.id === deferredId), false, "not-yet-due material should be deferred when inventory is sufficient");
assert.equal(bank.metadata.reviewPriorityCount, 1);

async function checkRepositoryRoundTrip() {
  const originalCwd = process.cwd();
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "mona-learning-memory-"));
  try {
    process.chdir(tempDir);
    const args = {
      conversationId: "learning-memory-roundtrip",
      turnSeq: 1,
      advisory: {
        best3Candidates: [],
        weakNoteCandidates: [],
        nextSessionSuggestions: [],
        learningEvents: [buildLearningEvent({
          expressionId: priorityId,
          verdict: "miss",
          atIso: reviewedAt,
          sessionId: "learning-memory-roundtrip-live",
        })],
      },
    };
    await appendMonaVnextMemoryCheckpoint(args);
    await appendMonaVnextMemoryCheckpoint(args);
    const summary = await readMonaVnextMemorySummary();
    assert.equal(summary.sessions.length, 1, "learning-profile.json must not appear as a conversation");
    assert.equal(summary.sessions[0].checkpointCount, 1, "turn retry must replace rather than duplicate a checkpoint");
    assert.equal(summary.learning.recordCount, 1);
    assert.deepEqual(summary.learning.dueExpressionIds, [priorityId]);
  } finally {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  }
}

void checkRepositoryRoundTrip()
  .then(() => {
    console.log("PASS learning-memory - FSRS state persists and due reviews lead the next session");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
