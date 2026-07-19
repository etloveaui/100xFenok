#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";


export const SCHEMA_VERSION = "damodaran-shadow-parity/v1";
export const FILE_NAMES = Object.freeze([
  "industries.json",
  "historical_erp.json",
  "credit_ratings.json",
  "erp.json",
  "industry_metrics.json",
  "industry_metrics_regions.json",
]);

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
export const REPORT_RELATIVE_PATH = process.env.DAMODARAN_SHADOW_REPORT
  ?? "data/admin/damodaran-shadow-parity.json";
const REPORT_PATH = path.join(REPO_ROOT, REPORT_RELATIVE_PATH);
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
  fs.writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
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

export function buildReport(bundle, producerResult) {
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

    const committedPath = path.join(REPO_ROOT, "data", "damodaran", file);
    try {
      return {
        file,
        ...comparePayloads(fresh, readJson(committedPath)),
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
    schema_version: SCHEMA_VERSION,
    fetched_at: bundle.fetched_at,
    status,
    mode: "shadow_only",
    ownership_flip: false,
    committed_root: "data/damodaran",
    ignored_compare_paths: ["/metadata/generated_at"],
    conditional_get: bundle.conditional_get,
    producer: {
      exit_code: producerResult.status,
      signal: producerResult.signal,
    },
    summary: {
      match: files.filter((row) => row.status === "match").length,
      mismatch: files.filter((row) => row.status === "mismatch").length,
      blocked: files.filter((row) => row.status === "blocked").length,
      request_count: Object.values(bundle.sources ?? {}).reduce((sum, rows) => sum + rows.length, 0),
    },
    files,
  };
}

export function main() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "damodaran-shadow-"));
  const outputDir = path.join(temporaryRoot, "converter-output");
  const bundlePath = path.join(temporaryRoot, "bundle.json");
  let report;

  try {
    const producerResult = spawnSync(
      process.env.PYTHON || "python3",
      [PRODUCER_PATH, "--output-dir", outputDir, "--bundle", bundlePath],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        timeout: 45 * 60 * 1000,
      },
    );

    if (fs.existsSync(bundlePath)) {
      report = buildReport(readJson(bundlePath), producerResult);
    } else {
      const reason = producerResult.error
        ? `${producerResult.error.name}: ${producerResult.error.message}`
        : `producer exited ${producerResult.status ?? "without status"}`;
      report = {
        schema_version: SCHEMA_VERSION,
        fetched_at: new Date().toISOString(),
        status: "blocked",
        mode: "shadow_only",
        ownership_flip: false,
        committed_root: "data/damodaran",
        ignored_compare_paths: ["/metadata/generated_at"],
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

  atomicWriteJson(REPORT_PATH, report);
  console.log(JSON.stringify(report.summary));
  if (report.status === "match") return 0;
  return report.status === "mismatch" ? 2 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main();
}
