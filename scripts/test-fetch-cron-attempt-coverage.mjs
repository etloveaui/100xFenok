#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";
import { buildFetchCronAttemptCoverage } from "./build-data-supply-detection-floor.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.join(__dirname, "fixtures", "data_supply", "detection_floor");
const expected = JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, "cases.expected.json"), "utf8"));
const calendars = JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, "calendars.fixture.json"), "utf8"));
const canonicalCalendars = JSON.parse(fs.readFileSync(path.join(__dirname, "lib", "data-supply-detection-calendars.json"), "utf8"));
const baseline = expected.baseline.expected_report;

const severity = { ready: 0, unobserved: 1, stale: 2, drift: 3, unavailable: 4 };

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function recomputeCounts(report) {
  const logical = { ready: 0, stale: 0, drift: 0, unavailable: 0, unobserved: 0 };
  const members = { ready: 0, stale: 0, drift: 0, unavailable: 0, unobserved: 0 };
  for (const row of report.lanes) {
    logical[row.status] += 1;
    if (row.monitoring_mode === "composite") {
      for (const member of row.members) members[member.status] += 1;
    } else {
      members[row.status] += 1;
    }
  }
  report.counts = {
    ...logical,
    producer_members_ready: members.ready,
    producer_members_stale: members.stale,
    producer_members_drift: members.drift,
    producer_members_unavailable: members.unavailable,
    producer_members_unobserved: members.unobserved,
  };
  return report;
}

function setNonCompositeEndpoint(report, laneId, endpoint) {
  const row = report.lanes.find((candidate) => candidate.id === laneId);
  assert.equal(row.monitoring_mode, "post_fetch_artifact");
  row.endpoint = endpoint;
  if (severity[endpoint.status] >= severity[row.artifact.status]) {
    row.status = endpoint.status;
    row.reason = endpoint.reason;
  } else {
    row.status = row.artifact.status;
    row.reason = row.artifact.reason;
  }
  return recomputeCounts(report);
}

function rowOf(coverage, laneId, cron = null) {
  const rows = coverage.rows.filter((row) => row.lane_id === laneId && (cron === null || row.cron === cron));
  assert.equal(rows.length, 1, `${laneId}:${cron ?? "*"} cardinality`);
  return rows[0];
}

const scheduledMembers = DATA_SUPPLY_DETECTION_CONFIG.lanes
  .flatMap((lane) => lane.producer_members)
  .filter((member) => member.cadence_declaration?.kind === "github_workflow" && member.schedule.length > 0);
const scheduleBindings = scheduledMembers.reduce((sum, member) => sum + member.schedule.length, 0);
assert.equal(scheduledMembers.length, 31);
assert.equal(scheduleBindings, 35);

// Schedule parity. The detection config declares when a lane is expected to
// run, and the observer attributes a missed slot against that declaration. If
// a workflow's cron shape changes and this list does not, monitoring silently
// stops covering the new slots: that is how stale ETF slots were left behind
// a six-slot declaration. Derive the truth from the workflow file instead of
// trusting a hand-maintained list.
function workflowCrons(relativePath) {
  const absolute = path.join(__dirname, "..", relativePath);
  const text = fs.readFileSync(absolute, "utf8");
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .map((line) => /^\s*-\s*cron:\s*['"]([^'"]+)['"]/.exec(line))
    .filter(Boolean)
    .map((match) => match[1]);
}

// One workflow can produce several artifacts on different subsets of its
// crons, so a member declares a subset, not the whole schedule. Two invariants
// hold that together: no member may claim a cron the workflow does not have,
// and every cron the workflow has must be claimed by some member. The second
// is the one that was violated: the shipped ETF slot existed with nobody watching.
const workflowUnion = new Map();
for (const member of scheduledMembers) {
  const evidence = member.cadence_declaration?.evidence;
  assert.ok(evidence, `${member.id}: a scheduled member must name its workflow`);
  const actual = new Set(workflowCrons(evidence));
  assert.ok(actual.size > 0, `${evidence}: no cron found; the extractor or the workflow changed shape`);
  for (const cron of member.schedule) {
    assert.ok(actual.has(cron), `${member.id}: declares '${cron}', absent from ${evidence}`);
  }
  if (!workflowUnion.has(evidence)) workflowUnion.set(evidence, { actual, claimed: new Set() });
  for (const cron of member.schedule) workflowUnion.get(evidence).claimed.add(cron);
}
for (const [evidence, { actual, claimed }] of workflowUnion) {
  const unwatched = [...actual].filter((cron) => !claimed.has(cron));
  assert.deepEqual(unwatched, [], `${evidence}: cron(s) no detection member claims`);
}

// The detection calendar is a second projection of the same workflow contract.
// Keep the promoted SSOT and its test fixture byte-for-data, then require the
// Yahoo schedule set to match fetch-yf-finance.yml exactly (stock + ETF slots).
// A future `:00`/`:07` workflow edit must fail here until the calendar is moved
// with it, preventing the observer from silently watching the wrong minutes.
assert.deepEqual(canonicalCalendars, calendars, "canonical calendar SSOT matches the detection-floor fixture");
const yahooWorkflow = ".github/workflows/fetch-yf-finance.yml";
const yahooWorkflowCrons = new Set(workflowCrons(yahooWorkflow));
const yahooCalendarSchedules = canonicalCalendars.schedules.filter((schedule) => (
  schedule.id === "weekday_2320_utc" || schedule.id === "yahoo_batch_etf_0000_utc"
));
const yahooCalendarCrons = new Set(yahooCalendarSchedules.map((schedule) => schedule.cron));
assert.equal(yahooCalendarSchedules.length, 2, "Yahoo calendar must cover one stock and one ETF slot");
assert.equal(yahooCalendarCrons.size, yahooCalendarSchedules.length, "Yahoo calendar slots must have unique crons");
assert.deepEqual(
  [...yahooCalendarCrons].sort(),
  [...yahooWorkflowCrons].sort(),
  "fetch-yf-finance.yml schedules and Yahoo detection calendar must stay exactly in sync",
);

// The lane this regression exists for: one stock slot plus one ETF slot.
const yahooMember = scheduledMembers.find((member) => member.id === "yahoo_batch_quote_history");
assert.deepEqual(yahooMember.schedule, ["20 23 * * 1-5", "7 0 * * 0-5"]);
assert.equal(
  DATA_SUPPLY_DETECTION_CONFIG.lanes.find((lane) => lane.id === "damodaran")
    ?.producer_members[0]?.activated_at,
  "2026-07-19T15:05:41Z",
);
assert.equal(
  DATA_SUPPLY_DETECTION_CONFIG.lanes.find((lane) => lane.id === "oecd_cli")
    ?.producer_members[0]?.activated_at,
  "2026-07-20T14:20:11Z",
);

// The baseline predates three newly declared workflows. They remain in the
// declaration denominator but must not manufacture expected_at rows.
const coverage = buildFetchCronAttemptCoverage({ report: baseline, calendars });
assert.equal(coverage.schema_version, "fetch-cron-attempt-coverage/v1");
assert.equal(coverage.mode, "shadow");
assert.equal(coverage.deployment_blocking, false);
assert.deepEqual(coverage.counts, {
  scheduled_members: 31,
  schedule_bindings: 31,
  observed: 26,
  suspected_skips: 3,
  attempt_gaps: 2,
});
assert.deepEqual(coverage.pre_activation_members, [
  {
    lane_id: "oecd_cli",
    member_id: "oecd_cli",
    workflow: ".github/workflows/fetch-oecd-cli.yml",
    cron: "0 8 1 * *",
    activated_at: "2026-07-20T14:20:11Z",
    first_eligible_at: "2026-08-01T08:00:00.000Z",
  },
  {
    lane_id: "damodaran",
    member_id: "damodaran",
    workflow: ".github/workflows/fetch-damodaran-shadow.yml",
    cron: "17 11 * * 6",
    activated_at: "2026-07-19T15:05:41Z",
    first_eligible_at: "2026-07-25T11:17:00.000Z",
  },
  {
    lane_id: "yahoo_batch_quote_history",
    member_id: "yahoo_batch_quote_history",
    workflow: ".github/workflows/fetch-yf-finance.yml",
    cron: "20 23 * * 1-5",
    activated_at: "2026-08-01T01:00:13Z",
    first_eligible_at: "2026-08-03T23:20:00.000Z",
  },
  // The single ETF slot fires Sunday-Friday, so its first eligible
  // occurrence after activation is Sunday at 00:07 UTC.
  {
    lane_id: "yahoo_batch_quote_history",
    member_id: "yahoo_batch_quote_history",
    workflow: ".github/workflows/fetch-yf-finance.yml",
    cron: "7 0 * * 0-5",
    activated_at: "2026-08-01T01:00:13Z",
    first_eligible_at: "2026-08-02T00:07:00.000Z",
  },
]);
assert.equal(coverage.rows.some((row) => row.lane_id === "oecd_cli"), false);
assert.equal(coverage.rows.some((row) => row.lane_id === "damodaran"), false);
assert.equal(coverage.rows.some((row) => row.lane_id === "yahoo_batch_quote_history"), false);
const configWithoutActivation = clone(DATA_SUPPLY_DETECTION_CONFIG);
for (const lane of configWithoutActivation.lanes.filter((row) => (
  row.id === "oecd_cli" || row.id === "damodaran" || row.id === "yahoo_batch_quote_history"
))) delete lane.producer_members[0].activated_at;
const unboundedCoverage = buildFetchCronAttemptCoverage({
  report: null,
  calendars,
  nowValue: baseline.generated_at,
  config: configWithoutActivation,
});
const boundedMissingReportCoverage = buildFetchCronAttemptCoverage({
  report: null,
  calendars,
  nowValue: baseline.generated_at,
});
const unaffectedRows = (document) => document.rows.filter((row) => (
  row.lane_id !== "oecd_cli" && row.lane_id !== "damodaran" && row.lane_id !== "yahoo_batch_quote_history"
));
assert.deepEqual(
  unaffectedRows(boundedMissingReportCoverage),
  unaffectedRows(unboundedCoverage),
  "activation declarations must not alter any undeclared lane row",
);
assert.equal(coverage.status, "warning");
assert.equal(rowOf(coverage, "gdelt_news_tone").state, "suspected_skip");
assert.equal(rowOf(coverage, "apewisdom_attention").state, "suspected_skip");
assert.equal(coverage.rows.filter((row) => row.lane_id === "yahoo_etf_fallback").length, 2);
assert.equal(coverage.rows.filter((row) => row.lane_id === "stockanalysis_surfaces").length, 2);
assert.equal(coverage.rows.filter((row) => row.lane_id === "slickcharts").length, 5);

// An attempt after the slot counts as observed even when the producer failed.
const failedCurrent = setNonCompositeEndpoint(clone(baseline), "gdelt_news_tone", {
  status: "unavailable",
  reason: "http_error",
  observed_at: baseline.generated_at,
});
const failedCoverage = buildFetchCronAttemptCoverage({ report: failedCurrent, calendars });
assert.equal(rowOf(failedCoverage, "gdelt_news_tone").state, "observed");
assert.equal(rowOf(failedCoverage, "gdelt_news_tone").producer_status, "unavailable");
assert.equal(rowOf(failedCoverage, "gdelt_news_tone").producer_reason, "http_error");

const futureAttempt = setNonCompositeEndpoint(clone(baseline), "gdelt_news_tone", {
  status: "unavailable",
  reason: "future_source",
  observed_at: "2026-07-12T00:00:00Z",
});
const futureCoverage = buildFetchCronAttemptCoverage({ report: futureAttempt, calendars });
assert.equal(rowOf(futureCoverage, "gdelt_news_tone").state, "suspected_skip");

// FINRA/OCC share one workflow+cron. One current peer proves workflow execution,
// so an old FINRA shard is an attempt evidence gap, not a suspected cron skip.
const sharedWorkflowGap = setNonCompositeEndpoint(clone(baseline), "finra_short_volume", {
  status: "stale",
  reason: "stale",
  observed_at: "2026-07-01T00:00:00Z",
});
const gapCoverage = buildFetchCronAttemptCoverage({ report: sharedWorkflowGap, calendars });
assert.equal(rowOf(gapCoverage, "finra_short_volume").state, "attempt_gap");
assert.equal(rowOf(gapCoverage, "occ_options_volume").state, "observed");

// Moving the evaluation point forward makes latest-only evidence expire without
// claiming retained history. Event origin is intentionally unavailable in v1.
const later = clone(baseline);
later.generated_at = "2026-07-20T18:00:00Z";
const laterCoverage = buildFetchCronAttemptCoverage({ report: later, calendars });
assert.equal(laterCoverage.status, "warning");
assert.ok(laterCoverage.counts.suspected_skips > 2);
assert.equal(Object.hasOwn(rowOf(laterCoverage, "gdelt_news_tone"), "event_name"), false);

// Once the first activation-eligible Damodaran slot has passed its declared
// grace, the ordinary finite row returns. OECD remains preactivation.
const postActivationCoverage = buildFetchCronAttemptCoverage({
  report: null,
  calendars,
  nowValue: "2026-07-27T04:00:00Z",
});
assert.equal(rowOf(postActivationCoverage, "damodaran").expected_at, "2026-07-25T11:17:00.000Z");
assert.equal(rowOf(postActivationCoverage, "damodaran").state, "suspected_skip");
assert.deepEqual(
  postActivationCoverage.pre_activation_members.map((row) => row.lane_id),
  // one stock slot plus one ETF slot
  ["oecd_cli", ...Array(2).fill("yahoo_batch_quote_history")],
);

const missingReportCoverage = buildFetchCronAttemptCoverage({
  report: null,
  calendars,
  nowValue: baseline.generated_at,
});
assert.equal(missingReportCoverage.deployment_blocking, false);
assert.equal(missingReportCoverage.status, "warning");
assert.deepEqual(missingReportCoverage.counts, {
  scheduled_members: 31,
  schedule_bindings: 31,
  observed: 0,
  suspected_skips: 31,
  attempt_gaps: 0,
});

process.stdout.write("test-fetch-cron-attempt-coverage: ok\n");
