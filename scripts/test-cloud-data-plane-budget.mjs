#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CANDIDATE_PLANNING_POLICY,
  DEFAULT_CLOUD_DATA_PLANE_POLICY,
  buildCloudDataPlaneCatalog,
  buildCloudDataPlaneReport,
  calculateCloudDataPlaneBudget,
  cloudDataPlaneExitCode,
  inventoryCloudDataPlaneRoots,
  validateCloudDataPlanePolicy,
} from "./lib/cloud-data-plane-budget.mjs";
import { canonicalJson } from "./lib/json-canonical.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_ROOT = path.join(REPO_ROOT, "scripts", "fixtures", "cloud-data-plane-budget");
const readFixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, name), "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));

const baseline = readFixture("account-baseline.json");
const demand = readFixture("request-demand.json");
const policy = readFixture("policy.json");

// Exact arithmetic: current + previous + in-progress slots are measured separately.
{
  const result = calculateCloudDataPlaneBudget({
    inventory: { complete: true, file_count: 2, bytes: 1_000_000_000 },
    accountBaseline: baseline,
    requestDemand: demand,
    policy,
  });
  assert.deepEqual(result.r2.slots.current, { bytes: 1_000_000_000, objects: 2, complete: true });
  assert.deepEqual(result.r2.slots.previous, { bytes: 1_000_000_000, objects: 2, complete: true });
  assert.deepEqual(result.r2.slots.in_progress, { bytes: 1_000_000_000, objects: 2, complete: true });
  assert.equal(result.r2.peak_objects.lower_bound, 6);
  assert.equal(result.r2.storage_byte_days.lower_bound, 90_000_000_000);
  assert.equal(result.r2.metrics.decimal_gb_month.lower_bound, 3);
  assert.equal(result.r2.class_a_breakdown.put.lower_bound, 18);
  assert.equal(result.r2.class_a_breakdown.copy.lower_bound, 9);
  assert.equal(result.r2.class_a_breakdown.list.lower_bound, 5);
  assert.equal(result.r2.class_a_breakdown.delete_free.lower_bound, 5);
  assert.equal(result.r2.metrics.class_a_operations_per_month.lower_bound, 32);
  assert.equal(result.r2.metrics.class_b_operations_per_month.lower_bound, 55);
  assert.equal(result.d1.metrics.account_bytes.lower_bound, 2500);
  assert.equal(result.d1.metrics.rows_read_per_day.lower_bound, 85);
  assert.equal(result.d1.metrics.rows_written_per_day.lower_bound, 33);
  assert.equal(result.d1.metrics.queries_per_worker_invocation.lower_bound, 6);
  assert.equal(result.d1.purge_policy.total_purge_batch_rows, 3);
  assert.deepEqual(
    result.d1.table_contracts.rows.map(({ id, projected_rows, max_rows, verdict }) => ({
      id,
      projected_rows,
      max_rows,
      verdict,
    })),
    [
      { id: "assets", projected_rows: 150, max_rows: 1000, verdict: "pass" },
      { id: "pointers", projected_rows: 20, max_rows: 100, verdict: "pass" },
    ],
  );
  assert.equal(result.kv.pointer_contract.candidate_pointers, 1);
  assert.equal(result.kv.pointer_contract.account_pointers.lower_bound, 2);
  assert.equal(result.kv.metrics.stored_bytes.lower_bound, 160);
  assert.equal(result.verdict, "pass");
}

// Missing or partial account facts cannot be promoted to a pass.
{
  const missing = calculateCloudDataPlaneBudget({
    inventory: { complete: true, file_count: 2, bytes: 1_000_000_000 },
    accountBaseline: null,
    requestDemand: demand,
    policy,
  });
  assert.equal(missing.verdict, "not_verified");
  assert.equal(missing.r2.metrics.decimal_gb_month.lower_bound, 3);

  const partial = calculateCloudDataPlaneBudget({
    inventory: { complete: true, file_count: 2, bytes: 1_000_000_000 },
    accountBaseline: { r2: { slots: { previous: { bytes: 0, objects: 0 } } } },
    requestDemand: demand,
    policy,
  });
  assert.equal(partial.verdict, "not_verified");
}

// Account-reported zero prior slots never shrink the conservative three-slot plan.
{
  const zeroSlots = clone(baseline);
  zeroSlots.r2.slots.previous = { bytes: 0, objects: 0 };
  zeroSlots.r2.slots.in_progress = { bytes: 0, objects: 0 };
  const result = calculateCloudDataPlaneBudget({
    inventory: { complete: true, file_count: 2, bytes: 1_000_000_000 },
    accountBaseline: zeroSlots,
    requestDemand: demand,
    policy,
  });
  assert.equal(result.r2.metrics.decimal_gb_month.lower_bound, 3);
  assert.equal(result.r2.peak_objects.lower_bound, 6);
}

// Table bounds, index-amplified purge writes, and the single-pointer model fail closed.
{
  const oversizedTable = clone(demand);
  oversizedTable.d1.tables[0].max_rows = 149;
  const tableResult = calculateCloudDataPlaneBudget({
    inventory: { complete: true, file_count: 2, bytes: 1_000_000_000 },
    accountBaseline: baseline,
    requestDemand: oversizedTable,
    policy,
  });
  assert.equal(tableResult.d1.table_contracts.verdict, "fail");
  assert.equal(tableResult.verdict, "fail");

  const twoPointers = clone(demand);
  twoPointers.kv.pointers = 2;
  const pointerResult = calculateCloudDataPlaneBudget({
    inventory: { complete: true, file_count: 2, bytes: 1_000_000_000 },
    accountBaseline: baseline,
    requestDemand: twoPointers,
    policy,
  });
  assert.equal(pointerResult.kv.pointer_contract.verdict, "fail");
  assert.equal(pointerResult.verdict, "fail");
}

// A known lower-bound exceedance wins over unrelated missing evidence.
{
  const result = calculateCloudDataPlaneBudget({
    inventory: { complete: true, file_count: 2, bytes: 4_000_000_000 },
    accountBaseline: null,
    requestDemand: null,
    policy,
  });
  assert.equal(result.r2.hard_limit.checks.decimal_gb_month.verdict, "fail");
  assert.equal(result.verdict, "fail");
}

// Planning lines and platform hard limits remain separate gates.
{
  const planningPolicy = clone(policy);
  planningPolicy.r2.planning_line.decimal_gb_month = 2.9;
  const result = calculateCloudDataPlaneBudget({
    inventory: { complete: true, file_count: 2, bytes: 1_000_000_000 },
    accountBaseline: baseline,
    requestDemand: demand,
    policy: planningPolicy,
  });
  assert.equal(result.r2.hard_limit.verdict, "pass");
  assert.equal(result.r2.planning_line.verdict, "fail");
  assert.equal(result.verdict, "fail");
}

// Frozen policy provenance and the intentionally sparse planning lines are exact.
{
  assert.equal(DEFAULT_CLOUD_DATA_PLANE_POLICY.verified_on, "2026-07-30");
  assert.deepEqual(
    Object.keys(DEFAULT_CLOUD_DATA_PLANE_POLICY.r2.planning_line).sort(),
    ["class_a_operations_per_month", "decimal_gb_month"],
  );
  assert.deepEqual(
    Object.keys(DEFAULT_CLOUD_DATA_PLANE_POLICY.kv.planning_line),
    ["writes_per_day"],
  );
  assert.equal(DEFAULT_CLOUD_DATA_PLANE_POLICY.d1.hard_limit.database_bytes, 500_000_000);
  assert.equal(DEFAULT_CLOUD_DATA_PLANE_POLICY.d1.hard_limit.queries_per_worker_invocation, 50);
  assert.equal(validateCloudDataPlanePolicy(DEFAULT_CLOUD_DATA_PLANE_POLICY), true);
  const emptyLimits = clone(policy);
  emptyLimits.r2.hard_limit = {};
  emptyLimits.r2.planning_line = {};
  assert.throws(() => validateCloudDataPlanePolicy(emptyLimits), /keys must be exactly/);
  const garbageSchema = clone(policy);
  garbageSchema.schema_version = "garbage";
  assert.throws(() => validateCloudDataPlanePolicy(garbageSchema), /policy schema/);
  const inventedPlanningLine = clone(policy);
  inventedPlanningLine.r2.planning_line.class_b_operations_per_month = 8_000_000;
  assert.throws(() => validateCloudDataPlanePolicy(inventedPlanningLine), /keys must be exactly/);
}

// Estate planning coverage stays deliberately partial; candidate planning
// covers the same six metrics without relabelling the estate result.
{
  const inputs = {
    inventory: { complete: true, file_count: 2, bytes: 1_000_000_000 },
    accountBaseline: baseline,
    requestDemand: demand,
    policy: DEFAULT_CLOUD_DATA_PLANE_POLICY,
  };
  const estate = calculateCloudDataPlaneBudget(inputs);
  assert.deepEqual(
    estate.r2.planning_line.coverage.ungoverned,
    ["class_b_operations_per_month"],
  );
  assert.deepEqual(
    estate.d1.planning_line.coverage.ungoverned.sort(),
    ["max_row_or_blob_bytes", "queries_per_worker_invocation"],
  );
  assert.deepEqual(
    estate.kv.planning_line.coverage.ungoverned.sort(),
    ["max_pointer_bytes", "reads_per_day", "stored_bytes"],
  );

  const candidate = calculateCloudDataPlaneBudget({
    ...inputs,
    candidatePlanning: CANDIDATE_PLANNING_POLICY,
  });
  for (const service of ["r2", "d1", "kv"]) {
    assert.deepEqual(
      candidate[service].planning_line.coverage.ungoverned,
      [],
      `${service} candidate planning must govern every candidate metric`,
    );
    assert.deepEqual(
      candidate[service].estate_planning_line.coverage.ungoverned,
      estate[service].planning_line.coverage.ungoverned,
      `${service} candidate report must preserve estate gaps`,
    );
  }
}

{
  assert.equal(cloudDataPlaneExitCode("pass"), 0);
  assert.equal(cloudDataPlaneExitCode("fail"), 1);
  assert.equal(cloudDataPlaneExitCode("not_verified"), 2);
  assert.equal(cloudDataPlaneExitCode("invalid"), 64);
}

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cloud-data-plane-budget-"));
try {
  fs.mkdirSync(path.join(fixtureRoot, "data", "computed", "tree"), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, "data", "computed", "a.json"), "a\n");
  fs.writeFileSync(path.join(fixtureRoot, "data", "computed", "b.json"), "bb\n");
  fs.writeFileSync(path.join(fixtureRoot, "data", "computed", "tree", "c.json"), "ccc\n");

  const laneRegistry = {
    schema_version: "fixture-lanes/v1",
    providers: [
      { id: "provider_a", label: "Provider A", class: "external_data" },
      { id: "provider_b", label: "Provider B", class: "external_data" },
    ],
    lanes: [
      {
        id: "lane_a",
        lane_class: "detection_floor",
        owner_workflow: ".github/workflows/a.yml",
        privacy_class: "public_mirror",
        enforcement: "live",
        provider_refs: [{ provider_id: "provider_a", role: "source", members: null }],
        cadence: { kind: "daily" },
        roots: {
          canonical_outputs: ["data/computed/a.json"],
          public_mirror: ["public/a.json"],
        },
        recovery_store: "data/admin/a.json",
      },
      {
        id: "lane_b",
        lane_class: "auxiliary",
        owner_workflow: ".github/workflows/b.yml",
        privacy_class: "private",
        enforcement: "shadow",
        provider_refs: [{ provider_id: "provider_b", role: "source", members: null }],
        cadence: { kind: "weekly" },
        roots: {
          canonical_outputs: [],
          public_mirror: [],
        },
        recovery_store: null,
      },
    ],
  };
  const derivedRegistry = {
    schema_version: "fixture-derived/v1",
    assets: [
      {
        id: "asset_a",
        lifecycle: "active",
        owner_workflow: ".github/workflows/a.yml",
        writer: "scripts/a.mjs",
        inputs: [{ kind: "lane", ref: "lane_a" }],
        cadence: { kind: "daily" },
        privacy_class: "public_mirror",
        public_serving_status: "active",
        public_outputs: [{ kind: "file", path: "public/a.json" }],
        retention: { kind: "snapshot" },
        recovery: "rebuild_from_inputs",
        recovery_evidence: "scripts/a.mjs",
        outputs: [{ kind: "file", path: "data/computed/a.json" }],
      },
      {
        id: "asset_b",
        lifecycle: "active",
        owner_workflow: ".github/workflows/b.yml",
        writer: "scripts/b.mjs",
        inputs: [
          { kind: "asset", ref: "asset_a" },
          { kind: "lane", ref: "lane_b" },
        ],
        cadence: { kind: "daily" },
        privacy_class: "private",
        public_serving_status: "private",
        public_outputs: [],
        retention: { kind: "snapshot" },
        recovery: "rebuild_from_inputs",
        recovery_evidence: "scripts/b.mjs",
        outputs: [
          { kind: "file", path: "data/computed/b.json" },
          { kind: "directory", path: "data/computed/tree" },
        ],
      },
    ],
  };
  const detectionConfig = {
    schema_version: "fixture-detection/v1",
    lanes: [
      {
        id: "lane_a",
        producer_members: [{
          id: "lane_a",
          schedule: ["0 0 * * *"],
          cadence_calendar: "utc",
          cadence_declaration: { kind: "github_workflow", evidence: ".github/workflows/a.yml" },
        }],
        freshness: { unit: "hours", max_staleness: 24 },
      },
    ],
  };

  const first = buildCloudDataPlaneCatalog({
    repoRoot: fixtureRoot,
    laneRegistry,
    derivedRegistry,
    detectionConfig,
  });
  const second = buildCloudDataPlaneCatalog({
    repoRoot: fixtureRoot,
    laneRegistry,
    derivedRegistry,
    detectionConfig,
  });
  assert.equal(canonicalJson(first), canonicalJson(second), "catalog JSON must be deterministic");
  assert.deepEqual(
    first.derived_assets.find((asset) => asset.id === "asset_b").provider_ids,
    ["provider_a", "provider_b"],
  );
  assert.equal(
    first.lanes.find((lane) => lane.id === "lane_a").current_state.status,
    "not_verified",
  );
  assert.equal(
    first.lanes.find((lane) => lane.id === "lane_b").expected_arrival.status,
    "not_verified",
  );
  assert.equal(first.inventory.file_count, 3);
  assert.equal(first.inventory.bytes, 9);
  assert.equal(JSON.stringify(first).includes(fixtureRoot), false, "report must not leak absolute paths");

  fs.mkdirSync(path.join(fixtureRoot, "data", "unowned"), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, "data", "unowned", "hidden.json"), "hidden\n");
  const unowned = inventoryCloudDataPlaneRoots({ repoRoot: fixtureRoot, laneRegistry, derivedRegistry });
  assert.equal(unowned.file_count, 4);
  assert.equal(unowned.unowned.file_count, 1);
  assert.equal(unowned.unowned.bytes, 7);
  assert.equal(unowned.complete, false);
  assert.equal(unowned.unowned.top_level_groups[0].group, "unowned");
  const unownedBudget = calculateCloudDataPlaneBudget({
    inventory: unowned,
    accountBaseline: baseline,
    requestDemand: demand,
    policy,
  });
  assert.notEqual(unownedBudget.verdict, "pass", "unowned estate bytes must not false-pass");
  fs.rmSync(path.join(fixtureRoot, "data", "unowned"), { recursive: true });

  const falseOwnership = clone(derivedRegistry);
  falseOwnership.assets[1].outputs[0].path = "data/computed/a.json";
  assert.throws(
    () => inventoryCloudDataPlaneRoots({
      repoRoot: fixtureRoot,
      laneRegistry,
      derivedRegistry: falseOwnership,
    }),
    /false path ownership/,
  );

  const caseCollision = clone(derivedRegistry);
  caseCollision.assets[1].outputs[0].path = "data/computed/A.json";
  assert.throws(
    () => inventoryCloudDataPlaneRoots({
      repoRoot: fixtureRoot,
      laneRegistry,
      derivedRegistry: caseCollision,
    }),
    /case-colliding/,
  );

  const cycle = clone(derivedRegistry);
  cycle.assets[0].inputs = [{ kind: "asset", ref: "asset_b" }];
  assert.throws(
    () => buildCloudDataPlaneCatalog({
      repoRoot: fixtureRoot,
      laneRegistry,
      derivedRegistry: cycle,
      detectionConfig,
    }),
    /derived asset cycle/,
  );

  const symlinkRegistry = clone(derivedRegistry);
  fs.symlinkSync(path.join(fixtureRoot, "data", "computed", "a.json"), path.join(fixtureRoot, "data", "computed", "linked.json"));
  symlinkRegistry.assets[1].outputs[0].path = "data/computed/linked.json";
  assert.throws(
    () => inventoryCloudDataPlaneRoots({
      repoRoot: fixtureRoot,
      laneRegistry,
      derivedRegistry: symlinkRegistry,
    }),
    /symlink/,
  );
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

// The shipped full registries and current computed tree are consumed directly.
{
  const first = buildCloudDataPlaneReport({ repoRoot: REPO_ROOT });
  const second = buildCloudDataPlaneReport({ repoRoot: REPO_ROOT });
  assert.equal(first.verdict, "fail");
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.ok(first.catalog.providers.length > 0);
  assert.ok(first.catalog.lanes.length > 0);
  assert.ok(first.catalog.derived_assets.length > 0);
  assert.ok(first.catalog.inventory.file_count > 0);
  const derivedOnlyCount = first.catalog.derived_assets
    .flatMap((asset) => asset.output_inventory)
    .reduce((sum, root) => sum + root.file_count, 0);
  assert.ok(first.catalog.inventory.file_count > derivedOnlyCount);
  // The 1929 crash artifact is now a declared optional path: it is produced only
  // on an explicit manual selection, so its absence is the normal state and it
  // moved out of missing_paths into optional_absent. Every estate file is now
  // owned or declared, so the inventory completes.
  assert.deepEqual(first.catalog.inventory.missing_paths, []);
  assert.deepEqual(first.catalog.inventory.optional_absent, ["data/slickcharts/1929crash.json"]);
  assert.equal(first.catalog.inventory.complete, true);
  assert.equal(first.catalog.inventory.unowned.file_count, 0);
  assert.ok(first.catalog.inventory.retained.file_count > 0);
  assert.equal(first.catalog.verdict, "not_verified");
  assert.equal(first.budget.r2.planning_line.verdict, "fail");
  assert.equal(JSON.stringify(first).includes(REPO_ROOT), false);
  assert.equal(first.budget.input_provenance.policy.status, "verified");
  assert.match(first.budget.input_provenance.policy.digest, /^[0-9a-f]{64}$/);
  assert.equal(first.budget.input_provenance.account_baseline.status, "not_verified");
  assert.match(first.catalog.source_digests.data_health_kpi, /^[0-9a-f]{64}$/);
  assert.notEqual(
    first.catalog.lanes.find((lane) => lane.id === "fred_macro").current_state.status,
    "not_verified",
  );
}

console.log("test-cloud-data-plane-budget: ok");
