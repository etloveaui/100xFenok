#!/usr/bin/env node

import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAttemptRow,
  buildSingleLaneShard,
  returnedTuple,
  threwTuple,
  transportError,
  writeJsonAtomic,
} from "./lib/data-supply-attempt-shard.mjs";
import {
  ATTEMPT_SHARD_SCHEMA,
  validateAttemptShard,
} from "./build-data-supply-detection-floor.mjs";
import { boundedDiagnosticDetail } from "./lib/diagnostic-detail.mjs";
import {
  LaneLkgStore,
  PROMOTION_CONTRACT_PROVIDER_OBSERVATION_V2,
  buildProviderObservationV2,
  classifyLkgFailure,
  isNaturalScheduleRun,
} from "./lib/data-supply-lkg-store.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const LANE_ID = "oecd_cli";
const ATTEMPT_SHARD_RELATIVE_PATH = "data/admin/data-supply-state/detection-attempts/oecd_cli.json";
export const OECD_MAX_MONTHS_PER_SERIES = 240;
export const OECD_PERSISTENCE_POLICY = Object.freeze({
  schema_version: "oecd-cli-bounded-persistence/v1",
  basis: "monthly_provider_period_per_series",
  max_months_per_series: OECD_MAX_MONTHS_PER_SERIES,
  eviction: "oldest_provider_period_first",
});
export const OECD_SERIES = Object.freeze({
  AUS: "australia", BRA: "brazil", CAN: "canada", CHN: "china", FRA: "france",
  G20: "g20", G7: "g7", DEU: "germany", IND: "india", IDN: "indonesia",
  ITA: "italy", JPN: "japan", KOR: "korea", A5M: "major_five_asia_economies",
  G4E: "major_four_european_countries", MEX: "mexico", NAFTA: "nafta",
  ZAF: "south_africa", ESP: "spain", TUR: "turkiye", GBR: "united_kingdom", USA: "united_states",
});
const AREA_CODES = Object.keys(OECD_SERIES);
const ENDPOINT = `https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_CLI,/${AREA_CODES.join("+")}.M.LI...AA...H?startPeriod=2016-05&format=csvfilewithlabels`;

export function requestBytes(url, { timeoutMs = 45_000 } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { Accept: "text/csv", "User-Agent": "100xFenok-platform/1.0" } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({ statusCode: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error("OECD SDMX request timed out"), { code: "ETIMEDOUT" })));
    request.on("error", reject);
  });
}

function csvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function validSourceDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function retainLatestOecdMonths(values, maxMonths = OECD_MAX_MONTHS_PER_SERIES) {
  if (!Array.isArray(values) || !values.every((row) => validSourceDate(row?.date) && Number.isFinite(row?.value))) {
    throw new Error("OECD persistence requires valid monthly observations");
  }
  if (!Number.isInteger(maxMonths) || maxMonths < 1) {
    throw new Error("OECD persistence bound must be a positive integer");
  }
  const byDate = new Map();
  for (const row of values) {
    if (byDate.has(row.date)) throw new Error("duplicate OECD periods");
    byDate.set(row.date, { ...row });
  }
  const available = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  const retained = available.slice(-maxMonths);
  return {
    rows: retained,
    persistence_state: {
      available_months: available.length,
      retained_months: retained.length,
      pruned_months: available.length - retained.length,
      first_retained_source_date: retained[0]?.date ?? null,
      last_retained_source_date: retained.at(-1)?.date ?? null,
    },
  };
}

export function parseOecdCsv(text, observedAt = null) {
  const rows = csvRows(String(text));
  const header = rows.shift() ?? [];
  const index = Object.fromEntries(header.map((name, position) => [name, position]));
  for (const column of ["REF_AREA", "TIME_PERIOD", "OBS_VALUE"]) {
    if (!Number.isInteger(index[column])) throw new Error(`OECD CSV missing column ${column}`);
  }
  const series = Object.fromEntries(Object.values(OECD_SERIES).map((key) => [key, []]));
  for (const row of rows) {
    const code = row[index.REF_AREA];
    if (!Object.hasOwn(OECD_SERIES, code)) throw new Error(`unknown OECD area ${code}`);
    const period = row[index.TIME_PERIOD];
    const value = Number(row[index.OBS_VALUE]);
    if (!/^\d{4}-\d{2}$/u.test(period) || !validSourceDate(`${period}-01`) || !Number.isFinite(value)) {
      throw new Error(`invalid OECD observation ${code}:${period}`);
    }
    series[OECD_SERIES[code]].push({ date: `${period}-01`, value });
  }
  const missing = Object.entries(series).filter(([, values]) => values.length === 0).map(([key]) => key);
  if (missing.length > 0) throw new Error(`missing OECD series: ${missing.join(", ")}`);
  const retainedBySeries = Object.fromEntries(Object.entries(series).map(([key, values]) => [
    key,
    retainLatestOecdMonths(values),
  ]));
  const retainedSeries = Object.fromEntries(Object.entries(retainedBySeries).map(([key, retained]) => [
    key,
    retained.rows,
  ]));
  const periods = [...new Set(Object.values(retainedSeries).flatMap((values) => values.map((row) => row.date)))].sort();
  return {
    schema_version: "oecd-cli-shadow/v1",
    source: "OECD SDMX DF_CLI",
    source_endpoint: "OECD.SDD.STES,DSD_STES@DF_CLI",
    generated_at: observedAt,
    latest_date: periods.at(-1),
    latest_values: Object.fromEntries(Object.entries(retainedSeries).map(([key, values]) => [key, values.at(-1).value])),
    persistence_policy: OECD_PERSISTENCE_POLICY,
    persistence_state: {
      series: Object.fromEntries(Object.entries(retainedBySeries).map(([key, retained]) => [
        key,
        retained.persistence_state,
      ])),
    },
    series: retainedSeries,
    records: periods.map((date) => ({
      date,
      period: date.slice(0, 7),
      values: Object.fromEntries(Object.entries(retainedSeries).filter(([, values]) => values.some((row) => row.date === date)).map(([key, values]) => [key, values.find((row) => row.date === date).value])),
    })),
  };
}

export function validOecdPayload(document) {
  if (document?.schema_version !== "oecd-cli-shadow/v1"
    || !validSourceDate(document?.latest_date)
    || JSON.stringify(document?.persistence_policy) !== JSON.stringify(OECD_PERSISTENCE_POLICY)
    || !document?.series || typeof document.series !== "object" || Array.isArray(document.series)
    || !document?.persistence_state?.series
    || !document?.latest_values || typeof document.latest_values !== "object" || Array.isArray(document.latest_values)
    || !Array.isArray(document?.records) || document.records.length === 0) return false;
  const keys = Object.values(OECD_SERIES);
  if (Object.keys(document.series).length !== keys.length
    || Object.keys(document.latest_values).length !== keys.length
    || keys.some((key) => !Array.isArray(document.series[key]) || document.series[key].length === 0)) {
    return false;
  }
  for (const key of keys) {
    const rows = document.series[key];
    const state = document.persistence_state.series[key];
    const sortedDates = rows.map((row) => row.date).toSorted();
    if (!rows.every((row) => validSourceDate(row?.date) && Number.isFinite(row?.value))
      || rows.length > OECD_MAX_MONTHS_PER_SERIES
      || new Set(rows.map((row) => row.date)).size !== rows.length
      || JSON.stringify(rows.map((row) => row.date)) !== JSON.stringify(sortedDates)
      || !state
      || state.retained_months !== rows.length
      || state.available_months !== state.retained_months + state.pruned_months
      || state.first_retained_source_date !== rows[0]?.date
      || state.last_retained_source_date !== rows.at(-1)?.date
      || document.latest_values[key] !== rows.at(-1)?.value) return false;
  }
  const periods = [...new Set(Object.values(document.series)
    .flatMap((rows) => rows.map((row) => row.date)))].sort();
  const expectedRecords = periods.map((date) => ({
    date,
    period: date.slice(0, 7),
    values: Object.fromEntries(Object.entries(document.series)
      .filter(([, rows]) => rows.some((row) => row.date === date))
      .map(([key, rows]) => [key, rows.find((row) => row.date === date).value])),
  }));
  return periods.at(-1) === document.latest_date
    && JSON.stringify(document.records) === JSON.stringify(expectedRecords);
}

function oecdProviderProgressVector(document) {
  if (!validOecdPayload(document)) throw new Error("OECD provider progress payload is invalid");
  return Object.fromEntries(Object.values(OECD_SERIES).map((key) => [
    key,
    document.series[key].at(-1).date,
  ]));
}

export function evaluateOecdProviderProgress(retainedPayload, candidatePayload) {
  const retained = oecdProviderProgressVector(retainedPayload);
  const candidate = oecdProviderProgressVector(candidatePayload);
  const keys = Object.values(OECD_SERIES);
  const regressedSeries = keys.filter((key) => candidate[key] < retained[key]);
  const advancedSeries = keys.filter((key) => candidate[key] > retained[key]);
  if (regressedSeries.length > 0) {
    return {
      eligible: false,
      reason: "recovery_provider_regression",
      regressed_series: regressedSeries,
      advanced_series: advancedSeries,
    };
  }
  if (advancedSeries.length === 0) {
    return {
      eligible: false,
      reason: "recovery_not_advanced_by_provider",
      regressed_series: [],
      advanced_series: [],
    };
  }
  return {
    eligible: true,
    reason: "ok",
    regressed_series: [],
    advanced_series: advancedSeries,
  };
}

function retainedOecdPayload(repoRoot, store, item) {
  const expectedPath = "data/admin/oecd_cli/lkg/oecd_cli.json";
  if (item?.lkg?.path !== expectedPath
    || !store.validRetainedLkg("oecd_cli", validOecdPayload, (document) => document?.latest_date ?? null)) {
    throw new Error("OECD retained LKG is invalid");
  }
  const payload = JSON.parse(fs.readFileSync(path.join(repoRoot, expectedPath), "utf8"));
  if (!validOecdPayload(payload)) throw new Error("OECD retained LKG payload is invalid");
  return payload;
}

function recordSuccessWithVectorDecision(store, input, vectorDecision) {
  if (vectorDecision?.eligible !== true) return store.recordSuccess(input);
  const evaluatePromotionCandidates = store.evaluatePromotionCandidates;
  store.evaluatePromotionCandidates = (artifacts) => artifacts.map((artifact) => ({
    key: artifact.key,
    eligible: true,
    reason: "ok",
    artifact,
  }));
  try {
    return store.recordSuccess(input);
  } finally {
    store.evaluatePromotionCandidates = evaluatePromotionCandidates;
  }
}

function parityReport(shadow, canonicalPath, observedAt) {
  let canonical;
  try { canonical = JSON.parse(fs.readFileSync(canonicalPath, "utf8")); } catch { canonical = null; }
  const existing = canonical?.datasets?.oecd_cli?.coverage?.latest_values ?? {};
  const revisions = Object.entries(shadow.latest_values).filter(([key, value]) => Number.isFinite(existing[key]) && existing[key] !== value)
    .map(([key, value]) => ({ key, canonical_value: existing[key], shadow_value: value, abs_diff: Math.abs(existing[key] - value) }));
  return {
    schema_version: "oecd-cli-shadow-parity/v1",
    observed_at: observedAt,
    canonical_status: canonical ? "readable" : "unavailable",
    compared_latest_values: Object.keys(existing).length,
    revisions,
  };
}

function writePairAtomic(entries) {
  const staged = entries.map(({ target, value }) => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
    return { target, temporary, prior: fs.existsSync(target) ? fs.readFileSync(target) : null };
  });
  try { for (const row of staged) fs.renameSync(row.temporary, row.target); }
  catch (error) {
    for (const row of staged) {
      fs.rmSync(row.temporary, { force: true });
      if (row.prior === null) fs.rmSync(row.target, { force: true }); else fs.writeFileSync(row.target, row.prior);
    }
    throw error;
  }
}

function snapshotFiles(filePaths) {
  return filePaths.map((filePath) => ({
    filePath,
    bytes: fs.existsSync(filePath) ? fs.readFileSync(filePath) : null,
  }));
}

function restoreFiles(snapshot) {
  for (const { filePath, bytes } of snapshot) {
    if (bytes === null) {
      fs.rmSync(filePath, { force: true });
      continue;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, bytes);
  }
}

export const OECD_MAX_ATTEMPT_HISTORY = 24;

export function recordOecdAttempt({
  attemptShardPath,
  row,
  maxAttempts = OECD_MAX_ATTEMPT_HISTORY,
}) {
  let existingAttempts = [];
  if (fs.existsSync(attemptShardPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(attemptShardPath, "utf8"));
      if (Array.isArray(existing?.attempts)) {
        existingAttempts = existing.attempts.filter((item) => item && typeof item === "object" && item.attempt_id !== row.attempt_id);
      }
    } catch {
      existingAttempts = [];
    }
  }
  const attempts = [row, ...existingAttempts]
    .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))
    .slice(0, maxAttempts);
  const shard = {
    schema_version: ATTEMPT_SHARD_SCHEMA,
    lane_id: LANE_ID,
    attempts,
  };
  validateAttemptShard(shard, LANE_ID);
  writeJsonAtomic(attemptShardPath, shard);
  return shard;
}

export async function runOecdCliShadow({
  repoRoot = REPO_ROOT,
  shadowPath = path.join(REPO_ROOT, "data/admin/oecd_cli/shadow/oecd-cli.json"),
  parityReportPath = path.join(REPO_ROOT, "data/admin/oecd_cli/parity-report.json"),
  attemptShardPath = path.join(REPO_ROOT, ATTEMPT_SHARD_RELATIVE_PATH),
  canonicalPath = path.join(REPO_ROOT, "data/macro/activity-surveys.json"),
  request = requestBytes,
  observedAt = new Date().toISOString(),
  attemptId = `gh-${process.env.GITHUB_RUN_ID ?? Date.now()}-${process.env.GITHUB_RUN_ATTEMPT ?? 1}-oecd-cli`,
  runId = process.env.GITHUB_RUN_ID || String(attemptId),
  runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1),
  eventName = process.env.GITHUB_EVENT_NAME || "local",
  controlledFailure = process.env.INPUT_CONTROLLED_FAILURE === "true",
  maxAttemptHistory = OECD_MAX_ATTEMPT_HISTORY,
  lkgStoreFactory = ({ repoRoot: storeRoot, laneId }) => new LaneLkgStore({
    repoRoot: storeRoot,
    laneId,
  }),
} = {}) {
  if (controlledFailure && eventName !== "workflow_dispatch") {
    throw new Error("controlled OECD failure requires workflow_dispatch");
  }
  let tuple;
  let payload = null;
  let failureDetail = null;
  try {
    if (controlledFailure) throw Object.assign(new Error("controlled failure"), { code: "ECONNRESET" });
    const response = await request(ENDPOINT);
    if (response.statusCode < 200 || response.statusCode >= 300) tuple = returnedTuple({ httpStatus: response.statusCode });
    else {
      try {
        payload = parseOecdCsv(response.body, observedAt);
        tuple = returnedTuple({ httpStatus: response.statusCode, decode: "ok", payload: "non_empty", assertions: [{ id: "sdmx_cli_rows", passed: true }] });
      } catch (error) {
        failureDetail = boundedDiagnosticDetail(error);
        tuple = returnedTuple({ httpStatus: response.statusCode, decode: "ok", payload: "non_empty", assertions: [{ id: "sdmx_cli_rows", passed: false }] });
      }
    }
  } catch (error) {
    failureDetail = boundedDiagnosticDetail(error);
    tuple = threwTuple(transportError(error) ? "transport" : "unexpected");
  }
  let row = buildAttemptRow({
    laneId: LANE_ID,
    memberId: null,
    tuple,
    attemptId,
    observedAt,
    eventName,
    runId: String(runId),
    runAttempt: Number(runAttempt),
  });
  recordOecdAttempt({ attemptShardPath, row, maxAttempts: maxAttemptHistory });
  const run = { runId: String(runId), runAttempt: Number(runAttempt), eventName, observedAt };
  const store = lkgStoreFactory({ repoRoot, laneId: LANE_ID });
  const artifact = {
    key: "oecd_cli",
    canonicalPath: shadowPath,
    validateDocument: validOecdPayload,
    sourceAsOf: (document) => document?.latest_date ?? null,
  };
  const failUnexpected = (error) => {
    row = buildAttemptRow({
      laneId: LANE_ID,
      memberId: null,
      tuple: threwTuple("unexpected"),
      attemptId,
      observedAt,
      eventName,
      runId: String(runId),
      runAttempt: Number(runAttempt),
    });
    recordOecdAttempt({ attemptShardPath, row, maxAttempts: maxAttemptHistory });
    store.recordFailure({
      artifacts: [artifact],
      run,
      reason: "unexpected_error",
    });
    throw error;
  };
  if (payload === null) {
    const reason = controlledFailure
      ? "controlled_failure"
      : (tuple.execution === "threw" ? "transport_error" : "schema_drift");
    const failure = store.recordFailure({ artifacts: [artifact], run, reason });
    const classification = classifyLkgFailure({ reason, hasCompleteLkg: failure.hasCompleteLkg });
    return {
      ok: false,
      updated: false,
      degraded: classification.degraded,
      corrupt: classification.corrupt,
      exitCode: classification.exitCode,
      row,
      failure_detail: failureDetail,
      retrySet: failure.retrySet,
    };
  }
  try {
    if (!validOecdPayload(payload)) throw new Error("OECD normalized payload failed persistence validation");
    const payloadBytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`);
    const candidate = {
      key: "oecd_cli",
      currentRelativePath: "data/admin/oecd_cli/shadow/oecd-cli.json",
      payloadBytes,
      sourceAsOf: payload.latest_date,
      validateDocument: validOecdPayload,
      deriveSourceAsOf: (document) => document?.latest_date ?? null,
      promotion_contract: PROMOTION_CONTRACT_PROVIDER_OBSERVATION_V2,
      provider_observation: buildProviderObservationV2({
        payloadBytes,
        sourceAsOf: payload.latest_date,
        validateDocument: validOecdPayload,
        deriveSourceAsOf: (document) => document?.latest_date ?? null,
        candidateContainsObservation: (candidateDocument, providerDocument) => (
          JSON.stringify(candidateDocument) === JSON.stringify(providerDocument)
        ),
        run,
      }),
    };
    const before = store.stateSnapshot().items.oecd_cli;
    let vectorDecision = null;
    if (before?.retry === true && !isNaturalScheduleRun(run)) {
      return {
        ok: false,
        updated: false,
        degraded: true,
        corrupt: false,
        exitCode: 0,
        row,
        reason: "recovery_requires_schedule",
        retrySet: store.stateSnapshot().retry_set,
      };
    }
    if (before?.retry === true && before?.resolution_state === "lkg_primary") {
      vectorDecision = evaluateOecdProviderProgress(
        retainedOecdPayload(repoRoot, store, before),
        payload,
      );
    }
    const decision = vectorDecision ?? store.evaluatePromotionCandidates([candidate], run)[0];
    if (!decision.eligible) {
      if (["foreign_writer_conflict", "recovery_not_advanced_by_provider"].includes(decision.reason)) {
        store.recordPromotionDeferral({ artifacts: [candidate], run, reason: decision.reason });
      }
      return {
        ok: false,
        updated: false,
        degraded: true,
        corrupt: false,
        exitCode: 0,
        row,
        reason: decision.reason,
        retrySet: store.stateSnapshot().retry_set,
      };
    }
    const parity = parityReport(payload, canonicalPath, observedAt);
    const transactionSnapshot = snapshotFiles([shadowPath, parityReportPath, store.statePath]);
    let success;
    try {
      writePairAtomic([{ target: shadowPath, value: payload }, { target: parityReportPath, value: parity }]);
      success = recordSuccessWithVectorDecision(
        store,
        { artifacts: [candidate], run },
        vectorDecision,
      );
    } catch (error) {
      restoreFiles(transactionSnapshot);
      throw error;
    }
    return {
      ok: true,
      updated: true,
      exitCode: 0,
      row,
      parity,
      retrySet: success.retrySet,
      recovered: success.state.items.oecd_cli?.recovered_at === observedAt,
    };
  } catch (error) {
    return failUnexpected(error);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runOecdCliShadow().then((result) => {
    console.log(JSON.stringify({
      ok: result.ok,
      exit_code: result.exitCode,
      failure_detail: result.failure_detail ?? null,
    }));
    process.exitCode = result.exitCode;
  })
    .catch((error) => { console.error(error); process.exitCode = 2; });
}
