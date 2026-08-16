#!/usr/bin/env node
// Live R2 round trip for the cloud-data-plane pilot.
//
// Runs the REAL publishGeneration + resolvePublicAsset from the byte-locked
// contract lib against the real R2 bucket `fenok-data-plane`. Only the object
// port is live: objectStore is a thin bridge that implements the Workers R2
// binding shape (get/put) by spawning the wrangler CLI; ledger and
// pointerStore stay on the LOCAL Miniflare-emulated coordinator Durable
// Object (fresh state per run, nothing remote).
//
// Safety: writes only immutable content-addressed keys (`objects/sha256/*`,
// `manifests/<generation-id>.json`); never deletes anything; refuses to run
// without CLOUDFLARE_API_TOKEN.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import {
  GENERATION_MANIFEST_SCHEMA,
  publishGeneration,
  resolvePublicAsset,
  sha256Bytes,
} from "./lib/cloud-data-plane-generation.mjs";
import { createCloudflareCloudDataPlane } from "./lib/cloud-data-plane-cloudflare-adapter.mjs";

const BUCKET = "fenok-data-plane";
const WRANGLER_CWD = new URL("../100xfenok-next", import.meta.url).pathname;

if (!process.env.CLOUDFLARE_API_TOKEN) {
  console.error("dev-cloud-data-plane-r2-live: CLOUDFLARE_API_TOKEN is not set — refusing a live run");
  process.exit(2);
}

// --- live R2 bridge (Workers R2 binding shape over the wrangler CLI) --------

const opCounts = { put: 0, get: 0, getMissing: 0 };

function runWrangler(args, stdinBytes) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["wrangler", ...args], {
      cwd: WRANGLER_CWD,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({
      code,
      stdout: Buffer.concat(stdoutChunks),
      stderr: Buffer.concat(stderrChunks).toString("utf8"),
    }));
    if (stdinBytes) child.stdin.write(stdinBytes);
    child.stdin.end();
  });
}

const r2Bridge = {
  async get(key) {
    opCounts.get += 1;
    // --remote is mandatory: without it wrangler serves the local Miniflare
    // store under .wrangler/state, not the real bucket.
    const result = await runWrangler(["r2", "object", "get", `${BUCKET}/${key}`, "--pipe", "--remote"]);
    if (result.code !== 0) {
      // Verified behavior (wrangler 4.92): a missing key exits 1 with
      // "The specified key does not exist." on stderr.
      opCounts.getMissing += 1;
      return null;
    }
    const bytes = new Uint8Array(result.stdout);
    return {
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    };
  },
  async put(key, bytes) {
    opCounts.put += 1;
    const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const result = await runWrangler(["r2", "object", "put", `${BUCKET}/${key}`, "--pipe", "--remote"], body);
    if (result.code !== 0) {
      throw new Error(`wrangler r2 object put failed (${result.code}): ${result.stderr.trim()}`);
    }
  },
};

// --- local coordinator Durable Object via Miniflare (ledger + pointer only) -

const require = createRequire(new URL("../100xfenok-next/package.json", import.meta.url));
const { Miniflare } = require("miniflare");

const moduleSource = async (name) => readFile(new URL(`./lib/${name}`, import.meta.url), "utf8");
// generation/json-canonical moved inside the app package boundary; the
// coordinator stays root-side. The flat mount keeps "./"-imports intact, so
// each file loads from its own home.
const canonicalModuleSource = async (name) => readFile(new URL(`../100xfenok-next/scripts/cloud-data-plane/${name}`, import.meta.url), "utf8");
const ENTRY_SOURCE = [
  'export { CloudDataPlaneCoordinator } from "./cloud-data-plane-coordinator.mjs";',
  'export default { fetch() { return new Response("cloud-data-plane pilot entry"); } };',
  "",
].join("\n");

const miniflare = new Miniflare({
  compatibilityDate: "2026-05-16",
  compatibilityFlags: ["nodejs_compat"],
  modules: [
    { type: "ESModule", path: "entry.mjs", contents: ENTRY_SOURCE },
    {
      type: "ESModule",
      path: "cloud-data-plane-coordinator.mjs",
      contents: await moduleSource("cloud-data-plane-coordinator.mjs"),
    },
    {
      type: "ESModule",
      path: "cloud-data-plane-generation.mjs",
      contents: await canonicalModuleSource("cloud-data-plane-generation.mjs"),
    },
    {
      type: "ESModule",
      path: "json-canonical.mjs",
      contents: await canonicalModuleSource("json-canonical.mjs"),
    },
  ],
  durableObjects: { CLOUD_COORDINATOR: "CloudDataPlaneCoordinator" },
});

const coordinatorNamespace = await miniflare.getDurableObjectNamespace("CLOUD_COORDINATOR");
const plane = createCloudflareCloudDataPlane({
  r2Bucket: r2Bridge,
  coordinatorNamespace,
});

// --- pilot generation --------------------------------------------------------

const encoder = new TextEncoder();
const NOW = new Date().toISOString();
const values = {
  "public/data/pilot/alpha.json": "{\"pilot\":\"r2-live\",\"asset\":\"alpha\"}\n",
  "public/data/pilot/beta.json": "{\"pilot\":\"r2-live\",\"asset\":\"beta\"}\n",
  "public/data/pilot/gamma.json": "{\"pilot\":\"r2-live\",\"asset\":\"gamma\"}\n",
};

const manifest = {
  schema_version: GENERATION_MANIFEST_SCHEMA,
  generation_id: "r2-live-pilot-1",
  source_sha: sha256Bytes(encoder.encode(JSON.stringify(values))),
  created_at: NOW,
  assets: Object.entries(values)
    .map(([path, text]) => {
      const bytes = encoder.encode(text);
      const sha256 = sha256Bytes(bytes);
      return {
        path,
        object_key: `objects/sha256/${sha256}`,
        sha256,
        bytes: bytes.byteLength,
        content_type: "application/json",
        source_as_of: NOW.slice(0, 10),
        privacy_class: "public",
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path)),
};

const payloads = new Map(Object.entries(values).map(([path, text]) => [path, encoder.encode(text)]));

const POLICY = {
  max_assets: 10,
  max_total_bytes: 10_000,
  validate_freshness: () => true,
  validate_public_payload({ bytes }) {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    return !Object.keys(value).some((key) => /token|secret|password|cookie/i.test(key));
  },
};

try {
  const published = await publishGeneration({
    manifest,
    payloads,
    expectedPointerSequence: 0,
    objectStore: plane.objectStore,
    ledger: plane.ledger,
    pointerStore: plane.pointerStore,
    policy: POLICY,
  });
  assert.equal(published.pointer.sequence, 1);
  assert.equal(published.receipt.state, "promoted");
  console.log(`publishGeneration: promoted generation ${published.summary.generation_id}`
    + ` (pointer sequence ${published.pointer.sequence}, receipt ${published.receipt.receipt_id})`);

  const keysWritten = [
    ...manifest.assets.map((asset) => asset.object_key),
    `manifests/${manifest.generation_id}.json`,
  ];

  let parityChecks = 0;
  for (const asset of manifest.assets) {
    const result = await resolvePublicAsset({
      publicPath: asset.path,
      pointerStore: plane.pointerStore,
      objectStore: plane.objectStore,
    });
    assert.equal(result.kind, "ok", `resolve ${asset.path}`);
    assert.deepEqual(result.bytes, encoder.encode(values[asset.path]), `byte parity ${asset.path}`);
    assert.equal(result.generation_id, manifest.generation_id);
    parityChecks += 1;
    console.log(`byte parity ok: ${asset.path} (${asset.bytes} bytes) <- ${asset.object_key}`);
  }

  console.log(`R2 keys written to ${BUCKET} (${keysWritten.length} objects, left in place, immutable):`);
  for (const key of keysWritten) console.log(`  ${key}`);
  console.log(`wrangler bridge ops: ${opCounts.put} put, ${opCounts.get} get (${opCounts.getMissing} misses)`);
  console.log(`resolvePublicAsset byte-identity assertions passed: ${parityChecks}/${manifest.assets.length}`);
  console.log("dev-cloud-data-plane-r2-live: ok");
} finally {
  await miniflare.dispose();
}
