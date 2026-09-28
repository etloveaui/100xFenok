"use client";

/**
 * personalStore — Client sync layer over device-local personalization (Spec §6, Task S4 & S4b).
 *
 * Keys supported:
 *   - "portfolio" -> localStorage "fenok.portfolio.v1"
 *   - "watchlist" -> localStorage "fenok.watchlist.v1"
 *   - "ib" -> localStorage "ib_profiles" and "ib_daily_data_<profile>_<symbol>"
 *   - "macro-presets" -> localStorage "100xfenok.macroChart.userPresets.v1"
 *   - "ib:<profileId>" -> split profile documents if IB data exceeds 256 KB
 *
 * Behavior:
 *   - Logged out: reads & writes localStorage only (byte-for-byte compatible with existing keys).
 *   - Logged in:
 *       - read: returns cached/local data immediately, fetches server in background;
 *         server updatedAt > local updatedAt -> adopts server data.
 *       - write: writes localStorage immediately, then debounces (500ms) PUT to /api/user/store/{key}.
 *       - subscribe(key, fn): reactive subscriber notified on any local or remote change.
 *   - Adopt-on-login:
 *       - Evaluates all 4 keys.
 *       - If multiple keys conflict, fires a single prompt listing all conflicting items:
 *         "포트폴리오 · 관심종목 · 무한매수 기록 · 매크로 프리셋".
 */

import { loadAuthToken, getCachedUser, onAuthUserChange } from "@/lib/auth/clientAuth";

export type PersonalStoreKey =
  | "portfolio"
  | "watchlist"
  | "ib"
  | "macro-presets"
  | `ib:${string}`;

export const MAX_STORE_SIZE_BYTES = 256 * 1024; // 256 KB

export const STORE_STORAGE_KEYS: Record<string, string> = {
  portfolio: "fenok.portfolio.v1",
  watchlist: "fenok.watchlist.v1",
  "macro-presets": "100xfenok.macroChart.userPresets.v1",
  ib: "ib_profiles",
};

export const STORE_KEY_LABELS: Record<string, string> = {
  portfolio: "포트폴리오",
  watchlist: "관심종목",
  ib: "무한매수 기록",
  "macro-presets": "매크로 프리셋",
};

export interface IbStoreDocument {
  version?: string;
  activeProfileId?: string | null;
  profiles?: Record<string, unknown>;
  daily?: Record<string, unknown>; // key: `${profileId}_${symbol}`
  updatedAt?: number;
}

export interface IbProfileStoreDocument {
  version?: string;
  profileId: string;
  profile: unknown;
  daily: Record<string, unknown>;
  updatedAt?: number;
}

export function packIbStoreFromLocal(): IbStoreDocument | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const rawProfiles = window.localStorage.getItem("ib_profiles");
    if (!rawProfiles) return null;
    const parsed = JSON.parse(rawProfiles);
    const daily: Record<string, unknown> = {};

    if (typeof window.localStorage.length === "number" && typeof window.localStorage.key === "function") {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith("ib_daily_data_")) {
          const suffix = k.slice("ib_daily_data_".length);
          const rawDaily = window.localStorage.getItem(k);
          if (rawDaily) {
            try {
              daily[suffix] = JSON.parse(rawDaily);
            } catch {
              // ignore malformed item
            }
          }
        }
      }
    } else {
      for (const k of Object.keys(window.localStorage)) {
        if (k.startsWith("ib_daily_data_")) {
          const suffix = k.slice("ib_daily_data_".length);
          const rawDaily = window.localStorage.getItem(k);
          if (rawDaily) {
            try {
              daily[suffix] = JSON.parse(rawDaily);
            } catch {
              // ignore
            }
          }
        }
      }
    }

    return {
      version: parsed.version || "1.0.0",
      activeProfileId: parsed.activeProfileId ?? null,
      profiles: parsed.profiles ?? {},
      daily,
      updatedAt: parsed.updatedAt ?? Date.now(),
    };
  } catch {
    return null;
  }
}

export function unpackIbStoreToLocal(doc: IbStoreDocument): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const profileStore = {
      version: doc.version || "1.0.0",
      activeProfileId: doc.activeProfileId ?? null,
      profiles: doc.profiles ?? {},
    };
    window.localStorage.setItem("ib_profiles", JSON.stringify(profileStore));

    if (doc.daily && typeof doc.daily === "object") {
      for (const [suffix, val] of Object.entries(doc.daily)) {
        window.localStorage.setItem(`ib_daily_data_${suffix}`, JSON.stringify(val));
      }
    }
  } catch {
    // Storage full or private mode
  }
}

export function splitIbStoreDocument(doc: IbStoreDocument): {
  rootDoc: IbStoreDocument;
  profileDocs: Record<string, IbProfileStoreDocument>;
} {
  const profileDocs: Record<string, IbProfileStoreDocument> = {};
  const profiles = doc.profiles ?? {};
  const daily = doc.daily ?? {};

  for (const [profileId, profile] of Object.entries(profiles)) {
    const profileDaily: Record<string, unknown> = {};
    const prefix = `${profileId}_`;
    for (const [k, v] of Object.entries(daily)) {
      if (k === profileId || k.startsWith(prefix)) {
        profileDaily[k] = v;
      }
    }
    profileDocs[profileId] = {
      version: doc.version,
      profileId,
      profile,
      daily: profileDaily,
      updatedAt: doc.updatedAt,
    };
  }

  const rootDoc: IbStoreDocument = {
    version: doc.version,
    activeProfileId: doc.activeProfileId,
    profiles: doc.profiles,
    daily: {},
    updatedAt: doc.updatedAt,
  };

  return { rootDoc, profileDocs };
}

export function mergeIbStoreDocuments(
  rootDoc: IbStoreDocument,
  profileDocs: Record<string, IbProfileStoreDocument>,
): IbStoreDocument {
  const profiles = { ...(rootDoc.profiles ?? {}) };
  const daily = { ...(rootDoc.daily ?? {}) };

  for (const [profileId, pDoc] of Object.entries(profileDocs)) {
    if (pDoc.profile) {
      profiles[profileId] = pDoc.profile;
    }
    if (pDoc.daily) {
      Object.assign(daily, pDoc.daily);
    }
  }

  return {
    ...rootDoc,
    profiles,
    daily,
  };
}

export function normalizeStoreKey(key: string): PersonalStoreKey | null {
  if (key === "portfolio" || key === "fenok.portfolio.v1") return "portfolio";
  if (key === "watchlist" || key === "fenok.watchlist.v1") return "watchlist";
  if (key === "macro-presets" || key === "100xfenok.macroChart.userPresets.v1") return "macro-presets";
  if (key === "ib" || key === "ib_profiles") return "ib";
  if (key.startsWith("ib:") && /^ib:[A-Za-z0-9._-]+$/.test(key)) return key as PersonalStoreKey;
  return null;
}

type Listener = () => void;
const keyListeners = new Map<PersonalStoreKey, Set<Listener>>();
const debounceTimers = new Map<PersonalStoreKey, ReturnType<typeof setTimeout>>();
const inFlightSyncs = new Set<PersonalStoreKey>();

export function read<T = unknown>(key: PersonalStoreKey | string): T | null {
  const norm = normalizeStoreKey(key);
  if (!norm) return null;
  if (typeof window === "undefined") return null;

  if (norm === "ib") {
    return packIbStoreFromLocal() as T | null;
  }

  const storageKey = STORE_STORAGE_KEYS[norm];
  if (!storageKey) return null;

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function write<T = unknown>(key: PersonalStoreKey | string, value: T): void {
  const norm = normalizeStoreKey(key);
  if (!norm) return;
  if (typeof window === "undefined") return;

  if (norm === "ib") {
    if (value && typeof value === "object") {
      unpackIbStoreToLocal(value as IbStoreDocument);
    }
  } else {
    const storageKey = STORE_STORAGE_KEYS[norm];
    if (storageKey) {
      const raw = typeof value === "string" ? value : JSON.stringify(value);
      try {
        window.localStorage.setItem(storageKey, raw);
      } catch {
        // Storage full or private mode
      }
    }
  }

  notifyListeners(norm);
  queueServerWrite(norm, typeof value === "string" ? JSON.parse(value) : value);
}

export function subscribe(key: PersonalStoreKey | string, fn: Listener): () => void {
  const norm = normalizeStoreKey(key);
  if (!norm) return () => {};
  let set = keyListeners.get(norm);
  if (!set) {
    set = new Set();
    keyListeners.set(norm, set);
  }
  set.add(fn);

  const storageKey = STORE_STORAGE_KEYS[norm];
  const onStorage = (e: StorageEvent | { key?: string | null }) => {
    if (norm === "ib") {
      if (e.key === "ib_profiles" || (e.key && e.key.startsWith("ib_daily_data_"))) {
        fn();
      }
    } else if (storageKey && e.key === storageKey) {
      fn();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage as EventListener);
  }

  // Trigger background server sync once per key when logged in
  if (typeof window !== "undefined" && loadAuthToken()) {
    triggerBackgroundSync(norm).catch(() => {});
  }

  return () => {
    set?.delete(fn);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage as EventListener);
    }
  };
}

function notifyListeners(key: PersonalStoreKey): void {
  const set = keyListeners.get(key);
  if (set) {
    for (const fn of set) {
      try {
        fn();
      } catch {
        // ignore subscriber errors
      }
    }
  }
}

function queueServerWrite(key: PersonalStoreKey, value: unknown): void {
  if (typeof window === "undefined") return;
  const token = loadAuthToken();
  if (!token) return; // logged out -> localStorage only

  const existing = debounceTimers.get(key);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    debounceTimers.delete(key);
    try {
      const activeToken = loadAuthToken();
      if (!activeToken) return;

      const updatedAt = getDocUpdatedAtMs(value);
      const raw = JSON.stringify({ value, updatedAt });
      const byteLength = new TextEncoder().encode(raw).byteLength;

      // Size split rule for ib if exceeds MAX_STORE_SIZE_BYTES
      if (key === "ib" && byteLength > MAX_STORE_SIZE_BYTES && value && typeof value === "object") {
        const { rootDoc, profileDocs } = splitIbStoreDocument(value as IbStoreDocument);
        await fetch("/api/user/store/ib", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${activeToken}`,
          },
          body: JSON.stringify({ value: rootDoc, updatedAt }),
        });
        for (const [profileId, pDoc] of Object.entries(profileDocs)) {
          await fetch(`/api/user/store/ib:${profileId}`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${activeToken}`,
            },
            body: JSON.stringify({ value: pDoc, updatedAt }),
          });
        }
        return;
      }

      await fetch(`/api/user/store/${key}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeToken}`,
        },
        body: raw,
      });
    } catch {
      // Fail soft — local copy in localStorage is preserved
    }
  }, 500);

  debounceTimers.set(key, timer);
}

export function getDocUpdatedAtMs(doc: unknown): number {
  if (!doc) return 0;
  if (Array.isArray(doc)) {
    let maxMs = 0;
    for (const item of doc) {
      if (item && typeof item === "object") {
        if ("updatedAt" in item && typeof item.updatedAt === "string") {
          const ms = Date.parse(item.updatedAt);
          if (!isNaN(ms) && ms > maxMs) maxMs = ms;
        } else if ("updatedAt" in item && typeof item.updatedAt === "number") {
          if (item.updatedAt > maxMs) maxMs = item.updatedAt;
        } else if ("updated_at" in item && typeof item.updated_at === "string") {
          const ms = Date.parse(item.updated_at);
          if (!isNaN(ms) && ms > maxMs) maxMs = ms;
        }
      }
    }
    return maxMs > 0 ? maxMs : Date.now();
  }
  if (typeof doc === "object") {
    if ("updated_at" in doc && typeof (doc as { updated_at: unknown }).updated_at === "string") {
      const ms = Date.parse((doc as { updated_at: string }).updated_at);
      if (!isNaN(ms)) return ms;
    }
    if ("updatedAt" in doc && typeof (doc as { updatedAt: unknown }).updatedAt === "number") {
      return (doc as { updatedAt: number }).updatedAt;
    }
  }
  return Date.now();
}

export async function triggerBackgroundSync(key: PersonalStoreKey | string): Promise<void> {
  const norm = normalizeStoreKey(key);
  if (!norm || inFlightSyncs.has(norm)) return;
  const token = loadAuthToken();
  if (!token) return;

  inFlightSyncs.add(norm);
  try {
    const res = await fetch(`/api/user/store/${norm}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;

    const body = (await res.json()) as { ok: boolean; value: unknown; updatedAt: number };
    if (!body?.ok || body.value === null) return;

    let serverValue = body.value;
    if (norm === "ib" && serverValue && typeof serverValue === "object") {
      const root = serverValue as IbStoreDocument;
      const profiles = root.profiles ?? {};
      if (Object.keys(root.daily ?? {}).length === 0 && Object.keys(profiles).length > 0) {
        const profileDocs: Record<string, IbProfileStoreDocument> = {};
        let hasSplit = false;
        for (const profileId of Object.keys(profiles)) {
          try {
            const pRes = await fetch(`/api/user/store/ib:${profileId}`, {
              method: "GET",
              headers: { Authorization: `Bearer ${token}` },
            });
            if (pRes.ok) {
              const pBody = (await pRes.json()) as { ok?: boolean; value?: IbProfileStoreDocument };
              if (pBody?.ok && pBody.value) {
                profileDocs[profileId] = pBody.value;
                hasSplit = true;
              }
            }
          } catch {
            // ignore
          }
        }
        if (hasSplit) {
          serverValue = mergeIbStoreDocuments(root, profileDocs);
        }
      }
    }

    const localDoc = read(norm);
    const localUpdatedAt = getDocUpdatedAtMs(localDoc);

    // Last-write-wins by server updatedAt
    if (body.updatedAt > localUpdatedAt) {
      if (norm === "ib") {
        unpackIbStoreToLocal(serverValue as IbStoreDocument);
      } else {
        const storageKey = STORE_STORAGE_KEYS[norm];
        if (storageKey) {
          window.localStorage.setItem(storageKey, JSON.stringify(serverValue));
        }
      }
      notifyListeners(norm);
    }
  } catch {
    // Fail soft, offline fallback keeps local copy
  } finally {
    inFlightSyncs.delete(norm);
  }
}

// ---------------------------------------------------------------------------
// Adopt-on-login: Scope C
// ---------------------------------------------------------------------------

export interface ConflictEntry {
  key: PersonalStoreKey;
  localData: unknown;
  serverData: unknown;
}

export interface AdoptConflict {
  key: PersonalStoreKey;
  keys?: PersonalStoreKey[];
  items?: string[];
  localData: unknown;
  serverData: unknown;
  conflicts?: ConflictEntry[];
  resolve: (choice: "adopt_local" | "keep_account") => Promise<void>;
}

type AdoptConflictListener = (conflict: AdoptConflict) => void;
const conflictListeners = new Set<AdoptConflictListener>();

export function onAdoptConflict(listener: AdoptConflictListener): () => void {
  conflictListeners.add(listener);
  return () => {
    conflictListeners.delete(listener);
  };
}

export function hasData(key: PersonalStoreKey | string, doc: unknown): boolean {
  if (!doc) return false;
  const norm = normalizeStoreKey(key);
  if (!norm) return false;

  if (norm === "portfolio") {
    if (typeof doc === "object" && "portfolios" in doc && Array.isArray((doc as { portfolios: unknown }).portfolios)) {
      return (doc as { portfolios: unknown[] }).portfolios.length > 0;
    }
    if (Array.isArray(doc)) return doc.length > 0;
  }

  if (norm === "watchlist") {
    if (typeof doc === "object" && "tickers" in doc && Array.isArray((doc as { tickers: unknown }).tickers)) {
      return (doc as { tickers: unknown[] }).tickers.length > 0;
    }
    if (Array.isArray(doc)) return doc.length > 0;
  }

  if (norm === "macro-presets") {
    if (Array.isArray(doc)) return doc.length > 0;
    if (typeof doc === "object" && "presets" in doc && Array.isArray((doc as { presets: unknown }).presets)) {
      return (doc as { presets: unknown[] }).presets.length > 0;
    }
  }

  if (norm === "ib" || norm.startsWith("ib:")) {
    if (typeof doc === "object") {
      const d = doc as Record<string, unknown>;
      if (d.profiles && typeof d.profiles === "object" && Object.keys(d.profiles).length > 0) {
        return true;
      }
      if (d.profile && typeof d.profile === "object") {
        return true;
      }
      if (d.daily && typeof d.daily === "object" && Object.keys(d.daily).length > 0) {
        return true;
      }
    }
  }

  return false;
}

export function isDifferent(key: PersonalStoreKey | string, localDoc: unknown, serverDoc: unknown): boolean {
  if (!localDoc && !serverDoc) return false;
  if (!localDoc || !serverDoc) return true;
  const norm = normalizeStoreKey(key);

  if (norm === "watchlist") {
    const getTickers = (d: unknown): string[] => {
      if (Array.isArray(d)) return d.map(String).map((s) => s.toUpperCase()).sort();
      if (d && typeof d === "object" && "tickers" in d && Array.isArray((d as { tickers: unknown }).tickers)) {
        return (d as { tickers: unknown[] }).tickers.map(String).map((s) => s.toUpperCase()).sort();
      }
      return [];
    };
    const tLocal = getTickers(localDoc);
    const tServer = getTickers(serverDoc);
    return JSON.stringify(tLocal) !== JSON.stringify(tServer);
  }

  if (norm === "portfolio") {
    const getCleanPortfolios = (d: unknown): unknown[] => {
      let list: unknown[] = [];
      if (Array.isArray(d)) list = d;
      else if (d && typeof d === "object" && "portfolios" in d && Array.isArray((d as { portfolios: unknown }).portfolios)) {
        list = (d as { portfolios: unknown[] }).portfolios;
      }
      return list.map((p) => {
        if (!p || typeof p !== "object") return p;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id, ...rest } = p as { id?: string; [k: string]: unknown };
        return rest;
      });
    };
    return JSON.stringify(getCleanPortfolios(localDoc)) !== JSON.stringify(getCleanPortfolios(serverDoc));
  }

  if (norm === "macro-presets") {
    const getCleanPresets = (d: unknown): unknown[] => {
      const list = Array.isArray(d)
        ? d
        : d && typeof d === "object" && "presets" in d && Array.isArray((d as { presets: unknown }).presets)
          ? (d as { presets: unknown[] }).presets
          : [];
      return list.map((p) => {
        if (!p || typeof p !== "object") return p;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id, updatedAt, ...rest } = p as { id?: string; updatedAt?: unknown; [k: string]: unknown };
        return rest;
      });
    };
    return JSON.stringify(getCleanPresets(localDoc)) !== JSON.stringify(getCleanPresets(serverDoc));
  }

  if (norm === "ib" || (norm && norm.startsWith("ib:"))) {
    const cleanIb = (d: unknown): unknown => {
      if (!d || typeof d !== "object") return d;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { updatedAt, ...rest } = d as Record<string, unknown>;
      return rest;
    };
    return JSON.stringify(cleanIb(localDoc)) !== JSON.stringify(cleanIb(serverDoc));
  }

  return JSON.stringify(localDoc) !== JSON.stringify(serverDoc);
}

async function uploadStoreData(token: string, key: PersonalStoreKey, value: unknown): Promise<void> {
  const updatedAt = getDocUpdatedAtMs(value);
  const rawPayload = JSON.stringify({ value, updatedAt });
  const byteLength = new TextEncoder().encode(rawPayload).byteLength;
  if (key === "ib" && byteLength > MAX_STORE_SIZE_BYTES && value && typeof value === "object") {
    const { rootDoc, profileDocs } = splitIbStoreDocument(value as IbStoreDocument);
    await fetch("/api/user/store/ib", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ value: rootDoc, updatedAt }),
    }).catch(() => {});
    for (const [profileId, pDoc] of Object.entries(profileDocs)) {
      await fetch(`/api/user/store/ib:${profileId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ value: pDoc, updatedAt }),
      }).catch(() => {});
    }
    return;
  }
  await fetch(`/api/user/store/${key}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: rawPayload,
  }).catch(() => {});
}

function applyServerDataLocally(key: PersonalStoreKey, serverValue: unknown): void {
  if (key === "ib") {
    unpackIbStoreToLocal(serverValue as IbStoreDocument);
  } else {
    const storageKey = STORE_STORAGE_KEYS[key];
    if (storageKey) {
      window.localStorage.setItem(storageKey, JSON.stringify(serverValue));
    }
  }
  notifyListeners(key);
}

export async function checkAdoptOnLogin(): Promise<void> {
  if (typeof window === "undefined") return;
  const token = loadAuthToken();
  if (!token) return;

  const user = getCachedUser();
  const sub = user?.sub || "user";
  const sessionKey = `fenok.adopted.${sub}`;
  try {
    if (window.sessionStorage.getItem(sessionKey)) return;
  } catch {
    // sessionStorage blocked
  }

  const keysToCheck: PersonalStoreKey[] = ["portfolio", "watchlist", "ib", "macro-presets"];
  const conflicts: ConflictEntry[] = [];

  for (const key of keysToCheck) {
    const local = read(key);
    const localHas = hasData(key, local);

    let serverValue: unknown = null;
    try {
      const res = await fetch(`/api/user/store/${key}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const body = (await res.json()) as { ok: boolean; value: unknown };
        serverValue = body?.value ?? null;
      }
    } catch {
      continue;
    }

    if (key === "ib" && serverValue && typeof serverValue === "object") {
      const root = serverValue as IbStoreDocument;
      const profiles = root.profiles ?? {};
      if (Object.keys(root.daily ?? {}).length === 0 && Object.keys(profiles).length > 0) {
        const profileDocs: Record<string, IbProfileStoreDocument> = {};
        let hasSplit = false;
        for (const profileId of Object.keys(profiles)) {
          try {
            const pRes = await fetch(`/api/user/store/ib:${profileId}`, {
              method: "GET",
              headers: { Authorization: `Bearer ${token}` },
            });
            if (pRes.ok) {
              const pBody = (await pRes.json()) as { ok?: boolean; value?: IbProfileStoreDocument };
              if (pBody?.ok && pBody.value) {
                profileDocs[profileId] = pBody.value;
                hasSplit = true;
              }
            }
          } catch {
            // ignore
          }
        }
        if (hasSplit) {
          serverValue = mergeIbStoreDocuments(root, profileDocs);
        }
      }
    }

    const serverHas = hasData(key, serverValue);

    // Rule 1: local has data, server empty -> upload silently
    if (localHas && !serverHas) {
      await uploadStoreData(token, key, local);
      continue;
    }

    // Rule 2: local empty, server has data -> adopt server data locally silently
    if (!localHas && serverHas) {
      applyServerDataLocally(key, serverValue);
      continue;
    }

    // Rule 3: both present and different -> collect conflict
    if (localHas && serverHas && isDifferent(key, local, serverValue)) {
      conflicts.push({ key, localData: local, serverData: serverValue });
    }
  }

  // If any conflicts exist, trigger single prompt
  if (conflicts.length > 0 && conflictListeners.size > 0) {
    const conflict: AdoptConflict = {
      key: conflicts[0].key,
      keys: conflicts.map((c) => c.key),
      items: conflicts.map((c) => STORE_KEY_LABELS[c.key] || c.key),
      localData: conflicts[0].localData,
      serverData: conflicts[0].serverData,
      conflicts,
      resolve: async (choice) => {
        for (const item of conflicts) {
          if (choice === "adopt_local") {
            await uploadStoreData(token, item.key, item.localData);
          } else {
            applyServerDataLocally(item.key, item.serverData);
          }
        }
      },
    };
    for (const listener of conflictListeners) {
      listener(conflict);
    }
  }

  try {
    window.sessionStorage.setItem(sessionKey, "1");
  } catch {
    // sessionStorage blocked
  }
}

// Auto-trigger adopt check on login change
if (typeof window !== "undefined") {
  onAuthUserChange((user) => {
    if (user) {
      checkAdoptOnLogin().catch(() => {});
    }
  });
}
