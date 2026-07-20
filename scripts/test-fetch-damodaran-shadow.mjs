#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as DamodaranProducer from "./fetch-damodaran-shadow.mjs";
import { buildLaneCommitManifest } from "./build-lane-commit-manifest.mjs";
import { LANE_REGISTRY, registryLaneById } from "./lib/lane-registry.mjs";
import {
  FILE_NAMES,
  comparePayloads,
  firstDivergentPaths,
  normalizePayload,
} from "./fetch-damodaran-shadow.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fixture() {
  return {
    metadata: {
      schema_version: "2.0.0",
      generated_at: "2026-07-19T00:00:00Z",
      source_date: "January 2026",
    },
    industries: {
      Software: {
        beta: { levered: 1.25 },
        margins: { net: 0.18 },
      },
    },
  };
}

{
  const committed = fixture();
  const fresh = structuredClone(committed);
  fresh.metadata.generated_at = "2026-07-19T01:02:03Z";

  assert.deepStrictEqual(normalizePayload(fresh), normalizePayload(committed));
  assert.deepStrictEqual(comparePayloads(fresh, committed), {
    status: "match",
    first_divergent_paths: [],
  });
}

{
  const committed = fixture();
  const fresh = structuredClone(committed);
  fresh.industries.Software.beta.levered = 1.26;

  assert.notDeepStrictEqual(normalizePayload(fresh), normalizePayload(committed));
  assert.deepStrictEqual(comparePayloads(fresh, committed), {
    status: "mismatch",
    first_divergent_paths: ["/industries/Software/beta/levered"],
  });
  assert.deepStrictEqual(
    firstDivergentPaths(normalizePayload(fresh), normalizePayload(committed), 5),
    ["/industries/Software/beta/levered"],
  );
}

function ownerBundle() {
  return {
    fetched_at: "2026-07-20T00:00:00Z",
    conditional_get: { used: false, reason: "fixture" },
    errors: {},
    payloads: Object.fromEntries(FILE_NAMES.map((file, index) => [
      file,
      {
        metadata: { generated_at: "2026-07-20T00:00:00Z", source_date: "fixture" },
        file,
        value: index + 1,
      },
    ])),
    sources: Object.fromEntries(FILE_NAMES.map((file) => [file, [{ url: `https://example.invalid/${file}` }]])),
  };
}

{
  assert.equal(typeof DamodaranProducer.guardProducedFiles, "function", "owner guard must be exported");
  assert.equal(typeof DamodaranProducer.promoteProducedFiles, "function", "guarded promotion must be exported");
  assert.equal(DamodaranProducer.SCHEMA_VERSION, "damodaran-owner-guard/v1");

  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "damodaran-owner-test-"));
  const producedRoot = path.join(fixtureRoot, "produced");
  const canonicalRoot = path.join(fixtureRoot, "canonical");
  fs.mkdirSync(producedRoot, { recursive: true });
  fs.mkdirSync(canonicalRoot, { recursive: true });
  const bundle = ownerBundle();
  for (const file of FILE_NAMES) {
    fs.writeFileSync(path.join(producedRoot, file), `${JSON.stringify(bundle.payloads[file], null, 2)}\n`);
  }

  const guard = DamodaranProducer.guardProducedFiles(bundle, producedRoot);
  assert.equal(guard.status, "match");
  assert.deepStrictEqual(guard.summary, { match: 6, mismatch: 0, blocked: 0 });
  DamodaranProducer.promoteProducedFiles({ bundle, producedRoot, canonicalRoot });
  for (const file of FILE_NAMES) {
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(path.join(canonicalRoot, file), "utf8")),
      bundle.payloads[file],
      `${file} must be promoted exactly`,
    );
  }

  const firstFile = FILE_NAMES[0];
  fs.writeFileSync(path.join(canonicalRoot, firstFile), '{"sentinel":"keep"}\n');
  fs.writeFileSync(
    path.join(producedRoot, firstFile),
    `${JSON.stringify({ ...bundle.payloads[firstFile], value: 999 }, null, 2)}\n`,
  );
  const mismatch = DamodaranProducer.guardProducedFiles(bundle, producedRoot);
  assert.equal(mismatch.status, "mismatch");
  assert.deepStrictEqual(mismatch.files[0].first_divergent_paths, ["/value"]);
  assert.throws(
    () => DamodaranProducer.promoteProducedFiles({ bundle, producedRoot, canonicalRoot }),
    /owner guard failed/,
  );
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(path.join(canonicalRoot, firstFile), "utf8")),
    { sentinel: "keep" },
    "failed guard must not mutate canonical data",
  );

  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

{
  const workflowPath = path.join(REPO_ROOT, ".github", "workflows", "fetch-damodaran-shadow.yml");
  const workflow = fs.readFileSync(workflowPath, "utf8");

  assert.match(workflow, /name:\s*Fetch Damodaran Data/);
  assert.match(workflow, /DAMODARAN_SHADOW_REPORT:\s*data\/admin\/damodaran\/owner-guard\.json/);
  assert.match(workflow, /cron:\s*['"]17 11 \* \* 6['"]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /node scripts\/test-fetch-damodaran-shadow\.mjs/);
  assert.match(workflow, /node scripts\/fetch-damodaran-shadow\.mjs/);
  assert.match(workflow, /uses:\s*actions\/upload-artifact@v4/);
  assert.match(workflow, /if:\s*\$\{\{ always\(\) \}\}[\s\S]+damodaran-owner-guard/);
  assert.match(workflow, /for file in industries\.json historical_erp\.json credit_ratings\.json erp\.json industry_metrics\.json industry_metrics_regions\.json/);
  assert.match(workflow, /rsync -a --checksum "data\/damodaran\/\$file" "100xfenok-next\/public\/data\/damodaran\/\$file"/);
  assert.match(workflow, /cmp -s "data\/damodaran\/\$file" "100xfenok-next\/public\/data\/damodaran\/\$file"/);
  assert.doesNotMatch(workflow, /rsync[^\n]+--delete[^\n]+data\/damodaran\//);
  assert.match(
    workflow,
    /scripts\/stage-lane-manifest\.sh[\s\\]+--workflow \.github\/workflows\/fetch-damodaran-shadow\.yml[\s\\]+--stage required_on_success/,
  );
  assert.doesNotMatch(workflow, /continue-on-error:/);
  assert.doesNotMatch(workflow, /git add/);
  assert.match(workflow, /PUBLISHED=false/);
  assert.match(workflow, /PUBLISHED=true/);
  assert.match(workflow, /if \[\[ "\$PUBLISHED" != "true" \]\]; then\s+exit 1\s+fi/);
}

{
  const lane = registryLaneById("damodaran");
  assert.ok(lane, "Damodaran must be a registry lane after the ownership flip");
  assert.equal(lane.owner_workflow, ".github/workflows/fetch-damodaran-shadow.yml");
  assert.equal(lane.privacy_class, "public_mirror");
  assert.equal(lane.lane_class, "auxiliary");
  assert.deepStrictEqual(lane.roots.canonical_outputs, DamodaranProducer.CANONICAL_RELATIVE_PATHS);
  assert.deepStrictEqual(lane.roots.public_mirror, DamodaranProducer.PUBLIC_MIRROR_RELATIVE_PATHS);

  const manifest = buildLaneCommitManifest(LANE_REGISTRY);
  const policy = manifest.workflows[".github/workflows/fetch-damodaran-shadow.yml"];
  assert.deepStrictEqual(policy.lanes, ["damodaran"]);
  assert.deepStrictEqual(policy.stages.always_if_exists, []);
  assert.deepStrictEqual(policy.stages.success_if_exists, []);
  assert.deepStrictEqual(policy.stages.required_on_success, [
    { path: "data/admin/damodaran/owner-guard.json", kind: "file", required: true },
    ...FILE_NAMES.flatMap((file) => [
      { path: `data/damodaran/${file}`, kind: "file", required: true },
      { path: `100xfenok-next/public/data/damodaran/${file}`, kind: "file", required: true },
    ]),
  ]);
}

console.log("damodaran owner guard and workflow contract tests passed");
