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
const MEASURED_ASSETS = 1_082;
const MEASURED_BYTES = 87_268_011;
const MEASURED_CLASS_B_READS = (MEASURED_ASSETS + 1) * 3 + 1;
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
assert.deepEqual(scope.manifest.totals, { file_count: MEASURED_ASSETS, bytes: MEASURED_BYTES });
const expectedFiles = independentScopeFiles(scope);
assert.equal(expectedFiles.length, MEASURED_ASSETS);
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
assert.equal(built.sourceAsOf.value, "2026-08-14");
assert.equal(built.sourceAsOf.origin, "family-index");
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
assert.ok(built.manifest.assets.every((asset) => asset.source_as_of === "2026-08-14"));

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
assert.equal(MEASURED_CLASS_B_READS, 3_250, "all-changed read model is presence + readback + parity + resume");
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
