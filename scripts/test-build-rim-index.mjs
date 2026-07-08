#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildRimIndexInputs,
  parseArgs,
  validateRimIndexInputs,
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

function makeKr10yFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rim-index-"));
  for (const dir of ["benchmarks", "computed", "damodaran", "slickcharts", "yf"]) {
    fs.symlinkSync(path.join(dataRoot, dir), path.join(tempRoot, dir), "dir");
  }
  const macroPayload = readJson(path.join(dataRoot, "macro/fred-banking-daily.json"));
  macroPayload.series.IRLTLT01KRM156N = [
    { date: "2026-05-01", value: 3.25 },
    { date: "2026-06-01", value: 3.33 },
  ];
  writeJson(path.join(tempRoot, "macro/fred-banking-daily.json"), macroPayload);
  return tempRoot;
}

const payload = buildRimIndexInputs({
  generatedAt: "2026-07-08T00:00:00.000Z",
});
const validation = validateRimIndexInputs(payload);

assert.equal(validation.ok, true, validation.errors.join("\n"));
assert.equal(payload.schema_version, "rim_index_inputs.v1");
assert.equal(payload.output_scope, "inputs_only_no_fair_value");
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
      rowIndex === 0 ? "source_anchored" : "compounded_derived",
      `${id}: source confidence`,
    );
    assert.equal(row.earnings_proxy.source_tier, "derived_formula", `${id}: earnings proxy tier`);
    assert.equal(row.book_value_ending.source_tier, "derived_formula", `${id}: book value ending tier`);
    assert.equal(row.pe_ratio.source_tier, "derived_formula", `${id}: PE tier`);
    assert.equal(row.peg_ratio.source_tier, "derived_formula", `${id}: PEG tier`);
    assert.equal(row.peg_ratio.formula, "pe_ratio / (derived.explicit_eps_growth_3y * 100)", `${id}: PEG formula`);
    assert.ok(row.peg_ratio.sources.includes("derived.explicit_eps_growth_3y"), `${id}: PEG canonical source`);
    assert.notEqual(row.residual_income_proxy.value, null, `${id}: residual income proxy value`);
  }
}

assert.equal(payload.indices.CCMP.role, "secondary_input_only");
assert.ok(payload.indices.CCMP.blockers.some((blocker) => blocker.code === "missing_named_constituent_weight_path"));

assert.equal(payload.indices.KOSPI.role, "backlog_blocked");
assert.equal(payload.indices.KOSPI.observed.risk_free_rate.source_tier, "blocked_not_wired");
assert.notEqual(payload.indices.KOSPI.observed.risk_free_rate.source, "macro/fred-banking-daily.json");
assert.doesNotMatch(String(payload.indices.KOSPI.observed.risk_free_rate.source_field ?? ""), /DGS10/);
assert.ok(payload.indices.KOSPI.blockers.some((blocker) => blocker.code === "missing_kospi_constituent_weight_path"));
assert.equal(payload.coverage_diagnostics.stock_action.KOSPI.kospi_index_weight_rows, 0);
assert.ok(payload.coverage_diagnostics.stock_action.KOSPI.forward_eps_fy1_fy3_rows > 0);
assert.equal(payload.coverage_diagnostics.stock_action.KOSPI.public_status, "blocked_missing_kospi_index_weights");

const fixtureRoot = makeKr10yFixture();
try {
  const payloadWithKr10y = buildRimIndexInputs({
    dataRootOverride: fixtureRoot,
    generatedAt: "2026-07-08T00:00:00.000Z",
  });
  const kospiRiskFree = payloadWithKr10y.indices.KOSPI.observed.risk_free_rate;
  assert.equal(kospiRiskFree.source_tier, "observed_source");
  assert.equal(kospiRiskFree.source, "macro/fred-banking-daily.json");
  assert.equal(kospiRiskFree.source_field, "series.IRLTLT01KRM156N[-1].value / 100");
  assert.equal(kospiRiskFree.value, 0.0333);
  assert.ok(!payloadWithKr10y.indices.KOSPI.blockers.some((blocker) => blocker.code === "country_risk_free_source_solved_not_wired"));
  assert.ok(payloadWithKr10y.indices.KOSPI.blockers.some((blocker) => blocker.code === "missing_kospi_constituent_weight_path"));
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

assert.equal(payload.indices.SOX.role, "backlog_blocked");
assert.ok(
  payload.indices.SOX.blockers.some((blocker) => blocker.code === "identity_mapping_philadelphia_semi_to_sox_unverified"),
);
assert.ok(payload.indices.SOX.blockers.some((blocker) => blocker.code === "missing_sox_constituent_weight_path"));

const publicText = JSON.stringify(payload);
assert.equal(publicText.includes('"fair_value"'), false);
assert.equal(publicText.includes('"target_price"'), false);

assert.deepEqual(parseArgs(["--check", "--min-covered-weight", "0.8"]).check, true);

console.log("test-build-rim-index: ok");
