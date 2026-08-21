// One rate-limit policy for every Cloudflare caller.
//
// This was duplicated by omission rather than by design: cloud-data-plane-r2-rest
// implemented it correctly for the WRITE path, and check-r2-free-tier-usage - the
// gate that runs immediately BEFORE that write, against the same host, account
// and token - had no retry at all. Measured 2026-08-21, every one of the six
// cost-gate blocks in the repository's recorded history was an HTTP 429 during
// the gate's inventory walk, and none was a budget breach. The correct policy
// was ten lines away the whole time.
//
// Honour Retry-After when the server sends one, fall back to exponential
// backoff, add per-URL stable jitter so concurrent callers desynchronise rather
// than retrying in lockstep, and bound the whole thing so a hostile or absurd
// Retry-After cannot park a runner.

export const MAX_ATTEMPTS = 3;
export const MAX_RATE_LIMIT_ATTEMPTS = 8;
export const BACKOFF_BASE_MS = 200;
export const MAX_RATE_LIMIT_BACKOFF_MS = 10_000;

// Deterministic per-URL offset. Two callers on different paths spread out; the
// same caller does not wander between attempts, which keeps retries reproducible.
export function stableJitterMs(value) {
  let hash = 0;
  for (const char of String(value)) hash = ((hash * 33) + char.charCodeAt(0)) >>> 0;
  return hash % 251;
}

// Retry-After is either delta-seconds or an HTTP-date. Anything else is not a
// delay and must not be treated as one.
export function retryAfterMs(response) {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const instant = Date.parse(raw);
  return Number.isFinite(instant) ? Math.max(0, instant - Date.now()) : null;
}

export function rateLimitDelayMs(response, attempt, url) {
  const exponential = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), MAX_RATE_LIMIT_BACKOFF_MS);
  const requested = retryAfterMs(response) ?? 0;
  return Math.min(
    Math.max(requested, exponential) + stableJitterMs(url),
    MAX_RATE_LIMIT_BACKOFF_MS,
  );
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
