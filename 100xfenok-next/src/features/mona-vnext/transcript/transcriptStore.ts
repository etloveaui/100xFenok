import type { MonaVnextServerContent } from "@/features/mona-vnext/live/liveProtocol";
import {
  finalizeMonaVnextTurn,
  normalizeTranscriptText,
  type MonaVnextTurn,
  type MonaVnextWorkingTurn,
} from "@/features/mona-vnext/transcript/turnBoundary";

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
      userText: inputText,
      startedAtIso: current.startedAtIso ?? atIso,
    };
    events.push({ type: "input-partial", text: inputText, atIso });
  }

  const outputText = normalizeTranscriptText(serverContent.outputTranscription?.text);
  if (outputText) {
    current = {
      ...current,
      modelText: outputText,
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
