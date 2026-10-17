#!/usr/bin/env node

import https from "node:https";
import fs from "node:fs";
import { hydratePublicCloudData } from "./materialize-cloud-data-plane-family.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { atomicWrite } from "./lib/atomic-file.mjs";
import { attemptResult, classifyEndpointResponse, defaultAttemptId, returnedTuple, threwTuple, transportError, worstRequestResult } from "./lib/provider-fetch-result.mjs";
import {
  allNaturalRequestsFailed,
  classifyLkgFailure,
  systemicLkgFailureReason,
} from "./lib/data-supply-lkg-store.mjs";
import { boundedDiagnosticDetail, diagnosticSuffix } from "./lib/diagnostic-detail.mjs";
import { INDEX_DIVIDEND_YIELD_DEFAULTS } from "./lib/index-dividend-yield.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const FRED_NASDAQ_NON_TRADING_MARGIN_DAYS = 7;

// The current Nasdaq yield uses t=max(observation<=asOf), then s=max(observation<=t-365),
// and rejects t older than 10 days. Request 365 days for the exact anchor, 10 days
// for the freshness lag, and one full calendar week for a weekend/holiday/non-trading gap:
// 365 + 10 + 7 = 382 calendar days. This is derived from the calculation contract,
// not from the size or values of any generated output.
export const FRED_NASDAQ_REQUEST_WINDOW = Object.freeze({
  lookbackDays: INDEX_DIVIDEND_YIELD_DEFAULTS.lookbackDays,
  freshnessMarginDays: INDEX_DIVIDEND_YIELD_DEFAULTS.maxObservationAgeDays,
  nonTradingMarginDays: FRED_NASDAQ_NON_TRADING_MARGIN_DAYS,
  requestDays: INDEX_DIVIDEND_YIELD_DEFAULTS.lookbackDays
    + INDEX_DIVIDEND_YIELD_DEFAULTS.maxObservationAgeDays
    + FRED_NASDAQ_NON_TRADING_MARGIN_DAYS,
});
export const FRED_NASDAQ_REQUEST_DAYS = FRED_NASDAQ_REQUEST_WINDOW.requestDays;

export const FRED_BANKING_GROUPS = Object.freeze([
  {
    id: "daily",
    days: 9999,
    series: [
      { id: "DGS10", name: "10Y Treasury Yield" },
      { id: "BAMLH0A0HYM2", name: "HY Spread" },
      { id: "NASDAQCOM", name: "Nasdaq Composite (Price Return)", requestDays: FRED_NASDAQ_REQUEST_DAYS },
      { id: "NASDAQXCMP", name: "Nasdaq Composite Total Return", requestDays: FRED_NASDAQ_REQUEST_DAYS },
    ],
  },
  {
    id: "weekly",
    days: 11000,
    series: [
      { id: "TOTLL", name: "Total Loans" },
      { id: "DPSACBW027SBOG", name: "Deposits" },
    ],
  },
  {
    id: "monthly",
    days: 9999,
    series: [
      { id: "IRLTLT01KRM156N", name: "Korea 10Y Government Bond Yield" },
    ],
  },
  {
    id: "quarterly",
    days: 9999,
    series: [
      { id: "DRALACBN", name: "Total Delinquency Rate" },
      { id: "DRCCLACBS", name: "Credit Card Delinquency" },
      { id: "DRCLACBS", name: "Consumer Delinquency" },
      { id: "DRBLACBS", name: "Business Delinquency" },
      { id: "DRCRELEXFACBS", name: "CRE Delinquency" },
      { id: "BOGZ1FL010000016Q", name: "FED Tier1" },
      { id: "CORALACBN", name: "Total NCO" },
      { id: "CORCCACBS", name: "Credit Card NCO" },
      { id: "CORCACBS", name: "Consumer NCO" },
      { id: "CORBLACBS", name: "Business NCO" },
      { id: "CORCREXFACBS", name: "CRE NCO" },
    ],
  },
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
    const request = https.get(url, { headers: { "User-Agent": "100xFenok-fred-banking/1.0" } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({
        statusCode: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error("FRED banking request timed out"), { code: "ETIMEDOUT" })));
    request.on("error", reject);
  });
}

function usableObservations(document) {
  return document.observations
    .filter((row) => String(row?.value ?? "").trim() !== "" && String(row.value).trim() !== ".")
    .map((row) => ({ date: String(row?.date ?? ""), value: Number(row?.value) }))
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.value));
}

async function evaluateSeries({ request, apiKey, group, series, observedAt, sleep, controlledFailureKey }) {
  if (series.id === controlledFailureKey) {
    return { ...attemptResult("transport_error", threwTuple("transport")), groupId: group.id, seriesId: series.id };
  }
  const url = buildUrl(series.id, series.requestDays ?? group.days, observedAt, apiKey);
  let last = null;
  for (let retry = 0; retry <= MAX_RETRIES; retry += 1) {
    if (retry > 0) await sleep(BACKOFFS_MS[Math.min(retry - 1, BACKOFFS_MS.length - 1)]);
    try {
      last = classifyEndpointResponse(await request(url, series.id, group.id), {
        laneId: "fred_banking",
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
      if (rows.length > 0) return { ...last, rows, groupId: group.id, seriesId: series.id };
      last = attemptResult("empty_payload", returnedTuple({
        httpStatus: last.attempt.http_status,
        auth: last.attempt.auth,
        decode: "ok",
        payload: "empty",
      }), last.document);
    }
    if (retry < MAX_RETRIES) continue;
  }
  return { ...last, groupId: group.id, seriesId: series.id };
}

function bankingSourceAsOf(document, group) {
  const sourceDates = group.series.map(({ id }) => {
    const rows = document?.series?.[id];
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const dates = rows.map((row) => row?.date).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
    return dates.length === rows.length ? dates.sort().at(-1) : null;
  });
  return sourceDates.every(Boolean) ? [...sourceDates].sort().at(0) : null;
}

function validBankingDocument(document, group) {
  if (!document || typeof document !== "object" || Array.isArray(document)
    || document.type !== group.id || typeof document.source_as_of !== "string"
    || !Number.isFinite(Date.parse(document.source_as_of)) || !document.series || typeof document.series !== "object") return false;
  return document.source_as_of === bankingSourceAsOf(document, group) && group.series.every(({ id }) => {
    const rows = document.series[id];
    return Array.isArray(rows) && rows.length > 0 && rows.every((row) => (
      /^\d{4}-\d{2}-\d{2}$/.test(row?.date) && Number.isFinite(row?.value)
    ));
  });
}

function validateControlledFailureKey(controlledFailureKey, eventName, selectedGroups) {
  if (!controlledFailureKey) return null;
  if (eventName !== "workflow_dispatch") throw new Error("controlled failure requires workflow_dispatch");
  if (!selectedGroups.some((group) => group.series.some((series) => series.id === controlledFailureKey))) {
    throw new Error(`unknown controlled FRED banking key: ${controlledFailureKey}`);
  }
  return controlledFailureKey;
}

function defaultCanonicalPaths() {
  return Object.fromEntries(FRED_BANKING_GROUPS.map((group) => [
    group.id,
    path.join(REPO_ROOT, "data", "macro", `fred-banking-${group.id}.json`),
  ]));
}

export async function runFredBanking({
  repoRoot = REPO_ROOT,
  canonicalPaths = defaultCanonicalPaths(),
  type = "all",
  apiKey = process.env.FRED_API_KEY,
  request = requestBytes,
  observedAt = new Date().toISOString(),
  attemptId = defaultAttemptId("fred-banking", observedAt),
  runId = process.env.GITHUB_RUN_ID || "local",
  runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1),
  eventName = process.env.GITHUB_EVENT_NAME || "local",
  controlledFailureKey = process.env.INPUT_CONTROLLED_FAILURE_KEY || "",
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const selectedGroups = type === "all"
    ? FRED_BANKING_GROUPS
    : FRED_BANKING_GROUPS.filter((group) => group.id === type);
  if (selectedGroups.length === 0) throw new Error(`unknown FRED banking type: ${type}`);
  const injectedKey = validateControlledFailureKey(controlledFailureKey.trim(), eventName, selectedGroups);
  const previous = Object.fromEntries(selectedGroups.map((group) => {
    const document = JSON.parse(fs.readFileSync(canonicalPaths[group.id], "utf8"));
    if (!validBankingDocument(document, group)) throw new Error(`Active banking baseline is invalid: ${group.id}`);
    return [group.id, document];
  }));

  let requestResults;
  if (!apiKey) {
    requestResults = [{
      ...attemptResult("unexpected_error", threwTuple("unexpected")),
      failure_detail: "FRED API key is unavailable",
    }];
  } else {
    requestResults = [];
    const targets = selectedGroups.flatMap((group) => group.series.map((series) => ({ group, series })));
    for (const [index, target] of targets.entries()) {
      requestResults.push(await evaluateSeries({ request, apiKey, ...target, observedAt, sleep, controlledFailureKey: injectedKey }));
      if (index < targets.length - 1) await sleep(500);
    }
  }

  const worst = worstRequestResult(requestResults);
  const attempt = (worst).attempt;
  if (worst.status !== "ready") {
    const systemicOutage = allNaturalRequestsFailed(requestResults, (row) => row.seriesId === injectedKey);
    const failureReason = systemicLkgFailureReason([worst.reason, ...requestResults.map((row) => row.reason)])
      ?? (injectedKey && !systemicOutage ? "controlled_failure" : worst.reason);
    const outcome = classifyLkgFailure({ reason: failureReason, hasCompleteLkg: true, systemic: systemicOutage });
    const failureDetail = failureReason === "controlled_failure"
      ? null
      : worst.failure_detail ?? requestResults.find((row) => row.failure_detail)?.failure_detail ?? null;
    return {
      ok: false,
      reason: failureReason,
      updated: false,
      attempt,
      retrySet: selectedGroups.map((group) => group.id),
      ...(failureDetail ? { failure_detail: failureDetail } : {}),
      ...outcome,
    };
  }

  const outputs = {};
  for (const group of selectedGroups) {
    const groupRows = requestResults.filter((row) => row.groupId === group.id);
    const series = Object.fromEntries(group.series.map((item) => [
      item.id,
      groupRows.find((row) => row.seriesId === item.id).rows,
    ]));
    const sourceDates = Object.values(series).map((rows) => rows.at(-1)?.date ?? null);
    const sourceAsOf = sourceDates.every(Boolean) ? [...sourceDates].sort().at(0) : null;
    outputs[group.id] = {
      updated: sourceAsOf,
      source_as_of: sourceAsOf,
      source_as_of_reason: sourceAsOf ? null : "one or more required FRED series have no usable observation date",
      fetched_at: observedAt,
      status: "ready",
      failed_series: [],
      type: group.id,
      series,
    };
  }

  // The whole generation stays on its active baseline if any selected series regresses.
  for (const group of selectedGroups) {
    const candidate = outputs[group.id];
    if (!validBankingDocument(candidate, group)) throw new Error(`Invalid banking candidate: ${group.id}`);
    if (group.series.some(({ id }) => candidate.series[id].at(-1).date < previous[group.id].series[id].at(-1).date)) {
      return { ok: false, reason: "source_regression", updated: false, attempt,
        retrySet: [group.id], degraded: true, corrupt: false, exitCode: 2 };
    }
  }
  for (const group of selectedGroups) {
    atomicWrite(canonicalPaths[group.id], `${JSON.stringify(outputs[group.id], null, 2)}\n`);
  }
  return { ok: true, reason: "ok", updated: true, attempt, groups: selectedGroups.map((group) => group.id), recovered: false };

}

function parseType(argv) {
  let type = process.env.FRED_BANKING_TYPE || "all";
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith("--type=")) type = argv[index].slice("--type=".length);
    else if (argv[index] === "--type") type = argv[++index];
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  return type;
}

async function main() {
  const baselines = await Promise.all(FRED_BANKING_GROUPS.map(({ id }) => hydratePublicCloudData({
    relative: `macro/fred-banking-${id}.json`, family: "fred-banking",
  })));
  if (new Set(baselines.map(({ generation }) => generation)).size !== 1) throw new Error("Banking baseline changed during hydration; retry the run");
  const result = await runFredBanking({ type: parseType(process.argv.slice(2)) });
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `updated=${result.ok && result.updated === true}\n`);
  if (!result.ok) {
    const prefix = result.degraded ? "[degraded]" : "[corrupt]";
    const message = `${prefix} FRED banking ${result.reason}; retry set: ${(result.retrySet || []).join(", ") || "none"}${diagnosticSuffix(result.failure_detail)}`;
    if (result.degraded) console.log(message);
    else console.error(message);
    process.exitCode = result.exitCode ?? 2;
    return;
  }
  console.log(`Saved FRED banking ${result.groups.join(", ")} artifacts${result.recovered ? "; recovered from LKG" : ""}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
