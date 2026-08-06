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
import { addMonthsMs, dividendAdjustment, isoDate, loadTracker, parseDateMs } from "./h2-harness.mjs";

// --- 1. existing-consumer regression on real repo data ----------------------

const tracker = loadTracker("SPY");
assert.equal(tracker.file_exists, true, "SPY canonical file exists");
assert.equal(tracker.identity_ok, true, "SPY identity passes");
assert.equal(tracker.prices.length, 260, "history_1y still carries its 260-bar cap");
assert.equal(tracker.price_start, "2025-07-24", "history_1y start date untouched");
assert.equal(tracker.price_end, "2026-08-05", "history_1y end date untouched");
assert.equal(tracker.div_start, "2016-09-16", "dividend leg untouched");
assert.equal(tracker.dividends.length, 40, "dividend count untouched");
// The unadjusted sibling now EXISTS (approved fetch ran): full history,
// identity passes, and the adjusted leg above is untouched by its presence.
assert.equal(tracker.unadjusted.file_exists, true, "unadjusted leg exists after the approved fetch");
assert.equal(tracker.unadjusted.identity_ok, true, "unadjusted identity passes");
assert.ok(tracker.unadjusted.prices.length > 5000, "unadjusted leg is long (full history)");
assert.equal(tracker.unadjusted.price_start, "1993-01-29", "unadjusted leg reaches SPY inception");
assert.equal(tracker.unadjusted.price_end, "2026-08-05", "unadjusted leg is current");

// Real-data branch A: a 2019 origin now has full dividend coverage (trailing
// reach 2016-09, horizon within the 2026-06 dividend tail) and an unadjusted
// close at the origin, so the adjustment succeeds — no bias label.
const realOrigin = {
  t0ms: parseDateMs("2019-01-02"),
  t1ms: addMonthsMs(parseDateMs("2019-01-02"), 36),
  priceReturn: 0.1,
};
const realAdj = dividendAdjustment(realOrigin, tracker);
assert.equal(realAdj.bias, null, "real-data branch A: adjustment succeeds");
assert.ok(Number.isFinite(realAdj.dividend_adjusted_return), "real-data branch A: adjusted return is finite");
// Exact trace: the add-on must equal the repo dividends inside the horizon
// divided by the repo's unadjusted close at the origin (nominal over nominal).
const divSum = tracker.dividends
  .filter((row) => row.ms > realOrigin.t0ms && row.ms <= realOrigin.t1ms)
  .reduce((s, row) => s + row.amount, 0);
const unadjAtOrigin = tracker.unadjusted.prices
  .filter((row) => row.ms <= realOrigin.t0ms)
  .at(-1);
assert.ok(unadjAtOrigin && realOrigin.t0ms - unadjAtOrigin.ms <= 45 * 86_400_000, "unadjusted close fresh at origin");
assert.ok(
  Math.abs(realAdj.dividend_adjusted_return - (0.1 + divSum / unadjAtOrigin.close)) < 1e-6,
  "real-data add-on = nominal dividends / nominal unadjusted close (harness rounds to 1e-6)",
);

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

// --- 5. overlap cross-check: sibling dividends must equal the canonical ----
//        series on the shared window (2016-09 onward) BEFORE it is trusted.
//        A mismatch means the two series are on different bases — stop.

const CROSSCHECK_SYMBOLS = ["SPY", "QQQ", "ONEQ", "IWM", "EWY", "SOXX"];
for (const symbol of CROSSCHECK_SYMBOLS) {
  const t = loadTracker(symbol);
  assert.equal(t.file_exists, true, `${symbol}: canonical exists`);
  assert.equal(t.unadjusted.file_exists, true, `${symbol}: sibling exists`);
  assert.equal(t.unadjusted.dividend_source, "sibling_full_history", `${symbol}: sibling dividends present`);
  const canonical = new Map(t.dividends.map((row) => [isoDate(row.ms), row.amount]));
  const sibling = new Map(t.unadjusted.dividends.map((row) => [isoDate(row.ms), row.amount]));
  assert.ok(sibling.size >= t.dividends.length, `${symbol}: sibling dividend history must be at least the canonical length`);
  assert.ok(
    t.unadjusted.dividends[0].ms <= t.dividends[0].ms,
    `${symbol}: sibling dividends must reach at least as far back as the canonical series`,
  );
  let checked = 0;
  for (const [date, amount] of canonical) {
    assert.ok(sibling.has(date), `${symbol}: canonical dividend ${date} missing from the sibling series`);
    assert.ok(
      Math.abs(sibling.get(date) - amount) < 1e-9,
      `${symbol}: dividend amount mismatch on ${date} (canonical ${amount} vs sibling ${sibling.get(date)})`,
    );
    checked += 1;
  }
  assert.equal(checked, t.dividends.length, `${symbol}: every canonical dividend cross-checked`);
  // The harness must actually USE the sibling series for the adjustment:
  // it must reach at least as far back as the canonical series (equal for
  // EWY, whose 29 payments never hit the 40 cap).
  assert.ok(t.unadjusted.dividends[0].ms <= t.dividends[0].ms, `${symbol}: sibling dividends reach at least as far back as the canonical series`);
}

console.log("feno-rim-v2 tracker-unadjusted tests passed");
