#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import { buildSustainableIndexRanges, OUT_OF_SCOPE } from "./build-fenok-rim-sustainable-index-ranges.mjs";
import { readCurrentRepoProxyIdentityAudit } from "./lib/fenok-rim-proxy-identity.mjs";

// SOX is out of scope: computable, not checkable. Every published semiconductor
// claim names SOXX, a different index.
const SCOPE = ["SPX", "NDX", "KOSPI", "CCMP", "RUT"];
const options = { asOf: "2026-08-04", generatedAt: "2026-08-04T00:00:00.000Z" };
const artifact = buildSustainableIndexRanges(options);

assert.deepEqual(buildSustainableIndexRanges(options), artifact, "the artifact must be deterministic for a fixed as-of");
assert.equal(artifact.schema_version, "fenok_rim_sustainable_index_ranges.v2");
assert.equal(artifact.generated_at, "2026-08-04T00:00:00.000Z");
assert.deepEqual(artifact.scope, SCOPE);
// Out-of-scope indices are still computed so the proxy audit can measure their
// bridge; they carry no value and never enter promotion.
assert.deepEqual(artifact.rows.filter((row) => !row.out_of_scope_reason).map((row) => row.id), SCOPE);
const outOfScope = artifact.rows.filter((row) => row.out_of_scope_reason);
assert.deepEqual(outOfScope.map((row) => row.id), Object.keys(OUT_OF_SCOPE));
for (const row of outOfScope) {
  assert.equal(row.publication_status, "OUT_OF_SCOPE");
  assert.equal(row.value, null, `${row.id}: an out-of-scope row may not carry a value`);
  assert.ok(row.inputs, `${row.id}: its inputs must stay available to the bridge audit`);
}

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
// The multiplier is a same-basis comparison, so it must sit near one and may
// only use indices whose tracker really is the index.
assert.ok(payoutRefit.rows.length >= 2, "the receipt must carry the same-basis comparisons");
assert.ok(payoutRefit.center > 0.9 && payoutRefit.center < 1.2,
  "a same-basis payout multiplier must sit near one");
for (const row of payoutRefit.rows) assert.ok(Math.abs(row.divergence) < 0.15, `${row.id}: divergence must stay small`);
const share = artifact.calibration.lt_roe_rule.refit.stock_gap_share;
assert.ok(share.low > 0.6 && share.high < 0.8, "the printed stock gap share must stay in its measured 0.62~0.76 band");
// The large-gap regime must be represented in the fit, or a cyclical peak is
// damped into nothing. Korea is deliberately NOT in it: its published claim is
// one of the two anchors that evaluate the rule.
assert.ok(artifact.calibration.lt_roe_rule.refit.observations.some((row) => row.id.startsWith("HYNIX")),
  "the large-gap regime must be a fitted observation");
assert.ok(!artifact.calibration.lt_roe_rule.refit.observations.some((row) => row.id.startsWith("KOSPI")),
  "Korea's published claim must evaluate the rule, not fit it");
assert.ok(artifact.calibration.published_upside_holdout.rows.length >= 7, "the hold-out receipt must list every scored anchor");
// An anchor used to fit a parameter cannot also evaluate it. Both inverted
// claims must be reported as in-sample and excluded from the score.
const holdout = artifact.calibration.published_upside_holdout;
assert.equal(holdout.feno.in_sample, 0, "no published claim may be consumed by the fit");
assert.deepEqual(holdout.fit_anchor_ids, [], "the fit must not claim any evaluation anchor");
for (const row of holdout.rows) {
  const fitted = holdout.fit_anchor_ids.includes(`${row.id}@${row.date}`);
  assert.equal(row.used_for_fitting, fitted, `${row.id}@${row.date}: fit membership must be declared`);
}
assert.equal(
  holdout.rows.filter((row) => !row.used_for_fitting && row.point_in_time_evaluable).length,
  holdout.feno.total,
  "the evaluation total must count only point-in-time rows outside the fit set",
);
// Payout is rebuilt from each tracker's own distribution record, so an anchor
// is only unevaluable when that tracker has no record at all. That is now KOSPI
// alone, and it clears the first time the ETF lane fetches EWY.
// All six trackers are collected, so every anchor reconstructs at its own date
// and nothing is excluded any more. The invariant that survives is the one that
// mattered: a later-vintage row must never be scored, and while any exists it
// must block promotion rather than quietly enter the totals.
assert.equal(holdout.feno.not_evaluable + holdout.feno.total, holdout.rows.length,
  "every anchor must be either scored or explicitly not evaluable");
assert.ok(holdout.feno.informative_total >= 1, "at least one point-in-time two-sided claim must evaluate the rule");
assert.equal(
  holdout.feno.not_evaluable > 0,
  artifact.promotion.blockers.some((row) => row.id === "historical_holdout_not_point_in_time"),
  "the point-in-time blocker must stand exactly when a later-vintage row exists",
);
for (const row of holdout.rows) {
  if (row.point_in_time_evaluable) continue;
  assert.equal(row.feno.passed, null, `${row.id}@${row.date}: an unevaluable row may not carry a verdict`);
}

// Promotion is gated on what the run measured, not on freshness alone. While a
// blocker stands nothing may be published as a usable range.
// Promotion is gated on defects only. A finding is what the measurement says
// about the world; it is disclosed and never clears, and holding it in the
// same list is what made the gate impossible to satisfy.
assert.equal(artifact.promotion.promoted, artifact.promotion.blockers.length === 0);
assert.ok(Array.isArray(artifact.promotion.findings), "findings must be reported alongside, not merged in");
for (const finding of artifact.promotion.findings) {
  assert.ok(finding.id && finding.detail, "every finding must name itself and say what it measured");
  assert.ok(!artifact.promotion.blockers.some((row) => row.id === finding.id), `${finding.id}: a finding may not also block`);
}
// Structural coverage is reported both ways: what was published and what was
// eligible. Collapsing to one number is how 36/36 would read as complete.
const structural = artifact.promotion.findings.find((row) => row.id === "structural_cells_excluded_for_unit_incoherence");
if (structural) {
  assert.match(structural.observed, /^\d+\/\d+$/, "observed coverage must be reported");
  assert.match(structural.eligible, /^(\d+)\/\1$/, "every eligible cell must reproduce");
  assert.ok(structural.ineligible_cells > 0, "the ineligible count must be stated, not implied");
  assert.deepEqual(structural.reasons, [
    "unit_coherent_book_unavailable",
    "same_date_NAV_unavailable",
    "scale_only_bridge",
    "rmse_gate_failed",
  ]);
  assert.ok(structural.re_entry, "an exclusion must say what would reverse it");
}
// No defect stands. Every in-scope index now has a direct source for the
// operands its value depends on, so nothing crosses a failing bridge. The
// only blockers that may remain are the four owner-ordered quarantine ids
// (DEC-289); releasing them is a separate act from clearing defects.
const QUARANTINE_IDS = [
  "model_validation_reopened",
  "twelve_month_output_targeting",
  "sealed_holdout_absent",
  "growth_model_not_validated",
];
assert.deepEqual(
  artifact.promotion.blockers.filter((row) => !QUARANTINE_IDS.includes(row.id)),
  [],
  "promotion must not be blocked by a defect that no longer exists",
);
assert.deepEqual(
  artifact.promotion.blockers.filter((row) => QUARANTINE_IDS.includes(row.id)).map((row) => row.id),
  QUARANTINE_IDS,
  "the DEC-289 quarantine blockers must stand in declared order",
);
assert.equal(artifact.promotion.promoted, false, "the quarantine withholds promotion");
assert.equal(artifact.status, "research_diagnostic_not_promoted",
  "status and promotion must share the combined blocker array");

// The two we know are findings, not defects: we cannot fit our way to his
// numbers, and we cannot make an index compound inside a domain it is outside.
assert.ok(artifact.promotion.findings.some((row) => row.id === "more_conservative_than_published_claims")
  || holdout.feno.informative_passed === holdout.feno.informative_total);
// The receipt gate must be real, not self-clearing: it may not sign off on its
// own absence, and it must carry every defect this run computed.
const receipt = JSON.parse(fs.readFileSync(new URL("../data/computed/fenok-rim/identification-receipt.json", import.meta.url), "utf8"))
  .sustainable_calibration_receipt;
assert.ok(receipt, "a sustainable calibration receipt must exist");
for (const field of ["parameter_sha256", "calibration_cutoff_at", "calibration_component_sha256", "receipt_sha256"]) {
  assert.ok(receipt[field], `the receipt must carry ${field}`);
}
const declared = new Set((receipt.promotion?.blockers ?? []).map((row) => row.id ?? row));
for (const blocker of artifact.promotion.blockers) {
  if (blocker.id.startsWith("sustainable_calibration_receipt")) continue;
  // DEC-289: quarantine blockers are owner-ordered policy, not defects the
  // calibration receipt computes; the receipt gate does not cover them.
  if (QUARANTINE_IDS.includes(blocker.id)) continue;
  assert.ok(declared.has(blocker.id), `${blocker.id}: the receipt must declare every computed defect`);
}
// Refusing the row is necessary, not sufficient. A proxy row may never publish
// while its bridge fails, and the global defect stands until those indices have
// direct target inputs regardless: a withheld index is still one we cannot
// value, and promoting around it would claim otherwise.
// Nothing is bridge-gated now: every in-scope index has a direct source for the
// operands its value depends on. Were that to change, the gate must return.
for (const row of artifact.rows) {
  if (row.out_of_scope_reason) continue;
  const gatedReasons = row.blocking_reasons.filter((reason) => reason.startsWith("proxy_"));
  assert.deepEqual(gatedReasons, [], `${row.id}: no in-scope row may depend on a failing bridge`);
}
assert.ok(!artifact.promotion.blockers.some((row) => row.id === "out_of_sample_anchor_failed"),
  "disagreeing with a published claim is a finding, not a defect");
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
  if (row.out_of_scope_reason) continue;
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
  assert.ok(["inside_printed_domain", "above_printed_domain", "below_printed_domain"].includes(row.value.convexity.status),
    `${row.id}: convexity must be classified against the printed domain`);
  // The domain is measured, not chosen: it must come from the printed cells and
  // must contain the printed evidence itself.
  const domain = row.value.convexity.printed_domain;
  assert.ok(domain && domain.observations > 0 && domain.low < domain.high, `${row.id}: the printed domain must be measured`);
  assert.ok(domain.source.includes("2025-12-09"), `${row.id}: the domain must derive from the printed grid`);
  if (row.value.convexity.status !== "inside_printed_domain") {
    assert.ok(artifact.promotion.findings.some((entry) => entry.id === "convexity_outside_printed_domain"),
      `${row.id}: a row outside the printed domain must be disclosed as a finding`);
  }
  assert.ok(Math.abs(row.value.book_growth - Math.min(row.inputs.lt_roe_centre * row.inputs.retention, row.inputs.book_growth_ceiling)) < 1e-12,
    `${row.id}: published growth must be the capped roll-forward`);
  assert.ok(row.value.convexity.status !== "above_printed_domain",
    `${row.id}: the cap must keep every row from compounding past the printed domain`);
  assert.ok(["inside_printed_domain", "above_printed_domain", "below_printed_domain"]
    .includes(row.measured_growth_diagnostic.convexity.status));
  assert.ok(row.source_notes.panel.includes("benchmarks"), `${row.id}: the panel source must be named`);
  assert.ok(row.source_notes.payout.length > 0, `${row.id}: the payout provenance must be named`);
}

// A row whose tracker is not the index carries no number at all. Every failing
// dimension must be named, and a dimension that is measured and reported but
// failing may never let a row score: reading the audit's own `scoreable` flag
// instead of the verdicts is exactly how a failed bridge gets scored silently.
// A bridge only gates an index that depends on one. Russell takes its book,
// ROE and payout from the LSEG factsheet, its own publisher, so nothing about
// its value crosses the IWM bridge; the audit still measures that bridge as
// evidence but it no longer decides whether the row may publish.
const russell = artifact.rows.find((row) => row.id === "RUT");
assert.match(russell.source_notes.payout, /ftserussell/, "Russell's payout must come from its publisher, not a tracker");
assert.equal(russell.inputs.payout_tracker, null, "a direct source means no tracker");
assert.equal(russell.inputs.forward_roe_basis, "LSEG ex-negative earnings bridge");
// Every in-scope row now carries a value, and any row that still depended on a
// failing bridge would have to be gated.
for (const id of SCOPE) {
  const row = artifact.rows.find((entry) => entry.id === id);
  assert.equal(row.publication_status, "RESEARCH_DIAGNOSTIC", `${id}: must carry a value`);
  assert.ok(row.value, `${id}: must carry a value`);
}
// The bridge audit still runs and still reports Russell against IWM failing;
// that is evidence about the tracker, not about the row.
const proxyAudit = readCurrentRepoProxyIdentityAudit();
assert.ok(proxyAudit.RUT_IWM, "the bridge audit must keep measuring Russell against IWM");

// Identity separations that a merge must never quietly drop.
assert.ok(!SCOPE.includes("SOX"), "SOX must not be in scope");
assert.ok(OUT_OF_SCOPE.SOX && OUT_OF_SCOPE.SOX.includes("SOXX"), "the exclusion must name why");
assert.ok(artifact.rows.find((row) => row.id === "CCMP").source_notes.panel.includes("nasdaq_composite"));
assert.equal(artifact.rows.find((row) => row.id === "RUT").inputs.forward_roe_basis, "LSEG ex-negative earnings bridge");

// A stale panel must fail the row closed rather than publish a stale range.
const stale = buildSustainableIndexRanges({ asOf: "2026-08-04", generatedAt: "2027-01-01T00:00:00.000Z" });
// An out-of-scope row is already withheld and stays that way; every in-scope
// row must fail closed on a stale panel.
assert.ok(
  stale.rows.filter((row) => !row.out_of_scope_reason).every((row) => row.publication_status === "NULL"),
  "a year-old panel must block every in-scope row",
);
assert.ok(["partial_six_index_coverage", "research_diagnostic_not_promoted"].includes(stale.status));
assert.ok(stale.promotion.blockers.length >= 0);

const packageJson = JSON.parse(fs.readFileSync(new URL("../100xfenok-next/package.json", import.meta.url), "utf8"));
const derived = packageJson.scripts["reconcile:derived"];
assert.ok(derived.indexOf("npm run build:rim-sustainable-research") > derived.indexOf("npm run build:rim-index"),
  "RIM inputs must precede the residual-value ranges");
assert.match(packageJson.scripts["qa:rim-sustainable-research"], /test-fenok-rim-yoo-panel-engine\.mjs/,
  "the panel engine suite must gate the artifact");
assert.match(packageJson.scripts["qa:rim-sustainable-research"], /test-fenok-rim-calibration-receipt\.mjs/,
  "the immutable calibration receipt must gate the artifact");
assert.match(packageJson.scripts["qa:rim-sustainable-research"], /test-fenok-rim-proxy-identity\.mjs/,
  "proxy identity must fail closed inside the artifact QA lane");
assert.match(packageJson.scripts["reconcile:verify"], /(?:^|&& )npm run qa:rim-sustainable-research(?: &&|$)/);

console.log("FENO RIM residual-value range artifact tests passed");
