import {
  MONA_VNEXT_MAX_SAME_PROMPT,
  type MonaVnextLessonState,
} from "@/features/mona-vnext/coach/coachPolicy";
import type { MonaVnextTurn } from "@/features/mona-vnext/transcript/turnBoundary";

export type MonaVnextPedagogyAction =
  | "continue"
  | "advance"
  | "reveal_english"
  | "hold"
  | "teach_slow"
  | "repair"
  | "intervene"
  | "answer_meta"
  | "stop";

export type MonaVnextPostTurnEvaluation = {
  intent: MonaVnextTurn["intent"];
  pedagogyAction: MonaVnextPedagogyAction;
  lessonAttempt: boolean;
  nextMaterialRequested: boolean;
  englishVisibilityRequested: boolean;
  holdCurrentRequested: boolean;
  difficultyRequested: boolean;
  repairRequested: boolean;
  metaQuestionRequested: boolean;
  stopRequested: boolean;
  sttDrift: boolean;
  promptId: string;
  samePromptCount: number;
  repeatInterventionRequested: boolean;
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
  const holdCurrentRequested = turn.intent === "hold_current";
  const difficultyRequested = turn.intent === "difficulty";
  const repairRequested = turn.intent === "repair";
  const metaQuestionRequested = turn.intent === "meta_question";
  const stopRequested = turn.intent === "stop";
  const lessonAttempt = turn.intent === "lesson_attempt";
  const repeatInterventionRequested = lessonAttempt && samePromptCount >= MONA_VNEXT_MAX_SAME_PROMPT;
  const pedagogyAction = selectPedagogyAction({
    nextMaterialRequested,
    englishVisibilityRequested,
    holdCurrentRequested,
    difficultyRequested,
    repairRequested,
    metaQuestionRequested,
    stopRequested,
    repeatInterventionRequested,
  });
  const shouldAdvancePrompt = pedagogyAction === "advance";

  return {
    intent: turn.intent,
    pedagogyAction,
    lessonAttempt,
    nextMaterialRequested,
    englishVisibilityRequested,
    holdCurrentRequested,
    difficultyRequested,
    repairRequested,
    metaQuestionRequested,
    stopRequested,
    sttDrift: turn.sttDrift,
    promptId: lessonState.expression.id,
    samePromptCount,
    repeatInterventionRequested,
    shouldAdvancePrompt,
    advisory: buildAdvisory({
      nextMaterialRequested,
      englishVisibilityRequested,
      holdCurrentRequested,
      difficultyRequested,
      repairRequested,
      metaQuestionRequested,
      stopRequested,
      sttDrift: turn.sttDrift,
      repeatInterventionRequested,
      shouldAdvancePrompt,
    }),
  };
}

function buildAdvisory(args: {
  nextMaterialRequested: boolean;
  englishVisibilityRequested: boolean;
  holdCurrentRequested: boolean;
  difficultyRequested: boolean;
  repairRequested: boolean;
  metaQuestionRequested: boolean;
  stopRequested: boolean;
  sttDrift: boolean;
  repeatInterventionRequested: boolean;
  shouldAdvancePrompt: boolean;
}) {
  const action = selectPedagogyAction(args);
  if (action === "stop") return "stop-softly";
  if (action === "answer_meta") return "answer-meta-question-directly";
  if (action === "reveal_english") return "keep-english-visible-and-explain-briefly";
  if (action === "hold") return "hold-current-and-wait-for-learner";
  if (action === "teach_slow") return "slow-teacher-mode-chunk-current-sentence";
  if (action === "intervene") return "trigger-intervention-hint";
  if (action === "repair") return "repair-first-without-switching-material";
  if (action === "advance") return "switch-material-within-one-turn";
  if (args.sttDrift) return "measure-stt-drift-and-avoid-grading-this-as-a-confident-attempt";
  return "continue-natural-coaching";
}

function selectPedagogyAction(args: {
  nextMaterialRequested: boolean;
  englishVisibilityRequested: boolean;
  holdCurrentRequested: boolean;
  difficultyRequested: boolean;
  repairRequested: boolean;
  metaQuestionRequested: boolean;
  stopRequested: boolean;
  repeatInterventionRequested: boolean;
}): MonaVnextPedagogyAction {
  if (args.stopRequested) return "stop";
  if (args.metaQuestionRequested) return "answer_meta";
  if (args.englishVisibilityRequested) return "reveal_english";
  if (args.holdCurrentRequested) return "hold";
  if (args.difficultyRequested) return "teach_slow";
  if (args.repeatInterventionRequested) return "intervene";
  if (args.nextMaterialRequested) return "advance";
  if (args.repairRequested) return "repair";
  return "continue";
}
