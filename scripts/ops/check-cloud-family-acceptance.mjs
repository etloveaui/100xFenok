#!/usr/bin/env node

// Verify that a family is live on the cloud data plane with valid serving headers.
// A supplied minimum publish time binds the response to the current run.


import { ENROLLED_PATHS } from "../lib/cloud-data-plane-worker-read.mjs";
import { liveRequestHeaders } from "../lib/live-request-headers.mjs";

const DEFAULT_BASE_URL = "https://100xfenok.etloveaui.workers.dev";
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
    baseUrl: process.env.CLOUD_ACCEPTANCE_BASE_URL || DEFAULT_BASE_URL,
    minObservedAt: process.env.CLOUD_ACCEPTANCE_MIN_OBSERVED_AT || null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  for (const arg of argv) {
    if (arg.startsWith("--family=")) args.family = arg.slice("--family=".length);
    else if (arg.startsWith("--base-url=")) args.baseUrl = arg.slice("--base-url=".length);
    else if (arg.startsWith("--min-observed-at=")) args.minObservedAt = arg.slice("--min-observed-at=".length);
    else if (arg.startsWith("--timeout-ms=")) args.timeoutMs = Number(arg.slice("--timeout-ms=".length));
    else fail(`unknown argument: ${arg}`);
  }
  if (!args.family || !/^[a-z][a-z0-9_-]{0,95}$/.test(args.family)) {
    fail("--family is required and must be a valid family id");
  }
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

function parseRealDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms : null;
}

export function evaluateStrictServingResponse({
  path: assetPath,
  family,
  minObservedAt = null,
  status,
  generationHeader,
  sourceAsOfHeader,
  publishedAtHeader,
  nowIso,
}) {
  const failures = [];
  const nowMs = Date.parse(nowIso);
  if (status !== 200) failures.push(`HTTP ${status} (expected 200)`);
  if (!generationHeader) failures.push("generation header is absent");
  const sourceMs = parseRealDay(sourceAsOfHeader);
  if (sourceMs === null) failures.push("source-as-of header is absent or invalid");
  else if (Number.isFinite(nowMs) && sourceMs > nowMs) failures.push("source-as-of header is in the future");
  const publishedMs = Date.parse(publishedAtHeader ?? "");
  if (!Number.isFinite(publishedMs)) failures.push("published-at header is absent or invalid");
  else if (Number.isFinite(nowMs) && publishedMs > nowMs) failures.push("published-at header is in the future");
  else if (minObservedAt !== null && publishedMs < Date.parse(minObservedAt)) failures.push("published-at header predates the current run");
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
      headers: {
        "cache-control": "no-cache",
        pragma: "no-cache",
        ...liveRequestHeaders(),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function checkCloudFamilyAcceptance({
  family,
  baseUrl = DEFAULT_BASE_URL,
  minObservedAt = null,
  nowIso = new Date().toISOString(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchFn = fetch,
}) {
  if (minObservedAt !== null) parseIso(minObservedAt, "min observed timestamp");
  const results = [];
  for (const assetPath of familyPaths(family)) {
    try {
      const response = await fetchWithTimeout(fetchFn, new URL(assetPath, baseUrl).href, timeoutMs);
      results.push(evaluateStrictServingResponse({
        path: assetPath,
        family,
        minObservedAt,
        status: response.status,
        generationHeader: response.headers.get("x-data-plane-generation"),
        sourceAsOfHeader: response.headers.get("x-data-plane-source-as-of"),
        publishedAtHeader: response.headers.get("x-data-plane-published-at"),
        nowIso,
      }));
    } catch (error) {
      results.push({ path: assetPath, family, ok: false, mode: "strict", failures: [`fetch failed: ${error.message}`] });
    }
  }
  const proven = results.every((result) => result.ok);
  return { state: proven ? "proven" : "not_proven", family, reason: proven ? null : "strict_serving_not_proven", paths: results };
}

function exitCodeFor(result) {
  return result.state === "proven" ? 0 : NOT_PROVEN_EXIT;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await checkCloudFamilyAcceptance({
    family: args.family,
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
