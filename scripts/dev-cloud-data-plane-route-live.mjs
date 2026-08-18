#!/usr/bin/env node
// Live check of the deployed data-plane door.
//
// Read-only against the coordinator: it asks for the pointer and nothing else,
// so running it can never change publication state. What it proves is that the
// door on the live Worker refuses and admits exactly as the local proof said it
// would — the local suite runs against Miniflare, and Miniflare is not
// production.
//
// Usage:
//   DATA_PLANE_WRITE_KEY=... node scripts/dev-cloud-data-plane-route-live.mjs
//   [--endpoint https://.../internal/cloud-data-plane] [--family <name>]

const DEFAULT_ENDPOINT = "https://100xfenok.etloveaui.workers.dev/internal/cloud-data-plane";

function flag(name, fallback) {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

const endpoint = flag("endpoint", process.env.DATA_PLANE_ENDPOINT ?? DEFAULT_ENDPOINT);
// Optional, and absent by default on purpose: without it every request stays
// byte-identical to the legacy shape and reads the route's default instance.
// With it, the route selects that family's Durable Object, which has its own
// pointer, ledger and sequence.
const family = flag("family", null);
const key = process.env.DATA_PLANE_WRITE_KEY;

if (!key) {
  console.error("dev-cloud-data-plane-route-live: DATA_PLANE_WRITE_KEY is not set");
  process.exit(2);
}

async function call(action, { method = "POST", headerKey = key, body = "{}" } = {}) {
  const headers = { "content-type": "application/json" };
  if (headerKey !== null) headers["x-data-plane-key"] = headerKey;
  if (family) headers["x-data-plane-family"] = family;
  const response = await fetch(`${endpoint}/${action}`, {
    method,
    headers,
    body: method === "POST" ? body : undefined,
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { status: response.status, code: payload?.error?.code ?? null, payload };
}

const checks = [
  { name: "unauthenticated is refused", run: () => call("pointer/get", { headerKey: null }), expect: 401 },
  { name: "wrong key is refused", run: () => call("pointer/get", { headerKey: "z".repeat(64) }), expect: 401 },
  { name: "GET is refused", run: () => call("pointer/get", { method: "GET" }), expect: 405 },
  { name: "unknown action is refused", run: () => call("pointer/wipe"), expect: 404 },
  { name: "authenticated pointer read", run: () => call("pointer/get"), expect: 200 },
];

let failures = 0;
for (const check of checks) {
  const result = await check.run();
  const ok = result.status === check.expect;
  if (!ok) failures += 1;
  const detail = result.code ? ` code=${result.code}` : "";
  console.log(`${ok ? "ok  " : "FAIL"} ${check.name}: HTTP ${result.status} (expected ${check.expect})${detail}`);
  if (ok && check.expect === 200) {
    const pointer = result.payload?.result ?? null;
    console.log(`     instance: ${family ?? "default (no family header)"}`);
    console.log(`     pointer: ${pointer
      ? `sequence ${pointer.sequence}, active ${pointer.active?.generation_id}, previous ${pointer.previous?.generation_id ?? "none"}`
      : "none yet"}`);
  }
}

// A 503 here is not a passing state, but it is a diagnosable one: the route is
// deployed and the Worker secret is missing. Say which it is rather than
// leaving a bare failure count.
if (failures > 0) {
  const probe = await call("pointer/get");
  if (probe.code === "DATA_PLANE_KEY_UNCONFIGURED") {
    console.error("dev-cloud-data-plane-route-live: route is live but DATA_PLANE_WRITE_KEY is not set on the Worker");
  }
}

console.log(`dev-cloud-data-plane-route-live: ${failures === 0 ? "ok" : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
