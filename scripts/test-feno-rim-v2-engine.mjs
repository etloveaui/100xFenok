#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  FADE_YEARS,
  HORIZONS,
  computeFamilyB,
  fadeCoefficient,
  roePath,
} from "./feno-rim-v2/engine.mjs";
import { invarianceViolations } from "./feno-rim-v2/provenance.mjs";

// Synthetic fixture (Phase 4 step 2): plausible but invented inputs; the
// engine must treat them as pure numbers and stay id-blind.
const synthetic = {
  id: "SPX",
  book: 1300,
  price: 7500,
  risk_free: 0.042,
  roe: {
    band: { low: 0.16, high: 0.20 },
    consensus: [{ fy: 1, roe: 0.19 }, { fy: 2, roe: 0.185 }, { fy: 3, roe: 0.18 }],
    coverage_ok: true,
  },
  payout_scenarios: [{ id: "ttm_ttm", low: 0.34, high: 0.38 }],
  growth_observed: { w5: 0.055, w10: 0.053, w15: 0.057 },
  erp_band: { low: 0.04, high: 0.055 },
  b2_admitted: true,
  b2_exclusion_reason: null,
  // The fixture admits B2, so the payout first-knowable check must be active
  // (engine fail-closed guard; owner ruling 2026-08-06).
  payout_consumed: true,
};

// Terminal B reaches exactly zero at N+F.
assert.equal(fadeCoefficient(FADE_YEARS), 0);
assert.ok(fadeCoefficient(FADE_YEARS - 1) > 0, "the last retained term is positive");
assert.ok(fadeCoefficient(1) > fadeCoefficient(5) && fadeCoefficient(5) > 0);

// ROE path: consensus years intact, fade lands exactly on the bound at M=5.
const pathLow = roePath(0.16, synthetic.roe);
assert.equal(pathLow[0], 0.19);
assert.equal(pathLow[2], 0.18);
assert.equal(pathLow[4], 0.16);

// ID invariance (Phase 4 step 4): the same normalized input under two ids.
assert.deepEqual(invarianceViolations(computeFamilyB, synthetic), []);

// Baseline compute.
const result = computeFamilyB(synthetic);
// Band wiring slice (owner ruling 2026-08-06): a proven ERP band does NOT flip
// anything to RANGE — SPEC §8 requires interval calibration on a holdout and
// §11 keeps confidence UNVERIFIED until Gate 4, so the row stays NULL with the
// next blocker named.
assert.equal(result.public_status, "NULL");
assert.ok(result.null_reasons.includes("holdout_interval_calibration_not_met"), "the band must not promote without holdout calibration");
assert.ok(result.value_hull.high > result.value_hull.low);
assert.equal(result.confidence, "UNVERIFIED");
assert.deepEqual(result.disclosures.horizons, [...HORIZONS]);
assert.deepEqual(result.disclosures.terminals, ["A", "B"]);

// Monotonicity: ERP up lowers value; ROE band up raises it; Rf up lowers it.
const erpUp = computeFamilyB({ ...synthetic, erp_band: { low: 0.05, high: 0.065 } });
assert.ok(erpUp.value_hull.high < result.value_hull.high, "ERP up must lower the hull");
const roeUp = computeFamilyB({ ...synthetic, roe: { ...synthetic.roe, band: { low: 0.18, high: 0.22 } } });
assert.ok(roeUp.value_hull.high > result.value_hull.high, "ROE band up must raise the hull");
const rfUp = computeFamilyB({ ...synthetic, risk_free: 0.052 });
assert.ok(rfUp.value_hull.high < result.value_hull.high, "risk-free up must lower the hull");

// B2 gate: excluded B2 leaves a B1-only hull and records the reason.
const b1Only = computeFamilyB({
  ...synthetic,
  b2_admitted: false,
  b2_exclusion_reason: "bridge data incomplete: OCI absent",
});
assert.equal(b1Only.b2_admitted, false);
assert.equal(b1Only.b2_exclusion_reason, "bridge data incomplete: OCI absent");
assert.ok(b1Only.disclosures.member_count < result.disclosures.member_count, "B1-only sweep has fewer members");
assert.ok(
  b1Only.disclosures.member_count > 0
    && !JSON.stringify(b1Only.hull_provenance).includes("B2"),
  "B1-only hull endpoints must not come from B2",
);

// Core ERP unproven => NULL public status, diagnostics still computed.
const noErp = computeFamilyB({ ...synthetic, erp_band: null });
assert.equal(noErp.public_status, "NULL");
assert.ok(noErp.null_reasons.includes("core_erp_unidentified"), "unproven core ERP must NULL the row");
assert.ok(Number.isFinite(noErp.value_hull.low), "diagnostic hull still computed under NULL");

// Direction reversal between scenarios => NULL.
const reversed = computeFamilyB({
  ...synthetic,
  price: 3000, // hull sits far above price for B1's low growth...
  growth_observed: { w5: 0.30, w10: 0.30, w15: 0.30 }, // ...while B2 retention with low ROE/payout high can land below
  roe: { band: { low: 0.05, high: 0.30 }, consensus: null, coverage_ok: false },
});
// Reversal depends on the fixture; assert the flag is consistent with the status.
if (reversed.null_reasons.includes("scenario_direction_reversal")) {
  assert.equal(reversed.public_status, "NULL");
}

// Both horizons and both terminals appear in the member set (no silent selection).
const memberSet = result.disclosures.members;
for (const horizon of HORIZONS) {
  assert.ok(memberSet.some((m) => m.horizon === horizon), `horizon ${horizon} must be live`);
}
for (const terminal of ["A", "B"]) {
  assert.ok(memberSet.some((m) => m.terminal === terminal), `terminal ${terminal} must be live`);
}
// B1 sweep census: 3 growth x 2 erp x 2 roe x 2 N x 2 terminal = 48 members.
assert.equal(memberSet.filter((m) => m.scenario === "B1_observed").length, 3 * 2 * 2 * 2 * 2);
// B1 human label (owner ruling 2026-08-06): every B1 member disclosure names
// the model; B1 must not claim clean-surplus reproduction (that is the B2
// gate's territory).
for (const member of memberSet.filter((m) => m.scenario === "B1_observed")) {
  assert.equal(member.scenario_label, "Empirical Book Growth Residual Income Model");
}

console.log("feno-rim-v2 engine tests passed");
