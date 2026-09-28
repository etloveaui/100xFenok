#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { writeJsonAtomic } from "./lib/atomic-file.mjs";
import { buildAttemptRow, foldWorstTuples, threwTuple } from "./lib/provider-fetch-result.mjs";
import { ATTEMPT_SCHEMA, validateAttemptEvidence } from "./build-data-supply-detection-floor.mjs";

export const SLICKCHARTS_MEMBERS = Object.freeze(["daily", "weekly", "monthly", "history", "symbols"]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function eventFiles(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  if (!stat.isDirectory()) return [];
  return fs.readdirSync(target, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .flatMap((entry) => eventFiles(path.join(target, entry.name)));
}

function readEvents(targets) {
  const files = targets.flatMap(eventFiles).filter((filePath) => filePath.endsWith(".jsonl"));
  return files.flatMap((filePath) => fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${filePath}:${index + 1} invalid attempt event: ${error.message}`);
      }
    }));
}

function validateEventTuple(tuple, memberId, index) {
  const row = buildAttemptRow({
    laneId: "slickcharts",
    memberId,
    attemptId: `event-${index}-${memberId}`,
    observedAt: "2000-01-01T00:00:00Z",
    tuple,
  });
  validateAttemptEvidence({ schema_version: ATTEMPT_SCHEMA, attempts: [row] });
  return tuple;
}

export function buildSlickchartsRunRow({
  memberId,
  eventPaths,
  producerOutcomes,
  rowPath,
  observedAt,
  attemptId,
  outcomesPath = null,
}) {
  if (!SLICKCHARTS_MEMBERS.includes(memberId)) throw new Error(`unknown SlickCharts member: ${memberId}`);
  let tuples;
  let eventCount = 0;
  try {
    const events = readEvents(eventPaths);
    eventCount = events.length;
    tuples = events.map((tuple, index) => validateEventTuple(tuple, memberId, index));
  } catch (error) {
    console.error(`SlickCharts ${memberId} run row invalid: ${error.message}`);
    tuples = [threwTuple("unexpected")];
  }
  const nonSuccess = producerOutcomes.filter((outcome) => new Set(["failure", "cancelled", "timed_out"]).has(outcome));
  let perFileFailure = false;
  if (outcomesPath && fs.existsSync(outcomesPath)) {
    const outcomes = readEvents([outcomesPath]);
    perFileFailure = outcomes.some((row) => row?.outcome === "failure");
  }
  if (nonSuccess.length > 0 || perFileFailure || tuples.length === 0) tuples.push(threwTuple("unexpected"));
  const tuple = foldWorstTuples(tuples);
  const row = buildAttemptRow({ laneId: "slickcharts", memberId, attemptId, observedAt, tuple });
  validateAttemptEvidence({ schema_version: ATTEMPT_SCHEMA, attempts: [row] });
  writeJsonAtomic(rowPath, row);
  return { row, eventCount };
}

function argumentValues(argv, name) {
  const values = [];
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === name) values.push(argv[index + 1]);
  }
  return values.filter((value) => value !== undefined);
}

function argumentValue(argv, name, fallback = null) {
  return argumentValues(argv, name).at(-1) ?? fallback;
}

function defaultAttemptId(memberId) {
  const runId = String(process.env.GITHUB_RUN_ID ?? Date.now());
  const runAttempt = String(process.env.GITHUB_RUN_ATTEMPT ?? "1");
  return `gh-${runId}-${runAttempt}-${memberId}`.toLowerCase();
}

function main(argv = process.argv.slice(2)) {
  const memberId = argumentValue(argv, "--member");
  const rowPath = argumentValue(argv, "--row", path.join(process.env.RUNNER_TEMP ?? ".", `slickcharts-${memberId}-row.json`));
  const eventPaths = [...argumentValues(argv, "--events"), ...argumentValues(argv, "--events-root")];
  const producerOutcomes = argumentValues(argv, "--outcome");
  const result = buildSlickchartsRunRow({
    memberId,
    eventPaths,
    producerOutcomes,
    rowPath,
    observedAt: argumentValue(argv, "--observed-at", new Date().toISOString()),
    attemptId: argumentValue(argv, "--attempt-id", defaultAttemptId(memberId)),
    outcomesPath: argumentValue(argv, "--outcomes-file"),
  });
  console.log(JSON.stringify({ member_id: memberId, request_events: result.eventCount, attempt: result.row }));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) main();
