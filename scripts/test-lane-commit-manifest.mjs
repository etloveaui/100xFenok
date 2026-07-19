#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LANE_REGISTRY,
  registryDigest,
  validateLaneRegistry,
} from "./lib/lane-registry.mjs";
import {
  COMMIT_MANIFEST_SCHEMA,
  buildLaneCommitManifest,
  emitLaneCommitManifest,
  validateLaneCommitManifest,
} from "./build-lane-commit-manifest.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = path.join(REPO_ROOT, "data", "admin", "lane-commit-manifest.json");

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
assert.equal(manifest.schema_version, COMMIT_MANIFEST_SCHEMA);
assert.equal(manifest.registry_schema, LANE_REGISTRY.schema_version);
assert.equal(manifest.registry_digest, registryDigest());
assert.equal(validateLaneCommitManifest(manifest, { registry: LANE_REGISTRY }), true);

const defillama = manifest.workflows[".github/workflows/fetch-defillama.yml"];
assert.deepEqual(defillama.lanes, ["defillama_stablecoins"]);
assert.deepEqual(defillama.stages.always_if_exists.map((entry) => entry.path), [
  "data/admin/data-supply-state/detection-attempts/defillama_stablecoins.json",
  "data/admin/defillama_stablecoins/index.json",
  "data/admin/defillama_stablecoins/lkg/stablecoins.json",
]);
assert.deepEqual(defillama.stages.success_if_exists.map((entry) => entry.path), [
  "data/macro/stablecoins.json",
  "100xfenok-next/public/data/macro/stablecoins.json",
]);
assert.deepEqual(defillama.stages.success_if_exists.map((entry) => entry.required), [true, true]);
assert.deepEqual(defillama.exclude, []);

// Missing, stale, unsafe, duplicate, and undeclared workflow entries fail closed.
for (const [label, mutate] of [
  ["missing workflow", (draft) => { delete draft.workflows[".github/workflows/fetch-defillama.yml"]; }],
  ["stale digest", (draft) => { draft.registry_digest = "0".repeat(64); }],
  ["unsafe path", (draft) => { draft.workflows[".github/workflows/fetch-defillama.yml"].stages.always_if_exists[0].path = "../escape"; }],
  ["duplicate path", (draft) => {
    const stage = draft.workflows[".github/workflows/fetch-defillama.yml"].stages.always_if_exists;
    stage.push(structuredClone(stage[0]));
  }],
  ["wrong type", (draft) => { draft.workflows[".github/workflows/fetch-defillama.yml"].stages.success_if_exists[0].path = 42; }],
  ["empty stages", (draft) => {
    for (const stage of Object.keys(draft.workflows[".github/workflows/fetch-defillama.yml"].stages)) {
      draft.workflows[".github/workflows/fetch-defillama.yml"].stages[stage] = [];
    }
  }],
  ["undeclared workflow", (draft) => {
    draft.workflows[".github/workflows/not-declared.yml"] = structuredClone(
      draft.workflows[".github/workflows/fetch-defillama.yml"],
    );
  }],
]) {
  const draft = structuredClone(manifest);
  mutate(draft);
  assert.throws(
    () => validateLaneCommitManifest(draft, { registry: LANE_REGISTRY }),
    /lane-commit-manifest/,
    `validation must reject ${label}`,
  );
}

// The emitter is deterministic and --check style validation catches a stale artifact.
const rebuilt = buildLaneCommitManifest(LANE_REGISTRY);
assert.deepEqual(rebuilt, manifest, "committed manifest must be a deterministic registry projection");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lane-commit-manifest-"));
const tempPath = path.join(tempRoot, "manifest.json");
emitLaneCommitManifest({ registry: LANE_REGISTRY, outputPath: tempPath });
assert.deepEqual(JSON.parse(fs.readFileSync(tempPath, "utf8")), manifest);

// A value-changing registry edit must change the projection and digest.
const changedRegistry = structuredClone(LANE_REGISTRY);
changedRegistry.lanes[0].label = `${changedRegistry.lanes[0].label} changed`;
validateLaneRegistry(changedRegistry);
const changed = buildLaneCommitManifest(changedRegistry);
assert.notEqual(changed.registry_digest, manifest.registry_digest);
assert.notDeepEqual(changed, manifest);

console.log("test-lane-commit-manifest: ok");
