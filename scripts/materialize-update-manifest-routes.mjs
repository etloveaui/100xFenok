#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";


const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

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
    source: "data/yf/quarter_closes.json",
    destination: "100xfenok-next/public/data/yf/quarter_closes.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
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
    // Public-safe aggregate index closes; no per-issuer rows.
    source: "data/computed/fenok-edge-korea-krx-index-daily.json",
    destination: "100xfenok-next/public/data/computed/fenok-edge-korea-krx-index-daily.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    // Public-safe KOSDAQ market-level concentration aggregate; no issuer rows.
    source: "data/computed/fenok-edge-korea-krx-kosdaq-market-cap-aggregate.json",
    destination: "100xfenok-next/public/data/computed/fenok-edge-korea-krx-kosdaq-market-cap-aggregate.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  // fenok_occ_options_availability is public_safe_aggregate: its public
  // projection is a slim marker (rows/side_attempts stripped) produced by
  // fetch-fenok-occ-options-volume.mjs:writePublicSlimAvailability, not a
  // verbatim cp_file. The previous verbatim route fattened the public file
  // to 25.5 MiB on 0deda857ee via materialize-update-manifest-routes. Exclude
  // it from generic materialization; the edge-daily lane stages the slim
  // marker directly.
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
    source: "data/sec-13f/README.md",
    destination: "100xfenok-next/public/data/sec-13f/README.md",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/sec-13f/schema.json",
    destination: "100xfenok-next/public/data/sec-13f/schema.json",
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
    source: "data/sec-13f/analytics/buying_pressure.json",
    destination: "100xfenok-next/public/data/sec-13f/analytics/buying_pressure.json",
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
    source: "data/sec-13f/analytics/conviction.json",
    destination: "100xfenok-next/public/data/sec-13f/analytics/conviction.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/sec-13f/analytics/conviction_entries.json",
    destination: "100xfenok-next/public/data/sec-13f/analytics/conviction_entries.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/sec-13f/analytics/enhanced_consensus.json",
    destination: "100xfenok-next/public/data/sec-13f/analytics/enhanced_consensus.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/sec-13f/analytics/hhi.json",
    destination: "100xfenok-next/public/data/sec-13f/analytics/hhi.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/sec-13f/analytics/multi_quarter_trends.json",
    destination: "100xfenok-next/public/data/sec-13f/analytics/multi_quarter_trends.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/sec-13f/analytics/new_positions.json",
    destination: "100xfenok-next/public/data/sec-13f/analytics/new_positions.json",
    mode: "cp_file",
    delete: false,
    excludes: [],
    required: true,
    trailing_slash: false,
  },
  {
    source: "data/sec-13f/analytics/options_hedge.json",
    destination: "100xfenok-next/public/data/sec-13f/analytics/options_hedge.json",
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
    source: "data/sec-13f/analytics/factor_exposures_summary.json",
    destination: "100xfenok-next/public/data/sec-13f/analytics/factor_exposures_summary.json",
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
    source: "data/sec-13f/analytics/turnover.json",
    destination: "100xfenok-next/public/data/sec-13f/analytics/turnover.json",
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
    // griffin.json is an intentionally absent public mirror artifact. The
    // materializer purges a stale destination copy before the delete-parity
    // rsync, so an old public bundle cannot keep serving the private file.
    excludes: ["griffin.json"],
    remove_excluded: ["griffin.json"],
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
  "data/metadata",
  "data/computed/signals.json",
  "data/computed/stock_action_index.json",
  "data/computed/sec13f_bridge_index.json",
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
  "data/admin/data-supply-detection-floor.json",
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
    assertSafeRelative(route.destination, `materialization route ${index}.destination`);
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
// disjointness are enforced here,
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
  throw new Error(`update-manifest materialization: ${message}`);
}

function isWithin(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function assertSafeRelative(value, label) {
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value) || value.split("/").includes("..") || /[\u0000-\u001f\u007f]/.test(value)) {
    fail(`${label} is unsafe`);
  }
}

function lstatIfExists(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function assertNoSymlinkComponents(target, allowRoot, label) {
  const relative = path.relative(allowRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail(`${label} escapes its allow-root`);
  let current = allowRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = lstatIfExists(current);
    if (!stat) break;
    if (stat.isSymbolicLink()) fail(`${label} contains a symlink`);
  }
}

function assertTreeHasNoSymlinks(root, label) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isSymbolicLink()) fail(`${label} contains a symlink`);
    if (entry.isDirectory()) assertTreeHasNoSymlinks(target, label);
  }
}

function treeContainsFile(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile()) return true;
    if (entry.isDirectory() && treeContainsFile(path.join(root, entry.name))) return true;
  }
  return false;
}

function pathsOverlap(left, right) {
  return isWithin(left, right) || isWithin(right, left);
}

function routeKey(route) {
  return `${route.source}\u0000${route.destination}`;
}

function isExcluded(relativePath, excludes) {
  return excludes.some(
    (exclude) => relativePath === exclude || relativePath.startsWith(`${exclude}/`),
  );
}

function removeExcludedDestinations(destination, relativePaths) {
  for (const relativePath of relativePaths) {
    const target = path.join(destination, relativePath);
    const stat = lstatIfExists(target);
    if (!stat) continue;
    if (stat.isSymbolicLink()) fail(`excluded destination is a symlink: ${relativePath}`);
    fs.rmSync(target, { recursive: stat.isDirectory() });
  }
}

export function validateMaterializationRoutes({ repoRoot, routes }) {
  const resolvedRepo = fs.realpathSync(repoRoot);
  const sourceAllow = path.join(resolvedRepo, "data");
  const destinationAllow = path.join(resolvedRepo, "100xfenok-next/public/data");
  for (const [allowRoot, label] of [[sourceAllow, "source allow-root"], [destinationAllow, "destination allow-root"]]) {
    const stat = lstatIfExists(allowRoot);
    if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) fail(`${label} must be a real directory`);
    if (!isWithin(fs.realpathSync(allowRoot), resolvedRepo)) fail(`${label} escapes repo root`);
  }
  const seenRoutes = new Set();
  const seenDestinations = new Set();
  const prepared = [];
  if (!Array.isArray(routes)) fail("materialization routes must be an array");
  for (const [index, route] of routes.entries()) {
    if (!route || typeof route !== "object" || Array.isArray(route)) fail(`routes[${index}] must be an object`);
    if (["delete", "required", "trailing_slash"].some((key) => typeof route[key] !== "boolean")) fail(`routes[${index}] booleans are invalid`);
    assertSafeRelative(route.source, `routes[${index}].source`);
    assertSafeRelative(route.destination, `routes[${index}].destination`);
    if (!route.source.startsWith("data/")) fail(`routes[${index}] source is outside canonical data root`);
    if (!route.destination.startsWith("100xfenok-next/public/data/")) fail(`routes[${index}] destination is outside public data root`);
    if (seenRoutes.has(routeKey(route))) fail(`routes[${index}] duplicates a route`);
    if (seenDestinations.has(route.destination)) fail(`routes[${index}] duplicates a destination`);
    seenRoutes.add(routeKey(route));
    seenDestinations.add(route.destination);
    if (route.mode === "cp_file") {
      if (route.delete !== false || route.trailing_slash !== false) fail(`routes[${index}] cp_file flags are invalid`);
    } else if (route.mode === "rsync_tree") {
      // delete:false rsync routes are the non-destructive directory form: the
      // boundary may refresh source-owned files but must never remove
      // destination-only content (public-only/admin/private/archive bytes).
      // delete is validated as boolean above; only trailing-slash semantics
      // are mandatory here.
      if (route.trailing_slash !== true) fail(`routes[${index}] rsync_tree flags are invalid`);
    } else fail(`routes[${index}] mode is invalid`);
    if (!Array.isArray(route.excludes)) fail(`routes[${index}] excludes must be an array`);
    const seenExcludes = new Set();
    for (const [excludeIndex, exclude] of route.excludes.entries()) {
      assertSafeRelative(exclude, `routes[${index}].excludes[${excludeIndex}]`);
      if (exclude.endsWith("/") || exclude.includes("*")) {
        fail(`routes[${index}].excludes[${excludeIndex}] must be an exact relative path`);
      }
      if (seenExcludes.has(exclude)) fail(`routes[${index}].excludes duplicates ${exclude}`);
      seenExcludes.add(exclude);
    }
    if (route.mode === "cp_file" && route.excludes.length > 0) {
      fail(`routes[${index}] cp_file cannot exclude paths`);
    }
    if (route.remove_excluded !== undefined) {
      if (!Array.isArray(route.remove_excluded)) fail(`routes[${index}].remove_excluded must be an array`);
      const seenRemoved = new Set();
      for (const [removeIndex, relativePath] of route.remove_excluded.entries()) {
        assertSafeRelative(relativePath, `routes[${index}].remove_excluded[${removeIndex}]`);
        if (!route.excludes.includes(relativePath)) {
          fail(`routes[${index}].remove_excluded[${removeIndex}] must also be excluded`);
        }
        if (seenRemoved.has(relativePath)) fail(`routes[${index}].remove_excluded duplicates ${relativePath}`);
        seenRemoved.add(relativePath);
      }
      if (route.mode !== "rsync_tree" || route.delete !== true) {
        fail(`routes[${index}].remove_excluded requires delete-parity rsync_tree`);
      }
    }
    const sourceAbs = path.resolve(resolvedRepo, route.source);
    const destinationAbs = path.resolve(resolvedRepo, route.destination);
    if (!isWithin(sourceAbs, sourceAllow) || sourceAbs === sourceAllow) fail(`routes[${index}] source escapes canonical data root`);
    if (!isWithin(destinationAbs, destinationAllow) || destinationAbs === destinationAllow) fail(`routes[${index}] destination escapes public data root`);
    if (pathsOverlap(sourceAbs, destinationAbs)) fail(`routes[${index}] source and destination overlap`);
    assertNoSymlinkComponents(sourceAbs, sourceAllow, `routes[${index}] source`);
    assertNoSymlinkComponents(destinationAbs, destinationAllow, `routes[${index}] destination`);
    const sourceStat = lstatIfExists(sourceAbs);
    const destinationStat = lstatIfExists(destinationAbs);
    if (destinationStat?.isSymbolicLink()) fail(`routes[${index}] destination contains a symlink`);
    if (destinationStat && route.mode === "cp_file" && !destinationStat.isFile()) fail(`routes[${index}] cp_file destination is not a file`);
    if (destinationStat && route.mode === "rsync_tree" && !destinationStat.isDirectory()) fail(`routes[${index}] rsync_tree destination is not a directory`);
    if (route.mode === "rsync_tree" && destinationStat) {
      assertTreeHasNoSymlinks(destinationAbs, `routes[${index}] destination`);
    }
    if (!sourceStat) {
      if (route.required) fail(`routes[${index}] required source is missing`);
      prepared.push({
        ...route,
        sourceAbs,
        destinationAbs,
        skip: true,
        removeStaleDestination: destinationStat !== null,
      });
      continue;
    }
    if (sourceStat.isSymbolicLink()) fail(`routes[${index}] source contains a symlink`);
    if (route.mode === "cp_file" && !sourceStat.isFile()) fail(`routes[${index}] cp_file source is not a file`);
    if (route.mode === "rsync_tree" && !sourceStat.isDirectory()) fail(`routes[${index}] rsync_tree source is not a directory`);
    if (route.mode === "rsync_tree" && !treeContainsFile(sourceAbs)) fail(`routes[${index}] rsync_tree source is empty`);
    if (route.mode === "rsync_tree") {
      assertTreeHasNoSymlinks(sourceAbs, `routes[${index}] source`);
    }
    if (route.source === "data/stockanalysis") {
      const backfill = path.join(sourceAbs, "backfill");
      if (lstatIfExists(backfill)?.isDirectory()) {
        for (const entry of fs.readdirSync(backfill)) {
          if (entry.includes(".partial.") || entry.endsWith(".ignored")) {
            fail(`routes[${index}] source contains a private backfill scratch path: ${entry}`);
          }
        }
      }
    }
    prepared.push({ ...route, sourceAbs, destinationAbs, skip: false, removeStaleDestination: false });
  }
  return { repoRoot: resolvedRepo, prepared };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) fail(`${command} failed: ${(result.stderr || result.stdout || "unknown error").trim()}`);
  return result.stdout;
}

function listTree(root, excludes = [], prefix = "") {
  const rows = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (isExcluded(relative, excludes)) continue;
    const target = path.join(root, entry.name);
    if (entry.isSymbolicLink()) fail("tree parity encountered a symlink");
    if (entry.isDirectory()) rows.push([`${relative}/`, null], ...listTree(target, excludes, relative));
    else if (entry.isFile()) rows.push([relative, fs.readFileSync(target)]);
    else fail("tree parity encountered an unsupported entry");
  }
  return rows;
}

function assertTreeParity(source, destination, excludes = []) {
  const left = listTree(source, excludes);
  const right = listTree(destination, excludes);
  if (left.length !== right.length) fail("rsync tree parity count differs");
  for (let index = 0; index < left.length; index += 1) {
    const [leftPath, leftContents] = left[index];
    const [rightPath, rightContents] = right[index];
    const contentsDiffer = leftContents === null
      ? rightContents !== null
      : rightContents === null || !leftContents.equals(rightContents);
    if (leftPath !== rightPath || contentsDiffer) fail("rsync tree parity differs");
  }
}

// delete:false semantics: every source entry must exist in the destination
// with identical bytes (canonical/public equality for covered outputs), while
// extra destination entries are deliberately ignored because the boundary
// must never delete destination-only content.
function assertTreeSubsetParity(source, destination, excludes = []) {
  const right = listTree(destination, excludes);
  const rightByPath = new Map(right.map(([relativePath, contents]) => [relativePath, contents]));
  for (const [leftPath, leftContents] of listTree(source, excludes)) {
    const rightContents = rightByPath.get(leftPath);
    if (rightContents === undefined) fail(`rsync subset parity missing destination entry: ${leftPath}`);
    const contentsDiffer = leftContents === null
      ? rightContents !== null
      : rightContents === null || !leftContents.equals(rightContents);
    if (contentsDiffer) fail(`rsync subset parity differs: ${leftPath}`);
  }
}

function assertNoUntracked(repoRoot, routes) {
  for (const route of routes) {
    const untracked = run("git", ["ls-files", "--others", "--exclude-standard", "--", route.source], { cwd: repoRoot });
    const ignored = run("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "--", route.source], { cwd: repoRoot });
    if (untracked.trim() || ignored.trim()) fail(`untracked or ignored pre-reset route source content: ${route.source}`);
  }
}

export function orderMaterializations(routes) {
  return [...routes].sort((left, right) => {
    const leftRank = left.mode === "cp_file" ? 0 : 1;
    const rightRank = right.mode === "cp_file" ? 0 : 1;
    return leftRank - rightRank;
  });
}

function parseArgs(argv) {
  const options = { repoRoot: DEFAULT_REPO_ROOT, all: false, routeSources: [], validateOnly: false, assertNoUntracked: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--repo-root", "--route-source"].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
      index += 1;
      if (argument === "--repo-root") options.repoRoot = path.resolve(value);
      else options.routeSources.push(value);
    } else if (argument === "--all") options.all = true;
    else if (argument === "--validate-only") options.validateOnly = true;
    else if (argument === "--assert-no-untracked") options.assertNoUntracked = true;
    else fail(`unknown argument: ${argument}`);
  }
  if (options.all === (options.routeSources.length > 0)) fail("select exactly --all or one or more --route-source values");
  return options;
}

export function materializeUpdateManifestRoutes(options) {
  const routes = UPDATE_MANIFEST_MATERIALIZATIONS;
  const validation = validateMaterializationRoutes({ repoRoot: options.repoRoot, routes });
  const selected = options.all
    ? validation.prepared
    : options.routeSources.map((source) => {
      const matches = validation.prepared.filter((route) => route.source === source);
      if (matches.length !== 1) fail(`route source must match exactly once: ${source}`);
      return matches[0];
    });
  if (new Set(selected.map((route) => route.source)).size !== selected.length) fail("route source selection contains duplicates");
  if (options.assertNoUntracked) assertNoUntracked(validation.repoRoot, selected);
  if (options.validateOnly) return { count: selected.length, materialized: 0 };
  let materialized = 0;
  for (const route of orderMaterializations(selected)) {
    if (route.skip) {
      if (route.removeStaleDestination && (route.mode === "cp_file" || route.delete === true)) {
        if (route.mode === "cp_file") fs.unlinkSync(route.destinationAbs);
        else fs.rmSync(route.destinationAbs, { recursive: true });
        materialized += 1;
      }
      continue;
    }
    if (route.mode === "cp_file") {
      fs.mkdirSync(path.dirname(route.destinationAbs), { recursive: true });
      fs.copyFileSync(route.sourceAbs, route.destinationAbs);
      if (!fs.readFileSync(route.sourceAbs).equals(fs.readFileSync(route.destinationAbs))) fail("cp_file parity differs");
    } else {
      fs.mkdirSync(route.destinationAbs, { recursive: true });
      if (route.remove_excluded?.length) {
        removeExcludedDestinations(route.destinationAbs, route.remove_excluded);
      }
      // Anchored exact-path rules work for both files (griffin.json) and
      // directory entries (etfs) without broad glob matching.
      const excludeArgs = route.excludes.flatMap((exclude) => ["--exclude", `/${exclude}`]);
      const syncArgs = ["-a", "--checksum", ...(route.delete ? ["--delete"] : []), ...excludeArgs, `${route.sourceAbs}/`, `${route.destinationAbs}/`];
      run(
        "rsync",
        syncArgs,
        { cwd: validation.repoRoot },
      );
      if (route.delete) assertTreeParity(route.sourceAbs, route.destinationAbs, route.excludes);
      else assertTreeSubsetParity(route.sourceAbs, route.destinationAbs, route.excludes);
    }
    materialized += 1;
  }
  return { count: selected.length, materialized };
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = materializeUpdateManifestRoutes(options);
    console.log(`update-manifest materialization: selected=${result.count} materialized=${result.materialized}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
