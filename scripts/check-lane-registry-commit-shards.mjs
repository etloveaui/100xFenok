#!/usr/bin/env node
// Lane Registry ⇄ workflow commit-shard cross-check (BACKLOG #366, step 4).
//
// The false-green class: a producer writes a file that its workflow's git-add
// allowlist does not name — the run stays green and the data silently never
// persists. The registry's per-lane commit_shards is the declaration; this
// gate makes the workflow prove it covers them:
//   1. every declared admin commit shard of the workflow's OWN lanes must be
//      covered by the workflow's allowlist (the false-green direction);
//   2. every admin path in the allowlist must be covered by SOME registry
//      declaration — a lane's commit_shards, a lane's admin_store, or a
//      declared exception (the undeclared-commit direction).
// Workflows with no owning lane (central publishers like update-manifest, or
// owner-gated lanes like fenok-edge-krx-daily) are checked direction 2 only.
// Glob/dir allowlist entries are normalized; subpath coverage is explicit.
// Mismatch = loud fail (exit 1).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LANE_REGISTRY, declaredExceptionPaths } from "./lib/lane-registry.mjs";

export function extractWorkflowShardAllowlist(workflowText) {
  // Whole-file scan: workflows commit admin state via SHARD loops, standalone
  // git add lines, globs, or var assignments — the allowlist is every
  // data/admin/ path literal in the file, normalized (globs collapsed to their
  // static prefix). Non-admin canonical/public paths are out of scope.
  const matches = [...workflowText.matchAll(/data\/admin\/[^\s"';\\]+/g)]
    .map((match) => match[0].replace(/\*.*$/, "").replace(/\/+$/, ""));
  const unique = [...new Set(matches)].sort();
  if (unique.length === 0) throw new Error("no data/admin shard paths found in workflow text");
  return unique;
}

function coversAny(path, declaredSet) {
  if (declaredSet.has(path)) return true;
  for (const declared of declaredSet) {
    if (path.startsWith(`${declared}/`) || declared.startsWith(`${path}/`)) return true;
  }
  return false;
}

function coveredByRegistry(path, declaredSet) {
  if (declaredSet.has(path)) return true;
  for (const declared of declaredSet) {
    if (path.startsWith(`${declared}/`)) return true;
  }
  return false;
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
  // DEC-266: a lane-less workflow is legal only via a static workflow_classes
  // declaration — anything else fails closed instead of silently passing.
  const workflowClass = registry.workflow_classes?.[workflowRel] ?? null;
  if (lanes.length === 0 && workflowClass === null) {
    return {
      ok: false,
      workflow: workflowRel,
      lanes: [],
      workflow_class: null,
      missing_in_workflow: [],
      undeclared_in_workflow: [],
      reason: "lane-less workflow with no declared workflow_class (DEC-266: declared, not inferred)",
      allowlist_count: allowlist.length,
      declared_count: 0,
    };
  }

  // Direction 1 (false-green): the workflow's OWN lanes' admin shards must be
  // covered by its allowlist.
  const ownDeclared = new Map();
  for (const lane of lanes) {
    for (const shard of lane.commit_shards) {
      // Gate scope is admin control-plane state; canonical/public mirrors of a
      // lane are tracked on the registry's public_mirror axis instead.
      if (shard.startsWith("data/admin/")) ownDeclared.set(shard, lane.id);
    }
  }
  const allowSet = new Set(allowlist);
  const missing_in_workflow = [...ownDeclared.entries()]
    .filter(([shard]) => !coversAny(shard, allowSet))
    .map(([shard, lane]) => ({ shard, lane }));

  // Direction 2 (undeclared-commit): every allowlist entry must be covered by
  // some registry declaration (lane commit_shards, lane admin_store, or a
  // declared exception).
  const registryDeclared = new Set();
  for (const lane of registry.lanes) {
    for (const shard of lane.commit_shards) {
      if (shard.startsWith("data/admin/")) registryDeclared.add(shard);
    }
    if (lane.roots.admin_store !== null) registryDeclared.add(lane.roots.admin_store);
  }
  for (const exception of declaredExceptionPaths()) registryDeclared.add(exception);
  const undeclared_in_workflow = allowlist.filter((entry) => !coveredByRegistry(entry, registryDeclared));

  return {
    ok: missing_in_workflow.length === 0 && undeclared_in_workflow.length === 0,
    workflow: workflowRel,
    lanes: lanes.map((lane) => lane.id),
    workflow_class: workflowClass?.class ?? null,
    missing_in_workflow,
    undeclared_in_workflow,
    allowlist_count: allowlist.length,
    declared_count: ownDeclared.size,
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
    console.error(`::error:: lane-registry gate: ${result.workflow} git-adds ${shard} but no registry declaration covers it`);
  }
  if (!result.ok) process.exit(1);
  console.log(`lane-registry commit-shard gate: ok (${result.workflow}; lanes ${result.lanes.join(",") || "none (central/owner-gated)"}; ${result.declared_count} own declared shards, ${result.allowlist_count} allowlist entries, all matched)`);
}
