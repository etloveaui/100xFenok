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

function stableClientKeyHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

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
  if (cfConnectingIp) return `ip:${cfConnectingIp}`;

  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwardedFor) return `ip:${forwardedFor}`;

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return `ip:${realIp}`;

  const fallbackMaterial = [
    request.headers.get("host")?.trim() || "no-host",
    request.headers.get("user-agent")?.trim() || "no-user-agent",
    request.headers.get("accept-language")?.trim() || "no-language",
  ].join("|");
  return `fallback:${stableClientKeyHash(fallbackMaterial)}`;
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

  const activeAttempt = current && current.resetAt > now ? current : undefined;
  const failedCount = activeAttempt ? activeAttempt.failedCount + 1 : 1;
  const lockedUntil = failedCount >= ADMIN_LOGIN_MAX_FAILURES ? now + ADMIN_LOGIN_LOCK_MS : 0;
  const resetAt =
    lockedUntil > 0 ? lockedUntil : activeAttempt ? activeAttempt.resetAt : now + ADMIN_LOGIN_LOCK_MS;

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
