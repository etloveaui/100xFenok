#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildRimIndexInputs,
  parseArgs,
  validateRimIndexInputs,
  buildPublicRimMirror,
  canonicalUtcInstant,
  parseUtcInstant,
  krxInputFreshness,
  soxInputFreshness,
  normalizeDividendYieldFraction,
  computeRimScenarioValues,
} from "./build-rim-index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function writeJson(absPath, payload) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

const KOSPI_DART_POINTER_REL = "computed/fenok-rim/kospi-dart-payout/current.json";
const KOSPI_DART_ARTIFACT_REL = "computed/fenok-rim/kospi-dart-payout/fy2025.json";

function makeKospiDartArtifact(overrides = {}) {
  return {
    schema_version: "kospi_dart_payout.v1",
    ok: true,
    fy: 2025,
    asOf: "2026-08-07",
    status: "ready",
    coverage: {
      covered_weight: 0.9,
      gate: 0.75,
      pass: true,
      valid_issuers: 3,
      universe_issuers: 4,
    },
    diagnostics: { parse_failure_count: 0, parse_failure_by_code: {} },
    index_dividend_yield: 0.02,
    payout_ratio: 0.1,
    earnings_yield: 0.2,
    first_knowable_at: "2026-08-06T00:00:00Z",
    per_issuer_rows: 3,
    metadata: {
      tier: "trailing_realised_fy_index_level",
      per_issuer_redistribution: "never included in the public artifact; retained only in the private raw cache",
    },
    provenance: {
      bridge: {
        source: "data/admin/fenok-edge-korea-krx-daily-index.json",
        source_field: "OutBlock_1[MKT_NM=KOSPI].MKTCAP / sum(OutBlock_1[MKT_NM=KOSPI].MKTCAP)",
        as_of: "2026-08-07",
        row_count: 4,
      },
      benchmark: {
        source: "data/benchmarks/emerging.json",
        as_of: "2026-08-02",
      },
    },
    ...overrides,
  };
}

function installKospiDartFixture(
  tempRoot,
  {
    artifact = makeKospiDartArtifact(),
    pointer = null,
    includePointer = true,
    rawArtifact = null,
    rawPointer = null,
  } = {},
) {
  const dartRoot = path.join(tempRoot, "computed/fenok-rim/kospi-dart-payout");
  fs.rmSync(path.join(tempRoot, "computed/fenok-rim"), { recursive: true, force: true });
  fs.mkdirSync(dartRoot, { recursive: true });
  const artifactPath = path.join(tempRoot, KOSPI_DART_ARTIFACT_REL);
  if (rawArtifact !== null) {
    fs.writeFileSync(artifactPath, rawArtifact, "utf8");
  } else {
    writeJson(artifactPath, artifact);
  }
  if (!includePointer) return;
  const artifactBytes = fs.readFileSync(artifactPath);
  let parsedArtifact = artifact;
  if (rawArtifact !== null) {
    try {
      parsedArtifact = JSON.parse(artifactBytes.toString("utf8"));
    } catch {
      parsedArtifact = artifact;
    }
  }
  const current = {
    schema_version: "kospi_dart_payout_pointer.v1",
    selected_artifact: "data/computed/fenok-rim/kospi-dart-payout/fy2025.json",
    fy: parsedArtifact.fy,
    sha256: crypto.createHash("sha256").update(artifactBytes).digest("hex"),
    as_of: parsedArtifact.asOf,
    first_knowable_at: parsedArtifact.first_knowable_at,
    coverage: {
      covered_weight: parsedArtifact.coverage.covered_weight,
      gate: parsedArtifact.coverage.gate,
      pass: parsedArtifact.coverage.pass,
    },
    ...pointer,
  };
  if (rawPointer !== null) fs.writeFileSync(path.join(tempRoot, KOSPI_DART_POINTER_REL), rawPointer, "utf8");
  else writeJson(path.join(tempRoot, KOSPI_DART_POINTER_REL), current);
}

const DEFAULT_EXACT_SPOT_ROWS = Object.freeze({
  sp500: [{ date: "2026-08-07", value: 7777.7 }],
  nasdaq: [{ date: "2026-08-07", value: 26666.6 }],
  nasdaq100: [{ date: "2026-08-07", value: 29999.9 }],
  sox: [{ date: "2026-08-07", value: 12000.1 }],
});

function makeExactSpotFixture({ includeAdmin = true, spotRows = {}, mutateKospi = null } = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rim-index-exact-spot-"));
  for (const dir of ["benchmarks", "damodaran", "macro", "slickcharts", "stockanalysis", "yf"]) {
    fs.symlinkSync(path.join(dataRoot, dir), path.join(tempRoot, dir), "dir");
  }
  if (includeAdmin) fs.symlinkSync(path.join(dataRoot, "admin"), path.join(tempRoot, "admin"), "dir");

  fs.mkdirSync(path.join(tempRoot, "indices"), { recursive: true });
  for (const file of ["nasdaq-giw-sox-constituents.json"]) {
    fs.symlinkSync(path.join(dataRoot, "indices", file), path.join(tempRoot, "indices", file), "file");
  }
  const mergedSpotRows = { ...DEFAULT_EXACT_SPOT_ROWS, ...spotRows };
  for (const [key, rows] of Object.entries(mergedSpotRows)) {
    writeJson(path.join(tempRoot, "indices", `${key}.json`), rows);
  }

  fs.mkdirSync(path.join(tempRoot, "computed"), { recursive: true });
  const computedSource = path.join(dataRoot, "computed");
  for (const entry of fs.readdirSync(computedSource, { withFileTypes: true })) {
    if (entry.name === "fenok-edge-korea-krx-index-daily.json" || entry.name === "fenok-rim") continue;
    fs.symlinkSync(
      path.join(computedSource, entry.name),
      path.join(tempRoot, "computed", entry.name),
      entry.isDirectory() ? "dir" : "file",
    );
  }
  let kospiPayload = readJson(path.join(computedSource, "fenok-edge-korea-krx-index-daily.json"));
  if (typeof mutateKospi === "function") kospiPayload = mutateKospi(kospiPayload);
  writeJson(path.join(tempRoot, "computed", "fenok-edge-korea-krx-index-daily.json"), kospiPayload);
  // Fixed-clock clamp: keep fixture input clocks at-or-before the fixed now
  // (2026-08-10). Truncation only, never a date rewrite. Weekly benchmark rows
  // clamp to the last Friday before the fixed now for us/micro (2026-07-31,
  // exactly the 10-day SLA boundary, and distinct from the 2026-08-07 spots)
  // and to 2026-08-07 for emerging. The single-date official KOSPI file cannot
  // be clamped and stays live.
  const benchmarkCutoffs = { "us.json": "2026-08-06", "micro_sectors.json": "2026-08-06", "emerging.json": "2026-08-10" };
  const liveBenchmarkRoot = path.join(dataRoot, "benchmarks");
  fs.rmSync(path.join(tempRoot, "benchmarks"), { recursive: true, force: true });
  fs.mkdirSync(path.join(tempRoot, "benchmarks"), { recursive: true });
  for (const entry of fs.readdirSync(liveBenchmarkRoot, { withFileTypes: true })) {
    const liveFile = path.join(liveBenchmarkRoot, entry.name);
    const tempFile = path.join(tempRoot, "benchmarks", entry.name);
    const cutoff = entry.isFile() ? benchmarkCutoffs[entry.name] : null;
    if (!cutoff) {
      fs.symlinkSync(liveFile, tempFile, entry.isDirectory() ? "dir" : "file");
      continue;
    }
    const benchmarkPayload = readJson(liveFile);
    for (const section of Object.values(benchmarkPayload.sections ?? {})) {
      if (Array.isArray(section?.data)) section.data = section.data.filter((row) => typeof row?.date === "string" && row.date <= cutoff);
    }
    writeJson(tempFile, benchmarkPayload);
  }
  const clampedMacroPayload = readJson(path.join(dataRoot, "macro/fred-banking-daily.json"));
  for (const rows of Object.values(clampedMacroPayload.series ?? {})) {
    if (Array.isArray(rows)) {
      const kept = rows.filter((row) => typeof row?.date === "string" && row.date <= "2026-08-10");
      rows.length = 0;
      rows.push(...kept);
    }
  }
  fs.rmSync(path.join(tempRoot, "macro"), { recursive: true, force: true });
  fs.mkdirSync(path.join(tempRoot, "macro"), { recursive: true });
  writeJson(path.join(tempRoot, "macro/fred-banking-daily.json"), clampedMacroPayload);
  return tempRoot;
}

function makeKr10yFixture() {
  const tempRoot = makeExactSpotFixture({ includeAdmin: false });
  const macroPayload = readJson(path.join(dataRoot, "macro/fred-banking-daily.json"));
  macroPayload.series.IRLTLT01KRM156N = [
    { date: "2026-05-01", value: 3.25 },
    { date: "2026-06-01", value: 3.33 },
  ];
  fs.rmSync(path.join(tempRoot, "macro"), { recursive: true, force: true });
  fs.mkdirSync(path.join(tempRoot, "macro"), { recursive: true });
  writeJson(path.join(tempRoot, "macro/fred-banking-daily.json"), macroPayload);
  return tempRoot;
}

function makeCcmpFixture({ spotRows = {}, mutateBenchmark = null, mutateMacro = null } = {}) {
  const tempRoot = makeExactSpotFixture({ includeAdmin: false, spotRows });
  if (typeof mutateBenchmark === "function") {
    const benchmarkRoot = path.join(tempRoot, "benchmarks");
    fs.rmSync(benchmarkRoot, { recursive: true, force: true });
    fs.mkdirSync(benchmarkRoot, { recursive: true });
    fs.symlinkSync(path.join(dataRoot, "benchmarks", "emerging.json"), path.join(benchmarkRoot, "emerging.json"), "file");
    fs.symlinkSync(path.join(dataRoot, "benchmarks", "micro_sectors.json"), path.join(benchmarkRoot, "micro_sectors.json"), "file");
    const benchmarkPayload = readJson(path.join(dataRoot, "benchmarks/us.json"));
    mutateBenchmark(benchmarkPayload);
    writeJson(path.join(benchmarkRoot, "us.json"), benchmarkPayload);
  }
  if (typeof mutateMacro === "function") {
    const macroRoot = path.join(tempRoot, "macro");
    fs.rmSync(macroRoot, { recursive: true, force: true });
    fs.mkdirSync(macroRoot, { recursive: true });
    const macroPayload = readJson(path.join(dataRoot, "macro/fred-banking-daily.json"));
    mutateMacro(macroPayload);
    writeJson(path.join(macroRoot, "fred-banking-daily.json"), macroPayload);
  }
  return tempRoot;
}

function makeKrxBridgeFixture(asOf) {
  assert.match(asOf, /^\d{4}-\d{2}-\d{2}$/, "KRX bridge fixture source date");
  const tempRoot = makeExactSpotFixture({ includeAdmin: false });
  const stockActionPayload = readJson(path.join(dataRoot, "computed/stock_action_index.json"));
  const rows = (stockActionPayload.rows ?? [])
    .filter((row) =>
      row?.marketScope === "korea"
      && String(row?.symbol ?? "").endsWith(".KS")
      && /^\d{6}$/.test(String(row?.ticker_normalized ?? ""))
      && typeof row?.estimateSnapshot?.forwardEps?.fy1 === "number"
      && typeof row?.estimateSnapshot?.forwardEps?.fy2 === "number"
      && typeof row?.estimateSnapshot?.forwardEps?.fy3 === "number"
      && typeof row?.profitabilitySnapshot?.roe?.fy1 === "number"
      && typeof row?.profitabilitySnapshot?.roe?.fy2 === "number"
      && typeof row?.profitabilitySnapshot?.roe?.fy3 === "number"
      && typeof row?.marketCap === "number"
      && row.marketCap > 0)
    .slice(0, 24);
  assert.ok(rows.length >= 12, "Korea stock_action fixture rows");
  const totalMarketCap = rows.reduce((sum, row) => sum + row.marketCap, 0);
  const bridgeSource = "admin/fenok-edge-korea-krx-daily-index.json";
  writeJson(path.join(tempRoot, bridgeSource), {
    schema_version: "fenok-edge-korea-krx-bridge/v1",
    generated_at: `${asOf}T15:00:00.000Z`,
    market: "Korea",
    source: "KRX_OPEN_API",
    raw_public: false,
    license_or_terms_note: "fixture raw stays private",
    bridge_scope: "stats_and_public_safe_rim_inputs_private_path_refs_no_raw_rows",
    as_of: asOf,
    private_artifacts: {
      raw_root: "_private/admin/fenok-edge-korea/daily/fixture/raw",
    },
    derived_rim_inputs: {
      schema_version: "krx_derived_rim_inputs.v1",
      generated_at: `${asOf}T15:00:00.000Z`,
      as_of: asOf,
      raw_public: false,
      license_or_terms_note: "fixture raw stays private",
      status: "ready",
      missing: [],
      kospi_weights: {
        source: `${bridgeSource}#derived_rim_inputs.kospi_weights`,
        source_field: "derived_rim_inputs.kospi_weights.rows[].weight",
        as_of: asOf,
        raw_public: false,
        license_or_terms_note: "fixture raw stays private",
        row_count: rows.length,
        total_market_cap: totalMarketCap,
        denominator: {
          method: "issuer_level_market_cap_sum",
          label: "KRX KOSPI stock-daily issuer MKTCAP sum; matches KOSPI including foreign shares aggregate in kospi_dd_trd",
          unit: "KRW",
          value: totalMarketCap,
        },
        rows: rows.map((row) => {
          const weight = row.marketCap / totalMarketCap;
          return {
            code: row.ticker_normalized,
            name: row.company,
            weight,
            weight_pct: weight * 100,
          };
        }),
      },
      korea_10y: {
        value: 0.04241,
        date: asOf,
        raw_value_percent: 4.241,
        source: `${bridgeSource}#derived_rim_inputs.korea_10y`,
        source_field: "derived_rim_inputs.korea_10y.value",
        label: "KRX KTS 10Y benchmark government bond yield",
        raw_public: false,
        license_or_terms_note: "fixture raw stays private",
      },
    },
  });
  return tempRoot;
}

function makeBenchmarkAvailabilityFixture({ missing = false, stale = false } = {}) {
  const tempRoot = makeExactSpotFixture({ includeAdmin: false });
  const benchmarkRoot = path.join(tempRoot, "benchmarks");
  fs.rmSync(benchmarkRoot, { recursive: true, force: true });
  if (!missing) {
    fs.mkdirSync(benchmarkRoot, { recursive: true });
    for (const file of ["us.json", "emerging.json", "micro_sectors.json"]) {
      const payload = readJson(path.join(dataRoot, "benchmarks", file));
      if (stale) {
        for (const section of Object.values(payload.sections ?? {})) {
          for (const row of Array.isArray(section?.data) ? section.data : []) row.date = "2026-05-01";
        }
      }
      writeJson(path.join(benchmarkRoot, file), payload);
    }
  }
  return tempRoot;
}

const ciSundayKrxFreshness = krxInputFreshness(
  "2026-07-09",
  "2026-07-12T01:41:29.000Z",
);
assert.equal(ciSundayKrxFreshness.calendar_age_days, 3);
assert.equal(ciSundayKrxFreshness.business_age_days, 1);
assert.equal(ciSundayKrxFreshness.freshness_unit, "business_days");
assert.equal(ciSundayKrxFreshness.freshness_calendar, "krx_market");
assert.equal(ciSundayKrxFreshness.status, "fresh_enough_for_input_slice");

const staleTuesdayKrxFreshness = krxInputFreshness(
  "2026-07-09",
  "2026-07-14T00:00:00.000Z",
);
assert.equal(staleTuesdayKrxFreshness.calendar_age_days, 5);
assert.equal(staleTuesdayKrxFreshness.business_age_days, 3);
assert.equal(staleTuesdayKrxFreshness.status, "refresh_recommended");

const mondayBoundaryKrxFreshness = krxInputFreshness(
  "2026-07-09",
  "2026-07-13T02:30:00.000Z",
);
assert.equal(mondayBoundaryKrxFreshness.calendar_age_days, 4);
assert.equal(mondayBoundaryKrxFreshness.business_age_days, 2);
assert.equal(mondayBoundaryKrxFreshness.status, "fresh_enough_for_input_slice");

const krxHolidayFreshness = krxInputFreshness(
  "2026-08-14",
  "2026-08-18T00:00:00.000Z",
);
assert.equal(krxHolidayFreshness.calendar_age_days, 4);
assert.equal(krxHolidayFreshness.business_age_days, 1);
assert.equal(krxHolidayFreshness.status, "fresh_enough_for_input_slice");

const holidayWeekendSoxFreshness = soxInputFreshness(
  "2026-07-02",
  "2026-07-12T00:00:00.000Z",
);
assert.equal(holidayWeekendSoxFreshness.calendar_age_days, 10);
assert.equal(holidayWeekendSoxFreshness.business_age_days, 5);
assert.equal(holidayWeekendSoxFreshness.freshness_calendar, "us_market");
assert.equal(holidayWeekendSoxFreshness.status, "fresh_enough_for_input_slice");

const futureKrxFreshness = krxInputFreshness(
  "2026-07-13",
  "2026-07-12T00:00:00.000Z",
);
assert.equal(futureKrxFreshness.business_age_days, 0);
assert.equal(futureKrxFreshness.future_date_anomaly, true);
assert.equal(futureKrxFreshness.status, "refresh_recommended");

const invalidKrxFreshness = krxInputFreshness(
  "2026-02-31",
  "2026-07-12T00:00:00.000Z",
);
assert.equal(invalidKrxFreshness.business_age_days, null);
assert.equal(invalidKrxFreshness.status, "refresh_recommended");

const futureSoxFreshness = soxInputFreshness(
  "2026-07-13",
  "2026-07-12T00:00:00.000Z",
);
assert.equal(futureSoxFreshness.future_date_anomaly, true);
assert.equal(futureSoxFreshness.status, "refresh_recommended");

const invalidSoxFreshness = soxInputFreshness(
  "2026-07-09junk",
  "2026-07-12T00:00:00.000Z",
);
assert.equal(invalidSoxFreshness.business_age_days, null);
assert.equal(invalidSoxFreshness.status, "refresh_recommended");

const currentSoxFixtureAsOf = readJson(path.join(dataRoot, "indices/nasdaq-giw-sox-constituents.json")).as_of;
assert.match(currentSoxFixtureAsOf, /^\d{4}-\d{2}-\d{2}$/, "SOX fixture source date");
const exactSpotRoot = makeExactSpotFixture({ includeAdmin: true });
// Fixed clock for the exact-spot lane: the builder's only clock is generatedAt,
// so pinning it pins every freshness computation. It stays inside the
// 10-calendar-day spot SLA after the 2026-08-07 exact spots and at-or-after the
// 2026-08-10 slickcharts collection, hence 2026-08-10. Fixture input clocks are
// clamped to at-or-before it inside makeExactSpotFixture. Live single-date
// Korea inputs (official KOSPI file, KRX bridge) newer than the fixed now keep
// their own dates and are named by validation until the data side carries
// history for them.
const payloadPinAsOf = "2026-08-10";
const payload = buildRimIndexInputs({
  dataRootOverride: exactSpotRoot,
  generatedAt: `${payloadPinAsOf}T23:59:59.000Z`,
});
const validation = validateRimIndexInputs(payload);

assert.equal(validation.ok, true, validation.errors.join("\n"));
assert.equal(payload.schema_version, "rim_index_inputs.v2");
assert.equal(payload.output_scope, "inputs_and_assumption_labelled_range_no_single_target");
assert.deepEqual(payload.policy.primary_indices, ["SPX", "NDX"]);

for (const id of ["SPX", "NDX"]) {
  const item = payload.indices[id];
  assert.equal(item.role, "primary_public_v1", `${id}: role`);
  assert.equal(item.blockers.length, 0, `${id}: blockers`);
  assert.equal(item.observed.price.source_tier, "observed_source", `${id}: price tier`);
  assert.equal(item.observed.forward_eps.source_tier, "observed_source", `${id}: EPS tier`);
  assert.equal(item.observed.risk_free_rate.source_tier, "observed_source", `${id}: risk-free tier`);
  assert.equal(item.observed.risk_free_rate.source, "macro/fred-banking-daily.json", `${id}: risk-free source`);
  assert.equal(item.derived.payout_ratio.source_tier, "derived_formula", `${id}: payout tier`);
  assert.equal(item.derived.payout_ratio.formula, "stock_action_index_weighted_dividend_yield / (benchmark_best_eps / benchmark_px_last)", `${id}: payout formula`);
  assert.equal(item.derived.explicit_eps_growth_3y.source_tier, "derived_formula", `${id}: growth tier`);
  assert.ok(item.derived.payout_ratio.coverage.covered_weight_ratio > 0.5, `${id}: payout coverage`);
  assert.ok(item.derived.payout_ratio.coverage.weighted_dividend_yield >= 0, `${id}: weighted dividend yield`);
  assert.equal(item.derived.legacy_payout_ratio_qa.source_tier, "derived_formula", `${id}: legacy payout QA tier`);
  assert.ok(item.derived.legacy_payout_ratio_qa.qa.covered_weight_ratio > 0.5, `${id}: legacy payout QA coverage`);
  assert.ok(item.derived.explicit_eps_growth_3y.coverage.covered_weight_ratio >= 0.75, `${id}: growth coverage`);
  assert.equal(item.derived.cost_of_equity.source_tier, "derived_formula", `${id}: cost of equity tier`);
  assert.ok(item.derived.cost_of_equity.value > item.observed.risk_free_rate.value, `${id}: cost of equity value`);
  assert.equal(item.derived.forecast_grid_v1.schema_version, "forecast_grid_v1", `${id}: forecast grid schema`);
  assert.equal(item.derived.forecast_grid_v1.public_status, "ready_inputs_only_no_fair_value", `${id}: forecast grid status`);
  assert.equal(item.derived.forecast_grid_v1.periods.length, 3, `${id}: forecast grid period count`);
  for (const [rowIndex, row] of item.derived.forecast_grid_v1.periods.entries()) {
    assert.ok(["fy1", "fy2", "fy3"].includes(row.period), `${id}: forecast period`);
    assert.equal(
      row.derivation_depth,
      rowIndex === 0 ? "source_anchored_or_one_step" : "chained_roll_forward",
      `${id}: derivation depth`,
    );
    assert.equal(
      row.source_confidence,
      rowIndex === 0 ? "source_snapshot_base_effect_sensitive" : "compounded_derived",
      `${id}: source confidence`,
    );
    assert.equal(
      row.growth_basis,
      rowIndex === 0 ? "source_reported_eps_growth_snapshot" : "forward_eps_ratio",
      `${id}: growth basis`,
    );
    assert.equal(
      row.growth_usage,
      rowIndex === 0 ? "context_only_not_earnings_roll_forward" : "earnings_path_roll_forward",
      `${id}: growth usage`,
    );
    assert.equal(row.earnings_proxy.source_tier, "derived_formula", `${id}: earnings proxy tier`);
    assert.equal(row.book_value_ending.source_tier, "derived_formula", `${id}: book value ending tier`);
    assert.equal(row.pe_ratio.source_tier, "derived_formula", `${id}: PE tier`);
    assert.equal(row.peg_ratio.source_tier, "derived_formula", `${id}: PEG tier`);
    assert.equal(row.peg_ratio.formula, "pe_ratio / (derived.explicit_eps_growth_3y * 100)", `${id}: PEG formula`);
    assert.ok(row.peg_ratio.sources.includes("derived.explicit_eps_growth_3y"), `${id}: PEG canonical source`);
    assert.notEqual(row.residual_income_proxy.value, null, `${id}: residual income proxy value`);
    if (rowIndex === 0) {
      assert.equal(row.earnings_proxy.formula, "benchmark_best_eps_anchor", `${id}: FY1 earnings proxy anchor`);
      assert.match(row.eps_growth.formula, /estimateSnapshot\.epsGrowth\.fy1/, `${id}: FY1 source-reported growth formula`);
      assert.match(row.eps_growth.notes.join(" "), /not applied/i, `${id}: FY1 eps growth caveat`);
      assert.match(row.earnings_proxy.notes.join(" "), /not multiplied/i, `${id}: FY1 earnings proxy caveat`);
    } else {
      assert.match(row.eps_growth.formula, /forward_eps_fy\d \/ forward_eps_fy\d/, `${id}: forward ratio growth formula`);
      assert.match(row.earnings_proxy.formula, /prior_period_earnings_proxy/, `${id}: roll-forward earnings proxy`);
    }
  }
}

const officialKospiSpotPayload = readJson(path.join(dataRoot, "computed/fenok-edge-korea-krx-index-daily.json"));
const officialKospiSpotRows = (officialKospiSpotPayload.indices ?? []).filter((row) => (
  row?.market === "KOSPI"
  && row?.index_class === "KOSPI"
  && row?.index_name === "코스피"
));
assert.equal(officialKospiSpotRows.length, 1, "real-root official KOSPI row identity remains unique");
const officialKospiSpotRow = officialKospiSpotRows[0];
const expectedExactSpots = {
  SPX: {
    source: "indices/sp500.json",
    as_of: "2026-08-07",
    value: 7777.7,
    identity: { provider_symbol: "^GSPC", canonical_index: "SPX" },
  },
  CCMP: {
    source: "indices/nasdaq.json",
    as_of: "2026-08-07",
    value: 26666.6,
    identity: { provider_symbol: "^IXIC", canonical_index: "CCMP" },
  },
  NDX: {
    source: "indices/nasdaq100.json",
    as_of: "2026-08-07",
    value: 29999.9,
    identity: { provider_symbol: "^NDX", canonical_index: "NDX" },
  },
  SOX: {
    source: "indices/sox.json",
    as_of: "2026-08-07",
    value: 12000.1,
    identity: { provider_symbol: "^SOX", canonical_index: "SOX" },
  },
  KOSPI: {
    source: "computed/fenok-edge-korea-krx-index-daily.json",
    source_field: "indices[market=KOSPI,index_class=KOSPI,index_name=코스피].close",
    as_of: officialKospiSpotPayload.as_of,
    value: officialKospiSpotRow.close,
    identity: { market: "KOSPI", index_class: "KOSPI", index_name: "코스피" },
  },
};
for (const [id, expected] of Object.entries(expectedExactSpots)) {
  const item = payload.indices[id];
  assert.equal(item.observed.price.source, expected.source, `${id}: exact spot source`);
  assert.equal(item.observed.price.source_field, expected.source_field ?? "rows[-1].value", `${id}: exact spot field`);
  assert.equal(item.observed.price.as_of, expected.as_of, `${id}: exact spot as_of`);
  assert.equal(item.observed.price.value, expected.value, `${id}: exact spot value`);
  assert.deepEqual(item.observed.price.identity, expected.identity, `${id}: exact named-index identity`);
  assert.equal(item.observed.price.freshness.generated_at_date, payloadPinAsOf, `${id}: processing date stays freshness metadata`);
  assert.equal(item.observed.benchmark_price.source, item.observed.forward_eps.source, `${id}: benchmark source is shared`);
  assert.equal(item.observed.benchmark_price.as_of, item.observed.forward_eps.as_of, `${id}: benchmark fundamentals share their own clock`);
  assert.equal(item.observed.benchmark_price.freshness.status, item.observed.forward_eps.freshness.status, `${id}: benchmark freshness is shared`);
  assert.notEqual(item.observed.price.as_of, item.observed.benchmark_price.as_of, `${id}: spot and benchmark clocks stay distinct`);
  assert.doesNotMatch(
    JSON.stringify(item.observed.price),
    /QQQ|SOXX|EWY|ETF|Global Scouter|Investing/i,
    `${id}: exact spot must not use an ETF or legacy price fallback`,
  );
  assert.equal(item.derived.book_value.formula, "current_price / price_to_book", `${id}: book uses current spot`);
  assert.ok(
    Math.abs(item.derived.book_value.value - (expected.value / item.observed.price_to_book.value)) < 0.01,
    `${id}: book value uses exact spot with benchmark P/B`,
  );
  if (item.derived.forecast_grid_v1?.periods?.length) {
    assert.equal(
      item.derived.forecast_grid_v1.periods[0].book_value_beginning.formula,
      "current_price / benchmark_px_to_book_ratio",
      `${id}: forecast book formula uses exact spot with benchmark P/B`,
    );
  }
}
assert.equal(payload.indices.KOSPI.observed.price.source_generated_at, officialKospiSpotPayload.generated_at);
for (const id of ["SPX", "CCMP", "NDX", "SOX"]) {
  assert.equal(payload.indices[id].observed.price.freshness.freshness_calendar, "us_market", `${id}: US spot clock`);
}
assert.equal(payload.indices.KOSPI.observed.price.freshness.freshness_calendar, "krx_market", "KOSPI spot clock");
assert.equal(payload.indices.KOSPI.observed.price.freshness.freshness_unit, "business_days", "KOSPI spot freshness unit");

const processingSnapshotPayload = buildRimIndexInputs({
  dataRootOverride: exactSpotRoot,
  generatedAt: "2026-08-10T23:59:59.000Z",
});
assert.equal(processingSnapshotPayload.indices.SPX.observed.price.as_of, "2026-08-07");
assert.equal(processingSnapshotPayload.indices.SPX.observed.price.freshness.generated_at_date, "2026-08-10");
assert.notEqual(
  processingSnapshotPayload.indices.SPX.observed.price.as_of,
  processingSnapshotPayload.indices.SPX.observed.price.freshness.generated_at_date,
  "generated_at_date must not become the economic spot observation date",
);

const staleSpotRoot = makeExactSpotFixture({
  includeAdmin: true,
  spotRows: { sp500: [{ date: "2026-07-01", value: 7000 }] },
});
try {
  const staleSpotPayload = buildRimIndexInputs({
    dataRootOverride: staleSpotRoot,
    generatedAt: "2026-08-10T23:59:59.000Z",
  });
  const staleSpot = staleSpotPayload.indices.SPX;
  assert.equal(staleSpot.observed.price.value, 7000);
  assert.equal(staleSpot.observed.price.freshness.status, "refresh_recommended");
  assert.ok(staleSpot.blockers.some((row) => row.code === "spot_source_refresh_recommended"));
  assert.equal(staleSpot.public_status, "input_only_primary_with_caveats");
  assert.equal(validateRimIndexInputs(staleSpotPayload).ok, true);
} finally {
  fs.rmSync(staleSpotRoot, { recursive: true, force: true });
}

const missingSpotRoot = makeExactSpotFixture({ includeAdmin: true });
try {
  fs.rmSync(path.join(missingSpotRoot, "indices", "nasdaq100.json"), { force: true });
  const missingSpotPayload = buildRimIndexInputs({
    dataRootOverride: missingSpotRoot,
    generatedAt: "2026-08-10T23:59:59.000Z",
  });
  const missingSpot = missingSpotPayload.indices.NDX;
  assert.ok(missingSpot.blockers.some((row) => row.code === "source_unavailable"));
  assert.equal(missingSpot.observed.price.value, null);
  assert.equal(missingSpot.observed.price.source_tier, "blocked_missing_source");
  assert.equal(missingSpot.observed.benchmark_price.value, null);
  assert.equal(validateRimIndexInputs(missingSpotPayload).ok, true);
} finally {
  fs.rmSync(missingSpotRoot, { recursive: true, force: true });
}

const identityMismatchRoot = makeExactSpotFixture({
  includeAdmin: true,
  mutateKospi: (source) => ({
    ...source,
    indices: source.indices.map((row) => row.index_name === "코스피" ? { ...row, index_name: "코스피 200" } : row),
  }),
});
try {
  const identityMismatchPayload = buildRimIndexInputs({
    dataRootOverride: identityMismatchRoot,
    generatedAt: "2026-08-10T23:59:59.000Z",
  });
  const mismatchedKospi = identityMismatchPayload.indices.KOSPI;
  assert.ok(mismatchedKospi.blockers.some((row) => row.code === "source_unavailable"));
  assert.match(mismatchedKospi.blockers.find((row) => row.code === "source_unavailable").reason, /identity mismatch/);
  assert.equal(mismatchedKospi.observed.price.value, null);
  assert.equal(mismatchedKospi.observed.benchmark_price.value, null);
  assert.equal(validateRimIndexInputs(identityMismatchPayload).ok, true);
} finally {
  fs.rmSync(identityMismatchRoot, { recursive: true, force: true });
}

const missingOfficialKospiRoot = makeExactSpotFixture({ includeAdmin: true });
try {
  fs.rmSync(path.join(missingOfficialKospiRoot, "computed", "fenok-edge-korea-krx-index-daily.json"), { force: true });
  const missingOfficialKospiPayload = buildRimIndexInputs({
    dataRootOverride: missingOfficialKospiRoot,
    generatedAt: "2026-08-10T23:59:59.000Z",
  });
  const missingOfficialKospi = missingOfficialKospiPayload.indices.KOSPI;
  assert.ok(missingOfficialKospi.blockers.some((row) => row.code === "source_unavailable"));
  assert.equal(missingOfficialKospi.observed.price.value, null);
  assert.equal(missingOfficialKospi.observed.price.source_tier, "blocked_missing_source");
  assert.equal(validateRimIndexInputs(missingOfficialKospiPayload).ok, true);
} finally {
  fs.rmSync(missingOfficialKospiRoot, { recursive: true, force: true });
}

// Coverage loss is honest lane degradation, not platform corruption. A stricter
// fixture floor forces the real builder down that path without fabricating inputs.
// Availability fixtures symlink shared sources from the live data tree. Pin their
// clock to the newest observed source date so those sources cannot outrun the test.
const currentLiveFixtureAsOf = Object.values(payload.indices)
  .flatMap((item) => Object.values(item.observed ?? {}))
  .map((field) => field?.as_of)
  .filter((asOf) => typeof asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asOf))
  .sort()
  .at(-1);
assert.match(currentLiveFixtureAsOf, /^\d{4}-\d{2}-\d{2}$/, "current live fixture source date");
const currentLiveFixtureGeneratedAt = `${currentLiveFixtureAsOf}T23:59:59.000Z`;
const degradedCoveragePayload = buildRimIndexInputs({
  generatedAt: currentLiveFixtureGeneratedAt,
  minCoveredWeight: 0.99,
});
const degradedCoverageValidation = validateRimIndexInputs(degradedCoveragePayload, {
  minCoveredWeight: 0.99,
});
assert.equal(degradedCoverageValidation.ok, true, degradedCoverageValidation.errors.join("\n"));
assert.ok(degradedCoverageValidation.warnings.length > 0, "coverage degradation must be named");
for (const id of ["SPX", "NDX"]) {
  const item = degradedCoveragePayload.indices[id];
  assert.equal(item.public_status, "input_only_primary_with_caveats", `${id}: degraded public status`);
  assert.ok(item.blockers.length > 0, `${id}: degradation blockers`);
  assert.equal(
    item.derived.forecast_grid_v1.public_status,
    "input_only_primary_with_caveats_no_fair_value",
    `${id}: degraded forecast-grid status`,
  );
}

// Claiming READY with the same low coverage remains a false-ready corruption.
const falseReadyPayload = JSON.parse(JSON.stringify(degradedCoveragePayload));
falseReadyPayload.indices.SPX.public_status = "ready_inputs_and_forecast_grid";
falseReadyPayload.indices.SPX.derived.forecast_grid_v1.public_status = "ready_inputs_only_no_fair_value";
const falseReadyValidation = validateRimIndexInputs(falseReadyPayload, { minCoveredWeight: 0.99 });
assert.equal(falseReadyValidation.ok, false);
assert.ok(falseReadyValidation.errors.some((error) => /SPX: false-ready/.test(error)));

// Formula/source-tier integrity remains platform-blocking even when availability
// is otherwise healthy.
const tamperedFormulaPayload = JSON.parse(JSON.stringify(payload));
tamperedFormulaPayload.indices.SPX.derived.cost_of_equity.formula = "risk_free_rate";
assert.equal(validateRimIndexInputs(tamperedFormulaPayload).ok, false);
const tamperedValuePayload = JSON.parse(JSON.stringify(payload));
tamperedValuePayload.indices.SPX.derived.cost_of_equity.value += 0.1;
assert.equal(validateRimIndexInputs(tamperedValuePayload).ok, false);

const missingBenchmarkRoot = makeBenchmarkAvailabilityFixture({ missing: true });
try {
  const missingBenchmarkPayload = buildRimIndexInputs({
    dataRootOverride: missingBenchmarkRoot,
    generatedAt: currentLiveFixtureGeneratedAt,
  });
  const missingBenchmarkValidation = validateRimIndexInputs(missingBenchmarkPayload);
  assert.equal(missingBenchmarkValidation.ok, true, missingBenchmarkValidation.errors.join("\n"));
  for (const id of ["SPX", "NDX", "KOSPI", "SOX"]) {
    assert.ok(missingBenchmarkPayload.indices[id].blockers.some((row) => row.code === "source_unavailable"));
    assert.ok(missingBenchmarkPayload.indices[id].observed.price.value > 0, `${id}: exact spot survives benchmark unavailability`);
    assert.equal(missingBenchmarkPayload.indices[id].observed.benchmark_price.value, null);
    assert.equal(missingBenchmarkPayload.indices[id].observed.benchmark_price.source_tier, "blocked_missing_source");
  }
} finally {
  fs.rmSync(missingBenchmarkRoot, { recursive: true, force: true });
}

const staleBenchmarkRoot = makeBenchmarkAvailabilityFixture({ stale: true });
try {
  const staleBenchmarkPayload = buildRimIndexInputs({
    dataRootOverride: staleBenchmarkRoot,
    generatedAt: currentLiveFixtureGeneratedAt,
  });
  const staleBenchmarkValidation = validateRimIndexInputs(staleBenchmarkPayload);
  assert.equal(staleBenchmarkValidation.ok, true, staleBenchmarkValidation.errors.join("\n"));
  for (const id of ["SPX", "NDX"]) {
    assert.equal(staleBenchmarkPayload.indices[id].public_status, "input_only_primary_with_caveats");
    assert.ok(staleBenchmarkPayload.indices[id].blockers.some((row) => row.code === "benchmark_source_refresh_recommended"));
  }
  assert.equal(staleBenchmarkPayload.indices.SOX.public_status, "input_only_sox_methodology_weights_with_caveats");
  const tamperedDegradedSecondary = JSON.parse(JSON.stringify(staleBenchmarkPayload));
  tamperedDegradedSecondary.indices.SOX.derived.cost_of_equity.formula = "risk_free_rate";
  assert.equal(validateRimIndexInputs(tamperedDegradedSecondary).ok, false);
} finally {
  fs.rmSync(staleBenchmarkRoot, { recursive: true, force: true });
}

assert.equal(payload.indices.CCMP.role, "secondary_input_only");
assert.equal(payload.indices.CCMP.public_status, "input_only_ccmp_direct_with_caveats");
assert.ok(payload.indices.CCMP.blockers.some((blocker) => blocker.code === "ccmp_direct_forecast_fields_missing"));
assert.equal(payload.indices.CCMP.observed.price.value, 26666.6);
assert.ok(payload.indices.CCMP.derived.payout_ratio.value > 0);
assert.equal(payload.indices.CCMP.derived.payout_ratio.coverage.dividend_yield_as_of, "2026-08-07");
assert.deepEqual(payload.indices.CCMP.derived.payout_ratio.coverage.source_clocks, {
  total_return_last_observation: "2026-08-07",
  price_return_last_observation: "2026-08-07",
  aligned_last_observation: "2026-08-07",
  requested_as_of: "2026-08-07",
  used_observation: "2026-08-07",
  anchor_observation: "2025-08-07",
  first_knowable_at: "2026-08-07",
  all_used_inputs_at_or_before: "2026-08-07",
});
assert.equal(payload.indices.CCMP.observed.risk_free_rate.source_field, "series.DGS10[-1].value / 100");
assert.equal(payload.indices.CCMP.observed.equity_risk_premium.source_field, "us_erp");
assert.equal(payload.indices.CCMP.observed.risk_free_rate.availability_status, "available");
assert.equal(payload.indices.CCMP.observed.equity_risk_premium.availability_status, "available");
assert.equal(payload.indices.CCMP.derived.forecast_grid_v1.source_tier, "blocked_missing_source");
assert.deepEqual(payload.indices.CCMP.derived.forecast_grid_v1.periods, []);
assert.equal(payload.indices.CCMP.derived.valuation_range_v1, undefined);
assert.equal(payload.indices.CCMP.derived.proxy_inputs_v1, undefined);
assert.doesNotMatch(JSON.stringify(payload.indices.CCMP.derived), /QQQ|ONEQ|proxy_diagnostic|methodology_derived_index_weight_source/i);
assert.equal(payload.coverage_diagnostics.proxy_constituent_candidates.CCMP.proxy_ticker, "ONEQ");
assert.equal(payload.coverage_diagnostics.proxy_constituent_candidates.CCMP.exact_index_substitute, false);
assert.ok(payload.coverage_diagnostics.proxy_constituent_candidates.CCMP.resolved_weight_ratio < 0.75);

const ccmpMeasuredRoot = makeCcmpFixture({
  spotRows: { nasdaq: [{ date: "2026-08-07", value: 26690.615234375 }] },
});
try {
  const measuredPayload = buildRimIndexInputs({
    dataRootOverride: ccmpMeasuredRoot,
    generatedAt: currentLiveFixtureGeneratedAt,
  });
  const measuredCcmp = measuredPayload.indices.CCMP;
  assert.ok(Math.abs(measuredCcmp.derived.payout_ratio.value - 0.14964115744352866) < 1e-12, "CCMP measured payout");
  assert.ok(Math.abs(measuredCcmp.derived.payout_ratio.coverage.dividend_yield - 0.006060379880316491) < 1e-15, "CCMP measured yield");
  assert.equal(measuredCcmp.derived.payout_ratio.coverage.exact_spot_value, 26690.615234375);
  assert.equal(measuredCcmp.derived.payout_ratio.coverage.exact_spot_as_of, "2026-08-07");
  assert.equal(measuredCcmp.observed.risk_free_rate.value, 0.0469);
  assert.equal(measuredCcmp.observed.equity_risk_premium.value, 0.0503);
  assert.equal(measuredCcmp.derived.cost_of_equity.value, 0.0972);
  assert.equal(measuredCcmp.derived.forecast_grid_v1.source_tier, "blocked_missing_source");
  assert.equal(validateRimIndexInputs(measuredPayload).ok, true);
} finally {
  fs.rmSync(ccmpMeasuredRoot, { recursive: true, force: true });
}

const ccmpDirectRoot = makeCcmpFixture({
  mutateBenchmark: (source) => {
    const row = source.sections.nasdaq_composite.data.at(-1);
    row.best_eps_fy2 = 1234.5;
    row.best_eps_fy3 = 1450.25;
    row.best_eps_asof = row.date;
  },
});
try {
  const directPayload = buildRimIndexInputs({
    dataRootOverride: ccmpDirectRoot,
    generatedAt: currentLiveFixtureGeneratedAt,
  });
  const directCcmp = directPayload.indices.CCMP;
  assert.equal(directCcmp.public_status, "ready_inputs_and_forecast_grid");
  assert.equal(directCcmp.blockers.length, 0);
  assert.equal(directCcmp.derived.forecast_grid_v1.source_tier, "direct_index_source");
  assert.deepEqual(
    directCcmp.derived.forecast_grid_v1.periods.map((row) => row.earnings_proxy.value),
    [1080.9544, 1234.5, 1450.25],
  );
  assert.deepEqual(
    directCcmp.derived.forecast_grid_v1.periods.map((row) => row.earnings_proxy.source_tier),
    ["observed_source", "observed_source", "observed_source"],
  );
  assert.equal(directCcmp.derived.forecast_grid_v1.coverage.best_eps_asof, "2026-07-31");
  assert.equal(directCcmp.derived.forecast_grid_v1.periods[0].book_value_beginning.formula, "current_price / benchmark_px_to_book_ratio");
  assert.equal(directCcmp.derived.forecast_grid_v1.periods[0].payout_ratio.formula, "derived.payout_ratio");
  assert.equal(directCcmp.derived.forecast_grid_v1.periods[0].residual_income_proxy.formula, "(roe_on_beginning_book - cost_of_equity) * book_value_beginning");
  assert.doesNotMatch(JSON.stringify(directCcmp.derived.forecast_grid_v1), /proxy_diagnostic|proxy_inputs_v1|methodology_derived_index_weight_source|QQQ|ONEQ/i);
  assert.equal(validateRimIndexInputs(directPayload).ok, true);
} finally {
  fs.rmSync(ccmpDirectRoot, { recursive: true, force: true });
}

for (const [label, mutateBenchmark, expected] of [
  [
    "N-A FY2",
    (source) => {
      const row = source.sections.nasdaq_composite.data.at(-1);
      row.best_eps_fy2 = "N-A";
      row.best_eps_fy3 = 1450.25;
      row.best_eps_asof = row.date;
    },
    /positive finite numeric|N-A/i,
  ],
  [
    "invalid FY3",
    (source) => {
      const row = source.sections.nasdaq_composite.data.at(-1);
      row.best_eps_fy2 = 1234.5;
      row.best_eps_fy3 = 0;
      row.best_eps_asof = row.date;
    },
    /positive finite numeric|non-positive/i,
  ],
  [
    "out-of-gate FY2",
    (source) => {
      const row = source.sections.nasdaq_composite.data.at(-1);
      row.best_eps_fy2 = row.best_eps * 4;
      row.best_eps_fy3 = row.best_eps * 4.5;
      row.best_eps_asof = row.date;
    },
    /outside/i,
  ],
  [
    "future best_eps_asof",
    (source) => {
      const row = source.sections.nasdaq_composite.data.at(-1);
      row.best_eps_fy2 = 1234.5;
      row.best_eps_fy3 = 1450.25;
      row.best_eps_asof = "2026-08-08";
    },
    /best_eps_asof.*must be no later|calendar date/i,
  ],
]) {
  const invalidRoot = makeCcmpFixture({ mutateBenchmark });
  try {
    const invalidPayload = buildRimIndexInputs({
      dataRootOverride: invalidRoot,
      generatedAt: currentLiveFixtureGeneratedAt,
    });
    const invalidCcmp = invalidPayload.indices.CCMP;
    assert.equal(invalidCcmp.derived.forecast_grid_v1.source_tier, "blocked_missing_source", `${label}: blocked grid`);
    assert.deepEqual(invalidCcmp.derived.forecast_grid_v1.periods, [], `${label}: no partial grid`);
    assert.ok(invalidCcmp.blockers.some((row) => /ccmp_direct_forecast/.test(row.code)), `${label}: named blocker`);
    assert.match(invalidCcmp.derived.forecast_grid_v1.reason, expected, `${label}: reason`);
    assert.equal(validateRimIndexInputs(invalidPayload).ok, true, `${label}: fail-closed payload validates`);
  } finally {
    fs.rmSync(invalidRoot, { recursive: true, force: true });
  }
}

const missingCcmpFredRoot = makeCcmpFixture({
  mutateMacro: (source) => {
    delete source.series.NASDAQCOM;
  },
});
try {
  const missingFredPayload = buildRimIndexInputs({
    dataRootOverride: missingCcmpFredRoot,
    generatedAt: currentLiveFixtureGeneratedAt,
  });
  const missingFredCcmp = missingFredPayload.indices.CCMP;
  assert.equal(missingFredCcmp.observed.price.value, 26666.6);
  assert.ok(missingFredCcmp.derived.book_value.value > 0);
  assert.equal(missingFredCcmp.derived.payout_ratio.value, null);
  assert.equal(missingFredCcmp.observed.risk_free_rate.value, 0.0469);
  assert.equal(missingFredCcmp.observed.equity_risk_premium.value, 0.0503);
  assert.equal(missingFredCcmp.derived.forecast_grid_v1.value, undefined);
  assert.equal(missingFredCcmp.derived.forecast_grid_v1.source_tier, "blocked_missing_source");
  assert.ok(missingFredCcmp.blockers.some((row) => row.code === "ccmp_measured_index_yield_unavailable"));
  assert.equal(validateRimIndexInputs(missingFredPayload).ok, true);
} finally {
  fs.rmSync(missingCcmpFredRoot, { recursive: true, force: true });
}

const kospi = payload.indices.KOSPI;
assert.doesNotMatch(String(kospi.observed.risk_free_rate.source_field ?? ""), /DGS10/);
if (kospi.role === "secondary_input_only") {
  const liveKrxFreshness = payload.coverage_diagnostics.stock_action.KOSPI.krx_kospi_weights.freshness;
  assert.ok(
    ["fresh_enough_for_input_slice", "refresh_recommended"].includes(liveKrxFreshness.status),
    `unexpected live KRX freshness status: ${liveKrxFreshness.status}`,
  );
  assert.equal(kospi.public_status, "input_only_krx_exact_weights_with_caveats");
  assert.ok(
    kospi.blockers.some((blocker) => blocker.code === "kospi_dart_payout_pointer_unavailable"),
    `missing DART pointer must block top-level payout: ${JSON.stringify(kospi.blockers)}`,
  );
  assert.equal(kospi.derived.payout_ratio.value, null);
  assert.equal(kospi.derived.payout_ratio.source_tier, "blocked_missing_source");
  assert.equal(kospi.derived.payout_ratio.formula, "kospi_dart_payout_artifact.payout_ratio");
  assert.equal(kospi.derived.legacy_payout_ratio_qa.source_tier, "derived_formula");
  assert.equal(kospi.derived.legacy_payout_ratio_qa.value, 0);
  assert.ok(
    kospi.derived.legacy_payout_ratio_qa.coverage.dividend_yield_unit_mix.unresolved
      > kospi.derived.legacy_payout_ratio_qa.coverage.dividend_yield_unit_mix.percent,
    "the old stock_action payout remains diagnostics-only",
  );
  assert.equal(kospi.observed.risk_free_rate.source_tier, "observed_source");
  assert.match(kospi.observed.risk_free_rate.source, /(kts_bydd_trd\/\d{8}\.json|derived_rim_inputs\.korea_10y)/);
  assert.ok(kospi.observed.risk_free_rate.value > 0.01);
  assert.ok(kospi.observed.risk_free_rate.value < 0.1);
  assert.ok(!kospi.blockers.some((blocker) => blocker.code === "missing_kospi_constituent_weight_path"));
  assert.ok(!kospi.blockers.some((blocker) => blocker.code === "country_risk_free_source_solved_not_wired"));
  assert.equal(kospi.derived.payout_ratio.coverage.availability_status, "blocked");
  assert.equal(kospi.derived.explicit_eps_growth_3y.source_tier, "derived_formula");
  assert.equal(kospi.derived.cost_of_equity.source_tier, "derived_formula");
  assert.equal(kospi.derived.forecast_grid_v1.periods[0].payout_ratio.value, null);
  assert.equal(kospi.derived.forecast_grid_v1.periods[0].payout_ratio.formula, "derived.payout_ratio");
  assert.equal(kospi.derived.forecast_grid_v1.coverage.exact_spot_as_of, payload.indices.KOSPI.observed.price.as_of);
  assert.equal(kospi.derived.payout_ratio.coverage.availability_as_of, null);
  assert.equal(kospi.derived.forecast_grid_v1.coverage.availability_as_of, payload.indices.KOSPI.observed.price.as_of);
  assert.ok(kospi.derived.explicit_eps_growth_3y.coverage.covered_weight_ratio >= 0.75);
  assert.equal(kospi.derived.forecast_grid_v1.schema_version, "forecast_grid_v1");
  assert.equal(kospi.derived.forecast_grid_v1.public_status, "input_only_krx_exact_weights_no_fair_value");
  assert.equal(kospi.derived.forecast_grid_v1.periods.length, 3);
  assert.equal(payload.coverage_diagnostics.stock_action.KOSPI.public_status, "krx_exact_weights_available");
  assert.equal(payload.coverage_diagnostics.stock_action.KOSPI.krx_kospi_weights.source_tier, "exact_index_weight_source");
  assert.ok(payload.coverage_diagnostics.stock_action.KOSPI.krx_kospi_weights.krx_rows > 0);
  assert.equal(
    payload.coverage_diagnostics.stock_action.KOSPI.krx_kospi_weights.denominator.label,
    "KRX KOSPI stock-daily issuer MKTCAP sum; matches KOSPI including foreign shares aggregate in kospi_dd_trd",
  );
  assert.ok(payload.coverage_diagnostics.stock_action.KOSPI.krx_kospi_weights.matched_weight_ratio >= 0.9);
  assert.ok(payload.coverage_diagnostics.stock_action.KOSPI.krx_kospi_weights.forward_eps_fy1_fy3_weight_ratio >= 0.75);
} else {
  assert.equal(kospi.role, "backlog_blocked");
  assert.equal(kospi.public_status, "blocked_or_input_only");
  assert.equal(payload.coverage_diagnostics.stock_action.KOSPI.public_status, "blocked_missing_kospi_index_weights");
  assert.equal(payload.coverage_diagnostics.stock_action.KOSPI.krx_kospi_weights, null);
}
assert.equal(payload.coverage_diagnostics.stock_action.KOSPI.kospi_index_weight_rows, 0);
assert.ok(payload.coverage_diagnostics.stock_action.KOSPI.forward_eps_fy1_fy3_rows > 0);
assert.equal(payload.coverage_diagnostics.proxy_constituent_candidates.KOSPI.proxy_ticker, "EWY");
assert.equal(payload.coverage_diagnostics.proxy_constituent_candidates.KOSPI.exact_index_substitute, false);
assert.equal(payload.coverage_diagnostics.proxy_constituent_candidates.KOSPI.diagnostic_status, "rejected_not_kospi_benchmark");
assert.ok(payload.coverage_diagnostics.proxy_constituent_candidates.KOSPI.resolved_weight_ratio >= 0.75);
assert.ok(payload.coverage_diagnostics.proxy_constituent_candidates.KOSPI.forward_eps_fy1_fy3_weight_ratio >= 0.75);

const fixtureRoot = makeKr10yFixture();
try {
  const payloadWithKr10y = buildRimIndexInputs({
    dataRootOverride: fixtureRoot,
    generatedAt: currentLiveFixtureGeneratedAt,
  });
  const kospiRiskFree = payloadWithKr10y.indices.KOSPI.observed.risk_free_rate;
  assert.equal(kospiRiskFree.source_tier, "observed_source");
  assert.equal(kospiRiskFree.source, "macro/fred-banking-daily.json");
  assert.equal(kospiRiskFree.source_field, "series.IRLTLT01KRM156N[-1].value / 100");
  assert.equal(kospiRiskFree.value, 0.0333);
  assert.equal(validateRimIndexInputs(payloadWithKr10y).ok, true);
  assert.ok(!payloadWithKr10y.indices.KOSPI.blockers.some((blocker) => blocker.code === "country_risk_free_source_solved_not_wired"));
  assert.ok(payloadWithKr10y.indices.KOSPI.blockers.some((blocker) => blocker.code === "kospi_dart_payout_pointer_unavailable"));
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

const bridgeFixtureRoot = makeKrxBridgeFixture(currentLiveFixtureAsOf);
try {
  const payloadWithBridgeOnlyKrx = buildRimIndexInputs({
    dataRootOverride: bridgeFixtureRoot,
    generatedAt: currentLiveFixtureGeneratedAt,
  });
  assert.equal(validateRimIndexInputs(payloadWithBridgeOnlyKrx).ok, true);
  const kospiBridge = payloadWithBridgeOnlyKrx.indices.KOSPI;
  assert.equal(kospiBridge.role, "secondary_input_only");
  // The bridge supplies exact KRX weights and KR10Y, but the exact DART payout
  // pointer is a separate required input and must fail closed when absent.
  assert.equal(kospiBridge.public_status, "input_only_krx_exact_weights_with_caveats");
  assert.match(kospiBridge.observed.risk_free_rate.source, /derived_rim_inputs\.korea_10y/);
  assert.deepEqual(
    kospiBridge.blockers.map((blocker) => blocker.code),
    ["kospi_dart_payout_pointer_unavailable"],
    "the bridge path blocks only on the missing exact DART payout pointer",
  );
  assert.equal(payloadWithBridgeOnlyKrx.coverage_diagnostics.stock_action.KOSPI.public_status, "krx_exact_weights_available");
  assert.match(payloadWithBridgeOnlyKrx.coverage_diagnostics.stock_action.KOSPI.krx_kospi_weights.source, /derived_rim_inputs\.kospi_weights/);
  assert.ok(payloadWithBridgeOnlyKrx.coverage_diagnostics.stock_action.KOSPI.krx_kospi_weights.matched_weight_ratio >= 0.75);
  assert.equal(kospiBridge.derived.forecast_grid_v1.public_status, "input_only_krx_exact_weights_no_fair_value");

  const staleBridgeGeneratedAt = new Date(currentLiveFixtureGeneratedAt);
  staleBridgeGeneratedAt.setUTCDate(staleBridgeGeneratedAt.getUTCDate() + 14);
  const staleBridgePayload = buildRimIndexInputs({
    dataRootOverride: bridgeFixtureRoot,
    generatedAt: staleBridgeGeneratedAt.toISOString(),
  });
  const staleKospiBridge = staleBridgePayload.indices.KOSPI;
  assert.equal(staleKospiBridge.public_status, "input_only_krx_exact_weights_with_caveats");
  assert.ok(staleKospiBridge.blockers.some((row) => row.code === "krx_kospi_daily_refresh_recommended"));
} finally {
  fs.rmSync(bridgeFixtureRoot, { recursive: true, force: true });
}

function runKospiDartFixture({ artifact = makeKospiDartArtifact(), pointer = null, includePointer = true, rawArtifact = null, rawPointer = null } = {}) {
  const root = makeKrxBridgeFixture(currentLiveFixtureAsOf);
  installKospiDartFixture(root, { artifact, pointer, includePointer, rawArtifact, rawPointer });
  try {
    return buildRimIndexInputs({
      dataRootOverride: root,
      generatedAt: currentLiveFixtureGeneratedAt,
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const dartReadyPayload = runKospiDartFixture();
const dartReadyKospi = dartReadyPayload.indices.KOSPI;
assert.equal(dartReadyKospi.public_status, "ready_inputs_and_forecast_grid");
assert.deepEqual(dartReadyKospi.blockers, []);
assert.equal(dartReadyKospi.derived.payout_ratio.value, 0.1);
assert.equal(dartReadyKospi.derived.payout_ratio.source_tier, "derived_formula");
assert.equal(dartReadyKospi.derived.payout_ratio.direct_source_tier, "direct_official_derived");
assert.equal(dartReadyKospi.derived.payout_ratio.formula, "kospi_dart_payout_artifact.payout_ratio");
assert.equal(dartReadyKospi.derived.payout_ratio.coverage.source_tier, "direct_official_derived");
assert.equal(dartReadyKospi.derived.payout_ratio.coverage.covered_weight_ratio, 0.9);
assert.equal(dartReadyKospi.derived.payout_ratio.coverage.availability_as_of, "2026-08-07");
assert.deepEqual(dartReadyKospi.derived.payout_ratio.coverage.source_clocks, {
  pointer_first_knowable_at: "2026-08-06",
  bridge_as_of: "2026-08-07",
  benchmark_as_of: "2026-08-02",
  availability_as_of: "2026-08-07",
  all_used_inputs_at_or_before: "2026-08-07",
});
assert.equal(dartReadyKospi.derived.payout_ratio.coverage.selected_artifact, "data/computed/fenok-rim/kospi-dart-payout/fy2025.json");
assert.match(dartReadyKospi.derived.payout_ratio.coverage.pointer_sha256, /^[a-f0-9]{64}$/);
assert.equal(dartReadyKospi.derived.payout_ratio.coverage.provenance.bridge.as_of, "2026-08-07");
assert.equal(dartReadyKospi.derived.payout_ratio.coverage.provenance.benchmark.as_of, "2026-08-02");
assert.ok(
  dartReadyKospi.derived.legacy_payout_ratio_qa.value === null
    || dartReadyKospi.derived.legacy_payout_ratio_qa.value === 0,
  "legacy stock_action payout remains diagnostic-only and may be unavailable",
);
assert.equal(dartReadyKospi.derived.forecast_grid_v1.periods[0].payout_ratio.value, 0.1);
assert.equal(dartReadyKospi.derived.forecast_grid_v1.periods[0].payout_ratio.formula, "derived.payout_ratio");
assert.equal(dartReadyKospi.derived.forecast_grid_v1.coverage.availability_as_of, "2026-08-07");
assert.equal(dartReadyKospi.derived.forecast_grid_v1.coverage.exact_spot_as_of, "2026-08-07");
assert.equal(validateRimIndexInputs(dartReadyPayload).ok, true);

for (const [label, options] of [
  ["missing pointer", { includePointer: false }],
  ["invalid pointer JSON", { rawPointer: "{broken" }],
  ["pointer schema mismatch", { pointer: { schema_version: "wrong.v1" } }],
  ["exact artifact path mismatch", { pointer: { selected_artifact: "data/computed/fenok-rim/kospi-dart-payout/fy2024.json" } }],
  ["artifact hash mismatch", { pointer: { sha256: "0".repeat(64) } }],
  ["artifact JSON corruption", { rawArtifact: "{broken" }],
  ["artifact schema mismatch", { artifact: { ...makeKospiDartArtifact(), schema_version: "wrong.v1" } }],
  ["artifact FY mismatch", { artifact: { ...makeKospiDartArtifact(), fy: 2024 } }],
  ["artifact date mismatch", { artifact: { ...makeKospiDartArtifact(), asOf: "not-a-date" } }],
  ["artifact first-knowable date corruption", { artifact: { ...makeKospiDartArtifact(), first_knowable_at: "not-a-timestamp" } }],
  ["coverage gate failure", { artifact: { ...makeKospiDartArtifact(), coverage: { covered_weight: 0.74, gate: 0.75, pass: false } } }],
  ["per-issuer leak", { artifact: { ...makeKospiDartArtifact(), per_issuer: [{ code: "005930", payout: 0.1 }] } }],
  ["bridge provenance corruption", { artifact: { ...makeKospiDartArtifact(), provenance: { ...makeKospiDartArtifact().provenance, bridge: null } } }],
  ["benchmark provenance corruption", { artifact: { ...makeKospiDartArtifact(), provenance: { ...makeKospiDartArtifact().provenance, benchmark: null } } }],
]) {
  const invalidPayload = runKospiDartFixture(options);
  const invalidKospi = invalidPayload.indices.KOSPI;
  assert.equal(invalidKospi.derived.payout_ratio.value, null, `${label}: no top-level payout`);
  assert.equal(invalidKospi.derived.payout_ratio.source_tier, "blocked_missing_source", `${label}: blocked tier`);
  assert.ok(
    invalidKospi.blockers.some((row) => row.code === "kospi_dart_payout_pointer_unavailable"),
    `${label}: named pointer blocker`,
  );
  assert.equal(validateRimIndexInputs(invalidPayload).ok, true, `${label}: fail-closed payload validates`);
}

// An alternate FY artifact is deliberately present, but a missing current
// pointer must not scan or select it as a fallback.
{
  const root = makeKrxBridgeFixture(currentLiveFixtureAsOf);
  installKospiDartFixture(root, { includePointer: false });
  writeJson(path.join(root, "computed/fenok-rim/kospi-dart-payout/fy2024.json"), makeKospiDartArtifact({ fy: 2024 }));
  try {
    const noScanPayload = buildRimIndexInputs({ dataRootOverride: root, generatedAt: currentLiveFixtureGeneratedAt });
    assert.equal(noScanPayload.indices.KOSPI.derived.payout_ratio.value, null, "missing pointer must not scan alternate FY files");
    assert.ok(
      noScanPayload.indices.KOSPI.derived.legacy_payout_ratio_qa.value === null
        || noScanPayload.indices.KOSPI.derived.legacy_payout_ratio_qa.value === 0,
      "legacy diagnostics do not become fallback payout",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const sox = payload.indices.SOX;
assert.equal(sox.role, "secondary_input_only");
assert.equal(sox.public_status, "ready_inputs_and_forecast_grid");
assert.equal(sox.blockers.length, 0);
assert.equal(sox.observed.price.identity.provider_symbol, "^SOX");
assert.equal(sox.observed.price.identity.canonical_index, "SOX");
assert.doesNotMatch(JSON.stringify(sox.observed.price), /SOXX/, "SOX observed identity must never name the SOXX ETF");
const wrongSoxIdentityPayload = structuredClone(payload);
wrongSoxIdentityPayload.indices.SOX.observed.price.identity.provider_symbol = "SOXX";
const wrongSoxIdentityValidation = validateRimIndexInputs(wrongSoxIdentityPayload);
assert.equal(wrongSoxIdentityValidation.ok, false, "SOXX must be rejected as the SOX provider identity");
assert.match(wrongSoxIdentityValidation.errors.join("\n"), /SOXX|provider_symbol/i);
assert.equal(sox.observed.risk_free_rate.source_tier, "observed_source");
assert.equal(sox.observed.risk_free_rate.source, "macro/fred-banking-daily.json");
assert.equal(sox.observed.equity_risk_premium.source_tier, "observed_source");
assert.equal(sox.derived.payout_ratio.source_tier, "derived_formula");
assert.equal(sox.derived.payout_ratio.formula, "sox_methodology_weighted_dividend_yield / (benchmark_best_eps / benchmark_px_last)");
assert.equal(sox.derived.explicit_eps_growth_3y.source_tier, "derived_formula");
assert.equal(sox.derived.cost_of_equity.source_tier, "derived_formula");
assert.ok(sox.derived.payout_ratio.coverage.covered_weight_ratio >= 0.75);
assert.ok(sox.derived.explicit_eps_growth_3y.coverage.covered_weight_ratio >= 0.75);
assert.equal(sox.derived.forecast_grid_v1.schema_version, "forecast_grid_v1");
assert.equal(sox.derived.forecast_grid_v1.public_status, "input_only_sox_methodology_weights_no_fair_value");
assert.equal(sox.derived.forecast_grid_v1.periods.length, 3);
assert.equal(sox.derived.forecast_grid_v1.coverage.index_key, "sox_nasdaq_giw_methodology_mktcap");
assert.equal(sox.derived.forecast_grid_v1.coverage.index_diagnostics.index_id, "SOX");
assert.equal(sox.derived.proxy_inputs_v1, undefined);
const soxDiagnostic = payload.coverage_diagnostics.stock_action.SOX;
assert.equal(soxDiagnostic.index_id, "SOX");
assert.equal(soxDiagnostic.source_tier, "methodology_derived_index_weight_source");
assert.equal(soxDiagnostic.source, "indices/nasdaq-giw-sox-constituents.json");
assert.equal(soxDiagnostic.official_weight_columns_available, false);
assert.equal(soxDiagnostic.constituent_rows, 30);
assert.equal(soxDiagnostic.methodology_weight_rows, 30);
assert.equal(soxDiagnostic.cap_violation_count, 0);
assert.ok(Math.abs(soxDiagnostic.methodology_weight_total - 100) < 0.0001);
assert.ok(Array.isArray(soxDiagnostic.top_weight_sample));
assert.ok(soxDiagnostic.top_weight_sample.length > 0);
assert.ok(soxDiagnostic.matched_weight_ratio >= 0.99);
assert.ok(soxDiagnostic.forward_eps_fy1_fy3_weight_ratio >= 0.75);
assert.equal(payload.coverage_diagnostics.proxy_constituent_candidates.SOX.proxy_ticker, "SOXX");
assert.equal(payload.coverage_diagnostics.proxy_constituent_candidates.SOX.exact_index_substitute, false);
assert.ok(payload.coverage_diagnostics.proxy_constituent_candidates.SOX.resolved_weight_ratio >= 0.75);

const wrongSoxDiagnosticPayload = structuredClone(payload);
wrongSoxDiagnosticPayload.indices.SOX.derived.forecast_grid_v1.coverage.index_diagnostics.index_id = "SOXX";
const wrongSoxDiagnosticValidation = validateRimIndexInputs(wrongSoxDiagnosticPayload);
assert.equal(wrongSoxDiagnosticValidation.ok, false, "SOXX must be rejected as the SOX forecast diagnostic identity");
assert.match(wrongSoxDiagnosticValidation.errors.join("\n"), /forecast_grid_v1\.coverage\.index_diagnostics\.index_id|SOX/i);

const badProxyPayload = JSON.parse(JSON.stringify(payload));
badProxyPayload.indices.SOX.derived.proxy_inputs_v1 = {
  schema_version: "proxy_inputs_v1",
  source_tier: "proxy_diagnostic",
  exact_index_substitute: false,
};
assert.equal(validateRimIndexInputs(badProxyPayload).ok, false);

const publicText = JSON.stringify(payload);
assert.equal(publicText.includes('"fair_value"'), false);
assert.equal(publicText.includes('"target_price"'), false);
const projected = buildPublicRimMirror({ source: "_private/admin/rim.json", value: 1 });
assert.equal(projected.source, "private_path_redacted");
assert.equal(projected.public_mirror_policy.raw_public, false);
const pathBearingProjection = buildPublicRimMirror({
  path: "admin/fenok-edge-korea-krx-daily-index.json",
  note: "Raw KRX rows stay private/admin; private path references are not public.",
  metric: "Selling, General & Admin",
  lowercase_metric: "selling, general & admin",
});
assert.equal(pathBearingProjection.path, "private_path_redacted");
// Redaction is PATH-only. The live payload leaked `admin/fenok-edge-korea-krx-daily-index.json`
// twice as a bare path, which is what must disappear. Prose that merely explains the
// policy is documentation, not an exposure: redacting it removes the reader's only
// explanation of why raw rows are absent, while hiding nothing.
assert.equal(
  pathBearingProjection.note,
  "Raw KRX rows stay private/admin; private path references are not public.",
  "prose describing the policy must survive redaction",
);
assert.equal(
  buildPublicRimMirror({ p: "data/admin/fenok-edge-korea-krx-daily-index.json" }).p,
  "private_path_redacted",
  "a nested admin path is still redacted",
);
assert.equal(
  buildPublicRimMirror({ s: "private path references are not public" }).s,
  "private path references are not public",
  "the bare phrase 'private path' is prose and must survive",
);
// The public mirror guard rejects these literal tokens ANYWHERE in the emitted
// bytes, including in the payload's own description of its redaction policy.
// Run 30692013135 failed the Cloudflare build on exactly that: the policy
// sentence spelled the forbidden token out loud while the data value beside it
// was correctly redacted.
for (const token of ["_private/", "admin/data-supply-state/", "admin/slickcharts-daily-delivery/", "data/yf/migration-evidence/"]) {
  assert.equal(
    JSON.stringify(buildPublicRimMirror({ p: "_private/admin/rim.json" })).includes(token),
    false,
    `the emitted mirror must not contain the forbidden public token ${token}, not even in its own policy text`,
  );
}
assert.equal(pathBearingProjection.metric, "Selling, General & Admin", "finance metric words are not redacted");
assert.equal(pathBearingProjection.lowercase_metric, "selling, general & admin", "lowercase finance metric words are not redacted");
const projectedText = JSON.stringify(pathBearingProjection);
assert.equal(projectedText.includes("admin/fenok-edge"), false);
assert.equal(projectedText.includes("admin_private_path_redacted"), false);

assert.deepEqual(parseArgs(["--check", "--min-covered-weight", "0.8"]).check, true);
const cliRoot = path.join(os.tmpdir(), "rim-cli-data-root");
const cliPublicRoot = path.join(os.tmpdir(), "rim-cli-public-root");
assert.equal(parseArgs(["--data-root", cliRoot]).dataRoot, path.resolve(cliRoot));
assert.equal(parseArgs([`--data-root=${cliRoot}`]).dataRoot, path.resolve(cliRoot));
assert.equal(parseArgs(["--public-data-root", cliPublicRoot]).publicDataRoot, path.resolve(cliPublicRoot));
assert.equal(parseArgs([`--public-data-root=${cliPublicRoot}`]).publicDataRoot, path.resolve(cliPublicRoot));

// A provider calendar date must resolve to the same day in every timezone. The
// Damodaran ERP source_date is the zoneless string "April 1, 2026"; projecting its
// locally-parsed midnight through toISOString resolved it to 2026-04-01 on a UTC
// runner and 2026-03-31 in Asia/Seoul, so build-rim-index --check called the
// committed artifact stale on any machine east of UTC. Run the real builder in two
// zones and require identical observed source dates.
{
  const observedSourceDatesIn = (timeZone) => {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { buildRimIndexInputs } from ${JSON.stringify(path.join(__dirname, "build-rim-index.mjs"))};`
        + "const built = buildRimIndexInputs({ generatedAt: '2099-01-01T00:00:00.000Z' });"
        + "const dates = Object.entries(built.indices).flatMap(([id, item]) =>"
        + "  Object.entries(item.observed ?? {}).map(([field, value]) => `${id}.${field}=${value?.as_of}`));"
        + "console.log(JSON.stringify(dates.sort()));",
      ],
      { encoding: "utf8", env: { ...process.env, TZ: timeZone } },
    );
    assert.equal(result.status, 0, `builder must run under TZ=${timeZone}: ${result.stderr}`);
    return JSON.parse(result.stdout.trim().split("\n").at(-1));
  };
  const seoul = observedSourceDatesIn("Asia/Seoul");
  const utc = observedSourceDatesIn("UTC");
  assert.ok(seoul.length > 0, "timezone fixture must observe source dates");
  assert.deepEqual(seoul, utc, "observed source dates must not depend on the runner timezone");
}

// ---------------------------------------------------------------------------
// SUCCESSOR CONTRACT: an assumption-labelled valuation RANGE, never a target.
//
// The producer used to stop at inputs. The missing step was a decision, not a
// defect: `no_public_single_target` forbids publishing one number for an index,
// so the successor publishes a BAND between two named scenarios and refuses to
// name a middle. These assertions pin that refusal, because the cheapest way to
// lose it is for someone to add a helpful "base case" later.
// ---------------------------------------------------------------------------
const RANGE_SCHEMA = "rim_valuation_range_v1";
const POINT_TARGET_TOKENS = ["fair_value", "target_price", "price_target", "intrinsic_value"];

assert.equal(payload.policy.no_public_single_target, true, "the single-target ban survives the successor scope");
assert.equal(
  payload.policy.valuation_range_scope,
  "SPX_NDX_only_assumption_labelled_range_no_single_target",
  "the range scope names the two indices it covers and the shape it refuses",
);

// NDX no longer publishes a band: its two payout routes differ by 15.44%, above
// the 5% reconciliation bound. It stays input-only until that source
// disagreement is resolved, so the ready-band assertions cover SPX alone.
const RANGE_PUBLISHING_IDS = ["SPX"];
const RANGE_REFUSED_IDS = ["NDX"];

for (const id of RANGE_PUBLISHING_IDS) {
  const item = payload.indices[id];
  const range = item.derived.valuation_range_v1;
  assert.ok(range, `${id}: a primary index carries a valuation range`);
  assert.equal(range.schema_version, RANGE_SCHEMA, `${id}: range schema`);
  assert.equal(range.public_status, "ready_range_no_single_target", `${id}: range status`);
  assert.equal(range.emits_single_target, false, `${id}: the range declares it is not a target`);

  // Every gate is a separately named boolean so a future failure says WHICH
  // gate refused, instead of a bare "no range".
  assert.deepEqual(
    Object.fromEntries(Object.entries(range.gates).map(([key, gate]) => [key, gate.passed])),
    {
      primary_index: true,
      source_tier_satisfied: true,
      blockers_empty: true,
      operands_complete: true,
      source_clock_honest: true,
      payout_routes_reconciled: true,
      model_sensitivity_bounded: true,
    },
    `${id}: every publication gate must pass before any range is emitted`,
  );

  // The clock must list every contributing layer, not only the observed block.
  const clockSources = range.source_clock.contributing_sources.map((row) => row.source);
  assert.ok(clockSources.includes("computed/stock_action_index.json"), `${id}: stock action clock is contributing`);
  assert.ok(clockSources.includes("benchmark_row"), `${id}: benchmark clock is contributing`);
  assert.equal(
    range.source_clock.contributing_sources[0].as_of,
    range.as_of,
    `${id}: the reported as_of is the first (oldest) contributing clock`,
  );

  // The two independent payout routes must agree on the number the model uses.
  const crossCheck = range.operands.payout_cross_check;
  assert.ok(crossCheck.payout_divergence <= crossCheck.payout_divergence_limit, `${id}: the payout routes themselves agree`);
  assert.ok(crossCheck.retention_divergence <= crossCheck.retention_divergence_limit, `${id}: retention sensitivity is bounded`);
  assert.ok(crossCheck.unresolved_unit_share <= 0.25, `${id}: most constituent dividend units are measurable`);

  // EXACTLY two scenarios: the endpoints. A third, middle scenario would be
  // read as "the" number by every reader, which is the thing the policy bans.
  assert.equal(range.scenarios.length, 2, `${id}: exactly two endpoint scenarios`);
  assert.deepEqual(range.scenarios.map((row) => row.id), ["conservative", "optimistic"], `${id}: scenario ids`);
  for (const scenario of range.scenarios) {
    assert.equal(typeof scenario.value, "number", `${id}/${scenario.id}: scenario value`);
    assert.ok(Number.isFinite(scenario.value) && scenario.value > 0, `${id}/${scenario.id}: finite positive value`);
    assert.equal(scenario.assumption_version, "rim-assumptions-20260708", `${id}/${scenario.id}: assumption version`);
    assert.equal(scenario.source_tier, "assumption_labelled_scenario", `${id}/${scenario.id}: scenario tier`);
    assert.ok(scenario.terminal_treatment.length > 0, `${id}/${scenario.id}: terminal treatment named`);
    assert.ok(scenario.formula.includes("book_value_beginning"), `${id}/${scenario.id}: formula anchors on book value`);
  }
  const [conservative, optimistic] = range.scenarios;
  assert.ok(conservative.value < optimistic.value, `${id}: the conservative endpoint must be the lower one`);
  assert.equal(range.range.low, conservative.value, `${id}: range low is the conservative endpoint`);
  assert.equal(range.range.high, optimistic.value, `${id}: range high is the optimistic endpoint`);

  // Assumptions must be labelled as assumptions, not dressed as sources.
  assert.equal(range.assumptions.terminal_growth.source_tier, "house_assumption", `${id}: terminal growth tier`);
  assert.equal(range.assumptions.fade_years.source_tier, "house_assumption", `${id}: fade years tier`);
  assert.equal(range.assumptions.discount_rate.source_tier, "derived_formula", `${id}: discount rate tier`);
  assert.equal(
    range.assumptions.discount_rate.value,
    item.derived.cost_of_equity.value,
    `${id}: the discount rate is the published cost of equity, not a second private number`,
  );
  assert.ok(
    range.assumptions.terminal_growth.high < range.assumptions.discount_rate.value,
    `${id}: a perpetuity is only defined while terminal growth stays below the discount rate`,
  );

  // Honest source clock: the range is only as current as its OLDEST operand.
  const operandDates = Object.values(item.observed)
    .map((field) => field?.as_of)
    .filter((asOf) => typeof asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asOf));
  assert.equal(range.as_of, operandDates.slice().sort()[0], `${id}: range as_of is the oldest operand date`);
  assert.equal(range.source_clock.basis, "oldest_contributing_observed_source", `${id}: clock basis`);

  // The operands are the published ones, by reference, so the range can never
  // drift away from the grid a reader is looking at.
  assert.equal(
    range.operands.residual_income_by_period.map((row) => row.period).join(","),
    "fy1,fy2,fy3",
    `${id}: residual income operands come from the three published periods`,
  );
  for (const [rowIndex, row] of range.operands.residual_income_by_period.entries()) {
    assert.equal(
      row.value,
      item.derived.forecast_grid_v1.periods[rowIndex].residual_income_proxy.value,
      `${id}: operand ${row.period} equals the published residual_income_proxy`,
    );
  }

  // No point-target vocabulary anywhere in the emitted block.
  const rangeText = JSON.stringify(range);
  for (const token of POINT_TARGET_TOKENS) {
    assert.equal(rangeText.includes(token), false, `${id}: the range must not contain the token ${token}`);
  }
}

// `residual_income_proxy` keeps its name. It is an operand of the range, and
// renaming it would silently break every reader that already knows the key.
for (const id of ["SPX", "NDX"]) {
  const fy1 = payload.indices[id].derived.forecast_grid_v1.periods[0];
  assert.ok("residual_income_proxy" in fy1, `${id}: residual_income_proxy keeps its published name`);
  assert.equal(
    fy1.residual_income_proxy.formula,
    "(roe_on_beginning_book - cost_of_equity) * book_value_beginning",
    `${id}: residual_income_proxy formula is unchanged`,
  );
}

// CCMP / KOSPI / SOX stay input-only. They are not primary indices, so they
// must not carry a range at all -- an empty or blocked range block would still
// invite a consumer to render something.
for (const id of ["CCMP", "KOSPI", "SOX"]) {
  assert.equal(
    "valuation_range_v1" in (payload.indices[id].derived ?? {}),
    false,
    `${id}: secondary and backlog indices carry no valuation range`,
  );
}

// GATE PROOF, not gate description: the same builder, run with a coverage floor
// it cannot meet, must REFUSE to publish a range while still publishing inputs.
for (const id of ["SPX", "NDX"]) {
  const blocked = degradedCoveragePayload.indices[id].derived.valuation_range_v1;
  assert.ok(blocked, `${id}: a refused range is still reported, not omitted`);
  assert.equal(blocked.public_status, "blocked_no_range", `${id}: degraded coverage refuses the range`);
  assert.equal(blocked.range.low, null, `${id}: refused low`);
  assert.equal(blocked.range.high, null, `${id}: refused high`);
  assert.deepEqual(blocked.scenarios, [], `${id}: a refused range emits no scenarios`);
  assert.equal(blocked.gates.blockers_empty.passed, false, `${id}: the blockers gate is the one that refused`);
  assert.ok(blocked.gates.blockers_empty.reason.length > 0, `${id}: the refusing gate states its reason`);
}
assert.equal(
  validateRimIndexInputs(degradedCoveragePayload, { minCoveredWeight: 0.99 }).ok,
  true,
  "refusing to publish a range is honest degradation, not corruption",
);

// FALSE-READY: claiming a range while a gate failed is corruption, exactly like
// the false-ready guard the inputs slice already has.
const falseRangePayload = JSON.parse(JSON.stringify(degradedCoveragePayload));
falseRangePayload.indices.SPX.derived.valuation_range_v1.public_status = "ready_range_no_single_target";
falseRangePayload.indices.SPX.derived.valuation_range_v1.range = { low: 100, high: 200 };
const falseRangeValidation = validateRimIndexInputs(falseRangePayload, { minCoveredWeight: 0.99 });
assert.equal(falseRangeValidation.ok, false, "a range published over a failed gate must not validate");
assert.ok(
  falseRangeValidation.errors.some((error) => /SPX.*valuation_range_v1.*gate/i.test(error)),
  `the error must name the gate: ${falseRangeValidation.errors.join("; ")}`,
);

// A SINGLE TARGET is the one shape this whole slice exists to prevent. Adding
// one must fail validation even when every gate genuinely passed.
for (const [label, mutate] of [
  ["a collapsed range", (range) => { range.range.high = range.range.low; }],
  ["a named point target", (range) => { range.point_target = range.range.low; }],
  ["a middle scenario", (range) => {
    range.scenarios.splice(1, 0, { id: "base", value: (range.range.low + range.range.high) / 2 });
  }],
]) {
  const singleTargetPayload = JSON.parse(JSON.stringify(payload));
  mutate(singleTargetPayload.indices.SPX.derived.valuation_range_v1);
  const singleTargetValidation = validateRimIndexInputs(singleTargetPayload);
  assert.equal(singleTargetValidation.ok, false, `${label} must fail validation`);
  assert.ok(
    singleTargetValidation.errors.some((error) => /single|target|scenario/i.test(error)),
    `${label}: the error must say why: ${singleTargetValidation.errors.join("; ")}`,
  );
}

// ---------------------------------------------------------------------------
// DEFECT A: `dividendYield` carries BOTH units in ONE field.
//
// computed/stock_action_index.json stores AAPL as 0.00321 and MTB as 2.43, and
// both rows say market=US -- so the convention is not split by market, by index,
// or by anything a caller can read off the row's identity. Averaging them raw
// produced a weighted S&P 500 dividend yield of 8.4% and a payout ratio of
// 1.642454, which then silently froze the book-value roll-forward.
//
// Magnitude alone cannot decide: a percent-encoded 0.4% yield is 0.4 and a
// fraction-encoded one is 0.004, and BOTH are below 1. The only honest
// discriminator is the row's own measured dividend over its own price.
// ---------------------------------------------------------------------------
{
  const percentRow = { symbol: "MTB", dividendYield: 2.43, price: 246.29, dividendHistory: { ttm: 6 } };
  const fractionRow = { symbol: "AAPL", dividendYield: 0.0032130202390246838, price: 333.02, dividendHistory: { ttm: 1.05 } };
  const unresolvableRow = { symbol: "001450.KS", dividendYield: 0.0346964, price: null, dividendHistory: null };
  const contradictoryRow = { symbol: "NODIV", dividendYield: 1.5, price: 100, dividendHistory: { ttm: 0 } };

  const percent = normalizeDividendYieldFraction(percentRow);
  assert.equal(percent.unit, "percent", "MTB pays 6.00 on a 246.29 price, so 2.43 can only be a percent");
  assert.ok(Math.abs(percent.value - 0.0243) < 0.0005, `percent row must become a fraction, got ${percent.value}`);

  const fraction = normalizeDividendYieldFraction(fractionRow);
  assert.equal(fraction.unit, "fraction", "AAPL pays 1.05 on a 333.02 price, so 0.0032 is already a fraction");
  assert.equal(fraction.value, 0.0032130202390246838, "a fraction row must pass through untouched");

  // Refusing is the honest answer. Guessing a unit is fabrication with a
  // hundred-fold error bar.
  for (const [label, row] of [["no price or dividend", unresolvableRow], ["a stored yield with no dividend", contradictoryRow]]) {
    const unresolved = normalizeDividendYieldFraction(row);
    assert.equal(unresolved.value, null, `${label}: must not be guessed`);
    assert.equal(unresolved.unit, "unresolved", `${label}: must be reported unresolved`);
    assert.ok(unresolved.reason.length > 0, `${label}: must state why`);
  }

  // A true zero-dividend row is resolved, not dropped: it is a real 0% yield.
  const zeroRow = normalizeDividendYieldFraction({ symbol: "Z", dividendYield: 0, price: 10, dividendHistory: { ttm: 0 } });
  assert.equal(zeroRow.value, 0, "a genuine zero yield is a measurement, not a gap");
}

// The published payout ratio must be a ratio a real index can produce, and the
// unit mix it was built from must be visible rather than averaged away.
for (const id of ["SPX", "NDX"]) {
  const payout = payload.indices[id].derived.payout_ratio;
  assert.ok(
    payout.value > 0 && payout.value < 1,
    `${id}: payout ratio must be a real fraction, got ${payout.value}`,
  );
  assert.ok(
    payout.coverage.weighted_dividend_yield > 0 && payout.coverage.weighted_dividend_yield < 0.06,
    `${id}: a broad equity index cannot yield ${payout.coverage.weighted_dividend_yield}`,
  );
  const mix = payout.coverage.dividend_yield_unit_mix;
  assert.ok(mix, `${id}: the unit mix must be published, not silently resolved`);
  assert.ok(mix.percent + mix.fraction > 0, `${id}: resolved rows`);
  assert.equal(typeof mix.unresolved, "number", `${id}: unresolved rows are counted`);
}

// ---------------------------------------------------------------------------
// DEFECT A2: the published formula must be the arithmetic that actually ran.
//
// retention was computed as Math.max(0, 1 - payout) while the emitted formula
// string said "1 - payout_ratio". At payout 1.64 the published retention read
// 0.0 -- a number that satisfies neither the formula nor the economics -- and
// the book roll-forward froze without saying so.
// ---------------------------------------------------------------------------
for (const id of ["SPX", "NDX"]) {
  for (const row of payload.indices[id].derived.forecast_grid_v1.periods) {
    assert.ok(
      Math.abs(row.retention_ratio.value - (1 - row.payout_ratio.value)) < 1e-6,
      `${id}/${row.period}: retention must equal the formula it publishes,`
      + ` got ${row.retention_ratio.value} against 1 - ${row.payout_ratio.value}`,
    );
    assert.ok(
      Math.abs(
        row.book_value_ending.value
        - (row.book_value_beginning.value + row.earnings_proxy.value * row.retention_ratio.value),
      ) < 1e-2,
      `${id}/${row.period}: the roll-forward must use the retention it published`,
    );
  }
}

// ---------------------------------------------------------------------------
// DEFECT B: the range validator READ declarations instead of MEASURING them.
//
// Every mutation below leaves the payload internally consistent-looking, so a
// validator that only checks that fields exist and agree with each other waves
// them through. Each one must be caught by recomputation.
// ---------------------------------------------------------------------------
for (const [label, mutate, expected] of [
  [
    "a gate that declares itself passed while the blockers it guards are open",
    (item) => {
      item.blockers.push({ code: "planted_blocker", severity: "lane_degraded" });
    },
    /blockers_empty/i,
  ],
  [
    "an as_of newer than the oldest operand it claims to summarise",
    (item) => {
      item.derived.valuation_range_v1.as_of = "2099-01-01";
      item.derived.valuation_range_v1.source_clock.as_of = "2099-01-01";
    },
    /as_of|oldest/i,
  ],
  [
    "terminal growth raised above the discount rate, where the perpetuity is undefined",
    (item) => {
      item.derived.valuation_range_v1.assumptions.terminal_growth.high =
        item.derived.cost_of_equity.value + 0.01;
    },
    /growth|discount/i,
  ],
  [
    "both endpoints inflated together so they still agree with each other",
    (item) => {
      const range = item.derived.valuation_range_v1;
      for (const scenario of range.scenarios) scenario.value *= 3;
      range.range.low = range.scenarios[0].value;
      range.range.high = range.scenarios[1].value;
    },
    /recompute|endpoint|scenario value/i,
  ],
  [
    "a book value operand that no longer matches the grid it cites",
    (item) => {
      item.derived.valuation_range_v1.operands.book_value_beginning.value *= 2;
    },
    /operand|book_value/i,
  ],
  [
    "every gate deleted, which used to validate as cleanly as every gate passing",
    (item) => {
      item.derived.valuation_range_v1.gates = {};
    },
    /gates must be exactly/i,
  ],
  [
    "one gate quietly dropped from the set",
    (item) => {
      delete item.derived.valuation_range_v1.gates.model_sensitivity_bounded;
    },
    /gates must be exactly/i,
  ],
  [
    "a point target nested inside notes, where a direct-key check cannot see it",
    (item) => {
      item.derived.valuation_range_v1.notes.push({ point_target: 5000 });
    },
    /forbidden single-target key at/i,
  ],
  [
    "a point target buried two levels down under an innocent name",
    (item) => {
      item.derived.valuation_range_v1.operands.summary = { consensus: { fair_value: 4200 } };
    },
    /forbidden single-target key at/i,
  ],
  [
    "a source clock that drops the stock action layer it was built from",
    (item) => {
      const clock = item.derived.valuation_range_v1.source_clock;
      clock.contributing_sources = clock.contributing_sources.filter(
        (row) => row.source !== "computed/stock_action_index.json",
      );
    },
    /omits contributing source/i,
  ],
  [
    "a book roll-forward that no longer follows from the retention beside it",
    (item) => {
      item.derived.forecast_grid_v1.periods[0].book_value_ending.value += 500;
    },
    /roll-forward|continue the prior/i,
  ],
  [
    "a residual income that does not follow from its own roe and book",
    (item) => {
      item.derived.forecast_grid_v1.periods[2].residual_income_proxy.value *= 1.5;
      item.derived.valuation_range_v1.operands.residual_income_by_period[2].value =
        item.derived.forecast_grid_v1.periods[2].residual_income_proxy.value;
    },
    /residual income .* does not recompute/i,
  ],
  [
    "an roe that contradicts the earnings and book it cites",
    (item) => {
      item.derived.forecast_grid_v1.periods[0].roe_on_beginning_book.value += 0.05;
    },
    /roe .* does not recompute/i,
  ],
  [
    "a width ratio that does not follow from the endpoints",
    (item) => {
      item.derived.valuation_range_v1.range.width_ratio = 1.0;
    },
    /width_ratio .* does not recompute/i,
  ],
  [
    "a price position that contradicts the price and the band",
    (item) => {
      item.derived.valuation_range_v1.price_context.position = "within_range";
    },
    /price position .* does not recompute/i,
  ],
  [
    "a published divergence that does not rederive from the payout operands",
    (item) => {
      item.derived.valuation_range_v1.operands.payout_cross_check.retention_divergence = 0.9;
    },
    /retention_divergence .* does not rederive/i,
  ],
  [
    "a payout divergence edited to look reconciled",
    (item) => {
      item.derived.valuation_range_v1.operands.payout_cross_check.payout_divergence = 0.001;
    },
    /payout_divergence .* does not rederive/i,
  ],
  [
    "a payout route disagreement hidden behind a declared-passing gate",
    (item) => {
      item.derived.legacy_payout_ratio_qa.value = item.derived.payout_ratio.value * 1.4;
    },
    /payout_routes_reconciled/i,
  ],
  [
    "a continuing value tampered with while the endpoint still agrees with itself",
    (item) => {
      item.derived.valuation_range_v1.scenarios[1].continuing_value_at_fy3 *= 1.3;
    },
    /continuing_value_at_fy3 .* does not recompute/i,
  ],
  [
    "a scenario terminal growth that no longer matches its declared assumption",
    (item) => {
      item.derived.valuation_range_v1.scenarios[1].terminal_growth = 0.05;
    },
    /terminal_growth .* does not match the declared assumption/i,
  ],
  [
    "a rewritten scenario formula",
    (item) => {
      item.derived.valuation_range_v1.scenarios[0].formula = "book_value_beginning + something_else";
    },
    /formula is not the contract formula/i,
  ],
  [
    "terminal treatment prose that stops naming the fade years it describes",
    (item) => {
      item.derived.valuation_range_v1.scenarios[0].terminal_treatment = "residual income fades away";
    },
    /must name the fade years/i,
  ],
  [
    "a source clock with the reconciliation route removed",
    (item) => {
      const clock = item.derived.valuation_range_v1.source_clock;
      clock.contributing_sources = clock.contributing_sources.filter(
        (row) => row.source !== "reconciliation.index_yield",
      );
    },
    /omits contributing source reconciliation\.index_yield/i,
  ],
  [
    "a source_clock.as_of pushed into the future while range.as_of stays honest",
    (item) => {
      item.derived.valuation_range_v1.source_clock.as_of = "2099-01-01";
    },
    /source_clock\.as_of .* must equal the oldest/i,
  ],
  [
    "a declared clock date that disagrees with the payload it cites",
    (item) => {
      const clock = item.derived.valuation_range_v1.source_clock;
      const row = clock.contributing_sources.find((entry) => entry.source === "benchmark_row");
      row.as_of = "2020-01-01";
    },
    /source clock (omits|declares) .*benchmark_row/i,
  ],
  [
    "a clock whose route was changed",
    (item) => {
      const row = item.derived.valuation_range_v1.source_clock.contributing_sources
        .find((entry) => entry.source === "benchmark_row");
      row.route = "reconciliation";
    },
    /not a contributing route|not a declared clock tuple/i,
  ],
  [
    "a clock whose kind was changed",
    (item) => {
      const row = item.derived.valuation_range_v1.source_clock.contributing_sources
        .find((entry) => entry.source === "observed.price");
      row.kind = "collected_at";
    },
    /source clock (omits|declares) .*observed\.price/i,
  ],
  [
    "a duplicated clock entry",
    (item) => {
      const clock = item.derived.valuation_range_v1.source_clock;
      clock.contributing_sources.push({ ...clock.contributing_sources[0] });
    },
    /declares .* on route .* 2 times/i,
  ],
  [
    "falsified contributing_source_dates",
    (item) => {
      item.derived.valuation_range_v1.source_clock.contributing_source_dates = ["2026-07-31"];
    },
    /contributing_source_dates does not recompute/i,
  ],
  [
    "a falsified oldest_source",
    (item) => {
      item.derived.valuation_range_v1.source_clock.oldest_source = "benchmark_row";
    },
    /oldest_source .* does not recompute/i,
  ],
  [
    "an impossible calendar date in a clock",
    (item) => {
      const row = item.derived.valuation_range_v1.source_clock.contributing_sources
        .find((entry) => entry.source === "observed.price");
      row.as_of = "2026-02-31";
    },
    /source clock (omits|declares) .*observed\.price/i,
  ],
  [
    "an impossible collection date on the reconciliation route",
    (item) => {
      item.derived.legacy_payout_ratio_qa.coverage.index_yield_collected_at = "9999-99-99";
    },
    /not a valid UTC timestamp|payout_routes_reconciled|carries no usable calendar date/i,
  ],
  [
    "a collection time in the future",
    (item) => {
      item.derived.legacy_payout_ratio_qa.coverage.index_yield_collected_at = "2099-01-01T00:00:00Z";
    },
    /in the future|payout_routes_reconciled/i,
  ],
  [
    "a collection time beyond the provider delivery SLA",
    (item) => {
      item.derived.legacy_payout_ratio_qa.coverage.index_yield_collected_at = "2020-01-01T00:00:00Z";
    },
    /delivery SLA|payout_routes_reconciled/i,
  ],
  [
    "a collection clock that did not come from the same response",
    (item) => {
      item.derived.legacy_payout_ratio_qa.coverage.index_yield_provenance.same_response = false;
    },
    /same fetch-and-parse response|payout_routes_reconciled/i,
  ],
  [
    "an invented clock source that feeds nothing",
    (item) => {
      item.derived.valuation_range_v1.source_clock.contributing_sources.push({
        source: "invented.route", as_of: "2026-01-01", route: "main", kind: "source_as_of",
      });
    },
    /which is not a contributing route/i,
  ],
  [
    "a source-tier gate that survives a downgraded observed tier",
    (item) => {
      item.observed.equity_risk_premium.source_tier = "proxy_diagnostic";
    },
    /source_tier_satisfied/i,
  ],
  [
    "an operands gate that survives a terminal residual income turned negative",
    (item) => {
      item.derived.forecast_grid_v1.periods[2].residual_income_proxy.value = -10;
      item.derived.valuation_range_v1.operands.residual_income_by_period[2].value = -10;
    },
    /operands_complete/i,
  ],
]) {
  const mutated = JSON.parse(JSON.stringify(payload));
  mutate(mutated.indices.SPX);
  const result = validateRimIndexInputs(mutated);
  assert.equal(result.ok, false, `${label}: must be rejected`);
  assert.ok(
    result.errors.some((error) => expected.test(error)),
    `${label}: the error must name the defect, got: ${result.errors.join("; ")}`,
  );
}

// COHERENT-PAYLOAD REGRESSIONS. Every mutation above edits one field; a forger
// edits all of them. These rewrite the declared tuple, the derived clock fields,
// and the gate flags together so the payload stays internally consistent, and
// they must still be rejected -- by the reconciliation ROUTE POLICY, which reads
// the provider's own record of whether it published an observation date rather
// than the label the payload chose for itself.
{
  const coverageOf = (item) => item.derived.legacy_payout_ratio_qa.coverage;
  const clockOf = (item) => item.derived.valuation_range_v1.source_clock;
  const reconciliationRow = (item) => clockOf(item).contributing_sources.find((row) => row.route === "reconciliation");
  const recohere = (item) => {
    const clock = clockOf(item);
    clock.contributing_source_dates = clock.contributing_sources
      .filter((row) => typeof row.as_of === "string")
      .map((row) => row.as_of)
      .sort();
    clock.oldest_source = clock.contributing_sources.find((row) => typeof row.as_of === "string")?.source ?? null;
    clock.as_of = clock.contributing_source_dates[0] ?? null;
    item.derived.valuation_range_v1.as_of = clock.as_of;
  };

  for (const [label, mutate, expected] of [
    [
      "a fully coherent relabel of the collection clock as an observation date",
      (item) => {
        coverageOf(item).index_yield_provenance.clock_kind = "source_as_of";
        const row = reconciliationRow(item);
        row.kind = "source_as_of";
        delete row.reason;
      },
      /source clock|clock policy|clock_kind|source_as_of/i,
    ],
    [
      "a fabricated source date that leaves the no-source-date reason in place",
      (item) => {
        coverageOf(item).index_yield_as_of = "2026-07-14";
        coverageOf(item).index_yield_provenance.clock_kind = "source_as_of";
        reconciliationRow(item).kind = "source_as_of";
        recohere(item);
      },
      // Superseded by a stronger refusal: the provider cannot publish an
      // observation date at all, so the fabricated date is refused on capability
      // rather than on the leftover reason field.
      /does not publish|can only supply/i,
    ],
    [
      "the clock provenance block removed entirely",
      (item) => {
        delete coverageOf(item).index_yield_provenance;
        recohere(item);
      },
      /publishes no clock provenance|carries no usable calendar date/i,
    ],
  ]) {
    const mutated = JSON.parse(JSON.stringify(payload));
    mutate(mutated.indices.SPX);
    const result = validateRimIndexInputs(mutated);
    assert.equal(result.ok, false, `${label}: must be rejected`);
    assert.ok(
      result.errors.some((error) => expected.test(error)),
      `${label}: the error must name the defect, got: ${result.errors.join("; ")}`,
    );
  }

  // FULL-COHERENCE FORGERIES. Everything a payload can say about the
  // reconciliation clock is rewritten together: the source date, its reason, the
  // whole provenance block, the clock tuple, every derived clock field, and all
  // seven gate flags. No payload-internal cross-check can object, because they
  // are all the same mutable evidence. Only the code-side route capability
  // allowlist can refuse these, so each one asserts the provider-capability
  // error by name.
  const fullyCoherentRelabel = (item, fabricatedDate) => {
    const coverage = coverageOf(item);
    const range = item.derived.valuation_range_v1;
    const clock = clockOf(item);
    coverage.index_yield_as_of = fabricatedDate;
    coverage.index_yield_as_of_reason = null;
    coverage.index_yield_provenance = {
      same_response: true,
      source_file: "slickcharts/sp500-yield.json",
      clock_kind: "source_as_of",
      note: "observation date",
    };
    const row = reconciliationRow(item);
    row.kind = "source_as_of";
    row.as_of = fabricatedDate;
    delete row.reason;
    delete row.collection_age_hours;
    delete row.collection_sla_hours;
    row.clock_policy_failures = [];
    clock.contributing_sources.sort(
      (a, b) => String(a.as_of ?? "").localeCompare(String(b.as_of ?? "")) || a.source.localeCompare(b.source),
    );
    recohere(item);
    for (const gate of Object.values(range.gates)) {
      gate.passed = true;
      gate.reason = "";
    }
  };

  // `exclusive` marks the forgeries that are otherwise PERFECT, so the capability
  // rule must be the only thing wrong with them. The impossible-date forgery is
  // deliberately not exclusive: 2026-02-31 is also a broken calendar date, and
  // the calendar checks are entitled to say so.
  for (const [label, fabricatedDate, exclusive] of [
    ["a valid past date", "2026-07-14", true],
    ["a future date", "2099-01-01", true],
    ["an impossible date", "2026-02-31", false],
    ["today's date", "2026-08-01", true],
  ]) {
    const mutated = JSON.parse(JSON.stringify(payload));
    fullyCoherentRelabel(mutated.indices.SPX, fabricatedDate);
    const result = validateRimIndexInputs(mutated);
    assert.equal(result.ok, false, `fully coherent relabel with ${label}: must be rejected`);
    assert.ok(
      result.errors.some((error) => /does not publish|can only supply|cannot supply/i.test(error)),
      `fully coherent relabel with ${label}: the provider capability must be what refuses it,`
      + ` got: ${result.errors.join("; ")}`,
    );
    // EXCLUSIVITY. Every error must trace to the capability refusal -- either it
    // states the capability directly, or it is the clock/gate machinery
    // disagreeing with a payload BECAUSE the validator recomputed the route from
    // the capability. An error from any unrelated check would mean the forgery
    // was imperfect and the capability rule was never actually exercised.
    const capabilityRooted = /does not publish|can only supply|cannot supply|source clock|contributing_source_dates|oldest_source|source_clock_honest|payout_routes_reconciled|carries no usable calendar date|must state why/i;
    const unrelated = exclusive ? result.errors.filter((error) => !capabilityRooted.test(error)) : [];
    assert.equal(
      unrelated.length,
      0,
      `fully coherent relabel with ${label}: the forgery must be perfect apart from the capability claim,`
      + ` but these errors came from elsewhere: ${unrelated.join("; ")}`,
    );
  }

  // THE CONTROL. Same forgery, same rewritten derived fields and gate flags, but
  // WITHOUT the capability violation: the route keeps the kind its provider can
  // actually supply. This must VALIDATE. It is what makes the four cases above a
  // test of the capability rule rather than a test of the surrounding machinery.
  {
    const control = JSON.parse(JSON.stringify(payload));
    const item = control.indices.SPX;
    const clock = clockOf(item);
    clock.contributing_sources.sort(
      (a, b) => String(a.as_of ?? "").localeCompare(String(b.as_of ?? "")) || a.source.localeCompare(b.source),
    );
    recohere(item);
    for (const gate of Object.values(item.derived.valuation_range_v1.gates)) {
      gate.passed = true;
      gate.reason = "";
    }
    const controlResult = validateRimIndexInputs(control);
    assert.equal(
      controlResult.ok,
      true,
      `the capability-respecting control must validate, or the relabel tests prove nothing:`
      + ` ${controlResult.errors.join("; ")}`,
    );
  }

  // THE SURGICAL FORGER. Admits the clock gate failed, so every clock-side check
  // agrees with the payload, and lies about the payout gate alone. Only the gate
  // recomputation parity can catch this one, so it is asserted by name.
  for (const [label, collectedAt] of [
    ["an absent collection clock", null],
    ["a future collection clock", "2099-01-01T00:00:00Z"],
    ["a collection clock beyond the delivery SLA", "2020-01-01T00:00:00Z"],
    ["an impossible collection clock", "9999-99-99"],
  ]) {
    const mutated = JSON.parse(JSON.stringify(payload));
    const item = mutated.indices.SPX;
    const range = item.derived.valuation_range_v1;
    coverageOf(item).index_yield_collected_at = collectedAt;
    const row = reconciliationRow(item);
    row.as_of = null;
    row.clock_policy_failures = [];
    recohere(item);
    range.gates.source_clock_honest = { passed: false, reason: "clock unusable" };
    range.gates.payout_routes_reconciled = { passed: true, reason: "" };
    range.public_status = "blocked_no_range";
    range.range = { low: null, high: null };
    range.scenarios = [];
    const result = validateRimIndexInputs(mutated);
    assert.equal(result.ok, false, `${label}: must be rejected`);
    assert.ok(
      result.errors.some((error) => /payout_routes_reconciled is declared passed while the reconciliation/.test(error)),
      `${label}: the gate parity check must be the one that catches it, got: ${result.errors.join("; ")}`,
    );
  }
}

// The scenario arithmetic is shared by the builder and the validator, so the
// validator can recompute rather than trust. Pin it on numbers computed by hand.
{
  const values = computeRimScenarioValues({
    bookValueBeginning: 1000,
    residualIncome: [100, 100, 100],
    discountRate: 0.1,
    terminalGrowthLow: 0,
    terminalGrowthHigh: 0.02,
    fadeYears: 10,
  });
  // Explicit periods: 100/1.1 + 100/1.21 + 100/1.331 = 248.685...
  assert.ok(Math.abs(values.explicitPresentValue - 248.6852) < 0.001, `explicit PV ${values.explicitPresentValue}`);
  // Optimistic continuing value at fy3: 100 * 1.02 / (0.1 - 0.02) = 1275
  assert.ok(Math.abs(values.optimisticContinuingValue - 1275) < 0.001, `optimistic CV ${values.optimisticContinuingValue}`);
  assert.ok(values.conservative < values.optimistic, "the fade endpoint is the lower one when residual income is positive");
}

// The public mirror carries the range and still redacts. A range that only
// existed in the private artifact would be invisible to every reader.
const mirroredRange = buildPublicRimMirror(payload).indices?.SPX?.derived?.valuation_range_v1;
assert.ok(mirroredRange, "the public mirror carries the valuation range");
assert.equal(mirroredRange.public_status, "ready_range_no_single_target", "mirror keeps the range status");
for (const token of POINT_TARGET_TOKENS) {
  assert.equal(JSON.stringify(mirroredRange).includes(token), false, `mirror must not contain ${token}`);
}

// STRICT UTC IN THE PRODUCER, matching the consumer rule exactly.
for (const [value, expected] of [
  ["2026-08-01T06:41:24Z", "2026-08-01T06:41:24.000Z"],
  ["2026-07-14T15:05:37+00:00", "2026-07-14T15:05:37.000Z"],
  ["2026-07-14T15:05:37-00:00", "2026-07-14T15:05:37.000Z"],
  ["2026-08-01T06:41:24.921Z", "2026-08-01T06:41:24.921Z"],
  ["2026-08-01", null],
  ["2026-08-01T06:41:24", null],
  ["2026-07-14T15:05:37+09:00", null],
  ["2026-08-01T99:99:99Z", null],
  ["2026-02-31T00:00:00Z", null],
  ["2026-08-01 is when we think", null],
  ["", null],
  [null, null],
]) {
  assert.equal(
    canonicalUtcInstant(value),
    expected,
    `canonicalUtcInstant(${JSON.stringify(value)}) must be ${JSON.stringify(expected)}`,
  );
  assert.equal(parseUtcInstant(value) === null, expected === null, `parseUtcInstant agrees for ${JSON.stringify(value)}`);
}

// The published collection clock must already be canonical, with the provider's
// raw string preserved beside it.
for (const id of ["SPX", "NDX"]) {
  const coverage = payload.indices[id].derived.legacy_payout_ratio_qa.coverage;
  assert.match(
    coverage.index_yield_collected_at,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    `${id}: the published collection clock must be canonical UTC`,
  );
  assert.ok(coverage.index_yield_collected_at_provider, `${id}: the provider's raw timestamp is preserved`);
  assert.equal(
    canonicalUtcInstant(coverage.index_yield_collected_at_provider),
    coverage.index_yield_collected_at,
    `${id}: the canonical clock must be the provider's own instant, not a different one`,
  );
}

console.log("test-build-rim-index: ok");
