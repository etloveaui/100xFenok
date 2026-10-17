#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXPECTED_FIXTURE_PATH as DETECTION_EXPECTED_PATH,
  emitDetectionExpectedFixture,
} from "./build-data-supply-detection-floor.mjs";
import { DERIVED_ASSET_REGISTRY, derivedAssetRegistryDigest } from "./lib/derived-asset-registry.mjs";
import { LANE_REGISTRY, registryDigest } from "./lib/lane-registry.mjs";
import {
  DATA_SUPPLY_POLICY_REGISTRY_PATH,
  loadDataSupplyPolicyRegistry,
  policyRegistryDigest,
} from "./data-supply-policy-registry.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LANE_DIGEST_PATH = path.join(REPO_ROOT, "scripts/fixtures/lane-registry/registry.expected.json");
const DERIVED_DIGEST_PATH = path.join(REPO_ROOT, "scripts/fixtures/derived-asset-registry/registry.expected.json");
const POLICY_DIGEST_PATH = path.join(REPO_ROOT, "scripts/fixtures/data_supply/policy_registry/registry.expected.json");

function writeDigestFixture(sourcePath, outputPath, field, value) {
  const fixture = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  fixture[field] = value;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(fixture, null, 2)}\n`);
}

async function emitAll(outputFor) {
  writeDigestFixture(LANE_DIGEST_PATH, outputFor(LANE_DIGEST_PATH), "registry_digest", registryDigest());
  writeDigestFixture(
    DERIVED_DIGEST_PATH,
    outputFor(DERIVED_DIGEST_PATH),
    "registry_digest",
    derivedAssetRegistryDigest(DERIVED_ASSET_REGISTRY),
  );
  const policyRegistry = loadDataSupplyPolicyRegistry(DATA_SUPPLY_POLICY_REGISTRY_PATH);
  writeDigestFixture(POLICY_DIGEST_PATH, outputFor(POLICY_DIGEST_PATH), "policy_digest", policyRegistryDigest(policyRegistry));

  emitDetectionExpectedFixture({
    sourcePath: DETECTION_EXPECTED_PATH,
    outputPath: outputFor(DETECTION_EXPECTED_PATH),
  });
}

function generatedPaths() {
  return [
    LANE_DIGEST_PATH,
    DERIVED_DIGEST_PATH,
    POLICY_DIGEST_PATH,
    DETECTION_EXPECTED_PATH,
  ];
}

async function main() {
  if (process.argv.length > 2) throw new Error("usage: node scripts/regen-pins.mjs");
  await emitAll((canonicalPath) => canonicalPath);
  console.log(`regen:pins wrote ${generatedPaths().length} projections`);
}

await main();
