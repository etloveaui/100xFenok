#!/usr/bin/env node

// FENO RIM v2 — B1/B2 gate tests (Phase 4 remainder, SPEC v3.0 section 7).
//
// On SPX real data: the public hull must be B1-only while B2 is excluded,
// and the exclusion reason must surface through computeFamilyB. On synthetic
// clean-surplus aggregates: the bridge error is exactly zero for the identity
// B_t = B_(t-1) + NI - Div, and the 0.02 tolerance boundary is enforced.

import assert from "node:assert/strict";
import { buildSpxInput } from "./feno-rim-v2/adapters/spx-panel.mjs";
import { computeFamilyB } from "./feno-rim-v2/engine.mjs";
import { BRIDGE_TOLERANCE, cleanSurplusBridge } from "./feno-rim-v2/clean-surplus.mjs";

// --- B1-only hull provenance on SPX real data -----------------------------

const input = buildSpxInput("2026-08-01");
const result = computeFamilyB(input);

assert.equal(result.b2_admitted, false, "SPX B2 is excluded today");
assert.equal(
  result.b2_exclusion_reason,
  input.b2_exclusion_reason,
  "the exclusion reason must surface unchanged through computeFamilyB",
);

const endpoints = [result.hull_provenance.low, result.hull_provenance.high].filter(Boolean);
assert.equal(endpoints.length, 2, "hull provenance must name both endpoints");
for (const prov of endpoints) {
  assert.equal(prov.scenario, "B1_observed", "a B1-only hull endpoint must come from B1_observed");
}

const memberScenarios = new Set(result.disclosures.members.map((m) => m.scenario));
assert.ok(memberScenarios.has("B1_observed"), "B1 members present");
assert.ok(![...memberScenarios].some((s) => s.startsWith("B2")), "no B2 member may appear while excluded");

// --- clean-surplus synthetic: exact identity => zero bridge error ----------

const identity = [
  { date: "2020-12-31", book: 1000 },
  { date: "2021-12-31", book: 1090, net_income: 120, dividends: 30, net_issuance: 0, oci: 0 },
];
// bridge_error = (1090 - 1000 - 120 + 30 - 0 - 0) / 1000 = 0
const identityResult = cleanSurplusBridge(identity);
assert.equal(identityResult.admitted, true, "exact identity must admit");
assert.equal(identityResult.bridge_errors.length, 1);
assert.equal(identityResult.bridge_errors[0].bridge_error, 0);
assert.equal(identityResult.reason, null);

// --- tolerance boundary: |error| == 0.02 admitted; 0.0201 rejected ---------

const atBoundary = [
  { date: "2020-12-31", book: 1000 },
  { date: "2021-12-31", book: 1090, net_income: 120, dividends: 30, net_issuance: 0, oci: BRIDGE_TOLERANCE * 1000 },
];
// bridge_error = (1090 - 1000 - 120 + 30 - 0 - 20) / 1000 = -0.02
assert.equal(cleanSurplusBridge(atBoundary).admitted, true, "|error| == 0.02 must admit");

const overBoundary = [
  { date: "2020-12-31", book: 1000 },
  { date: "2021-12-31", book: 1090, net_income: 120, dividends: 30, net_issuance: 0, oci: 20.1 },
];
// bridge_error = (1090 - 1000 - 120 + 30 - 0 - 20.1) / 1000 = -0.0201
const overResult = cleanSurplusBridge(overBoundary);
assert.equal(overResult.admitted, false, "|error| > 0.02 must reject");
assert.match(overResult.reason, /exceeds tolerance/);

// --- data absent: admitted=false with the stated reason --------------------

assert.deepEqual(cleanSurplusBridge([]), {
  admitted: false,
  reason: "clean-surplus bridge data incomplete: issuance and OCI aggregates absent",
  bridge_errors: [],
});
const partial = [{ date: "2020-12-31", book: 1000 }, { date: "2021-12-31", book: 1090, net_income: 120 }];
assert.equal(cleanSurplusBridge(partial).admitted, false, "incomplete aggregates must not admit");
assert.match(cleanSurplusBridge(partial).reason, /issuance and OCI aggregates absent/);

console.log("feno-rim-v2 B1/B2 gate tests passed");
