#!/usr/bin/env node
// Lane Registry ⇄ KPI recovery-source cross-check (BACKLOG #366, step 3).
//
// The defillama class made permanent: a lane with a recovery store on the tree
// whose index the KPI never reads (invisibly healthy) must be unshippable.
// Both directions, path-based so every KPI source shape is covered:
//   1. every registry lane with a recovery_store must have that index path
//      read by the KPI (general lane ids / nonstandard v2 stores / direct reads);
//   2. every KPI recovery source path must be declared as some lane's
//      recovery_store in the registry.
// Mismatch = loud fail (exit 1). Wired into the KPI test suite (build-verify).

import { fileURLToPath } from "node:url";
import { RECOVERY_STATE_SOURCES } from "./build-fenok-data-health-kpi.mjs";
import { LANE_REGISTRY } from "./lib/lane-registry.mjs";

export function kpiRecoverySourcePaths(sources = RECOVERY_STATE_SOURCES) {
  return new Set([
    ...sources.general_lane_ids.map((laneId) => `admin/${laneId}/index.json`),
    ...Object.values(sources.nonstandard),
    ...Object.values(sources.direct),
  ]);
}

export function checkKpiRecoverySourcesAgainstRegistry({
  sources = RECOVERY_STATE_SOURCES,
  registry = LANE_REGISTRY,
} = {}) {
  const kpiPaths = kpiRecoverySourcePaths(sources);
  const registryPaths = new Map();
  for (const lane of registry.lanes) {
    if (lane.recovery_store === null) continue;
    const path = lane.recovery_store.replace(/^data\//, "");
    if (!registryPaths.has(path)) registryPaths.set(path, []);
    registryPaths.get(path).push(lane.id);
  }

  const missing_from_kpi = [];
  for (const [path, laneIds] of registryPaths) {
    if (!kpiPaths.has(path)) missing_from_kpi.push({ path, lanes: laneIds });
  }
  const undeclared_in_kpi = [];
  for (const path of kpiPaths) {
    if (!registryPaths.has(path)) undeclared_in_kpi.push(path);
  }

  return {
    ok: missing_from_kpi.length === 0 && undeclared_in_kpi.length === 0,
    missing_from_kpi,
    undeclared_in_kpi,
    kpi_source_count: kpiPaths.size,
    registry_store_count: registryPaths.size,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = checkKpiRecoverySourcesAgainstRegistry();
  for (const row of result.missing_from_kpi) {
    console.error(`::error:: lane-registry gate: recovery store ${row.path} (${row.lanes.join(",")}) is never read by the KPI (the defillama class)`);
  }
  for (const path of result.undeclared_in_kpi) {
    console.error(`::error:: lane-registry gate: KPI recovery source ${path} is not declared by any lane record`);
  }
  if (!result.ok) process.exit(1);
  console.log(`lane-registry kpi gate: ok (${result.registry_store_count} registry stores, ${result.kpi_source_count} KPI sources, all matched)`);
}
