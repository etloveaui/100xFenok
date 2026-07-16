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
  return chart.map((row) => {
    const epoch = Number(row?.date) * 1000;
    const value = Number(row?.totalCirculating?.peggedUSD);
    if (!Number.isFinite(epoch) || !Number.isFinite(value)) return null;
    const date = new Date(epoch);
    if (Number.isNaN(date.getTime())) return null;
    return { date: date.toISOString().slice(0, 10), val: value };
  }).filter(Boolean);
}

function stablecoinsSourceAsOf(document) {
  const dates = Array.isArray(document?.series)
    ? document.series.map((row) => row?.date).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    : [];
  return dates.length > 0 ? dates.sort().at(-1) : null;
}

function validStablecoinsDocument(document) {
  return document?.source === "DefiLlama"
    && Number.isFinite(document?.current)
    && Array.isArray(document?.series)
    && document.series.length > 0
    && document.series.every((row) => /^\d{4}-\d{2}-\d{2}$/.test(row?.date) && Number.isFinite(row?.val))
    && Array.isArray(document?.stablecoins)
    && Array.isArray(document?.peggedAssets)
    && document.peggedAssets.length > 0
    && stablecoinsSourceAsOf(document) !== null;
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

  const series = seriesFromChart(result.document.chart);
  const stablecoinDocument = result.document.stablecoins;
  const output = {
    updated: observedAt,
    source: "DefiLlama",
    current: series.at(-1)?.val ?? 0,
    series,
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
