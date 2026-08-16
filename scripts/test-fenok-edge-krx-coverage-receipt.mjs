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
const activeCodes = activeKrxUniverseCodes(rows);
assert.deepEqual([...activeCodes].sort(), ["000660", "005930", "123456"]);

const receipt = buildKrxIssuerDailyCoverageReceipt({
  bridgeDocument: bridge,
  activeUniverseCodes: activeCodes,
  coveredCodes: ["005930", "000660", "123456", "NOT-A-KRX-ROW"],
  proofManifestSha256: "a".repeat(64),
});
assert.equal(receipt.schema_version, KRX_ISSUER_DAILY_RECEIPT_SCHEMA);
assert.equal(receipt.covered_count, 3);
assert.equal(receipt.denominator, 3);
assert.equal(receipt.missing_count, 0);
assert.equal(receipt.status, "ready");
assert.equal(receipt.raw_public, false);
assert.equal(receipt.per_issuer_rows, false);
assert.equal(receipt.active_universe_sha256, krxActiveUniverseSha256(activeCodes));
assert.equal(receipt.bridge_identity_sha256, krxBridgeIdentitySha256(bridge));
assert.equal(Object.hasOwn(receipt, "covered_codes"), false);

const boundBridge = { ...bridge, issuer_daily_coverage_receipt: receipt };
const valid = validateKrxIssuerDailyCoverageReceipt({
  bridgeDocument: boundBridge,
  activeUniverseCodes: activeCodes,
});
assert.equal(valid.ok, true);
assert.equal(valid.receipt.source_date, "2026-08-14");

const tamperedBridge = {
  ...boundBridge,
  latest_run: { run_id: "krx_daily_20260815" },
};
assert.equal(validateKrxIssuerDailyCoverageReceipt({
  bridgeDocument: tamperedBridge,
  activeUniverseCodes: activeCodes,
}).ok, false);
const badStatusBridge = {
  ...boundBridge,
  issuer_daily_coverage_receipt: { ...receipt, status: "partial" },
};
assert.equal(validateKrxIssuerDailyCoverageReceipt({
  bridgeDocument: badStatusBridge,
  activeUniverseCodes: activeCodes,
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
