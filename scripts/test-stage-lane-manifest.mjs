#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildLaneCommitManifest } from "./build-lane-commit-manifest.mjs";
import { LANE_REGISTRY, registryDigest } from "./lib/lane-registry.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HELPER = path.join(REPO_ROOT, "scripts", "stage-lane-manifest.sh");
const WORKFLOW = ".github/workflows/fetch-defillama.yml";
const YAHOO_WORKFLOW = ".github/workflows/fetch-yahoo-ticker.yml";
const SENTIMENT_WORKFLOW = ".github/workflows/fetch-sentiment.yml";
const EDGE_WORKFLOW = ".github/workflows/fenok-edge-daily.yml";
const YF_FINANCE_WORKFLOW = ".github/workflows/fetch-yf-finance.yml";
const STOCKANALYSIS_WORKFLOW = ".github/workflows/fetch-stockanalysis.yml";
const YARDENI_WORKFLOW = ".github/workflows/fetch-fred-yardeni.yml";
const EDGAR_WORKFLOW = ".github/workflows/fetch-edgar-filings.yml";
const FDIC_WORKFLOW = ".github/workflows/fetch-fdic.yml";
const SLICKCHARTS_DAILY_WORKFLOW = ".github/workflows/slickcharts-daily.yml";
const SLICKCHARTS_WEEKLY_WORKFLOW = ".github/workflows/slickcharts-weekly.yml";
const SLICKCHARTS_SYMBOLS_WORKFLOW = ".github/workflows/slickcharts-symbols.yml";
const DIGEST = registryDigest();

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeFixture({ workflow = WORKFLOW, includeSuccess = true, successStage = "success_if_exists" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage-lane-manifest-"));
  execFileSync("git", ["init", "-q", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "manifest-test"], { cwd: root });
  const manifest = buildLaneCommitManifest(LANE_REGISTRY);
  writeJson(path.join(root, "data/admin/lane-commit-manifest.json"), manifest);
  const paths = {
    always: manifest.workflows[workflow].stages.always_if_exists.map((entry) => entry.path),
    success: manifest.workflows[workflow].stages[successStage].map((entry) => entry.path),
  };
  const materialized = { always: [], success: [], exclude: [] };
  const materialize = (entries, output) => {
    for (const entry of entries) {
      if (entry.kind === "glob") {
        const base = entry.path.slice(0, entry.path.indexOf("*"));
        for (const name of ["fixture-a.json", "fixture-b.json"]) {
          const file = `${base}${name}`;
          const target = path.join(root, file);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, "{}\n");
          output.push(file);
        }
        continue;
      }
      if (entry.kind === "dynamic_set") {
        const file = `${entry.path}/dynamic.json`;
        const target = path.join(root, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, "{}\n");
        output.push(file);
        continue;
      }
      const target = path.join(root, entry.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (entry.kind === "directory") {
        fs.mkdirSync(target, { recursive: true });
        const file = `${entry.path}/fixture.json`;
        fs.writeFileSync(path.join(target, "fixture.json"), "{}\n");
        output.push(file);
      } else {
        fs.writeFileSync(target, "{}\n");
        output.push(entry.path);
      }
    }
  };
  materialize(manifest.workflows[workflow].stages.always_if_exists, materialized.always);
  if (includeSuccess) materialize(manifest.workflows[workflow].stages[successStage], materialized.success);
  materialize(manifest.workflows[workflow].exclude, materialized.exclude);
  return { root, manifest, paths, materialized };
}

function run(root, stage, extra = [], workflow = WORKFLOW) {
  return spawnSync("bash", [HELPER, "--repo-root", root, "--manifest", path.join(root, "data/admin/lane-commit-manifest.json"), "--workflow", workflow, "--stage", stage, "--expected-digest", DIGEST, ...extra], {
    cwd: root,
    encoding: "utf8",
  });
}

function cached(root) {
  return execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: root, encoding: "utf8" })
    .trim().split("\n").filter(Boolean).sort();
}

// The full symbols merge publishes its attempt shard and canonical aggregate;
// shard-only/single-symbol calls must not opt into this workflow-wide stage.
{
  const fixture = makeFixture({ workflow: SLICKCHARTS_SYMBOLS_WORKFLOW });
  const always = run(fixture.root, "always_if_exists", [], SLICKCHARTS_SYMBOLS_WORKFLOW);
  assert.equal(always.status, 0, `${always.stderr}\n${always.stdout}`);
  assert.match(always.stdout, /declared=2 stage_selected=2 staged_index_total=2/);
  assert.deepEqual(cached(fixture.root), fixture.materialized.always.sort());
}

// Weekly SlickCharts has no degraded-data branch: its attempt shard and four
// required checked-in outputs are one always-published manifest stage.
{
  const fixture = makeFixture({ workflow: SLICKCHARTS_WEEKLY_WORKFLOW });
  const always = run(fixture.root, "always_if_exists", [], SLICKCHARTS_WEEKLY_WORKFLOW);
  assert.equal(always.status, 0, `${always.stderr}\n${always.stdout}`);
  assert.match(always.stdout, /declared=5 stage_selected=5 staged_index_total=5/);
  assert.deepEqual(cached(fixture.root), fixture.materialized.always.sort());
}

// Daily SlickCharts always persists the merged attempt/recovery state, while
// the five scraper outputs are selected only when recovery permits publishing.
{
  const fixture = makeFixture({ workflow: SLICKCHARTS_DAILY_WORKFLOW });
  const always = run(fixture.root, "always_if_exists", [], SLICKCHARTS_DAILY_WORKFLOW);
  assert.equal(always.status, 0, `${always.stderr}\n${always.stdout}`);
  assert.match(always.stdout, /declared=2 stage_selected=2 staged_index_total=2/);
  assert.deepEqual(cached(fixture.root), fixture.materialized.always.sort());

  const success = run(fixture.root, "success_if_exists", [], SLICKCHARTS_DAILY_WORKFLOW);
  assert.equal(success.status, 0, `${success.stderr}\n${success.stdout}`);
  assert.match(success.stdout, /declared=5 stage_selected=5 staged_index_total=7/);
  assert.deepEqual(cached(fixture.root), [...fixture.materialized.always, ...fixture.materialized.success].sort());
}

// Monthly FDIC recovery state and successful canonical/public outputs remain
// optional so degraded evidence can still be committed without false failure.
{
  const fixture = makeFixture({ workflow: FDIC_WORKFLOW });
  const always = run(fixture.root, "always_if_exists", [], FDIC_WORKFLOW);
  assert.equal(always.status, 0, `${always.stderr}\n${always.stdout}`);
  assert.match(always.stdout, /declared=3 stage_selected=3 staged_index_total=3/);
  assert.deepEqual(cached(fixture.root), fixture.materialized.always.sort());

  const success = run(fixture.root, "success_if_exists", [], FDIC_WORKFLOW);
  assert.equal(success.status, 0, `${success.stderr}\n${success.stdout}`);
  assert.match(success.stdout, /declared=2 stage_selected=2 staged_index_total=5/);
  assert.deepEqual(cached(fixture.root), [...fixture.materialized.always, ...fixture.materialized.success].sort());
}

// EDGAR's non-admin directory outputs use the default success stage, while
// the workflow's outer branch preserves verify-success and non-plan semantics.
{
  const fixture = makeFixture({ workflow: EDGAR_WORKFLOW });
  const always = run(fixture.root, "always_if_exists", [], EDGAR_WORKFLOW);
  assert.equal(always.status, 0, `${always.stderr}\n${always.stdout}`);
  assert.match(always.stdout, /declared=4 stage_selected=4 staged_index_total=4/);
  assert.deepEqual(cached(fixture.root), fixture.materialized.always.sort());

  const success = run(fixture.root, "success_if_exists", [], EDGAR_WORKFLOW);
  assert.equal(success.status, 0, `${success.stderr}\n${success.stdout}`);
  assert.match(success.stdout, /declared=3 stage_selected=3 staged_index_total=7/);
  assert.deepEqual(cached(fixture.root), [...fixture.materialized.always, ...fixture.materialized.success].sort());
}

// Weekly Yardeni recovery state is always optional, and public/canonical
// outputs are selected only by the workflow's successful outcome branch.
{
  const fixture = makeFixture({ workflow: YARDENI_WORKFLOW });
  const always = run(fixture.root, "always_if_exists", [], YARDENI_WORKFLOW);
  assert.equal(always.status, 0, `${always.stderr}\n${always.stdout}`);
  assert.match(always.stdout, /declared=4 stage_selected=4 staged_index_total=4/);
  assert.deepEqual(cached(fixture.root), fixture.materialized.always.sort());

  const success = run(fixture.root, "success_if_exists", [], YARDENI_WORKFLOW);
  assert.equal(success.status, 0, `${success.stderr}\n${success.stdout}`);
  assert.match(success.stdout, /declared=2 stage_selected=2 staged_index_total=6/);
  assert.deepEqual(cached(fixture.root), [...fixture.materialized.always, ...fixture.materialized.success].sort());
}

// StockAnalysis combines four required directories, optional attempt shards,
// a modified/untracked YF dynamic set, and two exclusions nested inside staged roots.
{
  const fixture = makeFixture({ workflow: STOCKANALYSIS_WORKFLOW });
  const always = run(fixture.root, "always_if_exists", [], STOCKANALYSIS_WORKFLOW);
  assert.equal(always.status, 0, `${always.stderr}\n${always.stdout}`);
  assert.match(always.stdout, /declared=7 stage_selected=8 staged_index_total=7/);
  assert.deepEqual(cached(fixture.root), fixture.materialized.always.sort());
  for (const excluded of fixture.materialized.exclude) {
    assert.equal(cached(fixture.root).includes(excluded), false, `${excluded} must remain unstaged`);
  }

  const tracked = makeFixture({ workflow: STOCKANALYSIS_WORKFLOW });
  execFileSync("git", ["add", "-A"], { cwd: tracked.root });
  execFileSync("git", ["commit", "-qm", "fixture baseline"], { cwd: tracked.root });
  for (const file of [...tracked.materialized.always, ...tracked.materialized.exclude]) {
    fs.appendFileSync(path.join(tracked.root, file), "changed\n");
  }
  const trackedAlways = run(tracked.root, "always_if_exists", [], STOCKANALYSIS_WORKFLOW);
  assert.equal(trackedAlways.status, 0, `${trackedAlways.stderr}\n${trackedAlways.stdout}`);
  assert.match(trackedAlways.stdout, /declared=7 stage_selected=8 staged_index_total=7/);
  assert.deepEqual(cached(tracked.root), tracked.materialized.always.sort());
}

// Required Yahoo directories stage their concrete files while the declared
// summary exclusion is removed from the index by the manifest helper itself.
{
  const fixture = makeFixture({ workflow: YF_FINANCE_WORKFLOW });
  const always = run(fixture.root, "always_if_exists", [], YF_FINANCE_WORKFLOW);
  assert.equal(always.status, 0, `${always.stderr}\n${always.stdout}`);
  assert.match(always.stdout, /stage_selected=4 staged_index_total=4/);
  assert.deepEqual(cached(fixture.root), fixture.materialized.always.sort());
  assert.equal(
    cached(fixture.root).includes("data/yf/finance/_summary.json"),
    false,
    "the manifest exclusion must keep the generated YF summary unstaged",
  );

  const tracked = makeFixture({ workflow: YF_FINANCE_WORKFLOW });
  execFileSync("git", ["add", "-A"], { cwd: tracked.root });
  execFileSync("git", ["commit", "-qm", "fixture baseline"], { cwd: tracked.root });
  for (const file of [...tracked.materialized.always, ...tracked.materialized.exclude]) {
    fs.appendFileSync(path.join(tracked.root, file), "changed\n");
  }
  const trackedAlways = run(tracked.root, "always_if_exists", [], YF_FINANCE_WORKFLOW);
  assert.equal(trackedAlways.status, 0, `${trackedAlways.stderr}\n${trackedAlways.stdout}`);
  assert.match(trackedAlways.stdout, /stage_selected=4 staged_index_total=4/);
  assert.deepEqual(cached(tracked.root), tracked.materialized.always.sort());
}

// Directory policy selects one manifest entry while git stages its concrete files.
{
  const fixture = makeFixture({ workflow: YAHOO_WORKFLOW });
  const always = run(fixture.root, "always_if_exists", [], YAHOO_WORKFLOW);
  assert.equal(always.status, 0, `${always.stderr}\n${always.stdout}`);
  assert.match(always.stdout, /stage_selected=2 staged_index_total=2/);
  assert.deepEqual(cached(fixture.root), [
    fixture.paths.always[0],
    `${fixture.paths.always[1]}/fixture.json`,
  ].sort());

  const success = run(fixture.root, "success_if_exists", [], YAHOO_WORKFLOW);
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /stage_selected=2 staged_index_total=4/);
  assert.deepEqual(cached(fixture.root), [
    fixture.paths.always[0],
    `${fixture.paths.always[1]}/fixture.json`,
    ...fixture.paths.success,
  ].sort());
}

// Multi-lane policy combines file recovery shards with computed globs and only
// permits the computed stage after a successful, non-plan refresh.
{
  const fixture = makeFixture({ workflow: EDGE_WORKFLOW, successStage: "success_verify_not_plan_if_exists" });
  const always = run(fixture.root, "always_if_exists", [], EDGE_WORKFLOW);
  assert.equal(always.status, 0, `${always.stderr}\n${always.stdout}`);
  const alwaysCount = fixture.materialized.always.length;
  assert.match(always.stdout, new RegExp(`stage_selected=${alwaysCount} staged_index_total=${alwaysCount}`));
  assert.deepEqual(cached(fixture.root), fixture.materialized.always.sort());

  const success = run(fixture.root, "success_verify_not_plan_if_exists", [], EDGE_WORKFLOW);
  assert.equal(success.status, 0, success.stderr);
  const successCount = fixture.materialized.success.length;
  assert.match(success.stdout, new RegExp(`stage_selected=${successCount} staged_index_total=${alwaysCount + successCount}`));
  assert.deepEqual(cached(fixture.root), [...fixture.materialized.always, ...fixture.materialized.success].sort());
}

// Glob policy expands each matching file while the proof keeps selection and
// cumulative index totals separate.
{
  const fixture = makeFixture({ workflow: SENTIMENT_WORKFLOW });
  const always = run(fixture.root, "always_if_exists", [], SENTIMENT_WORKFLOW);
  assert.equal(always.status, 0, `${always.stderr}\n${always.stdout}`);
  assert.match(always.stdout, /stage_selected=6 staged_index_total=6/);
  assert.deepEqual(cached(fixture.root), fixture.materialized.always.sort());

  const success = run(fixture.root, "success_if_exists", [], SENTIMENT_WORKFLOW);
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /stage_selected=4 staged_index_total=10/);
  assert.deepEqual(cached(fixture.root), [...fixture.materialized.always, ...fixture.materialized.success].sort());
}

// Pilot contract: each stage is selected independently and the applied set is exact.
{
  const fixture = makeFixture();
  const always = run(fixture.root, "always_if_exists");
  assert.equal(always.status, 0, `${always.stderr}\n${always.stdout}`);
  assert.match(always.stdout, /workflow=.github\/workflows\/fetch-defillama\.yml/);
  assert.match(always.stdout, /stage=always_if_exists/);
  assert.match(always.stdout, /stage_selected=3 staged_index_total=3/);
  assert.deepEqual(cached(fixture.root), fixture.paths.always.sort());

  const success = run(fixture.root, "success_if_exists");
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /stage_selected=2 staged_index_total=5/);
  assert.deepEqual(cached(fixture.root), [...fixture.paths.always, ...fixture.paths.success].sort());
}

// Fail closed before mutation: missing, malformed, stale, unknown stage, and required path absence.
for (const [label, mutate] of [
  ["missing manifest", (fixture) => fs.unlinkSync(path.join(fixture.root, "data/admin/lane-commit-manifest.json"))],
  ["stale digest", (fixture) => {
    fixture.manifest.registry_digest = "0".repeat(64);
    writeJson(path.join(fixture.root, "data/admin/lane-commit-manifest.json"), fixture.manifest);
  }],
  ["malformed manifest", (fixture) => fs.writeFileSync(path.join(fixture.root, "data/admin/lane-commit-manifest.json"), "{\n")],
  ["required path absent", (fixture) => fs.rmSync(path.join(fixture.root, fixture.paths.success[0]), { force: true })],
]) {
  const fixture = makeFixture({ includeSuccess: label !== "required path absent" });
  mutate(fixture);
  const stage = label === "required path absent" ? "success_if_exists" : "always_if_exists";
  const result = run(fixture.root, stage);
  assert.notEqual(result.status, 0, `${label} must fail closed`);
  assert.deepEqual(cached(fixture.root), [], `${label} must not stage anything`);
}

{
  const fixture = makeFixture();
  const result = run(fixture.root, "not-a-stage");
  assert.notEqual(result.status, 0, "unknown stage must fail closed");
  assert.deepEqual(cached(fixture.root), []);
}

console.log("test-stage-lane-manifest: ok");
