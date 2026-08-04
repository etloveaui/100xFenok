import assert from "node:assert/strict";

import { classifyRimPublication } from "./fenok-rim-publication-policy.mjs";

const exactInputs = [
  "price",
  "book_value",
  "roe",
  "payout",
  "risk_free",
  "risk_premium",
].map((name) => ({ name, kind: "point", observable: true, current: true }));

const boundedHoldout = { kind: "range", passed: true, evidence_id: "holdout-range-1" };
const insideFit = [{ name: "discount_relation", inside_domain: true }];

assert.deepEqual(
  classifyRimPublication({
    identity_status: "verified",
    inputs: exactInputs,
    holdout: boundedHoldout,
    fitted_relations: insideFit,
  }),
  { status: "POINT", reasons: [] },
);

assert.deepEqual(
  classifyRimPublication({
    identity_status: "verified",
    inputs: exactInputs,
    holdout: { kind: "lower_bound", passed: true, evidence_id: "floor-1" },
    fitted_relations: insideFit,
  }),
  {
    status: "NULL",
    reasons: ["bounded_non_floor_holdout_required"],
  },
  "a satisfied floor must not validate a point estimate",
);

const rangedInputs = exactInputs.map((row) => (
  row.name === "payout" ? { ...row, kind: "range", lower: 0.2, upper: 0.35 } : row
));

assert.deepEqual(
  classifyRimPublication({
    identity_status: "verified",
    inputs: rangedInputs,
    holdout: boundedHoldout,
    fitted_relations: insideFit,
    sweep: { complete: true, lower: 8100, upper: 9400 },
  }),
  { status: "RANGE", reasons: [] },
);

assert.deepEqual(
  classifyRimPublication({
    identity_status: "verified",
    inputs: rangedInputs,
    holdout: boundedHoldout,
    fitted_relations: insideFit,
    sweep: { complete: false, lower: 8100, upper: 9400 },
  }),
  { status: "NULL", reasons: ["complete_bound_sweep_required"] },
);

assert.deepEqual(
  classifyRimPublication({
    identity_status: "unresolved",
    inputs: exactInputs,
    holdout: boundedHoldout,
    fitted_relations: insideFit,
  }),
  { status: "NULL", reasons: ["asset_identity_unverified"] },
);

assert.deepEqual(
  classifyRimPublication({
    identity_status: "verified",
    inputs: exactInputs.map((row) => (
      row.name === "risk_premium" ? { ...row, observable: false, kind: "latent" } : row
    )),
    holdout: boundedHoldout,
    fitted_relations: insideFit,
  }),
  { status: "NULL", reasons: ["material_input_latent:risk_premium"] },
);

assert.deepEqual(
  classifyRimPublication({
    identity_status: "verified",
    inputs: exactInputs,
    holdout: boundedHoldout,
    fitted_relations: [{ name: "discount_relation", inside_domain: false }],
  }),
  { status: "NULL", reasons: ["fitted_relation_outside_domain:discount_relation"] },
);

assert.deepEqual(
  classifyRimPublication({
    identity_status: "verified",
    inputs: exactInputs,
    holdout: { ...boundedHoldout, passed: false },
    fitted_relations: insideFit,
  }),
  { status: "NULL", reasons: ["bounded_holdout_failed"] },
);

console.log("fenok-rim publication policy tests passed");
