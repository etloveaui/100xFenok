#!/usr/bin/env node

import fs from "node:fs";
import { createHash } from "node:crypto";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAttemptRow,
  buildSingleLaneShard,
  foldWorstTuples,
  returnedTuple,
  threwTuple,
  transportError,
  tupleStatus,
  writeJsonAtomic,
} from "./lib/data-supply-attempt-shard.mjs";
import { boundedDiagnosticDetail } from "./lib/diagnostic-detail.mjs";
import { ProducerLkgStateStore } from "./lib/producer-lkg-state.mjs";
import {
  classifyFloat32Change,
  withinParityTolerance,
} from "./check-us-indices-parity.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const LANE_ID = "us_indices_daily";
const SERIES = Object.freeze([
  { key: "sp500", symbol: "^GSPC", encoded: "%5EGSPC" },
  { key: "nasdaq", symbol: "^IXIC", encoded: "%5EIXIC" },
  { key: "nasdaq100", symbol: "^NDX", encoded: "%5ENDX" },
  { key: "sox", symbol: "^SOX", encoded: "%5ESOX" },
]);
const ENDPOINT = "https://query1.finance.yahoo.com/v8/finance/chart";
const ATTEMPT_SHARD_RELATIVE_PATH = "data/admin/data-supply-state/detection-attempts/us_indices_daily.json";
export const US_INDICES_MAX_SERIES_DATES = 15_000;
export const US_INDICES_PERSISTENCE_POLICY = Object.freeze({
  schema_version: "us-indices-bounded-persistence/v1",
  basis: "distinct_provider_date_per_series",
  max_distinct_provider_dates_per_series: US_INDICES_MAX_SERIES_DATES,
  eviction: "oldest_provider_date_first",
});

export function requestBytes(url, key, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { Accept: "application/json", "User-Agent": "100xFenok-platform/1.0" } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({ statusCode: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8"), key }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error("Yahoo chart request timed out"), { code: "ETIMEDOUT" })));
    request.on("error", reject);
  });
}

function localDate(unixSeconds, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(unixSeconds * 1000));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function validRow(row) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(row?.date)
    || !Number.isFinite(row?.value)
    || row.value <= 0) return false;
  const parsed = new Date(`${row.date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === row.date;
}

export function parseYahooChart(payload, expectedSymbol) {
  const result = payload?.chart?.result?.[0];
  if (!result || result.meta?.symbol !== expectedSymbol) throw new Error(`Yahoo chart symbol mismatch for ${expectedSymbol}`);
  const timestamps = result.timestamp;
  const closes = result.indicators?.quote?.[0]?.close;
  const timeZone = result.meta?.exchangeTimezoneName;
  if (!Array.isArray(timestamps) || !Array.isArray(closes) || timestamps.length !== closes.length || typeof timeZone !== "string") {
    throw new Error(`Yahoo chart arrays are invalid for ${expectedSymbol}`);
  }
  const byDate = new Map();
  for (let index = 0; index < timestamps.length; index += 1) {
    const row = { date: localDate(timestamps[index], timeZone), value: closes[index] };
    if (!validRow(row)) throw new Error(`Yahoo chart row must have a valid date and finite positive value for ${expectedSymbol}`);
    byDate.set(row.date, row);
  }
  const rows = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  if (rows.length === 0) throw new Error(`Yahoo chart has no valid rows for ${expectedSymbol}`);
  return rows;
}

export function mergeSeries(existing, incoming, {
  seriesKey = null,
  providerRevisions = null,
  revisionContext = {},
  observedAt = new Date().toISOString(),
} = {}) {
  if (!Array.isArray(existing) || !Array.isArray(incoming) || !existing.every(validRow) || !incoming.every(validRow)) {
    throw new Error("index series must contain valid date/value rows");
  }
  const output = existing.map((row) => ({ ...row }));
  const byDate = new Map(output.map((row) => [row.date, row.value]));
  const lastDate = output.at(-1)?.date ?? null;
  for (const row of [...incoming].sort((left, right) => left.date.localeCompare(right.date))) {
    if (byDate.has(row.date)) {
      const storedValue = byDate.get(row.date);
      if (storedValue !== row.value) {
        if (!Array.isArray(providerRevisions) || !seriesKey) throw new Error(`conflicting value for existing date ${row.date}`);
        const absolute = Math.abs(storedValue - row.value);
        const revision = {
          ...revisionContext,
          series: seriesKey,
          date: row.date,
          stored_value: storedValue,
          observed_value: row.value,
          abs_diff: absolute,
          relative_diff: storedValue === 0 ? null : absolute / Math.abs(storedValue),
          within_tolerance: withinParityTolerance(storedValue, row.value),
          ...classifyFloat32Change(storedValue, row.value),
          observed_at: observedAt,
        };
        providerRevisions.push(revision);
      }
      continue;
    }
    if (lastDate !== null && row.date <= lastDate) throw new Error(`out-of-order index date ${row.date}`);
    output.push({ ...row });
    byDate.set(row.date, row.value);
  }
  return output;
}

export function retainLatestSeriesRows(rows, maxDistinctDates = US_INDICES_MAX_SERIES_DATES) {
  if (!Array.isArray(rows) || !rows.every(validRow)) {
    throw new Error("index persistence requires valid date/value rows");
  }
  if (!Number.isInteger(maxDistinctDates) || maxDistinctDates < 1) {
    throw new Error("index persistence bound must be a positive integer");
  }
  const byDate = new Map();
  for (const row of rows) {
    if (byDate.has(row.date)) throw new Error(`duplicate index date ${row.date}`);
    byDate.set(row.date, { ...row });
  }
  const available = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  const retained = available.slice(-maxDistinctDates);
  return {
    rows: retained,
    persistence_state: {
      available_distinct_provider_dates: available.length,
      retained_distinct_provider_dates: retained.length,
      pruned_distinct_provider_dates: available.length - retained.length,
      first_retained_source_date: retained[0]?.date ?? null,
      last_retained_source_date: retained.at(-1)?.date ?? null,
    },
  };
}

function readSeries(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function seriesBytes(rows) {
  return Buffer.from(`${JSON.stringify(rows, null, 2)}\n`);
}

export function seriesContainsProviderObservation(candidate, provider) {
  if (!Array.isArray(candidate) || !Array.isArray(provider)) return false;
  const candidateByDate = new Map(candidate.map((row) => [row.date, row]));
  return provider.every((observation) => {
    const retained = candidateByDate.get(observation.date);
    return validRow(retained)
      && validRow(observation)
      && withinParityTolerance(retained.value, observation.value);
  });
}

function stateStore(root) {
  return new ProducerLkgStateStore({
    root,
    laneId: LANE_ID,
    publicRoot: "data/admin/us-indices-daily",
    validatePayload: (_key, payload) => Array.isArray(payload) && payload.length > 0 && payload.every(validRow),
    progressMarker: (_key, payload) => payload.at(-1)?.date ?? null,
    candidateContainsObservation: seriesContainsProviderObservation,
  });
}

function runContext(attemptId, eventName, observedAt) {
  const match = String(attemptId).match(/^gh-(\d+)-(\d+)-us-indices$/u);
  return {
    run_id: match?.[1] ?? String(attemptId),
    run_attempt: Number(match?.[2] ?? 1),
    event_name: eventName ?? "unknown",
    natural: eventName === "schedule" && Number(match?.[2] ?? 1) === 1,
    observed_at: observedAt,
  };
}

function classifyResponse(response, descriptor) {
  const statusCode = response?.statusCode;
  const body = String(response?.body ?? "");
  const bodySha256 = createHash("sha256").update(body).digest("hex");
  if (!Number.isInteger(statusCode) || statusCode < 200 || statusCode >= 300) {
    return { tuple: returnedTuple({ httpStatus: Number.isInteger(statusCode) ? statusCode : 500 }), rows: null, bodySha256 };
  }
  let document;
  try {
    document = JSON.parse(body);
  } catch (error) {
    return {
      tuple: returnedTuple({ httpStatus: statusCode, decode: "error" }),
      rows: null,
      failureDetail: boundedDiagnosticDetail(error),
      bodySha256,
    };
  }
  try {
    const rows = parseYahooChart(document, descriptor.symbol);
    return {
      tuple: returnedTuple({
        httpStatus: statusCode,
        decode: "ok",
        payload: "non_empty",
        assertions: [{ id: "chart_result_array", passed: true }],
      }),
      rows,
      bodySha256,
    };
  } catch (error) {
    return {
      tuple: returnedTuple({
        httpStatus: statusCode,
        decode: "ok",
        payload: "non_empty",
        assertions: [{ id: "chart_result_array", passed: false }],
      }),
      rows: null,
      error,
      failureDetail: boundedDiagnosticDetail(error),
      bodySha256,
    };
  }
}

function writeTargetsAtomic(plans) {
  const staged = plans.map(({ targetPath, bytes }) => {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const temporary = `${targetPath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
    fs.writeFileSync(temporary, bytes, { mode: 0o600 });
    return { targetPath, temporary, prior: fs.existsSync(targetPath) ? fs.readFileSync(targetPath) : null };
  });
  try {
    for (const row of staged) fs.renameSync(row.temporary, row.targetPath);
  } catch (error) {
    for (const row of staged) {
      fs.rmSync(row.temporary, { force: true });
      if (row.prior === null) fs.rmSync(row.targetPath, { force: true });
      else fs.writeFileSync(row.targetPath, row.prior);
    }
    throw error;
  }
}

function snapshotFiles(filePaths) {
  return [...new Set(filePaths)].map((filePath) => ({
    filePath,
    bytes: fs.existsSync(filePath) ? fs.readFileSync(filePath) : null,
  }));
}

function restoreFiles(snapshots) {
  const failures = [];
  for (const { filePath, bytes } of snapshots) {
    try {
      if (bytes === null) {
        fs.rmSync(filePath, { force: true });
        continue;
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      writeTargetsAtomic([{ targetPath: filePath, bytes }]);
    } catch (error) {
      failures.push(new Error(`${filePath}: ${error.message}`, { cause: error }));
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `failed to restore ${failures.length} US indices transaction path(s)`);
  }
}

export function withFileRollback(filePaths, action, restore = restoreFiles) {
  const snapshots = snapshotFiles(filePaths);
  try {
    return action();
  } catch (error) {
    try {
      restore(snapshots);
    } catch (rollbackError) {
      const aggregate = new AggregateError(
        [error, rollbackError],
        `US indices publication rollback failed: ${rollbackError.message}`,
      );
      aggregate.rollbackFailed = true;
      throw aggregate;
    }
    throw error;
  }
}

export function writeUsIndicesGitHubOutputs(result, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) return;
  fs.appendFileSync(outputPath, `rollback_failed=${result?.rollback_failed === true}\n`);
}

function transactionPaths({ canonicalRoot, stateRoot, persistencePath, candidates = [] }) {
  return [
    ...SERIES.flatMap(({ key }) => [
      path.join(canonicalRoot, `${key}.json`),
      path.join(stateRoot, "keys", `${key}.json`),
      path.join(stateRoot, "lkg", `${key}.json`),
      path.join(stateRoot, "promotion-contracts", `${key}.json`),
    ]),
    ...candidates
      .map(({ candidate }) => candidate?.providerObservation?.payload_sha256)
      .filter((payloadSha256) => typeof payloadSha256 === "string")
      .map((payloadSha256) => path.join(stateRoot, "provider-observations", `${payloadSha256}.json`)),
    path.join(stateRoot, "index.json"),
    persistencePath,
  ];
}

export async function runUsIndicesDaily({
  canonicalRoot = path.join(REPO_ROOT, "data", "indices"),
  stateRoot = path.join(REPO_ROOT, "data", "admin", "us-indices-daily"),
  persistencePath = path.join(stateRoot, "persistence.json"),
  attemptShardPath = path.join(REPO_ROOT, ATTEMPT_SHARD_RELATIVE_PATH),
  request = requestBytes,
  observedAt = new Date().toISOString(),
  attemptId = `gh-${process.env.GITHUB_RUN_ID ?? Date.now()}-${process.env.GITHUB_RUN_ATTEMPT ?? 1}-us-indices`,
  eventName = process.env.GITHUB_EVENT_NAME ?? "unknown",
  controlledFailure = process.env.INPUT_CONTROLLED_FAILURE ?? "",
  commitCandidateFn = (store, candidate) => store.commitCandidate(candidate),
  buildIndexFn = (store, keys, run) => store.buildIndex({ keys, run }),
  withFileRollbackFn = withFileRollback,
} = {}) {
  const controlled = String(controlledFailure).trim();
  if (controlled && controlled !== "transport") throw new Error(`unknown US indices controlled failure: ${controlled}`);
  if (controlled && eventName !== "workflow_dispatch") {
    throw new Error("US indices controlled failure requires workflow_dispatch");
  }
  const results = [];
  for (const descriptor of SERIES) {
    if (controlled) {
      results.push({
        descriptor,
        tuple: threwTuple("transport"),
        rows: null,
        controlled: true,
        failureDetail: "controlled_failure",
      });
      continue;
    }
    try {
      const url = `${ENDPOINT}/${descriptor.encoded}?range=5d&interval=1d`;
      results.push({ descriptor, url, ...classifyResponse(await request(url, descriptor.key), descriptor) });
    } catch (error) {
      results.push({
        descriptor,
        tuple: threwTuple(transportError(error) ? "transport" : "unexpected"),
        rows: null,
        error,
        failureDetail: boundedDiagnosticDetail(error),
      });
    }
  }
  const worst = foldWorstTuples(results.map((result) => result.tuple));
  // Local re-runs (no GITHUB_EVENT_NAME) must not rewrite the committed
  // current_attempt event of the SAME run as "unknown": inherit the stored value.
  const effectiveEventName = (() => {
    if (eventName !== "unknown") return eventName;
    const runIdMatch = String(attemptId).match(/^gh-(\d+)-/u)?.[1] ?? null;
    try {
      const prior = JSON.parse(fs.readFileSync(path.join(stateRoot, "index.json"), "utf8"));
      const priorAttempt = prior?.current_attempt ?? null;
      if (priorAttempt?.event_name && String(priorAttempt.run_id) === runIdMatch) {
        return priorAttempt.event_name;
      }
    } catch {
      // no readable prior index — keep the honest "unknown" fallback
    }
    return eventName;
  })();
  const run = runContext(attemptId, effectiveEventName, observedAt);
  const store = stateStore(stateRoot);
  const keys = SERIES.map(({ key }) => `${key}.json`);
  const providerRevisions = [];

  function recordPipelineFailure(error, { rollbackFailed = false } = {}) {
    const failedTuple = threwTuple("unexpected");
    const failedRow = buildAttemptRow({
      laneId: LANE_ID,
      memberId: null,
      tuple: failedTuple,
      attemptId,
      observedAt,
    });
    writeJsonAtomic(attemptShardPath, buildSingleLaneShard({ laneId: LANE_ID, row: failedRow }));
    const failureDetail = boundedDiagnosticDetail(error);
    if (rollbackFailed) {
      return {
        ok: false,
        updated: false,
        degraded: false,
        corrupt: true,
        exitCode: 2,
        row: failedRow,
        reason: "rollback_failed",
        index: null,
        persistence: null,
        providerRevisions,
        failure_detail: failureDetail,
        rollback_failed: true,
      };
    }
    for (const descriptor of SERIES) {
      const key = `${descriptor.key}.json`;
      const canonicalPath = path.join(canonicalRoot, key);
      store.recordFailure({
        key,
        error: failureDetail,
        failureKind: "unexpected",
        fallbackBytes: fs.existsSync(canonicalPath) ? fs.readFileSync(canonicalPath) : null,
        canonicalRef: `data/indices/${key}`,
        run,
      });
    }
    const failureIndex = store.buildIndex({ keys, run });
    const retained = failureIndex.counts?.lkg === SERIES.length
      && failureIndex.counts?.retry === SERIES.length
      && failureIndex.counts?.unavailable === 0;
    return {
      ok: false,
      updated: false,
      degraded: retained,
      corrupt: !retained,
      exitCode: retained ? 0 : 2,
      row: failedRow,
      reason: "unexpected_error",
      index: failureIndex,
      persistence: null,
      providerRevisions,
      failure_detail: failureDetail,
      rollback_failed: false,
    };
  }

  if (results.some((result) => result.rows === null)) {
    const row = buildAttemptRow({ laneId: LANE_ID, memberId: null, tuple: worst, attemptId, observedAt });
    writeJsonAtomic(attemptShardPath, buildSingleLaneShard({ laneId: LANE_ID, row }));
    for (const result of results.filter((entry) => entry.rows === null)) {
      const key = `${result.descriptor.key}.json`;
      const canonicalPath = path.join(canonicalRoot, key);
      store.recordFailure({
        key,
        error: result.controlled ? "controlled_failure" : (result.failureDetail ?? tupleStatus(result.tuple)),
        failureKind: result.controlled
          ? "controlled_failure"
          : (result.tuple.execution === "threw" ? result.tuple.exception_kind : "schema_drift"),
        fallbackBytes: fs.existsSync(canonicalPath) ? fs.readFileSync(canonicalPath) : null,
        canonicalRef: `data/indices/${key}`,
        run,
      });
    }
    const index = store.buildIndex({ keys: SERIES.map(({ key }) => `${key}.json`), run });
    const failedWorst = results.find((result) => result.tuple === worst);
    const retainedControlledFailure = controlled
      && index.counts?.lkg === SERIES.length
      && index.counts?.retry === SERIES.length
      && index.counts?.unavailable === 0;
    return {
      ok: false,
      updated: false,
      degraded: retainedControlledFailure,
      corrupt: !retainedControlledFailure,
      exitCode: retainedControlledFailure ? 0 : 2,
      row,
      reason: controlled ? "controlled_failure" : tupleStatus(worst),
      controlled_failure: controlled,
      index,
      failure_detail: failedWorst?.failureDetail ?? null,
    };
  }

  const candidates = [];
  const persistenceStates = {};
  try {
    for (const result of results) {
      const key = `${result.descriptor.key}.json`;
      const canonicalPath = path.join(canonicalRoot, key);
      const existing = readSeries(canonicalPath);
      const merged = mergeSeries(existing, result.rows, {
        seriesKey: result.descriptor.key,
        providerRevisions,
        revisionContext: {
          symbol: result.descriptor.symbol,
          endpoint: result.url,
          body_sha256: result.bodySha256,
          run_id: run.run_id,
          run_attempt: run.run_attempt,
          event_name: run.event_name,
          natural: run.natural,
        },
        observedAt,
      });
      const retained = retainLatestSeriesRows(merged);
      persistenceStates[result.descriptor.key] = retained.persistence_state;
      const payloadBytes = seriesBytes(retained.rows);
      const providerBytes = seriesBytes(result.rows);
      const candidate = store.planCandidate({
        key,
        payloadBytes,
        canonicalRef: `data/indices/${key}`,
        run,
        providerObservation: store.buildProviderObservation({ key, payloadBytes: providerBytes, run }),
      });
      candidates.push({ candidate, canonicalPath, bytes: payloadBytes });
    }
  } catch (error) {
    return recordPipelineFailure(error);
  }

  const outOfTolerance = providerRevisions.filter((revision) => revision.within_tolerance === false);
  if (outOfTolerance.length > 0) {
    const revisionFailure = returnedTuple({
      httpStatus: 200,
      decode: "ok",
      payload: "non_empty",
      assertions: [{ id: "chart_result_array", passed: false }],
    });
    const failedWorst = foldWorstTuples([worst, revisionFailure]);
    const row = buildAttemptRow({ laneId: LANE_ID, memberId: null, tuple: failedWorst, attemptId, observedAt });
    writeJsonAtomic(attemptShardPath, buildSingleLaneShard({ laneId: LANE_ID, row }));
    for (const revision of outOfTolerance) {
      const key = `${revision.series}.json`;
      const canonicalPath = path.join(canonicalRoot, key);
      store.recordFailure({
        key,
        error: `out-of-tolerance provider revision for ${revision.date}`,
        failureKind: "schema_drift",
        fallbackBytes: fs.existsSync(canonicalPath) ? fs.readFileSync(canonicalPath) : null,
        canonicalRef: `data/indices/${key}`,
        run,
      });
    }
    store.buildIndex({ keys: SERIES.map(({ key }) => `${key}.json`), run });
    return {
      ok: false,
      updated: false,
      exitCode: 2,
      row,
      reason: tupleStatus(failedWorst),
      providerRevisions,
    };
  }

  const rejectedCandidates = candidates.filter(({ candidate }) => !candidate.accepted);
  if (rejectedCandidates.length > 0) {
    const allDeferred = rejectedCandidates.every(({ candidate }) => candidate.deferred === true);
    if (!allDeferred) {
      const rejected = rejectedCandidates[0].candidate;
      return recordPipelineFailure(new Error(`${rejected.key}: live candidate rejected: ${rejected.reason}`));
    }
    const row = buildAttemptRow({ laneId: LANE_ID, memberId: null, tuple: worst, attemptId, observedAt });
    writeJsonAtomic(attemptShardPath, buildSingleLaneShard({ laneId: LANE_ID, row }));
    const blockedByKeys = rejectedCandidates.map(({ candidate }) => candidate.key);
    const atomicCandidates = candidates.map(({ candidate }) => candidate.accepted
      ? {
          ...candidate,
          accepted: false,
          deferred: true,
          reason: "atomic_peer_deferral",
          blocked_by_keys: blockedByKeys,
        }
      : candidate);
    let deferredIndex;
    try {
      deferredIndex = withFileRollbackFn(
        transactionPaths({ canonicalRoot, stateRoot, persistencePath }),
        () => {
          for (const candidate of atomicCandidates) store.recordPromotionDeferral(candidate);
          return buildIndexFn(store, keys, run);
        },
      );
    } catch (error) {
      return recordPipelineFailure(error, { rollbackFailed: error?.rollbackFailed === true });
    }
    return {
      ok: false,
      updated: false,
      degraded: true,
      corrupt: false,
      exitCode: 0,
      row,
      reason: rejectedCandidates[0].candidate.reason,
      index: deferredIndex,
      persistence: null,
      providerRevisions,
      rollback_failed: false,
    };
  }

  const row = buildAttemptRow({ laneId: LANE_ID, memberId: null, tuple: worst, attemptId, observedAt });
  writeJsonAtomic(attemptShardPath, buildSingleLaneShard({ laneId: LANE_ID, row }));
  const persistence = {
    schema_version: "us-indices-persistence-state/v1",
    lane_id: LANE_ID,
    updated_at: observedAt,
    run_id: run.run_id,
    run_attempt: run.run_attempt,
    event_name: run.event_name,
    persistence_policy: US_INDICES_PERSISTENCE_POLICY,
    series: persistenceStates,
  };
  let index;
  try {
    index = withFileRollbackFn(
      transactionPaths({ canonicalRoot, stateRoot, persistencePath, candidates }),
      () => {
        writeTargetsAtomic([
          ...candidates.flatMap(({ canonicalPath, bytes }) => [
            { targetPath: canonicalPath, bytes },
          ]),
          { targetPath: persistencePath, bytes: Buffer.from(`${JSON.stringify(persistence, null, 2)}\n`) },
        ]);
        for (const { candidate } of candidates) commitCandidateFn(store, candidate);
        return buildIndexFn(store, keys, run);
      },
    );
  } catch (error) {
    return recordPipelineFailure(error, { rollbackFailed: error?.rollbackFailed === true });
  }
  return {
    ok: true,
    updated: true,
    exitCode: 0,
    row,
    reason: tupleStatus(worst),
    index,
    persistence,
    providerRevisions,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runUsIndicesDaily().then((result) => {
    writeUsIndicesGitHubOutputs(result);
    console.log(JSON.stringify({
      ok: result.ok,
      updated: result.updated,
      exit_code: result.exitCode,
      reason: result.reason,
      failure_detail: result.failure_detail ?? null,
      provider_revision_events: result.providerRevisions?.length ?? 0,
    }));
    process.exitCode = result.exitCode;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 2;
  });
}
