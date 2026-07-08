const ADMIN_LOGIN_MAX_FAILURES = 5;
const ADMIN_LOGIN_LOCK_MS = 1000 * 60 * 5;
const ADMIN_LOGIN_MAX_TRACKED_CLIENTS = 500;

type AdminLoginAttempt = {
  failedCount: number;
  lockedUntil: number;
  resetAt: number;
};

export type AdminLoginThrottleResult = {
  limited: boolean;
  retryAfterMs: number;
};

const loginAttempts = new Map<string, AdminLoginAttempt>();

function pruneExpiredLoginAttempts(now: number): void {
  for (const [clientKey, attempt] of loginAttempts) {
    if (attempt.resetAt <= now && attempt.lockedUntil <= now) {
      loginAttempts.delete(clientKey);
    }
  }
}

function rememberLoginAttempt(
  clientKey: string,
  attempt: AdminLoginAttempt,
  now: number,
): void {
  pruneExpiredLoginAttempts(now);
  if (!loginAttempts.has(clientKey) && loginAttempts.size >= ADMIN_LOGIN_MAX_TRACKED_CLIENTS) {
    const oldestClientKey = loginAttempts.keys().next().value as string | undefined;
    if (oldestClientKey) loginAttempts.delete(oldestClientKey);
  }
  loginAttempts.set(clientKey, attempt);
}

function throttleResult(attempt: AdminLoginAttempt | undefined, now: number): AdminLoginThrottleResult {
  if (!attempt || attempt.lockedUntil <= now) {
    return { limited: false, retryAfterMs: 0 };
  }
  return {
    limited: true,
    retryAfterMs: attempt.lockedUntil - now,
  };
}

export function getAdminLoginClientKey(request: Request): string {
  const cfConnectingIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfConnectingIp) return cfConnectingIp;

  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwardedFor) return forwardedFor;

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  return "unknown";
}

export function checkAdminLoginThrottle(
  clientKey: string,
  now = Date.now(),
): AdminLoginThrottleResult {
  pruneExpiredLoginAttempts(now);
  return throttleResult(loginAttempts.get(clientKey), now);
}

export function registerAdminLoginFailure(
  clientKey: string,
  now = Date.now(),
): AdminLoginThrottleResult {
  const current = loginAttempts.get(clientKey);
  if (current?.lockedUntil && current.lockedUntil > now) {
    return throttleResult(current, now);
  }

  const withinWindow = Boolean(current && current.resetAt > now);
  const failedCount = withinWindow ? current.failedCount + 1 : 1;
  const lockedUntil = failedCount >= ADMIN_LOGIN_MAX_FAILURES ? now + ADMIN_LOGIN_LOCK_MS : 0;
  const resetAt = lockedUntil || (withinWindow ? current.resetAt : now + ADMIN_LOGIN_LOCK_MS);

  const nextAttempt = {
    failedCount,
    lockedUntil,
    resetAt,
  };
  rememberLoginAttempt(clientKey, nextAttempt, now);
  return throttleResult(nextAttempt, now);
}

export function clearAdminLoginFailures(clientKey: string): void {
  loginAttempts.delete(clientKey);
}

export function adminLoginRetryAfterSeconds(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / 1000));
}
