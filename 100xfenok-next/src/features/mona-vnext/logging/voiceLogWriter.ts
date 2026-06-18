import path from "node:path";
import {
  MONA_VNEXT_LOG_SCHEMA_VERSION,
  scrubLearnerFacingText,
  type MonaVnextLogEvent,
  type MonaVnextVoiceLogDoc,
} from "@/features/mona-vnext/logging/voiceLogSchema";
import { MONA_VNEXT_LOG_NAMESPACE } from "@/features/mona-vnext/memory/monaVnextNamespace";
import { createMonaVnextObjectStore } from "@/features/mona-vnext/storage/objectStore";
import type { MonaVnextTurn } from "@/features/mona-vnext/transcript/turnBoundary";

const LOG_DIR = path.join("data", MONA_VNEXT_LOG_NAMESPACE, "owner-test");
const chains = new Map<string, Promise<void>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeSegment(value: unknown, fallback: string) {
  const source = typeof value === "string" && value.trim() ? value.trim() : fallback;
  const sanitized = source.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 110);
  return sanitized || fallback;
}

function normalizeIso(value: unknown) {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function normalizeTurn(value: unknown, conversationId: string): MonaVnextTurn | null {
  if (!isRecord(value)) return null;
  const turnSeq = typeof value.turnSeq === "number" && Number.isFinite(value.turnSeq)
    ? Math.max(1, Math.round(value.turnSeq))
    : null;
  if (turnSeq === null) return null;
  const startedAtIso = normalizeIso(value.startedAtIso) ?? new Date().toISOString();
  const completedAtIso = normalizeIso(value.completedAtIso) ?? startedAtIso;
  const userText = scrubLearnerFacingText(typeof value.userText === "string" ? value.userText : null);
  const modelText = scrubLearnerFacingText(typeof value.modelText === "string" ? value.modelText : null);
  if (!userText && !modelText) return null;

  return {
    conversationId,
    turnSeq,
    userText,
    modelText,
    intent: value.intent === "next_material"
      || value.intent === "english_visibility"
      || value.intent === "hold_current"
      || value.intent === "difficulty"
      || value.intent === "repair"
      || value.intent === "meta_question"
      || value.intent === "stop"
      || value.intent === "lesson_attempt"
      ? value.intent
      : "unknown",
    sttDrift: value.sttDrift === true,
    interrupted: value.interrupted === true,
    startedAtIso,
    completedAtIso,
  };
}

function normalizeEvent(value: unknown): MonaVnextLogEvent | null {
  if (!isRecord(value)) return null;
  const type = typeof value.type === "string" && value.type.trim()
    ? value.type.trim().replace(/\s+/g, "-").slice(0, 80)
    : null;
  const message = typeof value.message === "string" && value.message.trim()
    ? value.message.trim().replace(/\s+/g, " ").slice(0, 500)
    : null;
  if (!type || !message) return null;
  return {
    type,
    message,
    atIso: normalizeIso(value.atIso) ?? new Date().toISOString(),
    ...(isRecord(value.detail) ? { detail: value.detail } : {}),
  };
}

function normalizeObject(value: unknown) {
  return isRecord(value) ? value : {};
}

function buildLearnerTranscript(turns: MonaVnextTurn[]) {
  return turns.flatMap((turn) => {
    const entries: MonaVnextVoiceLogDoc["learnerTranscript"] = [];
    if (turn.userText) {
      entries.push({
        speaker: "user",
        text: turn.userText,
        turnSeq: turn.turnSeq,
        atIso: turn.startedAtIso,
      });
    }
    if (turn.modelText) {
      entries.push({
        speaker: "model",
        text: turn.modelText,
        turnSeq: turn.turnSeq,
        atIso: turn.completedAtIso,
      });
    }
    return entries;
  });
}

export async function appendMonaVnextVoiceLog(args: Record<string, unknown>) {
  const now = new Date().toISOString();
  const conversationId = safeSegment(args.conversationId, `mona-vnext-${Date.now().toString(36)}`);
  const sessionId = safeSegment(args.sessionId, conversationId);
  const startedAt = normalizeIso(args.startedAt) ?? now;
  const final = args.final === true;
  const relPath = path.join(LOG_DIR, `${startedAt.slice(0, 10)}_mona-vnext_${conversationId}.json`);
  const prev = chains.get(relPath) ?? Promise.resolve();

  const current = prev.then(async () => {
    const store = await createMonaVnextObjectStore();
    let doc: MonaVnextVoiceLogDoc = {
      schemaVersion: MONA_VNEXT_LOG_SCHEMA_VERSION,
      source: "mona-vnext",
      namespace: MONA_VNEXT_LOG_NAMESPACE,
      tester: "owner",
      sessionId,
      conversationId,
      startedAt,
      savedAt: now,
      stoppedAt: null,
      settings: {},
      metrics: {},
      turns: [],
      learnerTranscript: [],
      events: [],
      finalized: false,
    };

    try {
      const previous = await store.readText(relPath);
      const parsed = previous ? JSON.parse(previous) as MonaVnextVoiceLogDoc : null;
      if (parsed?.source === "mona-vnext" && Array.isArray(parsed.turns)) {
        doc = parsed;
      }
    } catch {
      // Missing/corrupt log starts fresh; vNext is owner-test only.
    }

    const incomingTurns = Array.isArray(args.turns)
      ? args.turns.map((turn) => normalizeTurn(turn, conversationId)).filter((turn): turn is MonaVnextTurn => Boolean(turn))
      : normalizeTurn(args.turn, conversationId)
        ? [normalizeTurn(args.turn, conversationId) as MonaVnextTurn]
        : [];
    const bySeq = new Map<number, MonaVnextTurn>();
    for (const turn of doc.turns) bySeq.set(turn.turnSeq, turn);
    for (const turn of incomingTurns) bySeq.set(turn.turnSeq, turn);
    const turns = [...bySeq.values()].sort((a, b) => a.turnSeq - b.turnSeq).slice(-500);

    const incomingEvents = Array.isArray(args.events)
      ? args.events.map(normalizeEvent).filter((event): event is MonaVnextLogEvent => Boolean(event))
      : normalizeEvent(args.event)
        ? [normalizeEvent(args.event) as MonaVnextLogEvent]
        : [];
    const events = [...doc.events, ...incomingEvents].slice(-1000);

    const payload: MonaVnextVoiceLogDoc = {
      ...doc,
      schemaVersion: MONA_VNEXT_LOG_SCHEMA_VERSION,
      source: "mona-vnext",
      namespace: MONA_VNEXT_LOG_NAMESPACE,
      tester: "owner",
      sessionId,
      conversationId,
      startedAt: doc.startedAt || startedAt,
      savedAt: now,
      stoppedAt: final ? (normalizeIso(args.stoppedAt) ?? now) : doc.stoppedAt,
      settings: { ...normalizeObject(doc.settings), ...normalizeObject(args.settings) },
      metrics: { ...normalizeObject(doc.metrics), ...normalizeObject(args.metrics) },
      turns,
      learnerTranscript: buildLearnerTranscript(turns),
      events,
      finalized: final ? true : doc.finalized === true,
    };

    const raw = `${JSON.stringify(payload, null, 2)}\n`;
    await store.writeText(relPath, raw);
    return {
      ok: true,
      file: relPath,
      backend: store.backend,
      sessionId,
      conversationId,
      turnCount: payload.turns.length,
      learnerTranscriptCount: payload.learnerTranscript.length,
      eventCount: payload.events.length,
      finalized: payload.finalized,
    };
  });

  chains.set(relPath, current.then(() => {}, () => {}));
  return current;
}
