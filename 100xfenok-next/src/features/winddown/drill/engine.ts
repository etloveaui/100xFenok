export const WINDDOWN_DRILL_ROUND_TARGET = 5 as const;

export type WindDownDrillCard = {
  id: string;
  en: string;
  ko: string;
};

export type WindDownDrillChoice = {
  id: string;
  text: string;
};

export type WindDownDrillRound = {
  id: string;
  prompt: string;
  answer: string;
  choices: WindDownDrillChoice[];
  correctChoiceId: string;
};

export type WindDownDrillResult = {
  roundId: string;
  choiceId: string;
  correct: boolean;
  points: number;
  combo: number;
};

export type WindDownDrillFeedback = WindDownDrillResult & {
  answer: string;
};

export type WindDownDrillState = {
  schemaVersion: 1;
  seed: string;
  phase: "prompt" | "feedback" | "complete";
  rounds: WindDownDrillRound[];
  roundIndex: number;
  score: number;
  combo: number;
  maxCombo: number;
  correctCount: number;
  results: WindDownDrillResult[];
  feedback: WindDownDrillFeedback | null;
};

export type WindDownDrillAction =
  | { type: "answer"; roundId: string; choiceId: string }
  | { type: "continue" };

function normalizedCards(cards: readonly WindDownDrillCard[]) {
  const unique = new Map<string, WindDownDrillCard>();
  for (const card of cards) {
    const id = card.id.trim();
    const en = card.en.trim().replace(/\s+/g, " ");
    const ko = card.ko.trim().replace(/\s+/g, " ");
    if (!id || !en || !ko || unique.has(id)) continue;
    unique.set(id, { id, en, ko });
  }
  return [...unique.values()];
}

function hash(value: string) {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return result >>> 0;
}

function stableShuffle<T>(
  values: readonly T[],
  seed: string,
  key: (value: T) => string,
) {
  return [...values].sort((left, right) => {
    const leftKey = key(left);
    const rightKey = key(right);
    return hash(`${seed}:${leftKey}`) - hash(`${seed}:${rightKey}`)
      || leftKey.localeCompare(rightKey);
  });
}

function buildRounds(cards: WindDownDrillCard[], seed: string) {
  const ordered = stableShuffle(cards, `${seed}:cards`, (card) => card.id);
  return Array.from({ length: WINDDOWN_DRILL_ROUND_TARGET }, (_, index) => {
    const card = ordered[index % ordered.length]!;
    const distractorByMeaning = new Map<string, WindDownDrillCard>();
    for (const candidate of [...cards].sort((left, right) => left.id.localeCompare(right.id))) {
      if (candidate.ko !== card.ko && !distractorByMeaning.has(candidate.ko)) {
        distractorByMeaning.set(candidate.ko, candidate);
      }
    }
    const distractors = stableShuffle(
      [...distractorByMeaning.values()],
      `${seed}:round:${index}:distractors`,
      (candidate) => candidate.id,
    ).slice(0, 2);
    const choices = stableShuffle(
      [card, ...distractors],
      `${seed}:round:${index}:choices`,
      (candidate) => candidate.id,
    ).map((candidate) => ({ id: candidate.id, text: candidate.ko }));
    return {
      id: `winddown-drill:${index + 1}:${card.id}`,
      prompt: card.en,
      answer: card.ko,
      choices,
      correctChoiceId: card.id,
    } satisfies WindDownDrillRound;
  });
}

export function createWindDownDrillSession(args: {
  cards: readonly WindDownDrillCard[];
  seed: string;
}): WindDownDrillState {
  const cards = normalizedCards(args.cards);
  if (cards.length < 3) {
    throw new Error("winddown_drill_requires_three_unique_cards");
  }
  if (new Set(cards.map((card) => card.ko)).size < 3) {
    throw new Error("winddown_drill_requires_three_distinct_meanings");
  }
  const seed = args.seed.trim() || "winddown-drill";
  return {
    schemaVersion: 1,
    seed,
    phase: "prompt",
    rounds: buildRounds(cards, seed),
    roundIndex: 0,
    score: 0,
    combo: 0,
    maxCombo: 0,
    correctCount: 0,
    results: [],
    feedback: null,
  };
}

export function replayWindDownDrillSession(
  state: WindDownDrillState,
): WindDownDrillState {
  return {
    ...state,
    phase: "prompt",
    roundIndex: 0,
    score: 0,
    combo: 0,
    maxCombo: 0,
    correctCount: 0,
    results: [],
    feedback: null,
  };
}

export function applyWindDownDrillAction(
  state: WindDownDrillState,
  action: WindDownDrillAction,
): WindDownDrillState {
  if (state.phase === "prompt" && action.type === "answer") {
    const round = state.rounds[state.roundIndex];
    if (
      !round
      || action.roundId !== round.id
      || !round.choices.some((choice) => choice.id === action.choiceId)
    ) {
      return state;
    }
    const correct = action.choiceId === round.correctChoiceId;
    const combo = correct ? state.combo + 1 : 0;
    const points = correct ? 100 + state.combo * 25 : 0;
    const result: WindDownDrillResult = {
      roundId: round.id,
      choiceId: action.choiceId,
      correct,
      points,
      combo,
    };
    return {
      ...state,
      phase: "feedback",
      score: state.score + points,
      combo,
      maxCombo: Math.max(state.maxCombo, combo),
      correctCount: state.correctCount + (correct ? 1 : 0),
      results: [...state.results, result],
      feedback: { ...result, answer: round.answer },
    };
  }

  if (state.phase === "feedback" && action.type === "continue") {
    const roundIndex = state.roundIndex + 1;
    return {
      ...state,
      phase: roundIndex >= state.rounds.length ? "complete" : "prompt",
      roundIndex,
      feedback: null,
    };
  }

  return state;
}
