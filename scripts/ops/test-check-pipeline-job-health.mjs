import { EXTERNAL_CLOCK_CRONS, externalClockEvent } from "../../ops/a1-lanes/external-clock.mjs";
import assert from "node:assert/strict";
import { buildAlarmState, alarmStateResolved, writeWorkflowOutputs } from "./emit-alarm-state.mjs";
import { canonicalJson } from "../lib/json-canonical.mjs";
import { sha256Bytes, sha256Canonical } from "../lib/cloud-data-plane-generation.mjs";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeSourceHealth, detailSourcePolicy } from "../lib/family-health.mjs";
import {
  NON_SCHEDULED_WORKFLOW_INCLUSIONS,
  SCHEDULED_WORKFLOW_EXCLUSIONS,
  buildIssueBody,
  buildWorkflowRunsUrl,
  coalesceSlots,
  computeFailureStreak,
  declaredSlotKey,
  deriveFailureStreakThreshold,
  deriveWorkflowWatchPolicy,
  QUEUE_EVICTION_INSPECTION_LIMIT,
  annotateQueueEvictions,
  classifyKpiGenerationStoppage,
  evaluateWorkflow,
  fetchKpiGenerationSnapshots,
  fetchRetentionSweepHealth,
  isQueueEvictedRun,
  mergeWorkflowRunBatches,
  needsMissedWindowReverification,
  parseWorkflowRunsPayload,
} from "./check-pipeline-job-health.mjs";

// Exercise the production detector/emitter functions without touching canonical state.
function proveAlarmTransition(label, openHealth, clearHealth, body, expected) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "alarm-transition-"));
  try {
    assert.match(body, expected);
    const open = buildAlarmState({ health: openHealth });
    const clear = buildAlarmState({ health: clearHealth, prior: open });
    assert.equal(open.status, "open");
    assert.equal(clear.status, "clear");
    assert.equal(alarmStateResolved(open, clear), true);
    const outputPath = path.join(temp, "github-output");
    writeWorkflowOutputs({ outputPath, incidentChanged: true, incidentResolved: alarmStateResolved(open, clear) });
    assert.match(fs.readFileSync(outputPath, "utf8"), /incident_resolved=true/);
    console.log(`PROOF ${label} open: ${JSON.stringify(open.open_incidents)} / clear: ${clear.status} incident_resolved=true`);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

// ETF rotation lag is in-band until the shared 80% floor or a member's
// existing expiry bound is breached. BLSG must not disappear in the ratio.
{
  const priorAt = "2026-10-24T10:00:00Z", latestAt = "2026-10-24T11:00:00Z";
  const row = (fresh, total, expired = 0) => ({ set: "stockanalysis_etf_detail", status: "delayed",
    fresh_members: fresh, total_members: total, source_health: { counts: { expired } },
    newest_source_date: "2026-10-23", latest_attempt: { observed_at: priorAt, outcome: "retained" },
    outcome_state: { attempt_at: priorAt, source_as_of: "2026-10-23", consecutive_retained: 3, unchanged_source_attempts: 3 } });
  const classify = value => classifyKpiGenerationStoppage([
    { generated_at: latestAt, sets: [value] }, { generated_at: priorAt, sets: [value] },
  ], { now: Date.parse("2026-10-24T11:01:00Z"), crons: ["0 10,11 * * *"] });
  assert.equal(classify(row(1482, 1494)).status, "ok", "12 stale members are inside the existing band");
  assert.equal(classify(row(80, 100)).status, "ok", "80% is in-band, including retained/unchanged attempts");
  assert.ok(classify(row(79, 100)).outcome_alarms[0].reasons.includes("member_ratio_low"));

  const policy = detailSourcePolicy("BLSG", { schema_version: "etf-detail-rotation/v1",
    core_tickers: ["BLSG"], tier2_tickers: [] }, 14);
  const source = "2026-10-16T00:00:00Z";
  const expiry = Date.parse(source) + policy.emergency_lkg_ttl_days * 86400_000;
  const members = [{ member: "BLSG", source_as_of: source, refresh_policy: policy },
    ...Array.from({ length: 99 }, (_, i) => ({ member: `F${i}`, source_as_of: new Date(expiry).toISOString(), refresh_policy: policy }))];
  const within = summarizeSourceHealth(members, new Date(expiry).toISOString(), policy);
  const expired = summarizeSourceHealth(members, new Date(expiry + 1).toISOString(), policy);
  assert.equal(within.counts.expired, 0);
  assert.equal(expired.counts.expired, 1);
  assert.equal(expired.oldest_source_member, "BLSG");
  const snapshot = at => ({ generated_at: at, sets: [{ set: "stockanalysis_etf_detail", status: "delayed",
    fresh_members: expired.fresh_members, total_members: expired.total_members, source_health: expired }] });
  const result = classifyKpiGenerationStoppage([
    snapshot(new Date(expiry + 2000).toISOString()), snapshot(new Date(expiry + 1000).toISOString()),
  ], { now: expiry + 3000, crons: ["0 0 * * *"] });
  assert.deepEqual(result.outcome_alarms[0].reasons, ["member_ratio_low"], "one expired member alarms despite 99% fresh");
  const recovery = classify(row(1482, 1494));
  proveAlarmTransition("ETF detail band recovery", { status: "alarm", data_health_kpi: result },
    { status: "ok", data_health_kpi: recovery }, buildIssueBody([{ kpi_outcome_alarms: result.outcome_alarms }]), /member_ratio_low/);
}

{
  const snapshot = (at, fresh) => ({ generated_at: at, sets: [{ set: "member_fixture",
    status: fresh === 1495 ? "fresh" : "delayed", fresh_members: fresh, total_members: 1495 }] });
  const previous = snapshot("2026-10-23T10:00:00Z", 1461);
  const options = { now: Date.parse("2026-10-23T11:01:00Z"), crons: ["0 10,11 * * *"] };
  const open = classifyKpiGenerationStoppage([snapshot("2026-10-23T11:00:00Z", 1461), previous], options);
  assert.deepEqual(open.outcome_alarms[0].reasons, ["member_ratio_low"]);
  const clear = classifyKpiGenerationStoppage([snapshot("2026-10-23T11:00:00Z", 1495), previous], options);
  assert.equal(clear.status, "ok");
  const body = buildIssueBody([{ kpi_stopped_sets: open.stopped_sets, kpi_outcome_alarms: open.outcome_alarms }]);
  proveAlarmTransition("15a/member_ratio_low", { status: "alarm", data_health_kpi: open },
    { status: "ok", data_health_kpi: clear }, body, /Members inside bound: 1461\/1495/);
}

{
  const workflow = deriveWorkflowWatchPolicy().watched.find(row => row.file === "fetch-yahoo-ticker.yml");
  const run = (hour, conclusion) => {
    const slot = `2026-10-23T${String(hour).padStart(2, "0")}:05:00.000Z`;
    return { id: hour, event: "workflow_dispatch", status: "completed", conclusion,
      created_at: slot, run_started_at: slot, html_url: `https://example.invalid/run/${hour}`,
      display_title: `external-clock/a1/v1 ${workflow.file} ${slot}` };
  };
  const failures = [run(11, "failure"), run(10, "failure")];
  const open = evaluateWorkflow(workflow, failures, { now: Date.parse("2026-10-23T11:06:00Z") });
  assert.equal(open.streak, 2);
  assert.deepEqual(open.alarm_reasons, ["failure_streak"]);
  const options = { now: Date.parse("2026-10-23T12:06:00Z") };
  const manual = evaluateWorkflow(workflow, [{ ...run(12, "success"), display_title: "Human dispatch" }, ...failures], options);
  assert.equal(manual.status, "alarm", "unmarked manual success cannot clear automatic failures");
  assert.equal(manual.recovery_pending_next_scheduled_run, true);
  const clear = evaluateWorkflow(workflow, [run(12, "success"), ...failures], options);
  assert.equal(clear.streak, 0);
  proveAlarmTransition("15c/yahoo_external_clock", { status: "alarm", workflows: [open] },
    { status: "ok", workflows: [clear] }, buildIssueBody([open]), /Consecutive failures: 2/);
}

// A permitted UNVERIFIED publication must not make a sustained cost-measurement
// outage invisible. Exercise the existing report shell and detector together.
{
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const report = fs.readFileSync(path.join(root, ".github/workflows/r2-usage-report.yml"), "utf8");
  const body = report.split("        run: |\n").at(-1).split("\n").map(line => line.replace(/^          /, "")).join("\n");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "r2-report-alarm-"));
  try {
    for (const code of [0, 1, 2, 3]) {
      const script = body.replace("node scripts/check-r2-free-tier-usage.mjs --json > usage.json",
        `printf '%s\\n' '{"verdict":"${code === 3 ? "unverified" : code === 2 ? "fail" : "ok"}"}' > usage.json; (exit ${code})`);
      const result = spawnSync("bash", ["-c", script], { cwd: temp, env: { ...process.env, GITHUB_STEP_SUMMARY: path.join(temp, "summary") }, encoding: "utf8" });
      assert.equal(result.status, code <= 1 ? 0 : code, result.stderr);
    }
    const workflow = deriveWorkflowWatchPolicy().watched.find(row => row.file === "r2-usage-report.yml");
    assert.ok(workflow, "the existing report must be watched on its declared schedule");
    assert.equal(workflow.failure_streak_threshold, 2);
    assert.deepEqual(workflow.crons, ["43 */6 * * *"]);
    const run = (id, conclusion) => ({ id, event: "schedule", status: "completed", conclusion,
      created_at: `2026-10-23T${String(id).padStart(2, "0")}:43:00Z`, run_started_at: `2026-10-23T${String(id).padStart(2, "0")}:43:00Z` });
    const options = { now: Date.parse("2026-10-23T12:45:00Z") };
    assert.equal(evaluateWorkflow(workflow, [run(12, "failure"), run(6, "success")], options).status, "ok");
    const repeated = evaluateWorkflow(workflow, [run(12, "failure"), run(6, "failure")], options);
    assert.equal(repeated.status, "alarm");
    assert.match(buildIssueBody([repeated]), /Exit 3 means UNVERIFIED/);
    assert.equal(evaluateWorkflow(workflow, [run(12, "success"), run(6, "failure")], options).status, "ok");
    const healthy = [run(0, "success")];
    assert.equal(evaluateWorkflow(workflow, healthy, { now: Date.parse("2026-10-23T06:45:00Z") }).status, "ok",
      "one missed six-hour slot stays quiet");
    const absent = evaluateWorkflow(workflow, healthy, { now: Date.parse("2026-10-23T12:45:00Z") });
    assert.ok(absent.alarm_reasons.includes("missed_schedule_window"), "two missed six-hour slots alarm");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

// Marked A1 dispatches are automatic slots, including failures and evictions.
{
  const workflow = { file: "fetch-yahoo-ticker.yml", label: "Yahoo ticker", events: ["schedule"],
    crons: ["5 * * * *"], scheduled_producer: true };
  const marked = (hour, conclusion = "failure") => {
    const slot = `2026-10-11T0${hour}:05:00.000Z`;
    return { id: hour, event: "workflow_dispatch", status: "completed", conclusion,
      created_at: slot, run_started_at: slot, html_url: `https://gh/run/${hour}`,
      display_title: `external-clock/a1/v1 ${workflow.file} ${slot}` };
  };
  const failures = [6, 5, 4, 3, 2, 1].map((hour) => marked(hour));
  const now = Date.parse("2026-10-11T06:30:00Z");
  const failed = evaluateWorkflow(workflow, failures, { now });
  assert.equal(failed.status, "alarm");
  assert.equal(failed.streak, 6);
  assert.deepEqual(failed.alarm_reasons, ["failure_streak"]);
  assert.equal(failed.firstFailingRunId, 1);
  assert.match(buildIssueBody([failed]), /First failing run: 1 started 2026-10-11T01:05/);
  const recovered = evaluateWorkflow(workflow,
    [{ ...marked(7, "success"), event: "schedule" }, ...failures],
    { now: Date.parse("2026-10-11T07:30:00Z") });
  assert.equal(recovered.status, "ok");
  assert.equal(recovered.streak, 0);
  assert.equal(recovered.failure_streak_recovered, true);
  const manual = evaluateWorkflow(workflow,
    [{ ...marked(7), display_title: "Human dispatch" }, marked(6, "success")],
    { now: Date.parse("2026-10-11T07:30:00Z") });
  assert.equal(manual.streak, 0, "an unmarked human failure stays excluded");
  assert.equal(manual.status, "ok");
  const evicted = marked(6, "cancelled");
  await annotateQueueEvictions({ workflow, runs: [evicted], fetchJobsFn: async () => [] });
  const lost = evaluateWorkflow(workflow, [evicted], { now });
  assert.equal(lost.streak, 0);
  assert.deepEqual(lost.alarm_reasons, ["lost_schedule_slot"]);
}

// One declared slot, one streak entry. The hourly observer's marked clock run
// and GitHub's own fallback schedule for that same slot are one automatic
// cycle: on 2026-10-13T21:11Z both failed for the same congestion reading and
// the pair opened a threshold-2 alarm as if two cycles had failed.
{
  const workflow = { file: "global-writer-queue-observer.yml", label: "Global Writer Queue Observability",
    events: ["schedule"], crons: ["11 * * * *"], scheduled_producer: true };
  const clock = (id, hour, conclusion = "failure") => ({
    id, event: "workflow_dispatch", status: "completed", conclusion,
    created_at: `2026-10-13T${hour}:11:02Z`, run_started_at: `2026-10-13T${hour}:11:02Z`,
    html_url: `https://gh/run/${id}`,
    display_title: `external-clock/a1/v1 ${workflow.file} 2026-10-13T${hour}:11:00.000Z`,
  });
  const fallback = (id, hour, conclusion = "failure") => ({
    id, event: "schedule", status: "completed", conclusion,
    created_at: `2026-10-13T${hour}:11:11Z`, run_started_at: `2026-10-13T${hour}:11:11Z`,
    html_url: `https://gh/run/${id}`,
  });
  const now = Date.parse("2026-10-13T23:00:00Z");
  const slot = Date.parse("2026-10-13T21:11:00.000Z");
  assert.equal(declaredSlotKey(workflow, fallback(1, "21")), slot,
    "a scheduled fallback is pinned to its declared cron instant");
  assert.equal(declaredSlotKey(workflow, clock(1, "21")), slot);
  assert.equal(declaredSlotKey(workflow, { ...fallback(1, "21"), created_at: "not-a-date", run_started_at: "not-a-date" }), null,
    "unparseable evidence is never folded into a slot");
  assert.equal(declaredSlotKey(workflow, { ...clock(1, "21"), display_title: "Human dispatch" }), null);
  // Creation pins the slot even when the runner started in a later window.
  const queued = { ...fallback(38468658101, "21"), run_started_at: "2026-10-13T22:12:00Z" };
  assert.equal(declaredSlotKey(workflow, queued), slot,
    "a queued fallback keeps its creation slot, not its start slot");
  assert.equal(coalesceSlots(workflow, [queued, clock(38468639644, "21")]).length, 1);
  // A missing creation timestamp is unknown, not a runner-start fallback.
  const uncreated = { ...fallback(38468658102, "21"), created_at: undefined };
  assert.equal(declaredSlotKey(workflow, uncreated), null,
    "a missing creation timestamp cannot claim a slot");
  assert.equal(coalesceSlots(workflow, [uncreated, clock(38468639644, "21")]).length, 2);
  // A drifted cron declaration stops coalescing instead of mis-bucketing.
  const drifted = { ...workflow, crons: ["12 * * * *"] };
  assert.equal(declaredSlotKey(drifted, fallback(1, "21")), null);
  assert.equal(declaredSlotKey(drifted, clock(1, "21")), null);
  assert.equal(coalesceSlots(drifted, [fallback(38468658020, "21"), clock(38468639644, "21")]).length, 2);

  // The real pair: 38468639644 (clock) and 38468658020 (fallback).
  const oneSlot = evaluateWorkflow(workflow,
    [fallback(38468658020, "21"), clock(38468639644, "21")], { now });
  assert.equal(oneSlot.streak, 1, "one slot counts once");
  assert.equal(oneSlot.alarm_reasons.includes("failure_streak"), false,
    "a single failed slot does not reach the threshold");

  // A distinct failed slot still reaches the threshold.
  const twoSlots = evaluateWorkflow(workflow,
    [fallback(38468658020, "21"), clock(38468639644, "21"), clock(38460000000, "20")], { now });
  assert.equal(twoSlots.streak, 2, "two separate failed slots still alarm");
  assert.equal(twoSlots.alarm_reasons.includes("failure_streak"), true);
  assert.equal(twoSlots.firstFailingRunId, 38460000000,
    "the alarm names the oldest failed slot in the streak");
  assert.match(buildIssueBody([twoSlots]),
    /First failing run: 38460000000 started 2026-10-13T20:11/);

  // A later successful fallback clears its own slot's earlier failure while an
  // older failed slot stays counted.
  const recovered = evaluateWorkflow(workflow,
    [fallback(38468658200, "22"), clock(38468658100, "22"),
      fallback(38468658020, "21", "success"), clock(38468639644, "21")], { now });
  assert.equal(recovered.streak, 1, "the successful fallback represents its slot");

  // Two marked runs in one slot are still one cycle.
  const markedTwice = evaluateWorkflow(workflow,
    [clock(38468639700, "21"), clock(38468639644, "21")], { now });
  assert.equal(markedTwice.streak, 1);

  // An in-progress fallback cannot erase a completed clock failure.
  const inFlight = evaluateWorkflow(workflow,
    [{ ...fallback(38468658099, "21"), status: "in_progress", conclusion: null }, clock(38468639644, "21")], { now });
  assert.equal(inFlight.streak, 1);

  // An unmarked manual dispatch keeps its existing separate semantics.
  const manualRun = { ...fallback(38468658100, "21", "success"), event: "workflow_dispatch",
    display_title: "Global Writer Queue Observability" };
  const manual = evaluateWorkflow(workflow,
    [manualRun, clock(38468639644, "21"), clock(38460000000, "20")], { now });
  assert.equal(manual.streak, 2, "a manual dispatch is not a slot result");

  // Runs from another workflow never coalesce into this workflow's slot.
  const otherFile = { ...clock(38468639645, "21"),
    display_title: "external-clock/a1/v1 fetch-yahoo-ticker.yml 2026-10-13T21:05:00.000Z" };
  assert.equal(coalesceSlots(workflow, [fallback(38468658020, "21"), otherFile]).length, 2);
  // Distinct declared slots survive as distinct entries.
  assert.equal(coalesceSlots(workflow, [fallback(2, "21"), clock(1, "20")]).length, 2);
}

// The alarm's data-stoppage input is two committed KPI generations. A single
// stopped generation is not yet a K3 incident; unreadable history is unknown,
// never a healthy result that can clear an open issue.
{
  const classifySnapshot = (generations) => classifyKpiGenerationStoppage(generations,
    { now: Date.parse("2026-09-28T11:40:00Z") });
  const generation = (generated_at, rows) => ({
    generated_at,
    sets: Object.entries(rows).map(([set, status]) => ({ set, status })),
  });
  const current = generation("2026-09-28T11:34:19.757Z", {
    fred_macro: "fresh",
    stockanalysis_etf_detail: "stopped",
    sentiment: "stopped",
  });
  const previous = generation("2026-09-28T10:21:42.000Z", {
    fred_macro: "fresh",
    stockanalysis_etf_detail: "stopped",
    sentiment: "delayed",
  });
  assert.deepEqual(classifySnapshot([current, previous]), {
    status: "alarm",
    stopped_sets: ["stockanalysis_etf_detail"],
    latest_generated_at: current.generated_at,
    previous_generated_at: previous.generated_at,
  });
  assert.equal(
    classifySnapshot([
      generation("2026-09-28T11:34:19Z", { stockanalysis_etf_detail: "stopped" }),
      generation("2026-09-28T10:21:42Z", { stockanalysis_etf_detail: "fresh" }),
    ]).status,
    "ok",
    "the set pages only when it is stopped in both latest generations",
  );
  const oneStopped = classifySnapshot([
    generation("2026-09-28T11:34:19Z", { stockanalysis_etf_detail: "stopped" }),
    generation("2026-09-28T10:21:42Z", { stockanalysis_etf_detail: "delayed" }),
  ]);
  assert.equal(oneStopped.status, "ok", "one stopped generation does not page");
  assert.deepEqual(oneStopped.stopped_sets, []);
  assert.equal(classifySnapshot([current]).status, "unknown", "one snapshot cannot clear or page");
  assert.equal(classifySnapshot([previous, current]).status, "unknown", "out-of-order generations stay unknown");
  assert.equal(classifySnapshot([
    generation("2026-09-28T11:34:19Z", { stockanalysis_etf_detail: "stopped" }),
    generation("2026-09-28T10:21:42Z", {}),
  ]).status, "unknown", "malformed generations stay unknown");

  const outcomeGeneration = (at, state, extra = {}) => ({ generated_at: at, sets: [{
    set: "gdelt_news_tone", status: state, newest_source_date: "2026-09-20",
    latest_attempt: { observed_at: at, outcome: "retained" }, ...extra,
  }] });
  const retained = [outcomeGeneration("2026-09-28T11:30:00Z", "delayed"),
    outcomeGeneration("2026-09-28T10:20:00Z", "delayed")];
  const retainedAlarm = classifySnapshot(retained);
  assert.equal(retainedAlarm.status, "alarm");
  assert.deepEqual(retainedAlarm.outcome_alarms[0].reasons, ["source_not_advancing", "retained_streak"]);
  const sameAttempt = structuredClone(retained);
  sameAttempt[0].sets[0].latest_attempt = sameAttempt[1].sets[0].latest_attempt;
  assert.equal(classifySnapshot(sameAttempt).status, "ok", "KPI rebuilds are not distinct retained attempts");
  const alreadyRetained = structuredClone(sameAttempt);
  alreadyRetained[0].sets[0].outcome_state = { attempt_at: alreadyRetained[0].sets[0].latest_attempt.observed_at,
    source_as_of: alreadyRetained[0].sets[0].newest_source_date, consecutive_retained: 2, unchanged_source_attempts: 2 };
  assert.equal(classifySnapshot(alreadyRetained).status, "alarm", "a projection-only refresh cannot close an observed retained streak");
  const quarterly = structuredClone(retained);
  quarterly.forEach(snapshot => { snapshot.sets[0].status = "fresh"; });
  assert.equal(classifySnapshot(quarterly).status, "ok", "in-bound quarterly source may remain unchanged");
  const lowMembers = structuredClone(sameAttempt);
  lowMembers.forEach(snapshot => Object.assign(snapshot.sets[0], { fresh_members: 1461, total_members: 1495 }));
  assert.deepEqual(classifySnapshot(lowMembers).outcome_alarms[0].reasons, ["member_ratio_low"]);
  lowMembers[0].sets.push({ set: "unobserved_lane", status: "unknown" });
  assert.equal(classifySnapshot(lowMembers).status, "alarm", "one unknown lane must not hide known unhealthy data");

  const kpiBody = buildIssueBody([{
    label: "Data stopped advancing",
    kpi_stopped_sets: ["stockanalysis_etf_detail"],
    latest_generated_at: current.generated_at,
    previous_generated_at: previous.generated_at,
  }]);
  assert.match(kpiBody, /stockanalysis_etf_detail/);
  assert.match(kpiBody, /two promoted health KPI generations/);
  assert.match(kpiBody, /2026-09-28T11:34:19\.757Z/);

  const objects = new Map();
  const manifests = [current, previous].map((document, index) => {
    const bytes = new TextEncoder().encode(JSON.stringify(document));
    const hash = sha256Bytes(bytes), generation = `platform-projections-test-${index}`;
    const manifest = { schema_version: "100x-cloud-data-generation/v1", generation_id: generation,
      source_sha: "a".repeat(64), created_at: document.generated_at,
      assets: [{ path: "public/data/admin/fenok-data-health-kpi.json", object_key: `objects/sha256/${hash}`,
        sha256: hash, bytes: bytes.length, content_type: "application/json", source_as_of: null, privacy_class: "public" }] };
    const manifestBytes = new TextEncoder().encode(canonicalJson(manifest));
    const key = `manifests/${generation}.json`;
    objects.set(key, manifestBytes); objects.set(`objects/sha256/${hash}`, bytes);
    return { generation_id: generation, manifest_key: key, manifest_sha256: sha256Canonical(manifest) };
  });
  const pointer = { schema_version: "100x-cloud-data-pointer/v1", sequence: 2,
    active: manifests[0], previous: manifests[1], source_sha: "a".repeat(64),
    prepared_receipt_id: "test-receipt", promoted_at: current.generated_at };
  const snapshots = await fetchKpiGenerationSnapshots({ plane: {
    pointerStore: { get: async () => pointer }, objectStore: { get: async key => objects.get(key) },
  } });
  assert.deepEqual(snapshots, [current, previous], "promoted snapshots remain newest-first");
}

assert.equal(deriveFailureStreakThreshold([{ cron: "0 7 * * 0" }]), 1,
  "a weekly workflow pages on its first completed failure");
assert.equal(deriveFailureStreakThreshold([{ cron: "0 6 * * *" }]), 2,
  "a faster-than-weekly workflow keeps the two-failure guard");
assert.equal(deriveFailureStreakThreshold([
  { cron: "0 7 * * 0" },
  { cron: "0 6 * * *" },
]), 2, "a workflow with both weekly and daily schedules uses its faster cadence");

// Runs are most-recent-first, matching the GitHub API `workflow_runs` ordering.
const F = (id) => ({ id, conclusion: "failure", html_url: `https://gh/run/${id}`, run_started_at: `t${id}` });
const S = (id) => ({ id, conclusion: "success", html_url: `https://gh/run/${id}` });
const C = (id) => ({ id, conclusion: "cancelled", html_url: `https://gh/run/${id}` });
const SU = (id) => ({ id, conclusion: "startup_failure", html_url: `https://gh/run/${id}`, run_started_at: `t${id}` });
const T = (id) => ({ id, conclusion: "timed_out", html_url: `https://gh/run/${id}`, run_started_at: `t${id}` });
const K = (id) => ({ id, conclusion: "skipped", html_url: `https://gh/run/${id}` });
const R = (id, event, createdAt) => ({ id, event, conclusion: "success", created_at: createdAt });

function writeWorkflow(root, file, source) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, file), source);
}

// Runs from pull requests must not enter the production streak for the
// explicitly included workflow-syntax gate. The API query is branch-scoped for
// every watched workflow, with main as the conservative project default.
{
  const url = new URL(buildWorkflowRunsUrl({
    owner: "owner with space",
    repo: "repo",
    file: "odd?ref#fragment.yml",
    event: "push",
  }));
  assert.equal(url.pathname, "/repos/owner%20with%20space/repo/actions/workflows/odd%3Fref%23fragment.yml/runs");
  assert.equal(url.searchParams.get("status"), "completed");
  assert.equal(url.searchParams.get("branch"), "main");
  assert.equal(url.searchParams.get("event"), "push");
  assert.equal(url.searchParams.get("per_page"), "15");
  assert.deepEqual(parseWorkflowRunsPayload({ workflow_runs: [{ id: 1 }] }), [{ id: 1 }]);
  assert.throws(
    () => parseWorkflowRunsPayload({ message: "unexpected success payload" }),
    /missing workflow_runs\[\]/,
    "a malformed HTTP-200 response must degrade to unknown, never healthy",
  );
}

// A newly added schedule is watched by construction. Removing `schedule` from
// the same fixture is the required mutation proving that the guard actually
// discriminates rather than accepting every YAML file.
{
  const workflowsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-watch-policy-"));
  writeWorkflow(workflowsDir, "future-scheduled.yml", [
    "name: Future Scheduled Job",
    "",
    "on:",
    "    schedule:",
    "        - cron: '7 7 * * *'",
    "    workflow_dispatch:",
    "",
  ].join("\n"));
  writeWorkflow(workflowsDir, "manual.yml", "name: Manual Only\non:\n  workflow_dispatch:\n");
  writeWorkflow(workflowsDir, "critical-gate.yml", "name: Critical Gate\n'on':\n  push:\n");
  writeWorkflow(workflowsDir, "self-alarm.yaml", "name: Self Alarm\n\"on\":\n  schedule:\n    - cron: '1 * * * *'\n");
  writeWorkflow(workflowsDir, "nested-key.yml", [
    "name: Nested Schedule Key",
    "on:",
    "    workflow_call:",
    "        inputs:",
    "            schedule:",
    "                required: false",
    "",
  ].join("\n"));
  writeWorkflow(
    workflowsDir,
    "inline-flow.yml",
    "name: Inline Flow Schedule\non: {\"schedule\": [{\"cron\": \"1 * * * *\"}], \"workflow_dispatch\": {}}\n",
  );

  const policy = deriveWorkflowWatchPolicy({
    workflowsDir,
    scheduledExclusions: {
      "self-alarm.yaml": "self-monitoring would create a recursive alarm loop",
    },
    nonScheduledInclusions: {
      "critical-gate.yml": "critical push gate must page despite having no schedule",
    },
  });
  assert.deepEqual(
    policy.watched.map((row) => row.file),
    ["critical-gate.yml", "future-scheduled.yml", "inline-flow.yml"],
  );
  assert.deepEqual(
    policy.watched.find((row) => row.file === "future-scheduled.yml")?.events,
    ["schedule"],
    "manual dispatch must never enter the counted event set",
  );
  assert.deepEqual(
    policy.watched.find((row) => row.file === "inline-flow.yml")?.events,
    ["schedule"],
    "inline workflow_dispatch must also be excluded from the counted event set",
  );
  assert.deepEqual(
    policy.watched.find((row) => row.file === "critical-gate.yml")?.events,
    ["push"],
    "the explicit non-scheduled gate keeps its declared automatic event",
  );
  assert.deepEqual(policy.excluded, [{
    file: "self-alarm.yaml",
    label: "Self Alarm",
    reason: "self-monitoring would create a recursive alarm loop",
  }]);
  assert.equal(policy.scheduled_count, 3);

  const scheduledSource = fs.readFileSync(path.join(workflowsDir, "future-scheduled.yml"), "utf8");
  const scheduleRemoved = scheduledSource.replace("    schedule:", "    workflow_dispatch:");
  assert.notEqual(scheduleRemoved, scheduledSource, "schedule-removal mutation anchor must exist");
  fs.writeFileSync(path.join(workflowsDir, "future-scheduled.yml"), scheduleRemoved);
  const mutated = deriveWorkflowWatchPolicy({
    workflowsDir,
    scheduledExclusions: { "self-alarm.yaml": "self-monitoring would create a recursive alarm loop" },
    nonScheduledInclusions: { "critical-gate.yml": "critical push gate must page despite having no schedule" },
  });
  assert.equal(mutated.watched.some((row) => row.file === "future-scheduled.yml"), false,
    "removing the schedule trigger must remove the automatic watch classification");
  assert.equal(mutated.watched.some((row) => row.file === "nested-key.yml"), false,
    "a nested key named schedule must not be mistaken for an on.schedule trigger");

  assert.throws(
    () => deriveWorkflowWatchPolicy({
      workflowsDir,
      scheduledExclusions: { "manual.yml": "stale exclusion" },
      nonScheduledInclusions: {},
    }),
    /exclusion must reference a scheduled workflow/,
  );
  assert.throws(
    () => deriveWorkflowWatchPolicy({
      workflowsDir,
      scheduledExclusions: { "self-alarm.yaml": "" },
      nonScheduledInclusions: {},
    }),
    /reason must be a non-empty string/,
  );
  assert.throws(
    () => deriveWorkflowWatchPolicy({
      workflowsDir,
      scheduledExclusions: {},
      nonScheduledInclusions: { "self-alarm.yaml": "stale inclusion" },
    }),
    /inclusion must reference a non-scheduled workflow/,
  );
  assert.throws(
    () => deriveWorkflowWatchPolicy({
      workflowsDir,
      scheduledExclusions: { "self-alarm.yaml": "self-monitoring loop" },
      nonScheduledInclusions: { "missing.yml": "missing gate" },
    }),
    /inclusion must reference an existing workflow/,
  );

  for (const invalid of [0, 1.5, 3, "1"]) {
    assert.throws(() => deriveWorkflowWatchPolicy({
      workflowsDir,
      scheduledExclusions: { "self-alarm.yaml": "self-monitoring loop" },
      nonScheduledInclusions: {
        "critical-gate.yml": { reason: "critical push gate", events: ["push"], failure_streak_threshold: invalid },
      },
    }), /failure_streak_threshold must be 1 or 2/);
  }
  assert.throws(() => deriveWorkflowWatchPolicy({
    workflowsDir,
    scheduledExclusions: { "self-alarm.yaml": "self-monitoring loop" },
    nonScheduledInclusions: { "critical-gate.yml": { reason: "critical push gate", events: ["workflow_run"] } },
  }), /inclusion event must be a declared workflow trigger/);

  writeWorkflow(workflowsDir, "aliased-on.yml", "name: Aliased On\non: *shared_triggers\n");
  assert.throws(
    () => deriveWorkflowWatchPolicy({
      workflowsDir,
      scheduledExclusions: { "self-alarm.yaml": "self-monitoring loop" },
      nonScheduledInclusions: {},
    }),
    /aliased top-level on trigger is unsupported/,
    "an uninspectable trigger alias must fail closed instead of silently missing a schedule",
  );
}

// Real-repository contract: at least 31 scheduled workflows are discovered. The
// alarm itself is the sole declared exclusion, while the non-scheduled workflow
// syntax gate is an explicit inclusion. The serving probe is watched, not
// excluded: its own run turns red only on machinery failure (issue/API), so a
// genuine probe failure is an outage worth paging, and a stale exclusion would
// hide it. The floor catches accidental parser shrinkage without making future
// scheduled workflows wait for a hand-edited exact count.
{
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const policy = deriveWorkflowWatchPolicy({
    workflowsDir: path.join(repoRoot, ".github", "workflows"),
  });
  for (const [file, crons] of Object.entries(EXTERNAL_CLOCK_CRONS)) {
    if (file in SCHEDULED_WORKFLOW_EXCLUSIONS) continue;
    const watch = policy.watched.find(row => row.file === file);
    assert.ok(watch?.events.includes(externalClockEvent(file)), `${file}: fetch clock event`);
    assert.equal(Boolean(watch.failure_streak_by_external_clock_cron), crons.length > 1, `${file}: isolate distinct cadences`);
    const manual = evaluateWorkflow(watch, [{ id: 1, event: externalClockEvent(file), status: "completed",
      conclusion: "failure", display_title: "Human dispatch" }]);
    assert.equal(manual.streak, 0, `${file}: unmarked runs stay excluded`);
  }
  const stockWatch = policy.watched.find(row => row.file === "fetch-stockanalysis.yml");
  const stockRun = (id, slot, conclusion) => ({ id, event: "repository_dispatch", status: "completed", conclusion,
    created_at: slot, run_started_at: slot, display_title: `external-clock/a1/v1 ${stockWatch.file} ${slot}` });
  const stockFailures = [stockRun(3, "2026-10-23T21:20:00.000Z", "failure"),
    stockRun(2, "2026-10-22T21:20:00.000Z", "failure")];
  const mixedSlots = evaluateWorkflow(stockWatch,
    [stockRun(4, "2026-10-23T23:50:00.000Z", "success"), ...stockFailures],
    { now: Date.parse("2026-10-24T00:00:00Z") });
  assert.equal(mixedSlots.streak, 2, "ETF success cannot clear the failing stock cadence");
  assert.ok(mixedSlots.alarm_reasons.includes("failure_streak"));
  const recoveredStock = evaluateWorkflow(stockWatch,
    [stockRun(5, "2026-10-24T21:20:00.000Z", "success"), ...stockFailures],
    { now: Date.parse("2026-10-24T21:30:00Z") });
  assert.equal(recoveredStock.streak, 0, "matching cadence success clears the failure streak");
  assert.ok(policy.scheduled_count >= 31, "the scheduled-workflow inventory must not shrink silently");
  assert.equal(
    policy.watched.length,
    policy.scheduled_count - Object.keys(SCHEDULED_WORKFLOW_EXCLUSIONS).length
      + Object.keys(NON_SCHEDULED_WORKFLOW_INCLUSIONS).length,
    "every scheduled workflow must be watched or explicitly excluded",
  );
  assert.deepEqual(policy.excluded, [{
    file: "pipeline-failure-alarm.yml",
    label: "Pipeline Failure Alarm",
    reason: SCHEDULED_WORKFLOW_EXCLUSIONS["pipeline-failure-alarm.yml"],
  }]);
  assert.equal(
    NON_SCHEDULED_WORKFLOW_INCLUSIONS["validate-workflows.yml"].reason,
    "critical workflow syntax gate must page despite having no schedule",
  );
  assert.deepEqual(
    NON_SCHEDULED_WORKFLOW_INCLUSIONS["validate-workflows.yml"].events,
    ["push"],
    "the non-scheduled gate must count main push runs only",
  );
  assert.deepEqual(
    policy.watched.find((row) => row.file === "validate-workflows.yml")?.events,
    ["push"],
    "the derived policy must carry the push-event filter to the API query",
  );
  assert.deepEqual(
    policy.watched.find((row) => row.file === "deploy-worker.yml")?.events,
    ["push", "schedule", "workflow_run", "workflow_dispatch"],
    "automatic triggers include bound clock dispatch; unmarked human runs stay excluded",
  );
  assert.deepEqual(
    policy.watched.find((row) => row.file === "slickcharts-history.yml")?.events,
    ["schedule", "workflow_dispatch"],
    "clock dispatch is fetched but manual remediation runs remain excluded",
  );
  for (const file of [
    "build-stocks-analyzer.yml",
    "data-plane-serving-probe.yml",
    "fetch-us-indices-daily.yml",
    "global-writer-queue-observer.yml",
    "update-manifest.yml",
    "validate-workflows.yml",
    "worker-request-budget-alarm.yml",
  ]) {
    assert.ok(policy.watched.some((row) => row.file === file), `${file} must be watched`);
  }
  assert.deepEqual(
    policy.watched.find((row) => row.file === "data-plane-serving-probe.yml")?.events,
    ["schedule", "workflow_dispatch"],
    "the probe includes bound clock dispatch; manual dispatch stays excluded",
  );
  assert.equal(
    policy.watched.find((row) => row.file === "slickcharts-weekly.yml")?.failure_streak_threshold,
    1,
    "the weekly workflow must retain its run-history paging threshold",
  );
  const computedWatch = policy.watched.find(row => row.file === "coordinate-computed-signals.yml");
  assert.deepEqual(computedWatch?.events, ["workflow_run"]);
  assert.deepEqual(computedWatch?.crons, []);
  assert.equal(computedWatch?.failure_streak_threshold, 1);
  assert.equal(evaluateWorkflow(computedWatch, [{ ...F(302), event: "workflow_run" }]).status, "alarm");
  assert.equal(evaluateWorkflow(computedWatch, [{ ...S(303), event: "workflow_run" },
    { ...F(302), event: "workflow_run" }]).status, "ok");
  const symbolsWatch = policy.watched.find((row) => row.file === "slickcharts-symbols.yml");
  assert.deepEqual(symbolsWatch?.events, ["workflow_run"]);
  assert.deepEqual(symbolsWatch?.crons, []);
  assert.equal(symbolsWatch?.failure_streak_threshold, 1,
    "one failed automatic symbols run must still page at weekly cadence");
  const symbolsResult = evaluateWorkflow(symbolsWatch, [
    { ...F(303), event: "workflow_dispatch" },
    { ...F(302), event: "workflow_run" },
    { ...S(301), event: "workflow_run" },
  ]);
  assert.equal(symbolsResult.status, "alarm");
  assert.equal(symbolsResult.streak, 1);
  assert.equal(symbolsResult.latestRunUrl, "https://gh/run/302",
    "manual failures cannot displace the newest automatic symbols run");
}

// GitHub accepts one event filter per workflow-runs request. Event-scoped
// batches are merged newest-first and deduplicated before streak evaluation, so
// manual runs cannot crowd counted automatic runs out of the API page.
{
  const merged = mergeWorkflowRunBatches([
    [R(4, "push", "2026-07-22T04:00:00Z"), R(2, "push", "2026-07-22T02:00:00Z")],
    [R(3, "schedule", "2026-07-22T03:00:00Z"), R(2, "schedule", "2026-07-22T02:00:00Z")],
  ]);
  assert.deepEqual(merged.map((run) => run.id), [4, 3, 2]);
  assert.equal(merged.some((run) => run.event === "workflow_dispatch"), false);
}

// Required production regression: manual remediation failures do not page the
// monthly history workflow, while two real scheduled analyzer failures still do.
{
  const slickchartsRuns = mergeWorkflowRunBatches([[
    { ...F(303), event: "workflow_dispatch" },
    { ...F(302), event: "workflow_dispatch" },
    { ...S(301), event: "schedule" },
  ]]);
  const slickcharts = evaluateWorkflow(
    { file: "slickcharts-history.yml", label: "SlickCharts Historical Membership", events: ["schedule"] },
    slickchartsRuns,
  );
  assert.equal(slickcharts.status, "ok");
  assert.equal(slickcharts.streak, 0);
  assert.equal(slickcharts.latestRunUrl, "https://gh/run/301");

  const analyzerRuns = mergeWorkflowRunBatches([[F(203), F(202), S(201)]]);
  const analyzer = evaluateWorkflow(
    { file: "build-stocks-analyzer.yml", label: "Build Stocks Analyzer", events: ["schedule"] },
    analyzerRuns,
  );
  assert.equal(analyzer.status, "alarm");
  assert.equal(analyzer.streak, 2);
  assert.equal(analyzer.firstFailingRunId, 202);
}

// Multi-event workflow runs must be evaluated by chronology, not by batch order.
{
  const runs = mergeWorkflowRunBatches([
    [{ ...F(402), event: "push", run_started_at: "2026-07-22T04:02:00Z" }],
    [
      { ...F(403), event: "schedule", run_started_at: "2026-07-22T04:03:00Z" },
      { ...C(401), event: "schedule", run_started_at: "2026-07-22T04:01:00Z" },
      { ...S(400), event: "schedule", run_started_at: "2026-07-22T04:00:00Z" },
    ],
  ]);
  const result = evaluateWorkflow(
    { file: "multi.yml", label: "Multi Event", events: ["push", "schedule"] },
    runs,
  );
  assert.deepEqual(runs.map((run) => run.id), [403, 402, 401, 400]);
  assert.equal(result.status, "alarm");
  assert.equal(result.firstFailingRunId, 402);
}

// --- Queue eviction is its own state, not a producer failure ----------------
// A scheduled run cancelled before any job exists is a lost natural slot. It
// must page without inflating the producer failure streak. Manual cancellations
// remain outside the counted automatic event set.
const jobsOf = (...jobs) => ({ jobs });
const evictedJobs = jobsOf({ name: "fetch", conclusion: "cancelled", steps: [] });
const ranJobs = jobsOf({ name: "fetch", conclusion: "failure", steps: [{ name: "Run", conclusion: "failure" }] });

{
  assert.equal(isQueueEvictedRun(evictedJobs.jobs), true, "cancelled job with zero steps never executed");
  assert.equal(isQueueEvictedRun(ranJobs.jobs), false, "a job that ran steps is a real failure");
  // The discriminator is ZERO STEPS, not the cancelled conclusion. Update
  // Manifest runs 30151994315 and 30157494401 were both cancelled mid-flight
  // with 26 steps each: real work, superseded. Reading those as evictions
  // would launder genuine interruptions into "nothing happened".
  assert.equal(
    isQueueEvictedRun([{ conclusion: "cancelled", steps: new Array(26).fill({ name: "step" }) }]),
    false,
    "a cancelled job that entered steps ran; it was not evicted",
  );
  assert.equal(
    isQueueEvictedRun([{ conclusion: "cancelled", steps: [{ name: "Set up job" }] }]),
    false,
    "even one entered step disproves eviction",
  );
  assert.equal(isQueueEvictedRun([]), false, "no job data proves nothing");
  assert.equal(isQueueEvictedRun(null), false, "missing job data proves nothing");
  assert.equal(
    isQueueEvictedRun([{ conclusion: "cancelled", steps: [] }, { conclusion: "failure", steps: [{ name: "Run" }] }]),
    false,
    "one executed job means the run was not evicted",
  );
}

{
  // An evicted run must not inflate the streak: it says nothing about the producer.
  const evicted = { ...F(2), queue_evicted: true };
  const { streak, evictedRunUrls } = computeFailureStreak([evicted, F(1), S(0)]);
  assert.equal(streak, 1, "an evicted run is not a producer failure");
  assert.deepEqual(evictedRunUrls, ["https://gh/run/2"], "but it must be named, never silently dropped");
}

{
  // Nor may it break a genuine streak the way a success does.
  const { streak } = computeFailureStreak([F(3), { ...F(2), queue_evicted: true }, F(1)]);
  assert.equal(streak, 2, "an evicted run between failures is transparent to the streak");
}

{
  // The healthy path must not sprout eviction vocabulary.
  const { evictedRunUrls } = computeFailureStreak([S(2), S(1)]);
  assert.deepEqual(evictedRunUrls, []);
}

{
  // evaluateWorkflow must carry the eviction out to the caller, not absorb it.
  const result = evaluateWorkflow(
    { file: "fetch-fenok-news-tone.yml", label: "News Tone", events: ["schedule"] },
    [
      { ...F(2), event: "schedule", queue_evicted: true },
      { ...S(1), event: "schedule" },
    ],
  );
  assert.equal(result.streak, 0, "eviction is not a producer failure");
  assert.equal(result.status, "alarm", "a lost scheduled slot must page");
  assert.deepEqual(result.alarm_reasons, ["lost_schedule_slot"]);
  assert.deepEqual(result.queue_evicted_run_urls, ["https://gh/run/2"]);
}

{
  const result = evaluateWorkflow(
    { file: "fetch-oecd-cli.yml", label: "OECD", events: ["schedule"] },
    [
      { ...C(30694384064), event: "schedule", jobs_empty: true },
      { ...S(30690000000), event: "schedule" },
    ],
  );
  assert.equal(result.status, "alarm");
  assert.equal(result.streak, 0);
  assert.equal(result.lost_schedule_slot_count, 1);
  assert.deepEqual(result.lost_schedule_slot_run_urls, ["https://gh/run/30694384064"]);
  assert.deepEqual(result.alarm_reasons, ["lost_schedule_slot"]);
}

{
  const result = evaluateWorkflow(
    { file: "fetch-oecd-cli.yml", label: "OECD", events: ["schedule"] },
    [
      { ...C(10), event: "workflow_dispatch", jobs_empty: true },
      { ...S(9), event: "schedule" },
    ],
  );
  assert.equal(result.status, "ok", "normal manual cancellation must not become a lost scheduled slot");
  assert.equal(result.lost_schedule_slot_count, 0);
  assert.deepEqual(result.alarm_reasons, []);
}

{
  // Manual success records progress; the next automatic cycle closes the slot.
  const result = evaluateWorkflow(
    { file: "fetch-oecd-cli.yml", label: "OECD", events: ["schedule"] },
    [
      { ...S(30700000010), event: "workflow_dispatch" },
      { ...C(30700000001), event: "schedule", jobs_empty: true },
      { ...S(30690000000), event: "schedule" },
    ],
  );
  assert.equal(result.status, "alarm");
  assert.equal(result.lost_schedule_slot_count, 1);
  assert.equal(result.resolved_lost_schedule_slot_count, 0);
  assert.deepEqual(result.lost_schedule_slot_run_urls, ["https://gh/run/30700000001"]);
  assert.deepEqual(result.alarm_reasons, ["lost_schedule_slot"]);
  assert.equal(result.recovery_pending_next_scheduled_run, true);
  assert.match(buildIssueBody([result]), /Recovery pending next scheduled run/);
  const recovered = evaluateWorkflow(
    { file: "fetch-oecd-cli.yml", label: "OECD", events: ["schedule"] },
    [{ ...S(30700000011), event: "schedule" }, { ...S(30700000010), event: "workflow_dispatch" },
      { ...C(30700000001), event: "schedule", jobs_empty: true }],
  );
  assert.equal(recovered.status, "ok");
  assert.equal(recovered.resolved_lost_schedule_slot_count, 1);
  assert.equal(recovered.recovery_pending_next_scheduled_run, false);
}

{
  // A newer dispatch FAILURE is not recovery evidence; the slot still pages.
  const result = evaluateWorkflow(
    { file: "fetch-oecd-cli.yml", label: "OECD", events: ["schedule"] },
    [
      { ...F(30700000010), event: "workflow_dispatch" },
      { ...C(30700000001), event: "schedule", jobs_empty: true },
      { ...S(30690000000), event: "schedule" },
    ],
  );
  assert.equal(result.status, "alarm");
  assert.equal(result.lost_schedule_slot_count, 1);
  assert.equal(result.resolved_lost_schedule_slot_count, 0);
  assert.deepEqual(result.alarm_reasons, ["lost_schedule_slot"]);
}

{
  // A jobs_empty run executed nothing, exactly like a queue eviction — it is
  // contention evidence, not producer evidence, so it neither inflates nor
  // breaks a streak (it still pages separately as a lost scheduled slot).
  const { streak } = computeFailureStreak([F(3), { ...C(2), jobs_empty: true }, F(1)]);
  assert.equal(streak, 2, "a never-executed run is transparent to the streak");
}

{
  // Slow-cadence incidents remain open after a manual success.
  const result = evaluateWorkflow(
    { file: "slickcharts-monthly.yml", label: "Monthly", events: ["schedule"], failure_streak_threshold: 1 },
    [
      { ...S(30700000010), event: "workflow_dispatch" },
      { ...F(30700000001), event: "schedule" },
      { ...S(30690000000), event: "schedule" },
    ],
  );
  assert.equal(result.status, "alarm");
  assert.equal(result.failure_streak_recovered, false);
  assert.equal(result.recovery_pending_next_scheduled_run, true);
  assert.deepEqual(result.alarm_reasons, ["failure_streak"]);
}

{
  // A dispatch success OLDER than the newest failure recovers nothing.
  const result = evaluateWorkflow(
    { file: "slickcharts-monthly.yml", label: "Monthly", events: ["schedule"] },
    [
      { ...F(30700000020), event: "schedule" },
      { ...S(30700000010), event: "workflow_dispatch" },
      { ...F(30700000001), event: "schedule" },
    ],
  );
  assert.equal(result.status, "alarm");
  assert.ok(result.alarm_reasons.includes("failure_streak"));
  assert.equal(result.failure_streak_recovered, false);
  assert.equal(result.recovery_pending_next_scheduled_run, false);
}

{
  // A manual success predating the newest lost slot cannot mark recovery.
  const result = evaluateWorkflow(
    { file: "fetch-oecd-cli.yml", label: "OECD", events: ["schedule"] },
    [
      { ...C(30700000020), event: "schedule", jobs_empty: true },
      { ...S(30700000010), event: "workflow_dispatch" },
      { ...C(30700000001), event: "schedule", jobs_empty: true },
    ],
  );
  assert.equal(result.status, "alarm");
  assert.equal(result.lost_schedule_slot_count, 2);
  assert.equal(result.resolved_lost_schedule_slot_count, 0);
  assert.equal(result.recovery_pending_next_scheduled_run, false);
  assert.deepEqual(result.lost_schedule_slot_run_urls, ["https://gh/run/30700000020", "https://gh/run/30700000001"]);
}

// --- The classifier must actually be wired to run data ----------------------
{
  const asked = [];
  const runs = await annotateQueueEvictions({
    runs: [F(3), F(2), S(1)],
    fetchJobsFn: async (id) => {
      asked.push(id);
      return id === 3 ? evictedJobs.jobs : ranJobs.jobs;
    },
  });
  assert.deepEqual(asked, [3, 2], "only the leading failure-class prefix is inspected");
  assert.equal(runs[0].queue_evicted, true);
  assert.equal(runs[1].queue_evicted, undefined, "a run that executed steps is left alone");
  assert.equal(runs[2].queue_evicted, undefined, "the success past the prefix is never fetched");
}

{
  const asked = [];
  await annotateQueueEvictions({
    runs: [S(9), F(8)],
    fetchJobsFn: async (id) => { asked.push(id); return []; },
  });
  assert.deepEqual(asked, [], "a healthy latest run spends no API calls at all");
}

{
  const asked = [];
  const runs = await annotateQueueEvictions({
    runs: [{ ...C(30694384064), event: "schedule" }, { ...S(1), event: "schedule" }],
    fetchJobsFn: async (id) => { asked.push(id); return []; },
  });
  assert.deepEqual(asked, [30694384064], "a leading cancelled schedule must inspect job execution evidence");
  assert.equal(runs[0].jobs_empty, true);
  const result = evaluateWorkflow(
    { file: "fetch-oecd-cli.yml", label: "OECD", events: ["schedule"] },
    runs,
  );
  assert.equal(result.status, "alarm");
  assert.equal(result.lost_schedule_slot_count, 1);
}

{
  const asked = [];
  await annotateQueueEvictions({
    runs: [F(9), F(8), F(7), F(6), F(5), F(4), F(3)],
    fetchJobsFn: async (id) => { asked.push(id); return []; },
    limit: QUEUE_EVICTION_INSPECTION_LIMIT,
  });
  assert.equal(asked.length, QUEUE_EVICTION_INSPECTION_LIMIT,
    "a long red history must not turn one health check into a rate-limit incident");
}

{
  // Fail-open: a job lookup that throws leaves the run-list verdict untouched.
  const runs = await annotateQueueEvictions({
    runs: [F(4)],
    fetchJobsFn: async () => { throw new Error("HTTP 502"); },
  });
  assert.equal(runs[0].queue_evicted, undefined);
  assert.equal(computeFailureStreak(runs).streak, 1, "an unreadable run stays a failure");
}

// 2 consecutive failures -> alarm
{
  const { streak } = computeFailureStreak([F(2), F(1), S(0)]);
  assert.equal(streak, 2, "two consecutive failures = streak 2");
}

// failure, success, failure -> no alarm (streak 1)
{
  const { streak } = computeFailureStreak([F(3), S(2), F(1)]);
  assert.equal(streak, 1, "failure-success-failure = streak 1");
}

// cancelled runs are skipped: failure, cancelled, failure -> streak 2 -> alarm
{
  const { streak, firstFailingIndex } = computeFailureStreak([F(3), C(2), F(1)]);
  assert.equal(streak, 2, "cancelled between failures is transparent = streak 2");
  assert.equal(firstFailingIndex, 2, "first failing run is the oldest, past the cancelled one");
}

// leading cancelled runs are skipped before counting: cancelled, failure, failure -> streak 2
{
  const { streak } = computeFailureStreak([C(3), F(2), F(1)]);
  assert.equal(streak, 2, "leading cancelled runs do not break the streak");
}

// failure-class: failure followed by startup_failure (the #357 config-refusal class) -> streak 2 -> alarm
{
  const { streak } = computeFailureStreak([F(2), SU(1), S(0)]);
  assert.equal(streak, 2, "failure + startup_failure are both failure-class = streak 2");
}

// failure-class: two timed_out (hung jobs) -> streak 2 -> alarm
{
  const { streak } = computeFailureStreak([T(2), T(1), S(0)]);
  assert.equal(streak, 2, "consecutive timed_out = streak 2");
}

// skipped is transparent like cancelled: failure, skipped, failure -> streak 2
{
  const { streak, firstFailingIndex } = computeFailureStreak([F(3), K(2), F(1)]);
  assert.equal(streak, 2, "skipped between failures is transparent = streak 2");
  assert.equal(firstFailingIndex, 2, "first failing run is past the skipped one");
}

// single failure -> no alarm
{
  const { streak } = computeFailureStreak([F(1), S(0)]);
  assert.equal(streak, 1, "single failure = streak 1");
}

// No completed run has ever been observed: not an alarm, but never healthy.
{
  const workflow = { file: "brand-new-lane.yml", label: "Brand New Lane" };
  const result = evaluateWorkflow(workflow, []);
  const { streak, firstFailingIndex } = computeFailureStreak([]);
  assert.equal(streak, 0, "empty run list = streak 0");
  assert.equal(firstFailingIndex, null, "empty run list has no failing run");
  assert.equal(result.status, "unknown", "no observed completed run must not be reported healthy");
  assert.equal(result.alarming, false, "never-observed is unknown, not an alarm");
  assert.match(result.message, /no completed run observed/i);
}

// evaluateWorkflow: alarm shape carries first-failing metadata + latest url
{
  const wf = { file: "update-manifest.yml", label: "Update Manifest" };
  const result = evaluateWorkflow(wf, [F(9), C(8), F(7), S(6)]);
  assert.equal(result.status, "alarm");
  assert.equal(result.streak, 2);
  assert.equal(result.alarming, true);
  assert.equal(result.firstFailingRunId, 7, "reports the oldest run in the streak");
  assert.equal(result.firstFailingRunUrl, "https://gh/run/7");
  assert.equal(result.firstFailingStartedAt, "t7");
  assert.equal(result.latestRunUrl, "https://gh/run/9", "latest run is the most recent, even if cancelled/failed");
}

// evaluateWorkflow: healthy shape is ok, no first-failing fields
{
  const wf = { file: "deploy-worker.yml", label: "Deploy Worker" };
  const result = evaluateWorkflow(wf, [S(2), F(1)]);
  assert.equal(result.status, "ok");
  assert.equal(result.alarming, false);
  assert.equal(result.firstFailingRunId, undefined);
}

// Graceful-degradation path at the script level: a config/API failure must
// exit 0 with `unknown` status, never alarm. Exercised offline by running the
// script with GITHUB_REPOSITORY unset (deterministic, no network).
{
  const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "check-pipeline-job-health.mjs");
  const resultPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-health-")), "result.json");
  const run = spawnSync(process.execPath, [scriptPath], {
    env: { ...process.env, GITHUB_REPOSITORY: "", PIPELINE_JOB_HEALTH_RESULT: resultPath },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, "missing GITHUB_REPOSITORY must exit 0, not alarm");
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  assert.equal(result.status, "unknown", "missing repository reports unknown status");
  assert.ok(!("issueBody" in result), "unknown status must not produce an alarm issue body");
  assert.equal(
    result.watched.length,
    deriveWorkflowWatchPolicy().watched.length,
    "the offline result covers every current watched workflow",
  );
  assert.equal(result.workflows.length, result.watched.length, "the offline result emits one row per watched workflow");
  assert.equal(result.data_health_kpi.status, "unknown", "missing repository cannot make KPI history look healthy");
  assert.ok(result.workflows.every((workflow) => workflow.status === "unknown"));
}

// fh-258 adjudication boundary: only a row that actually carries a
// missed-window verdict triggers the widened re-read, and the runs URL keeps
// its default page size while exposing the override the re-read uses.
assert.equal(needsMissedWindowReverification({ missed_schedule_window_hours: 624.78 }), true);
assert.equal(needsMissedWindowReverification({ missed_schedule_window_hours: null }), false);
assert.equal(
  needsMissedWindowReverification({
    alarming: true,
    alarm_reasons: ["failure_streak"],
    missed_schedule_window_hours: null,
  }),
  false,
  "failure-streak rows must not trigger the re-read",
);
assert.equal(needsMissedWindowReverification({}), false);
assert.equal(needsMissedWindowReverification(null), false);
assert.match(buildWorkflowRunsUrl({ owner: "o", repo: "r", file: "x.yml" }), /per_page=15/);
assert.match(
  buildWorkflowRunsUrl({ owner: "o", repo: "r", file: "x.yml" }),
  /status=completed/,
  "the completed-run query remains the default",
);
assert.match(
  buildWorkflowRunsUrl({ owner: "o", repo: "r", file: "x.yml", event: "schedule", perPage: 100 }),
  /per_page=100/,
);
assert.match(
  buildWorkflowRunsUrl({ owner: "o", repo: "r", file: "x.yml", event: "schedule", status: "in_progress" }),
  /status=in_progress.*event=schedule/,
  "the restore liveness query can inspect active scheduled runs",
);

// A green out-of-window job cannot heal a two-campaign sweep gap. Read the
// durable outcome, including pagination, and surface unreadable state loudly.
{
  const { STATE_TITLE, classifyRetentionSchedule } = await import('./retention-schedule.mjs');
  const state = { schema: 1, weekly_enabled: true, first_success: { at: '2026-09-26T15:13:58.775Z' } };
  const now = Date.parse('2026-10-11T14:00:00Z');
  const stale = classifyRetentionSchedule(state, {now});
  assert.deepEqual(stale.alarm_reasons, ['retention_sweep_stale']);
  assert.match(buildIssueBody([stale]), /2026-09-26T15:13:58.775Z/);
  assert.equal(classifyRetentionSchedule({...state,last_success:{at:'2026-10-10T17:00:00Z'}},{now}).status,'ok');
  for (const invalid of [null,{}, {...state,last_success:{at:'not-a-date'}}, {...state,last_success:{at:'2026-11-01T00:00:00Z'}}]) {
    assert.deepEqual(classifyRetentionSchedule(invalid,{now}).alarm_reasons,['retention_sweep_unreadable']);
  }
  const issue = { title: STATE_TITLE, body: '[retention-schedule-state]\n'+JSON.stringify(state) };
  let calls=0;
  const paginated = await fetchRetentionSweepHealth({token:'test',owner:'o',repo:'r',now,
    fetchFn:async()=>({ok:true,json:async()=>++calls===1?Array.from({length:100},()=>({title:'another'})):[issue]})});
  assert.equal(calls,2);
  assert.deepEqual(paginated.alarm_reasons,['retention_sweep_stale']);
  for (const rows of [[],[issue,issue],[{...issue,pull_request:{}}],[{...issue,body:'broken'}]]) {
    const result=await fetchRetentionSweepHealth({owner:'o',repo:'r',now,fetchFn:async()=>({ok:true,json:async()=>rows})});
    assert.deepEqual(result.alarm_reasons,['retention_sweep_unreadable']);
  }
}

console.log("check-pipeline-job-health tests passed");

// A frozen green KPI is an incident once two actual producer slots expire.
{
  const generation = (stamp) => ({ generated_at: stamp, sets: [{ set: "fred_macro", status: "fresh" }] });
  const generations = [generation("2026-10-10T09:40:00Z"), generation("2026-10-10T02:40:00Z")];
  const crons = ["30 2 * * *", "30 9 * * *"];
  assert.equal(classifyKpiGenerationStoppage(generations,
    { now: Date.parse("2026-10-11T03:45:00Z"), crons }).status, "ok", "one missed declared slot is tolerated");
  assert.equal(classifyKpiGenerationStoppage(generations,
    { now: Date.parse("2026-10-11T10:29:00Z"), crons }).status, "ok", "the current build retains its execution allowance");
  const frozen = classifyKpiGenerationStoppage(generations, { now: Date.parse("2026-10-11T10:30:00Z"), crons });
  assert.equal(frozen.status, "alarm");
  assert.equal(frozen.reason, "kpi_generation_stale");
  assert.equal(frozen.missed_generation_slots, 2);
  assert.equal(classifyKpiGenerationStoppage([generations[0]],
    { now: Date.parse("2026-10-11T10:30:00Z"), crons }).status, "alarm", "missing prior history cannot hide a frozen latest generation");
  assert.equal(classifyKpiGenerationStoppage(generations,
    { now: Date.parse("2026-10-11T04:01:00Z"), crons: ["0 * * * *"] }).status, "alarm", "the bound follows a changed producer cadence");
  assert.equal(classifyKpiGenerationStoppage(generations,
    { now: Date.parse("2026-10-10T01:00:00Z"), crons }).status, "unknown", "future generations cannot clear health");
  const fresh = [generation("2026-10-11T10:31:00Z"), generations[0]];
  assert.equal(classifyKpiGenerationStoppage(fresh,
    { now: Date.parse("2026-10-11T10:32:00Z"), crons }).status, "ok");
  assert.match(buildIssueBody([{ kpi_stopped_sets: [], kpi_reason: frozen.reason,
    latest_generated_at: frozen.latest_generated_at, missed_generation_slots: 2, age_hours: frozen.age_hours }]),
    /generation stopped advancing/);
}
