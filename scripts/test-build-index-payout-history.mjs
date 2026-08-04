import assert from "node:assert/strict";

import { buildArtifact } from "./build-index-payout-history.mjs";

const artifact = buildArtifact({ nowIso: "2026-08-04T05:00:00.000Z" });

assert.equal(artifact.schema_version, "fenok_rim_payout_history.v2");
assert.equal(
  artifact.basis_id,
  "realised_cash_dividends_over_positive_net_income_current_membership",
);

for (const [key, index] of Object.entries(artifact.indices)) {
  assert.equal(index.eligibility.production_eligible, false, `${key}: trailing history is not a forward model input`);
  assert.ok(
    index.eligibility.blocking_reasons.includes("current_membership_applied_to_historical_years"),
    `${key}: survivorship/membership timing must remain explicit`,
  );
  assert.ok(
    index.eligibility.blocking_reasons.includes("trailing_realised_basis_not_forward_policy"),
    `${key}: trailing and forward payout must not be mixed`,
  );
  assert.ok(index.history.length >= 3, `${key}: candidate band needs multiple completed years`);
  for (const row of index.history) {
    assert.ok(row.constituents > 0);
    assert.ok(row.net_income > 0);
    assert.equal(
      row.payout_ratio,
      Math.round((row.dividends / row.net_income) * 10000) / 10000,
      `${key}/${row.year}: published ratio must rederive from operands`,
    );
  }
  const values = index.history.map((row) => row.payout_ratio);
  assert.equal(index.summary.min, Math.min(...values));
  assert.equal(index.summary.max, Math.max(...values));
}

assert.ok(
  artifact.indices.kospi.eligibility.blocking_reasons.includes("exact_historical_index_membership_unavailable"),
  "every collected .KS ticker is not a KOSPI constituent set",
);
assert.ok(
  artifact.indices.philadelphia_semi.eligibility.blocking_reasons.includes("published_anchor_instrument_identity_unresolved"),
  "SOXX outputs cannot validate a Philadelphia-index payout choice",
);

console.log("build-index-payout-history tests passed");
