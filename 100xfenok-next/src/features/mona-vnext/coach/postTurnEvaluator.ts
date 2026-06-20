import {
  MONA_VNEXT_MAX_SAME_PROMPT,
  type MonaVnextLessonState,
} from "@/features/mona-vnext/coach/coachPolicy";
import {
  evaluateMonaVnextAnswerAttempt,
  type MonaVnextAnswerMatch,
} from "@/features/mona-vnext/coach/answerMatcher";
import type { MonaVnextTurn } from "@/features/mona-vnext/transcript/turnBoundary";

export type MonaVnextPedagogyAction =
  | "continue"
  | "advance"
  | "reveal_english"
  | "hold"
  | "teach_slow"
  | "repair"
  | "intervene"
  | "answer_close"
  | "answer_miss"
  | "reject_garbage"
  | "answer_meta"
  | "stop";

export type MonaVnextEvaluationOptions = {
  answerMatcherEnabled?: boolean;
  autoAdvanceOnCanonical?: boolean;
  sttGarbageGateEnabled?: boolean;
};

export type MonaVnextPostTurnEvaluation = {
  intent: MonaVnextTurn["intent"];
  pedagogyAction: MonaVnextPedagogyAction;
  answerMatch: MonaVnextAnswerMatch | null;
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
  options: MonaVnextEvaluationOptions = {},
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
  const answerMatch = options.answerMatcherEnabled && lessonAttempt
    ? evaluateMonaVnextAnswerAttempt(turn.userText, lessonState.expression.en)
    : null;
  const garbageAnswerDetected = answerMatch?.tier === "garbage";
  const canonicalAnswerDetected = answerMatch?.tier === "canonical";
  const closeAnswerDetected = answerMatch?.tier === "close";
  const missAnswerDetected = answerMatch?.tier === "miss";
  const sttGarbageRequested = lessonAttempt
    && options.sttGarbageGateEnabled === true
    && (turn.sttDrift || garbageAnswerDetected);
  const canonicalAnswerRequested = lessonAttempt
    && canonicalAnswerDetected
    && options.autoAdvanceOnCanonical === true;
  const closeAnswerRequested = lessonAttempt && closeAnswerDetected;
  const missAnswerRequested = lessonAttempt && missAnswerDetected;
  const repeatInterventionRequested = lessonAttempt && samePromptCount >= MONA_VNEXT_MAX_SAME_PROMPT;
  const pedagogyAction = selectPedagogyAction({
    nextMaterialRequested,
    englishVisibilityRequested,
    holdCurrentRequested,
    difficultyRequested,
    repairRequested,
    metaQuestionRequested,
    stopRequested,
    sttGarbageRequested,
    canonicalAnswerRequested,
    closeAnswerRequested,
    missAnswerRequested,
    repeatInterventionRequested,
  });
  const shouldAdvancePrompt = pedagogyAction === "advance";

  return {
    intent: turn.intent,
    pedagogyAction,
    answerMatch,
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
      answerMatch,
      sttGarbageRequested,
      canonicalAnswerRequested,
      closeAnswerRequested,
      missAnswerRequested,
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
  answerMatch: MonaVnextAnswerMatch | null;
  sttGarbageRequested: boolean;
  canonicalAnswerRequested: boolean;
  closeAnswerRequested: boolean;
  missAnswerRequested: boolean;
  repeatInterventionRequested: boolean;
  shouldAdvancePrompt: boolean;
}) {
  const action = selectPedagogyAction(args);
  if (action === "stop") return "stop-softly";
  if (action === "answer_meta") return "answer-meta-question-directly";
  if (action === "reveal_english") return "keep-english-visible-and-explain-briefly";
  if (action === "hold") return "hold-current-and-wait-for-learner";
  if (action === "teach_slow") return "slow-teacher-mode-chunk-current-sentence";
  if (action === "reject_garbage") return "reject-stt-garbage-without-grading";
  if (action === "answer_close") return "answer-close-reveal-current-target";
  if (action === "answer_miss") return "answer-miss-try-current-target";
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
  sttGarbageRequested: boolean;
  canonicalAnswerRequested: boolean;
  closeAnswerRequested: boolean;
  missAnswerRequested: boolean;
  repeatInterventionRequested: boolean;
}): MonaVnextPedagogyAction {
  if (args.stopRequested) return "stop";
  if (args.metaQuestionRequested) return "answer_meta";
  if (args.englishVisibilityRequested) return "reveal_english";
  if (args.holdCurrentRequested) return "hold";
  if (args.difficultyRequested) return "teach_slow";
  if (args.sttGarbageRequested) return "reject_garbage";
  if (args.canonicalAnswerRequested) return "advance";
  if (args.repeatInterventionRequested) return "intervene";
  if (args.nextMaterialRequested) return "advance";
  if (args.repairRequested) return "repair";
  if (args.closeAnswerRequested) return "answer_close";
  if (args.missAnswerRequested) return "answer_miss";
  return "continue";
}
