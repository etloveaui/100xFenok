#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateAttemptShard } from "./build-data-supply-detection-floor.mjs";
import { runSlickchartsAttempt } from "./emit-slickcharts-attempt.mjs";
import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "slickcharts-monthly-telemetry-test-"));
const shardPath = path.join(root, "slickcharts.json");

function eventPath(name, rows) {
  const filePath = path.join(root, `${name}.jsonl`);
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  return filePath;
}

function pageEvent(pageShape, assertionId, passed = true) {
  return {
    execution: "returned",
    exception_kind: null,
    http_status: 200,
    auth: "not_applicable",
    rate_limited: false,
    decode: "ok",
    payload: "non_empty",
    assertions: [{ id: assertionId, passed }],
    page_shape: pageShape,
    provider_date: "Thu, 04 Sep 2026 01:08:24 GMT",
    response_sha256: "0".repeat(64),
  };
}

// Contract fixture: the lane declares one assertion-id set per request shape.
{
  const lane = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((item) => item.id === "slickcharts");
  assert.deepEqual(lane.endpoint_contract.assertion_sets, {
    table: ["table_rows"],
    yield: ["yield_value"],
  });
  assert.deepEqual(
    lane.endpoint_contract.assertions.map((assertion) => assertion.id),
    ["table_rows"],
  );
}

// Mixed 21-event bundle (18 table_rows + 3 yield_value) validates end to end.
{
  const events = [
    ...Array.from({ length: 18 }, () => pageEvent("table", "table_rows")),
    ...Array.from({ length: 3 }, () => pageEvent("yield", "yield_value")),
  ];
  const result = runSlickchartsAttempt({
    memberId: "monthly",
    eventPaths: [eventPath("monthly", events)],
    producerOutcomes: Array.from({ length: 21 }, () => "success"),
    shardPath,
    rowPath: path.join(root, "monthly-row.json"),
    observedAt: "2026-09-04T01:08:46Z",
    attemptId: "gh-300-1-monthly",
  });
  assert.equal(result.row.execution, "returned");
  assert.deepEqual(result.row.assertions, [{ id: "table_rows", passed: true }]);
  assert.equal(validateAttemptShard(result.shard, "slickcharts"), true);
}

// A yield-shaped event carrying table_rows is invalid: the set must match
// the event's own shape, never any global set.
{
  const result = runSlickchartsAttempt({
    memberId: "monthly",
    eventPaths: [eventPath("monthly-crossed", [pageEvent("yield", "table_rows")])],
    producerOutcomes: ["success"],
    shardPath: path.join(root, "crossed-shard.json"),
    rowPath: path.join(root, "crossed-row.json"),
    observedAt: "2026-09-04T02:08:46Z",
    attemptId: "gh-301-1-monthly",
  });
  assert.equal(result.row.execution, "threw");
  assert.equal(result.row.exception_kind, "unexpected");
}

// Unknown shapes fail closed.
{
  const result = runSlickchartsAttempt({
    memberId: "monthly",
    eventPaths: [eventPath("monthly-unknown", [pageEvent("chart", "table_rows")])],
    producerOutcomes: ["success"],
    shardPath: path.join(root, "unknown-shard.json"),
    rowPath: path.join(root, "unknown-row.json"),
    observedAt: "2026-09-04T03:08:46Z",
    attemptId: "gh-302-1-monthly",
  });
  assert.equal(result.row.execution, "threw");
  assert.equal(result.row.exception_kind, "unexpected");
}

// Shapeless legacy table events keep validating (backward compatibility).
{
  const { page_shape: _dropped, ...legacy } = pageEvent("table", "table_rows");
  const result = runSlickchartsAttempt({
    memberId: "monthly",
    eventPaths: [eventPath("monthly-legacy", [legacy])],
    producerOutcomes: ["success"],
    shardPath: path.join(root, "legacy-shard.json"),
    rowPath: path.join(root, "legacy-row.json"),
    observedAt: "2026-09-04T04:08:46Z",
    attemptId: "gh-303-1-monthly",
  });
  assert.equal(result.row.execution, "returned");
}

console.log("test-slickcharts-monthly-telemetry: ok");
