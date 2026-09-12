import {
  deriveWindDownVoiceCorrectionPresentation,
  type WindDownVoiceActivity,
  type WindDownVoiceFinalizedTurn,
} from "@/features/winddown/voice/product";
import { type WindDownVoiceReportReceipt } from "@/features/mona-vnext/memory/learningProfileCoordinator";

export type WindDownVoicePracticeCitation = {
  conversation: string;
  turn: number;
  source: string;
};

export type WindDownVoicePracticeSeed = {
  citation: WindDownVoicePracticeCitation;
  activity: WindDownVoiceActivity;
  learnerText: string;
  modelCorrection: string;
  practiceUrl: string;
  materialId?: string;
};

const SAFE_PRODUCT_SESSION_ID = /^[A-Za-z0-9._-]{8,160}$/;
const SAFE_CONVERSATION_ID = /^[A-Za-z0-9._-]{1,120}$/;
const ALLOWED_QUERY_KEYS = new Set([
  "conversation",
  "turn",
  "source",
]);

export function buildWindDownVoicePracticeUrl(
  citation: WindDownVoicePracticeCitation,
): string {
  if (
    typeof citation.conversation !== "string" ||
    !SAFE_PRODUCT_SESSION_ID.test(citation.conversation)
  ) {
    throw new Error("invalid_conversation_id");
  }
  if (
    !Number.isSafeInteger(citation.turn) ||
    citation.turn < 1
  ) {
    throw new Error("invalid_turn_seq");
  }
  if (
    typeof citation.source !== "string" ||
    !SAFE_CONVERSATION_ID.test(citation.source)
  ) {
    throw new Error("invalid_source_conversation_id");
  }
  const params = new URLSearchParams();
  params.set("conversation", citation.conversation);
  params.set("turn", String(citation.turn));
  params.set("source", citation.source);

  return `/winddown/drill?${params.toString()}`;
}

export function parseWindDownVoicePracticeUrl(
  urlOrQuery: string,
): WindDownVoicePracticeCitation | null {
  try {
    const rawSearch = urlOrQuery.includes("?")
      ? urlOrQuery.slice(urlOrQuery.indexOf("?"))
      : urlOrQuery.startsWith("conversation=")
        ? `?${urlOrQuery}`
        : urlOrQuery;

    const parsed = new URLSearchParams(rawSearch);

    // Reject duplicate parameters
    for (const key of parsed.keys()) {
      if (!ALLOWED_QUERY_KEYS.has(key)) return null;
      if (parsed.getAll(key).length > 1) return null;
    }

    const conversation = parsed.get("conversation");
    const turnStr = parsed.get("turn");
    const source = parsed.get("source");

    if (!conversation || !SAFE_PRODUCT_SESSION_ID.test(conversation)) {
      return null;
    }
    if (!turnStr || !/^\d+$/.test(turnStr)) {
      return null;
    }
    const turn = parseInt(turnStr, 10);
    if (!Number.isSafeInteger(turn) || turn < 1) {
      return null;
    }
    if (!source || !SAFE_CONVERSATION_ID.test(source)) {
      return null;
    }

    return {
      conversation,
      turn,
      source,
    };
  } catch {
    return null;
  }
}

export function extractWindDownVoicePracticeSeeds(
  receipt: WindDownVoiceReportReceipt,
): WindDownVoicePracticeSeed[] {
  if (
    !receipt ||
    !receipt.report ||
    !receipt.report.outcome ||
    !Array.isArray(receipt.report.outcome.corrections) ||
    !Array.isArray(receipt.report.turns)
  ) {
    return [];
  }

  const turnsMap = new Map<string, WindDownVoiceFinalizedTurn>();
  for (const turn of receipt.report.turns) {
    turnsMap.set(`${turn.conversationId}:${turn.turnSeq}`, turn);
  }

  const journeyTargets = receipt.journeyTargets ?? [];
  const seeds: WindDownVoicePracticeSeed[] = [];

  for (const correction of receipt.report.outcome.corrections) {
    const matchingTurn = turnsMap.get(
      `${correction.conversationId}:${correction.turnSeq}`,
    );
    if (!matchingTurn) continue;
    if (matchingTurn.correctionText !== correction.correctionText) continue;

    // Resolve canonical journey material if available
    let materialId: string | undefined;
    const normalizedLearnerText = matchingTurn.userText?.trim().toLowerCase();
    if (journeyTargets.length > 0 && normalizedLearnerText) {
      const matched = journeyTargets.find((jt) =>
        jt.en.toLowerCase() === normalizedLearnerText,
      );
      if (matched) {
        materialId = matched.materialId;
      }
    }

    const citation: WindDownVoicePracticeCitation = {
      conversation: receipt.productSessionId,
      turn: correction.turnSeq,
      source: correction.conversationId,
    };

    seeds.push({
      citation,
      activity: receipt.activity,
      learnerText: correction.learnerText,
      modelCorrection: deriveWindDownVoiceCorrectionPresentation(correction)?.now ?? correction.correctionText,
      practiceUrl: buildWindDownVoicePracticeUrl(citation),
      ...(materialId ? { materialId } : {}),
    });
  }

  return seeds;
}
