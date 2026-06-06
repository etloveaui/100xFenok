#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const WORKER_SURFACE_PATHS = [
  "src",
  "next.config.ts",
  "open-next.config.ts",
  "wrangler.jsonc",
  "package.json",
];

const FORBIDDEN_PROVIDER_ENV_NAMES = [
  "TAVILY_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "NAVER_CLIENT_ID",
  "NAVER_CLIENT_SECRET",
  "NCP_CLIENT_ID",
  "NCP_CLIENT_SECRET",
  "KAKAO_REST_API_KEY",
];

const ALLOWED_WORKER_BRIDGE_ENV_NAMES = [
  "FENO_SKILL_BRIDGE_URL",
  "FENO_SKILL_BRIDGE_TOKEN",
];

function listFiles(pathname) {
  const stat = statSync(pathname, { throwIfNoEntry: false });
  if (!stat) return [];
  if (stat.isFile()) return [pathname];
  if (!stat.isDirectory()) return [];

  return readdirSync(pathname)
    .filter((name) => !name.startsWith("."))
    .flatMap((name) => listFiles(join(pathname, name)));
}

const files = WORKER_SURFACE_PATHS.flatMap(listFiles);
const leaks = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const name of FORBIDDEN_PROVIDER_ENV_NAMES) {
    if (text.includes(name)) {
      leaks.push({ file, name });
    }
  }
}

assert.deepEqual(leaks, [], "Provider API key env names must not appear in Worker-side app/config files.");

const bridgeClient = readFileSync("src/lib/server/admin-live-skill-bridge.ts", "utf8");
for (const name of ALLOWED_WORKER_BRIDGE_ENV_NAMES) {
  assert(
    bridgeClient.includes(name),
    `Worker bridge client must be configured only through ${ALLOWED_WORKER_BRIDGE_ENV_NAMES.join(" + ")}.`,
  );
}

console.log("admin-live-provider-boundary smoke PASS");
