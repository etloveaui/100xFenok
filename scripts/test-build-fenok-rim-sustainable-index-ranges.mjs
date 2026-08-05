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
assert.equal(artifact.runtime_contract.output_type, "FENO_residual_value_research_diagnostic");

// Calibration receipts must travel with the artifact, not live only in prose.
const reproduced = artifact.calibration.structural_reproduction.instruments.filter((row) => row.status === "reproduced");
assert.ok(reproduced.length >= 2, "the artifact must carry the grid reproduction receipt");
for (const row of reproduced) assert.ok(row.rmse_pct_of_mean_fair_value < 0.005, `${row.instrument}: reproduction receipt out of tolerance`);
for (const row of artifact.calibration.book_identity) assert.ok(Math.abs(row.relative_error) < 0.0005, `${row.id}: book identity receipt out of tolerance`);
assert.ok(artifact.calibration.lt_roe_rule.refit.gap_coefficient > 0, "the recorded gap coefficient must be positive");
assert.ok(artifact.calibration.lt_roe_rule.refit.max_abs_residual_pp < 4,
  "the LTROE fit must hold every observation inside four percentage points");
const payoutRefit = artifact.calibration.payout_multiplier.refit;
assert.equal(payoutRefit.rows.length, 3, "the payout multiplier receipt must carry all three known payouts");
assert.ok(payoutRefit.low > 1 && payoutRefit.high < 2.5, "the payout multiplier must stay in its measured band");
const share = artifact.calibration.lt_roe_rule.refit.stock_gap_share;
assert.ok(share.low > 0.6 && share.high < 0.8, "the printed stock gap share must stay in its measured 0.62~0.76 band");
assert.ok(artifact.calibration.lt_roe_rule.refit.observations.some((row) => row.id.startsWith("KOSPI")),
  "Korea must be a fitted observation rather than a US extrapolation");
assert.ok(artifact.calibration.published_upside_holdout.rows.length >= 7, "the hold-out receipt must list every scored anchor");
// An anchor used to fit a parameter cannot also evaluate it. Both inverted
// claims must be reported as in-sample and excluded from the score.
const holdout = artifact.calibration.published_upside_holdout;
assert.equal(holdout.feno.in_sample, 2);
for (const row of holdout.rows) {
  const fitted = holdout.fit_anchor_ids.includes(`${row.id}@${row.date}`);
  assert.equal(row.used_for_fitting, fitted, `${row.id}@${row.date}: fit membership must be declared`);
}
assert.equal(
  holdout.rows.filter((row) => !row.used_for_fitting).length,
  holdout.feno.total,
  "the evaluation total must count only rows outside the fit set",
);

// Promotion is gated on what the run measured, not on freshness alone. While a
// blocker stands nothing may be published as a usable range.
assert.equal(artifact.promotion.promoted, holdout.feno.informative_total > 0 && artifact.promotion.blockers.length === 0);
if (artifact.promotion.blockers.length) {
  assert.equal(artifact.status, "research_diagnostic_not_promoted");
  assert.ok(artifact.rows.every((row) => row.publication_status !== "RANGE"),
    "no row may claim RANGE while a promotion blocker stands");
  for (const blocker of artifact.promotion.blockers) {
    assert.ok(blocker.id && blocker.detail, "every blocker must name itself and say what it measured");
  }
}
// The blocker that matters most: no two-sided claim survives outside the fit.
assert.ok(
  artifact.promotion.blockers.some((row) => row.id === "no_discriminating_out_of_sample_anchor")
    || holdout.feno.informative_total > 0,
  "a run with no two-sided evaluation anchor must say so",
);
assert.equal(artifact.calibration.feno_rule.version, "feno-rim-residual-value/1");

// Every published row exposes two lanes, no point estimate, and a receipt for
// each operand that is not read straight from a panel.
for (const row of artifact.rows) {
  assert.equal(row.runtime_yoo_value_injection, false);
  assert.ok(["RESEARCH_DIAGNOSTIC", "RANGE", "NULL"].includes(row.publication_status));
  if (row.publication_status === "NULL") {
    assert.ok(row.blocking_reasons.length > 0, `${row.id}: a blocked row must name its blocker`);
    assert.equal(row.value, null);
    assert.equal(row.measured_growth_diagnostic, null);
    continue;
  }
  assert.deepEqual(row.blocking_reasons, []);
  assert.equal(row.input_freshness.status, "passed");
  assert.equal(row.publication_status, "RESEARCH_DIAGNOSTIC");
  for (const lane of [row.value, row.measured_growth_diagnostic]) {
    assert.equal(lane.point_estimate, null, `${row.id}: no lane may publish a point`);
    assert.ok(Number.isFinite(lane.range.low) && Number.isFinite(lane.range.high));
    assert.ok(lane.range.low <= lane.range.high, `${row.id}: endpoints must be ordered`);
    assert.ok(Number.isFinite(lane.upside.low) && Number.isFinite(lane.upside.high));
  }
  // Convexity is disclosed on every row rather than silently corrected, and an
  // amplifying row must appear in the promotion blockers.
  assert.ok(["bounded", "convex", "amplifying"].includes(row.value.convexity.status), `${row.id}: convexity must be disclosed`);
  if (row.value.convexity.status === "amplifying") {
    assert.ok(artifact.promotion.blockers.some((entry) => entry.id === "amplifying_convexity"),
      `${row.id}: an amplifying row must block promotion`);
  }
  assert.ok(Math.abs(row.value.book_growth - row.inputs.lt_roe_centre * row.inputs.retention) < 1e-12,
    `${row.id}: published growth must be Yoo's own roll-forward`);
  assert.ok(["bounded", "convex", "amplifying"].includes(row.measured_growth_diagnostic.convexity.status));
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
assert.ok(["partial_six_index_coverage", "research_diagnostic_not_promoted"].includes(stale.status));

const packageJson = JSON.parse(fs.readFileSync(new URL("../100xfenok-next/package.json", import.meta.url), "utf8"));
const derived = packageJson.scripts["reconcile:derived"];
assert.ok(derived.indexOf("npm run build:rim-sustainable-research") > derived.indexOf("npm run build:rim-index"),
  "RIM inputs must precede the residual-value ranges");
assert.match(packageJson.scripts["qa:rim-sustainable-research"], /test-fenok-rim-yoo-panel-engine\.mjs/,
  "the panel engine suite must gate the artifact");
assert.match(packageJson.scripts["reconcile:verify"], /(?:^|&& )npm run qa:rim-sustainable-research(?: &&|$)/);

console.log("FENO RIM residual-value range artifact tests passed");
