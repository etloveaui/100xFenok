#!/usr/bin/env node
// Lane Registry tests (BACKLOG #366 step 1):
//   (a) loader validation is fail-closed on malformed records/exceptions,
//   (b) the registry digest is pinned exact-value (conscious-edit pin, DEC-266),
//   (c) the shadow checker reports declared/undeclared/absent correctly and
//       never fails the build,
//   (d) registry stays consistent with the detection config (ids/enforcement)
//       and with on-disk workflow files.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LANE_REGISTRY,
  LANE_REGISTRY_SCHEMA,
  declaredAdminRoots,
  declaredExceptionPaths,
  registryDigest,
  registryLaneById,
  validateLaneRegistry,
} from "./lib/lane-registry.mjs";
import { checkLaneRegistryCompleteness } from "./check-lane-registry-completeness.mjs";
import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_PATH = path.join(REPO_ROOT, "scripts", "fixtures", "lane-registry", "registry.expected.json");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// --- (b) digest pin ------------------------------------------------------------
{
  const expected = JSON.parse(fs.readFileSync(EXPECTED_PATH, "utf8"));
  assert.equal(expected.schema_version, "lane-registry-expected/v1");
  assert.equal(
    registryDigest(),
    expected.registry_digest,
    "registry drifted: bump scripts/fixtures/lane-registry/registry.expected.json consciously",
  );
}

// --- (a) loader validation ------------------------------------------------------
{
  // the shipped registry itself validates
  assert.equal(validateLaneRegistry(LANE_REGISTRY), true);

  const base = clone(LANE_REGISTRY);
  const cases = [
    ["duplicate lane id", (draft) => { draft.lanes.push(clone(draft.lanes[0])); }],
    ["unknown key on a record", (draft) => { draft.lanes[0].surprise = true; }],
    ["bad lane id", (draft) => { draft.lanes[0].id = "Bad Id"; }],
    ["absolute store path", (draft) => { draft.lanes[0].roots.admin_store = "/etc/passwd"; }],
    ["path escape", (draft) => { draft.lanes[0].roots.admin_store = "data/admin/../secret"; }],
    ["artifact_only with a store", (draft) => {
      const lane = draft.lanes.find((row) => row.store_kind === "artifact_only");
      lane.roots.admin_store = "data/admin/sneaky";
    }],
    ["recovery store outside admin root", (draft) => {
      const lane = draft.lanes.find((row) => row.store_kind === "marker");
      lane.recovery_store = "data/admin/other/index.json";
    }],
    ["wrong schema_version", (draft) => { draft.schema_version = "lane-registry/v0"; }],
    ["undeclared exception kind", (draft) => { draft.declared_exceptions[0].kind = "directory"; }],
    ["duplicate exception", (draft) => { draft.declared_exceptions.push(clone(draft.declared_exceptions[0])); }],
    ["invalid cadence", (draft) => { draft.lanes[0].cadence.kind = "fortnightly"; }],
    ["invalid privacy class", (draft) => { draft.lanes[0].privacy_class = "publicish"; }],
    ["missing lane_class", (draft) => { delete draft.lanes[0].lane_class; }],
    ["invalid lane_class", (draft) => { draft.lanes[0].lane_class = "sometimes"; }],
    ["recovery store without shape", (draft) => {
      const lane = draft.lanes.find((row) => row.recovery_store !== null);
      delete lane.kpi_recovery_shape;
    }],
    ["shape without recovery store", (draft) => {
      const lane = draft.lanes.find((row) => row.recovery_store === null);
      lane.kpi_recovery_shape = "general";
    }],
    ["direct bucket conflict", (draft) => {
      const lane = draft.lanes.find((row) => row.kpi_recovery_shape === "direct"
        && row.roots.admin_store === "data/admin/stockanalysis-recovery");
      lane.recovery_store = "data/admin/stockanalysis-recovery/other-index.json";
    }],
    ["owner workflow outside workflows dir", (draft) => { draft.lanes[0].owner_workflow = "scripts/x.yml"; }],
    ["duplicate commit shard", (draft) => {
      const lane = draft.lanes.find((row) => row.commit_shards.length > 1);
      lane.commit_shards.push(lane.commit_shards[0]);
    }],
  ];
  for (const [label, mutate] of cases) {
    const draft = clone(base);
    mutate(draft);
    assert.throws(() => validateLaneRegistry(draft), /lane-registry/, `validation must reject: ${label}`);
  }
}

// --- (d) consistency with the detection config and the tree --------------------
{
  const detectionIds = DATA_SUPPLY_DETECTION_CONFIG.lanes.map((lane) => lane.id).sort();
  const registryIds = LANE_REGISTRY.lanes.map((lane) => lane.id).sort();
  for (const id of detectionIds) {
    assert.ok(registryIds.includes(id), `detection lane ${id} is missing from the registry`);
  }
  for (const lane of DATA_SUPPLY_DETECTION_CONFIG.lanes) {
    const record = registryLaneById(lane.id);
    assert.equal(
      record.enforcement,
      lane.enforcement,
      `enforcement disagreement for ${lane.id}: registry=${record.enforcement} config=${lane.enforcement}`,
    );
  }
  for (const lane of LANE_REGISTRY.lanes) {
    if (lane.owner_workflow !== null) {
      assert.equal(
        fs.existsSync(path.join(REPO_ROOT, lane.owner_workflow)),
        true,
        `owner workflow missing on disk: ${lane.owner_workflow}`,
      );
    }
    if (lane.roots.detection_attempt !== null) {
      assert.equal(
        lane.roots.detection_attempt.startsWith("data/admin/data-supply-state/detection-attempts/"),
        true,
        `detection attempt shard must live under the shared root: ${lane.id}`,
      );
    }
  }
  // shared stores declare every claimant
  const roots = declaredAdminRoots();
  assert.deepEqual(
    [...(roots.get("data/admin/stockanalysis-recovery") ?? [])].sort(),
    ["stockanalysis_etf_universe", "stockanalysis_stock_financial", "stockanalysis_surfaces", "yahoo_etf_fallback"].sort(),
    "the StockAnalysis recovery store must list every claimant lane",
  );
  // every recovery_store-bearing lane's index lives under its admin root
  for (const lane of LANE_REGISTRY.lanes) {
    if (lane.recovery_store !== null && lane.roots.admin_store !== null) {
      assert.ok(lane.recovery_store.startsWith(`${lane.roots.admin_store}/`), `${lane.id} recovery store escapes its admin root`);
    }
  }
  // declared exception paths exist today (the shadow checker would warn otherwise);
  // may_be_absent entries are declared-ephemeral and exempt by contract.
  for (const entry of LANE_REGISTRY.declared_exceptions) {
    if (entry.may_be_absent === true) continue;
    assert.equal(fs.existsSync(path.join(REPO_ROOT, entry.path)), true, `stale declared exception: ${entry.path}`);
  }
  // lane_class: financial-source detection floor stays fixed while owned and
  // private/runtime domains are registered as auxiliary lanes.
  {
    const byClass = LANE_REGISTRY.lanes.reduce((acc, lane) => {
      acc[lane.lane_class] = (acc[lane.lane_class] ?? 0) + 1;
      return acc;
    }, {});
    assert.deepEqual(byClass, { detection_floor: 27, auxiliary: 4 }, "lane_class partition drifted");
    assert.equal(registryLaneById("yahoo_batch_quote_history").lane_class, "auxiliary",
      "yahoo_batch_quote_history remains auxiliary (not a detection-floor lane)");
    for (const id of ["benchmarks", "global_scouter", "damodaran"]) {
      const converterLane = registryLaneById(id);
      assert.ok(converterLane, `${id} converter lane is registered`);
      assert.equal(converterLane.lane_class, "detection_floor", `${id} belongs to the detection floor`);
      assert.equal(converterLane.cadence.kind, "weekly", `${id} carries its declared weekly cadence`);
      assert.equal(converterLane.enforcement, "shadow", `${id} remains shadow until separately promoted`);
    }
    assert.equal(registryLaneById("benchmarks").owner_workflow, null,
      "Benchmark cadence is declared by the external converter payload, not a fabricated workflow");
    assert.equal(registryLaneById("global_scouter").owner_workflow, null,
      "Global Scouter cadence is declared by the external converter payload, not a fabricated workflow");
    assert.equal(registryLaneById("damodaran").owner_workflow, ".github/workflows/fetch-damodaran-shadow.yml",
      "Damodaran keeps its measured in-repo owner workflow");
    assert.equal(registryLaneById("stockanalysis_stock_financial").enforcement, "live",
      "the bounded StockAnalysis pair lane is live after its first committed natural 8-pair attempt");
    for (const id of ["admin_live_voice_logs", "mona_production_study_state", "mona_vnext_kv"]) {
      const lane = registryLaneById(id);
      assert.ok(lane, `private/runtime denominator lane missing: ${id}`);
      assert.equal(detectionIds.includes(id), false, `${id} must not enter the financial detection floor`);
      assert.deepEqual(
        {
          owner_workflow: lane.owner_workflow,
          store_kind: lane.store_kind,
          lane_class: lane.lane_class,
          cadence: lane.cadence,
          enforcement: lane.enforcement,
          privacy_class: lane.privacy_class,
          roots: lane.roots,
          commit_shards: lane.commit_shards,
          recovery_store: lane.recovery_store,
        },
        {
          owner_workflow: null,
          store_kind: "artifact_only",
          lane_class: "auxiliary",
          cadence: { kind: "unknown" },
          enforcement: "shadow",
          privacy_class: "private",
          roots: {
            admin_store: null,
            detection_attempt: null,
            canonical_outputs: [],
            public_mirror: [],
          },
          commit_shards: [],
          recovery_store: null,
        },
        `${id} must remain an honest repo/CI-unobservable auxiliary artifact lane`,
      );
      assert.ok(lane.declared_exception?.length > 0, `${id} must explain its observability exception`);
    }
    const indices = registryLaneById("us_indices_daily");
    assert.equal(indices.enforcement, "shadow", "US indices stays shadow until the parity acceptance window passes");
    assert.deepEqual(indices.roots.canonical_outputs, [
      "data/admin/us-indices-daily/shadow/sp500.json",
      "data/admin/us-indices-daily/shadow/nasdaq.json",
    ], "shadow phase must not claim GAS-owned canonical index paths");
    assert.deepEqual(indices.roots.public_mirror, [], "shadow phase must not write the stale public mirror");
    const oecd = registryLaneById("oecd_cli");
    assert.equal(oecd.enforcement, "shadow");
    assert.deepEqual(oecd.roots.canonical_outputs, ["data/admin/oecd_cli/shadow/oecd-cli.json"]);
    assert.deepEqual(oecd.roots.public_mirror, []);
    const krx = registryLaneById("krx");
    assert.equal(krx.enforcement, "shadow", "KRX stays shadow until a natural workflow run commits attempt evidence");
    assert.equal(krx.roots.detection_attempt, "data/admin/data-supply-state/detection-attempts/krx.json");
    assert.deepEqual(krx.roots.public_mirror, ["100xfenok-next/public/data/admin/fenok-edge-korea-krx-daily-index.json"]);
  }
  const floorException = LANE_REGISTRY.declared_exceptions
    .find((entry) => entry.path === "data/admin/data-supply-detection-floor.json");
  assert.equal(floorException?.may_be_absent, true,
    "the ephemeral detection-floor report must be declared may_be_absent (intentionally not committed)");
}

// --- (c) checker fixtures: declared / undeclared / absent ------------------------
{
  function makeTree(tag, { roots = [], files = [] } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `lane-registry-check-${tag}-`));
    for (const dir of roots) fs.mkdirSync(path.join(root, dir), { recursive: true });
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), "{}\n");
    }
    return root;
  }

  // fully declared tree -> clean, no warnings
  {
    const roots = [...declaredAdminRoots().keys()].filter((root) => !root.includes("fred_yardeni") && !root.includes("edgar_filings") && !root.includes("occ_options_volume"));
    const files = declaredExceptionPaths("file");
    const tree = makeTree("clean", {
      roots: [...roots, ...declaredExceptionPaths("root")],
      files,
    });
    const warnings = [];
    const summary = checkLaneRegistryCompleteness({
      repoRoot: tree,
      warn: (message) => warnings.push(message),
      info: () => {},
    });
    assert.deepEqual(summary.undeclared_roots, []);
    assert.deepEqual(summary.undeclared_files, []);
    assert.deepEqual(summary.stale_exceptions, []);
    assert.equal(warnings.length, summary.absent_store_roots.length, "only absent-store notes remain (pre-launch stores excluded above)");
  }

  // an undeclared root + undeclared file are reported loudly
  {
    const tree = makeTree("undeclared", {
      roots: ["data/admin/data-supply-state", "data/admin/brand_new_lane"],
      files: ["data/admin/brand-new-file.json"],
    });
    const warnings = [];
    const summary = checkLaneRegistryCompleteness({
      repoRoot: tree,
      warn: (message) => warnings.push(message),
      info: () => {},
    });
    assert.deepEqual(summary.undeclared_roots, ["data/admin/brand_new_lane"]);
    assert.deepEqual(summary.undeclared_files, ["data/admin/brand-new-file.json"]);
    assert.equal(summary.clean, false);
    assert.ok(warnings.some((line) => line.includes("undeclared_root")));
    assert.ok(warnings.some((line) => line.includes("undeclared_file")));
    assert.ok(warnings.some((line) => line.includes("stale_exception")), "exceptions for missing paths are reported");
  }

  // a registry store absent from the tree is reported, never fatal
  {
    const tree = makeTree("absent", { roots: ["data/admin/data-supply-state"] });
    const summary = checkLaneRegistryCompleteness({
      repoRoot: tree,
      warn: () => {},
      info: () => {},
    });
    const storeLanes = LANE_REGISTRY.lanes.filter((lane) => lane.roots.admin_store !== null).length;
    assert.equal(summary.absent_store_roots.length, storeLanes, "every store root is absent in a bare tree");
    assert.equal(summary.clean, false);
  }

  // the real tree has no undeclared entries (only pre-launch absent stores)
  {
    const summary = checkLaneRegistryCompleteness({ repoRoot: REPO_ROOT, warn: () => {}, info: () => {} });
    assert.deepEqual(summary.undeclared_roots, [], "no undeclared roots on origin/main");
    assert.deepEqual(summary.undeclared_files, [], "no undeclared files on origin/main");
    assert.deepEqual(summary.stale_exceptions, [], "no stale exceptions on origin/main");
    // Absent stores are time-dependent: each lane's store appears on its first
    // natural run, so assert the pending set is a SUBSET of the known
    // pre-launch lanes rather than an exact list.
    const pendingLanes = new Set([
      "edgar_filings",
      "fred_yardeni",
      "occ_options_volume",
      "yahoo_private_options",
      // #366 proxy-lane wiring (2026-07-19): admin stores are declared but
      // reserved — shard-only producers write nothing there until a future
      // recovery-state slice; they stay pending indefinitely by design.
      "apewisdom_attention",
      "gdelt_news_tone",
      "damodaran",
      "us_indices_daily",
      "oecd_cli",
      "krx",
    ]);
    for (const row of summary.absent_store_roots) {
      assert.ok(pendingLanes.has(row.lane), `unexpected absent store: ${row.lane} (${row.path})`);
    }
  }
}

console.log("test-lane-registry: ok");
