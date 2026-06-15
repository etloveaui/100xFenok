export type CoachTurnTranscriptEntry = {
  inputTurnId: number;
  text: string;
  atMs?: number | null;
};

export type CoachTurnTranscriptState = {
  pendingFinalTranscripts: readonly CoachTurnTranscriptEntry[];
  lastConsumedInputTurnId?: number | null;
  currentPendingTranscript?: string | null;
};

export type CoachTurnArgOverrideReason =
  | "empty-model-attempt";

export type CoachTurnTranscriptSource =
  | "current-pending"
  | "finalized-fifo"
  | "none";

export type CoachTurnArgSkippedReason =
  | "no-pending-final-transcript"
  | "blank-final-transcript"
  | "stale-or-consumed-transcript"
  | "model-attempt-kept"
  | "model-transcript-mismatch-kept"
  | "control-intent-kept";

export type CoachTurnArgTelemetry = {
  inputTurnId: number | null;
  didOverride: boolean;
  overrideReason: CoachTurnArgOverrideReason | null;
  skippedReason: CoachTurnArgSkippedReason | null;
  source: CoachTurnTranscriptSource;
  consumedCurrentPending: boolean;
  modelAttemptTextLen: number;
  transcriptTextLen: number;
};

export type ResolveCoachTurnArgsResult = {
  args: Record<string, unknown>;
  didOverride: boolean;
  overrideReason: CoachTurnArgOverrideReason | null;
  skippedReason: CoachTurnArgSkippedReason | null;
  consumeInputTurnId: number | null;
  consumedCurrentPending: boolean;
  telemetry: CoachTurnArgTelemetry;
};

function normalizedText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

const CONTROL_INTENTS = new Set(["next_material", "easier", "harder", "switch_theme", "stop"]);

function hasControlIntent(args: Record<string, unknown>): boolean {
  return typeof args.intent === "string" && CONTROL_INTENTS.has(args.intent.trim());
}

function result(input: {
  args: Record<string, unknown>;
  inputTurnId: number | null;
  didOverride: boolean;
  overrideReason: CoachTurnArgOverrideReason | null;
  skippedReason: CoachTurnArgSkippedReason | null;
  consumeInputTurnId: number | null;
  consumedCurrentPending: boolean;
  source: CoachTurnTranscriptSource;
  modelAttemptText: string;
  transcriptText: string;
}): ResolveCoachTurnArgsResult {
  const {
    args,
    inputTurnId,
    didOverride,
    overrideReason,
    skippedReason,
    consumeInputTurnId,
    consumedCurrentPending,
    source,
    modelAttemptText,
    transcriptText,
  } = input;
  return {
    args,
    didOverride,
    overrideReason,
    skippedReason,
    consumeInputTurnId,
    consumedCurrentPending,
    telemetry: {
      inputTurnId,
      didOverride,
      overrideReason,
      skippedReason,
      source,
      consumedCurrentPending,
      modelAttemptTextLen: modelAttemptText.length,
      transcriptTextLen: transcriptText.length,
    },
  };
}

export function resolveCoachTurnArgsForTranscript(
  args: Record<string, unknown> | null | undefined,
  transcriptState: CoachTurnTranscriptState | null | undefined,
): ResolveCoachTurnArgsResult {
  const originalArgs = args && typeof args === "object" ? { ...args } : {};
  const lastConsumedInputTurnId = transcriptState?.lastConsumedInputTurnId ?? null;
  const pending = transcriptState?.pendingFinalTranscripts ?? [];
  const currentPendingTranscript = normalizedText(transcriptState?.currentPendingTranscript);
  const validPending = pending.filter((entry) => (
    Number.isFinite(entry.inputTurnId) &&
    (lastConsumedInputTurnId == null || entry.inputTurnId > lastConsumedInputTurnId)
  ));
  const modelAttemptText = normalizedText(originalArgs.attemptText);
  const currentPendingCandidate = currentPendingTranscript
    ? {
        inputTurnId: null,
        text: currentPendingTranscript,
        consumeInputTurnId: null,
        consumedCurrentPending: true,
        source: "current-pending" as const,
      }
    : null;

  if (!currentPendingCandidate && !validPending.length) {
    const hasOnlyConsumedEntries = pending.length > 0;
    const skippedReason: CoachTurnArgSkippedReason = hasOnlyConsumedEntries
      ? "stale-or-consumed-transcript"
      : "no-pending-final-transcript";
    return result({
      args: originalArgs,
      inputTurnId: null,
      didOverride: false,
      overrideReason: null,
      skippedReason,
      consumeInputTurnId: null,
      consumedCurrentPending: false,
      source: "none",
      modelAttemptText,
      transcriptText: "",
    });
  }

  let transcript: {
    inputTurnId: number | null;
    text: string;
    consumeInputTurnId: number | null;
    consumedCurrentPending: boolean;
    source: CoachTurnTranscriptSource;
  };
  if (currentPendingCandidate) {
    transcript = currentPendingCandidate;
  } else {
    const finalizedTranscript = [...validPending].sort((a, b) => a.inputTurnId - b.inputTurnId)[0];
    if (!finalizedTranscript) {
      return result({
        args: originalArgs,
        inputTurnId: null,
        didOverride: false,
        overrideReason: null,
        skippedReason: "no-pending-final-transcript",
        consumeInputTurnId: null,
        consumedCurrentPending: false,
        source: "none",
        modelAttemptText,
        transcriptText: "",
      });
    }
    transcript = {
      inputTurnId: finalizedTranscript.inputTurnId,
      text: finalizedTranscript.text,
      consumeInputTurnId: finalizedTranscript.inputTurnId,
      consumedCurrentPending: false,
      source: "finalized-fifo",
    };
  }
  const transcriptText = normalizedText(transcript.text);
  const inputTurnId = transcript.inputTurnId;
  const consumeInputTurnId = transcript.consumeInputTurnId;
  const consumedCurrentPending = transcript.consumedCurrentPending;
  const source = transcript.source;

  if (hasControlIntent(originalArgs)) {
    return result({
      args: originalArgs,
      inputTurnId,
      didOverride: false,
      overrideReason: null,
      skippedReason: "control-intent-kept",
      consumeInputTurnId,
      consumedCurrentPending,
      source,
      modelAttemptText,
      transcriptText,
    });
  }

  if (!transcriptText) {
    return result({
      args: originalArgs,
      inputTurnId,
      didOverride: false,
      overrideReason: null,
      skippedReason: "blank-final-transcript",
      consumeInputTurnId,
      consumedCurrentPending,
      source,
      modelAttemptText,
      transcriptText,
    });
  }

  if (!modelAttemptText) {
    return result({
      args: { ...originalArgs, attemptText: transcriptText },
      inputTurnId,
      didOverride: true,
      overrideReason: "empty-model-attempt",
      skippedReason: null,
      consumeInputTurnId,
      consumedCurrentPending,
      source,
      modelAttemptText,
      transcriptText,
    });
  }

  if (modelAttemptText !== transcriptText) {
    return result({
      args: originalArgs,
      inputTurnId,
      didOverride: false,
      overrideReason: null,
      skippedReason: "model-transcript-mismatch-kept",
      consumeInputTurnId,
      consumedCurrentPending,
      source,
      modelAttemptText,
      transcriptText,
    });
  }

  return result({
    args: originalArgs,
    inputTurnId,
    didOverride: false,
    overrideReason: null,
    skippedReason: "model-attempt-kept",
    consumeInputTurnId,
    consumedCurrentPending,
    source,
    modelAttemptText,
    transcriptText,
  });
}
