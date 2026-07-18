#!/usr/bin/env node
// Lane Registry ⇄ workflow commit-shard cross-check (BACKLOG #366, step 4 pilot).
//
// The false-green class: a producer writes a file that its workflow's git-add
// allowlist does not name — the run stays green and the data silently never
// persists. The registry's per-lane commit_shards (transcribed in step 1) is
// the declaration; this gate makes the workflow prove it covers them:
//   1. every declared commit shard of the workflow's lanes must appear in the
//      workflow's shard allowlist;
//   2. the allowlist must contain no admin path that no lane declares.
// Mismatch = loud fail (exit 1). Pilot scope: fenok-edge-daily only; the
// pattern rolls out to the other 13 workflows in later steps.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LANE_REGISTRY } from "./lib/lane-registry.mjs";

export function extractWorkflowShardAllowlist(workflowText) {
  // Whole-file scan: workflows commit admin state via SHARD loops, standalone
  // git add lines, or var assignments — the allowlist is every data/admin/*.json
  // literal in the file, however it is reached. Non-admin canonical/public
  // paths are deliberately out of scope (the registry's public_mirror axis).
  const matches = [...workflowText.matchAll(/data\/admin\/[^\s"';\\]+\.json/g)].map((match) => match[0]);
  const unique = [...new Set(matches)].sort();
  if (unique.length === 0) throw new Error("no data/admin shard paths found in workflow text");
  return unique;
}

export function checkWorkflowCommitShardsAgainstRegistry({
  workflowText,
  workflowRel,
  registry = LANE_REGISTRY,
}) {
  if (typeof workflowRel !== "string" || !workflowRel.startsWith(".github/workflows/")) {
    throw new Error("workflowRel must be a .github/workflows/ path");
  }
  const allowlist = extractWorkflowShardAllowlist(workflowText);
  const lanes = registry.lanes.filter((lane) => lane.owner_workflow === workflowRel);
  if (lanes.length === 0) throw new Error(`no registry lanes own ${workflowRel}`);

  const declared = new Map();
  for (const lane of lanes) {
    for (const shard of lane.commit_shards) {
      // Gate scope is admin control-plane state; canonical/public mirrors of a
      // lane are tracked on the registry's public_mirror axis instead.
      if (shard.startsWith("data/admin/")) declared.set(shard, lane.id);
    }
  }
  const allowSet = new Set(allowlist);

  const missing_in_workflow = [...declared.entries()]
    .filter(([shard]) => !allowSet.has(shard))
    .map(([shard, lane]) => ({ shard, lane }));
  const undeclared_in_workflow = allowlist.filter((shard) => !declared.has(shard));

  return {
    ok: missing_in_workflow.length === 0 && undeclared_in_workflow.length === 0,
    workflow: workflowRel,
    lanes: lanes.map((lane) => lane.id),
    missing_in_workflow,
    undeclared_in_workflow,
    allowlist_count: allowlist.length,
    declared_count: declared.size,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const workflowRel = process.argv[2] ?? ".github/workflows/fenok-edge-daily.yml";
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = checkWorkflowCommitShardsAgainstRegistry({
    workflowText: fs.readFileSync(path.join(repoRoot, workflowRel), "utf8"),
    workflowRel,
  });
  for (const row of result.missing_in_workflow) {
    console.error(`::error:: lane-registry gate: ${row.shard} (lane ${row.lane}) is declared but NOT git-added by ${result.workflow} (the false-green class)`);
  }
  for (const shard of result.undeclared_in_workflow) {
    console.error(`::error:: lane-registry gate: ${result.workflow} git-adds ${shard} but no lane record declares it`);
  }
  if (!result.ok) process.exit(1);
  console.log(`lane-registry commit-shard gate: ok (${result.workflow}; lanes ${result.lanes.join(",")}; ${result.declared_count} declared shards, ${result.allowlist_count} allowlist entries, all matched)`);
}
