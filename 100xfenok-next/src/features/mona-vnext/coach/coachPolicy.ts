import type { MonaVnextTurn } from "@/features/mona-vnext/transcript/turnBoundary";

export const MONA_VNEXT_MAX_SAME_PROMPT = 3;

export type MonaVnextExpression = {
  id: string;
  ko: string;
  en: string;
  state: "prompt" | "reveal" | "repair";
};

export type MonaVnextLessonState = {
  expression: MonaVnextExpression;
  promptHistory: Record<string, number>;
  englishVisible: boolean;
};

export const MONA_VNEXT_EXPRESSION_BANK: MonaVnextExpression[] = [
  {
    id: "hope-that-makes-sense",
    ko: "내 말이 좀 말이 됐으면 좋겠어.",
    en: "I hope that makes sense.",
    state: "prompt",
  },
  {
    id: "still-raining",
    ko: "아직도 비가 와.",
    en: "It's still raining.",
    state: "prompt",
  },
  {
    id: "at-least-ten",
    ko: "적어도 10개는 필요해.",
    en: "I need at least ten.",
    state: "prompt",
  },
  {
    id: "im-not-sure-yet",
    ko: "아직 잘 모르겠어.",
    en: "I'm not sure yet.",
    state: "prompt",
  },
  {
    id: "can-you-say-that-again",
    ko: "다시 한 번 말해줄래?",
    en: "Can you say that again?",
    state: "prompt",
  },
];

export function createInitialLessonState(): MonaVnextLessonState {
  const expression = MONA_VNEXT_EXPRESSION_BANK[0];
  return {
    expression,
    promptHistory: { [expression.id]: 1 },
    englishVisible: true,
  };
}

export function pickNextExpression(currentId: string, promptHistory: Record<string, number>) {
  const currentIndex = MONA_VNEXT_EXPRESSION_BANK.findIndex((item) => item.id === currentId);
  for (let offset = 1; offset <= MONA_VNEXT_EXPRESSION_BANK.length; offset += 1) {
    const candidate = MONA_VNEXT_EXPRESSION_BANK[(currentIndex + offset + MONA_VNEXT_EXPRESSION_BANK.length) % MONA_VNEXT_EXPRESSION_BANK.length];
    if ((promptHistory[candidate.id] ?? 0) < MONA_VNEXT_MAX_SAME_PROMPT) return candidate;
  }
  return MONA_VNEXT_EXPRESSION_BANK[(currentIndex + 1 + MONA_VNEXT_EXPRESSION_BANK.length) % MONA_VNEXT_EXPRESSION_BANK.length];
}

export function recordPromptExposure(state: MonaVnextLessonState, expression: MonaVnextExpression): MonaVnextLessonState {
  const count = (state.promptHistory[expression.id] ?? 0) + 1;
  return {
    ...state,
    expression,
    promptHistory: {
      ...state.promptHistory,
      [expression.id]: count,
    },
  };
}

export function shouldForcePromptAdvance(state: MonaVnextLessonState) {
  return (state.promptHistory[state.expression.id] ?? 0) >= MONA_VNEXT_MAX_SAME_PROMPT;
}

export function classifyLearnerFacingTurn(turn: MonaVnextTurn) {
  return {
    isControl: turn.intent === "next_material" || turn.intent === "english_visibility" || turn.intent === "repair" || turn.intent === "stop",
    isLessonAttempt: turn.intent === "lesson_attempt",
  };
}
