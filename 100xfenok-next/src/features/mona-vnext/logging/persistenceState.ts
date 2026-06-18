// Persistence severity model for Mona vNext.
//
// Root cause (measured 2026-06-18): the coach POSTs one /log request per
// input/output partial (80+ per session). Those POSTs shared a single error
// state with the durable turn/final saves, so a single transient partial-POST
// blip raised a "저장 실패" banner even though the conversation was fully saved.
//
// This module splits severity: partial-event logging is best-effort and never
// surfaces as a conversation-save failure; only turn/final saves govern the
// user-facing banner.

export type MonaVnextPersistKind = "partial" | "turn" | "final";

export type MonaVnextPersistOutcome = {
  kind: MonaVnextPersistKind;
  ok: boolean;
  error?: string;
  file?: string;
};

export type MonaVnextPersistenceState = {
  // User-facing "저장 실패" banner is driven by this and only this.
  conversationSaveError: string | null;
  lastPersistedFile: string | null;
};

export function createInitialPersistenceState(): MonaVnextPersistenceState {
  return { conversationSaveError: null, lastPersistedFile: null };
}

export function reducePersistence(
  state: MonaVnextPersistenceState,
  outcome: MonaVnextPersistOutcome,
): MonaVnextPersistenceState {
  if (outcome.kind === "partial") {
    // Best-effort event logging: a dropped partial never affects the
    // conversation-save banner, success or failure.
    return state;
  }

  // turn | final = durable conversation data.
  if (outcome.ok) {
    return {
      conversationSaveError: null,
      lastPersistedFile: outcome.file ?? state.lastPersistedFile,
    };
  }

  const reason = outcome.error || "UNKNOWN_PERSISTENCE_ERROR";
  return { ...state, conversationSaveError: `${outcome.kind}: ${reason}` };
}
