#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTemporalReceipt,
  compareCalibrationReceiptIdentity,
  findPrintedRoeRoundingWitness,
  profileSharedBookUnderPrintedRoeRounding,
  solveBookFromPrintedGrid,
  solveZeroResidualRoeSlopePayout,
  validatePrintedOperandFixture,
} from "./fenok-rim-identification-protocol.mjs";
import { buildIdentificationArtifact } from "./build-fenok-rim-identification-receipt.mjs";

const NESTED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_PATH = path.join(NESTED, "scripts", "fixtures", "fenok-rim-2026-08-03-stock-grids.json");
const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));

// The stock sheets are the only captured grids with payout, RF and ERP printed
// on the same sheet. Their pixels and extracted operands must stay linked.
validatePrintedOperandFixture(fixture);
for (const artifact of Object.values(fixture.artifacts)) {
  const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(NESTED, artifact.path))).digest("hex");
  assert.equal(actual, artifact.sha256, `artifact hash drifted: ${artifact.path}`);
}

for (const instrument of Object.values(fixture.instruments)) {
  for (const grid of instrument.grids) {
    assert.equal(
      Math.round(grid.cells.reduce((sum, cell) => sum + cell.fair_value, 0) / 9),
      grid.printed_fair_value,
      `${instrument.name}/${grid.id} printed panel mean checksum`,
    );
    const solved = solveBookFromPrintedGrid({
      cells: grid.cells,
      riskFree: instrument.printed.risk_free,
      payout: instrument.printed.payout,
    });
    assert.equal(solved.cells, 9);
    assert.equal(solved.fit_objective, "relative_rms");
    assert.ok(solved.grid_rms <= 0.003, `${instrument.name}/${grid.id} structural RMS exceeds 0.3%`);
    assert.ok(Number.isFinite(solved.residual_roe_slope));
    assert.ok(Math.abs(solved.residual_roe_span) <= 0.01, `${instrument.name}/${grid.id} ROE-linked residual span exceeds 1%`);
    const zeroSlopePayout = solveZeroResidualRoeSlopePayout({
      cells: grid.cells,
      riskFree: instrument.printed.risk_free,
    });
    assert.ok(Math.abs(zeroSlopePayout - instrument.printed.payout) > instrument.printed.payout_display_resolution / 2);
    const roundingWitness = findPrintedRoeRoundingWitness({
      cells: grid.cells,
      riskFree: instrument.printed.risk_free,
      payout: instrument.printed.payout,
      roeDisplayResolution: instrument.printed.roe_display_resolution,
    });
    assert.equal(roundingWitness.found, true);
    assert.ok(Math.abs(roundingWitness.residual_roe_slope) <= 1e-12);
    assert.ok(roundingWitness.shift <= instrument.printed.roe_display_resolution / 2);
    assert.ok(roundingWitness.adjusted_roes[0] < roundingWitness.adjusted_roes[1]);
    assert.ok(roundingWitness.adjusted_roes[1] < roundingWitness.adjusted_roes[2]);
    assert.equal(roundingWitness.scope, "within_panel_only");
    assert.equal(roundingWitness.bound_saturated, false);
  }
  const sharedProfile = profileSharedBookUnderPrintedRoeRounding({
    grids: instrument.grids,
    riskFree: instrument.printed.risk_free,
    payout: instrument.printed.payout,
    roeDisplayResolution: instrument.printed.roe_display_resolution,
  });
  assert.equal(sharedProfile.saturated_count, 6);
}

const transfer = buildIdentificationArtifact();
assert.equal(transfer.schema_version, "fenok-rim-structural-transfer-receipt/v2");
assert.equal(transfer.status, "structural_transfer_only");
assert.equal(transfer.production_identified, false);
assert.equal(transfer.exact_printed_input_structural_conflict, true);
assert.equal(transfer.display_rounding_robust, false);
assert.equal(transfer.printed_roe_rounding_can_remove_conflict, true);
assert.equal(transfer.same_sheet_payout_count, 2);
assert.ok(transfer.cases.every((row) => row.grid_rms <= 0.003));
assert.ok(transfer.instruments.every((row) => row.cross_panel_exact_book_equality.equal === false));
assert.ok(transfer.instruments.every((row) => row.external_book_cross_check.comparison_status === "diagnostic_mixed_basis_not_a_promotion_gate"));
assert.ok(transfer.blocking_reasons.includes("exact_cross_panel_book_equality_fails"));
assert.ok(transfer.blocking_reasons.includes("rounded_cross_panel_shared_book_gate_fails"));
assert.ok(transfer.blocking_reasons.includes("rounded_shared_book_gate_pass_is_boundary_saturated"));
assert.ok(transfer.blocking_reasons.includes("printed_payout_residual_roe_conflict"));
assert.ok(transfer.blocking_reasons.includes("printed_roe_rounding_can_remove_slope"));
const zeroSlopeRoots = Object.fromEntries(transfer.cases.map((row) => [`${row.instrument}/${row.grid}`, row.payout_zero_residual_roe_slope]));
assert.ok(Math.abs(zeroSlopeRoots["SAMSUNG/worst"] - 0.2627765951204991) < 1e-12);
assert.ok(Math.abs(zeroSlopeRoots["SAMSUNG/likely"] - 0.27924570566103457) < 1e-12);
assert.ok(Math.abs(zeroSlopeRoots["HYNIX/worst"] - 0.17550154323406159) < 1e-12);
assert.ok(Math.abs(zeroSlopeRoots["HYNIX/likely"] - 0.19121064791128922) < 1e-12);

const artifact = transfer;
assert.equal(artifact.schema_version, "fenok-rim-structural-transfer-receipt/v2");
assert.equal(artifact.status, "structural_transfer_only");
assert.equal(artifact.production_identified, false);
assert.equal(artifact.fixture.cell_count, 36);
assert.match(artifact.fixture.sha256, /^[a-f0-9]{64}$/);
assert.equal(artifact.external_book_sources.SAMSUNG.fiscal_period, "2025-12-31");
assert.equal(artifact.external_book_sources.HYNIX.fiscal_period, "2025-12-31");
assert.equal(artifact.external_book_sources.SAMSUNG.ticker, "005930.KS");
assert.equal(artifact.external_book_sources.HYNIX.ticker, "000660.KS");
assert.ok(Object.values(artifact.external_book_sources).every((row) => row.currency === "KRW" && row.temporal_eligible === false));
assert.ok(Object.values(artifact.external_book_sources).every((row) => /^[a-f0-9]{64}$/.test(row.measurement_sha256)));
const instruments = Object.fromEntries(artifact.instruments.map((row) => [row.id, row]));
assert.ok(Math.abs(instruments.SAMSUNG.same_sheet_book_basis.book_per_share - 72790.489008524) < 1e-9);
assert.ok(Math.abs(instruments.HYNIX.same_sheet_book_basis.book_per_share - 171750.87384810933) < 1e-9);
assert.ok(artifact.instruments.every((row) => row.same_sheet_book_basis.independent_validation === false));
assert.ok(artifact.instruments.every((row) => row.printed_book_roll_forward.max_abs_relative_error < 0.00003));
assert.equal(instruments.SAMSUNG.cross_panel_relative_rms_gate.exact_printed_roes.passed, false);
assert.equal(instruments.SAMSUNG.cross_panel_relative_rms_gate.printed_roe_rounding_profile.gate.passed, true);
assert.equal(instruments.SAMSUNG.cross_panel_relative_rms_gate.clean_pass, false);
assert.equal(instruments.HYNIX.cross_panel_relative_rms_gate.printed_roe_rounding_profile.gate.passed, false);
assert.ok(Math.abs(instruments.SAMSUNG.cross_panel_relative_rms_gate.printed_roe_rounding_profile.gate.value - 0.003006113744874829) < 1e-12);
assert.ok(Math.abs(instruments.HYNIX.cross_panel_relative_rms_gate.printed_roe_rounding_profile.gate.value - 0.009187596283510612) < 1e-12);
assert.equal(artifact.calibration_receipt.schema_version, "fenok-rim-calibration-receipt/v1");
assert.equal(artifact.calibration_receipt.promotion.eligible, false);
// The evidence ledger lives in the parent project (parent_project scope). The
// nested-repo CI checkout cannot carry it, so honest absence (exists=false) is
// the expected contract there — never a silent fallback. Locally it must
// resolve and match its pinned hash.
{
  const ledger = artifact.calibration_receipt.source_ledger;
  assert.equal(ledger.resolved_scope, "parent_project", "source ledger scope is parent_project in both contexts");
  if (ledger.exists) {
    assert.equal(ledger.raw_sha256, ledger.expected_sha256, "source ledger hash integrity");
  }
}
assert.deepEqual(artifact.calibration_receipt.fit_evidence_ids, ["stock-grid-hynix", "stock-grid-samsung"]);
assert.deepEqual(artifact.calibration_receipt.evaluation_evidence_ids, []);
assert.deepEqual(artifact.calibration_receipt.evidence_set_contract, { fit: "applicable", evaluation: "not_applicable" });
assert.equal(artifact.calibration_receipt.promotion.underlying_production_identified, false);
assert.ok(artifact.calibration_receipt.promotion.blockers.includes("underlying_production_not_identified"));
assert.ok(transfer.blocking_reasons.every((reason) => artifact.calibration_receipt.promotion.blockers.includes(reason)));
assert.deepEqual(
  artifact.calibration_receipt.algorithm.sources.map((source) => source.path),
  [
    "scripts/analyze-fenok-rim-identifiability.mjs",
    "scripts/build-fenok-rim-identification-receipt.mjs",
    "scripts/fenok-rim-identification-protocol.mjs",
  ],
);
assert.ok(!artifact.calibration_receipt.algorithm.sources.some(
  (source) => source.path === "scripts/lib/fenok-rim-calibration-receipt.mjs",
));
assert.ok(artifact.calibration_receipt.sources.some(
  (source) => source.path === "scripts/lib/fenok-rim-calibration-receipt.mjs",
));
const committedArtifact = JSON.parse(fs.readFileSync(
  path.join(NESTED, "data", "computed", "fenok-rim", "identification-receipt.json"),
  "utf8",
));
const receiptComparison = compareCalibrationReceiptIdentity(
  committedArtifact.calibration_receipt,
  artifact.calibration_receipt,
);
assert.equal(
  receiptComparison.semantic_identity_equal,
  true,
  "committed identification receipt must match the semantic calibration identity",
);
assert.equal(receiptComparison.measurement_identity_equal, true);
// Raw/source metadata refreshes remain observable here without invalidating a
// stable semantic measurement receipt.
assert.equal(typeof receiptComparison.source_snapshot_equal, "boolean");

// Temporal candidate competition freezes the winner on fit rows only. The
// candidate that wins holdout must not replace the fit winner after inspection.
const observations = [
  { evidence_id: "fit-point", observation_at: "2026-06-01T23:59:59Z", model_family: "RIM", identity_status: "verified", type: "point", target: 1.20 },
  { evidence_id: "fit-range", observation_at: "2026-06-10T23:59:59Z", model_family: "RIM", identity_status: "verified", type: "range", target: [1.10, 1.30] },
  { evidence_id: "fit-floor", observation_at: "2026-06-20T23:59:59Z", model_family: "RIM", identity_status: "verified", type: "floor", target: 1.00 },
  { evidence_id: "heldout-point", observation_at: "2026-07-10T23:59:59Z", model_family: "RIM", identity_status: "verified", type: "point", target: 1.40 },
];
const HASH = "a".repeat(64);
const DEFINITION_HASH = "b".repeat(64);
const prediction = (value, availableAsOf, firstSeenAt = availableAsOf, contentSha256 = HASH) => ({
  value,
  available_as_of: availableAsOf,
  first_seen_at: firstSeenAt,
  content_sha256: contentSha256,
  dependencies: [{ id: "source-vintage", available_as_of: availableAsOf, first_seen_at: firstSeenAt, content_sha256: HASH }],
});
const candidates = [
  {
    id: "fit-winner",
    frozen_at: "2026-06-30T23:59:59Z",
    definition_sha256: DEFINITION_HASH,
    predictions: {
      "fit-point": prediction(1.20, "2026-05-31T23:59:59Z"),
      "fit-range": prediction(1.20, "2026-06-09T23:59:59Z"),
      "fit-floor": prediction(1.10, "2026-06-19T23:59:59Z"),
      "heldout-point": prediction(1.68, "2026-07-09T23:59:59Z"),
    },
  },
  {
    id: "holdout-star",
    frozen_at: "2026-06-30T23:59:59Z",
    definition_sha256: DEFINITION_HASH,
    predictions: {
      "fit-point": prediction(1.10, "2026-05-31T23:59:59Z"),
      "fit-range": prediction(1.05, "2026-06-09T23:59:59Z"),
      "fit-floor": prediction(1.10, "2026-06-19T23:59:59Z"),
      "heldout-point": prediction(1.40, "2026-07-09T23:59:59Z"),
    },
  },
  {
    id: "future-leak",
    frozen_at: "2026-06-30T23:59:59Z",
    definition_sha256: DEFINITION_HASH,
    predictions: {
      "fit-point": prediction(1.20, "2026-06-02T00:00:00Z"),
      "fit-range": prediction(1.20, "2026-06-09T23:59:59Z"),
      "fit-floor": prediction(1.10, "2026-06-19T23:59:59Z"),
      "heldout-point": prediction(1.40, "2026-07-09T23:59:59Z"),
    },
  },
];

const receipt = buildTemporalReceipt({
  observations,
  candidates,
  cutoff: "2026-06-30T23:59:59Z",
  boundedHoldoutThreshold: 0.05,
  minimumBoundedHoldout: 1,
});
assert.equal(receipt.schema_version, "fenok-rim-temporal-identification-receipt/v1");
assert.equal(receipt.selected_candidate_id, "fit-winner", "winner must be frozen on fit evidence only");
assert.equal(receipt.selected_candidate.definition_sha256, DEFINITION_HASH);
assert.equal(receipt.selected_candidate.frozen_at, "2026-06-30T23:59:59Z");
assert.equal(receipt.selected_candidate.prediction_receipts.length, 4);
assert.ok(receipt.selected_candidate.prediction_receipts.every((row) => row.dependencies.length === 1));
assert.deepEqual(receipt.fit_evidence_ids, ["fit-floor", "fit-point", "fit-range"]);
assert.deepEqual(receipt.holdout_evidence_ids, ["heldout-point"]);
assert.equal(receipt.fit.bounded_count, 2, "floor must not enter bounded fit loss");
assert.equal(receipt.holdout.bounded_count, 1);
assert.equal(receipt.holdout.passed, false, "failed sealed evidence must not trigger candidate switching");
assert.equal(receipt.passed, false);
assert.ok(receipt.rejected_candidates.some((row) => row.id === "future-leak" && row.reason === "temporal_leakage"));

const firstSeenTooLate = structuredClone(candidates[0]);
firstSeenTooLate.id = "first-seen-too-late";
firstSeenTooLate.predictions["fit-point"].first_seen_at = "2026-06-01T23:59:59.001Z";
firstSeenTooLate.predictions["fit-point"].dependencies[0].first_seen_at = "2026-06-01T23:59:59.001Z";
const firstSeenReceipt = buildTemporalReceipt({ observations, candidates: [firstSeenTooLate], cutoff: "2026-06-30T23:59:59Z" });
assert.ok(firstSeenReceipt.rejected_candidates.some((row) => row.reason === "temporal_leakage"));

const equalityCandidate = structuredClone(candidates[0]);
equalityCandidate.id = "exact-equality";
for (const observation of observations) {
  equalityCandidate.predictions[observation.evidence_id] = prediction(
    observation.type === "point" ? observation.target : observation.type === "range" ? observation.target[0] : observation.target,
    observation.observation_at,
  );
}
const equalityReceipt = buildTemporalReceipt({ observations, candidates: [equalityCandidate], cutoff: "2026-06-30T23:59:59Z" });
assert.equal(equalityReceipt.status, "passed", "exact timestamp equality must be eligible");

const missingDependencies = structuredClone(candidates[0]);
missingDependencies.id = "missing-dependencies";
delete missingDependencies.predictions["fit-point"].dependencies;
const missingDependenciesReceipt = buildTemporalReceipt({ observations, candidates: [missingDependencies], cutoff: "2026-06-30T23:59:59Z" });
assert.ok(missingDependenciesReceipt.rejected_candidates.some((row) => row.reason === "missing_dependency_receipt"));

const malformedHoldout = structuredClone(candidates[0]);
malformedHoldout.id = "malformed-holdout";
delete malformedHoldout.predictions["heldout-point"].dependencies;
const malformedHoldoutReceipt = buildTemporalReceipt({ observations, candidates: [malformedHoldout], cutoff: "2026-06-30T23:59:59Z" });
assert.equal(malformedHoldoutReceipt.status, "blocked");
assert.ok(malformedHoldoutReceipt.blocking_reasons.includes("missing_dependency_receipt"));
assert.equal(
  malformedHoldoutReceipt.selected_candidate.prediction_receipts.find((row) => row.evidence_id === "heldout-point").dependency_receipt_missing,
  true,
);

const invalidHoldoutDependency = structuredClone(candidates[0]);
invalidHoldoutDependency.id = "invalid-holdout-dependency";
invalidHoldoutDependency.predictions["heldout-point"].dependencies.push(null);
const invalidHoldoutReceipt = buildTemporalReceipt({ observations, candidates: [invalidHoldoutDependency], cutoff: "2026-06-30T23:59:59Z" });
assert.equal(invalidHoldoutReceipt.status, "blocked");
assert.ok(invalidHoldoutReceipt.blocking_reasons.includes("invalid_dependency_receipt"));
assert.equal(
  invalidHoldoutReceipt.selected_candidate.prediction_receipts.find((row) => row.evidence_id === "heldout-point").dependency_receipt_invalid,
  true,
);

const unhashed = structuredClone(candidates[0]);
unhashed.id = "unhashed-vintage";
delete unhashed.predictions["fit-point"].content_sha256;
const unhashedReceipt = buildTemporalReceipt({ observations, candidates: [unhashed], cutoff: "2026-06-30T23:59:59Z" });
assert.ok(unhashedReceipt.rejected_candidates.some((row) => row.reason === "invalid_dependency_receipt"));

const forgedAggregate = structuredClone(candidates[0]);
forgedAggregate.id = "forged-aggregate";
forgedAggregate.predictions["fit-point"].dependencies[0].available_as_of = "2026-06-02T00:00:00Z";
const forgedReceipt = buildTemporalReceipt({ observations, candidates: [forgedAggregate], cutoff: "2026-06-30T23:59:59Z" });
assert.ok(forgedReceipt.rejected_candidates.some((row) => row.reason === "dependency_vintage_mismatch"));

const notFrozen = structuredClone(candidates[0]);
notFrozen.id = "not-frozen";
notFrozen.frozen_at = "2026-07-01T00:00:00Z";
const notFrozenReceipt = buildTemporalReceipt({ observations, candidates: [notFrozen], cutoff: "2026-06-30T23:59:59Z" });
assert.ok(notFrozenReceipt.rejected_candidates.some((row) => row.reason === "candidate_not_frozen_before_holdout"));

assert.throws(
  () => buildTemporalReceipt({ observations: [{ ...observations[0], observation_at: "2026-02-30T00:00:00Z" }], candidates: [candidates[0]], cutoff: "2026-06-30T23:59:59Z" }),
  /valid timestamp/,
  "calendar-invalid timestamps must fail instead of being normalized by Date.parse",
);
assert.throws(
  () => buildTemporalReceipt({ observations, candidates: [{ ...candidates[0], frozen_at: "2026-06-30T23:59:59" }], cutoff: "2026-06-30T23:59:59Z" }),
  /timezone/,
  "unzoned freeze timestamps must fail",
);

assert.throws(
  () => buildTemporalReceipt({ observations, candidates: [candidates[0], structuredClone(candidates[0])], cutoff: "2026-06-30T23:59:59Z" }),
  /duplicate candidate id/,
);
assert.throws(
  () => buildTemporalReceipt({ observations: [observations[0], structuredClone(observations[0])], candidates: [candidates[0]], cutoff: "2026-06-30T23:59:59Z" }),
  /duplicate evidence_id/,
);

const reordered = buildTemporalReceipt({
  observations: [...observations].reverse(),
  candidates: [...candidates].reverse(),
  cutoff: "2026-06-30T23:59:59Z",
  boundedHoldoutThreshold: 0.05,
  minimumBoundedHoldout: 1,
});
assert.deepEqual(reordered, receipt, "receipt must be deterministic under input reordering");

const noBoundedHoldout = buildTemporalReceipt({
  observations: observations.map((row) => row.evidence_id === "heldout-point" ? { ...row, type: "floor", target: 1.0 } : row),
  candidates: candidates.slice(0, 2),
  cutoff: "2026-06-30T23:59:59Z",
  minimumBoundedHoldout: 1,
});
assert.equal(noBoundedHoldout.status, "blocked");
assert.ok(noBoundedHoldout.blocking_reasons.includes("insufficient_bounded_holdout"));

const unresolved = buildTemporalReceipt({
  observations: observations.map((row) => row.evidence_id === "heldout-point" ? { ...row, identity_status: "unresolved" } : row),
  candidates: candidates.slice(0, 2),
  cutoff: "2026-06-30T23:59:59Z",
  minimumBoundedHoldout: 1,
});
assert.equal(unresolved.status, "blocked");
assert.deepEqual(unresolved.unscoreable_evidence_ids, ["heldout-point"]);

console.log("OK test-fenok-rim-identification-protocol.mjs");
