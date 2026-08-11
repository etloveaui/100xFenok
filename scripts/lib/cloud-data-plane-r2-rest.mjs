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
// Retry policy: never retry 4xx (a semantic answer, not a transient one);
// network errors and 5xx get at most 3 attempts with exponential backoff.
// Every attempt carries a bounded deadline (default 60s; override with the
// timeoutMs option). A deadline hit is a network-class failure: it is retried
// like any other transport error and finally fails as R2_REST_NETWORK with a
// timeout-specific message.

const API_BASE = "https://api.cloudflare.com/client/v4/accounts";
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 200;
const DEFAULT_FETCH_TIMEOUT_MS = 60_000;

function fail(code, detail) {
  const error = new Error(`${code}:${detail}`);
  error.code = code;
  throw error;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // The deadline wins over any caller-supplied signal; no caller passes one.
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`r2-rest fetch timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readErrorBody(response) {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "<unreadable body>";
  }
}

export function createR2RestBucket({ accountId, bucket, token, fetchImpl = fetch, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS }) {
  if (!accountId || !bucket || !token) {
    fail("R2_REST_CONFIG_INVALID", "accountId, bucket and token are required");
  }
  if (typeof fetchImpl !== "function") {
    fail("R2_REST_CONFIG_INVALID", "fetchImpl must be a function");
  }
  const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_FETCH_TIMEOUT_MS;
  const objectsUrl = `${API_BASE}/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(bucket)}/objects`;
  const authHeaders = { Authorization: `Bearer ${token}` };

  // One HTTP round trip with the shared retry policy. Returns the Response on
  // any status; only network failures and 5xx are retried.
  async function request(url, init) {
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let response;
      try {
        response = await fetchWithTimeout(fetchImpl, url, init, effectiveTimeoutMs);
      } catch (error) {
        lastError = error;
        if (attempt < MAX_ATTEMPTS) await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
        continue;
      }
      if (response.status >= 500 && attempt < MAX_ATTEMPTS) {
        await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
        continue;
      }
      return response;
    }
    fail("R2_REST_NETWORK", lastError?.message ?? "request failed without a response");
  }

  return {
    async get(key) {
      const response = await request(`${objectsUrl}/${encodeURIComponent(key)}`, {
        method: "GET",
        headers: authHeaders,
      });
      if (response.status === 404) return null;
      if (!response.ok) {
        fail("R2_REST_HTTP", `get ${key} http ${response.status}: ${await readErrorBody(response)}`);
      }
      return {
        async arrayBuffer() {
          return response.arrayBuffer();
        },
      };
    },

    async put(key, bytes) {
      const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const response = await request(`${objectsUrl}/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { ...authHeaders, "content-type": "application/octet-stream" },
        body,
      });
      if (!response.ok) {
        fail("R2_REST_HTTP", `put ${key} http ${response.status}: ${await readErrorBody(response)}`);
      }
    },

    async list({ cursor } = {}) {
      const query = `?per_page=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const response = await request(`${objectsUrl}${query}`, {
        method: "GET",
        headers: authHeaders,
      });
      if (!response.ok) {
        fail("R2_REST_HTTP", `list http ${response.status}: ${await readErrorBody(response)}`);
      }
      const body = await response.json();
      if (!body?.success) {
        fail("R2_REST_HTTP", `list envelope not successful: ${JSON.stringify(body?.errors ?? null)}`);
      }
      const nextCursor = body?.result_info?.cursor || undefined;
      return {
        objects: (body.result ?? []).map((object) => ({ key: object.key })),
        truncated: Boolean(nextCursor),
        cursor: nextCursor,
      };
    },
  };
}
