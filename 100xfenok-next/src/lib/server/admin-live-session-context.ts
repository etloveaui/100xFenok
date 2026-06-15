import {
  DEFAULT_COACH_CONFIG,
  normalizeCoachConfig,
  type CoachConfig,
} from "@/lib/admin-live-coach-config";
import type { CoachSessionState } from "@/lib/server/mona-study-tools";

export type LiveToolSessionContext = {
  sessionId: string | null;
  coachSessionKey?: string | null;
  mode: "fenok" | "mona";
  coachConfig: CoachConfig;
  coachSessionState?: CoachSessionState | null;
  noPersist?: boolean;
};

const MAX_CONTEXTS = 40;
const sessionContexts = new Map<string, LiveToolSessionContext & { registeredAt: number }>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeMode(value: unknown): "fenok" | "mona" {
  return value === "mona" ? "mona" : "fenok";
}

function normalizeSessionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) return null;
  return trimmed.replace(/[^A-Za-z0-9._-]/g, "-");
}

function normalizeKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/\s+/g, " ");
  return key ? key.slice(0, 160) : null;
}

function normalizeKeyArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const item of value) {
    const key = normalizeKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
    if (keys.length >= 48) break;
  }
  return keys;
}

function normalizeNoPersist(value: unknown): boolean | undefined {
  return value === true ? true : undefined;
}

function normalizeCoachSessionState(value: unknown, fallbackSessionId: string | null): CoachSessionState | null {
  if (!isRecord(value)) return null;
  return {
    sessionId: normalizeSessionId(value.sessionId) ?? fallbackSessionId,
    currentItemKey: normalizeKey(value.currentItemKey),
    seenItemKeys: normalizeKeyArray(value.seenItemKeys),
    bufferedItemKeys: normalizeKeyArray(value.bufferedItemKeys),
    lastLearnerIntent: typeof value.lastLearnerIntent === "string" ? value.lastLearnerIntent.slice(0, 40) : null,
    lastToolIntent: typeof value.lastToolIntent === "string" ? value.lastToolIntent.slice(0, 40) : null,
    reviewCountActual: typeof value.reviewCountActual === "number" && Number.isFinite(value.reviewCountActual)
      ? Math.max(0, Math.round(value.reviewCountActual))
      : 0,
    newCountActual: typeof value.newCountActual === "number" && Number.isFinite(value.newCountActual)
      ? Math.max(0, Math.round(value.newCountActual))
      : 0,
  };
}

function pruneSessionContexts() {
  if (sessionContexts.size <= MAX_CONTEXTS) return;
  const entries = [...sessionContexts.entries()].sort((a, b) => a[1].registeredAt - b[1].registeredAt);
  for (const [key] of entries.slice(0, Math.max(0, entries.length - MAX_CONTEXTS))) {
    sessionContexts.delete(key);
  }
}

export function registerLiveToolSessionContext(context: LiveToolSessionContext) {
  if (!context.sessionId) return;
  sessionContexts.set(context.sessionId, {
    ...context,
    coachSessionKey: context.coachSessionKey ?? context.sessionId,
    registeredAt: Date.now(),
  });
  pruneSessionContexts();
}

export function resolveLiveToolSessionContext(value: unknown): LiveToolSessionContext {
  const input = isRecord(value) ? value : {};
  const sessionId = normalizeSessionId(input.sessionId);
  const coachSessionStateInput = isRecord(input.coachSessionState) ? input.coachSessionState : null;
  const coachSessionKey = normalizeSessionId(input.coachSessionKey)
    ?? normalizeSessionId(input.logSessionId)
    ?? normalizeSessionId(input.conversationId)
    ?? normalizeSessionId(coachSessionStateInput?.sessionId)
    ?? sessionId;
  if (sessionId && sessionContexts.has(sessionId)) {
    const stored = sessionContexts.get(sessionId);
    if (stored) {
      return {
        ...stored,
        coachSessionKey: coachSessionKey ?? stored.coachSessionKey ?? stored.sessionId,
        coachConfig: normalizeCoachConfig(input.coachConfig ?? stored.coachConfig ?? DEFAULT_COACH_CONFIG),
        coachSessionState: normalizeCoachSessionState(input.coachSessionState, coachSessionKey ?? sessionId)
          ?? stored.coachSessionState
          ?? null,
        noPersist: normalizeNoPersist(input.noPersist) ?? stored.noPersist,
      };
    }
  }

  return {
    sessionId,
    coachSessionKey,
    mode: normalizeMode(input.mode),
    coachConfig: normalizeCoachConfig(input.coachConfig ?? DEFAULT_COACH_CONFIG),
    coachSessionState: normalizeCoachSessionState(input.coachSessionState, coachSessionKey ?? sessionId),
    noPersist: normalizeNoPersist(input.noPersist),
  };
}

export function getRegisteredLiveToolSessionContext(sessionId: unknown): LiveToolSessionContext | null {
  const normalized = normalizeSessionId(sessionId);
  if (!normalized) return null;
  return sessionContexts.get(normalized) ?? null;
}
