#!/usr/bin/env node
// Prepare pinned metadata outside the family lock; re-prepare under the lock
// when publication overtakes it. No provider calls, listings or pointer writes.
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { once } from "node:events";
import { FAMILIES, resolveSourceAsOf } from "./publish-cloud-data-generation.mjs";
import { createDefaultMaterializePlane, readActiveFamilyIdentity } from "./materialize-cloud-data-plane-family.mjs";
import { createR2RestBucket } from "./lib/cloud-data-plane-r2-rest.mjs";
import { readGenerationAssetBytes, runBoundedAsyncPool, sha256Bytes, sha256Canonical, validateActivePointer, validateGenerationManifest } from "./lib/cloud-data-plane-generation.mjs";
import { ETF_FAMILY, healthKey, validateFamilyHealth, buildFamilyHealth, etfSourceMembers, buildDetailRefreshCadence } from "./lib/family-health.mjs";
import { DATA_SUPPLY_POLICY_REGISTRY } from "./data-supply-policy-registry.mjs";

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
  const readReferenceJson = relative => {
    if (!git(root, ["ls-tree", commit, "--", relative])) return null;
    return JSON.parse(git(root, ["show", `${commit}:${relative}`]));
  };
  const servedIndex = readReferenceJson("data/computed/data-supply/etf-detail/index.json");
  const cadence = servedIndex?.detail_refresh_cadence ?? buildDetailRefreshCadence(
    readReferenceJson("data/stockanalysis/etf_universe.json"),
    readReferenceJson("data/admin/fenok-etf-core-daily-basket.json"));
  const { fresh_ttl_hours, emergency_lkg_ttl_days } = DATA_SUPPLY_POLICY_REGISTRY.domains.etf_detail;
  const sourcePolicy = { fresh_ttl_hours, emergency_lkg_ttl_days };
  const sourceMembers = etfSourceMembers(servedIndex, sourcePolicy, cadence);
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
        if (total > FAMILIES[ETF_FAMILY].policy.max_total_bytes) throw new Error("CANONICAL_TREE_SIZE_LIMIT");
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
    return { kind: "git_commit", commit, tree, prefix: PREFIX, total_bytes: total, assets, lifecycle,
      source_members: sourceMembers, source_policy: sourcePolicy,
      source_index_sha256: servedIndex?.index_sha256 ?? null };
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill("SIGTERM");
  }
}

export async function readActiveReference({ plane, cataloguePlane, yahooPlane, identity, root = ROOT,
  now = new Date().toISOString() }) {
  const { pointer, manifest } = identity ?? await readActiveFamilyIdentity({ plane, family: ETF_FAMILY });
  // Read immutable objects named by this manifest, never working files hydrated
  // before a later pointer read. Detail payload hashes already live in it.
  const readJson = async (source, asset) => {
    if (!asset) throw new Error("HEALTH_METADATA_MISSING");
    return JSON.parse(Buffer.from(await readGenerationAssetBytes({ asset, objectStore: source.objectStore })));
  };
  const relative = "data/computed/data-supply/etf-detail/index.json";
  const servedIndex = await readJson(plane, manifest.assets.find(row => row.path === relative));
  const cadence = servedIndex.detail_refresh_cadence;
  const { fresh_ttl_hours, emergency_lkg_ttl_days } = DATA_SUPPLY_POLICY_REGISTRY.domains.etf_detail;
  const sourcePolicy = { fresh_ttl_hours, emergency_lkg_ttl_days };
  const assets = manifest.assets.filter(row => row.path.startsWith(`${PREFIX}/`));
  const tickers = assets.map(row => path.basename(row.path, ".json"));
  const files = {};
  const statePaths = new Set(tickers.map(ticker => `data/admin/stockanalysis-recovery/states/etf/${ticker}.json`));
  await runBoundedAsyncPool(manifest.assets.filter(row => statePaths.has(row.path)), async asset => {
    files[asset.path] = await readJson(plane, asset);
  });
  const { manifest: catalogue } = await readActiveFamilyIdentity({ plane: cataloguePlane, family: "stockanalysis-catalogue" });
  for (const name of ["etf_universe.json", "surfaces/etf_screener.json"]) {
    files[`data/stockanalysis/${name}`] = await readJson(cataloguePlane,
      catalogue.assets.find(row => row.path === `public/data/stockanalysis/${name}`));
  }
  const { manifest: yahoo } = await readActiveFamilyIdentity({ plane: yahooPlane, family: "yahoo-finance" });
  const observations = await readJson(yahooPlane,
    yahoo.assets.find(row => row.path === "data/yf/_acquisition-state.json"));
  if (observations.schema_version !== "yahoo-generation-observations/v1") throw new Error("HEALTH_YAHOO_OBSERVATIONS_INVALID");
  for (const ticker of tickers) {
    const saved = observations.tickers?.[ticker];
    if (saved?.terminal) files[`data/admin/yahoo-batch-quote-history/tickers/${ticker}.json`] = {
      ...saved, schema_version: "yahoo-batch-quote-history-state/v1", ticker,
      resolution_state: "terminal_provider_unsupported",
    };
  }
  // Reuse the lifecycle classifier with frozen metadata, as its Git reader does.
  // It needs member names and observations, not 900 MB of ETF/Yahoo price data.
  const lifecycle = JSON.parse(execFileSync("python3", ["-c", `
import json, sys
from types import SimpleNamespace
sys.path.insert(0, sys.argv[1])
from stockanalysis_etf_lifecycle import membership
data = json.load(sys.stdin)
inputs = SimpleNamespace(detail_tickers=set(data["tickers"]), read=data["files"].get)
print(json.dumps(membership(inputs, sys.argv[2])))
`, path.join(root, "scripts"), now], { input: JSON.stringify({ tickers, files }),
    encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }));
  return { kind: "active_generation", generation_id: manifest.generation_id,
    manifest_sha256: pointer.active.manifest_sha256, prefix: PREFIX,
    total_bytes: assets.reduce((sum, row) => sum + row.bytes, 0), assets, lifecycle,
    source_members: etfSourceMembers(servedIndex, sourcePolicy, cadence),
    source_policy: sourcePolicy, source_index_sha256: servedIndex.index_sha256 };
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
  if (snapshot.reference?.kind === "active_generation") {
    if (snapshot.reference.generation_id !== snapshot.manifest.generation_id
      || snapshot.reference.manifest_sha256 !== manifest.manifest_sha256) throw new Error("HEALTH_REFERENCE_INVALID");
  } else if (snapshot.reference?.kind !== "git_commit" || !/^[a-f0-9]{40}$/.test(snapshot.reference.commit)
    || !/^[a-f0-9]{40}$/.test(snapshot.reference.tree)) throw new Error("HEALTH_REFERENCE_INVALID");
  if (snapshot.reference.lifecycle?.detail_count !== snapshot.reference.assets?.length
    || !Array.isArray(snapshot.reference.lifecycle?.orphans)
    || !Array.isArray(snapshot.reference.lifecycle?.live_catalogue_gaps)) throw new Error("HEALTH_LIFECYCLE_REFERENCE_INVALID");
}

export async function prepareHealth({ plane, reference, identity, runId, runAttempt, now = new Date().toISOString() }) {
  const { pointer, manifest } = identity ?? await readActiveFamilyIdentity({ plane, family: ETF_FAMILY });
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
  return { result: "health_record_updated", family: ETF_FAMILY,
    reference: { ...record.reference, source_members: undefined },
    parity: record.parity, source_health: record.source_health, observed_at: record.observed_at,
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
    console.log(JSON.stringify({ needed, observed_at: record?.observed_at ?? null,
      generation_id: record?.plane?.generation_id ?? null }));
    return;
  }
  const plane = createDefaultMaterializePlane(config);
  const binding = { runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT };
  const prepare = async () => {
    const identity = await readActiveFamilyIdentity({ plane, family: ETF_FAMILY });
    const now = new Date().toISOString();
    const reference = await readActiveReference({ plane, identity, now,
      cataloguePlane: createDefaultMaterializePlane({ ...config, family: "stockanalysis-catalogue" }),
      yahooPlane: createDefaultMaterializePlane({ ...config, family: "yahoo-finance" }) });
    return prepareHealth({ plane, reference, identity, ...binding, now });
  };
  if (mode === "prepare") {
    const snapshot = await prepare();
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, JSON.stringify(snapshot));
    console.log(JSON.stringify({ result: "prepared", members: snapshot.reference.assets.length, generation_id: snapshot.reference.generation_id, digest: snapshot.digest }));
  } else {
    let snapshot = JSON.parse(await fs.readFile(filename, "utf8"));
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        console.log(JSON.stringify(await commitHealth({ plane, bucket, snapshot,
          cycle: env.HEALTH_PUBLICATION_CYCLE || null, ...binding })));
        return;
      } catch (error) {
        if (attempt === 3 || !["HEALTH_POINTER_CHANGED_REPREPARE", "HEALTH_NEWER_OBSERVATION_PRESENT"].includes(error.message)) throw error;
        console.log(JSON.stringify({ result: "repreparing", reason: error.message, attempt }));
        // This job holds the same family concurrency lock as its publisher.
        // Keep the fence: rebuild from the new snapshot instead of publishing
        // stale observations or waiting for tomorrow's daily admission.
        snapshot = await prepare();
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
