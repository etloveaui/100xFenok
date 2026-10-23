"use client";

/**
 * Signed out: existing device-local reads and writes.
 * Signed in: the account is authoritative; localStorage is its cache.
 * Preserve the original device bytes once before replacing any signed-in cache.
 */
import { loadAuthToken } from "@/lib/auth/clientAuth";

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
const inFlightSyncs = new Map<string, Promise<void>>();
const localRevisions = new Map<PersonalStoreKey, number>();
const pendingWrites = new Set<string>();
const queuedWriteTokens = new Map<PersonalStoreKey, string>();
export const DEVICE_BACKUP_KEY = "fenok.personal-store.device-backup.v1";

function ibDailyKeys(): string[] {
  const storage = window.localStorage;
  return Array.from({ length: storage.length }, (_, i) => storage.key(i))
    .filter((key): key is string => !!key && key.startsWith("ib_daily_data_"));
}

/** Raw strings include malformed documents; never overwrite the first backup.
 * If storage cannot save it, throw before modifying any of the device copies.
 */
function preserveDeviceCopy(): void {
  const storage = window.localStorage;
  if (storage.getItem(DEVICE_BACKUP_KEY) !== null) return;
  const entries: Record<string, string | null> = {};
  for (const key of [...Object.values(STORE_STORAGE_KEYS), ...ibDailyKeys()]) {
    entries[key] = storage.getItem(key);
  }
  const backup = JSON.stringify({ createdAt: Date.now(), entries });
  storage.setItem(DEVICE_BACKUP_KEY, backup);
  if (storage.getItem(DEVICE_BACKUP_KEY) !== backup) throw new Error("Device backup was not saved");
}

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

export interface PersonalStoreWriteResult {
  ok: boolean;
  reason?: "unavailable" | "storage";
}

export function write<T = unknown>(key: PersonalStoreKey | string, value: T): PersonalStoreWriteResult {
  const norm = normalizeStoreKey(key);
  if (!norm) return { ok: false, reason: "unavailable" };
  if (typeof window === "undefined") return { ok: false, reason: "unavailable" };

  if (loadAuthToken()) {
    try { preserveDeviceCopy(); } catch { return { ok: false, reason: "storage" }; }
  }
  localRevisions.set(norm, (localRevisions.get(norm) ?? 0) + 1);
  let localOk = true;
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
        // Storage full or private mode: the device copy did not land, so the
        // caller must not be told the save succeeded.
        localOk = false;
      }
    }
  }

  if (!localOk) {
    // A logged-in account may still persist it through the queued server write,
    // but that is a different promise from "saved on this device".
    queueServerWrite(norm, typeof value === "string" ? JSON.parse(value) : value);
    return { ok: false, reason: "storage" };
  }

  notifyListeners(norm);
  queueServerWrite(norm, typeof value === "string" ? JSON.parse(value) : value);
  return { ok: true };
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
    queuedWriteTokens.delete(key);
    pendingWrites.add(`${token}:${key}`);
    try {
      const activeToken = loadAuthToken();
      if (activeToken !== token) return;

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
    } finally {
      pendingWrites.delete(`${token}:${key}`);
    }
  }, 500);

  debounceTimers.set(key, timer);
  queuedWriteTokens.set(key, token);
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
  if (!norm || typeof window === "undefined") return;
  const token = loadAuthToken();
  if (!token || queuedWriteTokens.get(norm) === token || pendingWrites.has(`${token}:${norm}`)) return;
  const syncKey = `${token}:${norm}`;
  const current = inFlightSyncs.get(syncKey);
  if (current) return current;
  const revision = localRevisions.get(norm) ?? 0;
  const sync = syncServerCache(norm, token, revision).finally(() => inFlightSyncs.delete(syncKey));
  inFlightSyncs.set(syncKey, sync);
  return sync;
}

async function syncServerCache(norm: PersonalStoreKey, token: string, revision: number): Promise<void> {
  try {
    const res = await fetch(`/api/user/store/${norm}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;

    const body = (await res.json()) as { ok: boolean; value: unknown; updatedAt: number };
    if (!body?.ok || !("value" in body)) return;

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
            if (!pRes.ok) return;
            if (pRes.ok) {
              const pBody = (await pRes.json()) as { ok?: boolean; value?: IbProfileStoreDocument };
              if (!pBody?.ok) return;
              if (pBody.value) {
                profileDocs[profileId] = pBody.value;
                hasSplit = true;
              }
            }
          } catch {
            return; // Do not replace the cache with an incomplete account read.
          }
        }
        if (hasSplit) {
          serverValue = mergeIbStoreDocuments(root, profileDocs);
        }
      }
    }

    // Ignore responses for a previous account or reads predating an explicit edit.
    if (loadAuthToken() !== token || (localRevisions.get(norm) ?? 0) !== revision) return;
    preserveDeviceCopy();
    if (norm === "ib") {
      // Replace the entire IB cache, including daily rows absent from the account.
      const oldDailyKeys = ibDailyKeys();
      const doc = serverValue as IbStoreDocument | null;
      if (doc) {
        unpackIbStoreToLocal(doc);
        for (const key of oldDailyKeys) {
          if (!(key.slice("ib_daily_data_".length) in (doc.daily ?? {}))) window.localStorage.removeItem(key);
        }
      } else {
        window.localStorage.removeItem("ib_profiles");
        oldDailyKeys.forEach(key => window.localStorage.removeItem(key));
      }
    } else {
      const storageKey = STORE_STORAGE_KEYS[norm];
      if (storageKey) {
        if (serverValue === null) window.localStorage.removeItem(storageKey);
        else window.localStorage.setItem(storageKey, JSON.stringify(serverValue));
      }
    }
    notifyListeners(norm);
  } catch {
    // Offline, failed account reads or failed backup writes leave the cache intact.
  }
}

export async function syncAccountStores(): Promise<void> {
  await Promise.all(["portfolio", "watchlist", "ib", "macro-presets"].map(triggerBackgroundSync));
}
