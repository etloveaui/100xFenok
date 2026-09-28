import { after, test } from "node:test";
import assert from "node:assert/strict";
import { DataFetchError, fetchJsonOrNull, fetchJsonShared, invalidateData } from "./data-fetch";

// Route the module through its client/shared code path (it treats a missing
// `window` as a server render with no module state -- these tests exercise
// the sharing, cache and abort/timeout behavior, so they need `window` set).
const originalWindow = (globalThis as Record<string, unknown>).window;
const originalFetch = globalThis.fetch;
(globalThis as Record<string, unknown>).window = globalThis;

after(() => {
  (globalThis as Record<string, unknown>).window = originalWindow;
  globalThis.fetch = originalFetch;
});

let urlSeq = 0;
function uniqueUrl(label: string): string {
  urlSeq += 1;
  return `https://example.test/${label}-${urlSeq}`;
}

type ResponseSpec = {
  ok: boolean;
  status: number;
  json?: () => unknown;
  headers?: Headers;
  delayMs?: number;
  onCancel?: () => void;
};

function abortError(): Error {
  const err = new Error("aborted");
  err.name = "AbortError";
  return err;
}

function makeMockFetch(responder: (url: string, callIndex: number) => ResponseSpec | Promise<ResponseSpec>) {
  const state = { calls: 0 };
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const callIndex = state.calls;
    state.calls += 1;
    const spec = await responder(String(input), callIndex);
    const signal = init?.signal;
    if (spec.delayMs) {
      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(abortError());
        const timer = setTimeout(resolve, spec.delayMs);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(abortError());
        });
      });
    }
    if (signal?.aborted) throw abortError();
    return {
      ok: spec.ok,
      status: spec.status,
      headers: spec.headers ?? new Headers(),
      json: async () => (spec.json ? spec.json() : {}),
      body: { cancel: spec.onCancel ?? (() => {}) },
    } as unknown as Response;
  };
  return Object.assign(fn, { callCount: () => state.calls });
}

function useFetch(mock: ReturnType<typeof makeMockFetch>): void {
  globalThis.fetch = mock as unknown as typeof fetch;
}

test("concurrent callers for the same URL share one in-flight request", async () => {
  const fetchMock = makeMockFetch(() => ({ ok: true, status: 200, json: () => ({ hello: "world" }) }));
  useFetch(fetchMock);
  const url = uniqueUrl("share");
  const [a, b] = await Promise.all([fetchJsonShared<{ hello: string }>(url), fetchJsonShared<{ hello: string }>(url)]);
  assert.equal(fetchMock.callCount(), 1);
  assert.deepEqual(a.data, { hello: "world" });
  assert.deepEqual(b.data, { hello: "world" });
});

test("a cached response expires after its TTL and is then refetched", async () => {
  const fetchMock = makeMockFetch((_url, callIndex) => ({ ok: true, status: 200, json: () => ({ n: callIndex }) }));
  useFetch(fetchMock);
  const url = uniqueUrl("ttl");
  const first = await fetchJsonShared<{ n: number }>(url, { ttlMs: 30 });
  assert.equal(fetchMock.callCount(), 1);
  const immediate = await fetchJsonShared<{ n: number }>(url, { ttlMs: 30 });
  assert.equal(fetchMock.callCount(), 1);
  assert.equal(immediate.receivedAt, first.receivedAt);
  await new Promise((resolve) => setTimeout(resolve, 45));
  const afterExpiry = await fetchJsonShared<{ n: number }>(url, { ttlMs: 30 });
  assert.equal(fetchMock.callCount(), 2);
  assert.notEqual(afterExpiry.data.n, first.data.n);
});

test("a 503 response classifies as http, cancels its body, and is never cached", async () => {
  let cancelled = false;
  const fetchMock = makeMockFetch(() => ({ ok: false, status: 503, onCancel: () => { cancelled = true; } }));
  useFetch(fetchMock);
  const url = uniqueUrl("http-503");
  await assert.rejects(
    fetchJsonShared(url),
    (err: unknown) => err instanceof DataFetchError && err.kind === "http" && err.status === 503,
  );
  assert.equal(cancelled, true);
  await assert.rejects(fetchJsonShared(url));
  assert.equal(fetchMock.callCount(), 2); // the failure left nothing cached
});

test("a 401 response classifies as auth and is never cached", async () => {
  const fetchMock = makeMockFetch(() => ({ ok: false, status: 401 }));
  useFetch(fetchMock);
  const url = uniqueUrl("auth-401");
  await assert.rejects(
    fetchJsonShared(url),
    (err: unknown) => err instanceof DataFetchError && err.kind === "auth" && err.status === 401,
  );
  await assert.rejects(fetchJsonShared(url));
  assert.equal(fetchMock.callCount(), 2);
});

test("invalid JSON classifies as parse and is never cached", async () => {
  const fetchMock = makeMockFetch(() => ({
    ok: true,
    status: 200,
    json: () => {
      throw new SyntaxError("Unexpected token");
    },
  }));
  useFetch(fetchMock);
  const url = uniqueUrl("parse-bad-json");
  await assert.rejects(fetchJsonShared(url), (err: unknown) => err instanceof DataFetchError && err.kind === "parse");
  await assert.rejects(fetchJsonShared(url));
  assert.equal(fetchMock.callCount(), 2);
});

test("one caller's abort ends only its own wait; a concurrent caller still gets the result", async () => {
  const fetchMock = makeMockFetch(() => ({ ok: true, status: 200, json: () => ({ ok: true }), delayMs: 30 }));
  useFetch(fetchMock);
  const url = uniqueUrl("abort-share");
  const controller = new AbortController();
  const aborting = fetchJsonShared(url, { signal: controller.signal });
  const surviving = fetchJsonShared(url);
  controller.abort();
  await assert.rejects(aborting, (err: unknown) => err instanceof DataFetchError && err.kind === "aborted");
  const result = await surviving;
  assert.deepEqual(result.data, { ok: true });
  assert.equal(fetchMock.callCount(), 1); // the shared request itself was never aborted
});

test("a caller's timeout ends its own wait, but the shared request still fills the cache", async () => {
  const fetchMock = makeMockFetch(() => ({ ok: true, status: 200, json: () => ({ n: 7 }), delayMs: 40 }));
  useFetch(fetchMock);
  const url = uniqueUrl("timeout-fill");
  await assert.rejects(
    fetchJsonShared(url, { timeoutMs: 10 }),
    (err: unknown) => err instanceof DataFetchError && err.kind === "timeout",
  );
  await new Promise((resolve) => setTimeout(resolve, 55)); // let the shared request settle
  const cached = await fetchJsonShared<{ n: number }>(url);
  assert.equal(fetchMock.callCount(), 1); // second read was a cache hit
  assert.deepEqual(cached.data, { n: 7 });
});

test("force skips a fresh cache hit and issues a new request", async () => {
  const fetchMock = makeMockFetch((_url, callIndex) => ({ ok: true, status: 200, json: () => ({ n: callIndex }) }));
  useFetch(fetchMock);
  const url = uniqueUrl("force-fresh");
  const first = await fetchJsonShared<{ n: number }>(url, { ttlMs: 60_000 });
  assert.equal(fetchMock.callCount(), 1);
  const forced = await fetchJsonShared<{ n: number }>(url, { ttlMs: 60_000, force: true });
  assert.equal(fetchMock.callCount(), 2);
  assert.notEqual(forced.data.n, first.data.n);
});

test("force still joins an already in-flight request instead of duplicating it", async () => {
  const fetchMock = makeMockFetch((_url, callIndex) => ({ ok: true, status: 200, json: () => ({ n: callIndex }), delayMs: 20 }));
  useFetch(fetchMock);
  const url = uniqueUrl("force-inflight");
  const started = fetchJsonShared<{ n: number }>(url);
  const forced = fetchJsonShared<{ n: number }>(url, { force: true });
  const [a, b] = await Promise.all([started, forced]);
  assert.equal(fetchMock.callCount(), 1);
  assert.deepEqual(a.data, b.data);
});

test("the cache evicts its least recently used entry once past the LRU cap", async () => {
  const CAP = 64;
  const fetchMock = makeMockFetch((_url, callIndex) => ({ ok: true, status: 200, json: () => ({ n: callIndex }) }));
  useFetch(fetchMock);
  const urls = Array.from({ length: CAP + 1 }, (_, i) => uniqueUrl(`lru-${i}`));
  for (const url of urls) {
    await fetchJsonShared(url, { ttlMs: 60_000 });
  }
  assert.equal(fetchMock.callCount(), CAP + 1);

  await fetchJsonShared(urls[0], { ttlMs: 60_000 }); // evicted: cache miss
  assert.equal(fetchMock.callCount(), CAP + 2);

  await fetchJsonShared(urls[urls.length - 1], { ttlMs: 60_000 }); // still cached
  assert.equal(fetchMock.callCount(), CAP + 2);
});

test("fetchJsonOrNull resolves to null instead of throwing on failure", async () => {
  const fetchMock = makeMockFetch(() => ({ ok: false, status: 500 }));
  useFetch(fetchMock);
  const url = uniqueUrl("or-null");
  assert.equal(await fetchJsonOrNull(url), null);
});

test("invalidateData forces the next read to refetch", async () => {
  const fetchMock = makeMockFetch((_url, callIndex) => ({ ok: true, status: 200, json: () => ({ n: callIndex }) }));
  useFetch(fetchMock);
  const url = uniqueUrl("invalidate");
  await fetchJsonShared(url, { ttlMs: 60_000 });
  assert.equal(fetchMock.callCount(), 1);
  invalidateData(url);
  await fetchJsonShared(url, { ttlMs: 60_000 });
  assert.equal(fetchMock.callCount(), 2);
});
