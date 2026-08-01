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
assert.equal(scheduledMembers.length, 30);
assert.equal(scheduleBindings, 39);
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
  scheduled_members: 30,
  schedule_bindings: 30,
  observed: 27,
  suspected_skips: 3,
  attempt_gaps: 0,
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
  ...[0, 1, 2, 3, 4, 5].map((weekday) => ({
    lane_id: "yahoo_batch_quote_history",
    member_id: "yahoo_batch_quote_history",
    workflow: ".github/workflows/fetch-yf-finance.yml",
    cron: `0 22 * * ${weekday}`,
    activated_at: "2026-08-01T01:00:13Z",
    first_eligible_at: `2026-08-0${weekday + 2}T22:00:00.000Z`,
  })),
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
assert.equal(coverage.rows.filter((row) => row.lane_id === "yahoo_etf_fallback").length, 3);
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
  ["oecd_cli", ...Array(7).fill("yahoo_batch_quote_history")],
);

const missingReportCoverage = buildFetchCronAttemptCoverage({
  report: null,
  calendars,
  nowValue: baseline.generated_at,
});
assert.equal(missingReportCoverage.deployment_blocking, false);
assert.equal(missingReportCoverage.status, "warning");
assert.deepEqual(missingReportCoverage.counts, {
  scheduled_members: 30,
  schedule_bindings: 30,
  observed: 0,
  suspected_skips: 30,
  attempt_gaps: 0,
});

process.stdout.write("test-fetch-cron-attempt-coverage: ok\n");
