#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAttemptRow,
  foldWorstTuples,
  mergeCompositeShard,
  threwTuple,
  writeJsonAtomic,
} from "./lib/data-supply-attempt-shard.mjs";

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
  buildAttemptRow({
    laneId: "slickcharts",
    memberId,
    attemptId: `event-${index}-${memberId}`,
    observedAt: "2000-01-01T00:00:00Z",
    tuple,
  });
  return tuple;
}

export function mergeSlickchartsRow({ memberId, rowPath, shardPath }) {
  if (!SLICKCHARTS_MEMBERS.includes(memberId)) throw new Error(`unknown SlickCharts member: ${memberId}`);
  const row = readJson(rowPath);
  const baseShard = fs.existsSync(shardPath) ? readJson(shardPath) : null;
  const shard = mergeCompositeShard({
    laneId: "slickcharts",
    memberIds: SLICKCHARTS_MEMBERS,
    baseShard,
    row,
  });
  writeJsonAtomic(shardPath, shard);
  return { row, shard };
}

export function runSlickchartsAttempt({
  memberId,
  eventPaths,
  producerOutcomes,
  shardPath,
  rowPath,
  observedAt,
  attemptId,
}) {
  if (!SLICKCHARTS_MEMBERS.includes(memberId)) throw new Error(`unknown SlickCharts member: ${memberId}`);
  let tuples;
  let eventCount = 0;
  try {
    const events = readEvents(eventPaths);
    eventCount = events.length;
    tuples = events.map((tuple, index) => validateEventTuple(tuple, memberId, index));
  } catch (error) {
    console.error(`SlickCharts ${memberId} telemetry invalid: ${error.message}`);
    tuples = [threwTuple("unexpected")];
  }
  const nonSuccess = producerOutcomes.filter((outcome) => new Set(["failure", "cancelled", "timed_out"]).has(outcome));
  if (nonSuccess.length > 0 || tuples.length === 0) tuples.push(threwTuple("unexpected"));
  const tuple = foldWorstTuples(tuples);
  const row = buildAttemptRow({ laneId: "slickcharts", memberId, attemptId, observedAt, tuple });
  writeJsonAtomic(rowPath, row);
  const baseShard = fs.existsSync(shardPath) ? readJson(shardPath) : null;
  const shard = mergeCompositeShard({
    laneId: "slickcharts",
    memberIds: SLICKCHARTS_MEMBERS,
    baseShard,
    row,
  });
  writeJsonAtomic(shardPath, shard);
  return { row, shard, eventCount };
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
  const shardPath = argumentValue(argv, "--shard", "data/admin/data-supply-state/detection-attempts/slickcharts.json");
  const rowPath = argumentValue(argv, "--row", path.join(process.env.RUNNER_TEMP ?? ".", `slickcharts-${memberId}-row.json`));
  if (argumentValue(argv, "--row-in")) {
    mergeSlickchartsRow({ memberId, rowPath: argumentValue(argv, "--row-in"), shardPath });
    return;
  }
  const eventPaths = [...argumentValues(argv, "--events"), ...argumentValues(argv, "--events-root")];
  const producerOutcomes = argumentValues(argv, "--outcome");
  const result = runSlickchartsAttempt({
    memberId,
    eventPaths,
    producerOutcomes,
    shardPath,
    rowPath,
    observedAt: argumentValue(argv, "--observed-at", new Date().toISOString()),
    attemptId: argumentValue(argv, "--attempt-id", defaultAttemptId(memberId)),
  });
  console.log(JSON.stringify({ member_id: memberId, request_events: result.eventCount, attempt: result.row }));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) main();
