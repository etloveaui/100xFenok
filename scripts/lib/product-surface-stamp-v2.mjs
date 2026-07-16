import {
  PRODUCT_SURFACE_COLLECTION_MAX_AGE_HOURS,
  PRODUCT_SURFACE_DATELESS_REASON,
  PRODUCT_SURFACE_LEGACY_CLASSIFICATION,
  PRODUCT_SURFACE_LEGACY_DISPOSITION,
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

export function deriveProductSurfaceStampEvidence(members, nowIso) {
  const nowMs = new Date(nowIso).getTime();
  if (!Array.isArray(members) || !Number.isFinite(nowMs)) throw new Error("product surface stamp evidence requires members[] and a valid clock");
  const errors = [];
  const ids = new Set();
  for (const member of members) {
    const id = String(member?.id ?? "").trim();
    if (!id) errors.push("member id is required");
    else if (ids.has(id)) errors.push(`duplicate member ${id}`);
    ids.add(id);
    if (!['date_bearing', 'dateless_by_provider'].includes(member?.stamp_class)) errors.push(`member ${id || "<unknown>"} has invalid stamp_class`);
  }

  const dateMembers = members.filter((m) => m?.stamp_class === "date_bearing");
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
    policy_version: 2,
    members,
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

export function classifyProductSurfaceV2(requiredRows, nowIso, requiredIds) {
  const rows = Array.isArray(requiredRows) ? requiredRows : [];
  const counts = new Map();
  for (const row of rows) counts.set(row?.id, (counts.get(row?.id) || 0) + 1);
  const errors = [];
  for (const id of requiredIds) {
    const count = counts.get(id) || 0;
    if (count === 0) errors.push(`missing required surface ${id}`);
    else if (count > 1) errors.push(`duplicate required surface ${id}`);
  }
  if (errors.length) return { kind: "shape_error", source_date: null, shape_errors: errors };
  const evidenceById = [];
  const normalizedRows = [];
  const stableProjection = (evidence) => ({
    policy_version: evidence?.policy_version,
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
    const derived = deriveProductSurfaceStampEvidence(row.stamp_evidence?.members, nowIso);
    if (JSON.stringify(stableProjection(derived)) !== JSON.stringify(stableProjection(row.stamp_evidence))) errors.push(`v2 surface ${id} stamp_evidence re-derivation mismatch`);
    if (row.source_as_of !== derived.date_bearing.source_floor_as_of) errors.push(`v2 surface ${id} source_as_of must equal true-date subset floor`);
    evidenceById.push({ id, evidence: derived });
    normalizedRows.push({ ...row, stamp_evidence: derived });
    errors.push(...derived.shape_errors.map((message) => `${id}: ${message}`));
  }
  if (errors.length) return { kind: errors.some((e) => e.includes("future")) ? "future" : "shape_error", source_date: null, shape_errors: errors };
  if (evidenceById.some(({ evidence }) => evidence.state === "pending_true_date")) return { kind: "pending_true_date", source_date: null, normalized_rows: normalizedRows };
  if (evidenceById.some(({ evidence }) => evidence.state === "collection_stale")) return { kind: "collection_stale", source_date: null, normalized_rows: normalizedRows };
  const floors = evidenceById.map(({ evidence }) => evidence.date_bearing.source_floor_as_of).filter(Boolean);
  return { kind: "stamped", source_date: floors.length ? [...floors].sort()[0] : null, normalized_rows: normalizedRows };
}
