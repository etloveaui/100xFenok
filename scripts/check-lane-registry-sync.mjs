#!/usr/bin/env node
// Lane Registry ⇄ public-sync exclusion cross-check (BACKLOG #366, step 2).
//
// The hand-written EXCLUDED_PUBLIC_DATA_ROOTS stays authoritative; this gate
// makes it impossible to FORGET a lane — the exact 07-18 finra leak class
// (a new admin-private store silently syncing to the public mirror):
//   1. every registry lane whose privacy_class is "private" must have its
//      admin_store root present in EXCLUDED_PUBLIC_DATA_ROOTS;
//   2. every excluded admin/* root must be declared in the registry (as a
//      lane's admin_store or a declared exception).
// Mismatch = loud fail (exit 1). Wired into test-sync-public-data.mjs, so it
// blocks at build-verify time, before any leak reaches a deploy.

import { fileURLToPath } from "node:url";
import { EXCLUDED_PUBLIC_DATA_ROOTS } from "../100xfenok-next/scripts/sync-public-data.mjs";
import { LANE_REGISTRY, declaredExceptionPaths } from "./lib/lane-registry.mjs";

const ADMIN_PREFIX = "admin/";

function storeToExcludedForm(adminStore) {
  return adminStore.replace(/^data\//, "");
}

export function checkSyncExclusionsAgainstRegistry({
  excludedRoots = EXCLUDED_PUBLIC_DATA_ROOTS,
  registry = LANE_REGISTRY,
} = {}) {
  const excluded = new Set(excludedRoots);
  const declaredStores = new Set(
    registry.lanes
      .map((lane) => lane.roots.admin_store)
      .filter((root) => root !== null)
      .map(storeToExcludedForm),
  );
  const declaredExceptions = new Set(
    declaredExceptionPaths("root", registry).map(storeToExcludedForm),
  );

  const missing_exclusions = [];
  for (const lane of registry.lanes) {
    if (lane.privacy_class !== "private" || lane.roots.admin_store === null) continue;
    const root = storeToExcludedForm(lane.roots.admin_store);
    if (!excluded.has(root)) {
      missing_exclusions.push({ lane: lane.id, root });
    }
  }

  const undeclared_exclusions = [];
  for (const root of excludedRoots) {
    if (!root.startsWith(ADMIN_PREFIX)) continue;
    if (!declaredStores.has(root) && !declaredExceptions.has(root)) {
      undeclared_exclusions.push(root);
    }
  }

  return {
    ok: missing_exclusions.length === 0 && undeclared_exclusions.length === 0,
    missing_exclusions,
    undeclared_exclusions,
    private_lanes_checked: registry.lanes
      .filter((lane) => lane.privacy_class === "private" && lane.roots.admin_store !== null)
      .map((lane) => lane.id),
    admin_exclusions_checked: excludedRoots.filter((root) => root.startsWith(ADMIN_PREFIX)),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = checkSyncExclusionsAgainstRegistry();
  for (const row of result.missing_exclusions) {
    console.error(`::error:: lane-registry gate: private lane ${row.lane} store ${row.root} is MISSING from EXCLUDED_PUBLIC_DATA_ROOTS (the 07-18 finra leak class)`);
  }
  for (const root of result.undeclared_exclusions) {
    console.error(`::error:: lane-registry gate: excluded root ${root} is not declared by any lane record or declared exception`);
  }
  if (!result.ok) process.exit(1);
  console.log(`lane-registry sync gate: ok (private lanes: ${result.private_lanes_checked.join(", ") || "none"}; admin exclusions: ${result.admin_exclusions_checked.join(", ")})`);
}
