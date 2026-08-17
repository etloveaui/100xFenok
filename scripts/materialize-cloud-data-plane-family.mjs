#!/usr/bin/env node
// Read-only Cloud Data Plane family materializer.
//
// Resolves a family's ACTIVE generation from the cloud data plane (pointer ->
// manifest -> private payload objects), verifies every byte against the
// contract, and materializes the verified tree to an external output root via
// a sibling stage directory and one atomic rename. This is the reader-side
// twin of publish-cloud-data-generation.mjs (which stays the writer), built
// for later git-raw-writer retirement: the local tree is never read, and
// nothing here ever mutates the plane.
//
// Read-only guarantee: the ONLY plane surface used is pointerStore.get and
// objectStore.get. No pointer write, no compare-and-swap, no ledger call, no
// object list, no delete, and no R2 mutation of any kind. This file carries no
// HTTP/auth logic of its own — the REST bridge, the remote coordinator shim
// and the Cloudflare adapter are reused unchanged.
//
// Reader-side safety contract (all fail closed before any payload byte is
// staged):
// - output root must resolve strictly OUTSIDE the repository, strictly inside
//   the external temp base (RUNNER_TEMP, else TMPDIR, else the OS temp dir),
//   must not already exist, its parent must exist, and no ancestor component
//   below the base may be a symlink (a symlinked parent is a parent escape).
// - the pointer must validate; the stored manifest bytes must hash to the
//   pointer's manifest_sha256; the parsed manifest must re-validate and
//   cross-bind (generation_id, manifest_sha256, source_sha) to the pointer.
// - >=1 asset; every asset privacy_class "private" and path strictly under
//   --manifest-prefix (one or more safe unique relative segments after the
//   prefix); the content-addressed object key is enforced by the contract's
//   own validation.
// - payloads are fetched with bounded concurrency (max 8, the contract
//   constant) and each verified by byteLength + SHA-256 against the manifest
//   BEFORE staging; every staged file is read back and re-verified before the
//   rename completes.
// - on ANY failure only the exact stage directory this run created is removed;
//   the output target is never created, and if the run fails before staging
//   nothing is removed at all.
//
// CLI: --family <name> --manifest-prefix <prefix> --output-root <path>
// Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, DATA_PLANE_ENDPOINT,
//      DATA_PLANE_WRITE_KEY. Fixed existing bucket: fenok-data-plane.
// Materialize mode emits exactly one JSON line on stdout with
//   family, generation_id, manifest_sha256, source_sha, asset_count,
//   total_bytes, output_root. Verify mode emits that verified receipt with
//   status:"current" appended. No secrets, ever.

import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  runBoundedAsyncPool,
  sha256Bytes,
  validateActivePointer,
  validateGenerationManifest,
} from "./lib/cloud-data-plane-generation.mjs";
import { createCloudflareCloudDataPlane } from "./lib/cloud-data-plane-cloudflare-adapter.mjs";
import { createR2RestBucket } from "./lib/cloud-data-plane-r2-rest.mjs";
import { createRemoteCoordinatorNamespace } from "./lib/cloud-data-plane-remote-coordinator.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const R2_BUCKET = "fenok-data-plane";
const MATERIALIZE_RECEIPT_KEYS = Object.freeze([
  "family",
  "generation_id",
  "manifest_sha256",
  "source_sha",
  "asset_count",
  "total_bytes",
  "output_root",
]);
const SHA256_HEX = /^[0-9a-f]{64}$/;

function fail(code, detail) {
  const error = new Error(`${code}:${detail}`);
  error.code = code;
  throw error;
}

function isSafeSegment(segment) {
  return segment.length > 0
    && segment !== "."
    && segment !== ".."
    && !/[\\\x00-\x1f\x7f]/.test(segment);
}

// The logical asset-prefix (e.g. "data/stockanalysis/etfs"). Normalizes a
// trailing slash away but rejects absolute paths, backslashes, empty or
// dot/dotdot segments, and control characters.
function normalizeManifestPrefix(value) {
  if (typeof value !== "string" || value.length === 0) {
    fail("PREFIX_INVALID", "manifest prefix must be a non-empty relative path");
  }
  const cleaned = value.replace(/^\.\//, "").replace(/\/+$/, "");
  const segments = cleaned.split("/");
  if (cleaned.startsWith("/") || !segments.every(isSafeSegment)) {
    fail("PREFIX_INVALID", `unsafe manifest prefix ${value}`);
  }
  return cleaned;
}

// A relative path of ONE OR MORE safe segments (no empty/dot/dotdot segment,
// no backslash, no control characters). Returns the segments or null.
function safeRelativeSegments(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const segments = value.split("/");
  if (!segments.every(isSafeSegment)) return null;
  return segments;
}

function assertExactKeys(value, expected, code, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(code, `${label} keys must be exactly ${wanted.join(",")}`);
  }
}

function validatePlaneAndFamily(plane, family) {
  if (!plane || !plane.pointerStore || !plane.objectStore) {
    fail("PLANE_INVALID", "pointerStore and objectStore are required");
  }
  if (typeof family !== "string" || family.length === 0) {
    fail("FAMILY_INVALID", "family must be a non-empty string");
  }
}

async function readActiveFamilyIdentity({ plane, family }) {
  validatePlaneAndFamily(plane, family);
  const pointer = await plane.pointerStore.get();
  if (pointer === null || pointer === undefined) fail("ACTIVE_POINTER_UNAVAILABLE", family);
  validateActivePointer(pointer);

  const manifestBytes = await plane.objectStore.get(pointer.active.manifest_key);
  if (!(manifestBytes instanceof Uint8Array)) fail("MANIFEST_MISSING", pointer.active.manifest_key);
  if (sha256Bytes(manifestBytes) !== pointer.active.manifest_sha256) {
    fail("MANIFEST_INTEGRITY_INVALID", pointer.active.manifest_key);
  }
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    fail("MANIFEST_PARSE_INVALID", pointer.active.manifest_key);
  }
  const summary = validateGenerationManifest(manifest);
  if (
    summary.generation_id !== pointer.active.generation_id
    || summary.manifest_sha256 !== pointer.active.manifest_sha256
    || manifest.source_sha !== pointer.source_sha
  ) {
    fail("MANIFEST_CROSS_BIND_INVALID", pointer.active.generation_id);
  }
  return {
    pointer,
    manifest,
    summary,
    identity: {
      family,
      generation_id: summary.generation_id,
      manifest_sha256: summary.manifest_sha256,
      source_sha: manifest.source_sha,
    },
  };
}

async function readMaterializeReceipt(receiptPath) {
  const absolute = path.resolve(String(receiptPath));
  let stat;
  try {
    stat = await lstat(absolute);
  } catch {
    fail("RECEIPT_MISSING", absolute);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) fail("RECEIPT_PATH_INVALID", absolute);
  let receipt;
  try {
    receipt = JSON.parse(await readFile(absolute, "utf8"));
  } catch {
    fail("RECEIPT_PARSE_INVALID", absolute);
  }
  if (receipt === null || typeof receipt !== "object" || Array.isArray(receipt)) {
    fail("RECEIPT_SCHEMA_INVALID", "receipt must be a JSON object");
  }
  assertExactKeys(receipt, MATERIALIZE_RECEIPT_KEYS, "RECEIPT_SCHEMA_INVALID", "receipt");
  return receipt;
}

function validateMaterializeReceipt(receipt) {
  if (typeof receipt.family !== "string" || receipt.family.length === 0) {
    fail("RECEIPT_SCHEMA_INVALID", "receipt family must be a non-empty string");
  }
  if (typeof receipt.generation_id !== "string" || receipt.generation_id.length === 0) {
    fail("RECEIPT_SCHEMA_INVALID", "receipt generation_id must be a non-empty string");
  }
  for (const key of ["manifest_sha256", "source_sha"]) {
    if (typeof receipt[key] !== "string" || !SHA256_HEX.test(receipt[key])) {
      fail("RECEIPT_SCHEMA_INVALID", `receipt ${key} must be a lowercase SHA-256`);
    }
  }
  if (!Number.isSafeInteger(receipt.asset_count) || receipt.asset_count < 1) {
    fail("RECEIPT_SCHEMA_INVALID", "receipt asset_count must be a positive safe integer");
  }
  if (!Number.isSafeInteger(receipt.total_bytes) || receipt.total_bytes < 0) {
    fail("RECEIPT_SCHEMA_INVALID", "receipt total_bytes must be a non-negative safe integer");
  }
  if (typeof receipt.output_root !== "string" || !path.isAbsolute(receipt.output_root)) {
    fail("RECEIPT_SCHEMA_INVALID", "receipt output_root must be an absolute path");
  }
}

// The materializer's output root is deliberately external and newly created.
// Verification accepts only an existing, real directory at that same boundary:
// no repository path, no temp-base escape, and no symlink in the path chain.
async function validateExistingOutputRoot({ outputRoot, env, repoRoot }) {
  let absolute;
  try {
    absolute = path.resolve(String(outputRoot));
  } catch {
    fail("OUTPUT_PATH_INVALID", String(outputRoot));
  }
  if (absolute !== outputRoot) fail("RECEIPT_OUTPUT_INVALID", outputRoot);
  const repoReal = await realpath(repoRoot);
  if (absolute === repoReal || absolute.startsWith(`${repoReal}${path.sep}`)) {
    fail("OUTPUT_INSIDE_REPO", absolute);
  }
  const baseLexical = path.resolve(env.RUNNER_TEMP || env.TMPDIR || os.tmpdir());
  let baseReal;
  try {
    baseReal = await realpath(baseLexical);
    const baseStat = await lstat(baseReal);
    if (!baseStat.isDirectory()) fail("OUTPUT_BASE_INVALID", baseLexical);
  } catch (error) {
    if (error.code === "OUTPUT_BASE_INVALID") throw error;
    fail("OUTPUT_BASE_INVALID", baseLexical);
  }
  const relative = path.relative(baseReal, absolute);
  if (
    relative === ""
    || relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    fail("OUTPUT_PARENT_ESCAPE", absolute);
  }
  let cursor = baseReal;
  for (const part of relative.split(path.sep).filter((segment) => segment.length > 0)) {
    cursor = path.join(cursor, part);
    let stat;
    try {
      stat = await lstat(cursor);
    } catch {
      fail("OUTPUT_MISSING", cursor);
    }
    if (stat.isSymbolicLink()) fail("OUTPUT_SYMLINK", cursor);
    if (cursor === absolute && !stat.isDirectory()) fail("OUTPUT_PATH_INVALID", absolute);
  }
  let resolved;
  try {
    resolved = await realpath(absolute);
  } catch {
    fail("OUTPUT_MISSING", absolute);
  }
  if (resolved !== absolute) fail("OUTPUT_SYMLINK", absolute);
  return absolute;
}

async function readOutputTree(outputRoot) {
  const files = new Map();
  const directories = new Set([""]);
  async function walk(directory, relativeDirectory) {
    let children;
    try {
      children = await readdir(directory);
    } catch {
      fail("OUTPUT_READ_FAILED", relativeDirectory || outputRoot);
    }
    for (const name of children.sort()) {
      const relative = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      const fullPath = path.join(directory, name);
      let stat;
      try {
        stat = await lstat(fullPath);
      } catch {
        fail("OUTPUT_READ_FAILED", relative);
      }
      if (stat.isSymbolicLink()) fail("OUTPUT_SYMLINK", relative);
      if (stat.isDirectory()) {
        directories.add(relative);
        await walk(fullPath, relative);
        continue;
      }
      if (!stat.isFile()) fail("OUTPUT_ENTRY_INVALID", relative);
      let bytes;
      try {
        bytes = await readFile(fullPath);
      } catch {
        fail("OUTPUT_READ_FAILED", relative);
      }
      files.set(relative, {
        bytes: bytes.byteLength,
        sha256: sha256Bytes(bytes),
      });
    }
  }
  await walk(outputRoot, "");
  return { files, directories };
}

// The receipt intentionally carries no prefix: derive the only safe family
// prefix common to every manifest asset, then compare the materialized tree
// against the manifest's exact relative paths.
function deriveManifestPrefix(manifest) {
  const directorySegments = manifest.assets.map((asset) => asset.path.split("/").slice(0, -1));
  if (directorySegments.some((segments) => segments.length === 0)) {
    fail("MANIFEST_PREFIX_INVALID", "every asset must have a directory prefix");
  }
  const common = [...directorySegments[0]];
  for (const segments of directorySegments.slice(1)) {
    let length = 0;
    while (length < common.length && length < segments.length && common[length] === segments[length]) {
      length += 1;
    }
    common.length = length;
  }
  if (common.length === 0) fail("MANIFEST_PREFIX_INVALID", "assets have no common directory prefix");
  return common.join("/");
}

async function verifyMaterializedTree({ outputRoot, manifest, summary, receipt }) {
  const prefix = deriveManifestPrefix(manifest);
  const expectedFiles = new Map();
  const expectedDirectories = new Set([""]);
  for (const asset of manifest.assets) {
    if (asset.privacy_class !== "private") {
      fail("ASSET_PRIVACY_INVALID", `${asset.privacy_class}:${asset.path}`);
    }
    if (!asset.path.startsWith(`${prefix}/`)) fail("ASSET_PREFIX_INVALID", asset.path);
    const relative = asset.path.slice(prefix.length + 1);
    const segments = safeRelativeSegments(relative);
    if (segments === null || expectedFiles.has(relative)) fail("ASSET_REL_PATH_INVALID", asset.path);
    expectedFiles.set(relative, asset);
    for (let index = 1; index < segments.length; index += 1) {
      expectedDirectories.add(segments.slice(0, index).join("/"));
    }
  }

  const tree = await readOutputTree(outputRoot);
  for (const relative of tree.files.keys()) {
    if (!expectedFiles.has(relative)) fail("OUTPUT_FILE_EXTRA", relative);
  }
  for (const relative of expectedFiles.keys()) {
    if (!tree.files.has(relative)) fail("OUTPUT_FILE_MISSING", relative);
  }
  for (const relative of tree.directories) {
    if (!expectedDirectories.has(relative)) fail("OUTPUT_DIRECTORY_EXTRA", relative);
  }
  for (const relative of expectedDirectories) {
    if (!tree.directories.has(relative)) fail("OUTPUT_DIRECTORY_MISSING", relative);
  }
  if (receipt.asset_count !== summary.asset_count || receipt.asset_count !== expectedFiles.size) {
    fail("RECEIPT_ASSET_COUNT_MISMATCH", `${receipt.asset_count}:${summary.asset_count}`);
  }
  if (receipt.total_bytes !== summary.total_bytes) {
    fail("RECEIPT_TOTAL_BYTES_MISMATCH", `${receipt.total_bytes}:${summary.total_bytes}`);
  }
  if (tree.files.size !== expectedFiles.size) {
    fail("OUTPUT_ASSET_COUNT_MISMATCH", `${tree.files.size}:${expectedFiles.size}`);
  }
  const actualTotalBytes = [...tree.files.values()].reduce((sum, file) => sum + file.bytes, 0);
  if (actualTotalBytes !== receipt.total_bytes) {
    fail("OUTPUT_TOTAL_BYTES_MISMATCH", `${actualTotalBytes}:${receipt.total_bytes}`);
  }
  for (const [relative, asset] of expectedFiles) {
    const actual = tree.files.get(relative);
    if (actual.bytes !== asset.bytes || actual.sha256 !== asset.sha256) {
      fail("OUTPUT_FILE_INTEGRITY_INVALID", relative);
    }
  }
}

export async function verifyCloudDataPlaneFamilyReceipt({
  plane,
  family,
  receiptPath,
  env = process.env,
  repoRoot = REPO_ROOT,
}) {
  const receipt = await readMaterializeReceipt(receiptPath);
  validateMaterializeReceipt(receipt);
  const outputRoot = await validateExistingOutputRoot({
    outputRoot: receipt.output_root,
    env,
    repoRoot,
  });
  const { pointer, manifest, summary, identity } = await readActiveFamilyIdentity({ plane, family });
  if (receipt.family !== family) fail("RECEIPT_IDENTITY_MISMATCH", `family:${receipt.family}`);
  for (const key of ["family", "generation_id", "manifest_sha256", "source_sha"]) {
    if (receipt[key] !== identity[key]) {
      fail("RECEIPT_IDENTITY_MISMATCH", `${key}:${String(receipt[key])}`);
    }
  }
  if (
    receipt.output_root !== outputRoot
    || receipt.asset_count !== summary.asset_count
    || receipt.total_bytes !== summary.total_bytes
    || pointer.active.generation_id !== receipt.generation_id
    || pointer.active.manifest_sha256 !== receipt.manifest_sha256
    || pointer.source_sha !== receipt.source_sha
    || manifest.source_sha !== receipt.source_sha
  ) {
    fail("RECEIPT_MANIFEST_BINDING_INVALID", receipt.generation_id);
  }
  await verifyMaterializedTree({ outputRoot, manifest, summary, receipt });
  return { ...receipt, status: "current" };
}

// Validate the output root BEFORE any plane read. Rejections, in order:
//   unreadable path (NUL)         -> OUTPUT_PATH_INVALID
//   at or inside the repo          -> OUTPUT_INSIDE_REPO
//   outside the external temp base -> OUTPUT_PARENT_ESCAPE
//   base missing / not a directory  -> OUTPUT_BASE_INVALID
//   parent missing / not a dir      -> OUTPUT_PARENT_MISSING
//   symlinked ancestor below base   -> OUTPUT_SYMLINK
//   realpath(parent) != parent      -> OUTPUT_PARENT_ESCAPE
//   target already present          -> OUTPUT_EXISTS
// Returns the resolved absolute output root.
async function validateOutputRoot({ outputRoot, env, repoRoot }) {
  let absolute;
  try {
    absolute = path.resolve(String(outputRoot));
  } catch {
    fail("OUTPUT_PATH_INVALID", String(outputRoot));
  }
  const repoReal = await realpath(repoRoot);
  if (absolute === repoReal || absolute.startsWith(`${repoReal}${path.sep}`)) {
    fail("OUTPUT_INSIDE_REPO", absolute);
  }
  const baseLexical = path.resolve(env.RUNNER_TEMP || env.TMPDIR || os.tmpdir());
  let baseReal;
  try {
    baseReal = await realpath(baseLexical);
    const baseStat = await lstat(baseReal);
    if (!baseStat.isDirectory()) fail("OUTPUT_BASE_INVALID", baseLexical);
  } catch (error) {
    if (error.code === "OUTPUT_BASE_INVALID") throw error;
    fail("OUTPUT_BASE_INVALID", baseLexical);
  }
  if (!absolute.startsWith(`${baseReal}${path.sep}`)) {
    fail("OUTPUT_PARENT_ESCAPE", absolute);
  }
  const parent = path.dirname(absolute);
  let parentStat;
  try {
    parentStat = await lstat(parent);
  } catch {
    fail("OUTPUT_PARENT_MISSING", parent);
  }
  if (parentStat.isSymbolicLink()) fail("OUTPUT_SYMLINK", parent);
  if (!parentStat.isDirectory()) fail("OUTPUT_PARENT_INVALID", parent);

  // Walk every existing component strictly below the base; a symlink at any
  // level redirects the true parent elsewhere and is a parent escape.
  const relative = path.relative(baseReal, parent);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail("OUTPUT_PARENT_ESCAPE", parent);
  }
  let cursor = baseReal;
  for (const part of relative.split(path.sep).filter((segment) => segment.length > 0)) {
    cursor = path.join(cursor, part);
    let stat;
    try {
      stat = await lstat(cursor);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) fail("OUTPUT_SYMLINK", cursor);
  }
  let parentReal;
  try {
    parentReal = await realpath(parent);
  } catch {
    fail("OUTPUT_PARENT_INVALID", parent);
  }
  if (parentReal !== parent) fail("OUTPUT_PARENT_ESCAPE", parent);

  try {
    await lstat(absolute);
    fail("OUTPUT_EXISTS", absolute);
  } catch (error) {
    if (error.code !== "ENOENT") {
      if (error.code === "OUTPUT_EXISTS") throw error;
      fail("OUTPUT_PATH_INVALID", absolute);
    }
  }
  return absolute;
}

// Core reader-side materialization. Read-only against `plane` (only
// pointerStore.get and objectStore.get are ever called); every byte the tree
// receives is verified twice (plane bytes vs manifest, staged file readback vs
// manifest) before the stage directory is renamed to the output root.
export async function materializeCloudDataPlaneFamily({
  plane,
  family,
  manifestPrefix,
  outputRoot,
  env = process.env,
  repoRoot = REPO_ROOT,
}) {
  validatePlaneAndFamily(plane, family);
  const prefix = normalizeManifestPrefix(manifestPrefix);
  const output = await validateOutputRoot({ outputRoot, env, repoRoot });
  const { manifest, summary } = await readActiveFamilyIdentity({ plane, family });
  if (summary.asset_count < 1) fail("ASSET_COUNT_INVALID", "at least one asset is required");

  // 3. Family enrollment: every asset private and strictly under the prefix,
  // with a unique safe relative remainder of one or more segments.
  const entries = [];
  const relativePaths = new Set();
  for (const asset of manifest.assets) {
    if (asset.privacy_class !== "private") {
      fail("ASSET_PRIVACY_INVALID", `${asset.privacy_class}:${asset.path}`);
    }
    if (asset.path === prefix) {
      // The path does not leave the prefix at all: strictly under the prefix
      // requires one or more segments after it.
      fail("ASSET_REL_PATH_INVALID", asset.path);
    }
    if (!asset.path.startsWith(`${prefix}/`)) {
      fail("ASSET_PREFIX_INVALID", asset.path);
    }
    const remainder = asset.path.slice(prefix.length + 1);
    const segments = safeRelativeSegments(remainder);
    if (segments === null) fail("ASSET_REL_PATH_INVALID", asset.path);
    if (relativePaths.has(remainder)) fail("ASSET_DUPLICATE", remainder);
    relativePaths.add(remainder);
    entries.push({ asset, segments });
  }

  // 4. Stage beside the output, materialize under bounded concurrency, verify
  // every staged file, then one atomic rename. Failure removes only this
  // run's exact stage directory; the output is never created.
  const stageDir = `${output}.stage`;
  let stageStat;
  try {
    stageStat = await lstat(stageDir);
  } catch {
    stageStat = null;
  }
  if (stageStat !== null) fail("STAGE_EXISTS", stageDir);
  await mkdir(stageDir);
  let stageCreated = true;
  try {
    await runBoundedAsyncPool(entries, async ({ asset, segments }) => {
      const payload = await plane.objectStore.get(asset.object_key);
      if (!(payload instanceof Uint8Array)) fail("PAYLOAD_MISSING", asset.path);
      if (payload.byteLength !== asset.bytes || sha256Bytes(payload) !== asset.sha256) {
        fail("PAYLOAD_INTEGRITY_INVALID", asset.path);
      }
      const filePath = path.join(stageDir, ...segments);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, payload, { flag: "wx" });
      const written = await readFile(filePath);
      if (written.byteLength !== asset.bytes || sha256Bytes(written) !== asset.sha256) {
        fail("MATERIALIZE_VERIFY_INVALID", asset.path);
      }
    });
    await rename(stageDir, output);
    stageCreated = false;
  } catch (error) {
    if (stageCreated) {
      await rm(stageDir, { recursive: true, force: true }).catch(() => {});
    }
    throw error;
  }

  return {
    family,
    generation_id: summary.generation_id,
    manifest_sha256: summary.manifest_sha256,
    source_sha: manifest.source_sha,
    asset_count: summary.asset_count,
    total_bytes: summary.total_bytes,
    output_root: output,
  };
}

// Live plane: the same REST bridge + remote coordinator + adapter wiring the
// writer uses, bound to the family's own coordinator instance. No new
// HTTP/auth logic; configuration is enforced before any remote call.
export function createDefaultMaterializePlane({ accountId, token, endpoint, writeKey, family }) {
  if (!accountId || !token || !endpoint || !writeKey) {
    fail("PLANE_CONFIG_INVALID", "accountId, token, endpoint and writeKey are required");
  }
  const r2Bucket = createR2RestBucket({ accountId, bucket: R2_BUCKET, token });
  const coordinatorNamespace = createRemoteCoordinatorNamespace({ endpoint, key: writeKey, family });
  return createCloudflareCloudDataPlane({
    r2Bucket,
    coordinatorNamespace,
    coordinatorName: family,
  });
}

function parseArgs(argv) {
  if (!Array.isArray(argv)) fail("USAGE", "argv must be an array");
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!["--family", "--manifest-prefix", "--output-root", "--verify-receipt"].includes(flag)) {
      fail("USAGE", `unknown or unexpected argument ${flag}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--") || value.length === 0) {
      fail("USAGE", `${flag} requires a value`);
    }
    const key = flag.slice(2);
    if (Object.hasOwn(args, key)) fail("USAGE", `duplicate argument ${flag}`);
    args[key] = value;
    index += 1;
  }
  const verifyMode = Boolean(args["verify-receipt"]);
  const expected = verifyMode
    ? ["family", "verify-receipt"]
    : ["family", "manifest-prefix", "output-root"];
  const missing = expected.filter((key) => !args[key]);
  if (missing.length) {
    fail("USAGE", `missing required arguments: ${missing.map((key) => `--${key}`).join(", ")}`);
  }
  const unexpected = Object.keys(args).filter((key) => !expected.includes(key));
  if (unexpected.length) fail("USAGE", `arguments cannot be mixed across modes: ${unexpected.join(",")}`);
  return { ...args, mode: verifyMode ? "verify" : "materialize" };
}

export async function runMaterializerCli({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = (line) => console.log(line),
  stderr = (...parts) => console.error(...parts),
  createPlaneImpl = createDefaultMaterializePlane,
} = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    stderr(`materialize-cloud-data-plane-family: ${error.code ?? "USAGE"}: ${error.message}`);
    return 2;
  }
  const missing = [
    ["CLOUDFLARE_ACCOUNT_ID", env.CLOUDFLARE_ACCOUNT_ID],
    ["CLOUDFLARE_API_TOKEN", env.CLOUDFLARE_API_TOKEN],
    ["DATA_PLANE_ENDPOINT", env.DATA_PLANE_ENDPOINT],
    ["DATA_PLANE_WRITE_KEY", env.DATA_PLANE_WRITE_KEY],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    stderr(`materialize-cloud-data-plane-family: missing env ${missing.join(", ")} — no plane read attempted`);
    return 2;
  }
  try {
    const plane = createPlaneImpl({
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      token: env.CLOUDFLARE_API_TOKEN,
      endpoint: env.DATA_PLANE_ENDPOINT,
      writeKey: env.DATA_PLANE_WRITE_KEY,
      family: args.family,
    });
    const receipt = args.mode === "verify"
      ? await verifyCloudDataPlaneFamilyReceipt({
        plane,
        family: args.family,
        receiptPath: args["verify-receipt"],
        env,
      })
      : await materializeCloudDataPlaneFamily({
        plane,
        family: args.family,
        manifestPrefix: args["manifest-prefix"],
        outputRoot: args["output-root"],
        env,
      });
    stdout(JSON.stringify(receipt));
    return 0;
  } catch (error) {
    stderr(`materialize-cloud-data-plane-family: ${error.code ?? "ERROR"}: ${error.message}`);
    return 1;
  }
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    process.exitCode = await runMaterializerCli();
  } catch (error) {
    console.error(`materialize-cloud-data-plane-family: ${error.code ?? "ERROR"}: ${error.message}`);
    process.exitCode = 1;
  }
}
