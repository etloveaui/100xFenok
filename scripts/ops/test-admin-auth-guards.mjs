import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const appRoot = path.join(root, "100xfenok-next");
const requireFromApp = createRequire(path.join(appRoot, "package.json"));
const ts = requireFromApp("typescript");
const adminAuthPath = path.join(appRoot, "src/lib/client/admin-auth.ts");
const adminLoginThrottlePath = path.join(appRoot, "src/lib/server/admin-login-throttle.ts");
const adminSessionPath = path.join(appRoot, "src/lib/server/admin-session.ts");
const adminSessionRoutePath = path.join(appRoot, "src/app/api/admin/session/route.ts");
const footerPath = path.join(appRoot, "src/components/Footer.tsx");
const middlewarePath = path.join(appRoot, "middleware.ts");
const liveBenchPagePath = path.join(appRoot, "src/app/live-bench/page.tsx");
const adminAuthWorkflowPath = path.join(root, ".github/workflows/admin-auth-guards.yml");
const adminStaticAuthGuardPath = path.join(appRoot, "scripts/test-admin-static-auth-guard.mjs");

class TestCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

function createSessionStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
  };
}

function loadAdminAuthModule() {
  const source = fs.readFileSync(adminAuthPath, "utf8");
  const compiled = `${ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText}
module.exports.__testSetCachedAdminAuthenticated = setCachedAdminAuthenticated;
`;

  const events = [];
  const sandbox = {
    CustomEvent: TestCustomEvent,
    exports: {},
    module: { exports: {} },
    window: {
      dispatchEvent(event) {
        events.push(event);
      },
      sessionStorage: createSessionStorage(),
    },
  };
  sandbox.exports = sandbox.module.exports;

  vm.runInNewContext(compiled, sandbox, {
    filename: adminAuthPath,
  });

  return {
    events,
    module: sandbox.module.exports,
    storage: sandbox.window.sessionStorage,
  };
}

function loadServerTsModule(sourcePath, env = {}) {
  const source = fs.readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  const sandbox = {
    atob(value) {
      return Buffer.from(value, "base64").toString("binary");
    },
    btoa(value) {
      return Buffer.from(value, "binary").toString("base64");
    },
    exports: {},
    module: { exports: {} },
    process: { env },
    TextDecoder,
    TextEncoder,
  };
  sandbox.exports = sandbox.module.exports;

  vm.runInNewContext(compiled, sandbox, {
    filename: sourcePath,
  });
  return sandbox.module.exports;
}

function assertAdminAuthChangeEvents() {
  const { events, module, storage } = loadAdminAuthModule();
  assert.equal(typeof module.__testSetCachedAdminAuthenticated, "function");

  storage.clear();
  module.__testSetCachedAdminAuthenticated(true);
  assert.equal(events.length, 1, "false -> true should dispatch once");
  assert.equal(events[0].detail.authenticated, true);

  module.__testSetCachedAdminAuthenticated(true);
  assert.equal(events.length, 1, "true -> true should not dispatch");

  module.__testSetCachedAdminAuthenticated(false);
  assert.equal(events.length, 2, "true -> false should dispatch once");
  assert.equal(events[1].detail.authenticated, false);
}

function assertAdminVerifyLockout() {
  const { events, module, storage } = loadAdminAuthModule();
  const now = 1_000_000;

  storage.clear();
  assert.equal(module.getAdminVerifyFailCount(), 0);
  assert.equal(module.getAdminVerifyLockRemainingMs(now), 0);

  const firstFailure = module.registerAdminVerifyFailure(now);
  assert.equal(firstFailure.locked, false);
  assert.equal(firstFailure.remainingMs, 0);
  assert.equal(firstFailure.failCount, 1);

  const secondFailure = module.registerAdminVerifyFailure(now + 1);
  assert.equal(secondFailure.locked, false);
  assert.equal(secondFailure.remainingMs, 0);
  assert.equal(secondFailure.failCount, 2);

  const locked = module.registerAdminVerifyFailure(now + 2);
  assert.equal(locked.locked, true, "third failed admin verify should lock the client");
  assert.equal(locked.remainingMs, module.ADMIN_VERIFY_LOCK_MS);
  assert.equal(locked.failCount, module.ADMIN_MAX_FAILURES);
  assert.equal(module.getAdminVerifyFailCount(), module.ADMIN_MAX_FAILURES);
  assert.equal(module.getAdminVerifyLockRemainingMs(now + 1002), 2000);

  const lockedAgain = module.registerAdminVerifyFailure(now + 1003);
  assert.equal(lockedAgain.locked, true);
  assert(lockedAgain.remainingMs > 0);

  assert.equal(module.getAdminVerifyLockRemainingMs(now + module.ADMIN_VERIFY_LOCK_MS + 3), 0);
  assert.equal(module.getAdminVerifyFailCount(), 0, "expired lock should reset the fail count");
  assert(
    events.some((event) => event.type === module.ADMIN_VERIFY_STATE_EVENT),
    "client lockout must dispatch verify-state events",
  );
}

function extractCallTexts(source, callee) {
  const calls = [];
  let cursor = 0;

  while (cursor < source.length) {
    const index = source.indexOf(callee, cursor);
    if (index === -1) break;

    const before = source[index - 1];
    const after = source[index + callee.length];
    const isIdentifierChar = (char) => /[A-Za-z0-9_$]/.test(char || "");
    if (isIdentifierChar(before) || isIdentifierChar(after)) {
      cursor = index + callee.length;
      continue;
    }

    let open = index + callee.length;
    while (/\s/.test(source[open] || "")) open += 1;
    if (source[open] !== "(") {
      cursor = index + callee.length;
      continue;
    }

    let depth = 0;
    let quote = null;
    let lineComment = false;
    let blockComment = false;

    for (let i = open; i < source.length; i += 1) {
      const char = source[i];
      const next = source[i + 1];

      if (lineComment) {
        if (char === "\n") lineComment = false;
        continue;
      }
      if (blockComment) {
        if (char === "*" && next === "/") {
          blockComment = false;
          i += 1;
        }
        continue;
      }
      if (quote) {
        if (char === "\\") {
          i += 1;
          continue;
        }
        if (char === quote) quote = null;
        continue;
      }

      if (char === "/" && next === "/") {
        lineComment = true;
        i += 1;
        continue;
      }
      if (char === "/" && next === "*") {
        blockComment = true;
        i += 1;
        continue;
      }
      if (char === "\"" || char === "'" || char === "`") {
        quote = char;
        continue;
      }
      if (char === "(") depth += 1;
      if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          calls.push(source.slice(index, i + 1));
          cursor = i + 1;
          break;
        }
      }
    }

    if (cursor <= index) cursor = index + callee.length;
  }

  return calls;
}

function assertFooterDoesNotAutoRefreshAdminSession() {
  const footer = fs.readFileSync(footerPath, "utf8");

  assert(
    !footer.includes("ADMIN_AUTH_CHANGE_EVENT") && !footer.includes("fenok:admin-auth-change"),
    "Footer must not subscribe to admin auth change events",
  );

  const effectCalls = extractCallTexts(footer, "useEffect");
  const refreshingEffects = effectCalls.filter((call) => call.includes("refreshAdminAuthenticated"));
  assert.equal(
    refreshingEffects.length,
    0,
    "Footer useEffect must not call refreshAdminAuthenticated on mount/update",
  );
}

function assertAdminLiveIsNotPublicRewrite() {
  const middleware = fs.readFileSync(middlewarePath, "utf8");
  const liveBenchPage = fs.readFileSync(liveBenchPagePath, "utf8");

  assert(
    !middleware.includes('pathname = "/live-bench/"'),
    "/admin/live must not rewrite to /live-bench and bypass admin layout auth",
  );
  assert(
    !middleware.includes("isPublicLiveBenchPath"),
    "/admin/live must be treated as a normal admin path",
  );
  assert(
    liveBenchPage.includes('redirect("/admin/live")'),
    "/live-bench must redirect into the authenticated /admin/live route",
  );
  assert(
    !liveBenchPage.includes("AdminLiveBench"),
    "/live-bench must not mount the admin voice bench directly",
  );
}

function assertProductionDefaultAdminAuthIsDisabled() {
  const source = fs.readFileSync(adminSessionPath, "utf8");
  const staticGuard = fs.readFileSync(adminStaticAuthGuardPath, "utf8");
  assert(
    source.includes("export function isDefaultAdminAuthAllowed"),
    "admin-session must expose the default-auth environment guard for test coverage",
  );
  assert(
    !source.includes('NEXT_ADMIN_ALLOW_DEFAULTS === "1"'),
    "production must not be able to re-enable default admin credentials via NEXT_ADMIN_ALLOW_DEFAULTS",
  );
  assert(
    !staticGuard.includes("NEXT_ADMIN_ALLOW_DEFAULTS"),
    "admin static auth guard must use explicit production auth env, not default fallback opt-in",
  );

  const productionModule = loadServerTsModule(adminSessionPath, {
    NODE_ENV: "production",
    NEXT_ADMIN_ALLOW_DEFAULTS: "1",
  });
  assert.equal(
    productionModule.isDefaultAdminAuthAllowed(),
    false,
    "production default admin auth must stay disabled even when NEXT_ADMIN_ALLOW_DEFAULTS=1",
  );
  assert.equal(
    productionModule.isAdminAuthConfigured(),
    false,
    "production must require explicit admin password hash and session secret",
  );

  const developmentModule = loadServerTsModule(adminSessionPath, {
    NODE_ENV: "development",
  });
  assert.equal(developmentModule.isDefaultAdminAuthAllowed(), true);
  assert.equal(developmentModule.isAdminAuthConfigured(), true);
}

function assertAdminLoginThrottle() {
  const throttle = loadServerTsModule(adminLoginThrottlePath, { NODE_ENV: "test" });
  const clientKey = `admin-auth-guard-${Date.now()}`;
  const startedAt = 1_000_000;

  assert.equal(throttle.checkAdminLoginThrottle(clientKey, startedAt).limited, false);
  for (let failure = 0; failure < 4; failure += 1) {
    assert.equal(
      throttle.registerAdminLoginFailure(clientKey, startedAt + failure).limited,
      false,
      "first four failed logins should not lock the admin session endpoint",
    );
  }

  const locked = throttle.registerAdminLoginFailure(clientKey, startedAt + 4);
  assert.equal(locked.limited, true, "fifth failed login should lock the admin session endpoint");
  assert(locked.retryAfterMs > 0, "locked state must expose a positive retry window");
  assert.equal(
    throttle.adminLoginRetryAfterSeconds(locked.retryAfterMs),
    Math.ceil(locked.retryAfterMs / 1000),
  );
  assert.equal(throttle.checkAdminLoginThrottle(clientKey, startedAt + 5).limited, true);

  throttle.clearAdminLoginFailures(clientKey);
  assert.equal(throttle.checkAdminLoginThrottle(clientKey, startedAt + 6).limited, false);

  const request = new Request("https://example.test/admin", {
    headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.1" },
  });
  assert.equal(throttle.getAdminLoginClientKey(request), "203.0.113.10");
}

function assertAdminSessionRouteUsesServerThrottle() {
  const route = fs.readFileSync(adminSessionRoutePath, "utf8");

  assert(route.includes("checkAdminLoginThrottle"), "admin session POST must check server throttle");
  assert(route.includes("registerAdminLoginFailure"), "admin session POST must register failed logins");
  assert(route.includes("clearAdminLoginFailures"), "admin session POST must clear failures on success");
  assert(route.includes("TOO_MANY_ATTEMPTS"), "admin session POST must return a 429 error code");
  assert(route.includes('"Retry-After"'), "admin session POST must send a Retry-After header");

  assert(
    route.indexOf("checkAdminLoginThrottle") < route.indexOf("request.json()"),
    "admin session POST must check throttle before parsing credentials",
  );
  assert(
    route.indexOf("registerAdminLoginFailure") < route.indexOf("INVALID_PASSWORD"),
    "admin session POST must register a failed password before returning 401",
  );
}

function assertAdminAuthWorkflowTracksServerFiles() {
  const workflow = fs.readFileSync(adminAuthWorkflowPath, "utf8");
  for (const requiredPath of [
    "100xfenok-next/src/app/api/admin/session/route.ts",
    "100xfenok-next/src/components/AdminAccessGate.tsx",
    "100xfenok-next/src/components/footer/AdminAuthModal.tsx",
    "100xfenok-next/scripts/test-admin-static-auth-guard.mjs",
    "100xfenok-next/src/lib/server/admin-login-throttle.ts",
    "100xfenok-next/src/lib/server/admin-session.ts",
  ]) {
    assert(
      workflow.includes(requiredPath),
      `admin auth guard workflow must run when ${requiredPath} changes`,
    );
  }
}

assertAdminAuthChangeEvents();
assertAdminVerifyLockout();
assertFooterDoesNotAutoRefreshAdminSession();
assertAdminLiveIsNotPublicRewrite();
assertProductionDefaultAdminAuthIsDisabled();
assertAdminLoginThrottle();
assertAdminSessionRouteUsesServerThrottle();
assertAdminAuthWorkflowTracksServerFiles();

console.log("admin auth guards passed");
