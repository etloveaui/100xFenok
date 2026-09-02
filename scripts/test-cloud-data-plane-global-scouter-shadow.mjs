#!/usr/bin/env node
// Focused proof for Global Scouter publication and bounded reader enrollment.
// This is intentionally offline: the dry-run uses the default registry
// admission and never constructs a Cloudflare plane.

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
// No asset-count constant. A count is the same stale fixture the byte total was:
// a legitimate universe add or removal is healthy and would fail it. The family
// boundary is its roots, its four exact exclusions and its allowed file types,
// and those are what the assertions below check.
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
// The boundary is a shape, not a number: exactly one README and every other
// included file JSON. A universe that gains or loses tickers stays inside it.
const readmeFiles = expectedFiles.filter((file) => file === "README.md");
assert.equal(readmeFiles.length, 1, `expected exactly one README in scope, got ${readmeFiles.length}`);
const nonJson = expectedFiles.filter((file) => !file.endsWith(".json") && file !== "README.md");
assert.deepEqual(nonJson, [], `scope admits only JSON plus one README; found ${nonJson.join(", ")}`);
assert.ok(MEASURED_ASSETS > 0, "scope must not be empty");
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
// Reading core/metadata.json here would be self-comparison wearing a disguise:
// that file IS the family's declared clock ({file: "core/metadata.json", key:
// "source_date"}), so the publisher and the assertion would be quoting the same
// line. An earlier attempt did exactly that and a mutation proved it - changing
// the date moved both sides and the test stayed green.
//
// The real cross-check is that the converter stamps the same export date into
// five artifacts written separately. Agreement across them is evidence; one of
// them agreeing with itself is not.
const CROSS_STAMPED = [
  "core/metadata.json",
  "core/stocks_index.json",
  "core/dashboard.json",
  "etfs/index.json",
  "indicators/economic.json",
];
const stampedDates = new Map(
  CROSS_STAMPED.map((file) => {
    const json = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/global-scouter", file), "utf8"));
    return [file, json.source_date ?? json.source_as_of ?? json.as_of ?? null];
  }),
);
for (const [file, value] of stampedDates) {
  assert.match(String(value), /^\d{4}-\d{2}-\d{2}$/, `${file} must carry an export date, got ${JSON.stringify(value)}`);
}
const distinct = new Set(stampedDates.values());
assert.equal(
  distinct.size,
  1,
  `the export date disagrees across artifacts written by the same run: ${[...stampedDates].map(([f, v]) => `${f}=${v}`).join(", ")}`,
);
const EXPECTED_SOURCE_AS_OF = [...distinct][0];
assert.equal(built.sourceAsOf.value, EXPECTED_SOURCE_AS_OF);
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
assert.deepEqual(
  enrollment.prefixes.filter(({ family }) => family === FAMILY_NAME),
  [{ prefix: "/data/global-scouter/", family: FAMILY_NAME }],
);
assert.equal(FAMILY.reader_enrollment, true);
assert.ok(FAMILY.plan.class_a >= MEASURED_ASSETS * 2, "class-A plan must be >=2x measured assets");
// The previous line here asserted MEASURED_CLASS_B_READS against the identical
// expression that defines it, which proves nothing. The real invariant is the
// plan headroom immediately below.
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

assert.equal(assertPublicationAuthorization().authorized, 25, "default registry authorization includes Global Scouter");
assert.throws(
  () => assertPublicationAuthorization({ families: { [FAMILY_NAME]: FAMILY }, bindings: {} }),
  /FAMILY_NOT_AUTHORIZED.*global-scouter/,
);

const rollbackWorkflow = fs.readFileSync(
  path.join(REPO_ROOT, ".github/workflows/global-scouter-rollback-rehearsal.yml"),
  "utf8",
);
assert.match(rollbackWorkflow, /workflow_dispatch:/);
assert.doesNotMatch(rollbackWorkflow, /(?:^|\n)\s*(?:push|schedule):/);
assert.match(rollbackWorkflow, /if: github\.event\.inputs\.confirm == 'ROLLBACK_AND_RESTORE'/);
assert.match(rollbackWorkflow, /group: global-scouter-publish/);
assert.match(rollbackWorkflow, /cancel-in-progress: false/);
assert.doesNotMatch(rollbackWorkflow, /contents: write/);
assert.equal(
  rollbackWorkflow.match(/--family=global-scouter --rollback --json/g)?.length,
  2,
  "the rehearsal must roll back once and restore with the same validated operation",
);
assert.match(rollbackWorkflow, /if: \$\{\{ always\(\) && steps\.rollback\.outcome == 'success' \}\}/);
assert.match(rollbackWorkflow, /result\.active_generation_after !== process\.argv\[3\]/);
assert.match(rollbackWorkflow, /steps\.restore\.outcome == 'success'/);
assert.match(rollbackWorkflow, /x-data-plane-generation/);

console.log("Global Scouter publisher/reader contract ok (dynamic scope, cross-stamped source clock, bounded prefix enrollment, dry-run evidence, auth gate, live rollback-and-restore entry)");
