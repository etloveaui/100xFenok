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
import {
  ENROLLED_PATHS,
  ENROLLED_PREFIXES,
  familyForPath,
  handleCloudDataPlaneAsset,
  isEnrolledPath,
} from "./lib/cloud-data-plane-worker-read.mjs";
import { FAMILIES } from "./publish-cloud-data-generation.mjs";

const require = createRequire(new URL("../100xfenok-next/package.json", import.meta.url));
const { Miniflare } = require("miniflare");

const ENROLLED_URL = "https://100xfenok.test/data/macro/fred-macro.json";
const MANIFEST_PATH = "public/data/macro/fred-macro.json";
const SOURCE_SHA = "c".repeat(64);
const NOW = "2026-08-03T04:00:00.000Z";
const encoder = new TextEncoder();

// --- read-side enrolment is derived from the publisher's FAMILIES table -----
// The worker lib cannot import the publisher (its node-only imports would
// break the bundle), so the table is hand-derived; this block proves the
// derivation is exact and stays exact as FAMILIES changes.
{
  const publicFamilies = Object.entries(FAMILIES).filter(([, f]) => f.privacy_class === "public");
  const familyByName = new Map(publicFamilies);
  const manifestPrefix = (family) => family.manifest_prefix ?? family.root;

  for (const [pathname, familyName] of ENROLLED_PATHS) {
    const family = familyByName.get(familyName);
    assert.ok(family, `enrolled family ${familyName} exists in FAMILIES`);
    if (family.files) {
      const relative = `public${pathname}`.slice(manifestPrefix(family).length + 1);
      assert.ok(
        family.files.includes(relative),
        `${pathname} is listed in FAMILIES.${familyName}.files`,
      );
    } else {
      assert.ok(
        ENROLLED_PREFIXES.some(({ prefix, family: f }) => f === familyName && pathname.startsWith(prefix)),
        `${pathname} is covered by the ${familyName} tree prefix`,
      );
    }
  }

  for (const { prefix, family: familyName } of ENROLLED_PREFIXES) {
    assert.ok(familyByName.has(familyName), `prefix family ${familyName} exists in FAMILIES`);
    assert.ok(prefix.startsWith("/") && prefix.endsWith("/"), `${prefix} is a bounded /.../ prefix`);
  }

  // The contract counts: every explicit FAMILIES file is exact (610 total,
  // fred-macro and the computed-signals pilot included), and EDGAR is the only
  // tree prefix.
  const expectedExact = publicFamilies.reduce((n, [, f]) => n + (f.files ? f.files.length : 0), 0);
  assert.equal(ENROLLED_PATHS.size, expectedExact, `exact entries match FAMILIES (${expectedExact})`);
  assert.equal(ENROLLED_PREFIXES.length, 1, "exactly one tree prefix is enrolled");
  assert.equal(ENROLLED_PREFIXES[0].prefix, "/data/edgar-korean-summaries/");

  // Every public family's every published file is enrolled exactly or by prefix.
  for (const [familyName, family] of publicFamilies) {
    const files = family.files;
    if (!files) {
      // A tree family (no files list) must be covered by exactly its own
      // manifest prefix, slash-bounded.
      const treePrefix = `/${manifestPrefix(family)}/`.replace(/^\/public/, "");
      assert.ok(
        ENROLLED_PREFIXES.some(({ prefix, family: f }) => f === familyName && prefix === treePrefix),
        `tree family ${familyName} is covered by exactly ${treePrefix}`,
      );
      continue;
    }
    for (const file of files) {
      const pathname = `/${manifestPrefix(family)}/${file}`.replace(/^\/public/, "");
      const covered = ENROLLED_PATHS.has(pathname)
        || ENROLLED_PREFIXES.some(({ prefix }) => pathname.startsWith(prefix));
      assert.ok(covered, `family ${familyName} file ${pathname} is enrolled`);
    }
  }
}

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

  // --- enrolment boundary: exact single files and bounded tree prefixes -----
  assert.equal(isEnrolledPath("/data/macro/fred-macro.json"), true, "exact single file enrolled");
  assert.equal(familyForPath("/data/macro/fred-macro.json"), "fred-macro");
  assert.equal(isEnrolledPath("/data/yardney/yardney_model.json"), true, "exact single file enrolled");
  assert.equal(familyForPath("/data/yardney/yardney_model.json"), "fred-yardeni");
  assert.equal(isEnrolledPath("/data/edgar-korean-summaries/index.json"), true, "tree root child enrolled");
  assert.equal(
    isEnrolledPath("/data/edgar-korean-summaries/2026/08/10/0000320193-26-000123.json"),
    true,
    "deep tree child enrolled",
  );
  assert.equal(familyForPath("/data/edgar-korean-summaries/2026/08/10/x.json"), "edgar-korean-summaries");
  assert.equal(isEnrolledPath("/data/edgar-korean-summaries-evil/index.json"), false, "sibling directory not enrolled");
  assert.equal(isEnrolledPath("/data/edgar-korean-summariesx/index.json"), false, "near-prefix sibling not enrolled");
  assert.equal(isEnrolledPath("/data/edgar-korean-summaries"), false, "bare tree root not enrolled");
  assert.equal(isEnrolledPath("/data/edgar-korean-summaries/"), false, "bare tree root with slash not enrolled");
  assert.equal(isEnrolledPath("/data/edgar-korean-summaries//index.json"), false, "empty path segment not enrolled");
  assert.equal(isEnrolledPath("/data/edgar-korean-summaries/index.json/"), false, "trailing slash not enrolled");
  assert.equal(isEnrolledPath("/data/edgar-korean-summaries/./index.json"), false, "dot segment not enrolled");
  assert.equal(isEnrolledPath("/data/edgar-korean-summaries/../index.json"), false, "dot-dot segment not enrolled");
  assert.equal(isEnrolledPath("/data/edgar-korean-summaries/a/./b.json"), false, "nested dot segment not enrolled");
  assert.equal(isEnrolledPath("/data/edgar-korean-summaries/.hidden.json"), true, "dotfile-style segment is a normal file");
  assert.equal(isEnrolledPath("/data/edgar-korean-summaries/2026/08/10/x.json"), true, "clean deep child stays enrolled");
  assert.equal(familyForPath("/data/edgar-korean-summaries/"), null);
  assert.equal(familyForPath("/data/edgar-korean-summaries//index.json"), null);
  assert.equal(isEnrolledPath("/data/slickcharts/stocks/AAPL.json"), true, "stocks ticker exact entry");
  assert.equal(isEnrolledPath("/data/slickcharts/stocks/BF.B.json"), true, "dotted ticker exact entry");
  assert.equal(familyForPath("/data/slickcharts/stocks/AAPL.json"), "slickcharts-history");
  assert.equal(isEnrolledPath("/data/slickcharts/stocks-evil/AAPL.json"), false, "stocks sibling not enrolled");
  assert.equal(familyForPath("/data/slickcharts/gainers.json"), "slickcharts-daily", "per-lane exact wins");
  assert.equal(isEnrolledPath("/data/computed/signals.json"), true, "computed-signals pilot exact file enrolled");
  assert.equal(familyForPath("/data/computed/signals.json"), "computed-signals");
  assert.equal(isEnrolledPath("/data/computed/other.json"), false, "unrelated computed path remains unenrolled");

  assert.equal(
    await handleCloudDataPlaneAsset(get("https://100xfenok.test/data/edgar-korean-summaries-evil/index.json"), env),
    null,
    "sibling of an enrolled tree declines",
  );
  assert.equal(
    await handleCloudDataPlaneAsset(get("https://100xfenok.test/data/slickcharts/stocks-evil/AAPL.json"), env),
    null,
    "sibling of the stocks entries declines",
  );
  assert.equal(
    await handleCloudDataPlaneAsset(get("https://100xfenok.test/data/edgar-korean-summaries/"), env),
    null,
    "bare tree root with slash declines",
  );
  assert.equal(
    await handleCloudDataPlaneAsset(get("https://100xfenok.test/data/edgar-korean-summaries//index.json"), env),
    null,
    "empty path segment declines",
  );
  assert.equal(
    await handleCloudDataPlaneAsset(get("https://100xfenok.test/data/edgar-korean-summaries/index.json/"), env),
    null,
    "trailing slash declines",
  );
  assert.equal(
    await handleCloudDataPlaneAsset(get("https://100xfenok.test/data/computed/signals.json"), env),
    null,
    "computed-signals falls through before its family is published",
  );

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
    coordinatorName: "fred-macro",
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
  assert.equal(served.headers.get("x-data-plane-published-at"), NOW);
  assert.match(served.headers.get("cache-control") ?? "", /max-age=/);
  assert.equal(await served.text(), payloadText);

  const etag = served.headers.get("etag");
  assert.ok(etag, "etag present");

  const notModified = await handleCloudDataPlaneAsset(
    get(ENROLLED_URL, { headers: { "if-none-match": etag } }),
    env,
  );
  assert.equal(notModified.status, 304, "matching etag is 304");
  assert.equal(notModified.headers.get("x-data-plane-published-at"), NOW);

  const head = await handleCloudDataPlaneAsset(get(ENROLLED_URL, { method: "HEAD" }), env);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("x-data-plane-published-at"), NOW);
  assert.equal(await head.text(), "", "HEAD carries no body");

  // --- a second exact family resolves through its own pointer ----------------
  // The pointer is per family, so publishing yardeni must not disturb fred-macro
  // and must not make a third, unpublished family start serving.
  const yardneyText = "{\"model\":\"yardeni\"}\n";
  const yardneyPayload = encoder.encode(yardneyText);
  const yardneySha = sha256Bytes(yardneyPayload);
  const yardneyManifest = {
    schema_version: GENERATION_MANIFEST_SCHEMA,
    generation_id: "fred-yardeni-read-1",
    source_sha: SOURCE_SHA,
    created_at: NOW,
    assets: [{
      path: "public/data/yardney/yardney_model.json",
      object_key: `objects/sha256/${yardneySha}`,
      sha256: yardneySha,
      bytes: yardneyPayload.byteLength,
      content_type: "application/json",
      source_as_of: "2026-08-02",
      privacy_class: "public",
    }],
  };
  const yardneyPlane = createCloudflareCloudDataPlane({
    r2Bucket: DATA_PLANE_BUCKET,
    coordinatorNamespace: CLOUD_DATA_PLANE_COORDINATOR,
    coordinatorName: "fred-yardeni",
  });
  await publishGeneration({
    manifest: yardneyManifest,
    payloads: new Map([["public/data/yardney/yardney_model.json", yardneyPayload]]),
    expectedPointerSequence: 0,
    objectStore: yardneyPlane.objectStore,
    ledger: yardneyPlane.ledger,
    pointerStore: yardneyPlane.pointerStore,
    policy: {
      max_assets: 4,
      max_total_bytes: 10_000,
      validate_freshness: () => true,
      validate_public_payload: () => true,
    },
  });

  const yardneyServed = await handleCloudDataPlaneAsset(
    get("https://100xfenok.test/data/yardney/yardney_model.json"),
    env,
  );
  assert.ok(yardneyServed, "yardney serves from its own family");
  assert.equal(yardneyServed.headers.get("x-data-plane-generation"), "fred-yardeni-read-1");
  assert.equal(await yardneyServed.text(), yardneyText);

  const fredAgain = await handleCloudDataPlaneAsset(get(), env);
  assert.equal(
    fredAgain.headers.get("x-data-plane-generation"),
    "fred-macro-read-1",
    "fred-macro still resolves through its own pointer",
  );

  // --- computed-signals exact path serves from its own family pointer --------
  const computedText = "{\"source_as_of\":\"2026-07-29\",\"signals\":{}}\n";
  const computedPayload = encoder.encode(computedText);
  const computedSha = sha256Bytes(computedPayload);
  const computedManifestPath = "public/data/computed/signals.json";
  const computedManifest = {
    schema_version: GENERATION_MANIFEST_SCHEMA,
    generation_id: "computed-signals-read-1",
    source_sha: SOURCE_SHA,
    created_at: NOW,
    assets: [{
      path: computedManifestPath,
      object_key: `objects/sha256/${computedSha}`,
      sha256: computedSha,
      bytes: computedPayload.byteLength,
      content_type: "application/json",
      source_as_of: "2026-07-29",
      privacy_class: "public",
    }],
  };
  const computedPlane = createCloudflareCloudDataPlane({
    r2Bucket: DATA_PLANE_BUCKET,
    coordinatorNamespace: CLOUD_DATA_PLANE_COORDINATOR,
    coordinatorName: "computed-signals",
  });
  await publishGeneration({
    manifest: computedManifest,
    payloads: new Map([[computedManifestPath, computedPayload]]),
    expectedPointerSequence: 0,
    objectStore: computedPlane.objectStore,
    ledger: computedPlane.ledger,
    pointerStore: computedPlane.pointerStore,
    policy: {
      max_assets: 4,
      max_total_bytes: 30_000,
      validate_freshness: () => true,
      validate_public_payload: () => true,
    },
  });
  const computedServed = await handleCloudDataPlaneAsset(
    get("https://100xfenok.test/data/computed/signals.json"),
    env,
  );
  assert.ok(computedServed, "computed-signals exact path serves from the plane");
  assert.equal(computedServed.status, 200);
  assert.equal(computedServed.headers.get("x-data-plane-generation"), "computed-signals-read-1");
  assert.equal(computedServed.headers.get("x-data-plane-source-as-of"), "2026-07-29");
  assert.equal(await computedServed.text(), computedText);
  assert.equal(
    await handleCloudDataPlaneAsset(get("https://100xfenok.test/data/computed/other.json"), env),
    null,
    "unrelated computed path never reaches the plane",
  );

  assert.equal(
    await handleCloudDataPlaneAsset(get("https://100xfenok.test/data/sentiment/vix.json"), env),
    null,
    "a family with its own empty pointer declines",
  );

  // --- a tree family serves any child under its bounded prefix ---------------
  const edgarValues = {
    "public/data/edgar-korean-summaries/index.json": "{\"updated\":\"2026-08-10\"}\n",
    "public/data/edgar-korean-summaries/2026/08/10/0000320193-26-000123.json": "{\"company\":\"demo\"}\n",
  };
  const edgarManifest = {
    schema_version: GENERATION_MANIFEST_SCHEMA,
    generation_id: "edgar-read-1",
    source_sha: SOURCE_SHA,
    created_at: NOW,
    assets: Object.entries(edgarValues)
      .map(([path, text]) => {
        const bytes = encoder.encode(text);
        const sha = sha256Bytes(bytes);
        return {
          path,
          object_key: `objects/sha256/${sha}`,
          sha256: sha,
          bytes: bytes.byteLength,
          content_type: "application/json",
          source_as_of: "2026-08-10",
          privacy_class: "public",
        };
      })
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
  const edgarPlane = createCloudflareCloudDataPlane({
    r2Bucket: DATA_PLANE_BUCKET,
    coordinatorNamespace: CLOUD_DATA_PLANE_COORDINATOR,
    coordinatorName: "edgar-korean-summaries",
  });
  await publishGeneration({
    manifest: edgarManifest,
    payloads: new Map(Object.entries(edgarValues).map(([p, t]) => [p, encoder.encode(t)])),
    expectedPointerSequence: 0,
    objectStore: edgarPlane.objectStore,
    ledger: edgarPlane.ledger,
    pointerStore: edgarPlane.pointerStore,
    policy: {
      max_assets: 8,
      max_total_bytes: 100_000,
      validate_freshness: () => true,
      validate_public_payload: () => true,
    },
  });

  const edgarIndex = await handleCloudDataPlaneAsset(
    get("https://100xfenok.test/data/edgar-korean-summaries/index.json"),
    env,
  );
  assert.ok(edgarIndex, "tree root child serves");
  assert.equal(edgarIndex.headers.get("x-data-plane-generation"), "edgar-read-1");
  assert.equal(await edgarIndex.text(), edgarValues["public/data/edgar-korean-summaries/index.json"]);

  const edgarDeep = await handleCloudDataPlaneAsset(
    get("https://100xfenok.test/data/edgar-korean-summaries/2026/08/10/0000320193-26-000123.json"),
    env,
  );
  assert.ok(edgarDeep, "arbitrary deep tree child serves without an exact entry");
  assert.equal(
    await edgarDeep.text(),
    edgarValues["public/data/edgar-korean-summaries/2026/08/10/0000320193-26-000123.json"],
  );

  const edgarHead = await handleCloudDataPlaneAsset(
    get("https://100xfenok.test/data/edgar-korean-summaries/index.json", { method: "HEAD" }),
    env,
  );
  assert.equal(edgarHead.status, 200);
  assert.equal(await edgarHead.text(), "", "HEAD on a tree child carries no body");

  assert.equal(
    await handleCloudDataPlaneAsset(
      get("https://100xfenok.test/data/edgar-korean-summaries/not-published.json"),
      env,
    ),
    null,
    "enrolled tree path with no manifest binding declines",
  );

  // --- corruption must decline, never serve --------------------------------
  // Overwrite the object out from under the manifest, which is the shape a
  // partial write or a bad actor would produce.
  await DATA_PLANE_BUCKET.put(`objects/sha256/${sha256}`, encoder.encode("{\"series\":{}}\n"));
  const corrupted = await handleCloudDataPlaneAsset(get(), env);
  assert.equal(corrupted, null, "payload whose hash disagrees declines rather than serving");

  console.log("test-cloud-data-plane-worker-read: ok"
    + " (FAMILIES-derived enrolment: exact single files, per-family pointer isolation,"
    + " bounded tree prefixes with sibling/near-prefix fall-through and deep child serving;"
    + " declines with no pointer, on non-GET, off-path, unbound, missing binding, and"
    + " on payload corruption; serves exact bytes with generation attribution, 304, and HEAD)");
} finally {
  await miniflare.dispose();
}
