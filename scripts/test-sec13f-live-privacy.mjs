#!/usr/bin/env node

// Live privacy smoke: the intentionally private investor payload must not be
// reachable from the public Worker. This is separate from the local
// materialization contract because a stale deployed bundle can survive a
// correct checkout.

import assert from "node:assert/strict";

const DEFAULT_BASE_URL = "https://100xfenok.etloveaui.workers.dev";

function parseBaseUrl(argv) {
  const index = argv.indexOf("--base-url");
  const value = index >= 0 ? argv[index + 1] : DEFAULT_BASE_URL;
  if (!value || value.startsWith("-")) throw new Error("--base-url requires a URL");
  const url = new URL(value);
  if (!/^https?:$/u.test(url.protocol)) throw new Error("--base-url must use HTTP(S)");
  return url.toString().replace(/\/$/u, "");
}

const baseUrl = parseBaseUrl(process.argv.slice(2));
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 15_000);
let response;
try {
  response = await fetch(`${baseUrl}/data/sec-13f/investors/griffin.json?privacy_smoke=1`, {
    cache: "no-store",
    headers: {
      "cache-control": "no-cache, no-store",
      pragma: "no-cache",
    },
    signal: controller.signal,
  });
} finally {
  clearTimeout(timeout);
}

assert.equal(
  response.status,
  404,
  `private SEC 13F investor route must return 404, got ${response.status}`,
);
console.log(`sec13f live privacy: ok (griffin route HTTP ${response.status})`);
