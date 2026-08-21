#!/usr/bin/env node
// Who observes the observer. The pipeline alarm excludes itself from its own
// watch list, correctly, because self-monitoring would recurse. That leaves one
// gap: if the alarm itself stops running, nothing says so, and every other
// detector's silence becomes invisible with it. On 2026-08-21 the alarm missed
// two consecutive scheduled slots and survived only because an unrelated
// workflow_run trigger happened to fire it.
//
// The terminator is the stamp the alarm already writes. Every run persists
// data/admin/alarm-state.json with a generated_at, so an old stamp is direct
// evidence that the alarm has not run. This check reads that file and nothing
// else, so it cannot itself depend on the machinery it is checking.
//
// Exit 0 when live, exit 2 when stale, exit 1 when the state is unreadable —
// an unreadable state is a fault, never an all-clear.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const STATE_PATH = path.join(REPO_ROOT, "data", "admin", "alarm-state.json");

// The alarm runs hourly. Two missed slots is the same tolerance the alarm
// applies to the detectors it watches, plus an hour of scheduling slack.
export const ALARM_MAX_AGE_HOURS = 3;

export function evaluateAlarmLiveness(state, nowMs = Date.now()) {
  const stamp = state?.generated_at;
  if (typeof stamp !== "string") {
    return { status: "unreadable", reason: "alarm-state has no generated_at", age_hours: null };
  }
  const stampMs = Date.parse(stamp);
  if (!Number.isFinite(stampMs)) {
    return { status: "unreadable", reason: `generated_at is not a timestamp: ${stamp}`, age_hours: null };
  }
  const ageHours = (nowMs - stampMs) / 3_600_000;
  if (ageHours > ALARM_MAX_AGE_HOURS) {
    return {
      status: "stale",
      reason: `the pipeline alarm has not run for ${ageHours.toFixed(2)}h against a ${ALARM_MAX_AGE_HOURS}h ceiling`,
      age_hours: Number(ageHours.toFixed(2)),
    };
  }
  return { status: "live", reason: null, age_hours: Number(ageHours.toFixed(2)) };
}

function main() {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch (error) {
    process.stdout.write(JSON.stringify({ status: "unreadable", reason: error.message }) + "\n");
    process.exitCode = 1;
    return;
  }
  const result = evaluateAlarmLiveness(state);
  process.stdout.write(JSON.stringify(result) + "\n");
  if (result.status === "stale") process.exitCode = 2;
  else if (result.status === "unreadable") process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
