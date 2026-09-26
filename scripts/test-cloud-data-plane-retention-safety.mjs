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
import {
  createR2S3Client,
  deriveS3CredentialsFromToken,
  parseDeleteObjectsXml,
  parseListObjectsV2Xml,
} from "./lib/cloud-data-plane-s3.mjs";
import { BACKOFF_BASE_MS } from "./lib/cloudflare-rate-limit.mjs";
import { sha256Canonical } from "./lib/cloud-data-plane-generation.mjs";
import {
  applyBatch,
  computeSweepIntersection,
  indexManifestEntries,
  loadPlanArtifact,
  loadFamiliesState,
  parseManifestEntry,
} from "./ops/retention-sweep.mjs";
import {
  derivePublisherWorkflows,
  parseJournalComment,
  planRestoreFromStates,
  restoreStates,
  runWindow,
  serializeJournal,
} from "./ops/retention-window.mjs";

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

  // ---------------------------------------------------------------------------
  // fh-590 rev2 sweep cases (11-16): S3 parsing/derivation/deadline clamps,
  // manifest index identity, plan intersection, apply integration (canonical
  // recompute, presence preflight, per-key errors, verification), window
  // orchestration (failed run-list, foreign lease, partial-disable restore,
  // journal survival, originally-disabled stays disabled). Offline only.
  // ---------------------------------------------------------------------------
  {
    // 11. S3: parsers (truncation, per-key errors, UNKNOWN never success), in-memory
    // token derivation, and retry sleeps that cannot consume the deadline.
    const listXml = '<ListBucketResult><KeyCount>1</KeyCount><IsTruncated>true</IsTruncated>'
      + '<NextContinuationToken>T1</NextContinuationToken>'
      + '<Contents><Key>objects/sha256/aa</Key><ETag>&quot;abc&quot;</ETag>'
      + '<LastModified>2026-08-01T00:00:00.000Z</LastModified><Size>10</Size></Contents>'
      + '</ListBucketResult>';
    const page = parseListObjectsV2Xml(listXml);
    assert.deepEqual(page.entries, [{
      key: "objects/sha256/aa", size: 10, etag: "abc", last_modified: "2026-08-01T00:00:00.000Z",
    }]);
    assert.equal(page.isTruncated, true);
    assert.equal(page.nextContinuationToken, "T1");
    assert.throws(() => parseListObjectsV2Xml(listXml.replace("</ListBucketResult>", "")), /S3_XML_INVALID/);
    assert.throws(() => parseListObjectsV2Xml(listXml.replace("<KeyCount>1", "<KeyCount>2")), /S3_XML_INVALID/);

    const ok = parseDeleteObjectsXml(
      '<DeleteResult><Deleted><Key>a&amp;b</Key></Deleted></DeleteResult>',
      ["a&b"],
    );
    assert.deepEqual(ok.deleted, ["a&b"]);
    assert.deepEqual(ok.unknown, []);

    const partial = parseDeleteObjectsXml(
      '<DeleteResult><Deleted><Key>k1</Key></Deleted>'
      + '<Error><Key>k2</Key><Code>AccessDenied</Code><Message>nope</Message></Error></DeleteResult>',
      ["k1", "k2", "k3"],
    );
    assert.deepEqual(partial.deleted, ["k1"]);
    assert.equal(partial.errors[0].key, "k2");
    assert.equal(partial.errors[0].code, "AccessDenied");
    assert.deepEqual(partial.unknown, ["k3"], "a key in neither Deleted nor Error must be UNKNOWN, never success");

    const creds = await deriveS3CredentialsFromToken({
      token: "test-token-abc",
      fetchImpl: async () => ({
        status: 200,
        text: async () => JSON.stringify({ success: true, result: { id: "tok-1", status: "active" } }),
      }),
    });
    assert.equal(creds.accessKeyId, "tok-1");
    assert.match(creds.secretAccessKey, /^[0-9a-f]{64}$/, "the S3 secret is the SHA-256 of the existing token");
    await assert.rejects(
      deriveS3CredentialsFromToken({ token: "x", fetchImpl: async () => ({ status: 403, text: async () => "" }) }),
      /S3_TOKEN_VERIFY_FAILED/,
    );

    let clock = 0;
    const slept = [];
    const client = createR2S3Client({
      endpoint: "https://acct.r2.cloudflarestorage.com",
      accessKeyId: "a",
      secretAccessKey: "s",
      bucket: "b",
      now: () => clock,
      sleepImpl: async (ms) => { slept.push(ms); clock += ms; },
      fetchImpl: async () => { throw new Error("network down"); },
    });
    const deadlineErr = await client.listAllObjects({ deadline: 1_000 }).then(() => null, (error) => error);
    assert.ok(deadlineErr && ["S3_DEADLINE", "S3_NETWORK"].includes(deadlineErr.code), `unexpected ${deadlineErr?.code}`);
    assert.ok(slept.reduce((a, b) => a + b, 0) <= 1_000 + BACKOFF_BASE_MS, "retry sleeps must stay inside the deadline");
    console.log("retention safety 11 ok (S3 parsing/derivation; retry sleeps bounded by the deadline)");
  }

  {
    // 12. manifest index: replaced entries are never double-counted; generation-shaped
    // keys must match their manifest identity (a spoofed key rejects, no alias demotion).
    const idx = indexManifestEntries([
      { key: "manifests/x-0123456789abcdef.json", marker: 1 },
      { key: "manifests/x-0123456789abcdef.json", marker: 2 },
      { key: "manifests/y-0123456789abcdef.json", marker: 3 },
    ]);
    assert.equal(idx.size, 2, "a replaced manifest replaces by key, it is not appended");
    assert.equal(idx.get("manifests/x-0123456789abcdef.json").marker, 2, "last read wins");

    const manifest = await buildGeneration({ files: { "only.json": "{\"v\":1}\n" }, now: OLD });
    const key = `manifests/${manifest.generation_id}.json`;
    const text = JSON.stringify(manifest);
    const listingRow = { key, etag: "e1", last_modified: OLD, size: Buffer.byteLength(text) };
    const parsed = parseManifestEntry({ entry: { key, text }, listingEntry: listingRow });
    assert.equal(parsed.generation_id, manifest.generation_id);
    assert.equal(parsed.family, manifest.generation_id.slice(0, -17));
    assert.ok(parsed.referenced_keys.length >= 1);
    const spoof = { key: "manifests/oecd-cli-ffffffffffffffff.json", text };
    assert.throws(
      () => parseManifestEntry({ entry: spoof, listingEntry: { ...listingRow, key: spoof.key } }),
      /SWEEP_MANIFEST_KEY_MISMATCH/,
    );
    console.log("retention safety 12 ok (replace-by-key index; spoofed generation key rejected)");
  }

  {
    // 13. intersection: plan ∩ fresh for BOTH payloads and manifests, exact identity.
    const ident = (etag, size) => ({ etag, size, last_modified: OLD });
    const plan = {
      candidates: [
        { key: "objects/sha256/keep", size: 100 },
        { key: "objects/sha256/changed", size: 100 },
        { key: "objects/sha256/gone", size: 100 },
      ],
      manifest_candidates: [{
        key: "manifests/old-0123456789abcdef.json", generation_id: "old-0123456789abcdef", family: "old", size: 5,
      }],
    };
    const freshPlan = {
      candidates: [
        { key: "objects/sha256/keep", size: 100 },
        { key: "objects/sha256/changed", size: 100 },
        { key: "objects/sha256/new-in-fresh", size: 100 },
      ],
      manifestCandidates: [
        { key: "manifests/old-0123456789abcdef.json", generation_id: "old-0123456789abcdef", family: "old", size: 5 },
        { key: "manifests/new-0123456789abcdef.json", generation_id: "new-0123456789abcdef", family: "new", size: 5 },
      ],
    };
    const planListingByKey = new Map([
      ["manifests/old-0123456789abcdef.json", ident("m1", 5)],
      ["objects/sha256/keep", ident("e1", 100)],
      ["objects/sha256/changed", ident("e1", 100)],
      ["objects/sha256/gone", ident("e1", 100)],
    ]);
    const freshByKey = new Map([
      ["manifests/old-0123456789abcdef.json", ident("m1", 5)],
      ["objects/sha256/keep", ident("e1", 100)],
      ["objects/sha256/changed", ident("e2", 100)],
      ["objects/sha256/new-in-fresh", ident("e1", 100)],
    ]);
    const result = computeSweepIntersection({ plan, freshPlan, planListingByKey, freshByKey });
    assert.deepEqual(result.payloads.map((row) => row.key), ["objects/sha256/keep"]);
    assert.deepEqual(result.manifests.map((row) => row.key), ["manifests/old-0123456789abcdef.json"]);
    assert.deepEqual(result.skipped, { not_in_plan: 1, missing: 0, identity_changed: 1 });
    freshByKey.set("manifests/old-0123456789abcdef.json", ident("m2", 5));
    assert.equal(computeSweepIntersection({plan, freshPlan, planListingByKey, freshByKey}).manifests.length, 0, "changed manifest identity cannot delete");
    const skippedManifests = computeSweepIntersection({ plan, freshPlan, planListingByKey, freshByKey, skipManifests: true });
    assert.equal(skippedManifests.manifests.length, 0);
    console.log("retention safety 13 ok (plan∩fresh intersection for payloads and manifests)");
  }

  {
    // 14. applyBatch integration: canonical recompute + presence preflight + deadline +
    // per-key errors ≠ success + post-delete verification. Fixture: one family with four
    // generations (top3 + pointer retain three; g1 is doomed); candidate = g1's payload.
    const sweepRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-retention-apply-"));
    try {
      const gens = [];
      for (let i = 1; i <= 4; i += 1) {
        const manifest = await buildGeneration({
          files: { [`g${i}.json`]: `{"v":${i}}\n` },
          now: new Date(Date.parse(OLD) + i * 86_400_000).toISOString(),
        });
        gens.push(manifest);
      }
      const assetKeyOf = (manifest, filename) => manifest.assets.find((a) => a.path.endsWith(filename)).object_key;
      const g1File = assetKeyOf(gens[0], "g1.json");
      const liveKey = assetKeyOf(gens[3], "g4.json");
      const manifestText = (manifest) => JSON.stringify(manifest);
      const manifestListing = gens.map((manifest) => ({
        key: `manifests/${manifest.generation_id}.json`,
        size: Buffer.byteLength(manifestText(manifest)),
        etag: `em-${manifest.generation_id}`,
        last_modified: OLD,
      }));
      const objectListing = gens.map((manifest, index) => ({
        key: assetKeyOf(manifest, `g${index + 1}.json`),
        size: 20,
        etag: `eo-${index}`,
        last_modified: OLD,
      }));
      const fullListing = [...objectListing, ...manifestListing];
      const familiesState = [{
        name: "oecd-cli",
        pointer: { active: { generation_id: gens[3].generation_id }, previous: { generation_id: gens[2].generation_id } },
        preparedGenerations: [],
      }];
      const base = {
        schema: "r2-retention-plan/3",
        created_at: NOW,
        keep_newest: 3,
        grace_seconds: RETENTION_UPLOAD_GRACE_SECONDS,
        resume_window_seconds: 86400,
        families: [],
        manifests: [],
        manifest_entries: gens.map(manifest => ({key: `manifests/${manifest.generation_id}.json`, text: manifestText(manifest)})),
        listing: fullListing,
        candidates: [{ key: g1File, size: 20, reason: "test" }],
        manifest_candidates: [{
          key: manifestListing[0].key, generation_id: gens[0].generation_id, family: "oecd-cli", size: manifestListing[0].size,
        }],
        protected_keys: [],
        counts: {},
        reference_evidence: {},
      };
      const artifact = { ...base, plan_id: sha256Canonical(base) };
      const planPath = path.join(sweepRoot, "plan.json");
      fs.writeFileSync(planPath, JSON.stringify(artifact));
      const gateOk = async () => ({ code: 0 });
      const makeStub = (deleteImpl) => ({
        calls: [],
        gets: [],
        async listAllObjects() { return fullListing; },
        async getObject(k) {
          this.gets.push(k);
          const index = manifestListing.findIndex((row) => row.key === k);
          if (index < 0) return null;
          return {
            bytes: new TextEncoder().encode(manifestText(gens[index])),
            etag: manifestListing[index].etag,
            last_modified: manifestListing[index].last_modified,
          };
        },
        async deleteObjects(keys) {
          this.calls.push(keys);
          return deleteImpl(keys);
        },
      });
      const future = Math.floor(Date.now() / 1000) + 600;

      // (a) insufficient deadline → aborted, zero delete calls.
      let stub = makeStub(() => ({ deleted: [], errors: [], unknown: [] }));
      const abortedA = await applyBatch({
        planPath, deadlineEpochSeconds: Math.floor(Date.now() / 1000) - 10,
        deps: { s3: stub, familiesState, runCostGateImpl: gateOk }, io: { error: () => {} }, now: () => Date.now(),
      });
      assert.equal(abortedA.result, "retention_batch_aborted");
      assert.equal(abortedA.reason, "deadline_insufficient");
      assert.equal(stub.calls.length, 0);

      // (b) happy path: payload deleted, doomed manifest deleted, verification ok.
      stub = makeStub((keys) => ({
        deleted: keys.slice(),
        errors: [],
        unknown: [],
      }));
      const postListing = fullListing.filter((row) => row.key !== g1File && row.key !== manifestListing[0].key);
      const keysOut = path.join(sweepRoot, "keys.json");
      const applied = await applyBatch({
        planPath, deadlineEpochSeconds: future, keysOut,
        deps: { s3: stub, familiesState, postDeleteListing: postListing, runCostGateImpl: gateOk },
        io: { error: () => {} }, now: () => Date.now(),
      });
      assert.equal(applied.result, "retention_batch_applied");
      assert.equal(applied.payloads.deleted, 1);
      assert.equal(applied.manifests.deleted, 1);
      assert.ok(applied.payloads.bytes > 0);
      assert.equal(applied.verification, "ok");
      assert.equal(stub.gets.length, 0, "unchanged manifests use verified cache inside pause");
      const keysDoc = JSON.parse(fs.readFileSync(keysOut, "utf8"));
      assert.deepEqual(keysDoc.deleted, [g1File]);
      assert.deepEqual(keysDoc.deleted_manifests, [manifestListing[0].key]);

      // (c) per-key payload error → partial, and the manifest phase is blocked.
      stub = makeStub((keys) => (keys[0].startsWith("manifests/")
        ? { deleted: keys.slice(), errors: [], unknown: [] }
        : { deleted: [], errors: [{ key: keys[0], code: "AccessDenied", message: "no" }], unknown: [] }));
      const partialC = await applyBatch({
        planPath, deadlineEpochSeconds: future,
        deps: { s3: stub, familiesState, postDeleteListing: fullListing, runCostGateImpl: gateOk },
        io: { error: () => {} }, now: () => Date.now(),
      });
      assert.equal(partialC.result, "retention_batch_aborted", "zero successful deletes plus per-key errors aborts the batch");
      assert.equal(partialC.payloads.errors.length, 1);
      assert.equal(partialC.manifests.deleted, 0, "payload errors keep manifest evidence");

      // (d) presence preflight: a missing live payload aborts with zero deletes.
      stub = makeStub(() => ({ deleted: [], errors: [], unknown: [] }));
      const missingLive = fullListing.filter((row) => row.key !== liveKey);
      const abortedD = await applyBatch({
        planPath, deadlineEpochSeconds: future,
        deps: { s3: { ...stub, async listAllObjects() { return missingLive; } }, familiesState, runCostGateImpl: gateOk },
        io: { error: () => {} }, now: () => Date.now(),
      });
      assert.equal(abortedD.result, "retention_batch_aborted");
      assert.equal(abortedD.reason, "presence_preflight_failed");
      assert.equal(stub.calls.length, 0, "presence failure means zero deletes");

      // (e) a pointer to a generation with no manifest aborts with zero deletes.
      stub = makeStub(() => ({ deleted: [], errors: [], unknown: [] }));
      const abortedE = await applyBatch({
        planPath, deadlineEpochSeconds: future,
        deps: {
          s3: stub,
          familiesState: [{ name: "oecd-cli", pointer: { active: { generation_id: "oecd-cli-ffffffffffffffff" }, previous: null }, preparedGenerations: [] }],
          runCostGateImpl: gateOk,
        },
        io: { error: () => {} }, now: () => Date.now(),
      });
      assert.equal(abortedE.result, "retention_batch_aborted");
      assert.equal(abortedE.reason, "fresh_state_failed");
      assert.equal(abortedE.detail.code, "RETENTION_REFERENCE_SET_INCOMPLETE");
      assert.equal(stub.calls.length, 0);

      // (f) post-delete verification failure is never an applied success.
      stub = makeStub((keys) => ({ deleted: keys.slice(), errors: [], unknown: [] }));
      const failedVerify = await applyBatch({
        planPath, deadlineEpochSeconds: future,
        deps: {
          s3: stub, familiesState,
          postDeleteListing: fullListing.filter((row) => row.key !== liveKey),
          runCostGateImpl: gateOk,
        },
        io: { error: () => {} }, now: () => Date.now(),
      });
      assert.equal(failedVerify.result, "retention_batch_partial");
      assert.equal(failedVerify.verification, "failed");
      console.log("retention safety 14 ok (apply: preflight/deadline/errors/verification all fail closed)");
    } finally {
      fs.rmSync(sweepRoot, { recursive: true, force: true });
    }
  }

  {
    // 15. window helpers: derivation (publisher / reference-only / unclassified),
    // journal round-trip, restore planner (originally-disabled never enabled).
    const wfRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-retention-wf-"));
    try {
      fs.writeFileSync(
        path.join(wfRoot, "publisher-a.yml"),
        'name: Publisher A\non:\n  workflow_dispatch:\njobs:\n  x:\n    steps:\n      - run: node scripts/publish-cloud-data-generation.mjs --family=oecd-cli\n',
      );
      fs.writeFileSync(
        path.join(wfRoot, "mentions-only.yml"),
        "name: Mentions Only\non:\n  pull_request:\n    paths:\n      - 'scripts/publish-cloud-data-generation.mjs'\n",
      );
      fs.writeFileSync(
        path.join(wfRoot, "unclassified.yml"),
        "name: Unclassified\njobs:\n  x:\n    steps:\n      - run: cp scripts/publish-cloud-data-generation.mjs /tmp/\n",
      );
      fs.writeFileSync(path.join(wfRoot, "unrelated.yml"), "name: Unrelated\non: workflow_dispatch\n");
      const derived = derivePublisherWorkflows({ workflowsDir: wfRoot });
      assert.deepEqual(derived.publishers, [{ file: "publisher-a.yml", name: "Publisher A" }]);
      assert.deepEqual(derived.referenceOnly.map((row) => row.file), ["mentions-only.yml"]);
      assert.deepEqual(derived.unclassified.map((row) => row.file), ["unclassified.yml"], "an unclassified invocation must be detected");

      const journal = { schema: "retention-window-journal/2", lease: { run_id: "r1", expires_at: NOW }, vendored_states: [] };
      assert.deepEqual(parseJournalComment(serializeJournal(journal)), journal);
      assert.equal(parseJournalComment("not a journal"), null);

      const restorePlan = planRestoreFromStates({
        recorded: [
          { file: "a.yml", state: "active" },
          { file: "b.yml", state: "disabled_manually" },
          { file: "c.yml", state: "active" },
        ],
        current: [
          { file: "a.yml", state: "disabled_manually" },
          { file: "b.yml", state: "disabled_manually" },
          { file: "c.yml", state: "disabled_manually" },
          { file: "d.yml", state: "active" },
        ],
      });
      assert.deepEqual(restorePlan.enable, ["a.yml", "c.yml"]);
      assert.deepEqual(restorePlan.keepDisabled, ["b.yml"], "originally-disabled workflows are never enabled");
      console.log("retention safety 15 ok (derivation classes; journal round-trip; restore planner)");
    } finally {
      fs.rmSync(wfRoot, { recursive: true, force: true });
    }
  }

  {
    // 16. window orchestration with a scripted gh driver: failed run-list ⇒ aborted with
    // zero disable/enable; foreign live lease ⇒ no restore; partial-disable failure ⇒
    // restore of the disabled prefix; restore journal keeps unconfirmed entries.
    const mkWf = (files, state) => files.map((file) => ({ file, name: file, state }));
    const makeDriver = ({ workflows, journalBox, counts = {}, fail = {} }) => {
      const calls = [];
      const setState = (file, state) => { const row = workflows.find((w) => w.file === file); if (row) row.state = state; };
      const call = async (args) => {
        calls.push(args);
        const [a, b] = args;
        if (a === "issue" && b === "list" && args.includes("number,title")) return {ok: true, stdout: "[]"};
        if (a === "issue" && b === "create" && args.includes("100xFenok pipeline job failure alarm")) return {ok: true, stdout: "https://example.test/issues/8"};
        if (a === "issue" && b === "list") return { ok: true, stdout: JSON.stringify(journalBox.number && !fail.searchLag ? [{ number: journalBox.number }] : []) };
        if (a === "issue" && b === "view") return { ok: true, stdout: JSON.stringify({ comments: journalBox.journal ? [{ body: serializeJournal(journalBox.journal) }] : [] }) };
        if (a === "issue" && b === "comment") {
          const file = args[args.indexOf("--body-file") + 1];
          journalBox.journal = parseJournalComment(fs.readFileSync(file, "utf8"));
          return { ok: true, stdout: "" };
        }
        if (a === "issue" && b === "create") { journalBox.number = 7; return { ok: true, stdout: "https://example.test/issues/7" }; }
        if (a === "workflow" && b === "list") {
          return { ok: true, stdout: JSON.stringify(workflows.map((w) => ({ path: `.github/workflows/${w.file}`, state: w.state }))) };
        }
        if (a === "workflow" && b === "disable") {
          if (fail.disable === args[2]) return { ok: false };
          setState(args[2], "disabled_manually");
          return { ok: true };
        }
        if (a === "workflow" && b === "enable") {
          if (fail.enable === args[2]) return { ok: false };
          setState(args[2], "active");
          return { ok: true };
        }
        if (a === "api") {
          if (fail.runList) return { ok: false };
          const rest = b.split("/actions/workflows/")[1] ?? "";
          const file = rest.split("/")[0];
          return { ok: true, stdout: JSON.stringify({ total_count: counts[file] ?? 0 }) };
        }
        throw new Error(`unscripted gh call: ${args.join(" ")}`);
      };
      return { call, calls, workflows };
    };
    let clockMs = Date.now();
    const clock = () => clockMs;
    const sleepAdvance = async (ms) => { clockMs += ms; };
    const io = { error: () => {} };

    // (a) failed run-list query → aborted, and NO workflow was disabled.
    let gh = makeDriver({ workflows: mkWf(["a.yml"], "active"), journalBox: { number: 7, journal: null }, fail: { runList: true } });
    const failedList = await runWindow({
      repo: "o/r", preflightOnly: false, io,
      deps: { gh, now: clock, sleepImpl: sleepAdvance, execFileImpl: async () => { throw new Error("no spawn"); },
        publishers: { publishers: [{ file: "a.yml", name: "a.yml" }], referenceOnly: [], unclassified: [] } },
    });
    assert.equal(failedList.result, "retention_window_aborted");
    assert.equal(failedList.reason, "run_list_failed");
    assert.ok(!gh.calls.some((c) => c[0] === "workflow" && ["disable", "enable"].includes(c[1])));

    // (b) foreign live lease → aborted with no restore.
    gh = makeDriver({
      workflows: mkWf(["a.yml"], "active"),
      journalBox: {
        number: 7,
        journal: {
          schema: "retention-window-journal/2",
          lease: { run_id: "other-run", expires_at: new Date(Date.now() + 600_000).toISOString() },
          vendored_states: [{ file: "a.yml", name: "a.yml", state: "active" }],
        },
      },
    });
    const foreign = await runWindow({
      repo: "o/r", io,
      deps: { gh, now: clock, sleepImpl: sleepAdvance, execFileImpl: async () => { throw new Error("no spawn"); },
        publishers: { publishers: [{ file: "a.yml", name: "a.yml" }], referenceOnly: [], unclassified: [] } },
    });
    assert.equal(foreign.reason, "foreign_lease");
    assert.ok(!gh.calls.some((c) => c[0] === "workflow" && c[1] === "enable"), "no restore under a live foreign lease");

    // (c) partial disable failure → the disabled prefix is restored; report is structured.
    gh = makeDriver({
      workflows: mkWf(["a.yml", "b.yml"], "active"),
      journalBox: { number: 7, journal: null },
      fail: { disable: "b.yml", searchLag: true },
    });
    const partialDisable = await runWindow({
      repo: "o/r", io,
      deps: { gh, now: clock, sleepImpl: sleepAdvance, execFileImpl: async () => { throw new Error("no spawn"); },
        publishers: { publishers: [{ file: "a.yml", name: "a.yml" }, { file: "b.yml", name: "b.yml" }], referenceOnly: [], unclassified: [] } },
    });
    assert.equal(partialDisable.result, "retention_window_aborted");
    assert.equal(gh.calls.filter(c => c[0] === "issue" && c[1] === "list").length, 1, "lease readback uses the returned issue number despite search indexing lag");
    assert.ok(gh.calls.some((c) => c[0] === "workflow" && c[1] === "enable" && c[2] === "a.yml"), "the disabled prefix is restored");
    assert.equal(gh.workflows.find((w) => w.file === "a.yml").state, "active");

    // (d) restore keeps unconfirmed entries; (e) originally-disabled never enabled.
    gh = makeDriver({
      workflows: mkWf(["a.yml", "b.yml", "c.yml"], "disabled_manually"),
      journalBox: { number: 7, journal: null },
      fail: { enable: "b.yml" },
    });
    const outcome = await restoreStates({
      gh,
      recorded: [
        { file: "a.yml", name: "a.yml", state: "active" },
        { file: "b.yml", name: "b.yml", state: "active" },
        { file: "c.yml", name: "c.yml", state: "disabled_manually" },
      ],
      io,
    });
    assert.deepEqual(outcome.confirmed, ["a.yml", "c.yml"]);
    assert.deepEqual(outcome.unconfirmed, ["b.yml"], "unconfirmed restores stay in the journal");
    assert.ok(!gh.calls.some((c) => c[0] === "workflow" && c[1] === "enable" && c[2] === "c.yml"), "originally-disabled workflows are never enabled");
    const original = [ {file: "a.yml", state: "active"}, {file: "b.yml", state: "active"} ];
    const box = {number: 7, journal: {vendored_states: original, lease: {run_id: "expired", expires_at: "2020-01-01T00:00:00Z"}}};
    gh = makeDriver({workflows: mkWf(["a.yml", "b.yml"], "disabled_manually"), journalBox: box, fail: {enable: "b.yml"}});
    const recoveryDeps = {gh, now: clock, sleepImpl: sleepAdvance, publishers: {publishers: [{file: "a.yml", name: "a"}, {file: "b.yml", name: "b"}], referenceOnly: [], unclassified: []}};
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await runWindow({repo: "o/r", io, deps: recoveryDeps});
      assert.equal(r.reason, "recovery_incomplete");
      assert.deepEqual(box.journal.vendored_states, [{file: "b.yml", state: "active"}], "persisted original records survive repeated failures");
    }
    console.log("retention safety 16 ok (window: failed list, foreign lease, partial-disable restore, journal survival)");
  }

  // The real canonical adapter must reuse the supplied bucket snapshot while
  // obtaining fresh coordinator state exactly once for each family.
  {
    const calls = [];
    const states = await loadFamiliesState({
      env: {CLOUDFLARE_API_TOKEN: "test", CLOUDFLARE_ACCOUNT_ID: "test", DATA_PLANE_ENDPOINT: "https://test.invalid", DATA_PLANE_WRITE_KEY: "test"},
      now: "2026-09-26T00:00:00Z", resumeWindowSeconds: 86400,
      listing: [{key: "objects/example", size: 1, etag: "test", last_modified: "2026-09-20T00:00:00Z"}],
      createNamespace: ({family}) => ({
        idFromName: name => name,
        get: name => ({fetch: async url => {
          assert.equal(name, family);
          assert.equal(new URL(url).pathname, "/inspect");
          calls.push(family);
          return new Response(JSON.stringify({result: {receipts: [], pointer: null}}));
        }}),
      }),
    });
    assert.equal(states.length, 26);
    assert.equal(calls.length, 26);
    assert.equal(new Set(calls).size, 26);
    assert.deepEqual(states.map(row => row.name), calls);
    console.log("retention safety 17 ok (fresh coordinator states reuse one listing snapshot)");
  }

  console.log("test-cloud-data-plane-retention-safety: ok");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
