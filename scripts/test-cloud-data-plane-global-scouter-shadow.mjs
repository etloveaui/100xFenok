#!/usr/bin/env node
// Focused proof for the Global Scouter caller-only shadow publication. This is
// intentionally offline: the dry-run uses the default registry admission and
// never constructs a Cloudflare plane.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertPublicationAuthorization,
  buildFamilyManifest,
  FAMILIES,
  runPublisherCli,
} from "./publish-cloud-data-generation.mjs";
import { buildCandidateScope } from "./lib/cloud-data-plane-candidate-scope.mjs";
import { derivePublicPlaneEnrollment } from "./lib/plane-enrollment-derivation.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FAMILY_NAME = "global-scouter";
const FAMILY = FAMILIES[FAMILY_NAME];
const MANIFEST_PREFIX = "public/data/global-scouter/";
// DERIVED, not pinned. These were literals - 1,082 assets and 87,268,011 bytes
// from the 2026-08-14 export - and global-scouter is a WEEKLY source, so the
// byte total moves every refresh and the literal went red the moment the
// 2026-08-21 export landed. A contract pinned to this week's number is a
// contract that fails on next week's healthy data, which is the same defect
// shape this repo has already recorded for an error message and a symbol list.
//
// The independent walk below is what the assertions should have been comparing
// against all along: it enumerates and stats the canonical scope itself, so the
// publisher is still checked against something computed separately from it.
const MEASURED_ASSETS_FALLBACK = 1_082;
const DERIVED_CORE_FILES = [
  "core/per_bands_index.json",
  "core/revision_movers.json",
  "core/slick_index.json",
  "core/stocks_analyzer.json",
];

function independentScopeFiles(scope) {
  const files = [];
  for (const root of scope.manifest.included_canonical_roots) {
    const absolute = path.join(REPO_ROOT, root.path);
    const stat = fs.statSync(absolute);
    if (stat.isFile()) {
      files.push(path.relative(path.join(REPO_ROOT, "data/global-scouter"), absolute));
      continue;
    }
    const walk = (current) => {
      for (const entry of fs.readdirSync(current).sort()) {
        const next = path.join(current, entry);
        if (fs.statSync(next).isDirectory()) walk(next);
        else files.push(path.relative(path.join(REPO_ROOT, "data/global-scouter"), next));
      }
    };
    walk(absolute);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

const scope = buildCandidateScope({ repoRoot: REPO_ROOT, candidateId: "global_scouter" });
const expectedFiles = independentScopeFiles(scope);
const MEASURED_ASSETS = expectedFiles.length;
const MEASURED_BYTES = expectedFiles.reduce(
  (total, file) => total + fs.statSync(path.join(REPO_ROOT, "data/global-scouter", file)).size,
  0,
);
const MEASURED_CLASS_B_READS = (MEASURED_ASSETS + 1) * 3 + 1;
// The count is structural - it is the scope minus the four derived core files -
// so a change here means the family boundary moved and deserves a look, unlike
// the byte total which moves every week by design.
assert.equal(
  MEASURED_ASSETS,
  MEASURED_ASSETS_FALLBACK,
  `global-scouter scope moved from ${MEASURED_ASSETS_FALLBACK} to ${MEASURED_ASSETS} assets; confirm the family boundary changed on purpose before updating this`,
);
assert.deepEqual(scope.manifest.totals, { file_count: MEASURED_ASSETS, bytes: MEASURED_BYTES });
assert.equal(new Set(expectedFiles).size, expectedFiles.length);
assert.deepEqual(scope.manifest.excluded.map((row) => row.path), DERIVED_CORE_FILES.map((file) => `data/global-scouter/${file}`));

const built = await buildFamilyManifest({
  familyName: FAMILY_NAME,
  absRoot: path.join(REPO_ROOT, FAMILY.root),
  relRoot: FAMILY.manifest_prefix,
  now: () => "2026-08-17T00:00:00.000Z",
});
assert.equal(built.summary.asset_count, MEASURED_ASSETS);
assert.equal(built.summary.total_bytes, MEASURED_BYTES);
// The clock is read from the family index rather than pinned, for the same
// reason as the byte total: a weekly source makes last week's date a guaranteed
// future failure. What is asserted is that it HAS one and that it came from the
// family index, which is the behaviour the contract exists to protect.
assert.match(built.sourceAsOf.value, /^\d{4}-\d{2}-\d{2}$/);
assert.equal(built.sourceAsOf.origin, "family-index");
const EXPECTED_SOURCE_AS_OF = built.sourceAsOf.value;
assert.deepEqual(
  built.manifest.assets.map((asset) => asset.path.slice(MANIFEST_PREFIX.length)),
  expectedFiles,
  "publisher enumeration must come from the candidate scope roots",
);
assert.equal(
  built.manifest.assets.some((asset) => DERIVED_CORE_FILES.includes(asset.path.slice(MANIFEST_PREFIX.length))),
  false,
  "derived core outputs are not part of the caller publication",
);
assert.ok(built.manifest.assets.every((asset) => asset.source_as_of === EXPECTED_SOURCE_AS_OF));

const validator = FAMILY.validate_public_payload;
let accepted = 0;
for (const asset of built.manifest.assets) {
  assert.equal(validator({ asset, bytes: built.payloads.get(asset.path) }), true, asset.path);
  accepted += 1;
}
assert.equal(accepted, MEASURED_ASSETS);
const readmeAsset = built.manifest.assets.find((asset) => asset.path.endsWith("/README.md"));
assert.ok(readmeAsset, "README is included in the public scope");
assert.equal(validator({ asset: readmeAsset, bytes: built.payloads.get(readmeAsset.path) }), true);
assert.equal(validator({ asset: { path: "README.md" }, bytes: built.payloads.get(readmeAsset.path) }), true, "root-relative README is accepted");
const jsonAsset = built.manifest.assets.find((asset) => asset.path.endsWith(".json"));
assert.ok(jsonAsset);
assert.equal(validator({ bytes: new TextEncoder().encode('{"ok":true}') }), true, "bytes-only JSON fixture remains supported");
assert.equal(validator({ asset: jsonAsset, bytes: new TextEncoder().encode("{not json") }), false);
assert.equal(validator({ asset: jsonAsset, bytes: new TextEncoder().encode("[]") }), false);
assert.equal(validator({ asset: jsonAsset, bytes: new TextEncoder().encode('{"nested":{"api_key":"secret"}}') }), false);
assert.equal(validator({ asset: readmeAsset, bytes: new Uint8Array([0xff]) }), false);

const enrollment = derivePublicPlaneEnrollment(FAMILIES);
assert.equal(enrollment.exact.some(([, family]) => family === FAMILY_NAME), false);
assert.equal(enrollment.prefixes.some(({ family }) => family === FAMILY_NAME), false);
assert.equal(FAMILY.reader_enrollment, false);
assert.ok(FAMILY.plan.class_a >= MEASURED_ASSETS * 2, "class-A plan must be >=2x measured assets");
// The read model itself is the invariant, not the number it currently produces.
assert.equal(MEASURED_CLASS_B_READS, (MEASURED_ASSETS + 1) * 3 + 1, "all-changed read model is presence + readback + parity + resume");
assert.ok(FAMILY.plan.class_b >= MEASURED_CLASS_B_READS * 2, "class-B plan must be >=2x measured reads");
assert.ok(FAMILY.plan.bytes >= MEASURED_BYTES * 2, "byte plan must be >=2x measured bytes");

const dryRunLines = [];
const dryRunStderr = [];
const dryRunExit = await runPublisherCli({
  argv: [`--family=${FAMILY_NAME}`, "--dry-run"],
  stdout: (line) => dryRunLines.push(JSON.parse(line)),
  stderr: (...parts) => dryRunStderr.push(parts.join(" ")),
});
assert.equal(dryRunExit, 0, dryRunStderr.join("\n"));
assert.equal(dryRunLines.length, 1);
assert.equal(dryRunLines[0].result, "dry_run");
assert.equal(dryRunLines[0].assets, MEASURED_ASSETS);
assert.equal(dryRunLines[0].total_bytes, MEASURED_BYTES);
assert.equal(dryRunLines[0].enrolled.length, MEASURED_ASSETS);
assert.equal(dryRunLines[0].enrolled[0].path, built.manifest.assets[0].path);
assert.equal(dryRunLines[0].enrolled.at(-1).path, built.manifest.assets.at(-1).path);

assert.equal(assertPublicationAuthorization().authorized, 24, "default registry authorization includes Global Scouter");
assert.throws(
  () => assertPublicationAuthorization({ families: { [FAMILY_NAME]: FAMILY }, bindings: {} }),
  /FAMILY_NOT_AUTHORIZED.*global-scouter/,
);

console.log("Global Scouter shadow publisher contract ok (scope, source clock, 1,081 JSON + README validation, reader exclusion, dry-run evidence, auth gate)");
