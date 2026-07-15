#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { tupleStatus } from "./lib/data-supply-attempt-shard.mjs";
import { validateControlledFailureFiles } from "./slickcharts-daily-recovery.mjs";

function arg(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
}

function readEvents(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}

function failureKind(events) {
  const kinds = events.map((tuple) => {
    if (tuple?.execution === "threw") return tuple.exception_kind === "transport" ? "transport" : "unexpected";
    if ([401, 403].includes(tuple?.http_status)) return "auth";
    if (tuple?.http_status === 429) return "rate_limited";
    if (tuple?.decode === "error") return "decode";
    if (tuple?.assertions?.some((item) => item?.passed === false)) return "schema_drift";
    return tupleStatus(tuple) !== "ready" ? "http" : null;
  }).filter(Boolean);
  return ["auth", "rate_limited", "decode", "schema_drift", "unexpected", "transport", "http"]
    .find((kind) => kinds.includes(kind)) ?? "unexpected";
}

function appendOutcome(filePath, row) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const descriptor = fs.openSync(filePath, "a", 0o600);
  try {
    fs.writeSync(descriptor, `${JSON.stringify(row)}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
if (separator < 0 || separator === argv.length - 1) throw new Error("scraper command after -- is required");
const key = arg(argv, "--key");
const outcomesPath = arg(argv, "--outcomes", process.env.SLICKCHARTS_DAILY_OUTCOMES_PATH);
const eventName = arg(argv, "--event-name", process.env.GITHUB_EVENT_NAME);
const selectedScraper = arg(argv, "--selected-scraper", "all");
const controlled = validateControlledFailureFiles(
  arg(argv, "--controlled-failure-files", process.env.INPUT_CONTROLLED_FAILURE_FILES ?? ""),
  eventName,
);
if (!key || !outcomesPath) throw new Error("--key and --outcomes are required");

if (controlled.includes(key)) {
  appendOutcome(outcomesPath, {
    key,
    outcome: "failure",
    failure_kind: "controlled",
    error: "owner-approved workflow_dispatch chaos injection",
  });
  console.error(`[degraded] controlled failure injected for ${key}`);
  process.exit(0);
}

if (selectedScraper !== "all" && key !== `${selectedScraper}.json`) {
  appendOutcome(outcomesPath, { key, outcome: "skipped", failure_kind: null, error: null });
  console.log(`Skipped unselected SlickCharts daily key ${key}`);
  process.exit(0);
}

const before = readEvents(process.env.SLICKCHARTS_ATTEMPT_EVENTS_PATH).length;
const result = spawnSync(argv[separator + 1], argv.slice(separator + 2), { stdio: "inherit", env: process.env });
const events = readEvents(process.env.SLICKCHARTS_ATTEMPT_EVENTS_PATH).slice(before);
if (result.status === 0) {
  appendOutcome(outcomesPath, { key, outcome: "success", failure_kind: null, error: null });
} else {
  appendOutcome(outcomesPath, {
    key,
    outcome: "failure",
    failure_kind: failureKind(events),
    error: result.error?.message ?? `scraper exited ${result.status ?? "without status"}`,
  });
}

// The recovery finalizer owns the lane exit after all five per-file outcomes exist.
process.exit(0);
