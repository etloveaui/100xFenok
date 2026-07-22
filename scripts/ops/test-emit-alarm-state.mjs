#!/usr/bin/env node
// Contract test for emit-alarm-state.mjs (#365 P3). RED-first: a firing health
// result MUST produce an "open" state with the incident recorded; a quiet run
// after an open state MUST resolve honestly (clear + last_resolved_at) while
// preserving last_firing history. Plus a privacy proof (no paths/roots/secrets).

import assert from "node:assert/strict";

import { buildAlarmState, alarmStateUnchanged, ALARM_STATE_SCHEMA } from "./emit-alarm-state.mjs";
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
function alarmingRow(file, label, { streak = 2, firstFailingRunId = 999 } = {}) {
  const runs = [];
  for (let i = 0; i < streak; i += 1) {
    runs.push(ghRun(i === streak - 1 ? firstFailingRunId : firstFailingRunId + 100 + i, "failure"));
  }
  runs.push(ghRun(1, "success"));
  return evaluateWorkflow({ file, label }, runs);
}
function okRow(file, label, event = null) {
  return evaluateWorkflow({ file, label, ...(event ? { event } : {}) }, [ghRun(1, "success")]);
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
    okRow("validate-workflows.yml", "Validate GitHub Workflows", "push"),
  ],
};
const quietHealth = {
  status: "ok",
  workflows: [
    okRow("update-manifest.yml", "Update Manifest"),
    okRow("deploy-worker.yml", "Deploy Worker"),
    okRow("validate-workflows.yml", "Validate GitHub Workflows", "push"),
  ],
};

// --- RED-first: firing must open + record the incident ---
const firing = buildAlarmState({ health: firingHealth, prior: null, env: ENV, now: NOW });
assert.equal(firing.schema_version, ALARM_STATE_SCHEMA);
assert.equal(firing.status, "open", "firing health must yield status=open");
assert.equal(firing.open_incident_count, 1, "one alarming workflow => one open incident");
assert.equal(firing.open_incidents[0].workflow, "update-manifest.yml");
assert.equal(firing.open_incidents[0].streak, 3);
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
assert.deepEqual(firing.excluded_workflows, firingHealth.excluded,
  "declared workflow exclusions and their reasons must remain visible in alarm state");

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

// --- Unknown health is surfaced honestly (not silently clear) ---
const unknown = buildAlarmState({ health: { status: "unknown", workflows: [] }, prior: null, env: ENV, now: NOW });
assert.equal(unknown.status, "unknown");
assert.equal(unknown.open_incident_count, 0);

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

console.log(JSON.stringify({ ok: true, suite: "emit-alarm-state contract" }, null, 2));
