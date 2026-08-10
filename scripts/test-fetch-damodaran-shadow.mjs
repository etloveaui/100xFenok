#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as DamodaranProducer from "./fetch-damodaran-shadow.mjs";
import { classifyAttempt, validateAttemptShard } from "./build-data-supply-detection-floor.mjs";
import { buildLaneCommitManifest } from "./build-lane-commit-manifest.mjs";
import { LaneLkgStore } from "./lib/data-supply-lkg-store.mjs";
import { LANE_REGISTRY, registryLaneById } from "./lib/lane-registry.mjs";
import {
  DAMODARAN_HISTORY_LIMIT,
  DAMODARAN_PERSISTENCE_POLICY,
  FILE_NAMES,
  appendDamodaranHistory,
  buildDamodaranBundle,
  comparePayloads,
  evaluateDamodaranProviderProgress,
  firstDivergentPaths,
  normalizePayload,
  validDamodaranBundle,
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

function ownerBundle(sourceDate = "January 2026", sourceDatesByFile = {}) {
  return {
    fetched_at: "2026-07-20T00:00:00Z",
    conditional_get: { used: false, reason: "fixture" },
    errors: {},
    payloads: Object.fromEntries(FILE_NAMES.map((file, index) => [
      file,
      {
        metadata: {
          generated_at: "2026-07-20T00:00:00Z",
          source_date: sourceDatesByFile[file] ?? sourceDate,
        },
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
  sourceDate = "January 2026",
  sourceDatesByFile = {},
} = {}) {
  return (_command, args) => {
    if (throws) throw throws;
    const outputDir = args[args.indexOf("--output-dir") + 1];
    const bundlePath = args[args.indexOf("--bundle") + 1];
    if (!noBundle) {
      const bundle = ownerBundle(sourceDate, sourceDatesByFile);
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
    repoRoot: root,
    reportPath,
    attemptShardPath,
    canonicalRoot,
    spawn: spawnFixture(options),
    observedAt: "2026-07-27T01:02:03Z",
    attemptId: "damodaran-fixture-attempt",
    runId: "damodaran-fixture-attempt",
    eventName: "schedule",
    now: () => 1_000 + tick++ * 250,
  });
  return { root, reportPath, attemptShardPath, canonicalRoot, run };
}

{
  assert.equal(typeof DamodaranProducer.guardProducedFiles, "function", "owner guard must be exported");
  assert.equal(typeof DamodaranProducer.promoteProducedFiles, "function", "guarded promotion must be exported");
  assert.equal(typeof DamodaranProducer.runDamodaranShadow, "function", "attempt-writing runner must be exported");
  assert.equal(DamodaranProducer.SCHEMA_VERSION, "damodaran-owner-guard/v1");
  assert.equal(DAMODARAN_HISTORY_LIMIT, 52);
  assert.deepStrictEqual(DAMODARAN_PERSISTENCE_POLICY, {
    schema_version: "damodaran-bounded-persistence/v1",
    basis: "successful_provider_bundle",
    max_bundle_observations: 52,
    eviction: "oldest_provider_bundle_first",
  });

  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "damodaran-owner-test-"));
  const producedRoot = path.join(fixtureRoot, "produced");
  const canonicalRoot = path.join(fixtureRoot, "canonical");
  fs.mkdirSync(producedRoot, { recursive: true });
  fs.mkdirSync(canonicalRoot, { recursive: true });
  const bundle = ownerBundle();
  const currentBundle = buildDamodaranBundle(bundle.payloads);
  assert.equal(currentBundle.source_as_of, "2026-01-01");
  assert.equal(validDamodaranBundle(currentBundle), true);
  const oneFileAdvancedPayloads = structuredClone(bundle.payloads);
  oneFileAdvancedPayloads[FILE_NAMES[0]].metadata.source_date = "February 2026";
  assert.deepStrictEqual(
    evaluateDamodaranProviderProgress(
      currentBundle,
      buildDamodaranBundle(oneFileAdvancedPayloads),
    ),
    {
      eligible: true,
      reason: "ok",
      regressed_files: [],
      advanced_files: [FILE_NAMES[0]],
    },
  );
  assert.equal(
    evaluateDamodaranProviderProgress(currentBundle, currentBundle).reason,
    "recovery_not_advanced_by_provider",
  );
  const mixedRegressionPayloads = structuredClone(oneFileAdvancedPayloads);
  mixedRegressionPayloads[FILE_NAMES[1]].metadata.source_date = "December 2025";
  const mixedRegression = evaluateDamodaranProviderProgress(
    currentBundle,
    buildDamodaranBundle(mixedRegressionPayloads),
  );
  assert.equal(mixedRegression.eligible, false);
  assert.deepStrictEqual(mixedRegression.regressed_files, [FILE_NAMES[1]]);
  assert.deepStrictEqual(mixedRegression.advanced_files, [FILE_NAMES[0]]);
  const history = appendDamodaranHistory([], currentBundle, {
    runId: "history-fixture",
    runAttempt: 1,
    eventName: "schedule",
    observedAt: "2026-07-20T00:00:00Z",
  });
  assert.equal(history.observations.length, 1);
  assert.deepStrictEqual(
    appendDamodaranHistory(history.observations, currentBundle, {
      runId: "history-fixture",
      runAttempt: 1,
      eventName: "schedule",
      observedAt: "2026-07-20T00:00:00Z",
    }).observations,
    history.observations,
  );
  let boundedHistory = { observations: [] };
  for (let index = 0; index < DAMODARAN_HISTORY_LIMIT + 1; index += 1) {
    const datedPayloads = structuredClone(bundle.payloads);
    const sourceDate = new Date(Date.UTC(2022, index, 1)).toLocaleString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    for (const file of FILE_NAMES) datedPayloads[file].metadata.source_date = sourceDate;
    boundedHistory = appendDamodaranHistory(
      boundedHistory.observations,
      buildDamodaranBundle(datedPayloads),
      {
        runId: `history-${index}`,
        runAttempt: 1,
        eventName: "schedule",
        observedAt: new Date(Date.UTC(2022, index, 2)).toISOString(),
      },
    );
  }
  assert.equal(boundedHistory.observations.length, DAMODARAN_HISTORY_LIMIT);
  assert.equal(boundedHistory.persistence_state.pruned_bundle_observations, 1);
  assert.equal(boundedHistory.observations[0].source_as_of, "2022-02-01");
  const lateObservedOldPayloads = structuredClone(bundle.payloads);
  for (const file of FILE_NAMES) lateObservedOldPayloads[file].metadata.source_date = "January 2021";
  const afterLateObservedOldSource = appendDamodaranHistory(
    boundedHistory.observations,
    buildDamodaranBundle(lateObservedOldPayloads),
    {
      runId: "history-late-observed-old-source",
      runAttempt: 1,
      eventName: "schedule",
      observedAt: "2030-01-01T00:00:00.000Z",
    },
  );
  assert.equal(afterLateObservedOldSource.observations.length, DAMODARAN_HISTORY_LIMIT);
  assert.equal(
    afterLateObservedOldSource.observations.some((item) => item.source_as_of === "2021-01-01"),
    false,
    "retention must evict by provider source_as_of, not by late observed_at",
  );
  assert.equal(afterLateObservedOldSource.observations[0].source_as_of, "2022-02-01");
  assert.throws(
    () => appendDamodaranHistory([{ source_as_of: "fetch-day" }], currentBundle, {
      runId: "invalid-history",
      runAttempt: 1,
      eventName: "schedule",
      observedAt: "2026-07-20T00:00:00Z",
    }),
    /history contract/,
  );
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
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(path.join(fixtureRun.root, "data", "admin", "damodaran", "index.json"), "utf8")).retry_set,
    [],
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(fixtureRun.root, "data", "admin", "damodaran", "history.json"), "utf8")).observations.length,
    1,
  );
  fs.rmSync(fixtureRun.root, { recursive: true, force: true });
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "damodaran-state-write-rollback-"));
  const common = {
    repoRoot: root,
    reportPath: path.join(root, "data", "admin", "damodaran", "owner-guard.json"),
    attemptShardPath: path.join(root, "attempt.json"),
    canonicalRoot: path.join(root, "data", "damodaran"),
    now: () => 1_000,
  };
  const baseline = DamodaranProducer.runDamodaranShadow({
    ...common,
    spawn: spawnFixture(),
    observedAt: "2026-07-20T00:00:00Z",
    attemptId: "gh-710-1-damodaran",
    runId: "710",
    eventName: "schedule",
  });
  assert.equal(baseline.exitCode, 0);
  const rolledBackPaths = [
    ...FILE_NAMES.map((file) => path.join(common.canonicalRoot, file)),
    path.join(root, "data", "admin", "damodaran", "current", "damodaran.json"),
    path.join(root, "data", "admin", "damodaran", "history.json"),
  ];
  const before = new Map(rolledBackPaths.map((filePath) => [filePath, fs.readFileSync(filePath)]));
  const failed = DamodaranProducer.runDamodaranShadow({
    ...common,
    spawn: spawnFixture({ sourceDate: "February 2026" }),
    observedAt: "2026-07-27T00:00:00Z",
    attemptId: "gh-711-1-damodaran",
    runId: "711",
    eventName: "schedule",
    lkgStoreFactory: ({ repoRoot, laneId }) => {
      const store = new LaneLkgStore({ repoRoot, laneId });
      const recordSuccess = store.recordSuccess.bind(store);
      store.recordSuccess = (input) => {
        recordSuccess(input);
        throw new Error("injected recovery state write failure");
      };
      return store;
    },
  });
  assert.equal(failed.exitCode, 2);
  assert.equal(failed.recovery.reason, "unexpected_error");
  assert.equal(failed.recovery.degraded, false);
  assert.equal(failed.recovery.corrupt, true);
  assert.equal(failed.report.status, "blocked");
  assert.deepEqual(classifyAttempt(failed.row), {
    status: "unavailable",
    reason: "unexpected_error",
    observed_at: "2026-07-27T00:00:00Z",
  });
  for (const filePath of rolledBackPaths) {
    assert.deepEqual(
      fs.readFileSync(filePath),
      before.get(filePath),
      `${path.relative(root, filePath)} must roll back byte-for-byte after state-write failure`,
    );
  }
  const failedState = JSON.parse(fs.readFileSync(
    path.join(root, "data", "admin", "damodaran", "index.json"),
    "utf8",
  ));
  assert.deepEqual(failedState.retry_set, ["damodaran"]);
  assert.equal(failedState.items.damodaran.resolution_state, "lkg_primary");
  assert.equal(failedState.items.damodaran.retry, true);
  assert.deepEqual(failedState.items.damodaran.latest_failure, {
    run_id: "711",
    run_attempt: 1,
    observed_at: "2026-07-27T00:00:00Z",
    reason: "unexpected_error",
  });
  fs.rmSync(root, { recursive: true, force: true });
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
  assert.equal(result.exitCode, 2);
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
  assert.equal(result.exitCode, 2);
  assert.equal(result.row.execution, "threw");
  assert.equal(result.row.exception_kind, "unexpected");
  assert.equal(result.row.failure_entity, "damodaran_converter");
  assert.match(result.row.failure_detail, /^Error:/);
  assert.equal(result.row.failure_detail.includes("secret"), false);
  fs.rmSync(fixtureRun.root, { recursive: true, force: true });
}

{
  const fixtureRun = runFixture({ throws: new Error("owner guard exploded") });
  const malformedCurrentPath = path.join(
    fixtureRun.root,
    "data",
    "admin",
    "damodaran",
    "current",
    "damodaran.json",
  );
  fs.mkdirSync(path.dirname(malformedCurrentPath), { recursive: true });
  fs.writeFileSync(malformedCurrentPath, "malformed canonical\n");
  assert.throws(fixtureRun.run, /owner guard exploded/);
  const shard = JSON.parse(fs.readFileSync(fixtureRun.attemptShardPath, "utf8"));
  assert.equal(validateAttemptShard(shard, "damodaran"), true);
  assert.equal(shard.attempts[0].execution, "threw");
  assert.equal(shard.attempts[0].failure_entity, "damodaran_owner_guard");
  assert.deepEqual(classifyAttempt(shard.attempts[0]), {
    status: "unavailable",
    reason: "unexpected_error",
    observed_at: "2026-07-27T01:02:03Z",
  });
  const state = JSON.parse(fs.readFileSync(
    path.join(fixtureRun.root, "data", "admin", "damodaran", "index.json"),
    "utf8",
  ));
  assert.deepEqual(state.retry_set, ["damodaran"]);
  assert.equal(state.items.damodaran.resolution_state, "unavailable");
  assert.equal(state.items.damodaran.retry, true);
  assert.equal(state.items.damodaran.lkg ?? null, null);
  assert.deepEqual(state.items.damodaran.latest_failure, {
    run_id: "damodaran-fixture-attempt",
    run_attempt: 1,
    observed_at: "2026-07-27T01:02:03Z",
    reason: "unexpected_error",
  });
  assert.equal(fs.readFileSync(malformedCurrentPath, "utf8"), "malformed canonical\n");
  fs.rmSync(fixtureRun.root, { recursive: true, force: true });
}

{
  const workflowPath = path.join(REPO_ROOT, ".github", "workflows", "fetch-damodaran-shadow.yml");
  const workflow = fs.readFileSync(workflowPath, "utf8");

  assert.match(workflow, /name:\s*Fetch Damodaran Data/);
  assert.match(workflow, /DAMODARAN_SHADOW_REPORT:\s*data\/admin\/damodaran\/owner-guard\.json/);
  assert.match(workflow, /cron:\s*['"]17 11 \* \* 6['"]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /controlled_failure:/);
  assert.match(workflow, /INPUT_CONTROLLED_FAILURE:/);
  assert.match(workflow, /node scripts\/test-fetch-damodaran-shadow\.mjs/);
  assert.match(workflow, /node scripts\/fetch-damodaran-shadow\.mjs/);
  assert.match(workflow, /uses:\s*actions\/upload-artifact@v4/);
  assert.match(workflow, /if:\s*\$\{\{ always\(\) \}\}[\s\S]+damodaran-owner-guard/);
  // Post-slice-2 contract (#377): the lane no longer mirrors to the public
  // mirror — canonical staging + plane publish only.
  assert.doesNotMatch(workflow, /rsync[^\n]*100xfenok-next\/public\/data/);
  assert.doesNotMatch(workflow, /cmp -s "data\/damodaran\/\$file" "100xfenok-next\/public\/data\/damodaran\/\$file"/);
  assert.match(workflow, /publish-cloud-data-generation\.mjs --family=damodaran/);
  assert.match(
    workflow,
    /scripts\/stage-lane-manifest\.sh[\s\\]+--workflow \.github\/workflows\/fetch-damodaran-shadow\.yml[\s\\]+--stage always_if_exists/,
  );
  assert.match(
    workflow,
    /scripts\/stage-lane-manifest\.sh[\s\\]+--workflow \.github\/workflows\/fetch-damodaran-shadow\.yml[\s\\]+--stage required_on_success/,
  );
  assert.match(workflow, /id:\s*fetch/);
  assert.doesNotMatch(workflow, /id:\s*mirror/);
  assert.match(workflow, /FETCH_OUTCOME:\s*\$\{\{ steps\.fetch\.outcome \}\}/);
  assert.match(
    workflow,
    /if \[\[ "\$FETCH_OUTCOME" == "success" \]\]; then[\s\S]+--stage required_on_success/,
  );
  assert.match(workflow, /if:\s*\$\{\{ always\(\) \}\}[\s\S]+--stage always_if_exists/);
  // continue-on-error is allowed ONLY on the plane publish step (non-blocking
  // by design, matching the pilot pattern); nowhere else.
  assert.equal((workflow.match(/continue-on-error:/g) ?? []).length, 1);
  assert.match(workflow, /- name: Publish damodaran generation[\s\S]+continue-on-error: true/);
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
  assert.equal(lane.enforcement, "live");
  assert.deepStrictEqual(lane.cadence.provenance, {
    kind: "github_workflow",
    evidence: ".github/workflows/fetch-damodaran-shadow.yml",
  });
  assert.deepStrictEqual(lane.roots.canonical_outputs, DamodaranProducer.CANONICAL_RELATIVE_PATHS);
  // Post-slice-2 contract (#377): the public mirror is boundary-owned (full sync),
  // not lane-owned — public_mirror is empty; sync coverage is guaranteed by the
  // standing coverage gate (check-public-mirror-coverage.mjs).
  assert.deepStrictEqual(lane.roots.public_mirror, []);
  assert.equal(
    lane.roots.detection_attempt,
    "data/admin/data-supply-state/detection-attempts/damodaran.json",
  );
  assert.equal(lane.commit_shards.includes(lane.roots.detection_attempt), true);

  const manifest = buildLaneCommitManifest(LANE_REGISTRY);
  const policy = manifest.workflows[".github/workflows/fetch-damodaran-shadow.yml"];
  assert.deepStrictEqual(policy.lanes, ["damodaran"]);
  assert.deepStrictEqual(policy.stages.always_if_exists, [
    {
      path: "data/admin/data-supply-state/detection-attempts/damodaran.json",
      kind: "file",
      required: false,
    },
    { path: "data/admin/damodaran/index.json", kind: "file", required: false },
    { path: "data/admin/damodaran/current/damodaran.json", kind: "file", required: false },
    { path: "data/admin/damodaran/lkg/damodaran.json", kind: "file", required: false },
    { path: "data/admin/damodaran/history.json", kind: "file", required: false },
  ]);
  assert.deepStrictEqual(policy.stages.success_if_exists, []);
  assert.deepStrictEqual(policy.stages.required_on_success, [
    { path: "data/admin/damodaran/owner-guard.json", kind: "file", required: true },
    ...FILE_NAMES.map((file) => ({ path: `data/damodaran/${file}`, kind: "file", required: true })),
  ]);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "damodaran-recovery-test-"));
  const common = {
    repoRoot: root,
    reportPath: path.join(root, "data", "admin", "damodaran", "owner-guard.json"),
    attemptShardPath: path.join(root, "attempt.json"),
    canonicalRoot: path.join(root, "data", "damodaran"),
    now: () => 1_000,
  };
  const baseline = DamodaranProducer.runDamodaranShadow({
    ...common,
    spawn: spawnFixture(),
    observedAt: "2026-07-20T00:00:00Z",
    attemptId: "gh-700-1-damodaran",
    runId: "700",
    eventName: "schedule",
  });
  assert.equal(baseline.exitCode, 0);

  const failed = DamodaranProducer.runDamodaranShadow({
    ...common,
    spawn: () => { throw new Error("controlled failure must bypass spawn"); },
    observedAt: "2026-07-21T00:00:00Z",
    attemptId: "gh-701-1-damodaran",
    runId: "701",
    eventName: "workflow_dispatch",
    controlledFailure: true,
  });
  assert.equal(failed.exitCode, 0);
  assert.equal(failed.recovery.degraded, true);
  assert.deepStrictEqual(failed.recovery.retrySet, ["damodaran"]);
  const retainedBytes = fs.readFileSync(
    path.join(root, "data", "admin", "damodaran", "current", "damodaran.json"),
  );

  const mixedCadence = DamodaranProducer.runDamodaranShadow({
    ...common,
    spawn: spawnFixture({
      sourceDatesByFile: {
        [FILE_NAMES[0]]: "February 2026",
        [FILE_NAMES[1]]: "December 2025",
      },
    }),
    observedAt: "2026-07-21T00:30:00Z",
    attemptId: "gh-7015-1-damodaran",
    runId: "7015",
    eventName: "schedule",
  });
  assert.equal(mixedCadence.exitCode, 0);
  assert.equal(mixedCadence.recovery.reason, "recovery_provider_regression");
  assert.deepStrictEqual(
    fs.readFileSync(path.join(root, "data", "admin", "damodaran", "current", "damodaran.json")),
    retainedBytes,
    "one advancing file must not mask another Damodaran file regression",
  );
  assert.deepStrictEqual(mixedCadence.recovery.retrySet, ["damodaran"]);

  const manual = DamodaranProducer.runDamodaranShadow({
    ...common,
    spawn: spawnFixture({ sourceDate: "February 2026" }),
    observedAt: "2026-07-21T01:00:00Z",
    attemptId: "gh-702-1-damodaran",
    runId: "702",
    eventName: "workflow_dispatch",
  });
  assert.equal(manual.recovery.reason, "recovery_requires_schedule");

  const recovered = DamodaranProducer.runDamodaranShadow({
    ...common,
    spawn: spawnFixture({ sourceDate: "February 2026" }),
    observedAt: "2026-07-25T11:17:00Z",
    attemptId: "gh-703-1-damodaran",
    runId: "703",
    eventName: "schedule",
  });
  assert.equal(recovered.exitCode, 0);
  assert.equal(recovered.recovery.recovered, true);
  assert.deepStrictEqual(recovered.recovery.retrySet, []);
  const state = JSON.parse(fs.readFileSync(path.join(root, "data", "admin", "damodaran", "index.json"), "utf8"));
  assert.equal(state.items.damodaran.recovered_from_run_id, "701");
  assert.equal(state.items.damodaran.recovery_event_name, "schedule");
  fs.rmSync(root, { recursive: true, force: true });
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "damodaran-mixed-cadence-advance-"));
  const common = {
    repoRoot: root,
    reportPath: path.join(root, "data", "admin", "damodaran", "owner-guard.json"),
    attemptShardPath: path.join(root, "attempt.json"),
    canonicalRoot: path.join(root, "data", "damodaran"),
    now: () => 1_000,
  };
  DamodaranProducer.runDamodaranShadow({
    ...common,
    spawn: spawnFixture({
      sourceDatesByFile: { [FILE_NAMES[0]]: "March 2026" },
    }),
    observedAt: "2026-07-20T00:00:00Z",
    attemptId: "gh-720-1-damodaran",
    runId: "720",
    eventName: "schedule",
  });
  DamodaranProducer.runDamodaranShadow({
    ...common,
    spawn: () => { throw new Error("controlled failure must bypass spawn"); },
    observedAt: "2026-07-21T00:00:00Z",
    attemptId: "gh-721-1-damodaran",
    runId: "721",
    eventName: "workflow_dispatch",
    controlledFailure: true,
  });
  const recovered = DamodaranProducer.runDamodaranShadow({
    ...common,
    spawn: spawnFixture({
      sourceDatesByFile: {
        [FILE_NAMES[0]]: "March 2026",
        [FILE_NAMES[1]]: "February 2026",
      },
    }),
    observedAt: "2026-07-27T00:00:00Z",
    attemptId: "gh-722-1-damodaran",
    runId: "722",
    eventName: "schedule",
  });
  assert.equal(recovered.exitCode, 0);
  assert.equal(recovered.recovery.recovered, true);
  assert.deepStrictEqual(recovered.recovery.retrySet, []);
  assert.equal(
    JSON.parse(fs.readFileSync(
      path.join(root, "data", "admin", "damodaran", "current", "damodaran.json"),
      "utf8",
    )).source_as_of,
    "2026-03-01",
    "per-file progress must recover even when the scalar maximum is unchanged",
  );
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("damodaran owner guard and workflow contract tests passed");
