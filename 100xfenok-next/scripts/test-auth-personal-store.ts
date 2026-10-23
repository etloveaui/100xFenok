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
  getDocUpdatedAtMs,
  normalizeStoreKey,
  syncAccountStores,
  triggerBackgroundSync,
  DEVICE_BACKUP_KEY,
  read as storeRead,
  write as storeWrite,
  subscribe as subscribeStore,
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

test("personalStore helpers: normalizeStoreKey, getDocUpdatedAtMs", () => {
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

test("personalStore account-authoritative cache, backup and signed-out behavior", async () => {
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

  const originalFetch = globalThis.fetch;
  const originalSetItem = mockLocalStorage.setItem;
  const puts: Array<{ url: string; value: unknown; auth: string | null }> = [];
  let server: Record<string, unknown> = {
    portfolio: { portfolios: [{ id: "server", name: "Account Portfolio", holdings: [] }], updatedAt: 1 },
    watchlist: { tickers: ["MSFT"], updatedAt: 1 },
    ib: { profiles: { remote: { name: "Server IB" } }, daily: { remote_TQQQ: { holdings: 5 } } },
    "macro-presets": [{ name: "Account Preset" }],
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "PUT") {
      puts.push({ url, value: JSON.parse(String(init.body)).value, auth: new Headers(init.headers).get("Authorization") });
      return Response.json({ ok: true });
    }
    const key = url.split("/").pop()!;
    return Response.json({ ok: true, value: server[key] ?? null, updatedAt: 1 });
  }) as typeof fetch;

  try {
    // Preserve exact bytes, including malformed daily data, before any overwrite.
    localStore.set("ib_daily_data_malformed", "{broken");
    const originalDevice = Object.fromEntries(localStore);
    saveAuthToken("account-a.token");
    const writes: string[] = [];
    mockLocalStorage.setItem = (key, value) => { writes.push(key); originalSetItem(key, value); };
    await syncAccountStores();
    assert.equal(writes[0], DEVICE_BACKUP_KEY);
    const backupRaw = localStore.get(DEVICE_BACKUP_KEY)!;
    const backup = JSON.parse(backupRaw).entries;
    for (const [key, value] of Object.entries(originalDevice)) assert.equal(backup[key], value);
    assert.deepEqual(storeRead("portfolio"), server.portfolio); // Older timestamp still wins.
    assert.deepEqual(storeRead("watchlist"), server.watchlist);
    assert.deepEqual(storeRead("macro-presets"), server["macro-presets"]);
    assert.deepEqual(storeRead<IbStoreDocument>("ib")?.daily, { remote_TQQQ: { holdings: 5 } });
    assert.equal(localStore.has("ib_daily_data_prof-a_TQQQ"), false);
    assert.equal(localStore.has("ib_daily_data_malformed"), false);
    assert.equal(puts.length, 0); // Loading never imports device data into the account.

    // Empty account is authoritative too; backup remains the original snapshot.
    server = {};
    await syncAccountStores();
    for (const key of ["portfolio", "watchlist", "ib", "macro-presets"]) assert.equal(storeRead(key), null);
    assert.equal(localStore.get(DEVICE_BACKUP_KEY), backupRaw);
    assert.equal(puts.length, 0);

    // Explicit signed-in edits still write through to the account.
    const edited = { tickers: ["AAPL"] };
    storeWrite("watchlist", edited);
    await new Promise(resolve => setTimeout(resolve, 550));
    assert.deepEqual(puts.at(-1)?.value, edited);
    assert.equal(puts.at(-1)?.auth, "Bearer account-a.token");

    // A delayed GET must not erase a user edit or apply another account's response.
    const normalFetch = globalThis.fetch;
    let release!: (response: Response) => void;
    globalThis.fetch = (() => new Promise<Response>(resolve => { release = resolve; })) as typeof fetch;
    const pending = triggerBackgroundSync("portfolio");
    const newPortfolio = { portfolios: [{ name: "Edited during load" }] };
    storeWrite("portfolio", newPortfolio);
    release(Response.json({ ok: true, value: { portfolios: [] }, updatedAt: 999 }));
    await pending;
    assert.deepEqual(storeRead("portfolio"), newPortfolio);
    globalThis.fetch = normalFetch;
    await new Promise(resolve => setTimeout(resolve, 550));
    assert.deepEqual(puts.at(-1)?.value, newPortfolio);

    globalThis.fetch = (() => new Promise<Response>(resolve => { release = resolve; })) as typeof fetch;
    const oldAccountRead = triggerBackgroundSync("watchlist");
    clearAuthToken();
    release(Response.json({ ok: true, value: { tickers: ["WRONG"] } }));
    await oldAccountRead;
    assert.deepEqual(storeRead("watchlist"), edited);
    globalThis.fetch = normalFetch;

    // Logged-out edits remain device-only, and queued writes never move accounts.
    const count = puts.length;
    storeWrite("watchlist", { tickers: ["LOCAL"] });
    await triggerBackgroundSync("watchlist");
    assert.deepEqual(storeRead("watchlist"), { tickers: ["LOCAL"] });
    assert.equal(puts.length, count);
    saveAuthToken("account-a.token");
    storeWrite("watchlist", { tickers: ["A"] });
    saveAuthToken("account-b.token");
    await triggerBackgroundSync("watchlist");
    assert.equal(storeRead("watchlist"), null); // Prior account debounce does not block hydration.
    await new Promise(resolve => setTimeout(resolve, 550));
    assert.equal(puts.length, count);

    // Failed reads and a failed backup leave existing device data untouched.
    localStore.delete(DEVICE_BACKUP_KEY);
    localStore.set("fenok.watchlist.v1", "unparsed-device-bytes");
    globalThis.fetch = (async () => Response.json({ ok: false }, { status: 500 })) as typeof fetch;
    await triggerBackgroundSync("watchlist");
    assert.equal(localStore.get("fenok.watchlist.v1"), "unparsed-device-bytes");
    assert.equal(localStore.has(DEVICE_BACKUP_KEY), false);
    globalThis.fetch = normalFetch;
    mockLocalStorage.setItem = (key, value) => {
      if (key === DEVICE_BACKUP_KEY) throw new Error("Quota exceeded");
      originalSetItem(key, value);
    };
    await triggerBackgroundSync("watchlist");
    assert.equal(localStore.get("fenok.watchlist.v1"), "unparsed-device-bytes");
    assert.equal(localStore.has(DEVICE_BACKUP_KEY), false);
    mockLocalStorage.setItem = originalSetItem;

    // Split IB documents hydrate fully; stale device daily rows do not survive.
    globalThis.fetch = (async input => Response.json({ ok: true, value: String(input).endsWith("ib:p1")
      ? { profileId: "p1", profile: { name: "Split" }, daily: { p1_TQQQ: { holdings: 7 } } }
      : { profiles: { p1: { name: "Split" } }, daily: {} } })) as typeof fetch;
    await triggerBackgroundSync("ib");
    assert.deepEqual(storeRead<IbStoreDocument>("ib")?.daily, { p1_TQQQ: { holdings: 7 } });
  } finally {
    mockLocalStorage.setItem = originalSetItem;
    globalThis.fetch = originalFetch;
    clearAuthToken();
    notifyUserChange(null);
    delete (globalThis as unknown as { window?: unknown }).window;
  }
});
