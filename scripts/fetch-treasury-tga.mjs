#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ATTEMPT_SHARD_SCHEMA } from "./build-data-supply-detection-floor.mjs";

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

async function evaluateRequest(request, accountType) {
  try {
    return classifyResponse(await request(buildUrl(accountType), accountType));
  } catch (error) {
    const exceptionKind = transportError(error) ? "transport" : "unexpected";
    return result(exceptionKind === "transport" ? "transport_error" : "unexpected_error", threwTuple(exceptionKind));
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
  const allData = [];
  const raw = {};
  documents.forEach((document, index) => {
    const rows = document.data;
    raw[BUCKETS[index].key] = rows;
    for (const row of rows) {
      if (typeof row?.record_date !== "string" || row.open_today_bal == null || row.open_today_bal === "null") continue;
      const value = Number.parseFloat(row.open_today_bal);
      if (!Number.isFinite(value)) continue;
      allData.push({ date: row.record_date, val: value });
    }
  });
  if (allData.length === 0) return null;
  allData.sort((a, b) => a.date.localeCompare(b.date));
  const uniqueMap = new Map();
  for (const row of allData) uniqueMap.set(row.date, row.val);
  return {
    updated: observedAt,
    source: "Treasury FiscalData",
    endpoint: "accounting/dts/operating_cash_balance",
    series: Array.from(uniqueMap, ([date, val]) => ({ date, val })),
    raw,
  };
}

function validObservedAt(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && value.endsWith("Z");
}

export async function runTreasuryTga({
  canonicalPath = path.join(REPO_ROOT, "data", "macro", "tga.json"),
  publicPath = path.join(REPO_ROOT, "100xfenok-next", "public", "data", "macro", "tga.json"),
  attemptShardPath = path.join(REPO_ROOT, "data", "admin", "data-supply-state", "detection-attempts", "treasury_tga.json"),
  request = requestBytes,
  observedAt = new Date().toISOString(),
  attemptId = `tga-${new Date().toISOString().replace(/[^0-9a-z]/gi, "").toLowerCase()}-${randomBytes(4).toString("hex")}`,
} = {}) {
  if (!validObservedAt(observedAt)) throw new Error("observedAt must be RFC3339 UTC");
  if (!/^[a-z][a-z0-9_-]{0,95}$/.test(attemptId)) throw new Error("attemptId is invalid");

  const requestResults = await Promise.all(ACCOUNT_TYPES.map((accountType) => evaluateRequest(request, accountType)));
  let worst = worstRequestResult(requestResults);
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

  const row = attemptRow(worst, observedAt, attemptId);
  writeJsonAtomic(attemptShardPath, attemptShard(row));
  if (worst.status !== "ready") return { ok: false, reason: worst.reason, updated: false, attempt: row };

  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  atomicWrite(canonicalPath, serialized);
  atomicWrite(publicPath, serialized);
  return { ok: true, reason: "ok", updated: true, attempt: row, points: output.series.length };
}

async function main() {
  const resultValue = await runTreasuryTga();
  if (!resultValue.ok) {
    console.error(`Treasury TGA fetch failed: ${resultValue.reason}; last-known-good artifacts retained`);
    process.exitCode = 1;
    return;
  }
  console.log(`Saved ${resultValue.points} Treasury TGA points and current-attempt evidence`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
