#!/usr/bin/env node

import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  attemptResult,
  atomicWrite,
  classifyHttpResponse,
  defaultAttemptId,
  evaluateEndpointAssertions,
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
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");

export const DEFILLAMA_LANE_ID = "defillama_stablecoins";
export const DEFILLAMA_ENDPOINTS = Object.freeze([
  { key: "chart", url: "https://stablecoins.llama.fi/stablecoincharts/all" },
  { key: "stablecoins", url: "https://stablecoins.llama.fi/stablecoins?includePrices=false" },
]);
export const DEFILLAMA_MAX_SERIES_DAYS = 3_650;
export const DEFILLAMA_PERSISTENCE_POLICY = Object.freeze({
  schema_version: "defillama-bounded-persistence/v1",
  basis: "source_date",
  scope: "series",
  max_series_days: DEFILLAMA_MAX_SERIES_DAYS,
  eviction: "oldest_source_date_first",
});

const MAX_RETRIES = 2;
const BACKOFFS_MS = Object.freeze([1000, 2000, 4000]);

export function requestBytes(url, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "User-Agent": "100xFenok-defillama/1.0" } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({
        statusCode: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error("DefiLlama request timed out"), { code: "ETIMEDOUT" })));
    request.on("error", reject);
  });
}

function validateControlledFailureEndpoint(value, eventName) {
  if (!value) return null;
  if (eventName !== "workflow_dispatch") throw new Error("controlled failure requires workflow_dispatch");
  if (!DEFILLAMA_ENDPOINTS.some((endpoint) => endpoint.key === value)) {
    throw new Error(`unknown controlled DefiLlama endpoint: ${value}`);
  }
  return value;
}

async function evaluateEndpoint({ endpoint, request, sleep, controlledFailureEndpoint }) {
  if (endpoint.key === controlledFailureEndpoint) {
    return attemptResult("transport_error", threwTuple("transport"));
  }
  let last;
  for (let retry = 0; retry <= MAX_RETRIES; retry += 1) {
    if (retry > 0) await sleep(BACKOFFS_MS[Math.min(retry - 1, BACKOFFS_MS.length - 1)]);
    try {
      last = classifyHttpResponse(await request(endpoint.url, endpoint.key));
      if (last.attempt.payload === "empty") {
        last = attemptResult("empty_payload", last.attempt, last.document);
      }
    } catch (error) {
      const kind = transportError(error) ? "transport" : "unexpected";
      last = attemptResult(kind === "transport" ? "transport_error" : "unexpected_error", threwTuple(kind));
    }
    if (last.status === "ready" || retry === MAX_RETRIES) return last;
  }
  return last;
}

function aggregateReadyResponses(results) {
  const worst = worstRequestResult(results);
  if (worst.status !== "ready") return worst;
  const document = {
    chart: results[0].document,
    stablecoins: results[1].document,
  };
  const assertions = evaluateEndpointAssertions(DEFILLAMA_LANE_ID, document);
  const reason = assertions.some((assertion) => assertion.passed === false) ? "schema_drift" : "ok";
  return attemptResult(reason, returnedTuple({
    httpStatus: worst.attempt.http_status,
    decode: "ok",
    payload: "non_empty",
    assertions,
  }), document);
}

function seriesFromChart(chart) {
  if (!Array.isArray(chart)) return [];
  const sourceDates = new Set();
  return chart.map((row, index) => {
    const rawEpoch = row?.date;
    const rawValue = row?.totalCirculating?.peggedUSD;
    const epoch = Number(rawEpoch) * 1000;
    const value = Number(rawValue);
    if (rawEpoch === null || rawEpoch === undefined || String(rawEpoch).trim() === ""
      || rawValue === null || rawValue === undefined || String(rawValue).trim() === ""
      || !Number.isFinite(epoch) || !Number.isFinite(value)) {
      throw new Error(`invalid DefiLlama chart row at index ${index}`);
    }
    const date = new Date(epoch);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`invalid DefiLlama chart row at index ${index}`);
    }
    const sourceDate = date.toISOString().slice(0, 10);
    if (sourceDates.has(sourceDate)) {
      throw new Error(`duplicate DefiLlama chart source date: ${sourceDate}`);
    }
    sourceDates.add(sourceDate);
    return { date: sourceDate, val: value };
  });
}

export function boundDefillamaSeries(chart, policy = DEFILLAMA_PERSISTENCE_POLICY) {
  const maxDays = Number(policy?.max_series_days);
  if (!Number.isInteger(maxDays) || maxDays <= 0) {
    throw new Error("invalid DefiLlama persistence max_series_days");
  }

  const availableSeries = seriesFromChart(chart).sort((a, b) => a.date.localeCompare(b.date));
  const series = availableSeries.slice(-maxDays);
  return {
    series,
    persistence_state: {
      available_days: availableSeries.length,
      retained_days: series.length,
      pruned_days: availableSeries.length - series.length,
    },
  };
}

function exactFlatObject(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const valueKeys = Object.keys(value).sort();
  const expectedKeys = Object.keys(expected).sort();
  return JSON.stringify(valueKeys) === JSON.stringify(expectedKeys)
    && expectedKeys.every((key) => value[key] === expected[key]);
}

function validSourceDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validPersistenceEnvelope(document) {
  const hasPolicy = Object.prototype.hasOwnProperty.call(document ?? {}, "persistence_policy");
  const hasState = Object.prototype.hasOwnProperty.call(document ?? {}, "persistence_state");
  if (!hasPolicy && !hasState) return true;
  if (!hasPolicy || !hasState
    || !exactFlatObject(document.persistence_policy, DEFILLAMA_PERSISTENCE_POLICY)) return false;

  const series = document.series;
  if (!Array.isArray(series) || series.length > DEFILLAMA_MAX_SERIES_DAYS) return false;
  for (let index = 1; index < series.length; index += 1) {
    if (series[index - 1].date.localeCompare(series[index].date) >= 0) return false;
  }
  if (document.current !== series.at(-1)?.val) return false;

  const state = document.persistence_state;
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  const availableDays = state.available_days;
  const retainedDays = state.retained_days;
  const prunedDays = state.pruned_days;
  return Number.isInteger(availableDays) && availableDays >= 0
    && Number.isInteger(retainedDays) && retainedDays >= 0
    && Number.isInteger(prunedDays) && prunedDays >= 0
    && retainedDays === series.length
    && availableDays >= retainedDays
    && prunedDays === availableDays - retainedDays;
}

export function stablecoinsSourceAsOf(document) {
  const dates = Array.isArray(document?.series)
    ? document.series.map((row) => row?.date).filter(validSourceDate)
    : [];
  return dates.length > 0 ? dates.sort().at(-1) : null;
}

function validStablecoinsDocument(document) {
  return document?.source === "DefiLlama"
    && Number.isFinite(document?.current)
    && Array.isArray(document?.series)
    && document.series.length > 0
    && document.series.every((row) => validSourceDate(row?.date) && Number.isFinite(row?.val))
    && Array.isArray(document?.stablecoins)
    && Array.isArray(document?.peggedAssets)
    && document.peggedAssets.length > 0
    && stablecoinsSourceAsOf(document) !== null
    && validPersistenceEnvelope(document);
}

export async function runDefillama({
  repoRoot = REPO_ROOT,
  canonicalPath = path.join(REPO_ROOT, "data", "macro", "stablecoins.json"),
  publicPath = path.join(REPO_ROOT, "100xfenok-next", "public", "data", "macro", "stablecoins.json"),
  attemptShardPath = path.join(REPO_ROOT, "data", "admin", "data-supply-state", "detection-attempts", `${DEFILLAMA_LANE_ID}.json`),
  request = requestBytes,
  observedAt = new Date().toISOString(),
  attemptId = defaultAttemptId("defillama-stablecoins", observedAt),
  runId = process.env.GITHUB_RUN_ID || "local",
  runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1),
  eventName = process.env.GITHUB_EVENT_NAME || "local",
  controlledFailureEndpoint = process.env.INPUT_CONTROLLED_FAILURE_ENDPOINT || "",
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const injectedEndpoint = validateControlledFailureEndpoint(controlledFailureEndpoint.trim(), eventName);
  const run = { runId: String(runId), runAttempt: Number(runAttempt), eventName, observedAt };
  const lkgStore = new LaneLkgStore({ repoRoot, laneId: DEFILLAMA_LANE_ID });
  const lkgArtifacts = [{
    key: "stablecoins",
    canonicalPath,
    validateDocument: validStablecoinsDocument,
    sourceAsOf: stablecoinsSourceAsOf,
  }];

  const requestResults = [];
  for (const endpoint of DEFILLAMA_ENDPOINTS) {
    requestResults.push(await evaluateEndpoint({
      endpoint,
      request,
      sleep,
      controlledFailureEndpoint: injectedEndpoint,
    }));
  }
  const result = aggregateReadyResponses(requestResults);
  const attempt = writeAttemptShard({
    laneId: DEFILLAMA_LANE_ID,
    attemptShardPath,
    observedAt,
    attemptId,
    result,
  });

  if (result.status !== "ready") {
    const systemic = allNaturalRequestsFailed(
      requestResults,
      (_row, index) => DEFILLAMA_ENDPOINTS[index]?.key === injectedEndpoint,
    );
    const reason = systemicLkgFailureReason([result.reason, ...requestResults.map((row) => row.reason)])
      ?? (injectedEndpoint && !systemic ? "controlled_failure" : result.reason);
    const failure = lkgStore.recordFailure({ artifacts: lkgArtifacts, run, reason });
    return {
      ok: false,
      reason,
      updated: false,
      attempt,
      retrySet: failure.retrySet,
      ...classifyLkgFailure({ reason, hasCompleteLkg: failure.hasCompleteLkg, systemic }),
    };
  }

  const boundedSeries = boundDefillamaSeries(result.document.chart);
  const series = boundedSeries.series;
  const stablecoinDocument = result.document.stablecoins;
  const output = {
    updated: observedAt,
    source: "DefiLlama",
    current: series.at(-1)?.val ?? 0,
    series,
    persistence_policy: DEFILLAMA_PERSISTENCE_POLICY,
    persistence_state: boundedSeries.persistence_state,
    stablecoins: Array.isArray(stablecoinDocument) ? stablecoinDocument : [],
    peggedAssets: Array.isArray(stablecoinDocument?.peggedAssets) ? stablecoinDocument.peggedAssets : [],
  };
  if (!validStablecoinsDocument(output)) {
    throw new Error("DefiLlama normalized payload is invalid after ready endpoint classification");
  }
  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  const candidate = {
    key: "stablecoins",
    currentRelativePath: "data/macro/stablecoins.json",
    payloadBytes: Buffer.from(serialized),
    sourceAsOf: stablecoinsSourceAsOf(output),
    validateDocument: validStablecoinsDocument,
    deriveSourceAsOf: stablecoinsSourceAsOf,
    promotion_contract: PROMOTION_CONTRACT_PROVIDER_OBSERVATION_V2,
    provider_observation: buildProviderObservationV2({
      payloadBytes: Buffer.from(serialized),
      sourceAsOf: stablecoinsSourceAsOf(output),
      validateDocument: validStablecoinsDocument,
      deriveSourceAsOf: stablecoinsSourceAsOf,
      candidateContainsObservation: (candidateDocument, providerDocument) => JSON.stringify(candidateDocument) === JSON.stringify(providerDocument),
      run,
    }),
  };
  const state = lkgStore.stateSnapshot();
  if (state.items.stablecoins?.retry === true && !isNaturalScheduleRun(run)) {
    return {
      ok: false,
      reason: "recovery_requires_schedule",
      updated: false,
      attempt,
      retrySet: state.retry_set,
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
  const recovered = success.state.items.stablecoins?.recovered_at === observedAt;
  return { ok: true, reason: "ok", updated: true, attempt, recovered, exitCode: 0 };
}

async function main() {
  const result = await runDefillama();
  if (!result.ok) {
    const prefix = result.degraded ? "[degraded]" : "[corrupt]";
    const message = `${prefix} DefiLlama stablecoins ${result.reason}; retry set: ${(result.retrySet || []).join(", ") || "none"}`;
    if (result.degraded) console.log(message);
    else console.error(message);
    process.exitCode = result.exitCode ?? 2;
    return;
  }
  console.log(`Saved DefiLlama stablecoins and current-attempt evidence${result.recovered ? "; recovered from LKG" : ""}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 2;
  });
}
