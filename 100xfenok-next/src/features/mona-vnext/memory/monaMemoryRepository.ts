import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MONA_VNEXT_DATA_NAMESPACE,
} from "@/features/mona-vnext/memory/monaVnextNamespace";
import type { MonaVnextSrsAdvisory } from "@/features/mona-vnext/memory/srsAdvisory";

type MemoryCheckpoint = {
  conversationId: string;
  turnSeq: number;
  savedAt: string;
  advisory: MonaVnextSrsAdvisory;
};

const MEMORY_ROOT = path.join(process.cwd(), "data", MONA_VNEXT_DATA_NAMESPACE, "owner-test");
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

  const filePath = path.join(MEMORY_ROOT, `${conversationId}.json`);
  const prev = chains.get(filePath) ?? Promise.resolve();
  const current = prev.then(async () => {
    await mkdir(MEMORY_ROOT, { recursive: true });
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
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
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

    const tmp = `${filePath}.tmp`;
    const raw = `${JSON.stringify(payload, null, 2)}\n`;
    await writeFile(tmp, raw, "utf8");
    await rename(tmp, filePath);
    return {
      ok: true,
      file: path.relative(process.cwd(), filePath),
      conversationId,
      turnSeq,
      checkpointCount: payload.checkpoints.length,
    };
  });

  chains.set(filePath, current.then(() => {}, () => {}));
  return current;
}

export async function readMonaVnextMemorySummary() {
  await mkdir(MEMORY_ROOT, { recursive: true });
  const files = await readdir(MEMORY_ROOT).catch(() => []);
  const summaries: Array<{
    conversationId: string;
    savedAt: string | null;
    checkpointCount: number;
    best3Candidates: string[];
    weakNoteCount: number;
    nextSessionSuggestions: string[];
  }> = [];

  for (const file of files.filter((item) => item.endsWith(".json")).slice(-20)) {
    const filePath = path.join(MEMORY_ROOT, file);
    try {
      const raw = await readFile(filePath, "utf8");
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
        conversationId: typeof parsed.conversationId === "string" ? parsed.conversationId : file.replace(/\.json$/, ""),
        savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : null,
        checkpointCount: checkpoints.length,
        best3Candidates: normalizeStringArray(advisory.best3Candidates, 3),
        weakNoteCount: Array.isArray(advisory.weakNoteCandidates) ? advisory.weakNoteCandidates.length : 0,
        nextSessionSuggestions: normalizeStringArray(advisory.nextSessionSuggestions, 6),
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
