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

// The same wiring worker.ts uses: route first, enrolled assets second (plane,
// then ASSETS fallback), application afterwards.
const ENTRY_SOURCE = [
  'import { handleCloudDataPlaneRequest } from "./cloud-data-plane-worker-route.mjs";',
  'import { handleCloudDataPlaneAsset, isEnrolledPath } from "./cloud-data-plane-worker-read.mjs";',
  'export { CloudDataPlaneCoordinator } from "./cloud-data-plane-coordinator.mjs";',
  "export default {",
  "  async fetch(request, env) {",
  "    const routed = await handleCloudDataPlaneRequest(request, env);",
  "    if (routed) return routed;",
  "    if (isEnrolledPath(new URL(request.url).pathname)) {",
  "      const served = await handleCloudDataPlaneAsset(request, env);",
  "      if (served) return served;",
  "      const assets = env.ASSETS;",
  "      if (assets) return assets.fetch(request);",
  "    }",
  '    return new Response("application handler", { status: 200 });',
  "  },",
  "};",
  "",
].join("\n");

async function createWorker(bindings) {
  return new Miniflare({
    workers: [{
      compatibilityDate: "2026-05-16",
      compatibilityFlags: ["nodejs_compat"],
      bindings,
      serviceBindings: { ASSETS: { name: "assets" } },
      r2Buckets: ["DATA_PLANE_BUCKET"],
      durableObjects: { CLOUD_DATA_PLANE_COORDINATOR: "CloudDataPlaneCoordinator" },
      modules: [
        { type: "ESModule", path: "entry.mjs", contents: ENTRY_SOURCE },
        {
          type: "ESModule",
          path: "cloud-data-plane-worker-route.mjs",
          contents: await moduleSource("cloud-data-plane-worker-route.mjs"),
        },
        {
          type: "ESModule",
          path: "cloud-data-plane-worker-read.mjs",
          contents: await moduleSource("cloud-data-plane-worker-read.mjs"),
        },
        {
          type: "ESModule",
          path: "cloud-data-plane-cloudflare-adapter.mjs",
          contents: await moduleSource("cloud-data-plane-cloudflare-adapter.mjs"),
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
    }, {
      // The bundled-copy stand-in: whatever the plane declines, ASSETS serves.
      name: "assets",
      compatibilityDate: "2026-05-16",
      compatibilityFlags: ["nodejs_compat"],
      modules: [{
        type: "ESModule",
        path: "entry.mjs",
        contents: 'export default { fetch() { return new Response("assets fallback"); } };',
      }],
    }],
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

  // --- the read side mounted like worker.ts: enrolled serves, else ASSETS ---
  const readGet = (pathname) => worker.dispatchFetch(`https://worker.test${pathname}`);

  // Enrolled but its family has no pointer: the plane declines and ASSETS
  // serves the bundled copy.
  const unresolved = await readGet("/data/yardney/yardney_model.json");
  assert.equal(unresolved.status, 200);
  assert.equal(await unresolved.text(), "assets fallback");
  assert.equal(unresolved.headers.get("x-data-plane-published-at"), null, "fallback gains no plane heartbeat");

  // Enrolled tree path whose family has nothing published: same fallback.
  const emptyTree = await readGet("/data/edgar-korean-summaries/index.json");
  assert.equal(emptyTree.status, 200);
  assert.equal(await emptyTree.text(), "assets fallback");
  assert.equal(emptyTree.headers.get("x-data-plane-published-at"), null, "fallback gains no plane heartbeat");

  // The computed-signals pilot is exact-path enrolled, but an empty family
  // pointer still falls through to the bundled copy.
  const computedFallback = await readGet("/data/computed/signals.json");
  assert.equal(computedFallback.status, 200);
  assert.equal(await computedFallback.text(), "assets fallback");
  assert.equal(computedFallback.headers.get("x-data-plane-published-at"), null, "computed fallback gains no plane heartbeat");

  // Never enrolled: the application handler owns it.
  const unenrolled = await readGet("/data/macro/other.json");
  assert.equal(unenrolled.status, 200);
  assert.equal(await unenrolled.text(), "application handler");
  assert.equal(unenrolled.headers.get("x-data-plane-published-at"), null, "application response gains no plane heartbeat");

  // Siblings of enrolled trees must not match the bounded prefixes.
  const nearMiss = await readGet("/data/edgar-korean-summaries-evil/index.json");
  assert.equal(nearMiss.status, 200);
  assert.equal(await nearMiss.text(), "application handler");

  const stocksNearMiss = await readGet("/data/slickcharts/stocks-evil/AAPL.json");
  assert.equal(stocksNearMiss.status, 200);
  assert.equal(await stocksNearMiss.text(), "application handler");

  // Malformed tree remainders stay on the application handler, never ASSETS.
  const bareTree = await readGet("/data/edgar-korean-summaries/");
  assert.equal(bareTree.status, 200);
  assert.equal(await bareTree.text(), "application handler");

  const emptySegment = await readGet("/data/edgar-korean-summaries//index.json");
  assert.equal(emptySegment.status, 200);
  assert.equal(await emptySegment.text(), "application handler");

  const trailingSlash = await readGet("/data/edgar-korean-summaries/index.json/");
  assert.equal(trailingSlash.status, 200);
  assert.equal(await trailingSlash.text(), "application handler");

  // URL parsing normalizes a "../" segment before the worker sees it; it
  // arrives as a different, unenrolled path and stays on the application
  // handler. The segment-level rejection itself is proven at unit level.
  const dotDotSegment = await readGet("/data/edgar-korean-summaries/../index.json");
  assert.equal(dotDotSegment.status, 200);
  assert.equal(await dotDotSegment.text(), "application handler");

  // Enrolled and bound: served from the plane with generation attribution.
  const readValues = { "public/data/macro/fred-macro.json": "{\"series\":{\"DGS10\":[1,2,3]}}\n" };
  const readManifest = buildManifest(
    "read-proof-1",
    Object.entries(readValues).map(([path, text]) => ({ path, text })),
  );
  const fredSequence = (await familyPlane.pointerStore.get()).sequence;
  const readPublished = await publishGeneration({
    manifest: readManifest,
    payloads: new Map(Object.entries(readValues).map(([p, t]) => [p, encoder.encode(t)])),
    expectedPointerSequence: fredSequence,
    objectStore: familyPlane.objectStore,
    ledger: familyPlane.ledger,
    pointerStore: familyPlane.pointerStore,
    policy: POLICY,
  });
  assert.equal(readPublished.pointer.sequence, fredSequence + 1);

  const served = await readGet("/data/macro/fred-macro.json");
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("x-data-plane-generation"), "read-proof-1");
  assert.equal(served.headers.get("x-data-plane-published-at"), NOW);
  assert.equal(await served.text(), "{\"series\":{\"DGS10\":[1,2,3]}}\n");

  const computedValues = { "public/data/computed/signals.json": "{\"source_as_of\":\"2026-07-29\",\"signals\":{}}\n" };
  const computedManifest = buildManifest(
    "computed-route-1",
    Object.entries(computedValues).map(([path, text]) => ({ path, text })),
  );
  const computedPlane = createCloudflareCloudDataPlane({
    r2Bucket,
    coordinatorNamespace: createRouteCoordinatorNamespace(worker, WRITE_KEY, "computed-signals"),
  });
  await publishGeneration({
    manifest: computedManifest,
    payloads: new Map(Object.entries(computedValues).map(([p, t]) => [p, encoder.encode(t)])),
    expectedPointerSequence: 0,
    objectStore: computedPlane.objectStore,
    ledger: computedPlane.ledger,
    pointerStore: computedPlane.pointerStore,
    policy: POLICY,
  });
  const computedServed = await readGet("/data/computed/signals.json");
  assert.equal(computedServed.status, 200);
  assert.equal(computedServed.headers.get("x-data-plane-generation"), "computed-route-1");
  assert.equal(await computedServed.text(), computedValues["public/data/computed/signals.json"]);
  const computedUnenrolled = await readGet("/data/computed/other.json");
  assert.equal(computedUnenrolled.status, 200);
  assert.equal(await computedUnenrolled.text(), "application handler");

  const servedHead = await worker.dispatchFetch("https://worker.test/data/macro/fred-macro.json", {
    method: "HEAD",
  });
  assert.equal(servedHead.status, 200);
  assert.equal(servedHead.headers.get("x-data-plane-published-at"), NOW);
  assert.equal(await servedHead.text(), "");

  // Tree family through the mounted worker: one EDGAR asset publishes and
  // serves, and an enrolled tree path without a binding falls back to ASSETS.
  const edgarPlane = createCloudflareCloudDataPlane({
    r2Bucket,
    coordinatorNamespace: createRouteCoordinatorNamespace(worker, WRITE_KEY, "edgar-korean-summaries"),
  });
  const edgarValues = { "public/data/edgar-korean-summaries/index.json": "{\"updated\":\"2026-08-10\"}\n" };
  const edgarManifest = buildManifest(
    "edgar-read-1",
    Object.entries(edgarValues).map(([path, text]) => ({ path, text })),
  );
  const edgarPublished = await publishGeneration({
    manifest: edgarManifest,
    payloads: new Map(Object.entries(edgarValues).map(([p, t]) => [p, encoder.encode(t)])),
    expectedPointerSequence: 0,
    objectStore: edgarPlane.objectStore,
    ledger: edgarPlane.ledger,
    pointerStore: edgarPlane.pointerStore,
    policy: POLICY,
  });
  assert.equal(edgarPublished.pointer.sequence, 1);

  const edgarServed = await readGet("/data/edgar-korean-summaries/index.json");
  assert.equal(edgarServed.status, 200);
  assert.equal(edgarServed.headers.get("x-data-plane-generation"), "edgar-read-1");
  assert.equal(edgarServed.headers.get("x-data-plane-published-at"), NOW);
  assert.equal(await edgarServed.text(), "{\"updated\":\"2026-08-10\"}\n");

  const edgarMissing = await readGet("/data/edgar-korean-summaries/not-published.json");
  assert.equal(edgarMissing.status, 200);
  assert.equal(await edgarMissing.text(), "assets fallback");
  assert.equal(edgarMissing.headers.get("x-data-plane-published-at"), null, "fallback gains no plane heartbeat");

  console.log("test-cloud-data-plane-worker-route: ok"
    + " (refusal, publish, error transit, per-family pointer isolation,"
    + " and read-side enrolled serving with ASSETS fallback for unresolved,"
    + " unenrolled, and tree-near-miss paths)");
} finally {
  await worker.dispose();
  await unconfigured.dispose();
}
