#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ProducerLkgStateStore, assessRecoveryExit } from "./lib/producer-lkg-state.mjs";

export const SLICKCHARTS_DAILY_KEYS = Object.freeze([
  "gainers.json",
  "losers.json",
  "treasury.json",
  "currency.json",
  "mortgage.json",
]);

const FATAL_FAILURE_KINDS = new Set(["auth", "rate_limited", "decode", "schema_drift", "corrupt", "unexpected"]);

function finiteJson(value) {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteJson);
  if (value && typeof value === "object") return Object.values(value).every(finiteJson);
  return true;
}

function validSourceDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validatePayload(_key, payload) {
  return payload?.source === "slickcharts"
    && Array.isArray(payload?.history)
    && payload.history.length > 0
    && payload.history.every((row) => validSourceDate(row?.date))
    && finiteJson(payload);
}

function progressMarker(_key, payload) {
  return payload.history.map((row) => row.date).sort().at(-1) ?? null;
}

function storeFor(stateRoot) {
  return new ProducerLkgStateStore({
    root: stateRoot,
    laneId: "slickcharts_daily_delivery",
    publicRoot: "data/admin/slickcharts-daily-delivery",
    validatePayload,
    progressMarker,
  });
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

function parseList(value) {
  if (Array.isArray(value)) return value;
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

export function validateControlledFailureFiles(value, eventName) {
  const keys = [...new Set(parseList(value))];
  if (keys.length > 0 && eventName !== "workflow_dispatch") {
    throw new Error("controlled_failure_files is allowed only for workflow_dispatch");
  }
  for (const key of keys) {
    if (!SLICKCHARTS_DAILY_KEYS.includes(key)) throw new Error(`unknown controlled failure file: ${key}`);
  }
  return keys;
}

export function prepareSlickchartsDailyRecovery({ dataDir, snapshotDir }) {
  fs.rmSync(snapshotDir, { recursive: true, force: true });
  fs.mkdirSync(snapshotDir, { recursive: true });
  const copied = [];
  for (const key of SLICKCHARTS_DAILY_KEYS) {
    const source = path.join(dataDir, key);
    if (!fs.existsSync(source)) continue;
    fs.copyFileSync(source, path.join(snapshotDir, key));
    copied.push(key);
  }
  return copied;
}

function readOutcomes(outcomesPath) {
  if (!fs.existsSync(outcomesPath)) return new Map();
  const rows = fs.readFileSync(outcomesPath, "utf8").split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${outcomesPath}:${index + 1} invalid outcome: ${error.message}`);
    }
  });
  const byKey = new Map();
  for (const row of rows) {
    if (!SLICKCHARTS_DAILY_KEYS.includes(row?.key)) throw new Error(`unknown SlickCharts daily outcome key: ${row?.key}`);
    if (byKey.has(row.key)) throw new Error(`duplicate SlickCharts daily outcome key: ${row.key}`);
    if (!new Set(["success", "failure", "skipped"]).has(row.outcome)) throw new Error(`invalid outcome for ${row.key}`);
    byKey.set(row.key, row);
  }
  return byKey;
}

function exactRestore(store, key, targetPath) {
  const retained = store.validRetainedLkg(key);
  if (!retained.valid) return false;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, retained.payloadBytes);
  return true;
}

export function finalizeSlickchartsDailyRecovery({
  dataDir,
  stateRoot,
  snapshotDir,
  outcomesPath,
  statusPath,
  run,
  selectedScraper = "all",
  jobStatus = "success",
}) {
  const store = storeFor(stateRoot);
  const degradedKeys = [];
  const failedKeys = [];
  const fatalKeys = [];
  const reasons = [];
  let outcomes;
  try {
    outcomes = readOutcomes(outcomesPath);
  } catch (error) {
    outcomes = new Map();
    reasons.push(error.message);
    fatalKeys.push(...SLICKCHARTS_DAILY_KEYS);
  }

  for (const key of SLICKCHARTS_DAILY_KEYS) {
    const canonicalRef = `data/slickcharts/${key}`;
    const outputPath = path.join(dataDir, key);
    const snapshotPath = path.join(snapshotDir, key);
    const selected = selectedScraper === "all" || key === `${selectedScraper}.json`;
    const outcome = outcomes.get(key) ?? (selected && jobStatus !== "success"
      ? { key, outcome: "failure", failure_kind: "unexpected", error: `selected scraper has no outcome after job status ${jobStatus}` }
      : { key, outcome: "skipped" });

    if (outcome.outcome === "failure") {
      const fallbackBytes = fs.existsSync(snapshotPath) ? fs.readFileSync(snapshotPath) : null;
      store.recordFailure({
        key,
        error: outcome.error ?? `${key} scraper failed`,
        failureKind: outcome.failure_kind ?? "unexpected",
        fallbackBytes,
        canonicalRef,
        run,
      });
      degradedKeys.push(key);
      failedKeys.push(key);
      if (FATAL_FAILURE_KINDS.has(outcome.failure_kind ?? "unexpected")) fatalKeys.push(key);
      if (!exactRestore(store, key, outputPath)) reasons.push(`${key}: no valid retained LKG to restore`);
      continue;
    }

    if (outcome.outcome === "skipped") {
      const stateInspection = store.inspectState(key);
      if (stateInspection.kind === "valid") {
        const retained = store.validRetainedLkg(key, stateInspection.state);
        if (retained.valid) continue;
        store.recordFailure({
          key,
          error: `skipped key has invalid retained LKG: ${retained.reason}`,
          failureKind: "corrupt",
          fallbackBytes: null,
          canonicalRef,
          run,
        });
        degradedKeys.push(key);
        failedKeys.push(key);
        fatalKeys.push(key);
        reasons.push(`${key}: skipped key has invalid retained LKG`);
        continue;
      }
      if (!fs.existsSync(snapshotPath)) {
        store.recordFailure({ key, error: "skipped key has no baseline", failureKind: "corrupt", fallbackBytes: null, canonicalRef, run });
        degradedKeys.push(key);
        fatalKeys.push(key);
        continue;
      }
      try {
        const candidate = store.recordCandidate({ key, payloadBytes: fs.readFileSync(snapshotPath), canonicalRef, run });
        if (!candidate.accepted) {
          degradedKeys.push(key);
          if (!candidate.deferred) failedKeys.push(key);
          if (candidate.state.resolution_state === "unavailable") fatalKeys.push(key);
        }
      } catch (error) {
        store.recordFailure({ key, error: error.message, failureKind: "corrupt", fallbackBytes: null, canonicalRef, run });
        degradedKeys.push(key);
        fatalKeys.push(key);
      }
      continue;
    }

    try {
      const candidate = store.recordCandidate({ key, payloadBytes: fs.readFileSync(outputPath), canonicalRef, run });
      if (!candidate.accepted) {
        degradedKeys.push(key);
        if (!candidate.deferred) failedKeys.push(key);
        if (candidate.state.resolution_state === "unavailable") fatalKeys.push(key);
        if (!exactRestore(store, key, outputPath)) reasons.push(`${key}: rejected recovery has no valid retained LKG`);
      }
    } catch (error) {
      const fallbackBytes = fs.existsSync(snapshotPath) ? fs.readFileSync(snapshotPath) : null;
      store.recordFailure({ key, error: error.message, failureKind: "corrupt", fallbackBytes, canonicalRef, run });
      degradedKeys.push(key);
      failedKeys.push(key);
      fatalKeys.push(key);
      if (!exactRestore(store, key, outputPath)) reasons.push(`${key}: corrupt candidate has no valid retained LKG`);
    }
  }

  const index = store.buildIndex({ keys: SLICKCHARTS_DAILY_KEYS, run });
  const assessment = assessRecoveryExit({
    store,
    index,
    failedKeys: [...new Set(failedKeys)],
    fatalKeys: [...new Set(fatalKeys)],
  });
  const allReasons = [...new Set([...reasons, ...assessment.reasons])];
  const status = {
    schema_version: "producer-lkg-run-status/v1",
    lane_id: "slickcharts_daily_delivery",
    run_id: String(run.run_id),
    generated_at: run.observed_at,
    exit_code: allReasons.length === 0 ? assessment.exit_code : 2,
    publish_data: allReasons.length === 0 && assessment.exit_code === 0,
    degraded_keys: [...new Set(degradedKeys)].sort(),
    reasons: allReasons,
  };
  writeJsonAtomic(statusPath, status);
  return {
    exitCode: status.exit_code,
    publishData: status.publish_data,
    degradedKeys: status.degraded_keys,
    reasons: status.reasons,
    index,
  };
}

function arg(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
}

function githubRun() {
  const runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT ?? 1);
  return {
    run_id: String(process.env.GITHUB_RUN_ID ?? Date.now()),
    run_attempt: runAttempt,
    event_name: process.env.GITHUB_EVENT_NAME ?? null,
    natural: process.env.GITHUB_EVENT_NAME === "schedule" && runAttempt === 1,
    observed_at: new Date().toISOString(),
  };
}

function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  const dataDir = arg(argv, "--data-dir", "data/slickcharts");
  const snapshotDir = arg(argv, "--snapshot-dir", process.env.SLICKCHARTS_RECOVERY_SNAPSHOT_DIR);
  if (!snapshotDir) throw new Error("--snapshot-dir is required");
  if (command === "prepare") {
    console.log(JSON.stringify({ copied: prepareSlickchartsDailyRecovery({ dataDir, snapshotDir }) }));
    return;
  }
  if (command !== "finalize") throw new Error("usage: slickcharts-daily-recovery.mjs <prepare|finalize>");
  const result = finalizeSlickchartsDailyRecovery({
    dataDir,
    snapshotDir,
    stateRoot: arg(argv, "--state-root", "data/admin/slickcharts-daily-delivery"),
    outcomesPath: arg(argv, "--outcomes", process.env.SLICKCHARTS_DAILY_OUTCOMES_PATH),
    statusPath: arg(argv, "--status", process.env.SLICKCHARTS_RECOVERY_STATUS_PATH),
    run: githubRun(),
    selectedScraper: arg(argv, "--selected-scraper", "all"),
    jobStatus: arg(argv, "--job-status", "success"),
  });
  console.log(JSON.stringify({ exit_code: result.exitCode, degraded_keys: result.degradedKeys, reasons: result.reasons }));
  process.exitCode = result.exitCode;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exitCode = 2;
  }
}
