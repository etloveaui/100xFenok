#!/usr/bin/env node
// The alarm can already see a scheduled slot that ran and produced nothing:
// isLostScheduledSlot reads jobs_empty or queue_evicted off a run object. It
// cannot see a slot that never became a run at all, because there is no object
// to inspect and the run list is fetched with status=completed. Measured
// 2026-08-21T01:30Z, that is exactly what happened: global-writer-queue-observer
// and worker-request-budget-alarm both run hourly, both last ran at 23:35Z, and
// both had silently missed two consecutive slots while daily and six-hourly
// lanes ran normally.
//
// evaluateWorkflow already computes the newest counted run and then discards
// its timestamp, keeping only the URL. Carrying that timestamp is enough to
// count how many of the workflow's own scheduled instants have passed unrun.
// Counting slots rather than elapsed multiples is load-bearing: the first
// attempt compared elapsed time to the interval, passed its own unit test, and
// still missed this incident by 0.09h.
//
// Scope is deliberate. Only detectors get this: a workflow that follows its
// producers rather than owning a clock, like Update Manifest or Deploy Worker,
// would only produce false alarms.

import assert from "node:assert/strict";

import {
  MISSED_WINDOW_MULTIPLIER,
  MISSED_WINDOW_WORKFLOWS,
  cronIntervalHours,
  evaluateWorkflow,
  missedSlotCount,
} from "./check-pipeline-job-health.mjs";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-08-21T01:30:00Z");

function run(id, startedAt, { event = "schedule", conclusion = "success" } = {}) {
  return {
    id,
    event,
    conclusion,
    run_started_at: startedAt,
    html_url: `https://example.invalid/${id}`,
  };
}

function detector(file, cron) {
  return { file, label: file, events: ["schedule"], failure_streak_threshold: 2, crons: [cron] };
}

// The cron reader must distinguish the intervals the rule depends on.
assert.equal(cronIntervalHours("11 * * * *"), 1);
assert.equal(cronIntervalHours("41 */6 * * *"), 6);
assert.equal(cronIntervalHours("15 10 * * *"), 24);
assert.equal(cronIntervalHours("0 9 1 * *"), 24 * 31);
assert.equal(cronIntervalHours("not a cron"), null);

// The scope list must name only real detectors and must not be empty.
assert.ok(MISSED_WINDOW_WORKFLOWS.size > 0, "an empty scope protects nothing");
for (const file of MISSED_WINDOW_WORKFLOWS) {
  assert.match(file, /^[a-z0-9-]+\.yml$/, `${file} is not a workflow file name`);
}
assert.ok(
  !MISSED_WINDOW_WORKFLOWS.has("update-manifest.yml") && !MISSED_WINDOW_WORKFLOWS.has("deploy-worker.yml"),
  "workflows that follow their producers must stay out of scope",
);

// Slots are counted, not elapsed multiples. This is the regression that matters:
// an elapsed-multiple rule passed its own unit test and still missed the real
// 2026-08-21 incident, because 23:35Z to 01:30Z is only 1.91 hourly intervals
// while the 00:11 and 01:11 slots had both plainly passed unrun.
assert.equal(missedSlotCount("11 * * * *", Date.parse("2026-08-20T23:35:33Z"), NOW), 2);
assert.equal(missedSlotCount("7 * * * *", Date.parse("2026-08-20T23:35:01Z"), NOW), 2);
assert.equal(missedSlotCount("41 */6 * * *", Date.parse("2026-08-20T19:18:23Z"), NOW), 1);
assert.equal(missedSlotCount("not a cron", 0, NOW), null);

{
  // One missed slot is tolerated: GitHub drops scheduled runs routinely.
  const file = [...MISSED_WINDOW_WORKFLOWS][0];
  const started = "2026-08-21T00:30:00Z";
  const result = evaluateWorkflow(detector(file, "11 * * * *"), [run(2, started)], { now: NOW });
  assert.equal(result.latest_run_started_at, started);
  assert.equal(result.missed_schedule_slot_count, 1);
  assert.equal(result.alarm_reasons.includes("missed_schedule_window"), false, "one dropped slot must not alarm");
}

{
  // The measured 2026-08-21 incident, replayed exactly.
  const result = evaluateWorkflow(
    detector("global-writer-queue-observer.yml", "11 * * * *"),
    [run(2, "2026-08-20T23:35:33Z")],
    { now: NOW },
  );
  assert.equal(result.missed_schedule_slot_count, 2);
  assert.equal(result.alarm_reasons.includes("missed_schedule_window"), true, "two dropped slots must alarm");
  assert.equal(result.alarming, true);
  assert.equal(result.missed_schedule_window_hours > 1.9, true);
}

{
  // A workflow outside the detector scope never gets this reason, however late.
  const result = evaluateWorkflow(
    detector("update-manifest.yml", "11 * * * *"),
    [run(2, new Date(NOW - 400 * HOUR).toISOString())],
    { now: NOW },
  );
  assert.equal(result.alarm_reasons.includes("missed_schedule_window"), false);
}

{
  // No cron means no expectation to measure against.
  const file = [...MISSED_WINDOW_WORKFLOWS][0];
  const result = evaluateWorkflow(
    { ...detector(file, "11 * * * *"), crons: [] },
    [run(2, new Date(NOW - 400 * HOUR).toISOString())],
    { now: NOW },
  );
  assert.equal(result.alarm_reasons.includes("missed_schedule_window"), false);
}

assert.equal(MISSED_WINDOW_MULTIPLIER, 2, "the tolerated missed-slot count is part of the contract");

console.log(`missed schedule window: ok (${MISSED_WINDOW_WORKFLOWS.size} detectors in scope, x${MISSED_WINDOW_MULTIPLIER} tolerance)`);
