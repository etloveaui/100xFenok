#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_PROJECTION_OUTPUT_PATHS,
  buildLaneRegistryProjection,
  emitLaneRegistryProjection,
} from "./build-lane-registry-projection.mjs";
import {
  COMMITTED_REPORT_PATH,
  EXPECTED_FIXTURE_PATH as DETECTION_EXPECTED_PATH,
  emitDetectionExpectedFixture,
  emitPinnedDetectionReport,
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

function parseMode(args) {
  if (args.length === 0) return "write";
  if (args.length === 1 && args[0] === "--check") return "check";
  throw new Error("usage: node scripts/regen-pins.mjs [--check]");
}

function writeDigestFixture(sourcePath, outputPath, field, value) {
  const fixture = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  fixture[field] = value;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(fixture, null, 2)}\n`);
}

function projectionNow() {
  const fresh = new Date().toISOString();
  let old = null;
  try {
    const current = JSON.parse(fs.readFileSync(DEFAULT_PROJECTION_OUTPUT_PATHS[0], "utf8"));
    if (typeof current.generated_at === "string" && !Number.isNaN(Date.parse(current.generated_at))) {
      old = current.generated_at;
    }
  } catch {}
  if (!old) return fresh;
  try {
    buildLaneRegistryProjection(undefined, { now: old });
    return old;
  } catch (error) {
    if (error?.message?.includes("precedes")) return fresh;
    throw error;
  }
}

function tempPath(tempRoot, canonicalPath) {
  return path.join(tempRoot, path.relative(REPO_ROOT, canonicalPath));
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

  emitLaneRegistryProjection({
    outputPaths: DEFAULT_PROJECTION_OUTPUT_PATHS.map(outputFor),
    options: { now: projectionNow() },
  });

  emitDetectionExpectedFixture({
    sourcePath: DETECTION_EXPECTED_PATH,
    outputPath: outputFor(DETECTION_EXPECTED_PATH),
  });
  const projectedReportPath = outputFor(COMMITTED_REPORT_PATH);
  emitPinnedDetectionReport({ sourcePath: COMMITTED_REPORT_PATH, outputPath: projectedReportPath });
}

function generatedPaths() {
  return [
    LANE_DIGEST_PATH,
    DERIVED_DIGEST_PATH,
    POLICY_DIGEST_PATH,
    ...DEFAULT_PROJECTION_OUTPUT_PATHS,
    DETECTION_EXPECTED_PATH,
    COMMITTED_REPORT_PATH,
  ];
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  if (mode === "write") {
    await emitAll((canonicalPath) => canonicalPath);
    console.log(`regen:pins wrote ${generatedPaths().length} projections`);
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-pins-"));
  try {
    await emitAll((canonicalPath) => tempPath(tempRoot, canonicalPath));
    const stale = generatedPaths().filter((canonicalPath) => {
      const generatedPath = tempPath(tempRoot, canonicalPath);
      if (!fs.existsSync(canonicalPath)) return true;
      const committedText = fs.readFileSync(canonicalPath, "utf8");
      const generatedText = fs.readFileSync(generatedPath, "utf8");
      return committedText !== generatedText;
    });
    if (stale.length > 0) {
      throw new Error(`generated pins are stale: ${stale.map((filePath) => path.relative(REPO_ROOT, filePath)).join(", ")}`);
    }
    console.log(`qa:pins ok (${generatedPaths().length} projections matched — volatile runtime fields normalized)`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

await main();
