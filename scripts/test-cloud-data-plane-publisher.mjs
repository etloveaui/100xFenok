#!/usr/bin/env node
// Offline test for the node-side cloud data plane publisher. No Cloudflare
// network: the plane is createMemoryCloudDataPlane() from the byte-locked
// contract, the coordinator endpoint is a local node:http stub implementing
// the Durable Object wire contract, and the cost gate is exercised through
// the real CLI with CLOUDFLARE_API_TOKEN scrubbed (the gate then fails closed
// by design, which is exactly the gate-blocked path under test).

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { statSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createMemoryCloudDataPlane,
  publishGeneration,
  resolvePublicAsset,
  sha256Canonical,
  validateGenerationManifest,
} from "./lib/cloud-data-plane-generation.mjs";
import { createCloudflareCloudDataPlane } from "./lib/cloud-data-plane-cloudflare-adapter.mjs";
import { createR2RestBucket } from "./lib/cloud-data-plane-r2-rest.mjs";
import { createRemoteCoordinatorNamespace } from "./lib/cloud-data-plane-remote-coordinator.mjs";
import {
  assertPublishReceiptId,
  buildFamilyManifest,
  chaosExpectedPointerSequence,
  chaosPointerStore,
  classifyResultLine,
  collectFamiliesRetentionState,
  computeRetentionPlan,
  deleteR2Object,
  deterministicPublishReceiptId,
  executeRetentionPlan,
  FAMILIES,
  listR2ObjectsDetailed,
  resolveExpectedPointerSequence,
  RETENTION_PROTECTED_KEYS,
  rollbackLiveGeneration,
  verifyGenerationParity,
} from "./publish-cloud-data-generation.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PUBLISH_SCRIPT = path.join(REPO_ROOT, "scripts", "publish-cloud-data-generation.mjs");
const NOW_1 = "2026-08-03T00:00:00.000Z";
const NOW_2 = "2026-08-03T01:00:00.000Z";
const NOW_3 = "2026-08-03T02:00:00.000Z";
const NOW_4 = "2026-08-03T03:00:00.000Z";
const encoder = new TextEncoder();

const POLICY = {
  max_assets: 10,
  max_total_bytes: 1_000_000,
  validate_freshness: () => true,
  validate_public_payload: () => true,
};

async function assertRejectsCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

// --- R2 REST shim, offline via an injected fetch ----------------------------

{
  const bytes = encoder.encode("r2-rest-offline");
  const jsonEnvelope = (status, body) => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

  // 404 maps to null.
  const missBucket = createR2RestBucket({
    accountId: "acct",
    bucket: "bucket",
    token: "token",
    fetchImpl: async () => jsonEnvelope(404, {
      success: false,
      errors: [{ code: 10007, message: "The specified key does not exist." }],
    }),
  });
  assert.equal(await missBucket.get("objects/sha256/aa"), null);

  // 200 returns the raw body through arrayBuffer().
  const hitBucket = createR2RestBucket({
    accountId: "acct",
    bucket: "bucket",
    token: "token",
    fetchImpl: async () => new Response(bytes, { status: 200 }),
  });
  const object = await hitBucket.get("objects/sha256/aa");
  assert.deepEqual(new Uint8Array(await object.arrayBuffer()), bytes);

  // 5xx is retried up to 3 attempts; 4xx is not retried; network errors are.
  let putCalls = 0;
  const flakyBucket = createR2RestBucket({
    accountId: "acct",
    bucket: "bucket",
    token: "token",
    fetchImpl: async () => {
      putCalls += 1;
      return putCalls < 3
        ? jsonEnvelope(500, { success: false, errors: [{ code: 1, message: "boom" }] })
        : jsonEnvelope(200, { success: true, result: { key: "k" } });
    },
  });
  await flakyBucket.put("objects/sha256/bb", bytes);
  assert.equal(putCalls, 3);

  let rejectCalls = 0;
  const rejectingBucket = createR2RestBucket({
    accountId: "acct",
    bucket: "bucket",
    token: "token",
    fetchImpl: async () => {
      rejectCalls += 1;
      return jsonEnvelope(400, { success: false, errors: [{ code: 2, message: "bad" }] });
    },
  });
  await assertRejectsCode(rejectingBucket.put("objects/sha256/cc", bytes), "R2_REST_HTTP");
  assert.equal(rejectCalls, 1);

  let networkCalls = 0;
  const deadBucket = createR2RestBucket({
    accountId: "acct",
    bucket: "bucket",
    token: "token",
    fetchImpl: async () => {
      networkCalls += 1;
      throw new Error("socket hang up");
    },
  });
  await assertRejectsCode(deadBucket.get("objects/sha256/dd"), "R2_REST_NETWORK");
  assert.equal(networkCalls, 3);
  console.log("r2-rest shim: 404/200/5xx-retry/4xx-no-retry/network-retry ok");
}

// --- fixture tree + manifest build ------------------------------------------

const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "cloud-data-plane-publisher-"));
const FIXTURE_REL_ROOT = "data/test-fixtures/cloud-data-plane-publisher";
const SHARED = "{\"shared\":\"shadow-equals-lkg\"}\n";
const fixtureFiles = {
  "index.json": "{\"fixture\":\"index\"}\n",
  "lkg/oecd_cli.json": SHARED,
  "parity-report.json": "{\"fixture\":\"parity\"}\n",
  "shadow/oecd-cli.json": SHARED,
};
for (const [relative, text] of Object.entries(fixtureFiles)) {
  await mkdir(path.join(fixtureRoot, path.dirname(relative)), { recursive: true });
  await writeFile(path.join(fixtureRoot, relative), text);
}

const build = await buildFamilyManifest({
  familyName: "oecd-cli",
  absRoot: fixtureRoot,
  relRoot: FIXTURE_REL_ROOT,
  now: () => NOW_1,
});
const { manifest, payloads } = build;
validateGenerationManifest(manifest);
assert.match(manifest.generation_id, /^oecd-cli-[0-9a-f]{16}$/);
assert.equal(manifest.generation_id, `oecd-cli-${manifest.source_sha.slice(0, 16)}`);
assert.equal(
  manifest.source_sha,
  sha256Canonical(manifest.assets.map((asset) => [asset.path, asset.sha256])),
);
assert.equal(manifest.assets.length, 4);
const sortedPaths = manifest.assets.map((asset) => asset.path);
assert.deepEqual(sortedPaths, [...sortedPaths].sort((left, right) => left.localeCompare(right)));
assert.ok(sortedPaths.every((assetPath) => assetPath.startsWith("data/")));
assert.ok(manifest.assets.every((asset) => asset.privacy_class === "private"));
assert.equal(new Set(manifest.assets.map((asset) => asset.object_key)).size, 3);
console.log("manifest build from fixture tree ok (4 assets, 3 unique objects, private, sorted)");

// --- coordinator endpoint stub over node:http --------------------------------
//
// NOTE: the contract's createMemoryCloudDataPlane().inspect() crashes under
// node once any receipt exists ([...].map(structuredClone) passes the array
// index as structuredClone's options argument). The contract file is
// byte-locked, so the stub tracks receipts and object keys itself instead of
// calling inspect().

const serverPlane = createMemoryCloudDataPlane();
const requests = [];
let failNextWith500 = 0;

const stubReceipts = new Map();
const stubLedger = {
  async prepare(receipt) {
    await serverPlane.ledger.prepare(receipt);
    stubReceipts.set(receipt.receipt_id, structuredClone(receipt));
  },
  async markPromoted(receipt) {
    await serverPlane.ledger.markPromoted(receipt);
    stubReceipts.set(receipt.receipt_id, structuredClone(receipt));
  },
  async get(receiptId) {
    return serverPlane.ledger.get(receiptId);
  },
};

function fail(code, detail) {
  const error = new Error(`${code}:${detail}`);
  error.code = code;
  throw error;
}

// Per-family coordinator state: the worker route selects a Durable Object
// instance by the x-data-plane-family header, so each family owns its pointer,
// ledger and sequence over ONE shared object store. This emulates that
// selection offline — the memory plane gives each family its own pointer and
// receipts, while the object store (r2Binding) stays shared.
const perFamilyCoordinators = new Map();
function makeCoordinatorState() {
  const state = createMemoryCloudDataPlane();
  return {
    async action(pathname, payload) {
      switch (pathname) {
        case "/ledger/prepare":
          await state.ledger.prepare(payload.receipt);
          return null;
        case "/ledger/mark-promoted":
          await state.ledger.markPromoted(payload.receipt);
          return null;
        case "/ledger/get":
          return state.ledger.get(payload.receipt_id);
        case "/pointer/get":
          return state.pointerStore.get();
        case "/pointer/compare-and-swap":
          await state.pointerStore.compareAndSwap(payload.expected_sequence, payload.pointer);
          return null;
        case "/inspect":
          return {
            receipts: state.inspect().receipts,
            pointer: await state.pointerStore.get(),
          };
        default:
          return fail("COORDINATOR_ACTION_UNKNOWN", pathname);
      }
    },
  };
}

async function dispatchCoordinator(pathname, payload) {
  switch (pathname) {
    case "/ledger/prepare": return stubLedger.prepare(payload.receipt);
    case "/ledger/mark-promoted": return stubLedger.markPromoted(payload.receipt);
    case "/ledger/get": return stubLedger.get(payload.receipt_id);
    case "/pointer/get": return serverPlane.pointerStore.get();
    case "/pointer/compare-and-swap":
      return serverPlane.pointerStore.compareAndSwap(payload.expected_sequence, payload.pointer);
    case "/inspect":
      return {
        receipts: [...stubReceipts.values()]
          .sort((left, right) => left.receipt_id.localeCompare(right.receipt_id)),
        pointer: await serverPlane.pointerStore.get(),
      };
    default: return fail("COORDINATOR_ACTION_UNKNOWN", pathname);
  }
}

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const bodyText = Buffer.concat(chunks).toString("utf8");
  const { pathname } = new URL(req.url, "http://coordinator.stub");
  requests.push({ method: req.method, pathname, headers: req.headers, body: bodyText });
  if (failNextWith500 > 0) {
    failNextWith500 -= 1;
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "INJECTED_500", detail: "injected" } }));
    return;
  }
  try {
    const family = req.headers["x-data-plane-family"];
    const payload = bodyText ? JSON.parse(bodyText) : {};
    let result;
    if (family) {
      if (!perFamilyCoordinators.has(family)) {
        perFamilyCoordinators.set(family, makeCoordinatorState());
      }
      result = await perFamilyCoordinators.get(family).action(pathname, payload);
    } else {
      result = await dispatchCoordinator(pathname, payload);
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ result: result ?? null }));
  } catch (error) {
    res.writeHead(409, { "content-type": "application/json" });
    res.end(JSON.stringify({
      error: { code: error.code ?? "COORDINATOR_INTERNAL", detail: error.message },
    }));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${server.address().port}`;

// Workers R2 binding shape over the memory plane's object store. Object keys
// are tracked locally because the memory plane's inspect() is unusable (see
// the stub note above).
const r2Counters = { put: 0 };
const r2Keys = new Set();
const r2Binding = {
  async get(key) {
    const bytes = await serverPlane.objectStore.get(key);
    if (bytes === null) return null;
    return {
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    };
  },
  async put(key, bytes) {
    r2Counters.put += 1;
    await serverPlane.objectStore.putIfAbsent(key, bytes);
    r2Keys.add(key);
  },
  async list({ cursor } = {}) {
    const keys = [...r2Keys].sort();
    const start = cursor ? Number(cursor) : 0;
    const page = keys.slice(start, start + 2); // small pages to exercise pagination
    const next = start + page.length;
    return {
      objects: page.map((key) => ({ key })),
      truncated: next < keys.length,
      cursor: next < keys.length ? String(next) : undefined,
    };
  },
};

const coordinatorNamespace = createRemoteCoordinatorNamespace({
  endpoint,
  key: "test-write-key",
});
const plane = createCloudflareCloudDataPlane({ r2Bucket: r2Binding, coordinatorNamespace });

try {
  // First publish through the remote shim.
  const livePointer = await plane.pointerStore.get();
  assert.equal(livePointer, null);
  const resolved = await resolveExpectedPointerSequence({
    pointer: livePointer,
    manifest,
    objectStore: plane.objectStore,
  });
  assert.deepEqual(
    { expected: resolved.expectedPointerSequence, resume: resolved.resume },
    { expected: 0, resume: false },
  );
  const published = await publishGeneration({
    manifest: resolved.manifest,
    payloads,
    expectedPointerSequence: resolved.expectedPointerSequence,
    objectStore: plane.objectStore,
    ledger: plane.ledger,
    pointerStore: plane.pointerStore,
    policy: POLICY,
  });
  assert.equal(published.pointer.sequence, 1);
  assert.equal(published.receipt.state, "promoted");
  // Drift guard passes on a normal publish: the contract's returned
  // receipt_id equals the deterministic mirror of its format.
  assert.equal(
    assertPublishReceiptId({
      manifest: resolved.manifest,
      expectedPointerSequence: resolved.expectedPointerSequence,
      receipt: published.receipt,
    }),
    published.receipt.receipt_id,
  );
  assert.equal(r2Counters.put, 4); // 3 unique asset objects + 1 manifest
  assert.deepEqual(
    [...r2Keys].sort(),
    [...new Set([
      ...manifest.assets.map((asset) => asset.object_key),
      `manifests/${manifest.generation_id}.json`,
    ])].sort(),
  );

  // Wire format: JSON POST to ${endpoint}${pathname} with the data-plane key,
  // body passed through as parseable JSON matching the adapter's payload.
  assert.ok(requests.length >= 5); // pointer/get, ledger/get, ledger/prepare, CAS, get, mark-promoted...
  for (const request of requests) {
    assert.equal(request.method, "POST");
    assert.match(request.headers["content-type"], /application\/json/);
    assert.equal(request.headers["x-data-plane-key"], "test-write-key");
    JSON.parse(request.body);
  }
  const prepareRequest = requests.find((request) => request.pathname === "/ledger/prepare");
  assert.equal(JSON.parse(prepareRequest.body).receipt.receipt_id, published.receipt.receipt_id);
  const casRequest = requests.find((request) => request.pathname === "/pointer/compare-and-swap");
  assert.equal(JSON.parse(casRequest.body).expected_sequence, 0);
  assert.equal(JSON.parse(casRequest.body).pointer.sequence, 1);
  console.log("remote shim wire format ok (POST, headers, body passthrough)");

  // 5xx from the coordinator is retried; the call eventually succeeds.
  failNextWith500 = 2;
  const requestsBeforeRetry = requests.length;
  const pointerAfter = await plane.pointerStore.get();
  assert.equal(pointerAfter.sequence, 1);
  assert.equal(requests.length - requestsBeforeRetry, 3);
  console.log("remote shim 5xx retry ok (3 attempts, then success)");

  // A 409 contract error propagates as the exact code and is never retried.
  const requestsBefore409 = requests.length;
  const staleCandidate = { ...pointerAfter, sequence: 1 };
  await assertRejectsCode(
    plane.pointerStore.compareAndSwap(0, staleCandidate),
    "STALE_WRITER",
  );
  assert.equal(requests.length - requestsBefore409, 1);
  console.log("409 STALE_WRITER propagates as exact code, no retry");

  // Idempotent republish: same content (rebuilt with a LATER created_at, so
  // the fresh manifest bytes differ) resolves to the stored manifest and the
  // contract's resume path — the pointer does not advance.
  const rebuild = await buildFamilyManifest({
    familyName: "oecd-cli",
    absRoot: fixtureRoot,
    relRoot: FIXTURE_REL_ROOT,
    now: () => NOW_2,
  });
  assert.equal(rebuild.manifest.generation_id, manifest.generation_id);
  assert.notEqual(rebuild.manifest.created_at, manifest.created_at);
  const republishResolved = await resolveExpectedPointerSequence({
    pointer: await plane.pointerStore.get(),
    manifest: rebuild.manifest,
    objectStore: plane.objectStore,
  });
  assert.equal(republishResolved.resume, true);
  assert.equal(republishResolved.expectedPointerSequence, 0);
  assert.equal(republishResolved.manifest.created_at, NOW_1); // stored manifest adopted
  const republished = await publishGeneration({
    manifest: republishResolved.manifest,
    payloads: rebuild.payloads,
    expectedPointerSequence: republishResolved.expectedPointerSequence,
    objectStore: plane.objectStore,
    ledger: plane.ledger,
    pointerStore: plane.pointerStore,
    policy: POLICY,
  });
  assert.equal(republished.pointer.sequence, 1);
  assert.equal(republished.receipt.state, "promoted");
  assert.equal(republished.receipt.receipt_id, published.receipt.receipt_id);
  assert.equal(r2Counters.put, 4); // resume writes nothing
  assert.equal((await plane.pointerStore.get()).sequence, 1);
  console.log("idempotent republish ok (same generation_id, pointer did not advance)");

  // Byte-parity verification through the pointer.
  const parity = await verifyGenerationParity({
    pointerStore: plane.pointerStore,
    objectStore: plane.objectStore,
    payloads,
  });
  assert.equal(parity.assets, 4);
  const tampered = new Map(payloads);
  const victim = manifest.assets[0];
  tampered.set(victim.path, encoder.encode("{\"tampered\":true}\n".padEnd(victim.bytes, " ")));
  await assertRejectsCode(
    verifyGenerationParity({
      pointerStore: plane.pointerStore,
      objectStore: plane.objectStore,
      payloads: tampered,
    }),
    "PARITY_ASSET_MISMATCH",
  );
  console.log("byte-parity verification ok (positive + tamper rejection)");

  // inspect() through the wire (exercises list pagination + /inspect).
  const inspection = await plane.inspect();
  assert.equal(inspection.pointer.sequence, 1);
  assert.equal(inspection.object_keys.length, 4);
  assert.equal(inspection.receipts.length, 1);

  // --- chaos: stale-sequence -------------------------------------------------
  // A new generation (index.json changes) published with an
  // expectedPointerSequence one behind the live value must surface
  // STALE_WRITER and leave the pointer, the ledger and the objects untouched.
  await writeFile(path.join(fixtureRoot, "index.json"), "{\"fixture\":\"index-v2\"}\n");
  const buildV2 = await buildFamilyManifest({
    familyName: "oecd-cli",
    absRoot: fixtureRoot,
    relRoot: FIXTURE_REL_ROOT,
    now: () => NOW_3,
  });
  const { manifest: manifestV2, payloads: payloadsV2 } = buildV2;
  assert.notEqual(manifestV2.generation_id, manifest.generation_id);

  const pointerBeforeChaos = await plane.pointerStore.get();
  assert.equal(pointerBeforeChaos.sequence, 1);
  const resolvedV2 = await resolveExpectedPointerSequence({
    pointer: pointerBeforeChaos,
    manifest: manifestV2,
    objectStore: plane.objectStore,
    ledger: plane.ledger,
  });
  assert.deepEqual(
    { expected: resolvedV2.expectedPointerSequence, resume: resolvedV2.resume },
    { expected: 1, resume: false },
  );
  const staleExpected = chaosExpectedPointerSequence({
    chaos: "stale-sequence",
    pointerSequence: pointerBeforeChaos.sequence,
    resolved: resolvedV2.expectedPointerSequence,
  });
  assert.equal(staleExpected, 0); // one behind the live value
  assert.throws(
    () => chaosExpectedPointerSequence({ chaos: "stale-sequence", pointerSequence: 0, resolved: 0 }),
    (error) => {
      assert.equal(error.code, "CHAOS_PRECONDITION");
      return true;
    },
  );
  const putsBeforeStale = r2Counters.put;
  const requestsBeforeStale = requests.length;
  await assertRejectsCode(
    publishGeneration({
      manifest: resolvedV2.manifest,
      payloads: payloadsV2,
      expectedPointerSequence: staleExpected,
      objectStore: plane.objectStore,
      ledger: plane.ledger,
      pointerStore: plane.pointerStore,
      policy: POLICY,
    }),
    "STALE_WRITER",
  );
  assert.equal((await plane.pointerStore.get()).sequence, 1); // pointer did not advance
  assert.equal(r2Counters.put, putsBeforeStale); // stale check fires before any object write
  const staleWire = requests.slice(requestsBeforeStale);
  // The staleness verdict is computed from pointer state read across the HTTP
  // stub; no prepare or compare-and-swap may cross the wire afterwards.
  assert.ok(staleWire.some((request) => request.pathname === "/pointer/get"));
  assert.ok(!staleWire.some((request) => request.pathname === "/ledger/prepare"));
  assert.ok(!staleWire.some((request) => request.pathname === "/pointer/compare-and-swap"));
  console.log("chaos stale-sequence ok (STALE_WRITER surfaced, pointer held at 1)");

  // --- chaos: abort-after-prepare --------------------------------------------
  // The same new generation, now with the correct expected sequence, but the
  // publisher crashes after ledger.prepare returns and before compareAndSwap.
  const putsBeforeAbort = r2Counters.put;
  const requestsBeforeAbort = requests.length;
  const abortingPointerStore = chaosPointerStore({
    chaos: "abort-after-prepare",
    pointerStore: plane.pointerStore,
  });
  await assertRejectsCode(
    publishGeneration({
      manifest: resolvedV2.manifest,
      payloads: payloadsV2,
      expectedPointerSequence: resolvedV2.expectedPointerSequence,
      objectStore: plane.objectStore,
      ledger: plane.ledger,
      pointerStore: abortingPointerStore,
      policy: POLICY,
    }),
    "CHAOS_ABORT_AFTER_PREPARE",
  );
  assert.equal((await plane.pointerStore.get()).sequence, 1); // pointer did not advance
  const abortReceiptId = deterministicPublishReceiptId({
    manifest: resolvedV2.manifest,
    expectedPointerSequence: resolvedV2.expectedPointerSequence,
  });
  const abortedReceipt = await plane.ledger.get(abortReceiptId); // crosses the wire
  assert.equal(abortedReceipt.state, "prepared");
  assert.equal(abortedReceipt.promoted_pointer_sequence, null);
  const abortWire = requests.slice(requestsBeforeAbort);
  assert.ok(abortWire.some((request) => request.pathname === "/ledger/prepare"));
  // The injected crash fires before the CAS: no compare-and-swap on the wire.
  assert.ok(!abortWire.some((request) => request.pathname === "/pointer/compare-and-swap"));
  assert.equal(r2Counters.put, putsBeforeAbort + 2); // changed index.json + new manifest object
  console.log("chaos abort-after-prepare ok (pointer held at 1, receipt prepared, no CAS)");

  // Unchanged re-run: rebuilt with a fresh created_at, so only the publisher's
  // crash-retry stabilization (stored manifest + prepared receipt created_at)
  // can keep the bytes identical. Must resume the same receipt_id and advance
  // the pointer exactly once.
  const rerunV2 = await buildFamilyManifest({
    familyName: "oecd-cli",
    absRoot: fixtureRoot,
    relRoot: FIXTURE_REL_ROOT,
    now: () => NOW_4,
  });
  assert.equal(rerunV2.manifest.generation_id, manifestV2.generation_id);
  assert.notEqual(rerunV2.manifest.created_at, resolvedV2.manifest.created_at);
  const reresolved = await resolveExpectedPointerSequence({
    pointer: await plane.pointerStore.get(),
    manifest: rerunV2.manifest,
    objectStore: plane.objectStore,
    ledger: plane.ledger,
  });
  assert.equal(reresolved.resume, false);
  assert.equal(reresolved.expectedPointerSequence, 1);
  assert.equal(reresolved.manifest.created_at, NOW_3); // stored manifest adopted
  assert.equal(reresolved.resumeCreatedAt, abortedReceipt.created_at); // receipt bytes stabilized
  assert.equal(
    deterministicPublishReceiptId({
      manifest: reresolved.manifest,
      expectedPointerSequence: reresolved.expectedPointerSequence,
    }),
    abortReceiptId,
  );
  const putsBeforeRerun = r2Counters.put;
  const requestsBeforeRerun = requests.length;
  const resumed = await publishGeneration({
    manifest: reresolved.manifest,
    payloads: rerunV2.payloads,
    expectedPointerSequence: reresolved.expectedPointerSequence,
    objectStore: plane.objectStore,
    ledger: plane.ledger,
    pointerStore: plane.pointerStore,
    policy: POLICY,
    now: reresolved.resumeCreatedAt ? () => reresolved.resumeCreatedAt : undefined,
  });
  assert.equal(resumed.pointer.sequence, 2); // advanced exactly once
  assert.equal(resumed.pointer.active.generation_id, manifestV2.generation_id);
  assert.equal(resumed.pointer.previous.generation_id, manifest.generation_id);
  assert.equal(resumed.receipt.receipt_id, abortReceiptId); // same receipt resumed
  assert.equal(resumed.receipt.state, "promoted");
  assert.equal(resumed.receipt.promoted_pointer_sequence, 2);
  assert.equal(r2Counters.put, putsBeforeRerun); // every object already stored, nothing rewritten
  const rerunWire = requests.slice(requestsBeforeRerun);
  assert.equal(
    rerunWire.filter((request) => request.pathname === "/pointer/compare-and-swap").length,
    1,
  );
  const parityV2 = await verifyGenerationParity({
    pointerStore: plane.pointerStore,
    objectStore: plane.objectStore,
    payloads: rerunV2.payloads,
  });
  assert.equal(parityV2.assets, 4);
  assert.equal((await plane.pointerStore.get()).sequence, 2);
  console.log("chaos abort-after-prepare resume ok (same receipt_id, pointer advanced once to 2)");

  // Drift guard: passes again on the resumed publish, and fires loudly on an
  // induced mismatch — a receipt whose id the deterministic mirror cannot
  // reproduce (as if the contract's receipt-id format had changed) must raise
  // RECEIPT_ID_DRIFT, never pass silently.
  assert.equal(
    assertPublishReceiptId({
      manifest: reresolved.manifest,
      expectedPointerSequence: reresolved.expectedPointerSequence,
      receipt: resumed.receipt,
    }),
    resumed.receipt.receipt_id,
  );
  const driftedReceipt = { ...resumed.receipt, receipt_id: `publish-9-${"f".repeat(32)}` };
  assert.throws(
    () => assertPublishReceiptId({
      manifest: reresolved.manifest,
      expectedPointerSequence: reresolved.expectedPointerSequence,
      receipt: driftedReceipt,
    }),
    (error) => {
      assert.equal(error.code, "RECEIPT_ID_DRIFT");
      assert.match(error.message, /RECEIPT_ID_DRIFT:contract returned receipt_id/);
      assert.match(error.message, /deterministic computation gives/);
      return true;
    },
  );
  console.log("receipt-id drift guard ok (passes on match, RECEIPT_ID_DRIFT on mismatch)");

  // --- rollback --------------------------------------------------------------
  // Pointer is at sequence 2 (active V2, previous V1). Rollback must move the
  // sequence FORWARD by exactly one, make the old previous active, and write
  // no objects.
  const putsBeforeRollback = r2Counters.put;
  const requestsBeforeRollback = requests.length;
  const rolled = await rollbackLiveGeneration({
    objectStore: plane.objectStore,
    ledger: plane.ledger,
    pointerStore: plane.pointerStore,
  });
  assert.equal(rolled.pointerBefore.sequence, 2);
  assert.equal(rolled.pointerBefore.active.generation_id, manifestV2.generation_id);
  assert.equal(rolled.pointer.sequence, 3); // advanced by exactly one, forward
  assert.equal(rolled.pointer.active.generation_id, manifest.generation_id); // old previous
  assert.equal(rolled.pointer.previous.generation_id, manifestV2.generation_id); // rolled-back-from
  assert.equal(rolled.receipt.operation, "rollback");
  assert.equal(rolled.receipt.state, "promoted");
  assert.equal(rolled.receipt.promoted_pointer_sequence, 3);
  assert.equal(r2Counters.put, putsBeforeRollback); // zero object writes
  const rollbackWire = requests.slice(requestsBeforeRollback);
  // Wire-delta proof: only coordinator traffic crossed — one prepare, one CAS,
  // one mark-promoted — and no object mutation exists on this wire at all.
  assert.equal(
    rollbackWire.filter((request) => request.pathname === "/ledger/prepare").length,
    1,
  );
  assert.equal(
    rollbackWire.filter((request) => request.pathname === "/pointer/compare-and-swap").length,
    1,
  );
  assert.equal(
    rollbackWire.filter((request) => request.pathname === "/ledger/mark-promoted").length,
    1,
  );
  const parityRestored = await verifyGenerationParity({
    pointerStore: plane.pointerStore,
    objectStore: plane.objectStore,
    payloads, // original V1 payloads, now active again
  });
  assert.equal(parityRestored.assets, 4);

  // Rolling back again restores V2 at sequence 4 — the sequence never rewinds.
  const rolledForward = await rollbackLiveGeneration({
    objectStore: plane.objectStore,
    ledger: plane.ledger,
    pointerStore: plane.pointerStore,
  });
  assert.equal(rolledForward.pointer.sequence, 4);
  assert.equal(rolledForward.pointer.active.generation_id, manifestV2.generation_id);
  assert.equal(rolledForward.pointer.previous.generation_id, manifest.generation_id);
  assert.equal(r2Counters.put, putsBeforeRollback); // still zero object writes
  console.log("rollback ok (2->3 active=V1, 3->4 active=V2; sequence only moves forward)");

  // Rollback refusal: a pointer with no previous fails with a clean typed
  // error before any write; an empty plane refuses the same way.
  const singlePlane = createMemoryCloudDataPlane();
  await publishGeneration({
    manifest,
    payloads,
    expectedPointerSequence: 0,
    objectStore: singlePlane.objectStore,
    ledger: singlePlane.ledger,
    pointerStore: singlePlane.pointerStore,
    policy: POLICY,
    now: () => NOW_1,
  });
  await assertRejectsCode(
    rollbackLiveGeneration({
      objectStore: singlePlane.objectStore,
      ledger: singlePlane.ledger,
      pointerStore: singlePlane.pointerStore,
    }),
    "ROLLBACK_TARGET_MISSING",
  );
  assert.equal((await singlePlane.pointerStore.get()).sequence, 1); // untouched
  assert.equal((await singlePlane.pointerStore.get()).active.generation_id, manifest.generation_id);
  const emptyPlane = createMemoryCloudDataPlane();
  await assertRejectsCode(
    rollbackLiveGeneration({
      objectStore: emptyPlane.objectStore,
      ledger: emptyPlane.ledger,
      pointerStore: emptyPlane.pointerStore,
    }),
    "ROLLBACK_TARGET_MISSING",
  );
  assert.equal(await emptyPlane.pointerStore.get(), null);
  console.log("rollback refusal ok (ROLLBACK_TARGET_MISSING, no previous / no pointer, no writes)");

  // --- fred-macro family: split root/prefix, single file, public class -------
  // Built from the REAL source file (read-only): 100xfenok-next is never
  // edited, only read as the publish source.
  const fredBuild = await buildFamilyManifest({
    familyName: "fred-macro",
    absRoot: path.join(REPO_ROOT, "100xfenok-next/public/data/macro"),
    relRoot: "public/data/macro",
    now: () => NOW_1,
  });
  validateGenerationManifest(fredBuild.manifest);
  assert.equal(fredBuild.manifest.assets.length, 1);
  const fredAsset = fredBuild.manifest.assets[0];
  assert.equal(fredAsset.path, "public/data/macro/fred-macro.json");
  // The upstream data file changes over time (10d32795eb moved it 530240 ->
  // 530238 bytes); the invariant that matters is that the manifest records the
  // on-disk size exactly, not any one specific number.
  assert.equal(
    fredAsset.bytes,
    statSync(path.join(REPO_ROOT, "100xfenok-next/public/data/macro/fred-macro.json")).size,
  );
  // source_as_of comes from the payload's own top-level "updated", explicitly
  // marked as such — never the acquisition time.
  const fredUpdated = JSON.parse(await readFile(
    path.join(REPO_ROOT, "100xfenok-next/public/data/macro/fred-macro.json"),
    "utf8",
  )).updated;
  assert.equal(fredAsset.source_as_of, fredUpdated.slice(0, 10));
  assert.equal(fredBuild.sourceAsOf.origin, "payload");
  assert.equal(fredAsset.privacy_class, "public");
  assert.equal(fredAsset.content_type, "application/json");
  assert.equal(fredAsset.object_key, `objects/sha256/${fredAsset.sha256}`);
  assert.match(fredBuild.manifest.generation_id, /^fred-macro-[0-9a-f]{16}$/);
  assert.equal(
    fredBuild.manifest.generation_id,
    `fred-macro-${fredBuild.manifest.source_sha.slice(0, 16)}`,
  );

  // Publish through the plane: the contract must accept the public class and
  // invoke the family's real public-payload validator, which the payload
  // satisfies (top-level keys updated/series, nothing secret-shaped).
  assert.equal(
    FAMILIES["fred-macro"].validate_public_payload({
      bytes: fredBuild.payloads.get("public/data/macro/fred-macro.json"),
    }),
    true,
  );
  const fredResolved = await resolveExpectedPointerSequence({
    pointer: await plane.pointerStore.get(),
    manifest: fredBuild.manifest,
    objectStore: plane.objectStore,
    ledger: plane.ledger,
  });
  assert.equal(fredResolved.resume, false);
  const fredPublished = await publishGeneration({
    manifest: fredResolved.manifest,
    payloads: fredBuild.payloads,
    expectedPointerSequence: fredResolved.expectedPointerSequence,
    objectStore: plane.objectStore,
    ledger: plane.ledger,
    pointerStore: plane.pointerStore,
    policy: {
      ...POLICY,
      validate_public_payload: FAMILIES["fred-macro"].validate_public_payload,
    },
    now: () => NOW_1,
  });
  assert.equal(fredPublished.pointer.sequence, 5);
  assert.equal(fredPublished.pointer.active.generation_id, fredBuild.manifest.generation_id);
  assertPublishReceiptId({
    manifest: fredResolved.manifest,
    expectedPointerSequence: fredResolved.expectedPointerSequence,
    receipt: fredPublished.receipt,
  });
  // The contract's public read path serves the enrolled asset byte-exactly.
  const served = await resolvePublicAsset({
    publicPath: "public/data/macro/fred-macro.json",
    pointerStore: plane.pointerStore,
    objectStore: plane.objectStore,
  });
  assert.equal(served.kind, "ok");
  assert.deepEqual(served.bytes, fredBuild.payloads.get("public/data/macro/fred-macro.json"));
  assert.equal(served.content_type, "application/json");
  assert.equal(served.generation_id, fredBuild.manifest.generation_id);
  console.log("fred-macro family ok (single file, split root/prefix, public class served)");

  // --- per-family coordinators: two families publish and resolve ----------
  // independently, each against its OWN coordinator instance over the SHARED
  // object store. Acceptance gate for the per-family pointer fix: publishing
  // one family must never move another family's pointer.
  {
    const requestsAtStart = requests.length;
    const planeA = createCloudflareCloudDataPlane({
      r2Bucket: r2Binding,
      coordinatorNamespace: createRemoteCoordinatorNamespace({
        endpoint,
        key: "test-write-key",
        family: "oecd-cli",
      }),
      coordinatorName: "oecd-cli",
    });
    const planeB = createCloudflareCloudDataPlane({
      r2Bucket: r2Binding,
      coordinatorNamespace: createRemoteCoordinatorNamespace({
        endpoint,
        key: "test-write-key",
        family: "fred-macro",
      }),
      coordinatorName: "fred-macro",
    });
    const fredPolicy = {
      ...POLICY,
      validate_public_payload: FAMILIES["fred-macro"].validate_public_payload,
    };

    // A publishes oecd -> A sequence 1.
    const a1Resolved = await resolveExpectedPointerSequence({
      pointer: await planeA.pointerStore.get(),
      manifest,
      objectStore: planeA.objectStore,
    });
    assert.equal(a1Resolved.resume, false);
    const a1 = await publishGeneration({
      manifest: a1Resolved.manifest,
      payloads,
      expectedPointerSequence: a1Resolved.expectedPointerSequence,
      objectStore: planeA.objectStore,
      ledger: planeA.ledger,
      pointerStore: planeA.pointerStore,
      policy: POLICY,
    });
    assert.equal(a1.pointer.sequence, 1);

    // B publishes fred -> B sequence 1; A's pointer must not move.
    const b1Resolved = await resolveExpectedPointerSequence({
      pointer: await planeB.pointerStore.get(),
      manifest: fredBuild.manifest,
      objectStore: planeB.objectStore,
    });
    assert.equal(b1Resolved.resume, false);
    const b1 = await publishGeneration({
      manifest: b1Resolved.manifest,
      payloads: fredBuild.payloads,
      expectedPointerSequence: b1Resolved.expectedPointerSequence,
      objectStore: planeB.objectStore,
      ledger: planeB.ledger,
      pointerStore: planeB.pointerStore,
      policy: fredPolicy,
    });
    assert.equal(b1.pointer.sequence, 1);
    assert.equal((await planeA.pointerStore.get()).sequence, 1); // not displaced
    assert.equal((await planeA.pointerStore.get()).active.generation_id, manifest.generation_id);

    // A republishes oecd (idempotent resume): A stays at 1, B untouched.
    const a2Resolved = await resolveExpectedPointerSequence({
      pointer: await planeA.pointerStore.get(),
      manifest,
      objectStore: planeA.objectStore,
      ledger: planeA.ledger,
    });
    assert.equal(a2Resolved.resume, true);
    await publishGeneration({
      manifest: a2Resolved.manifest,
      payloads,
      expectedPointerSequence: a2Resolved.expectedPointerSequence,
      objectStore: planeA.objectStore,
      ledger: planeA.ledger,
      pointerStore: planeA.pointerStore,
      policy: POLICY,
      now: a2Resolved.resumeCreatedAt ? () => a2Resolved.resumeCreatedAt : undefined,
    });
    assert.equal((await planeA.pointerStore.get()).sequence, 1);
    const bPointerAfter = await planeB.pointerStore.get();
    assert.equal(bPointerAfter.sequence, 1);
    assert.equal(bPointerAfter.active.generation_id, fredBuild.manifest.generation_id);

    // Wire proof: every request this section issued carries the family header
    // of the family that issued it.
    const familyRequests = requests.slice(requestsAtStart);
    assert.ok(familyRequests.length >= 8);
    assert.ok(familyRequests.every((request) => request.headers["x-data-plane-family"]));
    const prepares = familyRequests.filter((request) => request.pathname === "/ledger/prepare");
    assert.ok(prepares.some((request) => request.headers["x-data-plane-family"] === "oecd-cli"));
    assert.ok(prepares.some((request) => request.headers["x-data-plane-family"] === "fred-macro"));
    const casRequests = familyRequests.filter((request) => request.pathname === "/pointer/compare-and-swap");
    assert.ok(casRequests.some((request) => request.headers["x-data-plane-family"] === "oecd-cli"));
    assert.ok(casRequests.some((request) => request.headers["x-data-plane-family"] === "fred-macro"));

    // Both families still RESOLVE from the shared object store: fred through
    // the public read path, oecd through a pointer walk.
    const fredServed = await resolvePublicAsset({
      publicPath: "public/data/macro/fred-macro.json",
      pointerStore: planeB.pointerStore,
      objectStore: planeB.objectStore,
    });
    assert.equal(fredServed.kind, "ok");
    assert.deepEqual(fredServed.bytes, fredBuild.payloads.get("public/data/macro/fred-macro.json"));
    const aParity = await verifyGenerationParity({
      pointerStore: planeA.pointerStore,
      objectStore: planeA.objectStore,
      payloads,
    });
    assert.equal(aParity.assets, manifest.assets.length);
    console.log("per-family coordinators ok (two families publish/resolve independently, no displacement)");
  }

  // --- source_as_of: real value from the family index, created_at fallback
  // marked explicitly, and a loud failure for a declared-but-invalid value ---
  {
    const asofRoot = await mkdtemp(path.join(os.tmpdir(), "cloud-data-plane-asof-"));
    try {
      // Live-shaped oecd-cli tree: index.json carries the real as-of date.
      await mkdir(path.join(asofRoot, "data/admin/oecd_cli"), { recursive: true });
      await writeFile(
        path.join(asofRoot, "data/admin/oecd_cli/index.json"),
        JSON.stringify({ updated_at: "2026-08-02T10:00:00.000Z" }),
      );
      await writeFile(path.join(asofRoot, "data/admin/oecd_cli/obs.json"), "{\"a\":1}\n");
      const withIndex = await buildFamilyManifest({
        familyName: "oecd-cli",
        absRoot: path.join(asofRoot, "data/admin/oecd_cli"),
        relRoot: "data/admin/oecd_cli",
        now: () => "2026-08-03T00:00:00.000Z",
      });
      assert.equal(withIndex.sourceAsOf.origin, "family-index");
      assert.ok(withIndex.manifest.assets.every((asset) => asset.source_as_of === "2026-08-02"));

      // Fixture-shaped tree without index.json: acquisition time is NOT
      // silently blurred into source time — the fallback is explicit.
      await rm(asofRoot, { recursive: true, force: true });
      await mkdir(asofRoot, { recursive: true });
      await writeFile(path.join(asofRoot, "obs.json"), "{\"a\":1}\n");
      const noIndex = await buildFamilyManifest({
        familyName: "oecd-cli",
        absRoot: asofRoot,
        relRoot: "data/admin/oecd_cli",
        now: () => "2026-08-03T09:00:00.000Z",
      });
      assert.equal(noIndex.sourceAsOf.origin, "created_at-fallback");
      assert.equal(noIndex.manifest.assets[0].source_as_of, "2026-08-03");

      // A declared source that is present but not a date fails loudly.
      await rm(asofRoot, { recursive: true, force: true });
      await mkdir(asofRoot, { recursive: true });
      await writeFile(path.join(asofRoot, "index.json"), JSON.stringify({ updated_at: "not a date" }));
      await writeFile(path.join(asofRoot, "obs.json"), "{\"a\":1}\n");
      await assertRejectsCode(
        buildFamilyManifest({
          familyName: "oecd-cli",
          absRoot: asofRoot,
          relRoot: "data/admin/oecd_cli",
          now: () => "2026-08-03T09:00:00.000Z",
        }),
        "FAMILY_ASOF_INVALID",
      );
      console.log("source_as_of ok (family-index real value, created_at fallback marked, invalid fails loudly)");
    } finally {
      await rm(asofRoot, { recursive: true, force: true });
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(fixtureRoot, { recursive: true, force: true });
}

// --- retention planner: the five mandated cases (offline, fabricated state) ---
// computeRetentionPlan is pure: manifests are fabricated through the real
// buildFamilyManifest (distinct fixture contents -> distinct generations), the
// pointer and object listing are fabricated directly, and deletion is a
// recording stub. No Cloudflare network anywhere in this section.

const retentionRoot = await mkdtemp(path.join(os.tmpdir(), "cloud-data-plane-retention-"));
const RET_REL_ROOT = "data/test-fixtures/cloud-data-plane-retention";
const RET_NOW = (hour) => `2026-08-03T${String(hour).padStart(2, "0")}:00:00.000Z`;
const P1_EVIDENCE_KEY = "objects/sha256/32098e38aa809da54d44ca13df2c9031b259c14a1b600a0ef4b5fec7ca65ad8b";

async function buildRetentionGeneration({ files, now }) {
  await rm(retentionRoot, { recursive: true, force: true });
  await mkdir(retentionRoot, { recursive: true });
  for (const [relative, text] of Object.entries(files)) {
    await mkdir(path.join(retentionRoot, path.dirname(relative)), { recursive: true });
    await writeFile(path.join(retentionRoot, relative), text);
  }
  const { manifest } = await buildFamilyManifest({
    familyName: "oecd-cli",
    absRoot: retentionRoot,
    relRoot: RET_REL_ROOT,
    now: () => now,
  });
  return manifest;
}
const manifestEntry = (manifest) => ({
  key: `manifests/${manifest.generation_id}.json`,
  text: JSON.stringify(manifest),
});
function retentionObjectEntries(manifests) {
  const byKey = new Map();
  for (const manifest of manifests) {
    for (const asset of manifest.assets) {
      byKey.set(asset.object_key, { key: asset.object_key, size: asset.bytes });
    }
  }
  return [...byKey.values()];
}
const assetKey = (manifest, suffix) => manifest.assets.find((asset) => asset.path.endsWith(suffix))?.object_key;
const pointerOf = (active, previous) => ({
  sequence: 9,
  active: { generation_id: active },
  previous: previous ? { generation_id: previous } : null,
});
// Re-prefix a built manifest onto a second family: family is derived from the
// generation_id prefix (oecd-cli-<hex> -> <family>-<hex>), so the SAME assets
// (content-addressed object keys) appear under a different family's window.
const asFamily = (manifest, familyName) => ({
  ...manifest,
  generation_id: `${familyName}-${manifest.generation_id.slice(manifest.generation_id.indexOf("-") + 1)}`,
});

// Case 1: objects shared across generations survive. G1 (a, b) falls out of
// the newest-3 window, but b is also in retained G2, so only a is collectable.
{
  const g1 = await buildRetentionGeneration({
    files: { "a.json": "{\"c\":1,\"f\":\"a\"}\n", "b.json": "{\"c\":1,\"f\":\"b\"}\n" },
    now: RET_NOW(0),
  });
  const g2 = await buildRetentionGeneration({
    files: { "b.json": "{\"c\":1,\"f\":\"b\"}\n", "c.json": "{\"c\":1,\"f\":\"c\"}\n" },
    now: RET_NOW(1),
  });
  const g3 = await buildRetentionGeneration({ files: { "d.json": "{\"c\":1,\"f\":\"d\"}\n" }, now: RET_NOW(2) });
  const g4 = await buildRetentionGeneration({ files: { "e.json": "{\"c\":1,\"f\":\"e\"}\n" }, now: RET_NOW(3) });
  const manifests = [g1, g2, g3, g4];
  const plan = computeRetentionPlan({
    families: [{ name: "oecd-cli", pointer: pointerOf(g4.generation_id, g3.generation_id), preparedGenerations: [] }],
    manifestEntries: manifests.map(manifestEntry),
    objectEntries: retentionObjectEntries(manifests),
  });
  assert.deepEqual(
    plan.retainedGenerations,
    [g2, g3, g4].map((manifest) => manifest.generation_id).sort(),
  );
  const keyA = assetKey(g1, "a.json");
  const keyB = assetKey(g1, "b.json");
  assert.equal(keyB, assetKey(g2, "b.json")); // genuinely shared across generations
  assert.deepEqual(plan.candidates.map((candidate) => candidate.key), [keyA]);
  assert.ok(plan.referencedKeys.includes(keyB)); // the shared object survives
  assert.match(plan.candidates[0].reason, new RegExp(`non-retained generation.*${g1.generation_id}`));
  console.log("retention case 1 ok (objects shared across generations survive)");
}

// Case 2: the rollback target (pointer previous) survives even though it sits
// OUTSIDE the newest-3 window. G2 is the only collectable generation.
{
  const generations = [];
  for (let index = 0; index < 5; index += 1) {
    generations.push(await buildRetentionGeneration({
      files: { "only.json": `{"c":2,"g":${index}}\n` },
      now: RET_NOW(index),
    }));
  }
  const [g1, g2, g3, g4, g5] = generations;
  const plan = computeRetentionPlan({
    families: [{
      name: "oecd-cli",
      pointer: pointerOf(g5.generation_id, g1.generation_id), // previous = rollback target, oldest
      preparedGenerations: [],
    }],
    manifestEntries: generations.map(manifestEntry),
    objectEntries: retentionObjectEntries(generations),
  });
  assert.ok(plan.retainedGenerations.includes(g1.generation_id)); // held by pointer.previous
  assert.deepEqual(
    plan.retainedGenerations,
    [g1, g3, g4, g5].map((manifest) => manifest.generation_id).sort(),
  );
  assert.deepEqual(plan.candidates.map((candidate) => candidate.key), [assetKey(g2, "only.json")]);
  console.log("retention case 2 ok (pointer previous survives outside the newest-3 window)");
}

// Case 3: a generation named by a prepared-but-unpromoted receipt survives,
// even though it is the oldest and the pointer does not name it.
{
  const generations = [];
  for (let index = 0; index < 4; index += 1) {
    generations.push(await buildRetentionGeneration({
      files: { "only.json": `{"c":3,"g":${index}}\n` },
      now: RET_NOW(index),
    }));
  }
  const [g1, g2, g3, g4] = generations;
  const plan = computeRetentionPlan({
    families: [{
      name: "oecd-cli",
      pointer: pointerOf(g4.generation_id, g3.generation_id),
      preparedGenerations: [g1.generation_id], // receipt in state "prepared"
    }],
    manifestEntries: generations.map(manifestEntry),
    objectEntries: retentionObjectEntries(generations),
  });
  assert.ok(plan.retainedGenerations.includes(g1.generation_id));
  assert.equal(plan.candidates.length, 0); // nothing may be collected
  console.log("retention case 3 ok (prepared-but-unpromoted generation survives)");
}

// Case 4: a corrupt (or unreadable, or missing) manifest in the retained set
// aborts the whole run with RETENTION_REFERENCE_SET_INCOMPLETE — and because
// the plan never materializes, the executor is never reached: zero deletions.
{
  const generations = [];
  for (let index = 0; index < 4; index += 1) {
    generations.push(await buildRetentionGeneration({
      files: { "only.json": `{"c":4,"g":${index}}\n` },
      now: RET_NOW(index),
    }));
  }
  const [g1, g2, g3, g4] = generations;
  const entries = generations.map(manifestEntry);
  const objectEntries = retentionObjectEntries(generations);

  let deleteCalls = 0;
  const recordingDelete = async () => {
    deleteCalls += 1;
    return { ok: true };
  };
  const attemptFlow = async (manifestEntries) => {
    // Mirrors the CLI: executeRetentionPlan is only reachable with a plan.
    let plan = null;
    try {
      plan = computeRetentionPlan({
        families: [{
          name: "oecd-cli",
          pointer: pointerOf(g4.generation_id, g3.generation_id),
          preparedGenerations: [],
        }],
        manifestEntries,
        objectEntries,
      });
    } catch (error) {
      assert.equal(error.code, "RETENTION_REFERENCE_SET_INCOMPLETE");
    }
    if (plan) await executeRetentionPlan({ plan, deleteObject: recordingDelete });
  };

  // Corrupt JSON at the NEWEST manifest (unambiguously in the retained set).
  await attemptFlow(entries.map((entry, index) => (index === 3 ? { ...entry, text: "{corrupt" } : entry)));
  // Unreadable (object vanished between listing and read).
  await attemptFlow(entries.map((entry, index) => (index === 3 ? { ...entry, text: null } : entry)));
  // Retained generation (g4, named by pointer.active) with no manifest in the
  // bucket — its references cannot be known, so the run must abort.
  await attemptFlow(entries.filter((entry) => entry.key !== `manifests/${g4.generation_id}.json`));
  assert.equal(deleteCalls, 0); // every variant aborted before any deletion
  console.log("retention case 4 ok (corrupt/unreadable/missing retained manifest aborts, zero deletions)");
}

// Case 5: a genuinely unreferenced object from the fourth-oldest generation is
// the ONLY thing collected — protected evidence keys, probe/lag.json, manifest
// keys and the shared object all survive, and the executor touches exactly one
// key.
{
  assert.ok(RETENTION_PROTECTED_KEYS.has(P1_EVIDENCE_KEY));
  assert.ok(RETENTION_PROTECTED_KEYS.has("probe/lag.json"));
  const g1 = await buildRetentionGeneration({
    files: { "unique.json": "{\"c\":5,\"f\":\"unique\"}\n", "shared.json": "{\"c\":5,\"f\":\"shared\"}\n" },
    now: RET_NOW(0),
  });
  const g2 = await buildRetentionGeneration({ files: { "x.json": "{\"c\":5,\"f\":\"x\"}\n" }, now: RET_NOW(1) });
  const g3 = await buildRetentionGeneration({ files: { "y.json": "{\"c\":5,\"f\":\"y\"}\n" }, now: RET_NOW(2) });
  const g4 = await buildRetentionGeneration({
    files: { "shared.json": "{\"c\":5,\"f\":\"shared\"}\n", "z.json": "{\"c\":5,\"f\":\"z\"}\n" },
    now: RET_NOW(3),
  });
  const generations = [g1, g2, g3, g4];
  const uniqueKey = assetKey(g1, "unique.json");
  const objectEntries = [
    ...retentionObjectEntries(generations),
    { key: P1_EVIDENCE_KEY, size: 320_980 }, // protected P1 evidence, unreferenced here
    { key: "probe/lag.json", size: 128 }, // protected probe
    { key: "manifests/r2-live-pilot-1.json", size: 900 }, // protected manifest
    ...generations.map((manifest) => ({ key: `manifests/${manifest.generation_id}.json`, size: 800 })),
  ];
  const plan = computeRetentionPlan({
    families: [{
      name: "oecd-cli",
      pointer: pointerOf(g4.generation_id, g3.generation_id),
      preparedGenerations: [],
    }],
    manifestEntries: generations.map(manifestEntry),
    objectEntries,
  });
  assert.deepEqual(plan.candidates.map((candidate) => candidate.key), [uniqueKey]);
  assert.equal(plan.candidates[0].size, g1.assets.find((asset) => asset.object_key === uniqueKey).bytes);
  assert.ok(plan.skippedProtected.includes(P1_EVIDENCE_KEY));
  assert.ok(plan.skippedProtected.includes("probe/lag.json"));
  const deletedKeys = [];
  const outcome = await executeRetentionPlan({
    plan,
    deleteObject: async (key) => {
      deletedKeys.push(key);
      return { ok: true };
    },
  });
  assert.deepEqual(deletedKeys, [uniqueKey]); // exactly one object collected
  assert.equal(outcome.deleted.length, 1);
  assert.equal(outcome.failures.length, 0);

  // A failing deleter is recorded, never thrown, and does not strand the batch.
  const failureOutcome = await executeRetentionPlan({
    plan,
    deleteObject: async () => ({ ok: false, error: "http 500: boom" }),
  });
  assert.equal(failureOutcome.deleted.length, 0);
  assert.equal(failureOutcome.failures.length, 1);
  assert.match(failureOutcome.failures[0].error, /http 500/);
  console.log("retention case 5 ok (only the fourth-oldest unreferenced object is collected)");
}

// Case 6: cross-family reference set over the shared object store. An object
// referenced by a RETAINED generation of family A and only an otherwise-
// collectable generation of family B survives; a prepared-unpromoted receipt
// protects within ITS family only (B's prepared generation keeps B's object,
// but does not rescue A's orphan).
{
  const sharedText = "{\"c\":6,\"f\":\"s\"}\n";
  const aGens = [];
  for (let index = 0; index < 4; index += 1) {
    aGens.push(await buildRetentionGeneration({
      files: index === 0
        ? { "u.json": "{\"c\":6,\"f\":\"u\"}\n" } // V: only in a1
        : index === 1
          ? { "s.json": sharedText } // S: shared with b1
          : { [`a${index}.json`]: `{\"c\":6,\"g\":${index}}\n` },
      now: RET_NOW(index),
    }));
  }
  const bGens = [];
  for (let index = 0; index < 4; index += 1) {
    bGens.push(asFamily(await buildRetentionGeneration({
      files: index === 0
        ? { "s.json": sharedText, "t.json": "{\"c\":6,\"f\":\"t\"}\n" } // S + T: only b1 has T
        : { [`b${index}.json`]: `{\"c\":6,\"g\":${index}}\n` },
      now: RET_NOW(index),
    }), "fred-macro"));
  }
  const [a1, a2, a3, a4] = aGens;
  const [b1, b2, b3, b4] = bGens;
  const keyS = assetKey(a2, "s.json");
  const keyT = assetKey(b1, "t.json");
  const keyV = assetKey(a1, "u.json");
  assert.equal(keyS, assetKey(b1, "s.json")); // genuinely shared across families

  const plan = computeRetentionPlan({
    families: [
      {
        name: "oecd-cli",
        pointer: pointerOf(a4.generation_id, a3.generation_id),
        preparedGenerations: [],
      },
      {
        name: "fred-macro",
        pointer: pointerOf(b4.generation_id, b3.generation_id),
        preparedGenerations: [b1.generation_id], // prepared receipt for family B
      },
    ],
    manifestEntries: [...aGens, ...bGens].map(manifestEntry),
    objectEntries: retentionObjectEntries([...aGens, ...bGens]),
  });
  // Per-family retention: A keeps a2..a4 (a1 outside the window), B keeps
  // b1 (prepared), b2..b4.
  assert.deepEqual(plan.retainedGenerations, [
    a2, a3, a4, b1, b2, b3, b4,
  ].map((manifest) => manifest.generation_id).sort());
  assert.ok(plan.referencedKeys.includes(keyS)); // shared object survives cross-family
  assert.ok(plan.referencedKeys.includes(keyT)); // B's prepared generation protects its object
  // V is referenced only by a1 (non-retained): the ONLY candidate.
  assert.deepEqual(plan.candidates.map((candidate) => candidate.key), [keyV]);
  assert.ok(!plan.referencedKeys.includes(keyV));
  console.log("retention case 6 ok (cross-family shared objects survive; prepared protects within its family)");
}

// Case 7: retention is BUCKET-LEVEL. Family B rolled back so its pointer
// ACTIVE (b1) is the oldest generation — outside B's own newest-3 window. A
// named-family-only scan (family A's state alone) would collect b1's object,
// i.e. delete the other family's live generation; the bucket-level union that
// reads every family's pointer keeps it.
{
  const aGens = [];
  for (let index = 0; index < 4; index += 1) {
    aGens.push(await buildRetentionGeneration({
      files: { [`a${index}.json`]: `{\"c\":7,\"g\":${index}}\n` },
      now: RET_NOW(index),
    }));
  }
  const bGens = [];
  for (let index = 0; index < 4; index += 1) {
    bGens.push(asFamily(await buildRetentionGeneration({
      files: { [`b${index}.json`]: `{\"c\":7,\"g\":${index}}\n` },
      now: RET_NOW(index),
    }), "fred-macro"));
  }
  const [bOldest] = bGens; // B's rolled-back ACTIVE: the oldest generation
  const bNewest = bGens[3];
  const aNewest = aGens[3];
  const aPrev = aGens[2];
  const keyP = assetKey(bOldest, "b0.json");
  const bucketLevel = computeRetentionPlan({
    families: [
      { name: "oecd-cli", pointer: pointerOf(aNewest.generation_id, aPrev.generation_id), preparedGenerations: [] },
      // B rolled back: active = bOldest, previous = bNewest. bOldest sits
      // outside B's newest-3 window and survives ONLY through its pointer.
      { name: "fred-macro", pointer: pointerOf(bOldest.generation_id, bNewest.generation_id), preparedGenerations: [] },
    ],
    manifestEntries: [...aGens, ...bGens].map(manifestEntry),
    objectEntries: retentionObjectEntries([...aGens, ...bGens]),
  });
  assert.ok(bucketLevel.retainedGenerations.includes(bOldest.generation_id));
  assert.ok(!bucketLevel.candidates.some((candidate) => candidate.key === keyP));

  // The unsafe shape: only family A's state is known — bOldest becomes a candidate.
  const namedFamilyOnly = computeRetentionPlan({
    families: [{ name: "oecd-cli", pointer: pointerOf(aNewest.generation_id, aPrev.generation_id), preparedGenerations: [] }],
    manifestEntries: [...aGens, ...bGens].map(manifestEntry),
    objectEntries: retentionObjectEntries([...aGens, ...bGens]),
  });
  assert.ok(namedFamilyOnly.candidates.some((candidate) => candidate.key === keyP));
  console.log("retention case 7 ok (bucket-level scan protects every family's live generation)");
}

// The bucket-level scan aborts when ANY family fails to answer: an unreadable
// family is indistinguishable from one with no live generations, and guessing
// wrong deletes production data. A family that legitimately answers with no
// pointer (never published) is a harmless empty state.
{
  let inspected = 0;
  let aborted = false;
  try {
    await collectFamiliesRetentionState({
      families: ["fred-macro", "oecd-cli"],
      createPlane: (name) => {
        inspected += 1;
        if (name === "fred-macro") {
          return {
            async inspect() {
              throw Object.assign(new Error("http 503: coordinator unavailable"), { code: "COORDINATOR_UNAVAILABLE" });
            },
          };
        }
        return {
          async inspect() {
            return { receipts: [], pointer: { sequence: 1, active: { generation_id: "oecd-cli-abc" }, previous: null } };
          },
        };
      },
    });
  } catch (error) {
    aborted = true;
    assert.equal(error.code, "RETENTION_FAMILY_UNREADABLE");
    assert.match(error.message, /fred-macro/);
  }
  assert.equal(aborted, true);
  assert.equal(inspected, 1); // the loop stops at the first failing family — abort = zero deletions

  const emptyStates = await collectFamiliesRetentionState({
    families: ["fred-macro", "oecd-cli"],
    createPlane: () => ({ async inspect() { return { receipts: [], pointer: null }; } }),
  });
  assert.deepEqual(emptyStates.map((state) => [state.name, state.pointer]), [
    ["fred-macro", null],
    ["oecd-cli", null],
  ]);
  console.log("retention family-scan ok (unreadable family aborts with zero deletions; empty family answers harmlessly)");
}

await rm(retentionRoot, { recursive: true, force: true });

// --- retention REST helpers: list-with-size pagination + delete semantics -----

{
  const pages = [
    {
      success: true,
      result: [
        { key: "objects/sha256/aa", size: 10 },
        { key: "objects/sha256/bb", size: 20 },
      ],
      result_info: { cursor: "next-page" },
    },
    {
      success: true,
      result: [{ key: "manifests/oecd-cli-x.json", size: 30 }],
      result_info: {},
    },
  ];
  let listCalls = 0;
  const listed = await listR2ObjectsDetailed({
    accountId: "acct",
    bucket: "bucket",
    token: "token",
    fetchImpl: async () => {
      const body = pages[listCalls];
      listCalls += 1;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(listCalls, 2); // cursor followed exactly once
  assert.deepEqual(listed, [
    { key: "objects/sha256/aa", size: 10 },
    { key: "objects/sha256/bb", size: 20 },
    { key: "manifests/oecd-cli-x.json", size: 30 },
  ]);

  const deleteBase = { accountId: "acct", bucket: "bucket", token: "token", key: "objects/sha256/aa" };
  const okDelete = await deleteR2Object({
    ...deleteBase,
    fetchImpl: async () => new Response("{}", { status: 200 }),
  });
  assert.equal(okDelete.ok, true);
  const goneDelete = await deleteR2Object({
    ...deleteBase,
    fetchImpl: async () => new Response(JSON.stringify({ success: false, errors: [{ code: 10007 }] }), { status: 404 }),
  });
  assert.equal(goneDelete.ok, true); // already absent satisfies retention's intent
  let deleteAttempts = 0;
  const badDelete = await deleteR2Object({
    ...deleteBase,
    fetchImpl: async () => {
      deleteAttempts += 1;
      return new Response("bad request", { status: 400 });
    },
  });
  assert.equal(badDelete.ok, false);
  assert.equal(deleteAttempts, 1); // 4xx is a semantic answer: never retried
  let networkAttempts = 0;
  const deadDelete = await deleteR2Object({
    ...deleteBase,
    fetchImpl: async () => {
      networkAttempts += 1;
      throw new Error("socket hang up");
    },
  });
  assert.equal(deadDelete.ok, false);
  assert.equal(networkAttempts, 3); // network errors exhaust the retry budget
  console.log("retention REST helpers ok (list pagination, delete 200/404/400/network)");
}

// --- gate-blocked behaviour through the real CLI (offline) -------------------

function runCli(extraArgs, includeFamily = true) {
  const env = { ...process.env };
  delete env.CLOUDFLARE_API_TOKEN; // the gate fails closed without a token — offline by design
  delete env.DATA_PLANE_ENDPOINT;
  delete env.DATA_PLANE_WRITE_KEY;
  const argv = [PUBLISH_SCRIPT, ...(includeFamily ? ["--family=oecd-cli"] : []), ...extraArgs];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, {
      cwd: REPO_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({
      code,
      stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      stderr: Buffer.concat(stderrChunks).toString("utf8"),
    }));
  });
}

{
  const tolerated = await runCli(["--tolerate-gate-block"]);
  assert.equal(tolerated.code, 0, tolerated.stderr);
  const lines = tolerated.stdout.trim().split("\n");
  assert.equal(lines.length, 1);
  const summary = JSON.parse(lines[0]);
  assert.equal(summary.result, "gate_blocked");
  assert.equal(summary.gate_exit, 2);
  assert.match(summary.generation_id, /^oecd-cli-[0-9a-f]{16}$/);
  // Spec-measured facts for the real oecd-cli family.
  assert.equal(summary.assets, 4);
  assert.equal(summary.total_bytes, 592_351);
  assert.equal(summary.unique_object_keys, 4); // 3 unique objects + 1 manifest
  assert.equal(summary.objects_deduped, 1);

  const refused = await runCli([]);
  assert.equal(refused.code, 3);
  assert.equal(refused.stdout.trim(), "");
  assert.match(refused.stderr, /cost gate blocked/);

  // Chaos flag parsing: a known mode is accepted (the gate still blocks first,
  // offline), an unknown mode is rejected before anything runs.
  const chaosAccepted = await runCli(["--chaos=stale-sequence", "--tolerate-gate-block"]);
  assert.equal(chaosAccepted.code, 0, chaosAccepted.stderr);
  assert.equal(JSON.parse(chaosAccepted.stdout.trim()).result, "gate_blocked");
  const chaosRejected = await runCli(["--chaos=bogus"]);
  assert.equal(chaosRejected.code, 1);
  assert.match(chaosRejected.stderr, /ARGS_INVALID/);

  // Rollback flag parsing: accepted (gate blocks first, offline, with the
  // rollback mode reported), and --rollback + --chaos is rejected.
  const rollbackAccepted = await runCli(["--rollback", "--tolerate-gate-block"]);
  assert.equal(rollbackAccepted.code, 0, rollbackAccepted.stderr);
  const rollbackGateSummary = JSON.parse(rollbackAccepted.stdout.trim());
  assert.equal(rollbackGateSummary.result, "gate_blocked");
  assert.equal(rollbackGateSummary.mode, "rollback");
  const rollbackChaos = await runCli(["--rollback", "--chaos=stale-sequence"]);
  assert.equal(rollbackChaos.code, 1);
  assert.match(rollbackChaos.stderr, /ARGS_INVALID/);

  // Retention flags: bucket-level, so --family is REJECTED on this path; the
  // cost gate runs FIRST even though retention is a dry-run by default and
  // DeleteObject is free (offline the gate fails closed, which is exactly the
  // gate-first proof). Flag validation fires before anything runs.
  const retentionTolerated = await runCli(["--retention", "--tolerate-gate-block"], false);
  assert.equal(retentionTolerated.code, 0, retentionTolerated.stderr);
  const retentionSummary = JSON.parse(retentionTolerated.stdout.trim());
  assert.equal(retentionSummary.result, "gate_blocked");
  assert.equal(retentionSummary.mode, "retention");

  const retentionExplicitDry = await runCli(["--retention", "--dry-run", "--tolerate-gate-block"], false);
  assert.equal(retentionExplicitDry.code, 0, retentionExplicitDry.stderr);
  assert.equal(JSON.parse(retentionExplicitDry.stdout.trim()).mode, "retention");

  // The unsafe named-family invocation must not be expressible.
  const retentionWithFamily = await runCli(["--retention", "--family=fred-macro"]);
  assert.equal(retentionWithFamily.code, 1);
  assert.match(retentionWithFamily.stderr, /ARGS_INVALID/);
  assert.match(retentionWithFamily.stderr, /bucket-level/);

  const deleteWithoutRetention = await runCli(["--retention-delete"]);
  assert.equal(deleteWithoutRetention.code, 1);
  assert.match(deleteWithoutRetention.stderr, /ARGS_INVALID/);

  const retentionRollback = await runCli(["--retention", "--rollback"], false);
  assert.equal(retentionRollback.code, 1);
  assert.match(retentionRollback.stderr, /ARGS_INVALID/);

  const retentionChaos = await runCli(["--retention", "--chaos=stale-sequence"], false);
  assert.equal(retentionChaos.code, 1);
  assert.match(retentionChaos.stderr, /ARGS_INVALID/);
  console.log("retention CLI flags ok (bucket-level, gate-first offline, dry-run default, ARGS_INVALID validation)");
  console.log("gate-blocked behaviour ok (tolerate -> typed line exit 0; strict -> exit 3)");
}

// --- result vocabulary: known outcomes are healthy, anything else is a bug ---

{
  const healthy = [
    "dry_run",
    "published",
    "resumed",
    "gate_blocked",
    "chaos_stale_writer",
    "chaos_abort_after_prepare",
    "rolled_back",
    "retention_dry_run",
    "retention_deleted",
  ];
  for (const result of healthy) {
    assert.deepEqual(classifyResultLine(JSON.stringify({ result })), {
      healthy: true,
      result,
      reason: "ok",
    });
  }
  assert.deepEqual(classifyResultLine(JSON.stringify({ result: "bogus" })), {
    healthy: false,
    result: "bogus",
    reason: "unknown-result:bogus",
  });
  assert.deepEqual(classifyResultLine("{not json"), { healthy: false, result: null, reason: "not-json" });
  assert.deepEqual(classifyResultLine(JSON.stringify({ foo: 1 })), {
    healthy: false,
    result: null,
    reason: "missing-result",
  });
  console.log("result vocabulary ok (known results healthy; unknown/not-json/missing are bugs)");
}

console.log("test-cloud-data-plane-publisher: ok");
