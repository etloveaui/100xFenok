#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { boundedDiagnosticDetail } from "./lib/diagnostic-detail.mjs";
import {
  attemptResult,
  defaultAttemptId,
  libraryTuple,
  writeAttemptShard,
} from "./lib/data-supply-attempt-shard.mjs";
import {
  LaneLkgStore,
  PROMOTION_CONTRACT_PROVIDER_OBSERVATION_V2,
  buildProviderObservationV2,
  classifyLkgFailure,
  isNaturalScheduleRun,
} from "./lib/data-supply-lkg-store.mjs";

export const SCHEMA_VERSION = "damodaran-owner-guard/v1";
export const ATTEMPT_SHARD_RELATIVE_PATH =
  "data/admin/data-supply-state/detection-attempts/damodaran.json";
export const FILE_NAMES = Object.freeze([
  "industries.json",
  "historical_erp.json",
  "credit_ratings.json",
  "erp.json",
  "industry_metrics.json",
  "industry_metrics_regions.json",
]);
export const CANONICAL_RELATIVE_PATHS = Object.freeze([
  "data/damodaran/industries.json",
  "data/damodaran/historical_erp.json",
  "data/damodaran/credit_ratings.json",
  "data/damodaran/erp.json",
  "data/damodaran/industry_metrics.json",
  "data/damodaran/industry_metrics_regions.json",
]);
export const PUBLIC_MIRROR_RELATIVE_PATHS = Object.freeze([
  "100xfenok-next/public/data/damodaran/industries.json",
  "100xfenok-next/public/data/damodaran/historical_erp.json",
  "100xfenok-next/public/data/damodaran/credit_ratings.json",
  "100xfenok-next/public/data/damodaran/erp.json",
  "100xfenok-next/public/data/damodaran/industry_metrics.json",
  "100xfenok-next/public/data/damodaran/industry_metrics_regions.json",
]);
export const DAMODARAN_HISTORY_LIMIT = 52;
export const DAMODARAN_PERSISTENCE_POLICY = Object.freeze({
  schema_version: "damodaran-bounded-persistence/v1",
  basis: "successful_provider_bundle",
  max_bundle_observations: DAMODARAN_HISTORY_LIMIT,
  eviction: "oldest_provider_bundle_first",
});
const DAMODARAN_BUNDLE_SCHEMA = "damodaran-current-bundle/v1";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
export const REPORT_RELATIVE_PATH = process.env.DAMODARAN_SHADOW_REPORT
  ?? "data/admin/damodaran/owner-guard.json";
const REPORT_PATH = path.join(REPO_ROOT, REPORT_RELATIVE_PATH);
const ATTEMPT_SHARD_PATH = path.join(REPO_ROOT, ATTEMPT_SHARD_RELATIVE_PATH);
const PRODUCER_PATH = path.join(
  SCRIPT_DIR,
  "lib",
  "damodaran_shadow_converter",
  "produce_bundle.py",
);


function pointerEscape(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function isObject(value) {
  return value !== null && typeof value === "object";
}

export function normalizePayload(payload) {
  const normalized = structuredClone(payload);
  if (isObject(normalized.metadata) && !Array.isArray(normalized.metadata)) {
    delete normalized.metadata.generated_at;
  }
  return normalized;
}

export function firstDivergentPaths(left, right, limit = 5) {
  const paths = [];

  function visit(leftValue, rightValue, pointer) {
    if (paths.length >= limit) return;
    if (Object.is(leftValue, rightValue)) return;

    if (!isObject(leftValue) || !isObject(rightValue)) {
      paths.push(pointer || "/");
      return;
    }
    if (Array.isArray(leftValue) !== Array.isArray(rightValue)) {
      paths.push(pointer || "/");
      return;
    }

    const leftKeys = Array.isArray(leftValue)
      ? Array.from({ length: leftValue.length }, (_, index) => String(index))
      : Object.keys(leftValue);
    const rightKeys = Array.isArray(rightValue)
      ? Array.from({ length: rightValue.length }, (_, index) => String(index))
      : Object.keys(rightValue);
    const keys = [...new Set([...leftKeys, ...rightKeys])].sort();

    for (const key of keys) {
      if (paths.length >= limit) break;
      const childPointer = `${pointer}/${pointerEscape(key)}`;
      if (!Object.hasOwn(leftValue, key) || !Object.hasOwn(rightValue, key)) {
        paths.push(childPointer);
        continue;
      }
      visit(leftValue[key], rightValue[key], childPointer);
    }
  }

  visit(left, right, "");
  return paths;
}

export function comparePayloads(fresh, committed) {
  const normalizedFresh = normalizePayload(fresh);
  const normalizedCommitted = normalizePayload(committed);
  try {
    assert.deepStrictEqual(normalizedFresh, normalizedCommitted);
    return { status: "match", first_divergent_paths: [] };
  } catch (error) {
    if (error?.code !== "ERR_ASSERTION") throw error;
    return {
      status: "mismatch",
      first_divergent_paths: firstDivergentPaths(normalizedFresh, normalizedCommitted),
    };
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function atomicWriteJson(filePath, payload) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
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

function providerSourceDate(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const normalized = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    const parsed = new Date(`${normalized}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === normalized
      ? normalized
      : null;
  }
  const match = normalized.match(/^([A-Za-z]+)(?:\s+(\d{1,2}),)?\s+(\d{4})$/u);
  if (!match) return null;
  const monthIndex = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ].indexOf(match[1].toLowerCase());
  const day = Number(match[2] ?? 1);
  const year = Number(match[3]);
  if (monthIndex < 0 || !Number.isInteger(day) || day < 1 || day > 31) return null;
  const parsed = new Date(Date.UTC(year, monthIndex, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === monthIndex && parsed.getUTCDate() === day
    ? parsed.toISOString().slice(0, 10)
    : null;
}

function payloadSourceAsOf(payload) {
  return providerSourceDate(payload?.metadata?.source_date);
}

export function buildDamodaranBundle(payloads) {
  if (!payloads || typeof payloads !== "object" || Array.isArray(payloads)
    || Object.keys(payloads).length !== FILE_NAMES.length
    || FILE_NAMES.some((file) => !isObject(payloads[file]) || Array.isArray(payloads[file]))) {
    throw new Error("Damodaran bundle requires all six provider payloads");
  }
  const sourceDates = FILE_NAMES.map((file) => payloadSourceAsOf(payloads[file]));
  if (sourceDates.some((value) => value === null)) {
    throw new Error("Damodaran bundle requires provider source dates on all payloads");
  }
  return {
    schema_version: DAMODARAN_BUNDLE_SCHEMA,
    source_as_of: sourceDates.sort().at(-1),
    persistence_policy: DAMODARAN_PERSISTENCE_POLICY,
    files: Object.fromEntries(FILE_NAMES.map((file) => [file, structuredClone(payloads[file])])),
  };
}

export function validDamodaranBundle(document) {
  if (document?.schema_version !== DAMODARAN_BUNDLE_SCHEMA
    || !/^\d{4}-\d{2}-\d{2}$/u.test(document?.source_as_of)
    || JSON.stringify(document?.persistence_policy) !== JSON.stringify(DAMODARAN_PERSISTENCE_POLICY)
    || !document?.files || typeof document.files !== "object" || Array.isArray(document.files)
    || Object.keys(document.files).length !== FILE_NAMES.length
    || FILE_NAMES.some((file) => !isObject(document.files[file]) || Array.isArray(document.files[file]))) {
    return false;
  }
  const sourceDates = FILE_NAMES.map((file) => payloadSourceAsOf(document.files[file]));
  return sourceDates.every((value) => value !== null) && sourceDates.sort().at(-1) === document.source_as_of;
}

function damodaranProviderProgressVector(bundle) {
  if (!validDamodaranBundle(bundle)) throw new Error("Damodaran provider progress bundle is invalid");
  return Object.fromEntries(FILE_NAMES.map((file) => [file, payloadSourceAsOf(bundle.files[file])]));
}

export function evaluateDamodaranProviderProgress(retainedBundle, candidateBundle) {
  const retained = damodaranProviderProgressVector(retainedBundle);
  const candidate = damodaranProviderProgressVector(candidateBundle);
  const regressedFiles = FILE_NAMES.filter((file) => candidate[file] < retained[file]);
  const advancedFiles = FILE_NAMES.filter((file) => candidate[file] > retained[file]);
  if (regressedFiles.length > 0) {
    return {
      eligible: false,
      reason: "recovery_provider_regression",
      regressed_files: regressedFiles,
      advanced_files: advancedFiles,
    };
  }
  if (advancedFiles.length === 0) {
    return {
      eligible: false,
      reason: "recovery_not_advanced_by_provider",
      regressed_files: [],
      advanced_files: [],
    };
  }
  return {
    eligible: true,
    reason: "ok",
    regressed_files: [],
    advanced_files: advancedFiles,
  };
}

function retainedDamodaranBundle(repoRoot, store, item) {
  const expectedPath = "data/admin/damodaran/lkg/damodaran.json";
  if (item?.lkg?.path !== expectedPath
    || !store.validRetainedLkg("damodaran", validDamodaranBundle, (document) => document?.source_as_of ?? null)) {
    throw new Error("Damodaran retained LKG is invalid");
  }
  const bundle = readJson(path.join(repoRoot, expectedPath));
  if (!validDamodaranBundle(bundle)) throw new Error("Damodaran retained LKG bundle is invalid");
  return bundle;
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

function bundleBytes(bundle) {
  return Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`);
}

function bundleHistoryRow(bundle, run) {
  return {
    source_as_of: bundle.source_as_of,
    observed_at: run.observedAt,
    run_id: run.runId,
    run_attempt: run.runAttempt,
    event_name: run.eventName,
    file_sha256: Object.fromEntries(FILE_NAMES.map((file) => [
      file,
      createHash("sha256").update(JSON.stringify(bundle.files[file])).digest("hex"),
    ])),
  };
}

export function appendDamodaranHistory(existing, bundle, run) {
  if (!Array.isArray(existing) || !validDamodaranBundle(bundle)
    || typeof run?.runId !== "string" || run.runId === ""
    || !Number.isInteger(run?.runAttempt) || run.runAttempt < 1
    || typeof run?.eventName !== "string" || run.eventName === ""
    || typeof run?.observedAt !== "string" || !Number.isFinite(Date.parse(run.observedAt))
    || existing.some((item) => (
      !/^\d{4}-\d{2}-\d{2}$/u.test(item?.source_as_of)
      || typeof item?.observed_at !== "string" || !Number.isFinite(Date.parse(item.observed_at))
      || typeof item?.run_id !== "string" || item.run_id === ""
      || !Number.isInteger(item?.run_attempt) || item.run_attempt < 1
      || typeof item?.event_name !== "string" || item.event_name === ""
      || !item?.file_sha256 || typeof item.file_sha256 !== "object" || Array.isArray(item.file_sha256)
      || Object.keys(item.file_sha256).length !== FILE_NAMES.length
      || FILE_NAMES.some((file) => !/^[0-9a-f]{64}$/u.test(item.file_sha256[file]))
    ))) {
    throw new Error("Damodaran history contract is invalid");
  }
  const row = bundleHistoryRow(bundle, run);
  const identity = `${row.source_as_of}:${JSON.stringify(row.file_sha256)}`;
  const byIdentity = new Map(existing.map((item) => [
    `${item?.source_as_of}:${JSON.stringify(item?.file_sha256)}`,
    item,
  ]));
  byIdentity.set(identity, row);
  const available = [...byIdentity.values()].sort((left, right) => (
    String(left.source_as_of).localeCompare(String(right.source_as_of))
      || String(left.observed_at).localeCompare(String(right.observed_at))
      || String(left.run_id).localeCompare(String(right.run_id))
  ));
  const observations = available.slice(-DAMODARAN_HISTORY_LIMIT);
  return {
    schema_version: "damodaran-bundle-history/v1",
    persistence_policy: DAMODARAN_PERSISTENCE_POLICY,
    persistence_state: {
      available_bundle_observations: available.length,
      retained_bundle_observations: observations.length,
      pruned_bundle_observations: available.length - observations.length,
    },
    observations,
  };
}

function promoteProducedBytes({ bytesByFile, canonicalRoot }) {
  if (!bytesByFile || FILE_NAMES.some((file) => !Buffer.isBuffer(bytesByFile[file]))) {
    throw new Error("Damodaran promotion requires all six verified byte payloads");
  }
  fs.mkdirSync(canonicalRoot, { recursive: true });
  const staged = FILE_NAMES.map((file) => {
    const targetPath = path.join(canonicalRoot, file);
    const temporaryPath = path.join(canonicalRoot, `.${file}.${process.pid}.tmp`);
    fs.writeFileSync(temporaryPath, bytesByFile[file]);
    return { targetPath, temporaryPath, prior: fs.existsSync(targetPath) ? fs.readFileSync(targetPath) : null };
  });
  try {
    for (const row of staged) fs.renameSync(row.temporaryPath, row.targetPath);
  } catch (error) {
    for (const row of staged) {
      fs.rmSync(row.temporaryPath, { force: true });
      if (row.prior === null) fs.rmSync(row.targetPath, { force: true });
      else fs.writeFileSync(row.targetPath, row.prior);
    }
    throw error;
  }
}

function bootstrapCurrentBundle(canonicalRoot, currentBundlePath) {
  try {
    const payloads = Object.fromEntries(FILE_NAMES.map((file) => [file, readJson(path.join(canonicalRoot, file))]));
    const bundle = buildDamodaranBundle(payloads);
    atomicWriteJson(currentBundlePath, bundle);
    return bundle;
  } catch {
    return null;
  }
}

function blockedRows(message) {
  return FILE_NAMES.map((file) => ({
    file,
    status: "blocked",
    first_divergent_paths: [],
    source_urls: [],
    error: message,
  }));
}

export function guardProducedFiles(bundle, producedRoot) {
  const files = FILE_NAMES.map((file) => {
    const sourceRows = bundle.sources?.[file] ?? [];
    const sourceUrls = [...new Set(sourceRows.map((row) => row.url))];
    const producerError = bundle.errors?.[file];
    const fresh = bundle.payloads?.[file];
    if (producerError || fresh === undefined) {
      return {
        file,
        status: "blocked",
        first_divergent_paths: [],
        source_urls: sourceUrls,
        error: producerError ?? "producer returned no payload",
      };
    }

    const producedPath = path.join(producedRoot, file);
    try {
      const produced = readJson(producedPath);
      let comparison;
      try {
        assert.deepStrictEqual(fresh, produced);
        comparison = { status: "match", first_divergent_paths: [] };
      } catch (error) {
        if (error?.code !== "ERR_ASSERTION") throw error;
        comparison = {
          status: "mismatch",
          first_divergent_paths: firstDivergentPaths(fresh, produced),
        };
      }
      return {
        file,
        ...comparison,
        source_urls: sourceUrls,
        error: null,
      };
    } catch (error) {
      return {
        file,
        status: "blocked",
        first_divergent_paths: [],
        source_urls: sourceUrls,
        error: `${error.name}: ${error.message}`,
      };
    }
  });

  const status = files.some((row) => row.status === "blocked")
    ? "blocked"
    : files.some((row) => row.status === "mismatch")
      ? "mismatch"
      : "match";
  return {
    status,
    summary: {
      match: files.filter((row) => row.status === "match").length,
      mismatch: files.filter((row) => row.status === "mismatch").length,
      blocked: files.filter((row) => row.status === "blocked").length,
    },
    files,
  };
}

export function promoteProducedFiles({ bundle, producedRoot, canonicalRoot }) {
  const guard = guardProducedFiles(bundle, producedRoot);
  if (guard.status !== "match") {
    throw new Error(`Damodaran owner guard failed: ${guard.status}`);
  }

  fs.mkdirSync(canonicalRoot, { recursive: true });
  const temporaryFiles = [];
  try {
    for (const file of FILE_NAMES) {
      const temporaryPath = path.join(canonicalRoot, `.${file}.${process.pid}.tmp`);
      fs.copyFileSync(path.join(producedRoot, file), temporaryPath);
      temporaryFiles.push([temporaryPath, path.join(canonicalRoot, file)]);
    }
    for (const [temporaryPath, targetPath] of temporaryFiles) {
      fs.renameSync(temporaryPath, targetPath);
    }
  } finally {
    for (const [temporaryPath] of temporaryFiles) {
      if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    }
  }
  return guard;
}

export function buildReport(bundle, producerResult, guard) {
  return {
    schema_version: SCHEMA_VERSION,
    fetched_at: bundle.fetched_at,
    status: guard.status,
    mode: "owner_guard",
    ownership_flip: true,
    guard_target: "producer_bundle_vs_generated_files",
    committed_root: "data/damodaran",
    public_mirror: "100xfenok-next/public/data/damodaran",
    ignored_compare_paths: [],
    conditional_get: bundle.conditional_get,
    producer: {
      exit_code: producerResult.status,
      signal: producerResult.signal,
    },
    summary: {
      ...guard.summary,
      request_count: Object.values(bundle.sources ?? {}).reduce((sum, rows) => sum + rows.length, 0),
    },
    files: guard.files,
  };
}

function resultForReport(report, producerResult, latencyMs) {
  if (producerResult?.error) {
    return attemptResult("unexpected_error", libraryTuple({
      execution: "threw",
      exceptionKind: "unexpected",
      candidates: FILE_NAMES.length,
      retryCount: 0,
      latencyMs,
      outcome: "error",
      failureEntity: "damodaran_converter",
      failureDetail: boundedDiagnosticDetail(producerResult.error),
    }));
  }
  if (report.status === "match" || report.status === "mismatch") {
    const passed = report.status === "match";
    return attemptResult(passed ? "ok" : "schema_drift", libraryTuple({
      candidates: FILE_NAMES.length,
      retryCount: 0,
      latencyMs,
      outcome: "success",
      decode: "ok",
      payload: "non_empty",
      assertions: [{ id: "owner_guard_match", passed }],
    }));
  }
  return attemptResult("unexpected_error", libraryTuple({
    candidates: FILE_NAMES.length,
    retryCount: 0,
    latencyMs,
    outcome: "error",
  }));
}

function thrownResult(error, latencyMs) {
  return attemptResult("unexpected_error", libraryTuple({
    execution: "threw",
    exceptionKind: "unexpected",
    candidates: FILE_NAMES.length,
    retryCount: 0,
    latencyMs,
    outcome: "error",
    failureEntity: "damodaran_owner_guard",
    failureDetail: boundedDiagnosticDetail(error),
  }));
}

export function runDamodaranShadow({
  repoRoot = REPO_ROOT,
  reportPath = path.join(repoRoot, REPORT_RELATIVE_PATH),
  attemptShardPath = path.join(repoRoot, ATTEMPT_SHARD_RELATIVE_PATH),
  canonicalRoot = path.join(repoRoot, "data", "damodaran"),
  currentBundlePath = path.join(repoRoot, "data", "admin", "damodaran", "current", "damodaran.json"),
  historyPath = path.join(repoRoot, "data", "admin", "damodaran", "history.json"),
  spawn = spawnSync,
  observedAt = new Date().toISOString(),
  attemptId = defaultAttemptId("damodaran", observedAt),
  runId = process.env.GITHUB_RUN_ID || String(attemptId),
  runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1),
  eventName = process.env.GITHUB_EVENT_NAME || "local",
  controlledFailure = process.env.INPUT_CONTROLLED_FAILURE === "true",
  lkgStoreFactory = ({ repoRoot: storeRoot, laneId }) => new LaneLkgStore({
    repoRoot: storeRoot,
    laneId,
  }),
  now = Date.now,
} = {}) {
  if (controlledFailure && eventName !== "workflow_dispatch") {
    throw new Error("controlled Damodaran failure requires workflow_dispatch");
  }
  const startedAt = now();
  const run = { runId: String(runId), runAttempt: Number(runAttempt), eventName, observedAt };
  const store = lkgStoreFactory({ repoRoot, laneId: "damodaran" });
  const artifact = {
    key: "damodaran",
    canonicalPath: currentBundlePath,
    validateDocument: validDamodaranBundle,
    sourceAsOf: (document) => document?.source_as_of ?? null,
  };
  let report;
  let producerResult;
  let candidateBundle = null;
  let verifiedBytes = null;

  try {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "damodaran-shadow-"));
    const outputDir = path.join(temporaryRoot, "converter-output");
    const bundlePath = path.join(temporaryRoot, "bundle.json");
    try {
      producerResult = controlledFailure
        ? {
          status: null,
          signal: null,
          stderr: "",
          error: new Error("controlled failure"),
        }
        : spawn(
          process.env.PYTHON || "python3",
          [PRODUCER_PATH, "--output-dir", outputDir, "--bundle", bundlePath],
          {
            cwd: repoRoot,
            encoding: "utf8",
            maxBuffer: 32 * 1024 * 1024,
            timeout: 45 * 60 * 1000,
          },
        );

      if (fs.existsSync(bundlePath)) {
        const bundle = readJson(bundlePath);
        let guard = guardProducedFiles(bundle, outputDir);
        if (producerResult.status === 0 && guard.status === "match") {
          try {
            candidateBundle = buildDamodaranBundle(bundle.payloads);
            verifiedBytes = Object.fromEntries(FILE_NAMES.map((file) => [
              file,
              fs.readFileSync(path.join(outputDir, file)),
            ]));
          } catch (error) {
            guard = {
              status: "blocked",
              summary: { match: 0, mismatch: 0, blocked: FILE_NAMES.length },
              files: blockedRows(`${error.name}: ${error.message}`),
            };
          }
        } else if (producerResult.status !== 0 && guard.status === "match") {
          guard = {
            status: "blocked",
            summary: { match: 0, mismatch: 0, blocked: FILE_NAMES.length },
            files: blockedRows(`producer exited ${producerResult.status ?? "without status"}`),
          };
        }
        report = buildReport(bundle, producerResult, guard);
      } else {
        const reason = producerResult.error
          ? `${producerResult.error.name}: ${producerResult.error.message}`
          : `producer exited ${producerResult.status ?? "without status"}`;
        report = {
          schema_version: SCHEMA_VERSION,
          fetched_at: new Date().toISOString(),
          status: "blocked",
          mode: "owner_guard",
          ownership_flip: true,
          guard_target: "producer_bundle_vs_generated_files",
          committed_root: "data/damodaran",
          public_mirror: "100xfenok-next/public/data/damodaran",
          ignored_compare_paths: [],
          conditional_get: { used: false, reason: "producer did not return a bundle" },
          producer: {
            exit_code: producerResult.status,
            signal: producerResult.signal,
            stderr_tail: producerResult.stderr?.slice(-2000) || null,
          },
          summary: { match: 0, mismatch: 0, blocked: FILE_NAMES.length, request_count: 0 },
          files: blockedRows(reason),
        };
      }
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  } catch (error) {
    const latencyMs = Math.max(0, Math.round(now() - startedAt));
    writeAttemptShard({
      laneId: "damodaran",
      attemptShardPath,
      observedAt,
      attemptId,
      result: thrownResult(error, latencyMs),
    });
    bootstrapCurrentBundle(canonicalRoot, currentBundlePath);
    store.recordFailure({
      artifacts: [artifact],
      run,
      reason: "unexpected_error",
    });
    throw error;
  }

  let recoveryResult = null;
  if (candidateBundle && report.status === "match") {
    const payloadBytes = bundleBytes(candidateBundle);
    const validateDocument = validDamodaranBundle;
    const deriveSourceAsOf = (document) => document?.source_as_of ?? null;
    const candidate = {
      key: "damodaran",
      currentRelativePath: "data/admin/damodaran/current/damodaran.json",
      payloadBytes,
      sourceAsOf: candidateBundle.source_as_of,
      validateDocument,
      deriveSourceAsOf,
      promotion_contract: PROMOTION_CONTRACT_PROVIDER_OBSERVATION_V2,
      provider_observation: buildProviderObservationV2({
        payloadBytes,
        sourceAsOf: candidateBundle.source_as_of,
        validateDocument,
        deriveSourceAsOf,
        candidateContainsObservation: (candidateDocument, providerDocument) => (
          JSON.stringify(candidateDocument) === JSON.stringify(providerDocument)
        ),
        run,
      }),
    };
    const before = store.stateSnapshot().items.damodaran;
    let vectorDecision = null;
    if (before?.retry === true && !isNaturalScheduleRun(run)) {
      recoveryResult = {
        ok: false,
        degraded: true,
        corrupt: false,
        exitCode: 0,
        reason: "recovery_requires_schedule",
        retrySet: store.stateSnapshot().retry_set,
      };
    } else {
      if (before?.retry === true && before?.resolution_state === "lkg_primary") {
        vectorDecision = evaluateDamodaranProviderProgress(
          retainedDamodaranBundle(repoRoot, store, before),
          candidateBundle,
        );
      }
      const decision = vectorDecision ?? store.evaluatePromotionCandidates([candidate], run)[0];
      if (!decision.eligible) {
        if (["foreign_writer_conflict", "recovery_not_advanced_by_provider"].includes(decision.reason)) {
          store.recordPromotionDeferral({ artifacts: [candidate], run, reason: decision.reason });
        }
        recoveryResult = {
          ok: false,
          degraded: true,
          corrupt: false,
          exitCode: 0,
          reason: decision.reason,
          retrySet: store.stateSnapshot().retry_set,
        };
      } else {
        try {
          let existingHistory = [];
          if (fs.existsSync(historyPath)) {
            const historyDocument = readJson(historyPath);
            if (historyDocument?.schema_version !== "damodaran-bundle-history/v1"
              || JSON.stringify(historyDocument?.persistence_policy) !== JSON.stringify(DAMODARAN_PERSISTENCE_POLICY)
              || !Array.isArray(historyDocument?.observations)
              || historyDocument.observations.length > DAMODARAN_HISTORY_LIMIT
              || historyDocument?.persistence_state?.retained_bundle_observations
                !== historyDocument.observations.length
              || historyDocument?.persistence_state?.available_bundle_observations
                !== historyDocument.persistence_state.retained_bundle_observations
                  + historyDocument.persistence_state.pruned_bundle_observations) {
              throw new Error("Damodaran history contract is invalid");
            }
            existingHistory = historyDocument.observations;
          }
          const history = appendDamodaranHistory(existingHistory, candidateBundle, run);
          const transactionSnapshot = snapshotFiles([
            ...FILE_NAMES.map((file) => path.join(canonicalRoot, file)),
            currentBundlePath,
            historyPath,
            store.statePath,
          ]);
          let success;
          try {
            promoteProducedBytes({ bytesByFile: verifiedBytes, canonicalRoot });
            atomicWriteJson(currentBundlePath, candidateBundle);
            atomicWriteJson(historyPath, history);
            success = recordSuccessWithVectorDecision(
              store,
              { artifacts: [candidate], run },
              vectorDecision,
            );
          } catch (error) {
            restoreFiles(transactionSnapshot);
            throw error;
          }
          recoveryResult = {
            ok: true,
            degraded: false,
            corrupt: false,
            exitCode: 0,
            reason: "ok",
            retrySet: success.retrySet,
            recovered: success.state.items.damodaran?.recovered_at === observedAt,
          };
        } catch (error) {
          report = {
            ...report,
            status: "blocked",
            summary: { ...report.summary, match: 0, blocked: FILE_NAMES.length },
            files: blockedRows(`${error.name}: ${error.message}`),
          };
          candidateBundle = null;
          const failure = store.recordFailure({
            artifacts: [artifact],
            run,
            reason: "unexpected_error",
          });
          const classification = classifyLkgFailure({
            reason: "unexpected_error",
            hasCompleteLkg: failure.hasCompleteLkg,
          });
          recoveryResult = {
            ok: false,
            degraded: classification.degraded,
            corrupt: classification.corrupt,
            exitCode: classification.exitCode,
            reason: "unexpected_error",
            retrySet: failure.retrySet,
          };
        }
      }
    }
  }

  if (!recoveryResult && report.status !== "match") {
    bootstrapCurrentBundle(canonicalRoot, currentBundlePath);
    const reason = controlledFailure
      ? "controlled_failure"
      : report.status === "mismatch" ? "schema_drift" : "unexpected_error";
    const failure = store.recordFailure({ artifacts: [artifact], run, reason });
    const classification = classifyLkgFailure({ reason, hasCompleteLkg: failure.hasCompleteLkg });
    recoveryResult = {
      ok: false,
      degraded: classification.degraded,
      corrupt: classification.corrupt,
      exitCode: classification.exitCode,
      reason,
      retrySet: failure.retrySet,
    };
  }

  atomicWriteJson(reportPath, report);
  const latencyMs = Math.max(0, Math.round(now() - startedAt));
  const row = writeAttemptShard({
    laneId: "damodaran",
    attemptShardPath,
    observedAt,
    attemptId,
    result: resultForReport(report, producerResult, latencyMs),
  });
  return {
    exitCode: recoveryResult?.exitCode ?? (report.status === "match" ? 0 : 2),
    report,
    row,
    recovery: recoveryResult,
  };
}

export function main() {
  const result = runDamodaranShadow();
  console.log(JSON.stringify(result.report.summary));
  return result.exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main();
}
