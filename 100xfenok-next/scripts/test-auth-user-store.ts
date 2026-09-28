import assert from "node:assert/strict";
import test from "node:test";
import {
  UserStoreCore,
  type DurableObjectStorageLike,
  TOKEN_TTL_MS,
  TOKEN_REFRESH_THRESHOLD_MS,
} from "../src/lib/server/userStore";
import {
  createSessionCookieHeader,
  createClearSessionCookieHeader,
  parseSessionToken,
  setCustomGoogleVerifier,
  type GoogleIdTokenVerifier,
  FX_SESSION_COOKIE_NAME,
} from "../src/lib/server/authSession";
import { POST as googleAuthHandler } from "../src/app/api/auth/google/route";
import { POST as logoutHandler } from "../src/app/api/auth/logout/route";
import { GET as meHandler } from "../src/app/api/user/me/route";

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

test("UserStoreCore saves and retrieves user profile with immutable createdAt", async () => {
  const storage = createFakeStorage();
  const store = new UserStoreCore({ storage });

  assert.equal(await store.getProfile(), null);

  const profile1 = await store.saveProfile({
    sub: "google-1001",
    email: "test@example.com",
    name: "Tester",
    picture: "https://example.com/avatar.png",
  });

  assert.equal(profile1.sub, "google-1001");
  assert.equal(profile1.email, "test@example.com");
  assert.equal(profile1.name, "Tester");
  assert.ok(profile1.createdAt > 0);
  assert.equal(profile1.updatedAt, profile1.createdAt);

  // Updating profile preserves createdAt
  const profile2 = await store.saveProfile({
    sub: "google-1001",
    email: "test@example.com",
    name: "Tester Renamed",
  });

  assert.equal(profile2.name, "Tester Renamed");
  assert.equal(profile2.createdAt, profile1.createdAt);
  assert.ok(profile2.updatedAt >= profile1.createdAt);
});

test("UserStoreCore mints, verifies, sliding-refreshes, and revokes 30-day tokens", async () => {
  const storage = createFakeStorage();
  const store = new UserStoreCore({ storage });
  await store.saveProfile({ sub: "google-1001", email: "test@example.com" });

  const now = 1_700_000_000_000;
  const { token, expiresAt } = await store.mintToken("mac-safari", now);

  assert.match(token, /^google-1001\.[0-9a-f]{64}$/);
  assert.equal(expiresAt, now + TOKEN_TTL_MS);

  const secret = token.split(".")[1]!;
  assert.equal(await store.verifyToken(secret, now), true);
  assert.equal(await store.verifyToken("invalid-secret", now), false);

  // 20 days later (10 days remaining < 15 days threshold) -> triggers sliding refresh
  const twentyDaysLater = now + 20 * 24 * 60 * 60 * 1000;
  assert.equal(await store.verifyToken(secret, twentyDaysLater), true);

  const tokens = await store.listTokens();
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0]!.expiresAt, twentyDaysLater + TOKEN_TTL_MS);

  // Revocation
  assert.equal(await store.revokeToken(secret), true);
  assert.equal(await store.verifyToken(secret, twentyDaysLater), false);
});

test("UserStoreCore manages user settings", async () => {
  const storage = createFakeStorage();
  const store = new UserStoreCore({ storage });

  const initial = await store.getSettings();
  assert.deepEqual(initial, {});

  const updated = await store.updateSettings({ theme: "dark", customView: "us-first" });
  assert.equal(updated.theme, "dark");
  assert.equal(updated.customView, "us-first");

  const retrieved = await store.getSettings();
  assert.equal(retrieved.theme, "dark");
  assert.equal(retrieved.customView, "us-first");
});

test("authSession parses tokens from Cookie or Bearer header", () => {
  const token = "sub-123.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  // From Cookie
  const cookieReq = new Request("http://localhost/api/user/me", {
    headers: {
      Cookie: `foo=bar; ${FX_SESSION_COOKIE_NAME}=${token}; other=val`,
    },
  });
  const parsedCookie = parseSessionToken(cookieReq);
  assert.ok(parsedCookie);
  assert.equal(parsedCookie.sub, "sub-123");
  assert.equal(parsedCookie.secret, "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  assert.equal(parsedCookie.source, "cookie");

  // From Authorization Bearer
  const bearerReq = new Request("http://localhost/api/user/me", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const parsedBearer = parseSessionToken(bearerReq);
  assert.ok(parsedBearer);
  assert.equal(parsedBearer.sub, "sub-123");
  assert.equal(parsedBearer.source, "bearer");

  // Missing
  const emptyReq = new Request("http://localhost/api/user/me");
  assert.equal(parseSessionToken(emptyReq), null);
});

test("authSession builds secure HttpOnly 30-day session cookies", () => {
  const token = "sub-123.secret-hash";
  const cookie = createSessionCookieHeader(token);
  assert.ok(cookie.includes("fx_session=sub-123.secret-hash"));
  assert.ok(cookie.includes("HttpOnly"));
  assert.ok(cookie.includes("Secure"));
  assert.ok(cookie.includes("SameSite=Lax"));
  assert.ok(cookie.includes("Max-Age=2592000"));

  const clearCookie = createClearSessionCookieHeader();
  assert.ok(clearCookie.includes("fx_session="));
  assert.ok(clearCookie.includes("Max-Age=0"));
});

test("Google login, logout and me API routes work end-to-end", async () => {
  const mockVerifier: GoogleIdTokenVerifier = {
    async verify(idToken: string) {
      if (idToken === "valid-google-token") {
        return {
          sub: "google-test-sub",
          email: "owner@100xfenok.com",
          name: "Fenok Owner",
          picture: "https://lh3.googleusercontent.com/avatar.jpg",
        };
      }
      return null;
    },
  };
  setCustomGoogleVerifier(mockVerifier);

  try {
    // 1. Invalid token rejected
    const badReq = new Request("http://localhost/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: "bad-token" }),
    });
    const badRes = await googleAuthHandler(badReq);
    assert.equal(badRes.status, 401);

    // 2. Valid token sets cookie and returns user
    const loginReq = new Request("http://localhost/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: "valid-google-token", deviceHint: "desktop-chrome" }),
    });
    const loginRes = await googleAuthHandler(loginReq);
    assert.equal(loginRes.status, 200);
    const loginData = (await loginRes.json()) as { ok: boolean; token: string; user: { email: string } };
    assert.equal(loginData.ok, true);
    assert.equal(loginData.user.email, "owner@100xfenok.com");
    assert.ok(loginData.token);

    const setCookie = loginRes.headers.get("Set-Cookie");
    assert.ok(setCookie?.includes("fx_session="));

    // 3. GET /api/user/me returns profile with valid session
    const meReq = new Request("http://localhost/api/user/me", {
      headers: {
        Authorization: `Bearer ${loginData.token}`,
      },
    });
    const meRes = await meHandler(meReq);
    assert.equal(meRes.status, 200);
    const meData = (await meRes.json()) as { ok: boolean; user: { sub: string } };
    assert.equal(meData.ok, true);
    assert.equal(meData.user.sub, "google-test-sub");

    // 4. POST /api/auth/logout revokes session and clears cookie
    const logoutReq = new Request("http://localhost/api/auth/logout", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${loginData.token}`,
      },
    });
    const logoutRes = await logoutHandler(logoutReq);
    assert.equal(logoutRes.status, 200);
    assert.ok(logoutRes.headers.get("Set-Cookie")?.includes("Max-Age=0"));

    // 5. GET /api/user/me is now 401
    const meAfterLogout = await meHandler(meReq);
    assert.equal(meAfterLogout.status, 401);
  } finally {
    setCustomGoogleVerifier(null);
  }
});
