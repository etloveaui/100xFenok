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

const yahooTicker = manifest.workflows[".github/workflows/fetch-yahoo-ticker.yml"];
assert.deepEqual(yahooTicker.lanes, ["yahoo_ticker_macro"]);
assert.deepEqual(yahooTicker.stages.always_if_exists, [
  {
    kind: "file",
    path: "data/admin/data-supply-state/detection-attempts/yahoo_ticker_macro.json",
    required: false,
  },
  {
    kind: "directory",
    path: "data/admin/yahoo-hourly-ticker",
    required: false,
  },
]);
assert.deepEqual(yahooTicker.stages.success_if_exists.map((entry) => entry.path), [
  "data/macro/yahoo-ticker.json",
  "100xfenok-next/public/data/macro/yahoo-ticker.json",
]);
assert.deepEqual(yahooTicker.exclude, []);

const treasuryTga = manifest.workflows[".github/workflows/fetch-treasury-tga.yml"];
assert.deepEqual(treasuryTga.lanes, ["treasury_tga"]);
assert.deepEqual(treasuryTga.stages.always_if_exists.map((entry) => entry.path), [
  "data/admin/data-supply-state/detection-attempts/treasury_tga.json",
  "data/admin/treasury_tga/index.json",
  "data/admin/treasury_tga/lkg/tga.json",
]);
assert.deepEqual(treasuryTga.stages.success_if_exists.map((entry) => entry.path), [
  "data/macro/tga.json",
  "100xfenok-next/public/data/macro/tga.json",
]);
assert.deepEqual(treasuryTga.exclude, []);

const fredMacro = manifest.workflows[".github/workflows/fetch-fred-macro.yml"];
assert.deepEqual(fredMacro.lanes, ["fred_macro"]);
assert.deepEqual(fredMacro.stages.always_if_exists.map((entry) => entry.path), [
  "data/admin/data-supply-state/detection-attempts/fred_macro.json",
  "data/admin/fred_macro/index.json",
  "data/admin/fred_macro/lkg/fred_macro.json",
]);
assert.deepEqual(fredMacro.stages.success_if_exists.map((entry) => entry.path), [
  "data/macro/fred-macro.json",
  "100xfenok-next/public/data/macro/fred-macro.json",
]);
assert.deepEqual(fredMacro.exclude, []);

const fredBanking = manifest.workflows[".github/workflows/fetch-fred-banking.yml"];
assert.deepEqual(fredBanking.lanes, ["fred_banking"]);
assert.deepEqual(fredBanking.stages.always_if_exists.map((entry) => entry.path), [
  "data/admin/data-supply-state/detection-attempts/fred_banking.json",
  "data/admin/fred_banking/index.json",
  "data/admin/fred_banking/lkg/daily.json",
  "data/admin/fred_banking/lkg/weekly.json",
  "data/admin/fred_banking/lkg/monthly.json",
  "data/admin/fred_banking/lkg/quarterly.json",
]);
assert.deepEqual(fredBanking.stages.success_if_exists.map((entry) => entry.path), [
  "data/macro/fred-banking-daily.json",
  "data/macro/fred-banking-weekly.json",
  "data/macro/fred-banking-monthly.json",
  "data/macro/fred-banking-quarterly.json",
  "100xfenok-next/public/data/macro/fred-banking-daily.json",
  "100xfenok-next/public/data/macro/fred-banking-weekly.json",
  "100xfenok-next/public/data/macro/fred-banking-monthly.json",
  "100xfenok-next/public/data/macro/fred-banking-quarterly.json",
]);
assert.deepEqual(fredBanking.exclude, []);

const nasdaqGiwSox = manifest.workflows[".github/workflows/fetch-nasdaq-giw-sox.yml"];
assert.deepEqual(nasdaqGiwSox.lanes, ["nasdaq_giw_sox"]);
assert.deepEqual(nasdaqGiwSox.stages.always_if_exists.map((entry) => entry.path), [
  "data/admin/data-supply-state/detection-attempts/nasdaq_giw_sox.json",
  "data/admin/nasdaq_giw_sox/index.json",
  "data/admin/nasdaq_giw_sox/lkg/constituents.json",
  "data/admin/nasdaq_giw_sox/history/constituents.json",
]);
assert.deepEqual(nasdaqGiwSox.stages.success_if_exists.map((entry) => entry.path), [
  "data/indices/nasdaq-giw-sox-constituents.json",
]);
assert.deepEqual(nasdaqGiwSox.exclude, []);

const privateOptions = manifest.workflows[".github/workflows/fetch-fenok-private-options.yml"];
assert.deepEqual(privateOptions.lanes, ["yahoo_private_options"]);
assert.deepEqual(privateOptions.stages.always_if_exists, [
  {
    kind: "file",
    path: "data/admin/data-supply-state/detection-attempts/yahoo_private_options.json",
    required: false,
  },
  {
    kind: "directory",
    path: "data/admin/yahoo_private_options",
    required: false,
  },
]);
assert.deepEqual(privateOptions.stages.success_if_exists.map((entry) => entry.path), [
  "data/computed/fenok_yahoo_private_options_availability.json",
  "100xfenok-next/public/data/computed/fenok_yahoo_private_options_availability.json",
]);
assert.deepEqual(privateOptions.exclude, []);

const sentiment = manifest.workflows[".github/workflows/fetch-sentiment.yml"];
assert.deepEqual(sentiment.lanes, ["sentiment"]);
assert.deepEqual(sentiment.stages.always_if_exists, [
  {
    kind: "file",
    path: "data/admin/data-supply-state/detection-attempts/sentiment.json",
    required: false,
  },
  {
    kind: "file",
    path: "data/admin/sentiment/index.json",
    required: false,
  },
  { kind: "glob", path: "data/admin/sentiment/current/*.json", required: false },
  { kind: "glob", path: "data/admin/sentiment/lkg/*.json", required: false },
]);
assert.deepEqual(sentiment.stages.success_if_exists, [
  { kind: "glob", path: "data/sentiment/*.json", required: false },
  { kind: "glob", path: "100xfenok-next/public/data/sentiment/*.json", required: false },
]);
assert.deepEqual(sentiment.exclude, []);

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
