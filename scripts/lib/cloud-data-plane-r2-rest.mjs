// Cloudflare REST bridge for R2 object bodies. Implements the Workers R2
// binding shape (get/put/list) that cloud-data-plane-cloudflare-adapter.mjs
// already consumes, backed by the account-level REST API instead of the
// wrangler CLI, so every remote-presence claim rests on HTTP status codes.
//
// Measured 2026-08-03 against account aeeb5ea3affe55a2219d08ea02dad9e1,
// bucket fenok-data-plane:
// - PUT  /client/v4/accounts/{acct}/r2/buckets/{bucket}/objects/{key} -> 200,
//   JSON envelope { success: true, result: { key, size, etag, ... } }. The key
//   works both raw and fully URL-encoded (slashes as %2F); encoded is used.
// - GET  same path -> 200 with the raw object bytes as the body (NOT the JSON
//   envelope); 404 with { success: false, errors: [{ code: 10007 }] } for a
//   missing key.
// - GET  .../objects (no key) keeps the listing envelope { result: [...],
//   result_info: { cursor } } already proven by check-r2-free-tier-usage.mjs.
//
// Retry policy: HTTP 429 gets a separate bounded Retry-After/backoff window;
// every other 4xx is a semantic no-retry. Network errors and 5xx get at most
// 3 attempts with exponential backoff.
// Every attempt carries a bounded deadline (default 60s; override with the
// timeoutMs option) that covers the response BODY as well as the request:
// fetch resolves as soon as headers arrive and hands back a lazy body reader,
// so a socket that dies mid-body would otherwise escape both the deadline and
// the retry budget. A deadline hit is a network-class failure: it is retried
// like any other transport error and finally fails as R2_REST_NETWORK with a
// timeout-specific message.

const API_BASE = "https://api.cloudflare.com/client/v4/accounts";
const MAX_ATTEMPTS = 3;
const MAX_RATE_LIMIT_ATTEMPTS = 8;
const BACKOFF_BASE_MS = 200;
const MAX_RATE_LIMIT_BACKOFF_MS = 10_000;
const DEFAULT_FETCH_TIMEOUT_MS = 60_000;

function fail(code, detail) {
  const error = new Error(`${code}:${detail}`);
  error.code = code;
  throw error;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stableJitterMs(value) {
  let hash = 0;
  for (const char of String(value)) hash = ((hash * 33) + char.charCodeAt(0)) >>> 0;
  return hash % 251;
}

function retryAfterMs(response) {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const instant = Date.parse(raw);
  return Number.isFinite(instant) ? Math.max(0, instant - Date.now()) : null;
}

function rateLimitDelayMs(response, attempt, url) {
  const exponential = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), MAX_RATE_LIMIT_BACKOFF_MS);
  const requested = retryAfterMs(response) ?? 0;
  return Math.min(
    Math.max(requested, exponential) + stableJitterMs(url),
    MAX_RATE_LIMIT_BACKOFF_MS,
  );
}

// One attempt is the request AND its full body, both under the same deadline.
// The body is drained here instead of being handed back as a lazy reader so a
// mid-body transport reset is raised inside the attempt and retried like any
// other network error, and so the timer cannot be cleared while bytes are
// still in flight. Every consumer of get() reads the whole object immediately,
// so this changes no caller's memory profile.
async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // The deadline wins over any caller-supplied signal; no caller passes one.
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    return { response, body: await response.arrayBuffer() };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`r2-rest fetch timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function errorBodyText(body) {
  try {
    return new TextDecoder().decode(body).slice(0, 500);
  } catch {
    return "<unreadable body>";
  }
}

export function createR2RestBucket({
  accountId,
  bucket,
  token,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  sleepImpl = sleep,
}) {
  if (!accountId || !bucket || !token) {
    fail("R2_REST_CONFIG_INVALID", "accountId, bucket and token are required");
  }
  if (typeof fetchImpl !== "function") {
    fail("R2_REST_CONFIG_INVALID", "fetchImpl must be a function");
  }
  if (typeof sleepImpl !== "function") {
    fail("R2_REST_CONFIG_INVALID", "sleepImpl must be a function");
  }
  const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_FETCH_TIMEOUT_MS;
  const objectsUrl = `${API_BASE}/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(bucket)}/objects`;
  const authHeaders = { Authorization: `Bearer ${token}` };

  // One HTTP round trip with the shared retry policy. Returns the Response and
  // its already-drained body on any status; network failures, mid-body resets
  // and 5xx use the existing three-attempt bound.
  // HTTP 429 alone gets a longer bounded retry window that honors Retry-After
  // and adds stable per-object jitter, so bounded parallel workers do not
  // immediately collide again. Every other 4xx remains a semantic no-retry.
  async function request(url, init) {
    let lastError = null;
    let transientAttempts = 0;
    let rateLimitAttempts = 0;
    while (true) {
      let attempt;
      try {
        attempt = await fetchWithTimeout(fetchImpl, url, init, effectiveTimeoutMs);
      } catch (error) {
        lastError = error;
        transientAttempts += 1;
        if (transientAttempts >= MAX_ATTEMPTS) break;
        await sleepImpl(BACKOFF_BASE_MS * 2 ** (transientAttempts - 1));
        continue;
      }
      const { response } = attempt;
      if (response.status === 429) {
        rateLimitAttempts += 1;
        if (rateLimitAttempts >= MAX_RATE_LIMIT_ATTEMPTS) return attempt;
        await sleepImpl(rateLimitDelayMs(response, rateLimitAttempts, url));
        continue;
      }
      if (response.status >= 500) {
        transientAttempts += 1;
        if (transientAttempts < MAX_ATTEMPTS) {
          await sleepImpl(BACKOFF_BASE_MS * 2 ** (transientAttempts - 1));
          continue;
        }
      }
      return attempt;
    }
    fail("R2_REST_NETWORK", lastError?.message ?? "request failed without a response");
  }

  return {
    async get(key) {
      const { response, body } = await request(`${objectsUrl}/${encodeURIComponent(key)}`, {
        method: "GET",
        headers: authHeaders,
      });
      if (response.status === 404) return null;
      if (!response.ok) {
        fail("R2_REST_HTTP", `get ${key} http ${response.status}: ${errorBodyText(body)}`);
      }
      return {
        async arrayBuffer() {
          return body;
        },
      };
    },

    async put(key, bytes) {
      const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const { response, body: responseBody } = await request(`${objectsUrl}/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { ...authHeaders, "content-type": "application/octet-stream" },
        body,
      });
      if (!response.ok) {
        fail("R2_REST_HTTP", `put ${key} http ${response.status}: ${errorBodyText(responseBody)}`);
      }
    },

    async list({ cursor } = {}) {
      const query = `?per_page=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const { response, body: responseBody } = await request(`${objectsUrl}${query}`, {
        method: "GET",
        headers: authHeaders,
      });
      if (!response.ok) {
        fail("R2_REST_HTTP", `list http ${response.status}: ${errorBodyText(responseBody)}`);
      }
      const body = JSON.parse(new TextDecoder().decode(responseBody));
      if (!body?.success) {
        fail("R2_REST_HTTP", `list envelope not successful: ${JSON.stringify(body?.errors ?? null)}`);
      }
      const nextCursor = body?.result_info?.cursor || undefined;
      return {
        objects: (body.result ?? []).map((object) => ({ key: object.key, size: object.size ?? null })),
        truncated: Boolean(nextCursor),
        cursor: nextCursor,
      };
    },
  };
}
