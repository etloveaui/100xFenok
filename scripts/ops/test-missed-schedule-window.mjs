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
  annotateQueueEvictions,
  cronIntervalHours,
  declaredMissedSlotCount,
  deriveWorkflowWatchPolicy,
  evaluateWorkflow,
  mergeWorkflowRunBatches,
  missedSlotCount,
  needsMissedWindowReverification,
} from "./check-pipeline-job-health.mjs";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-08-21T01:30:00Z");
const RESTORE_CRON = "4,19,34,49 * * * *";

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
assert.ok(MISSED_WINDOW_WORKFLOWS.has("retention-restore.yml"), "the restore watchdog owns a schedule to monitor");
assert.ok(!MISSED_WINDOW_WORKFLOWS.has("retention-sweep.yml"), "the owner-controlled sweep campaign stays exempt");

// Slots are counted, not elapsed multiples. This is the regression that matters:
// an elapsed-multiple rule passed its own unit test and still missed the real
// 2026-08-21 incident, because 23:35Z to 01:30Z is only 1.91 hourly intervals
// while the 00:11 and 01:11 slots had both plainly passed unrun.
assert.equal(missedSlotCount("11 * * * *", Date.parse("2026-08-20T23:35:33Z"), NOW), 2);
assert.equal(missedSlotCount("7 * * * *", Date.parse("2026-08-20T23:35:01Z"), NOW), 2);
assert.equal(missedSlotCount("41 */6 * * *", Date.parse("2026-08-20T19:18:23Z"), NOW), 1);
assert.equal(declaredMissedSlotCount(RESTORE_CRON, Date.parse("2026-08-21T00:50:00Z"), NOW), 2);
assert.equal(declaredMissedSlotCount(RESTORE_CRON, Date.parse("2026-08-21T01:05:00Z"), NOW), 1);
assert.equal(missedSlotCount("not a cron", 0, NOW), null);
assert.equal(declaredMissedSlotCount("not a cron", 0, NOW), null);
// Existing hourly observers let an early any-event run satisfy its hour;
// the restore watchdog counts exact scheduled instants and must not borrow it.
const earlyRun = Date.parse("2026-08-21T00:00:00Z");
const halfHour = Date.parse("2026-08-21T00:30:00Z");
assert.equal(missedSlotCount("23 * * * *", earlyRun, halfHour), 0);
assert.equal(declaredMissedSlotCount("23 * * * *", earlyRun, halfHour), 1);
const legacyEarly = evaluateWorkflow(detector("data-plane-serving-probe.yml", "23 * * * *"),
  [run(41, "2026-08-21T00:00:00Z")], { now: halfHour });
assert.equal(legacyEarly.missed_schedule_slot_count, 0, "existing detectors keep the legacy counter");
const reorderedStarts = evaluateWorkflow(detector("data-plane-serving-probe.yml", "23 * * * *"),
  [run(43, "2026-08-21T00:00:00Z"), run(42, "2026-08-21T01:00:00Z")], { now: NOW });
assert.equal(reorderedStarts.missed_schedule_slot_count, 1, "existing detectors keep the newest-counted-run anchor even when queue delays reorder start times");


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

{
  // The actual restore cadence is a minute-list cron. The first passed slot is
  // tolerated; two passed slots (30 minutes) alarm if no scheduled run exists.
  const restore = detector("retention-restore.yml", RESTORE_CRON);
  const oneSlot = evaluateWorkflow(restore, [run(10, "2026-08-21T01:05:00Z")], { now: NOW });
  assert.equal(oneSlot.missed_schedule_slot_count, 1);
  assert.equal(oneSlot.alarm_reasons.includes("missed_schedule_window"), false);

  const twoSlots = evaluateWorkflow(restore, [run(9, "2026-08-21T00:50:00Z")], { now: NOW });
  assert.equal(twoSlots.missed_schedule_slot_count, 2);
  assert.equal(twoSlots.alarm_reasons.includes("missed_schedule_window"), true);
}

{
  // A successful scheduled no-op is still proof the watchdog ran. A manual
  // dispatch cannot refresh the schedule clock or erase two missed slots.
  const restore = detector("retention-restore.yml", RESTORE_CRON);
  const noOpSuccess = evaluateWorkflow(restore, [run(12, "2026-08-21T01:20:00Z")], { now: NOW });
  assert.equal(noOpSuccess.missed_schedule_slot_count, 0);
  assert.equal(noOpSuccess.alarm_reasons.includes("missed_schedule_window"), false);

  const withManualDispatch = evaluateWorkflow(
    restore,
    [
      run(14, "2026-08-21T01:25:00Z", { event: "workflow_dispatch" }),
      run(13, "2026-08-21T00:50:00Z"),
    ],
    { now: NOW },
  );
  assert.equal(withManualDispatch.latest_run_started_at, "2026-08-21T00:50:00Z");
  assert.equal(withManualDispatch.missed_schedule_slot_count, 2);
  assert.equal(withManualDispatch.alarm_reasons.includes("missed_schedule_window"), true);
}

{
  // A recent in-progress scheduled watchdog counts as liveness evidence.
  // Queued-only and timeout-expired execution records do not.
  const restore = detector("retention-restore.yml", RESTORE_CRON);
  const recentInProgress = evaluateWorkflow(
    restore,
    [run(20, "2026-08-21T00:50:00Z")],
    {
      now: NOW,
      activeScheduledRuns: [{ id: 21, event: "schedule", status: "in_progress", run_started_at: "2026-08-21T01:20:00Z" }],
    },
  );
  assert.equal(recentInProgress.missed_schedule_slot_count, 0);
  assert.equal(recentInProgress.alarm_reasons.includes("missed_schedule_window"), false);

  const queuedOnly = evaluateWorkflow(
    restore,
    [run(20, "2026-08-21T00:50:00Z")],
    {
      now: NOW,
      activeScheduledRuns: [
        { id: 22, event: "schedule", status: "queued", created_at: "2026-08-21T01:05:00Z" },
        { id: 23, event: "schedule", status: "queued", created_at: "2026-08-21T01:20:00Z" },
      ],
    },
  );
  assert.equal(queuedOnly.missed_schedule_slot_count, 2);
  assert.equal(queuedOnly.alarm_reasons.includes("missed_schedule_window"), true,
    "queued runs do not prove the watchdog executed or hide a stuck runner queue");

  const expiredInProgress = evaluateWorkflow(
    restore,
    [run(20, "2026-08-21T00:50:00Z")],
    {
      now: NOW,
      activeScheduledRuns: [{ id: 24, event: "schedule", status: "in_progress", run_started_at: "2026-08-21T00:50:00Z" }],
    },
  );
  assert.equal(expiredInProgress.missed_schedule_slot_count, 2);
  assert.equal(expiredInProgress.alarm_reasons.includes("missed_schedule_window"), true,
    "an execution older than the workflow timeout is not indefinite liveness evidence");
}

{
  // An unsupported/malformed minute list fails open: no fabricated alarm.
  const result = evaluateWorkflow(
    detector("retention-restore.yml", "4,not-a-minute * * * *"),
    [run(30, "2026-08-21T00:50:00Z")],
    { now: NOW },
  );
  assert.equal(result.missed_schedule_slot_count, null);
  assert.equal(result.alarm_reasons.includes("missed_schedule_window"), false);
}

assert.equal(MISSED_WINDOW_MULTIPLIER, 2, "the tolerated missed-slot count is part of the contract");

// fh-258 stale-page fixture. Measured 2026-09-14T08:11:53Z: the serving-probe
// row anchored at 2026-08-19T07:24:30Z with 105 counted slots while run
// 34809685448 had already succeeded on 2026-09-14T05:27:04Z. The detector had
// accepted a stale single page; nothing else reproduces that row.
const STALE_PROBE_NOW = Date.parse("2026-09-14T08:11:53Z");
const STALE_ANCHOR = run(32227682844, "2026-08-19T07:24:30Z", { conclusion: "failure" });

{
  const result = evaluateWorkflow(
    detector("data-plane-serving-probe.yml", "41 */6 * * *"),
    [STALE_ANCHOR],
    { now: STALE_PROBE_NOW },
  );
  assert.equal(result.latest_run_started_at, "2026-08-19T07:24:30Z");
  assert.equal(result.missed_schedule_slot_count, 105, "existing serving-probe counting stays unchanged");
  assert.equal(result.alarm_reasons.includes("missed_schedule_window"), true);
  assert.equal(
    needsMissedWindowReverification(result),
    true,
    "a missed-window verdict must be re-read before it pages",
  );
}

{
  // Disagreeing second read: the widened page carries the fresh success, so the
  // merged evaluation clears the false positive (one slot, not 105).
  const merged = mergeWorkflowRunBatches([
    [STALE_ANCHOR],
    [run(34809685448, "2026-09-14T05:27:04Z")],
  ]);
  const result = evaluateWorkflow(
    detector("data-plane-serving-probe.yml", "41 */6 * * *"),
    merged,
    { now: STALE_PROBE_NOW },
  );
  assert.equal(result.latest_run_started_at, "2026-09-14T05:27:04Z");
  assert.equal(result.missed_schedule_slot_count, 1);
  assert.equal(result.alarm_reasons.includes("missed_schedule_window"), false);
}

{
  // Agreeing second read: a page repeating the same silent anchor is not
  // evidence the workflow resumed, so the alarm stands.
  const agreeing = mergeWorkflowRunBatches([
    [STALE_ANCHOR],
    [run(32227682845, "2026-08-19T07:24:30Z", { conclusion: "failure" })],
  ]);
  const result = evaluateWorkflow(
    detector("data-plane-serving-probe.yml", "41 */6 * * *"),
    agreeing,
    { now: STALE_PROBE_NOW },
  );
  assert.equal(result.missed_schedule_slot_count, 105);
  assert.equal(result.alarm_reasons.includes("missed_schedule_window"), true);
}

// Acquisition scope comes from the lane registry and actual workflow cron.
{
  const runs = [
    { ...run(120, "2026-08-21T01:20:00Z"), status: "queued", conclusion: null },
    { ...run(119, "2026-08-21T00:20:00Z", { conclusion: "failure" }), status: "completed" },
    { ...run(118, "2026-08-20T23:20:00Z", { conclusion: "failure" }), status: "completed" },
  ];
  const inspected = [];
  await annotateQueueEvictions({ runs, fetchJobsFn: async (id) => {
    inspected.push(id);
    return [{ conclusion: "cancelled", steps: [] }];
  } });
  assert.deepEqual(inspected, [119, 118], "active schedule evidence must not hide completed queue evictions");
  assert.equal(runs[1].queue_evicted, true);
  assert.equal(runs[2].queue_evicted, true);
}

// Acquisition scope comes from the lane registry and actual workflow cron.
// Manual-only and owner-run lanes must not acquire an invented schedule.
{
  const policy = deriveWorkflowWatchPolicy();
  const producers = policy.watched.filter((workflow) => workflow.scheduled_producer);
  for (const file of ["fetch-yf-finance.yml", "fetch-stockanalysis.yml", "fetch-fenok-private-options.yml"]) {
    assert.ok(producers.some((workflow) => workflow.file === file), `${file} owns automatic acquisition`);
  }
  for (const file of ["retention-sweep.yml", "global-scouter-shadow-publish.yml", "deploy-worker.yml"]) {
    assert.ok(!producers.some((workflow) => workflow.file === file), `${file} is not a scheduled data producer`);
  }
  const options = producers.find((workflow) => workflow.file === "fetch-fenok-private-options.yml");
  const lastSchedule = run(100, "2026-10-03T06:29:27Z");
  const tuesday = evaluateWorkflow(options, [lastSchedule], { now: Date.parse("2026-10-06T06:30:00Z") });
  assert.equal(tuesday.missed_schedule_slot_count, 1, "Sunday and Monday are not options schedule slots");
  assert.equal(tuesday.alarming, false, "one delayed/dropped natural slot stays tolerated");
  const wednesday = evaluateWorkflow(options, [
    run(102, "2026-10-07T06:20:00Z", { event: "workflow_dispatch" }),
    lastSchedule,
  ], { now: Date.parse("2026-10-07T06:30:00Z") });
  assert.equal(wednesday.missed_schedule_slot_count, 2);
  assert.equal(wednesday.alarm_reasons.includes("missed_schedule_window"), true,
    "manual recovery must not conceal a dead producer schedule");
}

{
  const since = Date.parse("2026-10-05T00:00:00Z");
  const now = Date.parse("2026-10-06T12:01:00Z");
  assert.equal(declaredMissedSlotCount(["0 12 * * 2", "0 12 * * 2", "0 1 * * 2"], since, now), 2,
    "multi-cron slots form a union, including overlapping declarations");
  assert.equal(declaredMissedSlotCount("0 12 * * 2", since, Date.parse("2026-10-13T12:01:00Z")), 2,
    "weekly schedules count declared dates rather than elapsed daily intervals");
  const producer = { ...detector("fixture-producer.yml", "11 * * * *"), scheduled_producer: true,
    schedule_activated_at: "2026-08-20T23:35:00Z" };
  const neverRan = evaluateWorkflow(producer,
    [run(110, "2026-08-21T01:20:00Z", { event: "workflow_dispatch" })], { now: NOW });
  assert.equal(neverRan.status, "alarm", "a registry activation can anchor a producer with no scheduled run");
  assert.equal(neverRan.missed_schedule_slot_count, 2);
  const onlyPush = evaluateWorkflow({ ...producer, events: ["schedule", "push"], schedule_activated_at: undefined },
    [run(113, "2026-08-21T01:20:00Z", { event: "push" })], { now: NOW });
  assert.equal(onlyPush.status, "unknown", "push success is not evidence that an unanchored schedule ran");
  const activatedOnlyPush = evaluateWorkflow({ ...producer, events: ["schedule", "push"] },
    [run(113, "2026-08-21T01:20:00Z", { event: "push" })], { now: NOW });
  assert.equal(activatedOnlyPush.status, "alarm", "push success cannot cover missed slots since registry activation");
  const queued = evaluateWorkflow(producer, [{
    id: 111, event: "schedule", status: "queued", conclusion: null, created_at: "2026-08-21T01:15:00Z",
  }], { now: NOW });
  assert.equal(queued.missed_schedule_slot_count, 0, "a created producer run proves the trigger exists");
  const staleQueued = evaluateWorkflow(producer, [{
    id: 112, event: "schedule", status: "queued", conclusion: null, created_at: "2026-08-20T23:35:00Z",
  }], { now: NOW });
  assert.equal(staleQueued.missed_schedule_slot_count, 2, "an old queued run cannot cover later absent slots");
}

console.log(`missed schedule window: ok (${MISSED_WINDOW_WORKFLOWS.size} detectors plus registry producers, x${MISSED_WINDOW_MULTIPLIER} tolerance)`);
