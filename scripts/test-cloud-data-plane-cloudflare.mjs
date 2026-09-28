#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import {
  GENERATION_MANIFEST_SCHEMA,
  publishGeneration,
  resolvePublicAsset,
  rollbackGeneration,
  sha256Bytes,
} from "./lib/cloud-data-plane-generation.mjs";
import { createCloudflareCloudDataPlane } from "./lib/cloud-data-plane-cloudflare-adapter.mjs";

const require = createRequire(new URL("../100xfenok-next/package.json", import.meta.url));
const { Miniflare } = require("miniflare");

const SOURCE_SHA = "a".repeat(64);
const NOW = "2026-08-02T12:00:00.000Z";
const encoder = new TextEncoder();

// The worker modules are the real adapter-side files, mounted into Miniflare
// under a flat virtual root so their relative imports keep resolving.
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
  r2Buckets: ["CLOUD_OBJECTS"],
  durableObjects: { CLOUD_COORDINATOR: "CloudDataPlaneCoordinator" },
});

const r2Bucket = await miniflare.getR2Bucket("CLOUD_OBJECTS");
const coordinatorNamespace = await miniflare.getDurableObjectNamespace("CLOUD_COORDINATOR");
const plane = createCloudflareCloudDataPlane({ r2Bucket, coordinatorNamespace });

async function assertRejectsCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

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

// Representative OECD-shaped payload set: one private source snapshot plus two
// public indicator bundles under the contract's public/ prefixes.
const firstValues = {
  "data/oecd/source-snapshot.json": "{\"source\":\"oecd-sdmx\",\"secret\":\"redacted\"}\n",
  "public/data/oecd/cli.json": "{\"country\":\"USA\",\"indicator\":\"CLI\",\"value\":100.4}\n",
  "public/data/oecd/pmi.json": "{\"country\":\"USA\",\"indicator\":\"PMI\",\"value\":51.2}\n",
};
const firstManifest = buildManifest("oecd-generation-1", [
  {
    path: "data/oecd/source-snapshot.json",
    text: firstValues["data/oecd/source-snapshot.json"],
    privacy_class: "private",
  },
  { path: "public/data/oecd/cli.json", text: firstValues["public/data/oecd/cli.json"] },
  { path: "public/data/oecd/pmi.json", text: firstValues["public/data/oecd/pmi.json"] },
]);

try {
  const first = await publishGeneration({
    manifest: firstManifest,
    payloads: payloadMap(firstManifest, firstValues),
    expectedPointerSequence: 0,
    objectStore: plane.objectStore,
    ledger: plane.ledger,
    pointerStore: plane.pointerStore,
    policy: PUBLICATION_POLICY,
    now: () => NOW,
    receiptId: "receipt-oecd-1",
  });
  assert.equal(first.pointer.sequence, 1);
  assert.equal(first.receipt.state, "promoted");

  // Evidence a: every public asset resolves byte-identical to its input payload.
  for (const asset of firstManifest.assets.filter((entry) => entry.privacy_class === "public")) {
    const result = await resolvePublicAsset({
      publicPath: asset.path,
      pointerStore: plane.pointerStore,
      objectStore: plane.objectStore,
    });
    assert.equal(result.kind, "ok");
    assert.deepEqual(result.bytes, encoder.encode(firstValues[asset.path]));
    assert.equal(result.generation_id, "oecd-generation-1");
  }
  const privateResult = await resolvePublicAsset({
    publicPath: "data/oecd/source-snapshot.json",
    pointerStore: plane.pointerStore,
    objectStore: plane.objectStore,
  });
  assert.deepEqual(privateResult, { kind: "not_enrolled" });

  // Evidence b: republishing the same generation is a no-op, and conflicting
  // bytes under an existing object key are rejected.
  {
    const keysBefore = (await plane.inspect()).object_keys;
    const republished = await publishGeneration({
      manifest: firstManifest,
      payloads: payloadMap(firstManifest, firstValues),
      expectedPointerSequence: 0,
      objectStore: plane.objectStore,
      ledger: plane.ledger,
      pointerStore: plane.pointerStore,
      policy: PUBLICATION_POLICY,
      now: () => NOW,
      receiptId: "receipt-oecd-1",
    });
    assert.equal(republished.pointer.sequence, 1);
    assert.equal(republished.receipt.state, "promoted");
    assert.deepEqual((await plane.inspect()).object_keys, keysBefore);

    const objectKey = firstManifest.assets.find(
      (asset) => asset.path === "public/data/oecd/cli.json",
    ).object_key;
    await plane.objectStore.putIfAbsent(objectKey, encoder.encode(firstValues["public/data/oecd/cli.json"]));
    await assertRejectsCode(
      plane.objectStore.putIfAbsent(objectKey, encoder.encode("{\"tampered\":true}\n")),
      "IMMUTABILITY_VIOLATION",
    );
    assert.deepEqual(
      await plane.objectStore.get(objectKey),
      encoder.encode(firstValues["public/data/oecd/cli.json"]),
    );
  }

  // Evidence c (writer side): a stale expected sequence is rejected and the
  // pointer stays put; a skipped sequence number is rejected too.
  {
    const pointerBefore = await plane.pointerStore.get();
    await assertRejectsCode(
      plane.pointerStore.compareAndSwap(0, { ...pointerBefore, sequence: 2 }),
      "STALE_WRITER",
    );
    await assertRejectsCode(
      plane.pointerStore.compareAndSwap(1, { ...pointerBefore, sequence: 3 }),
      "POINTER_SEQUENCE_INVALID",
    );
    assert.equal((await plane.pointerStore.get()).sequence, pointerBefore.sequence);
  }

  const secondValues = {
    "data/oecd/source-snapshot.json": "{\"source\":\"oecd-sdmx\",\"secret\":\"redacted-v2\"}\n",
    "public/data/oecd/cli.json": "{\"country\":\"USA\",\"indicator\":\"CLI\",\"value\":100.9}\n",
    "public/data/oecd/pmi.json": "{\"country\":\"USA\",\"indicator\":\"PMI\",\"value\":50.8}\n",
  };
  const secondManifest = buildManifest("oecd-generation-2", [
    {
      path: "data/oecd/source-snapshot.json",
      text: secondValues["data/oecd/source-snapshot.json"],
      privacy_class: "private",
    },
    { path: "public/data/oecd/cli.json", text: secondValues["public/data/oecd/cli.json"] },
    { path: "public/data/oecd/pmi.json", text: secondValues["public/data/oecd/pmi.json"] },
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
    receiptId: "receipt-oecd-2",
  });
  assert.equal(second.pointer.sequence, 2);
  assert.equal(second.pointer.previous.generation_id, "oecd-generation-1");

  // Evidence d: rollback restores the prior pointer and the prior payloads
  // resolve byte-identically again.
  {
    const rollback = await rollbackGeneration({
      expectedPointerSequence: 2,
      objectStore: plane.objectStore,
      ledger: plane.ledger,
      pointerStore: plane.pointerStore,
      now: () => NOW,
      receiptId: "receipt-oecd-rollback",
    });
    assert.equal(rollback.pointer.sequence, 3);
    assert.equal(rollback.receipt.operation, "rollback");
    assert.equal(rollback.pointer.active.generation_id, "oecd-generation-1");
    assert.equal(rollback.pointer.previous.generation_id, "oecd-generation-2");

    for (const asset of firstManifest.assets.filter((entry) => entry.privacy_class === "public")) {
      const restored = await resolvePublicAsset({
        publicPath: asset.path,
        pointerStore: plane.pointerStore,
        objectStore: plane.objectStore,
      });
      assert.equal(restored.kind, "ok");
      assert.deepEqual(restored.bytes, encoder.encode(firstValues[asset.path]));
    }
  }

  // Evidence c (reader side): tampering with the stored manifest bytes fails
  // closed — resolve reports unavailable and the pointer never advances.
  {
    const pointerBefore = await plane.pointerStore.get();
    const manifestKey = pointerBefore.active.manifest_key;
    const manifestBytes = await plane.objectStore.get(manifestKey);
    await r2Bucket.put(manifestKey, encoder.encode("{\"schema_version\":\"tampered\"}\n"));

    const tampered = await resolvePublicAsset({
      publicPath: "public/data/oecd/cli.json",
      pointerStore: plane.pointerStore,
      objectStore: plane.objectStore,
    });
    assert.deepEqual(tampered, { kind: "unavailable", reason: "MANIFEST_INTEGRITY_UNAVAILABLE" });
    assert.equal((await plane.pointerStore.get()).sequence, pointerBefore.sequence);

    await r2Bucket.put(manifestKey, manifestBytes);
    const restored = await resolvePublicAsset({
      publicPath: "public/data/oecd/cli.json",
      pointerStore: plane.pointerStore,
      objectStore: plane.objectStore,
    });
    assert.equal(restored.kind, "ok");
    assert.deepEqual(restored.bytes, encoder.encode(firstValues["public/data/oecd/cli.json"]));
  }

  // Adapter inspect() mirrors the memory plane's shape for parity tooling.
  {
    const snapshot = await plane.inspect();
    assert.equal(snapshot.pointer.sequence, 3);
    assert.deepEqual(
      snapshot.receipts.map((receipt) => receipt.receipt_id),
      ["receipt-oecd-1", "receipt-oecd-2", "receipt-oecd-rollback"],
    );
    assert.equal(snapshot.object_keys.length, 2 + 3 + 3);
    assert.ok(snapshot.object_keys.includes("manifests/oecd-generation-1.json"));
  }

  console.log("test-cloud-data-plane-cloudflare: ok");
} finally {
  await miniflare.dispose();
}
