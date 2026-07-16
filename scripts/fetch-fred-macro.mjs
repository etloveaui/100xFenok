#!/usr/bin/env node

import fs from "node:fs";
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
      last = attemptResult(
        exceptionKind === "transport" ? "transport_error" : "unexpected_error",
        threwTuple(exceptionKind),
      );
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
  repoRoot = REPO_ROOT,
  canonicalPath = path.join(REPO_ROOT, "data", "macro", "fred-macro.json"),
  publicPath = path.join(REPO_ROOT, "100xfenok-next", "public", "data", "macro", "fred-macro.json"),
  attemptShardPath = path.join(REPO_ROOT, "data", "admin", "data-supply-state", "detection-attempts", "fred_macro.json"),
  apiKey = process.env.FRED_API_KEY,
  request = requestBytes,
  observedAt = new Date().toISOString(),
  attemptId = defaultAttemptId("fred-macro", observedAt),
  runId = process.env.GITHUB_RUN_ID || "local",
  runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1),
  eventName = process.env.GITHUB_EVENT_NAME || "local",
  controlledFailureKey = process.env.INPUT_CONTROLLED_FAILURE_KEY || "",
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const injectedKey = validateControlledFailureKey(controlledFailureKey.trim(), eventName);
  const lkgStore = new LaneLkgStore({ repoRoot, laneId: "fred_macro" });
  const lkgArtifacts = [{
    key: "fred_macro",
    canonicalPath,
    validateDocument: validMacroDocument,
    sourceAsOf: macroSourceAsOf,
  }];
  const run = { runId: String(runId), runAttempt: Number(runAttempt), eventName, observedAt };
  let requestResults;
  if (!apiKey) {
    requestResults = [attemptResult("unexpected_error", threwTuple("unexpected"))];
  } else {
    requestResults = [];
    for (const series of FRED_MACRO_SERIES) {
      requestResults.push(await evaluateSeries({ request, apiKey, series, observedAt, sleep, controlledFailureKey: injectedKey }));
      if (series !== FRED_MACRO_SERIES.at(-1)) await sleep(500);
    }
  }

  const worst = worstRequestResult(requestResults);
  const attempt = writeAttemptShard({
    laneId: "fred_macro",
    attemptShardPath,
    observedAt,
    attemptId,
    result: worst,
  });
  if (worst.status !== "ready") {
    const systemicOutage = allNaturalRequestsFailed(
      requestResults,
      (_row, index) => FRED_MACRO_SERIES[index]?.id === injectedKey,
    );
    const failureReason = systemicLkgFailureReason([worst.reason, ...requestResults.map((row) => row.reason)])
      ?? (injectedKey && !systemicOutage ? "controlled_failure" : worst.reason);
    const failure = lkgStore.recordFailure({ artifacts: lkgArtifacts, run, reason: failureReason });
    const outcome = classifyLkgFailure({ reason: failureReason, hasCompleteLkg: failure.hasCompleteLkg, systemic: systemicOutage });
    return { ok: false, reason: failureReason, updated: false, attempt, retrySet: failure.retrySet, ...outcome };
  }

  const series = Object.fromEntries(FRED_MACRO_SERIES.map((item, index) => [item.id, requestResults[index].rows]));
  const output = { updated: observedAt, series };
  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  const candidate = {
    key: "fred_macro",
    currentRelativePath: "data/macro/fred-macro.json",
    payloadBytes: Buffer.from(serialized),
    sourceAsOf: macroSourceAsOf(output),
    validateDocument: validMacroDocument,
    deriveSourceAsOf: macroSourceAsOf,
    promotion_contract: PROMOTION_CONTRACT_PROVIDER_OBSERVATION_V2,
    provider_observation: buildProviderObservationV2({
      payloadBytes: Buffer.from(serialized),
      sourceAsOf: macroSourceAsOf(output),
      validateDocument: validMacroDocument,
      deriveSourceAsOf: macroSourceAsOf,
      candidateContainsObservation: (candidateDocument, providerDocument) => JSON.stringify(candidateDocument) === JSON.stringify(providerDocument),
      run,
    }),
  };
  const recoveryState = lkgStore.stateSnapshot();
  if (recoveryState.items.fred_macro?.retry === true && !isNaturalScheduleRun(run)) {
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
      attempt,
      retrySet: lkgStore.stateSnapshot().retry_set,
      degraded: true,
      corrupt: false,
      exitCode: 0,
    };
  }
  atomicWrite(canonicalPath, serialized);
  atomicWrite(publicPath, serialized);
  const success = lkgStore.recordSuccess({ artifacts: promotable, run });
  const recovered = success.state.items.fred_macro?.recovered_at === observedAt;
  return { ok: true, reason: "ok", updated: true, attempt, seriesCount: FRED_MACRO_SERIES.length, recovered };
}

async function main() {
  const result = await runFredMacro();
  if (!result.ok) {
    const prefix = result.degraded ? "[degraded]" : "[corrupt]";
    const message = `${prefix} FRED macro ${result.reason}; retry set: ${(result.retrySet || []).join(", ") || "none"}`;
    if (result.degraded) console.log(message);
    else console.error(message);
    process.exitCode = result.exitCode ?? 2;
    return;
  }
  console.log(`Saved ${result.seriesCount} FRED macro series and current-attempt evidence${result.recovered ? "; recovered from LKG" : ""}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
