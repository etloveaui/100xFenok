export const WINDDOWN_LEARN_CREDIT_TARGET = 5 as const;

const MAX_SENTENCE_BUILDER_TOKENS = 10;

export type WindDownLearnCard = {
  id: string;
  ko: string;
  en: string;
  acceptedVariants?: string[];
};

export type WindDownLearnChoice = {
  id: string;
  text: string;
};

export type WindDownLearnToken = {
  id: string;
  text: string;
};

export type WindDownLearnCreditPolicy = "eligible" | "practice-only";

export type WindDownMeaningChoiceExercise = {
  kind: "meaning-choice";
  creditPolicy: WindDownLearnCreditPolicy;
  card: WindDownLearnCard;
  choices: WindDownLearnChoice[];
  correctChoiceId: string;
};

export type WindDownSentenceBuilderExercise = {
  kind: "sentence-builder";
  creditPolicy: WindDownLearnCreditPolicy;
  card: WindDownLearnCard;
  tokens: WindDownLearnToken[];
  canonicalTokenIds: string[];
};

export type WindDownLearnExercise =
  WindDownMeaningChoiceExercise | WindDownSentenceBuilderExercise;

export type WindDownLearnMistakeRecap = {
  card: WindDownLearnCard;
  exerciseKind: WindDownLearnExercise["kind"];
};

export type WindDownLearnCompletion = {
  creditedCardIds: string[];
  mistakeRecap: WindDownLearnMistakeRecap[];
};

export type WindDownLearnState = {
  schemaVersion: 1;
  seed: string;
  targetActions: typeof WINDDOWN_LEARN_CREDIT_TARGET;
  queue: WindDownLearnExercise[];
  exerciseByCardId: Record<string, WindDownLearnExercise>;
  creditedCardIds: string[];
  earnedRewards: number;
  mistakes: WindDownLearnMistakeRecap[];
  isComplete: boolean;
  completion: WindDownLearnCompletion | null;
};

export type WindDownLearnAction =
  | {
      type: "choose-meaning";
      cardId: string;
      choiceId: string;
    }
  | {
      type: "submit-sentence";
      cardId: string;
      tokenIds: string[];
    };

export type WindDownLearnActionResult = {
  state: WindDownLearnState;
  outcome: "invalid" | "miss" | "practice" | "correct" | "complete";
  reward: 0 | 1;
};

function normalizeCard(value: WindDownLearnCard): WindDownLearnCard | null {
  const id = value.id.trim();
  const ko = value.ko.trim();
  const en = value.en.trim();
  if (!id || !ko || !en) return null;
  const acceptedVariants = Array.isArray(value.acceptedVariants)
    ? [
        ...new Set(
          value.acceptedVariants.map((item) => item.trim()).filter(Boolean),
        ),
      ]
    : [];
  return {
    id,
    ko,
    en,
    ...(acceptedVariants.length > 0 ? { acceptedVariants } : {}),
  };
}

function normalizedCards(
  cards: readonly WindDownLearnCard[],
): WindDownLearnCard[] {
  const byId = new Map<string, WindDownLearnCard>();
  for (const card of cards) {
    const normalized = normalizeCard(card);
    if (!normalized || byId.has(normalized.id)) continue;
    byId.set(normalized.id, normalized);
  }
  return [...byId.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

function stableRank(seed: string, key: string): number {
  let hash = 2166136261;
  for (const character of `${seed}:${key}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableShuffle<T>(
  values: readonly T[],
  seed: string,
  key: (value: T) => string,
): T[] {
  return [...values].sort(
    (left, right) =>
      stableRank(seed, key(left)) - stableRank(seed, key(right)) ||
      key(left).localeCompare(key(right)),
  );
}

function sentenceTokens(text: string): string[] {
  return text.match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*|[^\sA-Za-z0-9]/g) ?? [];
}

function sameSequence(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function hasExactTokenSet(
  tokenIds: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    tokenIds.length === expected.length &&
    new Set(tokenIds).size === tokenIds.length &&
    tokenIds.every((tokenId) => expected.includes(tokenId))
  );
}

function normalizeMeaningText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function isWindDownSentenceBuilderEligible(
  card: WindDownLearnCard,
): boolean {
  const count = sentenceTokens(card.en).length;
  return count >= 2 && count <= MAX_SENTENCE_BUILDER_TOKENS;
}

export function createWindDownSentenceBuilderExercise(
  card: WindDownLearnCard,
  seed: string,
): WindDownSentenceBuilderExercise {
  const normalized = normalizeCard(card);
  if (!normalized || !isWindDownSentenceBuilderEligible(normalized)) {
    throw new Error("winddown_learn_sentence_builder_card_invalid");
  }
  const canonical = sentenceTokens(normalized.en).map((text, index) => ({
    id: `winddown-builder:${normalized.id}:${index}`,
    text,
  }));
  return {
    kind: "sentence-builder",
    creditPolicy: "eligible",
    card: normalized,
    tokens: stableShuffle(
      canonical,
      `${seed}:builder:${normalized.id}`,
      (token) => token.id,
    ),
    canonicalTokenIds: canonical.map((token) => token.id),
  };
}

export function createWindDownMeaningChoiceExercise(
  card: WindDownLearnCard,
  cards: readonly WindDownLearnCard[],
  seed: string,
): WindDownMeaningChoiceExercise {
  const normalized = normalizeCard(card);
  if (!normalized) throw new Error("winddown_learn_meaning_card_invalid");
  const uniqueDistractors = new Map<string, WindDownLearnCard>();
  for (const candidate of normalizedCards(cards)) {
    if (candidate.id === normalized.id) continue;
    const meaning = normalizeMeaningText(candidate.ko);
    if (!meaning || meaning === normalizeMeaningText(normalized.ko)) continue;
    if (!uniqueDistractors.has(meaning))
      uniqueDistractors.set(meaning, candidate);
  }
  const choices: WindDownLearnChoice[] = [
    { id: `winddown-meaning:${normalized.id}:correct`, text: normalized.ko },
    ...stableShuffle(
      [...uniqueDistractors.values()],
      `${seed}:meaning:${normalized.id}`,
      (candidate) => candidate.id,
    )
      .slice(0, 3)
      .map((candidate) => ({
        id: `winddown-meaning:${normalized.id}:distractor:${candidate.id}`,
        text: candidate.ko,
      })),
  ];
  return {
    kind: "meaning-choice",
    creditPolicy: "eligible",
    card: normalized,
    choices: stableShuffle(
      choices,
      `${seed}:meaning:${normalized.id}:choices`,
      (choice) => choice.id,
    ),
    correctChoiceId: `winddown-meaning:${normalized.id}:correct`,
  };
}

function exerciseQueue(
  cards: WindDownLearnCard[],
  seed: string,
): WindDownLearnExercise[] {
  const selected = stableShuffle(
    cards,
    `${seed}:cards`,
    (card) => card.id,
  ).slice(0, WINDDOWN_LEARN_CREDIT_TARGET);
  if (selected.length !== WINDDOWN_LEARN_CREDIT_TARGET) {
    throw new Error("winddown_learn_requires_five_unique_cards");
  }
  const builderIds = new Set(
    stableShuffle(
      selected.filter(isWindDownSentenceBuilderEligible),
      `${seed}:builder-cards`,
      (card) => card.id,
    )
      .slice(0, 2)
      .map((card) => card.id),
  );
  return selected.map((card) =>
    builderIds.has(card.id)
      ? createWindDownSentenceBuilderExercise(card, seed)
      : createWindDownMeaningChoiceExercise(card, selected, seed),
  );
}

export function createWindDownLearnSession(args: {
  cards: readonly WindDownLearnCard[];
  seed: string;
}): WindDownLearnState {
  const seed = args.seed.trim() || "winddown-learn";
  const queue = exerciseQueue(normalizedCards(args.cards), seed);
  return {
    schemaVersion: 1,
    seed,
    targetActions: WINDDOWN_LEARN_CREDIT_TARGET,
    queue,
    exerciseByCardId: Object.fromEntries(
      queue.map((exercise) => [exercise.card.id, exercise]),
    ),
    creditedCardIds: [],
    earnedRewards: 0,
    mistakes: [],
    isComplete: false,
    completion: null,
  };
}

function invalid(state: WindDownLearnState): WindDownLearnActionResult {
  return { state, outcome: "invalid", reward: 0 };
}

function actionVerdict(
  exercise: WindDownLearnExercise,
  action: WindDownLearnAction,
): "invalid" | "correct" | "miss" {
  if (action.cardId !== exercise.card.id) return "invalid";
  if (exercise.kind === "meaning-choice") {
    if (action.type !== "choose-meaning") return "invalid";
    if (!exercise.choices.some((choice) => choice.id === action.choiceId)) {
      return "invalid";
    }
    return action.choiceId === exercise.correctChoiceId ? "correct" : "miss";
  }
  if (action.type !== "submit-sentence") return "invalid";
  if (!hasExactTokenSet(action.tokenIds, exercise.canonicalTokenIds)) {
    return "invalid";
  }
  return sameSequence(action.tokenIds, exercise.canonicalTokenIds)
    ? "correct"
    : "miss";
}

function appendMistake(
  mistakes: WindDownLearnMistakeRecap[],
  exercise: WindDownLearnExercise,
): WindDownLearnMistakeRecap[] {
  if (mistakes.some((recap) => recap.card.id === exercise.card.id)) {
    return mistakes;
  }
  return [...mistakes, { card: exercise.card, exerciseKind: exercise.kind }];
}

function practiceOnly(exercise: WindDownLearnExercise): WindDownLearnExercise {
  if (exercise.kind === "meaning-choice") {
    return {
      ...exercise,
      creditPolicy: "practice-only",
      card: { ...exercise.card },
      choices: exercise.choices.map((choice) => ({ ...choice })),
    };
  }
  return {
    ...exercise,
    creditPolicy: "practice-only",
    card: { ...exercise.card },
    tokens: exercise.tokens.map((token) => ({ ...token })),
    canonicalTokenIds: [...exercise.canonicalTokenIds],
  };
}

function finalMissInterlude(
  state: WindDownLearnState,
  missedExercise: WindDownLearnExercise,
): WindDownLearnExercise {
  const creditedId = stableShuffle(
    state.creditedCardIds,
    `${state.seed}:practice:${missedExercise.card.id}`,
    (cardId) => cardId,
  )[0];
  const creditedExercise = creditedId
    ? state.exerciseByCardId[creditedId]
    : undefined;
  if (!creditedExercise) {
    throw new Error("winddown_learn_practice_interlude_missing");
  }
  return practiceOnly(creditedExercise);
}

export function applyWindDownLearnAction(
  state: WindDownLearnState,
  action: WindDownLearnAction,
): WindDownLearnActionResult {
  const current = state.queue[0];
  if (
    !current ||
    state.isComplete ||
    (current.creditPolicy === "eligible" &&
      state.creditedCardIds.includes(action.cardId))
  ) {
    return invalid(state);
  }
  const verdict = actionVerdict(current, action);
  if (verdict === "invalid") return invalid(state);
  const remaining = state.queue.slice(1);
  if (current.creditPolicy === "practice-only") {
    if (verdict === "miss") {
      return {
        state: {
          ...state,
          queue: remaining.length > 0 ? [...remaining, current] : [current],
        },
        outcome: "miss",
        reward: 0,
      };
    }
    return {
      state: {
        ...state,
        queue: remaining,
      },
      outcome: "practice",
      reward: 0,
    };
  }
  if (verdict === "miss") {
    return {
      state: {
        ...state,
        queue:
          remaining.length > 0
            ? [...remaining, current]
            : [finalMissInterlude(state, current), current],
        mistakes: appendMistake(state.mistakes, current),
      },
      outcome: "miss",
      reward: 0,
    };
  }

  const creditedCardIds = [...state.creditedCardIds, current.card.id];
  const isComplete = creditedCardIds.length === state.targetActions;
  const completion = isComplete
    ? {
        creditedCardIds,
        mistakeRecap: state.mistakes,
      }
    : null;
  return {
    state: {
      ...state,
      queue: isComplete ? [] : remaining,
      creditedCardIds,
      earnedRewards: state.earnedRewards + 1,
      isComplete,
      completion,
    },
    outcome: isComplete ? "complete" : "correct",
    reward: 1,
  };
}
