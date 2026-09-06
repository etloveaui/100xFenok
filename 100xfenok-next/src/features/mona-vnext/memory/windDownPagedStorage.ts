import {
  appendWindDownHabitCompletionEvent,
  normalizeWindDownHabitCompletionEvent,
  type WindDownHabitAppendResult,
  type WindDownHabitCompletionEvent,
} from "@/features/winddown/habit/domain";
import {
  createEmptyMonaVnextLearningProfile,
  normalizeMonaVnextLearningProfile,
  type MonaVnextLearningProfile,
  type MonaVnextLearningRecord,
} from "@/features/mona-vnext/memory/fsrsLearningProfile";

/** The old rows remain compatibility sources and are never rewritten. */
export const WIND_DOWN_HABIT_LEGACY_STORAGE_KEY = "winddown-habit-events";
export const WIND_DOWN_PROFILE_LEGACY_STORAGE_KEY = "mona-vnext-learning-profile";

const STORAGE_VERSION = 2 as const;
export const WIND_DOWN_HABIT_MANIFEST_STORAGE_KEY =
  "winddown-habit-events:v2:manifest";
const HABIT_PAGE_PREFIX = "winddown-habit-events:v2:page:";
const HABIT_EVENT_INDEX_PREFIX = "winddown-habit-events:v2:event:";
export const WIND_DOWN_PROFILE_MANIFEST_STORAGE_KEY =
  "mona-vnext-learning-profile:v2:manifest";
const PROFILE_RECORD_PAGE_PREFIX = "mona-vnext-learning-profile:v2:records:";
const PROFILE_APPLIED_PAGE_PREFIX = "mona-vnext-learning-profile:v2:applied:";
const PROFILE_LEGACY_KV_SOURCE_KEY =
  "mona-vnext-learning-profile:legacy-kv-source";
export const WIND_DOWN_PROFILE_LEGACY_KV_SOURCE_MANIFEST_KEY =
  "mona-vnext-learning-profile:legacy-kv-source:v2:manifest";
export const WIND_DOWN_PROFILE_LEGACY_KV_SOURCE_CHUNK_PREFIX =
  "mona-vnext-learning-profile:legacy-kv-source:v2:chunk:";

/** Keep a comfortable margin below the 2 MiB SQLite DO key/value limit. */
export const WIND_DOWN_PAGE_VALUE_BYTE_LIMIT = 512 * 1024;
export const WIND_DOWN_DO_VALUE_BYTE_LIMIT = 2 * 1024 * 1024;
const STORAGE_LIST_PAGE_SIZE = 100;
const LEGACY_SOURCE_CHUNK_CODE_UNIT_LIMIT = 64 * 1024;

export type WindDownStorageListOptions = {
  limit?: number;
  startAfter?: string;
  prefix?: string;
  reverse?: boolean;
};

/** The subset shared by Durable Object storage and the in-memory regression fake. */
export type WindDownPagedStorageTransaction = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  list?: (
    options?: WindDownStorageListOptions,
  ) => Promise<Map<string, unknown>>;
};

export type WindDownPagedStorageErrorCode =
  | "WINDDOWN_STORAGE_PAGE_TOO_LARGE"
  | "WINDDOWN_STORAGE_LIST_INVALID"
  | "WINDDOWN_STORAGE_MANIFEST_INVALID";

export class WindDownPagedStorageError extends Error {
  constructor(readonly code: WindDownPagedStorageErrorCode) {
    super(code);
    this.name = "WindDownPagedStorageError";
  }
}

type HabitManifest = {
  schemaVersion: typeof STORAGE_VERSION;
  kind: "habit-events";
  pageCount: number;
  totalCount: number;
};

type HabitPage = {
  schemaVersion: typeof STORAGE_VERSION;
  kind: "habit-events-page";
  page: number;
  events: WindDownHabitCompletionEvent[];
};

type HabitPageState = {
  manifest: HabitManifest;
  pages: HabitPage[];
  events: WindDownHabitCompletionEvent[];
};

type ProfileManifest = {
  schemaVersion: typeof STORAGE_VERSION;
  kind: "learning-profile";
  recordPageCount: number;
  appliedEventIdPageCount: number;
  recordCount: number;
  appliedEventIdCount: number;
  updatedAt: string | null;
};

type ProfileRecordPage = {
  schemaVersion: typeof STORAGE_VERSION;
  kind: "learning-profile-records-page";
  page: number;
  records: MonaVnextLearningRecord[];
};

type ProfileAppliedPage = {
  schemaVersion: typeof STORAGE_VERSION;
  kind: "learning-profile-applied-page";
  page: number;
  appliedEventIds: string[];
};

type ProfilePageState = {
  manifest: ProfileManifest;
  recordPages: ProfileRecordPage[];
  appliedPages: ProfileAppliedPage[];
  profile: MonaVnextLearningProfile;
};

type LegacyKvSourceManifest = {
  schemaVersion: typeof STORAGE_VERSION;
  kind: "legacy-kv-source";
  encoding: "utf8";
  chunkCount: number;
  byteLength: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pageKey(prefix: string, page: number) {
  return `${prefix}${String(page).padStart(8, "0")}`;
}

function serializedByteLength(value: unknown) {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string") {
    throw new WindDownPagedStorageError("WINDDOWN_STORAGE_PAGE_TOO_LARGE");
  }
  return new TextEncoder().encode(serialized).byteLength;
}

function fitsPage(value: unknown) {
  return serializedByteLength(value) <= WIND_DOWN_PAGE_VALUE_BYTE_LIMIT;
}

function chunkValues<T>(
  values: readonly T[],
  buildPage: (page: number, values: T[]) => unknown,
  toPageValue: (value: T) => unknown,
) {
  const pages: T[][] = [];
  let current: T[] = [];
  let currentBytes = 0;
  let emptyPageBytes = serializedByteLength(buildPage(0, []));
  for (const value of values) {
    const valueBytes = serializedByteLength(toPageValue(value));
    const nextBytes = emptyPageBytes
      + currentBytes
      + valueBytes
      + (current.length > 0 ? 1 : 0);
    if (nextBytes <= WIND_DOWN_PAGE_VALUE_BYTE_LIMIT) {
      current.push(value);
      currentBytes = nextBytes - emptyPageBytes;
      continue;
    }
    if (current.length === 0) {
      if (!fitsPage(buildPage(pages.length, [value]))) {
        throw new WindDownPagedStorageError("WINDDOWN_STORAGE_PAGE_TOO_LARGE");
      }
      current = [value];
      currentBytes = valueBytes;
      continue;
    }
    const nextPageIndex = pages.length + 1;
    if (!fitsPage(buildPage(nextPageIndex, [value]))) {
      throw new WindDownPagedStorageError("WINDDOWN_STORAGE_PAGE_TOO_LARGE");
    }
    pages.push(current);
    current = [value];
    emptyPageBytes = serializedByteLength(buildPage(nextPageIndex, []));
    currentBytes = valueBytes;
  }
  if (current.length > 0) {
    if (!fitsPage(buildPage(pages.length, current))) {
      throw new WindDownPagedStorageError("WINDDOWN_STORAGE_PAGE_TOO_LARGE");
    }
    pages.push(current);
  }
  return pages;
}

function validCount(value: unknown) {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0;
}

function normalizeHabitManifest(value: unknown): HabitManifest | null {
  if (!isRecord(value)) return null;
  return value.schemaVersion === STORAGE_VERSION
    && value.kind === "habit-events"
    && validCount(value.pageCount)
    && validCount(value.totalCount)
    ? {
        schemaVersion: STORAGE_VERSION,
        kind: "habit-events",
        pageCount: value.pageCount,
        totalCount: value.totalCount,
      }
    : null;
}

function normalizeHabitPage(value: unknown, page: number): HabitPage | null {
  if (!isRecord(value) || value.schemaVersion !== STORAGE_VERSION) return null;
  if (value.kind !== "habit-events-page" || value.page !== page) return null;
  if (!Array.isArray(value.events)) return null;
  try {
    return {
      schemaVersion: STORAGE_VERSION,
      kind: "habit-events-page",
      page,
      events: value.events.map(normalizeWindDownHabitCompletionEvent),
    };
  } catch {
    return null;
  }
}

function normalizeProfileManifest(value: unknown): ProfileManifest | null {
  if (!isRecord(value)) return null;
  const updatedAt = value.updatedAt;
  if (
    updatedAt !== null
    && (
      typeof updatedAt !== "string"
      || !Number.isFinite(Date.parse(updatedAt))
    )
  ) return null;
  return value.schemaVersion === STORAGE_VERSION
    && value.kind === "learning-profile"
    && validCount(value.recordPageCount)
    && validCount(value.appliedEventIdPageCount)
    && validCount(value.recordCount)
    && validCount(value.appliedEventIdCount)
    ? {
        schemaVersion: STORAGE_VERSION,
        kind: "learning-profile",
        recordPageCount: value.recordPageCount,
        appliedEventIdPageCount: value.appliedEventIdPageCount,
        recordCount: value.recordCount,
        appliedEventIdCount: value.appliedEventIdCount,
        updatedAt,
      }
    : null;
}

function normalizeProfileRecordPage(
  value: unknown,
  page: number,
): ProfileRecordPage | null {
  if (!isRecord(value) || value.schemaVersion !== STORAGE_VERSION) return null;
  return value.kind === "learning-profile-records-page"
    && value.page === page
    && Array.isArray(value.records)
    ? {
        schemaVersion: STORAGE_VERSION,
        kind: "learning-profile-records-page",
        page,
        records: value.records as MonaVnextLearningRecord[],
      }
    : null;
}

function normalizeProfileAppliedPage(
  value: unknown,
  page: number,
): ProfileAppliedPage | null {
  if (!isRecord(value) || value.schemaVersion !== STORAGE_VERSION) return null;
  return value.kind === "learning-profile-applied-page"
    && value.page === page
    && Array.isArray(value.appliedEventIds)
    && value.appliedEventIds.every((item) => typeof item === "string")
    ? {
        schemaVersion: STORAGE_VERSION,
        kind: "learning-profile-applied-page",
        page,
        appliedEventIds: value.appliedEventIds as string[],
      }
    : null;
}

function normalizeLegacyKvSourceManifest(
  value: unknown,
): LegacyKvSourceManifest | null {
  if (!isRecord(value)) return null;
  return value.schemaVersion === STORAGE_VERSION
    && value.kind === "legacy-kv-source"
    && value.encoding === "utf8"
    && validCount(value.chunkCount)
    && validCount(value.byteLength)
    ? {
        schemaVersion: STORAGE_VERSION,
        kind: "legacy-kv-source",
        encoding: "utf8",
        chunkCount: value.chunkCount,
        byteLength: value.byteLength,
      }
    : null;
}

async function listAllByPrefix(
  storage: WindDownPagedStorageTransaction,
  prefix: string,
) {
  if (!storage.list) return null;
  const values = new Map<string, unknown>();
  let startAfter: string | undefined;
  while (true) {
    const page = await storage.list({
      prefix,
      limit: STORAGE_LIST_PAGE_SIZE,
      ...(startAfter ? { startAfter } : {}),
    });
    if (!(page instanceof Map)) {
      throw new WindDownPagedStorageError("WINDDOWN_STORAGE_LIST_INVALID");
    }
    for (const [key, value] of page) values.set(key, value);
    if (page.size < STORAGE_LIST_PAGE_SIZE) break;
    const keys = [...page.keys()].sort((left, right) => left.localeCompare(right));
    const nextStartAfter = keys.at(-1);
    if (!nextStartAfter || nextStartAfter === startAfter) {
      throw new WindDownPagedStorageError("WINDDOWN_STORAGE_LIST_INVALID");
    }
    startAfter = nextStartAfter;
  }
  return values;
}

async function readIndexedPages<T>(args: {
  storage: WindDownPagedStorageTransaction;
  prefix: string;
  pageCount: number;
  normalize: (value: unknown, page: number) => T | null;
}) {
  const listed = await listAllByPrefix(args.storage, args.prefix);
  const pages: T[] = [];
  for (let page = 0; page < args.pageCount; page += 1) {
    const key = pageKey(args.prefix, page);
    const raw = listed
      ? listed.get(key)
      : await args.storage.get<unknown>(key);
    const normalized = args.normalize(raw, page);
    if (!normalized) return null;
    pages.push(normalized);
  }
  return pages;
}

async function readHabitPageState(
  storage: WindDownPagedStorageTransaction,
): Promise<HabitPageState | null> {
  const rawManifest = await storage.get<unknown>(
    WIND_DOWN_HABIT_MANIFEST_STORAGE_KEY,
  );
  if (rawManifest === undefined) return null;
  const manifest = normalizeHabitManifest(rawManifest);
  if (!manifest) {
    throw new WindDownPagedStorageError("WINDDOWN_STORAGE_MANIFEST_INVALID");
  }
  const pages = await readIndexedPages({
    storage,
    prefix: HABIT_PAGE_PREFIX,
    pageCount: manifest.pageCount,
    normalize: normalizeHabitPage,
  });
  if (!pages) {
    throw new WindDownPagedStorageError("WINDDOWN_STORAGE_MANIFEST_INVALID");
  }
  const events = pages.flatMap((page) => page.events);
  if (events.length !== manifest.totalCount) {
    throw new WindDownPagedStorageError("WINDDOWN_STORAGE_MANIFEST_INVALID");
  }
  return { manifest, pages, events };
}

/** Read the complete habit ledger from active pages, falling back to the raw row. */
export async function readWindDownHabitEvents(
  storage: WindDownPagedStorageTransaction,
) {
  const active = await readHabitPageState(storage);
  if (active) return active.events;
  const legacy = await storage.get<unknown>(WIND_DOWN_HABIT_LEGACY_STORAGE_KEY);
  return Array.isArray(legacy) ? legacy as WindDownHabitCompletionEvent[] : [];
}

function buildHabitPage(page: number, events: WindDownHabitCompletionEvent[]): HabitPage {
  return {
    schemaVersion: STORAGE_VERSION,
    kind: "habit-events-page",
    page,
    events,
  };
}

function sameEventOrder(
  left: readonly WindDownHabitCompletionEvent[],
  right: readonly WindDownHabitCompletionEvent[],
) {
  return left.length === right.length
    && left.every((event, index) => event.eventId === right[index]?.eventId);
}

async function writeHabitPages(
  storage: WindDownPagedStorageTransaction,
  events: readonly WindDownHabitCompletionEvent[],
  existing: HabitPageState | null,
  candidate: WindDownHabitCompletionEvent,
) {
  const values = [...events];
  const pages = chunkValues(values, buildHabitPage, (event) => event);
  for (let page = 0; page < pages.length; page += 1) {
    const next = buildHabitPage(page, pages[page]);
    const previous = existing?.pages[page];
    if (!previous || JSON.stringify(previous) !== JSON.stringify(next)) {
      await storage.put(pageKey(HABIT_PAGE_PREFIX, page), next);
    }
  }
  if (!existing) {
    for (let page = 0; page < pages.length; page += 1) {
      for (const event of pages[page]) {
        await storage.put(
          `${HABIT_EVENT_INDEX_PREFIX}${encodeURIComponent(event.eventId)}`,
          { schemaVersion: STORAGE_VERSION, eventId: event.eventId, page },
        );
      }
    }
  } else {
    await storage.put(
      `${HABIT_EVENT_INDEX_PREFIX}${encodeURIComponent(candidate.eventId)}`,
      {
        schemaVersion: STORAGE_VERSION,
        eventId: candidate.eventId,
        page: pages.findIndex((page) => page.some((event) => event.eventId === candidate.eventId)),
      },
    );
  }
  await storage.put<HabitManifest>(WIND_DOWN_HABIT_MANIFEST_STORAGE_KEY, {
    schemaVersion: STORAGE_VERSION,
    kind: "habit-events",
    pageCount: pages.length,
    totalCount: values.length,
  });
}

/** Append once inside the caller's transaction; a retry leaves every page unchanged. */
export async function appendWindDownHabitEvent(
  storage: WindDownPagedStorageTransaction,
  candidate: WindDownHabitCompletionEvent,
): Promise<WindDownHabitAppendResult> {
  const active = await readHabitPageState(storage);
  const existing = active
    ? active.events
    : await readWindDownHabitEvents(storage);
  const appended = appendWindDownHabitCompletionEvent(existing, candidate);
  if (appended.duplicate) return appended;

  const normalizedCandidate = appended.events.find(
    (event) => event.eventId === candidate.eventId,
  );
  if (!normalizedCandidate) {
    throw new WindDownPagedStorageError("WINDDOWN_STORAGE_LIST_INVALID");
  }

  // The normal path appends to the tail. An out-of-order receipt is still
  // lossless, but may rewrite the pages from its insertion point once.
  if (
    active
    && active.pages.length > 0
    && sameEventOrder(appended.events.slice(0, existing.length), existing)
    && appended.events.at(-1)?.eventId === normalizedCandidate.eventId
  ) {
    const tailPageIndex = Math.max(0, active.pages.length - 1);
    const tail = active.pages[tailPageIndex]?.events ?? [];
    const nextTail = [...tail, normalizedCandidate];
    if (fitsPage(buildHabitPage(tailPageIndex, nextTail))) {
      await storage.put(
        pageKey(HABIT_PAGE_PREFIX, tailPageIndex),
        buildHabitPage(tailPageIndex, nextTail),
      );
      await storage.put(
        `${HABIT_EVENT_INDEX_PREFIX}${encodeURIComponent(normalizedCandidate.eventId)}`,
        {
          schemaVersion: STORAGE_VERSION,
          eventId: normalizedCandidate.eventId,
          page: tailPageIndex,
        },
      );
      await storage.put<HabitManifest>(WIND_DOWN_HABIT_MANIFEST_STORAGE_KEY, {
        ...active.manifest,
        totalCount: active.manifest.totalCount + 1,
      });
      return appended;
    }
    const nextPageIndex = active.manifest.pageCount;
    await storage.put(
      pageKey(HABIT_PAGE_PREFIX, nextPageIndex),
      buildHabitPage(nextPageIndex, [normalizedCandidate]),
    );
    await storage.put(
      `${HABIT_EVENT_INDEX_PREFIX}${encodeURIComponent(normalizedCandidate.eventId)}`,
      {
        schemaVersion: STORAGE_VERSION,
        eventId: normalizedCandidate.eventId,
        page: nextPageIndex,
      },
    );
    await storage.put<HabitManifest>(WIND_DOWN_HABIT_MANIFEST_STORAGE_KEY, {
      ...active.manifest,
      pageCount: active.manifest.pageCount + 1,
      totalCount: active.manifest.totalCount + 1,
    });
    return appended;
  }

  await writeHabitPages(storage, appended.events, active, normalizedCandidate);
  return appended;
}

function buildProfileRecordPage(
  page: number,
  records: [string, MonaVnextLearningRecord][],
): ProfileRecordPage {
  return {
    schemaVersion: STORAGE_VERSION,
    kind: "learning-profile-records-page",
    page,
    records: records.map(([, record]) => record),
  };
}

function buildProfileAppliedPage(
  page: number,
  appliedEventIds: string[],
): ProfileAppliedPage {
  return {
    schemaVersion: STORAGE_VERSION,
    kind: "learning-profile-applied-page",
    page,
    appliedEventIds,
  };
}

async function readProfilePageState(
  storage: WindDownPagedStorageTransaction,
): Promise<ProfilePageState | null> {
  const rawManifest = await storage.get<unknown>(
    WIND_DOWN_PROFILE_MANIFEST_STORAGE_KEY,
  );
  if (rawManifest === undefined) return null;
  const manifest = normalizeProfileManifest(rawManifest);
  if (!manifest) {
    throw new WindDownPagedStorageError("WINDDOWN_STORAGE_MANIFEST_INVALID");
  }
  const recordPages = await readIndexedPages({
    storage,
    prefix: PROFILE_RECORD_PAGE_PREFIX,
    pageCount: manifest.recordPageCount,
    normalize: normalizeProfileRecordPage,
  });
  const appliedPages = await readIndexedPages({
    storage,
    prefix: PROFILE_APPLIED_PAGE_PREFIX,
    pageCount: manifest.appliedEventIdPageCount,
    normalize: normalizeProfileAppliedPage,
  });
  if (!recordPages || !appliedPages) {
    throw new WindDownPagedStorageError("WINDDOWN_STORAGE_MANIFEST_INVALID");
  }
  const rawRecords = recordPages.flatMap((page) => page.records);
  const appliedEventIds = appliedPages.flatMap((page) => page.appliedEventIds);
  if (
    rawRecords.length !== manifest.recordCount
    || appliedEventIds.length !== manifest.appliedEventIdCount
  ) {
    throw new WindDownPagedStorageError("WINDDOWN_STORAGE_MANIFEST_INVALID");
  }
  const records: Record<string, MonaVnextLearningRecord> = {};
  for (const record of rawRecords) {
    if (!isRecord(record) || typeof record.expressionId !== "string") {
      throw new WindDownPagedStorageError("WINDDOWN_STORAGE_MANIFEST_INVALID");
    }
    records[record.expressionId] = record;
  }
  const profile = normalizeMonaVnextLearningProfile({
    ...createEmptyMonaVnextLearningProfile(),
    updatedAt: manifest.updatedAt,
    records,
    appliedEventIds,
  });
  if (
    Object.keys(profile.records).length !== manifest.recordCount
    || profile.appliedEventIds.length !== manifest.appliedEventIdCount
  ) {
    throw new WindDownPagedStorageError("WINDDOWN_STORAGE_MANIFEST_INVALID");
  }
  return { manifest, recordPages, appliedPages, profile };
}

/** Read the complete paged profile, or the untouched compatibility row. */
export async function readMonaVnextLearningProfile(
  storage: WindDownPagedStorageTransaction,
) {
  const active = await readProfilePageState(storage);
  if (active) return active.profile;
  const legacy = await storage.get<unknown>(WIND_DOWN_PROFILE_LEGACY_STORAGE_KEY);
  return legacy === undefined
    ? createEmptyMonaVnextLearningProfile()
    : normalizeMonaVnextLearningProfile(legacy);
}

function profileRecordEntries(profile: MonaVnextLearningProfile) {
  return Object.entries(profile.records)
    .sort(([left], [right]) => left.localeCompare(right));
}

/**
 * Publish pages after the caller has produced the next profile. Existing pages
 * are compared byte-for-byte, so ordinary reviews rewrite only affected record
 * pages and the applied-ID tail; the legacy profile row is never overwritten.
 */
export async function writeMonaVnextLearningProfile(
  storage: WindDownPagedStorageTransaction,
  profile: MonaVnextLearningProfile,
) {
  const normalized = normalizeMonaVnextLearningProfile(profile);
  const existing = await readProfilePageState(storage);
  const recordEntries = profileRecordEntries(normalized);
  const recordPages = chunkValues(
    recordEntries,
    buildProfileRecordPage,
    ([, record]) => record,
  );
  const appliedPages = chunkValues(
    normalized.appliedEventIds,
    buildProfileAppliedPage,
    (eventId) => eventId,
  );

  for (let page = 0; page < recordPages.length; page += 1) {
    const next = buildProfileRecordPage(page, recordPages[page]);
    const previous = existing?.recordPages[page];
    if (!previous || JSON.stringify(previous) !== JSON.stringify(next)) {
      await storage.put(pageKey(PROFILE_RECORD_PAGE_PREFIX, page), next);
    }
  }
  for (let page = 0; page < appliedPages.length; page += 1) {
    const next = buildProfileAppliedPage(page, appliedPages[page]);
    const previous = existing?.appliedPages[page];
    if (!previous || JSON.stringify(previous) !== JSON.stringify(next)) {
      await storage.put(pageKey(PROFILE_APPLIED_PAGE_PREFIX, page), next);
    }
  }

  await storage.put<ProfileManifest>(WIND_DOWN_PROFILE_MANIFEST_STORAGE_KEY, {
    schemaVersion: STORAGE_VERSION,
    kind: "learning-profile",
    recordPageCount: recordPages.length,
    appliedEventIdPageCount: appliedPages.length,
    recordCount: recordEntries.length,
    appliedEventIdCount: normalized.appliedEventIds.length,
    updatedAt: normalized.updatedAt,
  });
  return normalized;
}

export const WIND_DOWN_PROFILE_LEGACY_KV_SOURCE_KEY = PROFILE_LEGACY_KV_SOURCE_KEY;

function splitLegacyKvSource(raw: string) {
  const chunks: string[] = [];
  let start = 0;
  while (start < raw.length) {
    // A conservative UTF-16 bound keeps even escaped/control-heavy chunks
    // below the 512 KiB page limit; never split a surrogate pair.
    let end = Math.min(
      raw.length,
      start + LEGACY_SOURCE_CHUNK_CODE_UNIT_LIMIT,
    );
    if (
      end < raw.length
      && end > start
      && raw.charCodeAt(end - 1) >= 0xd800
      && raw.charCodeAt(end - 1) <= 0xdbff
      && raw.charCodeAt(end) >= 0xdc00
      && raw.charCodeAt(end) <= 0xdfff
    ) {
      end -= 1;
    }
    const chunk = raw.slice(start, end);
    if (
      chunk.length === 0
      || serializedByteLength(chunk) > WIND_DOWN_PAGE_VALUE_BYTE_LIMIT
    ) {
      throw new WindDownPagedStorageError("WINDDOWN_STORAGE_PAGE_TOO_LARGE");
    }
    chunks.push(chunk);
    start = end;
  }
  return chunks;
}

function normalizeLegacyKvSourceChunk(value: unknown): string | null {
  return typeof value === "string"
    && serializedByteLength(value) <= WIND_DOWN_PAGE_VALUE_BYTE_LIMIT
    ? value
    : null;
}

/** Read the exact legacy KV payload from its compatibility key or source pages. */
export async function readWindDownLegacyKvSource(
  storage: WindDownPagedStorageTransaction,
) {
  const rawManifest = await storage.get<unknown>(
    WIND_DOWN_PROFILE_LEGACY_KV_SOURCE_MANIFEST_KEY,
  );
  if (rawManifest === undefined) {
    const legacy = await storage.get<unknown>(PROFILE_LEGACY_KV_SOURCE_KEY);
    if (legacy === undefined) return null;
    if (typeof legacy !== "string") {
      throw new WindDownPagedStorageError("WINDDOWN_STORAGE_MANIFEST_INVALID");
    }
    return legacy;
  }

  const manifest = normalizeLegacyKvSourceManifest(rawManifest);
  if (!manifest) {
    throw new WindDownPagedStorageError("WINDDOWN_STORAGE_MANIFEST_INVALID");
  }
  const chunks = await readIndexedPages<string>({
    storage,
    prefix: WIND_DOWN_PROFILE_LEGACY_KV_SOURCE_CHUNK_PREFIX,
    pageCount: manifest.chunkCount,
    normalize: (value) => normalizeLegacyKvSourceChunk(value),
  });
  if (!chunks) {
    throw new WindDownPagedStorageError("WINDDOWN_STORAGE_MANIFEST_INVALID");
  }
  const raw = chunks.join("");
  if (new TextEncoder().encode(raw).byteLength !== manifest.byteLength) {
    throw new WindDownPagedStorageError("WINDDOWN_STORAGE_MANIFEST_INVALID");
  }
  return raw;
}

/** Store an exact legacy KV payload once, before any normalized seed is written. */
export async function preserveWindDownLegacyKvSource(
  storage: WindDownPagedStorageTransaction,
  raw: string,
) {
  const existingManifest = await storage.get<unknown>(
    WIND_DOWN_PROFILE_LEGACY_KV_SOURCE_MANIFEST_KEY,
  );
  if (existingManifest !== undefined) {
    await readWindDownLegacyKvSource(storage);
    return;
  }
  const existing = await storage.get<unknown>(PROFILE_LEGACY_KV_SOURCE_KEY);
  if (existing !== undefined) {
    if (typeof existing !== "string") {
      throw new WindDownPagedStorageError("WINDDOWN_STORAGE_MANIFEST_INVALID");
    }
    return;
  }
  if (serializedByteLength(raw) <= WIND_DOWN_PAGE_VALUE_BYTE_LIMIT) {
    await storage.put(PROFILE_LEGACY_KV_SOURCE_KEY, raw);
    return;
  }

  const chunks = splitLegacyKvSource(raw);
  for (let page = 0; page < chunks.length; page += 1) {
    await storage.put(
      pageKey(WIND_DOWN_PROFILE_LEGACY_KV_SOURCE_CHUNK_PREFIX, page),
      chunks[page],
    );
  }
  await storage.put<LegacyKvSourceManifest>(
    WIND_DOWN_PROFILE_LEGACY_KV_SOURCE_MANIFEST_KEY,
    {
      schemaVersion: STORAGE_VERSION,
      kind: "legacy-kv-source",
      encoding: "utf8",
      chunkCount: chunks.length,
      byteLength: new TextEncoder().encode(raw).byteLength,
    },
  );
}

export function shouldPageMonaVnextLearningProfileSeed(
  raw: string,
  profile: MonaVnextLearningProfile,
) {
  // SQLite bounds the key and value together; reserve the maximum key size.
  const seedValueLimit = WIND_DOWN_DO_VALUE_BYTE_LIMIT - 2_048;
  return serializedByteLength(raw) > seedValueLimit
    || serializedByteLength(profile) > seedValueLimit;
}

/** Preserve a legacy KV seed, then choose a legacy row or active pages safely. */
export async function initializeMonaVnextLearningProfileFromLegacyKv(
  storage: WindDownPagedStorageTransaction,
  raw: string | null,
) {
  if (raw !== null) {
    await preserveWindDownLegacyKvSource(storage, raw);
  }
  const profile = raw === null
    ? createEmptyMonaVnextLearningProfile()
    : normalizeMonaVnextLearningProfile(JSON.parse(raw));
  if (raw !== null && shouldPageMonaVnextLearningProfileSeed(raw, profile)) {
    return writeMonaVnextLearningProfile(storage, profile);
  }
  await storage.put(WIND_DOWN_PROFILE_LEGACY_STORAGE_KEY, profile);
  return profile;
}
