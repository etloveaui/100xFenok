#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildArtifact,
  findUniqueSignChangingRoot,
  solvePanelAtPayout,
  validateDiagnosticFixture,
} from "./build-fenok-rim-index-residual-roe-diagnostic.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/fixtures/fenok-rim-2025-12-09-grid.json"), "utf8"));
const OUTPUT = path.join(ROOT, "data/computed/fenok-rim/index-residual-roe-diagnostic.json");
const digest = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

validateDiagnosticFixture(FIXTURE, { verifyArtifactBytes: true });
assert.equal(FIXTURE.cells.length, 54);

const artifact = buildArtifact();
assert.deepEqual(buildArtifact(), artifact, "builder must be deterministic");
assert.equal(artifact.status, "local_structural_diagnostic_only");
assert.equal(artifact.production_eligible, false);
assert.equal(artifact.identified_payout, false);
assert.equal(artifact.formula_proof, false);
assert.equal(artifact.panels.length, 6);
assert.ok(artifact.panels.every((panel) => panel.point_cell_count === 9));
for (const blocker of [
  "payout_not_printed_same_sheet",
  "zero_slope_is_in_sample_constraint",
  "book_basis_not_identified",
  "no_temporal_holdout",
]) assert.ok(artifact.blocking_reasons.includes(blocker));

const expectedRoots = {
  "SPX/current": 0.403984887455,
  "SPX/3.5%": 0.403659384007,
  "CCMP/current": 0.322057599461,
  "CCMP/3.5%": 0.321455008228,
  "IWM/current": 0.171107538284,
  "IWM/3.5%": 0.170147619177,
};
for (const panel of artifact.panels) {
  assert.equal(panel.payout_zero_slope_root, expectedRoots[`${panel.instrument}/${panel.scenario}`]);
  assert.ok(panel.simultaneously_fitted_book_or_scale > 0);
  if (panel.instrument === "IWM") {
    assert.equal(panel.simultaneously_fitted_book, null);
    assert.ok(panel.simultaneously_fitted_scale > 0);
  } else {
    assert.ok(panel.simultaneously_fitted_book > 0);
    assert.equal(panel.simultaneously_fitted_scale, null);
  }
  assert.ok(Math.abs(panel.residual_roe_slope) <= 1e-10);
  assert.ok(Math.abs(panel.residual_roe_span) <= 1e-10);
}

assert.deepEqual(artifact.instruments.SPX.admissible_payout_band_comparison.canonical_reference_band, [0.2225, 0.535]);
assert.deepEqual(artifact.instruments.SPX.admissible_payout_band_comparison.rederived_discrete_band, [0.225, 0.535]);
assert.deepEqual(artifact.instruments.CCMP.admissible_payout_band_comparison.canonical_reference_band, [0.1225, 0.45]);
assert.deepEqual(artifact.instruments.CCMP.admissible_payout_band_comparison.rederived_discrete_band, [0.1225, 0.4475]);
for (const instrument of ["SPX", "CCMP"]) {
  const comparison = artifact.instruments[instrument].admissible_payout_band_comparison;
  assert.equal(comparison.reference_band_rederived_within_one_step, true);
  assert.equal(comparison.zero_slope_roots_inside_band, true);
  assert.equal(comparison.slope_not_robust_to_payout, true);
}
assert.equal(artifact.instruments.IWM.admissible_payout_band_comparison.status, "blocked");
assert.equal(artifact.instruments.IWM.admissible_payout_band_comparison.reason, "unit_coherent_book_unavailable");
assert.ok(artifact.instruments.IWM.blockers.includes("unit_coherent_book_unavailable"));

for (const source of artifact.source_inputs) {
  assert.match(source.sha256, /^[a-f0-9]{64}$/, source.path);
  assert.equal(source.sha256, digest(fs.readFileSync(path.join(ROOT, source.path))), source.path);
}

const floorFixture = structuredClone(FIXTURE);
floorFixture.cells[0].type = "floor";
assert.throws(() => validateDiagnosticFixture(floorFixture), /floor\/range cells are not point values/);
const rangeFixture = structuredClone(FIXTURE);
rangeFixture.cells[0].type = "range";
rangeFixture.cells[0].fair_value = [6700, 6800];
assert.throws(() => validateDiagnosticFixture(rangeFixture), /floor\/range cells are not point values|fair value/);
const missingFixture = structuredClone(FIXTURE);
delete missingFixture.cells[0].fair_value;
assert.throws(() => validateDiagnosticFixture(missingFixture), /fair value|point fair_value/);
const unhashedFixture = structuredClone(FIXTURE);
delete unhashedFixture.artifacts.SPX.sha256;
assert.throws(() => validateDiagnosticFixture(unhashedFixture), /artifact|sha256/);

const canonicalPanel = FIXTURE.cells.filter((cell) => cell.instrument === "SPX" && cell.scenario === "current");
assert.throws(
  () => solvePanelAtPayout(canonicalPanel.map((cell) => ({ ...cell, type: "floor" })), 0.042, 0.4),
  /floor\/range cells are not point values/,
);
assert.throws(() => findUniqueSignChangingRoot(() => 1), /found 0/);
assert.throws(
  () => findUniqueSignChangingRoot((value) => Math.sin(6 * Math.PI * (value + 0.01))),
  /expected one unique sign-changing root/,
);

assert.deepEqual(
  JSON.parse(fs.readFileSync(OUTPUT, "utf8")),
  artifact,
  "committed diagnostic artifact must equal buildArtifact output",
);

console.log("build-fenok-rim-index-residual-roe-diagnostic tests passed");
