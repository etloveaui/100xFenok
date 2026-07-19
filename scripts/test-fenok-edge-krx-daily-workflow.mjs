#!/usr/bin/env node
// Lane Registry ⇄ commit-shard completeness gate for fenok-edge-krx-daily.yml
// (#366 step 4). KRX is owner-gated with no registry lane and no lane store:
// the only admin path this workflow commits is the public-safe bridge index,
// which must stay covered by a declared exception. Zero-lane + zero-store is
// the asserted shape, not an oversight.
import assert from "node:assert/strict";
import fs from "node:fs";

import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

const workflowText = fs.readFileSync(new URL("../.github/workflows/fenok-edge-krx-daily.yml", import.meta.url), "utf8");
const gate = checkWorkflowCommitShardsAgainstRegistry({
  workflowText,
  workflowRel: ".github/workflows/fenok-edge-krx-daily.yml",
});
assert.deepEqual(gate.lanes, [], "KRX must stay owner-gated with no registry lane attribution");
assert.deepEqual(gate.missing_in_workflow, [],
  `declared shards the workflow never commits: ${JSON.stringify(gate.missing_in_workflow)}`);
assert.deepEqual(gate.undeclared_in_workflow, [],
  `allowlist paths with no registry record: ${JSON.stringify(gate.undeclared_in_workflow)}`);
assert.deepEqual(gate.allowlist_count, 1,
  "the KRX workflow commits exactly one admin path (the public-safe bridge index); the Slice 1 file is data/computed, not admin");

// Slice 1 (owner grant 2026-07-19): the workflow also commits the public-safe
// aggregate index closes and stages it manifest-natively alongside the hand list.
assert.match(workflowText, /data\/computed\/fenok-edge-korea-krx-index-daily\.json/,
  "the KRX workflow must commit the Slice 1 public index closes");
assert.match(workflowText, /scripts\/stage-lane-manifest\.sh/,
  "the KRX workflow must stage via the lane manifest (parity defense)");
assert.match(workflowText, /--stage always_if_exists/);
assert.doesNotMatch(workflowText, /git add -A/);

console.log("test-fenok-edge-krx-daily-workflow: ok");
