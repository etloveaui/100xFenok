#!/usr/bin/env node
import assert from "node:assert/strict";
import { activeKrxUniverseCodes, buildKrxIssuerDailyCoverage, currentListedKrxUniverseRows } from "./lib/fenok-edge-krx-coverage-receipt.mjs";

const sourceRows = [
  { ticker: "005930.KS", ticker_normalized: "005930", market: "KRX" },
  { ticker: "000660", market: "KRX" },
  { ticker: "012510", market: "KRX" },
  { ticker: "123456", market: "KOSDAQ" },
  { ticker: "AAPL", market: "US" },
];
const listedRows = currentListedKrxUniverseRows({
  activeUniverseRows: sourceRows,
  issuerMasterRowsByMarket: {
    KRX: [{ ISU_SRT_CD: "005930" }, { ISU_CD: "KR7000660001" }],
    KOSDAQ: [{ ISU_SRT_CD: "123456" }],
  },
});
assert.deepEqual([...activeKrxUniverseCodes(listedRows)].sort(), ["000660", "005930", "123456"]);
assert.equal(currentListedKrxUniverseRows({ activeUniverseRows: sourceRows, issuerMasterRowsByMarket: { KRX: [] } }), null);
const coverage = buildKrxIssuerDailyCoverage({
  sourceDate: "2026-09-29", activeUniverseRows: listedRows, sourceActiveUniverseRows: sourceRows,
  coveredCodesByMarket: { KRX: ["005930", "005930", "999999"], KOSDAQ: ["123456", "000660"] },
});
assert.equal(coverage.source_date, "2026-09-29");
assert.equal(coverage.covered_count, 2);
assert.equal(coverage.denominator, 3);
assert.equal(coverage.missing_count, 1);
assert.deepEqual(coverage.market_coverage, {
  KRX: { covered_count: 1, denominator: 2, missing_count: 1 },
  KOSDAQ: { covered_count: 1, denominator: 1, missing_count: 0 },
});
assert.deepEqual(coverage.listing_status_filter, {
  basis: "current_krx_issuer_master", source_denominator: 4, eligible_denominator: 3, excluded_count: 1,
  markets: { KRX: { source_denominator: 3, eligible_denominator: 2, excluded_count: 1 }, KOSDAQ: { source_denominator: 1, eligible_denominator: 1, excluded_count: 0 } },
});
assert.equal(coverage.status, "partial");
assert.equal(coverage.raw_public, false);
assert.equal(coverage.per_issuer_rows, false);
assert.equal(Object.keys(coverage).some((key) => /sha256|run|receipt|proof|codes/.test(key)), false);
assert.equal(buildKrxIssuerDailyCoverage({ sourceDate: "2026-02-30", activeUniverseRows: listedRows }), null);
console.log("test-fenok-edge-krx-coverage: ok");
