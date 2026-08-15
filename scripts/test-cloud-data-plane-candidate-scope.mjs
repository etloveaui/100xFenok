import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CANDIDATE_SCOPE_SCHEMA,
  buildCandidateScope,
  candidateScopeIds,
} from "./lib/cloud-data-plane-candidate-scope.mjs";
import { LANE_REGISTRY } from "./lib/lane-registry.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANDIDATE = "stockanalysis_etf_detail";
const GLOBAL_SCOUTER = "global_scouter";

function ownedRoot() {
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "fenok-candidate-scope-"));
  return root;
}

function assertThrows(run, fragment) {
  assert.throws(run, (error) => {
    assert.match(error.message, new RegExp(fragment));
    return true;
  });
}

// An independent measurement of the same tree. The scope module must not be the
// only thing that can compute its own totals, or the check degenerates into the
// module agreeing with itself.
function independentMeasure(absoluteRoot) {
  let files = 0;
  let bytes = 0;
  const rootStat = fs.lstatSync(absoluteRoot);
  if (rootStat.isFile()) return { files: 1, bytes: rootStat.size };
  assert.equal(rootStat.isDirectory(), true, `${absoluteRoot} must be a file or directory`);
  const walk = (current) => {
    for (const entry of fs.readdirSync(current)) {
      const next = path.join(current, entry);
      const stat = fs.lstatSync(next);
      if (stat.isDirectory()) walk(next);
      else { files += 1; bytes += stat.size; }
    }
  };
  walk(absoluteRoot);
  return { files, bytes };
}

function cloneRegistryWithLane(mutate) {
  const clone = JSON.parse(JSON.stringify(LANE_REGISTRY));
  const lane = clone.lanes.find((row) => row.id === CANDIDATE);
  mutate(lane, clone);
  return clone;
}

function realScopeChecks() {
  assert.ok(candidateScopeIds().includes(CANDIDATE), "the ETF detail candidate must be registered");

  const { manifest, inventory } = buildCandidateScope({ repoRoot: REPO_ROOT, candidateId: CANDIDATE });
  assert.equal(manifest.schema_version, CANDIDATE_SCOPE_SCHEMA);
  assert.equal(manifest.candidate_id, CANDIDATE);

  // Ownership is asserted from the registry, and the lane must still be shadow:
  // a scope contract that silently followed a live flip would let a migration
  // budget be argued for a lane that was promoted without an emitter attempt.
  assert.equal(manifest.owner.lane_id, CANDIDATE);
  assert.equal(manifest.owner.enforcement, "shadow");
  assert.equal(manifest.owner.owner_workflow, ".github/workflows/fetch-stockanalysis.yml");

  // The include set must equal the lane's declared canonical outputs exactly.
  const declared = LANE_REGISTRY.lanes.find((row) => row.id === CANDIDATE).roots.canonical_outputs;
  assert.deepEqual(manifest.included_canonical_roots.map((row) => row.path), [...declared].sort());

  const measuredIndependently = manifest.included_canonical_roots
    .map((row) => independentMeasure(path.join(REPO_ROOT, row.path)))
    .reduce((sum, row) => ({ files: sum.files + row.files, bytes: sum.bytes + row.bytes }), { files: 0, bytes: 0 });
  assert.equal(manifest.totals.file_count, measuredIndependently.files);
  assert.equal(manifest.totals.bytes, measuredIndependently.bytes);
  assert.ok(manifest.totals.file_count > 0 && manifest.totals.bytes > 0);

  // The derived public projection is recorded but must never add migration bytes.
  assert.ok(manifest.derived_public_projection_roots.length > 0);
  for (const row of manifest.derived_public_projection_roots) {
    assert.equal(row.migrates, false);
    assert.ok(row.reason.length > 0, "a projection root must say why it does not migrate");
  }

  // Every exclusion carries either a resolved owner lane or a written reason, and
  // no excluded path is also included.
  const includedPaths = new Set(manifest.included_canonical_roots.map((row) => row.path));
  assert.ok(manifest.excluded.length > 0);
  for (const row of manifest.excluded) {
    assert.ok(!includedPaths.has(row.path), `${row.path} cannot be both included and excluded`);
    assert.ok(row.reason.length > 0, `${row.path} must carry a reason`);
    if (row.class === "other_lane_owned") assert.ok(row.owner_lane && row.owner_lane !== CANDIDATE);
    else assert.equal(row.class, "declared_exclusion");
  }

  // The inventory handed to the budget calculator must be the scoped totals, not
  // the estate totals, and must be shaped like the estate inventory it replaces.
  assert.deepEqual(Object.keys(inventory).sort(), ["bytes", "complete", "digest", "file_count"]);
  assert.equal(inventory.complete, true);
  assert.equal(inventory.file_count, manifest.totals.file_count);
  assert.equal(inventory.bytes, manifest.totals.bytes);
  assert.equal(inventory.digest, manifest.path_digest);

  // Determinism: the same tree must produce the same digest.
  const again = buildCandidateScope({ repoRoot: REPO_ROOT, candidateId: CANDIDATE });
  assert.equal(again.manifest.path_digest, manifest.path_digest);

  return manifest;
}

function failClosedChecks(manifest) {
  assertThrows(() => buildCandidateScope({ repoRoot: REPO_ROOT, candidateId: "no_such_candidate" }), "unknown candidate");
  assertThrows(() => buildCandidateScope({ candidateId: CANDIDATE }), "repoRoot is required");

  // Ownership drift: if another lane claims the candidate's canonical root, the
  // scope must refuse rather than migrate a path it does not own.
  const stolen = cloneRegistryWithLane((lane, registry) => {
    const other = registry.lanes.find((row) => row.id === "stockanalysis_surfaces");
    other.roots.canonical_outputs = [...other.roots.canonical_outputs, ...lane.roots.canonical_outputs];
  });
  assertThrows(
    () => buildCandidateScope({ repoRoot: REPO_ROOT, candidateId: CANDIDATE, laneRegistry: stolen }),
    "declared by two lanes",
  );

  // A sibling path that no lane owns and no exclusion explains must stop the
  // build. This is the property that keeps a migration from silently under-counting.
  const root = ownedRoot();
  const family = path.join(root, "data", "stockanalysis");
  fs.mkdirSync(path.join(family, "etfs"), { recursive: true });
  fs.writeFileSync(path.join(family, "etfs", "SPY.json"), "{}");
  for (const entry of manifest.excluded) {
    const target = path.join(root, entry.path);
    if (path.extname(target)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "{}");
    } else {
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "placeholder.json"), "{}");
    }
  }
  // Sanity: the mirrored tree builds before the surprise path is added.
  const mirrored = buildCandidateScope({ repoRoot: root, candidateId: CANDIDATE });
  assert.equal(mirrored.manifest.totals.file_count, 1);

  fs.mkdirSync(path.join(family, "surprise"), { recursive: true });
  fs.writeFileSync(path.join(family, "surprise", "new.json"), "{}");
  assertThrows(() => buildCandidateScope({ repoRoot: root, candidateId: CANDIDATE }), "unclassified paths");
  fs.rmSync(path.join(family, "surprise"), { recursive: true, force: true });

  // A reason recorded for a path that no longer exists is stale bookkeeping.
  const staleTarget = path.join(root, "data", "stockanalysis", "canary");
  fs.rmSync(staleTarget, { recursive: true, force: true });
  assertThrows(() => buildCandidateScope({ repoRoot: root, candidateId: CANDIDATE }), "no longer present on disk");

  // An absent included root is a lost artifact, never an empty migration.
  fs.mkdirSync(staleTarget, { recursive: true });
  fs.writeFileSync(path.join(staleTarget, "placeholder.json"), "{}");
  fs.rmSync(path.join(family, "etfs"), { recursive: true, force: true });
  assertThrows(() => buildCandidateScope({ repoRoot: root, candidateId: CANDIDATE }), "included root is absent");

  // A symlink inside the include set would let the measured size disagree with
  // what actually uploads.
  fs.mkdirSync(path.join(family, "etfs"), { recursive: true });
  fs.symlinkSync(path.join(family, "index.json"), path.join(family, "etfs", "link.json"));
  assertThrows(() => buildCandidateScope({ repoRoot: root, candidateId: CANDIDATE }), "symlink inside included root");

  fs.rmSync(root, { recursive: true, force: true });
}

function budgetIntegrationChecks(manifest) {
  // The point of the scope contract: the same calculator, unchanged, run against
  // a scoped inventory instead of the whole estate.
  return Promise.all([
    import("./lib/cloud-data-plane-budget.mjs"),
  ]).then(([budget]) => {
    const demandPath = path.join(REPO_ROOT, "scripts", "fixtures", "cloud-data-plane", "etf-migration-demand.json");
    const demand = JSON.parse(fs.readFileSync(demandPath, "utf8"));
    const scoped = buildCandidateScope({ repoRoot: REPO_ROOT, candidateId: CANDIDATE });
    const estate = { complete: true, file_count: 38685, bytes: 2810393328, digest: crypto.randomUUID() };

    const scopedReport = budget.calculateCloudDataPlaneBudget({ inventory: scoped.inventory, requestDemand: demand });
    const estateReport = budget.calculateCloudDataPlaneBudget({ inventory: estate, requestDemand: demand });

    // Three slots stay three. The scope contract must never be a way to shrink
    // the retention model into passing.
    assert.deepEqual(scopedReport.assumptions.r2_slots, ["current", "previous", "in_progress"]);
    assert.deepEqual(Object.keys(scopedReport.r2.slots).sort(), ["current", "in_progress", "previous"]);
    for (const slot of Object.values(scopedReport.r2.slots)) {
      assert.equal(slot.bytes, scoped.inventory.bytes);
    }

    // The scoped figure is strictly the candidate carried three times, and it is
    // materially smaller than the estate figure that produced the planning-line
    // failure.
    assert.equal(
      scopedReport.r2.metrics.decimal_gb_month.lower_bound,
      (scoped.inventory.bytes * 3 * 30) / (1_000_000_000 * 30),
    );
    assert.ok(
      scopedReport.r2.metrics.decimal_gb_month.lower_bound < estateReport.r2.metrics.decimal_gb_month.lower_bound,
    );
    assert.equal(estateReport.r2.planning_line.verdict, "fail");
    // Without an account baseline the scoped line cannot be called a pass. It is
    // recorded as unverified rather than green, because the missing input is the
    // unrelated account usage that shares the same limit.
    assert.notEqual(scopedReport.r2.planning_line.verdict, "fail");
    assert.equal(scopedReport.r2.planning_line.verdict, "not_verified");
    assert.equal(manifest.totals.bytes, scoped.inventory.bytes);
  });
}

function globalScouterChecks() {
  assert.ok(candidateScopeIds().includes(GLOBAL_SCOUTER), "the Global Scouter candidate must be registered");
  const { manifest, inventory } = buildCandidateScope({ repoRoot: REPO_ROOT, candidateId: GLOBAL_SCOUTER });
  assert.equal(manifest.schema_version, CANDIDATE_SCOPE_SCHEMA);
  assert.equal(manifest.candidate_id, GLOBAL_SCOUTER);
  assert.equal(manifest.owner.lane_id, GLOBAL_SCOUTER);
  assert.equal(manifest.owner.enforcement, "shadow");
  assert.equal(manifest.owner.owner_workflow, null);

  const declared = LANE_REGISTRY.lanes.find((row) => row.id === GLOBAL_SCOUTER).roots.canonical_outputs;
  assert.deepEqual(manifest.included_canonical_roots.map((row) => row.path), [...declared].sort());
  const measuredIndependently = manifest.included_canonical_roots
    .map((row) => independentMeasure(path.join(REPO_ROOT, row.path)))
    .reduce((sum, row) => ({ files: sum.files + row.files, bytes: sum.bytes + row.bytes }), { files: 0, bytes: 0 });
  assert.deepEqual(
    { files: manifest.totals.file_count, bytes: manifest.totals.bytes },
    measuredIndependently,
  );
  assert.equal(manifest.totals.file_count, 1082);

  assert.deepEqual(
    manifest.excluded.map((row) => row.path),
    [
      "data/global-scouter/core/per_bands_index.json",
      "data/global-scouter/core/revision_movers.json",
      "data/global-scouter/core/slick_index.json",
      "data/global-scouter/core/stocks_analyzer.json",
    ],
  );
  assert.deepEqual(
    manifest.derived_public_projection_roots.map((row) => row.path).sort(),
    [
      "100xfenok-next/public/data/global-scouter/core/per_bands_index.json",
      "100xfenok-next/public/data/global-scouter/core/revision_movers.json",
      "100xfenok-next/public/data/global-scouter/core/slick_index.json",
      "100xfenok-next/public/data/global-scouter/core/stocks_analyzer.json",
    ],
  );
  for (const row of manifest.derived_public_projection_roots) {
    assert.equal(row.migrates, false);
    assert.ok(row.reason.length > 0);
  }
  assert.equal(inventory.complete, true);
  assert.equal(inventory.file_count, manifest.totals.file_count);
  assert.equal(inventory.bytes, manifest.totals.bytes);
  assert.equal(inventory.digest, manifest.path_digest);
  assert.equal(
    buildCandidateScope({ repoRoot: REPO_ROOT, candidateId: GLOBAL_SCOUTER }).manifest.path_digest,
    manifest.path_digest,
  );
  return manifest;
}

// The calculator checks above prove the arithmetic. They do not prove the wiring:
// which inventory the report actually hands the calculator, and whether a scoped
// run is labelled as one. A scoped verdict silently presented as an estate verdict
// is the failure this section exists to catch.
async function reportAndCliChecks() {
  const { buildCloudDataPlaneReport } = await import("./lib/cloud-data-plane-budget.mjs");
  const scoped = buildCandidateScope({ repoRoot: REPO_ROOT, candidateId: CANDIDATE });

  const estateReport = buildCloudDataPlaneReport({ repoRoot: REPO_ROOT });
  assert.deepEqual(estateReport.inventory_scope, { kind: "estate" });
  assert.equal("candidate_scope" in estateReport, false, "an estate run must not carry a candidate manifest");

  const candidateReport = buildCloudDataPlaneReport({ repoRoot: REPO_ROOT, candidateId: CANDIDATE });
  assert.deepEqual(candidateReport.inventory_scope, { kind: "candidate", candidate_id: CANDIDATE });
  assert.deepEqual(candidateReport.candidate_scope, scoped.manifest);

  // The estate catalog must still be built in candidate mode: a smaller number
  // computed over an estate with unowned files is not safer, it is less checked.
  assert.ok(candidateReport.catalog?.inventory);
  assert.equal(candidateReport.catalog.inventory.file_count, estateReport.catalog.inventory.file_count);
  assert.ok(candidateReport.catalog.inventory.bytes > scoped.inventory.bytes);

  // The budget really consumed the scoped inventory, not the estate one.
  for (const slot of Object.values(candidateReport.budget.r2.slots)) {
    assert.equal(slot.bytes, scoped.inventory.bytes);
    assert.equal(slot.objects, scoped.inventory.file_count);
  }
  assert.notEqual(
    candidateReport.budget.r2.metrics.decimal_gb_month.lower_bound,
    estateReport.budget.r2.metrics.decimal_gb_month.lower_bound,
  );

  const checker = path.join(REPO_ROOT, "scripts", "check-cloud-data-plane-budget.mjs");
  const demand = path.join(REPO_ROOT, "scripts", "fixtures", "cloud-data-plane", "etf-migration-demand.json");
  const run = (args) => spawnSync(process.execPath, [checker, ...args], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

  const cli = run(["--candidate", CANDIDATE, "--request-demand", demand, "--format", "json"]);
  assert.equal(cli.status, 2, `a scoped run without an account baseline must not exit 0: ${cli.stderr}`);
  const parsed = JSON.parse(cli.stdout);
  assert.deepEqual(parsed.inventory_scope, { kind: "candidate", candidate_id: CANDIDATE });
  assert.equal(parsed.candidate_scope.candidate_id, CANDIDATE);
  assert.equal(parsed.candidate_scope.totals.bytes, scoped.inventory.bytes);
  assert.equal(parsed.candidate_scope.path_digest, scoped.manifest.path_digest);
  assert.equal(parsed.candidate_scope.owner.enforcement, "shadow");
  // Absent baseline stays unverified. It must never round up to a pass.
  assert.equal(parsed.budget.r2.planning_line.verdict, "not_verified");
  assert.notEqual(parsed.verdict, "pass");

  // The default CLI path is unchanged and still estate-wide.
  const estateCli = run(["--format", "json"]);
  assert.deepEqual(JSON.parse(estateCli.stdout).inventory_scope, { kind: "estate" });

  // Argument handling fails closed rather than silently running estate-wide.
  const missingValue = run(["--candidate"]);
  assert.notEqual(missingValue.status, 0);
  assert.match(missingValue.stderr, /--candidate requires a value/);
  const unknownCandidate = run(["--candidate", "no_such_candidate", "--format", "json"]);
  assert.notEqual(unknownCandidate.status, 0);
  assert.match(unknownCandidate.stderr, /unknown candidate/);
}

const manifest = realScopeChecks();
globalScouterChecks();
failClosedChecks(manifest);
await budgetIntegrationChecks(manifest);
await reportAndCliChecks();
process.stdout.write("test-cloud-data-plane-candidate-scope: ok\n");
