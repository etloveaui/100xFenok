"use client";

/**
 * personalStore — Client sync layer over device-local personalization (Spec §6, Task S4).
 *
 * Keys supported:
 *   - "portfolio" -> localStorage "fenok.portfolio.v1"
 *   - "watchlist" -> localStorage "fenok.watchlist.v1"
 *
 * Behavior:
 *   - Logged out: reads & writes localStorage only (byte-for-byte compatible with existing keys).
 *   - Logged in:
 *       - read: returns cached/local data immediately, fetches server in background;
 *         server updatedAt > local updatedAt -> adopts server data.
 *       - write: writes localStorage immediately, then debounces (500ms) PUT to /api/user/store/{key}.
 *       - subscribe(key, fn): reactive subscriber notified on any local or remote change.
 */

import { loadAuthToken, getCachedUser, onAuthUserChange } from "@/lib/auth/clientAuth";

export type PersonalStoreKey = "portfolio" | "watchlist";

export const STORE_STORAGE_KEYS: Record<PersonalStoreKey, string> = {
  portfolio: "fenok.portfolio.v1",
  watchlist: "fenok.watchlist.v1",
};

export function normalizeStoreKey(key: string): PersonalStoreKey | null {
  if (key === "portfolio" || key === "fenok.portfolio.v1") return "portfolio";
  if (key === "watchlist" || key === "fenok.watchlist.v1") return "watchlist";
  return null;
}

type Listener = () => void;
const keyListeners = new Map<PersonalStoreKey, Set<Listener>>();
const debounceTimers = new Map<PersonalStoreKey, ReturnType<typeof setTimeout>>();
const inFlightSyncs = new Set<PersonalStoreKey>();

export function read<T = unknown>(key: PersonalStoreKey | string): T | null {
  const norm = normalizeStoreKey(key);
  if (!norm) return null;
  const storageKey = STORE_STORAGE_KEYS[norm];
  if (typeof window === "undefined") return null;

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
  const storageKey = STORE_STORAGE_KEYS[norm];
  if (typeof window === "undefined") return;

  const raw = typeof value === "string" ? value : JSON.stringify(value);
  try {
    window.localStorage.setItem(storageKey, raw);
  } catch {
    // Storage full or private mode
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
  const onStorage = (e: StorageEvent) => {
    if (e.key === storageKey) {
      fn();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }

  // Trigger background server sync once per key when logged in
  if (typeof window !== "undefined" && loadAuthToken()) {
    triggerBackgroundSync(norm).catch(() => {});
  }

  return () => {
    set?.delete(fn);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
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
      await fetch(`/api/user/store/${key}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeToken}`,
        },
        body: JSON.stringify({ value, updatedAt }),
      });
    } catch {
      // Fail soft — local copy in localStorage is preserved
    }
  }, 500);

  debounceTimers.set(key, timer);
}

export function getDocUpdatedAtMs(doc: unknown): number {
  if (doc && typeof doc === "object") {
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

async function triggerBackgroundSync(key: PersonalStoreKey): Promise<void> {
  if (inFlightSyncs.has(key)) return;
  const token = loadAuthToken();
  if (!token) return;

  inFlightSyncs.add(key);
  try {
    const res = await fetch(`/api/user/store/${key}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;

    const body = (await res.json()) as { ok: boolean; value: unknown; updatedAt: number };
    if (!body?.ok || body.value === null) return;

    const localDoc = read(key);
    const localUpdatedAt = getDocUpdatedAtMs(localDoc);

    // Last-write-wins by server updatedAt
    if (body.updatedAt > localUpdatedAt) {
      const storageKey = STORE_STORAGE_KEYS[key];
      window.localStorage.setItem(storageKey, JSON.stringify(body.value));
      notifyListeners(key);
    }
  } catch {
    // Fail soft, offline fallback keeps local copy
  } finally {
    inFlightSyncs.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Adopt-on-login: Scope C
// ---------------------------------------------------------------------------

export interface AdoptConflict {
  key: PersonalStoreKey;
  localData: unknown;
  serverData: unknown;
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

export function hasData(key: PersonalStoreKey, doc: unknown): boolean {
  if (!doc) return false;
  if (key === "portfolio") {
    if (typeof doc === "object" && "portfolios" in doc && Array.isArray((doc as { portfolios: unknown }).portfolios)) {
      return (doc as { portfolios: unknown[] }).portfolios.length > 0;
    }
    if (Array.isArray(doc)) return doc.length > 0;
  }
  if (key === "watchlist") {
    if (typeof doc === "object" && "tickers" in doc && Array.isArray((doc as { tickers: unknown }).tickers)) {
      return (doc as { tickers: unknown[] }).tickers.length > 0;
    }
    if (Array.isArray(doc)) return doc.length > 0;
  }
  return false;
}

export function isDifferent(key: PersonalStoreKey, localDoc: unknown, serverDoc: unknown): boolean {
  if (!localDoc && !serverDoc) return false;
  if (!localDoc || !serverDoc) return true;

  if (key === "watchlist") {
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

  if (key === "portfolio") {
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

  return JSON.stringify(localDoc) !== JSON.stringify(serverDoc);
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

  const keysToCheck: PersonalStoreKey[] = ["portfolio", "watchlist"];

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

    const serverHas = hasData(key, serverValue);

    // Rule 1: local has data, server empty -> upload silently
    if (localHas && !serverHas) {
      try {
        await fetch(`/api/user/store/${key}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            value: local,
            updatedAt: getDocUpdatedAtMs(local),
          }),
        });
      } catch {
        // fail-soft
      }
      continue;
    }

    // Rule 2: local empty, server has data -> adopt server data locally silently
    if (!localHas && serverHas) {
      const storageKey = STORE_STORAGE_KEYS[key];
      window.localStorage.setItem(storageKey, JSON.stringify(serverValue));
      notifyListeners(key);
      continue;
    }

    // Rule 3: both present and different -> one in-app prompt
    if (localHas && serverHas && isDifferent(key, local, serverValue)) {
      if (conflictListeners.size > 0) {
        const conflict: AdoptConflict = {
          key,
          localData: local,
          serverData: serverValue,
          resolve: async (choice) => {
            if (choice === "adopt_local") {
              // Upload local to server
              await fetch(`/api/user/store/${key}`, {
                method: "PUT",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                  value: local,
                  updatedAt: Date.now(),
                }),
              }).catch(() => {});
            } else {
              // Keep account: overwrite local with server data
              const storageKey = STORE_STORAGE_KEYS[key];
              window.localStorage.setItem(storageKey, JSON.stringify(serverValue));
              notifyListeners(key);
            }
          },
        };
        for (const listener of conflictListeners) {
          listener(conflict);
        }
        // Priority: portfolio first. Prompt one at a time.
        break;
      }
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
