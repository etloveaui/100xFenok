import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const VOICE_LOG_ROOT = path.join(process.cwd(), "data", "voice-logs");
const MAX_LOG_ENTRIES = 240;
const MAX_TEXT_LENGTH = 1400;
const MAX_PAYLOAD_BYTES = 128 * 1024;
const ROLE_SET = new Set(["system", "user", "bench", "tool", "error"]);

const appendChains = new Map<string, Promise<void>>();

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function normalizeIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

function normalizeMode(value: unknown): "fenok" | "mona" {
  return value === "mona" ? "mona" : "fenok";
}

function safeSegment(value: unknown, fallback: string): string {
  const source = typeof value === "string" && value.trim() ? value.trim() : fallback;
  const sanitized = source.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 90);
  return sanitized || fallback;
}

function pickPrimitiveObject(value: unknown, allowedKeys: string[]) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    allowedKeys
      .map((key) => [key, value[key]] as const)
      .filter(([, entry]) => (
        typeof entry === "string" ||
        typeof entry === "number" ||
        typeof entry === "boolean" ||
        entry === null
      )),
  );
}

function normalizeStringArray(value: unknown, maxItems = 24): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeText(item, 120))
    .filter((item): item is string => Boolean(item))
    .slice(0, maxItems);
}

function normalizeSettings(value: unknown) {
  const base = pickPrimitiveObject(value, [
    "lowVoice",
    "voiceName",
    "responseStyle",
    "vadPreset",
  ]);
  return {
    ...base,
    enabledToolIds: isRecord(value) ? normalizeStringArray(value.enabledToolIds) : [],
  };
}

function normalizeClient(value: unknown) {
  const base = pickPrimitiveObject(value, [
    "userAgent",
    "language",
    "platform",
    "screenWidth",
    "screenHeight",
    "viewportWidth",
    "viewportHeight",
    "devicePixelRatio",
  ]);
  return Object.fromEntries(
    Object.entries(base).map(([key, entry]) => [
      key,
      typeof entry === "string" ? entry.slice(0, 500) : entry,
    ]),
  );
}

function normalizeLogEntries(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((entry) => {
      const role = typeof entry.role === "string" && ROLE_SET.has(entry.role) ? entry.role : "system";
      const text = normalizeText(entry.text);
      if (!text) return null;
      return {
        role,
        text,
        at: normalizeText(entry.at, 80),
      };
    })
    .filter((entry): entry is { role: string; text: string; at: string | null } => Boolean(entry))
    .slice(-MAX_LOG_ENTRIES);
}

function normalizeAppendEntries(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((entry) => {
      const seq = typeof entry.seq === "number" && Number.isFinite(entry.seq) ? entry.seq : null;
      const role = typeof entry.role === "string" && ROLE_SET.has(entry.role) ? entry.role : "system";
      const text = normalizeText(entry.text);
      if (!text) return null;
      return { seq, role, text, at: normalizeText(entry.at, 80) };
    })
    .filter((entry): entry is { seq: number | null; role: string; text: string; at: string | null } => Boolean(entry));
}

function hasAppendContent(args: Record<string, unknown>): boolean {
  if (Array.isArray(args.entries) && args.entries.length > 0) return true;
  if (args.settings !== undefined || args.client !== undefined) return true;
  if (args.metrics !== undefined || args.stoppedAt !== undefined) return true;
  if (args.final === true) return true;
  return false;
}

function mergeEntries(
  existing: Array<{ seq: number; role: string; text: string; at: string | null }>,
  incoming: Array<{ seq: number | null; role: string; text: string; at: string | null }>,
  existingLastSeq: number,
) {
  const bySeq = new Map<number, { seq: number; role: string; text: string; at: string | null }>();
  for (const entry of existing) {
    bySeq.set(entry.seq, entry);
  }

  let synthSeq = existingLastSeq;

  for (const entry of incoming) {
    if (entry.seq !== null && Number.isFinite(entry.seq)) {
      if (!bySeq.has(entry.seq)) {
        bySeq.set(entry.seq, { seq: entry.seq, role: entry.role, text: entry.text, at: entry.at });
      }
    } else {
      let isDup = false;
      for (const [, ex] of bySeq) {
        if (ex.role === entry.role && ex.text === entry.text && (ex.at ?? "") === (entry.at ?? "")) {
          isDup = true;
          break;
        }
      }
      if (!isDup) {
        synthSeq += 1;
        bySeq.set(synthSeq, { seq: synthSeq, role: entry.role, text: entry.text, at: entry.at });
      }
    }
  }

  const merged = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  const lastSeq = merged.reduce((max, e) => Math.max(max, e.seq), existingLastSeq);
  return { merged, lastSeq };
}

export async function appendAdminLiveConversationLog(args: Record<string, unknown>) {
  const mode = normalizeMode(args.mode);
  const sessionId = safeSegment(args.sessionId, `live-${mode}-${Date.now().toString(36)}`);
  const startedAt = normalizeIso(args.startedAt) ?? new Date().toISOString();
  const final = args.final === true;

  if (!hasAppendContent(args)) {
    return { error: "EMPTY_APPEND" };
  }

  const filePath = path.join(
    VOICE_LOG_ROOT,
    `${startedAt.slice(0, 10)}_${mode}_${sessionId}.json`,
  );

  const chainKey = filePath;
  const prev = appendChains.get(chainKey) ?? Promise.resolve();
  const current = prev.then(async () => {
    await mkdir(VOICE_LOG_ROOT, { recursive: true });

    let doc: Record<string, unknown> = {
      schemaVersion: 2,
      source: "admin-live",
      mode,
      sessionId,
      startedAt,
      lastSeq: 0,
      appendCount: 0,
      finalized: false,
      logs: [],
      transcript: [],
    };

    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (isRecord(parsed) && Array.isArray(parsed.logs)) {
        doc = parsed;
      }
    } catch {
      // missing or corrupt → fresh doc
    }

    const existingLogs = Array.isArray(doc.logs) ? doc.logs : [];
    const existingNorm = existingLogs
      .filter(isRecord)
      .map((e) => ({
        seq: typeof e.seq === "number" && Number.isFinite(e.seq) ? e.seq : 0,
        role: typeof e.role === "string" && ROLE_SET.has(e.role) ? e.role : "system",
        text: typeof e.text === "string" ? e.text : "",
        at: typeof e.at === "string" ? e.at : null,
      }))
      .filter((e) => e.text);

    const incomingEntries = normalizeAppendEntries(args.entries);
    const existingLastSeq = typeof doc.lastSeq === "number" ? doc.lastSeq : 0;

    const { merged, lastSeq } = mergeEntries(existingNorm, incomingEntries, existingLastSeq);

    const normalized = merged
      .map((e) => ({
        role: e.role,
        text: e.text.slice(0, MAX_TEXT_LENGTH),
        at: e.at,
        seq: e.seq,
      }))
      .slice(-MAX_LOG_ENTRIES);

    const transcript = normalized
      .filter((e) => e.role === "user" || e.role === "bench")
      .map((e) => ({
        speaker: e.role === "user" ? "user" : "model",
        text: e.text,
        at: e.at,
      }));

    const now = new Date().toISOString();
    const incomingSettings = normalizeSettings(args.settings);
    const incomingClient = normalizeClient(args.client);
    const incomingMetrics = pickPrimitiveObject(args.metrics, [
      "micPermission", "connectionState", "firstResponseMs", "sessionPostMs", "socketOpenMs",
      "setupDoneMs", "transcriptLatencyMs", "turnCount", "interruptionCount",
      "sessionDurationSec", "lowVoice", "lastError", "rating",
    ]);

    const mergedSettings = Object.keys(incomingSettings).length > 0
      ? { ...(isRecord(doc.settings) ? doc.settings : {}), ...incomingSettings }
      : doc.settings;
    const mergedClient = Object.keys(incomingClient).length > 0
      ? { ...(isRecord(doc.client) ? doc.client : {}), ...incomingClient }
      : doc.client;
    const mergedMetrics = Object.keys(incomingMetrics).length > 0
      ? { ...(isRecord(doc.metrics) ? doc.metrics : {}), ...incomingMetrics }
      : doc.metrics;

    const payload: Record<string, unknown> = {
      ...doc,
      schemaVersion: 2,
      mode,
      sessionId,
      startedAt: typeof doc.startedAt === "string" ? doc.startedAt : startedAt,
      stoppedAt: args.stoppedAt ? normalizeIso(args.stoppedAt) ?? now : (doc.stoppedAt ?? null),
      savedAt: now,
      settings: mergedSettings,
      metrics: mergedMetrics,
      client: mergedClient,
      logs: normalized,
      transcript,
      lastSeq,
      appendCount: (typeof doc.appendCount === "number" ? doc.appendCount : 0) + 1,
      finalized: final ? true : (doc.finalized === true),
    };

    const raw = `${JSON.stringify(payload, null, 2)}\n`;
    let sizeBytes = Buffer.byteLength(raw, "utf8");

    if (sizeBytes > MAX_PAYLOAD_BYTES) {
      let trimmed = normalized;
      while (trimmed.length > 1 && sizeBytes > MAX_PAYLOAD_BYTES) {
        trimmed = trimmed.slice(1);
        payload.logs = trimmed;
        payload.transcript = trimmed
          .filter((e) => e.role === "user" || e.role === "bench")
          .map((e) => ({ speaker: e.role === "user" ? "user" : "model", text: e.text, at: e.at }));
        const retry = `${JSON.stringify(payload, null, 2)}\n`;
        sizeBytes = Buffer.byteLength(retry, "utf8");
      }
    }

    const finalRaw = `${JSON.stringify(payload, null, 2)}\n`;
    const tmpPath = `${filePath}.tmp`;
    await writeFile(tmpPath, finalRaw, "utf8");
    await rename(tmpPath, filePath);

    return {
      ok: true,
      file: path.relative(process.cwd(), filePath),
      mode,
      sessionId,
      logCount: (payload.logs as unknown[]).length,
      transcriptCount: (payload.transcript as unknown[]).length,
      sizeBytes: Buffer.byteLength(finalRaw, "utf8"),
      lastSeq,
      finalized: payload.finalized,
    };
  });

  appendChains.set(chainKey, current.then(() => {}, () => {}));
  return current;
}

export async function saveAdminLiveConversationLog(args: Record<string, unknown>) {
  const logs = normalizeLogEntries(args.logs);

  if (logs.length === 0) {
    return { error: "EMPTY_LOGS" };
  }

  const entries = logs.map((entry) => ({
    role: entry.role,
    text: entry.text,
    at: entry.at,
  }));

  return appendAdminLiveConversationLog({
    ...args,
    entries,
    final: true,
  });
}
