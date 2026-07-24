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
const HELPER_SOURCE = fs.readFileSync(HELPER, "utf8");
const APP_PACKAGE = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "100xfenok-next/package.json"), "utf8"));
const VALIDATE_WORKFLOWS = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/validate-workflows.yml"), "utf8");
const WORKFLOW = ".github/workflows/fetch-defillama.yml";
const YAHOO_WORKFLOW = ".github/workflows/fetch-yahoo-ticker.yml";
const SENTIMENT_WORKFLOW = ".github/workflows/fetch-sentiment.yml";
const EDGE_WORKFLOW = ".github/workflows/fenok-edge-daily.yml";
const KRX_WORKFLOW = ".github/workflows/fenok-edge-krx-daily.yml";
const YF_FINANCE_WORKFLOW = ".github/workflows/fetch-yf-finance.yml";
const STOCKANALYSIS_WORKFLOW = ".github/workflows/fetch-stockanalysis.yml";
const YARDENI_WORKFLOW = ".github/workflows/fetch-fred-yardeni.yml";
const EDGAR_WORKFLOW = ".github/workflows/fetch-edgar-filings.yml";
const FDIC_WORKFLOW = ".github/workflows/fetch-fdic.yml";
const SLICKCHARTS_DAILY_WORKFLOW = ".github/workflows/slickcharts-daily.yml";
const SLICKCHARTS_WEEKLY_WORKFLOW = ".github/workflows/slickcharts-weekly.yml";
const SLICKCHARTS_SYMBOLS_WORKFLOW = ".github/workflows/slickcharts-symbols.yml";
const SLICKCHARTS_MONTHLY_WORKFLOW = ".github/workflows/slickcharts-monthly.yml";
const SLICKCHARTS_HISTORY_WORKFLOW = ".github/workflows/slickcharts-history.yml";
const BUILD_STOCKS_ANALYZER_WORKFLOW = ".github/workflows/build-stocks-analyzer.yml";
const PIPELINE_FAILURE_ALARM_WORKFLOW = ".github/workflows/pipeline-failure-alarm.yml";
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

function run(root, stage, extra = [], workflow = WORKFLOW, helper = HELPER) {
  return spawnSync("bash", [helper, "--repo-root", root, "--manifest", path.join(root, "data/admin/lane-commit-manifest.json"), "--workflow", workflow, "--stage", stage, "--expected-digest", DIGEST, ...extra], {
    cwd: root,
    encoding: "utf8",
  });
}

function cached(root) {
  return execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: root, encoding: "utf8" })
    .trim().split("\n").filter(Boolean).sort();
}

function configureAlwaysStage(fixture, specs, exclude = []) {
  fixture.manifest.workflows[WORKFLOW].stages.always_if_exists = specs;
  fixture.manifest.workflows[WORKFLOW].exclude = exclude;
  writeJson(path.join(fixture.root, "data/admin/lane-commit-manifest.json"), fixture.manifest);
}

function writeFixturePath(root, kind, relativePath) {
  const target = path.join(root, relativePath);
  if (kind === "directory") {
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "fixture.json"), "{}\n");
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "{}\n");
}

function assertIgnoredExactPathSemantics(helper = HELPER) {
  for (const kind of ["file", "directory"]) {
    for (const required of [false, true]) {
      const fixture = makeFixture();
      try {
        const relativePath = `ignored-${kind}-${required ? "required" : "optional"}${kind === "file" ? ".json" : ""}`;
        configureAlwaysStage(fixture, [{ kind, path: relativePath, required }]);
        writeFixturePath(fixture.root, kind, relativePath);
        fs.writeFileSync(path.join(fixture.root, ".gitignore"), `${relativePath}${kind === "directory" ? "/" : ""}\n`);
        const result = run(fixture.root, "always_if_exists", [], WORKFLOW, helper);
        if (required) {
          assert.notEqual(result.status, 0, `required ignored ${kind} must fail closed`);
          assert.match(
            result.stderr,
            new RegExp(`manifest declares '${relativePath.replaceAll(".", "\\.")}' required while \\.gitignore excludes it`),
          );
        } else {
          assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
          assert.match(result.stderr, new RegExp(`skip ignored optional ${kind}.*${relativePath.replaceAll(".", "\\.")}`));
        }
        assert.deepEqual(cached(fixture.root), [], `ignored ${kind} must not reach git add`);
      } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      }
    }
  }
}

function assertIgnoredGlobFiltered(helper = HELPER) {
  const fixture = makeFixture();
  try {
    const directory = "ignored-glob";
    const included = `${directory}/included.json`;
    const ignored = `${directory}/ignored.json`;
    configureAlwaysStage(fixture, [{ kind: "glob", path: `${directory}/*.json`, required: false }]);
    writeFixturePath(fixture.root, "file", included);
    writeFixturePath(fixture.root, "file", ignored);
    fs.writeFileSync(path.join(fixture.root, ".gitignore"), `${ignored}\n`);
    const result = run(fixture.root, "always_if_exists", [], WORKFLOW, helper);
    assert.equal(result.status, 0, `ignored glob match must be filtered before git add: ${result.stderr}`);
    assert.match(result.stderr, /skip ignored optional glob.*ignored\.json/);
    assert.match(result.stdout, /stage_selected=1 staged_index_total=1/);
    assert.deepEqual(cached(fixture.root), [included]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

function assertRequiredIgnoredGlobFails(helper = HELPER) {
  const fixture = makeFixture();
  try {
    const directory = "required-ignored-glob";
    const included = `${directory}/included.json`;
    const ignored = `${directory}/ignored.json`;
    configureAlwaysStage(fixture, [{ kind: "glob", path: `${directory}/*.json`, required: true }]);
    writeFixturePath(fixture.root, "file", included);
    writeFixturePath(fixture.root, "file", ignored);
    fs.writeFileSync(path.join(fixture.root, ".gitignore"), `${ignored}\n`);
    const result = run(fixture.root, "always_if_exists", [], WORKFLOW, helper);
    assert.notEqual(result.status, 0, "required glob with an ignored match must fail closed");
    assert.match(result.stderr, /manifest declares 'required-ignored-glob\/ignored\.json' required while \.gitignore excludes it/);
    assert.deepEqual(cached(fixture.root), [], "required ignored glob must fail before any index mutation");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

function assertTrackedIgnoredDirectoryStillStages(helper = HELPER) {
  const fixture = makeFixture();
  try {
    const directory = "tracked-then-ignored";
    const trackedFile = `${directory}/tracked.json`;
    configureAlwaysStage(fixture, [{ kind: "directory", path: directory, required: false }]);
    writeFixturePath(fixture.root, "file", trackedFile);
    execFileSync("git", ["add", "--", trackedFile], { cwd: fixture.root });
    execFileSync("git", ["commit", "-qm", "tracked directory baseline"], { cwd: fixture.root });
    fs.writeFileSync(path.join(fixture.root, ".gitignore"), `${directory}/\n`);
    fs.appendFileSync(path.join(fixture.root, trackedFile), "changed\n");
    const result = run(fixture.root, "always_if_exists", [], WORKFLOW, helper);
    assert.equal(result.status, 0, `tracked files below an ignored directory remain stageable: ${result.stderr}`);
    assert.deepEqual(cached(fixture.root), [trackedFile]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

function assertTrackedFileBelowIgnoredParentStillStages(helper = HELPER) {
  const fixture = makeFixture();
  try {
    const directory = "tracked-file-ignored-parent";
    const trackedFile = `${directory}/tracked.json`;
    configureAlwaysStage(fixture, [{ kind: "file", path: trackedFile, required: false }]);
    writeFixturePath(fixture.root, "file", trackedFile);
    execFileSync("git", ["add", "--", trackedFile], { cwd: fixture.root });
    execFileSync("git", ["commit", "-qm", "tracked file baseline"], { cwd: fixture.root });
    fs.writeFileSync(path.join(fixture.root, ".gitignore"), `${directory}/\n`);
    fs.appendFileSync(path.join(fixture.root, trackedFile), "changed\n");
    const result = run(fixture.root, "always_if_exists", [], WORKFLOW, helper);
    assert.equal(result.status, 0, `tracked file below an ignored parent remains stageable: ${result.stderr}`);
    assert.deepEqual(cached(fixture.root), [trackedFile]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

function assertTrackedIgnoredDirectoryFromGlobStillStages(helper = HELPER) {
  const fixture = makeFixture();
  try {
    const directory = "tracked-glob-directory";
    const trackedFile = `${directory}/tracked.json`;
    configureAlwaysStage(fixture, [{ kind: "glob", path: "tracked-glob-*", required: false }]);
    writeFixturePath(fixture.root, "file", trackedFile);
    execFileSync("git", ["add", "--", trackedFile], { cwd: fixture.root });
    execFileSync("git", ["commit", "-qm", "tracked glob directory baseline"], { cwd: fixture.root });
    fs.writeFileSync(path.join(fixture.root, ".gitignore"), `${directory}/\n`);
    fs.appendFileSync(path.join(fixture.root, trackedFile), "changed\n");
    const result = run(fixture.root, "always_if_exists", [], WORKFLOW, helper);
    assert.equal(result.status, 0, `glob-matched tracked directory remains stageable: ${result.stderr}`);
    assert.deepEqual(cached(fixture.root), [trackedFile]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

function assertTrackedFileFromGlobBelowIgnoredParentStillStages(helper = HELPER) {
  const fixture = makeFixture();
  try {
    const directory = "tracked-glob-file-ignored-parent";
    const trackedFile = `${directory}/tracked.json`;
    configureAlwaysStage(fixture, [{ kind: "glob", path: `${directory}/*.json`, required: false }]);
    writeFixturePath(fixture.root, "file", trackedFile);
    execFileSync("git", ["add", "--", trackedFile], { cwd: fixture.root });
    execFileSync("git", ["commit", "-qm", "tracked glob file baseline"], { cwd: fixture.root });
    fs.writeFileSync(path.join(fixture.root, ".gitignore"), `${directory}/\n`);
    fs.appendFileSync(path.join(fixture.root, trackedFile), "changed\n");
    const result = run(fixture.root, "always_if_exists", [], WORKFLOW, helper);
    assert.equal(result.status, 0, `glob-matched tracked file below an ignored parent remains stageable: ${result.stderr}`);
    assert.deepEqual(cached(fixture.root), [trackedFile]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

assert.equal(
  APP_PACKAGE.scripts?.["qa:lane-manifest-staging"],
  "node ../scripts/test-stage-lane-manifest.mjs",
  "the lane-manifest staging test must have a package-script hop",
);
assert.match(
  VALIDATE_WORKFLOWS,
  /npm --prefix 100xfenok-next run qa:lane-manifest-staging/,
  "Validate GitHub Workflows must invoke the package-script hop",
);
for (const triggerPath of [
  "100xfenok-next/package.json",
  "scripts/stage-lane-manifest.sh",
  "scripts/test-stage-lane-manifest.mjs",
]) {
  assert.match(VALIDATE_WORKFLOWS, new RegExp(`- '${triggerPath.replaceAll(".", "\\.")}'`));
}

assertIgnoredExactPathSemantics();
assertIgnoredGlobFiltered();
assertRequiredIgnoredGlobFails();
assertTrackedIgnoredDirectoryStillStages();
assertTrackedFileBelowIgnoredParentStillStages();
assertTrackedIgnoredDirectoryFromGlobStillStages();
assertTrackedFileFromGlobBelowIgnoredParentStillStages();

{
  const mutationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stage-lane-manifest-mutations-"));
  try {
    const unfilteredSource = HELPER_SOURCE.replace(
      'if is_git_ignored "$match"; then',
      "if false; then",
    );
    assert.notEqual(unfilteredSource, HELPER_SOURCE, "ignore-filter mutation anchor must exist");
    const unfilteredHelper = path.join(mutationRoot, "unfiltered-glob.sh");
    fs.writeFileSync(unfilteredHelper, unfilteredSource);
    assert.throws(
      () => assertIgnoredGlobFiltered(unfilteredHelper),
      /ignored glob match must be filtered before git add/,
      "reverting the glob ignore filter must fail the behavior test",
    );

    const silentRequiredSource = HELPER_SOURCE.replace(
      "return 1 # required-ignore-conflict",
      "return 0 # required-ignore-conflict",
    );
    assert.notEqual(silentRequiredSource, HELPER_SOURCE, "required-ignore mutation anchor must exist");
    const silentRequiredHelper = path.join(mutationRoot, "silent-required.sh");
    fs.writeFileSync(silentRequiredHelper, silentRequiredSource);
    assert.throws(
      () => assertIgnoredExactPathSemantics(silentRequiredHelper),
      /required ignored file must fail closed/,
      "downgrading a required ignored path to a skip must fail the behavior test",
    );
  } finally {
    fs.rmSync(mutationRoot, { recursive: true, force: true });
  }
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

// Alarm-state publication is optional and non-primary: the manifest stages
// only the private/public state pair while the workflow preserves its issue path.
{
  const fixture = makeFixture({ workflow: PIPELINE_FAILURE_ALARM_WORKFLOW });
  const always = run(fixture.root, "always_if_exists", [], PIPELINE_FAILURE_ALARM_WORKFLOW);
  assert.equal(always.status, 0, `${always.stderr}\n${always.stdout}`);
  assert.match(always.stdout, /declared=2 stage_selected=2 staged_index_total=2/);
  assert.deepEqual(cached(fixture.root), fixture.materialized.always.sort());
}

// Stocks Analyzer pins 31 literal pathspecs plus the public investor JSON glob;
// nested/non-JSON files stay out and public griffin.json remains excluded.
{
  const fixture = makeFixture({ workflow: BUILD_STOCKS_ANALYZER_WORKFLOW });
  const publicInvestors = path.join(fixture.root, "100xfenok-next/public/data/sec-13f/investors");
  const outOfScope = [
    path.join(publicInvestors, "notes.txt"),
    path.join(publicInvestors, "nested", "nested.json"),
  ];
  fs.writeFileSync(outOfScope[0], "not json\n");
  fs.mkdirSync(path.dirname(outOfScope[1]), { recursive: true });
  fs.writeFileSync(outOfScope[1], "{}\n");
  const always = run(fixture.root, "always_if_exists", [], BUILD_STOCKS_ANALYZER_WORKFLOW);
  assert.equal(always.status, 0, `${always.stderr}\n${always.stdout}`);
  assert.match(always.stdout, /declared=32 stage_selected=35 staged_index_total=34/);
  assert.deepEqual(cached(fixture.root), fixture.materialized.always.sort());
  for (const excluded of fixture.materialized.exclude) {
    assert.equal(cached(fixture.root).includes(excluded), false, `${excluded} must remain unstaged`);
  }

  execFileSync("git", ["add", "-A"], { cwd: fixture.root });
  execFileSync("git", ["commit", "-qm", "fixture baseline"], { cwd: fixture.root });
  for (const file of [...fixture.materialized.always, ...fixture.materialized.exclude, ...outOfScope.map((file) => path.relative(fixture.root, file))]) {
    fs.appendFileSync(path.join(fixture.root, file), "changed\n");
  }
  const tracked = run(fixture.root, "always_if_exists", [], BUILD_STOCKS_ANALYZER_WORKFLOW);
  assert.equal(tracked.status, 0, `${tracked.stderr}\n${tracked.stdout}`);
  assert.deepEqual(cached(fixture.root), fixture.materialized.always.sort());
}

// The full history merge publishes its attempt shard, four canonical files,
// and the per-symbol directory; single-symbol attempts stay shard-only.
{
  const fixture = makeFixture({ workflow: SLICKCHARTS_HISTORY_WORKFLOW });
  const always = run(fixture.root, "always_if_exists", [], SLICKCHARTS_HISTORY_WORKFLOW);
  assert.equal(always.status, 0, `${always.stderr}\n${always.stdout}`);
  assert.match(always.stdout, /declared=6 stage_selected=6 staged_index_total=6/);
  assert.deepEqual(cached(fixture.root), fixture.materialized.always.sort());
}

// Monthly SlickCharts stages the attempt shard, 21 required outputs, and the
// optional one-off 1929 crash output through one always-published stage.
{
  const fixture = makeFixture({ workflow: SLICKCHARTS_MONTHLY_WORKFLOW });
  const always = run(fixture.root, "always_if_exists", [], SLICKCHARTS_MONTHLY_WORKFLOW);
  assert.equal(always.status, 0, `${always.stderr}\n${always.stdout}`);
  assert.match(always.stdout, /declared=23 stage_selected=23 staged_index_total=23/);
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
  assert.match(always.stdout, /declared=9 stage_selected=10 staged_index_total=9/);
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
  assert.match(trackedAlways.stdout, /declared=9 stage_selected=10 staged_index_total=9/);
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
  const alwaysCount = fixture.materialized.always.length;
  assert.match(always.stdout, new RegExp(`stage_selected=${alwaysCount} staged_index_total=${alwaysCount}`));
  assert.deepEqual(cached(fixture.root), fixture.materialized.always.sort());

  const success = run(fixture.root, "success_if_exists", [], SENTIMENT_WORKFLOW);
  assert.equal(success.status, 0, success.stderr);
  const successCount = fixture.materialized.success.length;
  assert.match(success.stdout, new RegExp(`stage_selected=${successCount} staged_index_total=${alwaysCount + successCount}`));
  assert.deepEqual(cached(fixture.root), [...fixture.materialized.always, ...fixture.materialized.success].sort());
}

// KRX always publishes its attempt shard; successful fetches additionally
// publish the admin bridge plus the two aggregate-only slices.
{
  const fixture = makeFixture({ workflow: KRX_WORKFLOW });
  const always = run(fixture.root, "always_if_exists", [], KRX_WORKFLOW);
  assert.equal(always.status, 0, `${always.stderr}\n${always.stdout}`);
  assert.match(always.stdout, /declared=1 stage_selected=1 staged_index_total=1/);
  assert.deepEqual(cached(fixture.root), [
    "data/admin/data-supply-state/detection-attempts/krx.json",
  ]);

  const success = run(fixture.root, "success_if_exists", [], KRX_WORKFLOW);
  assert.equal(success.status, 0, `${success.stderr}\n${success.stdout}`);
  assert.match(success.stdout, /declared=3 stage_selected=3 staged_index_total=4/);
  assert.deepEqual(cached(fixture.root), [
    "data/admin/data-supply-state/detection-attempts/krx.json",
    "data/admin/fenok-edge-korea-krx-daily-index.json",
    "data/computed/fenok-edge-korea-krx-index-daily.json",
    "data/computed/fenok-edge-korea-krx-kosdaq-market-cap-aggregate.json",
  ].sort());

  const missing = makeFixture({ workflow: KRX_WORKFLOW });
  const missingAlways = run(missing.root, "always_if_exists", [], KRX_WORKFLOW);
  assert.equal(missingAlways.status, 0, `${missingAlways.stderr}\n${missingAlways.stdout}`);
  fs.rmSync(path.join(missing.root, "data/computed/fenok-edge-korea-krx-kosdaq-market-cap-aggregate.json"));
  const failed = run(missing.root, "success_if_exists", [], KRX_WORKFLOW);
  assert.notEqual(failed.status, 0, "required Slice 2 aggregate must fail closed when absent");
  assert.deepEqual(cached(missing.root), [
    "data/admin/data-supply-state/detection-attempts/krx.json",
  ], "required-path failure must happen before any success-stage mutation");
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
