export type CoachTurnTranscriptEntry = {
  inputTurnId: number;
  text: string;
  atMs?: number | null;
};

export type CoachTurnTranscriptState = {
  pendingFinalTranscripts: readonly CoachTurnTranscriptEntry[];
  lastConsumedInputTurnId?: number | null;
};

export type CoachTurnArgOverrideReason =
  | "empty-model-attempt"
  | "model-transcript-mismatch";

export type CoachTurnArgSkippedReason =
  | "no-pending-final-transcript"
  | "blank-final-transcript"
  | "stale-or-consumed-transcript"
  | "model-attempt-kept";

export type CoachTurnArgTelemetry = {
  inputTurnId: number | null;
  didOverride: boolean;
  overrideReason: CoachTurnArgOverrideReason | null;
  skippedReason: CoachTurnArgSkippedReason | null;
  modelAttemptTextLen: number;
  transcriptTextLen: number;
};

export type ResolveCoachTurnArgsResult = {
  args: Record<string, unknown>;
  didOverride: boolean;
  overrideReason: CoachTurnArgOverrideReason | null;
  skippedReason: CoachTurnArgSkippedReason | null;
  consumeInputTurnId: number | null;
  telemetry: CoachTurnArgTelemetry;
};

function normalizedText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function result(input: {
  args: Record<string, unknown>;
  inputTurnId: number | null;
  didOverride: boolean;
  overrideReason: CoachTurnArgOverrideReason | null;
  skippedReason: CoachTurnArgSkippedReason | null;
  consumeInputTurnId: number | null;
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
    modelAttemptText,
    transcriptText,
  } = input;
  return {
    args,
    didOverride,
    overrideReason,
    skippedReason,
    consumeInputTurnId,
    telemetry: {
      inputTurnId,
      didOverride,
      overrideReason,
      skippedReason,
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
  const validPending = pending.filter((entry) => (
    Number.isFinite(entry.inputTurnId) &&
    (lastConsumedInputTurnId == null || entry.inputTurnId > lastConsumedInputTurnId)
  ));
  const modelAttemptText = normalizedText(originalArgs.attemptText);

  if (!validPending.length) {
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
      modelAttemptText,
      transcriptText: "",
    });
  }

  const transcript = [...validPending].sort((a, b) => a.inputTurnId - b.inputTurnId)[0];
  const transcriptText = normalizedText(transcript.text);
  const consumeInputTurnId = transcript.inputTurnId;

  if (!transcriptText) {
    return result({
      args: originalArgs,
      inputTurnId: consumeInputTurnId,
      didOverride: false,
      overrideReason: null,
      skippedReason: "blank-final-transcript",
      consumeInputTurnId,
      modelAttemptText,
      transcriptText,
    });
  }

  if (!modelAttemptText) {
    return result({
      args: { ...originalArgs, attemptText: transcriptText },
      inputTurnId: consumeInputTurnId,
      didOverride: true,
      overrideReason: "empty-model-attempt",
      skippedReason: null,
      consumeInputTurnId,
      modelAttemptText,
      transcriptText,
    });
  }

  if (modelAttemptText !== transcriptText) {
    return result({
      args: { ...originalArgs, attemptText: transcriptText },
      inputTurnId: consumeInputTurnId,
      didOverride: true,
      overrideReason: "model-transcript-mismatch",
      skippedReason: null,
      consumeInputTurnId,
      modelAttemptText,
      transcriptText,
    });
  }

  return result({
    args: originalArgs,
    inputTurnId: consumeInputTurnId,
    didOverride: false,
    overrideReason: null,
    skippedReason: "model-attempt-kept",
    consumeInputTurnId,
    modelAttemptText,
    transcriptText,
  });
}
