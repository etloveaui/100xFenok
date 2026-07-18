#!/usr/bin/env node
/**
 * Emit a privacy-filtered projection of the lane registry for the owner data
 * dashboard (#365). The Next app must NOT import scripts/lib/lane-registry.mjs
 * directly (spec design decision 3); it reads this projection instead.
 *
 * The projection carries METADATA ONLY — id, label, store_kind, cadence,
 * enforcement, privacy_class, and the owner_workflow BASENAME. It never emits
 * store roots, attempt/recovery paths, commit shards, or any repo directory
 * structure. The privacy contract is enforced by test-lane-registry-projection.mjs.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LANE_REGISTRY } from "./lib/lane-registry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_PATH = path.join(REPO_ROOT, "data", "admin", "lane-registry-projection.json");
const PUBLIC_OUT_PATH = path.join(
  REPO_ROOT,
  "100xfenok-next",
  "public",
  "data",
  "admin",
  "lane-registry-projection.json",
);

export const PROJECTION_SCHEMA = "lane-registry-projection/v1";

// The ONLY fields that cross into the projection. Anything path-shaped
// (roots, commit_shards, recovery_store, canonical_outputs, public_mirror) is
// deliberately dropped; owner_workflow is reduced to its basename.
export function projectLane(lane) {
  return {
    id: lane.id,
    label: lane.label,
    store_kind: lane.store_kind,
    cadence: {
      kind: lane.cadence?.kind ?? "unknown",
      provider: lane.cadence?.provider ?? null,
    },
    enforcement: lane.enforcement,
    privacy_class: lane.privacy_class,
    owner_workflow: lane.owner_workflow ? path.basename(lane.owner_workflow) : null,
  };
}

export function buildLaneRegistryProjection(registry = LANE_REGISTRY) {
  return {
    schema_version: PROJECTION_SCHEMA,
    generated_at: new Date().toISOString(),
    source_schema_version: registry.schema_version,
    purpose:
      "Admin-safe lane metadata projection for the owner data dashboard. Metadata only — no store roots, attempt/recovery paths, or repo directory structure.",
    lane_count: registry.lanes.length,
    lanes: registry.lanes.map(projectLane),
  };
}

function main() {
  const projection = buildLaneRegistryProjection();
  const json = `${JSON.stringify(projection, null, 2)}\n`;
  for (const target of [OUT_PATH, PUBLIC_OUT_PATH]) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, json);
  }
  console.log(
    `lane-registry projection: ${projection.lanes.length} lanes -> ${path.relative(REPO_ROOT, OUT_PATH)} (+ public mirror)`,
  );
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
