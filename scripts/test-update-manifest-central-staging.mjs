#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CENTRAL_COMMIT_PATHS,
  UPDATE_MANIFEST_MATERIALIZATIONS,
  buildLaneCommitManifest,
  centralCommitPathKind,
} from "./build-lane-commit-manifest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helperPath = path.join(root, "scripts/stage-update-manifest-central.mjs");
const helperSource = fs.readFileSync(helperPath, "utf8");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/update-manifest.yml"), "utf8");
// The staging contract is generated, not hand-copied: expected central policy
// comes from the builder, so adding a materialization route flows into this
// test without any list edit. No committed-artifact golden is read here.
const manifest = buildLaneCommitManifest();
const centralPaths = manifest.update_manifest.central_commit_paths;
const centralSpecs = manifest.workflows[".github/workflows/update-manifest.yml"].stages.always_if_exists;

// Contract: declared central paths are exactly the hand-maintained base plus
// one destination per materialization route, unique, and mirrored by the
// workflow stage with the builder's file/directory kind rule.
const baseSet = new Set(CENTRAL_COMMIT_PATHS);
const destinationSet = new Set(UPDATE_MANIFEST_MATERIALIZATIONS.map((route) => route.destination));
assert.equal(
  centralPaths.length,
  CENTRAL_COMMIT_PATHS.length + UPDATE_MANIFEST_MATERIALIZATIONS.length,
  "declared central paths must equal base paths plus one destination per route",
);
assert.equal(new Set(centralPaths).size, centralPaths.length, "declared central paths must be unique");
assert.ok(
  centralPaths.every((pathValue) => baseSet.has(pathValue) || destinationSet.has(pathValue)),
  "declared central paths must be base paths or materialization destinations",
);
for (const route of UPDATE_MANIFEST_MATERIALIZATIONS) {
  assert.ok(centralPaths.includes(route.destination), `declared central paths must include route destination: ${route.destination}`);
}
const isDirectoryPath = (pathValue) => centralCommitPathKind(pathValue) === "directory";
const expectedDirectories = centralPaths.filter(isDirectoryPath);
assert.deepEqual(centralSpecs.map((spec) => spec.path), centralPaths);
assert.deepEqual(centralSpecs.filter((spec) => spec.kind === "directory").map((spec) => spec.path), expectedDirectories);
assert.equal(
  centralSpecs.filter((spec) => spec.kind === "file").length,
  centralPaths.length - expectedDirectories.length,
);
assert.equal(centralSpecs.every((spec) => spec.required === false), true);
assert.equal(fs.existsSync(helperPath), true);
assert.match(helperSource, /[\"']-fdX[\"']/);
assert.doesNotMatch(helperSource, /[\"']-fdx[\"']/);
assert.equal((workflow.match(/node scripts\/stage-update-manifest-central\.mjs/g) ?? []).length, 5);
assert.equal((workflow.match(/node scripts\/test-update-manifest-central-staging\.mjs/g) ?? []).length, 0);
assert.match(workflow, /- name: Check if manifest changed[\s\S]*?stage-update-manifest-central\.mjs --check[\s\S]*?3\) echo "changed=false"/);
const retry = workflow.slice(workflow.indexOf("for attempt in 1 2 3; do"));
assert.match(retry, /git reset --hard origin\/main[\s\S]*?stage-update-manifest-central\.mjs --clean-untracked-after-reset[\s\S]*?stage-update-manifest-central\.mjs --assert-clean-after-reset/);
assert.match(retry, /stage-update-manifest-central\.mjs --check[\s\S]*?central_status[\s\S]*?stage-update-manifest-central\.mjs --stage[\s\S]*?git commit/);
assert.doesNotMatch(workflow, /git diff --quiet \\/);
assert.doesNotMatch(workflow, /git add -- \\/);
for (const pathValue of centralPaths) {
  assert.equal(workflow.includes(`${pathValue} \\`), false, `legacy central hand-list remains: ${pathValue}`);
}

// Behavior samples derived from the declared contract (no second list).
const fileSample = centralPaths.find((pathValue) => !isDirectoryPath(pathValue));
const directorySample = centralPaths.find(isDirectoryPath);
const treeDestination = UPDATE_MANIFEST_MATERIALIZATIONS.find((route) => route.mode === "rsync_tree").destination;

function write(target, contents) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function git(repoRoot, args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
}

function cached(repoRoot) {
  return git(repoRoot, ["diff", "--cached", "--name-only"]).trim().split("\n").filter(Boolean).sort();
}

function makeFixture() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "update-manifest-central-"));
  git(repoRoot, ["init", "-q", "--initial-branch=main"]);
  git(repoRoot, ["config", "user.email", "test@example.invalid"]);
  git(repoRoot, ["config", "user.name", "central-staging-test"]);
  const manifestPath = path.join(repoRoot, "data/admin/lane-commit-manifest.json");
  write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  write(path.join(repoRoot, fileSample), "baseline signals\n");
  write(path.join(repoRoot, directorySample, "index.json"), "baseline facts\n");
  write(path.join(repoRoot, treeDestination, "base.json"), "baseline slick\n");
  write(path.join(repoRoot, "unrelated.txt"), "unrelated baseline\n");
  git(repoRoot, ["add", "-A"]);
  git(repoRoot, ["commit", "-qm", "fixture baseline"]);
  return { repoRoot, manifestPath };
}

function runHelper(fixture, mode) {
  return spawnSync(process.execPath, [helperPath, "--repo-root", fixture.repoRoot, "--manifest", fixture.manifestPath, mode], {
    cwd: fixture.repoRoot,
    encoding: "utf8",
  });
}

function resetToOriginMain(fixture) {
  git(fixture.repoRoot, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  git(fixture.repoRoot, ["reset", "--hard", "origin/main"]);
}

// A Git/validation error remains fatal and cannot be reported as "changed".
{
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "update-manifest-central-not-git-"));
  const manifestPath = path.join(repoRoot, "data/admin/lane-commit-manifest.json");
  write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const result = runHelper({ repoRoot, manifestPath }, "--check");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /git diff failed/);
}

{
  const fixture = makeFixture();
  const result = runHelper(fixture, "--check");
  assert.equal(result.status, 3, `${result.stderr}\n${result.stdout}`);
  assert.match(result.stdout, new RegExp(`declared=${centralPaths.length} changed=0 staged=0`));
  assert.notEqual(runHelper(fixture, "--stage").status, 0);
}

{
  const fixture = makeFixture();
  write(path.join(fixture.repoRoot, fileSample), "changed signals\n");
  write(path.join(fixture.repoRoot, "unrelated.txt"), "unrelated unstaged\n");
  assert.equal(runHelper(fixture, "--check").status, 0);
  const staged = runHelper(fixture, "--stage");
  assert.equal(staged.status, 0, `${staged.stderr}\n${staged.stdout}`);
  assert.deepEqual(cached(fixture.repoRoot), [fileSample]);
  assert.match(git(fixture.repoRoot, ["diff", "--name-only"]), /unrelated\.txt/);
}

for (const relative of [fileSample, directorySample]) {
  const fixture = makeFixture();
  fs.rmSync(path.join(fixture.repoRoot, relative), { recursive: true });
  assert.equal(runHelper(fixture, "--check").status, 0);
  assert.equal(runHelper(fixture, "--stage").status, 0);
  assert.ok(cached(fixture.repoRoot).some((candidate) => candidate === relative || candidate.startsWith(`${relative}/`)));
}

{
  const fixture = makeFixture();
  write(path.join(fixture.repoRoot, treeDestination, "new.json"), "new\n");
  assert.equal(runHelper(fixture, "--stage").status, 0);
  assert.deepEqual(cached(fixture.repoRoot), [path.posix.join(treeDestination, "new.json")]);
}

// Reject unrelated pre-staged work before touching central paths.
{
  const fixture = makeFixture();
  write(path.join(fixture.repoRoot, "unrelated.txt"), "pre-staged unrelated\n");
  git(fixture.repoRoot, ["add", "unrelated.txt"]);
  write(path.join(fixture.repoRoot, fileSample), "central unstaged\n");
  const result = runHelper(fixture, "--stage");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /out-of-policy staged paths: unrelated\.txt/);
  assert.deepEqual(cached(fixture.repoRoot), ["unrelated.txt"]);
}

// reset restores tracked files but leaves generated untracked central residue. The
// policy-scoped cleanup removes only that residue before the clean assertion.
{
  const fixture = makeFixture();
  const tracked = path.join(fixture.repoRoot, fileSample);
  write(tracked, "tracked mutation\n");
  const residue = Array.from({ length: 100 }, (_, index) => path.join(
    fixture.repoRoot,
    treeDestination,
    `pre-reset-${String(index).padStart(3, "0")}.json`,
  ));
  for (const target of residue) write(target, "untracked residue\n");
  const unrelated = path.join(fixture.repoRoot, "unrelated-residue.txt");
  write(unrelated, "outside central policy\n");
  resetToOriginMain(fixture);
  assert.equal(fs.readFileSync(tracked, "utf8"), "baseline signals\n");
  assert.equal(residue.every((target) => fs.existsSync(target)), true);
  const dirty = runHelper(fixture, "--assert-clean-after-reset");
  assert.notEqual(dirty.status, 0);
  assert.match(dirty.stderr, /reset left central state: cached=0 changed=100 ignored=0/);
  const cleaned = runHelper(fixture, "--clean-untracked-after-reset");
  assert.equal(cleaned.status, 0, `${cleaned.stderr}\n${cleaned.stdout}`);
  assert.match(cleaned.stdout, /kind=ordinary count=100 paths=\[".*pre-reset-000\.json"/);
  assert.match(cleaned.stdout, /kind=ignored count=0 paths=\[\]/);
  assert.equal(residue.some((target) => fs.existsSync(target)), false);
  assert.equal(fs.existsSync(unrelated), true);
  assert.equal(runHelper(fixture, "--assert-clean-after-reset").status, 0);
  write(tracked, "retry rebuild\n");
  write(path.join(fixture.repoRoot, treeDestination, "rebuilt.json"), "retry public rebuild\n");
  assert.equal(runHelper(fixture, "--check").status, 0);
  assert.equal(runHelper(fixture, "--stage").status, 0);
  assert.deepEqual(cached(fixture.repoRoot), [
    path.posix.join(treeDestination, "rebuilt.json"),
    fileSample,
  ]);
}

{
  const fixture = makeFixture();
  const ignored = path.posix.join(treeDestination, "ignored.json");
  const outsideIgnored = "outside-ignored.json";
  write(path.join(fixture.repoRoot, ".gitignore"), `${ignored}\n${outsideIgnored}\n`);
  git(fixture.repoRoot, ["add", ".gitignore"]);
  git(fixture.repoRoot, ["commit", "-qm", "ignore fixture"]);
  write(path.join(fixture.repoRoot, ignored), "ignored residue\n");
  write(path.join(fixture.repoRoot, outsideIgnored), "outside ignored residue\n");
  resetToOriginMain(fixture);
  assert.notEqual(runHelper(fixture, "--assert-clean-after-reset").status, 0);
  const cleanup = runHelper(fixture, "--clean-untracked-after-reset");
  assert.equal(cleanup.status, 0, `${cleanup.stderr}\n${cleanup.stdout}`);
  assert.equal(cleanup.stdout.includes(`kind=ignored count=1 paths=${JSON.stringify([ignored])}`), true);
  assert.equal(fs.existsSync(path.join(fixture.repoRoot, ignored)), false);
  assert.equal(fs.existsSync(path.join(fixture.repoRoot, outsideIgnored)), true);
  assert.equal(runHelper(fixture, "--assert-clean-after-reset").status, 0);
}

// Cleanup is permitted only after reset has restored every tracked central path.
{
  const fixture = makeFixture();
  const tracked = path.join(fixture.repoRoot, fileSample);
  const untracked = path.join(fixture.repoRoot, treeDestination, "residue.json");
  const ignored = path.join(fixture.repoRoot, treeDestination, "ignored-residue.json");
  write(path.join(fixture.repoRoot, ".gitignore"), `${path.posix.join(treeDestination, "ignored-residue.json")}\n`);
  git(fixture.repoRoot, ["add", ".gitignore"]);
  git(fixture.repoRoot, ["commit", "-qm", "tracked refusal fixture"]);
  write(tracked, "tracked mutation\n");
  write(untracked, "untracked residue\n");
  write(ignored, "ignored residue\n");
  const cleanup = runHelper(fixture, "--clean-untracked-after-reset");
  assert.notEqual(cleanup.status, 0);
  assert.match(cleanup.stderr, /cleanup requires clean tracked state: cached=0 changed=1/);
  assert.equal(fs.existsSync(untracked), true);
  assert.equal(fs.existsSync(ignored), true);
}

// Cleanup refuses out-of-policy staged work before deleting either ordinary or
// ignored central residue.
{
  const fixture = makeFixture();
  const ignored = path.posix.join(treeDestination, "staged-guard-ignored.json");
  write(path.join(fixture.repoRoot, ".gitignore"), `${ignored}\n`);
  git(fixture.repoRoot, ["add", ".gitignore"]);
  git(fixture.repoRoot, ["commit", "-qm", "staged guard fixture"]);
  write(path.join(fixture.repoRoot, "unrelated.txt"), "pre-staged unrelated\n");
  git(fixture.repoRoot, ["add", "unrelated.txt"]);
  write(path.join(fixture.repoRoot, ignored), "ignored residue\n");
  const result = runHelper(fixture, "--clean-untracked-after-reset");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /out-of-policy staged paths: unrelated\.txt/);
  assert.equal(fs.existsSync(path.join(fixture.repoRoot, ignored)), true);
  assert.deepEqual(cached(fixture.repoRoot), ["unrelated.txt"]);
}

{
  const fixture = makeFixture();
  const drifted = structuredClone(manifest);
  drifted.update_manifest.central_commit_paths.pop();
  write(fixture.manifestPath, `${JSON.stringify(drifted, null, 2)}\n`);
  const result = runHelper(fixture, "--check");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /central_commit_paths are stale/);
}

console.log("test-update-manifest-central-staging: ok");
