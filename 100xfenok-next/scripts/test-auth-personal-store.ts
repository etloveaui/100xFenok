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
  type IbStoreDocument,
  type IbProfileStoreDocument,
  packIbStoreFromLocal,
  unpackIbStoreToLocal,
  splitIbStoreDocument,
  mergeIbStoreDocuments,
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
  assert.equal(isAllowedStoreKey("ib"), true);
  assert.equal(isAllowedStoreKey("macro-presets"), true);
  assert.equal(isAllowedStoreKey("ib:profile-1"), true);
  assert.equal(isAllowedStoreKey("ib:TQQQ_40DIV"), true);
  assert.equal(isAllowedStoreKey("ib:bad/char"), false);
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
  assert.equal(normalizeStoreKey("ib"), "ib");
  assert.equal(normalizeStoreKey("ib_profiles"), "ib");
  assert.equal(normalizeStoreKey("macro-presets"), "macro-presets");
  assert.equal(normalizeStoreKey("100xfenok.macroChart.userPresets.v1"), "macro-presets");
  assert.equal(normalizeStoreKey("ib:p1"), "ib:p1");
  assert.equal(normalizeStoreKey("other"), null);

  // hasData
  assert.equal(hasData("portfolio", null), false);
  assert.equal(hasData("portfolio", {}), false);
  assert.equal(hasData("portfolio", { portfolios: [] }), false);
  assert.equal(hasData("portfolio", { portfolios: [{ id: "1", name: "P1" }] }), true);
  assert.equal(hasData("watchlist", null), false);
  assert.equal(hasData("watchlist", { tickers: [] }), false);
  assert.equal(hasData("watchlist", { tickers: ["NVDA"] }), true);
  assert.equal(hasData("macro-presets", null), false);
  assert.equal(hasData("macro-presets", []), false);
  assert.equal(hasData("macro-presets", [{ id: "preset-1", name: "Lens View" }]), true);
  assert.equal(hasData("ib", null), false);
  assert.equal(hasData("ib", {}), false);
  assert.equal(hasData("ib", { profiles: {} }), false);
  assert.equal(hasData("ib", { profiles: { p1: { name: "Profile 1" } } }), true);
  assert.equal(hasData("ib", { daily: { p1_TQQQ: { holdings: 5 } } }), true);

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

  // isDifferent: macro-presets ignores id and updatedAt differences
  const mpA = [{ id: "user-1", name: "Lens", selected: [{ id: "fed_funds" }], updatedAt: "2026-09-01" }];
  const mpB = [{ id: "user-2", name: "Lens", selected: [{ id: "fed_funds" }], updatedAt: "2026-09-17" }];
  const mpC = [{ id: "user-1", name: "Lens", selected: [{ id: "cpi_yoy" }], updatedAt: "2026-09-01" }];
  assert.equal(isDifferent("macro-presets", mpA, mpB), false);
  assert.equal(isDifferent("macro-presets", mpA, mpC), true);

  // isDifferent: ib ignores updatedAt differences
  const ibA = { profiles: { p1: { id: "p1", name: "P1" } }, daily: { p1_TQQQ: { holdings: 10 } }, updatedAt: 100 };
  const ibB = { profiles: { p1: { id: "p1", name: "P1" } }, daily: { p1_TQQQ: { holdings: 10 } }, updatedAt: 200 };
  const ibC = { profiles: { p1: { id: "p1", name: "P1" } }, daily: { p1_TQQQ: { holdings: 20 } }, updatedAt: 100 };
  assert.equal(isDifferent("ib", ibA, ibB), false);
  assert.equal(isDifferent("ib", ibA, ibC), true);

  // getDocUpdatedAtMs
  const isoTime = "2026-09-17T12:00:00.000Z";
  const expectedMs = Date.parse(isoTime);
  assert.equal(getDocUpdatedAtMs({ updated_at: isoTime }), expectedMs);
  assert.equal(getDocUpdatedAtMs({ updatedAt: 12345678 }), 12345678);
  assert.equal(getDocUpdatedAtMs([{ updatedAt: "2026-09-17T12:00:00.000Z" }]), expectedMs);
});

test("IB store document packing, unpacking, split and merge helpers", () => {
  const localMap = new Map<string, string>();
  const originalWindow = (globalThis as unknown as { window?: unknown }).window;
  (globalThis as unknown as { window?: unknown }).window = {
    localStorage: {
      get length() {
        return localMap.size;
      },
      key: (i: number) => Array.from(localMap.keys())[i] ?? null,
      getItem: (k: string) => localMap.get(k) ?? null,
      setItem: (k: string, v: string) => localMap.set(k, v),
      removeItem: (k: string) => localMap.delete(k),
      clear: () => localMap.clear(),
    },
  };

  try {
    const doc: IbStoreDocument = {
      version: "1.0.0",
      activeProfileId: "prof-1",
      profiles: {
        "prof-1": { id: "prof-1", name: "Profile 1", stocks: [{ symbol: "TQQQ" }] },
        "prof-2": { id: "prof-2", name: "Profile 2", stocks: [{ symbol: "SOXL" }] },
      },
      daily: {
        "prof-1_TQQQ": { totalInvested: 5000, holdings: 50 },
        "prof-2_SOXL": { totalInvested: 3000, holdings: 30 },
      },
      updatedAt: 1700000000000,
    };

    // 1. Unpack into localStorage
    unpackIbStoreToLocal(doc);
    assert.ok(localMap.has("ib_profiles"));
    assert.ok(localMap.has("ib_daily_data_prof-1_TQQQ"));
    assert.ok(localMap.has("ib_daily_data_prof-2_SOXL"));

    // 2. Pack back from localStorage
    const packed = packIbStoreFromLocal();
    assert.ok(packed);
    assert.equal(packed.activeProfileId, "prof-1");
    assert.deepEqual(packed.profiles, doc.profiles);
    assert.deepEqual(packed.daily, doc.daily);

    // 3. Split into root and profileDocs
    const { rootDoc, profileDocs } = splitIbStoreDocument(doc);
    assert.equal(rootDoc.activeProfileId, "prof-1");
    assert.deepEqual(rootDoc.daily, {});
    assert.equal(Object.keys(profileDocs).length, 2);
    assert.deepEqual(profileDocs["prof-1"].daily, { "prof-1_TQQQ": { totalInvested: 5000, holdings: 50 } });
    assert.deepEqual(profileDocs["prof-2"].daily, { "prof-2_SOXL": { totalInvested: 3000, holdings: 30 } });

    // 4. Merge back
    const merged = mergeIbStoreDocuments(rootDoc, profileDocs);
    assert.deepEqual(merged.profiles, doc.profiles);
    assert.deepEqual(merged.daily, doc.daily);
  } finally {
    (globalThis as unknown as { window?: unknown }).window = originalWindow;
  }
});

test("IB store size split rule for payloads exceeding 256 KB", async () => {
  // Construct a document exceeding 256 KB across 2 profiles
  const largeChunk = "X".repeat(150 * 1024); // 150 KB
  const doc: IbStoreDocument = {
    version: "1.0.0",
    activeProfileId: "prof-heavy-1",
    profiles: {
      "prof-heavy-1": { id: "prof-heavy-1", name: "Heavy 1" },
      "prof-heavy-2": { id: "prof-heavy-2", name: "Heavy 2" },
    },
    daily: {
      "prof-heavy-1_BIG": { totalInvested: 1, holdings: 1, note: largeChunk },
      "prof-heavy-2_BIG": { totalInvested: 2, holdings: 2, note: largeChunk },
    },
    updatedAt: Date.now(),
  };

  const totalByteLength = new TextEncoder().encode(JSON.stringify(doc)).byteLength;
  assert.ok(totalByteLength > MAX_STORE_SIZE_BYTES, `Total size ${totalByteLength} must exceed 256 KB limit`);

  const { rootDoc, profileDocs } = splitIbStoreDocument(doc);

  const rootBytes = new TextEncoder().encode(JSON.stringify(rootDoc)).byteLength;
  assert.ok(rootBytes < MAX_STORE_SIZE_BYTES, `Root doc size ${rootBytes} must be well under 256 KB`);

  for (const [profileId, pDoc] of Object.entries(profileDocs)) {
    const pBytes = new TextEncoder().encode(JSON.stringify(pDoc)).byteLength;
    assert.ok(pBytes < MAX_STORE_SIZE_BYTES, `Profile ${profileId} size ${pBytes} must be under 256 KB`);
  }
});

test("personalStore client read, write, subscribe and adopt-on-login logic", async () => {
  // Set up mock localStorage and sessionStorage
  const localStore = new Map<string, string>();
  const sessionStore = new Map<string, string>();
  const storageListeners = new Set<(e: { key: string }) => void>();

  const mockLocalStorage = {
    get length() {
      return localStore.size;
    },
    key: (index: number) => {
      const keys = Array.from(localStore.keys());
      return keys[index] ?? null;
    },
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

  // 1. read and write work locally for portfolio
  storeWrite("portfolio", {
    version: 1,
    portfolios: [{ id: "p1", name: "My Local", holdings: [] }],
  });
  const localDoc = storeRead<{ version: number; portfolios: { name: string }[] }>("portfolio");
  assert.equal(localDoc?.portfolios[0]?.name, "My Local");

  // Read and write for macro-presets
  storeWrite("macro-presets", [{ id: "mp-1", name: "My Presets", selected: [] }]);
  const localPresets = storeRead<Array<{ id: string; name: string }>>("macro-presets");
  assert.equal(localPresets?.[0]?.name, "My Presets");

  // Read and write for ib
  storeWrite("ib", {
    version: "1.0",
    activeProfileId: "prof-a",
    profiles: { "prof-a": { id: "prof-a", name: "Profile A" } },
    daily: { "prof-a_TQQQ": { totalInvested: 1000, holdings: 10 } },
  });
  const localIb = storeRead<IbStoreDocument>("ib");
  assert.equal(localIb?.activeProfileId, "prof-a");
  assert.equal(localIb?.profiles?.["prof-a"]?.name, "Profile A");
  assert.equal((localIb?.daily?.["prof-a_TQQQ"] as { holdings: number })?.holdings, 10);

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

  // 6. Adopt-on-login: Scenario D - all 4 keys conflicting -> single prompt with all 4 items
  localStore.clear();
  sessionStore.clear();

  storeWrite("portfolio", {
    version: 1,
    portfolios: [{ id: "lp", name: "Local Portfolio", holdings: [] }],
  });
  storeWrite("watchlist", {
    version: 1,
    tickers: ["NVDA", "AAPL"],
  });
  storeWrite("ib", {
    version: "1.0",
    activeProfileId: "p1",
    profiles: { p1: { id: "p1", name: "Local IB" } },
    daily: { p1_TQQQ: { totalInvested: 100, holdings: 1 } },
  });
  storeWrite("macro-presets", [
    { id: "m-local", name: "Local Macro", selected: [{ id: "fed_funds" }] },
  ]);

  saveAuthToken("sub-multi.valid-token");
  notifyUserChange({
    sub: "sub-multi",
    email: "multi@example.com",
    name: "Multi User",
    picture: "",
    createdAt: 0,
    updatedAt: 0,
  });

  const serverIb = {
    version: "1.0",
    activeProfileId: "p1",
    profiles: { p1: { id: "p1", name: "Server IB" } },
    daily: { p1_TQQQ: { totalInvested: 500, holdings: 5 } },
  };
  const serverPresets = [
    { id: "m-server", name: "Server Macro", selected: [{ id: "cpi_yoy" }] },
  ];
  const serverWatchlist = {
    version: 1,
    tickers: ["MSFT", "GOOGL"],
  };

  const uploadedPutKeys: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (init?.method === "PUT") {
      for (const k of ["portfolio", "watchlist", "ib", "macro-presets"]) {
        if (url.includes(`/api/user/store/${k}`)) {
          uploadedPutKeys.push(k);
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
      }
    }
    if (url.includes("/api/user/store/portfolio")) {
      return new Response(JSON.stringify({ ok: true, key: "portfolio", value: serverPortfolio, updatedAt: 300 }), { status: 200 });
    }
    if (url.includes("/api/user/store/watchlist")) {
      return new Response(JSON.stringify({ ok: true, key: "watchlist", value: serverWatchlist, updatedAt: 300 }), { status: 200 });
    }
    if (url.includes("/api/user/store/ib")) {
      return new Response(JSON.stringify({ ok: true, key: "ib", value: serverIb, updatedAt: 300 }), { status: 200 });
    }
    if (url.includes("/api/user/store/macro-presets")) {
      return new Response(JSON.stringify({ ok: true, key: "macro-presets", value: serverPresets, updatedAt: 300 }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }) as typeof fetch;

  let multiConflict: AdoptConflict | null = null;
  const unsubMulti = onAdoptConflict((c) => {
    multiConflict = c;
  });

  try {
    await checkAdoptOnLogin();
    assert.ok(multiConflict);
    assert.deepEqual((multiConflict as AdoptConflict).keys, [
      "portfolio",
      "watchlist",
      "ib",
      "macro-presets",
    ]);
    assert.deepEqual((multiConflict as AdoptConflict).items, [
      "포트폴리오",
      "관심종목",
      "무한매수 기록",
      "매크로 프리셋",
    ]);

    // Test resolving with keep_account -> overwrites all 4 keys locally
    await (multiConflict as AdoptConflict).resolve("keep_account");
    const portAfter = storeRead<{ portfolios: { name: string }[] }>("portfolio");
    assert.equal(portAfter?.portfolios[0]?.name, "Account Portfolio");

    const watchAfter = storeRead<{ tickers: string[] }>("watchlist");
    assert.deepEqual(watchAfter?.tickers, ["MSFT", "GOOGL"]);

    const ibAfter = storeRead<IbStoreDocument>("ib");
    assert.equal(ibAfter?.profiles?.["p1"]?.name, "Server IB");
    assert.equal((ibAfter?.daily?.["p1_TQQQ"] as { holdings: number })?.holdings, 5);

    const macroAfter = storeRead<Array<{ name: string }>>("macro-presets");
    assert.equal(macroAfter?.[0]?.name, "Server Macro");

    // Test resolving with adopt_local
    await (multiConflict as AdoptConflict).resolve("adopt_local");
    assert.ok(uploadedPutKeys.includes("portfolio"));
    assert.ok(uploadedPutKeys.includes("watchlist"));
    assert.ok(uploadedPutKeys.includes("ib"));
    assert.ok(uploadedPutKeys.includes("macro-presets"));
  } finally {
    globalThis.fetch = originalFetch;
    unsubMulti();
    clearAuthToken();
    notifyUserChange(null);
  }

  // 7. Adopt-on-login: Scenario E - silent upload & silent adopt for ib and macro-presets
  localStore.clear();
  sessionStore.clear();

  // Local has ib, server has empty -> silent upload
  storeWrite("ib", {
    version: "1.0",
    activeProfileId: "p-silent",
    profiles: { "p-silent": { id: "p-silent", name: "Silent IB" } },
  });

  saveAuthToken("sub-silent.valid-token");
  notifyUserChange({
    sub: "sub-silent",
    email: "silent@example.com",
    name: "Silent User",
    picture: "",
    createdAt: 0,
    updatedAt: 0,
  });

  const silentPuts: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (init?.method === "PUT") {
      if (url.includes("/api/user/store/ib")) silentPuts.push("ib");
      if (url.includes("/api/user/store/macro-presets")) silentPuts.push("macro-presets");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url.includes("/api/user/store/ib")) {
      return new Response(JSON.stringify({ ok: true, key: "ib", value: null, updatedAt: 0 }), { status: 200 });
    }
    if (url.includes("/api/user/store/macro-presets")) {
      return new Response(
        JSON.stringify({
          ok: true,
          key: "macro-presets",
          value: [{ id: "m-server-silent", name: "Server Silent Preset", selected: [] }],
          updatedAt: 400,
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ ok: true, value: null, updatedAt: 0 }), { status: 200 });
  }) as typeof fetch;

  try {
    await checkAdoptOnLogin();
    // Silent upload happened for ib
    assert.ok(silentPuts.includes("ib"));
    // Silent adopt happened for macro-presets
    const adoptedMacro = storeRead<Array<{ name: string }>>("macro-presets");
    assert.equal(adoptedMacro?.[0]?.name, "Server Silent Preset");
  } finally {
    globalThis.fetch = originalFetch;
    clearAuthToken();
    notifyUserChange(null);
  }
});
