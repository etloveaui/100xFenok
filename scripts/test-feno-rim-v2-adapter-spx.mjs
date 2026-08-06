#!/usr/bin/env node

// FENO RIM v2 — SPX adapter, real-data contract tests (Phase 4 remainder).
//
// Proves on real repo files: provenance validation, join-guard drift refusal,
// id-invariance, NULL status while the core ERP band is unproven, B2
// exclusion with a stated reason, finite hull, determinism for a fixed asOf,
// and look-ahead refusal for an asOf before a component was knowable.

import assert from "node:assert/strict";
import { buildSpxInput } from "./feno-rim-v2/adapters/spx-panel.mjs";
import { computeFamilyB } from "./feno-rim-v2/engine.mjs";
import { invarianceViolations, joinGuard, validateNormalizedInput } from "./feno-rim-v2/provenance.mjs";

const AS_OF = "2026-08-01";
const input = buildSpxInput(AS_OF);

// 1. Provenance validation passes on real data.
assert.equal(validateNormalizedInput(input), true, "spx adapter output must satisfy the normalized contract");

// 2. Join-guard drift fails, naming the drifted key; identical provenance joins.
assert.equal(joinGuard(input, { ...input }), true);
assert.throws(() => joinGuard(input, { ...input, earnings_basis: "drifted" }), /earnings_basis/);
assert.throws(() => joinGuard(input, { ...input, membership_as_of: "2026-06-30" }), /membership_as_of/);

// 3. The engine is id-blind on the real adapter input.
assert.deepEqual(invarianceViolations(computeFamilyB, input), [], "no output may depend on the index id");

// 4. Public status NULL while the core ERP band is unproven.
const result = computeFamilyB(input);
assert.equal(result.public_status, "NULL");
assert.ok(result.null_reasons.includes("core_erp_unidentified"), "NULL must name core_erp_unidentified");

// 5. B2 excluded with a stated reason, surfaced in the compute output.
assert.equal(result.b2_admitted, false);
assert.ok(typeof result.b2_exclusion_reason === "string" && result.b2_exclusion_reason.length > 0, "B2 reason must be stated");

// 6. Diagnostic hull still finite and ordered under NULL.
assert.ok(Number.isFinite(result.value_hull.low) && Number.isFinite(result.value_hull.high), "hull must be finite");
assert.ok(result.value_hull.high > result.value_hull.low, "hull must be ordered");

// 7. Deterministic for a fixed asOf: two builds are identical records.
assert.deepEqual(buildSpxInput(AS_OF), input, "same asOf must produce the same normalized input");

// 8. Historical origins now succeed: the payout first-knowable check is
//    scoped to the B2 branch (payout is unconsumed while b2_admitted=false),
//    so 2014/2020 origins no longer refuse on the payout statement.
const historical2014 = buildSpxInput("2014-01-03");
assert.equal(historical2014.first_knowable_at <= "2014-01-03", true, "2014 origin is point-in-time");
assert.equal(historical2014.payout_consumed, false, "payout scoped out while B2 is excluded");
const historical2020 = buildSpxInput("2020-01-03");
assert.equal(historical2020.first_knowable_at <= "2020-01-03", true, "2020 origin is point-in-time");

// 9. A genuine data-boundary refusal still holds: no panel row before 2010
//    (with the payout component scoped out, the panel is the binding edge).
assert.throws(() => buildSpxInput("1998-01-05"), /no panel row at or before/);

console.log("feno-rim-v2 spx adapter tests passed");
