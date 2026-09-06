import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  applyWindDownReviewAction,
  createWindDownLocalMatch,
  createWindDownReviewChipExercise,
  createWindDownReviewSession,
  type WindDownReviewCard,
} from "../src/features/winddown/review/engine";
import {
  WINDDOWN_REVIEW_DRAFT_MAX_AGE_MS,
  WINDDOWN_REVIEW_DRAFT_RECOVERY_STORAGE_KEY,
  WINDDOWN_REVIEW_DRAFT_SCHEMA_VERSION,
  WINDDOWN_REVIEW_DRAFT_STORAGE_KEY,
  archiveWindDownReviewDraft,
  clearWindDownReviewDraftAfterExport,
  createWindDownReviewDraft,
  loadWindDownReviewDraftRecovery,
  loadWindDownReviewDraft,
  saveWindDownReviewDraft,
  type WindDownReviewDraftStorage,
} from "../src/features/winddown/review/draft";

const digest = "a".repeat(64);
const nowIso = "2026-09-06T03:00:00.000Z";
const savedAtIso = "2026-09-06T02:59:00.000Z";

const cards: WindDownReviewCard[] = [
  {
    id: "review-card-a",
    ko: "나는 준비됐어.",
    en: "I am ready.",
    reviewCycleId: `winddown-review:${"1".repeat(64)}`,
    dueAtIso: "2026-09-06T00:00:00.000Z",
  },
  {
    id: "review-card-b",
    ko: "잠깐 기다려 줘.",
    en: "Please wait a moment.",
    reviewCycleId: `winddown-review:${"2".repeat(64)}`,
    dueAtIso: "2026-09-06T00:00:00.000Z",
  },
  {
    id: "review-card-c",
    ko: "나중에 다시 이야기하자.",
    en: "Let's talk again later.",
    reviewCycleId: `winddown-review:${"3".repeat(64)}`,
    dueAtIso: "2026-09-06T00:00:00.000Z",
  },
];

class MemorySessionStorage implements WindDownReviewDraftStorage {
  private readonly values = new Map<string, string>();

  get value() {
    return this.getItem(WINDDOWN_REVIEW_DRAFT_STORAGE_KEY);
  }

  set value(next: string | null) {
    if (next === null) this.removeItem(WINDDOWN_REVIEW_DRAFT_STORAGE_KEY);
    else this.setItem(WINDDOWN_REVIEW_DRAFT_STORAGE_KEY, next);
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

class ThrowingSessionStorage implements WindDownReviewDraftStorage {
  activeValue: string | null = null;

  constructor(private readonly operation: "get" | "set") {}

  getItem(key: string) {
    if (this.operation === "get") throw new Error("SESSION_STORAGE_UNAVAILABLE");
    return key === WINDDOWN_REVIEW_DRAFT_STORAGE_KEY ? this.activeValue : null;
  }

  setItem(_key: string, _value: string) {
    throw new Error("SESSION_STORAGE_QUOTA_EXCEEDED");
  }

  removeItem(_key: string) {
    throw new Error("SESSION_STORAGE_UNAVAILABLE");
  }
}

function assertResumed(
  result: ReturnType<typeof loadWindDownReviewDraft>,
) {
  assert.equal(result.status, "resumed", "the draft must be accepted for this context");
  if (result.status !== "resumed") throw new Error("draft was not resumed");
  return result;
}

function currentCards() {
  return cards;
}

function save(
  storage: MemorySessionStorage,
  state: ReturnType<typeof createWindDownReviewSession>,
  args: {
    answer?: string;
    selectedChipIds?: string[];
    savedAtIso?: string;
    cards?: readonly WindDownReviewCard[];
  } = {},
) {
  const draft = createWindDownReviewDraft({
    state,
    cards: args.cards ?? currentCards(),
    answer: args.answer ?? "",
    selectedChipIds: args.selectedChipIds ?? [],
    savedAtIso: args.savedAtIso ?? savedAtIso,
  });
  assert.equal(draft.schemaVersion, WINDDOWN_REVIEW_DRAFT_SCHEMA_VERSION);
  assert.equal(saveWindDownReviewDraft(storage, draft).status, "saved");
  return draft;
}

function load(
  storage: WindDownReviewDraftStorage,
  context: {
    cards?: readonly WindDownReviewCard[];
    contentDigest?: string;
    nowIso?: string;
  } = {},
) {
  return loadWindDownReviewDraft({
    storage,
    cards: context.cards ?? currentCards(),
    contentDigest: context.contentDigest ?? digest,
    nowIso: context.nowIso ?? nowIso,
  });
}

const initial = createWindDownReviewSession({ cards, contentDigest: digest });
const chips = createWindDownReviewChipExercise(cards[0]!);
const selectedChipIds = chips.canonicalChipIds.slice(0, 2);
const chipStorage = new MemorySessionStorage();
const chipDraft = save(chipStorage, initial, { selectedChipIds });
const chipResume = assertResumed(load(chipStorage));
assert.deepEqual(chipResume.state.queue.map((card) => card.reviewCycleId), cards.map((card) => card.reviewCycleId));
assert.deepEqual(chipResume.selectedChipIds, selectedChipIds, "reload must retain the partial chip sentence");
assert.equal(chipResume.answer, "", "chip mode must not invent a typed answer");
assert.equal(chipDraft.inputMode, "chips");

let typed = applyWindDownReviewAction(initial, {
  type: "set-input-mode",
  inputMode: "typed",
}).state;
const typedStorage = new MemorySessionStorage();
save(typedStorage, typed, { answer: "I am" });
const typedResume = assertResumed(load(typedStorage));
assert.equal(typedResume.state.inputMode, "typed");
assert.equal(typedResume.answer, "I am", "reload must retain a partial typed answer");
assert.deepEqual(typedResume.selectedChipIds, []);

typed = applyWindDownReviewAction(typed, {
  type: "submit-first",
  answer: "not quite",
}).state;
typed = applyWindDownReviewAction(typed, {
  type: "first-graded",
  exact: false,
}).state;
assert.equal(typed.phase, "match");
const firstTile = typed.match!.tiles[0]!;
const midMatch = applyWindDownReviewAction(typed, {
  type: "select-match-tile",
  tileId: firstTile.id,
}).state;
assert.equal(midMatch.match!.selectedTileIds.length, 1);
const matchStorage = new MemorySessionStorage();
save(matchStorage, midMatch, { cards, answer: "" });
const matchResume = assertResumed(load(matchStorage));
assert.equal(matchResume.state.phase, "match");
assert.deepEqual(matchResume.state.match!.selectedTileIds, [firstTile.id], "reload must retain a mid-match selection");

let retry = typed;
for (const pair of retry.match!.pairs) {
  const left = retry.match!.tiles.find((tile) => tile.pairId === pair.id && tile.side === "left")!;
  const right = retry.match!.tiles.find((tile) => tile.pairId === pair.id && tile.side === "right")!;
  retry = applyWindDownReviewAction(retry, { type: "select-match-tile", tileId: left.id }).state;
  retry = applyWindDownReviewAction(retry, { type: "select-match-tile", tileId: right.id }).state;
}
assert.equal(retry.phase, "retry");
const retryStorage = new MemorySessionStorage();
save(retryStorage, retry, { answer: "I am ready" });
const retryResume = assertResumed(load(retryStorage));
assert.equal(retryResume.state.phase, "retry");
assert.equal(retryResume.answer, "I am ready", "reload must retain the retry answer");
assert.equal(retryResume.state.results.length, 0, "repair and retry must not award a draft result");

let gradePending = applyWindDownReviewAction(initial, {
  type: "set-input-mode",
  inputMode: "typed",
}).state;
gradePending = applyWindDownReviewAction(gradePending, {
  type: "submit-first",
  answer: "pending grade answer",
}).state;
assert.equal(gradePending.phase, "grading-first");
const gradeStorage = new MemorySessionStorage();
save(gradeStorage, gradePending, { answer: "pending grade answer" });
const gradeResume = assertResumed(load(gradeStorage));
assert.equal(gradeResume.state.phase, "grade-error-first", "in-flight grade must restore as an explicit retry");
assert.equal(gradeResume.state.pendingAnswer, "pending grade answer");
assert.equal(gradeResume.state.results.length, 0);

const commitPending = applyWindDownReviewAction(gradePending, {
  type: "first-graded",
  exact: true,
}).state;
assert.equal(commitPending.phase, "committing");
assert(commitPending.commitInput);
const pendingCommitPayload = structuredClone(commitPending.commitInput);
const commitStorage = new MemorySessionStorage();
save(commitStorage, commitPending, { answer: "" });
const commitResume = assertResumed(load(commitStorage));
assert.equal(commitResume.state.phase, "commit-error", "in-flight commit must restore as an explicit retry");
assert.deepEqual(commitResume.state.commitInput, pendingCommitPayload, "commit retry must retain the exact idempotent payload");
assert.equal(commitResume.state.results.length, 0, "restoring a pending commit must never fabricate progress");

const missingPendingCommitStorage = new MemorySessionStorage();
save(missingPendingCommitStorage, commitPending);
const missingPendingCommitResume = assertResumed(
  load(missingPendingCommitStorage, { cards: cards.slice(1) }),
);
assert.equal(
  missingPendingCommitResume.state.phase,
  "commit-error",
  "a missing fresh due card must leave a pending commit as an explicit retry",
);
assert.equal(
  missingPendingCommitResume.state.queue[0]?.reviewCycleId,
  cards[0]!.reviewCycleId,
  "the exact pending canonical card must remain available for manual retry",
);
assert.deepEqual(
  missingPendingCommitResume.state.commitInput,
  pendingCommitPayload,
  "a missing fresh due card must retain the exact pending commit payload",
);
const manualMissingPendingRetry = applyWindDownReviewAction(
  missingPendingCommitResume.state,
  { type: "retry-commit" },
);
assert.equal(manualMissingPendingRetry.state.phase, "committing");
assert.deepEqual(manualMissingPendingRetry.state.commitInput, pendingCommitPayload);
assert.equal(manualMissingPendingRetry.state.results.length, 0, "manual retry must not fabricate a receipt");

let committed = applyWindDownReviewAction(initial, {
  type: "set-input-mode",
  inputMode: "typed",
}).state;
committed = applyWindDownReviewAction(committed, {
  type: "submit-first",
  answer: "I am ready",
}).state;
committed = applyWindDownReviewAction(committed, {
  type: "first-graded",
  exact: true,
}).state;
committed = applyWindDownReviewAction(committed, {
  type: "commit-succeeded",
  result: {
    materialId: cards[0]!.id,
    reviewCycleId: cards[0]!.reviewCycleId,
    rating: "good",
    reward: 1,
  },
}).state;
const committedStorage = new MemorySessionStorage();
save(committedStorage, committed);
const committedResume = assertResumed(load(committedStorage));
assert.deepEqual(
  committedResume.state.queue.map((card) => card.reviewCycleId),
  cards.slice(1).map((card) => card.reviewCycleId),
  "already committed review cycles must never replay when the due queue still includes them",
);
assert.equal(committedResume.state.results.length, 1);

const staleStorage = new MemorySessionStorage();
save(staleStorage, initial);
const staleRaw = staleStorage.value;
const digestStale = load(staleStorage, { contentDigest: "b".repeat(64) });
assert.equal(digestStale.status, "stale");
assert.equal(staleStorage.value, staleRaw, "digest mismatch must retain the rejected raw draft");
const cycleChanged = cards.map((card, index) =>
  index === 0
    ? { ...card, reviewCycleId: `winddown-review:${"f".repeat(64)}` }
    : card,
);
const cycleStale = load(staleStorage, { cards: cycleChanged });
assert.equal(cycleStale.status, "stale");
assert.equal(staleStorage.value, staleRaw, "cycle mismatch must never overwrite recovery evidence");
const canonicalChanged = cards.map((card, index) =>
  index === 0 ? { ...card, en: "I am not ready." } : card,
);
const canonicalStale = load(staleStorage, { cards: canonicalChanged });
assert.equal(canonicalStale.status, "stale");
assert.equal(staleStorage.value, staleRaw, "canonical card drift must remain visible for recovery");
const freshnessStale = load(staleStorage, {
  nowIso: new Date(Date.parse(savedAtIso) + WINDDOWN_REVIEW_DRAFT_MAX_AGE_MS + 1).toISOString(),
});
assert.equal(freshnessStale.status, "stale");
assert.equal(staleStorage.value, staleRaw, "expired drafts must remain retained");

const malformedStorage = new MemorySessionStorage();
malformedStorage.value = '{"schemaVersion":1,"queue":';
const malformedRaw = malformedStorage.value;
const malformed = load(malformedStorage);
assert.equal(malformed.status, "malformed");
assert.equal(malformedStorage.value, malformedRaw, "malformed drafts must remain retained");

const recoveryStorage = new MemorySessionStorage();
recoveryStorage.value = staleRaw;
const archived = archiveWindDownReviewDraft(recoveryStorage);
assert.equal(archived.status, "archived", "explicit recovery must copy a rejected draft before clearing the active slot");
assert.equal(recoveryStorage.value, null, "the active slot clears only after the recovery copy is verified");
assert.equal(recoveryStorage.getItem(WINDDOWN_REVIEW_DRAFT_RECOVERY_STORAGE_KEY), staleRaw);
const recoveredRaw = loadWindDownReviewDraftRecovery(recoveryStorage);
assert.equal(recoveredRaw.status, "available");
if (recoveredRaw.status === "available") assert.equal(recoveredRaw.raw, staleRaw, "recovery must preserve exact raw bytes");

const conflictingRecoveryStorage = new MemorySessionStorage();
conflictingRecoveryStorage.value = staleRaw;
conflictingRecoveryStorage.setItem(WINDDOWN_REVIEW_DRAFT_RECOVERY_STORAGE_KEY, "existing archive");
const conflictingArchive = archiveWindDownReviewDraft(conflictingRecoveryStorage);
assert.equal(conflictingArchive.status, "unavailable", "an existing different recovery archive must never be overwritten");
assert.equal(conflictingRecoveryStorage.value, staleRaw, "archive conflict must retain the active rejected draft");

const failedRecoveryStorage = new ThrowingSessionStorage("set");
failedRecoveryStorage.activeValue = staleRaw;
const failedArchive = archiveWindDownReviewDraft(failedRecoveryStorage);
assert.equal(failedArchive.status, "unavailable", "recovery copy failures must remain non-fatal");
assert.equal(failedRecoveryStorage.activeValue, staleRaw, "copy failure must retain the active rejected draft");

const exportedRawStorage = new MemorySessionStorage();
const exportedRaw = `${"malformed".repeat(60_000)}!`;
exportedRawStorage.value = exportedRaw;
const oversizedNormalArchive = archiveWindDownReviewDraft(exportedRawStorage);
assert.equal(oversizedNormalArchive.status, "unavailable", "normal archive must refuse an oversized malformed active draft");
assert.equal(exportedRawStorage.value, exportedRaw, "normal archive refusal must retain the oversized active raw");
const retainedArchive = "retained archive bytes";
exportedRawStorage.setItem(WINDDOWN_REVIEW_DRAFT_RECOVERY_STORAGE_KEY, retainedArchive);
const exportedClear = clearWindDownReviewDraftAfterExport(exportedRawStorage, exportedRaw);
assert.equal(exportedClear.status, "cleared", "an explicit export acknowledgment may clear an oversized active raw");
assert.equal(exportedRawStorage.value, null);
assert.equal(
  exportedRawStorage.getItem(WINDDOWN_REVIEW_DRAFT_RECOVERY_STORAGE_KEY),
  retainedArchive,
  "explicit export clearing must never replace the retained recovery archive",
);

const mismatchedExportStorage = new MemorySessionStorage();
mismatchedExportStorage.value = "current rejected raw";
mismatchedExportStorage.setItem(WINDDOWN_REVIEW_DRAFT_RECOVERY_STORAGE_KEY, retainedArchive);
const mismatchedExport = clearWindDownReviewDraftAfterExport(
  mismatchedExportStorage,
  "previously downloaded raw",
);
assert.equal(mismatchedExport.status, "unavailable", "export acknowledgment must refuse when active raw changed");
assert.equal(mismatchedExportStorage.value, "current rejected raw", "raw mismatch must retain the current active raw");
assert.equal(
  mismatchedExportStorage.getItem(WINDDOWN_REVIEW_DRAFT_RECOVERY_STORAGE_KEY),
  retainedArchive,
  "raw mismatch must retain the existing recovery archive",
);

assert.equal(load(new ThrowingSessionStorage("get")).status, "unavailable", "review must survive unavailable sessionStorage reads");
const writeFailure = saveWindDownReviewDraft(
  new ThrowingSessionStorage("set"),
  chipDraft,
);
assert.equal(writeFailure.status, "unavailable", "quota or storage write failures must be non-fatal");

const singleMatch = createWindDownLocalMatch({
  card: cards[0]!,
  cards: [cards[0]!],
  seed: cards[0]!.reviewCycleId,
});
assert.equal(singleMatch.pairs.length, 1, "a one-card repair must use one real sentence pair");
assert.deepEqual(singleMatch.pairs.map((pair) => pair.id), [`card:${cards[0]!.id}`]);
assert.equal(singleMatch.tiles.length, 2);
assert.equal(singleMatch.pairs.some((pair) => ["opening", "closing"].includes(pair.id)), false);
let singleSolved = singleMatch;
for (const pair of singleSolved.pairs) {
  singleSolved = applyWindDownReviewAction(
    {
      ...initial,
      queue: [cards[0]!],
      phase: "match",
      match: singleSolved,
    },
    { type: "select-match-tile", tileId: singleSolved.tiles.find((tile) => tile.pairId === pair.id && tile.side === "left")!.id },
  ).state.match!;
  const right = singleSolved.tiles.find((tile) => tile.pairId === pair.id && tile.side === "right")!;
  const completed = applyWindDownReviewAction(
    {
      ...initial,
      queue: [cards[0]!],
      phase: "match",
      match: singleSolved,
    },
    { type: "select-match-tile", tileId: right.id },
  ).state.match!;
  assert.equal(completed.isComplete, true);
}

const twoMatch = createWindDownLocalMatch({
  card: cards[0]!,
  cards: cards.slice(0, 2),
  seed: "two-card-repair",
});
assert.equal(twoMatch.pairs.length, 2, "a two-card repair must use two real sentence pairs");
assert.equal(twoMatch.tiles.length, 4);
assert(twoMatch.pairs.every((pair) => pair.id.startsWith("card:")));

const retryForGrade = applyWindDownReviewAction(retry, {
  type: "submit-retry",
  answer: "I am ready",
});
assert.equal(retryForGrade.state.phase, "grading-retry");
const noCreditAfterRepair = applyWindDownReviewAction(retryForGrade.state, {
  type: "retry-graded",
  exact: true,
});
assert.equal(noCreditAfterRepair.state.phase, "committing");
assert.equal(noCreditAfterRepair.state.results.length, 0, "grading and repair must not create completed credit");

const engine = readFileSync(
  path.join(process.cwd(), "src/features/winddown/review/engine.ts"),
  "utf8",
);
const client = readFileSync(
  path.join(process.cwd(), "src/features/winddown/ui/WindDownReviewClient.tsx"),
  "utf8",
);
assert.equal(engine.includes('id: "opening"'), false, "fake first-word repair pairs must be removed");
assert.equal(engine.includes('id: "closing"'), false, "fake last-word repair pairs must be removed");
assert.equal(client.includes("sessionStorage"), true, "continuity must use private same-tab sessionStorage");
assert.equal(client.includes("localStorage"), false, "review continuity must never spill into localStorage");
assert(client.includes("loadWindDownReviewDraft") && client.includes("saveWindDownReviewDraft"));
assert(client.includes("archiveWindDownReviewDraft"));
assert(client.includes("clearWindDownReviewDraftAfterExport"));
assert(client.includes("이전 기록 보관하고 이어가기"));
assert(client.includes("data-draft-recovery-action=\"archive\""));
assert(client.includes("data-draft-recovery-action=\"download\""));
assert(client.includes("파일을 보관했어 · 새 기록으로 이어가기"));
assert(client.includes("data-draft-recovery-action=\"acknowledge-export\""));
assert(client.includes("draftWritesAllowedRef.current = true"));
assert(client.includes('window.addEventListener("pagehide"'));
assert(client.includes("persistDraft(next.state"));
assert(
  client.includes("한 문장 다시 익히기") &&
    client.includes("두 문장 다시 익히기"),
  "short repair UI must use the approved Korean labels",
);
assert(
  client.includes('data-repair-kind="single-card"') &&
    client.includes('data-repair-kind="two-card"'),
  "short repair labels must expose stable browser selectors",
);
assert(client.includes("aria-pressed") && client.includes("aria-live=\"polite\""), "choice and match/error feedback must expose state accessibly");
assert(client.includes("session.match.pairs.length"), "repair progress must follow the actual pair count");
assert(client.includes("SHA256_HEX") && client.includes("SHA256_HEX.test(material.contentDigest)"), "study responses must require a SHA-256 hex digest");

console.log(
  "PASS winddown-review-continuity - draft round-trip, fail-closed recovery, exact retries, meaningful short repairs, and accessibility contract",
);
