#!/usr/bin/env node
// Proof for the authenticated data-plane route that worker.ts mounts.
//
// The route is the only way a CI writer can reach the pointer's real
// compare-and-swap, so its refusals matter as much as its successes: an
// unauthenticated caller, an unknown action, a missing secret and an oversized
// body must each fail in a distinguishable way, and a contract error must cross
// HTTP with its code intact.
//
// Everything runs on Miniflare-emulated bindings. No Cloudflare resource is
// created and no network call leaves this process.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import {
  GENERATION_MANIFEST_SCHEMA,
  publishGeneration,
  resolvePublicAsset,
  sha256Bytes,
} from "./lib/cloud-data-plane-generation.mjs";
import { createCloudflareCloudDataPlane } from "./lib/cloud-data-plane-cloudflare-adapter.mjs";

const require = createRequire(new URL("../100xfenok-next/package.json", import.meta.url));
const { Miniflare } = require("miniflare");

const WRITE_KEY = "k".repeat(64);
const SOURCE_SHA = "b".repeat(64);
const NOW = "2026-08-03T03:00:00.000Z";
const ROUTE = "https://worker.test/internal/cloud-data-plane";
const encoder = new TextEncoder();

const moduleSource = async (name) => readFile(new URL(`./lib/${name}`, import.meta.url), "utf8");

// The same wiring worker.ts uses: route first, application afterwards.
const ENTRY_SOURCE = [
  'import { handleCloudDataPlaneRequest } from "./cloud-data-plane-worker-route.mjs";',
  'export { CloudDataPlaneCoordinator } from "./cloud-data-plane-coordinator.mjs";',
  "export default {",
  "  async fetch(request, env) {",
  "    const routed = await handleCloudDataPlaneRequest(request, env);",
  "    if (routed) return routed;",
  '    return new Response("application handler", { status: 200 });',
  "  },",
  "};",
  "",
].join("\n");

async function createWorker(bindings) {
  return new Miniflare({
    compatibilityDate: "2026-05-16",
    compatibilityFlags: ["nodejs_compat"],
    modules: [
      { type: "ESModule", path: "entry.mjs", contents: ENTRY_SOURCE },
      {
        type: "ESModule",
        path: "cloud-data-plane-worker-route.mjs",
        contents: await moduleSource("cloud-data-plane-worker-route.mjs"),
      },
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
    bindings,
    r2Buckets: ["DATA_PLANE_BUCKET"],
    durableObjects: { CLOUD_DATA_PLANE_COORDINATOR: "CloudDataPlaneCoordinator" },
  });
}

function post(worker, action, { key = WRITE_KEY, body = "{}", method = "POST", family = null } = {}) {
  const headers = { "content-type": "application/json" };
  if (key !== null) headers["x-data-plane-key"] = key;
  if (family !== null) headers["x-data-plane-family"] = family;
  return worker.dispatchFetch(`${ROUTE}/${action}`, { method, headers, body: method === "POST" ? body : undefined });
}

async function errorCode(response) {
  const payload = await response.json();
  return payload?.error?.code ?? null;
}

// The wire shim the CI publisher uses: it turns the adapter's Durable Object
// stub calls into authenticated HTTPS calls against the route.
function createRouteCoordinatorNamespace(worker, key = WRITE_KEY, family = null) {
  return {
    idFromName(name) {
      return { name };
    },
    get() {
      return {
        async fetch(url, init) {
          const { pathname } = new URL(url);
          const headers = { "content-type": "application/json", "x-data-plane-key": key };
          if (family !== null) headers["x-data-plane-family"] = family;
          return worker.dispatchFetch(`${ROUTE}${pathname}`, {
            method: "POST",
            headers,
            body: init?.body ?? "{}",
          });
        },
      };
    },
  };
}

function buildManifest(generationId, entries) {
  return {
    schema_version: GENERATION_MANIFEST_SCHEMA,
    generation_id: generationId,
    source_sha: SOURCE_SHA,
    created_at: NOW,
    assets: entries
      .map(({ path, text }) => {
        const bytes = encoder.encode(text);
        const sha256 = sha256Bytes(bytes);
        return {
          path,
          object_key: `objects/sha256/${sha256}`,
          sha256,
          bytes: bytes.byteLength,
          content_type: "application/json",
          source_as_of: "2026-08-03",
          privacy_class: "public",
        };
      })
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
}

const POLICY = {
  max_assets: 10,
  max_total_bytes: 100_000,
  validate_freshness: () => true,
  validate_public_payload: () => true,
};

const worker = await createWorker({ DATA_PLANE_WRITE_KEY: WRITE_KEY });
const unconfigured = await createWorker({ DATA_PLANE_WRITE_KEY: "" });

try {
  // --- the door refuses correctly ------------------------------------------
  const applicationPath = await worker.dispatchFetch("https://worker.test/anything-else");
  assert.equal(applicationPath.status, 200);
  assert.equal(await applicationPath.text(), "application handler");

  const wrongMethod = await post(worker, "pointer/get", { method: "GET" });
  assert.equal(wrongMethod.status, 405);
  assert.equal(await errorCode(wrongMethod), "METHOD_NOT_ALLOWED");

  const unknownAction = await post(worker, "pointer/delete-everything");
  assert.equal(unknownAction.status, 404);
  assert.equal(await errorCode(unknownAction), "COORDINATOR_ACTION_UNKNOWN");

  const noKey = await post(worker, "pointer/get", { key: null });
  assert.equal(noKey.status, 401);
  assert.equal(await errorCode(noKey), "DATA_PLANE_KEY_REJECTED");

  const wrongKey = await post(worker, "pointer/get", { key: "x".repeat(64) });
  assert.equal(wrongKey.status, 401);
  assert.equal(await errorCode(wrongKey), "DATA_PLANE_KEY_REJECTED");

  // A prefix of the real key must not pass: the compare is on the whole value.
  const prefixKey = await post(worker, "pointer/get", { key: WRITE_KEY.slice(0, 40) });
  assert.equal(prefixKey.status, 401);

  const missingSecret = await post(unconfigured, "pointer/get");
  assert.equal(missingSecret.status, 503);
  assert.equal(await errorCode(missingSecret), "DATA_PLANE_KEY_UNCONFIGURED");

  const oversized = await post(worker, "ledger/prepare", { body: "x".repeat(70_000) });
  assert.equal(oversized.status, 413);
  assert.equal(await errorCode(oversized), "DATA_PLANE_BODY_TOO_LARGE");

  // --- the door opens for the writer ---------------------------------------
  const emptyPointer = await post(worker, "pointer/get");
  assert.equal(emptyPointer.status, 200);
  assert.deepEqual(await emptyPointer.json(), { result: null });

  const r2Bucket = await worker.getR2Bucket("DATA_PLANE_BUCKET");
  const plane = createCloudflareCloudDataPlane({
    r2Bucket,
    coordinatorNamespace: createRouteCoordinatorNamespace(worker),
  });

  const values = {
    "public/data/pilot/route-alpha.json": "{\"route\":\"alpha\"}\n",
    "public/data/pilot/route-beta.json": "{\"route\":\"beta\"}\n",
  };
  const manifest = buildManifest("route-proof-1", Object.entries(values).map(([path, text]) => ({ path, text })));
  const payloads = new Map(Object.entries(values).map(([path, text]) => [path, encoder.encode(text)]));

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

  for (const [path, text] of Object.entries(values)) {
    const resolved = await resolvePublicAsset({
      publicPath: path,
      pointerStore: plane.pointerStore,
      objectStore: plane.objectStore,
    });
    assert.equal(resolved.kind, "ok");
    assert.deepEqual(resolved.bytes, encoder.encode(text));
  }

  // --- a contract error survives the HTTP hop -------------------------------
  // This is the property the route exists for: the writer's control flow is the
  // contract's error codes, so STALE_WRITER must arrive as STALE_WRITER.
  const second = buildManifest("route-proof-2", [
    { path: "public/data/pilot/route-gamma.json", text: "{\"route\":\"gamma\"}\n" },
  ]);
  await assert.rejects(
    publishGeneration({
      manifest: second,
      payloads: new Map([[
        "public/data/pilot/route-gamma.json",
        encoder.encode("{\"route\":\"gamma\"}\n"),
      ]]),
      expectedPointerSequence: 0,
      objectStore: plane.objectStore,
      ledger: plane.ledger,
      pointerStore: plane.pointerStore,
      policy: POLICY,
    }),
    (error) => {
      assert.equal(error.code, "STALE_WRITER");
      return true;
    },
  );

  // An unauthenticated shim must fail closed rather than write anything.
  const rejectedPlane = createCloudflareCloudDataPlane({
    r2Bucket,
    coordinatorNamespace: createRouteCoordinatorNamespace(worker, "z".repeat(64)),
  });
  await assert.rejects(rejectedPlane.pointerStore.get(), (error) => {
    assert.equal(error.code, "DATA_PLANE_KEY_REJECTED");
    return true;
  });

  const pointerAfter = await plane.pointerStore.get();
  assert.equal(pointerAfter.sequence, 1);
  assert.equal(pointerAfter.active.generation_id, "route-proof-1");

  // --- families do not share a pointer -------------------------------------
  // The defect this replaces was only visible with two families live: one
  // shared instance meant each family's publish displaced the last.
  const legacyPointer = await post(worker, "pointer/get");
  assert.equal(legacyPointer.headers.get("x-data-plane-coordinator"), "cloud-data-plane-coordinator");
  assert.deepEqual((await legacyPointer.json()).result?.active?.generation_id, "route-proof-1");

  const otherFamily = await post(worker, "pointer/get", { family: "fred-macro" });
  assert.equal(otherFamily.status, 200);
  assert.equal(otherFamily.headers.get("x-data-plane-coordinator"), "fred-macro");
  assert.deepEqual(await otherFamily.json(), { result: null }, "a different family sees its own empty pointer");

  const badFamily = await post(worker, "pointer/get", { family: "../escape" });
  assert.equal(badFamily.status, 400);
  assert.equal(await errorCode(badFamily), "DATA_PLANE_FAMILY_INVALID");

  // A publish under one family must leave the other family untouched.
  const familyPlane = createCloudflareCloudDataPlane({
    r2Bucket,
    coordinatorNamespace: createRouteCoordinatorNamespace(worker, WRITE_KEY, "fred-macro"),
  });
  const familyValues = { "public/data/pilot/family-alpha.json": "{\"family\":\"fred\"}\n" };
  const familyManifest = buildManifest(
    "family-proof-1",
    Object.entries(familyValues).map(([path, text]) => ({ path, text })),
  );
  const familyPublished = await publishGeneration({
    manifest: familyManifest,
    payloads: new Map(Object.entries(familyValues).map(([p, t]) => [p, encoder.encode(t)])),
    expectedPointerSequence: 0,
    objectStore: familyPlane.objectStore,
    ledger: familyPlane.ledger,
    pointerStore: familyPlane.pointerStore,
    policy: POLICY,
  });
  assert.equal(familyPublished.pointer.sequence, 1, "the new family starts its own sequence at 1");

  const legacyUnchanged = await plane.pointerStore.get();
  assert.equal(legacyUnchanged.sequence, 1);
  assert.equal(
    legacyUnchanged.active.generation_id,
    "route-proof-1",
    "publishing another family must not displace this one",
  );

  console.log("test-cloud-data-plane-worker-route: ok"
    + " (refusal, publish, error transit, and per-family pointer isolation)");
} finally {
  await worker.dispose();
  await unconfigured.dispose();
}
