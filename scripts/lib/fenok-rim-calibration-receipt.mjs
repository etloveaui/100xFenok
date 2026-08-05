import crypto from "node:crypto";

const SHA256 = /^[a-f0-9]{64}$/;

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeTimestamp(value, label) {
  const match = typeof value === "string" ? value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/,
  ) : null;
  if (!match) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) {
    throw new Error(`${label} must be a valid timestamp`);
  }
  if (zone !== "Z") {
    const offsetHours = Number(zone.slice(1, 3));
    const offsetMinutes = Number(zone.slice(4, 6));
    if (offsetHours > 14 || offsetMinutes > 59 || (offsetHours === 14 && offsetMinutes !== 0)) {
      throw new Error(`${label} must have a valid timezone offset`);
    }
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} must be a valid timestamp`);
  const normalized = new Date(milliseconds).toISOString();
  if (Number.isNaN(new Date(normalized).getTime())) throw new Error(`${label} must be a valid timestamp`);
  return normalized;
}

function compareSetRows(left, right) {
  const leftKey = typeof left?.id === "string" ? `id:${left.id}`
    : typeof left?.path === "string" ? `path:${left.path}` : null;
  const rightKey = typeof right?.id === "string" ? `id:${right.id}`
    : typeof right?.path === "string" ? `path:${right.path}` : null;
  return leftKey.localeCompare(rightKey);
}

const SET_ARRAY_KEYS = new Set(["sources", "evidence", "proxy_decisions"]);

function normalize(value, key = "value") {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${key} must be a finite number`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "string" && key.endsWith("_at")) {
    return normalizeTimestamp(value, key);
  }
  if (typeof value === "string" && key.endsWith("_as_of") && value.includes("T")) return normalizeTimestamp(value, key);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const rows = value.map((item) => normalize(item, key));
    const sortable = SET_ARRAY_KEYS.has(key) && rows.length > 0 && rows.every((item) => item && typeof item === "object"
      && (typeof item.id === "string" || typeof item.path === "string"));
    return sortable ? rows.map((item, index) => ({ item, index })).sort((left, right) => (
      compareSetRows(left.item, right.item) || left.index - right.index
    )).map(({ item }) => item) : rows;
  }
  if (!value || typeof value !== "object" || Buffer.isBuffer(value)) {
    throw new Error(`${key} must be canonical JSON data`);
  }
  return Object.fromEntries(Object.keys(value).sort().map((childKey) => [
    childKey,
    normalize(value[childKey], childKey),
  ]));
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

function bytesOf(value, label) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array || typeof value === "string") return value;
  throw new Error(`${label} bytes must be a Buffer, Uint8Array, or string`);
}

function uniqueRows(rows, label) {
  if (!Array.isArray(rows)) throw new Error(`${label} must be an array`);
  const ids = new Set();
  for (const row of rows) {
    if (typeof row?.id !== "string" || !row.id || ids.has(row.id)) throw new Error(`${label} ids must be unique non-empty strings`);
    ids.add(row.id);
  }
  return ids;
}

function uniqueIds(ids, label) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !id)) {
    throw new Error(`${label} must contain non-empty strings`);
  }
  if (new Set(ids).size !== ids.length) throw new Error(`${label} must not contain duplicates`);
  return [...ids].sort();
}

export function buildCalibrationReceipt(input) {
  if (!input || typeof input !== "object") throw new Error("calibration receipt input required");
  if (typeof input.algorithm?.id !== "string" || !input.algorithm.id
    || typeof input.algorithm?.version !== "string" || !input.algorithm.version
    || !isSha256(input.algorithm?.source_sha256)) {
    throw new Error("algorithm id, version, and source_sha256 required");
  }
  if (!Array.isArray(input.algorithm.sources) || input.algorithm.sources.length === 0
    || input.algorithm.sources.some((source) => typeof source?.path !== "string" || !source.path || !isSha256(source?.raw_sha256))) {
    throw new Error("algorithm sources with path and raw_sha256 required");
  }
  if (digest(canonicalJson(input.algorithm.sources)) !== input.algorithm.source_sha256) {
    throw new Error("algorithm source_sha256 must match the canonical source manifest");
  }
  canonicalJson(input.algorithm.parameters ?? {});
  const calibrationCutoffAt = input.calibration_cutoff_at === undefined ? null
    : normalizeTimestamp(input.calibration_cutoff_at, "calibration_cutoff_at");
  const componentEntries = input.calibration_components === undefined ? []
    : Object.entries(input.calibration_components);
  if (input.calibration_components !== undefined
    && (!input.calibration_components || Array.isArray(input.calibration_components)
      || typeof input.calibration_components !== "object" || componentEntries.length === 0
      || componentEntries.some(([id]) => !id))) {
    throw new Error("calibration_components must be a non-empty object");
  }
  const calibrationComponentSha256 = Object.fromEntries(componentEntries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, value]) => [id, digest(canonicalJson(value))]));

  const sourceIds = uniqueRows(input.sources ?? [], "sources");
  const evidenceIds = uniqueRows(input.evidence ?? [], "evidence");
  const proxyIds = uniqueRows(input.proxy_decisions ?? [], "proxy decisions");
  void sourceIds;
  void proxyIds;
  const fitEvidenceIds = uniqueIds(input.fit_evidence_ids ?? [], "fit_evidence_ids");
  const evaluationEvidenceIds = uniqueIds(input.evaluation_evidence_ids ?? [], "evaluation_evidence_ids");
  const fitStatus = fitEvidenceIds.length > 0 ? "applicable" : input.fit_evidence_status;
  const evaluationStatus = evaluationEvidenceIds.length > 0 ? "applicable" : input.evaluation_evidence_status;
  if (fitStatus !== "applicable" && fitStatus !== "not_applicable") {
    throw new Error("empty fit evidence requires fit_evidence_status=not_applicable");
  }
  if (evaluationStatus !== "applicable" && evaluationStatus !== "not_applicable") {
    throw new Error("empty evaluation evidence requires evaluation_evidence_status=not_applicable");
  }
  if (fitEvidenceIds.some((id) => evaluationEvidenceIds.includes(id))) {
    throw new Error("fit and evaluation evidence must be disjoint");
  }
  for (const id of [...fitEvidenceIds, ...evaluationEvidenceIds]) {
    if (!evidenceIds.has(id)) throw new Error(`unknown evidence id: ${id}`);
  }

  const sources = input.sources.map((source) => {
    if (typeof source.path !== "string" || !source.path) throw new Error(`${source.id} source path required`);
    const measurementSha256 = digest(canonicalJson(source.measurement));
    return {
      id: source.id,
      path: source.path,
      raw_sha256: digest(bytesOf(source.bytes, source.id)),
      measurement_sha256: measurementSha256,
    };
  });
  const evidence = input.evidence.map((row) => ({
    id: row.id,
    observation_at: normalizeTimestamp(row.observation_at, `${row.id} observation_at`),
    available_as_of: normalizeTimestamp(row.available_as_of, `${row.id} available_as_of`),
    point_in_time: row.point_in_time === true,
    measurement: normalize(row.measurement),
  }));
  const proxyDecisions = input.proxy_decisions.map((row) => normalize(row));

  if (typeof input.source_ledger?.path !== "string" || !input.source_ledger.path
    || !isSha256(input.source_ledger?.expected_sha256)) {
    throw new Error("declared source ledger path and expected_sha256 required");
  }
  const ledgerExists = input.source_ledger.bytes !== undefined;
  const sourceLedger = {
    exists: ledgerExists,
    path: input.source_ledger.path,
    resolved_scope: ledgerExists ? input.source_ledger.resolved_scope ?? null : null,
    expected_sha256: input.source_ledger.expected_sha256,
    raw_sha256: ledgerExists ? digest(bytesOf(input.source_ledger.bytes, "source ledger")) : null,
    ...(ledgerExists && input.source_ledger.measurement !== undefined ? {
      measurement_sha256: digest(canonicalJson(input.source_ledger.measurement)),
    } : {}),
  };

  const measurementPayload = {
    sources: sources.map(({ id, path, measurement_sha256 }) => ({ id, path, measurement_sha256 })),
    evidence,
    ...(sourceLedger.measurement_sha256 ? {
      source_ledger: { path: sourceLedger.path, measurement_sha256: sourceLedger.measurement_sha256 },
    } : {}),
  };
  const measurementReceiptSha256 = digest(canonicalJson(measurementPayload));
  const sourceSnapshotSha256 = digest(canonicalJson({
    sources: sources.map(({ id, path, raw_sha256 }) => ({ id, path, raw_sha256 })),
    source_ledger: sourceLedger,
  }));
  const proxyDecisionSha256 = digest(canonicalJson(proxyDecisions));
  const parameterSha256 = digest(canonicalJson(input.algorithm.parameters ?? {}));

  const underlyingProductionIdentified = input.external_promotion?.production_identified === true;
  const externalBlockers = [...(input.external_promotion?.blockers ?? [])].sort();
  if (!Array.isArray(input.external_promotion?.blockers)
    || externalBlockers.some((blocker) => typeof blocker !== "string" || !blocker)) {
    throw new Error("external promotion production status and blocker array required");
  }

  const blockers = [];
  if (!ledgerExists) blockers.push("missing_source_ledger");
  else if (sourceLedger.raw_sha256 !== sourceLedger.expected_sha256) blockers.push("source_ledger_hash_mismatch");
  if (evidence.some((row) => !row.point_in_time)) blockers.push("non_point_in_time_evidence");
  if (evidence.some((row) => Date.parse(row.available_as_of) > Date.parse(row.observation_at))) {
    blockers.push("future_evidence");
  }
  if (calibrationCutoffAt && evidence.some((row) => (
    Date.parse(row.observation_at) > Date.parse(calibrationCutoffAt)
    || Date.parse(row.available_as_of) > Date.parse(calibrationCutoffAt)
  ))) blockers.push("post_cutoff_evidence");
  if (!underlyingProductionIdentified) blockers.push("underlying_production_not_identified");
  blockers.push(...externalBlockers);
  const promotion = {
    requested: input.promotion_requested === true,
    underlying_production_identified: underlyingProductionIdentified,
    external_blockers: externalBlockers,
    eligible: input.promotion_requested === true && blockers.length === 0,
    blockers,
  };

  const generatedAt = normalizeTimestamp(input.generated_at, "generated_at");
  const semanticIdentity = {
    schema_version: "fenok-rim-calibration-receipt/v1",
    algorithm: normalize(input.algorithm),
    parameter_sha256: parameterSha256,
    ...(calibrationCutoffAt ? { calibration_cutoff_at: calibrationCutoffAt } : {}),
    ...(componentEntries.length ? { calibration_component_sha256: calibrationComponentSha256 } : {}),
    measurement_receipt_sha256: measurementReceiptSha256,
    proxy_decision_sha256: proxyDecisionSha256,
    fit_evidence_ids: fitEvidenceIds,
    evaluation_evidence_ids: evaluationEvidenceIds,
    evidence_set_contract: {
      fit: fitStatus,
      evaluation: evaluationStatus,
    },
    promotion,
  };
  const receiptSha256 = digest(canonicalJson(semanticIdentity));

  return {
    ...semanticIdentity,
    generated_at: generatedAt,
    receipt_sha256: receiptSha256,
    source_snapshot_sha256: sourceSnapshotSha256,
    sources: normalize(sources),
    source_ledger: sourceLedger,
  };
}

export function isSha256(value) {
  return typeof value === "string" && SHA256.test(value);
}
