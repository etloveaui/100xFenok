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

export function generateQuarters(now = new Date()) {
  const quarterEnds = ["0331", "0630", "0930", "1231"];
  const quarters = [];
  const currentYear = now.getUTCFullYear();
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - 45);
  for (let year = 2009; year <= currentYear; year += 1) {
    for (let quarter = 0; quarter < 4; quarter += 1) {
      const quarterMonth = quarter * 3 + 2;
      const quarterEnd = new Date(Date.UTC(year, quarterMonth + 1, 0));
      if (quarterEnd <= cutoff) quarters.push(`${year}${quarterEnds[quarter]}`);
    }
  }
  return quarters;
}

function buildUrl(quarter) {
  const params = new URLSearchParams({
    limit: "10000",
    fields: "RBC1AAJ,RISDATE",
    filters: `RISDATE:${quarter}`,
  });
  return `https://api.fdic.gov/banks/financials?${params.toString()}`;
}

export function requestBytes(url, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "User-Agent": "100xFenok-fdic-tier1/1.0" } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({
        statusCode: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error("FDIC request timed out"), { code: "ETIMEDOUT" })));
    request.on("error", reject);
  });
}

function quarterRow(document, quarter) {
  const ratios = document.data
    .map((row) => Number(row?.data?.RBC1AAJ))
    .filter(Number.isFinite);
  if (ratios.length === 0) return null;
  const average = ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
  return {
    date: `${quarter.slice(0, 4)}-${quarter.slice(4, 6)}-${quarter.slice(6, 8)}`,
    value: Number(average.toFixed(2)),
    banks: ratios.length,
  };
}

async function evaluateQuarter({ request, quarter, controlledFailureQuarter }) {
  if (quarter === controlledFailureQuarter) {
    return { ...attemptResult("transport_error", threwTuple("transport")), quarter };
  }
  try {
    const classified = classifyEndpointResponse(await request(buildUrl(quarter), quarter), {
      laneId: "fdic_tier1",
    });
    if (classified.status !== "ready") return { ...classified, quarter };
    const row = quarterRow(classified.document, quarter);
    if (row !== null) return { ...classified, quarter, row };
    return {
      ...attemptResult("empty_payload", returnedTuple({
        httpStatus: classified.attempt.http_status,
        auth: classified.attempt.auth,
        decode: "ok",
        payload: "empty",
      }), classified.document),
      quarter,
    };
  } catch (error) {
    const exceptionKind = transportError(error) ? "transport" : "unexpected";
    return {
      ...attemptResult(
        exceptionKind === "transport" ? "transport_error" : "unexpected_error",
        threwTuple(exceptionKind),
      ),
      quarter,
    };
  }
}

function fdicSourceAsOf(document) {
  const dates = Array.isArray(document?.data)
    ? document.data.map((row) => row?.date).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    : [];
  return dates.length > 0 ? dates.sort().at(-1) : null;
}

function validFdicDocument(document) {
  return document?.source === "FDIC"
    && Array.isArray(document?.data)
    && document.data.length > 0
    && document.data.every((row) => (
      /^\d{4}-\d{2}-\d{2}$/.test(row?.date)
      && Number.isFinite(row?.value)
      && Number.isInteger(row?.banks)
      && row.banks > 0
    ))
    && fdicSourceAsOf(document) !== null;
}

function controlledFailureQuarter(controlledFailureKey, eventName, quarters) {
  if (!controlledFailureKey) return null;
  if (eventName !== "workflow_dispatch") throw new Error("controlled failure requires workflow_dispatch");
  const quarter = controlledFailureKey === "latest" ? quarters.at(-1) : controlledFailureKey;
  if (!quarters.includes(quarter)) throw new Error(`unknown controlled FDIC key: ${controlledFailureKey}`);
  return quarter;
}

export async function runFdicTier1({
  repoRoot = REPO_ROOT,
  canonicalPath = path.join(REPO_ROOT, "data", "macro", "fdic-tier1.json"),
  publicPath = path.join(REPO_ROOT, "100xfenok-next", "public", "data", "macro", "fdic-tier1.json"),
  attemptShardPath = path.join(REPO_ROOT, "data", "admin", "data-supply-state", "detection-attempts", "fdic_tier1.json"),
  quarters = generateQuarters(),
  request = requestBytes,
  observedAt = new Date().toISOString(),
  attemptId = defaultAttemptId("fdic-tier1", observedAt),
  runId = process.env.GITHUB_RUN_ID || "local",
  runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1),
  eventName = process.env.GITHUB_EVENT_NAME || "local",
  controlledFailureKey = process.env.INPUT_CONTROLLED_FAILURE_KEY || "",
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!Array.isArray(quarters) || quarters.length === 0) throw new Error("FDIC quarter list must be non-empty");
  const injectedQuarter = controlledFailureQuarter(controlledFailureKey.trim(), eventName, quarters);
  const lkgStore = new LaneLkgStore({ repoRoot, laneId: "fdic_tier1" });
  const lkgArtifacts = [{
    key: "fdic_tier1",
    canonicalPath,
    validateDocument: validFdicDocument,
    sourceAsOf: fdicSourceAsOf,
  }];
  const run = { runId: String(runId), runAttempt: Number(runAttempt), eventName, observedAt };
  const requestResults = [];
  for (const [index, quarter] of quarters.entries()) {
    requestResults.push(await evaluateQuarter({ request, quarter, controlledFailureQuarter: injectedQuarter }));
    if (index < quarters.length - 1) await sleep(300);
  }
  const worst = worstRequestResult(requestResults);
  const attempt = writeAttemptShard({
    laneId: "fdic_tier1",
    attemptShardPath,
    observedAt,
    attemptId,
    result: worst,
  });
  if (worst.status !== "ready") {
    const systemicOutage = allNaturalRequestsFailed(requestResults, (row) => row.quarter === injectedQuarter);
    const failureReason = systemicLkgFailureReason([worst.reason, ...requestResults.map((row) => row.reason)])
      ?? (injectedQuarter && !systemicOutage ? "controlled_failure" : worst.reason);
    const failure = lkgStore.recordFailure({ artifacts: lkgArtifacts, run, reason: failureReason });
    const outcome = classifyLkgFailure({ reason: failureReason, hasCompleteLkg: failure.hasCompleteLkg, systemic: systemicOutage });
    return { ok: false, reason: failureReason, updated: false, attempt, retrySet: failure.retrySet, ...outcome };
  }

  const data = requestResults.map((row) => row.row).sort((a, b) => a.date.localeCompare(b.date));
  const output = {
    updated: observedAt,
    source: "FDIC",
    description: "Average Tier 1 Capital Ratio (RBC1AAJ)",
    data,
  };
  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  const candidate = {
    key: "fdic_tier1",
    currentRelativePath: "data/macro/fdic-tier1.json",
    payloadBytes: Buffer.from(serialized),
    sourceAsOf: fdicSourceAsOf(output),
    validateDocument: validFdicDocument,
    deriveSourceAsOf: fdicSourceAsOf,
  };
  const recoveryState = lkgStore.stateSnapshot();
  if (recoveryState.items.fdic_tier1?.retry === true && !isNaturalScheduleRun(run)) {
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
  const promotable = lkgStore.promotableCandidates([candidate], run);
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
  atomicWrite(canonicalPath, serialized);
  atomicWrite(publicPath, serialized);
  const success = lkgStore.recordSuccess({ artifacts: promotable, run });
  const recovered = success.state.items.fdic_tier1?.recovered_at === observedAt;
  return { ok: true, reason: "ok", updated: true, attempt, quarters: data.length, recovered };
}

async function main() {
  const result = await runFdicTier1();
  if (!result.ok) {
    const prefix = result.degraded ? "[degraded]" : "[corrupt]";
    const message = `${prefix} FDIC Tier1 ${result.reason}; retry set: ${(result.retrySet || []).join(", ") || "none"}`;
    if (result.degraded) console.log(message);
    else console.error(message);
    process.exitCode = result.exitCode ?? 2;
    return;
  }
  console.log(`Saved ${result.quarters} FDIC quarters and current-attempt evidence${result.recovered ? "; recovered from LKG" : ""}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
