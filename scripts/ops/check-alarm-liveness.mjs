#!/usr/bin/env node
// Who observes the observer. The pipeline alarm excludes itself from its own
// watch list, correctly, because self-monitoring would recurse. That leaves one
// gap: if the alarm itself stops running, nothing says so, and every other
// detector's silence becomes invisible with it. On 2026-08-21 the alarm missed
// two consecutive scheduled slots and survived only because an unrelated
// workflow_run trigger happened to fire it.
//
// This check first used the generated_at stamp in the alarm's incident
// document, on the stated premise that "every run persists it". That premise
// was false. emit-alarm-state.mjs writes the PRIOR document back byte-identical
// when no significant key changed, so the stamp advances when the INCIDENT
// changes, not when the alarm runs. Measured across the 299 persisted commits
// between 2026-07-24T09:38:46Z and 2026-08-21T02:26:20Z, 51 gaps (17.1%)
// exceeded the old 3h ceiling - 237.3h of false staleness in 28 days. The worst
// was 23.8h, on 2026-08-13/14, during which the alarm ran 21 times and every
// single run succeeded.
//
// The ceiling was not widened to cover that: a limit set to whatever would pass
// hides real death. The MEASUREMENT is replaced instead. Liveness now counts the
// alarm's own scheduled slots that passed with no run - the same rule, and the
// same two-slot tolerance, the alarm applies to the detectors it watches.
//
// Scope, stated rather than implied. This counts slots since the alarm's most
// recent run of ANY event, workflow_run included, so it answers "is the alarm
// running at all" and NOT "is the alarm's schedule healthy". Those differ: on
// 2026-08-21 the alarm's scheduled slots were dropped and it survived because an
// unrelated workflow_run fired it, which this check would have called live. That
// is deliberate. Measured the same day, GitHub dropped every hourly slot
// fleet-wide for about two hours - five hourly workflows, zero scheduled runs
// between 23:45Z and 01:45Z - so a schedule-only rule would fire on every hourly
// detector at once on ordinary scheduler weather. Detectors were still being run
// throughout by their workflow_run triggers.
//
// Two properties are deliberate and are asserted by test-alarm-liveness.mjs:
//   - The cadence is read from the alarm's own workflow, never hand-copied, so a
//     reschedule carries this rule with it.
//   - Only node builtins are imported. The slot counter is inlined rather than
//     imported from check-pipeline-job-health.mjs because that module is the
//     machinery this check exists to observe, and because its deep module graph
//     is the same one whose breakage disarmed four lanes on 2026-08-17. The two
//     implementations are bound by an equivalence assertion in the test.
//
// Exit 0 when live, exit 2 when stale, exit 1 when liveness cannot be measured -
// an unmeasurable answer is a fault, never an all-clear.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ALARM_WORKFLOW = "pipeline-failure-alarm.yml";
const GITHUB_API = "https://api.github.com";

// GitHub drops scheduled runs routinely, so one skipped slot is normal and two
// consecutive ones are not. This mirrors the alarm's MISSED_WINDOW_MULTIPLIER.
export const ALARM_MISSED_SLOT_THRESHOLD = 2;

// Read the alarm's declared cadence from the workflow itself. A hand-kept copy
// would keep asserting the old clock after a reschedule.
export function readAlarmCron(repoRoot = REPO_ROOT) {
  const file = path.join(repoRoot, ".github", "workflows", ALARM_WORKFLOW);
  const source = fs.readFileSync(file, "utf8");
  const match = /-\s*cron:\s*'([^']+)'/.exec(source);
  return match ? match[1] : null;
}

// Coarse by design: the question is only "how many hours between slots".
// Must stay equivalent to cronIntervalHours in check-pipeline-job-health.mjs.
function cronIntervalHours(cron) {
  if (typeof cron !== "string") return null;
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [, hour, dayOfMonth, , dayOfWeek] = fields;
  if (dayOfMonth !== "*") return 24 * 31;
  if (dayOfWeek !== "*") return 24 * 7;
  const stepped = /^\*\/(\d+)$/.exec(hour);
  if (stepped) {
    const step = Number(stepped[1]);
    return Number.isFinite(step) && step > 0 ? step : null;
  }
  return hour === "*" ? 1 : 24;
}

// Scheduled instants strictly after `since` and at or before `now`. Counting
// SLOTS rather than elapsed multiples is load-bearing: an elapsed-multiple rule
// passed its own unit test and still missed the 2026-08-21 incident by 0.09h.
// Must stay equivalent to missedSlotCount in check-pipeline-job-health.mjs.
export function countMissedSlots(cron, sinceMs, nowMs) {
  const intervalHours = cronIntervalHours(cron);
  if (intervalHours === null || !Number.isFinite(sinceMs) || !Number.isFinite(nowMs)) return null;
  const fields = cron.trim().split(/\s+/);
  const minute = Number(fields[0]);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  const stepMs = intervalHours * 3_600_000;
  const start = new Date(sinceMs);
  const anchor = Date.UTC(
    start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(),
    start.getUTCHours(), minute, 0, 0,
  );
  let slot = anchor <= sinceMs ? anchor + stepMs : anchor;
  let missed = 0;
  while (slot <= nowMs && missed <= 1000) { missed += 1; slot += stepMs; }
  return missed;
}

export function evaluateAlarmLiveness({ latestRunStartedAt, cron, nowMs = Date.now() } = {}) {
  if (typeof latestRunStartedAt !== "string" || latestRunStartedAt === "") {
    return {
      status: "unreadable",
      reason: "no completed pipeline-alarm run was returned; liveness cannot be measured",
      missed_slots: null,
      age_hours: null,
    };
  }
  const sinceMs = Date.parse(latestRunStartedAt);
  if (!Number.isFinite(sinceMs)) {
    return {
      status: "unreadable",
      reason: `run start is not a timestamp: ${latestRunStartedAt}`,
      missed_slots: null,
      age_hours: null,
    };
  }
  const missed = countMissedSlots(cron, sinceMs, nowMs);
  const ageHours = Number(((nowMs - sinceMs) / 3_600_000).toFixed(2));
  if (missed === null) {
    return {
      status: "unreadable",
      reason: `the alarm cadence could not be read: ${String(cron)}`,
      missed_slots: null,
      age_hours: ageHours,
    };
  }
  if (missed >= ALARM_MISSED_SLOT_THRESHOLD) {
    return {
      status: "stale",
      reason: `the pipeline alarm has passed ${missed} scheduled slots with no run `
        + `(threshold ${ALARM_MISSED_SLOT_THRESHOLD}); last run ${latestRunStartedAt}`,
      missed_slots: missed,
      age_hours: ageHours,
    };
  }
  return { status: "live", reason: null, missed_slots: missed, age_hours: ageHours };
}

async function fetchLatestAlarmRunStart() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return null;
  const url = `${GITHUB_API}/repos/${repo}/actions/workflows/${ALARM_WORKFLOW}/runs`
    + "?status=completed&per_page=1";
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) return null;
  const body = await response.json();
  const run = body?.workflow_runs?.[0];
  return run?.run_started_at || run?.created_at || null;
}

async function main() {
  let latestRunStartedAt = null;
  let cron = null;
  try {
    cron = readAlarmCron();
    latestRunStartedAt = await fetchLatestAlarmRunStart();
  } catch (error) {
    process.stdout.write(JSON.stringify({
      status: "unreadable", reason: error.message, missed_slots: null, age_hours: null,
    }) + "\n");
    process.exitCode = 1;
    return;
  }
  const result = evaluateAlarmLiveness({ latestRunStartedAt, cron });
  process.stdout.write(JSON.stringify(result) + "\n");
  if (result.status === "stale") process.exitCode = 2;
  else if (result.status === "unreadable") process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
