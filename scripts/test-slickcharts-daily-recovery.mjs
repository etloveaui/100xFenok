#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  SLICKCHARTS_DAILY_KEYS,
  finalizeSlickchartsDailyRecovery,
  prepareSlickchartsDailyRecovery,
  validateControlledFailureFiles,
} from "./slickcharts-daily-recovery.mjs";

const payload = (key, sourceAsOf, value = 1) => ({
  source: "slickcharts",
  updated: `${sourceAsOf}T01:00:00Z`,
  history: [{ date: sourceAsOf, count: 1, values: [{ key, value }] }],
});
const writePayload = (dir, key, sourceAsOf, value = 1) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, key), `${JSON.stringify(payload(key, sourceAsOf, value), null, 2)}\n`);
};
const writeOutcomes = (filePath, rows) => {
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
};
const run = (runId, observedAt, eventName = "workflow_dispatch") => ({
  run_id: runId,
  run_attempt: 1,
  event_name: eventName,
  natural: eventName === "schedule",
  observed_at: observedAt,
});

assert.deepEqual(SLICKCHARTS_DAILY_KEYS, [
  "gainers.json",
  "losers.json",
  "treasury.json",
  "currency.json",
  "mortgage.json",
]);
assert.deepEqual(validateControlledFailureFiles("treasury.json", "workflow_dispatch"), ["treasury.json"]);
assert.throws(() => validateControlledFailureFiles("treasury.json", "schedule"), /workflow_dispatch/);
assert.throws(() => validateControlledFailureFiles("sp500.json", "workflow_dispatch"), /unknown/);

{
  const wrapper = path.join(path.dirname(fileURLToPath(import.meta.url)), "run-slickcharts-daily-key.mjs");
  const wrapperRoot = fs.mkdtempSync(path.join(os.tmpdir(), "slickcharts-daily-wrapper-"));
  const wrapperOutcomes = path.join(wrapperRoot, "outcomes.jsonl");
  const injected = spawnSync(process.execPath, [
    wrapper,
    "--key", "treasury.json",
    "--outcomes", wrapperOutcomes,
    "--event-name", "workflow_dispatch",
    "--selected-scraper", "gainers",
    "--controlled-failure-files", "treasury.json",
    "--", process.execPath, "-e", "process.exit(99)",
  ], { encoding: "utf8" });
  assert.equal(injected.status, 0, injected.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(wrapperOutcomes, "utf8")), {
    key: "treasury.json",
    outcome: "failure",
    failure_kind: "controlled",
    error: "owner-approved workflow_dispatch chaos injection",
  });
  const skippedOutcomes = path.join(wrapperRoot, "skipped.jsonl");
  const skipped = spawnSync(process.execPath, [
    wrapper,
    "--key", "treasury.json",
    "--outcomes", skippedOutcomes,
    "--event-name", "workflow_dispatch",
    "--selected-scraper", "gainers",
    "--controlled-failure-files", "",
    "--", process.execPath, "-e", "process.exit(99)",
  ], { encoding: "utf8" });
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.equal(JSON.parse(fs.readFileSync(skippedOutcomes, "utf8")).outcome, "skipped");
  const scheduled = spawnSync(process.execPath, [
    wrapper,
    "--key", "treasury.json",
    "--outcomes", path.join(wrapperRoot, "schedule.jsonl"),
    "--event-name", "schedule",
    "--controlled-failure-files", "treasury.json",
    "--", process.execPath, "-e", "process.exit(0)",
  ], { encoding: "utf8" });
  assert.notEqual(scheduled.status, 0, "scheduled runs must reject chaos injection before executing the scraper");
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "slickcharts-daily-recovery-"));
const dataDir = path.join(root, "data", "slickcharts");
const stateRoot = path.join(root, "data", "admin", "slickcharts-daily-delivery");
const snapshotDir = path.join(root, "snapshot");
const outcomesPath = path.join(root, "outcomes.jsonl");
const statusPath = path.join(root, "status.json");

for (const key of SLICKCHARTS_DAILY_KEYS) writePayload(dataDir, key, "2026-07-14", 1);
prepareSlickchartsDailyRecovery({ dataDir, snapshotDir });
for (const key of SLICKCHARTS_DAILY_KEYS) writePayload(dataDir, key, "2026-07-15", 2);
fs.writeFileSync(path.join(dataDir, "treasury.json"), "{corrupt\n");
writeOutcomes(outcomesPath, SLICKCHARTS_DAILY_KEYS.map((key) => ({
  key,
  outcome: key === "treasury.json" ? "failure" : "success",
  failure_kind: key === "treasury.json" ? "controlled" : null,
  error: key === "treasury.json" ? "owner-approved controlled failure" : null,
})));

{
  const result = finalizeSlickchartsDailyRecovery({
    dataDir,
    stateRoot,
    snapshotDir,
    outcomesPath,
    statusPath,
    run: run("slick-failure", "2026-07-15T01:00:00Z"),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.publishData, true);
  assert.deepEqual(result.degradedKeys, ["treasury.json"]);
  assert.deepEqual(
    fs.readFileSync(path.join(dataDir, "treasury.json")),
    fs.readFileSync(path.join(snapshotDir, "treasury.json")),
    "failed key must be restored to the exact pre-run LKG bytes",
  );
  const state = JSON.parse(fs.readFileSync(path.join(stateRoot, "keys", "treasury.json"), "utf8"));
  assert.equal(state.resolution_state, "lkg_primary");
  assert.equal(state.retry, true);
  assert.equal(state.latest_failure.run_id, "slick-failure");
  assert.equal(JSON.parse(fs.readFileSync(statusPath, "utf8")).exit_code, 0);
  const index = JSON.parse(fs.readFileSync(path.join(stateRoot, "index.json"), "utf8"));
  assert.deepEqual(index.keys, SLICKCHARTS_DAILY_KEYS);
  assert.deepEqual(index.retry_keys, ["treasury.json"]);
  assert.deepEqual(index.current_attempt.failed_keys, ["treasury.json"]);
}

prepareSlickchartsDailyRecovery({ dataDir, snapshotDir });
for (const key of SLICKCHARTS_DAILY_KEYS) writePayload(dataDir, key, "2026-07-16", 3);
writeOutcomes(outcomesPath, SLICKCHARTS_DAILY_KEYS.map((key) => ({ key, outcome: "success", failure_kind: null, error: null })));
{
  const result = finalizeSlickchartsDailyRecovery({
    dataDir,
    stateRoot,
    snapshotDir,
    outcomesPath,
    statusPath,
    run: run("slick-manual-green", "2026-07-16T01:00:00Z"),
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.degradedKeys, ["treasury.json"], "manual green dispatch retains per-file LKG instead of promoting recovery");
  const state = JSON.parse(fs.readFileSync(path.join(stateRoot, "keys", "treasury.json"), "utf8"));
  assert.equal(state.resolution_state, "lkg_primary");
  assert.equal(state.latest_failure.run_id, "slick-failure");
}

prepareSlickchartsDailyRecovery({ dataDir, snapshotDir });
for (const key of SLICKCHARTS_DAILY_KEYS) writePayload(dataDir, key, "2026-07-17", 4);
writeOutcomes(outcomesPath, SLICKCHARTS_DAILY_KEYS.map((key) => ({ key, outcome: "success", failure_kind: null, error: null })));
{
  const result = finalizeSlickchartsDailyRecovery({
    dataDir,
    stateRoot,
    snapshotDir,
    outcomesPath,
    statusPath,
    run: run("slick-recovery", "2026-07-17T01:00:00Z", "schedule"),
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.degradedKeys, []);
  const state = JSON.parse(fs.readFileSync(path.join(stateRoot, "keys", "treasury.json"), "utf8"));
  assert.equal(state.resolution_state, "fresh_primary");
  assert.equal(state.retry, false);
  assert.equal(state.recovered_from_run_id, "slick-failure");
  assert.equal(state.recovery_event_name, "schedule");
  assert.equal(state.recovery_run_attempt, 1);
}

{
  const corruptRoot = fs.mkdtempSync(path.join(os.tmpdir(), "slickcharts-daily-corrupt-"));
  const corruptData = path.join(corruptRoot, "data");
  const corruptSnapshots = path.join(corruptRoot, "snapshots");
  const corruptOutcomes = path.join(corruptRoot, "outcomes.jsonl");
  for (const key of SLICKCHARTS_DAILY_KEYS) writePayload(corruptData, key, "2026-07-14", 1);
  prepareSlickchartsDailyRecovery({ dataDir: corruptData, snapshotDir: corruptSnapshots });
  fs.unlinkSync(path.join(corruptSnapshots, "treasury.json"));
  writeOutcomes(corruptOutcomes, SLICKCHARTS_DAILY_KEYS.map((key) => ({
    key,
    outcome: key === "treasury.json" ? "failure" : "success",
    failure_kind: key === "treasury.json" ? "transport" : null,
    error: key === "treasury.json" ? "reset" : null,
  })));
  const result = finalizeSlickchartsDailyRecovery({
    dataDir: corruptData,
    stateRoot: path.join(corruptRoot, "state"),
    snapshotDir: corruptSnapshots,
    outcomesPath: corruptOutcomes,
    statusPath: path.join(corruptRoot, "status.json"),
    run: run("slick-corrupt", "2026-07-15T01:00:00Z"),
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.publishData, false);
  assert.match(result.reasons.join("; "), /valid retained LKG/i);
}

{
  const setupRoot = fs.mkdtempSync(path.join(os.tmpdir(), "slickcharts-daily-setup-failure-"));
  const setupData = path.join(setupRoot, "data");
  const setupSnapshots = path.join(setupRoot, "snapshots");
  for (const key of SLICKCHARTS_DAILY_KEYS) writePayload(setupData, key, "2026-07-14", 1);
  prepareSlickchartsDailyRecovery({ dataDir: setupData, snapshotDir: setupSnapshots });
  const result = finalizeSlickchartsDailyRecovery({
    dataDir: setupData,
    stateRoot: path.join(setupRoot, "state"),
    snapshotDir: setupSnapshots,
    outcomesPath: path.join(setupRoot, "missing-outcomes.jsonl"),
    statusPath: path.join(setupRoot, "status.json"),
    selectedScraper: "treasury",
    jobStatus: "failure",
    run: run("slick-setup-failure", "2026-07-15T01:00:00Z"),
  });
  assert.equal(result.exitCode, 2, "a selected scraper with no outcome after job failure is not silently skipped");
  assert.deepEqual(result.degradedKeys, ["treasury.json"]);
}

{
  const skippedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "slickcharts-daily-skipped-corrupt-"));
  const skippedData = path.join(skippedRoot, "data");
  const skippedSnapshots = path.join(skippedRoot, "snapshots");
  const skippedState = path.join(skippedRoot, "state");
  const skippedOutcomes = path.join(skippedRoot, "outcomes.jsonl");
  for (const key of SLICKCHARTS_DAILY_KEYS) writePayload(skippedData, key, "2026-07-14", 1);
  prepareSlickchartsDailyRecovery({ dataDir: skippedData, snapshotDir: skippedSnapshots });
  fs.mkdirSync(path.join(skippedState, "keys"), { recursive: true });
  fs.writeFileSync(path.join(skippedState, "keys", "treasury.json"), "{broken\n");
  writeOutcomes(skippedOutcomes, [
    { key: "gainers.json", outcome: "success", failure_kind: null, error: null },
    { key: "losers.json", outcome: "skipped", failure_kind: null, error: null },
    { key: "treasury.json", outcome: "skipped", failure_kind: null, error: null },
    { key: "currency.json", outcome: "skipped", failure_kind: null, error: null },
    { key: "mortgage.json", outcome: "skipped", failure_kind: null, error: null },
  ]);
  const result = finalizeSlickchartsDailyRecovery({
    dataDir: skippedData,
    stateRoot: skippedState,
    snapshotDir: skippedSnapshots,
    outcomesPath: skippedOutcomes,
    statusPath: path.join(skippedRoot, "status.json"),
    selectedScraper: "gainers",
    jobStatus: "success",
    run: run("slick-skipped-corrupt", "2026-07-15T01:00:00Z"),
  });
  assert.equal(result.exitCode, 2, "a corrupt committed state cannot hide behind an unselected key");
  assert.equal(result.publishData, false);
  assert.deepEqual(result.degradedKeys, ["treasury.json"]);
}

{
  const skippedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "slickcharts-daily-skipped-corrupt-lkg-"));
  const skippedData = path.join(skippedRoot, "data");
  const skippedSnapshots = path.join(skippedRoot, "snapshots");
  const skippedState = path.join(skippedRoot, "state");
  const skippedOutcomes = path.join(skippedRoot, "outcomes.jsonl");
  for (const key of SLICKCHARTS_DAILY_KEYS) writePayload(skippedData, key, "2026-07-14", 1);
  prepareSlickchartsDailyRecovery({ dataDir: skippedData, snapshotDir: skippedSnapshots });
  writeOutcomes(skippedOutcomes, SLICKCHARTS_DAILY_KEYS.map((key) => ({
    key,
    outcome: "success",
    failure_kind: null,
    error: null,
  })));
  finalizeSlickchartsDailyRecovery({
    dataDir: skippedData,
    stateRoot: skippedState,
    snapshotDir: skippedSnapshots,
    outcomesPath: skippedOutcomes,
    statusPath: path.join(skippedRoot, "seed-status.json"),
    run: run("slick-skipped-lkg-seed", "2026-07-14T01:00:00Z"),
  });
  fs.writeFileSync(path.join(skippedState, "lkg", "treasury.json"), "{broken\n");
  writeOutcomes(skippedOutcomes, [
    { key: "gainers.json", outcome: "success", failure_kind: null, error: null },
    { key: "losers.json", outcome: "skipped", failure_kind: null, error: null },
    { key: "treasury.json", outcome: "skipped", failure_kind: null, error: null },
    { key: "currency.json", outcome: "skipped", failure_kind: null, error: null },
    { key: "mortgage.json", outcome: "skipped", failure_kind: null, error: null },
  ]);
  const result = finalizeSlickchartsDailyRecovery({
    dataDir: skippedData,
    stateRoot: skippedState,
    snapshotDir: skippedSnapshots,
    outcomesPath: skippedOutcomes,
    statusPath: path.join(skippedRoot, "status.json"),
    selectedScraper: "gainers",
    jobStatus: "success",
    run: run("slick-skipped-corrupt-lkg", "2026-07-15T01:00:00Z"),
  });
  assert.equal(result.exitCode, 2, "corrupt retained bytes cannot hide behind an unselected key");
  assert.equal(result.publishData, false);
  assert.deepEqual(result.degradedKeys, ["treasury.json"]);
}

console.log("test-slickcharts-daily-recovery: ok");
