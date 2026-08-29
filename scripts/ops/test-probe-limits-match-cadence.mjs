#!/usr/bin/env node
// A serving-probe freshness limit that is narrower than its producer's own
// schedule can never pass. slickcharts-history publishes monthly and carried no
// override at all, so it inherited the 5-day source and 7-day heartbeat
// defaults and produced 542 of the 551 failures in the 2026-08-21 sweep, while
// its identical monthly sibling slickcharts-monthly carried 40/40. The same
// half-applied shape appears on the heartbeat axis for families whose source
// axis was already relaxed.
//
// This is a consistency check, not a licence to widen limits. It only asserts
// that a limit is not narrower than the cadence the producer declares; a family
// whose data has genuinely stopped moving still fails the probe, which is the
// intended honest outcome.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ENROLLED_PATHS } from "../lib/cloud-data-plane-worker-read.mjs";
import { resolvePublishedAgeDays, resolveSourceAgeDays } from "./probe-data-plane-serving.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOW_DIR = path.join(REPO_ROOT, ".github", "workflows");

// Coarse on purpose: the question is only "at least this many days between
// runs", so a cadence class is enough and a minute-level model would add
// precision the assertion never uses.
export function cadenceDays(cron) {
  const [, , dayOfMonth, , dayOfWeek] = cron.trim().split(/\s+/);
  if (dayOfMonth !== "*") return 31;
  if (dayOfWeek !== "*") return dayOfWeek.includes(",") ? 3 : 7;
  return 1;
}

export function slowestCadence(workflowSource) {
  const crons = [...workflowSource.matchAll(/cron:\s*'([^']+)'/g)].map((match) => match[1]);
  if (crons.length === 0) return null;
  // A family is only as fresh as its most frequent schedule allows, so the
  // shortest interval is the honest bound when a workflow carries several.
  return Math.min(...crons.map(cadenceDays));
}

// Only enrolled paths matter, and each is resolved as the probe resolves it so
// a per-path override counts. Checking a bare family name instead would both
// invent violations for families the probe never sees and miss the path
// overrides that already relax fdic-tier1 and the fred-banking cadences.
const cadenceByFamily = new Map();
for (const file of fs.readdirSync(WORKFLOW_DIR).filter((name) => name.endsWith(".yml")).sort()) {
  const source = fs.readFileSync(path.join(WORKFLOW_DIR, file), "utf8");
  const cadence = slowestCadence(source);
  if (cadence === null) continue;
  for (const match of source.matchAll(/--family=([\w-]+)/g)) {
    const family = match[1];
    const known = cadenceByFamily.get(family);
    cadenceByFamily.set(family, known === undefined ? cadence : Math.min(known, cadence));
  }
}

const violations = [];
for (const [enrolledPath, family] of ENROLLED_PATHS) {
  const cadence = cadenceByFamily.get(family);
  if (cadence === undefined) continue;
  const heartbeat = resolvePublishedAgeDays({ path: enrolledPath, family });
  if (heartbeat !== null && heartbeat < cadence) {
    violations.push(`${family}: heartbeat limit ${heartbeat}d is narrower than its ${cadence}d cadence`);
  }
  const sourceAge = resolveSourceAgeDays({ path: enrolledPath, family });
  if (sourceAge !== null && sourceAge < cadence) {
    violations.push(`${family}: source limit ${sourceAge}d is narrower than its ${cadence}d cadence`);
  }
}

assert.deepEqual(
  [...new Set(violations)].sort(),
  [],
  `probe limits must not be narrower than the declared cadence:\n  ${[...new Set(violations)].sort().join("\n  ")}`,
);

// The cadence reader must be able to distinguish the classes it depends on.
assert.equal(cadenceDays("0 9 1 * *"), 31);
assert.equal(cadenceDays("17 11 * * 6"), 7);
assert.equal(cadenceDays("17 11,23 * * 6"), 7);
assert.equal(cadenceDays("0 8 * * *"), 1);
assert.equal(cadenceDays("0 6 1-7 * 1"), 31);

console.log("probe limits match declared cadence: ok");
