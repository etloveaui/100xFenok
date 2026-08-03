#!/usr/bin/env node
// Proof for the enrolled-asset read path.
//
// The property under test is almost entirely about refusal. Serving the right
// bytes when everything is healthy is the easy half; the half that protects the
// product is that every unhealthy outcome declines, so the caller falls back to
// the copy published through git. A 200 carrying anything other than the exact
// published payload is the failure this file exists to make impossible.
//
// Miniflare-emulated bindings only. No Cloudflare resource is created.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import {
  GENERATION_MANIFEST_SCHEMA,
  publishGeneration,
  sha256Bytes,
} from "./lib/cloud-data-plane-generation.mjs";
import { createCloudflareCloudDataPlane } from "./lib/cloud-data-plane-cloudflare-adapter.mjs";
import { handleCloudDataPlaneAsset } from "./lib/cloud-data-plane-worker-read.mjs";

const require = createRequire(new URL("../100xfenok-next/package.json", import.meta.url));
const { Miniflare } = require("miniflare");

const ENROLLED_URL = "https://100xfenok.test/data/macro/fred-macro.json";
const MANIFEST_PATH = "public/data/macro/fred-macro.json";
const SOURCE_SHA = "c".repeat(64);
const NOW = "2026-08-03T04:00:00.000Z";
const encoder = new TextEncoder();

const moduleSource = async (name) => readFile(new URL(`./lib/${name}`, import.meta.url), "utf8");
const ENTRY_SOURCE = [
  'export { CloudDataPlaneCoordinator } from "./cloud-data-plane-coordinator.mjs";',
  'export default { fetch() { return new Response("read-path test entry"); } };',
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
      contents: await moduleSource("cloud-data-plane-generation.mjs"),
    },
    {
      type: "ESModule",
      path: "json-canonical.mjs",
      contents: await moduleSource("json-canonical.mjs"),
    },
  ],
  r2Buckets: ["DATA_PLANE_BUCKET"],
  durableObjects: { CLOUD_DATA_PLANE_COORDINATOR: "CloudDataPlaneCoordinator" },
});

try {
  const DATA_PLANE_BUCKET = await miniflare.getR2Bucket("DATA_PLANE_BUCKET");
  const CLOUD_DATA_PLANE_COORDINATOR = await miniflare
    .getDurableObjectNamespace("CLOUD_DATA_PLANE_COORDINATOR");
  const env = { DATA_PLANE_BUCKET, CLOUD_DATA_PLANE_COORDINATOR };
  const get = (url = ENROLLED_URL, init) => new Request(url, init);

  // --- nothing published yet: every enrolled request declines ---------------
  assert.equal(await handleCloudDataPlaneAsset(get(), env), null, "no pointer declines");

  // --- refusals that do not depend on plane state ---------------------------
  assert.equal(
    await handleCloudDataPlaneAsset(get(ENROLLED_URL, { method: "POST", body: "x" }), env),
    null,
    "non-GET declines",
  );
  assert.equal(
    await handleCloudDataPlaneAsset(get("https://100xfenok.test/data/macro/other.json"), env),
    null,
    "unenrolled path declines",
  );
  assert.equal(await handleCloudDataPlaneAsset(get(), {}), null, "missing bindings decline");

  // --- publish the enrolled asset ------------------------------------------
  const payloadText = "{\"series\":{\"DGS10\":[1,2,3]}}\n";
  const payload = encoder.encode(payloadText);
  const sha256 = sha256Bytes(payload);
  const manifest = {
    schema_version: GENERATION_MANIFEST_SCHEMA,
    generation_id: "fred-macro-read-1",
    source_sha: SOURCE_SHA,
    created_at: NOW,
    assets: [{
      path: MANIFEST_PATH,
      object_key: `objects/sha256/${sha256}`,
      sha256,
      bytes: payload.byteLength,
      content_type: "application/json",
      source_as_of: "2026-08-02",
      privacy_class: "public",
    }],
  };
  const plane = createCloudflareCloudDataPlane({
    r2Bucket: DATA_PLANE_BUCKET,
    coordinatorNamespace: CLOUD_DATA_PLANE_COORDINATOR,
  });
  await publishGeneration({
    manifest,
    payloads: new Map([[MANIFEST_PATH, payload]]),
    expectedPointerSequence: 0,
    objectStore: plane.objectStore,
    ledger: plane.ledger,
    pointerStore: plane.pointerStore,
    policy: {
      max_assets: 4,
      max_total_bytes: 10_000,
      validate_freshness: () => true,
      validate_public_payload: () => true,
    },
  });

  // --- healthy: exact bytes, typed, attributed ------------------------------
  const served = await handleCloudDataPlaneAsset(get(), env);
  assert.ok(served, "healthy plane serves");
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "application/json");
  assert.equal(served.headers.get("x-data-plane-generation"), "fred-macro-read-1");
  assert.equal(served.headers.get("x-data-plane-source-as-of"), "2026-08-02");
  assert.match(served.headers.get("cache-control") ?? "", /max-age=/);
  assert.equal(await served.text(), payloadText);

  const etag = served.headers.get("etag");
  assert.ok(etag, "etag present");

  const notModified = await handleCloudDataPlaneAsset(
    get(ENROLLED_URL, { headers: { "if-none-match": etag } }),
    env,
  );
  assert.equal(notModified.status, 304, "matching etag is 304");

  const head = await handleCloudDataPlaneAsset(get(ENROLLED_URL, { method: "HEAD" }), env);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "", "HEAD carries no body");

  // --- corruption must decline, never serve --------------------------------
  // Overwrite the object out from under the manifest, which is the shape a
  // partial write or a bad actor would produce.
  await DATA_PLANE_BUCKET.put(`objects/sha256/${sha256}`, encoder.encode("{\"series\":{}}\n"));
  const corrupted = await handleCloudDataPlaneAsset(get(), env);
  assert.equal(corrupted, null, "payload whose hash disagrees declines rather than serving");

  console.log("test-cloud-data-plane-worker-read: ok"
    + " (declines with no pointer, on non-GET, off-path, unbound, and on payload corruption;"
    + " serves exact bytes with generation attribution, 304, and HEAD)");
} finally {
  await miniflare.dispose();
}
