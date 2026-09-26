#!/usr/bin/env node
/**
 * test-cloud-data-plane-retention-safety.mjs — fh-465/fh-479 focused offline cases.
 *
 * Covers the retention hardening added 2026-09-26:
 *  1. 48h upload-age grace: young unreferenced payloads/manifests are skipped
 *     and reported; old ones stay candidates.
 *  2. Unknown upload timestamps fail the plan closed (RETENTION_TIMESTAMP_UNKNOWN).
 *  3. In-flight publisher safety: a prepared (in-flight) generation that REUSES
 *     an old object keeps it out of the candidate set, and a pointer change
 *     (rollback target) never releases an object another retained generation
 *     still holds.
 *  4. Deletion throttle: executeRetentionPlan spaces destructive calls and still
 *     reports per-key failures.
 *  5. HTTP 429: the retention REST helpers honour Retry-After, fall back to the
 *     five-minute block when it is absent, and surface an exhausted budget.
 *  6. Delete-time revalidation: any manifest-set or family-state change between
 *     the plan and the delete phase aborts with zero deletions.
 *  7. Grace-manifest roots (fh-479): an OLD payload referenced only by a young
 *     grace-protected manifest survives outside newest3/prepared.
 *  8. Exhausted 429 (fh-479): the whole delete batch ends at the exhausted key —
 *     no next candidate call, manifests untouched, structured `aborted` row.
 *  9. Manifest reads (fh-479): paced through the shared bounded-429 helper, and
 *     Retry-After above 300s is honoured uncapped.
 * 10. Reference evidence (fh-479): per-family counts/IDs, shared-blob accounting
 *     without double counting, and presence failures for missing live/rollback
 *     payloads reported as failure rather than as survival.
 * No Cloudflare network anywhere; fetches and sleeps are injected.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  RETENTION_DELETE_THROTTLE_MS,
  RETENTION_MANIFEST_READ_THROTTLE_MS,
  RETENTION_RATE_LIMIT_DEFAULT_MS,
  RETENTION_UPLOAD_GRACE_SECONDS,
  assertSameRetentionInputs,
  buildFamilyManifest,
  computeRetentionPlan,
  deleteR2Object,
  executeRetentionPlan,
  getR2ObjectBytes,
  listR2ObjectsDetailed,
  readRetentionManifests,
  retentionInputFingerprint,
  retentionReferenceEvidence,
} from "./publish-cloud-data-generation.mjs";

const REL_ROOT = "data/test-fixtures/cloud-data-plane-retention-safety";
const NOW = "2026-09-26T12:00:00.000Z";
const OLD = "2026-08-01T00:00:00.000Z";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-retention-safety-"));

async function buildGeneration({ files, now }) {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  for (const [relative, text] of Object.entries(files)) {
    fs.mkdirSync(path.join(root, path.dirname(relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), text);
  }
  const { manifest } = await buildFamilyManifest({
    familyName: "oecd-cli",
    absRoot: root,
    relRoot: REL_ROOT,
    now: () => now,
  });
  return manifest;
}

const manifestEntry = (manifest) => ({
  key: `manifests/${manifest.generation_id}.json`,
  text: JSON.stringify(manifest),
});
const assetKey = (manifest, suffix) =>
  manifest.assets.find((asset) => asset.path.endsWith(suffix))?.object_key;
const pointerOf = (active, previous) => ({
  sequence: 9,
  active: { generation_id: active },
  previous: previous ? { generation_id: previous } : null,
});

// Every listed key carries an upload time; overrides replace single entries.
function entriesWithAges(manifests, overrides = {}) {
  const byKey = new Map();
  for (const manifest of manifests) {
    const manifestKey = `manifests/${manifest.generation_id}.json`;
    byKey.set(manifestKey, { key: manifestKey, size: 120, uploaded: overrides[manifestKey] ?? OLD });
    for (const asset of manifest.assets) {
      byKey.set(asset.object_key, {
        key: asset.object_key,
        size: asset.bytes,
        uploaded: overrides[asset.object_key] ?? OLD,
      });
    }
  }
  return [...byKey.values()];
}

try {
  const generations = [];
  for (let index = 0; index < 5; index += 1) {
    generations.push(await buildGeneration({
      files: { "only.json": `{"c":1,"g":${index}}\n` },
      now: `2026-08-0${index + 1}T00:00:00.000Z`,
    }));
  }
  const [g1, g2, g3, g4, g5] = generations;
  const manifestEntries = generations.map(manifestEntry);
  const a1 = assetKey(g1, "only.json");
  const a2 = assetKey(g2, "only.json");
  const m1 = `manifests/${g1.generation_id}.json`;
  const familiesState = [{
    name: "oecd-cli",
    pointer: pointerOf(g5.generation_id, g4.generation_id),
    preparedGenerations: [],
  }];
  const planOf = (entries, families = familiesState, entriesManifests = manifestEntries) =>
    computeRetentionPlan({
      families,
      manifestEntries: entriesManifests,
      objectEntries: entries,
      now: NOW,
    });

  // --- 1. young / old grace handling ------------------------------------------
  {
    const youngPlan = planOf(entriesWithAges(generations, { [a1]: "2026-09-26T11:00:00.000Z" }));
    assert.equal(youngPlan.graceSeconds, RETENTION_UPLOAD_GRACE_SECONDS);
    assert.deepEqual(youngPlan.skippedYoung, [a1]);
    assert.deepEqual(youngPlan.candidates.map((candidate) => candidate.key), [a2]);
    const youngManifestPlan = planOf(entriesWithAges(generations, { [m1]: "2026-09-26T11:00:00.000Z" }));
    assert.deepEqual(youngManifestPlan.manifestGraceSkipped, [m1]);
    assert.ok(!youngManifestPlan.manifestCandidates.some((candidate) => candidate.key === m1));
    const oldPlan = planOf(entriesWithAges(generations));
    assert.deepEqual(oldPlan.skippedYoung, []);
    assert.deepEqual(oldPlan.candidates.map((candidate) => candidate.key), [a1, a2]);
    console.log("retention safety 1 ok (young skipped/reported, old candidates unchanged)");
  }

  // --- 2. unknown timestamps fail closed --------------------------------------
  {
    const missing = entriesWithAges(generations).map((entry) =>
      (entry.key === a1 ? { ...entry, uploaded: undefined } : entry));
    assert.throws(
      () => planOf(missing),
      /RETENTION_TIMESTAMP_UNKNOWN/,
      "a missing upload time must fail the plan closed",
    );
    const garbage = entriesWithAges(generations).map((entry) =>
      (entry.key === a2 ? { ...entry, uploaded: "not-a-date" } : entry));
    assert.throws(() => planOf(garbage), /RETENTION_TIMESTAMP_UNKNOWN/);
    console.log("retention safety 2 ok (unknown upload time fails closed)");
  }

  // --- 3. in-flight reused-object safety + pointer changes --------------------
  {
    // g6 is prepared but unpromoted and REUSES g1's old payload byte-identically.
    const g6 = await buildGeneration({
      files: { "only.json": "{\"c\":1,\"g\":0}\n" },
      now: "2026-08-06T00:00:00.000Z",
    });
    assert.equal(assetKey(g6, "only.json"), a1, "the in-flight generation must reuse the old object");
    const inFlightFamilies = [{
      name: "oecd-cli",
      pointer: pointerOf(g5.generation_id, g4.generation_id),
      preparedGenerations: [g6.generation_id],
    }];
    const allManifests = [...generations, g6].map(manifestEntry);
    const inFlightPlan = planOf(entriesWithAges([...generations, g6]), inFlightFamilies, allManifests);
    assert.ok(inFlightPlan.retainedGenerations.includes(g6.generation_id));
    assert.ok(!inFlightPlan.candidates.some((candidate) => candidate.key === a1),
      "an old object reused by an in-flight publisher must never be a candidate");

    const rolledFamilies = [{
      name: "oecd-cli",
      pointer: pointerOf(g5.generation_id, g1.generation_id),
      preparedGenerations: [],
    }];
    const rolledPlan = planOf(entriesWithAges(generations), rolledFamilies);
    assert.ok(rolledPlan.retainedGenerations.includes(g1.generation_id),
      "the rollback target survives the pointer move outside the newest-3 window");
    assert.ok(!rolledPlan.candidates.some((candidate) => candidate.key === a1));
    assert.deepEqual(rolledPlan.candidates.map((candidate) => candidate.key), [a2]);
    console.log("retention safety 3 ok (in-flight reuse survives; pointer move keeps its target)");
  }

  // --- 4. deletion throttle ----------------------------------------------------
  {
    const planned = {
      candidates: [
        { key: "objects/sha256/aa", size: 1 },
        { key: "objects/sha256/bb", size: 2 },
      ],
      manifestCandidates: [{ key: "manifests/oecd-cli-0000000000000000.json", size: 3, generation_id: "oecd-cli-0000000000000000" }],
    };
    const sleeps = [];
    const deleted = [];
    const outcome = await executeRetentionPlan({
      plan: planned,
      deleteObject: async (key) => { deleted.push(key); return { ok: true }; },
      sleepImpl: async (ms) => { sleeps.push(ms); },
    });
    assert.deepEqual(deleted, ["objects/sha256/aa", "objects/sha256/bb", "manifests/oecd-cli-0000000000000000.json"]);
    assert.deepEqual(sleeps, [RETENTION_DELETE_THROTTLE_MS, RETENTION_DELETE_THROTTLE_MS],
      "each delete after the first is paced by the throttle, across both phases");
    assert.equal(outcome.deleted.length, 2);
    assert.equal(outcome.deletedManifests.length, 1);
    const failed = await executeRetentionPlan({
      plan: planned,
      deleteObject: async (key) => ({ ok: false, error: `no ${key}` }),
      sleepImpl: async () => {},
    });
    assert.equal(failed.failures.length, 2);
    assert.equal(failed.manifestFailures.length, 1);
    console.log("retention safety 4 ok (delete pacing + per-key failure collection)");
  }

  // --- 5. HTTP 429 handling ----------------------------------------------------
  {
    const base = { accountId: "acct", bucket: "bucket", token: "token", key: "objects/sha256/aa" };
    const sleeps = [];
    let attempts = 0;
    const honoured = await deleteR2Object({
      ...base,
      sleepImpl: async (ms) => { sleeps.push(ms); },
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) return new Response("", { status: 429, headers: { "retry-after": "7" } });
        return new Response("{}", { status: 200 });
      },
    });
    assert.equal(honoured.ok, true);
    assert.equal(attempts, 2);
    assert.equal(sleeps.length, 1);
    assert.ok(sleeps[0] >= 7_000 && sleeps[0] <= 7_250, `honors Retry-After (got ${sleeps[0]}ms)`);

    const sleeps2 = [];
    let attempts2 = 0;
    const blocked = await deleteR2Object({
      ...base,
      sleepImpl: async (ms) => { sleeps2.push(ms); },
      fetchImpl: async () => {
        attempts2 += 1;
        if (attempts2 === 1) return new Response("", { status: 429 });
        return new Response("{}", { status: 200 });
      },
    });
    assert.equal(blocked.ok, true);
    assert.ok(sleeps2[0] >= RETENTION_RATE_LIMIT_DEFAULT_MS
      && sleeps2[0] <= RETENTION_RATE_LIMIT_DEFAULT_MS + 250,
    `absent Retry-After falls back to the five-minute block (got ${sleeps2[0]}ms)`);

    const sleeps3 = [];
    let attempts3 = 0;
    const stuck = await deleteR2Object({
      ...base,
      sleepImpl: async (ms) => { sleeps3.push(ms); },
      fetchImpl: async () => {
        attempts3 += 1;
        return new Response("rate limited", { status: 429, headers: { "retry-after": "0" } });
      },
    });
    assert.equal(stuck.ok, false);
    assert.match(stuck.error, /429/);
    assert.equal(stuck.rate_limit_exhausted, true); // structured stop signal for the delete executor
    assert.equal(attempts3, 8); // MAX_RATE_LIMIT_ATTEMPTS, then the 429 is surfaced
    assert.equal(sleeps3.length, 7); // a pause before every retry, none after the last

    const listSleeps = [];
    let listAttempts = 0;
    const listed = await listR2ObjectsDetailed({
      accountId: "acct",
      bucket: "bucket",
      token: "token",
      sleepImpl: async (ms) => { listSleeps.push(ms); },
      fetchImpl: async () => {
        listAttempts += 1;
        if (listAttempts === 1) return new Response("", { status: 429, headers: { "retry-after": "2" } });
        return new Response(JSON.stringify({ success: true, result: [], result_info: {} }), { status: 200 });
      },
    });
    assert.deepEqual(listed, []);
    assert.equal(listAttempts, 2);
    assert.equal(listSleeps.length, 1);
    console.log("retention safety 5 ok (429 honors Retry-After, five-minute fallback, exhausted budget surfaced)");
  }

  // --- 6. delete-time revalidation ---------------------------------------------
  {
    const before = retentionInputFingerprint({ familiesState, manifestEntries });
    assert.equal(retentionInputFingerprint({ familiesState, manifestEntries }), before);
    assert.equal(
      retentionInputFingerprint({ familiesState, manifestEntries: [manifestEntries[1], manifestEntries[0], ...manifestEntries.slice(2)] }),
      before,
      "manifest ordering must not change the fingerprint",
    );
    assertSameRetentionInputs({ before, after: before });

    const changedFamilies = [{
      ...familiesState[0],
      preparedGenerations: ["oecd-cli-ffffffffffffffff"],
    }];
    assert.throws(
      () => assertSameRetentionInputs({
        before,
        after: retentionInputFingerprint({ familiesState: changedFamilies, manifestEntries }),
      }),
      /RETENTION_STATE_CHANGED/,
      "a new prepared receipt between plan and delete must abort",
    );

    const grownManifests = [...manifestEntries, { key: "manifests/oecd-cli-eeeeeeeeeeeeeeee.json", text: "{}" }];
    assert.throws(
      () => assertSameRetentionInputs({
        before,
        after: retentionInputFingerprint({ familiesState, manifestEntries: grownManifests }),
      }),
      /RETENTION_STATE_CHANGED/,
      "a new manifest between plan and delete must abort",
    );
    console.log("retention safety 6 ok (state revalidation aborts on any manifest/family change)");
  }

  // --- 7. grace-manifest reference roots (fh-479) ------------------------------
  {
    const graceRootPlan = planOf(entriesWithAges(generations, { [m1]: "2026-09-26T11:00:00.000Z" }));
    assert.deepEqual(graceRootPlan.graceRoots, [m1]);
    assert.deepEqual(graceRootPlan.manifestGraceSkipped, [m1]);
    assert.ok(graceRootPlan.referencedKeys.includes(a1),
      "the young manifest must be a reference root before the union is computed");
    assert.ok(!graceRootPlan.candidates.some((candidate) => candidate.key === a1),
      "an OLD payload referenced only by a young grace manifest survives outside newest3/prepared");
    assert.deepEqual(graceRootPlan.candidates.map((candidate) => candidate.key), [a2]);
    assert.ok(graceRootPlan.familyReferences["oecd-cli"].referenced_keys.includes(a1));
    console.log("retention safety 7 ok (young manifest is a reference root; its old payload survives)");
  }

  // --- 8. exhausted 429 ends the whole delete batch (fh-479) -------------------
  {
    const twoPhasePlan = {
      candidates: [
        { key: "objects/sha256/aa", size: 1 },
        { key: "objects/sha256/bb", size: 2 },
      ],
      manifestCandidates: [
        { key: "manifests/oecd-cli-0000000000000000.json", size: 3, generation_id: "oecd-cli-0000000000000000" },
        { key: "manifests/oecd-cli-1111111111111111.json", size: 4, generation_id: "oecd-cli-1111111111111111" },
      ],
    };
    const payloadPhaseCalls = [];
    const payloadAbort = await executeRetentionPlan({
      plan: twoPhasePlan,
      deleteObject: async (key) => {
        payloadPhaseCalls.push(key);
        return { ok: false, error: "http 429: rate limited", rate_limit_exhausted: true };
      },
      sleepImpl: async () => {},
    });
    assert.deepEqual(payloadPhaseCalls, ["objects/sha256/aa"],
      "no next candidate call after exhausted429");
    assert.equal(payloadAbort.failures.length, 1);
    assert.deepEqual(payloadAbort.aborted, { reason: "rate_limit_exhausted", phase: "payloads", key: "objects/sha256/aa" });
    assert.deepEqual(payloadAbort.deletedManifests, [], "manifests are untouched after a payload-phase abort");
    assert.deepEqual(payloadAbort.manifestFailures, []);

    const manifestPhaseCalls = [];
    const manifestAbort = await executeRetentionPlan({
      plan: twoPhasePlan,
      deleteObject: async (key) => {
        manifestPhaseCalls.push(key);
        if (key.startsWith("manifests/")) {
          return { ok: false, error: "http 429: rate limited", rate_limit_exhausted: true };
        }
        return { ok: true };
      },
      sleepImpl: async () => {},
    });
    assert.deepEqual(manifestPhaseCalls, [
      "objects/sha256/aa",
      "objects/sha256/bb",
      "manifests/oecd-cli-0000000000000000.json",
    ], "the manifest phase also stops at the exhausted key");
    assert.equal(manifestAbort.manifestFailures.length, 1);
    assert.equal(manifestAbort.aborted.phase, "manifests");
    assert.equal(manifestAbort.deletedManifests.length, 0);
    console.log("retention safety 8 ok (exhausted429 aborts the entire batch, manifests included)");
  }

  // --- 9. manifest reads: pacing + uncapped Retry-After (fh-479) ---------------
  {
    const readKeys = [];
    const readSleeps = [];
    const manifestRows = await readRetentionManifests({
      objectEntries: [
        { key: "objects/sha256/aa", size: 1 },
        { key: "manifests/oecd-cli-0000000000000000.json", size: 2 },
        { key: "pointers/oecd-cli.json", size: 3 },
        { key: "manifests/oecd-cli-1111111111111111.json", size: 4 },
      ],
      readObject: async (key) => {
        readKeys.push(key);
        return new TextEncoder().encode(`{"k":"${key}"}`);
      },
      sleepImpl: async (ms) => { readSleeps.push(ms); },
    });
    assert.deepEqual(readKeys, ["manifests/oecd-cli-0000000000000000.json", "manifests/oecd-cli-1111111111111111.json"]);
    assert.deepEqual(readSleeps, [RETENTION_MANIFEST_READ_THROTTLE_MS],
      "each manifest read after the first is paced");
    assert.equal(manifestRows.length, 2);
    assert.equal(manifestRows[0].text, "{\"k\":\"manifests/oecd-cli-0000000000000000.json\"}");

    let getAttempts = 0;
    const getSleeps = [];
    const fetched = await getR2ObjectBytes({
      accountId: "acct",
      bucket: "bucket",
      token: "token",
      key: "manifests/oecd-cli-0000000000000000.json",
      sleepImpl: async (ms) => { getSleeps.push(ms); },
      fetchImpl: async () => {
        getAttempts += 1;
        if (getAttempts === 1) return new Response("", { status: 429, headers: { "retry-after": "600" } });
        return new Response("{\"ok\":1}", { status: 200 });
      },
    });
    assert.equal(getAttempts, 2);
    assert.ok(fetched instanceof Uint8Array);
    assert.ok(getSleeps[0] >= 600_000 && getSleeps[0] <= 600_000 + 250,
      `Retry-After above 300s is honoured uncapped (got ${getSleeps[0]}ms)`);

    const gone = await getR2ObjectBytes({
      accountId: "acct",
      bucket: "bucket",
      token: "token",
      key: "manifests/missing.json",
      fetchImpl: async () => new Response("", { status: 404 }),
    });
    assert.equal(gone, null);
    console.log("retention safety 9 ok (manifest reads paced; Retry-After >300s uncapped; 404 -> null)");
  }

  // --- 10. reference evidence (fh-479) -----------------------------------------
  {
    const fabricated = {
      referencedKeys: ["objects/sha256/aa", "objects/sha256/bb", "objects/sha256/cc"],
      familyReferences: {
        "fam-a": {
          active_generation_id: "fam-a-1",
          previous_generation_id: "fam-a-0",
          retained_generations: ["fam-a-0", "fam-a-1"],
          referenced_keys: ["objects/sha256/aa", "objects/sha256/bb"],
          active_keys: ["objects/sha256/aa"],
          previous_keys: ["objects/sha256/bb"],
        },
        "fam-b": {
          active_generation_id: "fam-b-1",
          previous_generation_id: null,
          retained_generations: ["fam-b-1"],
          referenced_keys: ["objects/sha256/aa"],
          active_keys: ["objects/sha256/aa"],
          previous_keys: [],
        },
      },
    };
    const listing = [
      { key: "objects/sha256/aa", size: 10, uploaded: OLD },
      { key: "objects/sha256/bb", size: 20, uploaded: OLD },
      { key: "objects/sha256/cc", size: 30, uploaded: OLD },
    ];
    const evidence = retentionReferenceEvidence({ plan: fabricated, objectEntries: listing });
    assert.equal(evidence.families["fam-a"].active_generation_id, "fam-a-1");
    assert.equal(evidence.families["fam-a"].previous_generation_id, "fam-a-0");
    assert.equal(evidence.families["fam-a"].referenced_payload_count, 2);
    assert.equal(evidence.families["fam-a"].referenced_payload_bytes, 30);
    assert.equal(evidence.families["fam-b"].referenced_payload_bytes, 10);
    assert.equal(evidence.unique.referenced_payload_count, 3);
    assert.equal(evidence.unique.referenced_payload_bytes, 60, "shared blobs are counted once in the unique total");
    assert.deepEqual(evidence.unique.shared_payloads, ["objects/sha256/aa"]);
    assert.equal(evidence.unique.presence_ok, true);

    const missingLive = retentionReferenceEvidence({
      plan: fabricated,
      objectEntries: listing.filter((entry) => entry.key !== "objects/sha256/aa"),
    });
    assert.equal(missingLive.unique.presence_ok, false, "a missing live payload reports failure");
    assert.deepEqual(missingLive.unique.live_missing_payloads, ["objects/sha256/aa"]);
    assert.ok(missingLive.families["fam-a"].missing_referenced_payloads.includes("objects/sha256/aa"));
    assert.ok(missingLive.families["fam-b"].missing_referenced_payloads.includes("objects/sha256/aa"));

    const missingRollback = retentionReferenceEvidence({
      plan: fabricated,
      objectEntries: listing.filter((entry) => entry.key !== "objects/sha256/bb"),
    });
    assert.deepEqual(missingRollback.unique.rollback_missing_payloads, ["objects/sha256/bb"]);

    const realPlan = planOf(entriesWithAges(generations));
    const realEvidence = retentionReferenceEvidence({ plan: realPlan, objectEntries: entriesWithAges(generations) });
    assert.equal(realEvidence.unique.presence_ok, true);
    assert.deepEqual(realEvidence.families["oecd-cli"].active_payload_keys, [assetKey(g5, "only.json")]);
    console.log("retention safety 10 ok (per-family evidence, shared accounting, missing live/rollback fails)");
  }

  console.log("test-cloud-data-plane-retention-safety: ok");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
