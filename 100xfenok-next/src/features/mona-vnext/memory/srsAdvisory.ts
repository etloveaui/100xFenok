import type { MonaVnextPostTurnEvaluation } from "@/features/mona-vnext/coach/postTurnEvaluator";
import type {
  MonaVnextCorrectionCandidate,
  MonaVnextMasteryEvent,
} from "@/features/mona-vnext/memory/srsBridge";
import type { MonaVnextTurn } from "@/features/mona-vnext/transcript/turnBoundary";

export type MonaVnextSrsAdvisory = {
  best3Candidates: string[];
  weakNoteCandidates: Array<{ ko: string; reason: string }>;
  nextSessionSuggestions: string[];
  masteryEvents?: MonaVnextMasteryEvent[];
  correctionCandidates?: MonaVnextCorrectionCandidate[];
};

export function buildMonaVnextSrsAdvisory(
  turn: MonaVnextTurn,
  evaluation: MonaVnextPostTurnEvaluation,
): MonaVnextSrsAdvisory {
  if (!evaluation.lessonAttempt || !turn.userText) {
    return {
      best3Candidates: [],
      weakNoteCandidates: [],
      nextSessionSuggestions: evaluation.nextMaterialRequested ? ["Start with fresh material first."] : [],
    };
  }

  const weakNoteCandidates = evaluation.sttDrift
    ? [{ ko: turn.userText, reason: "stt-drift-warning" }]
    : evaluation.repairRequested
      ? [{ ko: turn.userText, reason: "repair-requested" }]
      : [];

  return {
    best3Candidates: turn.modelText ? [turn.modelText].slice(0, 3) : [],
    weakNoteCandidates,
    nextSessionSuggestions: weakNoteCandidates.length > 0
      ? ["Review this only as a gentle next-session suggestion, not as a live blocker."]
      : [],
  };
}
