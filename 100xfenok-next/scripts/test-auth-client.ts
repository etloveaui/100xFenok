import assert from "node:assert/strict";
import test from "node:test";
import {
  loadAuthToken,
  saveAuthToken,
  clearAuthToken,
  getGoogleClientId,
  DEFAULT_CLIENT_ID,
  onAuthInvalid,
  notifyAuthInvalid,
  fetchMe,
  postAuthLogout,
} from "../src/lib/auth/clientAuth";

test("clientAuth token storage manages memory and localStorage tokens", () => {
  // Mock localStorage for node environment
  const store = new Map<string, string>();
  const mockLocalStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => store.set(key, val),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
  (globalThis as unknown as { window?: { localStorage?: typeof mockLocalStorage } }).window = {
    localStorage: mockLocalStorage,
  };

  clearAuthToken();
  assert.equal(loadAuthToken(), "");

  saveAuthToken("sub-999.secret-token-12345");
  assert.equal(loadAuthToken(), "sub-999.secret-token-12345");
  assert.equal(mockLocalStorage.getItem("100xfenok.authToken"), "sub-999.secret-token-12345");

  clearAuthToken();
  assert.equal(loadAuthToken(), "");
  assert.equal(mockLocalStorage.getItem("100xfenok.authToken"), null);
});

test("clientAuth provides google client ID fallback", () => {
  const clientId = getGoogleClientId();
  assert.ok(clientId.length > 0);
  assert.equal(clientId, DEFAULT_CLIENT_ID);
});

test("clientAuth triggers onAuthInvalid listeners on 401 or manual notification", async () => {
  let invalidCalls = 0;
  const unsubscribe = onAuthInvalid(() => {
    invalidCalls += 1;
  });

  notifyAuthInvalid();
  assert.equal(invalidCalls, 1);

  // Mock global fetch to return 401
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    saveAuthToken("invalid-token");
    const res = await fetchMe();
    assert.equal(res.ok, false);
    assert.equal(loadAuthToken(), "");
    assert.equal(invalidCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    unsubscribe();
  }

  // After unsubscribe, listener should not fire
  notifyAuthInvalid();
  assert.equal(invalidCalls, 2);
});

test("clientAuth postAuthLogout clears token and notifies listeners", async () => {
  let invalidCalled = false;
  const unsubscribe = onAuthInvalid(() => {
    invalidCalled = true;
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    saveAuthToken("token-to-logout");
    const res = await postAuthLogout();
    assert.equal(res.ok, true);
    assert.equal(loadAuthToken(), "");
    assert.equal(invalidCalled, true);
  } finally {
    globalThis.fetch = originalFetch;
    unsubscribe();
  }
});
