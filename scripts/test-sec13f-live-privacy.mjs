#!/usr/bin/env node

// Live serving-scope smoke: investor payloads excluded from the app mirror must
// return 404 from the Worker. These tracked files remain public on GitHub; this
// check establishes serving scope, not confidentiality. It is separate from the local
// materialization contract because a stale deployed bundle can survive a
// correct checkout.

import assert from "node:assert/strict";
import { derivedPrivateFileOutputs } from "./lib/derived-asset-registry.mjs";
import { liveRequestHeaders } from "./lib/live-request-headers.mjs";

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
const privatePaths = [
  ["griffin investor", "/data/sec-13f/investors/griffin.json"],
  ...derivedPrivateFileOutputs().map((relativePath) => [
    `serving-excluded derived ${relativePath}`,
    `/${relativePath}`,
  ]),
].filter((entry, index, entries) => entries.findIndex((candidate) => candidate[1] === entry[1]) === index);
for (const [label, privatePath] of privatePaths) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const cacheBust = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let response;
  try {
    response = await fetch(`${baseUrl}${privatePath}?privacy_smoke=1&cb=${cacheBust}`, {
      cache: "no-store",
      headers: {
        "cache-control": "no-cache, no-store",
        pragma: "no-cache",
        ...liveRequestHeaders(),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  assert.equal(
    response.status,
    404,
    `serving-excluded ${label} route must return 404, got ${response.status}`,
  );
  console.log(`sec13f live serving scope: ok (${label} HTTP ${response.status})`);
}
