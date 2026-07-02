import path from "node:path";
import {
  MONA_VNEXT_DATA_NAMESPACE,
} from "@/features/mona-vnext/memory/monaVnextNamespace";
import type {
  MonaVnextCorrectionCandidate,
  MonaVnextMasteryEvent,
} from "@/features/mona-vnext/memory/srsBridge";
import type { MonaVnextSrsAdvisory } from "@/features/mona-vnext/memory/srsAdvisory";
import { createMonaVnextObjectStore } from "@/features/mona-vnext/storage/objectStore";

type MemoryCheckpoint = {
  conversationId: string;
  turnSeq: number;
  savedAt: string;
  advisory: MonaVnextSrsAdvisory;
};

const MEMORY_DIR = path.join("data", MONA_VNEXT_DATA_NAMESPACE, "owner-test");
const chains = new Map<string, Promise<void>>();

function safeSegment(value: unknown, fallback: string) {
  const source = typeof value === "string" && value.trim() ? value.trim() : fallback;
  const sanitized = source.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 100);
  return sanitized || fallback;
}

function normalizeStringArray(value: unknown, maxItems = 12) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => typeof item === "string" ? item.trim().replace(/\s+/g, " ") : "")
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeMasteryEvents(value: unknown): MonaVnextMasteryEvent[] {
  if (!Array.isArray(value)) return [];
  const events: MonaVnextMasteryEvent[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    let verdict: MonaVnextMasteryEvent["verdict"];
    if (record.verdict === "canonical") {
      verdict = "canonical";
    } else if (record.verdict === "variant") {
      verdict = "variant";
    } else {
      continue;
    }
    const event: MonaVnextMasteryEvent = {
      expressionId: typeof record.expressionId === "string" ? record.expressionId.trim().slice(0, 120) : "",
      verdict,
      atIso: typeof record.atIso === "string" ? record.atIso.trim().slice(0, 80) : "",
      sessionId: typeof record.sessionId === "string" ? record.sessionId.trim().slice(0, 120) : "",
    };
    if (event.expressionId && event.atIso && event.sessionId) events.push(event);
    if (events.length >= 20) break;
  }
  return events;
}

function normalizeCorrectionCandidates(value: unknown): MonaVnextCorrectionCandidate[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      expressionId: typeof item.expressionId === "string" ? item.expressionId.trim().slice(0, 120) : "",
      learnerText: typeof item.learnerText === "string" ? item.learnerText.trim().replace(/\s+/g, " ").slice(0, 400) : "",
      suggestion: typeof item.suggestion === "string" ? item.suggestion.trim().replace(/\s+/g, " ").slice(0, 400) : "",
      atIso: typeof item.atIso === "string" ? item.atIso.trim().slice(0, 80) : "",
      sessionId: typeof item.sessionId === "string" ? item.sessionId.trim().slice(0, 120) : "",
    }))
    .filter((item) => item.expressionId && item.learnerText && item.suggestion && item.atIso && item.sessionId)
    .slice(0, 20);
}

function normalizeAdvisory(value: unknown): MonaVnextSrsAdvisory {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const weak = Array.isArray(record.weakNoteCandidates)
    ? record.weakNoteCandidates
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      .map((item) => ({
        ko: typeof item.ko === "string" ? item.ko.trim().replace(/\s+/g, " ").slice(0, 240) : "",
        reason: typeof item.reason === "string" ? item.reason.trim().replace(/\s+/g, " ").slice(0, 80) : "unspecified",
      }))
      .filter((item) => item.ko)
      .slice(0, 8)
    : [];

  return {
    best3Candidates: normalizeStringArray(record.best3Candidates, 3),
    weakNoteCandidates: weak,
    nextSessionSuggestions: normalizeStringArray(record.nextSessionSuggestions, 6),
    masteryEvents: normalizeMasteryEvents(record.masteryEvents),
    correctionCandidates: normalizeCorrectionCandidates(record.correctionCandidates),
  };
}

export async function appendMonaVnextMemoryCheckpoint(args: Record<string, unknown>) {
  const conversationId = safeSegment(args.conversationId, `mona-vnext-${Date.now().toString(36)}`);
  const turnSeq = typeof args.turnSeq === "number" && Number.isFinite(args.turnSeq)
    ? Math.max(0, Math.round(args.turnSeq))
    : 0;
  const savedAt = new Date().toISOString();
  const checkpoint: MemoryCheckpoint = {
    conversationId,
    turnSeq,
    savedAt,
    advisory: normalizeAdvisory(args.advisory),
  };

  const relPath = path.join(MEMORY_DIR, `${conversationId}.json`);
  const prev = chains.get(relPath) ?? Promise.resolve();
  const current = prev.then(async () => {
    const store = await createMonaVnextObjectStore();
    let doc: Record<string, unknown> = {
      schemaVersion: 1,
      source: "mona-vnext-memory-advisory",
      namespace: MONA_VNEXT_DATA_NAMESPACE,
      tester: "owner",
      conversationId,
      productionWriteEnabled: false,
      checkpoints: [],
    };

    try {
      const raw = await store.readText(relPath);
      const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) doc = parsed;
    } catch {
      // Missing file starts a new advisory doc.
    }

    const checkpoints = Array.isArray(doc.checkpoints) ? doc.checkpoints : [];
    const payload = {
      ...doc,
      schemaVersion: 1,
      source: "mona-vnext-memory-advisory",
      namespace: MONA_VNEXT_DATA_NAMESPACE,
      tester: "owner",
      conversationId,
      productionWriteEnabled: false,
      savedAt,
      checkpoints: [...checkpoints, checkpoint].slice(-200),
    };

    const raw = `${JSON.stringify(payload, null, 2)}\n`;
    await store.writeText(relPath, raw);
    return {
      ok: true,
      file: relPath,
      backend: store.backend,
      conversationId,
      turnSeq,
      checkpointCount: payload.checkpoints.length,
    };
  });

  chains.set(relPath, current.then(() => {}, () => {}));
  return current;
}

export async function readMonaVnextMemorySummary() {
  const store = await createMonaVnextObjectStore();
  const files = await store.listJson(MEMORY_DIR);
  const summaries: Array<{
    conversationId: string;
    savedAt: string | null;
    checkpointCount: number;
    best3Candidates: string[];
    weakNoteCount: number;
    nextSessionSuggestions: string[];
    masteryEventCount: number;
    correctionCandidateCount: number;
  }> = [];

  for (const file of files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 20)) {
    try {
      const raw = await store.readText(file.relPath);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const checkpoints = Array.isArray(parsed.checkpoints) ? parsed.checkpoints : [];
      const last = checkpoints.at(-1);
      const lastRecord = last && typeof last === "object" && !Array.isArray(last)
        ? last as Record<string, unknown>
        : {};
      const advisory = lastRecord.advisory && typeof lastRecord.advisory === "object" && !Array.isArray(lastRecord.advisory)
        ? lastRecord.advisory as Record<string, unknown>
        : {};
      summaries.push({
        conversationId: typeof parsed.conversationId === "string" ? parsed.conversationId : file.name.replace(/\.json$/, ""),
        savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : null,
        checkpointCount: checkpoints.length,
        best3Candidates: normalizeStringArray(advisory.best3Candidates, 3),
        weakNoteCount: Array.isArray(advisory.weakNoteCandidates) ? advisory.weakNoteCandidates.length : 0,
        nextSessionSuggestions: normalizeStringArray(advisory.nextSessionSuggestions, 6),
        masteryEventCount: Array.isArray(advisory.masteryEvents) ? advisory.masteryEvents.length : 0,
        correctionCandidateCount: Array.isArray(advisory.correctionCandidates) ? advisory.correctionCandidates.length : 0,
      });
    } catch {
      // Ignore malformed owner-test advisory docs.
    }
  }

  return {
    namespace: MONA_VNEXT_DATA_NAMESPACE,
    tester: "owner",
    productionWriteEnabled: false,
    sessions: summaries.sort((a, b) => (b.savedAt ?? "").localeCompare(a.savedAt ?? "")),
  };
}
