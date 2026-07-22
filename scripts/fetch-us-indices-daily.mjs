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
import { ProducerLkgStateStore } from "./lib/producer-lkg-state.mjs";
import {
  classifyFloat32Change,
  emitUsIndicesParity,
  withinParityTolerance,
} from "./check-us-indices-parity.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const LANE_ID = "us_indices_daily";
const SERIES = Object.freeze([
  { key: "sp500", symbol: "^GSPC", encoded: "%5EGSPC" },
  { key: "nasdaq", symbol: "^IXIC", encoded: "%5EIXIC" },
]);
const ENDPOINT = "https://query1.finance.yahoo.com/v8/finance/chart";
const ATTEMPT_SHARD_RELATIVE_PATH = "data/admin/data-supply-state/detection-attempts/us_indices_daily.json";

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
  return /^\d{4}-\d{2}-\d{2}$/u.test(row?.date)
    && Number.isFinite(row?.value)
    && row.value > 0;
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

function readSeries(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function seriesBytes(rows) {
  return Buffer.from(`${JSON.stringify(rows, null, 2)}\n`);
}

function stateStore(root) {
  return new ProducerLkgStateStore({
    root,
    laneId: LANE_ID,
    publicRoot: "data/admin/us-indices-daily",
    validatePayload: (_key, payload) => Array.isArray(payload) && payload.length > 0 && payload.every(validRow),
    progressMarker: (_key, payload) => payload.at(-1)?.date ?? null,
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
  } catch {
    return { tuple: returnedTuple({ httpStatus: statusCode, decode: "error" }), rows: null, bodySha256 };
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
      bodySha256,
    };
  }
}

function writePairAtomic(plans) {
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

export async function runUsIndicesShadow({
  shadowRoot = path.join(REPO_ROOT, "data", "admin", "us-indices-daily", "shadow"),
  stateRoot = path.join(REPO_ROOT, "data", "admin", "us-indices-daily"),
  attemptShardPath = path.join(REPO_ROOT, ATTEMPT_SHARD_RELATIVE_PATH),
  parityReportPath = path.join(REPO_ROOT, "data", "admin", "us-indices-daily", "parity-report.json"),
  gasCanonicalRoot = path.join(REPO_ROOT, "data", "indices"),
  request = requestBytes,
  observedAt = new Date().toISOString(),
  attemptId = `gh-${process.env.GITHUB_RUN_ID ?? Date.now()}-${process.env.GITHUB_RUN_ATTEMPT ?? 1}-us-indices`,
  eventName = process.env.GITHUB_EVENT_NAME ?? "unknown",
} = {}) {
  const results = [];
  for (const descriptor of SERIES) {
    try {
      const url = `${ENDPOINT}/${descriptor.encoded}?range=5d&interval=1d`;
      results.push({ descriptor, url, ...classifyResponse(await request(url, descriptor.key), descriptor) });
    } catch (error) {
      results.push({
        descriptor,
        tuple: threwTuple(transportError(error) ? "transport" : "unexpected"),
        rows: null,
        error,
      });
    }
  }
  const worst = foldWorstTuples(results.map((result) => result.tuple));
  const row = buildAttemptRow({ laneId: LANE_ID, memberId: null, tuple: worst, attemptId, observedAt });
  writeJsonAtomic(attemptShardPath, buildSingleLaneShard({ laneId: LANE_ID, row }));
  const run = runContext(attemptId, eventName, observedAt);
  const store = stateStore(stateRoot);
  if (results.some((result) => result.rows === null)) {
    for (const result of results.filter((entry) => entry.rows === null)) {
      const key = `${result.descriptor.key}.json`;
      const shadowPath = path.join(shadowRoot, key);
      store.recordFailure({
        key,
        error: result.error?.message ?? tupleStatus(result.tuple),
        failureKind: result.tuple.execution === "threw" ? result.tuple.exception_kind : "schema_drift",
        fallbackBytes: fs.existsSync(shadowPath) ? fs.readFileSync(shadowPath) : null,
        canonicalRef: `data/admin/us-indices-daily/shadow/${key}`,
        run,
      });
    }
    store.buildIndex({ keys: SERIES.map(({ key }) => `${key}.json`), run });
    return { ok: false, updated: false, exitCode: 2, row, reason: tupleStatus(worst) };
  }

  const candidates = [];
  const providerRevisions = [];
  const newDatesBySeries = {};
  for (const result of results) {
    const key = `${result.descriptor.key}.json`;
    const targetPath = path.join(shadowRoot, key);
    const existing = readSeries(targetPath);
    const existingDates = new Set(existing.map((row) => row.date));
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
    newDatesBySeries[result.descriptor.key] = merged
      .filter((row) => !existingDates.has(row.date))
      .map((row) => row.date);
    const payloadBytes = seriesBytes(merged);
    const candidate = store.planCandidate({
      key,
      payloadBytes,
      canonicalRef: `data/admin/us-indices-daily/shadow/${key}`,
      run,
      providerObservation: store.buildProviderObservation({ key, payloadBytes, run }),
    });
    if (!candidate.accepted) throw new Error(`${key}: shadow candidate rejected: ${candidate.reason}`);
    candidates.push({ candidate, targetPath, bytes: payloadBytes });
  }
  writePairAtomic(candidates);
  for (const { candidate } of candidates) store.commitCandidate(candidate);
  const index = store.buildIndex({ keys: SERIES.map(({ key }) => `${key}.json`), run });
  const parity = emitUsIndicesParity({
    shadowRoot,
    gasCanonicalRoot,
    outputPath: parityReportPath,
    observedAt,
    providerRevisions,
    run,
    newDatesBySeries,
  });
  return { ok: true, updated: true, exitCode: 0, row, reason: tupleStatus(worst), index, parity };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runUsIndicesShadow().then((result) => {
    console.log(JSON.stringify({ ok: result.ok, updated: result.updated, exit_code: result.exitCode, reason: result.reason }));
    process.exitCode = result.exitCode;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 2;
  });
}
