import type {
  MonaVnextExpression,
  MonaVnextLessonState,
} from "@/features/mona-vnext/coach/coachPolicy";
import type { MonaVnextAnswerMatchTier } from "@/features/mona-vnext/coach/answerMatcher";
import acceptedVariantsArtifact from "@/features/mona-vnext/coach/acceptedVariants.curated.json";
import type {
  CardRef,
  TeacherMaterialCandidate,
  TeacherSession,
  TeacherVerdict,
} from "./teacherSession";

type ExpressionWithDifficulty = MonaVnextExpression & {
  difficulty?: unknown;
};

const curatedAcceptedVariants = acceptedVariantsArtifact as Record<string, string[]>;

function normalizeAcceptedVariants(expressionId: string, variants: unknown) {
  const direct = Array.isArray(variants) ? variants : [];
  const curated = curatedAcceptedVariants[expressionId] ?? [];
  return Array.from(new Set([...direct, ...curated]
    .map((variant) => typeof variant === "string" ? variant.trim().replace(/\s+/g, " ") : "")
    .filter(Boolean)));
}

export function monaExpressionToTeacherCard(entry: ExpressionWithDifficulty): CardRef {
  const difficulty = typeof entry.difficulty === "number" && Number.isFinite(entry.difficulty)
    ? entry.difficulty
    : 1;
  return {
    expressionId: entry.id,
    ko: entry.ko,
    targetEn: entry.en,
    acceptedVariants: normalizeAcceptedVariants(entry.id, entry.acceptedVariants),
    difficulty,
    exposureCount: 0,
  };
}

export function monaExpressionToTeacherMaterialCandidate(entry: ExpressionWithDifficulty): TeacherMaterialCandidate {
  return {
    ...monaExpressionToTeacherCard(entry),
    grounded: true,
    verifiedInSource: true,
    tried: [],
  };
}

export function mapAnswerMatchToTeacherVerdict(match: { tier: MonaVnextAnswerMatchTier } | null): TeacherVerdict {
  if (!match) return "miss";
  if (match.tier === "canonical") return "canonical";
  if (match.tier === "variant") return "variant";
  if (match.tier === "close") return "close";
  if (match.tier === "garbage") return "garbage";
  return "miss";
}

function teacherCardState(session: TeacherSession): MonaVnextExpression["state"] {
  if (session.phase === "feedback" && session.attempt.verdict !== "canonical" && session.attempt.verdict !== "variant") {
    return "repair";
  }
  if (session.visibility.english || session.phase === "revealed" || session.phase === "advance_pending") {
    return "reveal";
  }
  return "prompt";
}

function queueToExpressionBank(session: TeacherSession, fallbackBank: MonaVnextExpression[]) {
  const fallbackById = new Map(fallbackBank.map((entry) => [entry.id, entry]));
  return session.queue.entries.map((entry) => {
    const fallback = fallbackById.get(entry.expressionId);
    return {
      id: entry.expressionId,
      ko: entry.ko,
      en: entry.targetEn,
      acceptedVariants: [...entry.acceptedVariants],
      state: fallback?.state ?? "prompt",
    } satisfies MonaVnextExpression;
  });
}

export function teacherSessionToLessonState(
  session: TeacherSession,
  fallbackBank: MonaVnextExpression[],
): MonaVnextLessonState {
  const expressionBank = queueToExpressionBank(session, fallbackBank);
  const card = session.card ?? session.queue.entries[session.queue.cursor] ?? session.queue.entries[0];
  const expression: MonaVnextExpression = card
    ? {
      id: card.expressionId,
      ko: card.ko,
      en: card.targetEn,
      acceptedVariants: [...card.acceptedVariants],
      state: teacherCardState(session),
    }
    : expressionBank[0] ?? {
      id: "mona-tsm-empty",
      ko: "준비된 문장이 없어.",
      en: "No prepared sentence is available.",
      state: "prompt",
    };

  const promptHistory = session.queue.entries.reduce<Record<string, number>>((history, entry) => {
    history[entry.expressionId] = entry.exposureCount ?? 0;
    return history;
  }, {});
  if (session.card) {
    promptHistory[session.card.expressionId] = Math.max(
      promptHistory[session.card.expressionId] ?? 0,
      session.card.exposureCount,
    );
  }

  return {
    expression,
    expressionBank,
    promptHistory,
    englishVisible: session.visibility.english,
  };
}
