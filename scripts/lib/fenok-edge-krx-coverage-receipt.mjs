import { createHash } from "node:crypto";

import { canonicalJson } from "./json-canonical.mjs";

const KRX_ISSUER_DAILY_RECEIPT_SCHEMA_V1 = "fenok_krx_issuer_daily_coverage_receipt/v1";
const KRX_ISSUER_DAILY_RECEIPT_SCHEMA_V2 = "fenok_krx_issuer_daily_coverage_receipt/v2";
export const KRX_ISSUER_DAILY_RECEIPT_SCHEMA = "fenok_krx_issuer_daily_coverage_receipt/v3";
const KRX_COVERAGE_MARKETS = Object.freeze(["KRX", "KOSDAQ"]);

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function validIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function normalizeKrxCoverageCode(value) {
  return String(value ?? "").replace(/[^0-9A-Z]/giu, "").slice(0, 6).toUpperCase();
}

export function activeKrxUniverseCodes(rows) {
  return new Set(
    (Array.isArray(rows) ? rows : [])
      .filter((row) => row?.market === "KRX" || row?.market === "KOSDAQ")
      .map((row) => normalizeKrxCoverageCode(row?.ticker_normalized ?? row?.ticker))
      .filter(Boolean),
  );
}

function activeKrxUniverseCodesByMarket(rows) {
  const byMarket = Object.fromEntries(KRX_COVERAGE_MARKETS.map((market) => [market, new Set()]));
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!KRX_COVERAGE_MARKETS.includes(row?.market)) continue;
    const code = normalizeKrxCoverageCode(row?.ticker_normalized ?? row?.ticker);
    if (code) byMarket[row.market].add(code);
  }
  return byMarket;
}

function buildListingStatusFilter({ activeUniverseRows, sourceActiveUniverseRows }) {
  const eligibleCodes = activeKrxUniverseCodes(activeUniverseRows);
  const sourceCodes = activeKrxUniverseCodes(sourceActiveUniverseRows);
  const eligibleByMarket = activeKrxUniverseCodesByMarket(activeUniverseRows);
  const sourceByMarket = activeKrxUniverseCodesByMarket(sourceActiveUniverseRows);
  return {
    basis: "current_krx_issuer_master",
    source_denominator: sourceCodes.size,
    eligible_denominator: eligibleCodes.size,
    excluded_count: Math.max(0, sourceCodes.size - eligibleCodes.size),
    source_universe_sha256: krxActiveUniverseSha256(sourceCodes),
    markets: Object.fromEntries(KRX_COVERAGE_MARKETS.map((market) => [market, {
      source_denominator: sourceByMarket[market].size,
      eligible_denominator: eligibleByMarket[market].size,
      excluded_count: Math.max(0, sourceByMarket[market].size - eligibleByMarket[market].size),
    }])),
  };
}

function normalizedCoverageCodesByMarket(codesByMarket) {
  return Object.fromEntries(KRX_COVERAGE_MARKETS.map((market) => [
    market,
    new Set(sortedKrxCoverageCodes(codesByMarket?.[market])),
  ]));
}

function buildMarketCoverage({ activeUniverseRows, coveredCodesByMarket, coveredCount, denominator }) {
  const activeByMarket = activeKrxUniverseCodesByMarket(activeUniverseRows);
  const coveredByMarket = normalizedCoverageCodesByMarket(coveredCodesByMarket);
  const marketCoverage = Object.fromEntries(KRX_COVERAGE_MARKETS.map((market) => {
    const marketDenominator = activeByMarket[market].size;
    const marketCoveredCount = [...coveredByMarket[market]]
      .filter((code) => activeByMarket[market].has(code))
      .length;
    return [market, {
      covered_count: marketCoveredCount,
      denominator: marketDenominator,
      missing_count: Math.max(0, marketDenominator - marketCoveredCount),
    }];
  }));
  const splitCoveredCount = KRX_COVERAGE_MARKETS
    .reduce((sum, market) => sum + marketCoverage[market].covered_count, 0);
  const splitDenominator = KRX_COVERAGE_MARKETS
    .reduce((sum, market) => sum + marketCoverage[market].denominator, 0);
  return splitCoveredCount === coveredCount && splitDenominator === denominator
    ? marketCoverage
    : null;
}

function hasExactKeys(value, keys) {
  return value != null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function validMarketCoverage({ receipt, activeUniverseRows, coveredCount, receiptDenominator, missingCount }) {
  const marketCoverage = receipt?.market_coverage;
  const activeByMarket = activeKrxUniverseCodesByMarket(activeUniverseRows);
  if (!hasExactKeys(marketCoverage, KRX_COVERAGE_MARKETS)) return false;
  let splitCoveredCount = 0;
  let splitDenominator = 0;
  let splitMissingCount = 0;
  for (const market of KRX_COVERAGE_MARKETS) {
    const row = marketCoverage[market];
    if (!hasExactKeys(row, ["covered_count", "denominator", "missing_count"])) return false;
    const marketCoveredCount = Number(row.covered_count);
    const marketDenominator = Number(row.denominator);
    const marketMissingCount = Number(row.missing_count);
    if (!Number.isSafeInteger(marketCoveredCount)
      || !Number.isSafeInteger(marketDenominator)
      || !Number.isSafeInteger(marketMissingCount)
      || marketCoveredCount < 0
      || marketMissingCount < 0
      || marketCoveredCount + marketMissingCount !== marketDenominator
      || marketDenominator !== activeByMarket[market].size) {
      return false;
    }
    splitCoveredCount += marketCoveredCount;
    splitDenominator += marketDenominator;
    splitMissingCount += marketMissingCount;
  }
  return splitCoveredCount === coveredCount
    && splitDenominator === receiptDenominator
    && splitMissingCount === missingCount;
}

export function sortedKrxCoverageCodes(codes) {
  return [...(codes instanceof Set ? codes : new Set(codes ?? []))]
    .map(normalizeKrxCoverageCode)
    .filter(Boolean)
    .sort();
}

export function krxActiveUniverseSha256(codes) {
  return sha256(canonicalJson({ scope: "KRX/KOSDAQ active scoring universe", codes: sortedKrxCoverageCodes(codes) }));
}

export function krxBridgeIdentitySha256(bridgeDocument) {
  const { issuer_daily_coverage_receipt: _receipt, ...identity } = bridgeDocument ?? {};
  return sha256(canonicalJson(identity));
}

export function buildKrxIssuerDailyCoverageReceipt({
  bridgeDocument,
  activeUniverseCodes,
  coveredCodes,
  activeUniverseRows,
  sourceActiveUniverseRows = activeUniverseRows,
  coveredCodesByMarket,
  proofManifestSha256,
}) {
  const denominator = new Set(sortedKrxCoverageCodes(activeUniverseCodes));
  const covered = new Set(sortedKrxCoverageCodes(coveredCodes));
  const coveredCount = [...covered].filter((code) => denominator.has(code)).length;
  const missingCount = Math.max(0, denominator.size - coveredCount);
  const marketCoverage = buildMarketCoverage({
    activeUniverseRows,
    coveredCodesByMarket,
    coveredCount,
    denominator: denominator.size,
  });
  if (!validIsoDate(bridgeDocument?.as_of)
    || !validSha256(proofManifestSha256)
    || !bridgeDocument?.latest_run?.run_id
    || denominator.size === 0
    || marketCoverage === null) {
    return null;
  }

  return {
    schema_version: KRX_ISSUER_DAILY_RECEIPT_SCHEMA,
    generated_at: bridgeDocument.generated_at,
    source_date: bridgeDocument.as_of,
    run_id: bridgeDocument.latest_run.run_id,
    covered_count: coveredCount,
    denominator: denominator.size,
    missing_count: missingCount,
    market_coverage: marketCoverage,
    listing_status_filter: buildListingStatusFilter({ activeUniverseRows, sourceActiveUniverseRows }),
    status: missingCount === 0 ? "ready" : "partial",
    active_universe_sha256: krxActiveUniverseSha256(denominator),
    bridge_identity_sha256: krxBridgeIdentitySha256(bridgeDocument),
    proof_manifest_sha256: proofManifestSha256,
    raw_public: false,
    per_issuer_rows: false,
    evidence_basis: "private KRX stock/KOSDAQ issuer rows joined to the active KRX/KOSDAQ universe; no issuer rows retained",
  };
}

export function validateKrxIssuerDailyCoverageReceipt({
  bridgeDocument,
  activeUniverseCodes,
  activeUniverseRows,
}) {
  const receipt = bridgeDocument?.issuer_daily_coverage_receipt;
  const isLegacyV1 = receipt?.schema_version === KRX_ISSUER_DAILY_RECEIPT_SCHEMA_V1;
  const isLegacyV2 = receipt?.schema_version === KRX_ISSUER_DAILY_RECEIPT_SCHEMA_V2;
  const isCurrentV3 = receipt?.schema_version === KRX_ISSUER_DAILY_RECEIPT_SCHEMA;
  if (!isLegacyV1 && !isLegacyV2 && !isCurrentV3) return { ok: false, reason: "missing_or_wrong_schema" };
  if (!validIsoDate(receipt.source_date) || receipt.source_date !== bridgeDocument?.as_of) {
    return { ok: false, reason: "source_date_mismatch" };
  }
  if (receipt.generated_at !== bridgeDocument.generated_at
    || receipt.run_id !== bridgeDocument?.latest_run?.run_id) {
    return { ok: false, reason: "run_identity_mismatch" };
  }
  const sourceDenominator = new Set(sortedKrxCoverageCodes(
    Array.isArray(activeUniverseRows) ? activeKrxUniverseCodes(activeUniverseRows) : activeUniverseCodes,
  ));
  const coveredCount = Number(receipt.covered_count);
  const receiptDenominator = Number(receipt.denominator);
  const missingCount = Number(receipt.missing_count);
  if (!Number.isSafeInteger(coveredCount)
    || !Number.isSafeInteger(receiptDenominator)
    || !Number.isSafeInteger(missingCount)
    || coveredCount < 0
    || missingCount < 0
    || coveredCount > receiptDenominator
    || coveredCount + missingCount !== receiptDenominator
    || (!isCurrentV3 && receiptDenominator !== sourceDenominator.size)) {
    return { ok: false, reason: "count_mismatch" };
  }
  if (receipt.raw_public !== false || receipt.per_issuer_rows !== false) {
    return { ok: false, reason: "privacy_contract_mismatch" };
  }
  if (isLegacyV2 && !validMarketCoverage({
    receipt,
    activeUniverseRows,
    coveredCount,
    receiptDenominator,
    missingCount,
  })) {
    return { ok: false, reason: "market_coverage_mismatch" };
  }
  if (isCurrentV3) {
    const filter = receipt.listing_status_filter;
    const sourceByMarket = activeKrxUniverseCodesByMarket(activeUniverseRows);
    if (!hasExactKeys(filter, [
      "basis",
      "source_denominator",
      "eligible_denominator",
      "excluded_count",
      "source_universe_sha256",
      "markets",
    ])
      || filter.basis !== "current_krx_issuer_master"
      || filter.source_denominator !== sourceDenominator.size
      || filter.eligible_denominator !== receiptDenominator
      || filter.excluded_count !== filter.source_denominator - filter.eligible_denominator
      || filter.excluded_count < 0
      || filter.source_universe_sha256 !== krxActiveUniverseSha256(sourceDenominator)
      || !hasExactKeys(filter.markets, KRX_COVERAGE_MARKETS)) {
      return { ok: false, reason: "listing_status_filter_mismatch" };
    }
    for (const market of KRX_COVERAGE_MARKETS) {
      const statusRow = filter.markets[market];
      const coverageRow = receipt.market_coverage?.[market];
      if (!hasExactKeys(statusRow, ["source_denominator", "eligible_denominator", "excluded_count"])
        || !hasExactKeys(coverageRow, ["covered_count", "denominator", "missing_count"])
        || statusRow.source_denominator !== sourceByMarket[market].size
        || statusRow.eligible_denominator !== coverageRow?.denominator
        || statusRow.excluded_count !== statusRow.source_denominator - statusRow.eligible_denominator
        || statusRow.excluded_count < 0
        || !Number.isSafeInteger(coverageRow.covered_count)
        || !Number.isSafeInteger(coverageRow.denominator)
        || !Number.isSafeInteger(coverageRow.missing_count)
        || coverageRow.covered_count < 0
        || coverageRow.missing_count < 0
        || coverageRow.covered_count + coverageRow.missing_count !== coverageRow.denominator) {
        return { ok: false, reason: "listing_status_market_mismatch" };
      }
    }
    const eligibleSplit = KRX_COVERAGE_MARKETS.reduce(
      (sum, market) => sum + receipt.market_coverage[market].denominator,
      0,
    );
    const coveredSplit = KRX_COVERAGE_MARKETS.reduce(
      (sum, market) => sum + receipt.market_coverage[market].covered_count,
      0,
    );
    const missingSplit = KRX_COVERAGE_MARKETS.reduce(
      (sum, market) => sum + receipt.market_coverage[market].missing_count,
      0,
    );
    if (eligibleSplit !== receiptDenominator
      || coveredSplit !== coveredCount
      || missingSplit !== missingCount
      || !validSha256(receipt.active_universe_sha256)) {
      return { ok: false, reason: "listed_universe_mismatch" };
    }
  }
  const expectedStatus = missingCount === 0 ? "ready" : "partial";
  if (receipt.status !== expectedStatus) return { ok: false, reason: "status_mismatch" };
  if (!isCurrentV3 && receipt.active_universe_sha256 !== krxActiveUniverseSha256(sourceDenominator)) {
    return { ok: false, reason: "active_universe_digest_mismatch" };
  }
  if (receipt.bridge_identity_sha256 !== krxBridgeIdentitySha256(bridgeDocument)) {
    return { ok: false, reason: "bridge_identity_digest_mismatch" };
  }
  if (!validSha256(receipt.proof_manifest_sha256)) return { ok: false, reason: "proof_digest_missing" };
  return { ok: true, receipt };
}

export function selectKrxIssuerDailyCoverageEvidence({
  rawProofDates = [],
  rawCoveredCount = 0,
  denominator = 0,
  receiptValidation = null,
}) {
  const normalizedDates = [...new Set(rawProofDates.filter(validIsoDate))].sort();
  if (normalizedDates.length > 0) {
    const coveredCount = Math.max(0, Number(rawCoveredCount) || 0);
    return {
      source: "raw_private_run",
      source_date: normalizedDates.at(-1),
      covered_count: coveredCount,
      denominator,
      missing_count: Math.max(0, denominator - coveredCount),
    };
  }
  if (receiptValidation?.ok === true) {
    return {
      source: "bound_bridge_receipt",
      source_date: receiptValidation.receipt.source_date,
      covered_count: receiptValidation.receipt.covered_count,
      denominator: receiptValidation.receipt.denominator,
      missing_count: receiptValidation.receipt.missing_count,
    };
  }
  return {
    source: "none",
    source_date: null,
    covered_count: 0,
    denominator,
    missing_count: Math.max(0, denominator),
  };
}
