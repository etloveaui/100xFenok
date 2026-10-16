#!/usr/bin/env node

import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { atomicWrite } from "./lib/atomic-file.mjs";
import { attemptResult, classifyEndpointResponse, returnedTuple, threwTuple, transportError, worstRequestResult } from "./lib/provider-fetch-result.mjs";
import {
  allNaturalRequestsFailed,
  systemicLkgFailureReason,
} from "./lib/data-supply-lkg-store.mjs";
import { hydrateCanonicalCloudData } from "./materialize-cloud-data-plane-family.mjs";
import { boundedDiagnosticDetail, diagnosticSuffix } from "./lib/diagnostic-detail.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

export const FRED_MACRO_SERIES = Object.freeze([
  { id: "M2SL", days: 3650 },
  { id: "WALCL", days: 3650 },
  { id: "RRPONTSYD", days: 3650 },
  { id: "SOFR", days: 3650 },
  { id: "IORB", days: 3650 },
  { id: "WRESBAL", days: 3650 },
  { id: "GDP", days: 1095 },
]);

const MAX_RETRIES = 2;
const BACKOFFS_MS = Object.freeze([1000, 2000, 4000]);

function formatDate(date) {
  return date.toISOString().split("T")[0];
}

function buildUrl(seriesId, days, observedAt, apiKey) {
  const endDate = new Date(observedAt);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - days);
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
    observation_start: formatDate(startDate),
    observation_end: formatDate(endDate),
    sort_order: "asc",
  });
  return `https://api.stlouisfed.org/fred/series/observations?${params.toString()}`;
}

export function requestBytes(url, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "User-Agent": "100xFenok-fred-macro/1.0" } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({
        statusCode: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error("FRED macro request timed out"), { code: "ETIMEDOUT" })));
    request.on("error", reject);
  });
}

function usableObservations(document) {
  return document.observations
    .filter((item) => String(item?.value ?? "").trim() !== ".")
    .map((item) => ({ date: String(item?.date ?? ""), value: Number(item?.value) }))
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date) && Number.isFinite(item.value));
}

async function evaluateSeries({ request, apiKey, series, observedAt, sleep, controlledFailureKey }) {
  if (series.id === controlledFailureKey) {
    return attemptResult("transport_error", threwTuple("transport"));
  }
  const url = buildUrl(series.id, series.days, observedAt, apiKey);
  let last = null;
  for (let retry = 0; retry <= MAX_RETRIES; retry += 1) {
    if (retry > 0) await sleep(BACKOFFS_MS[Math.min(retry - 1, BACKOFFS_MS.length - 1)]);
    try {
      last = classifyEndpointResponse(await request(url, series.id), {
        laneId: "fred_macro",
        authRequired: true,
      });
    } catch (error) {
      const exceptionKind = transportError(error) ? "transport" : "unexpected";
      last = {
        ...attemptResult(
          exceptionKind === "transport" ? "transport_error" : "unexpected_error",
          threwTuple(exceptionKind),
        ),
        failure_detail: boundedDiagnosticDetail(error),
      };
    }
    if (last.status === "ready") {
      const rows = usableObservations(last.document);
      if (rows.length > 0) return { ...last, rows };
      last = attemptResult("empty_payload", returnedTuple({
        httpStatus: last.attempt.http_status,
        auth: last.attempt.auth,
        decode: "ok",
        payload: "empty",
      }), last.document);
    }
    if (retry < MAX_RETRIES) continue;
  }
  return last;
}

function macroSourceAsOf(document) {
  const dates = Object.values(document?.series ?? {}).flatMap((rows) => (
    Array.isArray(rows) ? rows.map((row) => row?.date).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)) : []
  ));
  return dates.length > 0 ? dates.sort().at(-1) : null;
}

function validMacroDocument(document) {
  if (!document || typeof document !== "object" || Array.isArray(document) || !document.series || typeof document.series !== "object") return false;
  return FRED_MACRO_SERIES.every(({ id }) => {
    const rows = document.series[id];
    return Array.isArray(rows) && rows.length > 0 && rows.every((row) => (
      /^\d{4}-\d{2}-\d{2}$/.test(row?.date) && Number.isFinite(row?.value)
    ));
  }) && macroSourceAsOf(document) !== null;
}

function validateControlledFailureKey(controlledFailureKey, eventName) {
  if (!controlledFailureKey) return null;
  if (eventName !== "workflow_dispatch") throw new Error("controlled failure requires workflow_dispatch");
  if (!FRED_MACRO_SERIES.some((series) => series.id === controlledFailureKey)) {
    throw new Error(`unknown controlled FRED macro key: ${controlledFailureKey}`);
  }
  return controlledFailureKey;
}

export async function runFredMacro({
  canonicalPath = path.join(REPO_ROOT, "data", "macro", "fred-macro.json"),
  apiKey = process.env.FRED_API_KEY,
  request = requestBytes,
  observedAt = new Date().toISOString(),
  eventName = process.env.GITHUB_EVENT_NAME || "local",
  controlledFailureKey = process.env.INPUT_CONTROLLED_FAILURE_KEY || "",
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!observedAt.endsWith("Z") || !Number.isFinite(Date.parse(observedAt))) throw new Error("observedAt must be RFC3339 UTC");
  const injectedKey = validateControlledFailureKey(controlledFailureKey.trim(), eventName);
  // The active generation supplies the monotonicity baseline and remains live
  // on every acquisition failure. No Git-era recovery snapshots are written.
  const previous = fs.existsSync(canonicalPath) ? JSON.parse(fs.readFileSync(canonicalPath, "utf8")) : null;
  if (!validMacroDocument(previous)) throw new Error("active FRED generation baseline is missing or invalid");
  let requestResults;
  if (!apiKey) {
    requestResults = [{
      ...attemptResult("unexpected_error", threwTuple("unexpected")),
      failure_detail: "FRED API key is unavailable",
    }];
  } else {
    requestResults = [];
    for (const series of FRED_MACRO_SERIES) {
      requestResults.push(await evaluateSeries({ request, apiKey, series, observedAt, sleep, controlledFailureKey: injectedKey }));
      if (series !== FRED_MACRO_SERIES.at(-1)) await sleep(500);
    }
  }

  const worst = worstRequestResult(requestResults);
  const attempt = (worst).attempt;
  if (worst.status !== "ready") {
    const systemicOutage = allNaturalRequestsFailed(
      requestResults,
      (_row, index) => FRED_MACRO_SERIES[index]?.id === injectedKey,
    );
    const failureReason = systemicLkgFailureReason([worst.reason, ...requestResults.map((row) => row.reason)])
      ?? (injectedKey && !systemicOutage ? "controlled_failure" : worst.reason);
    const failureDetail = failureReason === "controlled_failure"
      ? null
      : worst.failure_detail ?? requestResults.find((row) => row.failure_detail)?.failure_detail ?? null;
    return {
      ok: false,
      reason: failureReason,
      updated: false,
      attempt,
      retrySet: ["fred_macro"],
      ...(failureDetail ? { failure_detail: failureDetail } : {}),
      degraded: true,
      corrupt: false,
      exitCode: 2,
    };
  }

  const series = Object.fromEntries(FRED_MACRO_SERIES.map((item, index) => [item.id, requestResults[index].rows]));
  const output = { updated: observedAt, series };
  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  const sourceAsOf = Date.parse(macroSourceAsOf(output));
  if (!validMacroDocument(output) || !Number.isFinite(sourceAsOf) || sourceAsOf > Date.parse(observedAt) + 120_000) {
    throw new Error("FRED candidate is invalid or future-dated");
  }
  if (sourceAsOf < Date.parse(macroSourceAsOf(previous))) {
    return { ok: false, reason: "source_regression", updated: false, attempt,
      retrySet: ["fred_macro"], degraded: true, corrupt: false, exitCode: 2 };
  }
  // Canonical only. The public mirror is produced by sync-public-data.mjs during
  // sync-static, and the mirror contract requires that no lane stage it. Writing
  // it here left an unstaged file dirty after every run, which is what
  // cloud publication was refused for ten consecutive runs.
  atomicWrite(canonicalPath, serialized);
  return { ok: true, reason: "ok", updated: true, attempt, seriesCount: FRED_MACRO_SERIES.length, recovered: false };
}

async function main() {
  await hydrateCanonicalCloudData();
  const result = await runFredMacro();
  if (!result.ok) {
    const prefix = result.degraded ? "[degraded]" : "[corrupt]";
    const message = `${prefix} FRED macro ${result.reason}; retry set: ${(result.retrySet || []).join(", ") || "none"}${diagnosticSuffix(result.failure_detail)}`;
    if (result.degraded) console.log(message);
    else console.error(message);
    process.exitCode = result.exitCode ?? 2;
    return;
  }
  console.log(`Prepared ${result.seriesCount} FRED macro series for generation publication`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
