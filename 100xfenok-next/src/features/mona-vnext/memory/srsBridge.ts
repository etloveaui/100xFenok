import type { TeacherVerdict } from "@/features/mona-vnext/teacher/teacherSession";

export type MonaVnextLearningRating = "again" | "hard" | "good";
export type MonaVnextLearningInputMode = "chips" | "typed";

export function normalizeMonaVnextLearningInputMode(
  value: unknown,
): MonaVnextLearningInputMode | null {
  return value === "chips" || value === "typed" ? value : null;
}

export type MonaVnextLearningEvent = {
  expressionId: string;
  verdict: Extract<TeacherVerdict, "canonical" | "variant" | "close" | "miss">;
  rating: MonaVnextLearningRating;
  atIso: string;
  sessionId: string;
  inputMode?: MonaVnextLearningInputMode;
};

export function buildLearningEvent(args: {
  expressionId: string;
  verdict: TeacherVerdict;
  atIso: string;
  sessionId: string;
  inputMode?: MonaVnextLearningInputMode;
}): MonaVnextLearningEvent | null {
  if (args.verdict === "garbage") return null;
  const rating: MonaVnextLearningRating = args.verdict === "miss"
    ? "again"
    : args.verdict === "close"
      ? "hard"
      : "good";
  return {
    expressionId: args.expressionId,
    verdict: args.verdict,
    rating,
    atIso: args.atIso,
    sessionId: args.sessionId,
    ...(args.inputMode ? { inputMode: args.inputMode } : {}),
  };
}
