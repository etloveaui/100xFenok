#!/usr/bin/env node
/**
 * KPI v2 runtime self-proof fixtures (contract §"Fixtures").
 *
 * Runs the real builder CLI against temp data roots with an injected clock and
 * GitHub/origin envelope env, then asserts the runtime block, slot accounting,
 * source SLA, and public projection. Also spawns the checker to prove exit codes
 * (warn-only Phase A) and reuses the checker's own validation functions.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  projectPublicKpi,
  PUBLIC_RUNTIME_DENY_KEYS,
} from "./lib/kpi-runtime-projection.mjs";
import {
  classifyRuntimeSlots,
  validateCronDeferrals,
} from "./lib/kpi-runtime-slots.mjs";
import {
  evaluateSlaAge,
  slaStatusForAge,
  classifyProductSurface,
  buildEtfLane,
  buildYahooBatchLane,
  buildSlickChartsDeliveryLane,
  buildFinraOccLane,
  buildDetectionFloorLanes,
  mapDetectionFloorRow,
  buildRimLane,
  buildRuntime,
  enumerateDueSlots,
  deriveMissedSlots,
} from "./build-fenok-data-health-kpi.mjs";
import { SOURCE_SLA_DEF, REQUIRED_SURFACE_IDS, SLICKCHARTS_DELIVERY_GROUPS, TRACKED_CRONS, CADENCE } from "./lib/kpi-contract-constants.mjs";
import { ETF_CORE_DAILY_BASKET_CONFIG } from "./build-fenok-etf-core-daily-basket.mjs";
import {
  checkV2Runtime,
  checkSourceSla,
  checkPublicProjection,
  checkDetectionFloorLane,
} from "../100xfenok-next/scripts/check-fenok-data-health-kpi.mjs";
import { projectFenokDataHealthKpiPublicMirror } from "../100xfenok-next/sync-static-overrides.mjs";
import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILDER = path.join(__dirname, "build-fenok-data-health-kpi.mjs");
const CHECKER = path.join(__dirname, "..", "100xfenok-next", "scripts", "check-fenok-data-health-kpi.mjs");
const DETECTION_EXPECTED = path.join(__dirname, "fixtures", "data_supply", "detection_floor", "cases.expected.json");
const KPI_REL = path.join("admin", "fenok-data-health-kpi.json");
const PRODUCT_SURFACE_SLA = SOURCE_SLA_DEF.find((row) => row.source_id === "product_surface_coverage");
assert.equal(PRODUCT_SURFACE_SLA?.unit, "business_days");
assert.equal(PRODUCT_SURFACE_SLA?.max_staleness, 10, "weekly ETF universe cadence + grace must fit inside the product-surface SLA");

{
  const readyIndex = (id) => ({
    id,
    role: id === "SPX" || id === "NDX" ? "primary_public_v1" : "secondary_input_only",
    public_status: "ready_inputs_and_forecast_grid",
    blockers: [],
    derived: {
      forecast_grid_v1: {
        public_status: id === "KOSPI"
          ? "input_only_krx_exact_weights_no_fair_value"
          : id === "SOX"
            ? "input_only_sox_methodology_weights_no_fair_value"
            : "ready_inputs_only_no_fair_value",
      },
    },
  });
  const readyRim = {
    generated_at: "2026-07-12T01:41:29.000Z",
    output_scope: "inputs_only_no_fair_value",
    policy: { no_public_single_target: true },
    indices: Object.fromEntries(["SPX", "NDX", "KOSPI", "SOX"].map((id) => [id, readyIndex(id)])),
  };
  const readyLane = buildRimLane(readyRim);
  assert.equal(readyLane.status, "ready");
  assert.equal(readyLane.checks.find((row) => row.id === "rim_kospi_ready")?.status, "ready");

  const staleRim = structuredClone(readyRim);
  staleRim.indices.KOSPI.public_status = "input_only_krx_exact_weights_with_caveats";
  staleRim.indices.KOSPI.blockers = [{
    code: "krx_kospi_daily_refresh_recommended",
    severity: "freshness_blocker",
  }];
  const degradedLane = buildRimLane(staleRim);
  assert.equal(degradedLane.status, "degraded", "RIM readiness lag degrades its lane; RIM integrity remains a separate global gate");
  assert.equal(degradedLane.checks.find((row) => row.id === "rim_kospi_ready")?.status, "blocked");
}

{
  const ledger = {
    generated_at: "2026-07-13T00:00:00Z",
    source_audit: { acceptance_ok: true, source_dates: { finra_source_date: "2026-07-11", occ_source_date: "2026-07-11" } },
    counts: {
      plain_us_finra_source_ready: 1, plain_us_finra_denominator: 1,
      plain_us_occ_source_ready: 1, plain_us_occ_denominator: 1,
    },
    service_boundary: { active_s0_daily_source_gate_blocker: false, reason: "lane local" },
    raw_policy: { admin_local_only: true },
  };
  const walkback = buildFinraOccLane(ledger, { current_attempt: {
    attempt_ref: "28982598913", attempt_number: 1, observed_at: "2026-07-08T00:00:00Z",
    target_source_date: "2026-07-08", served_source_date: "2026-07-07",
    status: "degraded_walkback", fallback_active: true, selected_tickers: 50,
    message: "OCC target 2026-07-08 was unavailable; serving fallback dated 2026-07-07.",
  } });
  assert.equal(walkback.status, "degraded");
  assert.equal(walkback.deployment_blocking, false);
  assert.match(walkback.status_message, /target 2026-07-08.*fallback dated 2026-07-07.*Other lanes may publish/i);
  assert.equal(walkback.details.occ_current_attempt.status, "degraded_walkback");

  const current = buildFinraOccLane(ledger, { current_attempt: {
    attempt_ref: "ready", attempt_number: 1, status: "ready_current", fallback_active: false,
    target_source_date: "2026-07-11", served_source_date: "2026-07-11", selected_tickers: 50,
    message: "OCC target 2026-07-11 is current and served without fallback.",
  } });
  assert.equal(current.status, "ready");
}

// SlickCharts reports Fenok delivery time honestly; missing/stale is lane-local,
// while malformed/non-finite JSON and universe identity corruption stay global.
{
  const now = "2026-07-13T12:00:00.000Z";
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "slick-kpi-"));
  const dataRoot = path.join(tmp, "data");
  const base = path.join(dataRoot, "slickcharts");
  const fresh = "2026-07-13T11:00:00+00:00";
  for (const group of SLICKCHARTS_DELIVERY_GROUPS) {
    for (const filename of group.files) writeJson(path.join(base, filename), { updated: fresh });
  }
  writeJson(path.join(base, "universe.json"), {
    updated: fresh,
    uniqueCount: 2,
    stocks: [{ symbol: "AAPL", indices: ["sp500"] }, { symbol: "GOOGL", indices: ["nasdaq100"] }],
  });
  writeJson(path.join(base, "stocks", "AAPL.json"), { symbol: "AAPL", updated: fresh });
  writeJson(path.join(base, "stocks", "GOOGL.json"), { symbol: "GOOGL", updated: fresh });

  const ready = buildSlickChartsDeliveryLane(now, { dataRoot });
  assert.equal(ready.status, "ready");
  assert.deepEqual(ready.counts, { required: 37, fixed: 35, current_universe: 2, current: 37, missing: 0, stale: 0, invalid: 0 });
  assert.match(ready.details.timestamp_semantics, /fetch\/write delivery time, not provider publication time/i);

  fs.unlinkSync(path.join(base, "stocks", "GOOGL.json"));
  writeJson(path.join(base, "sp500.json"), { updated: "2026-06-01T00:00:00Z" });
  const degraded = buildSlickChartsDeliveryLane(now, { dataRoot });
  assert.equal(degraded.status, "degraded");
  assert.equal(degraded.deployment_blocking, false);
  assert.equal(degraded.counts.missing, 1);
  assert.equal(degraded.counts.stale, 1);
  assert.match(degraded.status_message, /slickcharts-history.*stocks\/GOOGL\.json.*missing|slickcharts-weekly.*sp500\.json.*exceeds/i);

  fs.writeFileSync(path.join(base, "gainers.json"), "{", "utf8");
  fs.writeFileSync(path.join(base, "losers.json"), `{"updated":"${fresh}","value":1e400}\n`, "utf8");
  const corrupt = buildSlickChartsDeliveryLane(now, { dataRoot });
  assert.equal(corrupt.status, "blocked");
  assert.equal(corrupt.deployment_blocking, true);
  assert.equal(corrupt.checks.find((item) => item.id === "json_integrity")?.status, "blocked");

  writeJson(path.join(base, "gainers.json"), { updated: fresh });
  writeJson(path.join(base, "losers.json"), { updated: fresh });
  writeJson(path.join(base, "universe.json"), {
    updated: fresh,
    uniqueCount: 1,
    stocks: [{ symbol: "AAPL" }, { symbol: "AAPL" }],
  });
  const identity = buildSlickChartsDeliveryLane(now, { dataRoot });
  assert.equal(identity.status, "blocked");
  assert.match(identity.checks.find((item) => item.id === "universe_identity")?.detail, /duplicate symbols.*AAPL/i);
}

// The full 4,515-row daily-1Y lane is a diagnostic backlog. Product availability
// is gated by the exact Core Daily Basket; non-zero diagnostic gaps must remain
// visible without blocking reconcile:verify or Worker deployment.
{
  const coverage = {
    public_scoring_readiness: {
      tracks: [{
        id: "etf_scoring_lane",
        stage: "PUBLIC",
        readiness_status: "ready",
        requirements: {
          source_available: true,
          normalized: true,
          joined_to_target_universe: true,
          scored: true,
          public: true,
          daily: true,
          gated: true,
        },
        evidence_based_readiness: {
          gate_ok: true,
          counts: {
            eligible_etf_count: 5451,
            scored_public_etf: 4515,
            fetchable_daily_1y_gap: 31,
            inception_limited_daily_1y_gap: 715,
            terminal_limited_daily_1y_gap: 63,
          },
        },
      }],
    },
  };
  const daily = {
    generated_at: "2026-07-11T23:15:57.000Z",
    raw_policy: { service_gate: false },
    daily_1y_readiness: { daily_1y_fetchable: 31 },
  };
  const plan = {
    counts: { fetchable: 31 },
    tickers: Array.from({ length: 31 }, (_, index) => `ETF${index}`),
    bounded_batches: { batch_count: 1 },
  };
  const core = {
    readiness: {
      core_daily_basket_ready: true,
      min_selected_count: 75,
      selected_count: 98,
      fresh_selected_count: 98,
      stale_selected_count: 0,
    },
  };
  const etfLane = buildEtfLane(coverage, daily, plan, core);
  assert.equal(etfLane.status, "ready", "Core Basket readiness, not the full-universe diagnostic backlog, gates the ETF service lane");
  for (const id of ["fetchable_daily_1y_gap_zero", "fetchable_plan_empty"]) {
    const diagnostic = etfLane.checks.find((item) => item.id === id);
    assert.equal(diagnostic?.status, "warning");
    assert.equal(diagnostic?.required, false);
    assert.equal(diagnostic?.service_gate, false);
  }
  assert.equal(etfLane.checks.find((item) => item.id === "core_basket_ready")?.status, "ready");

  const behindCoverage = structuredClone(coverage);
  behindCoverage.public_scoring_readiness.tracks[0].requirements.daily = false;
  behindCoverage.public_scoring_readiness.tracks[0].requirements.gated = false;
  behindCoverage.public_scoring_readiness.tracks[0].stage = "PUBLIC";
  const degradedEtfLane = buildEtfLane(behindCoverage, daily, plan, core);
  assert.equal(degradedEtfLane.status, "degraded");
  assert.equal(degradedEtfLane.deployment_blocking, false);
  assert.match(degradedEtfLane.status_message, /not ready.*Other lanes may publish/);
  assert.equal(degradedEtfLane.checks.find((item) => item.id === "requirements_complete")?.status, "blocked",
    "failed readiness remains visible and is not painted green");
}

// Yahoo acquisition readiness is lane-local: LKG/new-listing lag stays visible
// and self-healing without becoming a platform-integrity blocker.
{
  const readyIndex = {
    generated_at: "2026-07-13T02:00:00Z",
    counts: { active: 2, untracked: 0, fresh: 2, lkg: 0, pending_history: 0, unavailable: 0, retry: 0, failed: 0 },
    oldest_source_as_of: "2026-07-10",
    oldest_source_ticker: "AAPL",
    current_attempt: { run_id: "100", attempted: 2, successes: 2, failed: 0, skipped: 0, fetch_attempts: 2, errors: [] },
    pending_details: [],
    lkg_details: [],
    unavailable_details: [],
  };
  const readyLane = buildYahooBatchLane(readyIndex);
  assert.equal(readyLane.status, "ready");
  assert.equal(readyLane.counts.oldest_source_date, "2026-07-10");
  assert.equal(readyLane.as_of, "2026-07-10");
  const agedLane = buildYahooBatchLane(readyIndex, "2026-07-30T02:00:00Z");
  assert.equal(agedLane.status, "degraded", "unchanged Yahoo state must age against the KPI build clock");

  const degradedIndex = structuredClone(readyIndex);
  degradedIndex.counts = { active: 4, untracked: 0, fresh: 0, lkg: 2, pending_history: 1, unavailable: 1, retry: 4, failed: 2, stale: 1 };
  degradedIndex.current_attempt = { run_id: "101", attempted: 2, successes: 0, failed: 2, skipped: 0, fetch_attempts: 3, errors: [{ symbol: "AAPL" }, { symbol: "HOLX" }] };
  degradedIndex.lkg_details = [{ symbol: "AAPL", payload_sha256: "abc", source_as_of: "2026-07-10T00:00:00Z", failure_run_id: "101", raw_error: "must-not-publish" }];
  degradedIndex.stale_groups = [{
    source_as_of: "2026-06-26",
    source_age_business_days: 10,
    max_source_age_business_days: 6,
    expected_resolution: "next_natural_yahoo_run",
    symbols: ["FLEX", "GOOGL"],
  }];
  degradedIndex.pending_details = [{ symbol: "NEW", discovered_from: ["market_facts"], missing: ["history"], expected_resolution: "next_natural_yahoo_run", private_path: "/tmp/private" }];
  degradedIndex.unavailable_details = [{
    symbol: "HOLX",
    failure_run_id: "101",
    failure_observed_at: "2026-07-13T01:59:00Z",
    failure_kind: "transient_provider_miss",
    lkg_status: "absent",
    data_loss: false,
    deferred_acquisition: true,
    retry: true,
    expected_resolution: "next_natural_yahoo_run",
    raw_error: "must-not-publish",
    private_path: "/tmp/private",
  }];
  const degradedLane = buildYahooBatchLane(degradedIndex);
  assert.equal(degradedLane.status, "degraded");
  assert.equal(degradedLane.deployment_blocking, false);
  assert.match(degradedLane.status_message, /Other lanes may publish/);
  assert.match(degradedLane.checks.find((item) => item.id === "no_pending_history")?.detail, /NEW.*market_facts.*history.*next natural Yahoo run/i);
  assert.match(degradedLane.checks.find((item) => item.id === "no_lkg_primary")?.detail, /AAPL.*101.*2026-07-10/i);
  assert.match(degradedLane.checks.find((item) => item.id === "no_lkg_primary")?.detail, /FLEX, GOOGL.*2026-06-26.*10 business days.*6-day bound.*next natural Yahoo run/i);
  assert.match(degradedLane.checks.find((item) => item.id === "no_unavailable")?.detail, /HOLX.*transient provider miss.*next natural Yahoo run/i);
  assert.equal(degradedLane.details.lkg[0].raw_error, undefined);
  assert.deepEqual(degradedLane.details.stale_groups[0].symbols, ["FLEX", "GOOGL"]);
  assert.equal(degradedLane.details.pending_history[0].private_path, undefined);
  assert.deepEqual(degradedLane.details.unavailable, [{
    symbol: "HOLX",
    failure_attempt_ref: "101",
    failure_observed_at: "2026-07-13T01:59:00Z",
    failure_kind: "transient_provider_miss",
    lkg_status: "absent",
    data_loss: false,
    deferred_acquisition: true,
    retry: true,
    expected_resolution: "next_natural_yahoo_run",
  }]);

  const legacyUnavailableIndex = structuredClone(degradedIndex);
  delete legacyUnavailableIndex.unavailable_details;
  legacyUnavailableIndex.generated_at = "2026-07-15T00:10:40Z";
  legacyUnavailableIndex.counts.unavailable = 2;
  legacyUnavailableIndex.current_attempt.run_id = "29378156187";
  legacyUnavailableIndex.current_attempt.errors.push({ symbol: "MMC" });
  legacyUnavailableIndex.retry_symbols = ["HOLX", "MMC"];
  const legacyUnavailableLane = buildYahooBatchLane(legacyUnavailableIndex);
  assert.deepEqual(legacyUnavailableLane.details.unavailable.map((item) => item.symbol), ["HOLX", "MMC"]);
  assert.equal(legacyUnavailableLane.details.unavailable[0].failure_kind, "legacy_unclassified");
  assert.match(legacyUnavailableLane.checks.find((item) => item.id === "no_unavailable")?.detail, /HOLX.*MMC.*legacy unclassified/i);

  const ambiguousLegacyUnavailableIndex = structuredClone(legacyUnavailableIndex);
  ambiguousLegacyUnavailableIndex.current_attempt.run_id = "different-run";
  const ambiguousLegacyLane = buildYahooBatchLane(ambiguousLegacyUnavailableIndex);
  assert.deepEqual(ambiguousLegacyLane.details.unavailable, [], "unknown legacy names fail closed");

  const malformedIndex = structuredClone(readyIndex);
  malformedIndex.oldest_source_as_of = "2026-07-99junk";
  const malformedLane = buildYahooBatchLane(malformedIndex);
  assert.equal(malformedLane.status, "degraded");
  assert.equal(malformedLane.checks.find((item) => item.id === "oldest_source_stamp_valid")?.status, "blocked");

  const futureIndex = structuredClone(readyIndex);
  futureIndex.oldest_source_as_of = "2026-07-14T00:00:00Z";
  const futureLane = buildYahooBatchLane(futureIndex);
  assert.equal(futureLane.status, "degraded");
  assert.equal(futureLane.checks.find((item) => item.id === "oldest_source_not_future")?.status, "blocked");

  const staleIndex = structuredClone(readyIndex);
  staleIndex.oldest_source_as_of = "2026-06-01";
  const staleLane = buildYahooBatchLane(staleIndex);
  assert.equal(staleLane.status, "degraded");
  assert.equal(staleLane.checks.find((item) => item.id === "oldest_source_fresh")?.status, "blocked");
}

// Detection-floor adapter: every live lane enters the KPI through one generic
// mapper without becoming a platform-integrity blocker. Missing evidence is
// honest unobserved state; malformed or contradictory evidence fails closed.
{
  const liveConfigs = DATA_SUPPLY_DETECTION_CONFIG.lanes.filter((item) => item.enforcement === "live");
  const liveLaneIds = [
    "fred_macro",
    "fred_banking",
    "fred_yardeni",
    "fdic_tier1",
    "treasury_tga",
    "yahoo_ticker_macro",
    "sentiment",
    "slickcharts",
    "edgar_filings",
    "finra_short_volume",
    "occ_options_volume",
  ];
  assert.deepEqual(liveConfigs.map((item) => item.id), liveLaneIds);
  const report = (laneId = null, overrides = {}) => {
    const value = structuredClone(JSON.parse(fs.readFileSync(DETECTION_EXPECTED, "utf8")).baseline.expected_report);
    if (laneId !== null) {
      const index = value.lanes.findIndex((item) => item.id === laneId);
      value.lanes[index] = { ...value.lanes[index], ...overrides };
    }
    return value;
  };
  const row = (laneId, overrides = {}) => ({
    id: laneId,
    label: liveConfigs.find((item) => item.id === laneId)?.label,
    enforcement: "live",
    kpi_required: true,
    status: "ready", reason: "ok",
    artifact: { status: "ready", reason: "ok", source_as_of: "2026-07-10" },
    ...overrides,
  });

  const readyLanes = buildDetectionFloorLanes(report());
  assert.deepEqual(readyLanes.map((item) => item.id), liveLaneIds);
  for (const ready of readyLanes) {
    assert.equal(ready.status, "ready");
    assert.equal(ready.reason, "ok");
    assert.notEqual(ready.artifact.source_as_of, null);
    assert.equal(ready.deployment_blocking, false);
  }

  const fdicRecovery = {
    schema_version: "data-supply-lkg-state/v1",
    lane_id: "fdic_tier1",
    updated_at: "2026-07-15T01:00:00.000Z",
    retry_set: ["fdic_tier1"],
    items: {
      fdic_tier1: {
        key: "fdic_tier1",
        resolution_state: "lkg_primary",
        retry: true,
        current: {
          path: "data/admin/fdic_tier1/lkg/fdic_tier1.json",
          payload_sha256: "a".repeat(64),
          source_as_of: "2026-03-31",
        },
        lkg: {
          path: "data/admin/fdic_tier1/lkg/fdic_tier1.json",
          payload_sha256: "a".repeat(64),
          source_as_of: "2026-03-31",
        },
        latest_failure: {
          run_id: "4001",
          run_attempt: 1,
          observed_at: "2026-07-15T01:00:00.000Z",
          reason: "controlled_failure",
        },
      },
    },
  };
  const recoveryLanes = buildDetectionFloorLanes(report(), { fdic_tier1: fdicRecovery });
  const fdicRecoveryLane = recoveryLanes.find((item) => item.id === "fdic_tier1");
  assert.equal(fdicRecoveryLane.status, "degraded", "a ready endpoint cannot hide an active LKG retry set");
  assert.match(fdicRecoveryLane.checks.find((item) => item.id === "lkg_retry_set_empty")?.detail, /fdic_tier1.*lkg_primary.*4001/i);
  assert.deepEqual(fdicRecoveryLane.details.recovery_retry_set, [{
    key: "fdic_tier1",
    resolution_state: "lkg_primary",
    failure_run_id: "4001",
    recovered_from_run_id: null,
  }]);
  assert.equal(JSON.stringify(fdicRecoveryLane).includes("payload_sha256"), false, "private digests stay out of KPI evidence");
  const omittedRetry = structuredClone(fdicRecovery);
  omittedRetry.retry_set = [];
  assert.throws(
    () => buildDetectionFloorLanes(report(), { fdic_tier1: omittedRetry }),
    /retry_set omits active items/,
    "an index cannot hide retry:true items by omitting their keys",
  );
  const fdicRecoveryCheckerErrors = [];
  checkDetectionFloorLane(fdicRecoveryLane, fdicRecoveryCheckerErrors, liveConfigs.find((item) => item.id === "fdic_tier1"));
  assert.deepEqual(fdicRecoveryCheckerErrors, []);

  const fdicRecovered = structuredClone(fdicRecovery);
  fdicRecovered.updated_at = "2026-07-16T01:00:00.000Z";
  fdicRecovered.retry_set = [];
  fdicRecovered.items.fdic_tier1 = {
    ...fdicRecovered.items.fdic_tier1,
    resolution_state: "fresh_primary",
    retry: false,
    current: {
      path: "data/fdic/fdic-tier1.json",
      payload_sha256: "b".repeat(64),
      source_as_of: "2026-06-30",
    },
    recovered_from_run_id: "4001",
    recovered_at: "2026-07-16T01:00:00.000Z",
    recovery_run_id: "4002",
    recovery_run_attempt: 1,
    recovery_event_name: "schedule",
    last_recovered_failure: {
      run_id: "4001",
      run_attempt: 1,
      observed_at: "2026-07-15T01:00:00.000Z",
      reason: "controlled_failure",
    },
  };
  delete fdicRecovered.items.fdic_tier1.latest_failure;
  const recoveredLanes = buildDetectionFloorLanes(report(), { fdic_tier1: fdicRecovered });
  const fdicRecoveredLane = recoveredLanes.find((item) => item.id === "fdic_tier1");
  assert.equal(fdicRecoveredLane.status, "ready", "a named natural recovery remains lane-ready");
  assert.equal(fdicRecoveredLane.deployment_blocking, false, "a recovered lane never becomes a platform blocker");
  assert.deepEqual(fdicRecoveredLane.details.recovery_retry_set, []);
  assert.deepEqual(fdicRecoveredLane.details.recovery_recovered, [{
    key: "fdic_tier1",
    resolution_state: "fresh_primary",
    retry: false,
    recovered_from_run_id: "4001",
    recovery_run_id: "4002",
    recovery_run_attempt: 1,
    recovery_event_name: "schedule",
    recovered_at: "2026-07-16T01:00:00.000Z",
    lkg_source_as_of: "2026-03-31",
    source_as_of: "2026-06-30",
  }]);
  assert.equal(JSON.stringify(fdicRecoveredLane).includes("payload_sha256"), false, "recovery evidence names provenance without exposing digests");
  const recoveredCheckerErrors = [];
  checkDetectionFloorLane(fdicRecoveredLane, recoveredCheckerErrors, liveConfigs.find((item) => item.id === "fdic_tier1"));
  assert.deepEqual(recoveredCheckerErrors, []);

  const legacyDispatchRecovery = structuredClone(fdicRecovered);
  delete legacyDispatchRecovery.items.fdic_tier1.recovery_run_id;
  delete legacyDispatchRecovery.items.fdic_tier1.recovery_run_attempt;
  delete legacyDispatchRecovery.items.fdic_tier1.recovery_event_name;
  const legacyDispatchLane = buildDetectionFloorLanes(report(), { fdic_tier1: legacyDispatchRecovery })
    .find((item) => item.id === "fdic_tier1");
  assert.deepEqual(legacyDispatchLane.details.recovery_recovered, [], "legacy dispatch recovery is not natural-run proof");

  const partialRecoveryProof = structuredClone(fdicRecovered);
  delete partialRecoveryProof.items.fdic_tier1.recovery_event_name;
  assert.throws(
    () => buildDetectionFloorLanes(report(), { fdic_tier1: partialRecoveryProof }),
    /recovery provenance.*malformed/i,
    "partial natural-run provenance fails closed",
  );
  const explicitDispatchRecovery = structuredClone(fdicRecovered);
  explicitDispatchRecovery.items.fdic_tier1.recovery_event_name = "workflow_dispatch";
  assert.throws(
    () => buildDetectionFloorLanes(report(), { fdic_tier1: explicitDispatchRecovery }),
    /recovery provenance.*malformed/i,
    "explicit dispatch recovery cannot be projected as natural proof",
  );

  const projectedRecovered = projectPublicKpi({
    lanes: [{
      id: "fdic_tier1",
      details: {
        recovery_recovered: [{
          ...fdicRecoveredLane.details.recovery_recovered[0],
          payload_sha256: "b".repeat(64),
          private_path: "data/admin/fdic_tier1/lkg/fdic_tier1.json",
        }],
      },
    }],
  }, "2026-07-16T01:00:00.000Z");
  assert.deepEqual(projectedRecovered.lanes[0].details.recovery_recovered, fdicRecoveredLane.details.recovery_recovered,
    "public projection preserves named recovery proof through an explicit allowlist");

  const recoveryIndex = (laneId, keys, overrides = {}) => ({
    schema_version: "producer-lkg-index/v1",
    lane_id: laneId,
    generated_at: "2026-07-15T01:00:00Z",
    keys,
    counts: { keys: keys.length, fresh: keys.length, lkg: 0, retry: 0, unavailable: 0, failed: 0, recovered: 0 },
    retry_keys: [],
    lkg_details: [],
    recovery_details: [],
    current_attempt: {
      run_id: "300", run_attempt: 1, event_name: "workflow_dispatch", observed_at: "2026-07-15T01:00:00Z",
      attempted: keys.length, successes: keys.length, failed: 0, failed_keys: [],
    },
    ...overrides,
  });
  const yahooRecovery = recoveryIndex("yahoo_hourly_ticker", ["TQQQ.json", "SOXL.json"], {
    counts: { keys: 2, fresh: 1, lkg: 1, retry: 1, unavailable: 0, failed: 1, recovered: 0 },
    retry_keys: ["TQQQ.json"],
    lkg_details: [{
      key: "TQQQ.json",
      payload_sha256: "a".repeat(64),
      source_as_of: "2026-07-14T04:00:00.000Z",
      failure_run_id: "300",
    }],
    current_attempt: {
      run_id: "300", run_attempt: 1, event_name: "workflow_dispatch", observed_at: "2026-07-15T01:00:00Z",
      attempted: 2, successes: 1, failed: 1, failed_keys: ["TQQQ.json"],
    },
  });
  const yahooDegraded = mapDetectionFloorRow(row("yahoo_ticker_macro"), yahooRecovery);
  assert.equal(yahooDegraded.status, "degraded");
  assert.equal(yahooDegraded.reason, "recovery_degraded");
  assert.equal(yahooDegraded.details.detection_reason, "ok");
  assert.deepEqual(yahooDegraded.details.recovery.retry_keys, ["TQQQ.json"]);
  assert.equal(yahooDegraded.checks.find((item) => item.id === "recovery_retry_set_empty")?.status, "blocked");
  assert.equal(yahooDegraded.deployment_blocking, false);

  const recoveryAware = buildDetectionFloorLanes(report(), {
    yahoo_ticker_macro: yahooRecovery,
    slickcharts: recoveryIndex("slickcharts_daily_delivery", [
      "gainers.json", "losers.json", "treasury.json", "currency.json", "mortgage.json",
    ]),
  });
  assert.equal(recoveryAware.find((item) => item.id === "yahoo_ticker_macro")?.status, "degraded");
  assert.equal(recoveryAware.find((item) => item.id === "slickcharts")?.status, "ready");
  assert.equal(recoveryAware.find((item) => item.id === "treasury_tga")?.checks.some((item) => item.id.startsWith("recovery_")), false);

  const missingRecovery = mapDetectionFloorRow(row("slickcharts"), null);
  assert.equal(missingRecovery.status, "degraded");
  assert.equal(missingRecovery.reason, "recovery_degraded");
  assert.equal(missingRecovery.checks.find((item) => item.id === "recovery_state_present")?.status, "blocked");

  const stale = mapDetectionFloorRow(row("treasury_tga", {
    status: "stale",
    reason: "stale",
    artifact: { status: "stale", reason: "stale", source_as_of: "2026-07-03" },
  }));
  assert.equal(stale.status, "degraded");
  assert.equal(stale.reason, "stale");
  assert.equal(stale.artifact.source_as_of, "2026-07-03");
  assert.equal(stale.deployment_blocking, false);

  const unreadableArtifact = mapDetectionFloorRow(row("treasury_tga", {
    status: "unavailable",
    reason: "schema_drift",
    artifact: { status: "unavailable", reason: "schema_drift", source_as_of: null },
  }));
  assert.equal(unreadableArtifact.status, "degraded");
  assert.equal(unreadableArtifact.reason, "schema_drift");
  assert.equal(unreadableArtifact.artifact.source_as_of, null);

  const missing = buildDetectionFloorLanes(null);
  assert.deepEqual(missing.map((item) => item.id), liveLaneIds);
  for (const item of missing) {
    assert.equal(item.status, "degraded");
    assert.equal(item.reason, "workflow_unobserved");
    assert.equal(item.artifact.source_as_of, null);
    assert.match(item.status_message, /workflow_unobserved/i);
  }

  for (const malformed of [
    {},
    report("treasury_tga", { enforcement: "shadow" }),
    report("treasury_tga", { kpi_required: false }),
    report("treasury_tga", { status: "ready", reason: "stale" }),
    report("treasury_tga", { artifact: { status: "ready", reason: "ok", source_as_of: null } }),
    report("treasury_tga", { artifact: { status: "ready", reason: "ok", source_as_of: "2026-07-99" } }),
  ]) {
    assert.throws(() => buildDetectionFloorLanes(malformed), /schema_error|detection floor|treasury_tga/i);
  }
  const badCounts = report();
  badCounts.counts.ready += 1;
  assert.throws(() => buildDetectionFloorLanes(badCounts), /aggregate counts|detection floor/i);

  for (const malformedRow of [
    row("unknown_lane"),
    row("fred_yardeni", { label: "Wrong label" }),
    row("treasury_tga", { label: "Wrong label" }),
    row("treasury_tga", { enforcement: "shadow" }),
    row("treasury_tga", { kpi_required: false }),
    row("treasury_tga", { status: "ready", reason: "stale" }),
    row("treasury_tga", { status: "ready", reason: "ok", artifact: { status: "stale", reason: "stale", source_as_of: "2026-07-03" } }),
    row("treasury_tga", { artifact: { status: "ready", reason: "ok", source_as_of: null } }),
    row("treasury_tga", { artifact: { status: "ready", reason: "ok", source_as_of: "2026-07-99" } }),
  ]) {
    assert.throws(() => mapDetectionFloorRow(malformedRow), /detection floor/i);
  }

  const checkerErrors = [];
  checkDetectionFloorLane(stale, checkerErrors, liveConfigs.find((item) => item.id === stale.id));
  assert.deepEqual(checkerErrors, []);
  const tampered = structuredClone(stale);
  tampered.status = "ready";
  checkDetectionFloorLane(tampered, checkerErrors, liveConfigs.find((item) => item.id === stale.id));
  assert.ok(checkerErrors.some((entry) => /status/i.test(entry)), "checker independently rejects KPI status laundering");
  const recoveryCheckerErrors = [];
  checkDetectionFloorLane(yahooDegraded, recoveryCheckerErrors, liveConfigs.find((item) => item.id === yahooDegraded.id));
  assert.deepEqual(recoveryCheckerErrors, []);
}

// The canonical lanes the checker's validateCoreShape REQUIRED_LANES demands.
// Kept in lockstep with that set; a divergence hard-fails validateCoreShape immediately.
const REQUIRED_LANE_IDS = [
  "stock_s0_active_daily_gate",
  "stock_s1_candidate_gate",
  "etf_public_and_daily_gate",
  "yahoo_batch_quote_history",
  "slickcharts_delivery_freshness",
  "rim_inputs",
  "product_surface_freshness",
  "finra_occ_plain_us_and_mapping_policy",
  "automation_contract",
  "public_mirror_safety",
  ...DATA_SUPPLY_DETECTION_CONFIG.lanes
    .filter((item) => item.enforcement === "live")
    .map((item) => item.id),
];

const TARGET_RECOVERY_FIXTURES = Object.freeze({
  yahoo_ticker_macro: { laneId: "yahoo_hourly_ticker", keys: ["TQQQ.json", "SOXL.json"] },
  slickcharts: {
    laneId: "slickcharts_daily_delivery",
    keys: ["gainers.json", "losers.json", "treasury.json", "currency.json", "mortgage.json"],
  },
});

function readyRecoveryIndex(laneId, keys, generatedAt = "2026-07-14T11:00:00Z") {
  return {
    schema_version: "producer-lkg-index/v1",
    lane_id: laneId,
    generated_at: generatedAt,
    keys,
    counts: { keys: keys.length, fresh: keys.length, lkg: 0, retry: 0, unavailable: 0, failed: 0, recovered: 0 },
    retry_keys: [],
    lkg_details: [],
    recovery_details: [],
    current_attempt: {
      run_id: "ready", run_attempt: 1, event_name: "schedule", observed_at: generatedAt,
      attempted: keys.length, successes: keys.length, failed: 0, failed_keys: [],
    },
  };
}

function readyDetectionProjection(id, now) {
  const config = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((item) => item.id === id && item.enforcement === "live");
  if (!config) return {};
  const row = {
    id,
    label: config.label,
    enforcement: "live",
    kpi_required: true,
    status: "ready",
    reason: "ok",
    artifact: { status: "ready", reason: "ok", source_as_of: "2026-07-10" },
  };
  const recovery = TARGET_RECOVERY_FIXTURES[id];
  return mapDetectionFloorRow(row, recovery ? readyRecoveryIndex(recovery.laneId, recovery.keys, now) : undefined);
}

// HERMETIC ready core — synthesized in-process with ZERO inheritance from the repo's
// data/admin KPI doc. validateCoreShape hard-requires canonical deployment integrity,
// while lane readiness may honestly be degraded.
// Reading the real doc (previous behavior) leaked cf:build's regenerated BLOCKED status/
// lanes into the "ready" fixture — the OpenNext-only fixture-4b deploy failure. By
// constructing every gate field here, seedReadyV2 is fully decoupled from live data state.
function readyCoreV2(now) {
  const lanes = REQUIRED_LANE_IDS.map((id) => ({
    id,
    label: id,
    status: "ready",
    status_label: "정상",
    required: true,
    checks: [],
    ...readyDetectionProjection(id, now),
    ...(id === "yahoo_batch_quote_history" ? {
      as_of: "2026-07-09T00:00:00Z",
      deployment_blocking: false,
      counts: {
        active: 1, untracked: 0, fresh: 1, lkg: 0, pending_history: 0,
        unavailable: 0, retry: 0, failed: 0, oldest_source_date: "2026-07-09",
        stale: 0,
        oldest_source_symbol: "AAPL", oldest_source_age_business_days: 1,
        max_source_age_business_days: 6,
      },
      details: {
        latest_attempt: { attempt_ref: "fixture", attempt_number: 1, attempted: 1, successes: 1, failed: 0, skipped: 0, fetch_attempts: 1 },
        state_generated_at: now,
        stale_groups: [],
      },
    } : id === "slickcharts_delivery_freshness" ? {
      deployment_blocking: false,
      counts: { required: 35, fixed: 35, current_universe: 0, current: 35, missing: 0, stale: 0, invalid: 0 },
      details: {
        workflow_sla: SLICKCHARTS_DELIVERY_GROUPS.map((group) => ({
          source_id: group.id,
          workflow_id: group.workflow,
          max_hours: group.max_hours,
          required: group.files.length,
          current: group.files.length,
          missing: 0,
          stale: 0,
          invalid: 0,
          oldest_delivery_at: now,
        })),
        offenders: [],
        timestamp_semantics: "updated is Fenok fetch/write delivery time, not provider publication time.",
        scope_issues: [],
      },
      checks: [
        { id: "json_integrity", label: "JSON", status: "ready", required: true, platform_blocking: true },
        { id: "universe_identity", label: "identity", status: "ready", required: true, platform_blocking: true },
        { id: "delivery_ready", label: "delivery", status: "ready", required: true, platform_blocking: false },
      ],
    } : {}),
  }));
  return {
    schema_version: "fenok-data-health-kpi/v2",
    generated_at: now,
    status: "ready",
    status_label: "정상",
    purpose: "KPI v2 runtime self-proof fixture (hermetic ready core)",
    raw_policy: {
      public_mirror_allowed: true,
      raw_rows_included: false,
      private_artifact_paths_included: false,
      private_ledgers_included: false,
      source_artifacts_are_referenced_by_id_only: true,
    },
    deployment_integrity: {
      status: "ready", status_label: "정상",
      status_message: "Platform integrity gates are ready; degraded lanes may publish independently.",
      blocker_count: 0, blockers: [],
    },
    lanes,
    totals: { lanes: REQUIRED_LANE_IDS.length, ready: REQUIRED_LANE_IDS.length, degraded: 0, warning: 0, blocked: 0, unavailable: 0, required_not_ready: 0, platform_blocking_not_ready: 0 },
    non_ready_checks: [],
    source_artifacts: [{ id: "yahoo_batch_quote_history_state", generated_at: now, public_mirror: false, public_safe: false }],
  };
}

// Build a genuinely-ready v2 doc pair (synthesized ready core + a v2 runtime) so the
// checker's status/lane gate is satisfied and only runtime/sla/projection is exercised.
function seedReadyV2(tmp, { now, runtime, sla }) {
  writeReadyTargetRecoveryIndexes(tmp, now);
  const root = { ...readyCoreV2(now), runtime, source_sla: sla };
  const pub = projectPublicKpi(root, now);
  writeJson(path.join(tmp, "data", KPI_REL), root);
  writeJson(path.join(tmp, "public", "data", KPI_REL), pub);
  return { root, public: pub };
}

// Emit all canonical SOURCE_SLA sources fresh/ready by copying the DEFINITIONAL
// fields verbatim from SOURCE_SLA_DEF (so the checker's deep-equality passes) and
// attaching fresh observations; overrides mutate one.
const READY_DATES = {
  s0_finra_occ_mapping_ledger: "2026-07-09",
  rim_index_inputs: "2026-07-06",
  etf_core_daily_basket_admin: "2026-07-08",
  fenok_edge_coverage_index: "2026-07-09",
  product_surface_coverage: "2026-07-09",
  etf_daily1y_readiness_admin: "2026-07-10T00:00:00.000Z",
};
function slaEntry(def, sourceDate, now, extra = {}) {
  const age = sourceDate == null ? null : evaluateSlaAge({ sourceDate, unit: def.unit, calendar: def.calendar, nowIso: now });
  return { ...def, source_date: sourceDate, age, status: slaStatusForAge(age, def.max_staleness), ...extra };
}

// Mirror the builder's buildProductSurfaceEntry (shape-strict + sticky pending_since)
// so seedReadyV2 docs carry a product_surface entry the new checker accepts.
function productSurfaceEntry(now, { stampById = {}, defaultStamp = "2026-07-09", pendingSince, rawRows, priorEverStamped = false, markerless = false, stampMarkerValue = 1 } = {}) {
  const def = SOURCE_SLA_DEF.find((d) => d.source_id === "product_surface_coverage");
  const requiredRows = rawRows ?? REQUIRED_SURFACE_IDS.map((id) => ({ id, source_as_of: id in stampById ? stampById[id] : defaultStamp }));
  const stampMarkerPresent = !markerless;
  const cls = classifyProductSurface(requiredRows, now, { stampMarkerPresent, stampMarkerValue });
  const everStamped = priorEverStamped || cls.kind === "stamped";
  const base = { source_id: def.source_id, freshness_basis: def.freshness_basis, unit: def.unit, calendar: def.calendar, max_staleness: def.max_staleness, required: def.required, ...(stampMarkerPresent ? { source_stamp_version: stampMarkerValue } : {}), required_surface_rows: requiredRows };
  if (cls.kind === "shape_error") return { ...base, source_date: null, age: null, status: "error", shape_error: true, shape_errors: cls.shape_errors, pending: { pending_since: null, ever_stamped: everStamped } };
  if (cls.kind === "future") return { ...base, source_date: cls.source_date, age: evaluateSlaAge({ sourceDate: cls.source_date, unit: def.unit, calendar: def.calendar, nowIso: now }), status: "future_date_anomaly", future_date_anomaly: true, pending: { pending_since: null, ever_stamped: everStamped } };
  if (cls.kind === "pending") return { ...base, source_date: null, age: null, status: "unavailable_pending_source_stamp", pending_source_stamp: true, pending: { pending_since: pendingSince ?? now, ever_stamped: everStamped } };
  const age = evaluateSlaAge({ sourceDate: cls.source_date, unit: def.unit, calendar: def.calendar, nowIso: now });
  return { ...base, source_date: cls.source_date, age, status: slaStatusForAge(age, def.max_staleness), pending: { pending_since: null, ever_stamped: true } };
}

function readySla(now, overrides = {}) {
  const list = SOURCE_SLA_DEF.map((def) => (def.source_id === "product_surface_coverage"
    ? productSurfaceEntry(now, overrides.productSurface)
    : slaEntry(def, def.source_id.startsWith("slickcharts_") ? now : READY_DATES[def.source_id], now)));
  if (overrides.staleFinra) {
    const e = list.find((x) => x.source_id === "s0_finra_occ_mapping_ledger");
    e.source_date = "2026-06-01";
    e.age = evaluateSlaAge({ sourceDate: e.source_date, unit: e.unit, calendar: e.calendar, nowIso: now });
    e.status = slaStatusForAge(e.age, e.max_staleness);
  }
  if (overrides.emptySla) return [];
  if (overrides.dropRequired) return list.filter((x) => x.source_id !== "rim_index_inputs");
  if (overrides.unavailableRequired) {
    const e = list.find((x) => x.source_id === "rim_index_inputs");
    e.source_date = null; e.age = null; e.status = "unavailable";
  }
  if (overrides.futureRequired) {
    const e = list.find((x) => x.source_id === "s0_finra_occ_mapping_ledger");
    e.source_date = "2026-07-20"; e.age = 0; e.status = "future_date_anomaly"; e.future_date_anomaly = true;
  }
  if (overrides.coverageUnavailable) {
    const e = list.find((x) => x.source_id === "fenok_edge_coverage_index");
    e.source_date = null; e.age = null; e.status = "unavailable";
  }
  if (overrides.coverageFakePending) {
    // The generic-flag-bypass probe: pending_source_stamp on a NON-product_surface row.
    const e = list.find((x) => x.source_id === "fenok_edge_coverage_index");
    e.source_date = null; e.age = null; e.status = "ready"; e.pending_source_stamp = true;
  }
  if (typeof overrides.tamper === "function") overrides.tamper(list);
  return list;
}

let passed = 0;
function ok(label) {
  passed += 1;
  console.log(`  ok - ${label}`);
}

function baseEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("GITHUB_") || k.startsWith("KPI_")) continue;
    env[k] = v;
  }
  return env;
}

function mkTmp(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `kpi-v2-${name}-`));
  fs.mkdirSync(path.join(dir, "data", "admin"), { recursive: true });
  fs.mkdirSync(path.join(dir, "data", "computed", "rim-index"), { recursive: true });
  fs.mkdirSync(path.join(dir, "public", "data", "admin"), { recursive: true });
  return dir;
}

function writeJson(absPath, payload) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeReadyRecoveryIndex(tmp, relPath, laneId, keys, generatedAt = "2026-07-14T11:00:00Z") {
  writeJson(path.join(tmp, "data", "admin", relPath, "index.json"), readyRecoveryIndex(laneId, keys, generatedAt));
}

function writeReadyTargetRecoveryIndexes(tmp, generatedAt) {
  for (const [laneId, recovery] of Object.entries(TARGET_RECOVERY_FIXTURES)) {
    const relPath = laneId === "yahoo_ticker_macro" ? "yahoo-hourly-ticker" : "slickcharts-daily-delivery";
    writeReadyRecoveryIndex(tmp, relPath, recovery.laneId, recovery.keys, generatedAt);
  }
}

function seedPrior(tmp, priorDoc) {
  writeJson(path.join(tmp, "data", KPI_REL), priorDoc);
}

// Seed product-surface-coverage with per-surface source_as_of (true source stamps).
// stampById overrides specific surfaces; default stamp applies to the rest. absentIds
// OMIT the source_as_of key entirely (bootstrap/structural probes). rawSurfaces fully
// overrides the surfaces array (typo-property probe).
function seedProductCoverage(tmp, { defaultStamp = null, stampById = {}, absentIds = [], rawSurfaces, markerless = false, stampMarkerValue = 1 } = {}) {
  const surfaces = rawSurfaces ?? REQUIRED_SURFACE_IDS.map((id) => {
    const base = { id, as_of: "2026-07-09T00:00:00.000Z" };
    if (absentIds.includes(id)) return base; // no source_as_of key (absent own-property)
    return { ...base, source_as_of: id in stampById ? stampById[id] : defaultStamp };
  });
  const doc = { schema_version: "product-surface-coverage/v1", generated_at: "2026-07-10T00:00:00.000Z", surfaces };
  if (!markerless) doc.source_stamp_version = stampMarkerValue; // stamp-aware generator marker (rev5.6)
  writeJson(path.join(tmp, "data", "admin", "product-surface-coverage.json"), doc);
}

function seedFinraOccLedger(tmp, { finra, occ }) {
  writeJson(path.join(tmp, "data", "admin", "fenok-s0-finra-occ-mapping-ledger.json"), {
    generated_at: "2026-07-10T00:00:00.000Z",
    source_audit: { source_dates: { finra_source_date: finra, occ_source_date: occ } },
  });
}

function runBuilder(tmp, env, nowIso, { expectExit = 0 } = {}) {
  let status = 0;
  try {
    execFileSync("node", [BUILDER, "--data-root", tmp], {
      env: { ...baseEnv(), ...env, KPI_FAKE_NOW: nowIso },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    status = error.status ?? 1;
  }
  assert.equal(status, expectExit, `builder exit ${status} != ${expectExit}`);
  if (expectExit !== 0) return { exit: status }; // build hard-failed: no output to read
  return {
    root: JSON.parse(fs.readFileSync(path.join(tmp, "data", KPI_REL), "utf8")),
    public: JSON.parse(fs.readFileSync(path.join(tmp, "public", "data", KPI_REL), "utf8")),
  };
}

function runChecker(tmp, nowIso, { strict = false } = {}) {
  const args = [CHECKER, "--data-root", tmp];
  if (strict) args.push("--strict");
  try {
    execFileSync("node", args, {
      env: { ...baseEnv(), KPI_FAKE_NOW: nowIso },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { exit: 0 };
  } catch (error) {
    const stderr = String(error.stderr ?? "");
    const stdout = String(error.stdout ?? "");
    // Surface the child's real failure in CI logs — a swallowed checker error
    // turns an exit-code assertion into an undiagnosable AssertionError.
    console.error(`[runChecker exit=${error.status ?? 1}] stderr:\n${stderr.slice(0, 2048)}`);
    if (stdout) console.error(`[runChecker] stdout:\n${stdout.slice(0, 2048)}`);
    return { exit: error.status ?? 1, stderr };
  }
}

function makeProducerRuntime({ builtAt, slotKey, runId }) {
  return {
    producer_context: {
      built_at: builtAt,
      duration_ms: 12,
      run_id: runId,
      run_attempt: 1,
      event_name: "schedule",
      workflow: "Update Manifest",
      sha: "deadbeef",
      slot_key: slotKey,
      origin: null,
    },
    last_rebuild_context: { built_at: builtAt, run_id: runId, workflow: "Update Manifest", event_name: "schedule", sha: "deadbeef" },
    cadence: { crons_utc: ["30 2 * * *", "30 9 * * *"], slot_grace_minutes: 360, hard_max_age_hours: 26, slot_retention_days: 14, v2_activated_at: builtAt, calendar_version: "market-calendar/v1-2026" },
    slots: { satisfied_slot_keys: slotKey ? [slotKey] : [], last_satisfied_slot_key: slotKey, missed_slot_keys: [], cron_deferrals: [] },
    successful_snapshot_history: [{ built_at: builtAt, slot_key: slotKey, run_id: runId, run_attempt: 1, workflow: "Update Manifest", status: "ready", duration_ms: 12 }],
  };
}

function v2Doc(runtime, extra = {}) {
  return {
    schema_version: "fenok-data-health-kpi/v2",
    generated_at: runtime.producer_context?.built_at ?? "2026-07-10T00:00:00.000Z",
    status: "ready",
    runtime,
    ...extra,
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

console.log("# KPI v2 runtime self-proof fixtures");

// StockAnalysis L/R evidence is projected into the existing stock and surface
// lanes without exposing raw provider errors from the private state artifact.
{
  const now = "2026-07-15T08:10:00.000Z";
  const tmp = mkTmp("stockanalysis-recovery-evidence");
  writeJson(path.join(tmp, "data", "admin", "stockanalysis-recovery", "index.json"), {
    schema_version: "stockanalysis-recovery-index/v1",
    generated_at: now,
    degraded_details: [
      { artifact_kind: "stock", entity: "AAPL", resolution_state: "lkg_primary", payload_sha256: "a".repeat(64), source_as_of: "2026-07-14T20:00:00Z", failure_run_id: "chaos-1", data_loss: false },
      { artifact_kind: "financial", entity: "IBM", resolution_state: "lkg_primary", payload_sha256: "b".repeat(64), source_as_of: "2026-06-30", failure_run_id: "chaos-1", data_loss: false },
      { artifact_kind: "surface", entity: "earnings_calendar", resolution_state: "lkg_primary", payload_sha256: "c".repeat(64), source_as_of: null, failure_run_id: "chaos-1", data_loss: false },
    ],
    recovered_details: [
      { artifact_kind: "stock", entity: "MSFT", payload_sha256: "d".repeat(64), source_as_of: "2026-07-15T20:00:00Z", recovered_from_run_id: "chaos-0", recovered_at: now },
      { artifact_kind: "surface", entity: "actions_recent", payload_sha256: "e".repeat(64), source_as_of: null, recovered_from_run_id: "chaos-0", recovered_at: now },
    ],
    current_attempt: {
      run_id: "recovery-1",
      run_attempt: 1,
      errors: [{ artifact_kind: "stock", entity: "AAPL", error: "PRIVATE PROVIDER ERROR" }],
    },
  });
  const { root } = runBuilder(tmp, {}, now);
  const stockLane = root.lanes.find((item) => item.id === "stock_s1_candidate_gate");
  const surfaceLane = root.lanes.find((item) => item.id === "product_surface_freshness");
  assert.deepEqual(stockLane.details.stockanalysis_recovery.degraded_entities, ["AAPL", "IBM"]);
  assert.deepEqual(stockLane.details.stockanalysis_recovery.recovered_entities, ["MSFT"]);
  assert.deepEqual(surfaceLane.details.stockanalysis_recovery.degraded_entities, ["earnings_calendar"]);
  assert.deepEqual(surfaceLane.details.stockanalysis_recovery.recovered_entities, ["actions_recent"]);
  assert.equal(root.source_artifacts.find((item) => item.id === "stockanalysis_recovery_state").generated_at, now);
  assert.equal(JSON.stringify(root).includes("PRIVATE PROVIDER ERROR"), false);
  ok("StockAnalysis degraded/recovered entities are named in KPI evidence without raw errors");
}

// 0. Real CLI integration: every live row in the installed detection-floor
// report is consumed from data/admin; malformed JSON fails closed.
{
  const now = "2026-07-14T12:00:00.000Z";
  const tmp = mkTmp("detection-floor-live-installed");
  const installedReport = JSON.parse(fs.readFileSync(DETECTION_EXPECTED, "utf8")).baseline.expected_report;
  writeJson(path.join(tmp, "data", "admin", "data-supply-detection-floor.json"), installedReport);
  writeReadyRecoveryIndex(tmp, "yahoo-hourly-ticker", "yahoo_hourly_ticker", ["TQQQ.json", "SOXL.json"]);
  writeReadyRecoveryIndex(tmp, "slickcharts-daily-delivery", "slickcharts_daily_delivery", [
    "gainers.json", "losers.json", "treasury.json", "currency.json", "mortgage.json",
  ]);
  const { root, public: pub } = runBuilder(tmp, {}, now);
  assert.equal(root.totals.lanes, 21);
  for (const laneConfig of DATA_SUPPLY_DETECTION_CONFIG.lanes.filter((item) => item.enforcement === "live")) {
    const mapped = root.lanes.find((item) => item.id === laneConfig.id);
    const sourceRow = installedReport.lanes.find((item) => item.id === laneConfig.id);
    assert.equal(mapped.status, "ready");
    assert.equal(mapped.reason, "ok");
    assert.equal(mapped.artifact.source_as_of, sourceRow.artifact.source_as_of);
    assert.equal(mapped.deployment_blocking, false);
    assert.equal(root.deployment_integrity.blockers.some((item) => item.lane_id === laneConfig.id), false);
  }
  assert.deepEqual(root.source_artifacts.find((item) => item.id === "data_supply_detection_floor"), {
    id: "data_supply_detection_floor",
    generated_at: installedReport.generated_at,
    public_mirror: false,
    public_safe: false,
  });
  assert.equal(root.source_artifacts.find((item) => item.id === "yahoo_hourly_ticker_recovery_state")?.generated_at, "2026-07-14T11:00:00Z");
  assert.equal(root.source_artifacts.find((item) => item.id === "slickcharts_daily_delivery_recovery_state")?.generated_at, "2026-07-14T11:00:00Z");
  const publicYahooRecovery = pub.lanes.find((item) => item.id === "yahoo_ticker_macro")?.details?.recovery;
  assert.deepEqual(Object.keys(publicYahooRecovery).sort(), ["counts", "generated_at", "keys", "lane_id", "retry_keys"]);
  assert.equal(JSON.stringify(publicYahooRecovery).includes("run_id"), false);
  assert.equal(JSON.stringify(publicYahooRecovery).includes("payload_sha256"), false);

  const malformed = mkTmp("detection-floor-live-malformed-json");
  fs.writeFileSync(path.join(malformed, "data", "admin", "data-supply-detection-floor.json"), "{", "utf8");
  runBuilder(malformed, {}, now, { expectExit: 1 });
  ok("all installed live detection-floor rows map into KPI; malformed report fails closed");
}

// 1. push build -> non-authoritative, producer null
{
  const tmp = mkTmp("push");
  const now = "2026-07-10T05:00:00.000Z";
  const { root, public: pub } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "push",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/deploy-worker.yml@refs/heads/main",
    GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "1", GITHUB_ACTOR: "someuser", GITHUB_REF: "refs/heads/main",
  }, now);
  assert.equal(root.schema_version, "fenok-data-health-kpi/v2");
  assert.equal(root.runtime.producer_context, null, "push: producer null");
  assert.equal(root.runtime.authoritative_context.authoritative, false);
  assert.equal(pub.runtime.built_at, null);
  assert.equal(pub.runtime.fresh, false);
  assert.equal(pub.runtime.hard_age_ok, false);
  ok("push build is non-authoritative with null producer and honest public projection");
}

// 2. bare manual dispatch -> non-authoritative
{
  const tmp = mkTmp("bare");
  const now = "2026-07-10T05:00:00.000Z";
  const { root } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/update-manifest.yml@refs/heads/main",
    GITHUB_RUN_ID: "2", GITHUB_RUN_ATTEMPT: "1", GITHUB_ACTOR: "github-actions[bot]", GITHUB_REF: "refs/heads/main",
  }, now);
  assert.equal(root.runtime.producer_context, null, "bare dispatch: producer null");
  assert.equal(root.runtime.authoritative_context.authoritative, false);
  ok("bare manual dispatch (no envelope) is non-authoritative");
}

// 3. invalid-envelope dispatch -> non-authoritative (bad actor)
{
  const tmp = mkTmp("invalid");
  const now = "2026-07-10T05:00:00.000Z";
  const { root } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/update-manifest.yml@refs/heads/main",
    GITHUB_RUN_ID: "3", GITHUB_RUN_ATTEMPT: "1", GITHUB_ACTOR: "attacker", GITHUB_REF: "refs/heads/main",
    KPI_ORIGIN_SOURCE_WORKFLOW: "fenok-edge-daily.yml",
    KPI_ORIGIN_ORIGINAL_EVENT: "schedule",
    KPI_ORIGIN_SLOT_KEY: "fenok-edge-daily.yml:30 0 * * 2-6@2026-07-10T00:30Z",
  }, now);
  assert.equal(root.runtime.producer_context, null, "invalid envelope: producer null");
  assert.match(root.runtime.authoritative_context.reason, /invalid_envelope/);
  ok("invalid-envelope dispatch (bad actor) is non-authoritative");
}

// 4. valid enveloped edge dispatch -> authoritative, producer.slot_key === origin slot
{
  const tmp = mkTmp("valid-dispatch");
  const now = "2026-07-10T00:40:00.000Z"; // Fri
  const slotKey = "fenok-edge-daily.yml:30 0 * * 2-6@2026-07-10T00:30Z";
  const { root, public: pub } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/update-manifest.yml@refs/heads/main",
    GITHUB_RUN_ID: "441", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_ACTOR: "github-actions[bot]", GITHUB_REF: "refs/heads/main",
    KPI_ORIGIN_SOURCE_WORKFLOW: "fenok-edge-daily.yml",
    KPI_ORIGIN_SOURCE_RUN_ID: "999", KPI_ORIGIN_SOURCE_RUN_ATTEMPT: "1",
    KPI_ORIGIN_ORIGINAL_EVENT: "schedule",
    KPI_ORIGIN_SLOT_KEY: slotKey,
  }, now);
  assert.equal(root.runtime.authoritative_context.authoritative, true);
  assert.equal(root.runtime.producer_context.slot_key, slotKey, "producer slot = origin slot");
  assert.equal(root.runtime.producer_context.origin.source_workflow, "fenok-edge-daily.yml");
  assert.deepEqual(root.runtime.slots.satisfied_slot_keys, [slotKey]);
  // public projection equality + deny-key scan
  const expected = projectPublicKpi(root, pub.runtime.evaluated_at);
  assert.equal(JSON.stringify(expected), JSON.stringify(pub), "public == projectPublicKpi(root, stored evaluated_at)");
  for (const key of PUBLIC_RUNTIME_DENY_KEYS) assert.ok(!(key in pub.runtime), `deny key ${key} absent`);
  assert.ok(!JSON.stringify(pub).includes("\"999\""), "origin run id not leaked to public");
  ok("valid enveloped edge dispatch is authoritative; public projection exact + redacted");
}

// 4b. checker end-to-end on a genuinely-ready v2 doc (exit codes + warn-only)
{
  const tmp = mkTmp("checker-ready");
  const now = "2026-07-10T02:35:00.000Z";
  const runtime = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "e2e" });
  runtime.cadence.v2_activated_at = now; // due set empty -> missed empty
  seedReadyV2(tmp, { now, runtime, sla: readySla(now) });
  assert.equal(runChecker(tmp, now).exit, 0, "checker green on ready v2 doc (fresh sources)");
  assert.equal(runChecker(tmp, now, { strict: true }).exit, 0, "strict mode also green when everything fresh");
  ok("checker passes end-to-end on a ready v2 doc in both warn-only and strict modes");
}

// 4b2. Checker independently compares bounded KPI recovery evidence to the source index.
{
  const tmp = mkTmp("checker-recovery-source");
  const now = "2026-07-10T02:35:00.000Z";
  const runtime = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "recovery-source" });
  runtime.cadence.v2_activated_at = now;
  seedReadyV2(tmp, { now, runtime, sla: readySla(now) });
  writeJson(path.join(tmp, "data", "admin", "fdic_tier1", "index.json"), {
    schema_version: "data-supply-lkg-state/v1",
    lane_id: "fdic_tier1",
    updated_at: now,
    retry_set: ["fdic_tier1"],
    items: {
      fdic_tier1: {
        key: "fdic_tier1",
        resolution_state: "lkg_primary",
        retry: true,
        current: {
          path: "data/admin/fdic_tier1/lkg/fdic_tier1.json",
          payload_sha256: "a".repeat(64),
          source_as_of: "2026-03-31",
        },
        lkg: {
          path: "data/admin/fdic_tier1/lkg/fdic_tier1.json",
          payload_sha256: "a".repeat(64),
          source_as_of: "2026-03-31",
        },
        latest_failure: { run_id: "4001" },
      },
    },
  });
  const result = runChecker(tmp, now);
  assert.equal(result.exit, 1);
  assert.match(result.stderr, /KPI recovery_retry_set does not match its source index/);
  ok("checker rejects KPI recovery evidence that omits a source-index retry key");
}

{
  const tmp = mkTmp("checker-recovered-source");
  const now = "2026-07-10T02:35:00.000Z";
  const runtime = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "recovered-source" });
  runtime.cadence.v2_activated_at = now;
  seedReadyV2(tmp, { now, runtime, sla: readySla(now) });
  writeJson(path.join(tmp, "data", "admin", "fdic_tier1", "index.json"), {
    schema_version: "data-supply-lkg-state/v1",
    lane_id: "fdic_tier1",
    updated_at: "2026-07-10T01:00:00.000Z",
    retry_set: [],
    items: {
      fdic_tier1: {
        key: "fdic_tier1",
        resolution_state: "fresh_primary",
        retry: false,
        current: {
          path: "data/fdic/fdic-tier1.json",
          payload_sha256: "b".repeat(64),
          source_as_of: "2026-06-30",
        },
        lkg: {
          path: "data/admin/fdic_tier1/lkg/fdic_tier1.json",
          payload_sha256: "a".repeat(64),
          source_as_of: "2026-03-31",
        },
        recovered_from_run_id: "4001",
        recovered_at: "2026-07-10T01:00:00.000Z",
        recovery_run_id: "4002",
        recovery_run_attempt: 1,
        recovery_event_name: "schedule",
        last_recovered_failure: {
          run_id: "4001",
          run_attempt: 1,
          observed_at: "2026-07-09T01:00:00.000Z",
          reason: "controlled_failure",
        },
      },
    },
  });
  const result = runChecker(tmp, now);
  assert.equal(result.exit, 1);
  assert.match(result.stderr, /KPI recovery_recovered does not match its source index/);
  ok("checker rejects KPI evidence that drops a source-index natural recovery");
}

{
  const tmp = mkTmp("checker-target-recovery-source");
  const now = "2026-07-10T02:35:00.000Z";
  const runtime = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "target-recovery-source" });
  runtime.cadence.v2_activated_at = now;
  seedReadyV2(tmp, { now, runtime, sla: readySla(now) });
  writeReadyRecoveryIndex(tmp, "yahoo-hourly-ticker", "yahoo_hourly_ticker", ["TQQQ.json", "SOXL.json"]);
  const result = runChecker(tmp, now);
  assert.equal(result.exit, 1);
  assert.match(result.stderr, /yahoo_ticker_macro: KPI recovery evidence does not match its source index/);
  ok("checker rejects Yahoo/Slick KPI recovery evidence that diverges from the per-file source index");
}

// 4c. Yahoo lane count/attempt evidence is numeric and arithmetically closed.
{
  const tmp = mkTmp("checker-yahoo-tamper");
  const now = "2026-07-10T02:35:00.000Z";
  const runtime = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "yahoo-tamper" });
  runtime.cadence.v2_activated_at = now;
  const { root } = seedReadyV2(tmp, { now, runtime, sla: readySla(now) });
  const yahoo = root.lanes.find((lane) => lane.id === "yahoo_batch_quote_history");
  yahoo.counts.active = "1";
  yahoo.counts.oldest_source_date = "2026-02-31";
  yahoo.as_of = "2026-02-31";
  yahoo.details.latest_attempt.attempted = 2;
  writeJson(path.join(tmp, "data", KPI_REL), root);
  writeJson(path.join(tmp, "public", "data", KPI_REL), projectPublicKpi(root, now));
  const result = runChecker(tmp, now);
  assert.equal(result.exit, 1, "checker rejects Yahoo numeric coercion and attempt arithmetic tamper");
  assert.match(result.stderr, /oldest source timestamp\/date is malformed/);
  ok("Yahoo lane checker rejects coercive counts and unreconciled current-attempt evidence");
}

{
  const tmp = mkTmp("checker-yahoo-unavailable-detail");
  const now = "2026-07-10T02:35:00.000Z";
  const runtime = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "yahoo-unavailable-detail" });
  runtime.cadence.v2_activated_at = now;
  const { root } = seedReadyV2(tmp, { now, runtime, sla: readySla(now) });
  const yahoo = root.lanes.find((lane) => lane.id === "yahoo_batch_quote_history");
  yahoo.details.unavailable = [{
    symbol: "HOLX",
    failure_attempt_ref: "101",
    failure_observed_at: now,
    failure_kind: "transient_provider_miss",
    lkg_status: "absent",
    data_loss: false,
    deferred_acquisition: true,
    retry: true,
    expected_resolution: "next_natural_yahoo_run",
    private_path: "/tmp/private",
  }];
  writeJson(path.join(tmp, "data", KPI_REL), root);
  writeJson(path.join(tmp, "public", "data", KPI_REL), projectPublicKpi(root, now));
  const result = runChecker(tmp, now);
  assert.equal(result.exit, 1);
  assert.match(result.stderr, /unavailable detail count mismatch/);
  assert.match(result.stderr, /unavailable contains non-public fields: private_path/);
  ok("Yahoo unavailable details are count-bound and reject private fields");

  yahoo.details.unavailable[0] = {
    ...yahoo.details.unavailable[0],
    data_loss: "false",
    deferred_acquisition: "true",
  };
  writeJson(path.join(tmp, "data", KPI_REL), root);
  writeJson(path.join(tmp, "public", "data", KPI_REL), projectPublicKpi(root, now));
  const booleanResult = runChecker(tmp, now);
  assert.match(booleanResult.stderr, /data_loss must be boolean/);
  assert.match(booleanResult.stderr, /deferred_acquisition must be boolean/);

  yahoo.details.unavailable[0] = {
    ...yahoo.details.unavailable[0],
    data_loss: false,
    deferred_acquisition: false,
  };
  writeJson(path.join(tmp, "data", KPI_REL), root);
  writeJson(path.join(tmp, "public", "data", KPI_REL), projectPublicKpi(root, now));
  const deferredResult = runChecker(tmp, now);
  assert.match(deferredResult.stderr, /deferred acquisition provenance is invalid/);

  yahoo.details.unavailable[0] = {
    ...yahoo.details.unavailable[0],
    failure_kind: "legacy_unclassified",
    lkg_status: "lost",
    data_loss: false,
    deferred_acquisition: false,
  };
  writeJson(path.join(tmp, "data", KPI_REL), root);
  writeJson(path.join(tmp, "public", "data", KPI_REL), projectPublicKpi(root, now));
  const dataLossResult = runChecker(tmp, now);
  assert.match(dataLossResult.stderr, /data-loss provenance is invalid/);
}

// 4d. HERMETICITY — seedReadyV2 must NOT inherit a live/regenerated doc's state. Simulate
// the cf:build failure condition: a deliberately-BLOCKED KPI doc already sits at the seed's
// data/admin target (as build:fenok-data-health-kpi emits when a real lane is blocked, e.g.
// etf_public_and_daily_gate on a fetchable ticker). seedReadyV2 must overwrite it with a
// synthesized ready core so the checker still passes — the exact OpenNext fixture-4b failure.
{
  const tmp = mkTmp("hermetic");
  const now = "2026-07-10T02:35:00.000Z";
  // Pre-seed the seed target with a BLOCKED doc (the cf:build regenerated-real-doc state).
  writeJson(path.join(tmp, "data", KPI_REL), {
    schema_version: "fenok-data-health-kpi/v2", generated_at: now, status: "degraded", status_label: "차단",
    raw_policy: { public_mirror_allowed: true, raw_rows_included: false, private_artifact_paths_included: false, private_ledgers_included: false },
    lanes: REQUIRED_LANE_IDS.map((id, i) => ({ id, status: i === 2 ? "blocked" : "ready", required: true, checks: [] })),
    totals: { lanes: REQUIRED_LANE_IDS.length, ready: REQUIRED_LANE_IDS.length - 1, warning: 0, blocked: 1, unavailable: 0, required_not_ready: 1 },
    non_ready_checks: [{ lane_id: "etf_public_and_daily_gate", check_id: "fetchable_zero", status: "blocked", required: true }],
    source_artifacts: [], runtime: null, source_sla: [],
  });
  const runtime = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "hermetic" });
  runtime.cadence.v2_activated_at = now;
  const { root } = seedReadyV2(tmp, { now, runtime, sla: readySla(now) });
  // The synthesized core owes NOTHING to the blocked doc that was sitting there.
  assert.equal(root.status, "ready", "seed synthesizes status=ready regardless of a blocked doc at the target");
  assert.equal(root.totals.required_not_ready, 0, "seed synthesizes totals.required_not_ready=0 (no blocked leak)");
  assert.ok(REQUIRED_LANE_IDS.every((id) => root.lanes.find((l) => l.id === id)?.status === "ready"), "every required lane synthesized ready");
  assert.equal(runChecker(tmp, now).exit, 0, "checker green even though a BLOCKED doc preceded the seed (cf:build repro)");
  assert.equal(runChecker(tmp, now, { strict: true }).exit, 0, "strict also green — fixture is fully hermetic");
  ok("hermeticity: seedReadyV2 ignores a pre-existing BLOCKED data/admin doc (cf:build fixture-4b root cause fixed)");
}

// 5. delayed run outside grace -> slotless (historical extremes +368m / +364m)
for (const [runId, delayMin] of [["26765173733", 368], ["27940007940", 364]]) {
  const tmp = mkTmp(`slotless-${delayMin}`);
  const cronOcc = Date.UTC(2026, 6, 10, 2, 30, 0); // 2026-07-10T02:30Z (Fri)
  const jobStart = new Date(cronOcc + delayMin * 60000).toISOString();
  const now = new Date(cronOcc + (delayMin + 5) * 60000).toISOString();
  // Prior watermark before the occurrence so the passed 02:30 slot is due (thus missable).
  const prior = makeProducerRuntime({ builtAt: "2026-07-09T02:31:00.000Z", slotKey: null, runId: "prev" });
  prior.cadence.v2_activated_at = "2026-07-09T00:00:00.000Z";
  prior.slots.satisfied_slot_keys = [];
  prior.slots.last_satisfied_slot_key = null;
  seedPrior(tmp, v2Doc(prior));
  const { root } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "schedule",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/update-manifest.yml@refs/heads/main",
    GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: "1",
    GITHUB_ACTOR: "github-actions[bot]", GITHUB_REF: "refs/heads/main",
    KPI_EVENT_SCHEDULE: "30 2 * * *",
    KPI_JOB_STARTED_AT: jobStart,
  }, now);
  assert.equal(root.runtime.authoritative_context.authoritative, true, "delayed run still authoritative");
  assert.equal(root.runtime.producer_context.slot_key, null, `+${delayMin}m is slotless (outside 360m grace)`);
  assert.deepEqual(root.runtime.slots.satisfied_slot_keys, [], "slotless run satisfies no slot");
  assert.ok(root.runtime.slots.missed_slot_keys.includes("update-manifest.yml:30 2 * * *@2026-07-10T02:30Z"),
    "the passed 02:30 occurrence is due-but-unsatisfied (missed)");
  assert.equal(root.runtime.successful_snapshot_history.at(-1).run_id, runId, "slotless run recorded in history");
  ok(`delayed run +${delayMin}m (run ${runId}) is slotless yet recorded`);
}

// 5b. run_attempt > 1 is always slotless even when in grace
{
  const tmp = mkTmp("rerun");
  const now = "2026-07-10T02:35:00.000Z";
  const { root } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "schedule",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/update-manifest.yml@refs/heads/main",
    GITHUB_RUN_ID: "77", GITHUB_RUN_ATTEMPT: "3",
    GITHUB_ACTOR: "github-actions[bot]", GITHUB_REF: "refs/heads/main",
    KPI_EVENT_SCHEDULE: "30 2 * * *",
    KPI_JOB_STARTED_AT: "2026-07-10T02:33:00.000Z",
  }, now);
  assert.equal(root.runtime.producer_context.slot_key, null, "run_attempt>1 is slotless");
  ok("run_attempt>1 is always slotless (§2)");
}

// 6. superseded/missed slot: prior watermark 3d back, past occurrences unsatisfied
{
  const tmp = mkTmp("missed");
  const now = "2026-07-10T02:35:00.000Z";
  const prior = makeProducerRuntime({ builtAt: "2026-07-07T02:31:00.000Z", slotKey: null, runId: "old" });
  prior.cadence.v2_activated_at = "2026-07-07T00:00:00.000Z";
  prior.slots.satisfied_slot_keys = [];
  prior.slots.last_satisfied_slot_key = null;
  seedPrior(tmp, v2Doc(prior));
  const currentSlot = "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z";
  const { root } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "schedule",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/update-manifest.yml@refs/heads/main",
    GITHUB_RUN_ID: "600", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_ACTOR: "github-actions[bot]", GITHUB_REF: "refs/heads/main",
    KPI_EVENT_SCHEDULE: "30 2 * * *",
    KPI_JOB_STARTED_AT: "2026-07-10T02:33:00.000Z",
  }, now);
  assert.equal(root.runtime.cadence.v2_activated_at, "2026-07-07T00:00:00.000Z", "watermark carried forward");
  assert.ok(root.runtime.slots.satisfied_slot_keys.includes(currentSlot), "current slot satisfied");
  assert.ok(!root.runtime.slots.missed_slot_keys.includes(currentSlot), "current slot not missed");
  assert.ok(root.runtime.slots.missed_slot_keys.length > 0, "past due occurrences are missed");
  ok("superseded/missed: past due occurrences missed, current slot satisfied");
}

// 7. missing prior v1 -> bootstrap (v2_activated_at = now, no carry)
{
  const tmp = mkTmp("v1prior");
  const now = "2026-07-10T02:35:00.000Z";
  seedPrior(tmp, { schema_version: "fenok-data-health-kpi/v1", generated_at: "2026-07-09T00:00:00Z", status: "ready" });
  const { root } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "schedule",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/update-manifest.yml@refs/heads/main",
    GITHUB_RUN_ID: "700", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_ACTOR: "github-actions[bot]", GITHUB_REF: "refs/heads/main",
    KPI_EVENT_SCHEDULE: "30 2 * * *",
    KPI_JOB_STARTED_AT: "2026-07-10T02:33:00.000Z",
  }, now);
  assert.equal(root.runtime.cadence.v2_activated_at, now, "v1 prior -> fresh watermark = now");
  assert.equal(root.runtime.producer_context.run_id, "700");
  ok("missing prior v1: v2 bootstraps watermark at now, no runtime carry-forward");
}

// 8. deploy/local rebuild preservation — direct-builder write path
{
  const tmp = mkTmp("preserve");
  const now = "2026-07-10T10:00:00.000Z";
  const prior = makeProducerRuntime({ builtAt: "2026-07-10T02:30:30.000Z", slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "auth-1" });
  seedPrior(tmp, v2Doc(prior));
  const { root, public: pub } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "push", // non-authoritative local/deploy rebuild
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/deploy-worker.yml@refs/heads/main",
    GITHUB_RUN_ID: "deploy-9", GITHUB_RUN_ATTEMPT: "1", GITHUB_ACTOR: "github-actions[bot]", GITHUB_REF: "refs/heads/main",
  }, now);
  assert.deepEqual(root.runtime.producer_context, prior.producer_context, "producer_context preserved verbatim");
  assert.deepEqual(root.runtime.slots, prior.slots, "same-clock slot ledger remains byte-equivalent");
  assert.deepEqual(root.runtime.successful_snapshot_history, prior.successful_snapshot_history, "history preserved verbatim");
  assert.equal(root.runtime.last_rebuild_context.run_id, "deploy-9", "only last_rebuild_context updates");
  assert.equal(pub.runtime.built_at, prior.producer_context.built_at, "public built_at reflects preserved producer");
  ok("non-authoritative rebuild preserves producer/history and reconciles the same-clock slot ledger");

  // 8b. post-copy override write path — the ACTUAL sync-static-overrides function,
  // run against a temp root (not the in-memory projector).
  const tmp2 = mkTmp("override");
  const clobberedPublicPath = path.join(tmp2, "public", "data", KPI_REL);
  writeJson(clobberedPublicPath, JSON.parse(JSON.stringify(root))); // cp ../data -> public clobber
  projectFenokDataHealthKpiPublicMirror({ rootDir: tmp2, nowIso: now });
  const overridden = JSON.parse(fs.readFileSync(clobberedPublicPath, "utf8"));
  const denySet = new Set(PUBLIC_RUNTIME_DENY_KEYS);
  (function assertNoDeny(node, p) {
    if (Array.isArray(node)) return node.forEach((x, i) => assertNoDeny(x, `${p}[${i}]`));
    if (node && typeof node === "object") for (const k of Object.keys(node)) {
      assert.ok(!denySet.has(k), `override output must not expose ${k} at ${p}`);
      assertNoDeny(node[k], `${p}.${k}`);
    }
  })(overridden, "$");
  assert.equal(overridden.runtime.built_at, prior.producer_context.built_at, "override keeps producer built_at");
  assert.equal(overridden.runtime.evaluated_at, now, "override used injected clock");
  assert.ok(!fs.existsSync(`${clobberedPublicPath}.tmp`), "atomic write left no .tmp");
  ok("real sync-static override path re-projects the clobbered public mirror on a temp root (atomic, recursive-clean)");
}

// 8c. A non-authoritative rebuild may not claim a producer slot, but it MUST advance
// the derived missed-slot ledger to its own generated_at clock. This is the exact
// 2026-07-15 failure: the 09:30Z Update Manifest run genuinely failed, then a later
// manual rebuild crossed the 360-minute grace boundary while preserving missed=[].
{
  const tmp = mkTmp("non-auth-missed-ledger");
  const missedSlot = "update-manifest.yml:30 9 * * *@2026-07-15T09:30Z";
  const priorSlot = "update-manifest.yml:30 2 * * *@2026-07-15T02:30Z";
  const prior = makeProducerRuntime({
    builtAt: "2026-07-15T05:18:13.940Z",
    slotKey: priorSlot,
    runId: "29390832379",
  });
  prior.cadence.v2_activated_at = "2026-07-15T01:00:00.000Z";
  prior.slots = {
    satisfied_slot_keys: [priorSlot],
    last_satisfied_slot_key: priorSlot,
    missed_slot_keys: [],
    cron_deferrals: [],
  };
  seedPrior(tmp, v2Doc(prior));

  const buildAt = "2026-07-15T15:50:06.000Z";
  const { root: rebuilt } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/update-manifest.yml@refs/heads/main",
    GITHUB_RUN_ID: "29429461165", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_ACTOR: "owner", GITHUB_REF: "refs/heads/main",
  }, buildAt);
  assert.equal(rebuilt.runtime.authoritative_context.authoritative, false, "bare manual rebuild stays non-authoritative");
  assert.ok(rebuilt.runtime.slots.missed_slot_keys.includes(missedSlot),
    "non-authoritative rebuild records a genuinely missed slot once its own build clock crosses grace");

  // Keep the real miss blocking until a later authoritative full snapshot recovers it,
  // but prove the builder/checker equality invariant itself is no longer divergent.
  seedReadyV2(tmp, { now: buildAt, runtime: rebuilt.runtime, sla: readySla(buildAt) });
  const blocked = runChecker(tmp, buildAt, { strict: true });
  assert.equal(blocked.exit, 1, "the genuine unrecovered miss remains a strict blocker");
  assert.doesNotMatch(blocked.stderr, /missed_slot_keys re-derivation mismatch/,
    "builder and checker agree on the same canonical cron, retention, and build clock");
  assert.match(blocked.stderr, /retained missed slot\(s\) lack a later authoritative ready full-snapshot recovery/,
    "the real miss is preserved instead of papered over");

  // The next successful scheduled full snapshot retains the fact and supplies the
  // recovery evidence, changing BLOCKED -> DEGRADED without deleting the miss. The
  // unrelated 10:30Z KRX producer is marked satisfied so this fixture isolates the
  // failed 09:30Z Update Manifest occurrence.
  rebuilt.runtime.slots.satisfied_slot_keys.push("fenok-edge-krx-daily.yml:30 10 * * 1-5@2026-07-15T10:30Z");
  const recoveryAt = "2026-07-16T02:40:00.000Z";
  const recoveredRuntime = buildRuntime({
    nowIso: recoveryAt,
    priorRuntime: rebuilt.runtime,
    snapshotStatus: "ready",
    env: {
      GITHUB_EVENT_NAME: "schedule",
      GITHUB_WORKFLOW: "Update Manifest",
      GITHUB_WORKFLOW_REF: "o/r/.github/workflows/update-manifest.yml@refs/heads/main",
      GITHUB_RUN_ID: "next-schedule", GITHUB_RUN_ATTEMPT: "1",
      GITHUB_ACTOR: "github-actions[bot]", GITHUB_REF: "refs/heads/main",
      KPI_EVENT_SCHEDULE: "30 2 * * *",
      KPI_JOB_STARTED_AT: "2026-07-16T02:35:00.000Z",
    },
  });
  assert.ok(recoveredRuntime.slots.missed_slot_keys.includes(missedSlot), "recovery retains the historical miss");
  assert.equal(classifyRuntimeSlots(recoveredRuntime).status, "degraded", "later ready full snapshot recovers the miss");
  const runtimeErrors = [];
  const runtimeWarnings = [];
  checkV2Runtime(v2Doc(recoveredRuntime), { errors: runtimeErrors, warnings: runtimeWarnings }, recoveryAt);
  assert.deepEqual(runtimeErrors, [], "recovered historical miss has no runtime hard error");
  assert.ok(runtimeWarnings.some((message) => /recovered by later authoritative ready full snapshot/.test(message)),
    "recovered historical miss remains visible as a DEC-264 warning");
  ok("non-authoritative rebuild records genuine missed slots; later authoritative snapshot recovers without erasing history");
}

// 9. checker functions on an in-memory authoritative doc (projection equality + sla + runtime)
{
  const now = "2026-07-10T02:35:00.000Z";
  const runtime = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "z" });
  runtime.cadence.v2_activated_at = now;
  const root = v2Doc(runtime, { source_sla: readySla(now) });
  const pub = projectPublicKpi(root, now);
  const errors = [];
  const warnings = [];
  checkV2Runtime(root, { errors, warnings }, now);
  checkSourceSla(root, { errors, warnings }, now);
  checkPublicProjection(root, pub, { errors, warnings });
  assert.equal(errors.length, 0, `no hard errors: ${errors.join("; ")}`);
  ok("checker validation functions accept a well-formed v2 doc with no hard errors");

  // tamper: public runtime deny key present -> hard error
  const tampered = JSON.parse(JSON.stringify(pub));
  tampered.runtime.run_id = "leak";
  const e2 = [];
  checkPublicProjection(root, tampered, { errors: e2, warnings: [] });
  assert.ok(e2.some((m) => /forbidden runtime-identity key.*run_id/.test(m)), "deny-key leak is a hard error");
  ok("redaction deny-key scan flags a leaked run_id as a hard error");

  // nested leak deeper than runtime top-level is also caught (recursive scan)
  const nested = JSON.parse(JSON.stringify(pub));
  nested.lanes = [{ id: "x", details: { origin: { source_run_id: "leak" } } }];
  const e3 = [];
  checkPublicProjection(root, nested, { errors: e3, warnings: [] });
  assert.ok(e3.some((m) => /forbidden runtime-identity key.*origin/.test(m)), "nested deny-key leak caught by recursive scan");
  ok("recursive deny-key scan catches a leak nested below runtime top-level");
}

// 10. per-source SLA staleness (contract §5) — builder emits stale/ready from source dates
{
  const now = "2026-07-10T05:00:00.000Z";

  const tmpStale = mkTmp("sla-stale");
  seedFinraOccLedger(tmpStale, { finra: "20260601", occ: "20260601" }); // >3 business days old
  const { root: staleRoot } = runBuilder(tmpStale, {
    GITHUB_EVENT_NAME: "push", GITHUB_WORKFLOW_REF: "o/r/.github/workflows/deploy-worker.yml@refs/heads/main",
    GITHUB_RUN_ID: "s1", GITHUB_RUN_ATTEMPT: "1",
  }, now);
  const staleEntry = staleRoot.source_sla.find((s) => s.source_id === "s0_finra_occ_mapping_ledger");
  assert.equal(staleEntry.source_date, "2026-06-01", "oldest of finra/occ source dates");
  assert.equal(staleEntry.status, "stale", "old required source is stale");

  const tmpFresh = mkTmp("sla-fresh");
  seedFinraOccLedger(tmpFresh, { finra: "20260709", occ: "20260708" });
  const { root: freshRoot } = runBuilder(tmpFresh, {
    GITHUB_EVENT_NAME: "push", GITHUB_WORKFLOW_REF: "o/r/.github/workflows/deploy-worker.yml@refs/heads/main",
    GITHUB_RUN_ID: "s2", GITHUB_RUN_ATTEMPT: "1",
  }, now);
  const freshEntry = freshRoot.source_sla.find((s) => s.source_id === "s0_finra_occ_mapping_ledger");
  assert.equal(freshEntry.source_date, "2026-07-08", "oldest of finra/occ = occ 07-08");
  assert.equal(freshEntry.status, "ready", "recent required source is ready");
  ok("per-source SLA: builder emits stale for old required source and ready for recent one");
}

// 10b. stale REQUIRED source degrades its lane in both modes; it is not corruption.
{
  const now = "2026-07-10T02:35:00.000Z";
  const tmp = mkTmp("sla-checker");
  const runtime = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "sla" });
  runtime.cadence.v2_activated_at = now;
  seedReadyV2(tmp, { now, runtime, sla: readySla(now, { staleFinra: true }) });
  assert.equal(runChecker(tmp, now).exit, 0, "Phase A: stale required source is warn-only (exit 0)");
  assert.equal(runChecker(tmp, now, { strict: true }).exit, 0, "strict: stale required source stays lane-local (exit 0)");
  ok("stale required source: visible warning without a platform-wide strict block");
}

// 11. FIX 1 — a delayed 02:30 run at 09:35 must NOT claim the 09:30 slot
{
  const tmp = mkTmp("own-cron");
  const now = "2026-07-10T09:40:00.000Z";
  const { root } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "schedule",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/update-manifest.yml@refs/heads/main",
    GITHUB_RUN_ID: "own1", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_ACTOR: "github-actions[bot]", GITHUB_REF: "refs/heads/main",
    KPI_EVENT_SCHEDULE: "30 2 * * *", // this run WAS the 02:30 cron, delayed
    KPI_JOB_STARTED_AT: "2026-07-10T09:35:00.000Z",
  }, now);
  assert.equal(root.runtime.producer_context.slot_key, null, "02:30 run delayed to 09:35 is slotless on its own cron");
  assert.ok(!root.runtime.slots.satisfied_slot_keys.includes("update-manifest.yml:30 9 * * *@2026-07-10T09:30Z"),
    "must NOT falsely claim the 09:30 slot");

  // Positive contrast: a genuine 09:30 run at 09:35 claims the 09:30 slot.
  const tmp2 = mkTmp("own-cron-pos");
  const { root: r2 } = runBuilder(tmp2, {
    GITHUB_EVENT_NAME: "schedule",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/update-manifest.yml@refs/heads/main",
    GITHUB_RUN_ID: "own2", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_ACTOR: "github-actions[bot]", GITHUB_REF: "refs/heads/main",
    KPI_EVENT_SCHEDULE: "30 9 * * *",
    KPI_JOB_STARTED_AT: "2026-07-10T09:35:00.000Z",
  }, now);
  assert.equal(r2.runtime.producer_context.slot_key, "update-manifest.yml:30 9 * * *@2026-07-10T09:30Z",
    "genuine 09:30 run claims the 09:30 slot on its own cron");
  ok("FIX 1: schedule slot inferred on the run's OWN cron only (no cross-cron false claim)");
}

// 12. FIX 2 — stale/replayed and attempt-2 dispatch envelopes
{
  // (a) 10-day-old canonical slot_key -> non-authoritative (outside grace of now)
  const tmp = mkTmp("stale-env");
  const now = "2026-07-10T00:40:00.000Z";
  const { root } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/update-manifest.yml@refs/heads/main",
    GITHUB_RUN_ID: "st1", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_ACTOR: "github-actions[bot]", GITHUB_REF: "refs/heads/main",
    KPI_ORIGIN_SOURCE_WORKFLOW: "fenok-edge-daily.yml",
    KPI_ORIGIN_SOURCE_RUN_ATTEMPT: "1",
    KPI_ORIGIN_ORIGINAL_EVENT: "schedule",
    KPI_ORIGIN_SLOT_KEY: "fenok-edge-daily.yml:30 0 * * 2-6@2026-06-30T00:30Z",
  }, now);
  assert.equal(root.runtime.producer_context, null, "stale replayed slot_key -> non-authoritative");
  assert.match(root.runtime.authoritative_context.reason, /origin_slot_key/);

  // (b) fresh slot but source_run_attempt=2 -> authoritative but slotless
  const tmp2 = mkTmp("attempt2-env");
  const { root: r2 } = runBuilder(tmp2, {
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/update-manifest.yml@refs/heads/main",
    GITHUB_RUN_ID: "st2", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_ACTOR: "github-actions[bot]", GITHUB_REF: "refs/heads/main",
    KPI_ORIGIN_SOURCE_WORKFLOW: "fenok-edge-daily.yml",
    KPI_ORIGIN_SOURCE_RUN_ATTEMPT: "2",
    KPI_ORIGIN_ORIGINAL_EVENT: "schedule",
    KPI_ORIGIN_SLOT_KEY: "fenok-edge-daily.yml:30 0 * * 2-6@2026-07-10T00:30Z",
  }, now);
  assert.equal(r2.runtime.authoritative_context.authoritative, true, "attempt-2 valid envelope is still authoritative");
  assert.equal(r2.runtime.producer_context.slot_key, null, "source_run_attempt>1 -> slotless (claims no slot)");
  assert.deepEqual(r2.runtime.slots.satisfied_slot_keys, [], "attempt-2 dispatch satisfies no slot");
  ok("FIX 2: stale-replayed envelope rejected; attempt-2 envelope authoritative-but-slotless");
}

// 13. FIX 3 — under strict, a 48h-old producer vs the CHECKER clock is a hard error
{
  const tmp = mkTmp("frozen");
  const built = "2026-07-10T02:30:00.000Z";
  const checkerNow = "2026-07-12T02:35:00.000Z"; // ~48h later, producer never rebuilt
  const runtime = makeProducerRuntime({ builtAt: built, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "frozen" });
  runtime.cadence.v2_activated_at = built; // due/missed empty at build clock
  seedReadyV2(tmp, { now: built, runtime, sla: readySla(built) });
  assert.equal(runChecker(tmp, checkerNow).exit, 0, "Phase A: frozen 48h producer is warn-only (exit 0)");
  assert.equal(runChecker(tmp, checkerNow, { strict: true }).exit, 1, "strict: 48h producer vs checker clock is a hard error (exit 1)");
  ok("FIX 3: frozen-green producer (48h stale vs checker clock) blocks under strict, warns in Phase A");
}

// 14. Missing/unavailable source SLA evidence is lane readiness, not schema corruption.
{
  const now = "2026-07-10T02:35:00.000Z";
  const mkReady = (overrides) => {
    const tmp = mkTmp("sla-failclosed");
    const runtime = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "fc" });
    runtime.cadence.v2_activated_at = now;
    seedReadyV2(tmp, { now, runtime, sla: readySla(now, overrides) });
    return tmp;
  };
  for (const [label, overrides] of [["empty", { emptySla: true }], ["dropped-required", { dropRequired: true }], ["unavailable-required", { unavailableRequired: true }]]) {
    const tmp = mkReady(overrides);
    assert.equal(runChecker(tmp, now).exit, 0, `Phase A: ${label} SLA is warn-only (exit 0)`);
    assert.equal(runChecker(tmp, now, { strict: true }).exit, 0, `strict: ${label} SLA degrades its lane (exit 0)`);
  }
  ok("FIX 5a: empty / missing-required / unavailable-required SLA remains visible without freezing other lanes");
}

// 15. FIX 5d — future-dated source is an anomaly, never clamped to ready
{
  const now = "2026-07-10T05:00:00.000Z";
  // (a) builder: a future source date is flagged, not read as age-0 fresh
  const tmp = mkTmp("future-build");
  seedFinraOccLedger(tmp, { finra: "20260720", occ: "20260720" }); // 10 days in the future
  const { root } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "push", GITHUB_WORKFLOW_REF: "o/r/.github/workflows/deploy-worker.yml@refs/heads/main",
    GITHUB_RUN_ID: "fut", GITHUB_RUN_ATTEMPT: "1",
  }, now);
  const futureEntry = root.source_sla.find((s) => s.source_id === "s0_finra_occ_mapping_ledger");
  assert.equal(futureEntry.status, "future_date_anomaly", "future source date is an anomaly, not ready");
  assert.equal(futureEntry.future_date_anomaly, true, "future anomaly flagged");

  // (b) checker: future required source is timestamp corruption and always fails closed
  const tmp2 = mkTmp("future-check");
  const runtime = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "fut2" });
  runtime.cadence.v2_activated_at = now;
  seedReadyV2(tmp2, { now, runtime, sla: readySla(now, { futureRequired: true }) });
  assert.equal(runChecker(tmp2, now).exit, 1, "Phase A: future-dated required source is a hard anomaly (exit 1)");
  assert.equal(runChecker(tmp2, now, { strict: true }).exit, 1, "strict: future-dated required source fails closed (exit 1)");
  ok("FIX 5d: future-dated source is a global timestamp-integrity anomaly in both modes");
}

// 16. ROOT — SLA definitional tamper is a HARD error even in Phase A (never warn-only)
{
  const now = "2026-07-10T02:35:00.000Z";
  const tmp = mkTmp("sla-tamper");
  const runtime = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "t" });
  runtime.cadence.v2_activated_at = now;
  const sla = readySla(now, { tamper: (list) => {
    const e = list.find((x) => x.source_id === "rim_index_inputs");
    e.required = false; e.max_staleness = 999999; e.freshness_basis = "mutated";
  } });
  seedReadyV2(tmp, { now, runtime, sla });
  assert.equal(runChecker(tmp, now).exit, 1, "SLA definitional tamper is a hard error in Phase A");
  ok("ROOT: SLA definitional tamper (required/max/basis mutated) hard-errors even in Phase A");
}

// 17. ROOT — cadence tamper + malformed producer are HARD errors even in Phase A
{
  const now = "2026-07-10T02:35:00.000Z";

  const tmpCad = mkTmp("cadence-tamper");
  const rtCad = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "c" });
  rtCad.cadence.v2_activated_at = now;
  rtCad.cadence.hard_max_age_hours = 9999; // definition tamper
  seedReadyV2(tmpCad, { now, runtime: rtCad, sla: readySla(now) });
  assert.equal(runChecker(tmpCad, now).exit, 1, "cadence ceiling=9999 tamper hard-errors in Phase A");

  const tmpProd = mkTmp("producer-empty");
  const rtProd = makeProducerRuntime({ builtAt: now, slotKey: null, runId: "p" });
  rtProd.cadence.v2_activated_at = now;
  rtProd.slots = { satisfied_slot_keys: [], last_satisfied_slot_key: null, missed_slot_keys: [], cron_deferrals: [] };
  rtProd.producer_context = {}; // malformed: no built_at / run_id / workflow / event_name
  seedReadyV2(tmpProd, { now, runtime: rtProd, sla: readySla(now) });
  assert.equal(runChecker(tmpProd, now).exit, 1, "producer_context={} hard-errors in Phase A");

  const tmpGarbage = mkTmp("producer-garbage");
  const rtG = makeProducerRuntime({ builtAt: "garbage", slotKey: null, runId: "g" });
  rtG.cadence.v2_activated_at = now;
  rtG.slots = { satisfied_slot_keys: [], last_satisfied_slot_key: null, missed_slot_keys: [], cron_deferrals: [] };
  seedReadyV2(tmpGarbage, { now, runtime: rtG, sla: readySla(now) });
  assert.equal(runChecker(tmpGarbage, now).exit, 1, "producer_context.built_at='garbage' hard-errors in Phase A");
  ok("ROOT: cadence tamper + malformed producer (empty / garbage built_at) hard-error even in Phase A");
}

// 18. AGE-BAND BOUNDARY — explicit named boundary fixtures (auditor-findable)
//     ceiling = hard_max_age_hours = 26h; tolerance band = 10m.
{
  const built = "2026-07-10T02:30:00.000Z";
  const ageBandCeilingPlus5m = "2026-07-11T04:35:00.000Z";  // built + 26h05m
  const ageBandCeilingPlus11m = "2026-07-11T04:41:00.000Z"; // built + 26h11m
  const mk = () => {
    const tmp = mkTmp("age-band-boundary");
    const rt = makeProducerRuntime({ builtAt: built, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "b" });
    rt.cadence.v2_activated_at = built;
    seedReadyV2(tmp, { now: built, runtime: rt, sla: readySla(built) });
    return tmp;
  };
  assert.equal(runChecker(mk(), ageBandCeilingPlus5m, { strict: true }).exit, 0, "age_band_ceiling_plus_5m: within band, strict passes");
  ok("age band boundary ceiling+5m PASSES strict (within 10m tolerance)");
  assert.equal(runChecker(mk(), ageBandCeilingPlus11m, { strict: true }).exit, 1, "age_band_ceiling_plus_11m: beyond band, strict fails");
  ok("age band boundary ceiling+11m FAILS strict (beyond 10m tolerance)");
}

// 19. ADDENDUM (a) — FUTURE producer built_at vs checker clock: +1h rejected, +5m tolerated
{
  const checkerNow = "2026-07-10T02:30:00.000Z";
  const mk = (builtAt, slotTs) => {
    const tmp = mkTmp("future-built");
    const rt = makeProducerRuntime({ builtAt, slotKey: `update-manifest.yml:30 2 * * *@${slotTs}`, runId: "f" });
    rt.cadence.v2_activated_at = builtAt; // watermark=built so missed stays empty at the build clock
    rt.slots = { satisfied_slot_keys: [rt.producer_context.slot_key], last_satisfied_slot_key: rt.producer_context.slot_key, missed_slot_keys: [], cron_deferrals: [] };
    seedReadyV2(tmp, { now: builtAt, runtime: rt, sla: readySla(builtAt) });
    return tmp;
  };
  // built_at = checkerNow + 1h -> beyond 10m band -> hard error even in Phase A
  assert.equal(runChecker(mk("2026-07-10T03:30:00.000Z", "2026-07-10T02:30Z"), checkerNow).exit, 1,
    "producer built_at = checkerNow+1h is a hard error even in Phase A");
  // built_at = checkerNow + 5m -> within 10m skew band -> tolerated
  assert.equal(runChecker(mk("2026-07-10T02:35:00.000Z", "2026-07-10T02:30Z"), checkerNow).exit, 0,
    "producer built_at = checkerNow+5m is within the skew band -> tolerated");
  ok("ADDENDUM (a): future producer built_at rejected at +1h, tolerated at +5m (skew band)");
}

// 20. ADDENDUM (b) — etf_core SLA max_staleness is the SAME number as the basket config
{
  const etfCoreDef = SOURCE_SLA_DEF.find((d) => d.source_id === "etf_core_daily_basket_admin");
  assert.equal(etfCoreDef.max_staleness, ETF_CORE_DAILY_BASKET_CONFIG.maxQuoteAgeDays,
    "etf_core SLA max_staleness must equal ETF_CORE_DAILY_BASKET_CONFIG.maxQuoteAgeDays (no second number)");
  ok("ADDENDUM (b): etf_core SLA max_staleness stays single-sourced with the basket config (drift guard)");
}

// 21. SLA tamper — unit / calendar mutation, duplicate row, unknown extra row.
//     Each is a DEFINITION tamper => hard error in BOTH Phase A and strict.
{
  const now = "2026-07-10T02:35:00.000Z";
  const mkTampered = (tamper) => {
    const tmp = mkTmp("sla-tamper-cases");
    const rt = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "tc" });
    rt.cadence.v2_activated_at = now;
    seedReadyV2(tmp, { now, runtime: rt, sla: readySla(now, { tamper }) });
    return tmp;
  };
  const cases = [
    ["unit mutated (business_days->hours)", (list) => { list.find((x) => x.source_id === "s0_finra_occ_mapping_ledger").unit = "hours"; }],
    ["calendar mutated (us_market->wall_clock)", (list) => { list.find((x) => x.source_id === "s0_finra_occ_mapping_ledger").calendar = "wall_clock"; }],
    ["duplicate source_id row", (list) => { list.push(JSON.parse(JSON.stringify(list.find((x) => x.source_id === "rim_index_inputs")))); }],
    ["unknown extra source_id row", (list) => { list.push({ source_id: "bogus_source", freshness_basis: ".x", unit: "hours", calendar: "wall_clock", max_staleness: 1, required: true, source_date: null, age: null, status: "unavailable" }); }],
  ];
  for (const [label, tamper] of cases) {
    const tmp = mkTampered(tamper);
    assert.equal(runChecker(tmp, now).exit, 1, `Phase A: ${label} is a hard error (exit 1)`);
    assert.equal(runChecker(tmp, now, { strict: true }).exit, 1, `strict: ${label} is a hard error (exit 1)`);
  }
  ok("SLA tamper: unit/calendar mutation + duplicate row + unknown extra row all hard-error in Phase A AND strict");
}

// 22. Product-surface stamp classification (builder, via real generator-shaped input)
{
  const now = "2026-07-10T05:00:00.000Z";
  const psEntry = (root) => root.source_sla.find((s) => s.source_id === "product_surface_coverage");
  const buildWith = (seedOpts) => {
    const tmp = mkTmp("prod-surface");
    seedProductCoverage(tmp, seedOpts);
    const { root } = runBuilder(tmp, {
      GITHUB_EVENT_NAME: "push", GITHUB_WORKFLOW_REF: "o/r/.github/workflows/deploy-worker.yml@refs/heads/main",
      GITHUB_RUN_ID: "ps", GITHUB_RUN_ATTEMPT: "1",
    }, now);
    return psEntry(root);
  };

  // (a) all required surfaces stamped fresh -> OLDEST, ready; ever_stamped true
  const ready = buildWith({ defaultStamp: "2026-07-09" });
  assert.equal(ready.source_date, "2026-07-09", "stamped: aggregate = OLDEST");
  assert.equal(ready.status, "ready");
  assert.ok(!ready.pending_source_stamp, "stamped is not pending");
  assert.equal(ready.pending.ever_stamped, true, "stamped sets ever_stamped=true");
  // (b) all stamped OLD -> stale
  assert.equal(buildWith({ defaultStamp: "2026-06-01" }).status, "stale", "stamped old -> stale");
  // (c) ALL null -> pending (with pending marker); ever_stamped false (never stamped)
  const pending = buildWith({ defaultStamp: null });
  assert.equal(pending.status, "unavailable_pending_source_stamp", "all-null -> pending");
  assert.equal(pending.pending_source_stamp, true);
  assert.ok(typeof pending.pending.pending_since === "string", "pending carries pending.pending_since");
  assert.equal(pending.pending.ever_stamped, false, "bootstrap pending: ever_stamped false");
  // (c2) MIXED (some stamped, some null) -> validly PENDING (rev5.4), NOT partial
  const mixed = buildWith({ defaultStamp: "2026-07-09", stampById: { market_events: null } });
  assert.equal(mixed.status, "unavailable_pending_source_stamp", "mixed stamped/null -> validly pending");
  assert.equal(mixed.pending_source_stamp, true, "mixed is pending (at least one null)");
  // (d) all future -> anomaly
  const future = buildWith({ defaultStamp: "2026-07-20" });
  assert.equal(future.status, "future_date_anomaly");
  assert.equal(future.future_date_anomaly, true);
  ok("Product-surface: all-stamped->ready/stale, all-null & mixed->pending, future->anomaly");
}

// 23. FIX 1 — MIXED-FUTURE: future detected PER value BEFORE the OLDEST fold
{
  const now = "2026-07-10T05:00:00.000Z";
  const tmp = mkTmp("mixed-future");
  seedProductCoverage(tmp, { defaultStamp: "2026-07-09", stampById: { screener: "2026-07-20" } }); // 5 fresh + 1 future
  const { root } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "push", GITHUB_WORKFLOW_REF: "o/r/.github/workflows/deploy-worker.yml@refs/heads/main",
    GITHUB_RUN_ID: "mf", GITHUB_RUN_ATTEMPT: "1",
  }, now);
  const ps = root.source_sla.find((s) => s.source_id === "product_surface_coverage");
  assert.equal(ps.status, "future_date_anomaly", "one future stamp among fresh -> anomaly, NOT clean 2026-07-09");
  assert.equal(ps.future_date_anomaly, true);
  ok("FIX 1: mixed fresh+future stamps flag future_date_anomaly (per-value future before OLDEST fold)");
}

// 24. FIX 2 — SHAPE-STRICT pending: duplicate / missing / malformed = hard error (Phase A + strict)
{
  const now = "2026-07-10T02:35:00.000Z";
  const runShape = (rawRows) => {
    const tmp = mkTmp("ps-shape");
    const rt = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "sh" });
    rt.cadence.v2_activated_at = now;
    seedReadyV2(tmp, { now, runtime: rt, sla: readySla(now, { productSurface: { rawRows } }) });
    return tmp;
  };
  const baseRows = REQUIRED_SURFACE_IDS.map((id) => ({ id, source_as_of: null }));
  const cases = [
    ["duplicate required id", [...baseRows, { id: "market_valuation", source_as_of: null }]],
    ["missing required row", baseRows.filter((r) => r.id !== "screener")],
    ["malformed value (number)", baseRows.map((r) => (r.id === "sectors" ? { id: "sectors", source_as_of: 123 } : r))],
    ["malformed value (garbage string)", baseRows.map((r) => (r.id === "sectors" ? { id: "sectors", source_as_of: "not-a-date" } : r))],
  ];
  for (const [label, rawRows] of cases) {
    const tmp = runShape(rawRows);
    assert.equal(runChecker(tmp, now).exit, 1, `Phase A: product_surface ${label} is a hard error`);
    assert.equal(runChecker(tmp, now, { strict: true }).exit, 1, `strict: product_surface ${label} is a hard error`);
  }
  ok("FIX 2: shape-strict pending — duplicate/missing/malformed required surface rows hard-error (Phase A + strict)");
}

// 25. sticky pending_since: age is lane readiness; malformed/future timestamps remain hard.
{
  // preservation across rebuild: prior committed KPI pending_since must survive a rebuild
  const now = "2026-07-10T02:35:00.000Z";
  const priorSince = "2026-07-01T00:00:00.000Z";
  const tmp = mkTmp("pending-preserve");
  const prior = makeProducerRuntime({ builtAt: now, slotKey: null, runId: "prev" });
  prior.cadence.v2_activated_at = now;
  prior.slots = { satisfied_slot_keys: [], last_satisfied_slot_key: null, missed_slot_keys: [], cron_deferrals: [] };
  seedPrior(tmp, v2Doc(prior, {
    source_sla: [{ source_id: "product_surface_coverage", freshness_basis: ".surfaces[REQUIRED_SURFACE_IDS].source_as_of (OLDEST)", unit: "business_days", calendar: "us_market", max_staleness: 3, required: true, source_date: null, age: null, status: "unavailable_pending_source_stamp", pending_source_stamp: true, pending: { pending_since: priorSince, ever_stamped: false } }],
  }));
  seedProductCoverage(tmp, { defaultStamp: null }); // still all-null -> still pending
  const { root } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "push", GITHUB_WORKFLOW_REF: "o/r/.github/workflows/deploy-worker.yml@refs/heads/main",
    GITHUB_RUN_ID: "pp", GITHUB_RUN_ATTEMPT: "1",
  }, now);
  const ps = root.source_sla.find((s) => s.source_id === "product_surface_coverage");
  assert.equal(ps.pending.pending_since, priorSince, "pending_since preserved across rebuild (not reset to now)");
  ok("FIX 3a: pending_since is sticky — preserved across rebuilds from the prior committed KPI");

  // checker: pending_since age gate vs canonical PENDING_MAX_AGE_DAYS=14 (clock near
  // 07-10 so the OTHER sources stay fresh; only pending_since varies).
  const checkerNow = "2026-07-10T02:35:00.000Z";
  const mkPending = (pendingSince) => {
    const t = mkTmp("pending-age");
    const rt = makeProducerRuntime({ builtAt: checkerNow, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "pa" });
    rt.cadence.v2_activated_at = checkerNow;
    seedReadyV2(t, { now: checkerNow, runtime: rt, sla: readySla(checkerNow, { productSurface: { defaultStamp: null, pendingSince } }) });
    return t;
  };
  const at13d = new Date(new Date(checkerNow).getTime() - 13 * 86400000).toISOString();
  const at15d = new Date(new Date(checkerNow).getTime() - 15 * 86400000).toISOString();
  assert.equal(runChecker(mkPending(at13d), checkerNow, { strict: true }).exit, 0, "13d pending -> strict WARN (exit 0)");
  assert.equal(runChecker(mkPending(at15d), checkerNow, { strict: true }).exit, 0, "15d pending -> strict lane warning (exit 0)");
  assert.equal(runChecker(mkPending(at15d), checkerNow).exit, 0, "15d pending -> Phase A warn-only (exit 0, no time-bomb)");
  assert.equal(runChecker(mkPending("garbage"), checkerNow).exit, 1, "invalid pending_since -> hard error even Phase A");
  const futurePs = new Date(new Date(checkerNow).getTime() + 3 * 86400000).toISOString();
  assert.equal(runChecker(mkPending(futurePs), checkerNow).exit, 1, "future pending_since -> hard error even Phase A");
  ok("FIX 3b: pending age degrades one lane; invalid/future pending timestamps remain hard");
}

// 25c. ANTI-OSCILLATION evidence remains visible, but is a lane-local regression.
{
  const now = "2026-07-10T02:35:00.000Z";
  const tmp = mkTmp("oscillation");
  const rt = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "os" });
  rt.cadence.v2_activated_at = now;
  // pending, ever_stamped=true, pending_since FRESH (0d) — regression remains visible.
  seedReadyV2(tmp, { now, runtime: rt, sla: readySla(now, { productSurface: { defaultStamp: null, priorEverStamped: true, pendingSince: now } }) });
  assert.equal(runChecker(tmp, now).exit, 0, "Phase A: post-stamped regression is warn-only");
  assert.equal(runChecker(tmp, now, { strict: true }).exit, 0, "strict: regression degrades only the product-surface lane");
  ok("ANTI-OSCILLATION: ever_stamped regression stays visible without a platform freeze");
}

// 25d. ever_stamped preservation across a TWO-BUILD sequence (non-auth rebuild retains true)
{
  const now = "2026-07-10T05:00:00.000Z";
  const tmp = mkTmp("two-build");
  const env = { GITHUB_EVENT_NAME: "push", GITHUB_WORKFLOW_REF: "o/r/.github/workflows/deploy-worker.yml@refs/heads/main", GITHUB_RUN_ID: "b", GITHUB_RUN_ATTEMPT: "1" };
  // build 1: all stamped -> ever_stamped true, written to the temp root.
  seedProductCoverage(tmp, { defaultStamp: "2026-07-09" });
  const b1 = runBuilder(tmp, env, now).root.source_sla.find((s) => s.source_id === "product_surface_coverage");
  assert.equal(b1.pending.ever_stamped, true, "build 1 (all stamped) sets ever_stamped true");
  // build 2: non-authoritative rebuild that REGRESSES to all-null; ever_stamped must persist.
  seedProductCoverage(tmp, { defaultStamp: null });
  const b2 = runBuilder(tmp, env, now).root.source_sla.find((s) => s.source_id === "product_surface_coverage");
  assert.equal(b2.status, "unavailable_pending_source_stamp", "build 2 regressed to pending");
  assert.equal(b2.pending.ever_stamped, true, "build 2 retains ever_stamped=true from the prior committed doc (never reset to false)");
  ok("ever_stamped preserved across a two-build non-authoritative rebuild (monotonic true)");
}

// 26. Coverage unavailability degrades its source lane; malformed structure remains hard elsewhere.
{
  const now = "2026-07-10T02:35:00.000Z";
  const tmp = mkTmp("coverage-noexempt");
  const rt = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "cv" });
  rt.cadence.v2_activated_at = now;
  seedReadyV2(tmp, { now, runtime: rt, sla: readySla(now, { coverageUnavailable: true }) });
  assert.equal(runChecker(tmp, now).exit, 0, "Phase A: coverage unavailable is warn-only");
  assert.equal(runChecker(tmp, now, { strict: true }).exit, 0, "strict: coverage unavailable stays lane-local");
  ok("FIX 4: fenok_edge_coverage_index plain unavailable degrades its lane without freezing publication");
}

// 27. real generator on temp root — source dates remain distinct from collection clocks.
{
  const runGen = (seed) => {
    const tmp = mkTmp("real-generator");
    const w = (rel, o) => writeJson(path.join(tmp, "data", ...rel), o);
    w(["computed", "rim-index", "inputs.json"], { indices: { KOSPI: { observed: { price: { as_of: seed.rim } } }, SOX: { observed: { price: { as_of: seed.rim } } } } });
    w(["yardney", "yardney_model.json"], { data: [{ date: seed.yard }] });
    w(["global-scouter", "core", "stocks_analyzer.json"], { source_date: seed.screener });
    w(["computed", "market_facts", "index.json"], {
      count: 3,
      core_surface_source_as_of: seed.marketFacts,
      full_universe_floor_as_of: seed.marketFactsFloor ?? seed.marketFacts,
      source_stamp_diagnostics: {
        core_member_count: 1,
        core_price_stamped_count: seed.marketFacts ? 1 : 0,
        core_price_missing_count: seed.marketFacts ? 0 : 1,
        core_price_missing_tickers: seed.marketFacts ? [] : ["MISSING"],
        core_price_source_complete: Boolean(seed.marketFacts),
      },
      rows: [],
    });
    const surfaceDay = String(seed.surfaces || "").slice(0, 10) || null;
    const universeDay = String(seed.etfUniverse || "").slice(0, 10) || null;
    const domainStamps = { market_events: surfaceDay, sectors: surfaceDay, etf_center: surfaceDay };
    w(["stockanalysis", "surface_consumers.json"], { surfaces: [
      { surface: "event_fixture", consumers: [{ route: "/market/events" }] },
      { surface: "sector_fixture", consumers: [{ route: "/sectors" }] },
      { surface: "etf_fixture", consumers: [{ route: "/etfs" }] },
    ] });
    for (const name of ["event_fixture", "sector_fixture", "etf_fixture"]) {
      w(["stockanalysis", "surfaces", `${name}.json`], { fetched_at: seed.surfaces });
    }
    w(["stockanalysis", "surfaces", "index.json"], { source_as_of: domainStamps, results: [
      { surface: "event_fixture", status: "ok", path: "surfaces/event_fixture.json" },
      { surface: "sector_fixture", status: "ok", path: "surfaces/sector_fixture.json" },
      { surface: "etf_fixture", status: "ok", path: "surfaces/etf_fixture.json" },
    ] });
    w(["stockanalysis", "etf_universe.json"], { source_as_of: universeDay, records: [] });
    w(["stockanalysis", "index.json"], { source_as_of: { surfaces: domainStamps, etf_universe: universeDay } });
    execFileSync("node", [path.join(__dirname, "generate-product-surface-coverage.mjs"), "--data-root", tmp], { env: { ...baseEnv() }, stdio: ["ignore", "pipe", "pipe"] });
    const out = JSON.parse(fs.readFileSync(path.join(tmp, "data", "admin", "product-surface-coverage.json"), "utf8"));
    const getSurfaceStamp = (id) => out.surfaces.find((s) => s.id === id)?.source_as_of;
    getSurfaceStamp.diagnostics = out.source_stamp_diagnostics;
    return getSurfaceStamp;
  };

  // Only surfaces with upstream source dates carry a stamp. Aggregate
  // StockAnalysis products stay honest nulls even when collection clocks exist.
  const ready = runGen({ rim: "2026-07-03", yard: "2026-07-03", screener: "2026-07-02", marketFacts: "2026-07-08", surfaces: "2026-07-09T02:23:02Z", etfUniverse: "2026-07-07T22:37:04Z" });
  assert.equal(ready("market_valuation"), "2026-07-03");
  assert.equal(ready("screener"), "2026-07-02");
  assert.equal(ready("stock_detail"), "2026-07-08", "stock_detail = market_facts selected-price source floor");
  assert.equal(ready("market_events"), null, "market_events provider publishes no aggregate source date");
  assert.equal(ready("etf_center"), null, "ETF aggregate provider publishes no source date");
  assert.equal(ready("sectors"), "2026-07-08", "sectors = market_facts selected-price source floor");
  assert.equal(ready.diagnostics.market_facts_full_universe_floor_as_of, "2026-07-08", "full-universe floor remains visible as a diagnostic");
  assert.equal(ready.diagnostics.full_universe_floor_sla_bound, false, "full-universe floor is never SLA-bound");

  // STALE real source dates still stamp — the KPI decides stale, not the generator.
  const stale = runGen({ rim: "2026-06-01", yard: "2026-06-01", screener: "2026-06-01", marketFacts: "2026-06-01", surfaces: "2026-06-01T00:00:00Z", etfUniverse: "2026-06-01T00:00:00Z" });
  for (const id of ["stock_detail", "sectors"]) assert.equal(stale(id), "2026-06-01", `${id} stamps an old source date (stale decided downstream)`);
  for (const id of ["market_events", "etf_center"]) assert.equal(stale(id), null, `${id} does not fabricate a source date from collection time`);

  // Collection clocks are never source evidence, whether future or impossible.
  const future = runGen({ rim: "2026-07-03", yard: "2026-07-03", screener: "2026-07-02", marketFacts: "2026-07-08", surfaces: "2026-07-20T00:00:00Z", etfUniverse: "2026-07-07T22:37:04Z" });
  assert.equal(future("market_events"), null, "future collection date is not promoted");
  const impossible = runGen({ rim: "2026-07-03", yard: "2026-07-03", screener: "2026-07-02", marketFacts: "2026-07-08", surfaces: "2026-02-31T00:00:00Z", etfUniverse: "2026-07-07T22:37:04Z" });
  assert.equal(impossible("market_events"), null, "impossible collection timestamp is not promoted");

  // NULL fail-closed: missing market_facts stamp -> stock_detail & sectors stay null
  const partial = runGen({ rim: "2026-07-03", yard: "2026-07-03", screener: "2026-07-02", marketFacts: undefined, surfaces: "2026-07-09T02:23:02Z", etfUniverse: "2026-07-07T22:37:04Z" });
  assert.equal(partial("stock_detail"), null, "no market_facts stamp -> stock_detail null (fail-closed)");
  assert.equal(partial("sectors"), null, "no market_facts stamp -> sectors null (OLDEST-required fail-closed)");
  assert.equal(partial("market_events"), null, "market_events remains an honest aggregate null");
  assert.equal(partial("etf_center"), null, "no market_facts stamp -> ETF center null");
  ok("#331: real generator uses upstream source dates and never promotes collection clocks");
}

// 28. rev5.5 STRICT-BYPASS PROBES
{
  const now = "2026-07-10T02:35:00.000Z";
  const psBuild = (seedOpts, { expectExit = 0 } = {}) => {
    const tmp = mkTmp("r55");
    seedProductCoverage(tmp, seedOpts);
    const r = runBuilder(tmp, { GITHUB_EVENT_NAME: "push", GITHUB_WORKFLOW_REF: "o/r/.github/workflows/deploy-worker.yml@refs/heads/main", GITHUB_RUN_ID: "r55", GITHUB_RUN_ATTEMPT: "1" }, now, { expectExit });
    return expectExit === 0 ? r.root.source_sla.find((s) => s.source_id === "product_surface_coverage") : r;
  };
  const checkRows = (rawRows) => {
    const tmp = mkTmp("r55c");
    const rt = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "r55c" });
    rt.cadence.v2_activated_at = now;
    seedReadyV2(tmp, { now, runtime: rt, sla: readySla(now, { productSurface: { rawRows } }) });
    return tmp;
  };
  const allPresent = (mut) => REQUIRED_SURFACE_IDS.map((id) => ({ id, source_as_of: mut(id) }));

  // (1) REAL-CALENDAR: impossible / junk dates classify as shape_error (hard)
  for (const bad of ["2026-00-00", "2026-02-31", "2026-07-09junk"]) {
    const entry = psBuild({ defaultStamp: "2026-07-09", stampById: { screener: bad } });
    assert.equal(entry.status, "error", `builder: bad calendar date ${bad} -> shape_error`);
    const tmp = checkRows(allPresent((id) => (id === "screener" ? bad : "2026-07-09")));
    assert.equal(runChecker(tmp, now).exit, 1, `checker Phase A: bad calendar date ${bad} -> hard`);
    assert.equal(runChecker(tmp, now, { strict: true }).exit, 1, `checker strict: bad calendar date ${bad} -> hard`);
  }
  ok("rev5.5(1) REAL-CALENDAR: 2026-00-00 / 2026-02-31 / trailing-junk dates hard-error in generator+classifier");

  // (2) SCHEMA MARKER + OWN-PROPERTY: markerless legacy all-absent = bootstrap; a
  // MARKED artifact demands every row carry source_as_of (all-typo / partial-absent = hard).
  const bootstrap = psBuild({ absentIds: [...REQUIRED_SURFACE_IDS], markerless: true });
  assert.equal(bootstrap.status, "unavailable_pending_source_stamp", "markerless all-absent -> bootstrap pending");
  assert.equal(bootstrap.pending.ever_stamped, false, "bootstrap ever_stamped false");
  // MARKED + all-rows-typo (source_As_of) -> every row lacks source_as_of -> HARD (kills the fake-bootstrap collapse)
  const allTypo = psBuild({ rawSurfaces: REQUIRED_SURFACE_IDS.map((id) => ({ id, as_of: "x", source_As_of: "2026-07-09" })) });
  assert.equal(allTypo.status, "error", "MARKED all-rows-typo -> hard (not fake bootstrap)");
  // MARKED + partial-absent -> hard
  const partialAbsent = psBuild({ defaultStamp: "2026-07-09", absentIds: ["market_events"] });
  assert.equal(partialAbsent.status, "error", "MARKED partial-absent -> hard");
  assert.ok(partialAbsent.shape_error, "partial-absent flags shape_error");
  // MARKERLESS but a row carries source_as_of -> structural corruption -> hard
  const markerlessPresent = psBuild({ defaultStamp: "2026-07-09", markerless: true });
  assert.equal(markerlessPresent.status, "error", "markerless artifact carrying source_as_of -> structural hard");
  ok("rev5.6(1) SCHEMA MARKER: markerless all-absent=bootstrap; MARKED all-typo/partial-absent=hard; markerless-with-value=hard");

  // (3) GENERIC FLAG BYPASS: pending_source_stamp on a non-product_surface row = hard
  {
    const tmp = mkTmp("r55-flag");
    const rt = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "flag" });
    rt.cadence.v2_activated_at = now;
    seedReadyV2(tmp, { now, runtime: rt, sla: readySla(now, { coverageFakePending: true }) });
    assert.equal(runChecker(tmp, now, { strict: true }).exit, 1, "coverage row w/ pending_source_stamp+status=ready -> strict hard (bypass killed)");
    assert.equal(runChecker(tmp, now).exit, 1, "pending_source_stamp on non-product_surface is hard even in Phase A");
    ok("rev5.5(3) generic pending_source_stamp bypass killed — flag on any non-product_surface row is a hard error");
  }

  // (4) PRIOR CORRUPTION FAIL-CLOSED: corrupt prior v2 -> BUILD hard-fails; missing/v1 -> bootstrap
  {
    const mkCorrupt = (badPending) => {
      const tmp = mkTmp("r55-prior");
      const prior = makeProducerRuntime({ builtAt: now, slotKey: null, runId: "p" });
      prior.cadence.v2_activated_at = now;
      prior.slots = { satisfied_slot_keys: [], last_satisfied_slot_key: null, missed_slot_keys: [], cron_deferrals: [] };
      seedPrior(tmp, v2Doc(prior, { source_sla: [{ source_id: "product_surface_coverage", status: "unavailable_pending_source_stamp", pending: badPending }] }));
      seedProductCoverage(tmp, { absentIds: [...REQUIRED_SURFACE_IDS], markerless: true });
      return tmp;
    };
    for (const badPending of [{ pending_since: 123, ever_stamped: false }, { pending_since: "2026-07-01T00:00:00Z", ever_stamped: "yes" }, { pending_since: "garbage", ever_stamped: false }]) {
      const tmp = mkCorrupt(badPending);
      let status = 0;
      try { execFileSync("node", [BUILDER, "--data-root", tmp], { env: { ...baseEnv(), KPI_FAKE_NOW: now, GITHUB_EVENT_NAME: "push", GITHUB_WORKFLOW_REF: "o/r/.github/workflows/deploy-worker.yml@refs/heads/main", GITHUB_RUN_ID: "pc", GITHUB_RUN_ATTEMPT: "1" }, stdio: ["ignore", "pipe", "pipe"] }); }
      catch (e) { status = e.status ?? 1; }
      assert.equal(status, 1, `corrupt prior v2 pending ${JSON.stringify(badPending)} -> build hard-fails`);
    }
    // missing prior + v1 prior still bootstrap (markerless legacy artifact)
    const missing = psBuild({ absentIds: [...REQUIRED_SURFACE_IDS], markerless: true });
    assert.equal(missing.pending.ever_stamped, false, "missing prior -> bootstrap");
    const tmpV1 = mkTmp("r55-v1");
    seedPrior(tmpV1, { schema_version: "fenok-data-health-kpi/v1", generated_at: "2026-07-09T00:00:00Z", status: "ready" });
    seedProductCoverage(tmpV1, { absentIds: [...REQUIRED_SURFACE_IDS], markerless: true });
    const v1boot = runBuilder(tmpV1, { GITHUB_EVENT_NAME: "push", GITHUB_WORKFLOW_REF: "o/r/.github/workflows/deploy-worker.yml@refs/heads/main", GITHUB_RUN_ID: "v1", GITHUB_RUN_ATTEMPT: "1" }, now).root.source_sla.find((s) => s.source_id === "product_surface_coverage");
    assert.equal(v1boot.status, "unavailable_pending_source_stamp", "v1 prior -> bootstrap pending");
    assert.equal(v1boot.pending.ever_stamped, false, "v1 prior bootstrap ever_stamped false");
    ok("rev5.6(4) prior corruption fail-closed: malformed prior-v2 pending hard-fails the BUILD; missing/v1 prior still bootstrap");
  }

  // (5) STATE-SPECIFIC MARKER SHAPE: numeric / future pending_since (no band) / future-on-stamped = hard
  {
    const mkMut = (mut) => {
      const tmp = mkTmp("r55-marker");
      const rt = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "mk" });
      rt.cadence.v2_activated_at = now;
      const sla = readySla(now);
      mut(sla.find((s) => s.source_id === "product_surface_coverage"));
      seedReadyV2(tmp, { now, runtime: rt, sla });
      return tmp;
    };
    // numeric pending_since (make it pending first, then numeric)
    const numeric = mkMut((e) => { e.status = "unavailable_pending_source_stamp"; e.pending_source_stamp = true; e.source_date = null; e.age = null; e.required_surface_rows = REQUIRED_SURFACE_IDS.map((id) => ({ id, source_as_of: null })); e.pending = { pending_since: 123, ever_stamped: false }; });
    assert.equal(runChecker(numeric, now).exit, 1, "numeric pending_since -> hard even Phase A");
    // +5m future pending_since must be HARD (no tolerance band, unlike producer age)
    const future5m = mkMut((e) => { e.status = "unavailable_pending_source_stamp"; e.pending_source_stamp = true; e.source_date = null; e.age = null; e.required_surface_rows = REQUIRED_SURFACE_IDS.map((id) => ({ id, source_as_of: null })); e.pending = { pending_since: new Date(new Date(now).getTime() + 5 * 60000).toISOString(), ever_stamped: false }; });
    assert.equal(runChecker(future5m, now).exit, 1, "+5m future pending_since -> hard (NO tolerance band)");
    // future pending_since on a STAMPED row (must be null on stamped)
    const stampedFuture = mkMut((e) => { /* e is stamped ready by default */ e.pending = { pending_since: "2026-07-20", ever_stamped: true }; });
    assert.equal(runChecker(stampedFuture, now).exit, 1, "non-null pending_since on stamped row -> hard");
    ok("rev5.5(5) marker shape: numeric pending_since hard; +5m future hard (no band); pending_since on stamped row hard");
  }
}

// 29. rev5.6 STATE-MACHINE PROBES (anomaly-preserve, prior edge-cases, validation order)
{
  const now = "2026-07-10T02:35:00.000Z";
  const env = { GITHUB_EVENT_NAME: "push", GITHUB_WORKFLOW_REF: "o/r/.github/workflows/deploy-worker.yml@refs/heads/main", GITHUB_RUN_ID: "sm", GITHUB_RUN_ATTEMPT: "1" };
  const day10 = "2026-06-30T00:00:00.000Z"; // ~10 days before now
  const priorPendingDoc = (pending) => {
    const prior = makeProducerRuntime({ builtAt: now, slotKey: null, runId: "prev" });
    prior.cadence.v2_activated_at = now;
    prior.slots = { satisfied_slot_keys: [], last_satisfied_slot_key: null, missed_slot_keys: [], cron_deferrals: [] };
    return v2Doc(prior, { source_sla: [{ source_id: "product_surface_coverage", status: "unavailable_pending_source_stamp", source_stamp_version: 1, required_surface_rows: REQUIRED_SURFACE_IDS.map((id) => ({ id, source_as_of: null })), pending }] });
  };
  const psOf = (root) => root.source_sla.find((s) => s.source_id === "product_surface_coverage");

  // (2) ANOMALY STATES PRESERVE MARKERS: pending(day10) -> future anomaly -> pending
  // must RESUME the day-10 clock (no reset-to-now laundering).
  {
    const tmp = mkTmp("anomaly-preserve");
    seedPrior(tmp, priorPendingDoc({ pending_since: day10, ever_stamped: false }));
    seedProductCoverage(tmp, { defaultStamp: "2026-07-09", stampById: { screener: "2026-07-20" } }); // future anomaly
    const b1 = psOf(runBuilder(tmp, env, now).root);
    assert.equal(b1.status, "future_date_anomaly", "transition into future anomaly");
    assert.equal(b1.pending.pending_since, day10, "anomaly PRESERVES pending_since (not null, not now)");
    seedProductCoverage(tmp, { defaultStamp: null }); // back to all-null pending
    const b2 = psOf(runBuilder(tmp, env, now).root);
    assert.equal(b2.status, "unavailable_pending_source_stamp", "future -> pending again");
    assert.equal(b2.pending.pending_since, day10, "pending RESUMES the day-10 clock (no restart at now)");
    ok("rev5.6(2) anomaly states preserve pending_since — future->pending resumes the original clock (no laundering)");
  }

  // (3a) unreadable prior JSON (file EXISTS but corrupt) = build hard-fail; missing = bootstrap
  {
    const tmp = mkTmp("corrupt-prior-json");
    fs.writeFileSync(path.join(tmp, "data", KPI_REL), "{ not valid json", "utf8");
    seedProductCoverage(tmp, { absentIds: [...REQUIRED_SURFACE_IDS], markerless: true });
    runBuilder(tmp, env, now, { expectExit: 1 });
    // (3c) stamp-era lineage present but pending marker DELETED = build hard-fail
    const tmp2 = mkTmp("deleted-marker");
    const prior = makeProducerRuntime({ builtAt: now, slotKey: null, runId: "prev" });
    prior.cadence.v2_activated_at = now;
    prior.slots = { satisfied_slot_keys: [], last_satisfied_slot_key: null, missed_slot_keys: [], cron_deferrals: [] };
    seedPrior(tmp2, v2Doc(prior, { source_sla: [{ source_id: "product_surface_coverage", status: "unavailable_pending_source_stamp", required_surface_rows: REQUIRED_SURFACE_IDS.map((id) => ({ id, source_as_of: null })) /* lineage but NO pending */ }] }));
    seedProductCoverage(tmp2, { absentIds: [...REQUIRED_SURFACE_IDS], markerless: true });
    runBuilder(tmp2, env, now, { expectExit: 1 });
    ok("rev5.6(3) prior edge-cases: unreadable-existing-JSON & stamp-era-lineage-with-deleted-pending both hard-fail the BUILD");
  }

  // (4) VALIDATION ORDER: object pending_since on a FUTURE row = hard (before the future early-exit)
  {
    const tmp = mkTmp("future-obj-since");
    const rt = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "vo" });
    rt.cadence.v2_activated_at = now;
    const futureEntry = productSurfaceEntry(now, { defaultStamp: "2026-07-09", stampById: { screener: "2026-07-20" } }); // future_date_anomaly
    futureEntry.pending = { pending_since: {}, ever_stamped: false }; // OBJECT pending_since on a future row
    const sla = readySla(now).map((e) => (e.source_id === "product_surface_coverage" ? futureEntry : e));
    seedReadyV2(tmp, { now, runtime: rt, sla });
    assert.equal(runChecker(tmp, now).exit, 1, "object pending_since on a future row -> hard even Phase A (validated before future early-exit)");
    ok("rev5.6(5) validation order: object pending_since on a future row is hard (not a warning past the future branch)");
  }
}

// 30. rev5.6 ADDENDUM — marker value EXACTLY 1 + checker-side lineage/deletion detection
{
  const now = "2026-07-10T02:35:00.000Z";
  const env = { GITHUB_EVENT_NAME: "push", GITHUB_WORKFLOW_REF: "o/r/.github/workflows/deploy-worker.yml@refs/heads/main", GITHUB_RUN_ID: "mv", GITHUB_RUN_ATTEMPT: "1" };
  const psOf = (root) => root.source_sla.find((s) => s.source_id === "product_surface_coverage");

  // (a) bad source_stamp_version values -> HARD in BOTH builder classifier and checker
  for (const badMarker of [2, "1", true, {}]) {
    const tmpB = mkTmp("marker-build");
    seedProductCoverage(tmpB, { defaultStamp: "2026-07-09", stampMarkerValue: badMarker });
    const bEntry = psOf(runBuilder(tmpB, env, now).root);
    assert.equal(bEntry.status, "error", `builder: source_stamp_version=${JSON.stringify(badMarker)} -> shape_error`);

    const tmpC = mkTmp("marker-check");
    const rt = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "mc" });
    rt.cadence.v2_activated_at = now;
    const entry = productSurfaceEntry(now, { defaultStamp: "2026-07-09", stampMarkerValue: badMarker });
    const sla = readySla(now).map((e) => (e.source_id === "product_surface_coverage" ? entry : e));
    seedReadyV2(tmpC, { now, runtime: rt, sla });
    assert.equal(runChecker(tmpC, now).exit, 1, `checker Phase A: source_stamp_version=${JSON.stringify(badMarker)} -> hard`);
    assert.equal(runChecker(tmpC, now, { strict: true }).exit, 1, `checker strict: source_stamp_version=${JSON.stringify(badMarker)} -> hard`);
  }
  ok("rev5.6-addendum(a): source_stamp_version must be EXACTLY the number 1 — 2/'1'/true/{} hard in builder+checker");

  // (b) checker-side: a doc with stamp-slice lineage (required_surface_rows) but the
  // pending marker DELETED must fail at the CHECKER independently (not just the builder).
  {
    const tmp = mkTmp("checker-deletion");
    const rt = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "cd" });
    rt.cadence.v2_activated_at = now;
    const entry = productSurfaceEntry(now, { defaultStamp: "2026-07-09" }); // stamped, has lineage + pending
    delete entry.pending; // hand-edited: lineage present, pending marker deleted
    const sla = readySla(now).map((e) => (e.source_id === "product_surface_coverage" ? entry : e));
    seedReadyV2(tmp, { now, runtime: rt, sla });
    assert.equal(runChecker(tmp, now).exit, 1, "checker: lineage present but pending marker deleted -> hard (independent of builder)");
    ok("rev5.6-addendum(b): checker independently rejects a lineage-present artifact whose pending marker was deleted");
  }

  // (c) checker-side: stamp-era DATA present (rows carry source_as_of) but the
  // source_stamp_version marker DELETED -> markerless+present = structural hard. This
  // is the hand-edit that tries to force the bootstrap path onto real stamp data.
  {
    const tmp = mkTmp("checker-marker-del");
    const rt = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "md" });
    rt.cadence.v2_activated_at = now;
    const entry = productSurfaceEntry(now, { defaultStamp: "2026-07-09" }); // marked + rows carry source_as_of
    delete entry.source_stamp_version; // marker deleted, but rows still carry source_as_of
    const sla = readySla(now).map((e) => (e.source_id === "product_surface_coverage" ? entry : e));
    seedReadyV2(tmp, { now, runtime: rt, sla });
    assert.equal(runChecker(tmp, now).exit, 1, "Phase A: source_stamp_version deleted while rows carry source_as_of -> hard");
    assert.equal(runChecker(tmp, now, { strict: true }).exit, 1, "strict: same -> hard");
    ok("rev5.6-addendum(c): checker rejects source_stamp_version deletion on rows carrying stamp data (markerless-with-value structural hard)");
  }
}

// 31. GRACE-AWARE MISSED SLOTS (hotfix for deploy run 29064993375) — a slot is missed
// ONLY when now > slot_time + slot_grace_minutes; within grace it is NOT yet missable.
{
  const slotKey = "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z"; // 02:30Z slot
  const watermark = "2026-07-10T00:00:00.000Z"; // before the slot
  const grace = CADENCE.slot_grace_minutes; // 360
  const enumAt = (nowIso) => enumerateDueSlots({ trackedCrons: TRACKED_CRONS, watermarkIso: watermark, nowIso, retentionDays: CADENCE.slot_retention_days, graceMinutes: grace });

  // (a) slot due but within grace (+7m), unsatisfied => NOT missed
  const inGrace = enumAt("2026-07-10T02:37:00.000Z");
  assert.ok(!inGrace.includes(slotKey), "slot +7m is within 360m grace -> NOT due/missable");
  assert.ok(!deriveMissedSlots({ dueSlots: inGrace, satisfiedSlotKeys: [], cronDeferrals: [] }).includes(slotKey),
    "in-grace unsatisfied slot is NOT missed");

  // (b) slot past grace (+361m), unsatisfied => missed
  const pastGrace = enumAt("2026-07-10T08:31:00.000Z"); // 02:30 + 361m
  assert.ok(pastGrace.includes(slotKey), "slot +361m is past 360m grace -> due");
  assert.ok(deriveMissedSlots({ dueSlots: pastGrace, satisfiedSlotKeys: [], cronDeferrals: [] }).includes(slotKey),
    "past-grace unsatisfied slot IS missed");
  ok("hotfix(a/b): in-grace unsatisfied slot NOT missed; past-grace unsatisfied slot IS missed");

  // (c) EXACT CI scenario: non-auth deploy rebuild refreshed generated_at to slot+6m with
  // preserved empty slots; checker at slot+7m must re-derive [] and stay GREEN.
  {
    const buildAt = "2026-07-10T02:36:00.000Z"; // generated_at (slot+6m)
    const checkAt = "2026-07-10T02:37:00.000Z"; // checker clock (slot+7m)
    const tmp = mkTmp("ci-grace");
    const rt = makeProducerRuntime({ builtAt: buildAt, slotKey: null, runId: "deploy" });
    rt.cadence.v2_activated_at = watermark; // watermark BEFORE the 02:30 slot
    rt.slots = { satisfied_slot_keys: [], last_satisfied_slot_key: null, missed_slot_keys: [], cron_deferrals: [] };
    seedReadyV2(tmp, { now: buildAt, runtime: rt, sla: readySla(buildAt) });
    assert.equal(runChecker(tmp, checkAt).exit, 0, "CI scenario: build slot+6m, preserved missed=[], check slot+7m -> GREEN");
    assert.equal(runChecker(tmp, checkAt, { strict: true }).exit, 0, "CI scenario stays green under strict too");
    ok("hotfix(c): exact CI repro (29064993375) — build slot+6m preserved empty slots, check slot+7m is GREEN");
  }
}

// 32. EXACT GRACE BOUNDARY (auditor-pinned) — a slot becomes missable ONLY when now is
// STRICTLY past occ + grace. At exactly occ+360m it is NOT missed; one millisecond later
// it is. Pins the live-measured boundary the hotfix relies on (enumerateDueSlots line:
// `occ + graceMs >= now` => the grace edge is inclusive).
{
  const slotKey = "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z"; // occ 02:30Z
  const watermark = "2026-07-10T00:00:00.000Z";
  const grace = CADENCE.slot_grace_minutes; // 360 -> occ+grace = 08:30:00.000Z
  const missedAt = (nowIso) => deriveMissedSlots({
    dueSlots: enumerateDueSlots({ trackedCrons: TRACKED_CRONS, watermarkIso: watermark, nowIso, retentionDays: CADENCE.slot_retention_days, graceMinutes: grace }),
    satisfiedSlotKeys: [], cronDeferrals: [],
  });
  assert.ok(!missedAt("2026-07-10T08:30:00.000Z").includes(slotKey), "exactly occ+360m (grace edge inclusive) -> NOT missed");
  assert.ok(missedAt("2026-07-10T08:30:00.001Z").includes(slotKey), "occ+360m +1ms (strictly past grace) -> missed");
  ok("exact grace boundary: +360m NOT missed, +360m+1ms missed (matches auditor's live measurement)");
}

// 33. BUILDER-INVOKED CI repro (auditor ride-along for hotfix(c)) — hotfix(c) hand-seeds
// the v2 artifact; here the REAL builder emits the build-side runtime, then the checker
// re-derives grace-aware at slot+7m and stays GREEN. Proves the emitted runtime (not a
// synthetic one) survives the exact failing scenario of deploy run 29064993375.
{
  const watermark = "2026-07-10T00:00:00.000Z"; // BEFORE the 02:30Z slot
  const buildAt = "2026-07-10T02:36:00.000Z";    // slot+6m: non-auth deploy rebuild
  const checkAt = "2026-07-10T02:37:00.000Z";    // slot+7m: checker clock
  const tmp = mkTmp("ci-grace-real");
  // Prior v2 doc: watermark before the slot, empty slots, a real preserved producer.
  const prior = makeProducerRuntime({ builtAt: "2026-07-10T02:00:00.000Z", slotKey: null, runId: "prior" });
  prior.cadence.v2_activated_at = watermark;
  prior.slots = { satisfied_slot_keys: [], last_satisfied_slot_key: null, missed_slot_keys: [], cron_deferrals: [] };
  seedPrior(tmp, v2Doc(prior));
  // INVOKE the builder as a non-authoritative deploy rebuild (push, no cron envelope).
  const built = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "push",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/deploy-worker.yml@refs/heads/main",
    GITHUB_RUN_ID: "deploy", GITHUB_RUN_ATTEMPT: "1", GITHUB_ACTOR: "someuser", GITHUB_REF: "refs/heads/main",
  }, buildAt).root;
  // Build-side: non-auth rebuild preserves the empty slots + the pre-slot watermark verbatim.
  assert.equal(built.runtime.authoritative_context.authoritative, false, "deploy rebuild is non-authoritative");
  assert.deepEqual(built.runtime.slots.missed_slot_keys, [], "builder preserved empty missed slots (did not fabricate the in-grace 02:30 slot)");
  assert.equal(built.runtime.cadence.v2_activated_at, watermark, "watermark preserved before the 02:30 slot (checker re-derives against it)");
  // Transplant the REAL builder runtime into a lane-ready doc so the checker's status/lane
  // gate is satisfied and only the grace-aware slot re-derivation is under test.
  seedReadyV2(tmp, { now: buildAt, runtime: built.runtime, sla: readySla(buildAt) });
  assert.equal(runChecker(tmp, checkAt).exit, 0, "checker re-derives the 02:30 slot as in-grace at slot+7m -> GREEN");
  assert.equal(runChecker(tmp, checkAt, { strict: true }).exit, 0, "stays green under strict too");
  ok("#331 ride-along: real builder output survives the 29064993375 scenario (build slot+6m -> check slot+7m GREEN)");
}

// 34. RECOVERY-AWARE SLOT VERDICT — retained evidence stays visible, but a later
// authoritative + ready + committed full snapshot changes BLOCKED -> DEGRADED.
{
  const miss = "update-manifest.yml:30 2 * * *@2026-07-12T02:30Z";
  const recovery = "update-manifest.yml:30 9 * * *@2026-07-12T09:30Z";
  const runtime = makeProducerRuntime({ builtAt: "2026-07-12T10:51:19.151Z", slotKey: recovery, runId: "recovery" });
  runtime.cadence.v2_activated_at = "2026-07-12T00:00:00.000Z";
  runtime.slots.missed_slot_keys = [miss];
  runtime.slots.satisfied_slot_keys = [recovery];
  runtime.successful_snapshot_history = [{
    built_at: "2026-07-12T10:51:19.151Z", slot_key: recovery, run_id: "recovery",
    run_attempt: 1, workflow: "Update Manifest", status: "ready", duration_ms: 30,
  }];
  const classification = classifyRuntimeSlots(runtime);
  assert.equal(classification.status, "degraded");
  assert.deepEqual(classification.recovered_missed_slot_keys, [miss]);
  assert.deepEqual(classification.unrecovered_missed_slot_keys, []);

  const pub = projectPublicKpi(v2Doc(runtime), "2026-07-12T13:00:00.000Z");
  assert.equal(pub.runtime.slot_status, "degraded");
  assert.equal(pub.runtime.fresh, true);
  assert.equal(pub.runtime.missed_slot_count, 1);
  assert.equal(pub.runtime.recovered_missed_slot_count, 1);
  assert.equal(pub.runtime.unrecovered_missed_slot_count, 0);
  assert.match(pub.runtime.status_message, /recovered/i);
  const degradedErrors = [];
  const degradedWarnings = [];
  checkV2Runtime(v2Doc(runtime), { errors: degradedErrors, warnings: degradedWarnings }, "2026-07-12T13:00:00.000Z");
  assert.deepEqual(degradedErrors, [], "recovered historical miss does not hard-fail the checker");
  assert.ok(degradedWarnings.some((message) => /recovered by later authoritative ready/.test(message)),
    "checker emits an honest degraded warning");
  ok("recovered full-snapshot miss remains recorded while public slot verdict is DEGRADED");

  runtime.successful_snapshot_history[0].status = "blocked";
  const blocked = projectPublicKpi(v2Doc(runtime), "2026-07-12T13:00:00.000Z");
  assert.equal(blocked.runtime.slot_status, "blocked", "non-ready execution cannot launder a missed slot");
  assert.equal(blocked.runtime.fresh, false);
  assert.equal(blocked.runtime.unrecovered_missed_slot_count, 1);
  const blockedErrors = [];
  checkV2Runtime(v2Doc(runtime), { errors: blockedErrors, warnings: [] }, "2026-07-12T13:00:00.000Z");
  assert.ok(blockedErrors.some((message) => /lack a later authoritative ready/.test(message)),
    "unrecovered miss hard-fails the checker");
  ok("satisfied key without a later ready snapshot remains BLOCKED");

  const incrementalMiss = "fenok-edge-daily.yml:30 0 * * 2-6@2026-07-10T00:30Z";
  const incrementalLater = "fenok-edge-daily.yml:30 0 * * 2-6@2026-07-11T00:30Z";
  const incrementalBuildAt = "2026-07-10T06:31:00.000Z";
  const incrementalRuntime = makeProducerRuntime({ builtAt: incrementalBuildAt, slotKey: null, runId: "incremental-miss" });
  incrementalRuntime.cadence.v2_activated_at = "2026-07-10T00:00:00.000Z";
  incrementalRuntime.slots.missed_slot_keys = [incrementalMiss];
  incrementalRuntime.slots.satisfied_slot_keys = [];
  incrementalRuntime.successful_snapshot_history = [];
  const incrementalUnrecovered = classifyRuntimeSlots(incrementalRuntime);
  assert.equal(incrementalUnrecovered.status, "degraded",
    "unrecovered incremental/owner-gated miss is lane-local degradation, not a platform block");
  assert.deepEqual(incrementalUnrecovered.blocking_unrecovered_missed_slot_keys, []);
  assert.deepEqual(incrementalUnrecovered.lane_local_unrecovered_missed_slot_keys, [incrementalMiss]);
  const incrementalPub = projectPublicKpi(v2Doc(incrementalRuntime), "2026-07-10T07:00:00.000Z");
  assert.equal(incrementalPub.runtime.slot_status, "degraded");
  assert.equal(incrementalPub.runtime.fresh, true);
  assert.equal(incrementalPub.runtime.blocking_unrecovered_missed_slot_count, 0);
  assert.equal(incrementalPub.runtime.lane_local_unrecovered_missed_slot_count, 1);
  assert.match(incrementalPub.runtime.status_message, /incremental\/owner-gated/i);
  const incrementalErrors = [];
  const incrementalWarnings = [];
  checkV2Runtime(v2Doc(incrementalRuntime), { errors: incrementalErrors, warnings: incrementalWarnings }, "2026-07-10T07:00:00.000Z");
  assert.deepEqual(incrementalErrors, [], "incremental miss does not hard-fail the checker");
  assert.ok(incrementalWarnings.some((message) => message.includes(incrementalMiss)
    && message.includes("deployment_blocking:false")), "checker names the lane-local miss and its non-blocking policy");

  incrementalRuntime.slots.satisfied_slot_keys = [incrementalLater];
  incrementalRuntime.successful_snapshot_history = [{
    built_at: "2026-07-11T01:00:00.000Z", slot_key: incrementalLater, run_id: "edge-later",
    run_attempt: 1, workflow: "Update Manifest", status: "ready", duration_ms: 30,
  }];
  const incrementalRecovered = classifyRuntimeSlots(incrementalRuntime);
  assert.equal(incrementalRecovered.status, "degraded", "the lane's next successful slot recovers its prior miss");
  assert.deepEqual(incrementalRecovered.recovered_missed_slot_keys, [incrementalMiss]);
  assert.deepEqual(incrementalRecovered.lane_local_unrecovered_missed_slot_keys, []);
  ok("incremental/owner-gated miss degrades locally and recovers on that lane's next successful slot");

  const fakeRecovery = "update-manifest.yml:99 99 * * *@2026-07-13T09:30Z";
  const fakeRecoveryRuntime = structuredClone(runtime);
  fakeRecoveryRuntime.slots.satisfied_slot_keys = [fakeRecovery];
  fakeRecoveryRuntime.successful_snapshot_history = [{
    built_at: "2026-07-13T10:00:00.000Z", slot_key: fakeRecovery, run_id: "fake-recovery",
    run_attempt: 1, workflow: "Update Manifest", status: "ready", duration_ms: 30,
  }];
  const fakeRecoveryClassification = classifyRuntimeSlots(fakeRecoveryRuntime);
  assert.equal(fakeRecoveryClassification.status, "blocked", "non-canonical recovery slot cannot clear a full-snapshot miss");
  assert.deepEqual(fakeRecoveryClassification.recovered_missed_slot_keys, []);
  ok("non-canonical satisfied/history key cannot forge full-snapshot recovery");

  let retainedRecoveryRuntime = makeProducerRuntime({ builtAt: "2026-07-12T10:51:19.151Z", slotKey: recovery, runId: "retained-recovery" });
  retainedRecoveryRuntime.cadence.v2_activated_at = "2026-07-12T00:00:00.000Z";
  retainedRecoveryRuntime.slots.missed_slot_keys = [miss];
  for (let day = 13; day <= 22; day += 1) {
    for (const [hour, cron] of [[2, "30 2 * * *"], [9, "30 9 * * *"]]) {
      const nowIso = `2026-07-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:31:00.000Z`;
      retainedRecoveryRuntime = buildRuntime({
        nowIso,
        env: {
          GITHUB_EVENT_NAME: "schedule",
          GITHUB_WORKFLOW_REF: "o/r/.github/workflows/update-manifest.yml@refs/heads/main",
          GITHUB_RUN_ID: `history-${day}-${hour}`,
          GITHUB_RUN_ATTEMPT: "1",
          GITHUB_WORKFLOW: "Update Manifest",
          GITHUB_SHA: "deadbeef",
          KPI_EVENT_SCHEDULE: cron,
          KPI_JOB_STARTED_AT: nowIso,
        },
        priorRuntime: retainedRecoveryRuntime,
        snapshotStatus: "ready",
      });
    }
  }
  assert.ok(retainedRecoveryRuntime.successful_snapshot_history.some((entry) => entry.run_id === "retained-recovery"),
    "recovery evidence remains for the same 14-day window as its missed slot");
  assert.ok(classifyRuntimeSlots(retainedRecoveryRuntime).recovered_missed_slot_keys.includes(miss),
    "history churn cannot re-block a recovered retained miss");
  ok("successful history uses the missed-slot retention window, not a 14-row cap");
}

// 35. CRON DEFERRAL GUARD — a valid predeclared exception is accepted; post-hoc
// declarations and incomplete shapes are structurally rejected by builder + checker.
{
  const slotKey = "update-manifest.yml:30 2 * * *@2026-07-12T02:30Z";
  const valid = {
    slot_key: slotKey,
    reason: "planned GitHub Actions maintenance",
    declared_by: "platform-owner",
    declared_at: "2026-07-12T01:00:00.000Z",
    expires_at: "2026-07-12T03:00:00.000Z",
  };
  assert.deepEqual(validateCronDeferrals([valid]), []);
  assert.ok(validateCronDeferrals([{ ...valid, declared_at: "2026-07-12T02:30:00.000Z" }]).length > 0,
    "declared_at equal to slot time is not BEFORE the slot");
  assert.ok(validateCronDeferrals([{ ...valid, declared_at: "2026-07-12T03:00:00.000Z" }]).length > 0,
    "post-hoc deferral is rejected");
  assert.ok(validateCronDeferrals([{ slot_key: slotKey }]).length > 0, "missing audit fields are rejected");

  const tmp = mkTmp("deferral-valid");
  const rt = makeProducerRuntime({ builtAt: "2026-07-12T09:35:00.000Z", slotKey: "update-manifest.yml:30 9 * * *@2026-07-12T09:30Z", runId: "valid-deferral" });
  rt.cadence.v2_activated_at = "2026-07-12T00:00:00.000Z";
  rt.slots.cron_deferrals = [valid];
  seedReadyV2(tmp, { now: "2026-07-12T09:35:00.000Z", runtime: rt, sla: readySla("2026-07-12T09:35:00.000Z") });
  assert.equal(runChecker(tmp, "2026-07-12T09:35:00.000Z", { strict: true }).exit, 0,
    "valid non-empty predeclared deferral passes checker");

  const bad = structuredClone(rt);
  bad.slots.cron_deferrals = [{ ...valid, declared_at: "2026-07-12T03:00:00.000Z" }];
  const tmpChecker = mkTmp("deferral-posthoc-checker");
  seedReadyV2(tmpChecker, { now: "2026-07-12T09:35:00.000Z", runtime: bad, sla: readySla("2026-07-12T09:35:00.000Z") });
  assert.equal(runChecker(tmpChecker, "2026-07-12T09:35:00.000Z", { strict: true }).exit, 1,
    "checker rejects post-hoc deferral");

  const tmpBuilder = mkTmp("deferral-posthoc-builder");
  seedPrior(tmpBuilder, v2Doc(bad));
  runBuilder(tmpBuilder, {
    GITHUB_EVENT_NAME: "push",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/deploy-worker.yml@refs/heads/main",
    GITHUB_RUN_ID: "posthoc", GITHUB_RUN_ATTEMPT: "1", GITHUB_ACTOR: "github-actions[bot]", GITHUB_REF: "refs/heads/main",
  }, "2026-07-12T09:36:00.000Z", { expectExit: 1 });
  ok("cron deferrals require complete pre-slot evidence; post-hoc builder/checker paths fail closed");
}

// 36. GENERAL LANE DECOUPLING — lane readiness is honest DEGRADED evidence;
// only canonical platform-integrity checks may hard-stop deployment.
{
  const now = "2026-07-12T13:00:00.000Z";
  const runtime = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 9 * * *@2026-07-12T09:30Z", runId: "lane-decouple" });
  runtime.cadence.v2_activated_at = now;
  const root = { ...readyCoreV2(now), runtime, source_sla: readySla(now) };
  const etfIndex = root.lanes.findIndex((item) => item.id === "etf_public_and_daily_gate");
  root.lanes[etfIndex] = {
    ...root.lanes[etfIndex],
    status: "degraded",
    status_label: "저하",
    status_message: "ETF public scoring and daily gate is not ready: PUBLIC+DAILY+GATED: PUBLIC. Other lanes may publish.",
    deployment_blocking: false,
    checks: [{
      id: "requirements_complete", label: "PUBLIC+DAILY+GATED", status: "blocked",
      status_label: "차단", detail: "PUBLIC", platform_blocking: false,
    }],
  };
  root.status = "degraded";
  root.status_label = "저하";
  root.status_message = "1 required lane(s) are not ready; healthy lanes may still publish.";
  root.totals = { lanes: REQUIRED_LANE_IDS.length, ready: REQUIRED_LANE_IDS.length - 1, degraded: 1, warning: 0, blocked: 0, unavailable: 0, required_not_ready: 1, platform_blocking_not_ready: 0 };
  const tmp = mkTmp("lane-degraded");
  writeReadyTargetRecoveryIndexes(tmp, now);
  writeJson(path.join(tmp, "data", KPI_REL), root);
  writeJson(path.join(tmp, "public", "data", KPI_REL), projectPublicKpi(root, now));
  assert.equal(runChecker(tmp, now, { strict: true }).exit, 0,
    "strict checker accepts an honest degraded lane when deployment integrity is ready");
  ok("lane readiness degradation remains visible while platform integrity stays deployable");

  const blockedRoot = structuredClone(root);
  const automationIndex = blockedRoot.lanes.findIndex((item) => item.id === "automation_contract");
  const integrityCheck = {
    id: "sync_static_builds_kpi", label: "sync-static KPI build", status: "blocked",
    status_label: "차단", detail: "package script wiring", platform_blocking: true,
  };
  blockedRoot.lanes[automationIndex] = {
    ...blockedRoot.lanes[automationIndex], status: "blocked", status_label: "차단",
    status_message: "Platform integrity blocked by sync-static KPI build: package script wiring.",
    deployment_blocking: true, checks: [integrityCheck],
  };
  blockedRoot.status = "blocked";
  blockedRoot.status_label = "차단";
  blockedRoot.totals = { lanes: REQUIRED_LANE_IDS.length, ready: REQUIRED_LANE_IDS.length - 2, degraded: 1, warning: 0, blocked: 1, unavailable: 0, required_not_ready: 2, platform_blocking_not_ready: 1 };
  blockedRoot.deployment_integrity = {
    status: "blocked", status_label: "차단",
    status_message: "1 platform integrity blocker(s) must halt publication.", blocker_count: 1,
    blockers: [{ lane_id: "automation_contract", check_id: integrityCheck.id, label: integrityCheck.label, detail: integrityCheck.detail }],
  };
  const blockedTmp = mkTmp("platform-blocked");
  writeReadyTargetRecoveryIndexes(blockedTmp, now);
  writeJson(path.join(blockedTmp, "data", KPI_REL), blockedRoot);
  writeJson(path.join(blockedTmp, "public", "data", KPI_REL), projectPublicKpi(blockedRoot, now));
  assert.equal(runChecker(blockedTmp, now, { strict: true }).exit, 1,
    "canonical platform integrity failure still hard-stops strict verification");
  ok("global integrity failure remains BLOCKED and cannot be downgraded to a lane warning");
}

console.log(`\n# ${passed} fixtures passed`);
