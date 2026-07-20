import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  assertNoPrivateRunIdsInPublic,
  buildLaneRunIdMap,
  renderLaneRunIdModule,
  writeLaneRunIdMap,
} from "./generate-lane-runid-map.mjs";

const appRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(appRoot, "..");

const fixture = {
  lanes: [
    {
      id: "last_lane",
      details: {
        last_attempt: {
          run_id: "99123456789001",
          event_name: "schedule",
          observed_at: "2026-07-20T01:02:03Z",
        },
        current_attempt: {
          run_id: "99123456789000",
          run_attempt: 4,
          event_name: "workflow_dispatch",
          observed_at: "2026-07-20T00:00:00Z",
        },
      },
    },
    {
      id: "current_lane",
      details: {
        last_attempt: null,
        current_attempt: {
          run_id: 99234567890012,
          run_attempt: 2,
          event_name: "workflow_dispatch",
          observed_at: "2026-07-20T04:05:06Z",
        },
      },
    },
    { id: "null_lane", details: { last_attempt: null, current_attempt: null } },
    { id: "missing_lane", details: {} },
    { id: "unsafe_lane", details: { last_attempt: { run_id: "12/not-a-run" } } },
  ],
};

const expected = {
  current_lane: {
    run_id: "99234567890012",
    run_attempt: 2,
    event_name: "workflow_dispatch",
    observed_at: "2026-07-20T04:05:06Z",
  },
  last_lane: {
    run_id: "99123456789001",
    run_attempt: null,
    event_name: "schedule",
    observed_at: "2026-07-20T01:02:03Z",
  },
};

const map = buildLaneRunIdMap(fixture);
assert.deepEqual(map, expected, "private KPI attempts must derive a sorted, safe lane run-id map");

const rendered = renderLaneRunIdModule(map);
assert.match(rendered, /^import "server-only";/, "generated map must be server-only");
assert.match(rendered, /Readonly<Record<string, LaneRunIdEntry>>/, "generated map must keep a dynamic lane-id type");
assert.match(rendered, /99123456789001/, "generated map must embed the private run id for server bundling");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lane-runid-map-"));
try {
  const publicRoot = path.join(tempRoot, "public");
  const outputPath = path.join(tempRoot, "src", "generated", "lane-runid-map.ts");
  fs.mkdirSync(path.join(publicRoot, "data", "admin"), { recursive: true });
  fs.writeFileSync(path.join(publicRoot, "safe.json"), '{"last_attempt":{"event_name":"schedule"}}\n');
  const publicKpiPath = path.join(publicRoot, "data", "admin", "fenok-data-health-kpi.json");
  fs.writeFileSync(publicKpiPath, '{"last_attempt":{"event_name":"schedule"}}\n');

  assert.doesNotThrow(() => assertNoPrivateRunIdsInPublic(publicRoot));
  writeLaneRunIdMap({ map, outputPath, publicRoot });
  assert.equal(fs.readFileSync(outputPath, "utf8"), rendered, "writer must emit the deterministic server module");

  assert.throws(
    () => writeLaneRunIdMap({ map, outputPath: path.join(publicRoot, "lane-runid-map.ts"), publicRoot }),
    /must not be written under public/,
    "the generated map must never be emitted under public/",
  );

  fs.writeFileSync(publicKpiPath, JSON.stringify({ run_id: map.last_lane.run_id }));
  assert.throws(
    () => assertNoPrivateRunIdsInPublic(publicRoot),
    /private lane run-id data leaked under public/,
    "the public-tree grep guard must fail on a deliberately misplaced private run_id field",
  );
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

const privateKpi = JSON.parse(fs.readFileSync(path.join(repoRoot, "data", "admin", "fenok-data-health-kpi.json"), "utf8"));
const publicKpi = JSON.parse(fs.readFileSync(path.join(appRoot, "public", "data", "admin", "fenok-data-health-kpi.json"), "utf8"));
const actualMap = buildLaneRunIdMap(privateKpi);
assert.ok(Object.keys(actualMap).length > 0, "current private KPI fixture must expose at least one run-id mapping");
assertNoPrivateRunIdsInPublic(path.join(appRoot, "public"));
assert.equal(
  publicKpi.lanes.some((lane) => lane?.details?.last_attempt && "run_id" in lane.details.last_attempt),
  false,
  "public KPI last_attempt must remain explicitly redacted",
);

console.log(JSON.stringify({ ok: true, suite: "lane run-id server map + public leak guard", lanes: Object.keys(actualMap).length }, null, 2));
