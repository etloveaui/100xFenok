#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as DamodaranProducer from "./fetch-damodaran-shadow.mjs";
import { validateAttemptShard } from "./build-data-supply-detection-floor.mjs";
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

function spawnFixture({
  status = 0,
  mismatch = false,
  noBundle = false,
  error = null,
  throws = null,
} = {}) {
  return (_command, args) => {
    if (throws) throw throws;
    const outputDir = args[args.indexOf("--output-dir") + 1];
    const bundlePath = args[args.indexOf("--bundle") + 1];
    if (!noBundle) {
      const bundle = ownerBundle();
      fs.mkdirSync(outputDir, { recursive: true });
      for (const [index, file] of FILE_NAMES.entries()) {
        const payload = mismatch && index === 0
          ? { ...bundle.payloads[file], value: 999 }
          : bundle.payloads[file];
        fs.writeFileSync(path.join(outputDir, file), `${JSON.stringify(payload, null, 2)}\n`);
      }
      fs.writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
    }
    return { status, signal: null, stderr: "", error };
  };
}

function runFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "damodaran-run-test-"));
  const reportPath = path.join(root, "owner-guard.json");
  const attemptShardPath = path.join(root, "damodaran.json");
  const canonicalRoot = path.join(root, "canonical");
  let tick = 0;
  const run = () => DamodaranProducer.runDamodaranShadow({
    reportPath,
    attemptShardPath,
    canonicalRoot,
    spawn: spawnFixture(options),
    observedAt: "2026-07-27T01:02:03Z",
    attemptId: "damodaran-fixture-attempt",
    now: () => 1_000 + tick++ * 250,
  });
  return { root, reportPath, attemptShardPath, canonicalRoot, run };
}

{
  assert.equal(typeof DamodaranProducer.guardProducedFiles, "function", "owner guard must be exported");
  assert.equal(typeof DamodaranProducer.promoteProducedFiles, "function", "guarded promotion must be exported");
  assert.equal(typeof DamodaranProducer.runDamodaranShadow, "function", "attempt-writing runner must be exported");
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
  const fixtureRun = runFixture();
  const result = fixtureRun.run();
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.status, "match");
  assert.deepStrictEqual(result.row.assertions, [{ id: "owner_guard_match", passed: true }]);
  assert.equal(result.row.execution, "returned");
  assert.equal(result.row.outcome, "success");
  assert.equal(result.row.candidates, 6);
  assert.equal(result.row.latency_ms, 250);
  assert.equal(
    fs.readFileSync(fixtureRun.reportPath, "utf8"),
    `${JSON.stringify(result.report, null, 2)}\n`,
    "attempt evidence must not change owner-guard serialization",
  );
  const shard = JSON.parse(fs.readFileSync(fixtureRun.attemptShardPath, "utf8"));
  assert.equal(validateAttemptShard(shard, "damodaran"), true);
  fs.rmSync(fixtureRun.root, { recursive: true, force: true });
}

{
  const fixtureRun = runFixture({ mismatch: true });
  fs.mkdirSync(fixtureRun.canonicalRoot, { recursive: true });
  fs.writeFileSync(path.join(fixtureRun.canonicalRoot, FILE_NAMES[0]), '{"sentinel":"keep"}\n');
  const result = fixtureRun.run();
  assert.equal(result.exitCode, 2);
  assert.equal(result.report.status, "mismatch");
  assert.deepStrictEqual(result.row.assertions, [{ id: "owner_guard_match", passed: false }]);
  assert.equal(result.row.outcome, "success");
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(path.join(fixtureRun.canonicalRoot, FILE_NAMES[0]), "utf8")),
    { sentinel: "keep" },
  );
  fs.rmSync(fixtureRun.root, { recursive: true, force: true });
}

{
  const fixtureRun = runFixture({ status: 1, noBundle: true });
  const result = fixtureRun.run();
  assert.equal(result.exitCode, 1);
  assert.equal(result.row.execution, "returned");
  assert.equal(result.row.outcome, "error");
  assert.equal(Object.hasOwn(result.row, "failure_entity"), false);
  assert.equal(Object.hasOwn(result.row, "failure_detail"), false);
  fs.rmSync(fixtureRun.root, { recursive: true, force: true });
}

{
  const fixtureRun = runFixture({
    status: null,
    noBundle: true,
    error: new Error("converter spawn failed at https://example.invalid/private?token=secret"),
  });
  const result = fixtureRun.run();
  assert.equal(result.exitCode, 1);
  assert.equal(result.row.execution, "threw");
  assert.equal(result.row.exception_kind, "unexpected");
  assert.equal(result.row.failure_entity, "damodaran_converter");
  assert.match(result.row.failure_detail, /^Error:/);
  assert.equal(result.row.failure_detail.includes("secret"), false);
  fs.rmSync(fixtureRun.root, { recursive: true, force: true });
}

{
  const fixtureRun = runFixture({ throws: new Error("owner guard exploded") });
  assert.throws(fixtureRun.run, /owner guard exploded/);
  const shard = JSON.parse(fs.readFileSync(fixtureRun.attemptShardPath, "utf8"));
  assert.equal(validateAttemptShard(shard, "damodaran"), true);
  assert.equal(shard.attempts[0].execution, "threw");
  assert.equal(shard.attempts[0].failure_entity, "damodaran_owner_guard");
  fs.rmSync(fixtureRun.root, { recursive: true, force: true });
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
    /scripts\/stage-lane-manifest\.sh[\s\\]+--workflow \.github\/workflows\/fetch-damodaran-shadow\.yml[\s\\]+--stage always_if_exists/,
  );
  assert.match(
    workflow,
    /scripts\/stage-lane-manifest\.sh[\s\\]+--workflow \.github\/workflows\/fetch-damodaran-shadow\.yml[\s\\]+--stage required_on_success/,
  );
  assert.match(workflow, /id:\s*fetch/);
  assert.match(workflow, /id:\s*mirror/);
  assert.match(workflow, /FETCH_OUTCOME:\s*\$\{\{ steps\.fetch\.outcome \}\}/);
  assert.match(workflow, /MIRROR_OUTCOME:\s*\$\{\{ steps\.mirror\.outcome \}\}/);
  assert.match(
    workflow,
    /if \[\[ "\$FETCH_OUTCOME" == "success" && "\$MIRROR_OUTCOME" == "success" \]\]; then[\s\S]+--stage required_on_success/,
  );
  assert.match(workflow, /if:\s*\$\{\{ always\(\) \}\}[\s\S]+--stage always_if_exists/);
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
  assert.equal(lane.lane_class, "detection_floor");
  assert.equal(lane.enforcement, "shadow");
  assert.deepStrictEqual(lane.cadence.provenance, {
    kind: "github_workflow",
    evidence: ".github/workflows/fetch-damodaran-shadow.yml",
  });
  assert.deepStrictEqual(lane.roots.canonical_outputs, DamodaranProducer.CANONICAL_RELATIVE_PATHS);
  assert.deepStrictEqual(lane.roots.public_mirror, DamodaranProducer.PUBLIC_MIRROR_RELATIVE_PATHS);
  assert.equal(
    lane.roots.detection_attempt,
    "data/admin/data-supply-state/detection-attempts/damodaran.json",
  );
  assert.equal(lane.commit_shards.includes(lane.roots.detection_attempt), true);

  const manifest = buildLaneCommitManifest(LANE_REGISTRY);
  const policy = manifest.workflows[".github/workflows/fetch-damodaran-shadow.yml"];
  assert.deepStrictEqual(policy.lanes, ["damodaran"]);
  assert.deepStrictEqual(policy.stages.always_if_exists, [{
    path: "data/admin/data-supply-state/detection-attempts/damodaran.json",
    kind: "file",
    required: false,
  }]);
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
