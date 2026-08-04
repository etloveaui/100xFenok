#!/usr/bin/env node

// Index-only structural diagnostic over the verified 2025-12-09 54-cell grid.
// For each payout candidate, the book/scale is fitted simultaneously by least
// squares. The reported payout is only where fitted residuals have zero linear
// slope against ROE; it is not an identified payout or proof of the formula.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  gridAnchorsFromFixture,
  profileIdentifyBookFree,
  rimBracket,
  validateGridFixture,
} from "./analyze-fenok-rim-identifiability.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_PATH = "scripts/fixtures/fenok-rim-2025-12-09-grid.json";
const ANALYZER_PATH = "scripts/analyze-fenok-rim-identifiability.mjs";
const BAND_REGRESSION_PATH = "scripts/test-analyze-fenok-rim-identifiability.mjs";
const SELF_PATH = "scripts/build-fenok-rim-index-residual-roe-diagnostic.mjs";
const OUTPUT_PATH = "data/computed/fenok-rim/index-residual-roe-diagnostic.json";
const INSTRUMENTS = ["SPX", "CCMP", "IWM"];
const SCENARIOS = ["current", "3.5%"];
const CANONICAL_REFERENCE_BANDS = Object.freeze({
  SPX: [0.2225, 0.535],
  CCMP: [0.1225, 0.45],
});
const BAND_STEP = 0.0025;

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const round = (value, digits = 12) => {
  const scale = 10 ** digits;
  const rounded = Math.round(value * scale) / scale;
  return Object.is(rounded, -0) ? 0 : rounded;
};

function sourceHash(relativePath) {
  return { path: relativePath, sha256: sha256(fs.readFileSync(path.join(ROOT, relativePath))) };
}

function fail(message) {
  throw new Error(`index residual-ROE diagnostic invalid: ${message}`);
}

function exactPointCell(cell, label) {
  if (cell?.type !== undefined && cell.type !== "point") fail(`${label}: floor/range cells are not point values`);
  if (!Number.isFinite(cell?.fair_value) || !(cell.fair_value > 0)) fail(`${label}: missing finite point fair_value`);
  if (!Number.isFinite(cell?.lt_roe) || !Number.isFinite(cell?.risk_premium)) fail(`${label}: missing ROE or risk premium`);
  return {
    roe: cell.lt_roe,
    erp: cell.risk_premium,
    fair_value: cell.fair_value,
  };
}

export function validateDiagnosticFixture(fixture, { verifyArtifactBytes = false } = {}) {
  validateGridFixture(fixture);
  for (const instrument of INSTRUMENTS) {
    if (fixture.instruments[instrument]?.printed_payout !== null) {
      fail(`${instrument}: canonical fixture must preserve missing same-sheet payout`);
    }
    const artifact = fixture.artifacts?.[instrument];
    if (typeof artifact?.path !== "string" || !/^[a-f0-9]{64}$/.test(artifact?.sha256 ?? "")) {
      fail(`${instrument}: missing artifact path or sha256`);
    }
    if (verifyArtifactBytes) {
      const artifactPath = path.join(ROOT, artifact.path);
      if (!fs.existsSync(artifactPath)) fail(`${instrument}: artifact file missing`);
      if (sha256(fs.readFileSync(artifactPath)) !== artifact.sha256) fail(`${instrument}: artifact hash mismatch`);
    }
  }
  fixture.cells.forEach((cell, index) => exactPointCell(cell, `cell[${index}]`));
  return fixture;
}

export function solvePanelAtPayout(cells, riskFree, payout) {
  if (!Array.isArray(cells) || cells.length !== 9) fail("panel must contain exactly nine point cells");
  if (!Number.isFinite(riskFree) || !(riskFree > 0)) fail("panel risk-free rate missing");
  if (!Number.isFinite(payout) || payout < 0 || payout > 1) fail("payout must be in [0,1]");
  const rows = cells.map((cell, index) => {
    const point = exactPointCell(cell, `panel cell[${index}]`);
    return {
      ...point,
      coefficient: rimBracket({
        roe: point.roe,
        rf: riskFree,
        premium: point.erp,
        payout,
      }),
    };
  });
  const numerator = rows.reduce((sum, row) => sum + row.coefficient * row.fair_value, 0);
  const denominator = rows.reduce((sum, row) => sum + row.coefficient ** 2, 0);
  if (!(denominator > 0)) fail("simultaneous book denominator is non-positive");
  const book = numerator / denominator;
  const residuals = rows.map((row) => book * row.coefficient / row.fair_value - 1);
  const meanRoe = rows.reduce((sum, row) => sum + row.roe, 0) / rows.length;
  const meanResidual = residuals.reduce((sum, value) => sum + value, 0) / residuals.length;
  const slopeDenominator = rows.reduce((sum, row) => sum + (row.roe - meanRoe) ** 2, 0);
  if (!(slopeDenominator > 0)) fail("panel has no ROE variation");
  const slope = rows.reduce(
    (sum, row, index) => sum + (row.roe - meanRoe) * (residuals[index] - meanResidual),
    0,
  ) / slopeDenominator;
  const roeValues = rows.map((row) => row.roe);
  return {
    payout,
    simultaneously_fitted_book_or_scale: book,
    grid_rms: Math.sqrt(residuals.reduce((sum, value) => sum + value ** 2, 0) / residuals.length),
    max_abs_error: Math.max(...residuals.map(Math.abs)),
    residual_roe_slope: slope,
    residual_roe_span: slope * (Math.max(...roeValues) - Math.min(...roeValues)),
  };
}

export function findUniqueSignChangingRoot(evaluate, { lo = 0, hi = 1, scanSteps = 4096, iterations = 100 } = {}) {
  if (!(lo < hi) || !Number.isInteger(scanSteps) || scanSteps < 2) fail("invalid root scan interval");
  const brackets = [];
  let leftX = lo;
  let leftY = evaluate(leftX);
  if (!Number.isFinite(leftY)) fail("non-finite slope at root scan boundary");
  for (let step = 1; step <= scanSteps; step += 1) {
    const rightX = lo + ((hi - lo) * step) / scanSteps;
    const rightY = evaluate(rightX);
    if (!Number.isFinite(rightY)) fail("non-finite slope during root scan");
    if (leftY === 0) brackets.push([leftX, leftX]);
    else if (rightY === 0 || Math.sign(leftY) !== Math.sign(rightY)) brackets.push([leftX, rightX]);
    leftX = rightX;
    leftY = rightY;
  }
  const unique = brackets.filter((bracket, index) => (
    index === 0 || bracket[0] !== brackets[index - 1][1] || bracket[0] !== bracket[1]
  ));
  if (unique.length !== 1) fail(`expected one unique sign-changing root in [${lo},${hi}], found ${unique.length}`);
  let [left, right] = unique[0];
  if (left === right) return left;
  let leftValue = evaluate(left);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const mid = (left + right) / 2;
    const midValue = evaluate(mid);
    if (midValue === 0) return mid;
    if (Math.sign(leftValue) === Math.sign(midValue)) {
      left = mid;
      leftValue = midValue;
    } else {
      right = mid;
    }
  }
  return (left + right) / 2;
}

function admissiblePayoutBand(fixture, instrument) {
  if (instrument === "IWM") {
    return {
      status: "blocked",
      reason: "unit_coherent_book_unavailable",
      slope_not_robust_to_payout: null,
    };
  }
  const anchors = gridAnchorsFromFixture(fixture, instrument, fixture.rate_scenarios.current);
  const profile = profileIdentifyBookFree({
    anchors,
    roe: fixture.instruments[instrument].lt_roe_axis[1],
    rf: fixture.rate_scenarios.current,
    premium: fixture.instruments[instrument].erp_axis[1],
    payoutBand: [0, 0.6],
    payoutStep: BAND_STEP,
    rmsThreshold: 0.005,
  });
  if (!profile.feasible_payouts.length) return { status: "blocked", reason: "no_admissible_point_cell_band" };
  return {
    status: "measured_from_point_cells",
    method: "book_free_profile_rms_at_or_below_0.5_percent_on_0.25_percentage_point_grid",
    canonical_reference_band: CANONICAL_REFERENCE_BANDS[instrument],
    canonical_reference_source: BAND_REGRESSION_PATH,
    rederived_discrete_band: [profile.feasible_payouts[0], profile.feasible_payouts.at(-1)],
    allowed_reference_edge_difference: BAND_STEP,
  };
}

export function buildArtifact({ fixture = null } = {}) {
  const fixtureBytes = fs.readFileSync(path.join(ROOT, FIXTURE_PATH));
  const canonicalFixture = fixture ?? JSON.parse(fixtureBytes);
  validateDiagnosticFixture(canonicalFixture, { verifyArtifactBytes: fixture === null });
  const panels = [];
  const instruments = {};

  for (const instrument of INSTRUMENTS) {
    const roots = [];
    for (const scenario of SCENARIOS) {
      const cells = canonicalFixture.cells.filter(
        (cell) => cell.instrument === instrument && cell.scenario === scenario,
      );
      const riskFree = canonicalFixture.rate_scenarios[scenario];
      const root = findUniqueSignChangingRoot(
        (payout) => solvePanelAtPayout(cells, riskFree, payout).residual_roe_slope,
      );
      const solved = solvePanelAtPayout(cells, riskFree, root);
      roots.push(root);
      panels.push({
        instrument,
        scenario,
        risk_free: riskFree,
        point_cell_count: cells.length,
        payout_zero_slope_root: round(root),
        simultaneously_fitted_book_or_scale: round(solved.simultaneously_fitted_book_or_scale),
        simultaneously_fitted_book: instrument === "IWM"
          ? null
          : round(solved.simultaneously_fitted_book_or_scale),
        simultaneously_fitted_scale: instrument === "IWM"
          ? round(solved.simultaneously_fitted_book_or_scale)
          : null,
        book_interpretation: instrument === "IWM"
          ? "scale_only_not_unit_coherent_book"
          : "index_point_book_fitted_simultaneously_with_each_payout_candidate",
        grid_rms: round(solved.grid_rms),
        max_abs_error: round(solved.max_abs_error),
        residual_roe_slope: round(solved.residual_roe_slope),
        residual_roe_span: round(solved.residual_roe_span),
      });
    }
    const band = admissiblePayoutBand(canonicalFixture, instrument);
    if (band.status === "measured_from_point_cells") {
      const inside = roots.every(
        (root) => root >= band.canonical_reference_band[0] && root <= band.canonical_reference_band[1],
      );
      const edgesReproduce = band.canonical_reference_band.every(
        (edge, index) => Math.abs(edge - band.rederived_discrete_band[index]) <= BAND_STEP + 1e-12,
      );
      if (!edgesReproduce) fail(`${instrument}: canonical admissible payout band no longer rederives within one step`);
      band.reference_band_rederived_within_one_step = true;
      band.zero_slope_roots_inside_band = inside;
      band.slope_not_robust_to_payout = inside;
    }
    instruments[instrument] = {
      scenario_root_dispersion: round(Math.max(...roots) - Math.min(...roots)),
      admissible_payout_band_comparison: band,
      blockers: instrument === "IWM" ? ["unit_coherent_book_unavailable"] : [],
    };
  }

  return {
    schema_version: "fenok_rim_index_residual_roe_diagnostic.v1",
    source_date: canonicalFixture.artifacts.SPX.capture_date,
    scope: "verified_2025_12_09_index_fixture_only",
    status: "local_structural_diagnostic_only",
    production_eligible: false,
    identified_payout: false,
    formula_proof: false,
    point_cell_policy: {
      required_type: "point_fair_value",
      fixture_schema_implies_point_when_cell_type_is_absent: true,
      floors_ranges_and_missing_values_rejected: true,
    },
    method: {
      root: "unique sign-changing residual-versus-ROE slope root in payout interval [0,1]",
      simultaneous_book_fit: "at every payout candidate, fit one book/scale per nine-cell panel by least squares before calculating residual slope",
      residual: "simultaneously_fitted_book_or_scale * rim_bracket / printed_fair_value - 1",
      interpretation: "a local shape constraint only; it does not identify payout or prove the formula",
    },
    blocking_reasons: [
      "payout_not_printed_same_sheet",
      "zero_slope_is_in_sample_constraint",
      "book_basis_not_identified",
      "no_temporal_holdout",
    ],
    source_inputs: [
      { path: FIXTURE_PATH, sha256: fixture === null ? sha256(fixtureBytes) : null },
      ...INSTRUMENTS.map((instrument) => ({
        path: canonicalFixture.artifacts[instrument].path,
        sha256: canonicalFixture.artifacts[instrument].sha256,
      })),
      sourceHash(ANALYZER_PATH),
      sourceHash(BAND_REGRESSION_PATH),
      sourceHash(SELF_PATH),
    ],
    panels,
    instruments,
  };
}

function main() {
  const output = path.join(ROOT, OUTPUT_PATH);
  const artifact = buildArtifact();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`written: ${output}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
