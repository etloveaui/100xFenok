#!/usr/bin/env node
// X8: skip a late GitHub fallback only with a successful same-slot A1 receipt.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { externalClockCrons, externalClockSlot, clockCronMatches, workerBudgetJobs } from "../ops/a1-lanes/external-clock.mjs";

export function scheduledSlot(cron, createdAt) {
  const slot = new Date(createdAt);
  if (!Number.isFinite(slot.getTime())) throw new Error("Run creation timestamp is unavailable");
  slot.setUTCSeconds(0, 0);
  // Current admitted calendars are daily or weekday schedules, at most 3 days apart.
  for (let minute = 0; minute < 8 * 1440; minute += 1) {
    if (clockCronMatches(cron, slot)) return slot.toISOString();
    slot.setUTCMinutes(slot.getUTCMinutes() - 1);
  }
  throw new Error("No declared slot in the admitted calendar");
}

export function admissionDecision({ file, eventName, event, currentRun, runs = [] }) {
  const crons = externalClockCrons(file);
  const marked = eventName === "workflow_dispatch" && event.inputs?.external_clock === "a1-v1";
  if (eventName !== "schedule" && !marked) return { skip: false, reason: "ordinary-event" };
  if (!crons.length) throw new Error("Workflow is not admitted to the external clock");
  if (currentRun?.head_branch !== "main") throw new Error("Automatic clock runs require main");
  if (eventName === "schedule" && !crons.includes(event.schedule)) {
    return { skip: false, reason: "github-only-schedule" };
  }
  let slot;
  if (marked) {
    slot = event.inputs.external_clock_slot;
    const proof = { event: "workflow_dispatch", created_at: currentRun.created_at,
      display_title: `external-clock/a1/v1 ${file} ${slot}` };
    if (externalClockSlot({ file, crons }, proof) === null) throw new Error("Invalid external clock slot");
  } else {
    // Pin to run creation, never runner start: a queued run must not borrow a later slot.
    // GitHub supplies cron text but no original scheduled_at field. This is the
    // latest matching scheduled instant at creation; the limitation is explicit.
    slot = scheduledSlot(event.schedule, currentRun.created_at);
  }
  const duplicate = runs.find((run) => String(run.id) !== String(currentRun.id)
    && run.head_branch === "main" && run.status === "completed" && run.conclusion === "success"
    && externalClockSlot({ file, crons }, run) === Date.parse(slot));
  return { skip: Boolean(duplicate), slot, reason: duplicate ? "successful-marked-slot" : "slot-uncovered",
    ...(duplicate ? { evidence_run_id: duplicate.id } : {}) };
}

export function sourceWasClockNoop(jobs) {
  if (!Array.isArray(jobs) || !jobs.length) throw new Error("Source jobs are unreadable");
  const gate = jobs.find((job) => job.name === "clock-admission");
  const producers = jobs.filter((job) => job.name !== "clock-admission");
  return gate?.conclusion === "success" && producers.length > 0
    && producers.every((job) => job.conclusion === "skipped");
}

export function checkAdmission({ file, eventName, event, runId, repository, api }) {
  const marked = eventName === "workflow_dispatch" && event.inputs?.external_clock === "a1-v1";
  if (eventName === "workflow_run" && file === "coordinate-computed-signals.yml") {
    const sourceId = event.workflow_run?.id;
    if (!Number.isSafeInteger(sourceId)) throw new Error("Missing source run ID");
    const payload = api(`repos/${repository}/actions/runs/${sourceId}/jobs?per_page=100`);
    if (payload.total_count > 100) throw new Error("Source job page is incomplete");
    return { skip: sourceWasClockNoop(payload.jobs), reason: "source-clock-noop-check" };
  }
  if (eventName !== "schedule" && !marked) return { skip: false, reason: "ordinary-event" };
  const currentRun = api(`repos/${repository}/actions/runs/${runId}`);
  const initial = admissionDecision({ file, eventName, event, currentRun });
  if (!initial.slot) return initial;
  const params = new URLSearchParams({ event: "workflow_dispatch", branch: "main", status: "success",
    created: `>=${initial.slot}`, per_page: "100" });
  for (let page = 1; page <= 10; page += 1) {
    const payload = api(`repos/${repository}/actions/workflows/${file}/runs?${params}&page=${page}`);
    if (!Array.isArray(payload.workflow_runs)) throw new Error("Marked run history is unreadable");
    const result = admissionDecision({ file, eventName, event, currentRun, runs: payload.workflow_runs });
    if (result.skip || payload.workflow_runs.length < 100) return result;
  }
  throw new Error("Marked run history exceeds the bounded lookup");
}

function main() {
  const file = process.argv[2];
  const eventName = process.env.GITHUB_EVENT_NAME;
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  let result;
  try {
    result = checkAdmission({ file, eventName, event, runId: process.env.GITHUB_RUN_ID,
      repository: process.env.GITHUB_REPOSITORY,
      api: (endpoint) => JSON.parse(execFileSync("gh", ["api", endpoint],
        { encoding: "utf8", timeout: 20_000, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })) });
  } catch (error) {
    // API uncertainty must not suppress the fallback collection. Invalid marked
    // inputs are configuration errors and must not execute an unintended slot.
    if (eventName === "workflow_dispatch" && event.inputs?.external_clock === "a1-v1") throw error;
    console.error(`::warning::Clock duplicate evidence unavailable; preserving fallback: ${error.message}`);
    result = { skip: false, reason: "evidence-unavailable" };
  }
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `skip=${result.skip}\n`);
  if (file === "worker-request-budget-alarm.yml") {
    const jobs = workerBudgetJobs(eventName, event);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `check_budget=${jobs.requests}\ncheck_telemetry=${jobs.telemetry}\n`);
  }
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
