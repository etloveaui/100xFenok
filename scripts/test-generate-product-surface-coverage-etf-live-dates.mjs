#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRATCH_ROOT = path.join(ROOT, "_tmp");
fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
const fixtureRoot = fs.mkdtempSync(path.join(SCRATCH_ROOT, "product-surface-etf-live-"));
const GENERATED_AT = "2026-07-26T12:00:00Z";

function writeJson(relPath, value) {
  const filePath = path.join(fixtureRoot, "data", relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

try {
  writeJson("computed/market_facts/index.json", {
    core_surface_source_as_of: "2026-07-24",
    source_stamp_diagnostics: {
      core_member_count: 1,
      core_price_stamped_count: 1,
      core_price_missing_count: 0,
      core_price_missing_tickers: [],
      core_price_absent_from_index_count: 0,
      core_price_absent_from_index_tickers: [],
      core_price_source_complete: true,
    },
  });
  writeJson("yardney/yardney_model.json", {
    data: [{ date: "2026-07-25", fair_value: 6200 }],
  });
  writeJson("computed/rim-index/inputs.json", {
    indices: {
      KOSPI: {
        public_status: "ready_inputs_and_forecast_grid",
        blockers: [],
        observed: { price: { as_of: "2020-01-02" } },
      },
      SOX: {
        public_status: "ready_inputs_and_forecast_grid",
        blockers: [],
        observed: { price: { as_of: "2020-01-03" } },
      },
    },
  });
  writeJson("computed/data-supply/etf-detail/index.json", {
    schema_version: "data-supply-etf-detail-public-index/v1",
    entries: {
      AAOX: { ticker: "AAOX", source_as_of: null },
      AAAU: { ticker: "AAAU", source_as_of: "2026-06-29" },
      FROZ: { ticker: "FROZ", source_as_of: "2026-06-25" },
      DATELESS: { ticker: "DATELESS", source_as_of: "2026-04-01" },
      RESIDUAL: { ticker: "RESIDUAL", source_as_of: null },
    },
  });
  writeJson("stockanalysis/etfs/AAOX.json", {
    ticker: "AAOX",
    source_as_of: "2026-07-25T00:00:00Z",
    partial_reason_codes: ["quote_deferred_initial_reconcile", "history_deferred_initial_reconcile"],
  });
  writeJson("stockanalysis/etfs/AAAU.json", {
    ticker: "AAAU",
    source_as_of: "2026-07-18T00:00:00Z",
    partial_reason_codes: ["quote_deferred_initial_reconcile"],
  });
  writeJson("stockanalysis/etfs/DATELESS.json", { ticker: "DATELESS", source_as_of: null });
  writeJson("stockanalysis/etfs/RESIDUAL.json", {
    ticker: "RESIDUAL",
    source_as_of: null,
    partial_reason_codes: ["history_deferred_initial_reconcile"],
  });

  execFileSync(
    "node",
    [path.join(ROOT, "scripts", "generate-product-surface-coverage.mjs"), "--data-root", fixtureRoot],
    {
      env: { ...process.env, PS_GENERATED_AT: GENERATED_AT },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const output = JSON.parse(fs.readFileSync(
    path.join(fixtureRoot, "data", "admin", "product-surface-coverage.json"),
    "utf8",
  ));
  const etfCenter = output.surfaces.find((surface) => surface.id === "etf_center");
  const marketValuation = output.surfaces.find((surface) => surface.id === "market_valuation");
  const members = Object.fromEntries(
    etfCenter.stamp_evidence.members
      .filter((member) => member.id.startsWith("etf_detail:"))
      .map((member) => [member.id.slice("etf_detail:".length), member.source_as_of]),
  );

  assert.deepEqual(members, {
    AAOX: "2026-07-25",
    AAAU: "2026-07-18",
    FROZ: "2026-06-25",
    DATELESS: "2026-04-01",
    RESIDUAL: null,
  }, "ETF center must prefer live payload dates, then fall back to frozen enrollment-index dates");
  assert.equal(
    marketValuation.source_as_of,
    "2026-07-24",
    "quarantined RIM must not lower the required market-valuation freshness floor",
  );
  assert.deepEqual(
    marketValuation.stamp_evidence.members
      .filter((member) => member.stamp_class === "date_bearing")
      .map((member) => member.id),
    ["yardeni:published", "market_facts:core_surface"],
    "required market-valuation freshness must use only active Yardeni and market-facts sources",
  );
  assert.equal(
    marketValuation.checks.some((check) => check.label === "RIM 입력 기준일"),
    false,
    "quarantined RIM freshness must not remain a required surface check",
  );
  assert.equal(
    marketValuation.checks.some((check) => check.label === "KOSPI RIM 입력"),
    true,
    "RIM product readiness disclosure remains visible",
  );
  assert.equal(
    output.source_files.includes("computed/rim-index/inputs.json"),
    true,
    "RIM data provenance disclosure remains visible",
  );
  assert.equal(etfCenter.source_as_of, "2026-04-01", "surface source_as_of must equal the recovered true-date subset floor");
  assert.equal(
    etfCenter.source_as_of,
    etfCenter.stamp_evidence.date_bearing.source_floor_as_of,
    "published ETF source_as_of must remain the v2 all-member source floor",
  );
  assert.equal(etfCenter.source_as_of_reason, null);
  assert.equal(etfCenter.stamp_evidence.state, "pending_true_date", "a genuine residual date-bearing null must keep the surface pending");
  assert.deepEqual(output.source_stamp_diagnostics.etf_detail_date_resolution, {
    enrollment_count: 5,
    live_date_count: 2,
    fallback_date_count: 2,
    recovered_from_live_count: 1,
    missing_date_count: 1,
    age_histogram: {
      days_0_7: 1,
      days_8_30: 1,
      days_31_90: 1,
      over_90_days: 1,
    },
    median_age_days: 19.5,
    oldest_member: {
      ticker: "DATELESS",
      source_as_of: "2026-04-01",
    },
    deferred_reconciliation_member_count: 3,
  });

  for (const [ticker, sourceAsOf] of Object.entries({
    AAOX: "2026-07-25T00:00:00Z",
    AAAU: "2026-07-24T00:00:00Z",
    FROZ: "2026-07-23T00:00:00Z",
    DATELESS: "2026-07-22T00:00:00Z",
    RESIDUAL: "2026-07-21T00:00:00Z",
  })) {
    writeJson(`stockanalysis/etfs/${ticker}.json`, {
      ticker,
      source_as_of: sourceAsOf,
      partial_reason_codes: [],
    });
  }
  execFileSync(
    "node",
    [path.join(ROOT, "scripts", "generate-product-surface-coverage.mjs"), "--data-root", fixtureRoot],
    {
      env: { ...process.env, PS_GENERATED_AT: GENERATED_AT },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const freshOutput = JSON.parse(fs.readFileSync(
    path.join(fixtureRoot, "data", "admin", "product-surface-coverage.json"),
    "utf8",
  ));
  const freshEtfCenter = freshOutput.surfaces.find((surface) => surface.id === "etf_center");
  const freshnessRow = freshEtfCenter.checks.find((check) => check.label === "ETF 상세 전체 구성원 원천 기준일");
  assert.equal(freshEtfCenter.source_as_of, "2026-07-21");
  assert.equal(freshEtfCenter.source_as_of, freshEtfCenter.stamp_evidence.date_bearing.source_floor_as_of);
  assert.equal(freshEtfCenter.stamp_evidence.state, "stamped");
  assert.equal(freshnessRow?.status, "ready", "an all-fresh member fixture must make the all-member freshness row ready");
  assert.deepEqual(freshOutput.source_stamp_diagnostics.etf_detail_date_resolution.age_histogram, {
    days_0_7: 5,
    days_8_30: 0,
    days_31_90: 0,
    over_90_days: 0,
  });
  assert.equal(freshOutput.source_stamp_diagnostics.etf_detail_date_resolution.deferred_reconciliation_member_count, 0);
  console.log("test-generate-product-surface-coverage-etf-live-dates: ok");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
