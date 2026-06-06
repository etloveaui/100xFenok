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
const footerPath = path.join(appRoot, "src/components/Footer.tsx");

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

assertAdminAuthChangeEvents();
assertFooterDoesNotAutoRefreshAdminSession();

console.log("admin auth guards passed");
