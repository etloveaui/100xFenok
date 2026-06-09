import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// Resolve the data dir name at runtime (env-overridable). The non-literal
// segment keeps Turbopack from statically tracing data/mona-english into the
// build graph — that dir is a gitignored, out-of-root symlink to mona-life
// (the SSOT) read only at runtime by the Mac mini skill bridge.
const MONA_DATA_DIRNAME = process.env.MONA_DATA_DIRNAME ?? "mona-english";
const MONA_ROOT = path.join(process.cwd(), "data", MONA_DATA_DIRNAME);
const MONA_SESSIONS = path.join(MONA_ROOT, "sessions");
const MONA_BEST3 = path.join(MONA_ROOT, "best3.json");
const MONA_WEAK_NOTES = path.join(MONA_ROOT, "weak-notes.json");
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const IN_TURN_FS_TIMEOUT_MS = 50;
const SETUP_FS_TIMEOUT_MS = 500;
const MAX_SESSION_BYTES = 64 * 1024;
const MAX_BEST3_ENTRIES = 500;
const MAX_WEAK_NOTES = 200;

export const MONA_STUDY_TOOL_IDS = [
  "mona-save-session",
  "mona-yesterday",
  "mona-memory",
  "mona-weekly-test",
] as const;

type JsonRecord = Record<string, unknown>;

type Best3Item = {
  ko: string;
  en: string;
  note: string | null;
};

type WeakMiss = {
  expression: string;
  note: string | null;
};

type StudySession = {
  date: string;
  theme: string | null;
  best3: Best3Item[];
  weakMisses: WeakMiss[];
  summary: string | null;
  savedAt: string;
};

type Best3Entry = Best3Item & {
  firstSeen: string;
  sessions: string[];
};

type WeakNote = {
  expression: string;
  missCount: number;
  lastSeen: string;
  note: string | null;
  firstSeen: string;
  sessions: string[];
};

type StudySnapshot = {
  studyDate: string;
  loadedAt: string;
  sessions: StudySession[];
  best3: Best3Entry[];
  weakNotes: WeakNote[];
};

const WEEKDAY_PLAN = [
  { weekday: "일요일", theme: "복습", corner: "주간 테스트" },
  { weekday: "월요일", theme: "회사·업무", corner: "신규 + 섀도잉" },
  { weekday: "화요일", theme: "가족·친구 일상", corner: "빨모쌤·유튜브 데이" },
  { weekday: "수요일", theme: "혼잣말·감정", corner: "신규 + 섀도잉" },
  { weekday: "목요일", theme: "외출·쇼핑·식당", corner: "빨모쌤·유튜브 데이" },
  { weekday: "금요일", theme: "회사·업무 심화", corner: "프리토킹" },
  { weekday: "토요일", theme: "자유", corner: "자유" },
] as const;

let studySnapshot: StudySnapshot | null = null;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown, maxLength = 260): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function validateStudyDate(value: unknown): string | null {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === value ? value : null;
}

export function getCanonicalMonaStudyDate(now = new Date()): string {
  const kstDate = new Date(now.getTime() + KST_OFFSET_MS);
  const adjusted = kstDate.getUTCHours() < 4
    ? new Date(kstDate.getTime() - DAY_MS)
    : kstDate;
  return adjusted.toISOString().slice(0, 10);
}

function getWeekdayPlan(studyDate: string) {
  const [year, month, day] = studyDate.split("-").map(Number);
  const index = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return WEEKDAY_PLAN[index] ?? WEEKDAY_PLAN[0];
}

function safeResolve(...parts: string[]): string | null {
  const target = path.resolve(MONA_ROOT, ...parts);
  if (target !== MONA_ROOT && !target.startsWith(`${MONA_ROOT}${path.sep}`)) {
    return null;
  }
  const relative = path.relative(MONA_ROOT, target);
  if (relative.startsWith("..")) return null;
  return target;
}

async function withTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  const raw = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(raw, "utf8") > MAX_SESSION_BYTES && filePath.includes(`${path.sep}sessions${path.sep}`)) {
    return { ok: false, error: "PAYLOAD_TOO_LARGE" };
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, raw, "utf8");
  await rename(tmpPath, filePath);
  return { ok: true as const };
}

function normalizeBest3Items(value: unknown): Best3Item[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: Best3Item[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const ko = normalizeText(item.ko, 220);
    const en = normalizeText(item.en, 220);
    if (!ko || !en) continue;
    const key = normalizeKey(en);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ ko, en, note: normalizeText(item.note, 180) });
    if (items.length >= 3) break;
  }
  return items;
}

function normalizeWeakMisses(value: unknown): WeakMiss[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: WeakMiss[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const expression = normalizeText(item.expression, 220);
    if (!expression) continue;
    const key = normalizeKey(expression);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ expression, note: normalizeText(item.note, 180) });
    if (items.length >= 12) break;
  }
  return items;
}

function normalizeSession(value: unknown): StudySession | null {
  if (!isRecord(value)) return null;
  const date = validateStudyDate(value.date);
  if (!date) return null;
  return {
    date,
    theme: normalizeText(value.theme, 120),
    best3: normalizeBest3Items(value.best3),
    weakMisses: normalizeWeakMisses(value.weakMisses),
    summary: normalizeText(value.summary, 500),
    savedAt: normalizeText(value.savedAt, 80) ?? new Date(0).toISOString(),
  };
}

function normalizeBest3Store(value: unknown): Best3Entry[] {
  if (!isRecord(value) || !Array.isArray(value.entries)) return [];
  return value.entries
    .filter(isRecord)
    .map((entry) => {
      const ko = normalizeText(entry.ko, 220);
      const en = normalizeText(entry.en, 220);
      const firstSeen = validateStudyDate(entry.firstSeen);
      if (!ko || !en || !firstSeen) return null;
      return {
        ko,
        en,
        note: normalizeText(entry.note, 180),
        firstSeen,
        sessions: Array.isArray(entry.sessions)
          ? entry.sessions.map(validateStudyDate).filter((date): date is string => Boolean(date))
          : [firstSeen],
      };
    })
    .filter((entry): entry is Best3Entry => Boolean(entry));
}

function normalizeWeakStore(value: unknown): WeakNote[] {
  if (!isRecord(value) || !Array.isArray(value.notes)) return [];
  return value.notes
    .filter(isRecord)
    .map((note) => {
      const expression = normalizeText(note.expression, 220);
      const firstSeen = validateStudyDate(note.firstSeen);
      const lastSeen = validateStudyDate(note.lastSeen) ?? firstSeen;
      if (!expression || !firstSeen || !lastSeen) return null;
      return {
        expression,
        missCount: typeof note.missCount === "number" && Number.isFinite(note.missCount)
          ? Math.max(1, Math.round(note.missCount))
          : 1,
        lastSeen,
        note: normalizeText(note.note, 180),
        firstSeen,
        sessions: Array.isArray(note.sessions)
          ? note.sessions.map(validateStudyDate).filter((date): date is string => Boolean(date))
          : [firstSeen],
      };
    })
    .filter((note): note is WeakNote => Boolean(note));
}

async function loadStudySnapshot(studyDate = getCanonicalMonaStudyDate()): Promise<StudySnapshot> {
  const [filenames, best3Raw, weakRaw] = await Promise.all([
    readdir(MONA_SESSIONS).catch(() => [] as string[]),
    readJsonFile<unknown>(MONA_BEST3, null),
    readJsonFile<unknown>(MONA_WEAK_NOTES, null),
  ]);
  const sessionFiles = filenames
    .filter((filename) => filename.endsWith(".json"))
    .map((filename) => filename.slice(0, -5))
    .filter((date) => validateStudyDate(date));
  const sessions = (await Promise.all(
    sessionFiles.map(async (date) => {
      const filePath = safeResolve("sessions", `${date}.json`);
      if (!filePath) return null;
      return normalizeSession(await readJsonFile<unknown>(filePath, null));
    }),
  ))
    .filter((session): session is StudySession => Boolean(session))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    studyDate,
    loadedAt: new Date().toISOString(),
    sessions,
    best3: normalizeBest3Store(best3Raw),
    weakNotes: normalizeWeakStore(weakRaw),
  };
}

export async function prepareMonaStudySnapshot(studyDate = getCanonicalMonaStudyDate()) {
  studySnapshot = await withTimeout(
    loadStudySnapshot(studyDate),
    studySnapshot ?? {
      studyDate,
      loadedAt: new Date().toISOString(),
      sessions: [],
      best3: [],
      weakNotes: [],
    },
    SETUP_FS_TIMEOUT_MS,
  );
  return studySnapshot;
}

async function getSnapshotForTurn(studyDate = getCanonicalMonaStudyDate()) {
  if (studySnapshot?.studyDate === studyDate) return studySnapshot;
  studySnapshot = await withTimeout(
    loadStudySnapshot(studyDate),
    studySnapshot ?? {
      studyDate,
      loadedAt: new Date().toISOString(),
      sessions: [],
      best3: [],
      weakNotes: [],
    },
    IN_TURN_FS_TIMEOUT_MS,
  );
  return studySnapshot;
}

function findYesterdaySession(snapshot: StudySnapshot, date = snapshot.studyDate) {
  return [...snapshot.sessions]
    .filter((session) => session.date < date)
    .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
}

function mergeBest3(existing: Best3Item[], incoming: Best3Item[]) {
  const seen = new Set<string>();
  return [...incoming, ...existing].filter((item) => {
    const key = normalizeKey(item.en);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
}

function mergeWeak(existing: WeakMiss[], incoming: WeakMiss[]) {
  const seen = new Set<string>();
  return [...incoming, ...existing].filter((item) => {
    const key = normalizeKey(item.expression);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function updateBest3Store(entries: Best3Entry[], incoming: Best3Item[], studyDate: string) {
  const byKey = new Map(entries.map((entry) => [normalizeKey(entry.en), entry]));
  for (const item of incoming) {
    const key = normalizeKey(item.en);
    const current = byKey.get(key);
    if (current) {
      if (!current.sessions.includes(studyDate)) current.sessions.unshift(studyDate);
      if (item.note) current.note = item.note;
      current.ko = item.ko;
      continue;
    }
    byKey.set(key, {
      ...item,
      firstSeen: studyDate,
      sessions: [studyDate],
    });
  }
  return [...byKey.values()]
    .sort((a, b) => (b.sessions[0] ?? b.firstSeen).localeCompare(a.sessions[0] ?? a.firstSeen))
    .slice(0, MAX_BEST3_ENTRIES);
}

function updateWeakStore(entries: WeakNote[], incoming: WeakMiss[], studyDate: string, existingForDate: WeakMiss[]) {
  const existingKeys = new Set(existingForDate.map((item) => normalizeKey(item.expression)));
  const byKey = new Map(entries.map((entry) => [normalizeKey(entry.expression), entry]));
  for (const item of incoming) {
    const key = normalizeKey(item.expression);
    const current = byKey.get(key);
    if (current) {
      if (!current.sessions.includes(studyDate)) current.sessions.unshift(studyDate);
      if (!existingKeys.has(key)) current.missCount += 1;
      current.lastSeen = studyDate;
      if (item.note) current.note = item.note;
      continue;
    }
    byKey.set(key, {
      expression: item.expression,
      missCount: 1,
      lastSeen: studyDate,
      note: item.note,
      firstSeen: studyDate,
      sessions: [studyDate],
    });
  }
  return [...byKey.values()]
    .sort((a, b) => b.missCount - a.missCount || b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, MAX_WEAK_NOTES);
}

async function saveStudySession(args: Record<string, unknown>) {
  const studyDate = getCanonicalMonaStudyDate();
  if (args.date !== undefined && !validateStudyDate(args.date)) {
    return { error: "INVALID_DATE", studyDate, allowedPattern: DATE_PATTERN.source };
  }
  const sessionPath = safeResolve("sessions", `${studyDate}.json`);
  if (!sessionPath) return { error: "INVALID_PATH" };

  const snapshot = await getSnapshotForTurn(studyDate);
  const existing = snapshot.sessions.find((session) => session.date === studyDate) ?? null;
  const incomingBest3 = normalizeBest3Items(args.best3);
  const incomingWeak = normalizeWeakMisses(args.weakMisses);
  const mergedSession: StudySession = {
    date: studyDate,
    theme: normalizeText(args.theme, 120) ?? existing?.theme ?? getWeekdayPlan(studyDate).theme,
    best3: mergeBest3(existing?.best3 ?? [], incomingBest3),
    weakMisses: mergeWeak(existing?.weakMisses ?? [], incomingWeak),
    summary: normalizeText(args.summary, 500) ?? existing?.summary ?? null,
    savedAt: new Date().toISOString(),
  };

  const best3Store = updateBest3Store(snapshot.best3, incomingBest3, studyDate);
  const weakStore = updateWeakStore(snapshot.weakNotes, incomingWeak, studyDate, existing?.weakMisses ?? []);
  const best3Payload = {
    updatedAt: mergedSession.savedAt,
    count: best3Store.length,
    entries: best3Store,
  };
  const weakPayload = {
    updatedAt: mergedSession.savedAt,
    count: weakStore.length,
    notes: weakStore,
  };

  const writePromise = Promise.all([
    writeJsonAtomic(sessionPath, mergedSession),
    writeJsonAtomic(MONA_BEST3, best3Payload),
    writeJsonAtomic(MONA_WEAK_NOTES, weakPayload),
  ]);
  const writeResult = await withTimeout(writePromise, null, IN_TURN_FS_TIMEOUT_MS);
  if (writeResult === null) {
    void writePromise.catch(() => undefined);
  } else {
    const failed = writeResult.find((result) => "error" in result);
    if (failed && "error" in failed) return { error: failed.error, studyDate };
  }

  studySnapshot = {
    studyDate,
    loadedAt: new Date().toISOString(),
    sessions: [
      ...snapshot.sessions.filter((session) => session.date !== studyDate),
      mergedSession,
    ].sort((a, b) => a.date.localeCompare(b.date)),
    best3: best3Store,
    weakNotes: weakStore,
  };

  return {
    ok: true,
    studyDate,
    requestedDate: validateStudyDate(args.date) ?? null,
    best3Saved: incomingBest3.length,
    weakUpdated: incomingWeak.length,
    totals: {
      best3: best3Store.length,
      weak: weakStore.length,
    },
    note: writeResult === null
      ? "Save accepted from memory; disk write is continuing in the background."
      : "오늘 거 저장했어.",
  };
}

async function getYesterdaySession(args: Record<string, unknown>) {
  const requested = args.date === undefined ? null : validateStudyDate(args.date);
  if (args.date !== undefined && !requested) return { error: "INVALID_DATE", allowedPattern: DATE_PATTERN.source };
  const snapshot = await getSnapshotForTurn(requested ?? getCanonicalMonaStudyDate());
  const session = findYesterdaySession(snapshot, requested ?? snapshot.studyDate);
  if (!session) {
    return {
      found: false,
      studyDate: requested ?? snapshot.studyDate,
      message: "첫 세션이야. 워밍업은 건너뛰고 바로 오늘 표현 ②부터 가.",
      best3: [],
      weakMisses: [],
    };
  }
  return {
    found: true,
    date: session.date,
    theme: session.theme,
    best3: session.best3,
    weakMisses: session.weakMisses,
    summary: session.summary,
  };
}

async function getStudyMemory(args: Record<string, unknown>) {
  const snapshot = await getSnapshotForTurn();
  const scope = args.scope === "best3" || args.scope === "weak" ? args.scope : "all";
  const limit = typeof args.limit === "number" && Number.isFinite(args.limit)
    ? Math.max(1, Math.min(30, Math.round(args.limit)))
    : 12;
  return {
    scope,
    best3: scope === "weak" ? [] : snapshot.best3.slice(0, limit),
    weakNotes: scope === "best3" ? [] : snapshot.weakNotes.slice(0, limit),
    totals: {
      best3: snapshot.best3.length,
      weak: snapshot.weakNotes.length,
    },
  };
}

function buildWeeklyItems(snapshot: StudySnapshot, requested: number, weakBias: boolean) {
  const best3Items = snapshot.best3.map((entry) => ({
    ko: entry.ko,
    en: entry.en,
    note: entry.note,
    source: "best3" as const,
  }));
  const weakItems = snapshot.weakNotes.map((note) => ({
    ko: note.note ?? note.expression,
    en: note.expression,
    note: note.note,
    source: "weak" as const,
    missCount: note.missCount,
  }));
  const pool = weakBias ? [...weakItems, ...best3Items] : [...best3Items, ...weakItems];
  const deduped = new Map<string, (typeof pool)[number]>();
  for (const item of pool) deduped.set(normalizeKey(item.en), item);
  const items = [...deduped.values()];
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items.slice(0, requested);
}

async function getWeeklyTestSet(args: Record<string, unknown>) {
  const snapshot = await getSnapshotForTurn();
  const requested = typeof args.count === "number" && Number.isFinite(args.count)
    ? Math.max(1, Math.min(50, Math.round(args.count)))
    : 30;
  const weakBias = args.weakBias !== false;
  const items = buildWeeklyItems(snapshot, requested, weakBias);
  return {
    count: items.length,
    requested,
    weakBias,
    note: items.length < requested
      ? `${items.length}개로 본다. 새로 만들지 마.`
      : "3초 안에 나온 것만 정답으로 본다.",
    items,
  };
}

export async function executeMonaStudyToolFunction(name: string, args: Record<string, unknown>) {
  if (name === "saveStudySession") return saveStudySession(args);
  if (name === "getYesterdaySession") return getYesterdaySession(args);
  if (name === "getStudyMemory") return getStudyMemory(args);
  if (name === "getWeeklyTestSet") return getWeeklyTestSet(args);
  return { error: "TOOL_HANDLER_MISSING" };
}

function formatBest3(items: Best3Item[]) {
  return items.length
    ? items.map((item, index) => `${index + 1}) ${item.ko} -> ${item.en}${item.note ? ` (${item.note})` : ""}`).join("\n")
    : "없음";
}

function formatWeak(items: WeakMiss[] | WeakNote[]) {
  return items.length
    ? items.slice(0, 5).map((item, index) => {
      const text = "expression" in item ? item.expression : "";
      const miss = "missCount" in item ? ` x${item.missCount}` : "";
      return `${index + 1}) ${text}${miss}${item.note ? ` - ${item.note}` : ""}`;
    }).join("\n")
    : "없음";
}

export const MONA_PACING_RULES: readonly string[] = [
  "한 턴에 하나만 질문한다. 절대 Q1/Q2/Q3을 한 번에 쏟아내지 마.",
  "모나가 답할 때까지 기다린다. 끼어들거나 조기 종료하지 마.",
  "프리토킹 중엔 끼어들지 말고 끝난 뒤 피드백 2~3개만 준다.",
  "코너 하나당 최소 3~4회 캐치볼을 주고받은 뒤 다음으로 넘어간다.",
  "코너가 끝나고 모나가 '끝/그만'이라고 할 때까지 '잘 자'나 마무리 말을 하지 마.",
];

export async function buildMonaCoachDynamicBlock(studyDate?: string, snapshot?: StudySnapshot | null) {
  const resolvedDate = studyDate ?? getCanonicalMonaStudyDate();
  const resolvedSnapshot = snapshot ?? await prepareMonaStudySnapshot(resolvedDate);
  const plan = getWeekdayPlan(resolvedDate);
  const yesterday = findYesterdaySession(resolvedSnapshot, resolvedDate);
  const weekly = plan.weekday === "일요일" ? buildWeeklyItems(resolvedSnapshot, 30, true) : [];
  const firstSession = resolvedSnapshot.sessions.length === 0;

  return [
    "[오늘 - 서버 확정값, 다시 계산하지 마]",
    `날짜: ${resolvedDate} (Asia/Seoul, 04:00 cutoff) · 요일: ${plan.weekday}`,
    `테마: ${plan.theme} · 변동코너: ${plan.corner}`,
    "",
    "[어제 복습 재료]",
    firstSession || !yesterday
      ? "첫 세션이야. 워밍업 ①은 건너뛰고 바로 오늘 표현 ②부터 가."
      : [
        `어제 날짜: ${yesterday.date}`,
        `BEST3:\n${formatBest3(yesterday.best3)}`,
        `약점노트:\n${formatWeak(yesterday.weakMisses)}`,
      ].join("\n"),
    "",
    "[진행 규칙 - 내부 페이싱]",
    ...MONA_PACING_RULES,
    "단계 번호를 말하지 마. '이제 ②단계' 같은 말 금지. 어느 코너 할지 묻지 말고 네가 조용히 진행해.",
    "트리거 '시작/go/오늘꺼'가 오면 메뉴 설명 없이 바로 시작한다. 모나가 바꾸자고 할 때만 방향을 바꾼다.",
    "② 오늘 표현 뒤 saveStudySession으로 checkpoint 저장. ③ 변동코너 뒤 한 번 더 checkpoint 저장. 끝에는 오늘 BEST3를 최종 upsert 저장.",
    "한국어 문장 하나를 던지고 → 모나가 영어로 답할 때까지 기다리고 → 짧게 교정하고 → 진짜 쓰는 버전 하나를 알려주고 → 낮게 따라 말하게 한다. 그리고 나서 다음 문장으로 넘어간다. 한 번에 여러 개를 나열하지 마.",
    "",
    plan.weekday === "일요일"
      ? `[일요일 테스트]\n${weekly.length}개로 본다. 새로 만들지 마. 부족하면 부족한 개수 그대로 진행해. 필요하면 getWeeklyTestSet을 호출해 같은 범위에서 다시 받아라.`
      : "[평일]\n주간 테스트를 새로 만들지 마. 오늘 요일의 테마와 변동코너만 진행해.",
    "",
    "[도구]",
    "saveStudySession/getYesterdaySession/getStudyMemory/getWeeklyTestSet만 사용한다. 시장/검색/포트폴리오/Cortex 도구는 이 프로파일에 없다.",
  ].join("\n");
}
