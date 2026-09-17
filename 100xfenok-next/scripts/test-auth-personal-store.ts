import assert from "node:assert/strict";
import test from "node:test";
import {
  UserStoreCore,
  type DurableObjectStorageLike,
  getInMemoryUserStore,
  resetInMemoryUserStores,
} from "../src/lib/server/userStore";
import {
  getInMemoryUserRegistry,
  resetInMemoryUserRegistry,
} from "../src/lib/server/userRegistry";
import {
  GET as storeGetHandler,
  PUT as storePutHandler,
  isAllowedStoreKey,
  MAX_STORE_SIZE_BYTES,
} from "../src/app/api/user/store/[key]/route";
import {
  hasData,
  isDifferent,
  getDocUpdatedAtMs,
  normalizeStoreKey,
  read as storeRead,
  write as storeWrite,
  subscribe as subscribeStore,
  checkAdoptOnLogin,
  onAdoptConflict,
  type AdoptConflict,
} from "../src/lib/personal/personalStore";
import {
  saveAuthToken,
  clearAuthToken,
  notifyUserChange,
} from "../src/lib/auth/clientAuth";

function createFakeStorage(): DurableObjectStorageLike {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return map.get(key) as T | undefined;
    },
    async put(key: string, value: unknown): Promise<void> {
      map.set(key, value);
    },
    async delete(key: string): Promise<boolean> {
      return map.delete(key);
    },
  };
}

test("UserStoreCore getStoreData and setStoreData unit tests", async () => {
  const storage = createFakeStorage();
  const store = new UserStoreCore({ storage });

  // 1. Initial state is null
  assert.equal(await store.getStoreData("portfolio"), null);
  assert.equal(await store.getStoreData("watchlist"), null);

  // 2. Set portfolio data
  const t0 = 1_700_000_100_000;
  const portfolioDoc = {
    version: 1,
    portfolios: [{ id: "p1", name: "Tech Growth", holdings: [] }],
  };
  const savedPortfolio = await store.setStoreData("portfolio", portfolioDoc, t0);
  assert.equal(savedPortfolio.key, "portfolio");
  assert.deepEqual(savedPortfolio.value, portfolioDoc);
  assert.equal(savedPortfolio.updatedAt, t0);

  // 3. Retrieve saved portfolio
  const fetched = await store.getStoreData("portfolio");
  assert.ok(fetched);
  assert.deepEqual(fetched.value, portfolioDoc);
  assert.equal(fetched.updatedAt, t0);

  // 4. Watchlist is still null
  assert.equal(await store.getStoreData("watchlist"), null);

  // 5. Set watchlist data
  const watchlistDoc = {
    version: 1,
    tickers: ["NVDA", "AAPL", "MSFT"],
  };
  const savedWatchlist = await store.setStoreData("watchlist", watchlistDoc);
  assert.equal(savedWatchlist.key, "watchlist");
  assert.deepEqual(savedWatchlist.value, watchlistDoc);
  assert.ok(savedWatchlist.updatedAt > 0);

  // 6. Overwrite portfolio updates data and updatedAt
  const t1 = t0 + 5000;
  const updatedPortfolioDoc = {
    version: 1,
    portfolios: [{ id: "p1", name: "Tech Growth", holdings: [{ ticker: "NVDA", shares: 10 }] }],
  };
  const updatedPortfolio = await store.setStoreData("portfolio", updatedPortfolioDoc, t1);
  assert.equal(updatedPortfolio.updatedAt, t1);
  assert.deepEqual((await store.getStoreData("portfolio"))?.value, updatedPortfolioDoc);
});

test("API route /api/user/store/[key] enforces allowlist", async () => {
  assert.equal(isAllowedStoreKey("portfolio"), true);
  assert.equal(isAllowedStoreKey("watchlist"), true);
  assert.equal(isAllowedStoreKey("unknown"), false);
  assert.equal(isAllowedStoreKey("secrets"), false);

  const reqGet = new Request("http://localhost/api/user/store/unknown");
  const resGet = await storeGetHandler(reqGet, { params: { key: "unknown" } });
  assert.equal(resGet.status, 400);
  const dataGet = (await resGet.json()) as { ok: boolean; error: string };
  assert.equal(dataGet.ok, false);
  assert.ok(dataGet.error.includes("Invalid store key"));

  const reqPut = new Request("http://localhost/api/user/store/unknown", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: { foo: "bar" } }),
  });
  const resPut = await storePutHandler(reqPut, { params: { key: "unknown" } });
  assert.equal(resPut.status, 400);
});

test("API route /api/user/store/[key] enforces authentication", async () => {
  const reqGet = new Request("http://localhost/api/user/store/portfolio");
  const resGet = await storeGetHandler(reqGet, { params: { key: "portfolio" } });
  assert.equal(resGet.status, 401);

  const reqPut = new Request("http://localhost/api/user/store/portfolio", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: {} }),
  });
  const resPut = await storePutHandler(reqPut, { params: { key: "portfolio" } });
  assert.equal(resPut.status, 401);
});

test("API route /api/user/store/[key] blocks banned accounts with 403", async () => {
  resetInMemoryUserStores();
  resetInMemoryUserRegistry();

  const sub = "blocked-user-sub";
  const userStore = getInMemoryUserStore(sub);
  await userStore.saveProfile({ sub, email: "blocked@example.com" });
  const { token } = await userStore.mintToken("test-device");

  const registry = getInMemoryUserRegistry();
  await registry.upsert({ sub, email: "blocked@example.com" });
  await registry.setBlocked(sub, true);

  const reqGet = new Request("http://localhost/api/user/store/portfolio", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const resGet = await storeGetHandler(reqGet, { params: { key: "portfolio" } });
  assert.equal(resGet.status, 403);

  const reqPut = new Request("http://localhost/api/user/store/portfolio", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ value: { portfolios: [] } }),
  });
  const resPut = await storePutHandler(reqPut, { params: { key: "portfolio" } });
  assert.equal(resPut.status, 403);
});

test("API route /api/user/store/[key] rejects payloads exceeding 256 KB with 413", async () => {
  resetInMemoryUserStores();
  resetInMemoryUserRegistry();

  const sub = "size-test-sub";
  const userStore = getInMemoryUserStore(sub);
  await userStore.saveProfile({ sub, email: "size@example.com" });
  const { token } = await userStore.mintToken("test-device");

  // Create payload larger than 256 KB
  const largePadding = "x".repeat(MAX_STORE_SIZE_BYTES + 1024);
  const reqPut = new Request("http://localhost/api/user/store/portfolio", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ value: { pad: largePadding } }),
  });

  const resPut = await storePutHandler(reqPut, { params: { key: "portfolio" } });
  assert.equal(resPut.status, 413);
  const data = (await resPut.json()) as { ok: boolean; error: string };
  assert.equal(data.ok, false);
  assert.ok(data.error.includes("exceeds 256 KB limit"));
});

test("API route /api/user/store/[key] rejects invalid JSON with 400", async () => {
  resetInMemoryUserStores();
  resetInMemoryUserRegistry();

  const sub = "json-test-sub";
  const userStore = getInMemoryUserStore(sub);
  await userStore.saveProfile({ sub, email: "json@example.com" });
  const { token } = await userStore.mintToken("test-device");

  const reqPut = new Request("http://localhost/api/user/store/portfolio", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: "{ invalid json format ---",
  });

  const resPut = await storePutHandler(reqPut, { params: { key: "portfolio" } });
  assert.equal(resPut.status, 400);
  const data = (await resPut.json()) as { ok: boolean; error: string };
  assert.equal(data.ok, false);
  assert.equal(data.error, "Invalid JSON");
});

test("API route /api/user/store/[key] round-trip GET and PUT with updatedAt", async () => {
  resetInMemoryUserStores();
  resetInMemoryUserRegistry();

  const sub = "roundtrip-sub";
  const userStore = getInMemoryUserStore(sub);
  await userStore.saveProfile({ sub, email: "roundtrip@example.com" });
  const { token } = await userStore.mintToken("test-device");

  // 1. Initial GET on empty key returns value: null, updatedAt: 0
  const reqGetInitial = new Request("http://localhost/api/user/store/watchlist", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const resGetInitial = await storeGetHandler(reqGetInitial, { params: { key: "watchlist" } });
  assert.equal(resGetInitial.status, 200);
  const initialData = (await resGetInitial.json()) as {
    ok: boolean;
    key: string;
    value: unknown;
    updatedAt: number;
  };
  assert.equal(initialData.ok, true);
  assert.equal(initialData.key, "watchlist");
  assert.equal(initialData.value, null);
  assert.equal(initialData.updatedAt, 0);

  // 2. PUT data with custom updatedAt
  const customTime = 1_700_500_000_000;
  const payload = {
    value: { version: 1, tickers: ["NVDA", "TSLA"] },
    updatedAt: customTime,
  };
  const reqPut = new Request("http://localhost/api/user/store/watchlist", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const resPut = await storePutHandler(reqPut, { params: { key: "watchlist" } });
  assert.equal(resPut.status, 200);
  const putData = (await resPut.json()) as {
    ok: boolean;
    key: string;
    value: { version: number; tickers: string[] };
    updatedAt: number;
  };
  assert.equal(putData.ok, true);
  assert.equal(putData.key, "watchlist");
  assert.deepEqual(putData.value, payload.value);
  assert.equal(putData.updatedAt, customTime);

  // 3. GET retrieves the stored data
  const reqGetAfter = new Request("http://localhost/api/user/store/watchlist", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const resGetAfter = await storeGetHandler(reqGetAfter, { params: { key: "watchlist" } });
  assert.equal(resGetAfter.status, 200);
  const afterData = (await resGetAfter.json()) as {
    ok: boolean;
    key: string;
    value: { version: number; tickers: string[] };
    updatedAt: number;
  };
  assert.equal(afterData.ok, true);
  assert.deepEqual(afterData.value, payload.value);
  assert.equal(afterData.updatedAt, customTime);
});

test("personalStore helpers: normalizeStoreKey, hasData, isDifferent, getDocUpdatedAtMs", () => {
  // normalizeStoreKey
  assert.equal(normalizeStoreKey("portfolio"), "portfolio");
  assert.equal(normalizeStoreKey("fenok.portfolio.v1"), "portfolio");
  assert.equal(normalizeStoreKey("watchlist"), "watchlist");
  assert.equal(normalizeStoreKey("fenok.watchlist.v1"), "watchlist");
  assert.equal(normalizeStoreKey("other"), null);

  // hasData
  assert.equal(hasData("portfolio", null), false);
  assert.equal(hasData("portfolio", {}), false);
  assert.equal(hasData("portfolio", { portfolios: [] }), false);
  assert.equal(hasData("portfolio", { portfolios: [{ id: "1", name: "P1" }] }), true);
  assert.equal(hasData("watchlist", null), false);
  assert.equal(hasData("watchlist", { tickers: [] }), false);
  assert.equal(hasData("watchlist", { tickers: ["NVDA"] }), true);

  // isDifferent: watchlist order-insensitive and case-insensitive
  assert.equal(
    isDifferent("watchlist", { tickers: ["NVDA", "AAPL"] }, { tickers: ["aapl", "nvda"] }),
    false,
  );
  assert.equal(
    isDifferent("watchlist", { tickers: ["NVDA"] }, { tickers: ["NVDA", "MSFT"] }),
    true,
  );

  // isDifferent: portfolio ignores id differences if contents match
  const pA = {
    portfolios: [{ id: "id-local-1", name: "Main", holdings: [{ ticker: "AAPL", shares: 5 }] }],
  };
  const pB = {
    portfolios: [{ id: "id-remote-2", name: "Main", holdings: [{ ticker: "AAPL", shares: 5 }] }],
  };
  const pC = {
    portfolios: [{ id: "id-remote-2", name: "Main", holdings: [{ ticker: "AAPL", shares: 10 }] }],
  };
  assert.equal(isDifferent("portfolio", pA, pB), false);
  assert.equal(isDifferent("portfolio", pA, pC), true);

  // getDocUpdatedAtMs
  const isoTime = "2026-09-17T12:00:00.000Z";
  const expectedMs = Date.parse(isoTime);
  assert.equal(getDocUpdatedAtMs({ updated_at: isoTime }), expectedMs);
  assert.equal(getDocUpdatedAtMs({ updatedAt: 12345678 }), 12345678);
});

test("personalStore client read, write, subscribe and adopt-on-login logic", async () => {
  // Set up mock localStorage and sessionStorage
  const localStore = new Map<string, string>();
  const sessionStore = new Map<string, string>();
  const storageListeners = new Set<(e: { key: string }) => void>();

  const mockLocalStorage = {
    getItem: (key: string) => localStore.get(key) ?? null,
    setItem: (key: string, val: string) => {
      localStore.set(key, val);
      storageListeners.forEach((l) => l({ key }));
    },
    removeItem: (key: string) => {
      localStore.delete(key);
      storageListeners.forEach((l) => l({ key }));
    },
    clear: () => localStore.clear(),
  };

  const mockSessionStorage = {
    getItem: (key: string) => sessionStore.get(key) ?? null,
    setItem: (key: string, val: string) => sessionStore.set(key, val),
    removeItem: (key: string) => sessionStore.delete(key),
    clear: () => sessionStore.clear(),
  };

  (globalThis as unknown as { window?: unknown }).window = {
    localStorage: mockLocalStorage,
    sessionStorage: mockSessionStorage,
    addEventListener: (event: string, cb: (e: { key: string }) => void) => {
      if (event === "storage") storageListeners.add(cb);
    },
    removeEventListener: (event: string, cb: (e: { key: string }) => void) => {
      if (event === "storage") storageListeners.delete(cb);
    },
  };

  // 1. read and write work locally
  storeWrite("portfolio", {
    version: 1,
    portfolios: [{ id: "p1", name: "My Local", holdings: [] }],
  });
  const localDoc = storeRead<{ version: number; portfolios: { name: string }[] }>("portfolio");
  assert.equal(localDoc?.portfolios[0]?.name, "My Local");

  // 2. subscribe notifies on change
  let notified = false;
  const unsub = subscribeStore("portfolio", () => {
    notified = true;
  });
  storeWrite("portfolio", {
    version: 1,
    portfolios: [{ id: "p1", name: "Updated Local", holdings: [] }],
  });
  assert.equal(notified, true);
  unsub();

  // 3. Adopt-on-login: Scenario A - local has data, server empty -> silent upload
  saveAuthToken("sub-123.valid-token");
  notifyUserChange({
    sub: "sub-123",
    email: "user@example.com",
    name: "User",
    picture: "",
    createdAt: 0,
    updatedAt: 0,
  });

  const originalFetch = globalThis.fetch;
  let serverUploadedKey: string | null = null;
  let serverUploadedBody: unknown = null;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/user/store/portfolio")) {
      if (init?.method === "PUT") {
        serverUploadedKey = "portfolio";
        serverUploadedBody = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ ok: true, key: "portfolio", value: null, updatedAt: 0 }),
        { status: 200 },
      );
    }
    if (url.includes("/api/user/store/watchlist")) {
      return new Response(
        JSON.stringify({ ok: true, key: "watchlist", value: null, updatedAt: 0 }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }) as typeof fetch;

  try {
    sessionStore.clear();
    await checkAdoptOnLogin();
    assert.equal(serverUploadedKey, "portfolio");
    assert.ok(serverUploadedBody);
  } finally {
    globalThis.fetch = originalFetch;
    clearAuthToken();
    notifyUserChange(null);
  }

  // 4. Adopt-on-login: Scenario B - local empty, server has data -> silent adopt
  localStore.clear();
  sessionStore.clear();
  saveAuthToken("sub-456.valid-token");
  notifyUserChange({
    sub: "sub-456",
    email: "user2@example.com",
    name: "User 2",
    picture: "",
    createdAt: 0,
    updatedAt: 0,
  });

  const serverPortfolio = {
    version: 1,
    portfolios: [{ id: "server-p", name: "Account Portfolio", holdings: [] }],
  };

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/user/store/portfolio")) {
      return new Response(
        JSON.stringify({
          ok: true,
          key: "portfolio",
          value: serverPortfolio,
          updatedAt: 100,
        }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({ ok: true, key: "watchlist", value: null, updatedAt: 0 }),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    await checkAdoptOnLogin();
    const adopted = storeRead<{ portfolios: { name: string }[] }>("portfolio");
    assert.equal(adopted?.portfolios[0]?.name, "Account Portfolio");
  } finally {
    globalThis.fetch = originalFetch;
    clearAuthToken();
    notifyUserChange(null);
  }

  // 5. Adopt-on-login: Scenario C - conflict (both present & different) -> triggers onAdoptConflict
  localStore.clear();
  sessionStore.clear();
  storeWrite("portfolio", {
    version: 1,
    portfolios: [{ id: "local-p", name: "Local Conflict", holdings: [] }],
  });

  saveAuthToken("sub-789.valid-token");
  notifyUserChange({
    sub: "sub-789",
    email: "user3@example.com",
    name: "User 3",
    picture: "",
    createdAt: 0,
    updatedAt: 0,
  });

  let conflictReceived: AdoptConflict | null = null;
  const unsubConflict = onAdoptConflict((conflict) => {
    conflictReceived = conflict;
  });

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/user/store/portfolio")) {
      return new Response(
        JSON.stringify({
          ok: true,
          key: "portfolio",
          value: serverPortfolio,
          updatedAt: 200,
        }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({ ok: true, key: "watchlist", value: null, updatedAt: 0 }),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    await checkAdoptOnLogin();
    assert.ok(conflictReceived);
    assert.equal((conflictReceived as AdoptConflict).key, "portfolio");

    // Test resolving conflict by keeping account
    await (conflictReceived as AdoptConflict).resolve("keep_account");
    const resolvedLocal = storeRead<{ portfolios: { name: string }[] }>("portfolio");
    assert.equal(resolvedLocal?.portfolios[0]?.name, "Account Portfolio");
  } finally {
    globalThis.fetch = originalFetch;
    unsubConflict();
    clearAuthToken();
    notifyUserChange(null);
  }
});
