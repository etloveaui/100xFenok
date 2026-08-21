#!/usr/bin/env node
// A publish-capable family whose cloud-plane outcome has never been recorded is
// invisible on the freshness axis, not merely red. derivePublishOutcomeProjection
// does `if (!latest ... ) continue`, so a declared binding with no shard produces
// no row, reaches attachPublishOutcomeAlarms not at all, and can never raise a
// plane reason. Silence, not a red.
//
// Measured 2026-08-21: 24 bindings, 19 shards, 5 unrecorded. fred-yardeni had
// been serving source 2026-08-07 for eleven days while appearing in the alarm
// only as a failure_streak, and slickcharts-symbols carries no freshness row at
// all despite a 168h cadence - the same structural class as slickcharts-weekly,
// which does carry one.
//
// The naive fix - alarm on any missing shard - was measured and rejected. Three
// of the five have simply had no opportunity: two are monthly lanes whose last
// run predates the persist step, and one is schedule-gated and no-ops most
// cycles. Paging them would have been three false rows on day one.
//
// So this contract does what the cadence-declaration contract does: it does not
// change what the alarm asserts, it removes the silent default. Every declared
// binding must either have recorded an outcome or carry a measured reason why it
// has not. The anti-rot half matters as much as the coverage half - a reason
// that outlives the condition it describes turns the list into a blanket
// exemption, which is the failure mode this whole class keeps producing.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PLANE_PUBLISH_OUTCOME_BINDINGS } from "../lib/lane-registry.mjs";
import { PLANE_OUTCOME_UNRECORDED_REASONS } from "./check-pipeline-job-health.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHARD_DIR = path.join(REPO_ROOT, "data", "admin", "data-supply-state", "publish-outcomes");

const bound = Object.keys(PLANE_PUBLISH_OUTCOME_BINDINGS ?? {}).sort();
assert.ok(bound.length > 0, "no plane publish-outcome bindings are declared; the contract would be vacuous");

function hasRecordedOutcome(family) {
  const file = path.join(SHARD_DIR, `${family}.json`);
  if (!fs.existsSync(file)) return false;
  let shard;
  try {
    shard = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return false;
  }
  return Array.isArray(shard?.records) && shard.records.length > 0;
}

const recorded = bound.filter(hasRecordedOutcome);
const unrecorded = bound.filter((family) => !hasRecordedOutcome(family));

// --- Coverage: no family may be invisible by omission -----------------------
const unaccounted = unrecorded.filter((family) => !PLANE_OUTCOME_UNRECORDED_REASONS[family]);
assert.deepEqual(
  unaccounted,
  [],
  "these publish-capable families have never recorded a cloud-plane outcome and carry no reason, "
    + `so they are invisible on the freshness axis: ${unaccounted.join(", ")}`,
);

// --- Anti-rot: a reason must not outlive the condition ----------------------
// This is the half that catches drift. edgar-korean-summaries recorded its first
// outcome on 2026-08-21; had it been listed, this assertion would have fired the
// same day rather than leaving a stale excuse in place.
for (const [family, reason] of Object.entries(PLANE_OUTCOME_UNRECORDED_REASONS)) {
  assert.ok(
    bound.includes(family),
    `${family} carries an unrecorded-outcome reason but declares no plane binding`,
  );
  assert.ok(
    !recorded.includes(family),
    `${family} has recorded a plane outcome; remove its unrecorded-outcome reason `
      + "rather than leaving an excuse the condition no longer supports",
  );
  assert.equal(typeof reason, "string", `${family} reason must be a string`);
  assert.ok(
    reason.trim().length >= 60,
    `${family} reason is too thin to be a decision: ${JSON.stringify(reason)}`,
  );
  assert.ok(
    !/\b(TODO|TBD|FIXME|unknown|not sure)\b/i.test(reason),
    `${family} reason is a placeholder, not a measurement: ${JSON.stringify(reason)}`,
  );
}

// --- The split must stay explicit ------------------------------------------
// Three of the five are "no opportunity yet" and two are live incidents. If a
// future reader cannot tell those apart from the record, the list stops being
// useful the moment someone has to act on it.
const genuine = Object.entries(PLANE_OUTCOME_UNRECORDED_REASONS)
  .filter(([, reason]) => /GENUINE INCIDENT/.test(reason))
  .map(([family]) => family);
const awaiting = Object.entries(PLANE_OUTCOME_UNRECORDED_REASONS)
  .filter(([, reason]) => /no opportunity yet/.test(reason))
  .map(([family]) => family);
assert.equal(
  genuine.length + awaiting.length,
  Object.keys(PLANE_OUTCOME_UNRECORDED_REASONS).length,
  "every unrecorded family must be classified either 'GENUINE INCIDENT' or 'no opportunity yet'; "
    + `unclassified: ${Object.keys(PLANE_OUTCOME_UNRECORDED_REASONS)
      .filter((f) => !genuine.includes(f) && !awaiting.includes(f)).join(", ")}`,
);

// A reason that claims no opportunity must not belong to a family whose lane has
// obviously had one. The cheap, offline half of that test: an "awaiting" reason
// has to name the cadence or the commit that bounds the wait, so the claim is
// checkable by the next reader rather than asserted.
for (const family of awaiting) {
  const reason = PLANE_OUTCOME_UNRECORDED_REASONS[family];
  assert.ok(
    /cron '[^']+'/.test(reason),
    `${family} claims no opportunity yet but does not name the cadence that bounds the wait`,
  );
}

console.log(
  `test-plane-outcome-recording-coverage: ok `
    + `(${bound.length} bindings, ${recorded.length} recorded, ${unrecorded.length} unrecorded: `
    + `${genuine.length} incidents, ${awaiting.length} awaiting)`,
);
