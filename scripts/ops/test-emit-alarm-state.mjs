#!/usr/bin/env node
// Contract test for emit-alarm-state.mjs (#365 P3). RED-first: a firing health
// result MUST produce an "open" state with the incident recorded; a quiet run
// after an open state MUST resolve honestly (clear + last_resolved_at) while
// preserving last_firing history. Plus a privacy proof (no paths/roots/secrets).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildAlarmState,
  alarmStateUnchanged,
  writeAlarmStateMirrors,
  writeWorkflowOutputs,
  ALARM_STATE_SCHEMA,
} from "./emit-alarm-state.mjs";
import { evaluateWorkflow } from "./check-pipeline-job-health.mjs";

// Build workflow rows through the REAL evaluator instead of hand-writing a
// shape. A hand-written fixture previously nested firstFailingRunId under an
// `alarm` key that evaluateWorkflow never produces, so emit-alarm-state read
// w.alarm?.firstFailingRunId, production emitted first_failing_run_id: null on
// every incident, and the test passed anyway. Deriving from the producer means
// the two can no longer drift apart silently.
function ghRun(id, conclusion) {
  return { id, conclusion, html_url: `https://github.com/etloveaui/100xFenok/actions/runs/${id}`, run_started_at: "2026-07-19T10:00:00Z" };
}
function alarmingRow(file, label, { streak = 2, firstFailingRunId = 999, failureStreakThreshold = 2 } = {}) {
  const runs = [];
  for (let i = 0; i < streak; i += 1) {
    runs.push(ghRun(i === streak - 1 ? firstFailingRunId : firstFailingRunId + 100 + i, "failure"));
  }
  runs.push(ghRun(1, "success"));
  return evaluateWorkflow({ file, label, failure_streak_threshold: failureStreakThreshold }, runs);
}
function okRow(file, label, events = null, failureStreakThreshold = 2) {
  return evaluateWorkflow({ file, label, failure_streak_threshold: failureStreakThreshold, ...(events ? { events } : {}) }, [ghRun(1, "success")]);
}


const ENV = {
  GITHUB_RUN_ID: "123456",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: "etloveaui/100xFenok",
  GITHUB_EVENT_NAME: "workflow_run",
};
const NOW = new Date("2026-07-19T12:00:00Z");

const firingHealth = {
  status: "alarm",
  issueTitle: "100xFenok pipeline job failure alarm",
  excluded: [{
    file: "pipeline-failure-alarm.yml",
    label: "Pipeline Failure Alarm",
    reason: "self-monitoring would create a recursive alarm loop",
  }],
  workflows: [
    alarmingRow("update-manifest.yml", "Update Manifest", { streak: 3, firstFailingRunId: 999 }),
    okRow("deploy-worker.yml", "Deploy Worker"),
    okRow("validate-workflows.yml", "Validate GitHub Workflows", ["push"]),
  ],
};
const quietHealth = {
  status: "ok",
  workflows: [
    okRow("update-manifest.yml", "Update Manifest"),
    okRow("deploy-worker.yml", "Deploy Worker"),
    okRow("validate-workflows.yml", "Validate GitHub Workflows", ["push"]),
  ],
};

// --- Queue eviction must reach the published state -------------------------
// Lost scheduled slots page separately from producer failures. A non-scheduled
// observer eviction remains visibility-only because it does not represent a
// missed producer cadence.
{
  const withEvictions = {
    status: "alarm",
    workflows: [
      {
        ...okRow("fetch-fenok-news-tone.yml", "News Tone"),
        status: "alarm",
        alarming: true,
        alarm_reasons: ["lost_schedule_slot"],
        lost_schedule_slot_count: 1,
        lost_schedule_slot_run_urls: ["https://gh/run/30107986538"],
        queue_evicted_run_urls: ["https://gh/run/30107986538"],
      },
      { ...okRow("global-writer-queue-observability.yml", "Queue Observability"), queue_evicted_run_urls: ["https://gh/run/30108630740"] },
      okRow("deploy-worker.yml", "Deploy Worker"),
    ],
  };
  const state = buildAlarmState({ health: withEvictions, prior: null, env: ENV, now: NOW });
  assert.equal(state.status, "open", "a lost scheduled slot must page");
  assert.deepEqual(state.open_incidents[0].alarm_reasons, ["lost_schedule_slot"]);
  assert.equal(state.open_incidents[0].lost_schedule_slot_count, 1);
  assert.equal(state.queue_evicted_run_count, 2, "lost slots are counted, not dropped");
  assert.deepEqual(
    state.queue_evicted_workflows,
    [
      { workflow: "fetch-fenok-news-tone.yml", count: 1 },
      { workflow: "global-writer-queue-observability.yml", count: 1 },
    ],
    "each losing workflow is named, sorted, without raw run evidence",
  );
  const quietSameBoard = {
    status: "ok",
    workflows: [
      okRow("fetch-fenok-news-tone.yml", "News Tone"),
      okRow("global-writer-queue-observability.yml", "Queue Observability"),
      okRow("deploy-worker.yml", "Deploy Worker"),
    ],
  };
  const quiet = buildAlarmState({ health: quietSameBoard, prior: null, env: ENV, now: NOW });
  assert.equal(quiet.queue_evicted_run_count, 0);
  assert.deepEqual(quiet.queue_evicted_workflows, [], "a clean board sprouts no eviction noise");
  assert.equal(
    alarmStateUnchanged(quiet, state),
    false,
    "clearing a lost scheduled slot must update the published state",
  );
  assert.equal(
    alarmStateUnchanged(state, quiet),
    false,
    "clearing eviction evidence must also update the published state",
  );
}

// --- RED-first: firing must open + record the incident ---
const firing = buildAlarmState({ health: firingHealth, prior: null, env: ENV, now: NOW });
assert.equal(firing.schema_version, ALARM_STATE_SCHEMA);
assert.equal(firing.status, "open", "firing health must yield status=open");
assert.equal(firing.open_incident_count, 1, "one alarming workflow => one open incident");
assert.equal(firing.open_incidents[0].workflow, "update-manifest.yml");
assert.equal(firing.open_incidents[0].streak, 3);
assert.equal(firing.open_incidents[0].failure_streak_threshold, 2);
assert.equal(firing.open_incidents[0].first_failing_run_id, 999);
assert.ok(firing.last_firing && firing.last_firing.run_id === "123456", "last_firing captures this run id");
assert.equal(firing.last_firing.run_url, "https://github.com/etloveaui/100xFenok/actions/runs/123456");
assert.deepEqual(firing.last_firing.workflows, ["update-manifest.yml"]);
assert.equal(firing.last_resolved_at, null, "not resolved while open");
assert.equal(firing.watched_workflows.length, 3);
assert.equal(
  firing.watched_workflows.find((row) => row.file === "validate-workflows.yml")?.event,
  "push",
  "the public watch policy must expose the critical gate's event filter",
);
assert.deepEqual(
  firing.watched_workflows.find((row) => row.file === "validate-workflows.yml")?.events,
  ["push"],
  "the public alarm state must expose every counted automatic event",
);
assert.deepEqual(firing.excluded_workflows, firingHealth.excluded,
  "declared workflow exclusions and their reasons must remain visible in alarm state");

// fh-538 two-hop proof: the real health evaluator calibrates a monthly workflow
// to one completed failure, and the emitted public state preserves that decision
// contract for both the open incident and the complete watch inventory.
{
  const monthlyHealth = {
    status: "alarm",
    workflows: [
      alarmingRow("monthly.yml", "Monthly", { streak: 1, failureStreakThreshold: 1 }),
      okRow("daily.yml", "Daily", null, 2),
    ],
  };
  const monthlyState = buildAlarmState({ health: monthlyHealth, prior: null, env: ENV, now: NOW });
  assert.equal(monthlyHealth.workflows[0].status, "alarm", "producer must page monthly streak 1");
  assert.equal(monthlyState.open_incidents[0].failure_streak_threshold, 1);
  assert.deepEqual(
    monthlyState.watched_workflows.map((row) => [row.file, row.failure_streak_threshold]),
    [["monthly.yml", 1], ["daily.yml", 2]],
    "failure threshold must survive health -> alarm-state projection",
  );
}

// --- Quiet run AFTER an open state: honest resolution + preserved history ---
const resolved = buildAlarmState({ health: quietHealth, prior: firing, env: ENV, now: new Date("2026-07-19T13:00:00Z") });
assert.equal(resolved.status, "clear", "quiet health resolves to clear");
assert.equal(resolved.open_incident_count, 0, "no open incidents once clear");
assert.equal(resolved.last_resolved_at, "2026-07-19T13:00:00.000Z", "transition open->clear stamps last_resolved_at");
assert.ok(resolved.last_firing && resolved.last_firing.run_id === "123456", "last_firing history preserved across resolution");

// --- Clear stays clear: last_resolved_at is not re-stamped every quiet run ---
const stillClear = buildAlarmState({ health: quietHealth, prior: resolved, env: ENV, now: new Date("2026-07-19T14:00:00Z") });
assert.equal(stillClear.status, "clear");
assert.equal(stillClear.last_resolved_at, "2026-07-19T13:00:00.000Z", "clear->clear preserves the original resolution time");

// --- Recovery must be ANNOUNCEABLE, not merely recorded ---
// buildAlarmState already stamps last_resolved_at on open->clear, but the only
// value main() publishes to the workflow is `incident_changed`. The OPS issue is
// therefore written on failure and never told the incident ended, so a reader
// cannot tell a live outage from a finished one. Expose the transition as a pure
// predicate the way `alarmStateUnchanged` already is, so the notification channel
// can gate an all-clear on it.
{
  const emitter = await import("./emit-alarm-state.mjs");
  assert.equal(typeof emitter.alarmStateResolved, "function",
    "the emitter must expose the open->clear transition as a pure predicate");
  assert.equal(emitter.alarmStateResolved(firing, resolved), true,
    "open -> clear is a resolution the workflow can announce");
  assert.equal(emitter.alarmStateResolved(resolved, stillClear), false,
    "clear -> clear must not re-announce an already-resolved incident");
  assert.equal(emitter.alarmStateResolved(firing, firing), false,
    "an unchanged open incident is not a resolution");
  assert.equal(emitter.alarmStateResolved(null, resolved), false,
    "a first-ever clear run has nothing to announce as resolved");
  assert.equal(emitter.alarmStateResolved(firing, unknownState()), false,
    "open -> unknown is not a resolution; unknown health must never read as an all-clear");
}

function unknownState() {
  return buildAlarmState({ health: { status: "unknown", workflows: [] }, prior: null, env: ENV, now: NOW });
}

// --- Unknown health is surfaced honestly (not silently clear) ---
const unknown = buildAlarmState({ health: { status: "unknown", workflows: [] }, prior: null, env: ENV, now: NOW });
assert.equal(unknown.status, "unknown");
assert.equal(unknown.open_incident_count, 0);

const unknownWithPolicy = buildAlarmState({
  health: {
    status: "unknown",
    workflows: [{
      file: "deploy-worker.yml",
      label: "Deploy Worker",
      events: ["push", "schedule"],
      status: "unknown",
      message: "API unavailable",
    }],
  },
  prior: null,
  env: ENV,
  now: NOW,
});
assert.deepEqual(
  unknownWithPolicy.watched_workflows[0].events,
  ["push", "schedule"],
  "API degradation must preserve the declared counted-event policy in public alarm state",
);

// Defect 2 two-hop public projection: cadence is supplied by the health
// producer, and an unrecovered overdue slot pages after its declared grace. The public
// shape keeps only the honest suspected_skip/attempt_gap words, never its cron
// or private evidence paths.
{
  const cadenceHealth = {
    status: "alarm",
    workflows: [
      { ...okRow("not-due.yml", "Not Due"), cadence_status: "not_due" },
      {
        ...okRow("overdue.yml", "Overdue"),
        status: "alarm",
        alarming: true,
        alarm_reasons: ["unrecovered_overdue"],
        cadence_status: "overdue",
        cadence_evidence: ["suspected_skip"],
      },
      { ...okRow("recovered.yml", "Recovered"), cadence_status: "recovered", cadence_evidence: ["attempt_gap"] },
      { ...okRow("no-declaration.yml", "No Declaration"), cadence_status: "no_declaration" },
      { ...okRow("unknown.yml", "Unknown"), cadence_status: "unknown" },
    ],
  };
  const cadenceState = buildAlarmState({ health: cadenceHealth, prior: null, env: ENV, now: NOW });
  assert.equal(cadenceState.status, "open", "unrecovered overdue after declared grace must page");
  assert.equal(cadenceState.open_incident_count, 1);
  assert.deepEqual(cadenceState.open_incidents[0].alarm_reasons, ["unrecovered_overdue"]);
  assert.deepEqual(cadenceState.cadence_state_counts, {
    not_due: 1,
    overdue: 1,
    recovered: 1,
    no_declaration: 1,
    unknown: 1,
  });
  assert.deepEqual(
    cadenceState.watched_workflows.map((row) => [row.file, row.cadence_status, row.cadence_evidence]),
    [
      ["not-due.yml", "not_due", []],
      ["overdue.yml", "overdue", ["suspected_skip"]],
      ["recovered.yml", "recovered", ["attempt_gap"]],
      ["no-declaration.yml", "no_declaration", []],
      ["unknown.yml", "unknown", []],
    ],
    "all five cadence outcomes must survive health -> alarm-state projection",
  );

  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "alarm-state-cadence-mirrors-"));
  const outPath = path.join(outputRoot, "data", "admin", "alarm-state.json");
  const publicOutPath = path.join(outputRoot, "public", "data", "admin", "alarm-state.json");
  const expectedBytes = writeAlarmStateMirrors({ state: cadenceState, outPath, publicOutPath });
  assert.equal(fs.readFileSync(outPath, "utf8"), expectedBytes);
  assert.equal(fs.readFileSync(publicOutPath, "utf8"), expectedBytes,
    "health -> alarm state must write byte-identical admin and public mirrors");
}

// --- Privacy: the serialized state must not leak repo paths/roots/secrets ---
const FORBIDDEN = ["_private/", "data/admin", ".github/", "100xfenok-next", "public/data", "recovery_store", "GITHUB_TOKEN", "ghp_", "secret"];
for (const state of [firing, resolved, unknown]) {
  const json = JSON.stringify(state);
  for (const marker of FORBIDDEN) {
    assert.ok(!json.includes(marker), `alarm state leaked forbidden marker: ${marker}`);
  }
}

// An unresolved incident is re-reported on every trigger. Each report used to
// rewrite generated_at and last_firing with the reporting run's identity, which
// is a real content change, so the workflow committed it every time - 14 commits
// to origin/main on 2026-07-22 carrying an identical incident. Suppression must
// never become blindness, so every transition below is asserted to still write.
{
  const openNow = buildAlarmState({ health: firingHealth, prior: null, env: ENV, now: NOW });

  // Same incident, later run: nothing the alarm asserts has moved.
  const repeat = buildAlarmState({
    health: firingHealth,
    prior: openNow,
    env: { ...ENV, GITHUB_RUN_ID: "999999", GITHUB_EVENT_NAME: "schedule" },
    now: new Date("2026-07-19T12:30:00Z"),
  });
  assert.ok(
    alarmStateUnchanged(openNow, repeat),
    "a re-report of an identical incident must be treated as unchanged",
  );

  // --- transitions that MUST still be written ---
  const worse = buildAlarmState({
    health: {
      ...firingHealth,
      workflows: [
        alarmingRow("update-manifest.yml", "Update Manifest", { streak: 4, firstFailingRunId: 999 }),
        okRow("deploy-worker.yml", "Deploy Worker"),
      ],
    },
    prior: openNow,
    env: ENV,
    now: NOW,
  });
  assert.ok(!alarmStateUnchanged(openNow, worse), "a growing streak must be written");

  const secondWorkflow = buildAlarmState({
    health: {
      ...firingHealth,
      workflows: [
        alarmingRow("update-manifest.yml", "Update Manifest", { streak: 3, firstFailingRunId: 999 }),
        alarmingRow("deploy-worker.yml", "Deploy Worker", { streak: 2, firstFailingRunId: 555 }),
      ],
    },
    prior: openNow,
    env: ENV,
    now: NOW,
  });
  assert.ok(!alarmStateUnchanged(openNow, secondWorkflow), "a second alarming workflow must be written");

  const differentFirstFailure = buildAlarmState({
    health: {
      ...firingHealth,
      workflows: [
        alarmingRow("update-manifest.yml", "Update Manifest", { streak: 3, firstFailingRunId: 4242 }),
        okRow("deploy-worker.yml", "Deploy Worker"),
      ],
    },
    prior: openNow,
    env: ENV,
    now: NOW,
  });
  assert.ok(!alarmStateUnchanged(openNow, differentFirstFailure), "a different first-failing run must be written");

  const resolved = buildAlarmState({ health: quietHealth, prior: openNow, env: ENV, now: new Date("2026-07-19T13:00:00Z") });
  assert.ok(!alarmStateUnchanged(openNow, resolved), "resolution must be written");

  const watchListChanged = buildAlarmState({
    health: { ...firingHealth, workflows: [...firingHealth.workflows, okRow("fenok-edge-daily.yml", "Fenok Edge Daily Data")] },
    prior: openNow,
    env: ENV,
    now: NOW,
  });
  assert.ok(!alarmStateUnchanged(openNow, watchListChanged), "a change to the watched-workflow set must be written");

  const exclusionChanged = buildAlarmState({
    health: {
      ...firingHealth,
      excluded: [{ ...firingHealth.excluded[0], reason: "changed policy reason" }],
    },
    prior: openNow,
    env: ENV,
    now: NOW,
  });
  assert.ok(!alarmStateUnchanged(openNow, exclusionChanged),
    "a change to an explicit exclusion policy must be written");

  // A first-ever emission has no prior and must always be written.
  assert.ok(!alarmStateUnchanged(null, openNow), "a first emission must be written");
}

// GITHUB_OUTPUT is machinery, not best-effort persistence. An unwritable
// target must escape the helper so the direct emitter process exits non-zero.
{
  const unwritableOutput = fs.mkdtempSync(path.join(os.tmpdir(), "alarm-state-output-failure-"));
  try {
    assert.throws(
      () => writeWorkflowOutputs({
        outputPath: unwritableOutput,
        incidentChanged: "true",
        incidentResolved: "true",
      }),
      (error) => error?.code === "EISDIR",
      "GITHUB_OUTPUT write failure must throw instead of warning and returning green",
    );
  } finally {
    fs.rmSync(unwritableOutput, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({ ok: true, suite: "emit-alarm-state contract" }, null, 2));
