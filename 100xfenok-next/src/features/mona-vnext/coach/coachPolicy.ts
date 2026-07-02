import type { MonaVnextTurn } from "@/features/mona-vnext/transcript/turnBoundary";

export const MONA_VNEXT_MAX_SAME_PROMPT = 3;

export type MonaVnextExpression = {
  id: string;
  ko: string;
  en: string;
  state: "prompt" | "reveal" | "repair";
  acceptedVariants?: string[];
};

export type MonaVnextExpressionBankMetadata = {
  source: string;
  updatedAt: string | null;
  sourceEntryCount: number;
  eligibleEntryCount: number;
  selectedCount: number;
  seed: string;
  strategy: string;
  materialQuarantine?: Array<{ expressionId: string; reasons: string[] }>;
  materialWarnings?: Array<{ expressionId: string; reasons: string[] }>;
};

export type MonaVnextSessionExpressionBank = {
  metadata: MonaVnextExpressionBankMetadata;
  entries: MonaVnextExpression[];
};

export type MonaVnextLessonState = {
  expression: MonaVnextExpression;
  expressionBank: MonaVnextExpression[];
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

function normalizeExpressionBank(value?: MonaVnextExpression[]) {
  return Array.isArray(value) && value.length > 0 ? value : MONA_VNEXT_EXPRESSION_BANK;
}

export function createInitialLessonState(options: {
  expressionBank?: MonaVnextExpression[];
  activeExpressionId?: string;
  englishVisible?: boolean;
} = {}): MonaVnextLessonState {
  const expressionBank = normalizeExpressionBank(options.expressionBank);
  const expression = getMonaVnextExpressionById(options.activeExpressionId, expressionBank);
  return {
    expression,
    expressionBank,
    promptHistory: { [expression.id]: 1 },
    englishVisible: options.englishVisible ?? true,
  };
}

export function getMonaVnextExpressionById(
  value: unknown,
  expressionBank = MONA_VNEXT_EXPRESSION_BANK,
): MonaVnextExpression {
  const bank = normalizeExpressionBank(expressionBank);
  if (typeof value === "string") {
    const found = bank.find((item) => item.id === value.trim());
    if (found) return found;
  }
  return bank[0];
}

export function pickNextExpression(
  currentId: string,
  promptHistory: Record<string, number>,
  expressionBank = MONA_VNEXT_EXPRESSION_BANK,
) {
  const bank = normalizeExpressionBank(expressionBank);
  const currentIndex = bank.findIndex((item) => item.id === currentId);
  for (let offset = 1; offset <= bank.length; offset += 1) {
    const candidate = bank[(currentIndex + offset + bank.length) % bank.length];
    if ((promptHistory[candidate.id] ?? 0) < MONA_VNEXT_MAX_SAME_PROMPT) return candidate;
  }
  return bank[(currentIndex + 1 + bank.length) % bank.length];
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
    isControl: turn.intent === "next_material"
      || turn.intent === "english_visibility"
      || turn.intent === "hold_current"
      || turn.intent === "difficulty"
      || turn.intent === "repair"
      || turn.intent === "meta_question"
      || turn.intent === "stop",
    isLessonAttempt: turn.intent === "lesson_attempt",
  };
}
