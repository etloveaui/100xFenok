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
import { boundedDiagnosticDetail, diagnosticSuffix } from "./lib/diagnostic-detail.mjs";

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

export function latestClosedQuarter(now = new Date()) {
  const instant = new Date(now);
  if (!Number.isFinite(instant.getTime())) throw new Error("invalid FDIC quarter probe clock");
  const year = instant.getUTCFullYear();
  const candidates = [];
  for (let candidateYear = year - 1; candidateYear <= year; candidateYear += 1) {
    for (const suffix of ["0331", "0630", "0930", "1231"]) {
      const month = Number(suffix.slice(0, 2));
      const day = Number(suffix.slice(2));
      const closedAfterMs = Date.UTC(candidateYear, month - 1, day + 1);
      if (closedAfterMs <= instant.getTime()) candidates.push(`${candidateYear}${suffix}`);
    }
  }
  if (candidates.length === 0) throw new Error("unable to derive latest closed FDIC quarter");
  return candidates.sort().at(-1);
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
      failure_detail: boundedDiagnosticDetail(error),
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

export function migrateFdicPersistenceDocument(document) {
  if (!validFdicDocument(document)) throw new Error("FDIC persistence migration source is invalid");
  const hasPolicy = Object.prototype.hasOwnProperty.call(document, "persistence_policy");
  const hasState = Object.prototype.hasOwnProperty.call(document, "persistence_state");
  if (hasPolicy || hasState) {
    if (!hasPolicy || !hasState || !exactFdicPersistencePolicy(document.persistence_policy)) {
      throw new Error("FDIC persistence migration source has partial or invalid metadata");
    }
    return { changed: false, document: structuredClone(document) };
  }

  const byQuarter = new Map();
  const quarters = document.data.map((row) => {
    const quarter = row.date.replaceAll("-", "");
    if (byQuarter.has(quarter)) throw new Error(`duplicate FDIC quarter identifier: ${quarter}`);
    byQuarter.set(quarter, structuredClone(row));
    return quarter;
  });
  const retained = retainLatestQuarters(quarters);
  const migrated = {
    updated: document.updated,
    source: document.source,
    description: document.description,
    persistence_policy: FDIC_PERSISTENCE_POLICY,
    persistence_state: retained.persistence_state,
    data: retained.quarters.map((quarter) => byQuarter.get(quarter)),
  };
  if (!validFdicDocument(migrated)) throw new Error("FDIC persistence migration output is invalid");
  return { changed: true, document: migrated };
}

export function runFdicPersistenceMigration({
  canonicalPath = path.join(REPO_ROOT, "data", "macro", "fdic-tier1.json"),
  eventName = process.env.GITHUB_EVENT_NAME || "local",
  read = (targetPath) => fs.readFileSync(targetPath),
  write = (targetPath, bytes) => atomicWrite(targetPath, bytes),
} = {}) {
  if (eventName !== "workflow_dispatch") {
    throw new Error("FDIC persistence migration requires workflow_dispatch");
  }
  const canonicalBefore = Buffer.from(read(canonicalPath));
  let source;
  try {
    source = JSON.parse(canonicalBefore.toString("utf8"));
  } catch {
    throw new Error("FDIC persistence migration source is invalid JSON");
  }
  const migrated = migrateFdicPersistenceDocument(source);
  if (!migrated.changed) {
    return {
      ok: true,
      reason: "already_migrated",
      updated: false,
      quarters: migrated.document.data.length,
      pruned: migrated.document.persistence_state.pruned_quarters,
    };
  }

  const bytes = Buffer.from(`${JSON.stringify(migrated.document, null, 2)}\n`);
  try {
    write(canonicalPath, bytes);
  } catch (error) {
    try {
      atomicWrite(canonicalPath, canonicalBefore);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `FDIC persistence migration failed and rollback was incomplete: ${error.message}`,
      );
    }
    throw error;
  }
  return {
    ok: true,
    reason: "migrated",
    updated: true,
    quarters: migrated.document.data.length,
    pruned: migrated.document.persistence_state.pruned_quarters,
  };
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
  attemptShardPath = path.join(REPO_ROOT, "data", "admin", "data-supply-state", "detection-attempts", "fdic_tier1.json"),
  quarters = generateQuarters(),
  probeQuarter = null,
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
  if (probeQuarter !== null && !validQuarterIdentifier(probeQuarter)) {
    throw new Error(`invalid FDIC probe quarter: ${probeQuarter}`);
  }
  const retention = retainLatestQuarters(quarters);
  const retainedQuarters = retention.quarters;
  if (probeQuarter !== null && !retainedQuarters.includes(probeQuarter) && probeQuarter <= retainedQuarters.at(-1)) {
    throw new Error(`FDIC probe quarter must be newer than retained history: ${probeQuarter}`);
  }
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
  const baselineWorst = worstRequestResult(requestResults);
  if (baselineWorst.status !== "ready") {
    const attempt = writeAttemptShard({
      laneId: "fdic_tier1",
      attemptShardPath,
      observedAt,
      attemptId,
      result: baselineWorst,
    });
    const systemicOutage = allNaturalRequestsFailed(requestResults, (row) => row.quarter === injectedQuarter);
    const failureReason = systemicLkgFailureReason([baselineWorst.reason, ...requestResults.map((row) => row.reason)])
      ?? (injectedQuarter && !systemicOutage ? "controlled_failure" : baselineWorst.reason);
    const failure = lkgStore.recordFailure({ artifacts: lkgArtifacts, run, reason: failureReason });
    const outcome = classifyLkgFailure({ reason: failureReason, hasCompleteLkg: failure.hasCompleteLkg, systemic: systemicOutage });
    const failureDetail = failureReason === "controlled_failure"
      ? null
      : baselineWorst.failure_detail ?? requestResults.find((row) => row.failure_detail)?.failure_detail ?? null;
    return {
      ok: false,
      reason: failureReason,
      updated: false,
      attempt,
      retrySet: failure.retrySet,
      ...(failureDetail ? { failure_detail: failureDetail } : {}),
      ...outcome,
    };
  }

  let probe = null;
  let acceptedProbeResult = null;
  if (probeQuarter !== null) {
    if (retainedQuarters.includes(probeQuarter)) {
      probe = { quarter: probeQuarter, status: "already_included", reason: "ready" };
    } else {
      await sleep(300);
      const probeResult = await evaluateQuarter({
        request,
        quarter: probeQuarter,
        controlledFailureQuarter: null,
      });
      if (probeResult.status === "ready") {
        acceptedProbeResult = probeResult;
        probe = { quarter: probeQuarter, status: "included", reason: "ready" };
      } else if (probeResult.reason === "empty_payload") {
        probe = { quarter: probeQuarter, status: "not_yet_published", reason: probeResult.reason };
      } else {
        probe = { quarter: probeQuarter, status: "failed", reason: probeResult.reason };
      }
    }
  }

  const acceptedResults = acceptedProbeResult === null
    ? requestResults
    : [...requestResults, acceptedProbeResult];
  const attempt = writeAttemptShard({
    laneId: "fdic_tier1",
    attemptShardPath,
    observedAt,
    attemptId,
    result: worstRequestResult(acceptedResults),
  });
  const availableQuarters = acceptedProbeResult === null ? quarters : [...quarters, probeQuarter];
  const finalRetention = retainLatestQuarters(availableQuarters);
  const rowByQuarter = new Map(acceptedResults.map((row) => [row.quarter, row.row]));
  const data = finalRetention.quarters.map((quarter) => rowByQuarter.get(quarter));
  if (data.some((row) => row == null)) throw new Error("FDIC retained quarter is missing a fetched row");
  const output = {
    updated: observedAt,
    source: "FDIC",
    description: "Average Tier 1 Capital Ratio (RBC1AAJ)",
    persistence_policy: FDIC_PERSISTENCE_POLICY,
    persistence_state: finalRetention.persistence_state,
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
      probe,
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
      probe,
      degraded: true,
      corrupt: false,
      exitCode: 0,
    };
  }
  atomicWrite(canonicalPath, serialized);
  const success = lkgStore.recordSuccess({ artifacts: promotable, run });
  const recovered = success.state.items.fdic_tier1?.recovered_at === observedAt;
  return { ok: true, reason: "ok", updated: true, attempt, quarters: data.length, recovered, probe };
}

async function main() {
  if ((process.env.INPUT_PERSISTENCE_MIGRATION_ONLY || "").trim().toLowerCase() === "true") {
    const result = runFdicPersistenceMigration();
    console.log(
      result.updated
        ? `Migrated FDIC persistence metadata for ${result.quarters} quarters; pruned ${result.pruned}`
        : `FDIC persistence metadata already current for ${result.quarters} quarters`,
    );
    return;
  }
  const observedAt = new Date().toISOString();
  const result = await runFdicTier1({
    observedAt,
    probeQuarter: latestClosedQuarter(new Date(observedAt)),
  });
  const probeSuffix = result.probe?.status === "included"
    ? `; discovered latest closed quarter ${result.probe.quarter}`
    : result.probe?.status === "not_yet_published"
      ? `; latest closed quarter ${result.probe.quarter} not yet published`
      : result.probe?.status === "failed"
        ? `; latest closed quarter probe ${result.probe.quarter} failed (${result.probe.reason})`
        : "";
  if (!result.ok) {
    const prefix = result.degraded ? "[degraded]" : "[corrupt]";
    const message = `${prefix} FDIC Tier1 ${result.reason}; retry set: ${(result.retrySet || []).join(", ") || "none"}${probeSuffix}${diagnosticSuffix(result.failure_detail)}`;
    if (result.degraded) console.log(message);
    else console.error(message);
    process.exitCode = result.exitCode ?? 2;
    return;
  }
  console.log(`Saved ${result.quarters} FDIC quarters and current-attempt evidence${result.recovered ? "; recovered from LKG" : ""}${probeSuffix}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
