import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createMemoryCloudDataPlane, publishGeneration, sha256Canonical } from "./lib/cloud-data-plane-generation.mjs";
import { buildFamilyManifest, computeRetentionPlan, runPublisherCli } from "./publish-cloud-data-generation.mjs";
import { ETF_FAMILY, healthKey, buildFamilyHealth, classifyFamilyHealth, compareFamilyMembers } from "./lib/family-health.mjs";
import { prepareHealth, commitHealth, readCanonicalReference, readHealthRecord } from "./refresh-family-health.mjs";
import { fetchEtfFamilyHealth, buildIssueBody } from "./ops/check-pipeline-job-health.mjs";
import { buildAlarmState } from "./ops/emit-alarm-state.mjs";

const now = "2026-10-11T10:00:00.000Z";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "family-health-"));
const prefix = "data/stockanalysis/etfs";
const binding = { runId: "100", runAttempt: "1", now };
try {
  await fs.mkdir(path.join(root, prefix), { recursive: true });
  const data = { fetched_at: "2026-10-10T00:00:00Z", raw: { quote: { td: "2026-10-10" } } };
  await fs.writeFile(path.join(root, prefix, "ONE.json"), JSON.stringify(data));
  await fs.writeFile(path.join(root, prefix, "TWO.json"), JSON.stringify(data));
  await fs.mkdir(path.join(root, "data/stockanalysis/surfaces"), { recursive: true });
  for (const filename of ["etf_universe.json", "surfaces/etf_screener.json"]) {
    await fs.writeFile(path.join(root, "data/stockanalysis", filename), JSON.stringify({ records: [{ ticker: "ONE" }] }));
  }
  const git = args => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  git(["init", "-b", "main"]); git(["config", "user.name", "Health fixture"]); git(["config", "user.email", "fixture@example.invalid"]);
  git(["add", "."]); git(["commit", "-m", "canonical reference"]);
  const original = await readCanonicalReference({ root, ref: "HEAD" });
  // A dirty/unstaged worktree must not contaminate the frozen Git reference.
  await fs.writeFile(path.join(root, prefix, "ONE.json"), "malformed dirty bytes");
  assert.deepEqual(await readCanonicalReference({ root, ref: "HEAD" }), original);
  await fs.writeFile(path.join(root, prefix, "ONE.json"), JSON.stringify(data));

  const built = await buildFamilyManifest({ familyName: ETF_FAMILY, absRoot: path.join(root, prefix), relRoot: prefix, now: () => now });
  const plane = createMemoryCloudDataPlane();
  await publishGeneration({ ...plane, manifest: built.manifest, payloads: built.payloads,
    policy: { max_assets: 10, max_total_bytes: 1_000_000, validate_freshness: () => true, validate_public_payload: () => true },
    expectedPointerSequence: 0, now: () => now });
  const snapshot = await prepareHealth({ plane, reference: original, ...binding });
  let stored = null, puts = 0;
  const bucket = { get: async () => stored ? { arrayBuffer: async () => stored } : null,
    put: async (key, body) => { assert.equal(key, healthKey()); puts += 1; stored = body.slice(); } };
  let record = buildFamilyHealth({ snapshot, now });
  assert.equal(record.source_health.status, "not_evaluated");
  assert.equal(record.parity.matched, 2);
  assert.equal(record.lifecycle.orphan_count, 1);
  const oldOrphan = structuredClone(snapshot);
  oldOrphan.reference.lifecycle.orphans[0].first_seen_at = "2026-09-26T09:00:00Z";
  const orphanHealth = buildFamilyHealth({ snapshot: oldOrphan, now });
  const orphanAlarm = classifyFamilyHealth(orphanHealth, { now: Date.parse(now) });
  assert.deepEqual(orphanAlarm.alarm_reasons, ["orphan_unclassified_over_14_days"]);
  assert.equal(buildAlarmState({ health: { status: "alarm", workflows: [orphanAlarm] } }).status, "open");
  const followupOrphan = buildFamilyHealth({ snapshot, previous: orphanHealth, now });
  assert.equal(followupOrphan.lifecycle.orphans[0].first_seen_at, "2026-09-26T09:00:00Z");
  assert.equal(classifyFamilyHealth(record, { now: Date.parse(now) }).status, "ok");

  const older = structuredClone(snapshot);
  older.reference.assets[0].source_as_of = "2026-10-11";
  older.reference.assets[0].sha256 = "a".repeat(64);
  let first = buildFamilyHealth({ snapshot: older, cycle: "101", now });
  assert.equal(first.parity.plane_older, 1);
  assert.equal(first.parity.mismatched, 1);
  assert.equal(first.parity.behind_publication_cycles, 1);
  assert.deepEqual(first.parity.alarm_reasons, []);
  const retry = buildFamilyHealth({ snapshot: older, previous: first, cycle: "101", now });
  assert.equal(retry.parity.behind_publication_cycles, 1);
  const poll = buildFamilyHealth({ snapshot: older, previous: retry, now });
  assert.equal(poll.parity.behind_publication_cycles, 1);
  const second = buildFamilyHealth({ snapshot: older, previous: poll, cycle: "102", now });
  const alarm = classifyFamilyHealth(second, { now: Date.parse(now) });
  assert.equal(alarm.status, "alarm");
  assert.deepEqual(alarm.alarm_reasons, ["plane_behind_canonical"]);
  assert.match(buildIssueBody([alarm]), /plane_behind_canonical/);
  assert.match(buildIssueBody([alarm]), /plane older: 1/);
  assert.equal(buildAlarmState({ health: { status: "alarm", workflows: [alarm] } }).status, "open");
  assert.equal(buildFamilyHealth({ snapshot, previous: second, now }).parity.behind_publication_cycles, 2,
    "a daily poll alone does not clear a natural-cycle incident");
  const recovered = buildFamilyHealth({ snapshot, previous: second, cycle: "103", now });
  assert.equal(recovered.parity.behind_publication_cycles, 0);
  assert.deepEqual(recovered.parity.alarm_reasons, []);
  assert.equal(buildFamilyHealth({ snapshot: older, previous: recovered, cycle: "102", now }).parity.behind_publication_cycles, 0,
    "an out-of-order run cannot inflate the cycle count");

  const missing = compareFamilyMembers(original.assets.slice(0, 1), built.manifest.assets);
  assert.equal(missing.counts.plane_only, 1);
  assert.equal(compareFamilyMembers(original.assets, built.manifest.assets.slice(0, 1)).counts.missing_plane, 1);
  assert.throws(() => compareFamilyMembers([...original.assets, original.assets[0]], built.manifest.assets), /MEMBER_INVALID/);
  for (const bad of [null, {}, { ...record, observed_at: "not a date" }]) {
    assert.deepEqual(classifyFamilyHealth(bad, { now: Date.parse(now) }).alarm_reasons, ["health_record_stale"]);
  }
  const corruptCounts = structuredClone(record);
  corruptCounts.parity.matched += 1;
  assert.deepEqual(classifyFamilyHealth(corruptCounts, { now: Date.parse(now) }).alarm_reasons, ["health_record_stale"]);
  assert.equal(classifyFamilyHealth(record, { now: Date.parse(now) + 48 * 3600_000 }).status, "ok");
  const stale = classifyFamilyHealth(record, { now: Date.parse(now) + 48 * 3600_000 + 1 });
  assert.deepEqual(stale.alarm_reasons, ["health_record_stale"]);
  assert.match(buildIssueBody([stale]), /2026-10-11T10:00:00.000Z/);
  const staleState = buildAlarmState({ health: { status: "alarm", workflows: [stale] } });
  assert.equal(staleState.status, "open");
  assert.ok(JSON.stringify(staleState).includes("health_record_stale"));
  for (const failingBucket of [{ get: async () => null }, { get: async () => { throw new Error("offline"); } },
    { get: async () => ({ arrayBuffer: async () => Buffer.from("invalid json") }) }]) {
    assert.deepEqual((await fetchEtfFamilyHealth({ bucket: failingBucket, now: Date.parse(now) })).alarm_reasons, ["health_record_stale"]);
  }

  const result = await commitHealth({ plane, bucket, snapshot, cycle: "100", ...binding });
  assert.equal(result.result, "health_record_updated");
  assert.equal(puts, 1);
  assert.equal((await readHealthRecord(bucket)).parity.matched, 2);
  for (const mutation of [s => { s.run_attempt = "2"; }, s => { s.reference.assets[0].bytes += 1; }]) {
    const changed = structuredClone(snapshot); mutation(changed);
    await assert.rejects(commitHealth({ plane, bucket, snapshot: changed, ...binding }), /BINDING_INVALID|INTEGRITY_INVALID/);
  }
  const changedPointerPlane = { ...plane, pointerStore: { get: async () => ({ ...snapshot.pointer, sequence: snapshot.pointer.sequence + 1 }) } };
  await assert.rejects(commitHealth({ plane: changedPointerPlane, bucket, snapshot, ...binding }), /POINTER_CHANGED_REPREPARE/);
  await assert.rejects(commitHealth({ plane, bucket, snapshot, ...binding, now: "2026-10-12T10:00:00Z" }), /BINDING_INVALID/);
  const newer = { ...record, observed_at: "2026-10-11T11:00:00Z" };
  stored = new TextEncoder().encode(JSON.stringify(newer));
  await assert.rejects(commitHealth({ plane, bucket, snapshot, ...binding }), /NEWER_OBSERVATION_PRESENT/);
  assert.equal(puts, 1, "every rejected preparation must perform zero R2 writes");
  const corruptPlane = { ...plane, objectStore: { get: async () => new TextEncoder().encode("corrupt manifest") } };
  await assert.rejects(prepareHealth({ plane: corruptPlane, reference: original, ...binding }), /MANIFEST_INTEGRITY_INVALID/);
  // Only the manifest is read from the plane. No payload object may be read.
  let objectReads = 0;
  await prepareHealth({ plane: { ...plane, objectStore: { get: async key => {
    assert.ok(key.startsWith("manifests/")); objectReads += 1; return plane.objectStore.get(key);
  } } }, reference: original, ...binding });
  assert.equal(objectReads, 1);
  const retention = computeRetentionPlan({ families: [], manifestEntries: [],
    objectEntries: [{ key: healthKey(), size: 500, uploaded: "2020-01-01T00:00:00Z" }], now });
  assert.equal(retention.candidates.length, 0, "health metadata is not a retention candidate");
  const errors = [];
  const code = await runPublisherCli({ argv: [`--family=${ETF_FAMILY}`, "--json"], env: {},
    buildFamilyManifestImpl: async () => built,
    runCostGateImpl: async () => ({ code: 1, stdout: "storage_gb=40.1 verdict=WARN", stderr: "" }),
    stdout: () => {}, stderr: line => errors.push(line) });
  assert.equal(code, 3);
  assert.ok(errors.some(line => line.includes("storage_gb=40.1")), "JSON-mode block retains its exact cost axis");
  console.log("PASS family health: real Git blobs, manifest-only proof, two-cycle fire, stale/missing/unreadable fire, retry/poll/recovery, zero-write fences, retention exclusion and cost-axis evidence");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
