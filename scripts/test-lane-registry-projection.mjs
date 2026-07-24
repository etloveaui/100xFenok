#!/usr/bin/env node
/**
 * Contract test for the lane-registry projection emitter (#365 P1).
 * - RED-first privacy proof: the raw registry serialized WOULD leak paths/roots;
 *   the projection must not. The same detector flags the raw and clears the
 *   projection, proving the privacy filter is load-bearing.
 * - Emitter unit: all registered lanes, exact allowed key set, owner_workflow basename only.
 */

import assert from "node:assert/strict";

import { LANE_REGISTRY } from "./lib/lane-registry.mjs";
import { buildLaneRegistryProjection, projectLane, PROJECTION_SCHEMA } from "./build-lane-registry-projection.mjs";

// Path/privacy markers that must never appear in the admin-safe projection.
// Markers are PATH-shaped on purpose: "_private/" (the private-root prefix), not
// bare "_private" — the lane id "yahoo_private_options" legitimately contains
// "_private" and is NOT a path leak. Likewise cadence.provider legitimately
// contains text like "daily/weekly", so this is not a bare "/" ban.
const FORBIDDEN = ["_private/", "data/admin", ".github/", "100xfenok-next", "public/data", "canonical_outputs", "recovery_store", "commit_shards"];

function privacyViolations(jsonString) {
  return FORBIDDEN.filter((marker) => jsonString.includes(marker));
}

// --- RED-first: the raw registry DOES leak (proves the detector + filter matter) ---
const rawJson = JSON.stringify(LANE_REGISTRY);
const rawViolations = privacyViolations(rawJson);
assert.ok(
  rawViolations.length > 0,
  "RED proof failed: the raw registry should contain path/root markers (the filter must have something to strip)",
);

// --- GREEN: the projection leaks nothing ---
const projection = buildLaneRegistryProjection();
const projectionJson = JSON.stringify(projection);
assert.deepEqual(
  privacyViolations(projectionJson),
  [],
  `projection leaked forbidden markers: ${privacyViolations(projectionJson).join(", ")}`,
);

// --- Emitter unit: shape + counts ---
assert.equal(projection.schema_version, PROJECTION_SCHEMA);
assert.equal(projection.lanes.length, 32, "projection must carry all 32 registry lanes");
assert.equal(projection.lane_count, 32);

const ALLOWED_KEYS = ["cadence", "enforcement", "id", "label", "owner_workflow", "privacy_class", "store_kind"];
for (const lane of projection.lanes) {
  assert.deepEqual(Object.keys(lane).sort(), ALLOWED_KEYS, `lane ${lane.id}: unexpected key set`);
  // owner_workflow is a basename (no directory) or null.
  if (lane.owner_workflow !== null) {
    assert.ok(!lane.owner_workflow.includes("/"), `lane ${lane.id}: owner_workflow must be a basename`);
    assert.ok(lane.owner_workflow.endsWith(".yml"), `lane ${lane.id}: owner_workflow basename should be a .yml`);
  }
  assert.ok(lane.cadence && typeof lane.cadence.kind === "string", `lane ${lane.id}: cadence.kind required`);
}

// Spot-check a known lane against the source record.
const src = LANE_REGISTRY.lanes.find((l) => l.id === "fred_macro");
const projected = projectLane(src);
assert.equal(projected.owner_workflow, "fetch-fred-macro.yml", "basename derivation");
assert.equal(projected.label, "FRED macro");
assert.equal(projected.privacy_class, "public_mirror");
assert.equal(projected.enforcement, "live");
assert.ok(!("roots" in projected) && !("recovery_store" in projected), "no path fields carried");

console.log(JSON.stringify({ ok: true, lanes: projection.lanes.length, red_markers_stripped: rawViolations }, null, 2));
