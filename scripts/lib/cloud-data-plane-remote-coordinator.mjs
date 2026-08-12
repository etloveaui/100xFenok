// Remote bridge for the CloudDataPlaneCoordinator Durable Object. Presents
// the Durable Object namespace shape (idFromName/get -> stub.fetch) that
// cloud-data-plane-cloudflare-adapter.mjs already consumes, backed by plain
// HTTPS POSTs to the deployed worker route instead of a Workers binding.
//
// Wire contract (the worker end implements exactly this):
// - The adapter builds stub URLs like https://cloud-data-plane-coordinator/<action>;
//   only the pathname is significant (/ledger/prepare, /ledger/mark-promoted,
//   /ledger/get, /pointer/get, /pointer/compare-and-swap, /inspect).
// - Every call is POST ${endpoint}${pathname} with headers
//   content-type: application/json and x-data-plane-key: <key>; the JSON body
//   is passed through byte-for-byte.
// - The Response is returned unchanged: the adapter reads .ok and .json(), and
//   contract errors arrive as HTTP 409 with { error: { code, detail } }.
//
// Retry policy: never retry a 409 (or any 4xx) — those are semantic contract
// errors such as STALE_WRITER, and retrying them would corrupt the receipt
// protocol. Network errors and 5xx get at most 3 attempts with exponential
// backoff. Every attempt carries a bounded deadline (default 60s; override
// with the timeoutMs option). A timed-out POST is ambiguous — the server may
// have committed — so it is deliberately treated exactly like a network error
// (retried up to the same bound) instead of being replayed blindly or dropped:
// the worker side makes that replay safe through the CAS/ledger contract, and
// any resulting conflict arrives as a 409 that is never retried.

// Family routing: when `family` is given, every POST carries it as the
// x-data-plane-family header and the worker route selects that Durable Object
// instance (its own pointer/ledger/sequence). When `family` is absent the
// request is byte-identical to the legacy shape — no header, the route's
// default instance — so existing callers change nothing.

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
      throw new Error(`remote-coordinator POST timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function createRemoteCoordinatorNamespace({ endpoint, key, fetchImpl = fetch, family = null, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS }) {
  if (!endpoint || !key) {
    fail("REMOTE_COORDINATOR_CONFIG_INVALID", "endpoint and key are required");
  }
  if (typeof fetchImpl !== "function") {
    fail("REMOTE_COORDINATOR_CONFIG_INVALID", "fetchImpl must be a function");
  }
  const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_FETCH_TIMEOUT_MS;
  const base = String(endpoint).replace(/\/+$/, "");
  const familyHeaders = family ? { "x-data-plane-family": String(family) } : {};

  async function post(actionUrl, body) {
    const { pathname } = new URL(actionUrl);
    const target = `${base}${pathname}`;
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let response;
      try {
        response = await fetchWithTimeout(fetchImpl, target, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-data-plane-key": key,
            ...familyHeaders,
          },
          body,
        }, effectiveTimeoutMs);
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
    fail("REMOTE_COORDINATOR_NETWORK", lastError?.message ?? `no response from ${target}`);
  }

  return {
    idFromName(name) {
      return String(name);
    },
    get(id) {
      if (!id) fail("REMOTE_COORDINATOR_CONFIG_INVALID", "stub id is required");
      return {
        async fetch(url, init = {}) {
          return post(url, init.body ?? "{}");
        },
      };
    },
  };
}
