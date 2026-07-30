export const WINDDOWN_REVIEW_SCHEMA_VERSION = 1 as const;

export type WindDownReviewCard = {
  id: string;
  ko: string;
  en: string;
  acceptedVariants?: string[];
  reviewCycleId: string;
  dueAtIso: string;
};

export type WindDownReviewAttempt = {
  answer: string;
  revealedBefore: boolean;
};

export type WindDownReviewCommitInput = {
  schemaVersion: typeof WINDDOWN_REVIEW_SCHEMA_VERSION;
  activity: "review";
  reviewCycleId: string;
  materialId: string;
  contentDigest: string;
  attempts: WindDownReviewAttempt[];
};

export type WindDownReviewResult = {
  materialId: string;
  rating: "good" | "hard" | "again";
  reward: 0 | 1;
};

export type WindDownMatchPair = {
  id: string;
  leftLabel: string;
  rightLabel: string;
};

export type WindDownMatchTile = {
  id: string;
  pairId: string;
  side: "left" | "right";
  label: string;
};

export type WindDownLocalMatchState = {
  pairs: WindDownMatchPair[];
  tiles: WindDownMatchTile[];
  selectedTileIds: string[];
  matchedPairIds: string[];
  wrongTileIds: string[];
  isComplete: boolean;
};

export type WindDownLocalMatchAction = {
  type: "select-tile";
  tileId: string;
};

export type WindDownLocalMatchActionResult = {
  state: WindDownLocalMatchState;
  outcome: "invalid" | "selected" | "wrong-pair" | "matched" | "complete";
};

export type WindDownReviewPhase =
  | "recall"
  | "grading-first"
  | "grade-error-first"
  | "match"
  | "retry"
  | "grading-retry"
  | "grade-error-retry"
  | "committing"
  | "commit-error"
  | "summary";

export type WindDownReviewState = {
  contentDigest: string;
  queue: WindDownReviewCard[];
  results: WindDownReviewResult[];
  phase: WindDownReviewPhase;
  attempts: WindDownReviewAttempt[];
  pendingAnswer: string | null;
  match: WindDownLocalMatchState | null;
  commitInput: WindDownReviewCommitInput | null;
};

export type WindDownReviewAction =
  | { type: "submit-first"; answer: string }
  | { type: "retry-first-grade" }
  | { type: "first-graded"; exact: boolean }
  | { type: "first-grade-failed" }
  | { type: "reveal" }
  | { type: "select-match-tile"; tileId: string }
  | { type: "submit-retry"; answer: string }
  | { type: "retry-retry-grade" }
  | { type: "retry-graded"; exact: boolean }
  | { type: "retry-grade-failed" }
  | { type: "retry-commit" }
  | { type: "commit-failed" }
  | { type: "commit-succeeded"; result: WindDownReviewResult };

export type WindDownReviewActionResult = {
  state: WindDownReviewState;
  outcome:
    | "invalid"
    | "grading"
    | "match"
    | "retry"
    | "committing"
    | "commit-failed"
    | "advanced"
    | "summary";
};

function stableRank(seed: string, value: string) {
  let hash = 2166136261;
  for (const character of `${seed}:${value}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function uniqueCards(cards: readonly WindDownReviewCard[]) {
  const known = new Set<string>();
  return cards.filter((card) => {
    if (!card.id || known.has(card.id)) return false;
    known.add(card.id);
    return Boolean(card.ko.trim() && card.en.trim() && card.reviewCycleId);
  });
}

function wordEdges(value: string) {
  const words = value.trim().match(/[A-Za-z0-9']+/g) ?? [];
  return {
    first: words[0] ?? value.trim(),
    last: words.at(-1) ?? value.trim(),
  };
}

function fallbackRepairPairs(card: WindDownReviewCard): WindDownMatchPair[] {
  const edges = wordEdges(card.en);
  return [
    {
      id: `card:${card.id}`,
      leftLabel: card.en,
      rightLabel: card.ko,
    },
    {
      id: "opening",
      leftLabel: edges.first,
      rightLabel: "첫 단어",
    },
    {
      id: "closing",
      leftLabel: edges.last,
      rightLabel: "마지막 단어",
    },
  ];
}

function repairPairs(args: {
  card: WindDownReviewCard;
  cards: readonly WindDownReviewCard[];
  seed: string;
}): WindDownMatchPair[] {
  const target =
    uniqueCards(args.cards).find((card) => card.id === args.card.id) ?? args.card;
  const distractors = uniqueCards(args.cards)
    .filter((card) => card.id !== target.id)
    .sort(
      (left, right) =>
        stableRank(args.seed, left.id) - stableRank(args.seed, right.id) ||
        left.id.localeCompare(right.id),
    );
  const sentencePairs = [target, ...distractors].slice(0, 3).map((card) => ({
    id: `card:${card.id}`,
    leftLabel: card.en,
    rightLabel: card.ko,
  }));
  if (sentencePairs.length === 3) return sentencePairs;

  const fallback = fallbackRepairPairs(target);
  return [
    ...sentencePairs,
    ...fallback.filter(
      (pair) => !sentencePairs.some((candidate) => candidate.id === pair.id),
    ),
  ].slice(0, 3);
}

function shuffledTiles(pairs: WindDownMatchPair[], seed: string) {
  return pairs
    .flatMap((pair) => [
      {
        id: `${pair.id}:left`,
        pairId: pair.id,
        side: "left" as const,
        label: pair.leftLabel,
      },
      {
        id: `${pair.id}:right`,
        pairId: pair.id,
        side: "right" as const,
        label: pair.rightLabel,
      },
    ])
    .sort(
      (left, right) =>
        stableRank(seed, left.id) - stableRank(seed, right.id) ||
        left.id.localeCompare(right.id),
    );
}

export function createWindDownLocalMatch(args: {
  card: WindDownReviewCard;
  cards: readonly WindDownReviewCard[];
  seed: string;
}): WindDownLocalMatchState {
  const cards = uniqueCards(args.cards);
  const target = cards.find((card) => card.id === args.card.id) ?? args.card;
  const pairs = repairPairs({
    card: target,
    cards,
    seed: args.seed,
  });
  return {
    pairs,
    tiles: shuffledTiles(pairs, args.seed),
    selectedTileIds: [],
    matchedPairIds: [],
    wrongTileIds: [],
    isComplete: false,
  };
}

export function applyWindDownLocalMatchAction(
  state: WindDownLocalMatchState,
  action: WindDownLocalMatchAction,
): WindDownLocalMatchActionResult {
  if (state.isComplete || action.type !== "select-tile") {
    return { state, outcome: "invalid" };
  }
  const tile = state.tiles.find((candidate) => candidate.id === action.tileId);
  if (
    !tile ||
    state.selectedTileIds.includes(tile.id) ||
    state.matchedPairIds.includes(tile.pairId)
  ) {
    return { state, outcome: "invalid" };
  }
  const selectedTileIds = [...state.selectedTileIds, tile.id];
  if (selectedTileIds.length === 1) {
    return {
      state: { ...state, selectedTileIds, wrongTileIds: [] },
      outcome: "selected",
    };
  }
  const [firstId, secondId] = selectedTileIds;
  const first = state.tiles.find((candidate) => candidate.id === firstId);
  const second = state.tiles.find((candidate) => candidate.id === secondId);
  if (!first || !second || first.side === second.side) {
    return {
      state: { ...state, selectedTileIds: [], wrongTileIds: selectedTileIds },
      outcome: "wrong-pair",
    };
  }
  if (first.pairId !== second.pairId) {
    return {
      state: { ...state, selectedTileIds: [], wrongTileIds: selectedTileIds },
      outcome: "wrong-pair",
    };
  }
  const matchedPairIds = [...state.matchedPairIds, first.pairId];
  const isComplete = matchedPairIds.length === state.pairs.length;
  return {
    state: {
      ...state,
      selectedTileIds: [],
      wrongTileIds: [],
      matchedPairIds,
      isComplete,
    },
    outcome: isComplete ? "complete" : "matched",
  };
}

function currentCard(state: WindDownReviewState) {
  return state.queue[0] ?? null;
}

function cleanAnswer(value: string) {
  return value.trim().slice(0, 240);
}

function buildCommitInput(
  card: WindDownReviewCard,
  contentDigest: string,
  attempts: WindDownReviewAttempt[],
): WindDownReviewCommitInput {
  return {
    schemaVersion: WINDDOWN_REVIEW_SCHEMA_VERSION,
    activity: "review",
    reviewCycleId: card.reviewCycleId,
    materialId: card.id,
    contentDigest,
    attempts,
  };
}

function invalid(state: WindDownReviewState): WindDownReviewActionResult {
  return { state, outcome: "invalid" };
}

export function createWindDownReviewSession(args: {
  cards: readonly WindDownReviewCard[];
  contentDigest: string;
}): WindDownReviewState {
  const queue = uniqueCards(args.cards);
  return {
    contentDigest: args.contentDigest,
    queue,
    results: [],
    phase: queue.length > 0 ? "recall" : "summary",
    attempts: [],
    pendingAnswer: null,
    match: null,
    commitInput: null,
  };
}

export function applyWindDownReviewAction(
  state: WindDownReviewState,
  action: WindDownReviewAction,
): WindDownReviewActionResult {
  const card = currentCard(state);
  if (!card) return invalid(state);

  if (action.type === "submit-first") {
    const answer = cleanAnswer(action.answer);
    if (state.phase !== "recall" || !answer) return invalid(state);
    return {
      state: { ...state, phase: "grading-first", pendingAnswer: answer },
      outcome: "grading",
    };
  }

  if (action.type === "retry-first-grade") {
    if (state.phase !== "grade-error-first" || !state.pendingAnswer) {
      return invalid(state);
    }
    return {
      state: { ...state, phase: "grading-first" },
      outcome: "grading",
    };
  }

  if (action.type === "first-grade-failed") {
    if (state.phase !== "grading-first" || !state.pendingAnswer) {
      return invalid(state);
    }
    return {
      state: { ...state, phase: "grade-error-first" },
      outcome: "invalid",
    };
  }

  if (action.type === "first-graded") {
    if (state.phase !== "grading-first" || !state.pendingAnswer) {
      return invalid(state);
    }
    const attempts = [
      ...state.attempts,
      { answer: state.pendingAnswer, revealedBefore: false },
    ];
    if (action.exact) {
      return {
        state: {
          ...state,
          phase: "committing",
          attempts,
          pendingAnswer: null,
          commitInput: buildCommitInput(card, state.contentDigest, attempts),
        },
        outcome: "committing",
      };
    }
    return {
      state: {
        ...state,
        phase: "match",
        attempts,
        pendingAnswer: null,
        match: createWindDownLocalMatch({
          card,
          cards: state.queue,
          seed: card.reviewCycleId,
        }),
      },
      outcome: "match",
    };
  }

  if (action.type === "reveal") {
    if (state.phase !== "recall") return invalid(state);
    const attempts = [{ answer: "", revealedBefore: true }];
    return {
      state: {
        ...state,
        phase: "committing",
        attempts,
        commitInput: buildCommitInput(card, state.contentDigest, attempts),
      },
      outcome: "committing",
    };
  }

  if (action.type === "select-match-tile") {
    if (state.phase !== "match" || !state.match) return invalid(state);
    const matchResult = applyWindDownLocalMatchAction(state.match, {
      type: "select-tile",
      tileId: action.tileId,
    });
    if (matchResult.outcome === "invalid") return invalid(state);
    if (matchResult.outcome === "complete") {
      return {
        state: { ...state, phase: "retry", match: matchResult.state },
        outcome: "retry",
      };
    }
    return {
      state: { ...state, match: matchResult.state },
      outcome: "match",
    };
  }

  if (action.type === "submit-retry") {
    const answer = cleanAnswer(action.answer);
    if (state.phase !== "retry" || !answer || state.attempts.length !== 1) {
      return invalid(state);
    }
    return {
      state: { ...state, phase: "grading-retry", pendingAnswer: answer },
      outcome: "grading",
    };
  }

  if (action.type === "retry-retry-grade") {
    if (state.phase !== "grade-error-retry" || !state.pendingAnswer) {
      return invalid(state);
    }
    return {
      state: { ...state, phase: "grading-retry" },
      outcome: "grading",
    };
  }

  if (action.type === "retry-grade-failed") {
    if (state.phase !== "grading-retry" || !state.pendingAnswer) {
      return invalid(state);
    }
    return {
      state: { ...state, phase: "grade-error-retry" },
      outcome: "invalid",
    };
  }

  if (action.type === "retry-graded") {
    if (
      state.phase !== "grading-retry" ||
      !state.pendingAnswer ||
      state.attempts.length !== 1
    ) {
      return invalid(state);
    }
    const attempts = [
      ...state.attempts,
      { answer: state.pendingAnswer, revealedBefore: false },
    ];
    return {
      state: {
        ...state,
        phase: "committing",
        attempts,
        pendingAnswer: null,
        commitInput: buildCommitInput(card, state.contentDigest, attempts),
      },
      outcome: "committing",
    };
  }

  if (action.type === "commit-failed") {
    if (state.phase !== "committing" || !state.commitInput) return invalid(state);
    return {
      state: { ...state, phase: "commit-error" },
      outcome: "commit-failed",
    };
  }

  if (action.type === "retry-commit") {
    if (state.phase !== "commit-error" || !state.commitInput) return invalid(state);
    return {
      state: { ...state, phase: "committing" },
      outcome: "committing",
    };
  }

  if (action.type === "commit-succeeded") {
    if (state.phase !== "committing" || !state.commitInput) return invalid(state);
    const queue = state.queue.slice(1);
    const results = [...state.results, action.result];
    return {
      state: {
        ...state,
        queue,
        results,
        phase: queue.length > 0 ? "recall" : "summary",
        attempts: [],
        pendingAnswer: null,
        match: null,
        commitInput: null,
      },
      outcome: queue.length > 0 ? "advanced" : "summary",
    };
  }

  return invalid(state);
}
