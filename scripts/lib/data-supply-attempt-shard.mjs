import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  ATTEMPT_SHARD_SCHEMA,
  validateAttemptEvidence,
  validateAttemptShard,
} from "../build-data-supply-detection-floor.mjs";
import { DATA_SUPPLY_DETECTION_CONFIG } from "./data-supply-detection-config.mjs";

export { ATTEMPT_SHARD_SCHEMA };
const ATTEMPT_SCHEMA = "data-supply-detection-attempts/v1";

// Shared producer support. Keep this ordering identical to
// build-data-supply-detection-floor.mjs and
// fetch-treasury-tga.mjs. One producer member reduces every request to the
// single worst current-attempt tuple before publishing its lane shard.
export const STATUS_SEVERITY = Object.freeze({
  ready: 0,
  unobserved: 1,
  stale: 2,
  drift: 3,
  unavailable: 4,
});

const REASON_STATUS = Object.freeze({
  ok: "ready",
  workflow_unobserved: "unobserved",
  stale: "stale",
  schema_drift: "drift",
  decode_error: "drift",
  missing_artifact: "unavailable",
  transport_error: "unavailable",
  http_error: "unavailable",
  auth_error: "unavailable",
  rate_limited: "unavailable",
  empty_payload: "unavailable",
  future_source: "unavailable",
  unexpected_error: "unavailable",
});

export function attemptResult(reason, attempt, document = null) {
  return { status: REASON_STATUS[reason], reason, attempt, document };
}

export function returnedTuple({
  httpStatus,
  auth = "not_applicable",
  rateLimited = false,
  decode = "not_attempted",
  payload = "not_available",
  assertions = [],
}) {
  return {
    execution: "returned",
    exception_kind: null,
    http_status: httpStatus,
    auth,
    rate_limited: rateLimited,
    decode,
    payload,
    assertions,
  };
}

export function threwTuple(exceptionKind) {
  return {
    execution: "threw",
    exception_kind: exceptionKind,
    http_status: null,
    auth: "not_applicable",
    rate_limited: false,
    decode: "not_attempted",
    payload: "not_available",
    assertions: [],
  };
}

export function unobservedTuple() {
  return {
    execution: "unobserved",
    exception_kind: null,
    http_status: null,
    auth: "not_applicable",
    rate_limited: false,
    decode: "not_attempted",
    payload: "not_available",
    assertions: [],
  };
}

export function tupleStatus(tuple) {
  if (tuple?.execution === "unobserved") return "unobserved";
  if (tuple?.execution === "threw") return "unavailable";
  if (tuple?.execution !== "returned") throw new Error(`unknown tuple execution: ${tuple?.execution}`);
  const status = tuple.http_status;
  if (status === 401 || status === 403 || status === 429 || status < 200 || status >= 300) return "unavailable";
  if (tuple.decode === "error") return "drift";
  if (tuple.payload === "empty") return "unavailable";
  if (tuple.decode !== "ok" || tuple.payload !== "non_empty") return "unavailable";
  return tuple.assertions.some((assertion) => assertion.passed === false) ? "drift" : "ready";
}

export function foldWorstTuples(tuples) {
  if (!Array.isArray(tuples) || tuples.length === 0) throw new Error("cannot fold an empty tuple list");
  return tuples.reduce((worst, current) => (
    STATUS_SEVERITY[tupleStatus(current)] > STATUS_SEVERITY[tupleStatus(worst)] ? current : worst
  ));
}

export function buildAttemptRow({ laneId, memberId, tuple, attemptId = null, observedAt = null }) {
  if (!tuple || typeof tuple !== "object") throw new Error("attempt tuple is required");
  const unobserved = tuple.execution === "unobserved";
  const row = {
    lane_id: laneId,
    member_id: memberId,
    attempt_id: unobserved ? null : attemptId,
    observed_at: unobserved ? null : observedAt,
    execution: tuple.execution,
    exception_kind: tuple.exception_kind,
    http_status: tuple.http_status,
    auth: tuple.auth,
    rate_limited: tuple.rate_limited,
    decode: tuple.decode,
    payload: tuple.payload,
    assertions: tuple.assertions,
  };
  validateAttemptEvidence({ schema_version: ATTEMPT_SCHEMA, attempts: [row] });
  return row;
}

export function buildSingleLaneShard({ laneId, row }) {
  if (row?.lane_id !== laneId || row?.member_id !== null) throw new Error(`invalid single-lane row for ${laneId}`);
  const shard = { schema_version: ATTEMPT_SHARD_SCHEMA, lane_id: laneId, attempts: [structuredClone(row)] };
  validateAttemptShard(shard, laneId);
  return shard;
}

export function mergeCompositeShard({ laneId, memberIds, baseShard, row }) {
  if (!Array.isArray(memberIds) || memberIds.length === 0 || new Set(memberIds).size !== memberIds.length) {
    throw new Error("memberIds must be a non-empty unique list");
  }
  if (row?.lane_id !== laneId || !memberIds.includes(row?.member_id)) {
    throw new Error(`unknown member for ${laneId}: ${row?.member_id}`);
  }
  validateAttemptEvidence({ schema_version: ATTEMPT_SCHEMA, attempts: [row] });

  let attempts;
  if (baseShard === null || baseShard === undefined) {
    attempts = memberIds.map((memberId) => buildAttemptRow({
      laneId,
      memberId,
      tuple: unobservedTuple(),
    }));
  } else {
    validateAttemptShard(baseShard, laneId);
    attempts = baseShard.attempts.map((attempt) => structuredClone(attempt));
  }

  const byMember = new Map(attempts.map((attempt) => [attempt.member_id, attempt]));
  byMember.set(row.member_id, structuredClone(row));
  const shard = {
    schema_version: ATTEMPT_SHARD_SCHEMA,
    lane_id: laneId,
    attempts: memberIds.map((memberId) => byMember.get(memberId)),
  };
  validateAttemptShard(shard, laneId);
  return shard;
}

export function worstRequestResult(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("cannot fold an empty request result list");
  return rows.reduce((worst, current) => {
    if (!(current?.status in STATUS_SEVERITY)) throw new Error(`unknown request status: ${current?.status}`);
    if (!worst || STATUS_SEVERITY[current.status] > STATUS_SEVERITY[worst.status]) return current;
    return worst;
  }, null);
}

export function classifyHttpResponse(response, { authRequired = false, decodeBody = JSON.parse } = {}) {
  const statusCode = response?.statusCode;
  if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    return attemptResult("unexpected_error", threwTuple("unexpected"));
  }
  if (statusCode === 401 || statusCode === 403) {
    return attemptResult("auth_error", returnedTuple({ httpStatus: statusCode, auth: "rejected" }));
  }
  if (statusCode === 429) {
    return attemptResult("rate_limited", returnedTuple({
      httpStatus: statusCode,
      auth: authRequired ? "ok" : "not_applicable",
      rateLimited: true,
    }));
  }
  if (statusCode < 200 || statusCode >= 300) {
    return attemptResult("http_error", returnedTuple({ httpStatus: statusCode }));
  }

  let document;
  try {
    document = decodeBody(String(response.body ?? ""));
  } catch {
    return attemptResult("decode_error", returnedTuple({
      httpStatus: statusCode,
      auth: authRequired ? "ok" : "not_applicable",
      decode: "error",
    }));
  }
  return attemptResult("ok", returnedTuple({
    httpStatus: statusCode,
    auth: authRequired ? "ok" : "not_applicable",
    decode: "ok",
    payload: document == null || (Array.isArray(document) && document.length === 0)
      ? "empty"
      : "non_empty",
  }), document);
}

export function transportError(error) {
  return typeof error?.code === "string"
    || typeof error?.cause?.code === "string"
    || error?.name === "AbortError";
}

function pointerValue(document, pointer) {
  if (pointer === "") return document;
  return pointer.slice(1).split("/").reduce((value, token) => {
    if (value == null) return undefined;
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    return value[key];
  }, document);
}

function assertionPassed(assertion, document) {
  const value = pointerValue(document, assertion.pointer);
  const typeMatches = (candidate, expected) => {
    if (expected === "array") return Array.isArray(candidate);
    if (expected === "null") return candidate === null;
    return typeof candidate === expected && !Array.isArray(candidate);
  };
  const validDate = (candidate) => {
    if (typeof candidate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return false;
    const parsed = new Date(`${candidate}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate;
  };
  if (assertion.kind === "type") return typeMatches(value, assertion.expected);
  if (assertion.kind === "min_rows") return Array.isArray(value) && value.length >= assertion.min;
  if (assertion.kind === "object_fields") {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      && Object.entries(assertion.fields).every(([field, expected]) => typeMatches(value[field], expected));
  }
  if (assertion.kind === "object_array_fields") {
    if (!Array.isArray(value) || value.length < assertion.min) return false;
    const unique = new Set();
    for (const row of value) {
      if (row === null || typeof row !== "object" || Array.isArray(row)
        || !Object.entries(assertion.fields).every(([field, expected]) => typeMatches(row[field], expected))
        || assertion.non_empty_fields.some((field) => row[field].trim() === "")) return false;
      const identity = row[assertion.unique_by];
      const normalizedIdentity = typeof identity === "string" ? identity.trim().toUpperCase() : identity;
      if (unique.has(normalizedIdentity)) return false;
      unique.add(normalizedIdentity);
    }
    return true;
  }
  if (assertion.kind === "counted_identity_rows") {
    const count = value?.[assertion.count_field];
    const identities = value?.[assertion.identities_field];
    const rows = value?.[assertion.rows_field];
    if (!Number.isInteger(count) || count < assertion.min || !Array.isArray(identities) || !Array.isArray(rows)
      || identities.length !== count || rows.length !== count) return false;
    const unique = new Set();
    return rows.every((row, index) => {
      const identity = row?.[assertion.row_identity_field];
      const normalizedIdentity = typeof identity === "string" ? identity.trim().toUpperCase() : identity;
      if (row === null || typeof row !== "object" || Array.isArray(row)
        || row[assertion.row_rank_field] !== index + 1
        || assertion.row_string_fields.some((field) => typeof row[field] !== "string" || row[field].trim() === "")
        || identities[index] !== identity || unique.has(normalizedIdentity)) return false;
      unique.add(normalizedIdentity);
      return true;
    });
  }
  if (assertion.kind === "normalized_series_bundle") {
    return Array.isArray(value) && value.length > 0 && value.every((entry) => (
      entry !== null
      && typeof entry === "object"
      && !Array.isArray(entry)
      && typeof entry.source_key === "string"
      && entry.source_key.length > 0
      && typeof entry.file === "string"
      && entry.file.length > 0
      && Array.isArray(entry.series)
      && entry.series.length > 0
      && entry.series.every((row) => (
        row !== null
        && typeof row === "object"
        && !Array.isArray(row)
        && validDate(row.date)
        && Object.entries(row).some(([field, measurement]) => (
          field !== "date"
          && (
            (typeof measurement === "number" && Number.isFinite(measurement))
            || (typeof measurement === "string" && measurement.length > 0)
            || typeof measurement === "boolean"
          )
        ))
      ))
    ));
  }
  throw new Error(`unsupported endpoint assertion kind: ${assertion.kind}`);
}

export function evaluateEndpointAssertions(laneId, document) {
  const lane = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((candidate) => candidate.id === laneId);
  if (!lane) throw new Error(`unknown detection lane: ${laneId}`);
  return lane.endpoint_contract.assertions.map((assertion) => ({
    id: assertion.id,
    passed: assertionPassed(assertion, document),
  }));
}

export function classifyEndpointResponse(response, { laneId, authRequired = false, decodeBody = JSON.parse } = {}) {
  const classified = classifyHttpResponse(response, { authRequired, decodeBody });
  if (classified.status !== "ready") return classified;
  if (classified.attempt.payload === "empty") {
    return attemptResult("empty_payload", returnedTuple({
      httpStatus: classified.attempt.http_status,
      auth: classified.attempt.auth,
      decode: "ok",
      payload: "empty",
    }), classified.document);
  }
  const lane = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((candidate) => candidate.id === laneId);
  if (!lane) throw new Error(`unknown detection lane: ${laneId}`);
  const endpointAssertions = evaluateEndpointAssertions(laneId, classified.document);
  const endpointValue = lane.endpoint_contract.assertions.length === 1
    ? pointerValue(classified.document, lane.endpoint_contract.assertions[0].pointer)
    : classified.document;
  if (Array.isArray(endpointValue) && endpointValue.length === 0) {
    return attemptResult("empty_payload", returnedTuple({
      httpStatus: classified.attempt.http_status,
      auth: classified.attempt.auth,
      decode: "ok",
      payload: "empty",
    }), classified.document);
  }
  if (endpointAssertions.some((assertion) => !assertion.passed)) {
    return attemptResult("schema_drift", returnedTuple({
      httpStatus: classified.attempt.http_status,
      auth: classified.attempt.auth,
      decode: "ok",
      payload: "non_empty",
      assertions: endpointAssertions,
    }), classified.document);
  }
  return attemptResult("ok", returnedTuple({
    httpStatus: classified.attempt.http_status,
    auth: classified.attempt.auth,
    decode: "ok",
    payload: "non_empty",
    assertions: endpointAssertions,
  }), classified.document);
}

export function atomicWrite(filePath, bytes) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  let fd = null;
  try {
    fd = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.writeFileSync(fd, bytes, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temporary, filePath);
    const directoryFd = fs.openSync(directory, fs.constants.O_RDONLY);
    try {
      fs.fsyncSync(directoryFd);
    } finally {
      fs.closeSync(directoryFd);
    }
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

export function writeJsonAtomic(filePath, document) {
  atomicWrite(filePath, `${JSON.stringify(document, null, 2)}\n`);
}

export function validObservedAt(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && value.endsWith("Z");
}

export function defaultAttemptId(prefix, observedAt = new Date().toISOString()) {
  const stamp = observedAt.replace(/[^0-9a-z]/gi, "").toLowerCase();
  return `${prefix}-${stamp}-${randomBytes(4).toString("hex")}`;
}

export function writeAttemptShard({ laneId, attemptShardPath, observedAt, attemptId, result }) {
  if (!validObservedAt(observedAt)) throw new Error("observedAt must be RFC3339 UTC");
  if (!/^[a-z][a-z0-9_-]{0,95}$/.test(attemptId)) throw new Error("attemptId is invalid");
  const row = buildAttemptRow({ laneId, memberId: null, attemptId, observedAt, tuple: result.attempt });
  writeJsonAtomic(attemptShardPath, buildSingleLaneShard({ laneId, row }));
  return row;
}

function tupleFromAttemptRow(row) {
  return {
    execution: row.execution,
    exception_kind: row.exception_kind,
    http_status: row.http_status,
    auth: row.auth,
    rate_limited: row.rate_limited,
    decode: row.decode,
    payload: row.payload,
    assertions: structuredClone(row.assertions),
  };
}

export function writeMergedAttemptShard({
  laneId,
  attemptShardPath,
  observedAt,
  attemptId,
  result,
}) {
  if (!validObservedAt(observedAt)) throw new Error("observedAt must be RFC3339 UTC");
  if (!/^[a-z][a-z0-9_-]{0,95}$/.test(attemptId)) throw new Error("attemptId is invalid");
  let tuple = result.attempt;
  if (fs.existsSync(attemptShardPath)) {
    const base = JSON.parse(fs.readFileSync(attemptShardPath, "utf8"));
    validateAttemptShard(base, laneId);
    const current = base.attempts[0];
    if (current.attempt_id === attemptId) {
      const currentTuple = tupleFromAttemptRow(current);
      if (currentTuple.execution === "unobserved") {
        // The first batch may have had no contract-bearing request (for
        // example an empty tail or an expected provider-unavailable response).
        // A later observed tuple becomes the run evidence.
      } else if (tuple.execution === "unobserved") {
        // A neutral batch cannot erase evidence already observed in this run.
        tuple = currentTuple;
      } else {
        tuple = foldWorstTuples([currentTuple, tuple]);
      }
    }
  }
  const row = buildAttemptRow({ laneId, memberId: null, attemptId, observedAt, tuple });
  writeJsonAtomic(attemptShardPath, buildSingleLaneShard({ laneId, row }));
  return row;
}
