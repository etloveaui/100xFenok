#!/usr/bin/env node
// Offline test for the node-side cloud data plane publisher. No Cloudflare
// network: the plane is createMemoryCloudDataPlane() from the byte-locked
// contract, the coordinator endpoint is a local node:http stub implementing
// the Durable Object wire contract, and the cost gate is exercised through
// the real CLI with CLOUDFLARE_API_TOKEN scrubbed (the gate then fails closed
// by design, which is exactly the gate-blocked path under test).

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
  deterministicPublishReceiptId,
  FAMILIES,
  resolveExpectedPointerSequence,
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
    const result = await dispatchCoordinator(pathname, bodyText ? JSON.parse(bodyText) : {});
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
  assert.equal(fredAsset.bytes, 530_240);
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
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(fixtureRoot, { recursive: true, force: true });
}

// --- gate-blocked behaviour through the real CLI (offline) -------------------

function runCli(extraArgs) {
  const env = { ...process.env };
  delete env.CLOUDFLARE_API_TOKEN; // the gate fails closed without a token — offline by design
  delete env.DATA_PLANE_ENDPOINT;
  delete env.DATA_PLANE_WRITE_KEY;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [PUBLISH_SCRIPT, "--family=oecd-cli", ...extraArgs], {
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
  console.log("gate-blocked behaviour ok (tolerate -> typed line exit 0; strict -> exit 3)");
}

console.log("test-cloud-data-plane-publisher: ok");
