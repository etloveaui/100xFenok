import type { MonaVnextServerContent } from "@/features/mona-vnext/live/liveProtocol";
import {
  finalizeMonaVnextTurn,
  normalizeTranscriptText,
  type MonaVnextTurn,
  type MonaVnextWorkingTurn,
} from "@/features/mona-vnext/transcript/turnBoundary";

type TranscriptMergeMode = "input" | "output";

export type MonaVnextTranscriptState = {
  conversationId: string;
  nextTurnSeq: number;
  current: MonaVnextWorkingTurn;
  turns: MonaVnextTurn[];
};

export type MonaVnextTranscriptEvent =
  | { type: "input-partial"; text: string; atIso: string }
  | { type: "output-partial"; text: string; atIso: string }
  | { type: "interrupted"; atIso: string }
  | { type: "turn-complete"; turn: MonaVnextTurn; atIso: string };

export function createMonaVnextTranscriptState(conversationId: string): MonaVnextTranscriptState {
  return {
    conversationId,
    nextTurnSeq: 1,
    current: {
      userText: "",
      modelText: "",
      interrupted: false,
      startedAtIso: null,
    },
    turns: [],
  };
}

function shouldJoinWithSpace(previous: string, incoming: string, mode: TranscriptMergeMode) {
  if (!previous || !incoming) return false;
  if (/[\s([{"'“‘-]$/.test(previous)) return false;
  if (/^[\s,.!?;:)\]}"'”’]/.test(incoming)) return false;

  const previousTail = previous.at(-1) ?? "";
  const incomingHead = incoming.at(0) ?? "";
  if (/[A-Za-z0-9]$/.test(previousTail) && /^[A-Za-z0-9]/.test(incomingHead)) return true;
  if (/[A-Za-z0-9"”’]$/.test(previousTail) && /^[가-힣]/.test(incomingHead)) return true;
  if (/[가-힣]$/.test(previousTail) && /^[A-Za-z0-9"“‘]/.test(incomingHead)) return true;

  if (mode === "output" && /[가-힣]$/.test(previousTail) && /^[가-힣]/.test(incomingHead)) {
    return true;
  }
  if (mode === "input" && previous.length > 1 && incoming.length > 1 && /[가-힣]$/.test(previousTail) && /^[가-힣]/.test(incomingHead)) {
    return true;
  }
  return false;
}

export function mergeMonaVnextTranscriptText(
  previousValue: string | null | undefined,
  incomingValue: string | null | undefined,
  mode: TranscriptMergeMode,
) {
  const previous = normalizeTranscriptText(previousValue);
  const incoming = normalizeTranscriptText(incomingValue);
  if (!incoming) return previous;
  if (!previous) return incoming;

  if (incoming === previous) return previous;
  if (incoming.startsWith(previous)) return incoming;
  if (previous.endsWith(incoming) || previous.includes(incoming)) return previous;

  const joiner = shouldJoinWithSpace(previous, incoming, mode) ? " " : "";
  return normalizeTranscriptText(`${previous}${joiner}${incoming}`);
}

export function applyMonaVnextServerContent(
  state: MonaVnextTranscriptState,
  serverContent: MonaVnextServerContent,
  atIso = new Date().toISOString(),
) {
  let current = { ...state.current };
  const events: MonaVnextTranscriptEvent[] = [];
  let finalizedTurn: MonaVnextTurn | null = null;

  if (serverContent.interrupted) {
    current = {
      ...current,
      interrupted: true,
      startedAtIso: current.startedAtIso ?? atIso,
    };
    events.push({ type: "interrupted", atIso });
  }

  const inputText = normalizeTranscriptText(serverContent.inputTranscription?.text);
  if (inputText) {
    current = {
      ...current,
      userText: mergeMonaVnextTranscriptText(current.userText, inputText, "input"),
      startedAtIso: current.startedAtIso ?? atIso,
    };
    events.push({ type: "input-partial", text: inputText, atIso });
  }

  const outputText = normalizeTranscriptText(serverContent.outputTranscription?.text);
  if (outputText) {
    current = {
      ...current,
      modelText: mergeMonaVnextTranscriptText(current.modelText, outputText, "output"),
      startedAtIso: current.startedAtIso ?? atIso,
    };
    events.push({ type: "output-partial", text: outputText, atIso });
  }

  let nextState: MonaVnextTranscriptState = {
    ...state,
    current,
  };

  if (serverContent.turnComplete) {
    finalizedTurn = finalizeMonaVnextTurn({
      conversationId: state.conversationId,
      nextTurnSeq: state.nextTurnSeq,
      current,
      completedAtIso: atIso,
    });

    if (finalizedTurn) {
      events.push({ type: "turn-complete", turn: finalizedTurn, atIso });
      nextState = {
        conversationId: state.conversationId,
        nextTurnSeq: state.nextTurnSeq + 1,
        current: {
          userText: "",
          modelText: "",
          interrupted: false,
          startedAtIso: null,
        },
        turns: [...state.turns, finalizedTurn],
      };
    } else {
      nextState = {
        ...nextState,
        current: {
          userText: "",
          modelText: "",
          interrupted: false,
          startedAtIso: null,
        },
      };
    }
  }

  return { state: nextState, events, finalizedTurn };
}
