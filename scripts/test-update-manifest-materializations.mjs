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
const manifest = JSON.parse(fs.readFileSync(path.join(root, "data/admin/lane-commit-manifest.json"), "utf8"));
const helperCall = "node scripts/materialize-update-manifest-routes.mjs";
const EXPECTED_ROUTES = [
  { source: "data/slickcharts", destination: "100xfenok-next/public/data/slickcharts", mode: "rsync_tree", delete: true, required: true, trailing_slash: true },
  { source: "data/yf/finance", destination: "100xfenok-next/public/data/yf/finance", mode: "rsync_tree", delete: true, required: true, trailing_slash: true },
  { source: "data/stockanalysis", destination: "100xfenok-next/public/data/stockanalysis", mode: "rsync_tree", delete: true, required: true, trailing_slash: true },
  { source: "data/indices/nasdaq-giw-sox-constituents.json", destination: "100xfenok-next/public/data/indices/nasdaq-giw-sox-constituents.json", mode: "cp_file", delete: false, required: true, trailing_slash: false },
  { source: "data/admin/fenok-edge-korea-krx-daily-index.json", destination: "100xfenok-next/public/data/admin/fenok-edge-korea-krx-daily-index.json", mode: "cp_file", delete: false, required: true, trailing_slash: false },
  { source: "data/computed/fenok_occ_options_availability.json", destination: "100xfenok-next/public/data/computed/fenok_occ_options_availability.json", mode: "cp_file", delete: false, required: true, trailing_slash: false },
  { source: "data/computed/market_facts/index.json", destination: "100xfenok-next/public/data/computed/market_facts/index.json", mode: "cp_file", delete: false, required: true, trailing_slash: false },
];

assert.deepEqual(manifest.update_manifest.materializations, EXPECTED_ROUTES);
assert.equal((workflow.match(/node scripts\/materialize-update-manifest-routes\.mjs/g) ?? []).length, 3);
const initialProjection = workflow.slice(
  workflow.indexOf("- name: Project manifest-owned public mirrors"),
  workflow.indexOf("- name: Export computed signals"),
);
assert.match(initialProjection, /materialize-update-manifest-routes\.mjs --all[\s\S]*?validate-slickcharts-integrity\.py[\s\S]*?diff -qr data\/slickcharts/);
assert.ok(workflow.indexOf("- name: Build shared market and stock promotion state") < workflow.indexOf("- name: Project manifest-owned public mirrors"));
assert.ok(workflow.indexOf("- name: Project manifest-owned public mirrors") < workflow.indexOf("- name: Build phase2 closeout indexes"));
const retry = workflow.slice(workflow.indexOf("for attempt in 1 2 3; do"));
assert.match(retry, /git reset --hard origin\/main[\s\S]*?materialize-update-manifest-routes\.mjs --all --validate-only --assert-no-untracked/);
assert.match(retry, /write-fenok-s1-stock-public-promotion-dry-run\.mjs --check[\s\S]*?materialize-update-manifest-routes\.mjs --all[\s\S]*?validate-slickcharts-integrity\.py[\s\S]*?diff -qr data\/slickcharts[\s\S]*?export-computed-signals\.mjs[\s\S]*?build-phase2-closeout-indexes\.mjs/);
assert.match(retry, /git reset --hard origin\/main[\s\S]*?node scripts\/test-update-manifest-materializations\.mjs[\s\S]*?materialize-update-manifest-routes\.mjs --all --validate-only/);
assert.equal((workflow.match(/materialize-update-manifest-routes\.mjs --all(?! --validate-only)/g) ?? []).length, 2);
assert.doesNotMatch(workflow, /--route-source/);
assert.doesNotMatch(workflow, /rsync -a --checksum --delete (?:data\/slickcharts|data\/yf\/finance|data\/stockanalysis)/);
assert.doesNotMatch(workflow, /cp data\/(?:indices\/nasdaq-giw-sox-constituents|admin\/fenok-edge-korea-krx-daily-index|computed\/fenok_occ_options_availability|computed\/market_facts\/index)\.json/);
assert.equal(fs.existsSync(path.join(root, "scripts/materialize-update-manifest-routes.mjs")), true, `${helperCall} must exist`);

const helperPath = path.join(root, "scripts/materialize-update-manifest-routes.mjs");
const routes = manifest.update_manifest.materializations;
const orderedModes = orderMaterializations(routes).map((route) => route.mode);
assert.deepEqual(orderedModes, ["cp_file", "cp_file", "cp_file", "cp_file", "rsync_tree", "rsync_tree", "rsync_tree"]);

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
  assert.match(result.stdout, /selected=7 materialized=7/);
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
}

// Every selected route is preflighted before the first destructive rsync.
{
  const fixture = makeFixture();
  const stale = path.join(fixture.repoRoot, routes[0].destination, "stale.json");
  write(stale, "must survive failed preflight\n");
  fs.rmSync(path.join(fixture.repoRoot, routes.at(-1).source));
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
}

console.log("test-update-manifest-materializations: ok");
