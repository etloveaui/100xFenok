#!/usr/bin/env node
/**
 * Emit data/admin/alarm-state.json (#365 P3) from the pipeline-job-health result,
 * on BOTH firing and quiet-success resolution, so the owner dashboard can read
 * "is any alarm open" without opening GitHub Actions.
 *
 * The alarm-state commit must NEVER mask the alarm itself: the workflow runs this
 * with continue-on-error and keeps the OPS issue + job failure as the primary
 * channel (spec P3 constraint). This script only computes/writes the state file.
 *
 * Content is public-safe by construction: GitHub run ids, workflow FILE basenames,
 * actions run URLs, and our own issue title — no store roots, private paths, or
 * secrets. Enforced by test-emit-alarm-state.mjs.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ALARM_STATE_SCHEMA = "alarm-state/v1";

function isoNow(now) {
  return now instanceof Date ? now.toISOString() : new Date().toISOString();
}

// Pure: (health result, prior state, env, now) -> next alarm state.
export function buildAlarmState({ health, prior = null, env = {}, now = new Date() } = {}) {
  const at = isoNow(now);
  const workflows = Array.isArray(health?.workflows) ? health.workflows : [];
  const alarming = workflows.filter((w) => w?.status === "alarm");
  const healthStatus = health?.status ?? "unknown";
  const status = healthStatus === "alarm" ? "open" : healthStatus === "ok" ? "clear" : "unknown";

  const openIncidents = alarming.map((w) => ({
    workflow: w.file ?? null,
    label: w.label ?? w.name ?? w.file ?? null,
    streak: typeof w.streak === "number" ? w.streak : null,
    first_failing_run_id: w.alarm?.firstFailingRunId ?? null,
    first_failing_run_url: w.alarm?.firstFailingRunUrl ?? null,
  }));

  const runId = env.GITHUB_RUN_ID ? String(env.GITHUB_RUN_ID) : null;
  const runUrl = runId && env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY
    ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${runId}`
    : null;

  // last_firing: refresh only when currently open; otherwise preserve history.
  const lastFiring = status === "open"
    ? {
        run_id: runId,
        run_url: runUrl,
        observed_at: at,
        event: env.GITHUB_EVENT_NAME ?? null,
        workflows: alarming.map((w) => w.file ?? null),
        title: health?.issueTitle ?? null,
      }
    : (prior?.last_firing ?? null);

  // last_resolved_at: stamp the transition open -> clear; otherwise preserve.
  let lastResolvedAt = prior?.last_resolved_at ?? null;
  if (status === "clear" && prior?.status === "open") lastResolvedAt = at;

  return {
    schema_version: ALARM_STATE_SCHEMA,
    generated_at: at,
    status,
    open_incident_count: openIncidents.length,
    open_incidents: openIncidents,
    watched_workflows: workflows.map((w) => ({ file: w.file ?? null, label: w.label ?? w.name ?? null })),
    last_firing: lastFiring,
    last_resolved_at: lastResolvedAt,
  };
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

// Everything the alarm actually asserts. `generated_at` and `last_firing` are
// excluded because they describe the RUN that reported, not the incident.
const ALARM_STATE_SIGNIFICANT_KEYS = Object.freeze([
  "schema_version",
  "status",
  "open_incident_count",
  "open_incidents",
  "watched_workflows",
  "last_resolved_at",
]);

function significantAlarmState(state) {
  if (!state || typeof state !== "object") return null;
  return JSON.stringify(Object.fromEntries(
    ALARM_STATE_SIGNIFICANT_KEYS.map((key) => [key, state[key] ?? null]),
  ));
}

/**
 * An unresolved incident is re-reported on every trigger, and each report used to
 * rewrite `generated_at` and `last_firing` with the reporting run's identity. That
 * is a real content change, so the workflow committed it every time: 14 commits to
 * origin/main on 2026-07-22 alone, all carrying the identical incident. Comparing
 * consecutive commits showed the ONLY deltas were those two fields.
 *
 * When nothing the alarm asserts has moved, keep the prior document byte-identical
 * so git produces no commit at all. Every state transition still writes: a new
 * incident, a changed streak, a different first-failing run, a workflow entering or
 * leaving the watch list, and resolution. `last_firing` then means "the firing that
 * established the current state", which is more useful than "the last time we
 * repeated ourselves".
 *
 * This deliberately does NOT touch the alarm's firing path. The job still exits
 * non-zero and the OPS issue is still the primary channel; only the redundant
 * commit is suppressed.
 */
export function alarmStateUnchanged(prior, next) {
  const a = significantAlarmState(prior);
  return a !== null && a === significantAlarmState(next);
}

function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(__dirname, "..", "..");
  const healthPath = process.env.PIPELINE_JOB_HEALTH_RESULT || "pipeline-job-health-result.json";
  const outPath = path.join(repoRoot, "data", "admin", "alarm-state.json");
  const publicOutPath = path.join(repoRoot, "100xfenok-next", "public", "data", "admin", "alarm-state.json");

  const health = readJson(healthPath) ?? { status: "unknown", workflows: [] };
  const prior = readJson(outPath);
  const state = buildAlarmState({ health, prior, env: process.env, now: new Date() });

  const unchanged = alarmStateUnchanged(prior, state);
  const emitted = unchanged ? prior : state;
  const json = `${JSON.stringify(emitted, null, 2)}\n`;
  for (const target of [outPath, publicOutPath]) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, json);
  }
  const suffix = unchanged
    ? " (unchanged incident: prior document preserved, no commit expected)"
    : "";
  console.log(`alarm-state: status=${emitted.status} open=${emitted.open_incident_count} -> data/admin/alarm-state.json (+ public mirror)${suffix}`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
