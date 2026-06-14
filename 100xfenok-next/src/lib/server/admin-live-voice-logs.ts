import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const VOICE_LOG_ROOT = path.join(process.cwd(), "data", "voice-logs");
const MAX_LOG_ENTRIES = 10_000;
const MAX_TEXT_LENGTH = 1400;
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
const ROLE_SET = new Set(["system", "user", "bench", "tool", "error"]);

const appendChains = new Map<string, Promise<void>>();

type JsonRecord = Record<string, unknown>;

const UNSAFE_BENCH_LOG_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  { reason: "CONTROL_TOKEN", pattern: /\[(?:CONTROL|coach_control)\]/i },
  { reason: "SHOW_CARD_TOKEN", pattern: /\bshowCard\b/i },
  { reason: "CARD_STATE_TOKEN", pattern: /\bstate\s*=\s*(?:prompt|reveal|drill|clear)\b/i },
  { reason: "CARD_STATE_TOKEN", pattern: /\b(?:prompt|reveal|drill|clear)\s*상태/i },
  { reason: "ROUND_LABEL", pattern: /\bR[1-5]\b/ },
  { reason: "INTERNAL_PLAN", pattern: /(?:프롬프트 규칙을 지적|페르소나를 유지|자연스럽게 학습으로 유도|힌트를 제공|제공 방식.*불만|강력히 항의|실수를 인정|분위기를 전환|카드 상태가 바뀌지|기술적 문제를 인지|질문함|부드럽게 교정|자연스러운 표현인)/ },
  { reason: "INTERNAL_PLAN", pattern: /(?:호출하여|호출한다|진행한다|유도한다|제시한다|유지한다|전환한다|저장한다|인정하고|사과한 후)/ },
];

function sanitizeBenchLogText(value: string | null): string | null {
  if (!value) return null;
  return UNSAFE_BENCH_LOG_PATTERNS.some((item) => item.pattern.test(value)) ? null : value;
}

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

function normalizeTester(value: unknown): "mona" | "owner" {
  return value === "owner" ? "owner" : "mona";
}

function normalizeCoachConfigForLog(value: unknown) {
  if (!isRecord(value)) return null;
  const reviewMode = value.reviewMode === "new-first"
    || value.reviewMode === "review-first"
    || value.reviewMode === "soft"
    || value.reviewMode === "hard"
    || value.reviewMode === "off"
    ? value.reviewMode
    : "balanced";
  const difficulty = value.difficulty === "easy" || value.difficulty === "challenge"
    ? value.difficulty
    : "normal";
  const reviewRatio = typeof value.reviewRatio === "number" && Number.isFinite(value.reviewRatio)
    ? Math.min(1, Math.max(0, value.reviewRatio))
    : reviewMode === "off" ? 0 : reviewMode === "hard" ? 1 : reviewMode === "new-first" ? 0.15 : reviewMode === "review-first" ? 0.55 : 0.3;
  const difficultyCap = typeof value.difficultyCap === "number" && Number.isFinite(value.difficultyCap)
    ? Math.min(14, Math.max(4, value.difficultyCap))
    : difficulty === "easy" ? 6 : difficulty === "challenge" ? 10 : 8;
  return {
    tester: normalizeTester(value.tester),
    reviewMode,
    reviewRatio,
    difficulty,
    difficultyCap,
    freshMaterialEnabled: value.freshMaterialEnabled !== false,
    honorLiveRequests: value.honorLiveRequests !== false,
    emptyPraiseGuard: value.emptyPraiseGuard !== false,
  };
}

function normalizeCoachSessionStateForLog(value: unknown) {
  if (!isRecord(value)) return null;
  const sessionId = normalizeText(value.sessionId, 120);
  const seenItemKeys = normalizeStringArray(value.seenItemKeys, 24);
  const bufferedItemKeys = normalizeStringArray(value.bufferedItemKeys, 24);
  const reviewCountActual = typeof value.reviewCountActual === "number" && Number.isFinite(value.reviewCountActual)
    ? Math.max(0, Math.round(value.reviewCountActual))
    : 0;
  const newCountActual = typeof value.newCountActual === "number" && Number.isFinite(value.newCountActual)
    ? Math.max(0, Math.round(value.newCountActual))
    : 0;
  return {
    sessionId,
    currentItemKey: normalizeText(value.currentItemKey, 160),
    seenItemKeys,
    bufferedItemKeys,
    lastLearnerIntent: normalizeText(value.lastLearnerIntent, 40),
    lastToolIntent: normalizeText(value.lastToolIntent, 40),
    reviewCountActual,
    newCountActual,
  };
}

function normalizeSettings(value: unknown) {
  if (!isRecord(value)) return {};
  const base = pickPrimitiveObject(value, [
    "lowVoice",
    "voiceName",
    "responseStyle",
    "vadPreset",
    "interruptionMode",
    "tester",
    "clientBuildVersion",
    "conversationId",
    "logSessionId",
    "liveSessionId",
  ]);
  const coachConfig = isRecord(value) ? normalizeCoachConfigForLog(value.coachConfig) : null;
  const coachSessionState = normalizeCoachSessionStateForLog(value.coachSessionState);
  return {
    ...base,
    tester: coachConfig?.tester ?? normalizeTester(base.tester),
    ...(coachConfig ? { coachConfig } : {}),
    ...(coachSessionState ? {
      coachSessionState,
      bufferedItemKeys: coachSessionState.bufferedItemKeys,
    } : { bufferedItemKeys: normalizeStringArray(value.bufferedItemKeys, 24) }),
    enabledToolIds: normalizeStringArray(value.enabledToolIds),
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
      const seq = typeof entry.seq === "number" && Number.isFinite(entry.seq) ? entry.seq : null;
      const role = typeof entry.role === "string" && ROLE_SET.has(entry.role) ? entry.role : "system";
      const rawText = normalizeText(entry.text);
      const text = role === "bench" ? sanitizeBenchLogText(rawText) : rawText;
      if (!text) return null;
      return {
        seq,
        role,
        text,
        at: normalizeText(entry.at, 80),
        atIso: normalizeIso(entry.atIso),
      };
    })
    .filter((entry): entry is { seq: number | null; role: string; text: string; at: string | null; atIso: string | null } => Boolean(entry))
    .slice(-MAX_LOG_ENTRIES);
}

function normalizeAppendEntries(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((entry) => {
      const seq = typeof entry.seq === "number" && Number.isFinite(entry.seq) ? entry.seq : null;
      const role = typeof entry.role === "string" && ROLE_SET.has(entry.role) ? entry.role : "system";
      const rawText = normalizeText(entry.text);
      const text = role === "bench" ? sanitizeBenchLogText(rawText) : rawText;
      if (!text) return null;
      return { seq, role, text, at: normalizeText(entry.at, 80), atIso: normalizeIso(entry.atIso) };
    })
    .filter((entry): entry is { seq: number | null; role: string; text: string; at: string | null; atIso: string | null } => Boolean(entry));
}

function hasAppendContent(args: Record<string, unknown>): boolean {
  if (Array.isArray(args.entries) && args.entries.length > 0) return true;
  if (args.settings !== undefined || args.client !== undefined) return true;
  if (args.metrics !== undefined || args.stoppedAt !== undefined) return true;
  if (args.final === true) return true;
  return false;
}

function mergeEntries(
  existing: Array<{ seq: number; role: string; text: string; at: string | null; atIso: string | null }>,
  incoming: Array<{ seq: number | null; role: string; text: string; at: string | null; atIso: string | null }>,
  existingLastSeq: number,
) {
  const bySeq = new Map<number, { seq: number; role: string; text: string; at: string | null; atIso: string | null }>();
  for (const entry of existing) {
    bySeq.set(entry.seq, entry);
  }

  let synthSeq = existingLastSeq;

  for (const entry of incoming) {
    if (entry.seq !== null && Number.isFinite(entry.seq)) {
      if (!bySeq.has(entry.seq)) {
        bySeq.set(entry.seq, { seq: entry.seq, role: entry.role, text: entry.text, at: entry.at, atIso: entry.atIso });
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
        bySeq.set(synthSeq, { seq: synthSeq, role: entry.role, text: entry.text, at: entry.at, atIso: entry.atIso });
      }
    }
  }

  const merged = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  const lastSeq = merged.reduce((max, e) => Math.max(max, e.seq), existingLastSeq);
  return { merged, lastSeq };
}

function getLatestEntryIso(entries: Array<{ atIso: string | null }>): string | null {
  let latest: string | null = null;
  for (const entry of entries) {
    if (!entry.atIso) continue;
    if (latest === null || entry.atIso > latest) latest = entry.atIso;
  }
  return latest;
}

function resolveFinalStoppedAt(
  requestedStoppedAt: unknown,
  existingStoppedAt: unknown,
  entries: Array<{ atIso: string | null }>,
  now: string,
): string {
  const requested = normalizeIso(requestedStoppedAt) ?? normalizeIso(existingStoppedAt) ?? now;
  const latestEntryIso = getLatestEntryIso(entries);
  return latestEntryIso && requested < latestEntryIso ? latestEntryIso : requested;
}

export async function appendAdminLiveConversationLog(args: Record<string, unknown>) {
  const mode = normalizeMode(args.mode);
  const sessionId = safeSegment(args.sessionId, `live-${mode}-${Date.now().toString(36)}`);
  const startedAt = normalizeIso(args.startedAt) ?? new Date().toISOString();
  const final = args.final === true;
  const incomingSettings = normalizeSettings(args.settings);
  const tester = args.tester === "owner" || (isRecord(incomingSettings) && incomingSettings.tester === "owner") ? "owner" : "mona";

  if (!hasAppendContent(args)) {
    return { error: "EMPTY_APPEND" };
  }

  const logRoot = tester === "owner" ? path.join(VOICE_LOG_ROOT, "owner-test") : VOICE_LOG_ROOT;
  const filePath = path.join(
    logRoot,
    `${startedAt.slice(0, 10)}_${mode}_${sessionId}.json`,
  );

  const chainKey = filePath;
  const prev = appendChains.get(chainKey) ?? Promise.resolve();
  const current = prev.then(async () => {
    await mkdir(logRoot, { recursive: true });

    let doc: Record<string, unknown> = {
      schemaVersion: 3,
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

    if (doc.finalized === true && final !== true) {
      return { error: "ALREADY_FINALIZED", file: path.relative(process.cwd(), filePath) };
    }

    const existingLogs = Array.isArray(doc.logs) ? doc.logs : [];
    const existingNorm = existingLogs
      .filter(isRecord)
      .map((e) => ({
        seq: typeof e.seq === "number" && Number.isFinite(e.seq) ? e.seq : 0,
        role: typeof e.role === "string" && ROLE_SET.has(e.role) ? e.role : "system",
        text: typeof e.text === "string" && e.role === "bench"
          ? sanitizeBenchLogText(e.text) ?? ""
          : typeof e.text === "string" ? e.text : "",
        at: typeof e.at === "string" ? e.at : null,
        atIso: typeof e.atIso === "string" ? e.atIso : null,
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
        atIso: e.atIso,
        seq: e.seq,
      }))
      .slice(-MAX_LOG_ENTRIES);

    const transcript = normalized
      .filter((e) => e.role === "user" || e.role === "bench")
      .map((e) => ({
        speaker: e.role === "user" ? "user" : "model",
        text: e.text,
        at: e.at,
        atIso: e.atIso,
      }));

    const now = new Date().toISOString();
    const incomingClient = normalizeClient(args.client);
    const incomingMetrics = pickPrimitiveObject(args.metrics, [
      "micPermission", "connectionState", "firstResponseMs", "sessionPostMs", "socketOpenMs",
      "setupDoneMs", "transcriptLatencyMs", "turnCount", "interruptionCount",
      "audioFramesSent", "sessionDurationSec", "lowVoice", "lastError", "rating", "resumeCount",
      "appendFailureCount", "lastAppendError", "lessonMaterialToolCalls", "lessonMaterialLastReturnedCount",
      "lessonMaterialLastLatencyMs", "lessonMaterialLastSource", "clientIntentHint", "modelToolIntent",
      "intentHintMatched", "noUserTurnWatchdogCount", "lastNoUserTurnMs",
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
      schemaVersion: 3,
      mode,
      tester,
      sessionId,
      startedAt: typeof doc.startedAt === "string" ? doc.startedAt : startedAt,
      stoppedAt: final ? resolveFinalStoppedAt(args.stoppedAt, doc.stoppedAt, normalized, now) : null,
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
          .map((e) => ({ speaker: e.role === "user" ? "user" : "model", text: e.text, at: e.at, atIso: e.atIso }));
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
    seq: entry.seq,
    role: entry.role,
    text: entry.text,
    at: entry.at,
    atIso: entry.atIso,
  }));

  return appendAdminLiveConversationLog({
    ...args,
    entries,
    final: true,
  });
}
