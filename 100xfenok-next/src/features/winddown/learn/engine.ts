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
          value.acceptedVariants
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const expected = new Set(expectedKeys);
  const actual = Object.keys(value);
  return actual.length === expected.size && actual.every((key) => expected.has(key));
}

function normalizeStateCard(value: unknown): WindDownLearnCard | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string"
    || typeof value.ko !== "string"
    || typeof value.en !== "string"
    || (
      value.acceptedVariants !== undefined
      && (
        !Array.isArray(value.acceptedVariants)
        || !value.acceptedVariants.every((item) => typeof item === "string")
      )
    )
  ) return null;
  return normalizeCard(value as unknown as WindDownLearnCard);
}

function normalizeStateCards(
  cards: readonly WindDownLearnCard[],
): WindDownLearnCard[] | null {
  if (!Array.isArray(cards) || cards.length !== WINDDOWN_LEARN_CREDIT_TARGET) {
    return null;
  }
  const normalized = cards.map(normalizeStateCard);
  if (normalized.some((card) => !card)) return null;
  const result = normalized as WindDownLearnCard[];
  return new Set(result.map((card) => card.id)).size === result.length
    ? result
    : null;
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameCard(
  value: unknown,
  expected: WindDownLearnCard,
): boolean {
  if (!isRecord(value)) return false;
  const expectedKeys = expected.acceptedVariants
    ? ["id", "ko", "en", "acceptedVariants"]
    : ["id", "ko", "en"];
  if (!hasExactKeys(value, expectedKeys)) return false;
  return value.id === expected.id
    && value.ko === expected.ko
    && value.en === expected.en
    && (
      expected.acceptedVariants
        ? Array.isArray(value.acceptedVariants)
          && value.acceptedVariants.every((item): item is string => typeof item === "string")
          && sameStringArray(value.acceptedVariants, expected.acceptedVariants)
        : true
    );
}

function sameChoice(value: unknown, expected: WindDownLearnChoice): boolean {
  return isRecord(value)
    && hasExactKeys(value, ["id", "text"])
    && value.id === expected.id
    && value.text === expected.text;
}

function sameToken(value: unknown, expected: WindDownLearnToken): boolean {
  return isRecord(value)
    && hasExactKeys(value, ["id", "text"])
    && value.id === expected.id
    && value.text === expected.text;
}

function normalizeStateExercise(
  value: unknown,
  expected: WindDownLearnExercise,
): WindDownLearnExercise | null {
  if (!isRecord(value)) return null;
  if (value.kind !== expected.kind || value.creditPolicy !== "eligible") return null;
  if (!sameCard(value.card, expected.card)) return null;
  if (expected.kind === "meaning-choice") {
    if (
      !hasExactKeys(value, [
        "kind",
        "creditPolicy",
        "card",
        "choices",
        "correctChoiceId",
      ])
      || !Array.isArray(value.choices)
      || value.choices.length !== expected.choices.length
      || !value.choices.every((choice, index) =>
        sameChoice(choice, expected.choices[index]!),
      )
      || value.correctChoiceId !== expected.correctChoiceId
    ) return null;
    return expected;
  }
  if (
    !hasExactKeys(value, [
      "kind",
      "creditPolicy",
      "card",
      "tokens",
      "canonicalTokenIds",
    ])
    || !Array.isArray(value.tokens)
    || value.tokens.length !== expected.tokens.length
    || !value.tokens.every((token, index) =>
      sameToken(token, expected.tokens[index]!),
    )
    || !Array.isArray(value.canonicalTokenIds)
    || !value.canonicalTokenIds.every((tokenId): tokenId is string =>
      typeof tokenId === "string",
    )
    || !sameStringArray(value.canonicalTokenIds, expected.canonicalTokenIds)
  ) return null;
  return expected;
}

function normalizeStateQueueExercise(
  value: unknown,
  expected: WindDownLearnExercise,
  creditPolicy: WindDownLearnCreditPolicy,
): WindDownLearnExercise | null {
  if (!isRecord(value) || value.creditPolicy !== creditPolicy) return null;
  if (creditPolicy === "eligible") {
    return normalizeStateExercise(value, expected);
  }
  const practice = practiceOnly(expected);
  if (value.kind !== practice.kind || !sameCard(value.card, practice.card)) return null;
  if (practice.kind === "meaning-choice") {
    if (
      !hasExactKeys(value, [
        "kind",
        "creditPolicy",
        "card",
        "choices",
        "correctChoiceId",
      ])
      || !Array.isArray(value.choices)
      || value.choices.length !== practice.choices.length
      || !value.choices.every((choice, index) =>
        sameChoice(choice, practice.choices[index]!),
      )
      || value.correctChoiceId !== practice.correctChoiceId
    ) return null;
    return practice;
  }
  if (
    !hasExactKeys(value, [
      "kind",
      "creditPolicy",
      "card",
      "tokens",
      "canonicalTokenIds",
    ])
    || !Array.isArray(value.tokens)
    || value.tokens.length !== practice.tokens.length
    || !value.tokens.every((token, index) =>
      sameToken(token, practice.tokens[index]!),
    )
    || !Array.isArray(value.canonicalTokenIds)
    || !value.canonicalTokenIds.every((tokenId): tokenId is string =>
      typeof tokenId === "string",
    )
    || !sameStringArray(value.canonicalTokenIds, practice.canonicalTokenIds)
  ) return null;
  return practice;
}

function normalizeStateMistake(
  value: unknown,
  expectedByCardId: Record<string, WindDownLearnExercise>,
): WindDownLearnMistakeRecap | null {
  if (!isRecord(value) || !hasExactKeys(value, ["card", "exerciseKind"])) return null;
  if (value.exerciseKind !== "meaning-choice" && value.exerciseKind !== "sentence-builder") {
    return null;
  }
  const card = isRecord(value.card) && typeof value.card.id === "string"
    ? value.card.id
    : null;
  const expectedExercise = card ? expectedByCardId[card] : undefined;
  if (!expectedExercise || expectedExercise.kind !== value.exerciseKind) return null;
  if (!sameCard(value.card, expectedExercise.card)) return null;
  return { card: expectedExercise.card, exerciseKind: expectedExercise.kind };
}

/**
 * Validate and canonicalize a persisted Learn state against the current
 * five-card material set. The returned state contains only engine-generated
 * exercises, so callers can safely resume it without trusting raw JSON.
 */
export function normalizeWindDownLearnState(
  value: unknown,
  args: {
    cards: readonly WindDownLearnCard[];
    seed: string;
  },
): WindDownLearnState | null {
  if (!isRecord(value)) return null;
  const seed = typeof args.seed === "string" ? args.seed.trim() : "";
  const cards = normalizeStateCards(args.cards);
  if (!seed || !cards) return null;
  let expected: WindDownLearnState;
  try {
    expected = createWindDownLearnSession({ cards, seed });
  } catch {
    return null;
  }
  if (
    !hasExactKeys(value, [
      "schemaVersion",
      "seed",
      "targetActions",
      "queue",
      "exerciseByCardId",
      "creditedCardIds",
      "earnedRewards",
      "mistakes",
      "isComplete",
      "completion",
    ])
    || value.schemaVersion !== 1
    || value.seed !== seed
    || value.targetActions !== WINDDOWN_LEARN_CREDIT_TARGET
    || typeof value.earnedRewards !== "number"
    || !Number.isSafeInteger(value.earnedRewards)
    || value.earnedRewards < 0
    || value.earnedRewards > WINDDOWN_LEARN_CREDIT_TARGET
    || typeof value.isComplete !== "boolean"
    || !Array.isArray(value.creditedCardIds)
    || value.creditedCardIds.length > WINDDOWN_LEARN_CREDIT_TARGET
    || !value.creditedCardIds.every((cardId): cardId is string =>
      typeof cardId === "string",
    )
  ) return null;

  const expectedCardIds = Object.keys(expected.exerciseByCardId);
  const expectedCardIdSet = new Set(expectedCardIds);
  const creditedCardIds = value.creditedCardIds;
  if (
    new Set(creditedCardIds).size !== creditedCardIds.length
    || creditedCardIds.some((cardId) => !expectedCardIdSet.has(cardId))
    || value.earnedRewards !== creditedCardIds.length
  ) return null;
  const credited = new Set(creditedCardIds);

  if (!isRecord(value.exerciseByCardId)) return null;
  if (!hasExactKeys(value.exerciseByCardId, expectedCardIds)) return null;
  for (const cardId of expectedCardIds) {
    if (!normalizeStateExercise(value.exerciseByCardId[cardId], expected.exerciseByCardId[cardId]!)) {
      return null;
    }
  }

  if (!Array.isArray(value.queue) || value.queue.length > 10) return null;
  if (value.isComplete !== (creditedCardIds.length === WINDDOWN_LEARN_CREDIT_TARGET)) return null;
  if (value.isComplete ? value.queue.length !== 0 : value.queue.length === 0) return null;
  const normalizedQueue: WindDownLearnExercise[] = [];
  const queuedEligible = new Set<string>();
  const queuedPractice = new Set<string>();
  for (const rawExercise of value.queue) {
    if (!isRecord(rawExercise) || !isRecord(rawExercise.card) || typeof rawExercise.card.id !== "string") {
      return null;
    }
    const cardId = rawExercise.card.id;
    const expectedExercise = expected.exerciseByCardId[cardId];
    if (!expectedExercise) return null;
    const creditPolicy = rawExercise.creditPolicy;
    if (creditPolicy !== "eligible" && creditPolicy !== "practice-only") return null;
    const normalizedExercise = normalizeStateQueueExercise(
      rawExercise,
      expectedExercise,
      creditPolicy,
    );
    if (!normalizedExercise) return null;
    if (creditPolicy === "eligible") {
      if (credited.has(cardId) || queuedEligible.has(cardId)) return null;
      queuedEligible.add(cardId);
    } else {
      if (!credited.has(cardId) || queuedPractice.has(cardId)) return null;
      queuedPractice.add(cardId);
    }
    normalizedQueue.push(normalizedExercise);
  }
  for (const cardId of expectedCardIds) {
    if (!credited.has(cardId) && !queuedEligible.has(cardId)) return null;
    if (credited.has(cardId) && queuedEligible.has(cardId)) return null;
  }

  if (!Array.isArray(value.mistakes) || value.mistakes.length > WINDDOWN_LEARN_CREDIT_TARGET) return null;
  const normalizedMistakes: WindDownLearnMistakeRecap[] = [];
  const mistakeIds = new Set<string>();
  for (const rawMistake of value.mistakes) {
    const mistake = normalizeStateMistake(rawMistake, expected.exerciseByCardId);
    if (!mistake || mistakeIds.has(mistake.card.id)) return null;
    mistakeIds.add(mistake.card.id);
    normalizedMistakes.push(mistake);
  }

  let completion: WindDownLearnCompletion | null = null;
  if (value.isComplete) {
    if (!isRecord(value.completion) || !hasExactKeys(value.completion, ["creditedCardIds", "mistakeRecap"])) return null;
    if (
      !Array.isArray(value.completion.creditedCardIds)
      || !value.completion.creditedCardIds.every((cardId): cardId is string => typeof cardId === "string")
      || !sameStringArray(value.completion.creditedCardIds, creditedCardIds)
      || !Array.isArray(value.completion.mistakeRecap)
      || value.completion.mistakeRecap.length !== normalizedMistakes.length
    ) return null;
    const normalizedCompletionMistakes: WindDownLearnMistakeRecap[] = [];
    for (const rawMistake of value.completion.mistakeRecap) {
      const mistake = normalizeStateMistake(rawMistake, expected.exerciseByCardId);
      if (!mistake || !mistakeIds.has(mistake.card.id)) return null;
      normalizedCompletionMistakes.push(mistake);
    }
    if (
      !normalizedCompletionMistakes.every((mistake, index) => {
        const expectedMistake = normalizedMistakes[index];
        return expectedMistake?.card.id === mistake.card.id
          && expectedMistake.exerciseKind === mistake.exerciseKind;
      })
    ) return null;
    completion = {
      creditedCardIds: [...creditedCardIds],
      mistakeRecap: normalizedCompletionMistakes,
    };
  } else if (value.completion !== null) {
    return null;
  }

  return {
    schemaVersion: 1,
    seed,
    targetActions: WINDDOWN_LEARN_CREDIT_TARGET,
    queue: normalizedQueue,
    exerciseByCardId: Object.fromEntries(
      expectedCardIds.map((cardId) => [cardId, expected.exerciseByCardId[cardId]]),
    ),
    creditedCardIds: [...creditedCardIds],
    earnedRewards: value.earnedRewards,
    mistakes: normalizedMistakes,
    isComplete: value.isComplete,
    completion,
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
