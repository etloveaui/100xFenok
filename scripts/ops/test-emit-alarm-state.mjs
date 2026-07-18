#!/usr/bin/env node
// Contract test for emit-alarm-state.mjs (#365 P3). RED-first: a firing health
// result MUST produce an "open" state with the incident recorded; a quiet run
// after an open state MUST resolve honestly (clear + last_resolved_at) while
// preserving last_firing history. Plus a privacy proof (no paths/roots/secrets).

import assert from "node:assert/strict";

import { buildAlarmState, ALARM_STATE_SCHEMA } from "./emit-alarm-state.mjs";

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
  workflows: [
    { file: "update-manifest.yml", label: "Update Manifest", status: "alarm", streak: 3, alarm: { firstFailingRunId: 999, firstFailingRunUrl: "https://github.com/etloveaui/100xFenok/actions/runs/999" } },
    { file: "deploy-worker.yml", label: "Deploy Worker", status: "ok" },
  ],
};
const quietHealth = {
  status: "ok",
  workflows: [
    { file: "update-manifest.yml", label: "Update Manifest", status: "ok" },
    { file: "deploy-worker.yml", label: "Deploy Worker", status: "ok" },
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
assert.equal(firing.watched_workflows.length, 2);

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

console.log(JSON.stringify({ ok: true, suite: "emit-alarm-state contract" }, null, 2));
