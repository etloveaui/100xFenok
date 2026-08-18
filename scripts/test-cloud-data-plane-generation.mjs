#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  ACTIVE_POINTER_SCHEMA,
  DEFAULT_REMOTE_IO_CONCURRENCY,
  GENERATION_MANIFEST_SCHEMA,
  createMemoryCloudDataPlane,
  publishGeneration,
  runBoundedAsyncPool,
  resolveGenerationAsset,
  resolvePublicAsset,
  rollbackGeneration,
  sha256Bytes,
  validateActivePointer,
  validateGenerationManifest,
} from "./lib/cloud-data-plane-generation.mjs";

const SOURCE_SHA = "a".repeat(64);
const NOW = "2026-07-30T12:00:00.000Z";
const encoder = new TextEncoder();

function buildManifest(generationId, entries) {
  return {
    schema_version: GENERATION_MANIFEST_SCHEMA,
    generation_id: generationId,
    source_sha: SOURCE_SHA,
    created_at: NOW,
    assets: entries
      .map(({ path, text, privacy_class = "public", source_as_of = "2026-07-30" }) => {
        const bytes = encoder.encode(text);
        const sha256 = sha256Bytes(bytes);
        return {
          path,
          object_key: `objects/sha256/${sha256}`,
          sha256,
          bytes: bytes.byteLength,
          content_type: "application/json",
          source_as_of,
          privacy_class,
        };
      })
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
}

function payloadMap(manifest, values) {
  return new Map(manifest.assets.map((asset) => [asset.path, encoder.encode(values[asset.path])]));
}

const PUBLICATION_POLICY = {
  max_assets: 10,
  max_total_bytes: 10_000,
  validate_freshness(asset) {
    return asset.source_as_of === "2026-07-30";
  },
  validate_public_payload({ bytes }) {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    return !Object.keys(value).some((key) => /token|secret|password|cookie/i.test(key));
  },
};

const firstValues = {
  "data/private/source.json": "{\"secret\":1}\n",
  "public/data/market.json": "{\"value\":1}\n",
};
const firstManifest = buildManifest("generation-1", [
  { path: "data/private/source.json", text: firstValues["data/private/source.json"], privacy_class: "private" },
  { path: "public/data/market.json", text: firstValues["public/data/market.json"] },
]);
const firstSummary = validateGenerationManifest(firstManifest);
assert.equal(firstSummary.asset_count, 2);

// Schema, path, privacy and content-addressing violations are rejected before I/O.
{
  const unknownKey = structuredClone(firstManifest);
  unknownKey.assets[0].unexpected = true;
  assert.throws(() => validateGenerationManifest(unknownKey), /SCHEMA_INVALID/);

  const traversal = structuredClone(firstManifest);
  traversal.assets[0].path = "data/../public/leak.json";
  assert.throws(() => validateGenerationManifest(traversal), /PATH_INVALID/);

  const publicLeak = structuredClone(firstManifest);
  publicLeak.assets[0].privacy_class = "public";
  assert.throws(() => validateGenerationManifest(publicLeak), /PRIVACY_PATH_INVALID/);

  const mutableKey = structuredClone(firstManifest);
  mutableKey.assets[0].object_key = "objects/latest.json";
  assert.throws(() => validateGenerationManifest(mutableKey), /OBJECT_KEY_INVALID/);
}

const plane = createMemoryCloudDataPlane();
const first = await publishGeneration({
  manifest: firstManifest,
  payloads: payloadMap(firstManifest, firstValues),
  expectedPointerSequence: 0,
  objectStore: plane.objectStore,
  ledger: plane.ledger,
  pointerStore: plane.pointerStore,
  policy: PUBLICATION_POLICY,
  now: () => NOW,
  receiptId: "receipt-1",
});
assert.equal(first.pointer.sequence, 1);
assert.equal(first.pointer.previous, null);
assert.equal(first.receipt.state, "promoted");
assert.equal(first.receipt.operation, "publish");

// Remote immutable publication uses a deterministic bounded pool: eight
// deferred puts start, then the remaining two start only after capacity is
// released. This proves overlap without allowing an unbounded fan-out.
let poolManifest;
let poolPayloads;
{
  assert.equal(DEFAULT_REMOTE_IO_CONCURRENCY, 8);
  await assert.rejects(
    runBoundedAsyncPool([], async () => {}, DEFAULT_REMOTE_IO_CONCURRENCY + 1),
    /REMOTE_IO_CONCURRENCY_INVALID:9/,
  );
  const poolValues = Object.fromEntries(
    Array.from({ length: 9 }, (_, index) => [
      `public/data/pool-${index}.json`,
      `{"value":${index}}\n`,
    ]),
  );
  poolManifest = buildManifest(
    "generation-pool",
    Object.entries(poolValues).map(([path, text]) => ({ path, text })),
  );
  poolPayloads = payloadMap(poolManifest, poolValues);
  const poolPlane = createMemoryCloudDataPlane();
  const pending = [];
  const startedEight = new Promise((resolve) => { pending.startedEight = resolve; });
  const startedTen = new Promise((resolve) => { pending.startedTen = resolve; });
  let inFlight = 0;
  let maxInFlight = 0;
  let completedObjects = 0;
  const poolObjectStore = {
    async putIfAbsent(key, bytes) {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      pending.push({ release });
      if (pending.length === 8) pending.startedEight();
      if (pending.length === 10) pending.startedTen();
      await gate;
      inFlight -= 1;
      const outcome = await poolPlane.objectStore.putIfAbsent(key, bytes);
      completedObjects += 1;
      return outcome;
    },
    get: poolPlane.objectStore.get,
  };
  const publishProbe = publishGeneration({
    manifest: poolManifest,
    payloads: poolPayloads,
    expectedPointerSequence: 0,
    objectStore: poolObjectStore,
    ledger: poolPlane.ledger,
    pointerStore: poolPlane.pointerStore,
    policy: PUBLICATION_POLICY,
    now: () => NOW,
  });
  await startedEight;
  assert.equal(maxInFlight, 8);
  pending.slice(0, 8).forEach(({ release }) => release());
  await startedTen;
  assert.equal(maxInFlight, 8);
  pending.slice(8).forEach(({ release }) => release());
  const poolPublished = await publishProbe;
  assert.equal(poolPublished.summary.asset_count, 9);
  assert.equal(completedObjects, 10);
  console.log("bounded immutable publication ok (max in-flight 8, overlap >1, all 10 objects complete)");
}

// An immutable task failure rejects before the coordinator commit protocol;
// any already-started object work cannot produce a prepared receipt or CAS.
{
  const failurePlane = createMemoryCloudDataPlane();
  let putCalls = 0;
  let prepareCalls = 0;
  let casCalls = 0;
  let rejectionObserved = false;
  let postRejectionCalls = 0;
  let releaseInitialWindow;
  const initialWindowStarted = new Promise((resolve) => {
    releaseInitialWindow = resolve;
  });
  const pendingInitialWindow = [];
  const failingObjectStore = {
    async putIfAbsent(key, bytes) {
      putCalls += 1;
      if (rejectionObserved) postRejectionCalls += 1;
      if (putCalls === 1) throw new Error("injected immutable failure");
      if (putCalls <= DEFAULT_REMOTE_IO_CONCURRENCY) {
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        pendingInitialWindow.push({ release });
        if (putCalls === DEFAULT_REMOTE_IO_CONCURRENCY) releaseInitialWindow();
        await gate;
      }
      return failurePlane.objectStore.putIfAbsent(key, bytes);
    },
    get: failurePlane.objectStore.get,
  };
  const failingLedger = {
    async get() { return null; },
    async prepare() { prepareCalls += 1; },
    async markPromoted() {},
  };
  const failingPointerStore = {
    async get() { return null; },
    async compareAndSwap() { casCalls += 1; },
  };
  const failurePublish = publishGeneration({
    manifest: poolManifest,
    payloads: poolPayloads,
    expectedPointerSequence: 0,
    objectStore: failingObjectStore,
    ledger: failingLedger,
    pointerStore: failingPointerStore,
    policy: PUBLICATION_POLICY,
    now: () => NOW,
  });
  const observedFailure = failurePublish.catch((error) => {
    rejectionObserved = true;
    throw error;
  });
  await initialWindowStarted;
  assert.equal(putCalls, DEFAULT_REMOTE_IO_CONCURRENCY);
  assert.ok(putCalls < 10);
  pendingInitialWindow.forEach(({ release }) => release());
  await assert.rejects(
    observedFailure,
    /injected immutable failure/,
  );
  const callsAtRejection = putCalls;
  await Promise.resolve();
  assert.equal(putCalls, callsAtRejection);
  assert.equal(postRejectionCalls, 0);
  assert.equal(callsAtRejection, DEFAULT_REMOTE_IO_CONCURRENCY);
  assert.equal(prepareCalls, 0);
  assert.equal(casCalls, 0);
  console.log("bounded immutable failure gate ok (initial window only, no post-rejection calls or prepare/CAS)");
}

// Publication requires explicit freshness, size and public-payload policies.
{
  const missingPolicyPlane = createMemoryCloudDataPlane();
  await assert.rejects(
    publishGeneration({
      manifest: firstManifest,
      payloads: payloadMap(firstManifest, firstValues),
      expectedPointerSequence: 0,
      objectStore: missingPolicyPlane.objectStore,
      ledger: missingPolicyPlane.ledger,
      pointerStore: missingPolicyPlane.pointerStore,
    }),
    /SCHEMA_INVALID/,
  );

  const secretManifest = buildManifest("generation-secret", [
    { path: "public/data/secret.json", text: "{\"token\":\"nope\"}\n" },
  ]);
  const secretPlane = createMemoryCloudDataPlane();
  await assert.rejects(
    publishGeneration({
      manifest: secretManifest,
      payloads: payloadMap(secretManifest, { "public/data/secret.json": "{\"token\":\"nope\"}\n" }),
      expectedPointerSequence: 0,
      objectStore: secretPlane.objectStore,
      ledger: secretPlane.ledger,
      pointerStore: secretPlane.pointerStore,
      policy: PUBLICATION_POLICY,
    }),
    /PUBLIC_PAYLOAD_REJECTED/,
  );
  assert.deepEqual(secretPlane.inspect().object_keys, []);

  const staleManifest = buildManifest("generation-stale", [
    {
      path: "public/data/stale.json",
      text: "{\"value\":1}\n",
      source_as_of: "2026-07-29",
    },
  ]);
  const stalePlane = createMemoryCloudDataPlane();
  await assert.rejects(
    publishGeneration({
      manifest: staleManifest,
      payloads: payloadMap(staleManifest, { "public/data/stale.json": "{\"value\":1}\n" }),
      expectedPointerSequence: 0,
      objectStore: stalePlane.objectStore,
      ledger: stalePlane.ledger,
      pointerStore: stalePlane.pointerStore,
      policy: PUBLICATION_POLICY,
    }),
    /FRESHNESS_POLICY_REJECTED/,
  );
}

// Public reads preserve exact raw bytes; private and unenrolled paths never leak.
{
  const result = await resolvePublicAsset({
    publicPath: "/public/data/market.json",
    pointerStore: plane.pointerStore,
    objectStore: plane.objectStore,
  });
  assert.equal(result.kind, "ok");
  assert.deepEqual(result.bytes, encoder.encode(firstValues["public/data/market.json"]));
  assert.equal(result.generation_id, "generation-1");

  const privateResult = await resolvePublicAsset({
    publicPath: "data/private/source.json",
    pointerStore: plane.pointerStore,
    objectStore: plane.objectStore,
  });
  assert.deepEqual(privateResult, { kind: "not_enrolled" });

  const privateAuthorityResult = await resolveGenerationAsset({
    assetPath: "data/private/source.json",
    expectedPrivacyClass: "private",
    pointerStore: plane.pointerStore,
    objectStore: plane.objectStore,
  });
  assert.equal(privateAuthorityResult.kind, "ok");
  assert.deepEqual(privateAuthorityResult.bytes, encoder.encode(firstValues["data/private/source.json"]));

  const privateAsPublic = await resolveGenerationAsset({
    assetPath: "public/data/market.json",
    expectedPrivacyClass: "private",
    pointerStore: plane.pointerStore,
    objectStore: plane.objectStore,
  });
  assert.deepEqual(privateAsPublic, { kind: "not_enrolled" });

  const invalidPrivacy = await resolveGenerationAsset({
    assetPath: "data/private/source.json",
    expectedPrivacyClass: "secret",
    pointerStore: plane.pointerStore,
    objectStore: plane.objectStore,
  });
  assert.deepEqual(invalidPrivacy, { kind: "unavailable", reason: "PRIVACY_CLASS_INVALID" });

  const absentResult = await resolvePublicAsset({
    publicPath: "public/data/not-present.json",
    pointerStore: plane.pointerStore,
    objectStore: plane.objectStore,
  });
  assert.deepEqual(absentResult, { kind: "not_enrolled" });
}

// A stale writer cannot overwrite an already-promoted pointer.
{
  await assert.rejects(
    publishGeneration({
      manifest: firstManifest,
      payloads: payloadMap(firstManifest, firstValues),
      expectedPointerSequence: 0,
      objectStore: plane.objectStore,
      ledger: plane.ledger,
      pointerStore: plane.pointerStore,
      policy: PUBLICATION_POLICY,
      now: () => NOW,
      receiptId: "receipt-stale",
    }),
    /STALE_WRITER/,
  );
  assert.equal((await plane.pointerStore.get()).sequence, 1);
}

const secondValues = {
  "public/data/market.json": "{\"value\":2}\n",
  "public/generated/index.json": "{\"index\":2}\n",
};
const secondManifest = buildManifest("generation-2", [
  { path: "public/data/market.json", text: secondValues["public/data/market.json"] },
  { path: "public/generated/index.json", text: secondValues["public/generated/index.json"] },
]);
const second = await publishGeneration({
  manifest: secondManifest,
  payloads: payloadMap(secondManifest, secondValues),
  expectedPointerSequence: 1,
  objectStore: plane.objectStore,
  ledger: plane.ledger,
  pointerStore: plane.pointerStore,
  policy: PUBLICATION_POLICY,
  now: () => NOW,
  receiptId: "receipt-2",
});
assert.equal(second.pointer.sequence, 2);
assert.equal(second.pointer.previous.generation_id, "generation-1");

// A cross-bound receipt cannot finalize a pointer even when its state is syntactically valid.
{
  let markCalled = false;
  const evilReceipt = {
    ...first.receipt,
    receipt_id: "receipt-evil",
    state: "prepared",
    generation_id: "evil-generation",
    expected_pointer_sequence: 999,
    promoted_pointer_sequence: null,
  };
  await assert.rejects(
    publishGeneration({
      manifest: firstManifest,
      payloads: payloadMap(firstManifest, firstValues),
      expectedPointerSequence: 0,
      objectStore: plane.objectStore,
      ledger: {
        async get() {
          return evilReceipt;
        },
        async prepare() {
          throw new Error("must not prepare");
        },
        async markPromoted() {
          markCalled = true;
        },
      },
      pointerStore: {
        async get() {
          return first.pointer;
        },
      },
      policy: PUBLICATION_POLICY,
      receiptId: "receipt-evil",
    }),
    /STALE_WRITER/,
  );
  assert.equal(markCalled, false);
}

// Corrupt pointer/manifest/payload paths fail closed instead of silently serving a bundle.
{
  const invalidPointer = {
    schema_version: ACTIVE_POINTER_SCHEMA,
    sequence: 1,
    active: {
      generation_id: "generation-1",
      manifest_key: "manifests/generation-1.json",
      manifest_sha256: "x".repeat(64),
    },
    previous: null,
    source_sha: SOURCE_SHA,
    prepared_receipt_id: "receipt-invalid",
    promoted_at: NOW,
  };
  assert.throws(() => validateActivePointer(invalidPointer), /SCHEMA_INVALID/);

  const broken = createMemoryCloudDataPlane();
  const result = await resolvePublicAsset({
    publicPath: "public/data/market.json",
    pointerStore: {
      async get() {
        return {
          ...second.pointer,
          active: { ...second.pointer.active, manifest_sha256: "b".repeat(64) },
        };
      },
    },
    objectStore: plane.objectStore,
  });
  assert.deepEqual(result, { kind: "unavailable", reason: "MANIFEST_INTEGRITY_UNAVAILABLE" });

  const notConfigured = await resolvePublicAsset({
    publicPath: "public/data/market.json",
    pointerStore: broken.pointerStore,
    objectStore: broken.objectStore,
  });
  assert.deepEqual(notConfigured, { kind: "unavailable", reason: "ACTIVE_POINTER_UNAVAILABLE" });

  const sourceMismatch = await resolvePublicAsset({
    publicPath: "public/data/market.json",
    pointerStore: {
      async get() {
        return { ...second.pointer, source_sha: "b".repeat(64) };
      },
    },
    objectStore: plane.objectStore,
  });
  assert.deepEqual(sourceMismatch, { kind: "unavailable", reason: "MANIFEST_CROSS_BIND_INVALID" });
}

// A post-CAS ledger failure is recoverable with the same stable receipt id.
{
  const recoveringPlane = createMemoryCloudDataPlane();
  let failFinalize = true;
  const recoveringLedger = {
    ...recoveringPlane.ledger,
    async markPromoted(receipt) {
      if (failFinalize) throw new Error("injected finalize failure");
      return recoveringPlane.ledger.markPromoted(receipt);
    },
  };
  await assert.rejects(
    publishGeneration({
      manifest: firstManifest,
      payloads: payloadMap(firstManifest, firstValues),
      expectedPointerSequence: 0,
      objectStore: recoveringPlane.objectStore,
      ledger: recoveringLedger,
      pointerStore: recoveringPlane.pointerStore,
      policy: PUBLICATION_POLICY,
      now: () => NOW,
      receiptId: "receipt-recoverable",
    }),
    /injected finalize failure/,
  );
  assert.equal((await recoveringPlane.pointerStore.get()).sequence, 1);
  assert.equal((await recoveringPlane.ledger.get("receipt-recoverable")).state, "prepared");

  failFinalize = false;
  const recovered = await publishGeneration({
    manifest: firstManifest,
    payloads: payloadMap(firstManifest, firstValues),
    expectedPointerSequence: 0,
    objectStore: recoveringPlane.objectStore,
    ledger: recoveringLedger,
    pointerStore: recoveringPlane.pointerStore,
    policy: PUBLICATION_POLICY,
    now: () => NOW,
    receiptId: "receipt-recoverable",
  });
  assert.equal(recovered.pointer.sequence, 1);
  assert.equal(recovered.receipt.state, "promoted");
}

// Publish recovery fails closed when the adapter returns a schema-invalid pointer.
{
  const invalidPointerPlane = createMemoryCloudDataPlane();
  let failFinalize = true;
  const ledger = {
    ...invalidPointerPlane.ledger,
    async markPromoted(receipt) {
      if (failFinalize) throw new Error("injected invalid-pointer setup failure");
      return invalidPointerPlane.ledger.markPromoted(receipt);
    },
  };
  await assert.rejects(
    publishGeneration({
      manifest: firstManifest,
      payloads: payloadMap(firstManifest, firstValues),
      expectedPointerSequence: 0,
      objectStore: invalidPointerPlane.objectStore,
      ledger,
      pointerStore: invalidPointerPlane.pointerStore,
      policy: PUBLICATION_POLICY,
      now: () => NOW,
      receiptId: "receipt-invalid-pointer",
    }),
    /injected invalid-pointer setup failure/,
  );
  failFinalize = false;
  const promotedPointer = await invalidPointerPlane.pointerStore.get();
  await assert.rejects(
    publishGeneration({
      manifest: firstManifest,
      payloads: payloadMap(firstManifest, firstValues),
      expectedPointerSequence: 0,
      objectStore: invalidPointerPlane.objectStore,
      ledger,
      pointerStore: {
        async get() {
          return { ...promotedPointer, previous: promotedPointer.active };
        },
      },
      policy: PUBLICATION_POLICY,
      now: () => NOW,
      receiptId: "receipt-invalid-pointer",
    }),
    /POINTER_INVALID/,
  );
  assert.equal((await invalidPointerPlane.ledger.get("receipt-invalid-pointer")).state, "prepared");
}

// Rollback is limited to the pointer's verified previous generation and increments sequence.
{
  const rollback = await rollbackGeneration({
    expectedPointerSequence: 2,
    objectStore: plane.objectStore,
    ledger: plane.ledger,
    pointerStore: plane.pointerStore,
    now: () => NOW,
    receiptId: "receipt-rollback",
  });
  assert.equal(rollback.pointer.sequence, 3);
  assert.equal(rollback.receipt.operation, "rollback");
  assert.equal(rollback.pointer.active.generation_id, "generation-1");
  assert.equal(rollback.pointer.previous.generation_id, "generation-2");

  const restored = await resolvePublicAsset({
    publicPath: "public/data/market.json",
    pointerStore: plane.pointerStore,
    objectStore: plane.objectStore,
  });
  assert.equal(restored.kind, "ok");
  assert.deepEqual(restored.bytes, encoder.encode(firstValues["public/data/market.json"]));
}

// Rollback proves its target from the manifest and ONE object listing, never by
// downloading payload bodies. The listing establishes presence and declared
// length; the stored bytes are not re-hashed here.
{
  const listingPlane = createMemoryCloudDataPlane();
  await publishGeneration({
    manifest: firstManifest,
    payloads: payloadMap(firstManifest, firstValues),
    expectedPointerSequence: 0,
    objectStore: listingPlane.objectStore,
    ledger: listingPlane.ledger,
    pointerStore: listingPlane.pointerStore,
    policy: PUBLICATION_POLICY,
    now: () => NOW,
    receiptId: "receipt-listing-first",
  });
  await publishGeneration({
    manifest: secondManifest,
    payloads: payloadMap(secondManifest, secondValues),
    expectedPointerSequence: 1,
    objectStore: listingPlane.objectStore,
    ledger: listingPlane.ledger,
    pointerStore: listingPlane.pointerStore,
    policy: PUBLICATION_POLICY,
    now: () => NOW,
    receiptId: "receipt-listing-second",
  });
  const targetKey = firstManifest.assets[0].object_key;

  // An object the listing does not report is refused before any pointer move.
  const holedStore = {
    ...listingPlane.objectStore,
    async list() {
      return (await listingPlane.objectStore.list()).filter((entry) => entry.key !== targetKey);
    },
  };
  await assert.rejects(
    rollbackGeneration({
      expectedPointerSequence: 2,
      objectStore: holedStore,
      ledger: listingPlane.ledger,
      pointerStore: listingPlane.pointerStore,
      now: () => NOW,
      receiptId: "receipt-listing-holed",
    }),
    /ROLLBACK_PAYLOAD_INVALID/,
  );
  assert.equal((await listingPlane.pointerStore.get()).sequence, 2);

  // A listed length that contradicts the manifest is refused the same way.
  const shrunkStore = {
    ...listingPlane.objectStore,
    async list() {
      return (await listingPlane.objectStore.list())
        .map((entry) => (entry.key === targetKey ? { ...entry, bytes: entry.bytes - 1 } : entry));
    },
  };
  await assert.rejects(
    rollbackGeneration({
      expectedPointerSequence: 2,
      objectStore: shrunkStore,
      ledger: listingPlane.ledger,
      pointerStore: listingPlane.pointerStore,
      now: () => NOW,
      receiptId: "receipt-listing-shrunk",
    }),
    /ROLLBACK_PAYLOAD_INVALID/,
  );
  assert.equal((await listingPlane.pointerStore.get()).sequence, 2);

  // The healthy path reads exactly one object: the target manifest.
  const fetched = [];
  const countingStore = {
    ...listingPlane.objectStore,
    async get(key) {
      fetched.push(key);
      return listingPlane.objectStore.get(key);
    },
  };
  const listed = await rollbackGeneration({
    expectedPointerSequence: 2,
    objectStore: countingStore,
    ledger: listingPlane.ledger,
    pointerStore: listingPlane.pointerStore,
    now: () => NOW,
    receiptId: "receipt-listing-rollback",
  });
  assert.equal(listed.pointer.sequence, 3);
  assert.equal(listed.pointer.active.generation_id, "generation-1");
  assert.deepEqual(fetched, ["manifests/generation-1.json"]);
}

// Rollback uses the promoted pointer receipt to finish after a post-CAS ledger failure.
{
  const rollbackPlane = createMemoryCloudDataPlane();
  await publishGeneration({
    manifest: firstManifest,
    payloads: payloadMap(firstManifest, firstValues),
    expectedPointerSequence: 0,
    objectStore: rollbackPlane.objectStore,
    ledger: rollbackPlane.ledger,
    pointerStore: rollbackPlane.pointerStore,
    policy: PUBLICATION_POLICY,
    now: () => NOW,
    receiptId: "receipt-rb-first",
  });
  await publishGeneration({
    manifest: secondManifest,
    payloads: payloadMap(secondManifest, secondValues),
    expectedPointerSequence: 1,
    objectStore: rollbackPlane.objectStore,
    ledger: rollbackPlane.ledger,
    pointerStore: rollbackPlane.pointerStore,
    policy: PUBLICATION_POLICY,
    now: () => NOW,
    receiptId: "receipt-rb-second",
  });
  let failRollbackFinalize = true;
  const rollbackLedger = {
    ...rollbackPlane.ledger,
    async markPromoted(receipt) {
      if (receipt.receipt_id === "receipt-rb-recover" && failRollbackFinalize) {
        throw new Error("injected rollback finalize failure");
      }
      return rollbackPlane.ledger.markPromoted(receipt);
    },
  };
  await assert.rejects(
    rollbackGeneration({
      expectedPointerSequence: 2,
      objectStore: rollbackPlane.objectStore,
      ledger: rollbackLedger,
      pointerStore: rollbackPlane.pointerStore,
      now: () => NOW,
      receiptId: "receipt-rb-recover",
    }),
    /injected rollback finalize failure/,
  );
  assert.equal((await rollbackPlane.pointerStore.get()).sequence, 3);
  failRollbackFinalize = false;
  const recoveredRollback = await rollbackGeneration({
    expectedPointerSequence: 2,
    objectStore: rollbackPlane.objectStore,
    ledger: rollbackLedger,
    pointerStore: rollbackPlane.pointerStore,
    now: () => NOW,
    receiptId: "receipt-rb-recover",
  });
  assert.equal(recoveredRollback.pointer.sequence, 3);
  assert.equal(recoveredRollback.receipt.state, "promoted");
  assert.equal(recoveredRollback.receipt.operation, "rollback");
  assert.equal(recoveredRollback.pointer.active.generation_id, "generation-1");
}

// Rollback recovery also rejects a syntactically valid receipt bound to another sequence.
{
  let markCalled = false;
  const currentPointer = await plane.pointerStore.get();
  const evilReceipt = {
    ...first.receipt,
    receipt_id: currentPointer.prepared_receipt_id,
    state: "prepared",
    generation_id: currentPointer.active.generation_id,
    manifest_sha256: currentPointer.active.manifest_sha256,
    source_sha: currentPointer.source_sha,
    expected_pointer_sequence: 999,
    promoted_pointer_sequence: null,
  };
  await assert.rejects(
    rollbackGeneration({
      expectedPointerSequence: currentPointer.sequence - 1,
      objectStore: plane.objectStore,
      ledger: {
        async get() {
          return evilReceipt;
        },
        async markPromoted() {
          markCalled = true;
        },
      },
      pointerStore: plane.pointerStore,
      receiptId: currentPointer.prepared_receipt_id,
    }),
    /STALE_WRITER/,
  );
  assert.equal(markCalled, false);
}

// A normal publish receipt can never be mistaken for a rollback retry.
{
  const publishedPlane = createMemoryCloudDataPlane();
  await publishGeneration({
    manifest: firstManifest,
    payloads: payloadMap(firstManifest, firstValues),
    expectedPointerSequence: 0,
    objectStore: publishedPlane.objectStore,
    ledger: publishedPlane.ledger,
    pointerStore: publishedPlane.pointerStore,
    policy: PUBLICATION_POLICY,
    now: () => NOW,
  });
  await publishGeneration({
    manifest: secondManifest,
    payloads: payloadMap(secondManifest, secondValues),
    expectedPointerSequence: 1,
    objectStore: publishedPlane.objectStore,
    ledger: publishedPlane.ledger,
    pointerStore: publishedPlane.pointerStore,
    policy: PUBLICATION_POLICY,
    now: () => NOW,
  });
  await assert.rejects(
    rollbackGeneration({
      expectedPointerSequence: 1,
      objectStore: publishedPlane.objectStore,
      ledger: publishedPlane.ledger,
      pointerStore: publishedPlane.pointerStore,
      now: () => NOW,
    }),
    /STALE_WRITER/,
  );
  assert.equal((await publishedPlane.pointerStore.get()).active.generation_id, "generation-2");
}

// A payload mismatch is rejected before immutable writes or pointer mutation.
{
  const isolated = createMemoryCloudDataPlane();
  const badPayloads = payloadMap(firstManifest, firstValues);
  badPayloads.set("public/data/market.json", encoder.encode("{\"tampered\":true}\n"));
  await assert.rejects(
    publishGeneration({
      manifest: firstManifest,
      payloads: badPayloads,
      expectedPointerSequence: 0,
      objectStore: isolated.objectStore,
      ledger: isolated.ledger,
      pointerStore: isolated.pointerStore,
      policy: PUBLICATION_POLICY,
      now: () => NOW,
      receiptId: "receipt-bad",
    }),
    /PAYLOAD_INTEGRITY_INVALID/,
  );
  assert.deepEqual(isolated.inspect().object_keys, []);
  assert.equal(isolated.inspect().pointer, null);
}

console.log("test-cloud-data-plane-generation: ok");
