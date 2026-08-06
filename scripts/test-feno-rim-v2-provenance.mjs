#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  PROVENANCE_KEYS,
  defineAdapter,
  firstKnowable,
  invarianceViolations,
  joinGuard,
  validateNormalizedInput,
} from "./feno-rim-v2/provenance.mjs";

const base = {
  universe_id: "sp500_bloomberg_panel",
  membership_as_of: "2026-07-31",
  earnings_basis: "forward_fy1",
  equity_basis: "common_equity_aggregate",
  negative_earners_policy: "included",
  currency: "USD",
  share_class_policy: "single_count_per_ticker",
  first_knowable_at: "2026-08-01",
};

// A complete input validates.
assert.equal(validateNormalizedInput(base), true);

// Every missing key is named.
for (const key of PROVENANCE_KEYS) {
  const broken = { ...base, [key]: "" };
  assert.throws(() => validateNormalizedInput(broken), new RegExp(`missing provenance key ${key}`));
}

// Impossible calendar days fail the date keys.
assert.throws(() => validateNormalizedInput({ ...base, membership_as_of: "2026-02-30" }), /calendar day/);
assert.throws(() => validateNormalizedInput({ ...base, first_knowable_at: "2026-13-01" }), /calendar day/);

// Joins: identical provenance passes; any drift is a build error naming the key.
assert.equal(joinGuard(base, { ...base }), true);
assert.throws(() => joinGuard(base, { ...base, earnings_basis: "trailing_ttm" }), /earnings_basis/);
assert.throws(() => joinGuard(base, { ...base, membership_as_of: "2026-06-30" }), /membership_as_of/);

// first-knowable: the max component date wins; look-ahead fails closed.
assert.equal(
  firstKnowable({ price: "2026-07-31", book: "2026-07-30" }, "2026-08-01"),
  "2026-07-31",
);
assert.throws(() => firstKnowable({ price: "2026-08-02" }, "2026-08-01"), /look-ahead/);
assert.throws(() => firstKnowable({ price: "not-a-day" }), /calendar day/);

// Adapter boundary: the adapter output must satisfy the contract or throw.
const goodAdapter = defineAdapter("panel_spx", () => ({ ...base }));
assert.deepEqual(goodAdapter.normalize({}), base);
const badAdapter = defineAdapter("leaky", () => ({ ...base, first_knowable_at: null }));
assert.throws(() => badAdapter.normalize({}), /missing provenance key first_knowable_at/);

// Invariance property: a compliant compute is id-blind; a violating one is caught.
const compliant = (input) => ({
  book: 1000,
  keys: PROVENANCE_KEYS.map((key) => input[key]),
});
assert.deepEqual(invarianceViolations(compliant, base), []);

const idLeaky = (input) => ({
  book: input.id === "SPX" ? 1000 : 1001, // output correction after normalization
});
const violations = invarianceViolations(idLeaky, base);
assert.equal(violations.length, 1);
assert.match(violations[0], /depends on index id/);

console.log("feno-rim-v2 provenance tests passed");
