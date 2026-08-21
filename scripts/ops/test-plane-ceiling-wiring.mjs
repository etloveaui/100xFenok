#!/usr/bin/env node
// B-386 step 2: the derived ceiling actually reaches the projection.
//
// Step 1 (088f9e3cf9) added maxCronGapHours and planeFreshnessCeilingHours with
// no behaviour change. This wires them in, which is the part that changes what
// the alarm asserts for 24 families, so it lands separately and with its own
// contract.
//
// Before this, deriveFamilyFreshness was called without maxAgeHours at
// check-pipeline-job-health.mjs and every binding took the flat 60 - a constant
// whose own comment says it was calibrated for one weekday family, the ETF
// surface, and then applied to cadences from one hour to a month.
//
// Not every family HAS a cadence. computed-signals is driven by workflow_run,
// not by a schedule, so an age ceiling is meaningless for it. Those families are
// declared rather than silently given a number, and the age axis simply does not
// apply to them - the same shape as source-change mode. A silent default is what
// this whole change exists to remove, so re-introducing one for the awkward
// cases would defeat it.

import assert from "node:assert/strict";

import {
  PLANE_CEILING_UNSCHEDULED_REASONS,
  planeCeilingForFamily,
  resolveFamilyCadence,
} from "./check-pipeline-job-health.mjs";
import { PLANE_PUBLISH_OUTCOME_BINDINGS } from "../lib/lane-registry.mjs";

// --- Every bound family resolves to a ceiling or a declared reason ----------
const bound = Object.keys(PLANE_PUBLISH_OUTCOME_BINDINGS).sort();
assert.ok(bound.length >= 20, `only ${bound.length} bindings seen; the walk is not resolving them`);

const resolved = [];
const unscheduled = [];
for (const family of bound) {
  const ceiling = planeCeilingForFamily(family);
  if (ceiling === null) unscheduled.push(family);
  else {
    assert.ok(Number.isFinite(ceiling) && ceiling > 0, `${family} resolved a nonsense ceiling: ${ceiling}`);
    resolved.push([family, ceiling]);
  }
}

const unaccounted = unscheduled.filter((f) => !PLANE_CEILING_UNSCHEDULED_REASONS[f]);
assert.deepEqual(
  unaccounted,
  [],
  "these families have no resolvable cadence and no recorded reason, so they would silently lose the age axis: "
    + unaccounted.join(", "),
);

// Anti-rot: a reason must not outlive the condition.
for (const [family, reason] of Object.entries(PLANE_CEILING_UNSCHEDULED_REASONS)) {
  assert.ok(bound.includes(family), `${family} carries a reason but declares no plane binding`);
  assert.ok(
    unscheduled.includes(family),
    `${family} now resolves a cadence; remove its unscheduled reason rather than leaving a stale excuse`,
  );
  assert.ok(reason.trim().length >= 50, `${family} reason is too thin to be a decision: ${reason}`);
}

// --- The derivation must tighten as well as loosen --------------------------
// If every resolved ceiling were >= 60 this would just be a widening, which the
// standing no-tuning rule forbids. The hourly lanes are the proof.
const tighter = resolved.filter(([, hours]) => hours < 60);
const looser = resolved.filter(([, hours]) => hours > 60);
assert.ok(
  tighter.length >= 5,
  `only ${tighter.length} families end up tighter than the old flat ceiling; a one-way widening is not the fix`,
);
assert.ok(looser.length >= 3, `only ${looser.length} families end up looser; the slow half must still be corrected`);

// Spot-check the two extremes named in the measurement.
const byName = Object.fromEntries(resolved);
if (byName["yahoo-ticker-macro"] !== undefined) {
  assert.ok(
    byName["yahoo-ticker-macro"] <= 12,
    `an hourly lane must not stay invisible for days: ${byName["yahoo-ticker-macro"]}h`,
  );
}
if (byName["slickcharts-history"] !== undefined) {
  assert.ok(
    byName["slickcharts-history"] > 700,
    `a monthly lane cannot be judged against hours: ${byName["slickcharts-history"]}h`,
  );
}

// --- The resolver itself ----------------------------------------------------
{
  const cadence = resolveFamilyCadence("fred-macro");
  assert.ok(Array.isArray(cadence.crons) && cadence.crons.length > 0, "fred-macro must resolve its producer crons");
  assert.ok(Number.isFinite(cadence.graceHours) && cadence.graceHours > 0, "and the grace declared for them");
}
assert.equal(planeCeilingForFamily("not-a-family"), null, "an unknown family must not invent a ceiling");

// --- The wiring: the projection must pass it --------------------------------
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = fs.readFileSync(
  path.join(REPO_ROOT, "scripts", "ops", "check-pipeline-job-health.mjs"), "utf8",
);
const code = source.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
// Anchor on the whole projection block, not a fixed slice from the call: the
// ceiling is resolved once per family a few lines above it, and a byte-window
// assertion broke the moment that was deduplicated.
const blockStart = code.indexOf("for (const [family, binding] of Object.entries(bindings ?? {}))");
assert.ok(blockStart > 0, "the projection loop is gone; this contract is stale");
const block = code.slice(blockStart, code.indexOf("return projection;", blockStart));
assert.match(block, /deriveFamilyFreshness\(\{/, "the projection must still derive freshness");
assert.match(
  block,
  /maxAgeHours:/,
  "the projection must pass a per-family ceiling; without it every binding takes the flat default again",
);
assert.match(
  block,
  /planeCeilingForFamily\(family\)/,
  "and it must come from the derivation, not another constant",
);

console.log(
  `test-plane-ceiling-wiring: ok (${resolved.length} resolved, ${unscheduled.length} unscheduled, `
  + `${tighter.length} tighter than 60h, ${looser.length} looser)`,
);
