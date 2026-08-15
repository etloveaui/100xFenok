#!/usr/bin/env node

// Read-only observability for the SEC 13F public projection. The canonical
// comparison target is read from a caller-selected Git ref so a stale working
// tree cannot make a live projection look current. This probe is intentionally
// not a freshness, graph, deploy, or publication gate.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_BASE_URL = "https://100xfenok.etloveaui.workers.dev";
const DEFAULT_CANONICAL_REF = "origin/main";
const ROUTES = Object.freeze({
  summary: "/data/sec-13f/summary.json",
  consensus: "/data/sec-13f/analytics/consensus.json",
  byTicker: "/data/sec-13f/by_ticker.json",
});

function parseArgs(argv) {
  const args = [...argv];
  const readOption = (name, fallback) => {
    const index = args.indexOf(name);
    if (index < 0) return fallback;
    const value = args[index + 1];
    if (!value || value.startsWith("-")) throw new Error(`${name} requires a value`);
    return value;
  };

  const baseUrl = new URL(readOption("--base-url", process.env.SEC13F_PARITY_BASE_URL ?? DEFAULT_BASE_URL));
  assert.ok(/^https?:$/u.test(baseUrl.protocol), "--base-url must use HTTP(S)");
  return {
    baseUrl: baseUrl.toString().replace(/\/$/u, ""),
    canonicalRef: readOption(
      "--canonical-ref",
      process.env.SEC13F_PARITY_CANONICAL_REF ?? DEFAULT_CANONICAL_REF,
    ),
    reportPath: readOption(
      "--report-path",
      process.env.SEC13F_PARITY_REPORT_PATH ?? "",
    ),
    timeoutMs: Number(readOption("--timeout-ms", process.env.SEC13F_PARITY_TIMEOUT_MS ?? "15000")),
  };
}

function stable(value) {
  return JSON.stringify(value);
}

function sortedStrings(value, label) {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  return [...value].map(String).sort();
}

function readCanonicalJson(canonicalRef, relativePath) {
  const raw = execFileSync(
    "git",
    ["show", `${canonicalRef}:${relativePath}`],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(raw);
}

export function buildExpected(canonical) {
  const summaryMetadata = canonical.summary?.metadata;
  const consensusMetadata = canonical.consensus?.metadata;
  assert.ok(summaryMetadata && typeof summaryMetadata === "object", "canonical SEC 13F summary metadata is required");
  assert.ok(consensusMetadata && typeof consensusMetadata === "object", "canonical SEC 13F consensus metadata is required");
  assert.ok(Array.isArray(summaryMetadata.quarters_covered), "canonical quarters_covered is required");
  assert.ok(Array.isArray(consensusMetadata.excluded_stale_investors), "canonical excluded stale list is required");
  return {
    source_quarter: summaryMetadata.source_quarter,
    quarters_covered_length: summaryMetadata.quarters_covered.length,
    investor_count: summaryMetadata.investor_count,
    current_cohort_investors: consensusMetadata.current_cohort_investors,
    excluded_stale_investors: sortedStrings(
      consensusMetadata.excluded_stale_investors,
      "canonical excluded stale list",
    ),
    by_ticker_count: Object.keys(canonical.byTicker ?? {}).length,
  };
}

export function compareSemantic({ canonical, live, statuses }) {
  const expected = buildExpected(canonical);
  const summaryMetadata = live.summary?.metadata;
  const consensusMetadata = live.consensus?.metadata;
  const actual = {
    source_quarter: summaryMetadata?.source_quarter,
    quarters_covered_length: Array.isArray(summaryMetadata?.quarters_covered)
      ? summaryMetadata.quarters_covered.length
      : null,
    investor_count: summaryMetadata?.investor_count,
    current_cohort_investors: consensusMetadata?.current_cohort_investors,
    excluded_stale_investors: Array.isArray(consensusMetadata?.excluded_stale_investors)
      ? [...consensusMetadata.excluded_stale_investors].map(String).sort()
      : null,
    by_ticker_count: live.byTicker && typeof live.byTicker === "object"
      ? Object.keys(live.byTicker).length
      : null,
  };
  const rows = Object.keys(expected).map((key) => ({
    key,
    expected: expected[key],
    actual: actual[key],
    ok: stable(expected[key]) === stable(actual[key]),
  }));
  const routeRows = Object.entries(ROUTES).map(([key, route]) => ({
    key: `HTTP ${key}`,
    expected: 200,
    actual: statuses?.[key] ?? null,
    ok: statuses?.[key] === 200,
  }));
  return {
    ok: [...routeRows, ...rows].every((row) => row.ok),
    expected,
    actual,
    rows: [...routeRows, ...rows],
  };
}

async function fetchJson(baseUrl, route, timeoutMs, cacheBust) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const separator = route.includes("?") ? "&" : "?";
    const response = await fetch(`${baseUrl}${route}${separator}t=${cacheBust}`, {
      cache: "no-store",
      headers: {
        "cache-control": "no-cache, no-store",
        pragma: "no-cache",
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    let parseError = null;
    try {
      json = JSON.parse(text);
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
    return { status: response.status, json, parseError };
  } catch (error) {
    return {
      status: null,
      json: null,
      parseError: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function formatValue(value) {
  if (value === undefined) return "<missing>";
  if (value === null) return "null";
  return stable(value);
}

export function formatReport(result, context) {
  const status = result.ok ? "PASS" : "FAIL";
  const lines = [
    `SEC 13F live semantic parity: ${status}`,
    `base_url=${context.baseUrl}`,
    `canonical_ref=${context.canonicalRef}`,
    "evidence_class=observability_only; freshness_credit=false; graph_expansion=false; deploy_gate=false",
  ];
  for (const row of result.rows) {
    lines.push(`- ${row.ok ? "PASS" : "FAIL"} ${row.key}: expected=${formatValue(row.expected)} actual=${formatValue(row.actual)}`);
  }
  return lines.join("\n");
}

function readCanonical(canonicalRef) {
  return {
    summary: readCanonicalJson(canonicalRef, "data/sec-13f/summary.json"),
    consensus: readCanonicalJson(canonicalRef, "data/sec-13f/analytics/consensus.json"),
    byTicker: readCanonicalJson(canonicalRef, "data/sec-13f/by_ticker.json"),
  };
}

async function run(argv) {
  const options = parseArgs(argv);
  const canonical = readCanonical(options.canonicalRef);
  const cacheBust = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const fetched = await Promise.all(
    Object.entries(ROUTES).map(async ([key, route]) => [key, await fetchJson(options.baseUrl, route, options.timeoutMs, cacheBust)]),
  );
  const payloads = Object.fromEntries(fetched);
  const result = compareSemantic({
    canonical,
    live: {
      summary: payloads.summary.json,
      consensus: payloads.consensus.json,
      byTicker: payloads.byTicker.json,
    },
    statuses: Object.fromEntries(fetched.map(([key, value]) => [key, value.status])),
  });
  const report = formatReport(result, options);
  if (options.reportPath) fs.writeFileSync(options.reportPath, `${report}\n`, "utf8");
  process.stdout.write(`${report}\n`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`SEC 13F live semantic parity: BLOCKED\n${message}\n`);
    process.exitCode = 1;
  });
}
