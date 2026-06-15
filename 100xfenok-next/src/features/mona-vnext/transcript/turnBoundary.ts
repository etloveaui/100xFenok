import { detectMonaVnextIntent, hasLikelySttLanguageDrift, type MonaVnextIntent } from "@/features/mona-vnext/transcript/intentHints";

export type MonaVnextTurn = {
  conversationId: string;
  turnSeq: number;
  userText: string | null;
  modelText: string | null;
  intent: MonaVnextIntent;
  sttDrift: boolean;
  interrupted: boolean;
  startedAtIso: string;
  completedAtIso: string;
};

export type MonaVnextWorkingTurn = {
  userText: string;
  modelText: string;
  interrupted: boolean;
  startedAtIso: string | null;
};

export function createMonaVnextConversationId(now = new Date()) {
  return `mona-vnext-${now.getTime().toString(36)}`;
}

export function normalizeTranscriptText(value: string | null | undefined) {
  const text = (value ?? "").trim().replace(/\s+/g, " ");
  return text || "";
}

export function finalizeMonaVnextTurn(args: {
  conversationId: string;
  nextTurnSeq: number;
  current: MonaVnextWorkingTurn;
  completedAtIso: string;
}): MonaVnextTurn | null {
  const userText = normalizeTranscriptText(args.current.userText);
  const modelText = normalizeTranscriptText(args.current.modelText);
  if (!userText && !modelText) return null;

  return {
    conversationId: args.conversationId,
    turnSeq: args.nextTurnSeq,
    userText: userText || null,
    modelText: modelText || null,
    intent: detectMonaVnextIntent(userText),
    sttDrift: hasLikelySttLanguageDrift(userText),
    interrupted: args.current.interrupted,
    startedAtIso: args.current.startedAtIso ?? args.completedAtIso,
    completedAtIso: args.completedAtIso,
  };
}
