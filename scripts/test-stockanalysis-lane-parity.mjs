import assert from "node:assert/strict";

import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";
import { LANE_REGISTRY, PLANE_PUBLISH_FAMILY_BINDINGS } from "./lib/lane-registry.mjs";

const ownerWorkflow = ".github/workflows/fetch-stockanalysis.yml";
const expected = [
  "yahoo_etf_fallback",
  "stockanalysis_etf_universe",
  "stockanalysis_etf_detail",
  "stockanalysis_stock_financial",
  "stockanalysis_surfaces",
];
const registryLanes = LANE_REGISTRY.lanes
  .filter((lane) => lane.owner_workflow === ownerWorkflow && expected.includes(lane.id))
  .map((lane) => lane.id).sort();
assert.deepEqual(registryLanes, [...expected].sort());
for (const id of expected) {
  assert.ok(DATA_SUPPLY_DETECTION_CONFIG.lanes.some((lane) => lane.id === id), `${id} is missing detection policy`);
}
assert.deepEqual(PLANE_PUBLISH_FAMILY_BINDINGS["stockanalysis-etf-detail"], {
  lane_id: "stockanalysis_etf_detail",
  workflow: ownerWorkflow,
});

console.log("test-stockanalysis-lane-parity: ok");
