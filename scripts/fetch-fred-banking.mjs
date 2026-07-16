#!/usr/bin/env node

import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  attemptResult,
  atomicWrite,
  classifyEndpointResponse,
  defaultAttemptId,
  returnedTuple,
  threwTuple,
  transportError,
  worstRequestResult,
  writeAttemptShard,
} from "./lib/data-supply-attempt-shard.mjs";
import {
  LaneLkgStore,
  allNaturalRequestsFailed,
  classifyLkgFailure,
  isNaturalScheduleRun,
  systemicLkgFailureReason,
} from "./lib/data-supply-lkg-store.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

export const FRED_BANKING_GROUPS = Object.freeze([
  {
    id: "daily",
    days: 9999,
    series: [
      { id: "DGS10", name: "10Y Treasury Yield" },
      { id: "BAMLH0A0HYM2", name: "HY Spread" },
      // Transitional dual-write: keep Korea 10Y here until a natural run has
      // committed the new monthly artifact, then remove it with the config flip.
      { id: "IRLTLT01KRM156N", name: "Korea 10Y Government Bond Yield" },
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
  const url = buildUrl(series.id, group.days, observedAt, apiKey);
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
      last = attemptResult(
        exceptionKind === "transport" ? "transport_error" : "unexpected_error",
        threwTuple(exceptionKind),
      );
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

function defaultPublicPaths() {
  return Object.fromEntries(FRED_BANKING_GROUPS.map((group) => [
    group.id,
    path.join(REPO_ROOT, "100xfenok-next", "public", "data", "macro", `fred-banking-${group.id}.json`),
  ]));
}

export async function runFredBanking({
  repoRoot = REPO_ROOT,
  canonicalPaths = defaultCanonicalPaths(),
  publicPaths = defaultPublicPaths(),
  attemptShardPath = path.join(REPO_ROOT, "data", "admin", "data-supply-state", "detection-attempts", "fred_banking.json"),
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
  const lkgStore = new LaneLkgStore({ repoRoot, laneId: "fred_banking" });
  const lkgArtifacts = selectedGroups.map((group) => ({
    key: group.id,
    canonicalPath: canonicalPaths[group.id],
    validateDocument: (document) => validBankingDocument(document, group),
    sourceAsOf: (document) => bankingSourceAsOf(document, group),
  }));
  const run = { runId: String(runId), runAttempt: Number(runAttempt), eventName, observedAt };

  let requestResults;
  if (!apiKey) {
    requestResults = [attemptResult("unexpected_error", threwTuple("unexpected"))];
  } else {
    requestResults = [];
    const targets = selectedGroups.flatMap((group) => group.series.map((series) => ({ group, series })));
    for (const [index, target] of targets.entries()) {
      requestResults.push(await evaluateSeries({ request, apiKey, ...target, observedAt, sleep, controlledFailureKey: injectedKey }));
      if (index < targets.length - 1) await sleep(500);
    }
  }

  const worst = worstRequestResult(requestResults);
  const attempt = writeAttemptShard({
    laneId: "fred_banking",
    attemptShardPath,
    observedAt,
    attemptId,
    result: worst,
  });
  if (worst.status !== "ready") {
    const systemicOutage = allNaturalRequestsFailed(requestResults, (row) => row.seriesId === injectedKey);
    const failureReason = systemicLkgFailureReason([worst.reason, ...requestResults.map((row) => row.reason)])
      ?? (injectedKey && !systemicOutage ? "controlled_failure" : worst.reason);
    const failure = lkgStore.recordFailure({ artifacts: lkgArtifacts, run, reason: failureReason });
    const outcome = classifyLkgFailure({ reason: failureReason, hasCompleteLkg: failure.hasCompleteLkg, systemic: systemicOutage });
    return { ok: false, reason: failureReason, updated: false, attempt, retrySet: failure.retrySet, ...outcome };
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

  const candidates = selectedGroups.map((group) => {
    const serialized = `${JSON.stringify(outputs[group.id], null, 2)}\n`;
    return {
      key: group.id,
      currentRelativePath: `data/macro/fred-banking-${group.id}.json`,
      payloadBytes: Buffer.from(serialized),
      sourceAsOf: outputs[group.id].source_as_of,
      validateDocument: (document) => validBankingDocument(document, group),
      deriveSourceAsOf: (document) => bankingSourceAsOf(document, group),
      serialized,
    };
  });
  const recoveryState = lkgStore.stateSnapshot();
  const hasSelectedRetry = candidates.some((candidate) => recoveryState.items[candidate.key]?.retry === true);
  if (hasSelectedRetry && !isNaturalScheduleRun(run)) {
    return {
      ok: false,
      reason: "recovery_requires_schedule",
      updated: false,
      attempt,
      retrySet: recoveryState.retry_set,
      degraded: true,
      corrupt: false,
      exitCode: 0,
    };
  }
  const promotable = lkgStore.promotableCandidates(candidates, run);
  if (promotable.length === 0) {
    return {
      ok: false,
      reason: "recovery_not_advanced",
      updated: false,
      attempt,
      retrySet: lkgStore.stateSnapshot().retry_set,
      degraded: true,
      corrupt: false,
      exitCode: 0,
    };
  }
  for (const candidate of promotable) {
    atomicWrite(canonicalPaths[candidate.key], candidate.serialized);
    atomicWrite(publicPaths[candidate.key], candidate.serialized);
  }
  const success = lkgStore.recordSuccess({ artifacts: promotable, run });
  const recovered = promotable.some((candidate) => success.state.items[candidate.key]?.recovered_at === observedAt);
  if (success.retrySet.length > 0) {
    return {
      ok: false,
      reason: "recovery_not_advanced",
      updated: true,
      attempt,
      retrySet: success.retrySet,
      recovered,
      degraded: true,
      corrupt: false,
      exitCode: 0,
    };
  }
  return { ok: true, reason: "ok", updated: true, attempt, groups: selectedGroups.map((group) => group.id), recovered };
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
  const result = await runFredBanking({ type: parseType(process.argv.slice(2)) });
  if (!result.ok) {
    const prefix = result.degraded ? "[degraded]" : "[corrupt]";
    const message = `${prefix} FRED banking ${result.reason}; retry set: ${(result.retrySet || []).join(", ") || "none"}`;
    if (result.degraded) console.log(message);
    else console.error(message);
    process.exitCode = result.exitCode ?? 2;
    return;
  }
  console.log(`Saved FRED banking ${result.groups.join(", ")} artifacts and one current-attempt shard${result.recovered ? "; recovered from LKG" : ""}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
