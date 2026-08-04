#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import { buildSustainableIndexRanges } from "./build-fenok-rim-sustainable-index-ranges.mjs";

const artifact = buildSustainableIndexRanges({ generatedAt: "2026-08-04T00:00:00.000Z" });
const deterministicReplay = buildSustainableIndexRanges({ generatedAt: "2026-08-04T00:00:00.000Z" });
assert.deepEqual(deterministicReplay, artifact);

assert.equal(artifact.generated_at, "2026-08-04T00:00:00.000Z");
assert.equal(artifact.runtime_contract.automatic_diagnostic_fallback_inputs_refreshable, true);
assert.equal(artifact.runtime_contract.exact_official_input_refresh_complete, false);
assert.equal(artifact.runtime_contract.future_yoo_values_required, false);
assert.equal(artifact.runtime_contract.runtime_yoo_value_injection, false);
assert.equal(artifact.runtime_contract.runtime_target_level_injection, false);
assert.equal(artifact.runtime_contract.frozen_historical_yoo_calibration_parameters_used, true);
assert.equal(artifact.runtime_contract.point_estimate, false);
assert.equal(artifact.status, "automatic_feno_house_fair_value_ranges_ready");
assert.equal(artifact.runtime_contract.output_type, "FENO_house_fair_value_range");
assert.equal(artifact.promotion_gate.status, "passed");
assert.equal(artifact.methodology.narrow_house_range_rule.promotion_status, "adopted_as_FENO_house_range_policy");
assert.equal(artifact.methodology.horizon_validation.selected_horizon, 9);
assert.ok(artifact.methodology.horizon_validation.selected_validation_mae_pp < 0.2);
assert.ok(artifact.methodology.horizon_validation.runner_up_validation_mae_pp > 6);
assert.deepEqual(artifact.rows.map((row) => row.id), ["SPX", "NDX", "KOSPI", "SOX", "CCMP", "RUT"]);
assert.deepEqual(artifact.coverage_safe_rows.map((row) => row.id), ["SPX", "NDX", "KOSPI", "SOX", "CCMP", "RUT"]);

for (const row of artifact.rows) {
  assert.equal(row.runtime_yoo_value_injection, false);
  assert.equal(row.production_promoted, true);
  assert.equal(row.publication_status, "RANGE");
  assert.ok(["inside_measured_domain", "extrapolated"].includes(row.model_domain.discount.status));
  assert.equal(row.input_freshness.status, "passed");
  assert.equal(row.value.point_estimate, null);
  assert.ok(Number.isFinite(row.value.current_price));
  assert.equal("center_diagnostic" in row.value, false);
  assert.ok(Number.isFinite(row.value.range.low));
  assert.ok(Number.isFinite(row.value.range.high));
}

assert.ok(artifact.rows.filter((row) => ["SPX", "NDX"].includes(row.id)).every((row) => row.confidence === "medium"));
assert.ok(artifact.rows.filter((row) => !["SPX", "NDX"].includes(row.id)).every((row) => row.confidence === "low"));
assert.deepEqual(Object.keys(artifact.methodology.feno_house_policy), [
  "starting_book",
  "payout",
  "risk_free",
  "erp",
  "lt_roe",
  "discount",
  "horizon_and_residual_value",
]);
assert.equal(artifact.rows.find((row) => row.id === "RUT").official_fundamentals.source.publisher, "LSEG FTSE Russell");
assert.ok(artifact.rows.find((row) => row.id === "CCMP").exact_input_limitations.includes("exact_COMP_weights_require_Nasdaq_entitlement"));
assert.ok(artifact.coverage_safe_rows.filter((row) => ["SPX", "NDX"].includes(row.id)).every((row) => row.point_estimate === null));
assert.ok(artifact.coverage_safe_rows.filter((row) => ["KOSPI", "SOX", "CCMP"].includes(row.id)).every((row) => row.status === "blocked"));
assert.equal(artifact.coverage_safe_rows.find((row) => row.id === "RUT").status, "diagnostic_only_date_mismatch_and_no_holdout");
assert.match(artifact.coverage_safe_rows.find((row) => row.id === "RUT").rule.input_shape, /not a preserved FY1-FY3 path/);

const packageJson = JSON.parse(fs.readFileSync(new URL("../100xfenok-next/package.json", import.meta.url), "utf8"));
const derivedReconcile = packageJson.scripts["reconcile:derived"];
const sustainableIndex = derivedReconcile.indexOf("npm run build:rim-sustainable-research");
const rimIndex = derivedReconcile.indexOf("npm run build:rim-index");
const etfActionIndex = derivedReconcile.indexOf("npm run build:fenok-etf-action-index");
assert.ok(sustainableIndex >= 0, "derived reconciliation must include the FENO house range builder");
assert.ok(rimIndex >= 0 && rimIndex < sustainableIndex, "RIM inputs must precede the FENO house ranges");
assert.ok(etfActionIndex >= 0 && etfActionIndex < sustainableIndex, "ETF action proxies must precede the FENO house ranges");
assert.match(
  packageJson.scripts["reconcile:verify"],
  /(?:^|&& )npm run qa:rim-sustainable-research(?: &&|$)/,
  "derived verification must gate the FENO house range artifact",
);

console.log("FENO sustainable index range artifact tests passed");
