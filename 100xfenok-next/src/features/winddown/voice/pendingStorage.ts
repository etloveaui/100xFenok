import {
  WIND_DOWN_VOICE_REPORT_NORMAL_MAX_BYTES,
  buildWindDownVoiceReport,
  isWindDownVoiceReport,
  type WindDownVoiceCompletionReason,
  type WindDownVoiceReport,
} from "@/features/winddown/voice/report";
import {
  isWindDownVoiceDescriptor,
  type WindDownVoiceActivity,
  type WindDownVoiceDescriptor,
  type WindDownVoiceFinalizedTurn,
} from "@/features/winddown/voice/product";

export const WIND_DOWN_VOICE_OUTBOX_STORAGE_KEY =
  "winddown:voice_outbox:v1" as const;

export const WIND_DOWN_VOICE_CHECKPOINT_STORAGE_KEY =
  "winddown:voice_checkpoint:v1" as const;

export const WIND_DOWN_VOICE_FROZEN_STORAGE_KEY =
  "winddown:voice_frozen:v1" as const;

/** Envelope overhead allowance above the 256 KiB report content cap. */
export const WIND_DOWN_VOICE_OUTBOX_ENVELOPE_OVERHEAD_BYTES = 8 * 1024;
export const WIND_DOWN_VOICE_OUTBOX_MAX_BYTES =
  WIND_DOWN_VOICE_REPORT_NORMAL_MAX_BYTES +
  WIND_DOWN_VOICE_OUTBOX_ENVELOPE_OVERHEAD_BYTES;

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type WindDownVoiceOutboxEntry = {
  schemaVersion: 1;
  productSessionId: string;
  activity: WindDownVoiceActivity;
  finalDigest: string;
  report: WindDownVoiceReport;
  stagedAtIso: string;
  attempts: number;
  lastError?: string;
};

export type WindDownVoiceSessionCheckpoint = {
  schemaVersion: 1;
  productSessionId: string;
  activity: WindDownVoiceActivity;
  conversationIds: string[];
  sessionProofs: string[];
  descriptor: WindDownVoiceDescriptor;
  startedAtIso: string;
  turns: WindDownVoiceFinalizedTurn[];
  metrics: {
    turnCount: number;
    interruptionCount: number;
  };
  checkpointAtIso: string;
};

export type OutboxReadResult =
  | { status: "empty" }
  | { status: "valid"; entry: WindDownVoiceOutboxEntry }
  | { status: "corrupt"; raw: string; error: string }
  | { status: "storage-unavailable"; error: string };

export type CheckpointReadResult =
  | { status: "empty" }
  | { status: "valid"; checkpoint: WindDownVoiceSessionCheckpoint }
  | { status: "corrupt"; raw: string; error: string }
  | { status: "storage-unavailable"; error: string };

export type FrozenReadResult =
  | { status: "empty" }
  | { status: "valid"; report: WindDownVoiceReport }
  | { status: "corrupt"; raw: string; error: string }
  | { status: "storage-unavailable"; error: string };

export type FrozenSaveResult =
  | { ok: true }
  | { ok: false; code: "INVALID_REPORT" | "FROZEN_CONFLICT" | "FROZEN_CORRUPT_BYTES_RETAINED" }
  | { ok: false; code: "PAYLOAD_TOO_LARGE"; byteLength: number }
  | { ok: false; code: "FROZEN_OCCUPIED_BY_DIFFERENT_SESSION"; existingSessionId: string }
  | { ok: false; code: "STORAGE_UNAVAILABLE"; error: string };

export type OutboxSaveResult =
  | { ok: true }
  | { ok: false; code: "OUTBOX_CORRUPT_BYTES_RETAINED"; raw: string }
  | {
      ok: false;
      code: "OUTBOX_OCCUPIED_BY_DIFFERENT_SESSION";
      existingSessionId: string;
    }
  | { ok: false; code: "OUTBOX_DIGEST_CONFLICT"; existingDigest: string }
  | { ok: false; code: "PAYLOAD_TOO_LARGE"; byteLength: number }
  | { ok: false; code: "INVALID_REPORT" | "INVALID_OUTBOX_ENTRY" }
  | { ok: false; code: "STORAGE_UNAVAILABLE"; error: string };

export type OutboxAckResult =
  | { ok: true }
  | { ok: false; code: "NO_OUTBOX" }
  | { ok: false; code: "OUTBOX_CORRUPT"; raw: string }
  | { ok: false; code: "STORAGE_UNAVAILABLE"; error: string }
  | {
      ok: false;
      code: "ACKNOWLEDGMENT_MISMATCH";
      expected: {
        productSessionId: string;
        activity: string;
        finalDigest: string;
      };
    }
  | { ok: false; code: "CLEANUP_FAILED"; error: string };

export type CheckpointSaveResult =
  | { ok: true }
  | { ok: false; code: "OUTBOX_CORRUPT_BYTES_RETAINED"; raw: string }
  | { ok: false; code: "CHECKPOINT_CORRUPT_BYTES_RETAINED"; raw: string }
  | {
      ok: false;
      code: "OUTBOX_OCCUPIED_BY_DIFFERENT_SESSION";
      existingSessionId: string;
    }
  | {
      ok: false;
      code: "CHECKPOINT_OCCUPIED_BY_DIFFERENT_SESSION";
      existingSessionId: string;
    }
  | {
      ok: false;
      code: "CHECKPOINT_REGRESSION_REJECTED";
      existingCount: number;
      newCount: number;
    }
  | { ok: false; code: "CHECKPOINT_HISTORY_DIVERGED"; turnSeq: number }
  | { ok: false; code: "CHECKPOINT_INVALID"; error: string }
  | { ok: false; code: "CHECKPOINT_TOO_LARGE"; byteLength: number }
  | { ok: false; code: "STORAGE_UNAVAILABLE"; error: string };

const SAFE_PRODUCT_SESSION_ID = /^[A-Za-z0-9._-]{8,120}$/;
const SAFE_CONVERSATION_ID = /^[A-Za-z0-9._-]{1,120}$/;
const SAFE_PROOF = /^[A-Za-z0-9._-]{16,2048}$/;
const SAFE_DIGEST = /^[a-f0-9]{64}$/;

function calculateUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export async function verifyOutboxEntryDigest(
  entry: WindDownVoiceOutboxEntry,
): Promise<boolean> {
  try {
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(entry.report)),
    );
    const calculated = [...new Uint8Array(bytes)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return calculated === entry.finalDigest;
  } catch {
    return false;
  }
}

export function isValidOutboxEntry(value: unknown): value is WindDownVoiceOutboxEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return (
    source.schemaVersion === 1 &&
    typeof source.productSessionId === "string" &&
    SAFE_PRODUCT_SESSION_ID.test(source.productSessionId) &&
    (source.activity === "roleplay" || source.activity === "live-talk") &&
    typeof source.finalDigest === "string" &&
    SAFE_DIGEST.test(source.finalDigest) &&
    typeof source.stagedAtIso === "string" &&
    Number.isFinite(Date.parse(source.stagedAtIso)) &&
    typeof source.attempts === "number" &&
    Number.isSafeInteger(source.attempts) && source.attempts >= 0 &&
    (source.lastError === undefined || typeof source.lastError === "string") &&
    isWindDownVoiceReport(source.report) &&
    source.report.productSessionId === source.productSessionId &&
    source.report.activity === source.activity
  );
}

function isValidCheckpointTurn(
  turn: unknown,
  conversationIds: string[],
): turn is WindDownVoiceFinalizedTurn {
  if (!turn || typeof turn !== "object" || Array.isArray(turn)) return false;
  const source = turn as Record<string, unknown>;
  if (
    typeof source.conversationId !== "string" ||
    !conversationIds.includes(source.conversationId) ||
    typeof source.turnSeq !== "number" ||
    !Number.isSafeInteger(source.turnSeq) ||
    source.turnSeq < 1 ||
    (source.userText !== null && (typeof source.userText !== "string" || source.userText.length > 640)) ||
    (source.modelText !== null && (typeof source.modelText !== "string" || source.modelText.length > 640)) ||
    source.finalized !== true ||
    (source.sttDrift !== undefined && typeof source.sttDrift !== "boolean") ||
    typeof source.interrupted !== "boolean"
  ) {
    return false;
  }

  if (source.correctionText !== undefined && source.correctionText !== null) {
    if (
      typeof source.correctionText !== "string" ||
      source.correctionText.length > 240 ||
      !(typeof source.modelText === "string" && source.modelText.includes(source.correctionText))
    ) {
      return false;
    }
  }

  return true;
}

export function isValidCheckpoint(
  value: unknown,
): value is WindDownVoiceSessionCheckpoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  if (
    source.schemaVersion !== 1 ||
    typeof source.productSessionId !== "string" ||
    !SAFE_PRODUCT_SESSION_ID.test(source.productSessionId) ||
    (source.activity !== "roleplay" && source.activity !== "live-talk") ||
    !Array.isArray(source.conversationIds) ||
    source.conversationIds.length === 0 ||
    source.conversationIds.length > 5 ||
    new Set(source.conversationIds).size !== source.conversationIds.length ||
    !source.conversationIds.every(
      (id) => typeof id === "string" && SAFE_CONVERSATION_ID.test(id),
    ) ||
    !Array.isArray(source.sessionProofs) ||
    source.sessionProofs.length !== source.conversationIds.length ||
    !source.sessionProofs.every(
      (proof) => typeof proof === "string" && SAFE_PROOF.test(proof),
    ) ||
    !isWindDownVoiceDescriptor(source.descriptor) ||
    source.descriptor.activity !== source.activity ||
    typeof source.startedAtIso !== "string" ||
    !Number.isFinite(Date.parse(source.startedAtIso)) ||
    typeof source.checkpointAtIso !== "string" ||
    !Number.isFinite(Date.parse(source.checkpointAtIso)) ||
    !source.metrics ||
    typeof source.metrics !== "object" ||
    !(typeof (source.metrics as Record<string, unknown>).turnCount === "number" && Number.isSafeInteger((source.metrics as Record<string, unknown>).turnCount) && ((source.metrics as Record<string, unknown>).turnCount as number) >= 0) ||
    !(typeof (source.metrics as Record<string, unknown>).interruptionCount === "number" && Number.isSafeInteger((source.metrics as Record<string, unknown>).interruptionCount) && ((source.metrics as Record<string, unknown>).interruptionCount as number) >= 0) ||
    !Array.isArray(source.turns) ||
    source.turns.length > 24
  ) {
    return false;
  }

  const conversationIds = source.conversationIds as string[];
  const turns = source.turns as unknown[];
  const seenTurnKeys = new Set<string>();
  for (const turn of turns) {
    if (!isValidCheckpointTurn(turn, conversationIds)) return false;
    const turnKey = `${turn.conversationId}:${turn.turnSeq}`;
    if (seenTurnKeys.has(turnKey)) return false;
    seenTurnKeys.add(turnKey);
  }

  return true;
}

export function readWindDownVoiceOutbox(storage: StorageLike): OutboxReadResult {
  let raw: string | null = null;
  try {
    raw = storage.getItem(WIND_DOWN_VOICE_OUTBOX_STORAGE_KEY);
  } catch (error) {
    return {
      status: "storage-unavailable",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (raw === null) {
    return { status: "empty" };
  }

  if (calculateUtf8ByteLength(raw) > WIND_DOWN_VOICE_OUTBOX_MAX_BYTES) {
    return { status: "corrupt", raw, error: "recovery_payload_too_large" };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!isValidOutboxEntry(parsed)) {
      return {
        status: "corrupt",
        raw,
        error: "invalid_outbox_schema",
      };
    }
    return { status: "valid", entry: parsed };
  } catch (error) {
    return {
      status: "corrupt",
      raw,
      error: error instanceof Error ? error.message : "json_parse_failure",
    };
  }
}

export function saveWindDownVoiceOutbox(
  storage: StorageLike,
  entry: WindDownVoiceOutboxEntry,
): OutboxSaveResult {
  if (!isValidOutboxEntry(entry)) {
    return { ok: false, code: "INVALID_OUTBOX_ENTRY" };
  }

  const existing = readWindDownVoiceOutbox(storage);
  if (existing.status === "storage-unavailable") {
    return { ok: false, code: "STORAGE_UNAVAILABLE", error: existing.error };
  }
  if (existing.status === "corrupt") {
    return {
      ok: false,
      code: "OUTBOX_CORRUPT_BYTES_RETAINED",
      raw: existing.raw,
    };
  }
  if (existing.status === "valid") {
    if (existing.entry.productSessionId !== entry.productSessionId) {
      return {
        ok: false,
        code: "OUTBOX_OCCUPIED_BY_DIFFERENT_SESSION",
        existingSessionId: existing.entry.productSessionId,
      };
    }
    if (existing.entry.finalDigest !== entry.finalDigest) {
      return {
        ok: false,
        code: "OUTBOX_DIGEST_CONFLICT",
        existingDigest: existing.entry.finalDigest,
      };
    }
  }

  const serialized = JSON.stringify(entry);
  const byteLength = calculateUtf8ByteLength(serialized);
  if (byteLength > WIND_DOWN_VOICE_OUTBOX_MAX_BYTES) {
    return { ok: false, code: "PAYLOAD_TOO_LARGE", byteLength };
  }

  try {
    storage.setItem(WIND_DOWN_VOICE_OUTBOX_STORAGE_KEY, serialized);
    if (storage.getItem(WIND_DOWN_VOICE_OUTBOX_STORAGE_KEY) !== serialized) throw new Error("outbox_readback_failed");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      code: "STORAGE_UNAVAILABLE",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function acknowledgeWindDownVoiceOutbox(
  storage: StorageLike,
  ack: {
    productSessionId: string;
    activity: WindDownVoiceActivity;
    finalDigest: string;
  },
): OutboxAckResult {
  const current = readWindDownVoiceOutbox(storage);
  if (current.status === "storage-unavailable") {
    return { ok: false, code: "STORAGE_UNAVAILABLE", error: current.error };
  }
  if (current.status === "empty") {
    return { ok: false, code: "NO_OUTBOX" };
  }
  if (current.status === "corrupt") {
    return { ok: false, code: "OUTBOX_CORRUPT", raw: current.raw };
  }

  const { entry } = current;
  if (
    entry.productSessionId !== ack.productSessionId ||
    entry.activity !== ack.activity ||
    entry.finalDigest !== ack.finalDigest
  ) {
    return {
      ok: false,
      code: "ACKNOWLEDGMENT_MISMATCH",
      expected: {
        productSessionId: entry.productSessionId,
        activity: entry.activity,
        finalDigest: entry.finalDigest,
      },
    };
  }

  try {
    const checkpoint = readWindDownVoiceCheckpoint(storage);
    const frozen = readWindDownVoiceFrozen(storage);
    if (checkpoint.status === "storage-unavailable" || frozen.status === "storage-unavailable") {
      throw new Error("recovery_read_unavailable");
    }
    if (checkpoint.status === "valid" && checkpoint.checkpoint.productSessionId === ack.productSessionId) {
      const canonicalTurn = (turn: WindDownVoiceFinalizedTurn) => ({
        conversationId: turn.conversationId, turnSeq: turn.turnSeq,
        userText: turn.userText?.trim().replace(/\s+/g, " ") ?? null,
        modelText: turn.modelText?.trim().replace(/\s+/g, " ") ?? null,
        finalized: turn.finalized, sttDrift: turn.sttDrift === true, interrupted: turn.interrupted === true,
        correctionText: turn.correctionText?.trim().replace(/\s+/g, " ") || null,
      });
      const fits = checkpoint.checkpoint.turns.length <= entry.report.turns.length
        && checkpoint.checkpoint.turns.every((turn, index) => entry.report.turns[index]
          && JSON.stringify(canonicalTurn(turn)) === JSON.stringify(canonicalTurn(entry.report.turns[index])));
      if (!fits) throw new Error("checkpoint_changed_after_report");
      storage.removeItem(WIND_DOWN_VOICE_CHECKPOINT_STORAGE_KEY);
      if (storage.getItem(WIND_DOWN_VOICE_CHECKPOINT_STORAGE_KEY) !== null) throw new Error("checkpoint_cleanup_failed");
    }
    if (frozen.status === "valid" && frozen.report.productSessionId === ack.productSessionId) {
      if (JSON.stringify(frozen.report) !== JSON.stringify(entry.report)) throw new Error("frozen_changed_after_report");
      storage.removeItem(WIND_DOWN_VOICE_FROZEN_STORAGE_KEY);
      if (storage.getItem(WIND_DOWN_VOICE_FROZEN_STORAGE_KEY) !== null) throw new Error("frozen_cleanup_failed");
    }
    // Delete the exact acknowledged outbox last, keeping a retry anchor if cleanup fails.
    storage.removeItem(WIND_DOWN_VOICE_OUTBOX_STORAGE_KEY);
    if (storage.getItem(WIND_DOWN_VOICE_OUTBOX_STORAGE_KEY) !== null) throw new Error("outbox_cleanup_failed");
  } catch (error) {
    return { ok: false, code: "CLEANUP_FAILED", error: error instanceof Error ? error.message : String(error) };
  }

  return { ok: true };
}

export function readWindDownVoiceCheckpoint(
  storage: StorageLike,
): CheckpointReadResult {
  let raw: string | null = null;
  try {
    raw = storage.getItem(WIND_DOWN_VOICE_CHECKPOINT_STORAGE_KEY);
  } catch (error) {
    return {
      status: "storage-unavailable",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (raw === null) {
    return { status: "empty" };
  }

  if (calculateUtf8ByteLength(raw) > WIND_DOWN_VOICE_OUTBOX_MAX_BYTES) {
    return { status: "corrupt", raw, error: "recovery_payload_too_large" };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!isValidCheckpoint(parsed)) {
      return {
        status: "corrupt",
        raw,
        error: "invalid_checkpoint_schema",
      };
    }
    return { status: "valid", checkpoint: parsed };
  } catch (error) {
    return {
      status: "corrupt",
      raw,
      error: error instanceof Error ? error.message : "json_parse_failure",
    };
  }
}

export function saveWindDownVoiceCheckpoint(
  storage: StorageLike,
  checkpoint: WindDownVoiceSessionCheckpoint,
): CheckpointSaveResult {
  if (!isValidCheckpoint(checkpoint)) {
    return { ok: false, code: "CHECKPOINT_INVALID", error: "schema_mismatch" };
  }

  const outbox = readWindDownVoiceOutbox(storage);
  if (outbox.status === "storage-unavailable") return { ok: false, code: "STORAGE_UNAVAILABLE", error: outbox.error };
  if (outbox.status === "corrupt") {
    return {
      ok: false,
      code: "OUTBOX_CORRUPT_BYTES_RETAINED",
      raw: outbox.raw,
    };
  }
  if (
    outbox.status === "valid" &&
    outbox.entry.productSessionId !== checkpoint.productSessionId
  ) {
    return {
      ok: false,
      code: "OUTBOX_OCCUPIED_BY_DIFFERENT_SESSION",
      existingSessionId: outbox.entry.productSessionId,
    };
  }

  const current = readWindDownVoiceCheckpoint(storage);
  if (current.status === "storage-unavailable") return { ok: false, code: "STORAGE_UNAVAILABLE", error: current.error };
  if (current.status === "corrupt") {
    return {
      ok: false,
      code: "CHECKPOINT_CORRUPT_BYTES_RETAINED",
      raw: current.raw,
    };
  }
  if (current.status === "valid") {
    const existing = current.checkpoint;
    if (existing.productSessionId !== checkpoint.productSessionId) {
      return {
        ok: false,
        code: "CHECKPOINT_OCCUPIED_BY_DIFFERENT_SESSION",
        existingSessionId: existing.productSessionId,
      };
    }
    // Must never replace a longer checkpoint with fewer turns
    if (existing.turns.length > checkpoint.turns.length) {
      return {
        ok: false,
        code: "CHECKPOINT_REGRESSION_REJECTED",
        existingCount: existing.turns.length,
        newCount: checkpoint.turns.length,
      };
    }
    // Must not diverge earlier confirmed turns
    for (let i = 0; i < existing.turns.length; i++) {
      const eTurn = existing.turns[i];
      const nTurn = checkpoint.turns[i];
      if (
        JSON.stringify(eTurn) !== JSON.stringify(nTurn)
      ) {
        return {
          ok: false,
          code: "CHECKPOINT_HISTORY_DIVERGED",
          turnSeq: eTurn.turnSeq,
        };
      }
    }
  }

  const serialized = JSON.stringify(checkpoint);
  const byteLength = calculateUtf8ByteLength(serialized);
  if (byteLength > WIND_DOWN_VOICE_OUTBOX_MAX_BYTES) {
    return { ok: false, code: "CHECKPOINT_TOO_LARGE", byteLength };
  }

  try {
    storage.setItem(WIND_DOWN_VOICE_CHECKPOINT_STORAGE_KEY, serialized);
    if (storage.getItem(WIND_DOWN_VOICE_CHECKPOINT_STORAGE_KEY) !== serialized) throw new Error("checkpoint_readback_failed");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      code: "STORAGE_UNAVAILABLE",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function clearWindDownVoiceCheckpoint(
  storage: StorageLike,
  productSessionId: string,
): void {
  try {
    const current = readWindDownVoiceCheckpoint(storage);
    if (
      current.status === "valid" &&
      current.checkpoint.productSessionId === productSessionId
    ) {
      storage.removeItem(WIND_DOWN_VOICE_CHECKPOINT_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors on clear
  }
}

export function buildWindDownVoiceReportFromCheckpoint(
  checkpoint: WindDownVoiceSessionCheckpoint,
  completionReason: WindDownVoiceCompletionReason,
  stoppedAtIso: string,
): WindDownVoiceReport {
  return buildWindDownVoiceReport({
    schemaVersion: 1,
    activity: checkpoint.activity,
    productSessionId: checkpoint.productSessionId,
    descriptor: checkpoint.descriptor,
    conversationIds: checkpoint.conversationIds,
    sessionProofs: checkpoint.sessionProofs,
    startedAtIso: checkpoint.startedAtIso,
    stoppedAtIso,
    completionReason,
    turns: checkpoint.turns,
    metrics: checkpoint.metrics,
  });
}

export function readWindDownVoiceFrozen(storage: StorageLike): FrozenReadResult {
  let raw: string | null = null;
  try {
    raw = storage.getItem(WIND_DOWN_VOICE_FROZEN_STORAGE_KEY);
  } catch (err) {
    return {
      status: "storage-unavailable",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (raw === null) {
    return { status: "empty" };
  }

  if (calculateUtf8ByteLength(raw) > WIND_DOWN_VOICE_OUTBOX_MAX_BYTES) {
    return { status: "corrupt", raw, error: "recovery_payload_too_large" };
  }
  try {
    const parsed = JSON.parse(raw);
    if (isWindDownVoiceReport(parsed)) {
      return { status: "valid", report: parsed };
    }
    return {
      status: "corrupt",
      raw,
      error: "parsed JSON does not match WindDownVoiceReport schema",
    };
  } catch (err) {
    return {
      status: "corrupt",
      raw,
      error: err instanceof Error ? err.message : "JSON parse error",
    };
  }
}

export function saveWindDownVoiceFrozen(
  storage: StorageLike,
  report: WindDownVoiceReport,
): FrozenSaveResult {
  if (!isWindDownVoiceReport(report)) {
    return { ok: false, code: "INVALID_REPORT" };
  }

  const existing = readWindDownVoiceFrozen(storage);
  if (existing.status === "storage-unavailable") {
    return { ok: false, code: "STORAGE_UNAVAILABLE", error: existing.error };
  }
  if (
    existing.status === "valid" &&
    existing.report.productSessionId !== report.productSessionId
  ) {
    return {
      ok: false,
      code: "FROZEN_OCCUPIED_BY_DIFFERENT_SESSION",
      existingSessionId: existing.report.productSessionId,
    };
  }

  if (existing.status === "corrupt") return { ok: false, code: "FROZEN_CORRUPT_BYTES_RETAINED" };
  const serialized = JSON.stringify(report);
  if (existing.status === "valid" && JSON.stringify(existing.report) !== serialized) return { ok: false, code: "FROZEN_CONFLICT" };
  const outbox = readWindDownVoiceOutbox(storage);
  if (outbox.status === "storage-unavailable") return { ok: false, code: "STORAGE_UNAVAILABLE", error: outbox.error };
  if (outbox.status === "corrupt" || (outbox.status === "valid" && JSON.stringify(outbox.entry.report) !== serialized)) return { ok: false, code: "FROZEN_CONFLICT" };
  const byteLength = calculateUtf8ByteLength(serialized);
  if (byteLength > WIND_DOWN_VOICE_OUTBOX_MAX_BYTES) {
    return { ok: false, code: "PAYLOAD_TOO_LARGE", byteLength };
  }

  try {
    storage.setItem(WIND_DOWN_VOICE_FROZEN_STORAGE_KEY, serialized);
    const readBack = storage.getItem(WIND_DOWN_VOICE_FROZEN_STORAGE_KEY);
    if (readBack !== serialized) {
      return {
        ok: false,
        code: "STORAGE_UNAVAILABLE",
        error: "read-back verification failed",
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      code: "STORAGE_UNAVAILABLE",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function clearWindDownVoiceFrozen(
  storage: StorageLike,
  productSessionId: string,
): void {
  try {
    const current = readWindDownVoiceFrozen(storage);
    if (
      current.status === "valid" &&
      current.report.productSessionId === productSessionId
    ) {
      storage.removeItem(WIND_DOWN_VOICE_FROZEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors on clear
  }
}

export function createWindDownVoiceRecoveryDraft(
  payload:
    | WindDownVoiceOutboxEntry
    | WindDownVoiceSessionCheckpoint
    | WindDownVoiceReport
    | { format: string; raw: string }
    | Record<string, unknown>,
): string {
  return JSON.stringify(
    {
      format: "winddown-voice-recovery-draft-v1",
      exportedAtIso: new Date().toISOString(),
      payload,
    },
    null,
    2,
  );
}


// Keep unresolved browser records accessible while freeing the current session slot.
// This copies and verifies exact bytes first; it never discards a learner record.
export const WIND_DOWN_VOICE_RETAINED_STORAGE_KEY = "winddown:voice_retained:v1";
const ACTIVE_RECOVERY_KEYS = [WIND_DOWN_VOICE_OUTBOX_STORAGE_KEY, WIND_DOWN_VOICE_FROZEN_STORAGE_KEY, WIND_DOWN_VOICE_CHECKPOINT_STORAGE_KEY] as const;
export function retainWindDownVoiceRecovery(storage: StorageLike, pending?: WindDownVoiceReport | Record<string, unknown> | null): { ok: true } | { ok: false; error: string } {
  try {
    const entries: Array<{key: string; value: string}> = ACTIVE_RECOVERY_KEYS.flatMap(key => {
      const value = storage.getItem(key);
      return value === null ? [] : [{ key, value }];
    });
    if (pending) entries.push({ key: "in-memory-report", value: JSON.stringify(pending) });
    if (entries.length === 0) return { ok: true };
    const raw = storage.getItem(WIND_DOWN_VOICE_RETAINED_STORAGE_KEY);
    const archive = raw === null ? { schemaVersion: 1, entries: [] } : JSON.parse(raw);
    if (!archive || archive.schemaVersion !== 1 || !Array.isArray(archive.entries)
      || !archive.entries.every((batch: unknown) => Array.isArray(batch) && batch.every(row => row && typeof row.key === "string" && typeof row.value === "string"))) {
      throw new Error("retained_archive_unreadable");
    }
    if (!archive.entries.some((batch: unknown) => JSON.stringify(batch) === JSON.stringify(entries))) archive.entries.push(entries);
    if (archive.entries.length > 8) throw new Error("retained_archive_full");
    const serialized = JSON.stringify(archive);
    if (calculateUtf8ByteLength(serialized) > 4 * 1024 * 1024) throw new Error("retained_archive_full");
    storage.setItem(WIND_DOWN_VOICE_RETAINED_STORAGE_KEY, serialized);
    if (storage.getItem(WIND_DOWN_VOICE_RETAINED_STORAGE_KEY) !== serialized) throw new Error("retained_archive_readback_failed");
    for (const entry of entries) {
      if (entry.key === "in-memory-report") continue;
      if (storage.getItem(entry.key) !== entry.value) throw new Error("active_recovery_changed");
      storage.removeItem(entry.key);
      if (storage.getItem(entry.key) !== null) throw new Error("active_recovery_cleanup_failed");
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "retention_unavailable" };
  }
}
