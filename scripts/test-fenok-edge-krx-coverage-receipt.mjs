#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  KRX_ISSUER_DAILY_RECEIPT_SCHEMA,
  activeKrxUniverseCodes,
  buildKrxIssuerDailyCoverageReceipt,
  krxActiveUniverseSha256,
  krxBridgeIdentitySha256,
  selectKrxIssuerDailyCoverageEvidence,
  validateKrxIssuerDailyCoverageReceipt,
} from "./lib/fenok-edge-krx-coverage-receipt.mjs";

const bridge = {
  schema_version: "fenok-edge-korea-krx-bridge/v1",
  generated_at: "2026-08-17T11:00:00.000Z",
  market: "Korea",
  source: "KRX_OPEN_API",
  as_of: "2026-08-14",
  raw_public: false,
  latest_run: { run_id: "krx_daily_20260814" },
};
const rows = [
  { ticker: "005930", market: "KRX" },
  { ticker: "000660", market: "KRX" },
  { ticker: "123456", market: "KOSDAQ" },
  { ticker: "AAPL", market: "US" },
];
const sourceRows = [
  ...rows,
  { ticker: "012510.KS", ticker_normalized: "012510", market: "KRX" },
];
const activeCodes = activeKrxUniverseCodes(rows);
assert.deepEqual([...activeCodes].sort(), ["000660", "005930", "123456"]);

const receipt = buildKrxIssuerDailyCoverageReceipt({
  bridgeDocument: bridge,
  activeUniverseCodes: activeCodes,
  coveredCodes: ["005930", "000660", "123456", "NOT-A-KRX-ROW"],
  activeUniverseRows: rows,
  sourceActiveUniverseRows: sourceRows,
  coveredCodesByMarket: {
    KRX: ["005930", "000660", "NOT-A-KRX-ROW"],
    KOSDAQ: ["123456"],
  },
  proofManifestSha256: "a".repeat(64),
});
assert.equal(receipt.schema_version, "fenok_krx_issuer_daily_coverage_receipt/v3");
assert.equal(receipt.schema_version, KRX_ISSUER_DAILY_RECEIPT_SCHEMA);
assert.equal(receipt.covered_count, 3);
assert.equal(receipt.denominator, 3);
assert.equal(receipt.missing_count, 0);
assert.deepEqual(receipt.market_coverage, {
  KRX: { covered_count: 2, denominator: 2, missing_count: 0 },
  KOSDAQ: { covered_count: 1, denominator: 1, missing_count: 0 },
});
assert.equal(receipt.status, "ready");
assert.equal(receipt.raw_public, false);
assert.equal(receipt.per_issuer_rows, false);
assert.equal(receipt.active_universe_sha256, krxActiveUniverseSha256(activeCodes));
assert.deepEqual(receipt.listing_status_filter, {
  basis: "current_krx_issuer_master",
  source_denominator: 4,
  eligible_denominator: 3,
  excluded_count: 1,
  source_universe_sha256: krxActiveUniverseSha256(activeKrxUniverseCodes(sourceRows)),
  markets: {
    KRX: { source_denominator: 3, eligible_denominator: 2, excluded_count: 1 },
    KOSDAQ: { source_denominator: 1, eligible_denominator: 1, excluded_count: 0 },
  },
});
assert.equal(receipt.bridge_identity_sha256, krxBridgeIdentitySha256(bridge));
assert.equal(Object.hasOwn(receipt, "covered_codes"), false);

const boundBridge = { ...bridge, issuer_daily_coverage_receipt: receipt };
const valid = validateKrxIssuerDailyCoverageReceipt({
  bridgeDocument: boundBridge,
  activeUniverseCodes: activeKrxUniverseCodes(sourceRows),
  activeUniverseRows: sourceRows,
});
assert.equal(valid.ok, true);
assert.equal(valid.receipt.source_date, "2026-08-14");

const { market_coverage: _marketCoverage, ...legacyReceipt } = receipt;
const legacyBridge = {
  ...bridge,
  issuer_daily_coverage_receipt: {
    ...legacyReceipt,
    schema_version: "fenok_krx_issuer_daily_coverage_receipt/v1",
  },
};
assert.equal(validateKrxIssuerDailyCoverageReceipt({
  bridgeDocument: legacyBridge,
  activeUniverseCodes: activeCodes,
  activeUniverseRows: rows,
}).ok, true);

const tamperedBridge = {
  ...boundBridge,
  latest_run: { run_id: "krx_daily_20260815" },
};
assert.equal(validateKrxIssuerDailyCoverageReceipt({
  bridgeDocument: tamperedBridge,
  activeUniverseCodes: activeCodes,
  activeUniverseRows: rows,
}).ok, false);
const badStatusBridge = {
  ...boundBridge,
  issuer_daily_coverage_receipt: { ...receipt, status: "partial" },
};
assert.equal(validateKrxIssuerDailyCoverageReceipt({
  bridgeDocument: badStatusBridge,
  activeUniverseCodes: activeCodes,
  activeUniverseRows: rows,
}).ok, false);
const badMarketCoverageBridge = {
  ...boundBridge,
  issuer_daily_coverage_receipt: {
    ...receipt,
    market_coverage: {
      ...receipt.market_coverage,
      KOSDAQ: { covered_count: 0, denominator: 1, missing_count: 0 },
    },
  },
};
assert.equal(validateKrxIssuerDailyCoverageReceipt({
  bridgeDocument: badMarketCoverageBridge,
  activeUniverseCodes: activeCodes,
  activeUniverseRows: rows,
}).ok, false);

assert.deepEqual(
  selectKrxIssuerDailyCoverageEvidence({
    rawProofDates: [],
    rawCoveredCount: 0,
    denominator: 3,
    receiptValidation: valid,
  }),
  {
    source: "bound_bridge_receipt",
    source_date: "2026-08-14",
    covered_count: 3,
    denominator: 3,
    missing_count: 0,
  },
);
assert.equal(
  selectKrxIssuerDailyCoverageEvidence({ rawProofDates: [], denominator: 3 }).covered_count,
  0,
);
assert.equal(
  selectKrxIssuerDailyCoverageEvidence({ rawProofDates: ["2026-08-14"], rawCoveredCount: 2, denominator: 3 }).source,
  "raw_private_run",
);

console.log("test-fenok-edge-krx-coverage-receipt: ok");
