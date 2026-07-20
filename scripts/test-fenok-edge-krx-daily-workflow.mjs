#!/usr/bin/env node
// Lane Registry ⇄ commit-shard completeness gate for fenok-edge-krx-daily.yml
// (#366 step 4). KRX is an emitter-first shadow lane: every non-plan run emits
// attempt evidence, while successful fetches additionally stage the public-safe
// aggregate artifacts.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

const workflowText = fs.readFileSync(new URL("../.github/workflows/fenok-edge-krx-daily.yml", import.meta.url), "utf8");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gate = checkWorkflowCommitShardsAgainstRegistry({
  workflowText,
  workflowRel: ".github/workflows/fenok-edge-krx-daily.yml",
  repoRoot,
});
assert.deepEqual(gate.lanes, ["krx"], "KRX must be attributed to its shadow lane");
assert.deepEqual(gate.missing_in_workflow, [],
  `declared shards the workflow never commits: ${JSON.stringify(gate.missing_in_workflow)}`);
assert.deepEqual(gate.undeclared_in_workflow, [],
  `allowlist paths with no registry record: ${JSON.stringify(gate.undeclared_in_workflow)}`);
assert.deepEqual(gate.allowlist_count, 2,
  "the KRX workflow commits its attempt shard and public-safe bridge index; computed files are outside the admin-only legacy count");

// Slice 1 (owner grant 2026-07-19): the workflow also commits the public-safe
// aggregate index closes and stages it manifest-natively alongside the hand list.
assert.match(workflowText, /data\/computed\/fenok-edge-korea-krx-index-daily\.json/,
  "the KRX workflow must commit the Slice 1 public index closes");
assert.match(workflowText, /data\/computed\/fenok-edge-korea-krx-kosdaq-market-cap-aggregate\.json/,
  "the KRX workflow must commit the aggregate-only Slice 2 KOSDAQ market-cap summary");
assert.match(workflowText, /scripts\/stage-lane-manifest\.sh/,
  "the KRX workflow must stage via the lane manifest (parity defense)");
assert.match(workflowText, /--stage always_if_exists/);
assert.match(workflowText, /--stage success_if_exists/);
assert.match(workflowText, /emit-fenok-krx-attempt\.mjs/);
assert.match(workflowText, /steps\.krx_fetch\.outcome/);
assert.match(workflowText, /detection-attempts\/krx\.json/);
assert.match(workflowText, /if: \$\{\{ always\(\)/,
  "KRX failure attempts must still reach the emitter and commit path");
assert.doesNotMatch(workflowText, /git add -A/);

console.log("test-fenok-edge-krx-daily-workflow: ok");
