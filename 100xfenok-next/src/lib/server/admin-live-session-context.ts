import {
  DEFAULT_COACH_CONFIG,
  normalizeCoachConfig,
  type CoachConfig,
} from "@/lib/admin-live-coach-config";

export type LiveToolSessionContext = {
  sessionId: string | null;
  mode: "fenok" | "mona";
  coachConfig: CoachConfig;
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
    registeredAt: Date.now(),
  });
  pruneSessionContexts();
}

export function resolveLiveToolSessionContext(value: unknown): LiveToolSessionContext {
  const input = isRecord(value) ? value : {};
  const sessionId = normalizeSessionId(input.sessionId);
  if (sessionId && sessionContexts.has(sessionId)) {
    const stored = sessionContexts.get(sessionId);
    if (stored) return stored;
  }

  return {
    sessionId,
    mode: normalizeMode(input.mode),
    coachConfig: normalizeCoachConfig(input.coachConfig ?? DEFAULT_COACH_CONFIG),
  };
}

export function getRegisteredLiveToolSessionContext(sessionId: unknown): LiveToolSessionContext | null {
  const normalized = normalizeSessionId(sessionId);
  if (!normalized) return null;
  return sessionContexts.get(normalized) ?? null;
}
