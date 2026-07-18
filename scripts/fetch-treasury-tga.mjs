#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ATTEMPT_SHARD_SCHEMA } from "./build-data-supply-detection-floor.mjs";
import {
  LaneLkgStore,
  PROMOTION_CONTRACT_PROVIDER_OBSERVATION_V2,
  allNaturalRequestsFailed,
  buildProviderObservationV2,
  classifyLkgFailure,
  isNaturalScheduleRun,
  systemicLkgFailureReason,
} from "./lib/data-supply-lkg-store.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

export { ATTEMPT_SHARD_SCHEMA };
export const ACCOUNT_TYPES = Object.freeze([
  "Federal Reserve Account",
  "Treasury General Account (TGA)",
  "Treasury General Account (TGA) Opening Balance",
]);

const BUCKETS = Object.freeze([
  { key: "fra", name: ACCOUNT_TYPES[0] },
  { key: "tga", name: ACCOUNT_TYPES[1] },
  { key: "tgaOpening", name: ACCOUNT_TYPES[2] },
]);
const BASE_URL = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance";
const LANE_ID = "treasury_tga";
const LKG_KEY = "tga";
const SOURCE = "Treasury FiscalData";
const ENDPOINT = "accounting/dts/operating_cash_balance";
// FiscalData already limits each account-type response to 10,000 rows. Mirror
// that ceiling locally across the combined distinct-day series so persistence
// remains explicitly bounded without discarding the currently published
// 2005-present history.
export const MAX_SERIES_DAYS = 10_000;
export const TGA_PERSISTENCE_POLICY = Object.freeze({
  schema_version: "treasury-tga-bounded-persistence/v1",
  basis: "record_date",
  scope: "series_and_raw",
  max_series_days: MAX_SERIES_DAYS,
  eviction: "oldest_record_date_first",
});

// Keep this ordering identical to the detection-floor builder. A producer
// request is reduced with the same worst-result rule before its single lane
// attempt is emitted.
const STATUS_SEVERITY = Object.freeze({ ready: 0, unobserved: 1, stale: 2, drift: 3, unavailable: 4 });
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

function validSourceDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validBalance(value) {
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value));
}

function result(reason, attempt, document = null) {
  return { status: REASON_STATUS[reason], reason, attempt, document };
}

function returnedTuple({
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

function threwTuple(exceptionKind) {
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

export function buildUrl(accountType) {
  const url = new URL(BASE_URL);
  url.searchParams.set("filter", `account_type:eq:${accountType}`);
  url.searchParams.set("sort", "record_date");
  url.searchParams.set("page[size]", "10000");
  url.searchParams.set("fields", "record_date,open_today_bal");
  return url.toString();
}

export function requestBytes(url, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "User-Agent": "100xFenok-treasury-tga/1.0" } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({
        statusCode: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error("Treasury request timed out"), { code: "ETIMEDOUT" })));
    request.on("error", reject);
  });
}

function classifyResponse(response) {
  const statusCode = response?.statusCode;
  if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    return result("unexpected_error", threwTuple("unexpected"));
  }
  if (statusCode === 401 || statusCode === 403) {
    return result("auth_error", returnedTuple({ httpStatus: statusCode, auth: "rejected" }));
  }
  if (statusCode === 429) {
    return result("rate_limited", returnedTuple({ httpStatus: statusCode, rateLimited: true }));
  }
  if (statusCode < 200 || statusCode >= 300) {
    return result("http_error", returnedTuple({ httpStatus: statusCode }));
  }

  let document;
  try {
    document = JSON.parse(String(response.body ?? ""));
  } catch {
    return result("decode_error", returnedTuple({
      httpStatus: statusCode,
      decode: "error",
    }));
  }
  if (!Array.isArray(document?.data)) {
    return result("schema_drift", returnedTuple({
      httpStatus: statusCode,
      decode: "ok",
      payload: "non_empty",
      assertions: [{ id: "data_array", passed: false }],
    }), document);
  }
  if (document.data.length === 0) {
    return result("empty_payload", returnedTuple({
      httpStatus: statusCode,
      decode: "ok",
      payload: "empty",
    }), document);
  }
  if (!document.data.every((row) => (
    validSourceDate(row?.record_date)
    && row.open_today_bal !== "null"
    && validBalance(row.open_today_bal)
  ))) {
    return result("schema_drift", returnedTuple({
      httpStatus: statusCode,
      decode: "ok",
      payload: "non_empty",
      assertions: [{ id: "data_array", passed: true }],
    }), document);
  }
  return result("ok", returnedTuple({
    httpStatus: statusCode,
    decode: "ok",
    payload: "non_empty",
    assertions: [{ id: "data_array", passed: true }],
  }), document);
}

function transportError(error) {
  return typeof error?.code === "string" || error?.name === "AbortError";
}

async function evaluateRequest(request, bucket, controlledFailureKey) {
  if (bucket.key === controlledFailureKey) {
    return {
      ...result("transport_error", threwTuple("transport")),
      bucketKey: bucket.key,
      controlled: true,
    };
  }
  try {
    return {
      ...classifyResponse(await request(buildUrl(bucket.name), bucket.name)),
      bucketKey: bucket.key,
      controlled: false,
    };
  } catch (error) {
    const exceptionKind = transportError(error) ? "transport" : "unexpected";
    return {
      ...result(exceptionKind === "transport" ? "transport_error" : "unexpected_error", threwTuple(exceptionKind)),
      bucketKey: bucket.key,
      controlled: false,
    };
  }
}

export function worstRequestResult(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("cannot fold an empty request result list");
  return rows.reduce((worst, current) => {
    if (!(current?.status in STATUS_SEVERITY)) throw new Error(`unknown request status: ${current?.status}`);
    if (!worst || STATUS_SEVERITY[current.status] > STATUS_SEVERITY[worst.status]) return current;
    return worst;
  }, null);
}

function attemptRow(worst, observedAt, attemptId) {
  return {
    lane_id: "treasury_tga",
    member_id: null,
    attempt_id: attemptId,
    observed_at: observedAt,
    ...worst.attempt,
  };
}

function attemptShard(row) {
  return {
    schema_version: ATTEMPT_SHARD_SCHEMA,
    lane_id: "treasury_tga",
    attempts: [row],
  };
}

function atomicWrite(filePath, bytes) {
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

function writeJsonAtomic(filePath, document) {
  atomicWrite(filePath, `${JSON.stringify(document, null, 2)}\n`);
}

function buildOutput(documents, observedAt) {
  const raw = {};
  documents.forEach((document, index) => {
    raw[BUCKETS[index].key] = document.data;
  });
  const retained = retainLatestTgaSeriesDays(raw);
  if (retained.series.length === 0) return null;
  return {
    updated: observedAt,
    source: SOURCE,
    endpoint: ENDPOINT,
    persistence_policy: TGA_PERSISTENCE_POLICY,
    persistence_state: retained.stats,
    series: retained.series,
    raw: retained.raw,
  };
}

function projectSeriesFromRaw(raw) {
  const allData = [];
  for (const bucket of BUCKETS) {
    for (const row of raw?.[bucket.key] ?? []) {
      allData.push({ date: row.record_date, val: Number(row.open_today_bal) });
    }
  }
  if (allData.length === 0) return [];
  allData.sort((a, b) => a.date.localeCompare(b.date));
  const uniqueMap = new Map();
  for (const row of allData) uniqueMap.set(row.date, row.val);
  return Array.from(uniqueMap, ([date, val]) => ({ date, val }));
}

export function retainLatestTgaSeriesDays(raw, policy = TGA_PERSISTENCE_POLICY) {
  const maxSeriesDays = Number(policy?.max_series_days);
  if (!Number.isInteger(maxSeriesDays) || maxSeriesDays <= 0) {
    throw new Error("invalid Treasury TGA persistence max_series_days");
  }

  let providerRows = 0;
  for (const bucket of BUCKETS) {
    const rows = raw?.[bucket.key];
    if (!Array.isArray(rows)) throw new Error(`invalid Treasury TGA persistence bucket: ${bucket.key}`);
    providerRows += rows.length;
    for (const row of rows) {
      if (!validSourceDate(row?.record_date)) {
        throw new Error(`invalid Treasury TGA persistence record_date: ${String(row?.record_date ?? "<empty>")}`);
      }
    }
  }

  const projectedSeries = projectSeriesFromRaw(raw);
  const series = projectedSeries.slice(-maxSeriesDays);
  const retainedDates = new Set(series.map((row) => row.date));
  const retainedRaw = Object.fromEntries(BUCKETS.map((bucket) => [
    bucket.key,
    raw[bucket.key].filter((row) => retainedDates.has(row.record_date)),
  ]));
  const retainedRawRows = Object.values(retainedRaw).reduce((sum, rows) => sum + rows.length, 0);

  return {
    raw: retainedRaw,
    series,
    stats: {
      provider_rows: providerRows,
      valid_series_days: projectedSeries.length,
      retained_series_days: series.length,
      pruned_series_days: projectedSeries.length - series.length,
      retained_raw_rows: retainedRawRows,
      pruned_raw_rows: providerRows - retainedRawRows,
      oldest_retained_date: series[0]?.date ?? null,
      newest_retained_date: series.at(-1)?.date ?? null,
    },
  };
}

function validObservedAt(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && value.endsWith("Z");
}

function tgaSourceAsOf(document) {
  const dates = Array.isArray(document?.series)
    ? document.series.map((row) => row?.date).filter(validSourceDate)
    : [];
  return dates.length > 0 ? dates.sort().at(-1) : null;
}

function validTgaDocument(document) {
  if (document?.source !== SOURCE || document?.endpoint !== ENDPOINT || !validObservedAt(document?.updated)) return false;
  if (!Array.isArray(document?.series) || document.series.length === 0) return false;
  let priorDate = null;
  for (const row of document.series) {
    if (!validSourceDate(row?.date) || !Number.isFinite(row?.val)
      || (priorDate !== null && row.date <= priorDate)) return false;
    priorDate = row.date;
  }
  if (!document.raw || typeof document.raw !== "object" || Array.isArray(document.raw)) return false;
  if (JSON.stringify(Object.keys(document.raw).sort()) !== JSON.stringify(BUCKETS.map((bucket) => bucket.key).sort())) return false;
  for (const bucket of BUCKETS) {
    const rows = document.raw[bucket.key];
    if (!Array.isArray(rows) || rows.length === 0 || !rows.every((row) => (
      validSourceDate(row?.record_date)
      && row.open_today_bal !== "null"
      && validBalance(row.open_today_bal)
    ))) return false;
  }
  const expectedSeries = retainLatestTgaSeriesDays(document.raw).series;
  const hasPersistencePolicy = document.persistence_policy !== undefined;
  const hasPersistenceState = document.persistence_state !== undefined;
  if (hasPersistencePolicy !== hasPersistenceState) return false;
  if (hasPersistencePolicy) {
    if (JSON.stringify(document.persistence_policy) !== JSON.stringify(TGA_PERSISTENCE_POLICY)) return false;
    const state = document.persistence_state;
    const retainedRawRows = Object.values(document.raw).reduce((sum, rows) => sum + rows.length, 0);
    if (!Number.isInteger(state?.provider_rows) || state.provider_rows < retainedRawRows
      || !Number.isInteger(state?.valid_series_days) || state.valid_series_days < document.series.length
      || state.retained_series_days !== document.series.length
      || state.pruned_series_days !== state.valid_series_days - state.retained_series_days
      || state.retained_raw_rows !== retainedRawRows
      || state.pruned_raw_rows !== state.provider_rows - state.retained_raw_rows
      || state.oldest_retained_date !== document.series[0]?.date
      || state.newest_retained_date !== document.series.at(-1)?.date) return false;
  }
  return tgaSourceAsOf(document) !== null
    && JSON.stringify(document.series) === JSON.stringify(expectedSeries);
}

function readValidCanonical(canonicalPath) {
  if (!fs.existsSync(canonicalPath)) return null;
  const bytes = fs.readFileSync(canonicalPath);
  try {
    const document = JSON.parse(bytes.toString("utf8"));
    return validTgaDocument(document) ? { bytes, document } : null;
  } catch {
    return null;
  }
}

function controlledFailureKey(value, eventName) {
  const key = value.trim();
  if (!key) return "";
  if (eventName !== "workflow_dispatch") throw new Error("controlled failure requires workflow_dispatch");
  if (key !== LKG_KEY) throw new Error(`unknown controlled Treasury TGA key: ${key}`);
  return key;
}

export async function runTreasuryTga({
  repoRoot = REPO_ROOT,
  canonicalPath = path.join(repoRoot, "data", "macro", "tga.json"),
  publicPath = path.join(repoRoot, "100xfenok-next", "public", "data", "macro", "tga.json"),
  attemptShardPath = path.join(repoRoot, "data", "admin", "data-supply-state", "detection-attempts", "treasury_tga.json"),
  request = requestBytes,
  observedAt = new Date().toISOString(),
  attemptId = `tga-${new Date().toISOString().replace(/[^0-9a-z]/gi, "").toLowerCase()}-${randomBytes(4).toString("hex")}`,
  runId = process.env.GITHUB_RUN_ID || "local",
  runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1),
  eventName = process.env.GITHUB_EVENT_NAME || "local",
  controlledFailureKey: controlledFailureValue = process.env.INPUT_CONTROLLED_FAILURE_KEY || "",
} = {}) {
  if (!validObservedAt(observedAt)) throw new Error("observedAt must be RFC3339 UTC");
  if (!/^[a-z][a-z0-9_-]{0,95}$/.test(attemptId)) throw new Error("attemptId is invalid");
  const injectedKey = controlledFailureKey(controlledFailureValue, eventName);
  const lkgStore = new LaneLkgStore({ repoRoot, laneId: LANE_ID });
  const lkgArtifacts = [{
    key: LKG_KEY,
    canonicalPath,
    validateDocument: validTgaDocument,
    sourceAsOf: tgaSourceAsOf,
  }];
  const run = { runId: String(runId), runAttempt: Number(runAttempt), eventName, observedAt };

  const requestResults = await Promise.all(BUCKETS.map((bucket) => evaluateRequest(request, bucket, injectedKey)));
  const naturalFailures = requestResults.filter((requestResult) => (
    requestResult.controlled !== true && requestResult.status !== "ready"
  ));
  let worst = injectedKey && naturalFailures.length > 0
    ? worstRequestResult(naturalFailures)
    : worstRequestResult(requestResults);
  let output = null;
  if (worst.status === "ready") {
    output = buildOutput(requestResults.map((row) => row.document), observedAt);
    if (output === null) {
      worst = result("empty_payload", returnedTuple({
        httpStatus: 200,
        decode: "ok",
        payload: "empty",
      }));
    }
  }
  if (output !== null && Date.parse(tgaSourceAsOf(output)) > Date.parse(observedAt)) {
    output = null;
    worst = result("future_source", returnedTuple({
      httpStatus: 200,
      decode: "ok",
      payload: "non_empty",
      assertions: [{ id: "data_array", passed: true }],
    }));
  }

  const row = attemptRow(worst, observedAt, attemptId);
  writeJsonAtomic(attemptShardPath, attemptShard(row));
  if (worst.status !== "ready") {
    const systemicOutage = allNaturalRequestsFailed(requestResults, (requestResult) => requestResult.controlled === true);
    const nonTransientHttp = requestResults.some((requestResult) => (
      requestResult.reason === "http_error"
      && requestResult.attempt.http_status >= 400
      && requestResult.attempt.http_status < 500
    ));
    const naturalWorst = naturalFailures.length > 0 ? worstRequestResult(naturalFailures) : null;
    const failureReason = systemicLkgFailureReason([worst.reason, ...requestResults.map((requestResult) => requestResult.reason)])
      ?? (injectedKey && naturalFailures.length === 0 ? "controlled_failure" : naturalWorst?.reason ?? worst.reason);
    const failure = lkgStore.recordFailure({ artifacts: lkgArtifacts, run, reason: failureReason });
    const outcome = classifyLkgFailure({
      reason: failureReason,
      hasCompleteLkg: failure.hasCompleteLkg,
      systemic: systemicOutage || nonTransientHttp,
    });
    return { ok: false, reason: failureReason, updated: false, attempt: row, retrySet: failure.retrySet, ...outcome };
  }

  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  const candidate = {
    key: LKG_KEY,
    currentRelativePath: "data/macro/tga.json",
    payloadBytes: Buffer.from(serialized),
    sourceAsOf: tgaSourceAsOf(output),
    validateDocument: validTgaDocument,
    deriveSourceAsOf: tgaSourceAsOf,
    promotion_contract: PROMOTION_CONTRACT_PROVIDER_OBSERVATION_V2,
    provider_observation: buildProviderObservationV2({
      payloadBytes: Buffer.from(serialized),
      sourceAsOf: tgaSourceAsOf(output),
      validateDocument: validTgaDocument,
      deriveSourceAsOf: tgaSourceAsOf,
      candidateContainsObservation: (candidateDocument, providerDocument) => (
        JSON.stringify(candidateDocument) === JSON.stringify(providerDocument)
      ),
      run,
    }),
  };
  const recoveryState = lkgStore.stateSnapshot();
  if (recoveryState.items[LKG_KEY]?.retry === true && !isNaturalScheduleRun(run)) {
    return {
      ok: false,
      reason: "recovery_requires_schedule",
      updated: false,
      attempt: row,
      retrySet: recoveryState.retry_set,
      degraded: true,
      corrupt: false,
      exitCode: 0,
    };
  }
  const currentCanonical = readValidCanonical(canonicalPath);
  if (currentCanonical !== null && recoveryState.items[LKG_KEY]?.retry !== true) {
    const currentSourceAsOf = tgaSourceAsOf(currentCanonical.document);
    const currentEpoch = Date.parse(currentSourceAsOf);
    const candidateEpoch = Date.parse(candidate.sourceAsOf);
    if (candidateEpoch < currentEpoch) {
      const failure = lkgStore.recordFailure({ artifacts: lkgArtifacts, run, reason: "source_regression" });
      const outcome = classifyLkgFailure({ reason: "source_regression", hasCompleteLkg: failure.hasCompleteLkg });
      return {
        ok: false,
        reason: "source_regression",
        updated: false,
        attempt: row,
        retrySet: failure.retrySet,
        ...outcome,
      };
    }
    const currentHasPersistenceEnvelope = Object.prototype.hasOwnProperty.call(
      currentCanonical.document,
      "persistence_policy",
    ) && Object.prototype.hasOwnProperty.call(currentCanonical.document, "persistence_state");
    if (candidateEpoch === currentEpoch && currentHasPersistenceEnvelope) {
      if (!recoveryState.items[LKG_KEY]) {
        lkgStore.recordSuccess({
          artifacts: [{ ...candidate, payloadBytes: currentCanonical.bytes, sourceAsOf: currentSourceAsOf }],
          run,
        });
      }
      return {
        ok: true,
        reason: "unchanged_source",
        updated: false,
        attempt: row,
        points: currentCanonical.document.series.length,
        recovered: false,
      };
    }
  }
  const decisions = lkgStore.evaluatePromotionCandidates([candidate], run);
  const promotable = decisions.filter((decision) => decision.eligible).map((decision) => decision.artifact);
  if (promotable.length === 0) {
    const reason = decisions[0].reason;
    if (["foreign_writer_conflict", "recovery_not_advanced_by_provider"].includes(reason)) {
      lkgStore.recordPromotionDeferral({ artifacts: [candidate], run, reason });
    }
    return {
      ok: false,
      reason,
      updated: false,
      attempt: row,
      retrySet: lkgStore.stateSnapshot().retry_set,
      degraded: true,
      corrupt: false,
      exitCode: 0,
    };
  }
  atomicWrite(canonicalPath, serialized);
  atomicWrite(publicPath, serialized);
  const success = lkgStore.recordSuccess({ artifacts: promotable, run });
  const recovered = success.state.items[LKG_KEY]?.recovered_at === observedAt;
  return { ok: true, reason: "ok", updated: true, attempt: row, points: output.series.length, recovered };
}

async function main() {
  const resultValue = await runTreasuryTga();
  if (!resultValue.ok) {
    const prefix = resultValue.degraded ? "[degraded]" : "[corrupt]";
    const message = `${prefix} Treasury TGA ${resultValue.reason}; retry set: ${(resultValue.retrySet || []).join(", ") || "none"}`;
    if (resultValue.degraded) console.log(message);
    else console.error(message);
    process.exitCode = resultValue.exitCode ?? 2;
    return;
  }
  if (!resultValue.updated) {
    console.log(`Treasury TGA source unchanged; retained ${resultValue.points} points and current-attempt evidence`);
    return;
  }
  console.log(`Saved ${resultValue.points} Treasury TGA points and current-attempt evidence${resultValue.recovered ? "; recovered from LKG" : ""}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 2;
  });
}
