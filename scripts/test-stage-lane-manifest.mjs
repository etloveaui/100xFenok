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
const DIGEST = registryDigest();

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeFixture({ includeSuccess = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage-lane-manifest-"));
  execFileSync("git", ["init", "-q", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "manifest-test"], { cwd: root });
  const manifest = buildLaneCommitManifest(LANE_REGISTRY);
  writeJson(path.join(root, "data/admin/lane-commit-manifest.json"), manifest);
  const paths = {
    always: manifest.workflows[WORKFLOW].stages.always_if_exists.map((entry) => entry.path),
    success: manifest.workflows[WORKFLOW].stages.success_if_exists.map((entry) => entry.path),
  };
  for (const file of paths.always) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "{}\n");
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

function run(root, stage, extra = []) {
  return spawnSync("bash", [HELPER, "--repo-root", root, "--manifest", path.join(root, "data/admin/lane-commit-manifest.json"), "--workflow", WORKFLOW, "--stage", stage, "--expected-digest", DIGEST, ...extra], {
    cwd: root,
    encoding: "utf8",
  });
}

function cached(root) {
  return execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: root, encoding: "utf8" })
    .trim().split("\n").filter(Boolean).sort();
}

// Pilot contract: each stage is selected independently and the applied set is exact.
{
  const fixture = makeFixture();
  const always = run(fixture.root, "always_if_exists");
  assert.equal(always.status, 0, `${always.stderr}\n${always.stdout}`);
  assert.match(always.stdout, /workflow=.github\/workflows\/fetch-defillama\.yml/);
  assert.match(always.stdout, /stage=always_if_exists/);
  assert.deepEqual(cached(fixture.root), fixture.paths.always.sort());

  const success = run(fixture.root, "success_if_exists");
  assert.equal(success.status, 0, success.stderr);
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
