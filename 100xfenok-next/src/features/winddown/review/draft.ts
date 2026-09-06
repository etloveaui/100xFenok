import {
  WINDDOWN_REVIEW_SCHEMA_VERSION,
  createWindDownReviewChipExercise,
  type WindDownLocalMatchState,
  type WindDownMatchPair,
  type WindDownMatchTile,
  type WindDownReviewAttempt,
  type WindDownReviewCard,
  type WindDownReviewCommitInput,
  type WindDownReviewInputMode,
  type WindDownReviewPhase,
  type WindDownReviewResult,
  type WindDownReviewState,
} from "./engine";

export const WINDDOWN_REVIEW_DRAFT_SCHEMA_VERSION = 1 as const;
export const WINDDOWN_REVIEW_DRAFT_STORAGE_KEY =
  "winddown-review:draft:v1" as const;
export const WINDDOWN_REVIEW_DRAFT_RECOVERY_STORAGE_KEY =
  "winddown-review:draft:recovery:v1" as const;
export const WINDDOWN_REVIEW_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000 as const;

const MAX_DRAFT_CARDS = 100;
const MAX_REVIEW_ATTEMPTS = 2;
const MAX_ANSWER_LENGTH = 240;
const MAX_LABEL_LENGTH = 240;
const MAX_DRAFT_SERIALIZED_LENGTH = 350_000;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,180}$/;
const REVIEW_CYCLE_ID = /^winddown-review:[a-f0-9]{64}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const REVIEW_PHASES: readonly WindDownReviewPhase[] = [
  "recall",
  "grading-first",
  "grade-error-first",
  "match",
  "retry",
  "grading-retry",
  "grade-error-retry",
  "committing",
  "commit-error",
  "summary",
];

const DRAFT_KEYS = new Set([
  "schemaVersion",
  "savedAtIso",
  "contentDigest",
  "cards",
  "queue",
  "results",
  "committedReviewCycleIds",
  "phase",
  "inputMode",
  "attempts",
  "pendingAnswer",
  "match",
  "commitInput",
  "answer",
  "selectedChipIds",
]);

const CARD_REQUIRED_KEYS = new Set([
  "id",
  "ko",
  "en",
  "reviewCycleId",
  "dueAtIso",
]);
const CARD_OPTIONAL_KEYS = new Set(["acceptedVariants"]);
const RESULT_KEYS = new Set([
  "materialId",
  "reviewCycleId",
  "rating",
  "reward",
]);
const ATTEMPT_KEYS = new Set(["answer", "revealedBefore"]);
const MATCH_KEYS = new Set([
  "pairs",
  "tiles",
  "selectedTileIds",
  "matchedPairIds",
  "wrongTileIds",
  "isComplete",
]);
const PAIR_KEYS = new Set(["id", "leftLabel", "rightLabel"]);
const TILE_KEYS = new Set(["id", "pairId", "side", "label"]);
const COMMIT_KEYS = new Set([
  "schemaVersion",
  "activity",
  "reviewCycleId",
  "materialId",
  "contentDigest",
  "inputMode",
  "attempts",
]);

export type WindDownReviewDraftStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
};

export type WindDownReviewDraftResult = WindDownReviewResult & {
  reviewCycleId: string;
};

export type WindDownReviewDraft = {
  schemaVersion: typeof WINDDOWN_REVIEW_DRAFT_SCHEMA_VERSION;
  savedAtIso: string;
  contentDigest: string;
  /** Every card issued for this same-tab review round, including committed cards. */
  cards: WindDownReviewCard[];
  /** The reducer queue at the exact point this draft was captured. */
  queue: WindDownReviewCard[];
  results: WindDownReviewDraftResult[];
  committedReviewCycleIds: string[];
  phase: WindDownReviewPhase;
  inputMode: WindDownReviewInputMode;
  attempts: WindDownReviewAttempt[];
  pendingAnswer: string | null;
  match: WindDownLocalMatchState | null;
  commitInput: WindDownReviewCommitInput | null;
  answer: string;
  selectedChipIds: string[];
};

export type WindDownReviewDraftRejectReason =
  | "invalid-context"
  | "expired"
  | "future-dated"
  | "content-digest-mismatch"
  | "review-cycle-mismatch"
  | "canonical-card-mismatch"
  | "queue-cycle-missing"
  | "current-queue-invalid"
  | "state-invalid";

export type WindDownReviewDraftLoadResult =
  | { status: "missing" }
  | {
      status: "resumed";
      draft: WindDownReviewDraft;
      state: WindDownReviewState;
      answer: string;
      selectedChipIds: string[];
      reconciled: boolean;
    }
  | {
      status: "stale";
      raw: string;
      reason: WindDownReviewDraftRejectReason;
    }
  | { status: "malformed"; raw: string; reason: "invalid-shape" | "invalid-json" }
  | {
      status: "unavailable";
      reason: "storage-unavailable" | "storage-read-failed";
    };

export type WindDownReviewDraftWriteResult =
  | { status: "saved" }
  | {
      status: "unavailable";
      reason: "storage-unavailable" | "storage-write-failed";
    };

export type WindDownReviewDraftRecoveryResult =
  | { status: "missing" }
  | { status: "archived"; raw: string }
  | {
      status: "unavailable";
      reason:
        | "storage-unavailable"
        | "storage-read-failed"
        | "recovery-conflict"
        | "recovery-write-failed"
        | "recovery-verify-failed"
        | "active-clear-unsupported"
        | "active-clear-failed"
        | "raw-too-large";
    };

export type WindDownReviewDraftRecoveryLoadResult =
  | { status: "missing" }
  | { status: "available"; raw: string }
  | {
      status: "unavailable";
      reason:
        | "storage-unavailable"
        | "storage-read-failed"
        | "recovery-too-large";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: ReadonlySet<string>,
  optional: ReadonlySet<string> = new Set(),
) {
  const keys = Object.keys(value);
  return (
    required.size <= keys.length &&
    keys.every((key) => required.has(key) || optional.has(key)) &&
    [...required].every((key) => Object.hasOwn(value, key)) &&
    keys.length ===
      required.size + [...optional].filter((key) => Object.hasOwn(value, key)).length
  );
}

function boundedString(
  value: unknown,
  maxLength: number,
  allowEmpty = false,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= maxLength &&
    (allowEmpty || Boolean(value.trim()))
  );
}

function cloneCard(card: WindDownReviewCard): WindDownReviewCard {
  return {
    id: card.id,
    ko: card.ko,
    en: card.en,
    ...(card.acceptedVariants
      ? { acceptedVariants: [...card.acceptedVariants] }
      : {}),
    reviewCycleId: card.reviewCycleId,
    dueAtIso: card.dueAtIso,
  };
}

function cloneAttempt(attempt: WindDownReviewAttempt): WindDownReviewAttempt {
  return {
    answer: attempt.answer,
    revealedBefore: attempt.revealedBefore,
  };
}

function cloneResult(result: WindDownReviewDraftResult): WindDownReviewDraftResult {
  return {
    materialId: result.materialId,
    reviewCycleId: result.reviewCycleId,
    rating: result.rating,
    reward: result.reward,
  };
}

function cloneMatch(match: WindDownLocalMatchState | null): WindDownLocalMatchState | null {
  if (!match) return null;
  return {
    pairs: match.pairs.map((pair) => ({ ...pair })),
    tiles: match.tiles.map((tile) => ({ ...tile })),
    selectedTileIds: [...match.selectedTileIds],
    matchedPairIds: [...match.matchedPairIds],
    wrongTileIds: [...match.wrongTileIds],
    isComplete: match.isComplete,
  };
}

function cloneCommitInput(
  input: WindDownReviewCommitInput | null,
): WindDownReviewCommitInput | null {
  if (!input) return null;
  return {
    schemaVersion: input.schemaVersion,
    activity: input.activity,
    reviewCycleId: input.reviewCycleId,
    materialId: input.materialId,
    contentDigest: input.contentDigest,
    inputMode: input.inputMode,
    attempts: input.attempts.map(cloneAttempt),
  };
}

function sameCard(left: WindDownReviewCard, right: WindDownReviewCard) {
  const leftVariants = left.acceptedVariants ?? [];
  const rightVariants = right.acceptedVariants ?? [];
  return (
    left.id === right.id &&
    left.ko === right.ko &&
    left.en === right.en &&
    left.reviewCycleId === right.reviewCycleId &&
    left.dueAtIso === right.dueAtIso &&
    leftVariants.length === rightVariants.length &&
    leftVariants.every((value, index) => value === rightVariants[index])
  );
}

function parseCard(value: unknown): WindDownReviewCard | null {
  if (!isRecord(value) || !hasExactKeys(value, CARD_REQUIRED_KEYS, CARD_OPTIONAL_KEYS)) {
    return null;
  }
  const id = value.id;
  const ko = value.ko;
  const en = value.en;
  const reviewCycleId = value.reviewCycleId;
  const dueAtIso = value.dueAtIso;
  if (
    !boundedString(id, 180) ||
    !SAFE_ID.test(id) ||
    !boundedString(ko, MAX_LABEL_LENGTH) ||
    !boundedString(en, MAX_LABEL_LENGTH) ||
    !boundedString(reviewCycleId, 220) ||
    !REVIEW_CYCLE_ID.test(reviewCycleId) ||
    !boundedString(dueAtIso, 80) ||
    !Number.isFinite(Date.parse(dueAtIso))
  ) {
    return null;
  }
  let acceptedVariants: string[] | undefined;
  if (Object.hasOwn(value, "acceptedVariants")) {
    if (
      !Array.isArray(value.acceptedVariants) ||
      value.acceptedVariants.length > 20 ||
      !value.acceptedVariants.every(
        (variant) => boundedString(variant, MAX_LABEL_LENGTH),
      )
    ) {
      return null;
    }
    acceptedVariants = [...value.acceptedVariants] as string[];
  }
  return {
    id,
    ko,
    en,
    ...(acceptedVariants ? { acceptedVariants } : {}),
    reviewCycleId,
    dueAtIso,
  };
}

function parseCards(value: unknown): WindDownReviewCard[] | null {
  if (!Array.isArray(value) || value.length > MAX_DRAFT_CARDS) return null;
  const cards = value.map(parseCard);
  if (!cards.every((card): card is WindDownReviewCard => Boolean(card))) {
    return null;
  }
  const ids = new Set(cards.map((card) => card.id));
  const cycles = new Set(cards.map((card) => card.reviewCycleId));
  return ids.size === cards.length && cycles.size === cards.length ? cards : null;
}

function parseAttempts(value: unknown): WindDownReviewAttempt[] | null {
  if (
    !Array.isArray(value) ||
    value.length > MAX_REVIEW_ATTEMPTS ||
    !value.every(
      (attempt) =>
        isRecord(attempt) &&
        hasExactKeys(attempt, ATTEMPT_KEYS) &&
        boundedString(attempt.answer, MAX_ANSWER_LENGTH, true) &&
        typeof attempt.revealedBefore === "boolean" &&
        (Boolean(attempt.answer.trim()) || attempt.revealedBefore),
    )
  ) {
    return null;
  }
  return value.map((attempt) => ({
    answer: (attempt as Record<string, unknown>).answer as string,
    revealedBefore: (attempt as Record<string, unknown>).revealedBefore as boolean,
  }));
}

function parseResult(
  value: unknown,
  cardsByCycle: ReadonlyMap<string, WindDownReviewCard>,
): WindDownReviewDraftResult | null {
  if (!isRecord(value) || !hasExactKeys(value, RESULT_KEYS)) return null;
  const materialId = value.materialId;
  const reviewCycleId = value.reviewCycleId;
  if (
    !boundedString(materialId, 180) ||
    !SAFE_ID.test(materialId) ||
    !boundedString(reviewCycleId, 220) ||
    !REVIEW_CYCLE_ID.test(reviewCycleId) ||
    !["good", "hard", "again"].includes(String(value.rating)) ||
    (value.reward !== 0 && value.reward !== 1)
  ) {
    return null;
  }
  const card = cardsByCycle.get(reviewCycleId);
  return card && card.id === materialId
    ? {
        materialId,
        reviewCycleId,
        rating: value.rating as WindDownReviewResult["rating"],
        reward: value.reward as 0 | 1,
      }
    : null;
}

function parseMatch(value: unknown): WindDownLocalMatchState | null {
  if (value === null) return null;
  if (!isRecord(value) || !hasExactKeys(value, MATCH_KEYS)) return null;
  if (
    !Array.isArray(value.pairs) ||
    value.pairs.length < 1 ||
    value.pairs.length > 3 ||
    !value.pairs.every(
      (pair) =>
        isRecord(pair) &&
        hasExactKeys(pair, PAIR_KEYS) &&
        typeof pair.id === "string" &&
        pair.id.length <= 186 &&
        pair.id.startsWith("card:") &&
        SAFE_ID.test(pair.id.slice("card:".length)) &&
        boundedString(pair.leftLabel, MAX_LABEL_LENGTH) &&
        boundedString(pair.rightLabel, MAX_LABEL_LENGTH),
    ) ||
    !Array.isArray(value.tiles) ||
    value.tiles.length !== value.pairs.length * 2 ||
    !value.tiles.every(
      (tile) =>
        isRecord(tile) &&
        hasExactKeys(tile, TILE_KEYS) &&
        typeof tile.id === "string" &&
        SAFE_ID.test(tile.id) &&
        typeof tile.pairId === "string" &&
        tile.pairId.length <= 186 &&
        tile.pairId.startsWith("card:") &&
        SAFE_ID.test(tile.pairId.slice("card:".length)) &&
        (tile.side === "left" || tile.side === "right") &&
        boundedString(tile.label, MAX_LABEL_LENGTH),
    ) ||
    !Array.isArray(value.selectedTileIds) ||
    value.selectedTileIds.length > 2 ||
    !value.selectedTileIds.every((id) => typeof id === "string") ||
    !Array.isArray(value.matchedPairIds) ||
    value.matchedPairIds.length > value.pairs.length ||
    !value.matchedPairIds.every((id) => typeof id === "string") ||
    !Array.isArray(value.wrongTileIds) ||
    value.wrongTileIds.length > 2 ||
    !value.wrongTileIds.every((id) => typeof id === "string") ||
    typeof value.isComplete !== "boolean"
  ) {
    return null;
  }
  const pairs = value.pairs as Record<string, unknown>[];
  const tiles = value.tiles as Record<string, unknown>[];
  const pairIds = pairs.map((pair) => pair.id as string);
  const tileIds = tiles.map((tile) => tile.id as string);
  const selectedTileIds = value.selectedTileIds as string[];
  const matchedPairIds = value.matchedPairIds as string[];
  const wrongTileIds = value.wrongTileIds as string[];
  const pairIdSet = new Set(pairIds);
  const tileIdSet = new Set(tileIds);
  const pairsById = new Map(
    pairs.map((pair) => [pair.id as string, pair]),
  );
  if (
    pairIdSet.size !== pairIds.length ||
    tileIdSet.size !== tileIds.length ||
    new Set(selectedTileIds).size !== selectedTileIds.length ||
    new Set(matchedPairIds).size !== matchedPairIds.length ||
    new Set(wrongTileIds).size !== wrongTileIds.length ||
    selectedTileIds.some((id) => !tileIdSet.has(id)) ||
    matchedPairIds.some((id) => !pairIdSet.has(id)) ||
    wrongTileIds.some((id) => !tileIdSet.has(id)) ||
    selectedTileIds.some((id) => wrongTileIds.includes(id)) ||
    matchedPairIds.some((pairId) =>
      tiles.some((tile) =>
        tile.pairId === pairId &&
        (selectedTileIds.includes(tile.id as string) ||
          wrongTileIds.includes(tile.id as string)),
      ),
    ) ||
    matchedPairIds.some((id) => wrongTileIds.some((wrongId) => wrongId.startsWith(`${id}:`))) ||
    tiles.some((tile) => {
      const pair = pairsById.get(tile.pairId as string);
      return Boolean(
        pair &&
          tile.label !==
            (tile.side === "left" ? pair.leftLabel : pair.rightLabel),
      );
    }) ||
    value.isComplete !== (matchedPairIds.length === pairIds.length)
  ) {
    return null;
  }
  if (
    selectedTileIds.length === 2 &&
    (tiles.find((tile) => tile.id === selectedTileIds[0])?.side ===
      tiles.find((tile) => tile.id === selectedTileIds[1])?.side)
  ) {
    return null;
  }
  const pairSides = new Map<string, Set<string>>();
  for (const tile of tiles) {
    const pairId = tile.pairId as string;
    const side = tile.side as string;
    const sides = pairSides.get(pairId) ?? new Set<string>();
    sides.add(side);
    pairSides.set(pairId, sides);
  }
  if ([...pairIdSet].some((id) => pairSides.get(id)?.size !== 2)) return null;
  return {
    pairs: pairs.map((pair) => ({
      id: pair.id as string,
      leftLabel: pair.leftLabel as string,
      rightLabel: pair.rightLabel as string,
    })) as WindDownMatchPair[],
    tiles: tiles.map((tile) => ({
      id: tile.id as string,
      pairId: tile.pairId as string,
      side: tile.side as "left" | "right",
      label: tile.label as string,
    })) as WindDownMatchTile[],
    selectedTileIds: [...selectedTileIds],
    matchedPairIds: [...matchedPairIds],
    wrongTileIds: [...wrongTileIds],
    isComplete: value.isComplete,
  };
}

function parseCommitInput(
  value: unknown,
  cardsByCycle: ReadonlyMap<string, WindDownReviewCard>,
  contentDigest: string,
): WindDownReviewCommitInput | null {
  if (!isRecord(value)) return null;
  if (!hasExactKeys(value, COMMIT_KEYS)) return null;
  const reviewCycleId = value.reviewCycleId;
  const materialId = value.materialId;
  const inputMode = value.inputMode;
  if (
    value.schemaVersion !== WINDDOWN_REVIEW_SCHEMA_VERSION ||
    value.activity !== "review" ||
    !boundedString(reviewCycleId, 220) ||
    !REVIEW_CYCLE_ID.test(reviewCycleId) ||
    !boundedString(materialId, 180) ||
    !SAFE_ID.test(materialId) ||
    value.contentDigest !== contentDigest ||
    (inputMode !== "chips" && inputMode !== "typed")
  ) {
    return null;
  }
  const card = cardsByCycle.get(reviewCycleId);
  const attempts = parseAttempts(value.attempts);
  return card && card.id === materialId && attempts && attempts.length > 0
    ? {
        schemaVersion: WINDDOWN_REVIEW_SCHEMA_VERSION,
        activity: "review",
        reviewCycleId,
        materialId,
        contentDigest,
        inputMode: inputMode as WindDownReviewInputMode,
        attempts,
      }
    : null;
}

function sameAttempts(
  left: readonly WindDownReviewAttempt[],
  right: readonly WindDownReviewAttempt[],
) {
  return (
    left.length === right.length &&
    left.every(
      (attempt, index) =>
        attempt.answer === right[index]?.answer &&
        attempt.revealedBefore === right[index]?.revealedBefore,
    )
  );
}

function validateMatchCards(
  match: WindDownLocalMatchState | null,
  cards: readonly WindDownReviewCard[],
) {
  if (!match) return true;
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  return match.pairs.every((pair) => {
    const card = cardsById.get(pair.id.slice("card:".length));
    return Boolean(card && card.en === pair.leftLabel && card.ko === pair.rightLabel);
  });
}

function parseDraft(value: unknown): WindDownReviewDraft | null {
  if (!isRecord(value) || !hasExactKeys(value, DRAFT_KEYS)) return null;
  if (
    value.schemaVersion !== WINDDOWN_REVIEW_DRAFT_SCHEMA_VERSION ||
    !boundedString(value.savedAtIso, 80) ||
    !Number.isFinite(Date.parse(value.savedAtIso)) ||
    typeof value.contentDigest !== "string" ||
    !SHA256_HEX.test(value.contentDigest)
  ) {
    return null;
  }
  const cards = parseCards(value.cards);
  const queue = parseCards(value.queue);
  if (!cards || !queue) return null;
  const cardsByCycle = new Map(cards.map((card) => [card.reviewCycleId, card]));
  const queueByCycle = new Map(queue.map((card) => [card.reviewCycleId, card]));
  if (
    [...queueByCycle.values()].some((card) => {
      const canonical = cardsByCycle.get(card.reviewCycleId);
      return !canonical || !sameCard(canonical, card);
    })
  ) {
    return null;
  }
  const resultsValue = value.results;
  if (!Array.isArray(resultsValue) || resultsValue.length > cards.length) return null;
  const results = resultsValue.map((result) => parseResult(result, cardsByCycle));
  if (!results.every((result): result is WindDownReviewDraftResult => Boolean(result))) {
    return null;
  }
  const committedValue = value.committedReviewCycleIds;
  if (
    !Array.isArray(committedValue) ||
    committedValue.length !== results.length ||
    !committedValue.every(
      (cycleId) => typeof cycleId === "string" && cardsByCycle.has(cycleId),
    ) ||
    new Set(committedValue).size !== committedValue.length ||
    !results.every((result) => committedValue.includes(result.reviewCycleId))
  ) {
    return null;
  }
  if (
    queue.some((card) =>
      (committedValue as unknown[]).includes(card.reviewCycleId),
    )
  ) {
    return null;
  }
  if (
    typeof value.phase !== "string" ||
    !REVIEW_PHASES.includes(value.phase as WindDownReviewPhase) ||
    (value.inputMode !== "chips" && value.inputMode !== "typed")
  ) {
    return null;
  }
  const attempts = parseAttempts(value.attempts);
  const match = parseMatch(value.match);
  const pendingAnswer = value.pendingAnswer;
  const answer = value.answer;
  const selectedChipIds = value.selectedChipIds;
  if (
    !attempts ||
    !(pendingAnswer === null || boundedString(pendingAnswer, MAX_ANSWER_LENGTH, true)) ||
    !boundedString(answer, MAX_ANSWER_LENGTH, true) ||
    !Array.isArray(selectedChipIds) ||
    selectedChipIds.length > 100 ||
    !selectedChipIds.every(
      (id) => typeof id === "string" && id.length <= 180 && SAFE_ID.test(id),
    ) ||
    new Set(selectedChipIds).size !== selectedChipIds.length
  ) {
    return null;
  }
  const commitInput =
    value.commitInput === null
      ? null
      : parseCommitInput(value.commitInput, cardsByCycle, value.contentDigest);
  if (value.commitInput !== null && !commitInput) return null;
  if (value.match !== null && !match) return null;
  const phase = value.phase as WindDownReviewPhase;
  const current = queue[0] ?? null;
  const gradingPhase =
    phase === "grading-first" ||
    phase === "grade-error-first" ||
    phase === "grading-retry" ||
    phase === "grade-error-retry";
  const matchCanRemain =
    phase === "match" ||
    phase === "retry" ||
    phase === "grading-retry" ||
    phase === "grade-error-retry" ||
    phase === "committing" ||
    phase === "commit-error";
  const retryMatchPhase =
    phase === "retry" ||
    phase === "grading-retry" ||
    phase === "grade-error-retry";
  if (
    (gradingPhase && !pendingAnswer) ||
    (!gradingPhase && pendingAnswer !== null) ||
    ((phase === "match" || phase === "retry") && !match) ||
    ((phase === "grading-retry" || phase === "grade-error-retry") && !match) ||
    (!matchCanRemain && match !== null) ||
    ((phase === "committing" || phase === "commit-error") && !commitInput) ||
    (phase !== "committing" && phase !== "commit-error" && commitInput !== null) ||
    (phase === "summary" && queue.length > 0) ||
    (phase === "recall" && attempts.length !== 0) ||
    ((phase === "grading-first" || phase === "grade-error-first") && attempts.length !== 0) ||
    ((phase === "match" || phase === "retry") && attempts.length !== 1) ||
    (phase === "summary" && attempts.length !== 0) ||
    (phase === "match" && Boolean(match?.isComplete)) ||
    (retryMatchPhase && !match?.isComplete) ||
    ((phase === "committing" || phase === "commit-error") &&
      Boolean(match) &&
      !match?.isComplete) ||
    (phase === "grade-error-retry" && attempts.length !== 1) ||
    (phase === "grading-retry" && attempts.length !== 1) ||
    (phase === "committing" && attempts.length === 0) ||
    (phase === "commit-error" && attempts.length === 0) ||
    (commitInput !== null &&
      (!current ||
        commitInput.reviewCycleId !== current.reviewCycleId ||
        !sameAttempts(commitInput.attempts, attempts) ||
        commitInput.inputMode !== value.inputMode)) ||
    !validateMatchCards(match, queue)
  ) {
    return null;
  }
  if (queue.length === 0 && phase !== "summary") return null;
  if (
    queue.length > 0 &&
    value.inputMode === "chips" &&
    selectedChipIds.some((id) => {
      const exercise = current ? createWindDownReviewChipExercise(current) : null;
      return !exercise?.canonicalChipIds.includes(id);
    })
  ) {
    return null;
  }
  if (queue.length === 0 && selectedChipIds.length > 0) return null;
  if (
    value.inputMode === "typed" && selectedChipIds.length > 0
  ) {
    return null;
  }
  return {
    schemaVersion: WINDDOWN_REVIEW_DRAFT_SCHEMA_VERSION,
    savedAtIso: value.savedAtIso,
    contentDigest: value.contentDigest,
    cards: cards.map(cloneCard),
    queue: queue.map(cloneCard),
    results: results.map(cloneResult),
    committedReviewCycleIds: [...committedValue] as string[],
    phase,
    inputMode: value.inputMode as WindDownReviewInputMode,
    attempts: attempts.map(cloneAttempt),
    pendingAnswer: pendingAnswer === null ? null : (pendingAnswer as string),
    match: cloneMatch(match),
    commitInput: cloneCommitInput(commitInput),
    answer: answer as string,
    selectedChipIds: [...selectedChipIds] as string[],
  };
}

function stale(
  raw: string,
  reason: WindDownReviewDraftRejectReason,
): WindDownReviewDraftLoadResult {
  return { status: "stale", raw, reason };
}

function reconcileDraft(args: {
  draft: WindDownReviewDraft;
  currentCards: readonly WindDownReviewCard[];
  contentDigest: string;
}):
  | {
      draft: WindDownReviewDraft;
      state: WindDownReviewState;
      answer: string;
      selectedChipIds: string[];
      reconciled: boolean;
    }
  | { reason: WindDownReviewDraftRejectReason } {
  const current = parseCards(args.currentCards);
  if (!current) return { reason: "current-queue-invalid" };
  const draftByCycle = new Map(args.draft.cards.map((card) => [card.reviewCycleId, card]));
  const draftByMaterial = new Map(args.draft.cards.map((card) => [card.id, card]));
  const currentByCycle = new Map(current.map((card) => [card.reviewCycleId, card]));
  const committed = new Set(args.draft.committedReviewCycleIds);
  const pendingCommit = args.draft.commitInput;
  const pendingCommitCard = pendingCommit
    ? draftByCycle.get(pendingCommit.reviewCycleId)
    : undefined;
  const canRetainPendingCommit = Boolean(
    pendingCommit &&
      pendingCommitCard &&
      (args.draft.phase === "committing" || args.draft.phase === "commit-error") &&
      pendingCommit.materialId === pendingCommitCard.id &&
      pendingCommit.contentDigest === args.contentDigest,
  );

  for (const card of current) {
    const originalByMaterial = draftByMaterial.get(card.id);
    if (
      originalByMaterial &&
      originalByMaterial.reviewCycleId !== card.reviewCycleId
    ) {
      return { reason: "review-cycle-mismatch" };
    }
    const originalByCycle = draftByCycle.get(card.reviewCycleId);
    if (originalByCycle && !sameCard(originalByCycle, card)) {
      return { reason: "canonical-card-mismatch" };
    }
  }

  for (const card of args.draft.queue) {
    if (committed.has(card.reviewCycleId)) return { reason: "state-invalid" };
    const currentCard = currentByCycle.get(card.reviewCycleId);
    if (
      !currentCard &&
      !(canRetainPendingCommit && card.reviewCycleId === pendingCommit?.reviewCycleId)
    ) {
      return { reason: "queue-cycle-missing" };
    }
    if (currentCard && !sameCard(card, currentCard)) {
      return { reason: "canonical-card-mismatch" };
    }
  }

  for (const card of args.draft.cards) {
    if (
      !currentByCycle.has(card.reviewCycleId) &&
      !committed.has(card.reviewCycleId) &&
      args.draft.queue.some((queued) => queued.reviewCycleId === card.reviewCycleId)
    ) {
      if (!(canRetainPendingCommit && card.reviewCycleId === pendingCommit?.reviewCycleId)) {
        return { reason: "queue-cycle-missing" };
      }
    }
  }

  const queue: WindDownReviewCard[] = [];
  for (const card of args.draft.queue) {
    const currentCard = currentByCycle.get(card.reviewCycleId);
    if (currentCard && !committed.has(card.reviewCycleId)) queue.push(cloneCard(currentCard));
    if (
      !currentCard &&
      !committed.has(card.reviewCycleId) &&
      canRetainPendingCommit &&
      card.reviewCycleId === pendingCommit?.reviewCycleId
    ) {
      queue.push(cloneCard(card));
    }
  }
  for (const card of current) {
    if (!committed.has(card.reviewCycleId) && !queue.some((queued) => queued.reviewCycleId === card.reviewCycleId)) {
      queue.push(cloneCard(card));
    }
  }

  const allCards = [...args.draft.cards.map(cloneCard)];
  for (const card of current) {
    if (!allCards.some((candidate) => candidate.reviewCycleId === card.reviewCycleId)) {
      allCards.push(cloneCard(card));
    }
  }
  const originalPhase = args.draft.phase;
  const restoredPhase =
    originalPhase === "grading-first"
      ? "grade-error-first"
      : originalPhase === "grading-retry"
        ? "grade-error-retry"
        : originalPhase === "committing"
          ? "commit-error"
          : queue.length > 0 && originalPhase === "summary"
            ? "recall"
            : originalPhase;
  const reconciled =
    queue.length !== args.draft.queue.length ||
    allCards.length !== args.draft.cards.length ||
    restoredPhase !== originalPhase;
  const state: WindDownReviewState = {
    contentDigest: args.contentDigest,
    queue,
    results: args.draft.results.map(cloneResult),
    phase: restoredPhase,
    inputMode: args.draft.inputMode,
    attempts: args.draft.attempts.map(cloneAttempt),
    pendingAnswer: args.draft.pendingAnswer,
    match: cloneMatch(args.draft.match),
    commitInput: cloneCommitInput(args.draft.commitInput),
  };
  return {
    draft: {
      ...args.draft,
      cards: allCards,
      queue: queue.map(cloneCard),
      phase: restoredPhase,
    },
    state,
    answer: args.draft.answer,
    selectedChipIds: [...args.draft.selectedChipIds],
    reconciled,
  };
}

export function createWindDownReviewDraft(args: {
  state: WindDownReviewState;
  cards: readonly WindDownReviewCard[];
  answer: string;
  selectedChipIds: readonly string[];
  savedAtIso?: string;
}): WindDownReviewDraft {
  const cards = args.cards.map(cloneCard);
  const cardsByMaterial = new Map(cards.map((card) => [card.id, card]));
  const results = args.state.results.map((result) => {
    const card = result.reviewCycleId
      ? cards.find((candidate) => candidate.reviewCycleId === result.reviewCycleId)
      : cardsByMaterial.get(result.materialId);
    if (!card || !result.reviewCycleId || card.reviewCycleId !== result.reviewCycleId) {
      throw new Error("winddown_review_draft_result_cycle_missing");
    }
    return {
      materialId: result.materialId,
      reviewCycleId: result.reviewCycleId,
      rating: result.rating,
      reward: result.reward,
    } satisfies WindDownReviewDraftResult;
  });
  const draft: WindDownReviewDraft = {
    schemaVersion: WINDDOWN_REVIEW_DRAFT_SCHEMA_VERSION,
    savedAtIso: args.savedAtIso ?? new Date().toISOString(),
    contentDigest: args.state.contentDigest,
    cards,
    queue: args.state.queue.map(cloneCard),
    results,
    committedReviewCycleIds: results.map((result) => result.reviewCycleId),
    phase: args.state.phase,
    inputMode: args.state.inputMode,
    attempts: args.state.attempts.map(cloneAttempt),
    pendingAnswer: args.state.pendingAnswer,
    match: cloneMatch(args.state.match),
    commitInput: cloneCommitInput(args.state.commitInput),
    answer: args.answer,
    selectedChipIds: [...args.selectedChipIds],
  };
  if (!parseDraft(draft)) throw new Error("winddown_review_draft_state_invalid");
  return draft;
}

export function saveWindDownReviewDraft(
  storage: WindDownReviewDraftStorage | null | undefined,
  draft: WindDownReviewDraft,
): WindDownReviewDraftWriteResult {
  if (!storage || typeof storage.setItem !== "function") {
    return { status: "unavailable", reason: "storage-unavailable" };
  }
  if (!parseDraft(draft)) {
    return { status: "unavailable", reason: "storage-write-failed" };
  }
  try {
    const serialized = JSON.stringify(draft);
    if (serialized.length > MAX_DRAFT_SERIALIZED_LENGTH) {
      return { status: "unavailable", reason: "storage-write-failed" };
    }
    storage.setItem(WINDDOWN_REVIEW_DRAFT_STORAGE_KEY, serialized);
    return { status: "saved" };
  } catch {
    return { status: "unavailable", reason: "storage-write-failed" };
  }
}

export function archiveWindDownReviewDraft(
  storage: WindDownReviewDraftStorage | null | undefined,
): WindDownReviewDraftRecoveryResult {
  if (
    !storage ||
    typeof storage.getItem !== "function" ||
    typeof storage.setItem !== "function" ||
    typeof storage.removeItem !== "function"
  ) {
    return { status: "unavailable", reason: "storage-unavailable" };
  }

  let raw: string | null;
  let existingRecovery: string | null;
  try {
    raw = storage.getItem(WINDDOWN_REVIEW_DRAFT_STORAGE_KEY);
    existingRecovery = storage.getItem(
      WINDDOWN_REVIEW_DRAFT_RECOVERY_STORAGE_KEY,
    );
  } catch {
    return { status: "unavailable", reason: "storage-read-failed" };
  }
  if (raw === null) return { status: "missing" };
  if (typeof raw !== "string" || raw.length > MAX_DRAFT_SERIALIZED_LENGTH) {
    return { status: "unavailable", reason: "raw-too-large" };
  }
  if (existingRecovery !== null && existingRecovery !== raw) {
    return { status: "unavailable", reason: "recovery-conflict" };
  }

  try {
    if (existingRecovery === null) {
      storage.setItem(WINDDOWN_REVIEW_DRAFT_RECOVERY_STORAGE_KEY, raw);
    }
  } catch {
    return { status: "unavailable", reason: "recovery-write-failed" };
  }

  let copiedRecovery: string | null;
  try {
    copiedRecovery = storage.getItem(WINDDOWN_REVIEW_DRAFT_RECOVERY_STORAGE_KEY);
  } catch {
    return { status: "unavailable", reason: "recovery-verify-failed" };
  }
  if (copiedRecovery !== raw) {
    return { status: "unavailable", reason: "recovery-verify-failed" };
  }

  try {
    storage.removeItem(WINDDOWN_REVIEW_DRAFT_STORAGE_KEY);
  } catch {
    return { status: "unavailable", reason: "active-clear-failed" };
  }
  try {
    if (storage.getItem(WINDDOWN_REVIEW_DRAFT_STORAGE_KEY) !== null) {
      return { status: "unavailable", reason: "active-clear-failed" };
    }
  } catch {
    return { status: "unavailable", reason: "active-clear-failed" };
  }
  return { status: "archived", raw };
}

export function loadWindDownReviewDraftRecovery(
  storage: WindDownReviewDraftStorage | null | undefined,
): WindDownReviewDraftRecoveryLoadResult {
  if (!storage || typeof storage.getItem !== "function") {
    return { status: "unavailable", reason: "storage-unavailable" };
  }
  let raw: string | null;
  try {
    raw = storage.getItem(WINDDOWN_REVIEW_DRAFT_RECOVERY_STORAGE_KEY);
  } catch {
    return { status: "unavailable", reason: "storage-read-failed" };
  }
  if (raw === null) return { status: "missing" };
  if (typeof raw !== "string" || raw.length > MAX_DRAFT_SERIALIZED_LENGTH) {
    return { status: "unavailable", reason: "recovery-too-large" };
  }
  return { status: "available", raw };
}

export function loadWindDownReviewDraft(args: {
  storage: WindDownReviewDraftStorage | null | undefined;
  cards: readonly WindDownReviewCard[];
  contentDigest: string;
  nowIso: string;
}): WindDownReviewDraftLoadResult {
  if (!args.storage || typeof args.storage.getItem !== "function") {
    return { status: "unavailable", reason: "storage-unavailable" };
  }
  let raw: string | null;
  try {
    raw = args.storage.getItem(WINDDOWN_REVIEW_DRAFT_STORAGE_KEY);
  } catch {
    return { status: "unavailable", reason: "storage-read-failed" };
  }
  if (raw === null) return { status: "missing" };
  if (typeof raw !== "string") {
    return { status: "malformed", raw: String(raw), reason: "invalid-shape" };
  }
  if (raw.length > MAX_DRAFT_SERIALIZED_LENGTH) {
    return { status: "malformed", raw, reason: "invalid-shape" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "malformed", raw, reason: "invalid-json" };
  }
  const draft = parseDraft(parsed);
  if (!draft) return { status: "malformed", raw, reason: "invalid-shape" };
  const nowMs = Date.parse(args.nowIso);
  const savedMs = Date.parse(draft.savedAtIso);
  if (!Number.isFinite(nowMs) || !Number.isFinite(savedMs) || !SHA256_HEX.test(args.contentDigest)) {
    return stale(raw, "invalid-context");
  }
  if (savedMs > nowMs) return stale(raw, "future-dated");
  if (nowMs - savedMs > WINDDOWN_REVIEW_DRAFT_MAX_AGE_MS) {
    return stale(raw, "expired");
  }
  if (draft.contentDigest !== args.contentDigest) {
    return stale(raw, "content-digest-mismatch");
  }
  const result = reconcileDraft({
    draft,
    currentCards: args.cards,
    contentDigest: args.contentDigest,
  });
  return "reason" in result ? stale(raw, result.reason) : { status: "resumed", ...result };
}
