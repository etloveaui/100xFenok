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
const DIGEST = registryDigest();

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeFixture({ workflow = WORKFLOW, includeSuccess = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage-lane-manifest-"));
  execFileSync("git", ["init", "-q", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "manifest-test"], { cwd: root });
  const manifest = buildLaneCommitManifest(LANE_REGISTRY);
  writeJson(path.join(root, "data/admin/lane-commit-manifest.json"), manifest);
  const paths = {
    always: manifest.workflows[workflow].stages.always_if_exists.map((entry) => entry.path),
    success: manifest.workflows[workflow].stages.success_if_exists.map((entry) => entry.path),
  };
  for (const entry of manifest.workflows[workflow].stages.always_if_exists) {
    const target = path.join(root, entry.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (entry.kind === "directory") {
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "fixture.json"), "{}\n");
    } else {
      fs.writeFileSync(target, "{}\n");
    }
  }
  if (includeSuccess) {
    for (const file of paths.success) {
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "{}\n");
    }
  }
  return { root, manifest, paths };
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
