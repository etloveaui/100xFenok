#!/usr/bin/env node
/**
 * #296 rank-1 macro owner live-equivalence gate.
 *
 * Reads the canonical-root inventory's macro-monitor live-equivalence prep
 * matrix, then checks every listed row against a local Next.js runtime. This is
 * read-only and localhost-only by default.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inventoryScript = path.join(__dirname, "check-canonical-root-inventory.mjs");
const DEFAULT_BASE_URL = "http://127.0.0.1:3105";
const REQUEST_TIMEOUT_MS = Number(process.env.QA_MACRO_OWNER_TIMEOUT_MS ?? 15000);

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.QA_BASE_URL ?? process.env.QA_MACRO_OWNER_BASE_URL ?? DEFAULT_BASE_URL,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--base-url") {
      args.baseUrl = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--base-url=")) {
      args.baseUrl = arg.slice("--base-url=".length);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return args;
}

function normalizeBaseUrl(rawBaseUrl) {
  const url = new URL(rawBaseUrl);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

function assertLocalBaseUrl(baseUrl) {
  const host = baseUrl.hostname.toLowerCase();
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (localHosts.has(host) || host.endsWith(".localhost")) return;
  if (process.env.QA_MACRO_OWNER_ALLOW_REMOTE === "1") return;
  throw new Error(`refusing non-local QA base URL: ${baseUrl.origin}`);
}

function withTimeout(operation, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return operation(controller.signal).finally(() => clearTimeout(timer)).catch((error) => {
    if (error?.name === "AbortError") throw new Error(`${label} timed out after ${REQUEST_TIMEOUT_MS}ms`);
    throw error;
  });
}

function loadMatrix() {
  const raw = execFileSync(process.execPath, [inventoryScript, "--json"], { encoding: "utf8" });
  const report = JSON.parse(raw);
  const matrix = report.macro_monitor_rank1_owner_review?.live_equivalence_prep;
  if (!report.ok) {
    throw new Error(`canonical-root inventory is not OK: ${(report.errors ?? []).join("; ")}`);
  }
  if (!matrix?.matrix_ready) {
    throw new Error("macro owner live-equivalence prep matrix is not ready");
  }
  if (!Array.isArray(matrix.rows) || matrix.rows.length === 0) {
    throw new Error("macro owner live-equivalence prep matrix has no rows");
  }
  return matrix;
}

async function fetchSmoke(baseUrl, row) {
  const url = new URL(row.path, baseUrl);
  const response = await withTimeout(
    (signal) => fetch(url, { redirect: "follow", signal }),
    `GET ${row.path}`,
  );
  await response.arrayBuffer();
  return {
    role: row.role,
    equivalence_group: row.equivalence_group ?? null,
    path: row.path,
    paired_path: row.paired_path ?? null,
    expected_http_status: row.expected_http_status,
    status: response.status,
    final_url: response.url,
    ok: response.status === row.expected_http_status,
  };
}

function printJson(report) {
  console.log(JSON.stringify(report, null, 2));
}

function fail(errors, report, json) {
  if (json) printJson(report);
  console.error(`[qa:macro-owner-live-equivalence] failed (${errors.length} violation(s))`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = normalizeBaseUrl(args.baseUrl);
  assertLocalBaseUrl(baseUrl);

  const matrix = loadMatrix();
  const rows = [];
  const errors = [];

  for (const row of matrix.rows) {
    try {
      const result = await fetchSmoke(baseUrl, row);
      rows.push(result);
      if (!result.ok) {
        errors.push(`${row.role} ${row.path}: expected ${row.expected_http_status}, got ${result.status}`);
      }
    } catch (error) {
      errors.push(`${row.role} ${row.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const report = {
    ok: errors.length === 0,
    base_url: baseUrl.origin,
    matrix_ready: matrix.matrix_ready,
    proof_status: errors.length === 0 ? "local_runtime_smoke_passed" : "local_runtime_smoke_failed",
    rows_checked: rows.length,
    expected_rows: matrix.row_count,
    rows,
    errors,
  };

  if (errors.length > 0) fail(errors, report, args.json);
  if (args.json) {
    printJson(report);
  } else {
    console.log(`[qa:macro-owner-live-equivalence] OK rows=${rows.length} base=${baseUrl.origin}`);
  }
}

main().catch((error) => {
  console.error(`[qa:macro-owner-live-equivalence] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
