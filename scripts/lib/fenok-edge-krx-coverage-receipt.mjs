import { createHash } from "node:crypto";

import { canonicalJson } from "./json-canonical.mjs";

export const KRX_ISSUER_DAILY_RECEIPT_SCHEMA = "fenok_krx_issuer_daily_coverage_receipt/v1";

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
  proofManifestSha256,
}) {
  const denominator = new Set(sortedKrxCoverageCodes(activeUniverseCodes));
  const covered = new Set(sortedKrxCoverageCodes(coveredCodes));
  const coveredCount = [...covered].filter((code) => denominator.has(code)).length;
  const missingCount = Math.max(0, denominator.size - coveredCount);
  if (!validIsoDate(bridgeDocument?.as_of)
    || !validSha256(proofManifestSha256)
    || !bridgeDocument?.latest_run?.run_id
    || denominator.size === 0) {
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
}) {
  const receipt = bridgeDocument?.issuer_daily_coverage_receipt;
  if (receipt?.schema_version !== KRX_ISSUER_DAILY_RECEIPT_SCHEMA) return { ok: false, reason: "missing_or_wrong_schema" };
  if (!validIsoDate(receipt.source_date) || receipt.source_date !== bridgeDocument?.as_of) {
    return { ok: false, reason: "source_date_mismatch" };
  }
  if (receipt.generated_at !== bridgeDocument.generated_at
    || receipt.run_id !== bridgeDocument?.latest_run?.run_id) {
    return { ok: false, reason: "run_identity_mismatch" };
  }
  const denominator = new Set(sortedKrxCoverageCodes(activeUniverseCodes));
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
    || receiptDenominator !== denominator.size) {
    return { ok: false, reason: "count_mismatch" };
  }
  if (receipt.raw_public !== false || receipt.per_issuer_rows !== false) {
    return { ok: false, reason: "privacy_contract_mismatch" };
  }
  const expectedStatus = missingCount === 0 ? "ready" : "partial";
  if (receipt.status !== expectedStatus) return { ok: false, reason: "status_mismatch" };
  if (receipt.active_universe_sha256 !== krxActiveUniverseSha256(denominator)) {
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
