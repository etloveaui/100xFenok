#!/usr/bin/env node
// Prepare outside the family lock; commit only rechecks identity and writes.
// No provider calls, payload reads from R2, listings, pointer changes or Git writes.
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { once } from "node:events";
import { FAMILIES, resolveSourceAsOf } from "./publish-cloud-data-generation.mjs";
import { createDefaultMaterializePlane, readActiveFamilyIdentity } from "./materialize-cloud-data-plane-family.mjs";
import { createR2RestBucket } from "./lib/cloud-data-plane-r2-rest.mjs";
import { sha256Bytes, sha256Canonical, validateActivePointer, validateGenerationManifest } from "./lib/cloud-data-plane-generation.mjs";
import { ETF_FAMILY, healthKey, validateFamilyHealth, buildFamilyHealth } from "./lib/family-health.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PREFIX = "data/stockanalysis/etfs";
const SNAPSHOT_SCHEMA = "family-health-preparation/1";
const git = (root, args) => execFileSync("git", ["-C", root, ...args], {
  encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
}).trim();

export async function readHealthRecord(bucket) {
  const body = await bucket.get(healthKey());
  if (!body) return null;
  const record = JSON.parse(Buffer.from(await body.arrayBuffer()).toString("utf8"));
  return validateFamilyHealth(record);
}

export async function readCanonicalReference({ root = ROOT, ref = "origin/main" } = {}) {
  const commit = git(root, ["rev-parse", "--verify", `${ref}^{commit}`]);
  const tree = git(root, ["rev-parse", `${commit}:${PREFIX}`]);
  const rows = git(root, ["ls-tree", "-rz", commit, "--", PREFIX]).split("\0").filter(Boolean).map(row => {
    const match = /^(100644) blob ([a-f0-9]{40})\t(.+)$/.exec(row);
    if (!match || !match[3].endsWith(".json")) throw new Error("CANONICAL_MEMBER_INVALID");
    return { oid: match[2], path: match[3] };
  });
  if (!rows.length || rows.length > 7000) throw new Error("CANONICAL_MEMBER_BUDGET");
  // One streaming process. Only one member's bytes are buffered at a time.
  const child = spawn("git", ["-C", root, "cat-file", "--batch"], { stdio: ["pipe", "pipe", "pipe"] });
  const completed = once(child, "close");
  let stderr = "";
  child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-2000); });
  const timer = setTimeout(() => child.kill("SIGTERM"), 5 * 60_000);
  child.stdin.end(rows.map(row => row.oid).join("\n") + "\n");
  let buffer = Buffer.alloc(0), current = null, index = 0, total = 0;
  const assets = [];
  try {
    for await (const chunk of child.stdout) {
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
      while (true) {
        if (!current) {
          const end = buffer.indexOf(10);
          if (end < 0) break;
          const header = /^([a-f0-9]{40}) blob (\d+)$/.exec(buffer.subarray(0, end).toString());
          if (!header || header[1] !== rows[index]?.oid) throw new Error("CANONICAL_BLOB_IDENTITY_INVALID");
          current = { ...rows[index], bytes: Number(header[2]) };
          if (current.bytes > 16 * 1024 * 1024) throw new Error("CANONICAL_BLOB_SIZE_LIMIT");
          buffer = buffer.subarray(end + 1);
        }
        if (buffer.length < current.bytes + 1) break;
        if (buffer[current.bytes] !== 10) throw new Error("CANONICAL_BLOB_FRAME_INVALID");
        const body = buffer.subarray(0, current.bytes);
        const source = resolveSourceAsOf({ family: FAMILIES[ETF_FAMILY],
          payloads: new Map([[current.path, body]]), relRoot: PREFIX,
          createdIsoDay: new Date().toISOString().slice(0, 10) });
        assets.push({ path: current.path, sha256: sha256Bytes(body), bytes: body.length,
          source_as_of: source.perAsset.get(current.path.slice(PREFIX.length + 1)) });
        total += body.length;
        if (total > 1_300_000_000) throw new Error("CANONICAL_TREE_SIZE_LIMIT");
        buffer = buffer.subarray(current.bytes + 1);
        current = null;
        index += 1;
      }
    }
    const [code] = await completed;
    if (code !== 0 || buffer.length || current || index !== rows.length) throw new Error(`CANONICAL_READ_INCOMPLETE:${stderr}`);
    const lifecycle = JSON.parse(execFileSync("python3", [path.join(ROOT, "scripts/stockanalysis_etf_lifecycle.py"),
      "--root", root, "--git-ref", commit], { encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }));
    if (lifecycle.detail_count !== assets.length) throw new Error("HEALTH_LIFECYCLE_MEMBERSHIP_INVALID");
    return { kind: "git_commit", commit, tree, prefix: PREFIX, total_bytes: total, assets, lifecycle };
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill("SIGTERM");
  }
}

function validateSnapshot(snapshot, { runId, runAttempt, now }) {
  if (snapshot?.schema_version !== SNAPSHOT_SCHEMA || snapshot.family !== ETF_FAMILY
    || snapshot.run_id !== runId || snapshot.run_attempt !== runAttempt
    || !/^\d+$/.test(runId) || !/^\d+$/.test(runAttempt)
    || !Number.isFinite(Date.parse(snapshot.observed_at))
    || Date.parse(now) - Date.parse(snapshot.observed_at) > 6 * 60 * 60 * 1000
    || Date.parse(snapshot.observed_at) > Date.parse(now) + 5 * 60 * 1000) throw new Error("HEALTH_PREPARATION_BINDING_INVALID");
  const { digest, ...body } = snapshot;
  if (digest !== sha256Canonical(body)) throw new Error("HEALTH_PREPARATION_INTEGRITY_INVALID");
  validateActivePointer(snapshot.pointer);
  const manifest = validateGenerationManifest(snapshot.manifest);
  if (!snapshot.manifest.generation_id.startsWith(`${ETF_FAMILY}-`)
    || manifest.manifest_sha256 !== snapshot.pointer.active.manifest_sha256
    || manifest.generation_id !== snapshot.pointer.active.generation_id
    || snapshot.manifest.source_sha !== snapshot.pointer.source_sha) throw new Error("HEALTH_PREPARATION_MANIFEST_INVALID");
  if (snapshot.reference?.kind !== "git_commit" || !/^[a-f0-9]{40}$/.test(snapshot.reference.commit)
    || !/^[a-f0-9]{40}$/.test(snapshot.reference.tree)) throw new Error("HEALTH_REFERENCE_INVALID");
  if (snapshot.reference.lifecycle?.detail_count !== snapshot.reference.assets?.length
    || !Array.isArray(snapshot.reference.lifecycle?.orphans)
    || !Array.isArray(snapshot.reference.lifecycle?.live_catalogue_gaps)) throw new Error("HEALTH_LIFECYCLE_REFERENCE_INVALID");
}

export async function prepareHealth({ plane, reference, runId, runAttempt, now = new Date().toISOString() }) {
  const { pointer, manifest } = await readActiveFamilyIdentity({ plane, family: ETF_FAMILY });
  const snapshot = { schema_version: SNAPSHOT_SCHEMA, family: ETF_FAMILY, run_id: runId,
    run_attempt: runAttempt, observed_at: now, pointer, manifest, reference };
  snapshot.digest = sha256Canonical(snapshot);
  validateSnapshot(snapshot, { runId, runAttempt, now });
  // Validate all members before transferring the candidate to the writer.
  buildFamilyHealth({ snapshot, now });
  return snapshot;
}

export async function commitHealth({ plane, bucket, snapshot, cycle = null, runId, runAttempt,
  now = new Date().toISOString() }) {
  const started = performance.now();
  validateSnapshot(snapshot, { runId, runAttempt, now });
  const pointer = await plane.pointerStore.get();
  if (sha256Canonical(pointer) !== sha256Canonical(snapshot.pointer)) throw new Error("HEALTH_POINTER_CHANGED_REPREPARE");
  let previous;
  try { previous = await readHealthRecord(bucket); }
  catch { throw new Error("HEALTH_PREVIOUS_UNREADABLE"); }
  if (previous && Date.parse(previous.observed_at) > Date.parse(snapshot.observed_at)) throw new Error("HEALTH_NEWER_OBSERVATION_PRESENT");
  const record = buildFamilyHealth({ snapshot, previous, cycle, now });
  const bytes = new TextEncoder().encode(JSON.stringify(record));
  await bucket.put(healthKey(), bytes);
  const actual = await bucket.get(healthKey());
  if (!actual || sha256Bytes(new Uint8Array(await actual.arrayBuffer())) !== sha256Bytes(bytes)) throw new Error("HEALTH_RECORD_READBACK_INVALID");
  return { result: "health_record_updated", family: ETF_FAMILY, reference: record.reference,
    parity: record.parity, observed_at: record.observed_at,
    commit_elapsed_ms: Math.round(performance.now() - started) };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const [mode, filename] = argv;
  if (!["needed", "prepare", "commit"].includes(mode) || (mode !== "needed" && !filename) || argv.length > 2) throw new Error("USAGE: needed | prepare FILE | commit FILE");
  const config = { accountId: env.CLOUDFLARE_ACCOUNT_ID, token: env.CLOUDFLARE_API_TOKEN,
    endpoint: env.DATA_PLANE_ENDPOINT, writeKey: env.DATA_PLANE_WRITE_KEY, family: ETF_FAMILY };
  const bucket = createR2RestBucket({ ...config, bucket: "fenok-data-plane" });
  if (mode === "needed") {
    let record;
    try { record = await readHealthRecord(bucket); } catch { record = null; }
    const needed = record?.observed_at.slice(0, 10) !== new Date().toISOString().slice(0, 10);
    if (env.GITHUB_OUTPUT) await fs.appendFile(env.GITHUB_OUTPUT, `needed=${needed}\n`);
    console.log(JSON.stringify({ needed }));
    return;
  }
  const plane = createDefaultMaterializePlane(config);
  const binding = { runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT };
  if (mode === "prepare") {
    const reference = await readCanonicalReference();
    const snapshot = await prepareHealth({ plane, reference, ...binding });
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, JSON.stringify(snapshot));
    console.log(JSON.stringify({ result: "prepared", members: reference.assets.length, commit: reference.commit, digest: snapshot.digest }));
  } else {
    const snapshot = JSON.parse(await fs.readFile(filename, "utf8"));
    console.log(JSON.stringify(await commitHealth({ plane, bucket, snapshot,
      cycle: env.HEALTH_PUBLICATION_CYCLE || null, ...binding })));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
