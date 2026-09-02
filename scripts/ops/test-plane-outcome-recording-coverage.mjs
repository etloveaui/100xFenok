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
// The naive fix - alarm on any missing shard - was measured and rejected, and
// then the rejection itself was re-measured. It first read as three of five
// awaiting an opportunity. oecd-cli and slickcharts-monthly were reclassified
// the same day: neither has ever completed a SCHEDULED run, their only ones
// having been cancelled or failed while every success is a workflow_dispatch,
// and a lane that only ever runs by hand is not waiting for its cadence. The
// measured split was four genuine incidents against one awaiting opportunity.
// The anti-rot contract below is expected to shrink that set as first outcomes
// land, so the current awaiting workflow is derived instead of pinned here.
//
// Every declared binding must either have recorded an outcome or carry a
// measured reason why it has not, and that reason must classify itself. The anti-rot half matters as much as the coverage half - a reason
// that outlives the condition it describes turns the list into a blanket
// exemption, which is the failure mode this whole class keeps producing.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PLANE_PUBLISH_OUTCOME_BINDINGS } from "../lib/lane-registry.mjs";
import {
  PLANE_OUTCOME_UNRECORDED_CLASSIFICATIONS,
  PLANE_OUTCOME_UNRECORDED_REASONS,
  PLANE_PUBLISH_ALARM_REASONS,
  attachPublishOutcomeAlarms,
  unrecordedIncidentWorkflowFiles,
} from "./check-pipeline-job-health.mjs";

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
for (const [family, entry] of Object.entries(PLANE_OUTCOME_UNRECORDED_REASONS)) {
  const reason = entry?.reason;
  assert.ok(
    PLANE_OUTCOME_UNRECORDED_CLASSIFICATIONS.includes(entry?.classification),
    `${family} carries an unknown classification: ${JSON.stringify(entry?.classification)}`,
  );
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

// --- The split must stay explicit, and it decides the alarm ----------------
// B-391 made this classification load-bearing rather than descriptive, so it is
// a FIELD. It used to be read out of the prose with a regex, which is the same
// defect as a contract pinned to an error message: the wording improves and the
// behaviour silently changes.
const genuine = Object.entries(PLANE_OUTCOME_UNRECORDED_REASONS)
  .filter(([, entry]) => entry.classification === "incident")
  .map(([family]) => family);
const awaiting = Object.entries(PLANE_OUTCOME_UNRECORDED_REASONS)
  .filter(([, entry]) => entry.classification === "awaiting_opportunity")
  .map(([family]) => family);
assert.equal(
  genuine.length + awaiting.length,
  Object.keys(PLANE_OUTCOME_UNRECORDED_REASONS).length,
  "every unrecorded family must classify itself as incident or awaiting_opportunity",
);
// The alarm must fire on exactly the incidents, derived the same way the alarm
// derives it. Asserting the map alone would pass with the call site deleted.
const alarmingFiles = unrecordedIncidentWorkflowFiles();
assert.deepEqual(
  [...alarmingFiles.values()].flat().sort(),
  [...genuine].sort(),
  "the families whose absence alarms must be exactly those classified as incidents",
);
for (const family of awaiting) {
  assert.ok(
    ![...alarmingFiles.values()].flat().includes(family),
    `${family} awaits an opportunity and must not be paged`,
  );
}

// A reason that claims no opportunity must not belong to a family whose lane has
// obviously had one. The cheap, offline half of that test: an "awaiting" reason
// has to name the cadence or the commit that bounds the wait, so the claim is
// checkable by the next reader rather than asserted.
for (const family of awaiting) {
  const reason = PLANE_OUTCOME_UNRECORDED_REASONS[family].reason;
  assert.ok(
    /cron '[^']+'/.test(reason),
    `${family} claims no opportunity yet but does not name the cadence that bounds the wait`,
  );
}

// --- The alarm must actually raise it --------------------------------------
// Exercised through attachPublishOutcomeAlarms, not by re-deriving the set. The
// assertions above all pass with the call site deleted, which is exactly the
// vacuity shape this program keeps finding.
{
  const files = [...alarmingFiles.keys()];
  if (files.length === 0) {
    console.log(
      "test-plane-outcome-recording-coverage: no incident workflow files to exercise; skip alarm exercise (all unrecorded are awaiting_opportunity)",
    );
  } else {
    // Absence raises the reason and makes the workflow alarm.
    const absent = attachPublishOutcomeAlarms(
      files.map((file) => ({ file, alarm_reasons: [], alarming: false })),
      new Map(),
    );
    for (const row of absent) {
      assert.ok(
        row.alarm_reasons.includes(PLANE_PUBLISH_ALARM_REASONS.outcome_unrecorded),
        `${row.file} must raise ${PLANE_PUBLISH_ALARM_REASONS.outcome_unrecorded} when it has no projection row`,
      );
      assert.equal(row.alarming, true, `${row.file} must alarm on an unrecorded outcome`);
      assert.deepEqual(row.plane_outcome_unrecorded_families, alarmingFiles.get(row.file).slice().sort());
    }

    // A family that has started recording must stop alarming on its own, without
    // waiting for anyone to edit the reason list.
    const nowRecorded = attachPublishOutcomeAlarms(
      [{ file: files[0], alarm_reasons: [], alarming: false }],
      new Map([[files[0], { result: "published", freshness: { state: "healthy" } }]]),
    );
    assert.ok(
      !nowRecorded[0].alarm_reasons.includes(PLANE_PUBLISH_ALARM_REASONS.outcome_unrecorded),
      "a recorded outcome must clear the absence reason without editing the reason list",
    );
    assert.equal(nowRecorded[0].plane_outcome_unrecorded_families, undefined);
  }

  // An awaiting family must stay silent all the way through the alarm.
  const awaitingFiles = Object.entries(PLANE_OUTCOME_UNRECORDED_REASONS)
    .filter(([, entry]) => entry.classification === "awaiting_opportunity")
    .map(([family]) => family);
  if (awaitingFiles.length > 0) {
    const awaitingWorkflow = path.basename(
      PLANE_PUBLISH_OUTCOME_BINDINGS[awaitingFiles[0]].workflow,
    );
    const silent = attachPublishOutcomeAlarms(
      [{ file: awaitingWorkflow, alarm_reasons: [], alarming: false }],
      new Map(),
    );
    assert.deepEqual(silent[0].alarm_reasons, [], "an awaiting family must not be paged");
    assert.equal(silent[0].alarming, false);
  }
}

console.log(
  `test-plane-outcome-recording-coverage: ok `
    + `(${bound.length} bindings, ${recorded.length} recorded, ${unrecorded.length} unrecorded: `
    + `${genuine.length} incidents, ${awaiting.length} awaiting)`,
);
