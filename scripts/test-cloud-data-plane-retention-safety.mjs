#!/usr/bin/env node
/**
 * test-cloud-data-plane-retention-safety.mjs — fh-465 focused offline cases.
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
 * No Cloudflare network anywhere; fetches and sleeps are injected.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  RETENTION_DELETE_THROTTLE_MS,
  RETENTION_RATE_LIMIT_DEFAULT_MS,
  RETENTION_UPLOAD_GRACE_SECONDS,
  assertSameRetentionInputs,
  buildFamilyManifest,
  computeRetentionPlan,
  deleteR2Object,
  executeRetentionPlan,
  listR2ObjectsDetailed,
  retentionInputFingerprint,
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

  console.log("test-cloud-data-plane-retention-safety: ok");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
