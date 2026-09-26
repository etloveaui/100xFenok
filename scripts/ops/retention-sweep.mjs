#!/usr/bin/env node
// retention-sweep.mjs — revision 2 (fh-598 corrections applied).
//
// PLAN (outside any pause; no pause deadline): full S3 listing identity for EVERY key
// (ETag/LastModified/Size, no prefix omission), every manifest read + validated, fresh
// coordinator family state; the plan artifact caches the listing identities, the manifest
// index and candidate keys for BOTH payloads and manifests. Candidate policy is produced
// by the canonical helpers (computeRetentionPlan / retentionReferenceEvidence), never by a
// second drifting policy. The cost gate runs first with a declared 2x budget.
//
// APPLY (inside the pause; ONE deadline): fresh COMPLETE S3 listing + changed
// manifests (bounded concurrency, identity-checked: listed ETag/Size vs response
// identity/bytes) + fresh family state → canonical recompute (a retained generation with
// no readable manifest aborts with ZERO deletes) → presence preflight (every live/rollback
// payload must be present; else ZERO deletes) → cost gate → eligibility = intersection with
// the ORIGINAL plan for both payloads and manifests (exact key identity; fresh grace via the
// canonical plan; global cross-family references; protected keys) → payload DeleteObjects
// first (≤1000/request; no artificial cap — the deadline stops partial work explicitly) →
// obsolete-manifest DeleteObjects (default ON; --skip-manifests disables) → fresh post-delete
// listing + live/rollback presence verification within the same deadline. Per-key errors,
// unknowns, deferred keys, a failed/incomplete verification or any abort can never return an
// applied success. Successful/deferred/failed keys and measured bytes are persisted to
// --keys-out. The legacy REST per-key deleter is not used anywhere on this path.
//
// Honesty notes: the 900 s deadline bounds THIS run from before the first disable; it is not
// a guarantee that a future invocation resumes within any fixed time (see retention-window.mjs
// for the recovery contract and its limits).

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  S3_DELETE_MAX_KEYS,
  createR2S3ClientFromExistingToken,
} from "../lib/cloud-data-plane-s3.mjs";
import { runBoundedAsyncPool, sha256Canonical, validateGenerationManifest } from "../lib/cloud-data-plane-generation.mjs";
import { createCloudflareCloudDataPlane } from "../lib/cloud-data-plane-cloudflare-adapter.mjs";
import { createR2RestBucket } from "../lib/cloud-data-plane-r2-rest.mjs";
import { createRemoteCoordinatorNamespace } from "../lib/cloud-data-plane-remote-coordinator.mjs";
import {
  FAMILIES,
  RETENTION_KEEP_NEWEST,
  RETENTION_PROTECTED_KEYS,
  RETENTION_UPLOAD_GRACE_SECONDS,
  collectFamiliesRetentionState,
  computeRetentionPlan,
  retentionReferenceEvidence,
  runCostGate,
} from "../publish-cloud-data-generation.mjs";

export const PLAN_SCHEMA = "r2-retention-plan/3";
export const RESULT_VOCABULARY = Object.freeze([
  "retention_plan",
  "retention_batch_applied",
  "retention_batch_partial",
  "retention_batch_noop",
  "retention_batch_aborted",
]);
export const DEFAULT_RESUME_WINDOW_SECONDS = 86_400;
const MANIFEST_READ_CONCURRENCY = 8;
const DEADLINE_RESERVE_MS = 20_000;
const MIN_APPLY_MS = 60_000;
const POST_DELETE_MIN_MS = 30_000;
const GENERATION_MANIFEST_KEY = /^manifests\/.+-[0-9a-f]{16}\.json$/;

function fail(code, detail) {
  const error = new Error(`${code}:${detail}`);
  error.code = code;
  throw error;
}

function bucketName() {
  return "fenok-data-plane";
}

function logLine(io, ...parts) {
  io.error(parts.join(" "));
}

// --- shared loading -----------------------------------------------------------

async function loadFamiliesState({ env, now, resumeWindowSeconds }) {
  const token = env.CLOUDFLARE_API_TOKEN;
  const endpoint = env.DATA_PLANE_ENDPOINT;
  const writeKey = env.DATA_PLANE_WRITE_KEY;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const missing = [
    ["CLOUDFLARE_API_TOKEN", token],
    ["CLOUDFLARE_ACCOUNT_ID", accountId],
    ["DATA_PLANE_ENDPOINT", endpoint],
    ["DATA_PLANE_WRITE_KEY", writeKey],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) fail("SWEEP_CONFIG_INVALID", `missing env ${missing.join(", ")}`);
  const r2Bucket = createR2RestBucket({ accountId, bucket: bucketName(), token });
  return collectFamiliesRetentionState({
    families: Object.keys(FAMILIES).sort(),
    createPlane: (name) => createCloudflareCloudDataPlane({
      r2Bucket,
      coordinatorNamespace: createRemoteCoordinatorNamespace({ endpoint, key: writeKey, family: name }),
      coordinatorName: name,
    }),
    now,
    resumeWindowSeconds,
  });
}

// Every listing entry must carry key, size, ETag and LastModified. Anything else is
// ambiguous metadata and aborts the caller with zero side effects.
function assertListingComplete(entries) {
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.key)) fail("SWEEP_METADATA_DUPLICATE", entry.key);
    seen.add(entry.key);
    if (
      !entry?.key
      || !Number.isInteger(entry.size)
      || typeof entry.etag !== "string" || entry.etag.length === 0
      || typeof entry.last_modified !== "string" || !Number.isFinite(Date.parse(entry.last_modified))
    ) {
      fail("SWEEP_METADATA_INCOMPLETE", entry?.key ?? "<entry without key>");
    }
  }
}

// Read manifest bodies with snapshot-consistency validation: the fetched bytes and the
// response identity (ETag) must match the listing entry the plan is based on.
async function readManifestTextsWithIdentity({ s3, listingEntries, deadline }) {
  const results = new Array(listingEntries.length);
  await runBoundedAsyncPool(
    listingEntries.map((entry, index) => ({ entry, index })),
    async ({ entry, index }) => {
      const fetched = await s3.getObject(entry.key, { deadline });
      if (fetched === null) fail("SWEEP_MANIFEST_MISSING", entry.key);
      const { bytes, etag } = fetched;
      if (bytes.byteLength !== entry.size) {
        fail("SWEEP_MANIFEST_IDENTITY", `${entry.key}: size ${bytes.byteLength} != listed ${entry.size}`);
      }
      if (typeof etag !== "string" || etag.length === 0 || etag !== entry.etag) {
        fail("SWEEP_MANIFEST_IDENTITY", `${entry.key}: response etag differs from the listing`);
      }
      results[index] = { key: entry.key, text: new TextDecoder().decode(bytes) };
    },
    MANIFEST_READ_CONCURRENCY,
  );
  if (results.some((entry) => entry === undefined)) {
    fail("SWEEP_MANIFEST_READ_INCOMPLETE", "bounded pool did not fill every slot");
  }
  return results;
}

// Replace-by-key index: a key can hold exactly one current entry (the last read wins),
// so a changed manifest can never be counted twice.
export function indexManifestEntries(entries) {
  const index = new Map();
  for (const entry of entries) index.set(entry.key, entry);
  return index;
}

export function parseManifestEntry({ entry, listingEntry }) {
  let parsed;
  try {
    parsed = JSON.parse(entry.text);
  } catch {
    fail("SWEEP_MANIFEST_INVALID", `${entry.key}: not JSON`);
  }
  try {
    validateGenerationManifest(parsed);
  } catch (error) {
    fail("SWEEP_MANIFEST_INVALID", `${entry.key}: ${error.message}`);
  }
  const generationId = parsed.generation_id;
  if (GENERATION_MANIFEST_KEY.test(entry.key)) {
    // A generation-shaped key must name exactly this manifest; anything else is a
    // spoofed/mismatched key and is rejected rather than demoted to an alias.
    if (`manifests/${generationId}.json` !== entry.key) {
      fail("SWEEP_MANIFEST_KEY_MISMATCH", `${entry.key}: manifest generation_id ${generationId}`);
    }
  }
  const isGeneration = `manifests/${generationId}.json` === entry.key;
  const referenced = [...new Set(parsed.assets.map((asset) => asset.object_key))].sort();
  return {
    key: entry.key,
    generation_id: isGeneration ? generationId : null,
    family: isGeneration ? generationId.slice(0, -17) : null,
    created_at: typeof parsed.created_at === "string" ? parsed.created_at : null,
    referenced_keys: referenced,
    etag: listingEntry.etag,
    last_modified: listingEntry.last_modified,
    size: listingEntry.size,
  };
}

// Fresh canonical state: complete listing + ALL manifests (identity-checked) + family
// state + the shared computeRetentionPlan (which aborts when any retained generation
// has no readable manifest, when a family is unreadable, or when input is malformed).
async function buildFreshCanonicalState({ s3, env, now, resumeWindowSeconds, deadline, cachedPlan = null, deps = {} }) {
  const listing = deps.freshListing ?? await s3.listAllObjects({ deadline });
  assertListingComplete(listing);
  const listingByKey = new Map(listing.map((entry) => [entry.key, entry]));
  const manifestListingEntries = listing
    .filter((entry) => entry.key.startsWith("manifests/"))
    .sort((left, right) => left.key.localeCompare(right.key));
  if (listing.length > 100_000 || manifestListingEntries.length > 2500) fail("SWEEP_SCAN_BUDGET", "declared scan limit exceeded");
  const oldListing = new Map((cachedPlan?.listing ?? []).map(row => [row.key, row]));
  const cached = indexManifestEntries(cachedPlan?.manifest_entries ?? []);
  const sameIdentity = (a,b) => a && b && a.etag === b.etag && a.size === b.size && a.last_modified === b.last_modified;
  if (cachedPlan && [...cached.keys()].some(key => !listingByKey.has(key))) fail("SWEEP_MANIFEST_VANISHED", "cached manifest disappeared");
  const changed = cachedPlan ? manifestListingEntries.filter(row => !sameIdentity(oldListing.get(row.key), row) || !cached.has(row.key)) : manifestListingEntries;
  if (cachedPlan && changed.length > 300) fail("SWEEP_DELTA_BUDGET", "more than 300 changed manifests");
  const fetched = await readManifestTextsWithIdentity({ s3, listingEntries: changed, deadline });
  const merged = indexManifestEntries([...cached.values(), ...fetched]);
  const manifestEntries = manifestListingEntries.map(row => merged.get(row.key));
  for (const entry of manifestEntries) parseManifestEntry({entry, listingEntry: listingByKey.get(entry.key)});
  const familiesState = deps.familiesState
    ?? await loadFamiliesState({ env, now, resumeWindowSeconds });
  const objectEntries = listing.map(({ key, size, last_modified }) => ({ key, size, uploaded: last_modified }));
  const plan = computeRetentionPlan({
    families: familiesState,
    manifestEntries,
    objectEntries,
    now,
    keepNewest: RETENTION_KEEP_NEWEST,
    graceSeconds: RETENTION_UPLOAD_GRACE_SECONDS,
  });
  return { listing, listingByKey, manifestEntries, manifestListingEntries, familiesState, plan, manifestsRead: fetched.length };
}

// --- pure intersection (exported for the retention safety suite) ---------------

// Eligibility = intersection with the ORIGINAL plan for BOTH payloads and manifests,
// exact key identity (listing ETag+Size unchanged since the plan), fresh grace and the
// global retained references (both already enforced by the canonical fresh plan).
// A payload-only/noop intersection never blocks the manifest cleanup; an obsolete
// manifest's shared retained payloads are NOT required to be deleted for the manifest
// itself to be eligible (deleting the manifest never touches payloads).
export function computeSweepIntersection({
  plan,
  freshPlan,
  planListingByKey,
  freshByKey,
  skipManifests = false,
  maxPayloadKeys = null,
} = {}) {
  const planCandidateKeys = new Set(plan.candidates.map((row) => row.key));
  const payloads = [];
  const skipped = { not_in_plan: 0, missing: 0, identity_changed: 0 };
  for (const candidate of freshPlan.candidates) {
    if (!planCandidateKeys.has(candidate.key)) { skipped.not_in_plan += 1; continue; }
    const fresh = freshByKey.get(candidate.key);
    const previous = planListingByKey.get(candidate.key);
    if (!fresh || !previous) { skipped.missing += 1; continue; }
    if (fresh.etag !== previous.etag || fresh.size !== previous.size || fresh.last_modified !== previous.last_modified) { skipped.identity_changed += 1; continue; }
    payloads.push({ key: candidate.key, size: candidate.size ?? fresh.size });
  }
  payloads.sort((left, right) => (right.size - left.size) || left.key.localeCompare(right.key));
  const selectedPayloads = maxPayloadKeys === null ? payloads : payloads.slice(0, maxPayloadKeys);
  const planManifestKeys = new Set((plan.manifest_candidates ?? []).map((row) => row.key));
  const manifests = skipManifests
    ? []
    : (freshPlan.manifestCandidates ?? [])
      .filter((row) => {
        const fresh = freshByKey.get(row.key), old = planListingByKey.get(row.key);
        return planManifestKeys.has(row.key) && fresh && old && fresh.etag === old.etag && fresh.size === old.size && fresh.last_modified === old.last_modified;
      })
      .map((row) => ({ key: row.key, generation_id: row.generation_id, family: row.family, size: row.size ?? null }))
      .sort((left, right) => left.key.localeCompare(right.key));
  return { payloads: selectedPayloads, payloadsTotal: payloads.length, manifests, skipped };
}

// --- plan build ---------------------------------------------------------------

export async function buildPlan({
  env = process.env,
  now = new Date().toISOString(),
  resumeWindowSeconds = DEFAULT_RESUME_WINDOW_SECONDS,
  deps = {},
  io = console,
} = {}) {
  const runCostGateImpl = deps.runCostGateImpl ?? runCostGate;
  const gate = await runCostGateImpl({ planClassA: 200, planClassB: 5000, planBytes: 0, env });
  if (gate.code !== 0 && gate.code !== 1) fail("SWEEP_GATE_BLOCKED", `gate exit ${gate.code}`);
  const s3 = deps.s3 ?? await createR2S3ClientFromExistingToken({ env });
  const state = await buildFreshCanonicalState({ s3, env, now, resumeWindowSeconds, deadline: undefined, deps });
  const evidence = retentionReferenceEvidence({ plan: state.plan, objectEntries: state.listing });
  const manifestIndex = state.manifestEntries.map((entry) => parseManifestEntry({
    entry,
    listingEntry: state.listingByKey.get(entry.key),
  }));
  const base = {
    schema: PLAN_SCHEMA,
    created_at: now,
    keep_newest: RETENTION_KEEP_NEWEST,
    grace_seconds: RETENTION_UPLOAD_GRACE_SECONDS,
    resume_window_seconds: resumeWindowSeconds,
    families: state.familiesState.map((family) => ({
      name: family.name,
      active_id: family.pointer?.active?.generation_id ?? null,
      previous_id: family.pointer?.previous?.generation_id ?? null,
      prepared_ids: [...(family.preparedGenerations ?? [])],
      expired_receipt_ids: (family.expiredReceipts ?? []).map((row) => row.generation_id ?? null),
    })),
    manifests: manifestIndex,
    manifest_entries: state.manifestEntries,
    listing: state.listing,
    candidates: state.plan.candidates,
    manifest_candidates: state.plan.manifestCandidates,
    protected_keys: [...RETENTION_PROTECTED_KEYS].sort(),
    counts: {
      listing: state.listing.length,
      manifests: manifestIndex.length,
      candidates: state.plan.candidates.length,
      manifest_candidates: state.plan.manifestCandidates.length,
      retained_generations: state.plan.retainedGenerations.length,
      grace_root_manifests: state.plan.graceRoots.length,
      referenced_keys: state.plan.referencedKeys.length,
    },
    reference_evidence: evidence.unique,
    gate: { code: gate.code, verdict: gate.code === 0 ? "ok" : "warn" },
  };
  const artifact = { ...base, plan_id: sha256Canonical(base) };
  return artifact;
}

export function loadPlanArtifact(planPath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(planPath, "utf8"));
  } catch (error) {
    fail("SWEEP_PLAN_INVALID", `${planPath}: ${error.message}`);
  }
  if (parsed?.schema !== PLAN_SCHEMA) fail("SWEEP_PLAN_INVALID", `unexpected schema ${parsed?.schema}`);
  const { plan_id: planId, ...base } = parsed;
  const recomputed = sha256Canonical(base);
  if (recomputed !== planId) fail("SWEEP_PLAN_ID_MISMATCH", `${planPath}: plan_id does not reproduce`);
  return parsed;
}

// --- apply --------------------------------------------------------------------

async function deleteChunks({ s3, keys, sizeByKey, deadline, io, label }) {
  const outcome = { label, chunks: 0, deleted: [], errors: [], deferred: [], unknown: [], bytes: 0, abort: null };
  for (let offset = 0; offset < keys.length; offset += S3_DELETE_MAX_KEYS) {
    if (Date.now() + DEADLINE_RESERVE_MS >= deadline) {
      outcome.deferred.push(...keys.slice(offset));
      outcome.abort = "deadline_before_chunk";
      break;
    }
    const chunk = keys.slice(offset, offset + S3_DELETE_MAX_KEYS);
    outcome.chunks += 1;
    let result;
    try {
      result = await s3.deleteObjects(chunk, { deadline: deadline - DEADLINE_RESERVE_MS });
    } catch (error) {
      outcome.unknown.push(...chunk);
      outcome.deferred.push(...keys.slice(offset + chunk.length));
      outcome.abort = error?.code === "S3_DEADLINE" ? "deadline" : `request_failure:${error?.code ?? "ERROR"}`;
      break;
    }
    for (const key of result.deleted) {
      outcome.deleted.push(key);
      outcome.bytes += sizeByKey.get(key) ?? 0;
    }
    outcome.errors.push(...result.errors);
    if (result.unknown.length > 0) {
      outcome.unknown.push(...result.unknown);
      outcome.deferred.push(...keys.slice(offset + chunk.length));
      outcome.abort = "unknown_result";
      break;
    }
  }
  if (outcome.chunks > 1) logLine(io, `sweep: ${label} chunks=${outcome.chunks}`);
  return outcome;
}

export async function applyBatch({
  planPath,
  env = process.env,
  batchMaxKeys = null,
  skipManifests = false,
  keysOut = null,
  deadlineEpochSeconds,
  deps = {},
  io = console,
  now = () => Date.now(),
} = {}) {
  const startedAt = new Date(now()).toISOString();
  const plan = loadPlanArtifact(planPath);
  const deadline = Number(deadlineEpochSeconds) * 1000;
  const abortReport = (reason, detail = {}, extra = {}) => ({
    result: "retention_batch_aborted",
    reason,
    detail,
    plan_id: plan.plan_id,
    started_at: startedAt,
    finished_at: new Date(now()).toISOString(),
    verification: "not_attempted",
    ...extra,
  });
  if (!Number.isFinite(deadline) || now() + MIN_APPLY_MS >= deadline) {
    return abortReport("deadline_insufficient", { deadline_epoch_seconds: deadlineEpochSeconds ?? null });
  }

  const runCostGateImpl = deps.runCostGateImpl ?? runCostGate;
  const gate = await runCostGateImpl({planClassA: 400, planClassB: 600, planBytes: 0, env, timeoutMs: Math.max(1, Math.min(60_000, deadline - now() - MIN_APPLY_MS))});
  if (gate.code !== 0 && gate.code !== 1) return abortReport("gate_blocked", {gate_exit: gate.code});
  let s3;
  try {
    s3 = deps.s3 ?? await createR2S3ClientFromExistingToken({ env, timeoutMs: Math.max(1, Math.min(30_000, deadline - now())) });
  } catch (error) {
    return abortReport("credential_derivation_failed", { code: error?.code ?? "ERROR" });
  }

  // Fresh canonical state: complete listing + ALL manifests + family state + canonical plan.
  let state;
  try {
    state = await buildFreshCanonicalState({
      s3,
      env,
      now: new Date(now()).toISOString(),
      resumeWindowSeconds: plan.resume_window_seconds,
      cachedPlan: plan,
      deadline: deadline - DEADLINE_RESERVE_MS,
      deps,
    });
  } catch (error) {
    return abortReport("fresh_state_failed", { code: error?.code ?? "ERROR", message: String(error?.message ?? error).slice(0, 300) });
  }

  // Presence preflight: every live/rollback payload referenced by a retained root must
  // exist in the fresh listing. Missing references abort with zero deletes.
  const presencePre = retentionReferenceEvidence({ plan: state.plan, objectEntries: state.listing });
  if (presencePre.unique.presence_ok !== true) {
    return abortReport("presence_preflight_failed", {
      live_missing: presencePre.unique.live_missing_payloads,
      rollback_missing: presencePre.unique.rollback_missing_payloads,
    });
  }

  const sizeByKey = new Map(state.listing.map((entry) => [entry.key, entry.size]));
  const intersection = computeSweepIntersection({
    plan,
    freshPlan: state.plan,
    planListingByKey: new Map(plan.listing.map((entry) => [entry.key, entry])),
    freshByKey: state.listingByKey,
    skipManifests,
    maxPayloadKeys: batchMaxKeys,
  });

  const report = {
    result: "retention_batch_noop",
    plan_id: plan.plan_id,
    started_at: startedAt,
    finished_at: null,
    deadline_epoch_seconds: Math.floor(deadline / 1000),
    plan_age_seconds: Math.floor((now() - Date.parse(plan.created_at)) / 1000),
    fresh: {
      listing_entries: state.listing.length,
      manifests_read: state.manifestsRead,
      families: state.familiesState.length,
    },
    retained: {
      generations: state.plan.retainedGenerations.length,
      grace_root_manifests: state.plan.graceRoots.length,
      referenced_keys: state.plan.referencedKeys.length,
      present: true,
    },
    doomed_manifests: {
      count: state.plan.manifestCandidates.length,
      bytes: state.plan.manifestCandidateBytes,
    },
    eligible: {
      payloads_total: intersection.payloadsTotal,
      payloads_selected: intersection.payloads.length,
      manifests: intersection.manifests.length,
      skipped: intersection.skipped,
      batch_max_keys: batchMaxKeys,
    },
    gate: { code: gate.code },
    payloads: null,
    manifests: null,
    verification: "not_attempted",
  };

  if (intersection.payloads.length === 0 && intersection.manifests.length === 0) {
    report.finished_at = new Date(now()).toISOString();
    return report;
  }

  let payloadOutcome = { label: "payloads", chunks: 0, deleted: [], errors: [], deferred: [], unknown: [], bytes: 0, abort: null };
  if (intersection.payloads.length > 0) {
    payloadOutcome = await deleteChunks({
      s3,
      keys: intersection.payloads.map((row) => row.key),
      sizeByKey,
      deadline,
      io,
      label: "payloads",
    });
  }

  let manifestOutcome = { label: "manifests", chunks: 0, deleted: [], errors: [], deferred: [], unknown: [], bytes: 0, abort: null };
  if (intersection.manifests.length > 0 && payloadOutcome.abort === null && payloadOutcome.unknown.length === 0 && payloadOutcome.errors.length === 0) {
    manifestOutcome = await deleteChunks({
      s3,
      keys: intersection.manifests.map((row) => row.key),
      sizeByKey,
      deadline,
      io,
      label: "manifests",
    });
  } else if (intersection.manifests.length > 0) {
    manifestOutcome.deferred = intersection.manifests.map((row) => row.key);
    manifestOutcome.abort = "payload_phase_incomplete";
  }

  // Post-delete verification (same deadline): fresh listing + live/rollback presence.
  if (payloadOutcome.abort === null && payloadOutcome.unknown.length === 0
    && (manifestOutcome.abort === null || manifestOutcome.abort === "payload_phase_incomplete")) {
    if (now() + POST_DELETE_MIN_MS >= deadline) {
      report.verification = "incomplete";
    } else {
      try {
        const postListing = deps.postDeleteListing ?? await s3.listAllObjects({ deadline: deadline - DEADLINE_RESERVE_MS });
        assertListingComplete(postListing);
        const presencePost = retentionReferenceEvidence({ plan: state.plan, objectEntries: postListing });
        report.verification = presencePost.unique.presence_ok === true ? "ok" : "failed";
        report.verification_datasets = Object.fromEntries(Object.entries(presencePost.families).map(([name,row]) => [name, {active_generation_id:row.active_generation_id, previous_generation_id:row.previous_generation_id, referenced_payload_count:row.referenced_payload_count, missing_referenced_payloads:row.missing_referenced_payloads}]));
        const postKeys = new Set(postListing.map(row => row.key));
        const stillPresent = [...payloadOutcome.deleted, ...manifestOutcome.deleted].filter(key => postKeys.has(key));
        if (stillPresent.length) {report.verification = "failed"; report.deleted_still_present = stillPresent;}
        if (presencePost.unique.presence_ok !== true) {
          report.verification_detail = {
            live_missing: presencePost.unique.live_missing_payloads,
            rollback_missing: presencePost.unique.rollback_missing_payloads,
          };
        }
      } catch (error) {
        report.verification = "incomplete";
        report.verification_detail = { code: error?.code ?? "ERROR" };
      }
    }
  }
  // A deleted doomed manifest is expected to disappear from the fresh listing; the
  // presence check only concerns retained references, so no suppression is needed.

  report.payloads = {
    requested: intersection.payloads.length,
    chunks: payloadOutcome.chunks,
    deleted: payloadOutcome.deleted.length,
    bytes: payloadOutcome.bytes,
    errors: payloadOutcome.errors,
    deferred: payloadOutcome.deferred,
    unknown: payloadOutcome.unknown,
    abort: payloadOutcome.abort,
  };
  report.manifests = {
    requested: intersection.manifests.length,
    chunks: manifestOutcome.chunks,
    deleted: manifestOutcome.deleted.length,
    bytes: manifestOutcome.bytes,
    errors: manifestOutcome.errors,
    deferred: manifestOutcome.deferred,
    unknown: manifestOutcome.unknown,
    abort: manifestOutcome.abort,
  };

  const aborted = payloadOutcome.abort !== null || payloadOutcome.unknown.length > 0
    || (manifestOutcome.abort !== null && manifestOutcome.abort !== "deadline_before_chunk")
    || manifestOutcome.unknown.length > 0;
  const errors = payloadOutcome.errors.length + manifestOutcome.errors.length;
  const deferred = payloadOutcome.deferred.length + manifestOutcome.deferred.length;
  const deletedTotal = payloadOutcome.deleted.length + manifestOutcome.deleted.length;
  if (aborted && deletedTotal === 0) {
    report.result = "retention_batch_aborted";
    report.reason = payloadOutcome.abort ?? manifestOutcome.abort ?? "unknown_result";
  } else if (!aborted && errors === 0 && deferred === 0 && report.verification === "ok") {
    report.result = "retention_batch_applied";
  } else {
    report.result = "retention_batch_partial";
    report.reason = aborted
      ? (payloadOutcome.abort ?? manifestOutcome.abort ?? "unknown_result")
      : (errors > 0 ? "per_key_errors" : (deferred > 0 ? "deferred_by_deadline" : "verification_incomplete"));
  }
  report.finished_at = new Date(now()).toISOString();

  if (keysOut) {
    const keysArtifact = {
      schema: "r2-retention-batch-keys/1",
      plan_id: plan.plan_id,
      generated_at: report.finished_at,
      deleted: payloadOutcome.deleted,
      deleted_manifests: manifestOutcome.deleted,
      errors: payloadOutcome.errors,
      manifest_errors: manifestOutcome.errors,
      deferred: payloadOutcome.deferred,
      manifest_deferred: manifestOutcome.deferred,
      unknown: payloadOutcome.unknown,
      manifest_unknown: manifestOutcome.unknown,
      bytes: { payloads: payloadOutcome.bytes, manifests: manifestOutcome.bytes },
    };
    fs.writeFileSync(keysOut, `${JSON.stringify(keysArtifact)}\n`);
    report.keys_path = path.resolve(keysOut);
  }
  return report;
}

// --- CLI ----------------------------------------------------------------------

function parseSweepArgs(argv) {
  const args = {
    command: argv[0] ?? null,
    out: null, plan: null, keysOut: null,
    batchMaxKeys: null, skipManifests: false, deadlineEpochSeconds: null,
  };
  for (const arg of argv.slice(1)) {
    if (arg.startsWith("--out=")) args.out = arg.slice("--out=".length);
    else if (arg.startsWith("--plan=")) args.plan = arg.slice("--plan=".length);
    else if (arg.startsWith("--keys-out=")) args.keysOut = arg.slice("--keys-out=".length);
    else if (arg.startsWith("--batch-max-keys=")) args.batchMaxKeys = Number.parseInt(arg.slice("--batch-max-keys=".length), 10);
    else if (arg === "--skip-manifests") args.skipManifests = true;
    else if (arg.startsWith("--deadline-epoch-seconds=")) args.deadlineEpochSeconds = Number.parseInt(arg.slice("--deadline-epoch-seconds=".length), 10);
    else fail("ARGS_INVALID", arg);
  }
  if (args.command === "plan" && !args.out) fail("ARGS_INVALID", "plan requires --out=<path>");
  if (args.command === "apply" && (!args.plan || !Number.isFinite(args.deadlineEpochSeconds))) {
    fail("ARGS_INVALID", "apply requires --plan=<path> and --deadline-epoch-seconds=<epoch>");
  }
  if (args.command !== "plan" && args.command !== "apply") fail("ARGS_INVALID", `unknown command ${args.command}`);
  return args;
}

export async function runRetentionSweepCli({ argv = process.argv.slice(2), env = process.env, io = console } = {}) {
  const args = parseSweepArgs(argv);
  if (args.command === "plan") {
    const artifact = await buildPlan({ env, io });
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, `${JSON.stringify(artifact)}\n`);
    io.log(JSON.stringify({
      result: "retention_plan",
      plan_id: artifact.plan_id,
      plan_path: path.resolve(args.out),
      created_at: artifact.created_at,
      counts: artifact.counts,
      reference_evidence: artifact.reference_evidence,
    }));
    return 0;
  }
  const report = await applyBatch({
    planPath: args.plan,
    env,
    batchMaxKeys: args.batchMaxKeys,
    skipManifests: args.skipManifests,
    keysOut: args.keysOut,
    deadlineEpochSeconds: args.deadlineEpochSeconds,
    io,
  });
  io.log(JSON.stringify(report));
  if (report.result === "retention_batch_aborted") return 1;
  if (report.result === "retention_batch_partial") return 2;
  return 0;
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    process.exitCode = await runRetentionSweepCli();
  } catch (error) {
    console.error(`retention-sweep: ${error.code ?? "ERROR"}: ${error.message}`);
    process.exitCode = 1;
  }
}
