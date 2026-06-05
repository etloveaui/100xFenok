export const ADMIN_AUTH_STORAGE_KEY = "adminAuth";
export const ADMIN_AUTH_CHANGE_EVENT = "fenok:admin-auth-change";
export const ADMIN_VERIFY_STATE_EVENT = "fenok:admin-verify-state";
export const ADMIN_VERIFY_FAIL_COUNT_KEY = "adminVerifyFailCount";
export const ADMIN_VERIFY_LOCK_UNTIL_KEY = "adminVerifyLockUntil";
export const ADMIN_MAX_FAILURES = 1;
export const ADMIN_VERIFY_LOCK_MS = 0;

export type AdminVerifyResult = "matched" | "mismatch" | "unsupported";
export type AdminVerifyFailureState = {
  locked: boolean;
  remainingMs: number;
  failCount: number;
};

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function dispatchAdminEvent(name: string, detail: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  } catch {
    // Some privacy-restricted browser contexts can block storage/events.
  }
}

function setCachedAdminAuthenticated(authenticated: boolean): void {
  const storage = getSessionStorage();
  if (!storage) {
    dispatchAdminEvent(ADMIN_AUTH_CHANGE_EVENT, { authenticated });
    return;
  }

  try {
    if (authenticated) {
      storage.setItem(ADMIN_AUTH_STORAGE_KEY, "true");
    } else {
      storage.removeItem(ADMIN_AUTH_STORAGE_KEY);
    }
  } catch {
    // The HttpOnly cookie remains the source of truth.
  }

  dispatchAdminEvent(ADMIN_AUTH_CHANGE_EVENT, { authenticated });
}

export function isAdminAuthenticated(): boolean {
  const storage = getSessionStorage();
  if (!storage) return false;
  try {
    return storage.getItem(ADMIN_AUTH_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function getAdminVerifyFailCount(): number {
  const storage = getSessionStorage();
  if (!storage) return 0;
  let raw = 0;
  try {
    raw = Number(storage.getItem(ADMIN_VERIFY_FAIL_COUNT_KEY) || "0");
  } catch {
    return 0;
  }
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

export function getAdminVerifyLockRemainingMs(now = Date.now()): number {
  const storage = getSessionStorage();
  if (!storage) return 0;

  try {
    storage.removeItem(ADMIN_VERIFY_LOCK_UNTIL_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
  void now;
  return 0;
}

export function clearAdminVerifyState(): void {
  const storage = getSessionStorage();
  if (storage) {
    try {
      storage.removeItem(ADMIN_VERIFY_FAIL_COUNT_KEY);
      storage.removeItem(ADMIN_VERIFY_LOCK_UNTIL_KEY);
    } catch {
      // Ignore storage cleanup failures.
    }
  }
  dispatchAdminEvent(ADMIN_VERIFY_STATE_EVENT, {
    failCount: 0,
    locked: false,
    remainingMs: 0,
  });
}

export function registerAdminVerifyFailure(now = Date.now()): AdminVerifyFailureState {
  const storage = getSessionStorage();
  if (storage) {
    try {
      storage.removeItem(ADMIN_VERIFY_FAIL_COUNT_KEY);
      storage.removeItem(ADMIN_VERIFY_LOCK_UNTIL_KEY);
    } catch {
      // Ignore storage cleanup failures.
    }
  }
  void now;
  const nextState = {
    locked: false,
    remainingMs: 0,
    failCount: 1,
  };
  dispatchAdminEvent(ADMIN_VERIFY_STATE_EVENT, nextState);
  return nextState;
}

export function setAdminAuthenticated(): void {
  clearAdminVerifyState();
  setCachedAdminAuthenticated(true);
}

export function clearAdminAuthenticated(): void {
  setCachedAdminAuthenticated(false);
}

export async function refreshAdminAuthenticated(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  try {
    const response = await fetch("/api/admin/session/", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = (await response.json()) as { authenticated?: boolean };
    const authenticated = payload.authenticated === true;
    setCachedAdminAuthenticated(authenticated);
    return authenticated;
  } catch {
    return isAdminAuthenticated();
  }
}

export async function logoutAdminSession(): Promise<void> {
  if (typeof window !== "undefined") {
    try {
      await fetch("/api/admin/session/", {
        method: "DELETE",
        cache: "no-store",
        credentials: "same-origin",
      });
    } catch {
      // 네트워크 오류여도 클라이언트 상태는 즉시 정리
    }
  }

  clearAdminAuthenticated();
  clearAdminVerifyState();
}

export async function verifyAdminPassword(input: string): Promise<AdminVerifyResult> {
  const normalized = input.trim();
  if (!normalized) return "mismatch";

  try {
    const response = await fetch("/api/admin/session/", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ password: normalized }),
    });

    if (response.ok) {
      setAdminAuthenticated();
      return "matched";
    }

    if (response.status === 401 || response.status === 400) {
      return "mismatch";
    }

    return "unsupported";
  } catch {
    return "unsupported";
  }
}
