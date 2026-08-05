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

assert.ok(rut.dimensions.price_unit_bridge.intersection_count >= 30, "the bridge needs enough overlapping dates");
// Recomputed from live prices; pinning it exactly guarantees a break on every
// tracker refresh. The property that matters is that it stays stable.
assert.ok(Math.abs(rut.dimensions.price_unit_bridge.ratio_median / 10.122070245193717 - 1) < 0.02,
  "RUT/IWM median ratio must stay within 2% of its calibrated level");
assert.ok(rut.dimensions.price_unit_bridge.coefficient_of_variation < 0.01, "RUT/IWM ratio must stay tight");
assert.ok(rut.dimensions.price_unit_bridge.max_relative_deviation < 0.02, "RUT/IWM must have no large excursion");
assert.equal(rut.dimensions.price_unit_bridge.passed, true);

assert.ok(sox.dimensions.price_unit_bridge.intersection_count >= 30, "the bridge needs enough overlapping dates");
// Recomputed from live prices; pinning it exactly guarantees a break on every
// tracker refresh. The property that matters is that it stays stable.
assert.ok(Math.abs(sox.dimensions.price_unit_bridge.ratio_median / 23.259061773768508 - 1) < 0.02,
  "SOX/SOXX median ratio must stay within 2% of its calibrated level");
// SOXX is not the Philadelphia index, and this is where that shows: its ratio
// wanders several times more than Russell's and the bridge fails on it.
assert.ok(sox.dimensions.price_unit_bridge.coefficient_of_variation > rut.dimensions.price_unit_bridge.coefficient_of_variation,
  "SOX/SOXX must remain the looser of the two bridges");
assert.ok(sox.dimensions.price_unit_bridge.max_relative_deviation > 0.02, "SOX/SOXX must keep failing its deviation gate");
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

// RUT's valuation payout is direct LSEG. The proxy side below is rebuilt
// independently from IWM so this remains a useful divergence diagnostic.
assert.ok(rut.dimensions.payout_identity.proxy_payout > 0 && rut.dimensions.payout_identity.proxy_payout < 1);
closeTo(rut.dimensions.payout_identity.target_payout, 0.23716, 1e-15, "RUT LSEG payout");
assert.ok(rut.dimensions.payout_identity.relative_divergence > 0.05,
  "the independent IWM/LSEG payout divergence must remain measurable");
assert.equal(rut.dimensions.payout_identity.bridge_applicable, false);
assert.equal(rut.dimensions.payout_identity.scoreable, false);
assert.equal(rut.dimensions.payout_identity.passed, false);
assert.equal(rut.dimensions.payout_identity.reason, "direct_target_source_no_proxy_bridge");
assert.equal(currentInputs.RUT_IWM.payout_context.target_role, "direct_target");
assert.equal(currentInputs.RUT_IWM.payout_context.proxy_role, "proxy_tracker");
assert.equal(currentInputs.RUT_IWM.payout_context.valuation_payout, rut.dimensions.payout_identity.target_payout);
assert.ok(sox.dimensions.payout_identity.proxy_payout > 0 && sox.dimensions.payout_identity.proxy_payout < 1);
closeTo(sox.dimensions.payout_identity.target_payout, 0.112985, 1e-15, "SOX GIW payout");
assert.ok(sox.dimensions.payout_identity.relative_divergence > 0.05,
  "SOX's tracker and index payout identities must still be measurably apart");
assert.equal(sox.dimensions.payout_identity.passed, false);
assert.equal(auditPayoutIdentity(0.5, 0.525).passed, true);
assert.equal(auditPayoutIdentity(0.5, 0.526).passed, false);
const sameSourcePayout = auditPayoutIdentity(0.5, 0.5, DEFAULT_PROXY_IDENTITY_THRESHOLDS, {
  bridge_applicable: true,
  target_role: "direct_target",
  proxy_role: "direct_target",
  target_source_id: "same-publisher",
  proxy_source_id: "same-publisher",
});
assert.equal(sameSourcePayout.passed, false, "same-source equality must never pass as an identity bridge");
assert.equal(sameSourcePayout.scoreable, false);
assert.equal(sameSourcePayout.reason, "same_source_payout_identity_not_independent");

assert.equal(rut.dimensions.book_roe_identity.passed, false);
assert.equal(rut.dimensions.book_roe_identity.reason, "book_or_roe_missing");
assert.equal(sox.dimensions.book_roe_identity.passed, false);
assert.equal(auditBookRoeIdentity({ target_book: 10, proxy_book: 1, target_roe: 0.2, proxy_roe: 0.2, basis_id: "x", proxy_basis_id: "x", as_of: "2026-01-01", proxy_as_of: "2026-01-01", validated: false }).passed, false);

assert.equal(rut.dimensions.historical_claim_identity.passed, false);
assert.equal(rut.dimensions.historical_claim_identity.scoreable, false);
assert.equal(sox.dimensions.historical_claim_identity.passed, false);
assert.equal(sox.dimensions.historical_claim_identity.scoreable, false);
// The matched dates move whenever the tracker's history is refetched, so what
// is asserted is the matching rule, not the pair it happened to pick.
assert.ok(sox.dimensions.historical_claim_identity.index_observation.date <= "2026-06-28");
assert.ok(sox.dimensions.historical_claim_identity.proxy_observation.date <= "2026-06-28");
assert.ok(sox.dimensions.historical_claim_identity.point_in_time_ratio > 15 && sox.dimensions.historical_claim_identity.point_in_time_ratio < 30,
  "the claim-date ratio must stay in its measured range");
// The deviation itself moves with every refetch, so the assertion is that it
// is measured and reported. What carries the meaning is the verdict below:
// the claim names SOXX and there is no validated translation onto the index.
assert.ok(Number.isFinite(sox.dimensions.historical_claim_identity.point_in_time_ratio_relative_deviation),
  "the claim-date deviation must be measured, not absent");
assert.equal(sox.dimensions.historical_claim_identity.reason, "claim_names_proxy_without_validated_target_translation");
// Distance is zero when both series have the claim date and one when the
// matcher has to step back a day; either is a correct match, and which one it
// is depends on what the last fetch happened to cover.
assert.ok(sox.dimensions.historical_claim_identity.matched_trading_day_distance <= 1,
  "the claim must match within one trading day or not at all");

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
assert.equal(brokenPayout.dimensions.payout_identity.passed, false);
assert.equal(brokenPayout.dimensions.payout_identity.scoreable, false);
assert.equal(brokenPayout.dimensions.payout_identity.reason, "direct_target_source_no_proxy_bridge");
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
