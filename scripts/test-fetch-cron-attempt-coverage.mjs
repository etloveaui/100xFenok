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
assert.equal(scheduledMembers.length, 29);
assert.equal(scheduleBindings, 32);

// Baseline includes two owner-declared scheduled members with no attempt row.
const coverage = buildFetchCronAttemptCoverage({ report: baseline, calendars });
assert.equal(coverage.schema_version, "fetch-cron-attempt-coverage/v1");
assert.equal(coverage.mode, "shadow");
assert.equal(coverage.deployment_blocking, false);
assert.deepEqual(coverage.counts, {
  scheduled_members: 29,
  schedule_bindings: 32,
  observed: 29,
  suspected_skips: 3,
  attempt_gaps: 0,
});
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

const missingReportCoverage = buildFetchCronAttemptCoverage({
  report: null,
  calendars,
  nowValue: baseline.generated_at,
});
assert.equal(missingReportCoverage.deployment_blocking, false);
assert.equal(missingReportCoverage.status, "warning");
assert.deepEqual(missingReportCoverage.counts, {
  scheduled_members: 29,
  schedule_bindings: 32,
  observed: 0,
  suspected_skips: 32,
  attempt_gaps: 0,
});

process.stdout.write("test-fetch-cron-attempt-coverage: ok\n");
