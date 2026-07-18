#!/usr/bin/env node
/**
 * Focused unit test for the Taiwan universe classification + carry-over
 * denominator reconciliation used by build-fenok-edge-coverage-index.mjs.
 * First test coverage for that build script.
 */

import {
  hasTaiwanTickerSuffix,
  isExplicitTaiwanRow,
  reconcileTaiwanCurrentUniverseDenominator,
  selectExplicitTaiwanRows,
  selectTaiwanTickerAnomalies,
} from "./lib/taiwan-universe.mjs";

let failures = 0;
function assert(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

// pct mirrors build-fenok-edge-coverage-index.mjs pct(): null on falsy total,
// else percent rounded to 2 decimals.
function pct(count, total) {
  if (!Number(total)) return null;
  return Number(((Number(count) / Number(total)) * 100).toFixed(2));
}

// --- Explicit-Taiwan classification (upstream market/market_scope based) ---
assert(isExplicitTaiwanRow({ market: "TW" }), "market=TW is explicit Taiwan");
assert(isExplicitTaiwanRow({ market: "taiwan" }), "market=taiwan is explicit Taiwan (case-insensitive)");
assert(isExplicitTaiwanRow({ market: "TPEX" }), "market=TPEX is explicit Taiwan");
assert(isExplicitTaiwanRow({ market_scope: "taiwan" }), "market_scope=taiwan is explicit Taiwan");
assert(!isExplicitTaiwanRow({ market: "US_CLASS", market_scope: "us" }), "US_CLASS/us is NOT explicit Taiwan");
assert(!isExplicitTaiwanRow({ market: "US" }), "US is NOT explicit Taiwan");

const explicitRows = selectExplicitTaiwanRows([
  { ticker: "2330.TW", market: "TW" },
  { ticker: "AAPL", market: "US" },
  { ticker: "0700.HK", market: "HKEX" },
]);
assert(explicitRows.length === 1 && explicitRows[0].ticker === "2330.TW", "selectExplicitTaiwanRows keeps only market-tagged Taiwan rows");

// --- Ticker-suffix recognition ---
assert(hasTaiwanTickerSuffix({ ticker: "2454.TW" }), ".TW suffix recognized");
assert(hasTaiwanTickerSuffix({ ticker: "1234.TWO" }), ".TWO suffix recognized");
assert(hasTaiwanTickerSuffix({ ticker_normalized: "2454-TW" }), "normalized -TW suffix recognized");
assert(!hasTaiwanTickerSuffix({ ticker: "AAPL", ticker_normalized: "AAPL" }), "plain US ticker has no Taiwan suffix");

// --- Anomaly detection: suffix-Taiwan rows NOT in the explicit bucket ---
// The MediaTek case: .TW suffix but upstream-tagged US_CLASS/us -> surfaced, not reclassified.
const rows = [
  { ticker: "2454.TW", ticker_normalized: "2454-TW", market: "US_CLASS", market_scope: "us", company: "Mediatek" },
  { ticker: "2330.TW", ticker_normalized: "2330-TW", market: "TW", market_scope: "taiwan", company: "TSMC" },
  { ticker: "AAPL", ticker_normalized: "AAPL", market: "US", company: "Apple" },
];
const explicit = selectExplicitTaiwanRows(rows);
const anomalies = selectTaiwanTickerAnomalies(rows, explicit);
assert(explicit.length === 1 && explicit[0].ticker === "2330.TW", "properly-tagged TW row lands in explicit bucket");
assert(anomalies.length === 1, "exactly one anomaly (the mis-tagged .TW row)");
assert(anomalies[0].ticker === "2454.TW", "anomaly is the mis-tagged .TW ticker");
assert(
  anomalies[0].company === "Mediatek"
    && anomalies[0].market === "US_CLASS"
    && anomalies[0].market_scope === "us"
    && anomalies[0].ticker_normalized === "2454-TW",
  "anomaly carries ticker/ticker_normalized/market/market_scope/company",
);
assert(
  Object.keys(anomalies[0]).sort().join(",") === "company,market,market_scope,ticker,ticker_normalized",
  "anomaly shape is exactly the documented fields",
);
// A properly-tagged suffix-Taiwan row must NOT be flagged as an anomaly.
assert(
  !anomalies.some((a) => a.ticker === "2330.TW"),
  "explicit-Taiwan suffix row is not an anomaly",
);

// --- Carry-over denominator reconciliation (the 1173 vs 1177 fix) ---
// A stale carried row (frozen denominator 1173) must be re-stamped to the
// current active_scoring_universe.total that its label claims.
const stale = {
  id: "taiwan_current_universe",
  covered_count: 0,
  denominator: 1173,
  denominator_label: "active_scoring_universe.total",
  coverage_pct: 0,
  active_scoring_coverage_pct: 0,
};
reconcileTaiwanCurrentUniverseDenominator(stale, 1177, pct);
assert(stale.denominator === 1177, "denominator re-stamped to current active total");
assert(stale.coverage_pct === pct(0, 1177), "coverage_pct recomputed against current total");
assert(stale.active_scoring_coverage_pct === pct(0, 1177), "active_scoring_coverage_pct recomputed");

// Non-zero count reconciles pct too.
const withCount = { covered_count: 1, denominator: 1173, coverage_pct: 0, active_scoring_coverage_pct: 0 };
reconcileTaiwanCurrentUniverseDenominator(withCount, 1177, pct);
assert(withCount.denominator === 1177, "denominator re-stamped with non-zero count");
assert(withCount.coverage_pct === pct(1, 1177), "coverage_pct = pct(count, current total)");

// A row that already matches the current total is left consistent (idempotent).
const fresh = { covered_count: 0, denominator: 1177, coverage_pct: 0, active_scoring_coverage_pct: 0 };
reconcileTaiwanCurrentUniverseDenominator(fresh, 1177, pct);
assert(fresh.denominator === 1177, "already-current denominator stays 1177");

// Null-safe.
assert(reconcileTaiwanCurrentUniverseDenominator(null, 1177, pct) === null, "null row is a no-op");

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, suite: "build-fenok-edge-coverage-index taiwan classification + denominator" }, null, 2));
