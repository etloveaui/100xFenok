import {
  pickNextExpression,
  recordPromptExposure,
  shouldForcePromptAdvance,
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

  if (evaluation.nextMaterialRequested || evaluation.repairRequested || shouldForcePromptAdvance(state)) {
    const next = pickNextExpression(state.expression.id, state.promptHistory);
    return recordPromptExposure(
      {
        ...state,
        englishVisible: true,
      },
      {
        ...next,
        state: evaluation.repairRequested ? "repair" : "prompt",
      },
    );
  }

  if (evaluation.lessonAttempt) {
    return recordPromptExposure(state, state.expression);
  }

  return state;
}
