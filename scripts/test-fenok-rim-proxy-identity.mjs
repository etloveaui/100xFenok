#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  auditBookRoeIdentity,
  auditHistoricalClaimIdentity,
  auditPayoutIdentity,
  auditPriceUnitBridge,
  auditProxyIdentity,
  DEFAULT_PROXY_IDENTITY_THRESHOLDS,
  readCurrentRepoProxyIdentityAudit,
  readCurrentRepoProxyIdentityInputs,
} from "./lib/fenok-rim-proxy-identity.mjs";

const closeTo = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
};

const currentInputs = readCurrentRepoProxyIdentityInputs();
const current = readCurrentRepoProxyIdentityAudit();
const rut = current.RUT_IWM;
const sox = current.SOX_SOXX;

assert.equal(rut.dimensions.price_unit_bridge.intersection_count, 51);
closeTo(rut.dimensions.price_unit_bridge.ratio_median, 10.122070245193717, 1e-12, "RUT/IWM median ratio");
closeTo(rut.dimensions.price_unit_bridge.coefficient_of_variation, 0.0034368247500787532, 1e-15, "RUT/IWM CV");
closeTo(rut.dimensions.price_unit_bridge.max_relative_deviation, 0.008176936367427112, 1e-15, "RUT/IWM max deviation");
assert.equal(rut.dimensions.price_unit_bridge.passed, true);

assert.equal(sox.dimensions.price_unit_bridge.intersection_count, 49);
closeTo(sox.dimensions.price_unit_bridge.ratio_median, 23.259061773768508, 1e-12, "SOX/SOXX median ratio");
closeTo(sox.dimensions.price_unit_bridge.coefficient_of_variation, 0.014656042493242209, 1e-15, "SOX/SOXX CV");
closeTo(sox.dimensions.price_unit_bridge.max_relative_deviation, 0.03536111578456058, 1e-15, "SOX/SOXX max deviation");
assert.equal(sox.dimensions.price_unit_bridge.passed, false);

const shortBridge = auditPriceUnitBridge(
  Array.from({ length: 29 }, (_, index) => ({ date: `2026-01-${String(index + 1).padStart(2, "0")}`, value: 100 + index })),
  Array.from({ length: 29 }, (_, index) => ({ date: `2026-01-${String(index + 1).padStart(2, "0")}`, value: 10 + index / 10 })),
);
assert.equal(shortBridge.passed, false);
assert.equal(shortBridge.reason, "insufficient_exact_date_intersections");
assert.equal(auditPriceUnitBridge([{ date: "2026-01-01", value: 10 }], [{ date: "2026-01-02", value: 1 }]).reason, "no_exact_date_intersections");

const stableRows = Array.from({ length: 30 }, (_, index) => ({ date: `2026-01-${String(index + 1).padStart(2, "0")}`, value: 100, available_as_of: `2026-01-${String(index + 1).padStart(2, "0")}` }));
const shiftedProxy = stableRows.map((row, index) => ({ date: row.date, value: index === 29 ? 8 : 10, available_as_of: row.available_as_of }));
assert.equal(auditPriceUnitBridge(stableRows, shiftedProxy).passed, false, "one shifted scale must fail the max-deviation gate");

// The tracker payout is the engine's output, not a constant. Pinning its exact
// value here made every payout-basis change break this suite for no reason;
// what this test is for is the divergence between the two identities.
assert.ok(rut.dimensions.payout_identity.proxy_payout > 0 && rut.dimensions.payout_identity.proxy_payout < 1);
closeTo(rut.dimensions.payout_identity.target_payout, 0.23716, 1e-15, "RUT LSEG payout");
assert.ok(rut.dimensions.payout_identity.relative_divergence > 0.05,
  "RUT's tracker and official payout identities must still be measurably apart");
assert.equal(rut.dimensions.payout_identity.passed, false);
assert.ok(sox.dimensions.payout_identity.proxy_payout > 0 && sox.dimensions.payout_identity.proxy_payout < 1);
closeTo(sox.dimensions.payout_identity.target_payout, 0.112985, 1e-15, "SOX GIW payout");
assert.ok(sox.dimensions.payout_identity.relative_divergence > 0.05,
  "SOX's tracker and index payout identities must still be measurably apart");
assert.equal(sox.dimensions.payout_identity.passed, false);
assert.equal(auditPayoutIdentity(0.5, 0.525).passed, true);
assert.equal(auditPayoutIdentity(0.5, 0.526).passed, false);

assert.equal(rut.dimensions.book_roe_identity.passed, false);
assert.equal(rut.dimensions.book_roe_identity.reason, "book_or_roe_missing");
assert.equal(sox.dimensions.book_roe_identity.passed, false);
assert.equal(auditBookRoeIdentity({ target_book: 10, proxy_book: 1, target_roe: 0.2, proxy_roe: 0.2, basis_id: "x", proxy_basis_id: "x", as_of: "2026-01-01", proxy_as_of: "2026-01-01", validated: false }).passed, false);

assert.equal(rut.dimensions.historical_claim_identity.passed, false);
assert.equal(rut.dimensions.historical_claim_identity.scoreable, false);
assert.equal(sox.dimensions.historical_claim_identity.passed, false);
assert.equal(sox.dimensions.historical_claim_identity.scoreable, false);
assert.equal(sox.dimensions.historical_claim_identity.index_observation.date, "2026-06-26");
assert.equal(sox.dimensions.historical_claim_identity.proxy_observation.date, "2026-06-25");
closeTo(sox.dimensions.historical_claim_identity.point_in_time_ratio, 21.118953522393273, 1e-12, "SOX claim-date ratio");
closeTo(sox.dimensions.historical_claim_identity.point_in_time_ratio_relative_deviation, 0.0920118047834948, 1e-15, "SOX claim-date ratio deviation");
assert.equal(sox.dimensions.historical_claim_identity.reason, "claim_names_proxy_without_validated_target_translation");
assert.equal(sox.dimensions.historical_claim_identity.matched_trading_day_distance, 1);

const priceOnlyCannotPromote = auditProxyIdentity({
  ...currentInputs.RUT_IWM,
  index_rows: stableRows,
  proxy_rows: stableRows.map((row) => ({ date: row.date, value: 10, available_as_of: row.available_as_of })),
});
assert.equal(priceOnlyCannotPromote.dimensions.price_unit_bridge.passed, true);
assert.equal(priceOnlyCannotPromote.passed, false, "price identity must not promote other dimensions");

const dimensionsAreIndependent = auditProxyIdentity({
  target_identity: "INDEX",
  proxy_identity: "ETF",
  index_rows: stableRows,
  proxy_rows: stableRows.map((row) => ({ date: row.date, value: 10, available_as_of: row.available_as_of })),
  book_roe_evidence: { target_book: 100, proxy_book: 10, target_roe: 0.2, proxy_roe: 0.2, basis_id: "same", proxy_basis_id: "same", as_of: "2026-01-01", proxy_as_of: "2026-01-01", validated: true },
  proxy_payout: 0.2,
  target_payout: 0.2,
  historical_claim: { observation_at: "2026-01-30", available_as_of: "2026-01-30", asset: "INDEX" },
  historical_claim_translation_validated: false,
});
assert.equal(dimensionsAreIndependent.dimensions.price_unit_bridge.passed, true);
assert.equal(dimensionsAreIndependent.dimensions.book_roe_identity.passed, true);
assert.equal(dimensionsAreIndependent.dimensions.payout_identity.passed, true);
assert.equal(dimensionsAreIndependent.dimensions.historical_claim_identity.passed, true);
assert.equal(dimensionsAreIndependent.passed, true);
const brokenPayout = auditProxyIdentity({ ...currentInputs.RUT_IWM, proxy_payout: 0.2, target_payout: 0.2 });
assert.equal(brokenPayout.dimensions.price_unit_bridge.passed, true);
assert.equal(brokenPayout.dimensions.payout_identity.passed, true);
assert.equal(brokenPayout.dimensions.book_roe_identity.passed, false);
assert.equal(brokenPayout.passed, false);

const missingPointInTime = auditHistoricalClaimIdentity({
  claim: { observation_at: "2025-01-01", available_as_of: "2025-01-01", asset: "INDEX" },
  targetIdentity: "INDEX",
  proxyIdentity: "ETF",
  indexRows: [],
  proxyRows: [],
  priceBridge: dimensionsAreIndependent.dimensions.price_unit_bridge,
});
assert.equal(missingPointInTime.passed, false);
assert.equal(missingPointInTime.scoreable, false);
assert.equal(missingPointInTime.reason, "point_in_time_target_observation_missing");

const exactTargetClaim = auditHistoricalClaimIdentity({
  claim: { observation_at: "2026-01-15", available_as_of: "2026-01-15", asset: "INDEX" },
  targetIdentity: "INDEX",
  proxyIdentity: "ETF",
  indexRows: [{ date: "2026-01-15", value: 100, available_as_of: "2026-01-15" }],
  proxyRows: [],
  priceBridge: { passed: false, ratio_median: null },
  upstreamProxyGates: {},
});
assert.equal(exactTargetClaim.passed, true, "exact target claim must not depend on proxy prices or proxy gates");
assert.equal(exactTargetClaim.scoreable, true);
assert.equal(exactTargetClaim.proxy_observation, null);

const laterVintageTarget = auditHistoricalClaimIdentity({
  claim: { observation_at: "2026-01-15", available_as_of: "2026-01-15", asset: "INDEX" },
  targetIdentity: "INDEX",
  proxyIdentity: "ETF",
  indexRows: [{ date: "2026-01-15", value: 100, available_as_of: "2026-01-16" }],
  proxyRows: [],
});
assert.equal(laterVintageTarget.passed, false, "later-available target observation must fail PIT eligibility");
assert.equal(laterVintageTarget.reason, "point_in_time_target_observation_missing");

const translatedBase = {
  claim: { observation_at: "2026-01-16", available_as_of: "2026-01-16", asset: "ETF" },
  targetIdentity: "INDEX",
  proxyIdentity: "ETF",
  indexRows: [{ date: "2026-01-16", value: 100, available_as_of: "2026-01-16" }],
  proxyRows: [{ date: "2026-01-15", value: 10, available_as_of: "2026-01-15" }],
  priceBridge: { passed: true, ratio_median: 10 },
  translatedIdentityValidated: true,
  tradingDates: ["2026-01-13", "2026-01-14", "2026-01-15", "2026-01-16"],
  upstreamProxyGates: {
    price_unit_bridge: { passed: true },
    book_roe_identity: { passed: true },
    payout_identity: { passed: true },
  },
};
const translatedOneDay = auditHistoricalClaimIdentity(translatedBase);
assert.equal(translatedOneDay.passed, true, "validated proxy translation may use a one-trading-day match");
assert.equal(translatedOneDay.matched_trading_day_distance, 1);
assert.equal(auditHistoricalClaimIdentity({
  ...translatedBase,
  upstreamProxyGates: { ...translatedBase.upstreamProxyGates, payout_identity: { passed: false } },
}).passed, false, "translated claim requires every upstream proxy gate");
assert.equal(auditHistoricalClaimIdentity({
  ...translatedBase,
  proxyRows: [{ date: "2026-01-13", value: 10, available_as_of: "2026-01-13" }],
}).reason, "point_in_time_prices_more_than_one_trading_day_apart");
assert.equal(auditHistoricalClaimIdentity({
  ...translatedBase,
  proxyRows: [{ date: "2026-01-15", value: 10, available_as_of: "2026-01-17" }],
}).reason, "point_in_time_price_missing", "later-available proxy observation must fail PIT eligibility");

assert.equal(rut.passed, false);
assert.equal(sox.passed, false);
assert.equal(DEFAULT_PROXY_IDENTITY_THRESHOLDS.price_min_intersections, 30);
assert.equal(DEFAULT_PROXY_IDENTITY_THRESHOLDS.price_max_relative_deviation, 0.01);
assert.equal(DEFAULT_PROXY_IDENTITY_THRESHOLDS.payout_max_relative_divergence, 0.05);

console.log("fenok RIM proxy identity tests passed");
