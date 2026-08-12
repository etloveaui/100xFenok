#!/usr/bin/env node
// Regression test for the Update Manifest dispatch decoupling lane: the six
// computed-signals source workflows must never dispatch update-manifest.yml
// per run (their successful completions now drive the serialized
// coordinate-computed-signals workflow_run instead), the three earlier
// proven-safe decoupled workflows stay dispatch-free, and the remaining
// dispatch sites that carry real consumers stay in place.
//
// Context: update-manifest.yml reconciles shared derived/public projections
// twice daily on schedule (UTC 02:30 / 09:30). The three decoupled workflows
// do not need per-run dispatch because they either serve their own plane
// generation (fred-yardeni) or their family has no manifest consumer
// (oecd-cli, finra-ats-weekly). GITHUB_TOKEN bot pushes do not cascade into
// downstream workflows, so the scheduled reconciliation is the only fallback.
// slickcharts-history keeps its membership dispatch: it fires only when an
// operator explicitly selects scraper=membership, so it is a manual
// projection path, not a per-run amplification path.
//
// The six coordinator sources changed from explicit dispatch to a workflow_run
// trigger: coordinate-computed-signals.yml rebuilds and plane-publishes
// data/computed/signals.json on any successful source completion, and the
// scheduled reconciliation remains the shared-projection fallback.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowsDir = path.join(repoRoot, ".github", "workflows");

const DISPATCH_CALL = "gh workflow run update-manifest.yml";

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function readWorkflow(name) {
  return fs.readFileSync(path.join(workflowsDir, name), "utf8");
}

// The six coordinator-source workflows plus the three earlier decoupled
// workflows must never dispatch update-manifest.yml per run, and each must
// document the residual scheduled-reconciliation fallback so the removal reads
// as intentional.
for (const name of [
  "fetch-fred-macro.yml",
  "fetch-treasury-tga.yml",
  "fetch-defillama.yml",
  "fetch-fred-banking.yml",
  "fetch-fdic.yml",
  "fetch-sentiment.yml",
  "fetch-fred-yardeni.yml",
  "fetch-oecd-cli.yml",
  "fetch-finra-ats-weekly.yml",
]) {
  const source = readWorkflow(name);
  assert.equal(
    countOccurrences(source, DISPATCH_CALL),
    0,
    `${name} must not dispatch update-manifest.yml per run`,
  );
  assert.ok(
    source.includes("scheduled update-manifest.yml"),
    `${name} must explain the scheduled update-manifest.yml fallback`,
  );
}

// slickcharts-history keeps its operator-only membership dispatch; pin the
// shape so the manual projection path cannot silently regress to dry-run-only.
{
  const source = readWorkflow("slickcharts-history.yml");
  assert.equal(
    countOccurrences(source, DISPATCH_CALL),
    1,
    "slickcharts-history must keep exactly one update-manifest dispatch",
  );
  assert.ok(
    source.includes("-f rebuild_slickcharts=true"),
    "slickcharts-history membership dispatch must keep rebuild_slickcharts=true",
  );
  assert.ok(
    source.includes("if: ${{ github.event.inputs.scraper == 'membership' }}"),
    "slickcharts-history membership dispatch must stay gated on scraper=membership",
  );
}

// Representative callers with real projection consumers keep their dispatch:
// the fenok-edge envelope (authoritative).
for (const name of [
  "fenok-edge-daily.yml",
]) {
  const source = readWorkflow(name);
  assert.ok(
    countOccurrences(source, DISPATCH_CALL) >= 1,
    `${name} must keep its update-manifest dispatch`,
  );
}

// Pin the fallback cadence so the "twice daily" comments cannot silently
// drift away from update-manifest.yml's actual schedule.
{
  const source = readWorkflow("update-manifest.yml");
  assert.equal(
    countOccurrences(source, "- cron: '30 2 * * *'"),
    1,
    "morning reconciliation must stay exact",
  );
  assert.equal(
    countOccurrences(source, "- cron: '30 9 * * *'"),
    1,
    "evening reconciliation must stay exact",
  );
}

console.log("update-manifest dispatch decoupling: 9 removed, required callers pinned");
