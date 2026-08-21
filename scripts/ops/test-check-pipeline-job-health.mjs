import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPublishOutcomeRecord,
  PUBLISH_OUTCOME_SHARD_SCHEMA,
} from "../lib/publish-outcome-shard.mjs";
import { LANE_REGISTRY } from "../lib/lane-registry.mjs";
import {
  NON_SCHEDULED_WORKFLOW_INCLUSIONS,
  SCHEDULED_WORKFLOW_EXCLUSIONS,
  CADENCE_STATES,
  PLANE_FRESHNESS_ALARM_REASONS,
  PLANE_FRESHNESS_MAX_AGE_HOURS,
  PLANE_FRESHNESS_MODE_AGE,
  PLANE_FRESHNESS_MODE_SOURCE_CHANGE,
  freshnessModeForFamily,
  PLANE_PUBLISH_ALARM_REASONS,
  PLANE_PUBLISH_OUTCOME_BINDINGS,
  assertDeclaredScheduleGraceContracts,
  attachPublishOutcomeAlarms,
  attachWorkflowCadence,
  buildWorkflowRunsUrl,
  computeFailureStreak,
  deriveFailureStreakThreshold,
  deriveFamilyFreshness,
  derivePublishOutcomeProjection,
  deriveWorkflowCadenceProjection,
  deriveWorkflowWatchPolicy,
  QUEUE_EVICTION_INSPECTION_LIMIT,
  annotateQueueEvictions,
  evaluateWorkflow,
  isQueueEvictedRun,
  mergeWorkflowRunBatches,
  parseWorkflowRunsPayload,
  runtimeSlotKey,
} from "./check-pipeline-job-health.mjs";

assert.equal(runtimeSlotKey("update-manifest.yml", "30 2 * * *", null), null);
assert.equal(runtimeSlotKey("update-manifest.yml", "30 2 * * *", ""), null);

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

// The registry binding map is authoritative; alarm QA validates each binding
// against the same registry workflow policy instead of maintaining a second
// 20+ row copy that can omit a new publisher. Lane-owned publishers must name
// a real lane. A lane-less publisher must be explicitly declared as a platform
// publisher (the computed-signals coordinator case).
assert.equal(Object.keys(PLANE_PUBLISH_OUTCOME_BINDINGS).length, 24);
for (const [family, binding] of Object.entries(PLANE_PUBLISH_OUTCOME_BINDINGS)) {
  assert.ok(LANE_REGISTRY.workflow_policies[binding.workflow], `${family} workflow policy must be declared`);
  assert.ok(
    LANE_REGISTRY.workflow_policies[binding.workflow].stages.always_if_exists.some(
      (spec) => spec.path === `data/admin/data-supply-state/publish-outcomes/${family}.json`,
    ),
    `${family} workflow must authorize its exact outcome shard`,
  );
  const lane = LANE_REGISTRY.lanes.find((candidate) => candidate.id === binding.lane_id);
  if (lane) continue;
  assert.equal(
    LANE_REGISTRY.workflow_classes[binding.workflow]?.class,
    "platform_publisher",
    `${family} binding without a lane must be an explicit platform publisher`,
  );
}
assert.deepEqual(PLANE_PUBLISH_OUTCOME_BINDINGS["computed-signals"], {
  lane_id: "computed_signals",
  workflow: ".github/workflows/coordinate-computed-signals.yml",
});
assert.deepEqual(PLANE_PUBLISH_OUTCOME_BINDINGS["global-scouter"], {
  lane_id: "global_scouter",
  workflow: ".github/workflows/global-scouter-shadow-publish.yml",
});
const globalScouterWorkflow = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".github/workflows/global-scouter-shadow-publish.yml"),
  "utf8",
);
assert.match(
  globalScouterWorkflow,
  /node scripts\/publish-cloud-data-generation\.mjs --family=global-scouter --json/,
  "Global Scouter caller must use the strict publisher command",
);
assert.match(
  globalScouterWorkflow,
  /node scripts\/persist-cloud-publish-outcome\.mjs --family=global-scouter --workflow=\.github\/workflows\/global-scouter-shadow-publish\.yml --publisher-outcome=/,
  "Global Scouter caller must persist its exact outcome binding",
);

const outcomeShard = (family, records) => ({
  schema_version: PUBLISH_OUTCOME_SHARD_SCHEMA,
  family,
  records,
});
const outcomeRecord = (family, result, observedAt) => buildPublishOutcomeRecord({
  family,
  result,
  observedAt,
});
// Freshness is time-dependent by definition, so every outcome fixture below
// pins the clock. Left to wall time these contracts would pass today and fail
// tomorrow for a reason unrelated to the code under test — the fixtures' own
// records would simply age past the ceiling.
const FIXTURE_NOW = new Date("2026-08-10T03:00:00Z");

{
  const projection = derivePublishOutcomeProjection({
    now: FIXTURE_NOW,
    shards: {
      "fred-macro": outcomeShard("fred-macro", [
        outcomeRecord("fred-macro", "gate_blocked", "2026-08-10T01:00:00Z"),
      ]),
    },
  });
  const [gated] = attachPublishOutcomeAlarms([
    { file: "fetch-fred-macro.yml", status: "ok", alarming: false, alarm_reasons: [] },
  ], projection);
  assert.equal(gated.status, "alarm", "latest gate_blocked outcome must page");
  assert.equal(gated.alarming, true);
  // Two axes, both true and neither hiding the other: the latest result is a
  // gate refusal, AND this family has no successful publish on record at all,
  // which is an unavailable rather than a healthy — there is nothing to serve
  // honestly and nothing to date staleness from.
  assert.deepEqual(gated.alarm_reasons, [
    PLANE_PUBLISH_ALARM_REASONS.gate_blocked,
    PLANE_FRESHNESS_ALARM_REASONS.unavailable,
  ]);
  assert.equal(gated.plane_publish_outcome.result, "gate_blocked");
  assert.equal(gated.plane_publish_outcome.freshness.state, "unavailable");
  assert.equal(gated.plane_publish_outcome.freshness.last_success_at, null);
}

{
  for (const failureResult of ["gate_blocked", "failed"]) {
    const projection = derivePublishOutcomeProjection({
      now: FIXTURE_NOW,
      shards: {
        "fred-macro": outcomeShard("fred-macro", [
          outcomeRecord("fred-macro", failureResult, "2026-08-10T01:00:00Z"),
          outcomeRecord("fred-macro", "published", "2026-08-10T02:00:00Z"),
        ]),
      },
    });
    const [published] = attachPublishOutcomeAlarms([
      {
        file: "fetch-fred-macro.yml",
        status: "alarm",
        alarming: true,
        alarm_reasons: ["failure_streak", PLANE_PUBLISH_ALARM_REASONS[failureResult]],
      },
    ], projection);
    assert.equal(published.plane_publish_outcome.result, "published");
    assert.equal(published.status, "alarm", "published must not clear canonical failure alarms");
    assert.deepEqual(published.alarm_reasons, ["failure_streak"], `${failureResult} must clear only its plane reason`);
  }
}

{
  const projection = derivePublishOutcomeProjection({
    now: FIXTURE_NOW,
    shards: {
      "fred-macro": outcomeShard("fred-macro", [
        outcomeRecord("fred-macro", "gate_blocked", "2026-08-10T01:00:00Z"),
        outcomeRecord("fred-macro", "resumed", "2026-08-10T02:00:00Z"),
      ]),
    },
  });
  const [resumed] = attachPublishOutcomeAlarms([
    {
      file: "fetch-fred-macro.yml",
      status: "alarm",
      alarming: true,
      alarm_reasons: ["failure_streak", PLANE_PUBLISH_ALARM_REASONS.gate_blocked],
    },
  ], projection);
  assert.equal(resumed.plane_publish_outcome.result, "resumed");
  assert.equal(resumed.status, "alarm", "resumed must not clear canonical failure alarms");
  assert.deepEqual(resumed.alarm_reasons, ["failure_streak"], "resumed clears only plane reasons");
}

{
  for (const successResult of ["published", "resumed"]) {
    const projection = derivePublishOutcomeProjection({
    now: FIXTURE_NOW,
      shards: {
        "fred-macro": outcomeShard("fred-macro", [
          outcomeRecord("fred-macro", "gate_blocked", "2026-08-10T01:00:00Z"),
          outcomeRecord("fred-macro", successResult, "2026-08-10T02:00:00Z"),
        ]),
      },
    });
    const [cleared] = attachPublishOutcomeAlarms([{
      file: "fetch-fred-macro.yml",
      status: "ok",
      alarming: false,
      alarm_reasons: [PLANE_PUBLISH_ALARM_REASONS.gate_blocked],
    }], projection);
    assert.equal(cleared.status, "ok", `${successResult} must close a plane-only alarm`);
    assert.equal(cleared.alarming, false);
    assert.deepEqual(cleared.alarm_reasons, []);
  }
}

{
  const outOfOrder = derivePublishOutcomeProjection({
    now: FIXTURE_NOW,
    shards: {
      "fred-macro": outcomeShard("fred-macro", [
        outcomeRecord("fred-macro", "published", "2026-08-10T03:00:00Z"),
        outcomeRecord("fred-macro", "failed", "2026-08-10T01:00:00Z"),
      ]),
    },
  });
  assert.equal(outOfOrder.get("fetch-fred-macro.yml").result, "published", "older array tail must not beat newer evidence");

  const equalTimestamp = derivePublishOutcomeProjection({
    now: FIXTURE_NOW,
    shards: {
      "fred-macro": outcomeShard("fred-macro", [
        outcomeRecord("fred-macro", "failed", "2026-08-10T03:00:00Z"),
        outcomeRecord("fred-macro", "published", "2026-08-10T03:00:00Z"),
      ]),
    },
  });
  assert.equal(equalTimestamp.get("fetch-fred-macro.yml").result, "published", "equal timestamps use later append order");
}

{
  const projection = derivePublishOutcomeProjection({
    now: FIXTURE_NOW,
    shards: {
      "fred-macro": outcomeShard("fred-macro", [
        outcomeRecord("fred-macro", "gate_blocked", "2026-08-10T01:00:00Z"),
      ]),
      sentiment: outcomeShard("sentiment", [
        outcomeRecord("sentiment", "published", "2026-08-10T02:00:00Z"),
      ]),
    },
  });
  const classified = attachPublishOutcomeAlarms([
    { file: "fetch-fred-macro.yml", status: "ok", alarming: false, alarm_reasons: [] },
    { file: "fetch-sentiment.yml", status: "ok", alarming: false, alarm_reasons: [] },
  ], projection);
  assert.equal(classified[0].status, "alarm");
  assert.equal(classified[0].plane_publish_outcome.family, "fred-macro");
  assert.equal(classified[1].status, "ok");
  assert.equal(classified[1].plane_publish_outcome.family, "sentiment");
  assert.deepEqual(classified[1].alarm_reasons, [], "one family alarm must not contaminate another workflow");
}

{
  const projection = derivePublishOutcomeProjection({
    now: FIXTURE_NOW,
    shards: {
      sentiment: outcomeShard("sentiment", [
        outcomeRecord("sentiment", "failed", "2026-08-10T03:00:00Z"),
      ]),
    },
  });
  const [failed] = attachPublishOutcomeAlarms([
    { file: "fetch-sentiment.yml", status: "ok", alarming: false, alarm_reasons: [] },
  ], projection);
  assert.equal(failed.status, "alarm");
  // Both axes again: the latest result failed, and with no success anywhere in
  // the history this family has nothing fresh to serve either.
  assert.deepEqual(failed.alarm_reasons, [
    PLANE_PUBLISH_ALARM_REASONS.failed,
    PLANE_FRESHNESS_ALARM_REASONS.unavailable,
  ]);
  assert.equal(failed.plane_publish_outcome.freshness.state, "unavailable");
}

// D3 static-LKG aging, owner-selected: option A with a 60-hour ceiling. The
// four transitions are pinned here rather than trusted, because the two
// triggers are independent and a state machine that only ever gets exercised in
// production is a state machine nobody has read.
{
  const at = (hours) => new Date(Date.parse("2026-08-10T00:00:00Z") + hours * 3_600_000).toISOString();
  const freshnessOf = (records, nowHours) => deriveFamilyFreshness({
    records: records.map(([hours, result]) => outcomeRecord("sentiment", result, at(hours))),
    now: new Date(Date.parse(at(nowHours))),
  });

  const healthy = freshnessOf([[0, "published"], [5, "published"]], 10);
  assert.equal(healthy.state, "healthy");
  assert.equal(healthy.consecutive_non_success, 0);
  assert.equal(healthy.last_success_at, at(5), "last-success timestamp must be reported, not implied");

  // One failed cycle is delayed, not unavailable: the LKG is still served and
  // the operator is told, which is the whole point of the middle state.
  const delayed = freshnessOf([[0, "published"], [5, "failed"]], 10);
  assert.equal(delayed.state, "delayed");
  assert.equal(delayed.consecutive_non_success, 1);
  assert.deepEqual(delayed.triggered_by, []);

  const byCount = freshnessOf([[0, "published"], [5, "failed"], [6, "failed"]], 10);
  assert.equal(byCount.state, "unavailable");
  assert.deepEqual(byCount.triggered_by, ["consecutive_non_success"]);

  // A cycle that never fired writes no record at all, so the counter cannot see
  // it. Age is the trigger that catches a true miss, and these two must stay
  // independent for that reason.
  const byAge = freshnessOf([[0, "published"]], 61);
  assert.equal(byAge.state, "unavailable");
  assert.deepEqual(byAge.triggered_by, ["source_age_hours"]);
  assert.equal(byAge.consecutive_non_success, 0);
  assert.ok(byAge.source_age_hours > PLANE_FRESHNESS_MAX_AGE_HOURS);
  assert.equal(freshnessOf([[0, "published"]], 60).state, "healthy", "the ceiling is exclusive, not off by one");

  // Recovery clears automatically: the next success resets the counter and is
  // reported as a recovery edge rather than as an indistinguishable healthy.
  const recovered = freshnessOf([[0, "published"], [5, "failed"], [6, "published"]], 10);
  assert.equal(recovered.state, "healthy");
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.consecutive_non_success, 0);
  assert.equal(freshnessOf([[0, "published"], [5, "published"]], 10).recovered, false);

  assert.equal(deriveFamilyFreshness({ records: [] }), null, "no history must not manufacture a state");
}

// A source-change family is judged by whether its export is PUBLISHED, not by
// how long ago that happened. The ETF-sized ceiling would have reported a
// permanent unavailable on a family that was perfectly current.
{
  const at = (hours) => new Date(Date.parse("2026-08-10T00:00:00Z") + hours * 3_600_000).toISOString();
  const published = (sourceAsOf, hours = 0) => buildPublishOutcomeRecord({
    family: "global-scouter",
    result: "published",
    observedAt: at(hours),
    sourceAsOf,
  });
  const sourceChangeOf = ({ publishedAsOf, canonical, nowHours }) => deriveFamilyFreshness({
    records: [published(publishedAsOf)],
    now: new Date(Date.parse(at(nowHours))),
    mode: PLANE_FRESHNESS_MODE_SOURCE_CHANGE,
    canonicalSourceAsOf: canonical,
  });

  // Far past the age ceiling and still healthy: nothing changed, so nothing is late.
  const aged = sourceChangeOf({ publishedAsOf: "2026-08-14", canonical: "2026-08-14", nowHours: 500 });
  assert.equal(aged.state, "healthy");
  assert.ok(aged.source_age_hours > PLANE_FRESHNESS_MAX_AGE_HOURS, "the fixture must actually outlive the ceiling");
  assert.deepEqual(aged.triggered_by, []);
  assert.equal(aged.max_age_hours, null, "an inapplicable ceiling must not be reported as a number");
  assert.equal(aged.unpublished_source_change, false);

  // A moved export is delayed, not unavailable: the published generation is still
  // serving and still honest, there is simply newer source sitting behind it.
  const pending = sourceChangeOf({ publishedAsOf: "2026-08-14", canonical: "2026-08-18", nowHours: 1 });
  assert.equal(pending.state, "delayed");
  assert.deepEqual(pending.triggered_by, ["unpublished_source_change"]);
  assert.equal(pending.published_source_as_of, "2026-08-14");
  assert.equal(pending.canonical_source_as_of, "2026-08-18");

  // An unreadable clock is unavailable, never healthy: answering an unanswered
  // question "current" would be the one unsafe guess.
  const unknown = sourceChangeOf({ publishedAsOf: "2026-08-14", canonical: null, nowHours: 500 });
  assert.equal(unknown.unpublished_source_change, null);
  assert.equal(unknown.state, "unavailable");
  assert.deepEqual(unknown.triggered_by, ["source_clock_unknown"]);

  // The published side is nullable by schema, so it trips the same guard.
  const unpublishedClock = deriveFamilyFreshness({
    records: [buildPublishOutcomeRecord({ family: "global-scouter", result: "published", observedAt: at(0) })],
    now: new Date(Date.parse(at(1))),
    mode: PLANE_FRESHNESS_MODE_SOURCE_CHANGE,
    canonicalSourceAsOf: "2026-08-14",
  });
  assert.equal(unpublishedClock.state, "unavailable");
  assert.deepEqual(unpublishedClock.triggered_by, ["source_clock_unknown"]);

  // Only the AGE trigger is withdrawn. A producer that fails twice is still
  // unavailable, because that is a broken producer rather than a quiet source.
  const failedTwice = deriveFamilyFreshness({
    records: [
      published("2026-08-14"),
      buildPublishOutcomeRecord({ family: "global-scouter", result: "failed", observedAt: at(1) }),
      buildPublishOutcomeRecord({ family: "global-scouter", result: "failed", observedAt: at(2) }),
    ],
    now: new Date(Date.parse(at(3))),
    mode: PLANE_FRESHNESS_MODE_SOURCE_CHANGE,
    canonicalSourceAsOf: "2026-08-14",
  });
  assert.equal(failedTwice.state, "unavailable");
  assert.deepEqual(failedTwice.triggered_by, ["consecutive_non_success"]);

  // The publisher registry decides which families are source-change, so there is
  // no second table here to drift from it.
  assert.equal(freshnessModeForFamily("global-scouter"), PLANE_FRESHNESS_MODE_SOURCE_CHANGE);
  assert.equal(freshnessModeForFamily("stockanalysis-etf-detail"), PLANE_FRESHNESS_MODE_AGE);
  assert.equal(freshnessModeForFamily("no-such-family"), PLANE_FRESHNESS_MODE_AGE, "an unknown family keeps its ceiling");
}

{
  const malformed = derivePublishOutcomeProjection({
    now: FIXTURE_NOW,
    shards: {
      "fred-macro": outcomeShard("fred-macro", [
        { family: "fred-macro", result: "gate_blocked" },
      ]),
    },
  });
  const [unchanged] = attachPublishOutcomeAlarms([
    { file: "fetch-fred-macro.yml", status: "ok", alarming: false, alarm_reasons: [] },
  ], malformed);
  assert.equal(unchanged.status, "ok", "malformed shard must not invent an alarm");
  assert.deepEqual(unchanged.alarm_reasons, []);
}

{
  // A shard carrying any other schema_version (or a legacy shape) is not a
  // publish-outcome shard: no projection, no invented alarm.
  const wrongSchema = derivePublishOutcomeProjection({
    now: FIXTURE_NOW,
    shards: {
      "fred-macro": {
        schema_version: "data-supply-publish-outcome-shard/v1",
        family: "fred-macro",
        records: [outcomeRecord("fred-macro", "gate_blocked", "2026-08-10T01:00:00Z")],
      },
    },
  });
  assert.equal(wrongSchema.size, 0, "wrong schema_version must yield no projection");
  const [unchanged] = attachPublishOutcomeAlarms([
    { file: "fetch-fred-macro.yml", status: "ok", alarming: false, alarm_reasons: [] },
  ], wrongSchema);
  assert.equal(unchanged.status, "ok", "wrong schema_version must not invent an alarm");
  assert.deepEqual(unchanged.alarm_reasons, []);
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

// Defect 2: every cadence outcome is explicit.  This fixture deliberately
// joins member-level coverage (not workflow-level guesses), preserves the
// suspected_skip/attempt_gap evidence words, and proves recovered uses only
// canonical KPI runtime recovery for a tracked workflow/cron pair.
{
  const config = {
    lanes: [{
      producer_members: [
        { id: "not_due_member", workflow: ".github/workflows/not-due.yml", schedule: ["0 1 * * *"], cadence_calendar: "utc", cadence_declaration: { kind: "github_workflow" } },
        { id: "overdue_member", workflow: ".github/workflows/overdue.yml", schedule: ["0 2 * * *"], cadence_calendar: "utc", cadence_declaration: { kind: "github_workflow" } },
        { id: "recovered_member", workflow: ".github/workflows/update-manifest.yml", schedule: ["30 2 * * *"], cadence_calendar: "utc", cadence_declaration: { kind: "github_workflow" } },
        { id: "unknown_member", workflow: ".github/workflows/unknown.yml", schedule: ["0 3 * * *"], cadence_calendar: "utc", cadence_declaration: { kind: "github_workflow" } },
      ],
    }],
  };
  const calendars = {
    schedules: [
      { id: "not_due_contract", cron: "0 1 * * *", calendar_id: "utc", grace: { unit: "hours", value: 1 } },
      { id: "overdue_contract", cron: "0 2 * * *", calendar_id: "utc", grace: { unit: "hours", value: 1 } },
      { id: "update_manifest_0230", cron: "30 2 * * *", calendar_id: "utc", grace: { unit: "hours", value: 1 } },
      { id: "unknown_contract", cron: "0 3 * * *", calendar_id: "utc", grace: { unit: "hours", value: 1 } },
    ],
  };
  const recoveredSlot = "update-manifest.yml:30 2 * * *@2026-07-21T02:30Z";
  const recoverySlot = "update-manifest.yml:30 2 * * *@2026-07-22T02:30Z";
  const projection = deriveWorkflowCadenceProjection({
    watched: [
      { file: "not-due.yml" },
      { file: "overdue.yml" },
      { file: "update-manifest.yml" },
      { file: "no-declaration.yml" },
      { file: "unknown.yml" },
    ],
    coverage: {
      rows: [
        { workflow: ".github/workflows/not-due.yml", member_id: "not_due_member", cron: "0 1 * * *", state: "observed", expected_at: "2026-07-22T01:00:00.000Z" },
        { workflow: ".github/workflows/overdue.yml", member_id: "overdue_member", cron: "0 2 * * *", state: "suspected_skip", expected_at: "2026-07-22T02:00:00.000Z" },
        { workflow: ".github/workflows/update-manifest.yml", member_id: "recovered_member", cron: "30 2 * * *", state: "attempt_gap", expected_at: "2026-07-21T02:30:00.000Z" },
      ],
      pre_activation_members: [
        {
          lane_id: "unknown_lane",
          member_id: "unknown_member",
          workflow: ".github/workflows/unknown.yml",
          cron: "0 3 * * *",
          activated_at: "2026-07-23T00:00:00Z",
          first_eligible_at: "2026-07-24T03:00:00.000Z",
        },
      ],
    },
    kpiRuntime: {
      slots: { missed_slot_keys: [recoveredSlot], satisfied_slot_keys: [recoverySlot] },
      successful_snapshot_history: [{
        slot_key: recoverySlot,
        built_at: "2026-07-22T03:00:00.000Z",
        workflow: "Update Manifest",
        status: "ready",
        run_attempt: 1,
      }],
    },
    config,
    calendars,
  });
  assert.deepEqual(projection.state_counts, {
    not_due: 2,
    overdue: 1,
    recovered: 1,
    no_declaration: 1,
    unknown: 0,
  });
  assert.deepEqual(
    projection.workflows.map((row) => [row.file, row.state, row.evidence]),
    [
      ["not-due.yml", "not_due", []],
      ["overdue.yml", "overdue", ["suspected_skip"]],
      ["update-manifest.yml", "recovered", ["attempt_gap"]],
      ["no-declaration.yml", "no_declaration", []],
      ["unknown.yml", "not_due", []],
    ],
  );
  const joined = attachWorkflowCadence([{ file: "overdue.yml", label: "Overdue", status: "ok" }], projection);
  assert.equal(joined[0].status, "alarm", "unrecovered overdue after declared grace must page");
  assert.equal(joined[0].alarming, true);
  assert.deepEqual(joined[0].alarm_reasons, ["unrecovered_overdue"]);
  assert.equal(joined[0].cadence_status, "overdue");

  // Mutation proof: neither absent grace nor an ambiguous/missing schedule may
  // silently fall back to zero, KPI's 360 minutes, or no_declaration.
  const missingGrace = structuredClone(calendars);
  delete missingGrace.schedules.find((row) => row.id === "overdue_contract").grace;
  assert.throws(
    () => assertDeclaredScheduleGraceContracts({ config, calendars: missingGrace }),
    /schedule overdue_contract has no grace block/,
  );
  const missingContract = structuredClone(calendars);
  missingContract.schedules = missingContract.schedules.filter((row) => row.id !== "overdue_contract");
  assert.throws(
    () => assertDeclaredScheduleGraceContracts({ config, calendars: missingContract }),
    /declared schedule overdue\.yml:0 2 \* \* \* must have exactly one grace contract/,
  );
}

// fh-538: paging sensitivity comes from the existing cadence declaration, not
// a second workflow-name table. A monthly declaration pages on its first
// completed failure; daily/hourly declarations retain the two-failure noise
// guard. Slot drift remains the separate overdue join proved above.
{
  const calendars = {
    schedules: [
      { id: "monthly", cron: "0 9 1 * *", calendar_id: "utc", grace: { unit: "hours", value: 1 } },
      { id: "weekly", cron: "0 7 * * 0", calendar_id: "utc", grace: { unit: "hours", value: 1 } },
      { id: "daily", cron: "0 6 * * *", calendar_id: "utc", grace: { unit: "hours", value: 1 } },
      { id: "hourly", cron: "23 * * * *", calendar_id: "utc", grace: { unit: "hours", value: 1 } },
    ],
  };
  const member = (id, file, cron) => ({
    id,
    workflow: `.github/workflows/${file}`,
    schedule: [cron],
    cadence_calendar: "utc",
    cadence_declaration: { kind: "github_workflow" },
  });
  const config = {
    lanes: [{ producer_members: [
      member("monthly_member", "monthly.yml", "0 9 1 * *"),
      member("daily_member", "daily.yml", "0 6 * * *"),
      member("hourly_member", "hourly.yml", "23 * * * *"),
    ] }],
  };
  const watched = [
    { file: "monthly.yml", label: "Monthly" },
    { file: "daily.yml", label: "Daily" },
    { file: "hourly.yml", label: "Hourly" },
  ];
  const projection = deriveWorkflowCadenceProjection({ watched, config, calendars });
  assert.deepEqual(
    projection.workflows.map((row) => [row.file, row.failure_streak_threshold]),
    [["monthly.yml", 1], ["daily.yml", 2], ["hourly.yml", 2]],
    "the same declared cron rows must calibrate monthly=1 and daily/hourly=2",
  );

  const calibrated = attachWorkflowCadence(watched, projection);
  const [monthly, daily, hourly] = calibrated.map((workflow) => evaluateWorkflow(workflow, [F(1), S(0)]));
  assert.equal(monthly.status, "alarm", "one monthly completed failure must page");
  assert.equal(daily.status, "ok", "one daily completed failure must not page");
  assert.equal(hourly.status, "ok", "one hourly completed failure must not page");
  assert.equal(hourly.failure_streak_threshold, 2,
    "hourly stays at 2, not 3: completed failures are evidence and slot drift is the overdue join");

  // Bidirectional mutation: cadence alone flips the decision in both directions.
  const monthlyToDaily = structuredClone(config);
  monthlyToDaily.lanes[0].producer_members[0].schedule = ["0 6 * * *"];
  const mutatedMonthly = deriveWorkflowCadenceProjection({ watched, config: monthlyToDaily, calendars });
  const monthlyAfterMutation = evaluateWorkflow(
    attachWorkflowCadence(watched, mutatedMonthly)[0],
    [F(1), S(0)],
  );
  assert.equal(monthlyAfterMutation.failure_streak_threshold, 2);
  assert.equal(monthlyAfterMutation.status, "ok", "monthly -> daily must remove the one-failure page");

  const dailyToMonthly = structuredClone(config);
  dailyToMonthly.lanes[0].producer_members[1].schedule = ["0 9 1 * *"];
  const mutatedDaily = deriveWorkflowCadenceProjection({ watched, config: dailyToMonthly, calendars });
  const dailyAfterMutation = evaluateWorkflow(
    attachWorkflowCadence(watched, mutatedDaily)[1],
    [F(1), S(0)],
  );
  assert.equal(dailyAfterMutation.failure_streak_threshold, 1);
  assert.equal(dailyAfterMutation.status, "alarm", "daily -> monthly must add the one-failure page");

  assert.equal(
    deriveFailureStreakThreshold([{ cron: "0 7 * * 0" }]),
    1,
    "the exact weekly boundary must page on the first completed failure",
  );
  assert.equal(
    deriveFailureStreakThreshold([{ cron: "0 7 * * 0" }, { cron: "0 6 * * *" }]),
    2,
    "a weekly+daily workflow uses its combined effective cadence and keeps the two-failure guard",
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
    ["push", "schedule", "workflow_run"],
    "every declared automatic trigger must count while manual dispatch stays excluded",
  );
  assert.deepEqual(
    policy.watched.find((row) => row.file === "slickcharts-history.yml")?.events,
    ["schedule"],
    "manual remediation runs must never contribute to the alarm streak",
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
    ["schedule"],
    "the probe contributes its scheduled cadence only; manual dispatch stays excluded",
  );
  const calendars = JSON.parse(fs.readFileSync(path.join(repoRoot, "scripts", "lib", "data-supply-detection-calendars.json"), "utf8"));
  const initialCadence = deriveWorkflowCadenceProjection({
    watched: policy.watched,
    coverage: { rows: [] },
    calendars,
  });
  assert.deepEqual(Object.keys(initialCadence.state_counts), CADENCE_STATES, "first-evaluation dry run must expose all five states");
  assert.equal(
    Object.values(initialCadence.state_counts).reduce((sum, count) => sum + count, 0),
    policy.watched.length,
    "the first 31-workflow evaluation must classify every watched workflow exactly once",
  );
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
  // A lost scheduled slot is RESOLVED by any strictly newer successful run,
  // including workflow_dispatch. The 2026-08-01 eviction storm left monthly
  // lanes (OECD, slickcharts-monthly) paging hourly toward their NEXT natural
  // slot on September 1 even after repeated dispatch successes refreshed the
  // same data — recovery evidence the alarm never fetched.
  const result = evaluateWorkflow(
    { file: "fetch-oecd-cli.yml", label: "OECD", events: ["schedule"] },
    [
      { ...S(30700000010), event: "workflow_dispatch" },
      { ...C(30700000001), event: "schedule", jobs_empty: true },
      { ...S(30690000000), event: "schedule" },
    ],
  );
  assert.equal(result.status, "ok", "a newer successful run resolves the lost slot");
  assert.equal(result.lost_schedule_slot_count, 0);
  assert.equal(result.resolved_lost_schedule_slot_count, 1);
  assert.deepEqual(result.lost_schedule_slot_run_urls, []);
  assert.deepEqual(result.alarm_reasons, []);
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
  // A failure streak is recovered by a strictly newer successful run of any
  // event. slickcharts-monthly live case: schedule failed 07-01, its 08-01
  // slot was evicted, three dispatch successes then proved the producer end
  // to end — yet the streak could only break on the NEXT monthly slot.
  const result = evaluateWorkflow(
    { file: "slickcharts-monthly.yml", label: "Monthly", events: ["schedule"] },
    [
      { ...S(30700000010), event: "workflow_dispatch" },
      { ...F(30700000001), event: "schedule" },
      { ...S(30690000000), event: "schedule" },
    ],
  );
  assert.equal(result.status, "ok", "a newer success of any event recovers the streak");
  assert.equal(result.failure_streak_recovered, true);
  assert.deepEqual(result.alarm_reasons, []);
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
}

{
  // Mixed ages: only slots older than the newest success resolve; a slot
  // newer than every success keeps paging.
  const result = evaluateWorkflow(
    { file: "fetch-oecd-cli.yml", label: "OECD", events: ["schedule"] },
    [
      { ...C(30700000020), event: "schedule", jobs_empty: true },
      { ...S(30700000010), event: "workflow_dispatch" },
      { ...C(30700000001), event: "schedule", jobs_empty: true },
    ],
  );
  assert.equal(result.status, "alarm");
  assert.equal(result.lost_schedule_slot_count, 1);
  assert.equal(result.resolved_lost_schedule_slot_count, 1);
  assert.deepEqual(result.lost_schedule_slot_run_urls, ["https://gh/run/30700000020"]);
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
    "the first cadence dry run covers every current watched workflow",
  );
  assert.equal(result.workflows.length, result.watched.length, "the first cadence dry run emits one classified row per watched workflow");
  assert.deepEqual(Object.keys(result.cadence_state_counts), CADENCE_STATES);
  assert.equal(
    Object.values(result.cadence_state_counts).reduce((sum, count) => sum + count, 0),
    result.watched.length,
    "the five-state count must reconcile to the complete watch inventory",
  );
  // CORRECTED 2026-08-21 (B-394). This used to require the checked-in fixture to
  // contain at least one overdue row, which made the contract depend on the
  // fleet being broken: it passed only while some real family was overdue, and
  // failed the moment the last one was fixed. fetch-yf-finance was that family,
  // and giving its ETF cron an observation moved it to not_due - the fix landing
  // is what turned this red.
  //
  // What the assertion was for is kept and is exercised deterministically at the
  // attachWorkflowCadence check above, on a constructed overdue projection. What
  // remains here is the invariant that does not need an incident to exist: any
  // overdue row present in the live projection must page, and the state must be
  // one the projection can actually produce.
  const overdueRows = result.workflows.filter((row) => row.cadence_status === "overdue");
  assert.ok(
    overdueRows.every((row) => row.status === "alarm"
      && row.alarm_reasons.includes("unrecovered_overdue")),
    "an unrecovered slot beyond declared grace must remain a paging incident",
  );
  assert.ok(
    result.workflows.every((row) => CADENCE_STATES.includes(row.cadence_status)),
    "every live row must carry a declared cadence state",
  );
  // A live row must never be "unknown" without the coverage artifact being
  // absent outright. An unknown here means the KPI's coverage rows no longer key
  // to the declared bindings - which is exactly what a member-id change does
  // before the detection report and KPI are rebuilt, and it silently removes a
  // workflow from cadence watch rather than alarming.
  const unknownRows = result.workflows.filter((row) => row.cadence_status === "unknown");
  assert.deepEqual(
    unknownRows.map((row) => row.file),
    [],
    "a workflow whose declared bindings do not resolve in the KPI coverage drops out of cadence "
      + "watch silently; rebuild data/admin/data-supply-detection-floor.json and the KPI artifact",
  );
}

// Workflow YAML sanity: mirror the budget-alarm shape and honor #357 (no runner
// context in job-level env).
{
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "pipeline-failure-alarm.yml"),
    "utf8",
  );
  const updateManifestWorkflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "update-manifest.yml"),
    "utf8",
  );
  const deployWorkerWorkflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "deploy-worker.yml"),
    "utf8",
  );
  const edgeDailyWorkflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "fenok-edge-daily.yml"),
    "utf8",
  );
  assert.match(workflow, /cron: '23 \* \* \* \*'/, "hourly schedule at minute 23");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(
    workflow,
    /workflow_run:\s*\n\s+workflows:\s*\['Update Manifest', 'Deploy Worker \(Cloudflare\)', 'Fenok Edge Daily Data'\]\s*\n\s+types:\s*\[completed\]/,
    "completed runs from the three fast-path publisher workflows trigger the alarm immediately",
  );
  assert.match(updateManifestWorkflow, /^name: Update Manifest$/m, "workflow_run display name stays exact");
  assert.match(deployWorkerWorkflow, /^name: Deploy Worker \(Cloudflare\)$/m, "workflow_run display name stays exact");
  assert.match(edgeDailyWorkflow, /^name: Fenok Edge Daily Data$/m, "workflow_run display name stays exact");
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /group: pipeline-failure-alarm/, "alarm runs share one serialized concurrency group");
  assert.match(workflow, /cancel-in-progress: false/, "concurrency must not cancel in progress");
  assert.match(workflow, /node scripts\/ops\/check-pipeline-job-health\.mjs/);
  assert.doesNotMatch(
    workflow,
    /run: npm --prefix 100xfenok-next run qa:pipeline-job-health/,
    "a contract-test failure must not block the production health scan",
  );
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "100xfenok-next", "package.json"), "utf8"));
  assert.equal(
    packageJson.scripts["qa:pipeline-job-health"],
    "node ../scripts/ops/test-check-pipeline-job-health.mjs",
    "the watch-policy contract must have a stable package entrypoint",
  );
  assert.match(
    packageJson.scripts["qa:alarm-state"],
    /^npm run qa:pipeline-job-health && /,
    "the aggregate alarm QA must include the watch-policy contract",
  );
  const validateWorkflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "validate-workflows.yml"),
    "utf8",
  );
  assert.match(
    validateWorkflow,
    /- name: Validate alarm workflow contracts\s+run: npm --prefix 100xfenok-next run qa:alarm-state/,
    "workflow changes must execute the aggregate alarm contract in CI",
  );
  for (const guardedPath of [
    "scripts/ops/check-pipeline-job-health.mjs",
    "scripts/ops/emit-alarm-state.mjs",
    "scripts/ops/test-check-pipeline-job-health.mjs",
    "scripts/ops/test-emit-alarm-state.mjs",
    "scripts/test-pipeline-failure-alarm-manifest.mjs",
  ]) {
    assert.equal(
      (validateWorkflow.match(new RegExp(guardedPath.replaceAll(".", "\\."), "g")) || []).length,
      2,
      `${guardedPath} must trigger both push and pull_request validation`,
    );
  }
  assert.match(workflow, /continue-on-error: true/);
  assert.match(workflow, /steps\.pipeline\.outcome == 'failure'/);
  assert.equal(
    (workflow.match(/if: steps\.pipeline\.outcome == 'failure'/g) || []).length,
    2,
    "healthy workflow_run completions remain quiet: issue preparation and issue update are alarm-only, and the run concludes green when reporting succeeded",
  );
  assert.doesNotMatch(workflow, /\$\{\{\s*runner\./, "must not reference the runner context in expressions (#357)");
}

console.log("check-pipeline-job-health tests passed");
