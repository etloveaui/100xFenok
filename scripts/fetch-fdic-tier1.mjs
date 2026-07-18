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

// Preserve the documented 2009-present history today and leave a full 20-year
// quarterly window before oldest-quarter eviction begins.
export const MAX_QUARTERS = 80;
export const FDIC_PERSISTENCE_POLICY = Object.freeze({
  schema_version: "fdic-bounded-persistence/v1",
  basis: "quarter_end",
  scope: "series",
  max_retained_quarters: MAX_QUARTERS,
  eviction: "oldest_quarter_first",
});

function validQuarterIdentifier(quarter) {
  if (typeof quarter !== "string" || !/^\d{8}$/.test(quarter)) return false;
  if (Number(quarter.slice(0, 4)) < 1) return false;
  if (!["0331", "0630", "0930", "1231"].includes(quarter.slice(4))) return false;
  const isoDate = `${quarter.slice(0, 4)}-${quarter.slice(4, 6)}-${quarter.slice(6, 8)}`;
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === isoDate;
}

export function retainLatestQuarters(quarters, policy = FDIC_PERSISTENCE_POLICY) {
  if (!Array.isArray(quarters)) throw new Error("FDIC quarter list must be an array");
  const maxQuarters = Number(policy?.max_retained_quarters);
  if (!Number.isInteger(maxQuarters) || maxQuarters <= 0) {
    throw new Error("invalid FDIC persistence max_retained_quarters");
  }
  const seen = new Set();
  for (const quarter of quarters) {
    if (!validQuarterIdentifier(quarter)) throw new Error(`invalid FDIC quarter identifier: ${quarter}`);
    if (seen.has(quarter)) throw new Error(`duplicate FDIC quarter identifier: ${quarter}`);
    seen.add(quarter);
  }
  const sorted = [...quarters].sort((a, b) => String(a).localeCompare(String(b)));
  const retained = sorted.slice(-maxQuarters);
  return {
    quarters: retained,
    persistence_state: {
      available_quarters: sorted.length,
      retained_quarters: retained.length,
      pruned_quarters: sorted.length - retained.length,
    },
  };
}

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

function exactFdicPersistencePolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return false;
  const expectedKeys = Object.keys(FDIC_PERSISTENCE_POLICY).sort();
  const actualKeys = Object.keys(policy).sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index])
    && expectedKeys.every((key) => policy[key] === FDIC_PERSISTENCE_POLICY[key]);
}

function validFdicDocument(document) {
  const validLegacyShape = document?.source === "FDIC"
    && Array.isArray(document?.data)
    && document.data.length > 0
    && document.data.every((row) => (
      /^\d{4}-\d{2}-\d{2}$/.test(row?.date)
      && Number.isFinite(row?.value)
      && Number.isInteger(row?.banks)
      && row.banks > 0
    ))
    && fdicSourceAsOf(document) !== null;
  if (!validLegacyShape) return false;

  const hasPolicy = Object.prototype.hasOwnProperty.call(document, "persistence_policy");
  const hasState = Object.prototype.hasOwnProperty.call(document, "persistence_state");
  if (!hasPolicy && !hasState) return true;
  if (!hasPolicy || !hasState || !exactFdicPersistencePolicy(document.persistence_policy)) return false;
  if (document.data.length > MAX_QUARTERS) return false;
  if (document.data.some((row) => (
    typeof row.date !== "string" || !validQuarterIdentifier(row.date.replaceAll("-", ""))
  ))) return false;
  if (document.data.some((row, index) => index > 0 && document.data[index - 1].date >= row.date)) return false;

  const state = document.persistence_state;
  const available = state?.available_quarters;
  const retained = state?.retained_quarters;
  const pruned = state?.pruned_quarters;
  return Number.isInteger(available)
    && Number.isInteger(retained)
    && Number.isInteger(pruned)
    && available >= 0
    && retained >= 0
    && pruned >= 0
    && retained === document.data.length
    && available === retained + pruned;
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
  const retention = retainLatestQuarters(quarters);
  const retainedQuarters = retention.quarters;
  const injectedQuarter = controlledFailureQuarter(controlledFailureKey.trim(), eventName, retainedQuarters);
  const lkgStore = new LaneLkgStore({ repoRoot, laneId: "fdic_tier1" });
  const lkgArtifacts = [{
    key: "fdic_tier1",
    canonicalPath,
    validateDocument: validFdicDocument,
    sourceAsOf: fdicSourceAsOf,
  }];
  const run = { runId: String(runId), runAttempt: Number(runAttempt), eventName, observedAt };
  const requestResults = [];
  for (const [index, quarter] of retainedQuarters.entries()) {
    requestResults.push(await evaluateQuarter({ request, quarter, controlledFailureQuarter: injectedQuarter }));
    if (index < retainedQuarters.length - 1) await sleep(300);
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
    persistence_policy: FDIC_PERSISTENCE_POLICY,
    persistence_state: retention.persistence_state,
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
    promotion_contract: PROMOTION_CONTRACT_PROVIDER_OBSERVATION_V2,
    provider_observation: buildProviderObservationV2({
      payloadBytes: Buffer.from(serialized),
      sourceAsOf: fdicSourceAsOf(output),
      validateDocument: validFdicDocument,
      deriveSourceAsOf: fdicSourceAsOf,
      candidateContainsObservation: (candidateDocument, providerDocument) => JSON.stringify(candidateDocument) === JSON.stringify(providerDocument),
      run,
    }),
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
