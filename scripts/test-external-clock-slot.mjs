#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { admissionDecision, scheduledSlot, checkAdmission, sourceWasClockNoop } from "./check-external-clock-slot.mjs";
import { EXTERNAL_CLOCK_CRONS, externalClockCrons, dueDispatches, workerBudgetJobs, externalClockEvent, collectorClockMode, dispatchDue } from "../ops/a1-lanes/external-clock.mjs";
import { evaluateExternalClock, evaluateWorkflow } from "./ops/check-pipeline-job-health.mjs";

const file = "fetch-fred-macro.yml";
const slot = "2026-10-12T08:00:00.000Z";
const currentRun = { id: 10, head_branch: "main", created_at: "2026-10-12T14:45:00Z" };
const success = { id: 9, event: "workflow_dispatch", status: "completed", conclusion: "success",
  head_branch: "main", created_at: slot, display_title: `external-clock/a1/v1 ${file} ${slot}` };
const base = { file, currentRun, eventName: "schedule", event: { schedule: "0 8 * * *" }, runs: [success] };
assert.equal(admissionDecision(base).skip, true, "late daily GitHub fallback skips actual successful slot");
for (const changed of [{ conclusion: "failure" }, { conclusion: null, status: "queued" },
  { head_branch: "other" }, { display_title: "Human dispatch" }, { id: 10 },
  { display_title: `external-clock/a1/v1 ${file} 2026-10-11T08:00:00.000Z` }]) {
  assert.equal(admissionDecision({ ...base, runs: [{ ...success, ...changed }] }).skip, false);
}
assert.equal(admissionDecision({ ...base, currentRun: { ...currentRun, run_started_at: "2026-10-13T09:00:00Z" } }).slot,
  slot, "queue delay cannot steal the next day's slot");
assert.equal(scheduledSlot("0 22 * * 1-5", "2026-10-12T04:00:00Z"), "2026-10-09T22:00:00.000Z");
assert.equal(admissionDecision({ ...base, eventName: "workflow_dispatch", event: { inputs: {} } }).skip, false);
const marker = { external_clock: "a1-v1", external_clock_slot: slot };
assert.equal(admissionDecision({ ...base, eventName: "workflow_dispatch", event: { inputs: marker } }).skip, true);
assert.throws(() => admissionDecision({ ...base, eventName: "workflow_dispatch",
  event: { inputs: { ...marker, external_clock_slot: "2026-10-12T08:01:00.000Z" } } }), /Invalid/);
assert.throws(() => admissionDecision({ ...base, eventName: "workflow_dispatch",
  event: { inputs: { ...marker, external_clock_slot: "2026-10-13T08:00:00.000Z" } } }), /Invalid/);
assert.equal(admissionDecision({ ...base, file: "worker-request-budget-alarm.yml",
  event: { schedule: "0 5 * * *" } }).reason, "github-only-schedule");

for (const [cron, stamp, expected] of [
  ["7 * * * *", "2026-10-12T02:07:00.000Z", { requests: true, telemetry: false }],
  ["17 2,14 * * *", "2026-10-12T02:17:00.000Z", { requests: false, telemetry: true }],
  ["17 2,14 * * *", "2026-10-12T14:17:00.000Z", { requests: false, telemetry: true }],
]) {
  const budgetFile = "worker-request-budget-alarm.yml";
  assert.ok(dueDispatches(new Date(stamp)).some((row) => row.file === budgetFile));
  assert.deepEqual(workerBudgetJobs("schedule", { schedule: cron }), expected);
  const inputs = { external_clock: "a1-v1", external_clock_slot: stamp };
  assert.deepEqual(workerBudgetJobs("workflow_dispatch", { inputs }), expected);
  const proof = { ...success, created_at: stamp, display_title: `external-clock/a1/v1 ${budgetFile} ${stamp}` };
  assert.equal(admissionDecision({ ...base, file: budgetFile,
    currentRun: { ...currentRun, created_at: new Date(Date.parse(stamp) + 30 * 60_000).toISOString() },
    event: { schedule: cron }, runs: [proof] }).skip, true,
    "the delayed GitHub budget job skips only the same successful external slot");
}
assert.deepEqual(workerBudgetJobs("workflow_dispatch", { inputs: {} }), { requests: true, telemetry: true });
assert.deepEqual(workerBudgetJobs("workflow_dispatch", { inputs: { external_clock: "a1-v1", external_clock_slot: "invalid" } }),
  { requests: false, telemetry: false });

for (const cron of ["30 2 * * *", "30 9 * * *"]) {
  const multiFile = "update-manifest.yml";
  const stamp = scheduledSlot(cron, currentRun.created_at);
  const proof = { ...success, created_at: stamp, display_title: `external-clock/a1/v1 ${multiFile} ${stamp}` };
  assert.equal(admissionDecision({ ...base, file: multiFile, event: { schedule: cron }, runs: [proof] }).skip, true);
  const wrong = { ...proof, display_title: proof.display_title.replace("T02:30", "T09:30").replace("T09:30", "T02:30") };
  if (cron.startsWith("30 9")) assert.equal(admissionDecision({ ...base, file: multiFile,
    event: { schedule: cron }, runs: [wrong] }).skip, false);
}

const calls = [];
const got = checkAdmission({ file, eventName: "schedule", event: base.event, runId: 10, repository: "owner/repo",
  api: (endpoint) => {
    calls.push(endpoint);
    if (calls.length === 1) return currentRun;
    if (calls.length === 2) return { workflow_runs: Array(100).fill({ ...success, display_title: "human" }) };
    return { workflow_runs: [success] };
  } });
assert.equal(got.skip, true, "same-slot proof beyond the first page remains usable");
assert.match(calls[1], /created=.*2026-10-12T08/);
assert.match(calls[2], /page=2$/);
assert.throws(() => checkAdmission({ file, eventName: "schedule", event: base.event, runId: 10,
  repository: "owner/repo", api: () => { throw new Error("API down"); } }), /API down/);
assert.equal(checkAdmission({ file, eventName: "push", event: {}, api: () => assert.fail("human/push API call") }).skip, false);
assert.equal(sourceWasClockNoop([{ name: "clock-admission", conclusion: "success" },
  { name: "producer", conclusion: "skipped" }]), true);
assert.equal(sourceWasClockNoop([{ name: "clock-admission", conclusion: "success" },
  { name: "producer", conclusion: "success" }]), false);
assert.equal(sourceWasClockNoop([{ name: "legacy-producer", conclusion: "success" }]), false);
assert.throws(() => sourceWasClockNoop([]), /unreadable/);

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-clock-slot-"));
try {
  fs.writeFileSync(path.join(fixture, "gh"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const eventPath = path.join(fixture, "event.json");
  const outputPath = path.join(fixture, "output");
  fs.writeFileSync(eventPath, JSON.stringify(base.event));
  const env = { ...process.env, PATH: `${fixture}:${process.env.PATH}`, GH_TOKEN: "fixture-only",
    GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputPath, GITHUB_EVENT_NAME: "schedule",
    GITHUB_RUN_ID: "10", GITHUB_REPOSITORY: "owner/repo" };
  const cli = fileURLToPath(new URL("./check-external-clock-slot.mjs", import.meta.url));
  const fallback = spawnSync(process.execPath, [cli, file], { env, encoding: "utf8" });
  assert.equal(fallback.status, 0);
  assert.equal(fs.readFileSync(outputPath, "utf8"), "skip=false\n");
  assert.match(fallback.stderr, /preserving fallback/);
  fs.writeFileSync(eventPath, JSON.stringify({ inputs: marker }));
  const brokenMarker = spawnSync(process.execPath, [cli, file], {
    env: { ...env, GITHUB_EVENT_NAME: "workflow_dispatch" }, encoding: "utf8" });
  assert.notEqual(brokenMarker.status, 0, "unmeasurable marked admission must be visible as failure");
  fs.writeFileSync(eventPath, JSON.stringify({ inputs: {} }));
  fs.writeFileSync(outputPath, "");
  const manualBudget = spawnSync(process.execPath, [cli, "worker-request-budget-alarm.yml"], {
    env: { ...env, GITHUB_EVENT_NAME: "workflow_dispatch" }, encoding: "utf8" });
  assert.equal(manualBudget.status, 0);
  assert.equal(fs.readFileSync(outputPath, "utf8"), "skip=false\ncheck_budget=true\ncheck_telemetry=true\n");
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

// Monthly source declarations and the two bounded collector transports.
assert.equal(scheduledSlot("0 8 1 * *", "2026-11-29T09:00:00Z"), "2026-11-01T08:00:00.000Z");
for (const [collector, cron, stamp, mode, action] of [
  ["fetch-stockanalysis.yml", "20 21 * * *", "2026-10-12T21:20:00.000Z", "stock_daily", "external-clock-stockanalysis"],
  ["fetch-stockanalysis.yml", "50 23 * * 1-5", "2026-10-12T23:50:00.000Z", "etf_weekday", "external-clock-stockanalysis"],
  ["fetch-stockanalysis.yml", "20 23 * * 0", "2026-10-11T23:20:00.000Z", "etf_general", "external-clock-stockanalysis"],
  ["fetch-yf-finance.yml", "7 0 * * 0-5", "2026-10-12T00:07:00.000Z", "etfs", "external-clock-yf-finance"],
]) {
  assert.equal(collectorClockMode(collector, cron), mode);
  const proof = { ...success, event: externalClockEvent(collector), created_at: stamp,
    display_title: `external-clock/a1/v1 ${collector} ${stamp}` };
  const call = { file: collector, eventName: "repository_dispatch", event: { action,
    client_payload: { external_clock: "a1-v1", external_clock_slot: stamp } },
    currentRun: { ...currentRun, created_at: stamp }, runs: [proof] };
  assert.equal(admissionDecision(call).skip, true);
  assert.throws(() => admissionDecision({ ...call, event: { ...call.event, action: "wrong" } }), /Invalid/);
  assert.equal(admissionDecision({ ...call, runs: [{ ...proof, conclusion: "failure" }] }).skip, false);
  assert.equal(admissionDecision({ ...call, eventName: "schedule", event: { schedule: cron } }).skip, true);
  const workflow = { file: collector, crons: externalClockCrons(collector), events: ["schedule"],
    failure_streak_threshold: 2 };
  const failures = [8, 7, 6].map(id => ({ ...proof, id, conclusion: "failure" }));
  const manual = { ...proof, id: 10, event: "workflow_dispatch", display_title: "Human repair" };
  const pending = evaluateWorkflow(workflow, [manual, ...failures], { now: Date.parse(stamp) + 60_000 });
  assert.ok(pending.alarm_reasons.includes("failure_streak"), "marked repository failures enter the same failure streak");
  assert.equal(pending.recovery_pending_next_scheduled_run, true, "human success leaves the automatic incident pending");
  assert.equal(evaluateWorkflow(workflow, [{ ...proof, id: 11 }, manual, ...failures],
    { now: Date.parse(stamp) + 60_000 }).alarming, false, "the next marked automatic success closes the incident");
  assert.equal(evaluateExternalClock(workflow, [proof], { now: Date.parse(stamp) + 60_000 }).status, "ok");
}
const state = {};
const completedSlots = await dispatchDue({ now: new Date("2026-11-01T08:00:00Z"), state,
  dispatch: async row => row.file === "fetch-oecd-cli.yml" ? "disabled" : "dispatched" });
assert.ok(completedSlots.some(row => row.file === "slickcharts-monthly.yml" && row.outcome === "dispatched"));
assert.equal(state["fetch-oecd-cli.yml"], undefined, "a disabled workflow is neither enabled nor marked dispatched");
const repeated = await dispatchDue({ now: new Date("2026-11-01T08:00:00Z"), state, dispatch: async () => "disabled" });
assert.ok(repeated.every(row => row.outcome === "disabled"), "completed same-slot dispatches are not repeated");

assert.equal(dueDispatches(new Date("2026-10-11T22:00:00Z")).some((row) => row.file === "fetch-sentiment.yml"), false);
assert.equal(dueDispatches(new Date("2026-10-12T22:00:00Z")).some((row) => row.file === "fetch-sentiment.yml"), true);
assert.equal(dueDispatches(new Date("2026-10-12T01:10:00Z")).some((row) => row.file === "fetch-fenok-private-options.yml"), false);
assert.equal(dueDispatches(new Date("2026-10-13T01:10:00Z")).some((row) => row.file === "fetch-fenok-private-options.yml"), true);

console.log(`external clock slot admission: PASS (${Object.keys(EXTERNAL_CLOCK_CRONS).length} workflows, same-slot/failed/manual/API/pagination/downstream/weekday/monthly/repository transport)`);
