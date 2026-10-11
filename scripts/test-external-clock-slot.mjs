#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { admissionDecision, scheduledSlot, checkAdmission, sourceWasClockNoop } from "./check-external-clock-slot.mjs";
import { EXTERNAL_CLOCK_CRONS, externalClockCrons, dueDispatches } from "../ops/a1-lanes/external-clock.mjs";
import { deriveWorkflowWatchPolicy, evaluateExternalClock, evaluateWorkflow } from "./ops/check-pipeline-job-health.mjs";

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
  event: { schedule: "17 2,14 * * *" } }).reason, "github-only-schedule");

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
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

const watched = deriveWorkflowWatchPolicy({ scheduledExclusions: {} }).watched;
const start = Date.parse("2026-10-12T00:00:00Z");
const end = start + 7 * 86400_000;
const slots = new Map(Object.keys(EXTERNAL_CLOCK_CRONS).map((key) => [key, []]));
const clockInstants = new Set();
for (let stamp = start; stamp < end; stamp += 60_000) {
  for (const row of dueDispatches(new Date(stamp))) {
    slots.get(row.file).push(row.slot);
    clockInstants.add(stamp);
  }
}
for (const [workflowFile, members] of slots) {
  assert.ok(members.length >= 3, `${workflowFile}: week must contain >=3 slots`);
  const workflow = watched.find((row) => row.file === workflowFile);
  assert.ok(workflow, `${workflowFile}: included in health observation`);
  for (const cron of externalClockCrons(workflowFile)) assert.ok(workflow.crons.includes(cron));
  const markedRun = { ...success, created_at: members[0], run_started_at: members[0],
    display_title: `external-clock/a1/v1 ${workflowFile} ${members[0]}` };
  const now = Date.parse(members[3] ?? members[2]) + 1;
  const stale = evaluateExternalClock(workflow, [markedRun, { event: "schedule", created_at: new Date(now).toISOString(), conclusion: "success" }], { now });
  assert.equal(stale.status, "alarm", `${workflowFile}: GitHub fallback cannot mask 3 missed clock slots`);
  const queued = { ...markedRun, status: "queued", conclusion: null,
    created_at: members[3], display_title: `external-clock/a1/v1 ${workflowFile} ${members[3]}` };
  assert.equal(evaluateExternalClock(workflow, [queued], { now }).missed_clock_slot_count, 0);
  if (!["pins-autosync.yml", "pipeline-failure-alarm.yml"].includes(workflowFile)) {
    const completed = { ...queued, status: "completed", conclusion: "success", run_started_at: members[3] };
    assert.equal(evaluateWorkflow(workflow, [completed], { now }).missed_schedule_slot_count, 0,
      `${workflowFile}: actual watched policy counts a marked scheduled slot`);
    assert.equal(evaluateWorkflow(workflow, [markedRun], { now }).alarming, true,
      `${workflowFile}: missed slots fire under actual watched policy`);
  }
  const yaml = fs.readFileSync(new URL(`../.github/workflows/${workflowFile}`, import.meta.url), "utf8");
  assert.ok(yaml.includes(`node scripts/check-external-clock-slot.mjs ${workflowFile}`));
  const jobs = yaml.slice(yaml.indexOf("\njobs:\n")).split(/^  (?=[A-Za-z][\w-]*:\s*$)/m).slice(1);
  for (const job of jobs) {
    if (job.startsWith("clock-admission:")) continue;
    assert.match(job, /needs:.*clock-admission/, `${workflowFile}: downstream needs admission`);
    assert.match(job, /needs\.clock-admission\.outputs\.skip != 'true'/, `${workflowFile}: every downstream job honors no-op`);
  }
}
assert.equal(dueDispatches(new Date("2026-10-11T22:00:00Z")).some((row) => row.file === "fetch-sentiment.yml"), false);
assert.equal(dueDispatches(new Date("2026-10-12T22:00:00Z")).some((row) => row.file === "fetch-sentiment.yml"), true);
assert.equal(dueDispatches(new Date("2026-10-12T01:10:00Z")).some((row) => row.file === "fetch-fenok-private-options.yml"), false);
assert.equal(dueDispatches(new Date("2026-10-13T01:10:00Z")).some((row) => row.file === "fetch-fenok-private-options.yml"), true);

// Compare the actual systemd calendar parser's emitted week against clock due slots.
const timer = fs.readFileSync(new URL("../ops/a1-lanes/feno-a1-external-clock.timer", import.meta.url), "utf8");
const timerInstants = new Set();
for (const [, calendar] of timer.matchAll(/^OnCalendar=(.+)$/gm)) {
  const output = execFileSync("systemd-analyze", ["calendar", "--base-time=2026-10-11 23:59:59 UTC", "--iterations=1800", calendar],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  for (const [, stamp] of output.matchAll(/\b(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) UTC/g)) {
    const ms = Date.parse(stamp.replace(" ", "T") + "Z");
    if (ms >= start && ms < end) timerInstants.add(ms);
  }
}
assert.ok(timerInstants.size > 1000, "actual systemd output must be parsed");
assert.deepEqual([...timerInstants].sort(), [...clockInstants].sort(), "timer fires at exactly the declared union, including weekdays and multiple slots");
console.log(`external clock slot admission: PASS (${slots.size} workflows, same-slot/failed/manual/API/pagination/downstream/weekday/fire/timer-week parity)`);
