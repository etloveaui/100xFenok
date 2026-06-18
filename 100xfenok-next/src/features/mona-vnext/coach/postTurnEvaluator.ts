import {
  MONA_VNEXT_MAX_SAME_PROMPT,
  type MonaVnextLessonState,
} from "@/features/mona-vnext/coach/coachPolicy";
import type { MonaVnextTurn } from "@/features/mona-vnext/transcript/turnBoundary";

export type MonaVnextPostTurnEvaluation = {
  intent: MonaVnextTurn["intent"];
  lessonAttempt: boolean;
  nextMaterialRequested: boolean;
  englishVisibilityRequested: boolean;
  repairRequested: boolean;
  metaQuestionRequested: boolean;
  stopRequested: boolean;
  sttDrift: boolean;
  promptId: string;
  samePromptCount: number;
  shouldAdvancePrompt: boolean;
  advisory: string;
};

export function evaluateMonaVnextTurn(
  turn: MonaVnextTurn,
  lessonState: MonaVnextLessonState,
): MonaVnextPostTurnEvaluation {
  const samePromptCount = lessonState.promptHistory[lessonState.expression.id] ?? 0;
  const nextMaterialRequested = turn.intent === "next_material";
  const englishVisibilityRequested = turn.intent === "english_visibility";
  const repairRequested = turn.intent === "repair";
  const metaQuestionRequested = turn.intent === "meta_question";
  const stopRequested = turn.intent === "stop";
  const shouldAdvancePrompt = nextMaterialRequested || repairRequested || samePromptCount >= MONA_VNEXT_MAX_SAME_PROMPT;

  return {
    intent: turn.intent,
    lessonAttempt: turn.intent === "lesson_attempt",
    nextMaterialRequested,
    englishVisibilityRequested,
    repairRequested,
    metaQuestionRequested,
    stopRequested,
    sttDrift: turn.sttDrift,
    promptId: lessonState.expression.id,
    samePromptCount,
    shouldAdvancePrompt,
    advisory: buildAdvisory({
      nextMaterialRequested,
      englishVisibilityRequested,
      repairRequested,
      metaQuestionRequested,
      stopRequested,
      sttDrift: turn.sttDrift,
      shouldAdvancePrompt,
    }),
  };
}

function buildAdvisory(args: {
  nextMaterialRequested: boolean;
  englishVisibilityRequested: boolean;
  repairRequested: boolean;
  metaQuestionRequested: boolean;
  stopRequested: boolean;
  sttDrift: boolean;
  shouldAdvancePrompt: boolean;
}) {
  if (args.stopRequested) return "stop-softly";
  if (args.metaQuestionRequested) return "answer-meta-question-directly";
  if (args.englishVisibilityRequested) return "keep-english-visible-and-explain-briefly";
  if (args.repairRequested) return "repair-first-and-switch-material";
  if (args.nextMaterialRequested) return "switch-material-within-one-turn";
  if (args.sttDrift) return "measure-stt-drift-and-avoid-grading-this-as-a-confident-attempt";
  if (args.shouldAdvancePrompt) return "advance-prompt-repeat-limit";
  return "continue-natural-coaching";
}
