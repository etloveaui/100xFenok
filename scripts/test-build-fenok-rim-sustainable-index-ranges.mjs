#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import { buildSustainableIndexRanges } from "./build-fenok-rim-sustainable-index-ranges.mjs";

const SCOPE = ["SPX", "NDX", "KOSPI", "SOX", "CCMP", "RUT"];
const options = { asOf: "2026-08-04", generatedAt: "2026-08-04T00:00:00.000Z" };
const artifact = buildSustainableIndexRanges(options);

assert.deepEqual(buildSustainableIndexRanges(options), artifact, "the artifact must be deterministic for a fixed as-of");
assert.equal(artifact.schema_version, "fenok_rim_sustainable_index_ranges.v2");
assert.equal(artifact.generated_at, "2026-08-04T00:00:00.000Z");
assert.deepEqual(artifact.scope, SCOPE);
assert.deepEqual(artifact.rows.map((row) => row.id), SCOPE);

assert.equal(artifact.runtime_contract.point_estimate, false);
assert.equal(artifact.runtime_contract.runtime_yoo_value_injection, false);
assert.equal(artifact.runtime_contract.runtime_target_level_injection, false);
assert.equal(artifact.runtime_contract.frozen_historical_yoo_calibration_parameters_used, true);
assert.equal(artifact.runtime_contract.output_type, "FENO_residual_value_range");

// Calibration receipts must travel with the artifact, not live only in prose.
const reproduced = artifact.calibration.structural_reproduction.instruments.filter((row) => row.status === "reproduced");
assert.ok(reproduced.length >= 2, "the artifact must carry the grid reproduction receipt");
for (const row of reproduced) assert.ok(row.rmse_pct_of_mean_fair_value < 0.005, `${row.instrument}: reproduction receipt out of tolerance`);
for (const row of artifact.calibration.book_identity) assert.ok(Math.abs(row.relative_error) < 0.0005, `${row.id}: book identity receipt out of tolerance`);
assert.ok(artifact.calibration.lt_roe_rule.refit.slope < 1, "the recorded LTROE slope must be a mean reversion");
assert.ok(artifact.calibration.published_upside_holdout.rows.length >= 7, "the hold-out receipt must list every scored anchor");
assert.equal(artifact.calibration.published_upside_holdout.feno_measured.informative_total, 2);

// Every published row exposes two lanes, no point estimate, and a receipt for
// each operand that is not read straight from a panel.
for (const row of artifact.rows) {
  assert.equal(row.runtime_yoo_value_injection, false);
  assert.ok(["RANGE", "NULL"].includes(row.publication_status));
  if (row.publication_status === "NULL") {
    assert.ok(row.blocking_reasons.length > 0, `${row.id}: a blocked row must name its blocker`);
    assert.equal(row.feno_measured, null);
    assert.equal(row.yoo_convention, null);
    continue;
  }
  assert.deepEqual(row.blocking_reasons, []);
  assert.equal(row.input_freshness.status, "passed");
  for (const lane of [row.feno_measured, row.yoo_convention]) {
    assert.equal(lane.point_estimate, null, `${row.id}: no lane may publish a point`);
    assert.ok(Number.isFinite(lane.range.low) && Number.isFinite(lane.range.high));
    assert.ok(lane.range.low <= lane.range.high, `${row.id}: endpoints must be ordered`);
    assert.ok(Number.isFinite(lane.upside.low) && Number.isFinite(lane.upside.high));
  }
  // The measured lane must be well posed; the Yoo lane is a diagnostic and may
  // be an amplifier, but it must say so.
  assert.notEqual(row.feno_measured.convexity.status, "amplifying", `${row.id}: the measured lane must not amplify`);
  assert.ok(["bounded", "convex", "amplifying"].includes(row.yoo_convention.convexity.status));
  assert.ok(row.growth_assumption_gap.ratio > 1, `${row.id}: Yoo's convention must be recorded as the faster book roll-forward`);
  assert.ok(row.source_notes.panel.includes("benchmarks"), `${row.id}: the panel source must be named`);
  assert.ok(row.source_notes.payout.length > 0, `${row.id}: the payout provenance must be named`);
}

// Identity separations that a merge must never quietly drop.
assert.ok(artifact.rows.find((row) => row.id === "SOX").source_notes.panel.includes("philadelphia_semi"));
assert.ok(artifact.rows.find((row) => row.id === "CCMP").source_notes.panel.includes("nasdaq_composite"));
assert.equal(artifact.rows.find((row) => row.id === "RUT").inputs.forward_roe_basis, "LSEG ex-negative earnings bridge");

// A stale panel must fail the row closed rather than publish a stale range.
const stale = buildSustainableIndexRanges({ asOf: "2026-08-04", generatedAt: "2027-01-01T00:00:00.000Z" });
assert.ok(stale.rows.every((row) => row.publication_status === "NULL"), "a year-old panel must block every row");
assert.equal(stale.status, "partial_six_index_coverage");

const packageJson = JSON.parse(fs.readFileSync(new URL("../100xfenok-next/package.json", import.meta.url), "utf8"));
const derived = packageJson.scripts["reconcile:derived"];
assert.ok(derived.indexOf("npm run build:rim-sustainable-research") > derived.indexOf("npm run build:rim-index"),
  "RIM inputs must precede the residual-value ranges");
assert.match(packageJson.scripts["qa:rim-sustainable-research"], /test-fenok-rim-yoo-panel-engine\.mjs/,
  "the panel engine suite must gate the artifact");
assert.match(packageJson.scripts["reconcile:verify"], /(?:^|&& )npm run qa:rim-sustainable-research(?: &&|$)/);

console.log("FENO RIM residual-value range artifact tests passed");
