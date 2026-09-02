#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DERIVED_ASSET_REGISTRY,
  DERIVED_WRITER_RECOVERY_CONTRACTS,
  derivedAssetById,
  derivedAssetProviderIds,
  derivedAssetReachableLaneIds,
  derivedAssetRegistryDigest,
  validateDerivedAssetRegistry,
} from "./lib/derived-asset-registry.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_PATH = path.join(
  REPO_ROOT,
  "scripts",
  "fixtures",
  "derived-asset-registry",
  "registry.expected.json",
);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

{
  const expected = JSON.parse(fs.readFileSync(EXPECTED_PATH, "utf8"));
  assert.equal(expected.schema_version, "derived-asset-registry-expected/v1");
  assert.equal(
    derivedAssetRegistryDigest(),
    expected.registry_digest,
    "derived asset registry drifted: bump the digest fixture consciously",
  );
}

{
  assert.equal(validateDerivedAssetRegistry(DERIVED_ASSET_REGISTRY), true);
  assert.equal(DERIVED_ASSET_REGISTRY.assets.length, 35, "35 logical derived assets are declared");
  assert.equal(
    DERIVED_ASSET_REGISTRY.assets.flatMap((asset) => asset.outputs).length,
    39,
    "all 35 top-level files and four recursive directories are declared exactly once",
  );
  const sec13fBridge = derivedAssetById("sec13f_bridge_index");
  assert.deepEqual(
    sec13fBridge.outputs,
    [{ path: "data/computed/sec13f_bridge_index.json", kind: "file" }],
    "the SEC 13F bridge must have one canonical owner",
  );
  assert.equal(sec13fBridge.owner_workflow, ".github/workflows/build-stocks-analyzer.yml");
  assert.equal(sec13fBridge.writer, "scripts/build-sec13f-bridge-index.mjs");
  assert.deepEqual(sec13fBridge.public_outputs, [{ path: "100xfenok-next/public/data/computed/sec13f_bridge_index.json", kind: "file" }]);
  assert.equal(sec13fBridge.public_serving_status, "active");
  assert.equal(sec13fBridge.privacy_class, "public_mirror");
  assert.equal(sec13fBridge.label, "SEC 13F bridge index (live, honest 424/1,026 coverage)");
  assert.equal(sec13fBridge.cadence.kind, "daily");
  assert.equal(sec13fBridge.recovery, "rebuild_from_inputs");
  const fenokRim = derivedAssetById("fenok_rim");
  assert.deepEqual(
    fenokRim.outputs,
    [{ path: "data/computed/fenok-rim", kind: "directory" }],
    "the Fenok RIM directory must have one registry owner",
  );
  assert.equal(fenokRim.lifecycle, "quarantined");
  assert.equal(fenokRim.owner_workflow, null);
  assert.equal(fenokRim.writer, null);
  assert.deepEqual(fenokRim.inputs, []);
  assert.equal(fenokRim.cadence.kind, "orphaned");
  assert.equal(fenokRim.privacy_class, "public_mirror");
  assert.equal(fenokRim.public_serving_status, "active");
  assert.equal(fenokRim.recovery, "none");
  assert.deepEqual(
    fenokRim.public_outputs,
    [
      { path: "100xfenok-next/public/data/computed/fenok-rim/fair-values.json", kind: "file" },
      { path: "100xfenok-next/public/data/computed/fenok-rim/payout-history.json", kind: "file" },
      { path: "100xfenok-next/public/data/computed/fenok-rim/sustainable-index-ranges.public.json", kind: "file" },
    ],
    "only the three reviewed Fenok RIM files are public",
  );
  const rimIndex = derivedAssetById("rim_index");
  assert.deepEqual(
    rimIndex.outputs,
    [{ path: "data/computed/rim-index", kind: "directory" }],
    "the RIM index input directory must have one registry owner",
  );
  assert.equal(rimIndex.lifecycle, "quarantined");
  assert.equal(rimIndex.owner_workflow, null);
  assert.equal(rimIndex.writer, null);
  assert.deepEqual(rimIndex.inputs, []);
  assert.equal(rimIndex.cadence.kind, "orphaned");
  assert.equal(rimIndex.privacy_class, "public_mirror");
  assert.equal(rimIndex.public_serving_status, "active");
  assert.equal(rimIndex.recovery, "none");
  assert.deepEqual(
    rimIndex.public_outputs,
    [{ path: "100xfenok-next/public/data/computed/rim-index/inputs.json", kind: "file" }],
    "only the exact RIM index inputs surface is public",
  );
  for (const rawName of [
    "sustainable-index-ranges.json",
    "identification-receipt.json",
    "input-diagnostics.json",
    "index-residual-roe-diagnostic.json",
    "membership-sensitivity-2026.json",
    "russell2000-official-fundamentals.json",
    "russell2000-history",
  ]) {
    assert.equal(
      fenokRim.public_outputs.some((spec) => spec.path.includes(rawName)),
      false,
      `private Fenok RIM research output must not be public: ${rawName}`,
    );
  }
  assert.equal(derivedAssetById("taiwan_data_bridge_index").lifecycle, "orphaned");
  assert.equal(derivedAssetById("taiwan_data_bridge_index").writer, null);
  for (const id of ["fenok_flow_proxies_history", "fenok_signal_lens_proxies_history"]) {
    assert.deepEqual(
      derivedAssetById(id).retention,
      { kind: "unbounded_history", max_items: null, basis: "source_dates" },
      `${id} must remain honestly unbounded until a separate persistence fix`,
    );
  }
  assert.ok(
    derivedAssetReachableLaneIds("entity_graph").includes("global_scouter"),
    "active derived assets expose transitive lane ancestry",
  );
  assert.deepEqual(
    derivedAssetProviderIds("entity_graph"),
    ["global_scouter", "sec_edgar", "slickcharts", "stockanalysis", "yahoo_finance"],
    "provider ancestry is derived from the single lane-registry provider table",
  );
  assert.deepEqual(
    derivedAssetReachableLaneIds("fenok_etf_signals_summary"),
    derivedAssetReachableLaneIds("fenok_etf_signals"),
    "asset-to-asset provider ancestry must propagate",
  );
  assert.throws(() => derivedAssetReachableLaneIds("missing_asset"), /unknown asset/);
}

{
  const base = clone(DERIVED_ASSET_REGISTRY);
  const cases = [
    ["wrong schema", (draft) => { draft.schema_version = "derived-asset-registry/v0"; }],
    ["duplicate id", (draft) => { draft.assets.push(clone(draft.assets[0])); }],
    ["unknown asset key", (draft) => { draft.assets[0].surprise = true; }],
    ["duplicate output", (draft) => { draft.assets[1].outputs = clone(draft.assets[0].outputs); }],
    ["unknown lane", (draft) => { draft.assets[0].inputs[0] = { kind: "lane", ref: "missing_lane" }; }],
    ["unknown asset", (draft) => { draft.assets[0].inputs[0] = { kind: "asset", ref: "missing_asset" }; }],
    ["current asset cycle", (draft) => {
      draft.assets.find((asset) => asset.id === "market_facts").inputs.push({
        kind: "asset",
        ref: "entity_graph",
      });
    }],
    ["path-only active asset", (draft) => {
      const target = draft.assets.find((asset) => asset.id === "signals");
      target.inputs = [{ kind: "path", ref: "data/sentiment" }];
    }],
    ["missing active writer", (draft) => { draft.assets[0].writer = null; }],
    ["orphan with writer", (draft) => {
      draft.assets.find((asset) => asset.id === "taiwan_data_bridge_index").writer = "scripts/update-manifest.py";
    }],
    ["private public output", (draft) => {
      draft.assets.find((asset) => asset.id === "etf_action_index").public_outputs = [
        { path: "100xfenok-next/public/data/computed/leak.json", kind: "file" },
      ];
    }],
    ["public output omitted", (draft) => { draft.assets[0].public_outputs = []; }],
    ["unbounded history disguised as bounded", (draft) => {
      draft.assets.find((asset) => asset.id === "fenok_flow_proxies_history").retention.max_items = 100;
    }],
    ["invalid recovery", (draft) => { draft.assets[0].recovery = "hope"; }],
    ["false lane LKG recovery", (draft) => {
      const target = draft.assets[0];
      target.recovery = "lane_lkg";
      target.recovery_evidence = "scripts/lib/lane-registry.mjs";
      target.inputs = [{ kind: "lane", ref: "global_scouter" }];
    }],
    ["false generation recovery", (draft) => {
      const target = draft.assets.find((asset) => asset.id === "signals");
      target.recovery = "generation_store";
      target.recovery_evidence = "scripts/data_supply_state.py";
      target.retention = { kind: "generations", max_items: 3, basis: "generation_id" };
    }],
    ["false rebuild recovery", (draft) => {
      const target = draft.assets.find((asset) => asset.id === "fenok_news_tone_proxy");
      target.recovery = "rebuild_from_inputs";
      target.recovery_evidence = target.writer;
    }],
  ];
  for (const [label, mutate] of cases) {
    const draft = clone(base);
    mutate(draft);
    assert.throws(
      () => validateDerivedAssetRegistry(draft, { checkFilesystem: false }),
      /derived-asset-registry/,
      `validation must reject ${label}`,
    );
  }
}

function materializeRegistryTree(registry) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "derived-asset-registry-"));
  const touch = (relativePath, directory = false) => {
    const absolute = path.join(root, relativePath);
    if (directory) {
      fs.mkdirSync(absolute, { recursive: true });
      return;
    }
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    if (fs.existsSync(absolute)) return;
    fs.writeFileSync(absolute, "{}\n");
  };
  for (const asset of registry.assets) {
    for (const spec of asset.outputs) touch(spec.path, spec.kind === "directory");
    if (asset.public_serving_status === "active") {
      for (const spec of asset.public_outputs) touch(spec.path, spec.kind === "directory");
    }
    if (asset.lifecycle !== "active") continue;
    touch(asset.owner_workflow);
    const recoveryContract = DERIVED_WRITER_RECOVERY_CONTRACTS[asset.writer];
    const writerMarker = recoveryContract === "lane_lkg"
      ? "LaneLkgStore\n"
      : recoveryContract === "generation_store"
        ? "DataSupplyStateStore\n"
        : "{}\n";
    const writerPath = path.join(root, asset.writer);
    fs.mkdirSync(path.dirname(writerPath), { recursive: true });
    if (!fs.existsSync(writerPath)) fs.writeFileSync(writerPath, writerMarker);
    touch(asset.cadence.evidence);
    touch(asset.recovery_evidence);
    for (const ref of asset.inputs.filter((entry) => entry.kind === "path")) touch(ref.ref, true);
  }
  return root;
}

{
  const root = materializeRegistryTree(DERIVED_ASSET_REGISTRY);
  const draft = clone(DERIVED_ASSET_REGISTRY);
  draft.assets.find((asset) => asset.id === "signals").public_outputs = [
    { path: "100xfenok-next/public/data/computed/does-not-exist.json", kind: "file" },
  ];
  assert.throws(
    () => validateDerivedAssetRegistry(draft, { repoRoot: root }),
    /active public output is missing/,
    "an active public serving path must exist with the declared kind",
  );
  fs.rmSync(root, { recursive: true, force: true });
}

{
  const root = materializeRegistryTree(DERIVED_ASSET_REGISTRY);
  const krxSnapshots = DERIVED_ASSET_REGISTRY.assets.find((asset) => asset.id === "krx_market_snapshots");
  for (const spec of krxSnapshots.public_outputs) {
    fs.rmSync(path.join(root, spec.path));
  }
  assert.doesNotThrow(
    () => validateDerivedAssetRegistry(DERIVED_ASSET_REGISTRY, { repoRoot: root }),
    "an active public output may be absent when it is the exact build-time mirror of a declared canonical output",
  );
  fs.rmSync(root, { recursive: true, force: true });
}

{
  const root = materializeRegistryTree(DERIVED_ASSET_REGISTRY);
  const draft = clone(DERIVED_ASSET_REGISTRY);
  const signals = draft.assets.find((asset) => asset.id === "signals");
  signals.public_outputs = [
    { path: "100xfenok-next/public/data/computed/entity_graph.json", kind: "file" },
  ];
  fs.rmSync(path.join(root, "100xfenok-next/public/data/computed/entity_graph.json"));
  assert.throws(
    () => validateDerivedAssetRegistry(draft, { repoRoot: root }),
    /active public output is missing/,
    "an active public output cannot borrow a canonical source owned by another asset",
  );
  fs.rmSync(root, { recursive: true, force: true });
}

{
  const root = materializeRegistryTree(DERIVED_ASSET_REGISTRY);
  const draft = clone(DERIVED_ASSET_REGISTRY);
  draft.assets.find((asset) => asset.id === "signals").public_serving_status = "missing_projection";
  assert.throws(
    () => validateDerivedAssetRegistry(draft, { repoRoot: root }),
    /missing_projection public output unexpectedly exists/,
    "a missing_projection output must remain invalid when it appears on disk",
  );
  fs.rmSync(root, { recursive: true, force: true });
}

{
  const root = materializeRegistryTree(DERIVED_ASSET_REGISTRY);
  fs.writeFileSync(path.join(root, "data", "computed", "undeclared.json"), "{}\n");
  assert.throws(
    () => validateDerivedAssetRegistry(DERIVED_ASSET_REGISTRY, { repoRoot: root }),
    /computed root coverage mismatch.*undeclared/,
    "a new computed root cannot ship without a registry declaration",
  );
  fs.rmSync(root, { recursive: true, force: true });
}

{
  const root = materializeRegistryTree(DERIVED_ASSET_REGISTRY);
  fs.rmSync(path.join(root, "data", "computed", "signals.json"));
  assert.throws(
    () => validateDerivedAssetRegistry(DERIVED_ASSET_REGISTRY, { repoRoot: root }),
    /declared output is missing/,
    "a stale declaration cannot remain silently green",
  );
  fs.rmSync(root, { recursive: true, force: true });
}

{
  // A sparse checkout cannot observe outputs it never materialised, so the
  // filesystem assertion must stand down there while still firing in a full
  // checkout. fetch-edgar-filings failed on 2026-08-17 because it did not.
  const root = materializeRegistryTree(DERIVED_ASSET_REGISTRY);
  fs.rmSync(path.join(root, "data", "computed", "signals.json"));
  fs.mkdirSync(path.join(root, ".git", "info"), { recursive: true });

  assert.throws(
    () => validateDerivedAssetRegistry(DERIVED_ASSET_REGISTRY, { repoRoot: root }),
    /declared output is missing/,
    "a full checkout must still fail on a genuinely missing output",
  );

  fs.writeFileSync(path.join(root, ".git", "info", "sparse-checkout"), "/scripts/\n");
  validateDerivedAssetRegistry(DERIVED_ASSET_REGISTRY, { repoRoot: root });

  fs.rmSync(path.join(root, ".git", "info", "sparse-checkout"));
  assert.throws(
    () => validateDerivedAssetRegistry(DERIVED_ASSET_REGISTRY, { repoRoot: root }),
    /declared output is missing/,
    "removing the sparse marker must restore the assertion",
  );
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("test-derived-asset-registry: ok");
