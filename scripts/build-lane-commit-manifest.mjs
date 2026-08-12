#!/usr/bin/env node

// Deterministic projection of the lane registry's workflow policies. This is
// shadow/check-only during the foundation phase; consumer workflows are not
// switched here.

import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  COMMIT_PATH_KINDS,
  COMMIT_STAGE_KEYS,
  COMPUTED_SIGNALS_SOURCE_LANE_IDS,
  LANE_REGISTRY,
  registryDigest,
  validateLaneRegistry,
} from "./lib/lane-registry.mjs";
import { canonicalJson } from "./lib/json-canonical.mjs";

export const COMMIT_MANIFEST_SCHEMA = "lane-commit-manifest/v1";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");
export const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, "data", "admin", "lane-commit-manifest.json");

function computedSignalsSourceTriggerExclusions(registry = LANE_REGISTRY) {
  const lanes = COMPUTED_SIGNALS_SOURCE_LANE_IDS.map((laneId) => {
    const lane = registry.lanes.find((candidate) => candidate.id === laneId);
    if (!lane) fail(`computed-signals source lane is missing: ${laneId}`);
    if (!lane.owner_workflow) fail(`computed-signals source lane has no owner workflow: ${laneId}`);
    if (!lane.roots.admin_store) fail(`computed-signals source lane has no admin store: ${laneId}`);
    if (lane.roots.canonical_outputs.length === 0) fail(`computed-signals source lane has no canonical outputs: ${laneId}`);
    return lane;
  });
  const canonical = lanes.flatMap((lane) => lane.roots.canonical_outputs.map((output) => {
    const basename = path.posix.basename(output);
    return `!${basename.includes(".") ? output : `${output}/**`}`;
  }));
  const admin = lanes.map((lane) => `!${lane.roots.admin_store}/**`);
  const exclusions = [...canonical, ...admin];
  if (new Set(exclusions).size !== exclusions.length) fail("computed-signals source trigger exclusions contain duplicates");
  return exclusions;
}

const UPDATE_MANIFEST_TRIGGER_PATHS = [
  "data/**",
  "!data/yf/**",
  "!data/admin/yahoo-batch-quote-history/**",
  "!data/manifest.json",
  "!data/computed/**",
  "!data/admin/data-usage-manifest.json",
  "!data/admin/product-surface-coverage.json",
  "!data/admin/fenok-data-health-kpi.json",
  "!data/admin/damodaran-shadow-parity.json",
  "!data/admin/sec-13f-shadow-parity.json",
  "!data/admin/fenok-s1-stock-public-promotion-dry-run.json",
  "!data/admin/fenok-edge-coverage-index.json",
  "!data/admin/fenok-s0-finra-occ-mapping-ledger.json",
  "!data/admin/fenok-edge-etf-daily1y-readiness.json",
  "!data/admin/fenok-edge-etf-daily1y-fetchable-plan.json",
  "!data/admin/fenok-etf-core-daily-basket.json",
  "!data/admin/fenok-edge-korea-krx-daily-index.json",
  "!data/admin/data-supply-state/**",
  "!data/admin/lane-registry-projection.json",
  "!data/admin/lane-commit-manifest.json",
  "!data/admin/alarm-state.json",
  // Six coordinator-source families publish their own plane generations and no
  // longer dispatch Update Manifest per run; their owned canonical/admin
  // commits must not implicitly trigger the full reconciliation either.
  // Scheduled/manual reconciliation and every unrelated data trigger remain.
  ...computedSignalsSourceTriggerExclusions(),
  "!data/stockanalysis/**",
  "!data/slickcharts/discovery-summary.json",
  "!data/slickcharts/membership-changes.json",
  "!data/slickcharts/universe.json",
  "scripts/update-manifest.py",
  "scripts/export-computed-signals.mjs",
  "scripts/build-phase2-closeout-indexes.mjs",
  "scripts/build-fenok-signals.mjs",
  "scripts/build-slickcharts-discovery.mjs",
  "scripts/scrapers/membership-tracker.py",
  "scripts/write-fenok-s1-stock-public-promotion-dry-run.mjs",
  "scripts/build-fenok-edge-coverage-index.mjs",
  "scripts/audit-fenok-s0-source-gaps.mjs",
  "scripts/write-fenok-etf-daily1y-readiness.mjs",
  "scripts/audit-fenok-stock-promotion-candidates.mjs",
  "scripts/stock-action-score-core.mjs",
  "scripts/fetch-nasdaq-giw-sox-constituents.mjs",
  "scripts/generate-product-surface-coverage.mjs",
  "scripts/build-fenok-data-health-kpi.mjs",
  "scripts/lib/market-calendar.mjs",
  "scripts/lib/kpi-runtime-projection.mjs",
  "scripts/lib/kpi-runtime-slots.mjs",
  "scripts/lib/kpi-contract-constants.mjs",
  "tools/macro-monitor/shared/signals-core.mjs",
];

export const UPDATE_MANIFEST_MATERIALIZATIONS = [
  {
    source: "data/slickcharts",
    destination: "100xfenok-next/public/data/slickcharts",
    mode: "rsync_tree",
    delete: true,
    excludes: [],
    required: true,
    trailing_slash: true,
  },
  {
    source: "data/yf/finance",
    destination: "100xfenok-next/public/data/yf/finance",
    mode: "rsync_tree",
    delete: true,
    excludes: [],
    required: true,
    trailing_slash: true,
  },
  {
    source: "data/stockanalysis",
    destination: "100xfenok-next/public/data/stockanalysis",
    mode: "rsync_tree",
    delete: true,
    excludes: ["etfs"],
    required: true,
    trailing_slash: true,
  },
  {
    source: "data/indices/README.md",
    destination: "100xfenok-next/public/data/indices/README.md",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/indices/schema.json",
    destination: "100xfenok-next/public/data/indices/schema.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/indices/nasdaq-giw-sox-constituents.json",
    destination: "100xfenok-next/public/data/indices/nasdaq-giw-sox-constituents.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/indices/sp500.json",
    destination: "100xfenok-next/public/data/indices/sp500.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/indices/nasdaq.json",
    destination: "100xfenok-next/public/data/indices/nasdaq.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/indices/nasdaq100.json",
    destination: "100xfenok-next/public/data/indices/nasdaq100.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/indices/sox.json",
    destination: "100xfenok-next/public/data/indices/sox.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/admin/fenok-edge-korea-krx-daily-index.json",
    destination: "100xfenok-next/public/data/admin/fenok-edge-korea-krx-daily-index.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    // The first healthy KRX observation creates this bounded public-safe
    // history. Keep the route optional until that producer has run, then copy
    // it byte-for-byte on every Update Manifest materialization.
    source: "data/computed/fenok-edge-korea-krx-bridge-history.json",
    destination: "100xfenok-next/public/data/computed/fenok-edge-korea-krx-bridge-history.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: false,
    trailing_slash: false,
  },
  {
    source: "data/computed/fenok_occ_options_availability.json",
    destination: "100xfenok-next/public/data/computed/fenok_occ_options_availability.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/computed/market_facts/index.json",
    destination: "100xfenok-next/public/data/computed/market_facts/index.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/computed/fenok_etf_core_daily_basket_summary.json",
    destination: "100xfenok-next/public/data/computed/fenok_etf_core_daily_basket_summary.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  // Batch 2 canonical-only producer mirrors (2026-08-11). The nine
  // build-stocks-analyzer lane producers publish only data/ paths; these
  // routes re-establish their former public mirrors at the merge boundary.
  // Bounded files are exact cp_file routes; the dynamic investor set is an
  // exact rsync_tree mirror except for the explicit public exclusion below.
  {
    source: "data/global-scouter/core/stocks_analyzer.json",
    destination: "100xfenok-next/public/data/global-scouter/core/stocks_analyzer.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/global-scouter/core/per_bands_index.json",
    destination: "100xfenok-next/public/data/global-scouter/core/per_bands_index.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/global-scouter/core/slick_index.json",
    destination: "100xfenok-next/public/data/global-scouter/core/slick_index.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/global-scouter/core/revision_movers.json",
    destination: "100xfenok-next/public/data/global-scouter/core/revision_movers.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/sec-13f/summary.json",
    destination: "100xfenok-next/public/data/sec-13f/summary.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/sec-13f/by_sector.json",
    destination: "100xfenok-next/public/data/sec-13f/by_sector.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/sec-13f/by_ticker.json",
    destination: "100xfenok-next/public/data/sec-13f/by_ticker.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/sec-13f/analytics/consensus.json",
    destination: "100xfenok-next/public/data/sec-13f/analytics/consensus.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/sec-13f/analytics/ticker_aliases.json",
    destination: "100xfenok-next/public/data/sec-13f/analytics/ticker_aliases.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/sec-13f/analytics/trades_ranking.json",
    destination: "100xfenok-next/public/data/sec-13f/analytics/trades_ranking.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/sec-13f/analytics/portfolio_views.json",
    destination: "100xfenok-next/public/data/sec-13f/analytics/portfolio_views.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/sec-13f/analytics/guru_holders_index.json",
    destination: "100xfenok-next/public/data/sec-13f/analytics/guru_holders_index.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/damodaran",
    destination: "100xfenok-next/public/data/damodaran",
    mode: "rsync_tree",
    delete: true,
    excludes: [],
    required: true,
    trailing_slash: true,
  },
  {
    source: "data/calendar/prev-values.json",
    destination: "100xfenok-next/public/data/calendar/prev-values.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/sec-13f/investors",
    destination: "100xfenok-next/public/data/sec-13f/investors",
    mode: "rsync_tree",
    delete: true,
    // griffin.json is an intentionally absent public mirror artifact and is
    // explicitly ignored at that destination by the repository contract.
    excludes: ["griffin.json"],
    required: true,
    trailing_slash: true,
  },
];

// Hand-maintained central commit paths, EXCLUDING materialization
// destinations. Every route destination is derived from
// UPDATE_MANIFEST_MATERIALIZATIONS and appended in route-table order (see
// deriveCentralCommitPaths), so adding a materialization route cannot desync
// the central staging policy. The base keeps its stable relative order and
// must never repeat a route destination.
export const CENTRAL_COMMIT_PATHS = [
  "data/computed/signals.json",
  "data/computed/stock_action_index.json",
  "data/computed/stock_action_summary.json",
  "data/computed/fenok_signals.json",
  "data/computed/fenok_signals_summary.json",
  "data/computed/fenok_etf_signals.json",
  "data/computed/fenok_etf_signals_summary.json",
  "data/computed/etf_action_index.json",
  "data/computed/fenok_etf_core_daily_basket_summary.json",
  "data/computed/market_facts",
  "data/computed/market_source_parity.json",
  "data/computed/market_data_audit.json",
  "data/computed/entity_graph.json",
  "data/computed/entity_graph_stock_index.json",
  "data/computed/entity_graph_stock_services.json",
  "data/computed/market_structure_index.json",
  "data/computed/rim-index/inputs.json",
  "data/computed/rim-index/FENO_RIM_FIVE_CANONICAL_CURRENT.json",
  "data/yf/finance/_summary.json",
  "data/stockanalysis/backfill/history_gap_report_latest.json",
  "data/slickcharts/discovery-summary.json",
  "data/slickcharts/membership-changes.json",
  "data/slickcharts/universe.json",
  "data/admin/fenok-s1-stock-public-promotion-dry-run.json",
  "data/admin/fenok-edge-coverage-index.json",
  "data/admin/fenok-s0-finra-occ-mapping-ledger.json",
  "data/admin/fenok-edge-etf-daily1y-readiness.json",
  "data/admin/fenok-edge-etf-daily1y-fetchable-plan.json",
  "data/admin/fenok-etf-core-daily-basket.json",
  "data/admin/data-usage-manifest.json",
  "data/admin/product-surface-coverage.json",
  "data/admin/fenok-data-health-kpi.json",
  "data/admin/lane-registry-projection.json",
  "data/manifest.json",
  "100xfenok-next/public/data/computed/signals.json",
  "100xfenok-next/public/data/computed/stock_action_index.json",
  "100xfenok-next/public/data/computed/stock_action_summary.json",
  "100xfenok-next/public/data/computed/fenok_signals_summary.json",
  "100xfenok-next/public/data/computed/fenok_etf_signals_summary.json",
  "100xfenok-next/public/data/computed/market_source_parity.json",
  "100xfenok-next/public/data/computed/market_data_audit.json",
  "100xfenok-next/public/data/computed/entity_graph.json",
  "100xfenok-next/public/data/computed/entity_graph_stock_index.json",
  "100xfenok-next/public/data/computed/entity_graph_stock_services.json",
  "100xfenok-next/public/data/computed/market_structure_index.json",
  "100xfenok-next/public/data/computed/rim-index/inputs.json",
  "100xfenok-next/public/data/admin/fenok-edge-coverage-index.json",
  "100xfenok-next/public/data/admin/data-usage-manifest.json",
  "100xfenok-next/public/data/admin/product-surface-coverage.json",
  "100xfenok-next/public/data/admin/fenok-data-health-kpi.json",
  "100xfenok-next/public/data/admin/lane-registry-projection.json",
  "100xfenok-next/public/data/manifest.json",
  "100xfenok-next/src/generated/static-route-manifest.ts",
];

function materializationDestinations(routes = UPDATE_MANIFEST_MATERIALIZATIONS) {
  if (!Array.isArray(routes)) fail("materialization routes must be an array");
  const destinations = routes.map((route, index) => {
    if (!route || typeof route !== "object" || Array.isArray(route) || typeof route.destination !== "string") {
      fail(`materialization route ${index} has no destination`);
    }
    validatePathString(route.destination, `materialization route ${index}.destination`);
    return route.destination;
  });
  const seen = new Set();
  for (const destination of destinations) {
    if (seen.has(destination)) fail(`materialization destinations contain duplicates: ${destination}`);
    seen.add(destination);
  }
  return destinations;
}

// Single authority for the file/directory kind of a central commit path. A
// path whose final segment carries an extension is a file; everything else
// (bare names and extensionless directories) is a directory. Consumers must
// import this classifier instead of re-deriving the extension heuristic.
export function centralCommitPathKind(pathValue) {
  return pathValue.includes("/") && pathValue.split("/").at(-1).includes(".") ? "file" : "directory";
}

// Single source of truth for the final central list: the hand-maintained base
// (non-materialization paths only, stable relative order) followed by every
// route destination in route-table order. Uniqueness and base/destination
// disjointness are enforced here and re-validated on the generated manifest,
// so a route addition needs no central-path edit and cannot introduce
// duplicates or unsafe paths.
export function deriveCentralCommitPaths(routes = UPDATE_MANIFEST_MATERIALIZATIONS) {
  const base = [...CENTRAL_COMMIT_PATHS];
  const baseSet = new Set(base);
  if (baseSet.size !== base.length) fail("central commit base paths contain duplicates");
  const destinations = materializationDestinations(routes);
  for (const destination of destinations) {
    if (baseSet.has(destination)) fail(`materialization destination duplicates a central base path: ${destination}`);
  }
  return [...base, ...destinations];
}

function fail(message) {
  throw new Error(`lane-commit-manifest: ${message}`);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function validatePathString(value, context) {
  if (typeof value !== "string" || value.length === 0 || value.startsWith("/") || value.split("/").includes("..") || /[\u0000-\u001f\u007f]/.test(value)) {
    fail(`${context} is unsafe`);
  }
}

function validateSpec(entry, context) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(`${context} must be an object`);
  const keys = Object.keys(entry).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["kind", "path", "required"])) fail(`${context} keys are invalid`);
  validatePathString(entry.path, `${context}.path`);
  if (!COMMIT_PATH_KINDS.includes(entry.kind)) fail(`${context}.kind is invalid`);
  if (typeof entry.required !== "boolean") fail(`${context}.required must be boolean`);
}

function validateManifestWorkflow(entry, workflowRel, registry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(`workflow ${workflowRel} must be an object`);
  const keys = Object.keys(entry).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["exclude", "lanes", "stages"])) fail(`workflow ${workflowRel} keys are invalid`);
  if (!Array.isArray(entry.lanes)) fail(`workflow ${workflowRel}.lanes must be an array`);
  for (const laneId of entry.lanes) {
    if (!registry.lanes.some((laneValue) => laneValue.id === laneId)) fail(`workflow ${workflowRel} references unknown lane ${laneId}`);
  }
  if (!entry.stages || typeof entry.stages !== "object" || Array.isArray(entry.stages)) fail(`workflow ${workflowRel}.stages must be an object`);
  if (JSON.stringify(Object.keys(entry.stages).sort()) !== JSON.stringify([...COMMIT_STAGE_KEYS].sort())) fail(`workflow ${workflowRel}.stages keys are invalid`);
  const stageEntryCount = COMMIT_STAGE_KEYS.reduce((count, stage) => count + (Array.isArray(entry.stages[stage]) ? entry.stages[stage].length : 0), 0);
  if (stageEntryCount === 0) fail(`workflow ${workflowRel} has no declared staging entries`);
  for (const stage of COMMIT_STAGE_KEYS) {
    if (!Array.isArray(entry.stages[stage])) fail(`workflow ${workflowRel}.stages.${stage} must be an array`);
    const seen = new Set();
    for (const [index, spec] of entry.stages[stage].entries()) {
      validateSpec(spec, `workflow ${workflowRel}.stages.${stage}[${index}]`);
      if (seen.has(spec.path)) fail(`workflow ${workflowRel} duplicates ${spec.path}`);
      seen.add(spec.path);
    }
  }
  if (!Array.isArray(entry.exclude)) fail(`workflow ${workflowRel}.exclude must be an array`);
  for (const [index, spec] of entry.exclude.entries()) validateSpec(spec, `workflow ${workflowRel}.exclude[${index}]`);
}

export function validateLaneCommitManifest(manifest, { registry = LANE_REGISTRY } = {}) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) fail("manifest must be an object");
  const keys = Object.keys(manifest).sort();
  const expected = ["registry_digest", "registry_schema", "schema_version", "update_manifest", "workflows"];
  if (JSON.stringify(keys) !== JSON.stringify(expected)) fail(`top-level keys are invalid: ${keys.join(",")}`);
  if (manifest.schema_version !== COMMIT_MANIFEST_SCHEMA) fail("schema_version is invalid");
  validateLaneRegistry(registry);
  if (manifest.registry_schema !== registry.schema_version) fail("registry_schema is stale");
  const expectedDigest = registryDigestFor(registry);
  if (manifest.registry_digest !== expectedDigest) fail("registry_digest is stale");
  if (!manifest.workflows || typeof manifest.workflows !== "object" || Array.isArray(manifest.workflows)) fail("workflows must be an object");
  const expectedWorkflows = Object.keys(registry.workflow_policies).sort();
  const actualWorkflows = Object.keys(manifest.workflows).sort();
  if (JSON.stringify(expectedWorkflows) !== JSON.stringify(actualWorkflows)) fail("workflow key set is stale");
  for (const workflowRel of expectedWorkflows) validateManifestWorkflow(manifest.workflows[workflowRel], workflowRel, registry);

  const update = manifest.update_manifest;
  if (!update || typeof update !== "object" || Array.isArray(update)) fail("update_manifest must be an object");
  if (JSON.stringify(Object.keys(update).sort()) !== JSON.stringify(["central_commit_paths", "materializations", "trigger_paths"])) fail("update_manifest keys are invalid");
  if (!Array.isArray(update.trigger_paths) || update.trigger_paths.length === 0) fail("trigger_paths must be non-empty");
  for (const [index, trigger] of update.trigger_paths.entries()) validatePathString(trigger, `trigger_paths[${index}]`);
  if (!Array.isArray(update.central_commit_paths) || update.central_commit_paths.length === 0) fail("central_commit_paths must be non-empty");
  const seenCentral = new Set();
  for (const [index, pathValue] of update.central_commit_paths.entries()) {
    validatePathString(pathValue, `central_commit_paths[${index}]`);
    if (seenCentral.has(pathValue)) fail(`central_commit_paths duplicates ${pathValue}`);
    seenCentral.add(pathValue);
  }
  if (!Array.isArray(update.materializations) || update.materializations.length !== UPDATE_MANIFEST_MATERIALIZATIONS.length) {
    fail(`materializations must contain exactly ${UPDATE_MANIFEST_MATERIALIZATIONS.length} routes`);
  }
  for (const [index, route] of update.materializations.entries()) {
    const routeKeys = Object.keys(route).sort();
    if (JSON.stringify(routeKeys) !== JSON.stringify(["delete", "destination", "excludes", "mode", "required", "source", "trailing_slash"])) fail(`materializations[${index}] keys are invalid`);
    validatePathString(route.source, `materializations[${index}].source`);
    validatePathString(route.destination, `materializations[${index}].destination`);
    if (!Array.isArray(route.excludes)) fail(`materializations[${index}].excludes must be an array`);
    const seenExcludes = new Set();
    for (const [excludeIndex, exclude] of route.excludes.entries()) {
      validatePathString(exclude, `materializations[${index}].excludes[${excludeIndex}]`);
      if (exclude.endsWith("/") || exclude.includes("*")) fail(`materializations[${index}].excludes[${excludeIndex}] must be an exact relative path`);
      if (seenExcludes.has(exclude)) fail(`materializations[${index}].excludes duplicates ${exclude}`);
      seenExcludes.add(exclude);
    }
    if (!["cp_file", "rsync_tree"].includes(route.mode)) fail(`materializations[${index}].mode is invalid`);
    if (typeof route.delete !== "boolean" || typeof route.required !== "boolean" || typeof route.trailing_slash !== "boolean") fail(`materializations[${index}] booleans are invalid`);
    if (route.mode === "rsync_tree" && route.trailing_slash !== true) fail(`materializations[${index}] rsync route must declare trailing slash semantics`);
    if (route.mode === "cp_file" && route.trailing_slash !== false) fail(`materializations[${index}] cp route must not carry trailing slash semantics`);
    if (route.mode === "cp_file" && route.excludes.length > 0) fail(`materializations[${index}] cp route cannot exclude paths`);
  }
  return true;
}

function registryDigestFor(registry) {
  // Keep the digest calculation coupled to the exact registry input, including
  // injected fixtures used by tests, rather than silently hashing the default.
  return (registry === LANE_REGISTRY)
    ? registryDigest()
    : createHash("sha256").update(canonicalJson(registry), "utf8").digest("hex");
}

export function buildLaneCommitManifest(registry = LANE_REGISTRY) {
  validateLaneRegistry(registry);
  const workflows = {};
  for (const workflowRel of Object.keys(registry.workflow_policies).sort()) {
    workflows[workflowRel] = cloneJson(registry.workflow_policies[workflowRel]);
  }
  const centralCommitPaths = deriveCentralCommitPaths();
  // Update Manifest's central staging policy is published in the dedicated
  // top-level contract as well as its workflow entry, so a consumer can prove
  // the workflow key/stage/count before reading the central path list.
  workflows[".github/workflows/update-manifest.yml"].stages.always_if_exists = centralCommitPaths.map((pathValue) => ({
    path: pathValue,
    kind: centralCommitPathKind(pathValue),
    required: false,
  }));
  const manifest = {
    schema_version: COMMIT_MANIFEST_SCHEMA,
    registry_schema: registry.schema_version,
    registry_digest: registryDigestFor(registry),
    workflows,
    update_manifest: {
      trigger_paths: [...UPDATE_MANIFEST_TRIGGER_PATHS],
      materializations: cloneJson(UPDATE_MANIFEST_MATERIALIZATIONS),
      central_commit_paths: [...centralCommitPaths],
    },
  };
  validateLaneCommitManifest(manifest, { registry });
  return manifest;
}

export function emitLaneCommitManifest({ registry = LANE_REGISTRY, outputPath = DEFAULT_OUTPUT_PATH } = {}) {
  const manifest = buildLaneCommitManifest(registry);
  const text = `${JSON.stringify(JSON.parse(canonicalJson(manifest)), null, 2)}\n`;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, text);
  return manifest;
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const outputPath = process.argv.includes("--output")
    ? path.resolve(process.argv[process.argv.indexOf("--output") + 1])
    : DEFAULT_OUTPUT_PATH;
  const built = buildLaneCommitManifest();
  if (checkOnly) {
    if (!fs.existsSync(outputPath)) fail(`generated manifest is missing: ${path.relative(REPO_ROOT, outputPath)}`);
    const existing = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    if (canonicalJson(existing) !== canonicalJson(built)) fail(`generated manifest is stale: ${path.relative(REPO_ROOT, outputPath)}`);
    console.log(`lane-commit-manifest: ok (${path.relative(REPO_ROOT, outputPath)}; registry_digest=${built.registry_digest})`);
    return;
  }
  emitLaneCommitManifest({ outputPath });
  console.log(`lane-commit-manifest: wrote ${path.relative(REPO_ROOT, outputPath)} (registry_digest=${built.registry_digest})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
