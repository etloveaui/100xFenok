import { MONA_VNEXT_DATA_NAMESPACE } from "@/features/mona-vnext/memory/monaVnextNamespace";
import type { CardRef, TeacherVerdict } from "@/features/mona-vnext/teacher/teacherSession";

export const MONA_VNEXT_OWNER_TEST_MEMORY_DIR = `data/${MONA_VNEXT_DATA_NAMESPACE}/owner-test`;

export type MonaVnextMasteryEvent = {
  expressionId: string;
  verdict: Extract<TeacherVerdict, "canonical" | "variant">;
  atIso: string;
  sessionId: string;
};

export type MonaVnextReviewRecord = {
  expressionId: string;
  box: number;
  dueAtIso: string;
};

export type MonaVnextCorrectionCandidate = {
  expressionId: string;
  learnerText: string;
  suggestion: string;
  atIso: string;
  sessionId: string;
};

export type MonaVnextOwnerTestMemoryState = {
  masteryEvents: MonaVnextMasteryEvent[];
  reviewRecords: MonaVnextReviewRecord[];
  correctionCandidates: MonaVnextCorrectionCandidate[];
};

function uniqueByExpressionId(cards: CardRef[]) {
  const seen = new Set<string>();
  return cards.filter((card) => {
    if (seen.has(card.expressionId)) return false;
    seen.add(card.expressionId);
    return true;
  });
}

export function filterRecentlyMasteredCards(
  cards: CardRef[],
  masteryEvents: MonaVnextMasteryEvent[],
  options: { recentSessionIds: string[]; minCount?: number },
) {
  const uniqueCards = uniqueByExpressionId(cards);
  const minCount = Math.max(1, Math.floor(options.minCount ?? 20));
  const recentSessionIds = new Set(options.recentSessionIds);
  const recentlyMastered = new Set(
    masteryEvents
      .filter((event) => recentSessionIds.has(event.sessionId))
      .map((event) => event.expressionId),
  );
  const filtered = uniqueCards.filter((card) => !recentlyMastered.has(card.expressionId));
  return filtered.length >= minCount ? filtered : uniqueCards;
}

export function buildReviewDueQueue(
  cards: CardRef[],
  reviewRecords: MonaVnextReviewRecord[],
  nowIso = new Date().toISOString(),
) {
  const byId = new Map(uniqueByExpressionId(cards).map((card) => [card.expressionId, card]));
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return [];
  return reviewRecords
    .filter((record) => Date.parse(record.dueAtIso) <= nowMs)
    .sort((a, b) => Date.parse(a.dueAtIso) - Date.parse(b.dueAtIso) || a.box - b.box)
    .map((record) => byId.get(record.expressionId))
    .filter((card): card is CardRef => Boolean(card));
}

export function buildMasteryEvent(args: {
  expressionId: string;
  verdict: TeacherVerdict;
  atIso: string;
  sessionId: string;
}): MonaVnextMasteryEvent | null {
  if (args.verdict !== "canonical" && args.verdict !== "variant") return null;
  return {
    expressionId: args.expressionId,
    verdict: args.verdict,
    atIso: args.atIso,
    sessionId: args.sessionId,
  };
}

export function buildCorrectionCandidate(args: MonaVnextCorrectionCandidate): MonaVnextCorrectionCandidate {
  return {
    expressionId: args.expressionId,
    learnerText: args.learnerText.trim().replace(/\s+/g, " ").slice(0, 400),
    suggestion: args.suggestion.trim().replace(/\s+/g, " ").slice(0, 400),
    atIso: args.atIso,
    sessionId: args.sessionId,
  };
}

export function applyOwnerTestMemoryPatch(
  state: MonaVnextOwnerTestMemoryState,
  patch: {
    masteryEvent?: MonaVnextMasteryEvent | null;
    reviewRecord?: MonaVnextReviewRecord | null;
    correctionCandidate?: MonaVnextCorrectionCandidate | null;
  },
): MonaVnextOwnerTestMemoryState {
  return {
    masteryEvents: patch.masteryEvent
      ? [...state.masteryEvents, patch.masteryEvent].slice(-500)
      : state.masteryEvents,
    reviewRecords: patch.reviewRecord
      ? [
        ...state.reviewRecords.filter((record) => record.expressionId !== patch.reviewRecord?.expressionId),
        patch.reviewRecord,
      ].slice(-500)
      : state.reviewRecords,
    correctionCandidates: patch.correctionCandidate
      ? [...state.correctionCandidates, patch.correctionCandidate].slice(-200)
      : state.correctionCandidates,
  };
}
