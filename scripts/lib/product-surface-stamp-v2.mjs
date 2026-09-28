import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { canonicalJson } from "./json-canonical.mjs";
import { readVerifiedYahooIssuerPolicy } from "./yahoo-issuer-lifecycle.mjs";
import {
  PRODUCT_SURFACE_COLLECTION_MAX_AGE_HOURS,
  PRODUCT_SURFACE_DATELESS_REASON,
  PRODUCT_SURFACE_LEGACY_CLASSIFICATION,
  PRODUCT_SURFACE_LEGACY_DISPOSITION,
  PRODUCT_SURFACE_COVERAGE_SCHEMA_VERSION,
  PRODUCT_SURFACE_STAMP_VERSION,
  PRODUCT_SURFACE_LIFECYCLE_MEMBERSHIP_VERSION,
  REQUIRED_SURFACE_IDS,
} from "./kpi-contract-constants.mjs";
import { isRealCalendarDate } from "./market-calendar.mjs";

const HOUR_MS = 3600000;

function own(obj, key) {
  return obj != null && Object.prototype.hasOwnProperty.call(obj, key);
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}

function ratio(done, total) {
  return total === 0 ? 1 : Number((done / total).toFixed(6));
}

function hasExactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

const UBS_NOTICE_SYMBOLS = Object.freeze(["IWDL", "IWFL", "IWML", "MTUL", "QULL", "SCDL", "USML"]);
const ETF_PREFIX = "etf_detail:";
const POLICY_FACT_KEYS = ["symbol", "event", "effective_date", "effective_date_basis", "issuer", "primary_source_domain", "source_urls",
  "notice_date", "source_published_date", "settlement_amount_notice_date", "last_trading_date_expected", "settlement_date_expected", "payment_status"];

function productIssuerProof(members, nowIso, {dataRoot, proof = null, verificationNowIso = nowIso} = {}) {
  const evaluatedAt = proof?.evaluated_at ?? nowIso;
  const verified = readVerifiedYahooIssuerPolicy({dataRoot, nowIso: verificationNowIso, evaluatedAt, expectedSha256: proof?.sha256 ?? null});
  if (!verified.valid) throw new Error("canonical issuer policy is unverified");
  const bytes = fs.readFileSync(path.join(dataRoot, "computed", "data-supply", "etf-detail", "index.json"));
  const index = JSON.parse(bytes);
  if (index?.schema_version !== "data-supply-etf-detail-public-index/v1" || !index.entries
      || typeof index.entries !== "object" || Array.isArray(index.entries)) throw new Error("canonical ETF catalogue is invalid");
  const symbols = Object.keys(index.entries).sort();
  if (!symbols.length || symbols.some((symbol) => !/^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(symbol)
      || index.entries[symbol]?.ticker !== symbol)) throw new Error("canonical ETF catalogue identity is invalid");
  const ids = members.filter((row) => typeof row?.id === "string" && row.id.startsWith(ETF_PREFIX)).map((row) => row.id).sort();
  const expectedIds = symbols.map((symbol) => ETF_PREFIX + symbol).sort();
  if (canonicalJson(ids) !== canonicalJson(expectedIds) || new Set(ids).size !== ids.length) throw new Error("ETF catalogue membership is incomplete or duplicated");
  if (!UBS_NOTICE_SYMBOLS.every((symbol) => symbols.includes(symbol))) throw new Error("exact seven issuer notice members are required");
  const events = UBS_NOTICE_SYMBOLS.map((symbol) => {
    const row = verified.rows.get(symbol)?.row;
    if (row?.event !== "issuer_announced_redemption" || row.issuer !== "UBS AG" || row.primary_source_domain !== "etracs.ubs.com"
        || row.effective_date !== "2026-08-19" || row.effective_date_basis !== "issuer_expected_settlement"
        || row.last_trading_date_expected !== "2026-08-18" || row.settlement_date_expected !== "2026-08-19"
        || row.payment_status !== "not_verified" || row.notice_date !== "2026-07-16" || row.source_published_date !== "2026-07-16"
        || row.settlement_amount_notice_date !== "2026-08-17"
        || canonicalJson(row.source_urls) !== canonicalJson(["https://etracs.ubs.com/news/show-article/id/724", "https://etracs.ubs.com/news/show-article/id/727"])) {
      throw new Error("exact verified UBS notice facts are required");
    }
    return Object.fromEntries(POLICY_FACT_KEYS.map((key) => [key, row[key]]));
  });
  const expected = {policy_ref: "yahoo-issuer-lifecycle", sha256: verified.sha256, evaluated_at: evaluatedAt,
    catalogue_ref: "etf-detail-enrollment", catalogue_sha256: createHash("sha256").update(bytes).digest("hex"),
    inactive_symbols: [...UBS_NOTICE_SYMBOLS], events};
  if (proof !== null && canonicalJson(proof) !== canonicalJson(expected)) throw new Error("issuer membership proof differs from canonical facts");
  return {proof: expected, catalogueIds: expectedIds};
}

export function createProductSurfaceIssuerLifecycle(members, nowIso, {dataRoot = null} = {}) {
  // No verified-notice member: preserve the original v2 contract and avoid policy I/O.
  if (!members.some((row) => UBS_NOTICE_SYMBOLS.some((symbol) => row?.id === ETF_PREFIX + symbol))) {
    return {members, issuerLifecycle: null};
  }
  const {proof} = productIssuerProof(members, nowIso, {dataRoot});
  const inactive = new Set(proof.inactive_symbols.map((symbol) => ETF_PREFIX + symbol));
  return {members: members.map((row) => inactive.has(row.id) ? {...row, stamp_class: "issuer_notice_inactive"} : row), issuerLifecycle: proof};
}

export function deriveProductSurfaceStampEvidence(members, nowIso, {policyVersion = 2, issuerLifecycle = null, dataRoot = null, surfaceId = null, verificationNowIso = nowIso} = {}) {
  const nowMs = new Date(nowIso).getTime();
  if (!Array.isArray(members) || !Number.isFinite(nowMs)) throw new Error("product surface stamp evidence requires members[] and a valid clock");
  const errors = [];
  const v3 = policyVersion === PRODUCT_SURFACE_LIFECYCLE_MEMBERSHIP_VERSION;
  let verifiedInactive = new Set();
  let verifiedIssuerProof = null;
  let catalogueIds = [];
  if (policyVersion !== 2 && !v3) errors.push("unsupported product membership policy version");
  if (v3) {
    try {
      if (surfaceId !== "etf_center" || issuerLifecycle === null) throw new Error("v3 issuer membership requires ETF surface and explicit proof");
      const verified = productIssuerProof(members, nowIso, {dataRoot, proof: issuerLifecycle, verificationNowIso});
      catalogueIds = verified.catalogueIds;
      verifiedIssuerProof = verified.proof;
      verifiedInactive = new Set(verified.proof.inactive_symbols.map((symbol) => ETF_PREFIX + symbol));
      for (const row of members) {
        if (verifiedInactive.has(row.id) ? row.stamp_class !== "issuer_notice_inactive"
            : row.stamp_class === "issuer_notice_inactive" || (row.id.startsWith(ETF_PREFIX) && row.stamp_class !== "date_bearing")) {
          throw new Error("issuer inactive and required active memberships must be disjoint and exact");
        }
      }
    } catch {
      verifiedInactive = new Set();
      verifiedIssuerProof = null;
      errors.push("v3 issuer membership requires independently verified canonical policy and complete catalogue");
    }
  } else if (issuerLifecycle !== null) errors.push("issuer membership proof requires explicit policy version 3");
  const ids = new Set();
  for (const member of members) {
    const id = String(member?.id ?? "").trim();
    if (!id) errors.push("member id is required");
    else if (ids.has(id)) errors.push(`duplicate member ${id}`);
    ids.add(id);
    if (!['date_bearing', 'dateless_by_provider', ...(v3 ? ['issuer_notice_inactive'] : [])].includes(member?.stamp_class)) errors.push(`member ${id || "<unknown>"} has invalid stamp_class`);
  }

  const dateMembers = members.filter((m) => m?.stamp_class === "date_bearing"
    || (m?.stamp_class === "issuer_notice_inactive" && !verifiedInactive.has(m.id)));
  const datelessMembers = members.filter((m) => m?.stamp_class === "dateless_by_provider");
  const dates = [];
  for (const member of dateMembers) {
    if (member.source_as_of === null) continue;
    if (!isRealCalendarDate(member.source_as_of)) errors.push(`malformed true source date for ${member.id}: ${JSON.stringify(member.source_as_of)}`);
    else {
      dates.push(member.source_as_of);
      if (new Date(`${member.source_as_of}T00:00:00Z`).getTime() > nowMs) errors.push(`${member.id}: source_as_of is in the future`);
    }
  }
  for (const member of members.filter((row) => verifiedInactive.has(row.id))) {
    if (member.source_as_of !== null && (!isRealCalendarDate(member.source_as_of)
        || new Date(`${member.source_as_of}T00:00:00Z`).getTime() > nowMs)) errors.push(`${member.id}: inactive historical source date is invalid`);
  }
  const collectionTimes = [];
  let fresh = 0;
  let stale = 0;
  for (const member of datelessMembers) {
    if (member.source_as_of !== null) {
      errors.push(`${member.id}: provider now publishes a date; reclassify surface to date_bearing`);
    }
    if (typeof member.source_as_of_reason !== "string" || !member.source_as_of_reason.trim()) {
      errors.push(`${member.id}: dateless_by_provider source_as_of_reason must preserve the provider reason`);
    }
    if (member.recency_label !== PRODUCT_SURFACE_DATELESS_REASON) {
      errors.push(`${member.id}: dateless_by_provider recency_label must be ${JSON.stringify(PRODUCT_SURFACE_DATELESS_REASON)}`);
    }
    if (!validTimestamp(member.collected_at)) {
      errors.push(`${member.id}: dateless_by_provider collected_at must be a valid timestamp`);
      continue;
    }
    const collectedMs = new Date(member.collected_at).getTime();
    collectionTimes.push(member.collected_at);
    if (collectedMs > nowMs) errors.push(`${member.id}: collected_at is in the future`);
    else if ((nowMs - collectedMs) / HOUR_MS <= PRODUCT_SURFACE_COLLECTION_MAX_AGE_HOURS) fresh += 1;
    else stale += 1;
  }
  const sourceFloor = dates.length ? [...dates].sort()[0] : null;
  const collectionFloor = collectionTimes.length ? [...collectionTimes].sort((a, b) => new Date(a) - new Date(b))[0] : null;
  const collectionAgeHours = collectionFloor && Number.isFinite(nowMs)
    ? Number(((nowMs - new Date(collectionFloor).getTime()) / HOUR_MS).toFixed(3))
    : null;
  const dateRequired = dateMembers.length;
  const dateStamped = dates.length;
  let state = "stamped";
  if (errors.length) state = errors.some((e) => e.includes("future")) ? "future_anomaly" : "shape_error";
  else if (dateStamped < dateRequired) state = "pending_true_date";
  else if (stale > 0) state = "collection_stale";
  return {
    policy_version: policyVersion,
    members,
    ...(v3 ? {membership: {catalogue_count: catalogueIds.length, active_count: catalogueIds.length - verifiedInactive.size,
      inactive_count: verifiedInactive.size, active_member_ids: catalogueIds.filter((id) => !verifiedInactive.has(id)), inactive_member_ids: [...verifiedInactive].sort()},
      issuer_lifecycle: verifiedIssuerProof} : {}),
    date_bearing: {
      required_count: dateRequired,
      stamped_count: dateStamped,
      missing_count: dateRequired - dateStamped,
      coverage_ratio: ratio(dateStamped, dateRequired),
      source_floor_as_of: sourceFloor,
    },
    dateless_by_provider: {
      required_count: datelessMembers.length,
      collection_fresh_count: fresh,
      stale_count: stale,
      collected_at_floor: collectionFloor,
      collection_age_hours: collectionAgeHours,
      max_age_hours: PRODUCT_SURFACE_COLLECTION_MAX_AGE_HOURS,
      reason: PRODUCT_SURFACE_DATELESS_REASON,
    },
    state,
    shape_errors: errors,
  };
}

export function nextProductSurfaceLineageV2({ priorLineage = null, legacyV1 = null, kind, nowIso }) {
  if (!validTimestamp(nowIso)) throw new Error("product surface v2 lineage requires a valid clock");
  let legacy;
  let previousV2 = { pending_since: null, ever_stamped: false };
  if (priorLineage) {
    if (!hasExactKeys(priorLineage, ["active_version", "v2", "superseded_v1"])
      || priorLineage.active_version !== 2
      || !hasExactKeys(priorLineage.v2, ["pending_since", "ever_stamped"])
      || !hasExactKeys(priorLineage.superseded_v1, ["pending_since", "ever_stamped", "classification", "disposition"])) {
      throw new Error("prior product_surface v2 stamp_lineage missing/malformed; downgrade or deletion is not allowed");
    }
    legacy = JSON.parse(JSON.stringify(priorLineage.superseded_v1));
    previousV2 = { ...priorLineage.v2 };
  } else {
    legacy = {
      pending_since: legacyV1?.pending_since ?? null,
      ever_stamped: legacyV1?.ever_stamped === true,
      classification: PRODUCT_SURFACE_LEGACY_CLASSIFICATION,
      disposition: PRODUCT_SURFACE_LEGACY_DISPOSITION,
    };
  }
  for (const [name, marker] of [["v2", previousV2], ["superseded_v1", legacy]]) {
    if (typeof marker.ever_stamped !== "boolean" || (marker.pending_since !== null && !validTimestamp(marker.pending_since))) {
      throw new Error(`prior product_surface stamp_lineage.${name} malformed`);
    }
  }
  if (legacy.classification !== PRODUCT_SURFACE_LEGACY_CLASSIFICATION || legacy.disposition !== PRODUCT_SURFACE_LEGACY_DISPOSITION) {
    throw new Error("prior product_surface superseded_v1 classification/disposition mutated");
  }
  const stamped = kind === "stamped";
  const everStamped = previousV2.ever_stamped || stamped;
  return {
    lineage: {
      active_version: 2,
      v2: { pending_since: stamped ? null : (previousV2.pending_since ?? nowIso), ever_stamped: everStamped },
      superseded_v1: legacy,
    },
    regressed: !stamped && previousV2.ever_stamped === true,
  };
}

export function classifyProductSurfaceV2(requiredRows, nowIso, requiredIds, {dataRoot = null, verificationNowIso = nowIso} = {}) {
  const rows = Array.isArray(requiredRows) ? requiredRows : [];
  const counts = new Map();
  for (const row of rows) counts.set(row?.id, (counts.get(row?.id) || 0) + 1);
  const errors = [];
  for (const id of requiredIds) {
    const count = counts.get(id) || 0;
    if (count === 0) errors.push(`missing required surface ${id}`);
    else if (count > 1) errors.push(`duplicate required surface ${id}`);
  }
  if (errors.length) return { kind: "shape_error", source_date: null, shape_errors: errors,
    ...(rows.some((row) => row?.stamp_evidence?.policy_version === 3) ? {normalized_rows: rows.map((row) => row?.stamp_evidence?.policy_version === 3
      ? {...row, stamp_evidence: deriveProductSurfaceStampEvidence(row.stamp_evidence.members, nowIso,
        {policyVersion: 3, issuerLifecycle: row.stamp_evidence.issuer_lifecycle ?? null, dataRoot, surfaceId: row.id, verificationNowIso})} : row)} : {}) };
  const evidenceById = [];
  const normalizedRows = [];
  const stableProjection = (evidence) => ({
    policy_version: evidence?.policy_version,
    ...(evidence?.policy_version === 3 ? {membership: evidence?.membership, issuer_lifecycle: evidence?.issuer_lifecycle} : {}),
    date_bearing: evidence?.date_bearing,
    dateless_by_provider: evidence?.dateless_by_provider && {
      required_count: evidence.dateless_by_provider.required_count,
      collected_at_floor: evidence.dateless_by_provider.collected_at_floor,
      max_age_hours: evidence.dateless_by_provider.max_age_hours,
      reason: evidence.dateless_by_provider.reason,
    },
  });
  for (const id of requiredIds) {
    const row = rows.find((item) => item?.id === id);
    if (!own(row, "stamp_evidence")) {
      errors.push(`v2 surface ${id} lacks stamp_evidence`);
      continue;
    }
    const derived = deriveProductSurfaceStampEvidence(row.stamp_evidence?.members, nowIso, {
      policyVersion: row.stamp_evidence?.policy_version, issuerLifecycle: row.stamp_evidence?.issuer_lifecycle ?? null, dataRoot, surfaceId: id, verificationNowIso});
    if (JSON.stringify(stableProjection(derived)) !== JSON.stringify(stableProjection(row.stamp_evidence))) errors.push(`v2 surface ${id} stamp_evidence re-derivation mismatch`);
    if (row.source_as_of !== derived.date_bearing.source_floor_as_of) errors.push(`v2 surface ${id} source_as_of must equal true-date subset floor`);
    evidenceById.push({ id, evidence: derived });
    normalizedRows.push({ ...row, stamp_evidence: derived });
    errors.push(...derived.shape_errors.map((message) => `${id}: ${message}`));
  }
  if (errors.length) return { kind: errors.some((e) => e.includes("future")) ? "future" : "shape_error", source_date: null, shape_errors: errors,
    ...(rows.some((row) => row?.stamp_evidence?.policy_version === 3) ? {normalized_rows: normalizedRows} : {}) };
  if (evidenceById.some(({ evidence }) => evidence.state === "pending_true_date")) return { kind: "pending_true_date", source_date: null, normalized_rows: normalizedRows };
  if (evidenceById.some(({ evidence }) => evidence.state === "collection_stale")) return { kind: "collection_stale", source_date: null, normalized_rows: normalizedRows };
  const floors = evidenceById.map(({ evidence }) => evidence.date_bearing.source_floor_as_of).filter(Boolean);
  return { kind: "stamped", source_date: floors.length ? [...floors].sort()[0] : null, normalized_rows: normalizedRows };
}

export function validateProductSurfaceCoverageV2Artifact(payload, {dataRoot = null, verificationNowIso = payload?.generated_at} = {}) {
  const errors = [];
  if (payload?.schema_version !== PRODUCT_SURFACE_COVERAGE_SCHEMA_VERSION) {
    errors.push(`schema_version must be exactly ${PRODUCT_SURFACE_COVERAGE_SCHEMA_VERSION}`);
  }
  if (payload?.source_stamp_version !== PRODUCT_SURFACE_STAMP_VERSION) {
    errors.push(`source_stamp_version must be exactly numeric ${PRODUCT_SURFACE_STAMP_VERSION}`);
  }
  const generatedAt = payload?.generated_at;
  if (!validTimestamp(generatedAt)) errors.push("generated_at must be a valid timestamp");
  const surfaces = Array.isArray(payload?.surfaces) ? payload.surfaces : [];
  if (!Array.isArray(payload?.surfaces)) errors.push("surfaces must be an array");
  const counts = new Map();
  for (const surface of surfaces) counts.set(surface?.id, (counts.get(surface?.id) || 0) + 1);
  for (const id of REQUIRED_SURFACE_IDS) {
    const count = counts.get(id) || 0;
    if (count === 0) errors.push(`missing required v2 surface ${id}`);
    else if (count > 1) errors.push(`duplicate required v2 surface ${id}`);
  }
  if (!validTimestamp(generatedAt)) return errors;
  for (const id of REQUIRED_SURFACE_IDS) {
    const surface = surfaces.find((item) => item?.id === id);
    if (!surface || (counts.get(id) || 0) !== 1) continue;
    if (!own(surface, "source_as_of")) errors.push(`${id}: source_as_of own-property is required`);
    if (!own(surface, "stamp_evidence")) {
      errors.push(`${id}: stamp_evidence is required for v2`);
      continue;
    }
    const evidence = surface.stamp_evidence;
    const derived = deriveProductSurfaceStampEvidence(evidence?.members, generatedAt, {
      policyVersion: evidence?.policy_version, issuerLifecycle: evidence?.issuer_lifecycle ?? null, dataRoot, surfaceId: id, verificationNowIso});
    if (JSON.stringify(evidence) !== JSON.stringify(derived)) errors.push(`${id}: stamp_evidence must exactly re-derive at generated_at`);
    if (surface.source_as_of !== derived.date_bearing.source_floor_as_of) {
      errors.push(`${id}: source_as_of must equal the TRUE-date subset floor`);
    }
    if (derived.state === "shape_error" || derived.state === "future_anomaly") {
      errors.push(`${id}: stamp_evidence state ${derived.state} is deployment-blocking`);
    }
    if (surface.source_as_of === null) {
      if (typeof surface.source_as_of_reason !== "string" || !surface.source_as_of_reason.trim()) {
        errors.push(`${id}: null source_as_of requires a reason`);
      }
    } else if (surface.source_as_of_reason !== null && surface.source_as_of_reason !== undefined) {
      errors.push(`${id}: dated source_as_of must not carry a missing-date reason`);
    }
  }
  return errors;
}
