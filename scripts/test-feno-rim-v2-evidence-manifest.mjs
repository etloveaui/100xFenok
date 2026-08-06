#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CALIBRATION_CUTOFF_AT,
  MANIFEST_SCHEMA_VERSION,
  assertManifestIntegrity,
  buildEvidenceManifest,
} from "./feno-rim-v2/evidence-manifest.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const manifest = buildEvidenceManifest({ generatedAt: "2026-08-06T00:00:00.000Z" });
assert.equal(manifest.schema_version, MANIFEST_SCHEMA_VERSION);
assert.equal(manifest.calibration_cutoff_at, CALIBRATION_CUTOFF_AT);
assert.equal(manifest.final_holdout, null, "the final holdout is the next sealed claim, not a recycled one");

// Role census: structure grids, five two-sided claims, everything else context.
const counts = {};
for (const row of manifest.evidence) counts[row.role] = (counts[row.role] ?? 0) + 1;
assert.deepEqual(counts, { CONTEXT_ONLY: 9, STRUCTURE: 2, VALIDATE: 5 });

// No fit, no selection, no holdout reuse: the sets are empty by construction.
for (const role of ["FIT", "SELECT", "FINAL_HOLDOUT"]) {
  assert.equal(manifest.evidence.filter((row) => row.role === role).length, 0, `${role} must be empty before any fit exists`);
}

// Every claim of the calibration fixture is present exactly once.
const calibration = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/fixtures/fenok-rim-calibration-evidence.json"), "utf8"));
const ids = new Set(manifest.evidence.map((row) => row.evidence_id));
for (const claim of calibration.claims) {
  assert.ok(ids.has(claim.evidence_id), `${claim.evidence_id} must be in the manifest`);
}
assert.equal(manifest.evidence.length, calibration.claims.length + 2);

// Integrity: roles valid, cutoff respected, no fit/holdout overlap.
assert.equal(assertManifestIntegrity(manifest), true);

// Determinism: identical inputs, identical hash; timestamp outside the hash.
const again = buildEvidenceManifest({ generatedAt: "2027-01-01T00:00:00.000Z" });
assert.equal(again.manifest_sha256, manifest.manifest_sha256, "the manifest hash must not depend on generated_at");
assert.notEqual(again.generated_at, manifest.generated_at);

// The integrity checker must actually catch violations.
const corrupted = JSON.parse(JSON.stringify(manifest));
corrupted.evidence[0].first_knowable_at = "2026-08-06";
assert.throws(() => assertManifestIntegrity(corrupted), /postdates cutoff/);
const dup = JSON.parse(JSON.stringify(manifest));
dup.evidence.push({ ...dup.evidence[0] });
assert.throws(() => assertManifestIntegrity(dup), /duplicate id/);
const badRole = JSON.parse(JSON.stringify(manifest));
badRole.evidence[0].role = "PROMOTE";
assert.throws(() => assertManifestIntegrity(badRole), /unknown role/);

console.log("feno-rim-v2 evidence manifest tests passed");
