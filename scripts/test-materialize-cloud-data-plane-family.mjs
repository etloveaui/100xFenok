#!/usr/bin/env node
// Offline tests for scripts/materialize-cloud-data-plane-family.mjs: injected
// read-only plane + plane factory; temp-only filesystem effects; unchanged delta.

import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  rmdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACTIVE_POINTER_SCHEMA,
  GENERATION_MANIFEST_SCHEMA,
  sha256Bytes,
  sha256Canonical,
} from "./lib/cloud-data-plane-generation.mjs";
import { canonicalJson } from "./lib/json-canonical.mjs";
import {
  materializeCloudDataPlaneFamily,
  runMaterializerCli,
  verifyCloudDataPlaneFamilyReceipt,
} from "./materialize-cloud-data-plane-family.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PREFIX = "data/stockanalysis/etfs";
const GENERATION_ID = "g20260817t120000z0000";
const SOURCE_SHA = "a".repeat(64);
const FAMILY = "stockanalysis-etf-detail";
const encoder = new TextEncoder();

// Worktree snapshot before any action; the final section proves temp-only effects.
const { execFile } = await import("node:child_process");
const { promisify } = await import("node:util");
const gitStatus = async () =>
  (await promisify(execFile)("git", ["status", "--porcelain"], { cwd: REPO_ROOT }))
    .stdout.split("\n").filter(Boolean).sort();
const gitStatusAtStart = await gitStatus();

async function assertRejectsCode(promise, code, label = "") {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code,
      `${label} expected code ${code}, got ${error.code}: ${error.message}`);
    return true;
  });
}

function makeAsset(assetPath, bytes, overrides = {}) {
  const sha256 = sha256Bytes(bytes);
  return {
    path: assetPath,
    object_key: `objects/sha256/${sha256}`,
    sha256,
    bytes: bytes.byteLength,
    content_type: "application/json",
    source_as_of: "2026-08-16",
    privacy_class: "private",
    ...overrides,
  };
}

function makeManifest({ assets, overrides = {} }) {
  return {
    schema_version: GENERATION_MANIFEST_SCHEMA,
    generation_id: GENERATION_ID,
    source_sha: SOURCE_SHA,
    created_at: "2026-08-17T12:00:00.000Z",
    assets,
    ...overrides,
  };
}

function makePointer({ manifestSha, overrides = {} }) {
  return {
    schema_version: ACTIVE_POINTER_SCHEMA,
    sequence: 1,
    active: {
      generation_id: GENERATION_ID,
      manifest_key: `manifests/${GENERATION_ID}.json`,
      manifest_sha256: manifestSha,
    },
    previous: null,
    source_sha: SOURCE_SHA,
    prepared_receipt_id: "publish-1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    promoted_at: "2026-08-17T12:00:01.000Z",
    ...overrides,
  };
}

// Coherent world: valid manifest + byte-bound pointer + content-addressed
// object map. Negative cases mutate `objects`/`pointer` before each run.
function buildWorld({ assetEntries }) {
  const manifest = makeManifest({ assets: assetEntries.map(({ asset }) => asset) });
  const manifestSha = sha256Canonical(manifest);
  const objects = new Map(assetEntries.map(({ asset, bytes }) => [asset.object_key, bytes]));
  objects.set(`manifests/${GENERATION_ID}.json`, encoder.encode(canonicalJson(manifest)));
  return { manifest, manifestSha, objects, pointer: makePointer({ manifestSha }) };
}

// Read-only plane: mutating surfaces record and throw so the test can assert
// the materializer never reaches them. `tracker` measures get concurrency.
function createPlane({ objects, pointer, tracker = null }) {
  const called = { get: [], put: 0, putIfAbsent: 0, list: 0, compareAndSwap: 0 };
  const mutating = (counter, surface) => async () => {
    called[counter] += 1;
    throw new Error(`materializer must never call ${surface}`);
  };
  const plane = {
    objectStore: {
      async get(key) {
        called.get.push(key);
        if (tracker) tracker.start();
        try {
          if (tracker) await new Promise((resolve) => setTimeout(resolve, 5));
          return objects.has(key) ? new Uint8Array(objects.get(key)) : null;
        } finally {
          if (tracker) tracker.end();
        }
      },
      put: mutating("put", "objectStore.put"),
      putIfAbsent: mutating("putIfAbsent", "objectStore.putIfAbsent"),
      list: mutating("list", "objectStore.list"),
    },
    pointerStore: {
      async get() {
        return pointer ? structuredClone(pointer) : null;
      },
      compareAndSwap: mutating("compareAndSwap", "pointerStore.compareAndSwap"),
    },
  };
  return { plane, called };
}

function assertReadOnly(called) {
  for (const [counter, label] of [["put", "object write"], ["putIfAbsent", "putIfAbsent"], ["list", "object list"], ["compareAndSwap", "compare-and-swap"]]) {
    assert.equal(called[counter], 0, `no ${label} may be issued`);
  }
}

async function pathExists(target) {
  try {
    await lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function assertTreeAbsent(parent, names) {
  for (const name of names) {
    assert.equal(await pathExists(path.join(parent, name)), false,
      `${name} must not exist after the run`);
  }
}

async function readTree(root) {
  const entries = [];
  const childRel = (rel, name) => (rel ? `${rel}/${name}` : name);
  async function walk(directory, rel = "") {
    assert.ok((await lstat(directory)).isDirectory(), `unexpected non-directory ${directory}`);
    for (const name of (await readdir(directory)).sort()) {
      const full = path.join(directory, name);
      if ((await lstat(full)).isDirectory()) await walk(full, childRel(rel, name));
      else entries.push([childRel(rel, name), new Uint8Array(await readFile(full))]);
    }
  }
  await walk(root);
  return entries;
}

async function withTempDir(prefix, fn) {
  const base = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(base);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

function sampleAssets(count) {
  const assets = [];
  for (let index = 0; index < count; index += 1) {
    const ticker = `T${String(index).padStart(3, "0")}`;
    const bytes = encoder.encode(JSON.stringify({ ticker, index, source: "fixture" }));
    assets.push({ asset: makeAsset(`${PREFIX}/${ticker}.json`, bytes), bytes });
  }
  return assets;
}

function withoutKey(world, key) {
  const objects = new Map(world.objects);
  objects.delete(key);
  return { objects, pointer: world.pointer };
}

// Rewrites the stored manifest and rebinds the pointer hash so the rejection
// under test hits its intended check, not an earlier integrity failure.
function withBoundManifestBytes(world, bytes) {
  const objects = new Map(world.objects);
  objects.set(world.pointer.active.manifest_key, bytes);
  return {
    objects,
    pointer: {
      ...world.pointer,
      active: { ...world.pointer.active, manifest_sha256: sha256Bytes(bytes) },
    },
  };
}

// Table-driven negative driver. Rows are
// [name, expectedCode, prepare, extra?]; `prepare` returns { plane, called },
// `extra` receives { called }. Every row must fail, leave no out/out.stage
// behind, and never reach a mutating plane surface.
async function expectRejections({ base, rows }) {
  const output = path.join(base, "out");
  for (const [name, code, prepare, extra] of rows) {
    const { plane, called } = prepare();
    await assertRejectsCode(
      materializeCloudDataPlaneFamily({ plane, family: FAMILY, manifestPrefix: PREFIX, outputRoot: output, env: { RUNNER_TEMP: base } }),
      code,
      name,
    );
    assertReadOnly(called);
    await assertTreeAbsent(base, ["out", "out.stage"]);
    if (extra) await extra({ called });
  }
}

// --- 1. Positive byte parity + exact receipt + atomic rename ----------------
await withTempDir("materialize-pos-", async (base) => {
  const assetEntries = [
    [1, "AAA.json"], [2, "sub/BBB.json"], [3, "ZZZ.json"],
  ].map(([n, rel]) => {
    const bytes = encoder.encode(JSON.stringify({ n, ticker: rel.split("/").pop() }));
    return { asset: makeAsset(`${PREFIX}/${rel}`, bytes), bytes };
  })
    .sort((left, right) => left.asset.path.localeCompare(right.asset.path));
  const world = buildWorld({ assetEntries });
  const output = path.join(base, "out");
  const { plane, called } = createPlane(world);
  const receipt = await materializeCloudDataPlaneFamily({
    plane,
    family: FAMILY,
    manifestPrefix: PREFIX,
    outputRoot: output,
    env: { RUNNER_TEMP: base },
  });
  assert.deepEqual(receipt, {
    family: FAMILY,
    generation_id: GENERATION_ID,
    manifest_sha256: world.manifestSha,
    source_sha: SOURCE_SHA,
    asset_count: 3,
    total_bytes: assetEntries.reduce((sum, entry) => sum + entry.asset.bytes, 0),
    output_root: output,
  }, "receipt must carry the exact verified fields");

  const materialized = await readTree(output);
  assert.deepEqual(
    materialized.map(([rel]) => rel).sort(),
    ["AAA.json", "sub/BBB.json", "ZZZ.json"].sort(),
    "the materialized tree must mirror the manifest relative paths exactly",
  );
  for (const { asset, bytes } of assetEntries) {
    const expectedRel = asset.path.slice(PREFIX.length + 1);
    const found = materialized.find(([candidate]) => candidate === expectedRel)
      ?? assert.fail(`missing materialized asset ${expectedRel}`);
    assert.deepEqual(found[1], bytes, `${expectedRel} must be byte-identical`);
  }
  assert.equal(await pathExists(`${output}.stage`), false, "stage dir must be renamed away");
  assertReadOnly(called);
  console.log("positive parity ok (exact receipt, byte-identical tree, atomic rename, zero mutations)");

  const receiptPath = path.join(base, "verified-receipt.json");
  await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`);
  const verified = await verifyCloudDataPlaneFamilyReceipt({
    plane,
    family: FAMILY,
    receiptPath,
    env: { RUNNER_TEMP: base },
  });
  assert.deepEqual(verified, { ...receipt, status: "current" },
    "receipt verification must return the one verified receipt object");
  assertReadOnly(called);
  console.log("receipt verification ok (pointer/manifest/tree binding, exact count/bytes, zero mutations)");
});

// --- 1b. Receipt verification rejects missing, extra, and tampered files ----
for (const [label, mutate, expectedCode] of [
  ["missing file", async (output, assets) => rm(path.join(output, assets[0]), { force: true }), "OUTPUT_FILE_MISSING"],
  ["extra file", async (output) => writeFile(path.join(output, "EXTRA.json"), "{}"), "OUTPUT_FILE_EXTRA"],
  ["tampered file", async (output, assets) => {
    const target = path.join(output, assets[0]);
    const bytes = new Uint8Array(await readFile(target));
    bytes[0] ^= 0x01;
    await writeFile(target, bytes);
  }, "OUTPUT_FILE_INTEGRITY_INVALID"],
]) {
  await withTempDir(`materialize-verify-${label.replaceAll(" ", "-")}-`, async (base) => {
    const assetEntries = sampleAssets(2);
    const world = buildWorld({ assetEntries });
    const output = path.join(base, "out");
    const { plane, called } = createPlane(world);
    const receipt = await materializeCloudDataPlaneFamily({
      plane,
      family: FAMILY,
      manifestPrefix: PREFIX,
      outputRoot: output,
      env: { RUNNER_TEMP: base },
    });
    const receiptPath = path.join(base, "verified-receipt.json");
    await writeFile(receiptPath, JSON.stringify(receipt));
    const relativeAssets = assetEntries.map(({ asset }) => asset.path.slice(PREFIX.length + 1));
    await mutate(output, relativeAssets);
    await assertRejectsCode(
      verifyCloudDataPlaneFamilyReceipt({
        plane,
        family: FAMILY,
        receiptPath,
        env: { RUNNER_TEMP: base },
      }),
      expectedCode,
      label,
    );
    assertReadOnly(called);
  });
}
console.log("receipt rejection coverage ok (missing, extra, and tampered files fail closed)");

// --- 2. Pointer / manifest integrity and cross-bind -------------------------
await withTempDir("materialize-manifest-", async (base) => {
  const world = buildWorld({ assetEntries: sampleAssets(2) });
  const manifestKey = world.pointer.active.manifest_key;
  const unparseable = encoder.encode(`{"not": "json"`);
  const badSchema = encoder.encode(canonicalJson({ ...world.manifest, schema_version: "bogus/v9" }));
  const crossBound = encoder.encode(canonicalJson({ ...world.manifest, generation_id: "g20260817t130000z9999" }));
  await expectRejections({
    base,
    rows: [
      ["no active pointer", "ACTIVE_POINTER_UNAVAILABLE", () => createPlane({ objects: world.objects, pointer: null })],
      ["invalid pointer contract", "SCHEMA_INVALID", () => createPlane({ objects: world.objects, pointer: { ...world.pointer, sequence: 0 } })],
      ["manifest object missing", "MANIFEST_MISSING", () => createPlane(withoutKey(world, manifestKey))],
      ["manifest hash mismatch", "MANIFEST_INTEGRITY_INVALID",
        () => {
          const objects = new Map(world.objects);
          objects.set(manifestKey, encoder.encode(`{"corrupt"`));
          return createPlane({ objects, pointer: world.pointer });
        }],
      ["manifest unparseable", "MANIFEST_PARSE_INVALID", () => createPlane(withBoundManifestBytes(world, unparseable))],
      ["manifest schema invalid", "SCHEMA_INVALID", () => createPlane(withBoundManifestBytes(world, badSchema))],
      ["manifest cross-binds other generation", "MANIFEST_CROSS_BIND_INVALID", () => createPlane(withBoundManifestBytes(world, crossBound))],
    ],
  });
  console.log("pointer/manifest integrity ok (missing, invalid, corrupt, unparseable, schema-invalid, cross-bind)");
});

// --- 3. Payload integrity and exact stage cleanup ---------------------------
await withTempDir("materialize-payload-", async (base) => {
  const world = buildWorld({ assetEntries: sampleAssets(3) });
  const payloadKey = world.manifest.assets[1].object_key;
  await expectRejections({
    base,
    rows: [
      ["payload object missing", "PAYLOAD_MISSING", () => createPlane(withoutKey(world, payloadKey)),
        ({ called }) => assert.ok(called.get.length >= 2, "manifest and the missing payload were both read")],
      ["payload bytes corrupt", "PAYLOAD_INTEGRITY_INVALID",
        () => {
          const objects = new Map(world.objects);
          objects.set(payloadKey, encoder.encode("corrupted-bytes-here"));
          return createPlane({ objects, pointer: world.pointer });
        }],
      ["no pointer (no payload reads)", "ACTIVE_POINTER_UNAVAILABLE", () => createPlane({ objects: world.objects, pointer: null }),
        ({ called }) => assert.deepEqual(called.get, [], "no object read may happen without a pointer")],
    ],
  });
  console.log("payload integrity + cleanup ok (missing/corrupt payload, only exact stage dir removed)");
});

// --- 4. Enrollment: public / wrong-prefix / prefix-equal / traversal / dup --
await withTempDir("materialize-assets-", async (base) => {
  const bytes = encoder.encode("{}");
  await expectRejections({
    base,
    rows: [
      ["public asset", "ASSET_PRIVACY_INVALID", () => createPlane(buildWorld({ assetEntries: [
        { asset: makeAsset("public/data/stockanalysis/etfs/PUB.json", bytes, { privacy_class: "public" }), bytes },
      ] }))],
      ["outside family prefix", "ASSET_PREFIX_INVALID", () => createPlane(buildWorld({ assetEntries: [{ asset: makeAsset("data/other/OUT.json", bytes), bytes }] }))],
      ["path equal to prefix", "ASSET_REL_PATH_INVALID", () => createPlane(buildWorld({ assetEntries: [{ asset: makeAsset(PREFIX, bytes), bytes }] }))],
      ["traversal segment", "PATH_INVALID", () => createPlane(buildWorld({ assetEntries: [{ asset: makeAsset(`${PREFIX}/../evil.json`, bytes), bytes }] }))],
      ["duplicate relative path", "PATH_DUPLICATE",
        () => createPlane(buildWorld({
          assetEntries: [
            { asset: makeAsset(`${PREFIX}/DUP.json`, bytes), bytes },
            { asset: makeAsset(`${PREFIX}/DUP.json`, bytes), bytes },
          ],
        }))],
    ],
  });
  console.log("enrollment ok (public, wrong-prefix, prefix-equal, traversal, duplicate all rejected)");
});

// --- 5. Output-root safety (always before any plane read) -------------------
await withTempDir("materialize-output-", async (base) => {
  const world = buildWorld({ assetEntries: sampleAssets(1) });
  const outsideBase = await mkdtemp(path.join(os.tmpdir(), "materialize-escape-"));
  try {
    const insideRepo = path.join(REPO_ROOT, "data", ".materialize-should-never-exist");
    const cases = [
      ["existing target", async () => { await mkdir(path.join(base, "existing")); },
        path.join(base, "existing"), "OUTPUT_EXISTS"],
      ["inside repository", null, insideRepo, "OUTPUT_INSIDE_REPO",
        async () => assert.equal(await pathExists(insideRepo), false, "repo path must never be created")],
      ["outside temp base", null, path.join(outsideBase, "out"), "OUTPUT_PARENT_ESCAPE",
        () => assertTreeAbsent(outsideBase, ["out"])],
      ["missing parent", null, path.join(base, "no-such-parent", "out"), "OUTPUT_PARENT_MISSING"],
      ["symlinked parent", () => symlink(path.join(base, "elsewhere"), path.join(base, "linked")),
        path.join(base, "linked", "out"), "OUTPUT_SYMLINK"],
    ];
    for (const [name, setup, outputRoot, code, after] of cases) {
      if (setup) await setup();
      const { plane, called } = createPlane(world);
      await assertRejectsCode(
        materializeCloudDataPlaneFamily({ plane, family: FAMILY, manifestPrefix: PREFIX, outputRoot, env: { RUNNER_TEMP: base } }),
        code,
        name,
      );
      assert.deepEqual(called.get, [], "output validation must precede any plane read");
      assertReadOnly(called);
      if (after) await after();
    }
    console.log("output-root safety ok (existing, inside repo, escape, missing parent, symlink all rejected)");
  } finally {
    await rm(outsideBase, { recursive: true, force: true });
  }
});

// --- 6. Bounded concurrency (max 8, but genuinely parallel) -----------------
await withTempDir("materialize-conc-", async (base) => {
  const assetEntries = sampleAssets(24);
  const world = buildWorld({ assetEntries });
  const tracker = {
    active: 0,
    peak: 0,
    start() { this.active += 1; this.peak = Math.max(this.peak, this.active); },
    end() { this.active -= 1; },
  };
  const { plane, called } = createPlane({ objects: world.objects, pointer: world.pointer, tracker });
  const receipt = await materializeCloudDataPlaneFamily({
    plane,
    family: FAMILY,
    manifestPrefix: PREFIX,
    outputRoot: path.join(base, "out"),
    env: { RUNNER_TEMP: base },
  });
  assert.deepEqual(
    [receipt.asset_count, receipt.total_bytes],
    [24, assetEntries.reduce((sum, { asset }) => sum + asset.bytes, 0)],
  );
  assert.ok(tracker.peak <= 8, `concurrent gets must not exceed 8 (peak ${tracker.peak})`);
  assert.ok(tracker.peak >= 2, `concurrent gets must actually parallelize (peak ${tracker.peak})`);
  assertReadOnly(called);
  console.log(`concurrency ok (24 assets, peak ${tracker.peak} concurrent gets, zero mutations)`);
});

// --- 7. CLI: usage, env, success receipt, failure path ----------------------
await withTempDir("materialize-cli-", async (base) => {
  const world = buildWorld({ assetEntries: sampleAssets(2) });
  const output = path.join(base, "out");
  const fakeEnv = {
    RUNNER_TEMP: base,
    CLOUDFLARE_ACCOUNT_ID: "acct-test-123",
    CLOUDFLARE_API_TOKEN: "token-secret-abc",
    DATA_PLANE_ENDPOINT: "https://coordinator.invalid",
    DATA_PLANE_WRITE_KEY: "write-key-secret-xyz",
  };
  const fullArgs = ["--family", FAMILY, "--manifest-prefix", PREFIX, "--output-root", output];
  const noPlane = () => assert.fail("no plane may be created before usage/env checks");
  const runCli = async ({ args, cliEnv = fakeEnv, createPlaneImpl }) => {
    const stdoutLines = [], stderrLines = [];
    const code = await runMaterializerCli({
      argv: args,
      env: cliEnv,
      stdout: (line) => stdoutLines.push(line),
      stderr: (line) => stderrLines.push(line),
      createPlaneImpl,
    });
    return { code, stdoutLines, stderrLines };
  };

  // Usage and env failures exit 2 on an empty stdout before any plane exists.
  for (const [label, args, cliEnv, needle] of [
    ["missing required argument", ["--family", FAMILY, "--manifest-prefix", PREFIX], fakeEnv, "missing required arguments"],
    ["unknown flag", ["--family", FAMILY, "--wat"], fakeEnv],
    ["mixed materialize and verify modes", ["--family", FAMILY, "--verify-receipt", path.join(base, "missing"), "--output-root", output], fakeEnv, "arguments cannot be mixed"],
    ["missing env", fullArgs, { RUNNER_TEMP: base }, "missing env"],
  ]) {
    const { code, stdoutLines, stderrLines } = await runCli({ args, cliEnv, createPlaneImpl: noPlane });
    assert.equal(code, 2, label);
    assert.deepEqual(stdoutLines, [], label);
    if (needle) assert.ok(stderrLines.some((line) => line.includes(needle)), label);
  }

  // Success: exactly one secret-free receipt line and no stderr chatter.
  {
    const { code, stdoutLines, stderrLines } = await runCli({
      args: fullArgs,
      createPlaneImpl: () => createPlane(world).plane,
    });
    assert.equal(code, 0);
    assert.equal(stdoutLines.length, 1, "exactly one receipt line on stdout");
    assert.deepEqual(JSON.parse(stdoutLines[0]), {
      family: FAMILY,
      generation_id: GENERATION_ID,
      manifest_sha256: world.manifestSha,
      source_sha: SOURCE_SHA,
      asset_count: 2,
      total_bytes: world.manifest.assets.reduce((sum, asset) => sum + asset.bytes, 0),
      output_root: output,
    }, "exact secret-free receipt");
    const stdoutText = stdoutLines.join("\n");
    for (const secret of ["acct-test-123", "token-secret-abc", "https://coordinator.invalid", "write-key-secret-xyz"]) {
      assert.equal(stdoutText.includes(secret), false, "receipt must not leak env values");
    }
    assert.deepEqual(stderrLines, [], "no stderr chatter on a successful run");
  }

  // Verify mode: exactly one machine-readable object on stdout, with the
  // active receipt and output tree checked through the injected read-only plane.
  {
    const receiptPath = path.join(base, "cli-verified-receipt.json");
    const materializedReceipt = {
      family: FAMILY,
      generation_id: GENERATION_ID,
      manifest_sha256: world.manifestSha,
      source_sha: SOURCE_SHA,
      asset_count: 2,
      total_bytes: world.manifest.assets.reduce((sum, asset) => sum + asset.bytes, 0),
      output_root: output,
    };
    await writeFile(receiptPath, JSON.stringify(materializedReceipt));
    const { code, stdoutLines, stderrLines } = await runCli({
      args: ["--family", FAMILY, "--verify-receipt", receiptPath],
      createPlaneImpl: () => createPlane(world).plane,
    });
    assert.equal(code, 0);
    assert.equal(stdoutLines.length, 1, "verify mode must emit exactly one receipt line");
    assert.deepEqual(JSON.parse(stdoutLines[0]), { ...materializedReceipt, status: "current" });
    assert.deepEqual(stderrLines, [], "verify mode must not emit stderr on success");
  }

  // Runtime failure: exit 1, machine-clean stdout, code on stderr, no stage.
  {
    const existing = path.join(base, "existing-out");
    await mkdir(existing);
    const { code, stdoutLines, stderrLines } = await runCli({
      args: ["--family", FAMILY, "--manifest-prefix", PREFIX, "--output-root", existing],
      createPlaneImpl: () => createPlane(world).plane,
    });
    assert.equal(code, 1);
    assert.deepEqual(stdoutLines, []);
    assert.ok(stderrLines.some((line) => line.includes("OUTPUT_EXISTS")));
    assert.equal(await pathExists(`${existing}.stage`), false);
    await rmdir(existing);
  }
  console.log("CLI ok (usage/env exit 2, one secret-free receipt line on success, failure exit 1)");
});

// --- 8. Composition: reused contract/adapters, no own HTTP or writers -------
{
  const source = await readFile(
    new URL("./materialize-cloud-data-plane-family.mjs", import.meta.url),
    "utf8",
  );
  for (const token of ["fetch(", "Authorization", "x-data-plane-key", "api.cloudflare.com"]) {
    assert.equal(source.includes(token), false, `materializer must not contain ${token}`);
  }
  for (const reused of [
    "createR2RestBucket",
    "createRemoteCoordinatorNamespace",
    "createCloudflareCloudDataPlane",
    "validateActivePointer",
    "validateGenerationManifest",
    "runBoundedAsyncPool",
  ]) {
    assert.ok(source.includes(reused), `materializer must reuse ${reused}`);
  }
  assert.equal(source.includes("pointerStore.compareAndSwap"), false,
    "materializer must never reference a write surface");
  assert.equal(source.includes(".put("), false, "materializer must never write objects");
  console.log("composition ok (no own HTTP/auth, writer surfaces absent, contract validation reused)");
}

// Worktree scope: the run leaves the repository delta identical. This remains
// valid both before and after the files are committed.
{
  assert.deepEqual(await gitStatus(), gitStatusAtStart,
    "test must not alter the repository worktree (only temp dirs are touched)");
  console.log("worktree scope ok (delta unchanged across the run)");
}

console.log("test-materialize-cloud-data-plane-family: ok");
