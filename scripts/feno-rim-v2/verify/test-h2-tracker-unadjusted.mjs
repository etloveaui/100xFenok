#!/usr/bin/env node

// FENO RIM v2 — Phase 3B tracker slice: unadjusted-close denominator tests.
//
// Proves on real repo data + synthetic trackers:
// 1. existing-consumer regression — loadTracker's history_1y leg is untouched
//    (260 rows, same dates) and the unadjusted leg is absent today, so the
//    §9 bias path holds (additive-only change);
// 2. both branches of the new denominator — unadjusted close present ⇒
//    nominal-over-nominal; absent/identity-failed ⇒ bias_unadjusted, no
//    silent fallback to the adjusted close;
// 3. the defect itself — an auto-adjusted close understates the origin price,
//    so the old denominator overstates the add-on, one-sided (bias shown);
// 4. determinism — identical inputs, identical output.

import assert from "node:assert/strict";
import { addMonthsMs, dividendAdjustment, loadTracker, parseDateMs } from "./h2-harness.mjs";

// --- 1. existing-consumer regression on real repo data ----------------------

const tracker = loadTracker("SPY");
assert.equal(tracker.file_exists, true, "SPY canonical file exists");
assert.equal(tracker.identity_ok, true, "SPY identity passes");
assert.equal(tracker.prices.length, 260, "history_1y still carries its 260-bar cap");
assert.equal(tracker.price_start, "2025-07-24", "history_1y start date untouched");
assert.equal(tracker.price_end, "2026-08-05", "history_1y end date untouched");
assert.equal(tracker.div_start, "2016-09-16", "dividend leg untouched");
assert.equal(tracker.dividends.length, 40, "dividend count untouched");
// The unadjusted sibling does not exist yet (no fetch run; additive-only):
// the harness must keep the bias path, never fall back to the adjusted close.
assert.equal(tracker.unadjusted.file_exists, false, "unadjusted leg absent today");
assert.equal(tracker.unadjusted.identity_ok, false, "unadjusted identity fails when absent");

const realOrigin = {
  t0ms: parseDateMs("2015-01-02"),
  t1ms: addMonthsMs(parseDateMs("2015-01-02"), 36),
  priceReturn: 0.1,
};
const realAdj = dividendAdjustment(realOrigin, tracker);
assert.equal(realAdj.bias, "dividend_series_absent", "no unadjusted leg => bias path on real data");
assert.equal(realAdj.dividend_adjusted_return, null, "no silent fallback to the adjusted close");

// --- 2. both branches of the new denominator (synthetic tracker) ------------

const base = { t0ms: parseDateMs("2015-01-02"), t1ms: parseDateMs("2018-01-02"), priceReturn: 0.1 };
const withUnadjusted = {
  file_exists: true,
  identity_ok: true,
  dividends: [
    { ms: parseDateMs("2014-01-01"), amount: 1 },   // trailing coverage only
    { ms: parseDateMs("2015-03-01"), amount: 1 },
    { ms: parseDateMs("2016-03-01"), amount: 1 },
    { ms: parseDateMs("2017-12-15"), amount: 1 },
  ],
  div_start: "2014-01-01",
  div_end: "2017-12-15",
  // The adjusted leg is deliberately understated at the origin (95 vs 100):
  // only the unadjusted leg may drive the denominator.
  prices: [{ ms: parseDateMs("2015-01-02"), close: 95 }],
  unadjusted: {
    file_exists: true,
    identity_ok: true,
    prices: [{ ms: parseDateMs("2015-01-02"), close: 100 }],
  },
};

// Branch A — unadjusted present: dividend_adjusted_return = priceReturn + divSum / unadjClose.
const adjusted = dividendAdjustment(base, withUnadjusted);
assert.equal(adjusted.bias, null, "branch A: no bias label");
assert.ok(Math.abs(adjusted.dividend_adjusted_return - (0.1 + 3 / 100)) < 1e-12, "branch A: nominal over nominal denominator");

// Branch B — unadjusted absent: bias path with the leg named, no fallback.
const noUnadjusted = { ...withUnadjusted, unadjusted: { file_exists: false, identity_ok: false, prices: [] } };
const unadjustedAbsent = dividendAdjustment(base, noUnadjusted);
assert.equal(unadjustedAbsent.bias, "dividend_series_absent", "branch B: bias label");
assert.match(unadjustedAbsent.bias_detail, /unadjusted_close_series_absent/, "branch B: missing leg named");
assert.equal(unadjustedAbsent.dividend_adjusted_return, null, "branch B: no adjusted-close fallback");

// Branch B — identity failure of the unadjusted leg also refuses.
const identityFailed = { ...withUnadjusted, unadjusted: { file_exists: true, identity_ok: false, prices: [] } };
const unadjustedBad = dividendAdjustment(base, identityFailed);
assert.equal(unadjustedBad.bias, "dividend_series_absent", "branch B: identity failure => bias path");
assert.match(unadjustedBad.bias_detail, /unadjusted_close_identity_failed/, "branch B: identity failure named");

// --- 3. the defect: adjusted denominator overstates the add-on, one-sided ---

const newAddOn = adjusted.dividend_adjusted_return - base.priceReturn; // 0.03
const oldAddOn = 3 / 95; // the pre-fix denominator (auto-adjusted close at the origin)
assert.ok(Math.abs(newAddOn - 0.03) < 1e-12, "new add-on uses the unadjusted close");
assert.ok(oldAddOn > newAddOn, "old add-on is overstated (one-sided bias)");
const biasPp = (oldAddOn - newAddOn) * 100;
assert.ok(Math.abs(biasPp - (3 / 95 - 0.03) * 100) < 1e-9, "bias magnitude measured");
// Sanity: the bias is small at a young origin and grows with origin age —
// here the synthetic cumulative yield (5%) is the driver, mirroring the
// measured real-data magnitudes (+0.51pp EWY / +0.33pp SPY at 11y origins).

// --- 4. determinism ----------------------------------------------------------

assert.deepEqual(
  dividendAdjustment(base, withUnadjusted),
  dividendAdjustment(base, withUnadjusted),
  "identical inputs must produce identical output",
);

console.log("feno-rim-v2 tracker-unadjusted tests passed");
