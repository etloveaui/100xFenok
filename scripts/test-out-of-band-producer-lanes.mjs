#!/usr/bin/env node
// Some canonical data is written by a producer that is not a GitHub workflow,
// so nothing in the Actions-shaped machinery can see it stop. data/sentiment/
// aaii.json is the worked example: it is refreshed weekly by an owner-run
// Google Apps Script, its commits are authored by a person rather than
// github-actions[bot], no workflow file mentions it, and it had no lane entry at
// all. Measured 2026-08-21 over its real API history: 32 commits from
// 2025-12-29 to 2026-08-13, 28 of them on a Thursday, with five gaps longer
// than a week and a sixth in progress. Every one of those was invisible.
//
// The registry already models this: a lane may declare owner_workflow null with
// a cadence and enforcement "shadow", which is how benchmarks and
// global_scouter are carried. This contract requires that a canonical output
// living under a lane-owned root is claimed by some lane, so an out-of-band
// producer cannot be added with no cadence at all.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LANE_REGISTRY } from "./lib/lane-registry.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Directories whose every JSON payload is canonical lane data. Scoped rather
// than repo-wide: this asserts a property of data/sentiment today and grows
// deliberately, not by accident.
const LANE_OWNED_ROOTS = ["data/sentiment"];

// Not a data series: it describes the others.
const NON_SERIES = new Set(["schema.json"]);

function claimedPaths() {
  const claimed = new Set();
  for (const lane of LANE_REGISTRY.lanes) {
    for (const entry of lane.roots?.canonical_outputs ?? []) {
      claimed.add(entry);
    }
  }
  return claimed;
}

// A directory-level claim is not evidence that each file inside it has the
// right producer. data/sentiment is claimed wholesale by the sentiment lane,
// which declares a daily cadence and fetch-sentiment.yml as its owner, yet
// aaii.json is written weekly by an out-of-band Google Apps Script that
// workflow never touches. So the check is: every file under a lane-owned root
// must be produced by that lane's declared owner, or be claimed by its own lane
// with its own cadence.
import { SENTIMENT_LKG_SOURCE_FILES } from "./fetch-sentiment.mjs";

const claimed = claimedPaths();
const producerWrites = new Set(Object.values(SENTIMENT_LKG_SOURCE_FILES).flat());

const misattributed = [];
for (const root of LANE_OWNED_ROOTS) {
  const dir = path.join(REPO_ROOT, root);
  if (!fs.existsSync(dir)) continue;
  const owningLane = LANE_REGISTRY.lanes.find((lane) =>
    (lane.roots?.canonical_outputs ?? []).includes(root));
  for (const name of fs.readdirSync(dir).filter((entry) => entry.endsWith(".json")).sort()) {
    if (NON_SERIES.has(name)) continue;
    const relative = `${root}/${name}`;
    const ownFileLane = LANE_REGISTRY.lanes.find((lane) =>
      (lane.roots?.canonical_outputs ?? []).includes(relative));
    if (ownFileLane) continue;
    if (!owningLane) { misattributed.push(`${relative} (no lane at all)`); continue; }
    // Attributed to a workflow-owned lane, so that workflow must actually write it.
    if (owningLane.owner_workflow !== null && !producerWrites.has(name)) {
      misattributed.push(`${relative} (attributed to ${owningLane.id}/${owningLane.cadence?.kind ?? "?"} but its producer does not write it)`);
    }
  }
}

assert.deepEqual(
  misattributed,
  [],
  `a file attributed to a workflow-owned lane must be written by that workflow, otherwise its `
    + `real producer stopping is invisible:\n  ${misattributed.join("\n  ")}`,
);

// A lane whose producer is not a workflow must still declare a cadence and say
// why it has no attempt shard, or it is claimed in name only.
for (const lane of LANE_REGISTRY.lanes) {
  if (lane.owner_workflow !== null) continue;
  if (!(lane.roots?.canonical_outputs ?? []).some((entry) => LANE_OWNED_ROOTS.some((root) => entry.startsWith(root)))) continue;
  assert.ok(
    lane.cadence?.kind && lane.cadence.kind !== "unknown",
    `${lane.id} has no workflow and no declared cadence, so nothing can observe it stopping`,
  );
  assert.ok(
    typeof lane.declared_exception === "string" && lane.declared_exception.trim().length >= 20,
    `${lane.id} has no workflow and must record why it carries no attempt shard`,
  );
}

console.log(`out-of-band producer lanes: ok (${LANE_OWNED_ROOTS.length} roots checked, ${claimed.size} canonical outputs claimed)`);
