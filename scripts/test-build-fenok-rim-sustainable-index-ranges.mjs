#!/usr/bin/env node

import assert from "node:assert/strict";
import { buildSustainableIndexRanges } from "./build-fenok-rim-sustainable-index-ranges.mjs";

const artifact = buildSustainableIndexRanges({ generatedAt: "2026-08-04T00:00:00.000Z" });

assert.equal(artifact.generated_at, "2026-08-04T00:00:00.000Z");
assert.equal(artifact.runtime_contract.automatic_diagnostic_fallback_inputs_refreshable, true);
assert.equal(artifact.runtime_contract.exact_official_input_refresh_complete, false);
assert.equal(artifact.runtime_contract.future_yoo_values_required, false);
assert.equal(artifact.runtime_contract.runtime_yoo_value_injection, false);
assert.equal(artifact.runtime_contract.runtime_target_level_injection, false);
assert.equal(artifact.runtime_contract.frozen_historical_yoo_calibration_parameters_used, true);
assert.equal(artifact.runtime_contract.point_estimate, false);
assert.equal(artifact.methodology.horizon_validation.selected_horizon, 9);
assert.ok(artifact.methodology.horizon_validation.selected_validation_mae_pp < 0.2);
assert.ok(artifact.methodology.horizon_validation.runner_up_validation_mae_pp > 6);
assert.deepEqual(artifact.rows.map((row) => row.id), ["SPX", "NDX", "KOSPI", "SOX", "CCMP", "RUT"]);
assert.deepEqual(artifact.coverage_safe_rows.map((row) => row.id), ["SPX", "NDX", "KOSPI", "SOX", "CCMP", "RUT"]);

for (const row of artifact.rows) {
  assert.equal(row.runtime_yoo_value_injection, false);
  assert.equal(row.production_promoted, false);
  assert.equal(row.value.point_estimate, null);
  assert.ok(Number.isFinite(row.value.current_price));
  assert.ok(Number.isFinite(row.value.center_diagnostic));
  assert.ok(row.value.range.low <= row.value.center_diagnostic);
  assert.ok(row.value.center_diagnostic <= row.value.range.high);
}

assert.ok(artifact.rows.filter((row) => ["SPX", "NDX"].includes(row.id)).every((row) => row.confidence === "medium"));
assert.ok(artifact.rows.filter((row) => !["SPX", "NDX"].includes(row.id)).every((row) => row.confidence === "low"));
assert.equal(artifact.rows.find((row) => row.id === "RUT").official_fundamentals.source.publisher, "LSEG FTSE Russell");
assert.ok(artifact.rows.find((row) => row.id === "CCMP").promotion_blockers.includes("exact_COMP_weights_require_Nasdaq_entitlement"));
assert.ok(artifact.coverage_safe_rows.filter((row) => ["SPX", "NDX"].includes(row.id)).every((row) => row.point_estimate === null));
assert.ok(artifact.coverage_safe_rows.filter((row) => ["KOSPI", "SOX", "CCMP"].includes(row.id)).every((row) => row.status === "blocked"));
assert.equal(artifact.coverage_safe_rows.find((row) => row.id === "RUT").status, "diagnostic_only_date_mismatch_and_no_holdout");
assert.match(artifact.coverage_safe_rows.find((row) => row.id === "RUT").rule.input_shape, /not a preserved FY1-FY3 path/);

console.log("FENO sustainable index range artifact tests passed");
