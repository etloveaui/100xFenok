import assert from "node:assert/strict";
import test from "node:test";
import {
  UserRegistryCore,
  UserRegistryMemoryStorage,
  getInMemoryUserRegistry,
  resetInMemoryUserRegistry,
} from "../src/lib/server/userRegistry";
import {
  getInMemoryUserStore,
  resetInMemoryUserStores,
} from "../src/lib/server/userStore";
import {
  setCustomGoogleVerifier,
  type GoogleIdTokenVerifier,
} from "../src/lib/server/authSession";
import { POST as googleAuthHandler } from "../src/app/api/auth/google/route";
import { GET as meHandler } from "../src/app/api/user/me/route";
import { POST as pingHandler } from "../src/app/api/user/ping/route";
import {
  GET as adminUsersGetHandler,
  POST as adminUsersPostHandler,
} from "../src/app/api/admin/users/route";
import {
  ADMIN_SESSION_COOKIE,
  createAdminSessionToken,
} from "../src/lib/server/admin-session";

test("UserRegistryCore upserts users with loginCount, devices, and timestamp integrity", async () => {
  const storage = new UserRegistryMemoryStorage();
  const registry = new UserRegistryCore(storage);

  const t0 = 1_700_000_000_000;
  // 1. First upsert (new user)
  const res1 = await registry.upsert({
    sub: "google-reg-1",
    email: "user1@example.com",
    name: "User One",
    picture: "https://example.com/pic1.jpg",
    device: "desktop-mac",
    now: t0,
  });

  assert.equal(res1.isNew, true);
  assert.equal(res1.user.sub, "google-reg-1");
  assert.equal(res1.user.email, "user1@example.com");
  assert.equal(res1.user.name, "User One");
  assert.equal(res1.user.loginCount, 1);
  assert.deepEqual(res1.user.devices, ["desktop-mac"]);
  assert.equal(res1.user.blocked, false);
  assert.equal(res1.user.firstSeen, new Date(t0).toISOString());
  assert.equal(res1.user.lastSeen, new Date(t0).toISOString());

  // 2. Second upsert (existing user, new device, later time)
  const t1 = t0 + 3600 * 1000; // 1 hour later
  const res2 = await registry.upsert({
    sub: "google-reg-1",
    email: "user1-renamed@example.com",
    name: "User One Updated",
    device: "mobile-iphone",
    now: t1,
  });

  assert.equal(res2.isNew, false);
  assert.equal(res2.user.loginCount, 2);
  assert.deepEqual(res2.user.devices, ["desktop-mac", "mobile-iphone"]);
  assert.equal(res2.user.firstSeen, new Date(t0).toISOString());
  assert.equal(res2.user.lastSeen, new Date(t1).toISOString());
  assert.equal(res2.user.name, "User One Updated");
  // Picture preserved if not provided
  assert.equal(res2.user.picture, "https://example.com/pic1.jpg");

  // 3. Duplicate device does not duplicate in list
  const res3 = await registry.upsert({
    sub: "google-reg-1",
    email: "user1-renamed@example.com",
    name: "User One Updated",
    device: "desktop-mac",
    now: t1 + 1000,
  });
  assert.equal(res3.user.loginCount, 3);
  assert.deepEqual(res3.user.devices, ["desktop-mac", "mobile-iphone"]);
});

test("UserRegistryCore ping updates lastSeen", async () => {
  const storage = new UserRegistryMemoryStorage();
  const registry = new UserRegistryCore(storage);

  const t0 = 1_700_000_000_000;
  await registry.upsert({
    sub: "google-ping-user",
    email: "ping@example.com",
    name: "Pinger",
    now: t0,
  });

  const t1 = t0 + 60_000;
  const ok = await registry.ping("google-ping-user", t1);
  assert.equal(ok, true);

  const users = await registry.listUsers();
  assert.equal(users.length, 1);
  assert.equal(users[0]!.lastSeen, new Date(t1).toISOString());

  // Non-existent user ping returns false
  assert.equal(await registry.ping("unknown-user", t1), false);
});

test("UserRegistryCore block and unblock controls", async () => {
  const storage = new UserRegistryMemoryStorage();
  const registry = new UserRegistryCore(storage);

  await registry.upsert({
    sub: "block-test-user",
    email: "block@example.com",
    name: "Blocked User",
  });

  assert.equal(await registry.isBlocked("block-test-user"), false);

  await registry.setBlocked("block-test-user", true);
  assert.equal(await registry.isBlocked("block-test-user"), true);

  await registry.setBlocked("block-test-user", false);
  assert.equal(await registry.isBlocked("block-test-user"), false);
});

test("UserRegistryCore getStats computes now, today, sevenDays, and total", async () => {
  const storage = new UserRegistryMemoryStorage();
  const registry = new UserRegistryCore(storage);

  const baseTime = 1_700_000_000_000; // Arbitrary epoch ms

  // User A: seen 2 minutes ago -> now, today, 7d, total
  await registry.upsert({
    sub: "user-a",
    email: "a@example.com",
    name: "User A",
    now: baseTime - 2 * 60 * 1000,
  });

  // User B: seen 20 minutes ago -> today, 7d, total
  await registry.upsert({
    sub: "user-b",
    email: "b@example.com",
    name: "User B",
    now: baseTime - 20 * 60 * 1000,
  });

  // User C: seen 3 days ago -> 7d, total
  await registry.upsert({
    sub: "user-c",
    email: "c@example.com",
    name: "User C",
    now: baseTime - 3 * 24 * 60 * 60 * 1000,
  });

  // User D: seen 14 days ago -> total only
  await registry.upsert({
    sub: "user-d",
    email: "d@example.com",
    name: "User D",
    now: baseTime - 14 * 24 * 60 * 60 * 1000,
  });

  const stats = await registry.getStats(baseTime);
  assert.equal(stats.total, 4);
  assert.equal(stats.now, 1); // Only User A
  assert.equal(stats.sevenDays, 3); // User A, B, C
});

test("UserRegistryCore revokeAll clears tokens in UserStore", async () => {
  resetInMemoryUserStores();
  resetInMemoryUserRegistry();

  const registry = getInMemoryUserRegistry();
  const userStore = getInMemoryUserStore("sub-to-revoke");
  await userStore.saveProfile({ sub: "sub-to-revoke", email: "rev@example.com" });

  const { token } = await userStore.mintToken("device-1");
  const secret = token.split(".")[1]!;

  assert.equal(await userStore.verifyToken(secret), true);

  // Revoke via UserRegistry
  const revoked = await registry.revokeAll("sub-to-revoke");
  assert.equal(revoked, true);

  // Token is now rejected
  assert.equal(await userStore.verifyToken(secret), false);
  const tokens = await userStore.listTokens();
  assert.equal(tokens.length, 0);
});

test("API routes enforce blocked status and handle admin actions", async () => {
  resetInMemoryUserStores();
  resetInMemoryUserRegistry();

  const mockVerifier: GoogleIdTokenVerifier = {
    async verify(idToken: string) {
      if (idToken === "token-allowed") {
        return {
          sub: "sub-allowed",
          email: "allowed@example.com",
          name: "Allowed User",
        };
      }
      if (idToken === "token-blocked") {
        return {
          sub: "sub-blocked",
          email: "blocked@example.com",
          name: "Blocked User",
        };
      }
      return null;
    },
  };
  setCustomGoogleVerifier(mockVerifier);

  try {
    const registry = getInMemoryUserRegistry();

    // 1. Successful login registers user in registry
    const loginReq = new Request("http://localhost/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: "token-allowed", deviceHint: "test-device" }),
    });
    const loginRes = await googleAuthHandler(loginReq);
    assert.equal(loginRes.status, 200);
    const loginData = (await loginRes.json()) as { ok: boolean; token: string };

    const users = await registry.listUsers();
    assert.equal(users.length, 1);
    assert.equal(users[0]!.sub, "sub-allowed");

    // 2. /api/user/ping works with valid session
    const pingReq = new Request("http://localhost/api/user/ping", {
      method: "POST",
      headers: { Authorization: `Bearer ${loginData.token}` },
    });
    const pingRes = await pingHandler(pingReq);
    assert.equal(pingRes.status, 200);

    // 3. Block user
    await registry.setBlocked("sub-allowed", true);

    // 4. /api/user/me returns 403 when blocked
    const meReq = new Request("http://localhost/api/user/me", {
      headers: { Authorization: `Bearer ${loginData.token}` },
    });
    const meRes = await meHandler(meReq);
    assert.equal(meRes.status, 403);

    // 5. /api/user/ping returns 403 when blocked
    const pingBlockedRes = await pingHandler(pingReq);
    assert.equal(pingBlockedRes.status, 403);

    // 6. /api/auth/google returns 403 when blocked
    const loginBlockedReq = new Request("http://localhost/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: "token-allowed" }),
    });
    const loginBlockedRes = await googleAuthHandler(loginBlockedReq);
    assert.equal(loginBlockedRes.status, 403);

    // 7. Admin API /api/admin/users
    // Unauthenticated -> 401
    const unauthReq = new Request("http://localhost/api/admin/users");
    const unauthRes = await adminUsersGetHandler(unauthReq);
    assert.equal(unauthRes.status, 401);

    // Admin authenticated GET
    const adminToken = await createAdminSessionToken("admin-sub");
    const adminGetReq = new Request("http://localhost/api/admin/users", {
      headers: {
        Cookie: `${ADMIN_SESSION_COOKIE}=${adminToken}`,
      },
    });
    const adminGetRes = await adminUsersGetHandler(adminGetReq);
    assert.equal(adminGetRes.status, 200);
    const adminGetData = (await adminGetRes.json()) as { ok: boolean; stats: { total: number }; users: unknown[] };
    assert.equal(adminGetData.ok, true);
    assert.equal(adminGetData.stats.total, 1);

    // Test unblock via admin POST
    const unblockReq = new Request("http://localhost/api/admin/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${ADMIN_SESSION_COOKIE}=${adminToken}`,
      },
      body: JSON.stringify({ action: "unblock", sub: "sub-allowed" }),
    });
    const unblockRes = await adminUsersPostHandler(unblockReq);
    assert.equal(unblockRes.status, 200);
    assert.equal(await registry.isBlocked("sub-allowed"), false);

    // Test revokeAll via admin POST
    const revokeReq = new Request("http://localhost/api/admin/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${ADMIN_SESSION_COOKIE}=${adminToken}`,
      },
      body: JSON.stringify({ action: "revokeAll", sub: "sub-allowed" }),
    });
    const revokeRes = await adminUsersPostHandler(revokeReq);
    assert.equal(revokeRes.status, 200);

    // Session is now dead -> 401 on /api/user/me
    const meAfterRevoke = await meHandler(meReq);
    assert.equal(meAfterRevoke.status, 401);
  } finally {
    setCustomGoogleVerifier(null);
  }
});
