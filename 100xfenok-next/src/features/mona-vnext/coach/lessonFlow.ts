import {
  pickNextExpression,
  recordPromptExposure,
  type MonaVnextLessonState,
} from "@/features/mona-vnext/coach/coachPolicy";
import type { MonaVnextPostTurnEvaluation } from "@/features/mona-vnext/coach/postTurnEvaluator";

export function applyMonaVnextLessonEvaluation(
  state: MonaVnextLessonState,
  evaluation: MonaVnextPostTurnEvaluation,
): MonaVnextLessonState {
  if (evaluation.stopRequested || evaluation.metaQuestionRequested) return state;

  if (evaluation.englishVisibilityRequested) {
    return {
      ...state,
      englishVisible: true,
      expression: {
        ...state.expression,
        state: "reveal",
      },
    };
  }

  if (evaluation.pedagogyAction === "advance") {
    const next = pickNextExpression(state.expression.id, state.promptHistory, state.expressionBank);
    return recordPromptExposure(
      {
        ...state,
        englishVisible: true,
      },
      {
        ...next,
        state: "prompt",
      },
    );
  }

  if (evaluation.pedagogyAction === "hold"
    || evaluation.pedagogyAction === "teach_slow"
    || evaluation.pedagogyAction === "repair"
    || evaluation.pedagogyAction === "intervene") {
    return {
      ...state,
      englishVisible: true,
      expression: {
        ...state.expression,
        state: "repair",
      },
    };
  }

  if (evaluation.lessonAttempt) {
    return recordPromptExposure(state, state.expression);
  }

  return state;
}
