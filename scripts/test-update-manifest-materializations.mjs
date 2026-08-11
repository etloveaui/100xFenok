#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { orderMaterializations, validateMaterializationRoutes } from "./materialize-update-manifest-routes.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/update-manifest.yml"), "utf8");
const runner = fs.readFileSync(path.join(root, "scripts/update-manifest-projections.sh"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "data/admin/lane-commit-manifest.json"), "utf8"));
const helperCall = "node scripts/materialize-update-manifest-routes.mjs";
const EXPECTED_ROUTES = [
  { source: "data/slickcharts", destination: "100xfenok-next/public/data/slickcharts", mode: "rsync_tree", delete: true, excludes: [], required: true, trailing_slash: true },
  { source: "data/yf/finance", destination: "100xfenok-next/public/data/yf/finance", mode: "rsync_tree", delete: true, excludes: [], required: true, trailing_slash: true },
  { source: "data/stockanalysis", destination: "100xfenok-next/public/data/stockanalysis", mode: "rsync_tree", delete: true, excludes: ["etfs"], required: true, trailing_slash: true },
  { source: "data/indices/nasdaq-giw-sox-constituents.json", destination: "100xfenok-next/public/data/indices/nasdaq-giw-sox-constituents.json", mode: "cp_file", delete: false, excludes: [], required: true, trailing_slash: false },
  { source: "data/admin/fenok-edge-korea-krx-daily-index.json", destination: "100xfenok-next/public/data/admin/fenok-edge-korea-krx-daily-index.json", mode: "cp_file", delete: false, excludes: [], required: true, trailing_slash: false },
  { source: "data/computed/fenok-edge-korea-krx-bridge-history.json", destination: "100xfenok-next/public/data/computed/fenok-edge-korea-krx-bridge-history.json", mode: "cp_file", delete: false, excludes: [], required: false, trailing_slash: false },
  { source: "data/computed/fenok_occ_options_availability.json", destination: "100xfenok-next/public/data/computed/fenok_occ_options_availability.json", mode: "cp_file", delete: false, excludes: [], required: true, trailing_slash: false },
  { source: "data/computed/market_facts/index.json", destination: "100xfenok-next/public/data/computed/market_facts/index.json", mode: "cp_file", delete: false, excludes: [], required: true, trailing_slash: false },
];

assert.deepEqual(manifest.update_manifest.materializations, EXPECTED_ROUTES);
// Projection materialization is owned by the shared runner; the workflow keeps
// only the retry-hygiene invocation. The initial path reaches the SAME runner.
assert.equal((workflow.match(/node scripts\/materialize-update-manifest-routes\.mjs/g) ?? []).length, 1,
  "workflow must keep only the retry-hygiene materialize invocation");
assert.equal((runner.match(/node scripts\/materialize-update-manifest-routes\.mjs/g) ?? []).length, 1,
  "runner must own the projection materialize invocation");
assert.ok(workflow.indexOf("run: bash scripts/update-manifest-projections.sh") < workflow.indexOf("- name: Check if manifest changed"),
  "initial path must run the shared runner before the change probe");
// Mirror projection order, once, in the shared runner (initial and retry alike).
assert.match(runner, /materialize-update-manifest-routes\.mjs --all[\s\S]*?sync-public-data\.mjs --write --etf-shards-only[\s\S]*?validate-slickcharts-integrity\.py[\s\S]*?diff -qr data\/slickcharts/);
const retry = workflow.slice(workflow.indexOf("for attempt in 1 2 3; do"));
assert.match(retry, /git reset --hard origin\/main[\s\S]*?materialize-update-manifest-routes\.mjs --all --validate-only --assert-no-untracked/);
// Current retry contract: reset hygiene, then the shared runner, then the
// change probe / stage / commit / push. The workflow does not re-run the
// projection stack inline and does not invoke this test suite itself.
assert.match(retry, /materialize-update-manifest-routes\.mjs --all --validate-only --assert-no-untracked[\s\S]*?update-manifest-projections\.sh[\s\S]*?stage-update-manifest-central\.mjs --check/);
assert.equal((workflow.match(/node scripts\/test-update-manifest-materializations\.mjs/g) ?? []).length, 0,
  "workflow must not re-run the materializations suite inside the retry loop");
assert.equal((workflow.match(/materialize-update-manifest-routes\.mjs --all(?! --validate-only)/g) ?? []).length, 0,
  "workflow must not carry the projection --all invocation (runner owns it)");
assert.equal((runner.match(/materialize-update-manifest-routes\.mjs --all(?! --validate-only)/g) ?? []).length, 1,
  "runner must carry the projection --all invocation exactly once");
assert.equal((workflow.match(/sync-public-data\.mjs --write --etf-shards-only/g) ?? []).length, 0,
  "workflow must not embed the public mirror sync (runner owns it)");
assert.equal((runner.match(/sync-public-data\.mjs --write --etf-shards-only/g) ?? []).length, 1,
  "runner must carry the public mirror sync exactly once");
for (const source of [workflow, runner]) {
  assert.doesNotMatch(source, /--route-source/);
  assert.doesNotMatch(source, /rsync -a --checksum --delete (?:data\/slickcharts|data\/yf\/finance|data\/stockanalysis)/);
  assert.doesNotMatch(source, /cp data\/(?:indices\/nasdaq-giw-sox-constituents|admin\/fenok-edge-korea-krx-daily-index|computed\/fenok_occ_options_availability|computed\/market_facts\/index)\.json/);
}
assert.equal(fs.existsSync(path.join(root, "scripts/materialize-update-manifest-routes.mjs")), true, `${helperCall} must exist`);

const helperPath = path.join(root, "scripts/materialize-update-manifest-routes.mjs");
const routes = manifest.update_manifest.materializations;
const orderedModes = orderMaterializations(routes).map((route) => route.mode);
assert.deepEqual(orderedModes, ["cp_file", "cp_file", "cp_file", "cp_file", "cp_file", "rsync_tree", "rsync_tree", "rsync_tree"]);

function write(target, contents) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function makeFixture() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "update-manifest-materializations-"));
  execFileSync("git", ["init", "-q", "--initial-branch=main"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.name", "materialization-test"], { cwd: repoRoot });
  fs.mkdirSync(path.join(repoRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "100xfenok-next/public/data"), { recursive: true });
  const manifestPath = path.join(repoRoot, "data/admin/lane-commit-manifest.json");
  write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const route of routes) {
    const source = path.join(repoRoot, route.source);
    if (route.mode === "rsync_tree") {
      write(path.join(source, "keep.json"), `${route.source}\n`);
      write(path.join(source, "nested/deep.json"), "deep\n");
      fs.mkdirSync(path.join(source, "empty"), { recursive: true });
      if (route.source === "data/stockanalysis") {
        write(path.join(source, "etfs/SPY.json"), '{"ticker":"SPY"}\n');
        write(path.join(source, "nested/etfs/keep.json"), '{"nested":true}\n');
        write(
          path.join(repoRoot, route.destination, "etfs/shards/index.json"),
          '{"compatibility_mode":"shard-only"}\n',
        );
      }
    } else write(source, `${route.source}\n`);
  }
  execFileSync("git", ["add", "-A"], { cwd: repoRoot });
  execFileSync("git", ["commit", "-qm", "fixture baseline"], { cwd: repoRoot });
  return { repoRoot, manifestPath };
}

function runHelper(fixture, args) {
  return spawnSync(process.execPath, [helperPath, "--repo-root", fixture.repoRoot, "--manifest", fixture.manifestPath, ...args], {
    cwd: fixture.repoRoot,
    encoding: "utf8",
  });
}

{
  const fixture = makeFixture();
  for (const route of routes.filter((entry) => entry.mode === "rsync_tree")) {
    write(path.join(fixture.repoRoot, route.destination, "stale.json"), "stale\n");
  }
  const result = runHelper(fixture, ["--all"]);
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  assert.match(result.stdout, /selected=8 materialized=8/);
  for (const route of routes) {
    const source = path.join(fixture.repoRoot, route.source);
    const destination = path.join(fixture.repoRoot, route.destination);
    if (route.mode === "rsync_tree") {
      assert.equal(fs.existsSync(path.join(destination, "stale.json")), false);
      assert.equal(fs.readFileSync(path.join(destination, "keep.json"), "utf8"), fs.readFileSync(path.join(source, "keep.json"), "utf8"));
      assert.equal(fs.readFileSync(path.join(destination, "nested/deep.json"), "utf8"), "deep\n");
      assert.equal(fs.statSync(path.join(destination, "empty")).isDirectory(), true);
    } else assert.equal(fs.readFileSync(destination, "utf8"), fs.readFileSync(source, "utf8"));
  }
  const stockanalysisDestination = path.join(
    fixture.repoRoot,
    "100xfenok-next/public/data/stockanalysis/etfs",
  );
  assert.equal(fs.existsSync(path.join(stockanalysisDestination, "SPY.json")), false);
  assert.equal(
    fs.readFileSync(path.join(stockanalysisDestination, "shards/index.json"), "utf8"),
    '{"compatibility_mode":"shard-only"}\n',
  );
  assert.equal(
    fs.readFileSync(
      path.join(
        fixture.repoRoot,
        "100xfenok-next/public/data/stockanalysis/nested/etfs/keep.json",
      ),
      "utf8",
    ),
    '{"nested":true}\n',
  );
}

// A missing optional source removes an existing public mirror so stale bytes
// cannot survive after the canonical source has disappeared.
{
  const fixture = makeFixture();
  const optionalRoute = routes.find((route) => route.required === false);
  assert.ok(optionalRoute);
  const source = path.join(fixture.repoRoot, optionalRoute.source);
  const destination = path.join(fixture.repoRoot, optionalRoute.destination);
  write(destination, "stale optional mirror\n");
  fs.rmSync(source);
  const result = runHelper(fixture, ["--all"]);
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  assert.match(result.stdout, /selected=8 materialized=8/);
  assert.equal(fs.existsSync(destination), false);
}

// An optional source and destination that are both absent are a no-op; the
// remaining required routes still materialize.
{
  const fixture = makeFixture();
  const optionalRoute = routes.find((route) => route.required === false);
  assert.ok(optionalRoute);
  fs.rmSync(path.join(fixture.repoRoot, optionalRoute.source));
  const result = runHelper(fixture, ["--all"]);
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  assert.match(result.stdout, /selected=8 materialized=7/);
  assert.equal(fs.existsSync(path.join(fixture.repoRoot, optionalRoute.destination)), false);
}

// Every selected route is preflighted before the first destructive rsync.
{
  const fixture = makeFixture();
  const stale = path.join(fixture.repoRoot, routes[0].destination, "stale.json");
  write(stale, "must survive failed preflight\n");
  fs.rmSync(path.join(fixture.repoRoot, routes[0].source), { recursive: true });
  const result = runHelper(fixture, ["--all"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /required source is missing/);
  assert.equal(fs.readFileSync(stale, "utf8"), "must survive failed preflight\n");
}

// A structurally valid but drifted route cannot override the generated contract.
{
  const fixture = makeFixture();
  const drifted = structuredClone(manifest);
  drifted.update_manifest.materializations[0].destination = "100xfenok-next/public/data/slickcharts-drifted";
  write(fixture.manifestPath, `${JSON.stringify(drifted, null, 2)}\n`);
  const result = runHelper(fixture, ["--all"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /manifest materializations are stale/);
}

// An empty rsync source cannot authorize deletion of an existing public tree.
{
  const fixture = makeFixture();
  const stale = path.join(fixture.repoRoot, routes[0].destination, "stale.json");
  write(stale, "must survive empty source\n");
  fs.rmSync(path.join(fixture.repoRoot, routes[0].source), { recursive: true });
  fs.mkdirSync(path.join(fixture.repoRoot, routes[0].source), { recursive: true });
  const result = runHelper(fixture, ["--all"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /rsync_tree source is empty/);
  assert.equal(fs.readFileSync(stale, "utf8"), "must survive empty source\n");
}

// A reset retry fails closed if untracked source content survived the reset.
{
  const fixture = makeFixture();
  const tracked = path.join(fixture.repoRoot, routes[0].source, "keep.json");
  const untracked = path.join(fixture.repoRoot, routes[0].source, "stale-untracked.json");
  write(tracked, "pre-reset mutation\n");
  write(untracked, "stale\n");
  execFileSync("git", ["reset", "--hard", "HEAD"], { cwd: fixture.repoRoot });
  assert.equal(fs.readFileSync(tracked, "utf8"), `${routes[0].source}\n`);
  assert.equal(fs.existsSync(untracked), true);
  const result = runHelper(fixture, ["--all", "--validate-only", "--assert-no-untracked"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /untracked or ignored pre-reset route source content/);
}

// Ignored source residue also survives reset and must not bypass the retry gate.
{
  const fixture = makeFixture();
  write(path.join(fixture.repoRoot, ".gitignore"), "data/slickcharts/ignored.tmp\n");
  execFileSync("git", ["add", ".gitignore"], { cwd: fixture.repoRoot });
  execFileSync("git", ["commit", "-qm", "ignore fixture"], { cwd: fixture.repoRoot });
  const ignored = path.join(fixture.repoRoot, routes[0].source, "ignored.tmp");
  write(ignored, "ignored stale state\n");
  execFileSync("git", ["reset", "--hard", "HEAD"], { cwd: fixture.repoRoot });
  assert.equal(fs.existsSync(ignored), true);
  const result = runHelper(fixture, ["--all", "--validate-only", "--assert-no-untracked"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /untracked or ignored pre-reset route source content/);
}

for (const target of ["source", "destination"]) {
  const fixture = makeFixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "update-manifest-outside-"));
  const routePath = path.join(fixture.repoRoot, routes[0][target]);
  fs.rmSync(routePath, { recursive: true, force: true });
  fs.symlinkSync(outside, routePath);
  const result = runHelper(fixture, ["--all"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /contains a symlink/);
}

// A symlink in an existing destination ancestor is rejected before mkdir/copy.
{
  const fixture = makeFixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "update-manifest-ancestor-outside-"));
  const ancestor = path.join(fixture.repoRoot, "100xfenok-next/public/data/computed");
  fs.symlinkSync(outside, ancestor);
  const result = runHelper(fixture, ["--all"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /contains a symlink/);
}

{
  const fixture = makeFixture();
  const swapped = structuredClone(routes);
  swapped[0].source = routes[0].destination;
  assert.throws(() => validateMaterializationRoutes({ repoRoot: fixture.repoRoot, routes: swapped }), /outside canonical data root/);
  const overlapping = structuredClone(routes);
  overlapping[0].destination = "data/slickcharts/public";
  assert.throws(() => validateMaterializationRoutes({ repoRoot: fixture.repoRoot, routes: overlapping }), /outside public data root/);
  const duplicate = structuredClone(routes);
  duplicate[1].destination = duplicate[0].destination;
  assert.throws(() => validateMaterializationRoutes({ repoRoot: fixture.repoRoot, routes: duplicate }), /duplicates a destination/);
  const publicEscape = structuredClone(routes);
  publicEscape[0].destination = "100xfenok-next/public/escape";
  assert.throws(() => validateMaterializationRoutes({ repoRoot: fixture.repoRoot, routes: publicEscape }), /outside public data root/);
  const wrongType = structuredClone(routes);
  wrongType[0] = { ...wrongType[0], mode: "cp_file", delete: false, trailing_slash: false };
  assert.throws(() => validateMaterializationRoutes({ repoRoot: fixture.repoRoot, routes: wrongType }), /cp_file source is not a file/);
  const wrongRsyncType = structuredClone(routes);
  wrongRsyncType[0].source = routes.at(-1).source;
  assert.throws(() => validateMaterializationRoutes({ repoRoot: fixture.repoRoot, routes: wrongRsyncType }), /rsync_tree source is not a directory/);
  const trailingSlashDrift = structuredClone(routes);
  trailingSlashDrift[0].trailing_slash = false;
  assert.throws(() => validateMaterializationRoutes({ repoRoot: fixture.repoRoot, routes: trailingSlashDrift }), /rsync_tree flags are invalid/);
  const cpDeleteDrift = structuredClone(routes);
  cpDeleteDrift.at(-1).delete = true;
  assert.throws(() => validateMaterializationRoutes({ repoRoot: fixture.repoRoot, routes: cpDeleteDrift }), /cp_file flags are invalid/);
  const unsafeExclude = structuredClone(routes);
  unsafeExclude[0].excludes = ["../outside"];
  assert.throws(() => validateMaterializationRoutes({ repoRoot: fixture.repoRoot, routes: unsafeExclude }), /excludes\[0\] is unsafe/);
  const globExclude = structuredClone(routes);
  globExclude[0].excludes = ["etf*"];
  assert.throws(() => validateMaterializationRoutes({ repoRoot: fixture.repoRoot, routes: globExclude }), /exact relative subtree/);
  const cpExclude = structuredClone(routes);
  cpExclude.at(-1).excludes = ["nested"];
  assert.throws(() => validateMaterializationRoutes({ repoRoot: fixture.repoRoot, routes: cpExclude }), /cp_file cannot exclude subtrees/);
}

console.log("test-update-manifest-materializations: ok");
