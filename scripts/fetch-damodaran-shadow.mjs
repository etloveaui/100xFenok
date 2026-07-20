#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";


export const SCHEMA_VERSION = "damodaran-owner-guard/v1";
export const FILE_NAMES = Object.freeze([
  "industries.json",
  "historical_erp.json",
  "credit_ratings.json",
  "erp.json",
  "industry_metrics.json",
  "industry_metrics_regions.json",
]);
export const CANONICAL_RELATIVE_PATHS = Object.freeze([
  "data/damodaran/industries.json",
  "data/damodaran/historical_erp.json",
  "data/damodaran/credit_ratings.json",
  "data/damodaran/erp.json",
  "data/damodaran/industry_metrics.json",
  "data/damodaran/industry_metrics_regions.json",
]);
export const PUBLIC_MIRROR_RELATIVE_PATHS = Object.freeze([
  "100xfenok-next/public/data/damodaran/industries.json",
  "100xfenok-next/public/data/damodaran/historical_erp.json",
  "100xfenok-next/public/data/damodaran/credit_ratings.json",
  "100xfenok-next/public/data/damodaran/erp.json",
  "100xfenok-next/public/data/damodaran/industry_metrics.json",
  "100xfenok-next/public/data/damodaran/industry_metrics_regions.json",
]);

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
export const REPORT_RELATIVE_PATH = process.env.DAMODARAN_SHADOW_REPORT
  ?? "data/admin/damodaran/owner-guard.json";
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
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
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

export function guardProducedFiles(bundle, producedRoot) {
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

    const producedPath = path.join(producedRoot, file);
    try {
      const produced = readJson(producedPath);
      let comparison;
      try {
        assert.deepStrictEqual(fresh, produced);
        comparison = { status: "match", first_divergent_paths: [] };
      } catch (error) {
        if (error?.code !== "ERR_ASSERTION") throw error;
        comparison = {
          status: "mismatch",
          first_divergent_paths: firstDivergentPaths(fresh, produced),
        };
      }
      return {
        file,
        ...comparison,
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
    status,
    summary: {
      match: files.filter((row) => row.status === "match").length,
      mismatch: files.filter((row) => row.status === "mismatch").length,
      blocked: files.filter((row) => row.status === "blocked").length,
    },
    files,
  };
}

export function promoteProducedFiles({ bundle, producedRoot, canonicalRoot }) {
  const guard = guardProducedFiles(bundle, producedRoot);
  if (guard.status !== "match") {
    throw new Error(`Damodaran owner guard failed: ${guard.status}`);
  }

  fs.mkdirSync(canonicalRoot, { recursive: true });
  const temporaryFiles = [];
  try {
    for (const file of FILE_NAMES) {
      const temporaryPath = path.join(canonicalRoot, `.${file}.${process.pid}.tmp`);
      fs.copyFileSync(path.join(producedRoot, file), temporaryPath);
      temporaryFiles.push([temporaryPath, path.join(canonicalRoot, file)]);
    }
    for (const [temporaryPath, targetPath] of temporaryFiles) {
      fs.renameSync(temporaryPath, targetPath);
    }
  } finally {
    for (const [temporaryPath] of temporaryFiles) {
      if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    }
  }
  return guard;
}

export function buildReport(bundle, producerResult, guard) {
  return {
    schema_version: SCHEMA_VERSION,
    fetched_at: bundle.fetched_at,
    status: guard.status,
    mode: "owner_guard",
    ownership_flip: true,
    guard_target: "producer_bundle_vs_generated_files",
    committed_root: "data/damodaran",
    public_mirror: "100xfenok-next/public/data/damodaran",
    ignored_compare_paths: [],
    conditional_get: bundle.conditional_get,
    producer: {
      exit_code: producerResult.status,
      signal: producerResult.signal,
    },
    summary: {
      ...guard.summary,
      request_count: Object.values(bundle.sources ?? {}).reduce((sum, rows) => sum + rows.length, 0),
    },
    files: guard.files,
  };
}

export function main() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "damodaran-shadow-"));
  const outputDir = path.join(temporaryRoot, "converter-output");
  const bundlePath = path.join(temporaryRoot, "bundle.json");
  const canonicalRoot = path.join(REPO_ROOT, "data", "damodaran");
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
      const bundle = readJson(bundlePath);
      let guard = guardProducedFiles(bundle, outputDir);
      if (producerResult.status === 0 && guard.status === "match") {
        try {
          guard = promoteProducedFiles({ bundle, producedRoot: outputDir, canonicalRoot });
        } catch (error) {
          guard = {
            status: "blocked",
            summary: { match: 0, mismatch: 0, blocked: FILE_NAMES.length },
            files: blockedRows(`${error.name}: ${error.message}`),
          };
        }
      } else if (producerResult.status !== 0 && guard.status === "match") {
        guard = {
          status: "blocked",
          summary: { match: 0, mismatch: 0, blocked: FILE_NAMES.length },
          files: blockedRows(`producer exited ${producerResult.status ?? "without status"}`),
        };
      }
      report = buildReport(bundle, producerResult, guard);
    } else {
      const reason = producerResult.error
        ? `${producerResult.error.name}: ${producerResult.error.message}`
        : `producer exited ${producerResult.status ?? "without status"}`;
      report = {
        schema_version: SCHEMA_VERSION,
        fetched_at: new Date().toISOString(),
        status: "blocked",
        mode: "owner_guard",
        ownership_flip: true,
        guard_target: "producer_bundle_vs_generated_files",
        committed_root: "data/damodaran",
        public_mirror: "100xfenok-next/public/data/damodaran",
        ignored_compare_paths: [],
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
