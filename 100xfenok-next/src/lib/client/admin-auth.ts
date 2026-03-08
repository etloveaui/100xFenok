export const ADMIN_AUTH_STORAGE_KEY = "adminAuth";
export const ADMIN_AUTH_CHANGE_EVENT = "fenok:admin-auth-change";
export const ADMIN_VERIFY_STATE_EVENT = "fenok:admin-verify-state";
export const ADMIN_VERIFY_FAIL_COUNT_KEY = "adminVerifyFailCount";
export const ADMIN_VERIFY_LOCK_UNTIL_KEY = "adminVerifyLockUntil";
export const ADMIN_MAX_FAILURES = 3;
export const ADMIN_VERIFY_LOCK_MS = 3000;

export type AdminVerifyResult = "matched" | "mismatch" | "unsupported";
export type AdminVerifyFailureState = {
  locked: boolean;
  remainingMs: number;
  failCount: number;
};

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage;
}

function dispatchAdminEvent(name: string, detail: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function setCachedAdminAuthenticated(authenticated: boolean): void {
  const storage = getSessionStorage();
  if (!storage) return;

  if (authenticated) {
    storage.setItem(ADMIN_AUTH_STORAGE_KEY, "true");
  } else {
    storage.removeItem(ADMIN_AUTH_STORAGE_KEY);
  }

  dispatchAdminEvent(ADMIN_AUTH_CHANGE_EVENT, { authenticated });
}

export function isAdminAuthenticated(): boolean {
  const storage = getSessionStorage();
  if (!storage) return false;
  return storage.getItem(ADMIN_AUTH_STORAGE_KEY) === "true";
}

export function getAdminVerifyFailCount(): number {
  const storage = getSessionStorage();
  if (!storage) return 0;
  const raw = Number(storage.getItem(ADMIN_VERIFY_FAIL_COUNT_KEY) || "0");
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

export function getAdminVerifyLockRemainingMs(now = Date.now()): number {
  const storage = getSessionStorage();
  if (!storage) return 0;

  const rawUntil = Number(storage.getItem(ADMIN_VERIFY_LOCK_UNTIL_KEY) || "0");
  if (!Number.isFinite(rawUntil) || rawUntil <= now) {
    storage.removeItem(ADMIN_VERIFY_LOCK_UNTIL_KEY);
    return 0;
  }

  return rawUntil - now;
}

export function clearAdminVerifyState(): void {
  const storage = getSessionStorage();
  if (!storage) return;
  storage.removeItem(ADMIN_VERIFY_FAIL_COUNT_KEY);
  storage.removeItem(ADMIN_VERIFY_LOCK_UNTIL_KEY);
  dispatchAdminEvent(ADMIN_VERIFY_STATE_EVENT, {
    failCount: 0,
    locked: false,
    remainingMs: 0,
  });
}

export function registerAdminVerifyFailure(now = Date.now()): AdminVerifyFailureState {
  const storage = getSessionStorage();
  if (!storage) {
    return { locked: false, remainingMs: 0, failCount: 0 };
  }

  const activeLockRemainingMs = getAdminVerifyLockRemainingMs(now);
  if (activeLockRemainingMs > 0) {
    const lockedState = {
      locked: true,
      remainingMs: activeLockRemainingMs,
      failCount: 0,
    };
    dispatchAdminEvent(ADMIN_VERIFY_STATE_EVENT, lockedState);
    return lockedState;
  }

  const nextFailCount = getAdminVerifyFailCount() + 1;
  if (nextFailCount >= ADMIN_MAX_FAILURES) {
    storage.removeItem(ADMIN_VERIFY_FAIL_COUNT_KEY);
    storage.setItem(ADMIN_VERIFY_LOCK_UNTIL_KEY, String(now + ADMIN_VERIFY_LOCK_MS));
    const lockedState = {
      locked: true,
      remainingMs: ADMIN_VERIFY_LOCK_MS,
      failCount: 0,
    };
    dispatchAdminEvent(ADMIN_VERIFY_STATE_EVENT, lockedState);
    return lockedState;
  }

  storage.setItem(ADMIN_VERIFY_FAIL_COUNT_KEY, String(nextFailCount));
  const nextState = {
    locked: false,
    remainingMs: 0,
    failCount: nextFailCount,
  };
  dispatchAdminEvent(ADMIN_VERIFY_STATE_EVENT, nextState);
  return nextState;
}

export function setAdminAuthenticated(): void {
  const storage = getSessionStorage();
  if (!storage) return;
  clearAdminVerifyState();
  setCachedAdminAuthenticated(true);
}

export function clearAdminAuthenticated(): void {
  const storage = getSessionStorage();
  if (!storage) return;
  setCachedAdminAuthenticated(false);
}

export async function refreshAdminAuthenticated(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  try {
    const response = await fetch("/api/admin/session", {
      method: "GET",
      cache: "no-store",
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
      await fetch("/api/admin/session", {
        method: "DELETE",
        cache: "no-store",
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
    const response = await fetch("/api/admin/session", {
      method: "POST",
      cache: "no-store",
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
