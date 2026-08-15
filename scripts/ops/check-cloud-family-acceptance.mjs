#!/usr/bin/env node

// Evidence gate for a natural family run. A green producer workflow is not
// cloud-serving proof when the publisher is allowed to return gate_blocked.
// This checker binds the live response to the current run's publish-outcome
// record and exact generation id, then requires the three plane headers.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ENROLLED_PATHS } from "../lib/cloud-data-plane-worker-read.mjs";
import { validatePublishOutcomeShard } from "../lib/publish-outcome-shard.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_BASE_URL = "https://100xfenok.etloveaui.workers.dev";
const SUCCESS_RESULTS = new Set(["published", "resumed"]);
const NOT_PROVEN_EXIT = 75;
const DEFAULT_TIMEOUT_MS = 15_000;

function fail(message) {
  throw new Error(`cloud-family-acceptance: ${message}`);
}
function parseIso(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    fail(`${label} must be a parseable ISO timestamp`);
  }
  return value;
}

function parseArgs(argv) {
  const args = {
    family: null,
    repoRoot: REPO_ROOT,
    outcomeFile: null,
    baseUrl: process.env.CLOUD_ACCEPTANCE_BASE_URL || DEFAULT_BASE_URL,
    minObservedAt: process.env.CLOUD_ACCEPTANCE_MIN_OBSERVED_AT || null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  for (const arg of argv) {
    if (arg.startsWith("--family=")) args.family = arg.slice("--family=".length);
    else if (arg.startsWith("--repo-root=")) args.repoRoot = arg.slice("--repo-root=".length);
    else if (arg.startsWith("--outcome-file=")) args.outcomeFile = arg.slice("--outcome-file=".length);
    else if (arg.startsWith("--base-url=")) args.baseUrl = arg.slice("--base-url=".length);
    else if (arg.startsWith("--min-observed-at=")) args.minObservedAt = arg.slice("--min-observed-at=".length);
    else if (arg.startsWith("--timeout-ms=")) args.timeoutMs = Number(arg.slice("--timeout-ms=".length));
    else fail(`unknown argument: ${arg}`);
  }
  if (!args.family || !/^[a-z][a-z0-9_-]{0,95}$/.test(args.family)) {
    fail("--family is required and must be a valid family id");
  }
  args.repoRoot = path.resolve(args.repoRoot);
  args.outcomeFile = path.resolve(
    args.repoRoot,
    args.outcomeFile || `data/admin/data-supply-state/publish-outcomes/${args.family}.json`,
  );
  if (typeof args.baseUrl !== "string" || !/^https?:\/\/[^\s]+$/u.test(args.baseUrl)) {
    fail("base URL must be an absolute http(s) URL");
  }
  if (args.minObservedAt !== null) parseIso(args.minObservedAt, "min observed timestamp");
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0 || args.timeoutMs > DEFAULT_TIMEOUT_MS) {
    fail(`timeout must be between 1 and ${DEFAULT_TIMEOUT_MS} ms`);
  }
  return args;
}

export function familyPaths(family) {
  const paths = [...ENROLLED_PATHS.entries()]
    .filter(([, candidate]) => candidate === family)
    .map(([assetPath]) => assetPath);
  if (paths.length === 0) fail(`family ${family} has no enrolled serving paths`);
  return paths;
}

export function readCurrentOutcome({ outcomeFile, family, minObservedAt = null, readFile = fs.readFileSync }) {
  if (!fs.existsSync(outcomeFile)) {
    return { record: null, reason: "outcome_shard_absent" };
  }
  let shard;
  try {
    shard = JSON.parse(readFile(outcomeFile, "utf8"));
    validatePublishOutcomeShard(shard, family);
  } catch (error) {
    throw new Error(`invalid outcome shard: ${error.message}`);
  }
  const minMs = minObservedAt === null ? null : Date.parse(parseIso(minObservedAt, "min observed timestamp"));
  const eligible = shard.records.filter((record) => (
    minMs === null || Date.parse(record.observed_at) >= minMs
  ));
  if (eligible.length === 0) {
    return { record: null, reason: "no_outcome_from_current_run" };
  }
  eligible.sort((left, right) => Date.parse(left.observed_at) - Date.parse(right.observed_at));
  return { record: eligible.at(-1), reason: null };
}

function parseRealDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms : null;
}

export function evaluateStrictServingResponse({
  path: assetPath,
  family,
  expectedGeneration,
  status,
  generationHeader,
  sourceAsOfHeader,
  publishedAtHeader,
  nowIso,
}) {
  const failures = [];
  const nowMs = Date.parse(nowIso);
  if (status !== 200) failures.push(`HTTP ${status} (expected 200)`);
  if (!generationHeader || generationHeader !== expectedGeneration) {
    failures.push(`generation header ${generationHeader == null ? "absent" : JSON.stringify(generationHeader)} does not match current ${JSON.stringify(expectedGeneration)}`);
  }
  const sourceMs = parseRealDay(sourceAsOfHeader);
  if (sourceMs === null) failures.push("source-as-of header is absent or invalid");
  else if (Number.isFinite(nowMs) && sourceMs > nowMs) failures.push("source-as-of header is in the future");
  const publishedMs = Date.parse(publishedAtHeader ?? "");
  if (!Number.isFinite(publishedMs)) failures.push("published-at header is absent or invalid");
  else if (Number.isFinite(nowMs) && publishedMs > nowMs) failures.push("published-at header is in the future");
  return {
    path: assetPath,
    family,
    ok: failures.length === 0,
    mode: "strict",
    failures,
  };
}

async function fetchWithTimeout(fetchFn, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, {
      redirect: "manual",
      cache: "no-store",
      headers: { "cache-control": "no-cache", pragma: "no-cache" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function checkCloudFamilyAcceptance({
  family,
  outcomeFile,
  baseUrl = DEFAULT_BASE_URL,
  minObservedAt = null,
  nowIso = new Date().toISOString(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchFn = fetch,
  readFile = fs.readFileSync,
}) {
  const outcome = readCurrentOutcome({ outcomeFile, family, minObservedAt, readFile });
  if (!outcome.record) {
    return { state: "not_proven", family, outcome_result: null, reason: outcome.reason, paths: [] };
  }
  const record = outcome.record;
  if (!SUCCESS_RESULTS.has(record.result)) {
    return {
      state: "not_proven",
      family,
      outcome_result: record.result,
      observed_at: record.observed_at,
      generation_id: record.generation_id,
      reason: record.result === "gate_blocked" ? "cost_gate_blocked" : "publisher_failed",
      paths: [],
    };
  }
  if (!record.generation_id) {
    return {
      state: "not_proven",
      family,
      outcome_result: record.result,
      observed_at: record.observed_at,
      generation_id: null,
      reason: "successful_outcome_has_no_generation_id",
      paths: [],
    };
  }
  const results = [];
  for (const assetPath of familyPaths(family)) {
    let response;
    try {
      response = await fetchWithTimeout(fetchFn, new URL(assetPath, baseUrl).href, timeoutMs);
      results.push(evaluateStrictServingResponse({
        path: assetPath,
        family,
        expectedGeneration: record.generation_id,
        status: response.status,
        generationHeader: response.headers.get("x-data-plane-generation"),
        sourceAsOfHeader: response.headers.get("x-data-plane-source-as-of"),
        publishedAtHeader: response.headers.get("x-data-plane-published-at"),
        nowIso,
      }));
    } catch (error) {
      results.push({
        path: assetPath,
        family,
        ok: false,
        mode: "strict",
        failures: [`fetch failed: ${error.message}`],
      });
    }
  }
  return {
    state: results.every((result) => result.ok) ? "proven" : "not_proven",
    family,
    outcome_result: record.result,
    observed_at: record.observed_at,
    generation_id: record.generation_id,
    reason: results.every((result) => result.ok) ? null : "strict_serving_not_proven",
    paths: results,
  };
}

function exitCodeFor(result) {
  return result.state === "proven" ? 0 : NOT_PROVEN_EXIT;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await checkCloudFamilyAcceptance({
    family: args.family,
    outcomeFile: args.outcomeFile,
    baseUrl: args.baseUrl,
    minObservedAt: args.minObservedAt,
    timeoutMs: args.timeoutMs,
  });
  console.log(JSON.stringify(result));
  process.exitCode = exitCodeFor(result);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
