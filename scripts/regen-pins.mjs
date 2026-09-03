#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_MATERIALIZATION_ORACLE_PATH,
  DEFAULT_OUTPUT_PATH as LANE_COMMIT_MANIFEST_PATH,
  emitLaneCommitManifest,
  emitMaterializationOracle,
} from "./build-lane-commit-manifest.mjs";
import {
  DEFAULT_PROJECTION_OUTPUT_PATHS,
  buildLaneRegistryProjection,
  emitLaneRegistryProjection,
} from "./build-lane-registry-projection.mjs";
import {
  DEFAULT_ENROLLMENT_OUTPUT_PATH,
  emitCloudDataPlaneEnrollment,
} from "./build-cloud-data-plane-enrollment.mjs";
import {
  COMMITTED_REPORT_PATH,
  EXPECTED_FIXTURE_PATH as DETECTION_EXPECTED_PATH,
  emitDetectionExpectedFixture,
  emitPinnedDetectionReport,
} from "./build-data-supply-detection-floor.mjs";
import {
  COMMITTED_KPI_PATH,
  PUBLIC_KPI_PATH,
  emitPinnedKpiCronCoverage,
} from "./build-fenok-data-health-kpi.mjs";
import {
  INK4_CONTRAST_FIXTURE_PATH,
  emitInk4ContrastFixture,
} from "../100xfenok-next/scripts/build-ink4-contrast-fixture.mjs";
import {
  MIGRATION_DEMAND_FIXTURE_PATHS,
  emitMigrationDemandFixture,
} from "./lib/cloud-data-plane-candidate-scope.mjs";
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
const UPDATE_MANIFEST_WORKFLOW_PATH = path.join(REPO_ROOT, ".github/workflows/update-manifest.yml");
const TRIGGER_START_MARKER = "# BEGIN GENERATED lane-commit-manifest trigger_paths";
const TRIGGER_END_MARKER = "# END GENERATED lane-commit-manifest trigger_paths";

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

function updateManifestTriggerPaths() {
  const workflow = fs.readFileSync(UPDATE_MANIFEST_WORKFLOW_PATH, "utf8");
  const start = workflow.indexOf(TRIGGER_START_MARKER);
  const end = workflow.indexOf(TRIGGER_END_MARKER, start);
  if (start < 0 || end < 0) throw new Error("update-manifest trigger_paths markers are missing");
  return workflow.slice(start + TRIGGER_START_MARKER.length, end)
    .split("\n")
    .map((line) => line.match(/^\s*-\s+(['"])(.*?)\1\s*$/u)?.[2] ?? null)
    .filter((line) => line !== null);
}

function orderedDifference(left, right) {
  const available = new Map();
  for (const value of right) available.set(value, (available.get(value) ?? 0) + 1);
  return left.filter((value) => {
    const count = available.get(value) ?? 0;
    if (count === 0) return true;
    available.set(value, count - 1);
    return false;
  });
}

function assertUpdateManifestTriggerParity(expected) {
  const actual = updateManifestTriggerPaths();
  if (JSON.stringify(actual) === JSON.stringify(expected)) return;
  const missing = orderedDifference(expected, actual);
  const extra = orderedDifference(actual, expected);
  const render = (paths) => paths.length > 0
    ? paths.map((triggerPath) => `  - '${triggerPath}'`).join("\n")
    : "  (none)";
  throw new Error(
    `update-manifest trigger_paths drift\nmissing trigger lines:\n${render(missing)}`
    + `\nextra trigger lines:\n${render(extra)}`
    + (missing.length === 0 && extra.length === 0 ? "\norder differs from lane-commit manifest" : ""),
  );
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

  emitLaneCommitManifest({ outputPath: outputFor(LANE_COMMIT_MANIFEST_PATH) });
  emitMaterializationOracle({ outputPath: outputFor(DEFAULT_MATERIALIZATION_ORACLE_PATH) });
  emitLaneRegistryProjection({
    outputPaths: DEFAULT_PROJECTION_OUTPUT_PATHS.map(outputFor),
    options: { now: projectionNow() },
  });
  await emitCloudDataPlaneEnrollment({ outputPath: outputFor(DEFAULT_ENROLLMENT_OUTPUT_PATH) });

  for (const [candidateId, relativePath] of Object.entries(MIGRATION_DEMAND_FIXTURE_PATHS)) {
    const canonicalPath = path.join(REPO_ROOT, relativePath);
    emitMigrationDemandFixture({
      repoRoot: REPO_ROOT,
      candidateId,
      sourcePath: canonicalPath,
      outputPath: outputFor(canonicalPath),
    });
  }
  emitDetectionExpectedFixture({
    sourcePath: DETECTION_EXPECTED_PATH,
    outputPath: outputFor(DETECTION_EXPECTED_PATH),
  });
  const projectedReportPath = outputFor(COMMITTED_REPORT_PATH);
  emitPinnedDetectionReport({ sourcePath: COMMITTED_REPORT_PATH, outputPath: projectedReportPath });
  emitPinnedKpiCronCoverage({
    rootSourcePath: COMMITTED_KPI_PATH,
    reportPath: projectedReportPath,
    rootOutputPath: outputFor(COMMITTED_KPI_PATH),
    publicOutputPath: outputFor(PUBLIC_KPI_PATH),
  });
  emitInk4ContrastFixture({ outputPath: outputFor(INK4_CONTRAST_FIXTURE_PATH) });
}

function generatedPaths() {
  return [
    LANE_DIGEST_PATH,
    DERIVED_DIGEST_PATH,
    POLICY_DIGEST_PATH,
    LANE_COMMIT_MANIFEST_PATH,
    DEFAULT_MATERIALIZATION_ORACLE_PATH,
    ...DEFAULT_PROJECTION_OUTPUT_PATHS,
    DEFAULT_ENROLLMENT_OUTPUT_PATH,
    ...Object.values(MIGRATION_DEMAND_FIXTURE_PATHS).map((relativePath) => path.join(REPO_ROOT, relativePath)),
    DETECTION_EXPECTED_PATH,
    COMMITTED_REPORT_PATH,
    COMMITTED_KPI_PATH,
    PUBLIC_KPI_PATH,
    INK4_CONTRAST_FIXTURE_PATH,
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
      return !fs.existsSync(canonicalPath) || !fs.readFileSync(canonicalPath).equals(fs.readFileSync(generatedPath));
    });
    if (stale.length > 0) {
      throw new Error(`generated pins are stale: ${stale.map((filePath) => path.relative(REPO_ROOT, filePath)).join(", ")}`);
    }
    const projectedManifest = JSON.parse(fs.readFileSync(tempPath(tempRoot, LANE_COMMIT_MANIFEST_PATH), "utf8"));
    assertUpdateManifestTriggerParity(projectedManifest.update_manifest.trigger_paths);
    console.log(`qa:pins ok (${generatedPaths().length} byte-identical projections)`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

await main();
