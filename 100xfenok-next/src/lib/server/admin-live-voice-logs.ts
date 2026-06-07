import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const VOICE_LOG_ROOT = path.join(process.cwd(), "data", "voice-logs");
const MAX_LOG_ENTRIES = 240;
const MAX_TEXT_LENGTH = 1400;
const MAX_PAYLOAD_BYTES = 128 * 1024;
const ROLE_SET = new Set(["system", "user", "bench", "tool", "error"]);

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

export async function saveAdminLiveConversationLog(args: Record<string, unknown>) {
  const savedAt = new Date().toISOString();
  const mode = normalizeMode(args.mode);
  const sessionId = safeSegment(args.sessionId, `live-${mode}-${Date.now().toString(36)}`);
  const startedAt = normalizeIso(args.startedAt) ?? savedAt;
  const stoppedAt = normalizeIso(args.stoppedAt) ?? savedAt;
  const logs = normalizeLogEntries(args.logs);

  if (logs.length === 0) {
    return { error: "EMPTY_LOGS" };
  }

  const transcript = logs
    .filter((entry) => entry.role === "user" || entry.role === "bench")
    .map((entry) => ({
      speaker: entry.role === "user" ? "user" : "model",
      text: entry.text,
      at: entry.at,
    }));

  const payload = {
    schemaVersion: 1,
    source: "admin-live",
    mode,
    sessionId,
    startedAt,
    stoppedAt,
    savedAt,
    settings: normalizeSettings(args.settings),
    metrics: pickPrimitiveObject(args.metrics, [
      "micPermission",
      "connectionState",
      "firstResponseMs",
      "transcriptLatencyMs",
      "turnCount",
      "interruptionCount",
      "sessionDurationSec",
      "lowVoice",
      "lastError",
      "rating",
    ]),
    client: normalizeClient(args.client),
    logs,
    transcript,
  };

  const raw = `${JSON.stringify(payload, null, 2)}\n`;
  const sizeBytes = Buffer.byteLength(raw, "utf8");
  if (sizeBytes > MAX_PAYLOAD_BYTES) {
    return { error: "PAYLOAD_TOO_LARGE", sizeBytes, maxBytes: MAX_PAYLOAD_BYTES };
  }

  await mkdir(VOICE_LOG_ROOT, { recursive: true });
  const date = stoppedAt.slice(0, 10);
  const filename = `${date}_${mode}_${sessionId}.json`;
  const filePath = path.join(VOICE_LOG_ROOT, filename);
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, raw, "utf8");
  await rename(tmpPath, filePath);

  return {
    ok: true,
    file: path.relative(process.cwd(), filePath),
    mode,
    sessionId,
    logCount: logs.length,
    transcriptCount: transcript.length,
    sizeBytes,
  };
}
