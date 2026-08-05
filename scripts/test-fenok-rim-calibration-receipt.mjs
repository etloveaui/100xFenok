#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  buildCalibrationReceipt,
  canonicalJson,
} from "./lib/fenok-rim-calibration-receipt.mjs";
import { buildIdentificationArtifact } from "./build-fenok-rim-identification-receipt.mjs";

const ledgerBytes = Buffer.from('{"claims":[]}\n');
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const sourceLedger = {
  path: "docs/agent-work/fenok-rim-evidence-ledger-20260804.json",
  expected_sha256: sha256(ledgerBytes),
  bytes: ledgerBytes,
};

function input(overrides = {}) {
  const algorithmSources = [
    { path: "scripts/example-algorithm.mjs", raw_sha256: "a".repeat(64) },
  ];
  return {
    generated_at: "2026-08-05T10:00:00+09:00",
    algorithm: {
      id: "rim-calibration",
      version: "rim-calibration/1.0.0",
      sources: algorithmSources,
      source_sha256: sha256(canonicalJson(algorithmSources)),
      parameters: { threshold: 0.05, iterations: 100, signed_zero: -0 },
    },
    sources: [
      {
        id: "samsung-book",
        path: "data/yf/finance/005930.KS.json",
        bytes: Buffer.from('{"fetched_at":"2026-08-05T00:00:00Z","equity":10,"shares":2}\n'),
        measurement: { equity: 10, shares: 2 },
      },
      {
        id: "hynix-book",
        path: "data/yf/finance/000660.KS.json",
        bytes: Buffer.from('{"fetched_at":"2026-08-05T00:00:00Z","equity":12,"shares":3}\n'),
        measurement: { equity: 12, shares: 3 },
      },
    ],
    evidence: [
      {
        id: "fit-a",
        observation_at: "2026-06-01T00:00:00Z",
        available_as_of: "2026-05-31T23:00:00Z",
        point_in_time: true,
        measurement: { target: 0.2 },
      },
      {
        id: "eval-a",
        observation_at: "2026-07-01T00:00:00Z",
        available_as_of: "2026-06-30T23:00:00Z",
        point_in_time: true,
        measurement: { target: [0.1, 0.3] },
      },
    ],
    fit_evidence_ids: ["fit-a"],
    evaluation_evidence_ids: ["eval-a"],
    proxy_decisions: [
      { id: "sox-to-soxx", accepted: false, reason: "identity_not_measured" },
    ],
    source_ledger: sourceLedger,
    external_promotion: { production_identified: true, blockers: [] },
    promotion_requested: true,
    calibration_cutoff_at: "2026-08-05T01:00:00.000Z",
    calibration_components: {
      lt_roe_rule: { intercept: 0.07, gap_coefficient: 0.47 },
      payout_multiplier: { low: 1.08, center: 1.085, high: 1.09 },
      printed_convexity_domain: { low: 1.76, high: 2.56, observations: 12 },
      twelve_month_conversion: { intercept: 0.13, slope: 0.08, horizon_months: 12 },
    },
    ...overrides,
  };
}

const baseline = buildCalibrationReceipt(input());
assert.equal(baseline.schema_version, "fenok-rim-calibration-receipt/v1");
assert.equal(baseline.generated_at, "2026-08-05T01:00:00.000Z");
assert.equal(baseline.promotion.eligible, true);
assert.match(baseline.receipt_sha256, /^[a-f0-9]{64}$/);
assert.match(baseline.measurement_receipt_sha256, /^[a-f0-9]{64}$/);
assert.match(baseline.source_snapshot_sha256, /^[a-f0-9]{64}$/);
assert.match(baseline.proxy_decision_sha256, /^[a-f0-9]{64}$/);
assert.match(baseline.parameter_sha256, /^[a-f0-9]{64}$/);
assert.equal(baseline.calibration_cutoff_at, "2026-08-05T01:00:00.000Z");
assert.deepEqual(Object.keys(baseline.calibration_component_sha256), [
  "lt_roe_rule",
  "payout_multiplier",
  "printed_convexity_domain",
  "twelve_month_conversion",
]);
for (const value of Object.values(baseline.calibration_component_sha256)) assert.match(value, /^[a-f0-9]{64}$/);

for (const component of Object.keys(baseline.calibration_component_sha256)) {
  const changed = input();
  changed.calibration_components[component] = { ...changed.calibration_components[component], receipt_test_marker: component };
  const changedReceipt = buildCalibrationReceipt(changed);
  assert.notEqual(changedReceipt.calibration_component_sha256[component], baseline.calibration_component_sha256[component]);
  for (const other of Object.keys(baseline.calibration_component_sha256).filter((id) => id !== component)) {
    assert.equal(changedReceipt.calibration_component_sha256[other], baseline.calibration_component_sha256[other]);
  }
  assert.notEqual(changedReceipt.receipt_sha256, baseline.receipt_sha256);
}

// Raw metadata drift remains visible without changing semantic measurement identity.
const metadataOnly = input();
metadataOnly.sources[0].bytes = Buffer.from('{"fetched_at":"2026-08-05T01:00:00Z","equity":10,"shares":2}\n');
const metadataReceipt = buildCalibrationReceipt(metadataOnly);
assert.equal(metadataReceipt.measurement_receipt_sha256, baseline.measurement_receipt_sha256);
assert.notEqual(metadataReceipt.source_snapshot_sha256, baseline.source_snapshot_sha256);
assert.equal(metadataReceipt.receipt_sha256, baseline.receipt_sha256);
const regeneratedLater = buildCalibrationReceipt(input({ generated_at: "2026-08-06T10:00:00+09:00" }));
assert.equal(
  regeneratedLater.receipt_sha256,
  baseline.receipt_sha256,
  "generated_at must not enter semantic receipt identity",
);

// Measurement mutation changes both semantic identities.
const measurementMutation = input();
measurementMutation.sources[0].measurement.equity = 11;
const mutatedReceipt = buildCalibrationReceipt(measurementMutation);
assert.notEqual(mutatedReceipt.measurement_receipt_sha256, baseline.measurement_receipt_sha256);
assert.notEqual(mutatedReceipt.receipt_sha256, baseline.receipt_sha256);

// Key order, set order, offset spelling, and negative zero are canonicalized.
const reordered = input({
  generated_at: "2026-08-05T01:00:00.000Z",
  algorithm: {
    parameters: { signed_zero: 0, iterations: 100, threshold: 0.05 },
    sources: input().algorithm.sources,
    source_sha256: input().algorithm.source_sha256,
    version: "rim-calibration/1.0.0",
    id: "rim-calibration",
  },
});
reordered.sources.reverse();
reordered.evidence.reverse();
assert.equal(buildCalibrationReceipt(reordered).receipt_sha256, baseline.receipt_sha256);
assert.equal(
  canonicalJson({ z: -0, sources: [{ id: "b", value: 2 }, { value: 1, id: "a" }] }),
  '{"sources":[{"id":"a","value":1},{"id":"b","value":2}],"z":0}',
);
assert.equal(
  canonicalJson({ grids: [{ id: "worst" }, { id: "likely" }] }),
  '{"grids":[{"id":"worst"},{"id":"likely"}]}',
  "ordered model arrays must not be reordered merely because rows have ids",
);
assert.throws(() => canonicalJson({ value: Infinity }), /finite number/);

for (const change of [
  { algorithm: { ...input().algorithm, version: "rim-calibration/1.0.1" } },
  { algorithm: { ...input().algorithm, parameters: { threshold: 0.06, iterations: 100 } } },
]) {
  assert.notEqual(buildCalibrationReceipt(input(change)).receipt_sha256, baseline.receipt_sha256);
}
const changedAlgorithmSources = [{ path: "scripts/example-algorithm.mjs", raw_sha256: "b".repeat(64) }];
assert.notEqual(buildCalibrationReceipt(input({
  algorithm: {
    ...input().algorithm,
    sources: changedAlgorithmSources,
    source_sha256: sha256(canonicalJson(changedAlgorithmSources)),
  },
})).receipt_sha256, baseline.receipt_sha256);
assert.throws(() => buildCalibrationReceipt(input({
  algorithm: { ...input().algorithm, source_sha256: "b".repeat(64) },
})), /canonical source manifest/);

const proxyChanged = input();
proxyChanged.proxy_decisions[0].accepted = true;
const proxyReceipt = buildCalibrationReceipt(proxyChanged);
assert.notEqual(proxyReceipt.proxy_decision_sha256, baseline.proxy_decision_sha256);
assert.notEqual(proxyReceipt.receipt_sha256, baseline.receipt_sha256);

assert.throws(
  () => buildCalibrationReceipt(input({ evaluation_evidence_ids: ["fit-a"] })),
  /fit and evaluation evidence must be disjoint/,
);
assert.throws(
  () => buildCalibrationReceipt(input({ evidence: [], fit_evidence_ids: [], evaluation_evidence_ids: [] })),
  /empty fit evidence/,
);
const explicitlyNotApplicable = buildCalibrationReceipt(input({
  evidence: [],
  fit_evidence_ids: [],
  evaluation_evidence_ids: [],
  fit_evidence_status: "not_applicable",
  evaluation_evidence_status: "not_applicable",
}));
assert.deepEqual(explicitlyNotApplicable.evidence_set_contract, { fit: "not_applicable", evaluation: "not_applicable" });

const futureEvidence = input();
futureEvidence.evidence[1].available_as_of = "2026-07-01T00:00:00.001Z";
const futureReceipt = buildCalibrationReceipt(futureEvidence);
assert.equal(futureReceipt.promotion.eligible, false);
assert.ok(futureReceipt.promotion.blockers.includes("future_evidence"));

const postCutoffEvidence = input();
postCutoffEvidence.evidence[1].observation_at = "2026-08-05T01:00:00.001Z";
postCutoffEvidence.evidence[1].available_as_of = "2026-08-05T01:00:00.001Z";
const postCutoffReceipt = buildCalibrationReceipt(postCutoffEvidence);
assert.equal(postCutoffReceipt.promotion.eligible, false);
assert.ok(postCutoffReceipt.promotion.blockers.includes("post_cutoff_evidence"));

const nonPitEvidence = input();
nonPitEvidence.evidence[0].point_in_time = false;
const nonPitReceipt = buildCalibrationReceipt(nonPitEvidence);
assert.equal(nonPitReceipt.promotion.eligible, false);
assert.ok(nonPitReceipt.promotion.blockers.includes("non_point_in_time_evidence"));

const missingLedger = buildCalibrationReceipt(input({
  source_ledger: {
    path: sourceLedger.path,
    expected_sha256: sourceLedger.expected_sha256,
  },
}));
assert.equal(missingLedger.promotion.eligible, false);
assert.ok(missingLedger.promotion.blockers.includes("missing_source_ledger"));
assert.equal(missingLedger.source_ledger.exists, false);
assert.equal(missingLedger.source_ledger.path, sourceLedger.path);
assert.equal(missingLedger.source_ledger.expected_sha256, sourceLedger.expected_sha256);

const mismatchedLedger = buildCalibrationReceipt(input({
  source_ledger: { ...sourceLedger, expected_sha256: "f".repeat(64) },
}));
assert.equal(mismatchedLedger.promotion.eligible, false);
assert.ok(mismatchedLedger.promotion.blockers.includes("source_ledger_hash_mismatch"));

const structurallyBlocked = buildCalibrationReceipt(input({
  external_promotion: {
    production_identified: false,
    blockers: ["printed_payout_residual_roe_conflict", "exact_cross_panel_book_equality_fails"],
  },
}));
assert.equal(structurallyBlocked.promotion.eligible, false);
assert.equal(structurallyBlocked.promotion.underlying_production_identified, false);
assert.ok(structurallyBlocked.promotion.blockers.includes("underlying_production_not_identified"));
assert.ok(structurallyBlocked.promotion.blockers.includes("printed_payout_residual_roe_conflict"));
assert.ok(structurallyBlocked.promotion.blockers.includes("exact_cross_panel_book_equality_fails"));

const integrated = buildIdentificationArtifact().sustainable_calibration_receipt;
assert.equal(integrated.schema_version, "fenok-rim-calibration-receipt/v1");
assert.equal(integrated.algorithm.id, "fenok-rim-sustainable-index-calibration");
assert.deepEqual(integrated.algorithm.sources.map((source) => source.path), [
  "scripts/build-fenok-rim-identification-receipt.mjs",
  "scripts/build-fenok-rim-sustainable-index-ranges.mjs",
  "scripts/fenok-rim-yoo-panel-engine.mjs",
  "scripts/lib/fenok-rim-calibration-receipt.mjs",
]);
assert.deepEqual(Object.keys(integrated.calibration_component_sha256), [
  "lt_roe_rule",
  "payout_multiplier",
  "printed_convexity_domain",
  "twelve_month_conversion",
]);
assert.deepEqual(integrated.fit_evidence_ids, [
  "ltroe-index-centres-2025-12-09",
  "ltroe-stock-centres-2026-08-03",
  "payout-multiplier-spx-ndx-2026-07-31",
  "printed-convexity-full-cells-2025-12-09",
  "twelve-month-fit-2017-01-06--2022-07-22",
]);
assert.deepEqual(integrated.evaluation_evidence_ids, [
  "twelve-month-evaluation-2022-09-30--2026-07-17",
]);
// Every in-scope index now has a direct source for the operands its value
// depends on, so no bridge gates anything. Under DEC-289 the only external
// blockers are the four owner-ordered quarantine ids (sorted); any other id
// standing here would be a defect.
assert.deepEqual(integrated.promotion.external_blockers, [
  "growth_model_not_validated",
  "model_validation_reopened",
  "sealed_holdout_absent",
  "twelve_month_output_targeting",
]);
assert.ok(!integrated.promotion.external_blockers.includes("sustainable_calibration_receipt_not_integrated"));
assert.ok(!integrated.promotion.blockers.includes("post_cutoff_evidence"));
assert.ok(!integrated.promotion.blockers.includes("future_evidence"));
assert.match(integrated.algorithm.source_sha256, /^[a-f0-9]{64}$/);
assert.match(integrated.parameter_sha256, /^[a-f0-9]{64}$/);

console.log("fenok-rim calibration receipt tests passed");
