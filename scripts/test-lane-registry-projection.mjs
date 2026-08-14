#!/usr/bin/env node
/**
 * Contract test for the lane-registry projection emitter (#365 P1).
 * - RED-first privacy proof: the raw registry serialized WOULD leak paths/roots;
 *   the projection must not. The same detector flags the raw and clears the
 *   projection, proving the privacy filter is load-bearing.
 * - Emitter unit: all registered lanes, exact allowed key set, owner_workflow basename only.
 */

import assert from "node:assert/strict";

import { LANE_REGISTRY } from "./lib/lane-registry.mjs";
import {
  buildLaneRegistryProjection,
  projectLane,
  PROJECTION_SCHEMA,
  CONTROL_ROOM_STATE_KEYS,
  isControlRoomLane,
} from "./build-lane-registry-projection.mjs";

// Path/privacy markers that must never appear in the admin-safe projection.
// Markers are PATH-shaped on purpose: "_private/" (the private-root prefix), not
// bare "_private" — the lane id "yahoo_private_options" legitimately contains
// "_private" and is NOT a path leak.
const FORBIDDEN = ["_private/", "data/admin", ".github/", "100xfenok-next", "public/data", "canonical_outputs", "recovery_store", "commit_shards"];

function privacyViolations(jsonString) {
  return FORBIDDEN.filter((marker) => jsonString.includes(marker));
}

// --- RED-first: the raw registry DOES leak (proves the detector + filter matter) ---
const rawJson = JSON.stringify(LANE_REGISTRY);
const rawViolations = privacyViolations(rawJson);
assert.ok(
  rawViolations.length > 0,
  "RED proof failed: the raw registry should contain path/root markers (the filter must have something to strip)",
);

// --- GREEN: the projection leaks nothing ---
const projection = buildLaneRegistryProjection();
const projectionJson = JSON.stringify(projection);
assert.deepEqual(
  privacyViolations(projectionJson),
  [],
  `projection leaked forbidden markers: ${privacyViolations(projectionJson).join(", ")}`,
);

// --- Emitter unit: shape + counts ---
assert.equal(projection.schema_version, PROJECTION_SCHEMA);
const EXPECTED_LANE_IDS = [
  "fred_macro",
  "fred_banking",
  "fred_yardeni",
  "fdic_tier1",
  "treasury_tga",
  "defillama_stablecoins",
  "yahoo_etf_fallback",
  "stockanalysis_etf_universe",
  "stockanalysis_etf_detail",
  "stockanalysis_stock_financial",
  "stockanalysis_surfaces",
  "yahoo_ticker_macro",
  "sentiment",
  "nasdaq_giw_sox",
  "us_indices_daily",
  "oecd_cli",
  "krx",
  "slickcharts",
  "edgar_filings",
  "sec_13f",
  "admin_live_voice_logs",
  "mona_production_study_state",
  "mona_vnext_kv",
  "benchmarks",
  "global_scouter",
  "damodaran",
  "finra_short_volume",
  "finra_ats_weekly",
  "occ_options_volume",
  "yahoo_private_options",
  "apewisdom_attention",
  "gdelt_news_tone",
  "yahoo_batch_quote_history",
];
assert.equal(projection.lanes.length, 33, "projection must carry all 33 registry lanes");
assert.equal(projection.lane_count, 33);
assert.deepEqual(
  projection.lanes.map(({ id }) => id),
  EXPECTED_LANE_IDS,
  "projection lane IDs must stay aligned with the registry order",
);

const ALLOWED_KEYS = ["cadence", "enforcement", "id", "label", "owner_workflow", "privacy_class", "store_kind"];
for (const lane of projection.lanes) {
  const expectedKeys = isControlRoomLane(LANE_REGISTRY.lanes.find((candidate) => candidate.id === lane.id), LANE_REGISTRY.providers)
    ? [...ALLOWED_KEYS, "control_room_state"]
    : ALLOWED_KEYS;
  assert.deepEqual(Object.keys(lane).sort(), expectedKeys.sort(), `lane ${lane.id}: unexpected key set`);
  // owner_workflow is a basename (no directory) or null.
  if (lane.owner_workflow !== null) {
    assert.ok(!lane.owner_workflow.includes("/"), `lane ${lane.id}: owner_workflow must be a basename`);
    assert.ok(lane.owner_workflow.endsWith(".yml"), `lane ${lane.id}: owner_workflow basename should be a .yml`);
  }
  assert.ok(lane.cadence && typeof lane.cadence.kind === "string", `lane ${lane.id}: cadence.kind required`);
  assert.deepEqual(Object.keys(lane.cadence), ["kind", "provider"], `lane ${lane.id}: projection cadence has an exact display shape`);
  assert.equal(typeof lane.cadence.provider, "string", `lane ${lane.id}: provider display label required`);
}

// Spot-check a known lane against the source record.
const src = LANE_REGISTRY.lanes.find((l) => l.id === "fred_macro");
const projected = projectLane(src);
assert.equal(projected.owner_workflow, "fetch-fred-macro.yml", "basename derivation");
assert.equal(projected.label, "FRED macro");
assert.equal(projected.privacy_class, "public_mirror");
assert.equal(projected.enforcement, "live");
assert.equal(projected.cadence.provider, "FRED");
assert.ok(!("roots" in projected) && !("recovery_store" in projected), "no path fields carried");

// --- RED-first control-room projection ---
// The six non-external-data provider/runtime lanes are derived from the provider
// registry, not a second hand-maintained lane list. Their operating state is a
// separate projection from product freshness enums and never carries private
// run IDs/URLs.
const fixtureNow = "2026-08-01T08:00:00Z";
const fixtureCalendars = {
  schema_version: "data-supply-detection-calendars/v1",
  calendars: [
    { id: "utc", timezone: "UTC", weekend_days: [0, 6], holidays: [] },
    { id: "us_trading", timezone: "America/New_York", weekend_days: [0, 6], holidays: [] },
  ],
  schedules: [
    { id: "hourly_at_05", cron: "5 * * * *", calendar_id: "utc", grace: { unit: "hours", value: 6 } },
    { id: "weekday_2200_us", cron: "0 22 * * 1-5", calendar_id: "us_trading", grace: { unit: "business_days", value: 1 } },
  ],
};
const controlProjection = buildLaneRegistryProjection(LANE_REGISTRY, {
  now: fixtureNow,
  calendars: fixtureCalendars,
  workflowSchedules: {
    "fetch-yahoo-ticker.yml": [{ cron: "5 * * * *", calendar_id: "utc" }],
    "fetch-sentiment.yml": [{ cron: "0 22 * * 1-5", calendar_id: "us_trading" }],
  },
  kpi: {
    source_sla: [],
    lanes: [
      {
        id: "yahoo_ticker_macro",
        as_of: "2026-08-01T07:55:00Z",
        details: { recovery_retry_set: [], recovery_recovered: [] },
      },
      {
        id: "sentiment",
        as_of: "2026-07-31",
        details: { recovery_retry_set: [{ key: "sentiment" }], recovery_recovered: [] },
      },
      { id: "admin_live_voice_logs", as_of: "2026-08-01", details: {} },
      { id: "mona_production_study_state", as_of: "2026-08-01", details: {} },
      { id: "mona_vnext_kv", as_of: "2026-08-01", details: {} },
    ],
  },
  sourceArtifacts: {
    yahoo_ticker_macro: [
      { current: { source_as_of: "2026-07-31T20:00:00.000Z" } },
      { current: { source_as_of: "2026-07-31T20:00:00.000Z" } },
    ],
    sentiment: {
      items: {
        cnn: { current: { source_as_of: "2026-07-31" } },
        cftc: { current: { source_as_of: "2026-07-28" } },
        crypto: { current: { source_as_of: "2026-07-31" } },
        move: { current: { source_as_of: "2026-07-31" } },
        vix: { current: { source_as_of: "2026-07-31" } },
      },
    },
    global_scouter: {
      update_frequency: "weekly",
      source_date: "2026-07-24",
    },
  },
  attempts: {
    yahoo_ticker_macro: [{
      lane_id: "yahoo_ticker_macro",
      observed_at: "2026-08-01T07:05:00Z",
      execution: "returned",
      http_status: 200,
      rate_limited: false,
      decode: "ok",
      payload: "non_empty",
      assertions: [{ id: "chart_result_array", passed: true }],
      attempt_id: "gh-123456789-1-yahoo",
    }],
    sentiment: [{
      lane_id: "sentiment",
      observed_at: "2026-07-31T21:59:00Z",
      execution: "returned",
      http_status: 429,
      rate_limited: true,
      decode: "not_attempted",
      payload: "empty",
      assertions: [],
      attempt_id: "gh-987654321-1-sentiment",
    }],
  },
  alarm: {
    status: "open",
    open_incidents: [{ workflow: "fetch-sentiment.yml", class: "engineering" }],
  },
  queue: {
    "fetch-sentiment.yml": { evidence_status: "measured", wait_ms: 1234, depth: 2 },
  },
});
const controlRows = controlProjection.lanes.filter((lane) => lane.control_room_state);
assert.equal(controlRows.length, 6, "exactly six external/runtime lanes must carry control_room_state");
assert.deepEqual(
  controlRows.map((lane) => lane.id),
  ["yahoo_ticker_macro", "sentiment", "admin_live_voice_logs", "mona_production_study_state", "mona_vnext_kv", "global_scouter"],
  "control-room lanes must derive from provider classes",
);
for (const lane of controlRows) {
  assert.deepEqual(Object.keys(lane.control_room_state).sort(), [...CONTROL_ROOM_STATE_KEYS].sort(), `${lane.id}: control state shape`);
  assert.ok(!JSON.stringify(lane.control_room_state).includes("123456789"), `${lane.id}: private run id leaked`);
  assert.ok(!JSON.stringify(lane.control_room_state).includes("github.com"), `${lane.id}: private run URL leaked`);
}
const yahooControl = controlProjection.lanes.find((lane) => lane.id === "yahoo_ticker_macro").control_room_state;
assert.equal(yahooControl.schedule.status, "on_time");
assert.equal(yahooControl.latest_attempt.outcome, "success");
assert.equal(yahooControl.latest_attempt.failure_class, null);
const sentimentControl = controlProjection.lanes.find((lane) => lane.id === "sentiment").control_room_state;
assert.equal(sentimentControl.schedule.status, "overdue");
assert.equal(sentimentControl.latest_attempt.outcome, "failed");
assert.equal(sentimentControl.latest_attempt.failure_class, "rate_limited");
assert.equal(sentimentControl.incident.class, "engineering");
assert.deepEqual(sentimentControl.queue, { evidence_status: "measured", wait_ms: 1234, depth: 2 });
assert.equal(sentimentControl.recovery.state, "retry_pending");
const yahooSource = yahooControl.source;
assert.equal(yahooSource.source_date, "2026-07-31T20:00:00.000Z", "yahoo must use the oldest committed provider source clock");
assert.equal(yahooSource.source_date_reason, "yahoo_hourly_ticker.current.source_as_of.oldest");
assert.equal(yahooSource.evidence_status, "observed");
assert.ok(!JSON.stringify(yahooSource).includes("data/admin"), "yahoo source path must stay private");
assert.equal(sentimentControl.source.source_date, "2026-07-28", "sentiment must use the oldest committed provider source clock");
assert.equal(sentimentControl.source.source_date_reason, "sentiment_index.items.current.source_as_of.oldest");
assert.equal(sentimentControl.source.evidence_status, "observed");
assert.ok(!JSON.stringify(sentimentControl.source).includes("data/admin"), "sentiment source path must stay private");
const globalControl = controlProjection.lanes.find((lane) => lane.id === "global_scouter").control_room_state;
assert.equal(globalControl.source.source_date, "2026-07-24", "global_scouter must use the metadata source clock");
assert.equal(
  globalControl.source.source_date_reason,
  "global_scouter_metadata.source_date",
  "global_scouter source clock provenance must be explicit",
);
assert.equal(globalControl.source.evidence_status, "observed");
assert.ok(!JSON.stringify(globalControl.source).includes("data/global-scouter"), "source path must stay private");

for (const [laneId, reason] of Object.entries({
  admin_live_voice_logs: "not_instrumented: local runtime has no committed public-safe source stamp",
  mona_production_study_state: "not_instrumented: owner SSOT runtime has no committed public-safe source stamp",
  mona_vnext_kv: "not_instrumented: KV runtime has no committed public-safe source stamp",
})) {
  const source = controlProjection.lanes.find((lane) => lane.id === laneId).control_room_state.source;
  assert.equal(source.source_date, null, `${laneId} must not infer a source date`);
  assert.equal(source.source_date_reason, reason, `${laneId} source instrumentation reason`);
  assert.equal(source.evidence_status, "not_instrumented", `${laneId} source evidence status`);
}

console.log(JSON.stringify({ ok: true, lanes: projection.lanes.length, red_markers_stripped: rawViolations }, null, 2));
