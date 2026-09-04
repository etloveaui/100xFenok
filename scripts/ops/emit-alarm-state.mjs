#!/usr/bin/env node
/**
 * Emit data/admin/alarm-state.json (#365 P3) from the pipeline-job-health result,
 * on BOTH firing and quiet-success resolution, so the owner dashboard can read
 * "is any alarm open" without opening GitHub Actions.
 *
 * The emitter and OPS issue reporting are non-best-effort, so their machinery
 * failures turn the run red. The later alarm-state Git commit is best-effort and
 * can never mask the issue channel (spec P3 constraint). This script computes/
 * writes the state file and publishes its transition outputs.
 *
 * Content is public-safe by construction: GitHub run ids, workflow FILE basenames,
 * actions run URLs, and our own issue title — no store roots, private paths, or
 * secrets. Enforced by test-emit-alarm-state.mjs.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ALARM_STATE_SCHEMA = "alarm-state/v1";
// The one family with a D3 aging policy. Scoped deliberately: this document
// stays a workflow-health surface, not a per-family data catalogue.
export const ETF_FRESHNESS_FAMILY = "stockanalysis-etf-detail";
const CADENCE_STATES = Object.freeze(["not_due", "overdue", "recovered", "no_declaration", "unknown"]);
const PUBLIC_CADENCE_EVIDENCE = new Set(["suspected_skip", "attempt_gap"]);

function isoNow(now) {
  return now instanceof Date ? now.toISOString() : new Date().toISOString();
}

// Sorted unique lane ids carried on a workflow row's lane_outcome detail.
// Anything else on the detail (decisions, run ids, source clocks) stays in the
// private operator alarm; the published state names only the lane.
function laneOutcomeLanes(workflow) {
  const detail = workflow?.lane_outcome;
  if (!Array.isArray(detail)) return [];
  return [...new Set(detail.map((entry) => entry?.lane_id).filter((lane) => typeof lane === "string"))].sort();
}

// Which lanes still need an OPS-issue notification today. Pure: the notified
// map ({lane: YYYY-MM-DD}) and the current lanes in, the due lanes out. A lane
// notified earlier today is suppressed; tomorrow it is due again — lane+day
// one-report-a-day with no workflow change. An unreadable day fails silent
// (nothing due) rather than paging every run.
export function laneNotificationsDue({ notified = {}, lanes = [], day = null } = {}) {
  if (typeof day !== "string" || day.length === 0) return [];
  const seen = notified && typeof notified === "object" ? notified : {};
  return [...new Set(lanes)].filter((lane) => seen[lane] !== day).sort();
}

// Pure: (health result, prior state, env, now) -> next alarm state.
export function buildAlarmState({ health, prior = null, env = {}, now = new Date() } = {}) {
  const at = isoNow(now);
  const workflows = Array.isArray(health?.workflows) ? health.workflows : [];
  const alarming = workflows.filter((w) => w?.status === "alarm");
  const healthStatus = health?.status ?? "unknown";
  const status = healthStatus === "alarm" ? "open" : healthStatus === "ok" ? "clear" : "unknown";

  // evaluateWorkflow (check-pipeline-job-health.mjs) returns firstFailingRunId
  // and firstFailingRunUrl at the TOP LEVEL of the workflow object. Reading only
  // `w.alarm?.*` meant production always emitted null here while the OPS issue
  // body, built from the same evaluator, printed the run id correctly. The nested
  // read is kept as a fallback so any caller still passing that shape keeps
  // working, but top level wins because that is what the producer emits.
  const openIncidents = alarming.map((w) => ({
    workflow: w.file ?? null,
    label: w.label ?? w.name ?? w.file ?? null,
    streak: typeof w.streak === "number" ? w.streak : null,
    failure_streak_threshold: w.failure_streak_threshold === 1 ? 1 : 2,
    first_failing_run_id: w.firstFailingRunId ?? w.alarm?.firstFailingRunId ?? null,
    first_failing_run_url: w.firstFailingRunUrl ?? w.alarm?.firstFailingRunUrl ?? null,
    alarm_reasons: Array.isArray(w.alarm_reasons) ? [...new Set(w.alarm_reasons)].sort() : [],
    // Lane ids only — never shard paths, workflow paths, or record payloads.
    lane_outcome_lanes: laneOutcomeLanes(w),
    lost_schedule_slot_count: Number.isInteger(w.lost_schedule_slot_count)
      ? w.lost_schedule_slot_count
      : 0,
    cadence_status: CADENCE_STATES.includes(w?.cadence_status) ? w.cadence_status : "unknown",
  }));

  // A run the API could not classify is a real state, and going from one unknown
  // workflow to several is a deterioration. Without recording WHICH workflows are
  // unknown, those transitions compare equal and would be silently deduped.
  const unknownWorkflows = workflows
    .filter((w) => w?.status !== "alarm" && w?.status !== "ok")
    .map((w) => ({ workflow: w?.file ?? null, status: w?.status ?? null }))
    .sort((a, b) => String(a.workflow).localeCompare(String(b.workflow)));
  const excludedWorkflows = Array.isArray(health?.excluded)
    ? health.excluded
      .map((row) => ({
        file: row?.file ?? null,
        label: row?.label ?? row?.file ?? null,
        reason: row?.reason ?? null,
      }))
      .sort((a, b) => String(a.file).localeCompare(String(b.file)))
    : [];
  // Queue eviction evidence remains visible by workflow. A scheduled lost slot
  // pages through `lost_schedule_slot`; an observer/manual eviction alone does
  // not. Counts only, sorted, no raw run evidence.
  const queueEvictedWorkflows = workflows
    .map((w) => ({
      workflow: w?.file ?? null,
      count: Array.isArray(w?.queue_evicted_run_urls) ? w.queue_evicted_run_urls.length : 0,
    }))
    .filter((row) => row.count > 0)
    .sort((a, b) => String(a.workflow).localeCompare(String(b.workflow)));
  const queueEvictedRunCount = queueEvictedWorkflows.reduce((sum, row) => sum + row.count, 0);
  const cadence_state_counts = Object.fromEntries(CADENCE_STATES.map((state) => [state, 0]));
  // The only public artifact whose values derive from the private
  // publish-outcome shard. Two fields for the one family with a D3 policy: the
  // derived state, and its age at write time — a duration, not a point in time.
  // Not published: timestamps, the failure counter, paths, run ids, raw
  // evidence. The exact last-success time stays in the private operator alarm.
  const publishedFreshness = (workflow) => {
    const outcome = workflow?.plane_publish_outcome ?? null;
    if (outcome?.family !== ETF_FRESHNESS_FAMILY) return {};
    const freshness = outcome?.freshness ?? null;
    if (!freshness || typeof freshness.state !== "string") return {};
    return {
      data_freshness_state: freshness.state,
      data_freshness_age_hours_at_generation: freshness.source_age_hours === null
        ? null
        : Math.round(freshness.source_age_hours),
    };
  };

  const watchedWorkflows = workflows.map((w) => {
    const cadence_status = CADENCE_STATES.includes(w?.cadence_status) ? w.cadence_status : "unknown";
    cadence_state_counts[cadence_status] += 1;
    return {
      file: w.file ?? null,
      label: w.label ?? w.name ?? null,
      events: Array.isArray(w.events) ? w.events : (w.event ? [w.event] : []),
      event: w.event ?? (w.events?.length === 1 ? w.events[0] : null),
      failure_streak_threshold: w.failure_streak_threshold === 1 ? 1 : 2,
      cadence_status,
      // Preserve the existing point-in-time uncertainty vocabulary without
      // publishing cron strings, paths, timestamps, or raw run evidence.
      cadence_evidence: Array.isArray(w?.cadence_evidence)
        ? [...new Set(w.cadence_evidence.filter((value) => PUBLIC_CADENCE_EVIDENCE.has(value)))].sort()
        : [],
      ...publishedFreshness(w),
    };
  });

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

  // last_resolved_at: stamp an alarm/uncertain -> clear transition; otherwise preserve.
  let lastResolvedAt = prior?.last_resolved_at ?? null;
  if (status === "clear" && ["open", "unknown", "blind"].includes(prior?.status)) lastResolvedAt = at;

  // Lane+day notification ledger: carry the prior map, then stamp every lane
  // open in this run with today. The identity projection below compares the
  // still-due set, so an unchanged lane notifies once per day.
  const today = at.slice(0, 10);
  const laneOutcomeNotified = { ...(prior?.lane_outcome_notified ?? {}) };
  for (const incident of openIncidents) {
    for (const lane of incident.lane_outcome_lanes ?? []) {
      laneOutcomeNotified[lane] = today;
    }
  }

  return {
    schema_version: ALARM_STATE_SCHEMA,
    generated_at: at,
    status,
    open_incident_count: openIncidents.length,
    open_incidents: openIncidents,
    lane_outcome_notified: laneOutcomeNotified,
    watched_workflows: watchedWorkflows,
    cadence_state_counts,
    excluded_workflows: excludedWorkflows,
    unknown_workflows: unknownWorkflows,
    queue_evicted_run_count: queueEvictedRunCount,
    queue_evicted_workflows: queueEvictedWorkflows,
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
  "lane_outcome_notified",
  "watched_workflows",
  "cadence_state_counts",
  "excluded_workflows",
  "unknown_workflows",
  "queue_evicted_run_count",
  "queue_evicted_workflows",
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
 * green when emission and reporting succeed, and the OPS issue is still the
 * primary channel; only the redundant commit is suppressed.
 */
export function alarmStateUnchanged(prior, next) {
  const a = significantAlarmState(prior);
  return a !== null && a === significantAlarmState(next);
}

// The persisted document carries operator-useful detail that changes while one
// incident remains open: counters, ages, run evidence, and watch policy. Keep
// those changes for state/body refresh, but do not use them to notify an issue
// commenter. An incident identity is the workflow plus its reason set. Unknown
// workflows are included because a change in alarm blindness is operator-visible.
function incidentIdentityProjection(state) {
  if (!state || typeof state !== "object") return null;
  const openIncidents = Array.isArray(state.open_incidents)
    ? state.open_incidents
      .map((incident) => ({
        workflow: incident?.workflow ?? null,
        alarm_reasons: Array.isArray(incident?.alarm_reasons)
          ? [...new Set(incident.alarm_reasons)].sort()
          : [],
        lane_outcome_lanes: Array.isArray(incident?.lane_outcome_lanes)
          ? [...new Set(incident.lane_outcome_lanes)].sort()
          : [],
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    : [];
  const unknownWorkflows = Array.isArray(state.unknown_workflows)
    ? state.unknown_workflows
      .map((workflow) => ({
        workflow: workflow?.workflow ?? null,
        status: workflow?.status ?? null,
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    : [];
  const healthUncertain = state.status === "unknown" || state.status === "blind";
  if (openIncidents.length === 0 && unknownWorkflows.length === 0 && !healthUncertain) return null;
  // Lane+day one-report-a-day: a lane already notified today compares equal
  // (comment suppressed); at midnight it becomes due again (comment fires).
  // Without a readable generation day this degrades to no lane signal rather
  // than a notification on every run.
  const day = typeof state.generated_at === "string" && state.generated_at.length >= 10
    ? state.generated_at.slice(0, 10)
    : null;
  const notified = state.lane_outcome_notified && typeof state.lane_outcome_notified === "object"
    ? state.lane_outcome_notified
    : {};
  const laneNotificationsDueToday = day === null ? [] : laneNotificationsDue({
    notified,
    lanes: openIncidents.flatMap((incident) => incident.lane_outcome_lanes),
    day,
  });
  return {
    open_incidents: openIncidents,
    unknown_workflows: unknownWorkflows,
    health_uncertain: healthUncertain,
    lane_notifications_due: laneNotificationsDueToday,
  };
}

/**
 * Compare only the identities that should trigger a new OPS issue comment.
 * Full alarm-state equality remains owned by alarmStateUnchanged so counters,
 * ages, run evidence, and policy changes still persist and refresh the body.
 * Resolution has its own output and must not be reported as a new incident.
 */
export function incidentIdentitiesChanged(prior, next) {
  if (next?.status === "clear") return false;

  const nextProjection = incidentIdentityProjection(next);
  const priorProjection = incidentIdentityProjection(prior);
  if (JSON.stringify(priorProjection) !== JSON.stringify(nextProjection)) return true;
  // Lane+day rollover: buildAlarmState stamps the new state's own ledger at
  // build time, so the next projection's own due set always reads empty. The
  // day boundary is visible only against the PRIOR ledger — a lane whose last
  // notification is an older day is due again even though nothing else moved.
  const nextDay = typeof next?.generated_at === "string" && next.generated_at.length >= 10
    ? next.generated_at.slice(0, 10)
    : null;
  const nextLanes = Array.isArray(next?.open_incidents)
    ? next.open_incidents.flatMap((incident) => Array.isArray(incident?.lane_outcome_lanes)
      ? incident.lane_outcome_lanes
      : [])
    : [];
  return laneNotificationsDue({
    notified: prior?.lane_outcome_notified,
    lanes: nextLanes,
    day: nextDay,
  }).length > 0;
}

/**
 * True when an open alarm or an uncertain/blind read recovers to clear, so the
 * recovery can be ANNOUNCED and not merely recorded. `buildAlarmState` already
 * stamps `last_resolved_at`, but the alarm's notification channel is gated on
 * the failing path, which means the OPS issue collects alerts and is never told
 * the incident ended; a reader cannot separate a live outage from a finished one.
 *
 * A first-ever clear run (no prior document) has nothing to announce.
 */
export function alarmStateResolved(prior, next) {
  return ["open", "unknown", "blind"].includes(prior?.status) && next?.status === "clear";
}

export function writeAlarmStateMirrors({ state, outPath, publicOutPath }) {
  const json = `${JSON.stringify(state, null, 2)}\n`;
  // Public mirror is boundary-owned (#377 slice 2); write canonical only.
  const targets = [outPath, publicOutPath].filter(Boolean);
  for (const target of targets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, json);
  }
  return json;
}

export function writeWorkflowOutputs({ outputPath, incidentChanged, incidentResolved }) {
  fs.appendFileSync(outputPath, `incident_changed=${incidentChanged}\n`);
  fs.appendFileSync(outputPath, `incident_resolved=${incidentResolved}\n`);
}

function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(__dirname, "..", "..");
  const healthPath = process.env.PIPELINE_JOB_HEALTH_RESULT || "pipeline-job-health-result.json";
  const outPath = path.join(repoRoot, "data", "admin", "alarm-state.json");

  const health = readJson(healthPath) ?? { status: "unknown", workflows: [] };
  const prior = readJson(outPath);
  const state = buildAlarmState({ health, prior, env: process.env, now: new Date() });

  const unchanged = alarmStateUnchanged(prior, state);
  const emitted = unchanged ? prior : state;
  writeAlarmStateMirrors({ state: emitted, outPath });
  // Published separately from full state equality: the latest state remains
  // available for body refresh, while only identity changes notify the issue.
  const incidentChanged = incidentIdentitiesChanged(prior, state) ? "true" : "false";
  // Published alongside `incident_changed` so the notification channel can post an
  // all-clear instead of leaving the OPS issue reading as a live outage forever.
  // The workflow consumes this output on its all-clear path.
  const incidentResolved = alarmStateResolved(prior, emitted) ? "true" : "false";
  if (process.env.GITHUB_OUTPUT) {
    // Output publication is machinery, not best-effort persistence: without
    // these values the workflow cannot safely report a new incident or recovery.
    // Let any write failure reject the emitter step directly; later reporting
    // and persistence remain skipped by GitHub's default success semantics.
    writeWorkflowOutputs({
      outputPath: process.env.GITHUB_OUTPUT,
      incidentChanged,
      incidentResolved,
    });
  }

  const suffix = unchanged
    ? " (unchanged incident: prior document preserved, no commit expected)"
    : "";
  console.log(`alarm-state: status=${emitted.status} open=${emitted.open_incident_count} incident_changed=${incidentChanged} -> data/admin/alarm-state.json (+ public mirror)${suffix}`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
