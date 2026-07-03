#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

export const BUILD_COMMAND = "npm run cf:build";
export const WARN_GZIP_BYTES = 2950 * 1024;
export const HARD_GZIP_BYTES = 3000 * 1024;
export const BASELINE_DELTA_BYTES = 128 * 1024;

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const APP_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const BASELINE_PATH = path.join(APP_ROOT, "scripts", "worker-bundle-baseline.json");
const BASELINE_RELATIVE_PATH = path.relative(APP_ROOT, BASELINE_PATH);
const WRANGLER_OUTDIR = path.join(APP_ROOT, ".wrangler", "worker-bundle-budget");
const WRANGLER_META_PATH = path.join(WRANGLER_OUTDIR, "bundle-meta.json");
const WRANGLER_BUNDLE_PATH = path.join(WRANGLER_OUTDIR, "worker.js");

export function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB`;
}

export function evaluateBudget(gzipBytes, options = {}) {
  const warnBytes = options.warnBytes ?? WARN_GZIP_BYTES;
  const hardBytes = options.hardBytes ?? HARD_GZIP_BYTES;
  const maxBaselineDeltaBytes = options.maxBaselineDeltaBytes ?? BASELINE_DELTA_BYTES;
  const baselineGzipBytes = options.baselineGzipBytes;
  const baselineDeltaBytes = Number.isFinite(baselineGzipBytes) ? gzipBytes - baselineGzipBytes : null;
  const hardFailures = [];
  const warnings = [];

  if (gzipBytes > hardBytes) {
    hardFailures.push(`gzip ${formatKiB(gzipBytes)} exceeds hard budget ${formatKiB(hardBytes)}`);
  }
  if (baselineDeltaBytes !== null && baselineDeltaBytes > maxBaselineDeltaBytes) {
    hardFailures.push(`baseline delta ${formatKiB(baselineDeltaBytes)} exceeds ${formatKiB(maxBaselineDeltaBytes)}`);
  }
  if (hardFailures.length > 0) {
    return { status: "fail", exitCode: 1, baselineDeltaBytes, hardFailures, warnings };
  }
  if (gzipBytes >= warnBytes) {
    warnings.push(`gzip ${formatKiB(gzipBytes)} is at or above warn budget ${formatKiB(warnBytes)}`);
  }
  return {
    status: warnings.length > 0 ? "warn" : "pass",
    exitCode: 0,
    baselineDeltaBytes,
    hardFailures,
    warnings,
  };
}

export function parseWranglerUploadSummary(output) {
  const match = output.match(/Total Upload:\s*([\d.]+)\s*KiB\s*\/\s*gzip:\s*([\d.]+)\s*KiB/i);
  if (!match) return null;
  return {
    rawKiB: Number.parseFloat(match[1]),
    gzipKiB: Number.parseFloat(match[2]),
  };
}

export function summarizeMetafileInputs(metafile, limit = 8) {
  return Object.entries(metafile?.inputs ?? {})
    .map(([inputPath, info]) => ({ path: inputPath, bytes: Number(info?.bytes ?? 0) }))
    .filter((item) => Number.isFinite(item.bytes))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, limit);
}

export function parseBaseline(jsonText) {
  const data = JSON.parse(jsonText);
  const rawBytes = Number(data.raw_bytes);
  const gzipBytes = Number(data.gzip_bytes);
  if (!Number.isFinite(rawBytes) || rawBytes < 0) {
    throw new Error("baseline raw_bytes must be a non-negative number");
  }
  if (!Number.isFinite(gzipBytes) || gzipBytes < 0) {
    throw new Error("baseline gzip_bytes must be a non-negative number");
  }
  return {
    updatedAt: String(data.updated_at ?? ""),
    rawBytes,
    gzipBytes,
    gzipKiB: Number(data.gzip_kib ?? gzipBytes / 1024),
  };
}

export function serializeBaseline(measurement, updatedAt = new Date().toISOString()) {
  return `${JSON.stringify({
    updated_at: updatedAt,
    raw_bytes: measurement.rawBytes,
    gzip_bytes: measurement.gzipBytes,
    gzip_kib: measurement.gzipBytes / 1024,
  }, null, 2)}${os.EOL}`;
}

export function missingBuildMessage(reason) {
  return [
    "[qa:worker-bundle-budget] OpenNext build output not found.",
    `reason: ${reason}`,
    `Run: ${BUILD_COMMAND}`,
  ].join(os.EOL);
}

export function missingBaselineMessage(reason) {
  return [
    "[qa:worker-bundle-budget] Worker bundle baseline not found.",
    `reason: ${reason}`,
    "Run: npm run qa:worker-bundle-budget -- --update-baseline",
  ].join(os.EOL);
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    throw new Error(`missing ${BASELINE_RELATIVE_PATH}`);
  }
  return parseBaseline(fs.readFileSync(BASELINE_PATH, "utf8"));
}

function writeBaseline(measurement) {
  const updatedAt = new Date().toISOString();
  fs.writeFileSync(BASELINE_PATH, serializeBaseline(measurement, updatedAt));
  return parseBaseline(fs.readFileSync(BASELINE_PATH, "utf8"));
}

function requireOpenNextBuild() {
  const requiredPaths = [
    ".open-next/worker.js",
    ".open-next/server-functions/default/handler.mjs",
    ".open-next/assets",
  ];
  const missing = requiredPaths.filter((relativePath) => !fs.existsSync(path.join(APP_ROOT, relativePath)));
  if (missing.length > 0) {
    throw new Error(`missing ${missing.join(", ")}`);
  }
}

function runWranglerDryRun() {
  fs.rmSync(WRANGLER_OUTDIR, { recursive: true, force: true });
  fs.mkdirSync(WRANGLER_OUTDIR, { recursive: true });

  const result = spawnSync(
    "npx",
    [
      "wrangler",
      "deploy",
      "--dry-run",
      "--outdir",
      path.relative(APP_ROOT, WRANGLER_OUTDIR),
      "--metafile",
      path.relative(APP_ROOT, WRANGLER_META_PATH),
    ],
    {
      cwd: APP_ROOT,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 32,
    },
  );

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    process.stdout.write(output);
    throw new Error(`wrangler dry-run failed with exit ${result.status}`);
  }
  return output;
}

function readBundleMeasurement() {
  if (!fs.existsSync(WRANGLER_BUNDLE_PATH)) {
    throw new Error(`wrangler dry-run did not emit ${path.relative(APP_ROOT, WRANGLER_BUNDLE_PATH)}`);
  }
  const bundle = fs.readFileSync(WRANGLER_BUNDLE_PATH);
  const gzipBytes = zlib.gzipSync(bundle).length;
  return {
    bundlePath: path.relative(APP_ROOT, WRANGLER_BUNDLE_PATH),
    rawBytes: bundle.length,
    gzipBytes,
  };
}

function readComposition() {
  if (!fs.existsSync(WRANGLER_META_PATH)) return [];
  const metafile = JSON.parse(fs.readFileSync(WRANGLER_META_PATH, "utf8"));
  return summarizeMetafileInputs(metafile);
}

function printReport({ measurement, baseline, baselineUpdated, wranglerSummary, composition, budget }) {
  const hardHeadroom = HARD_GZIP_BYTES - measurement.gzipBytes;
  const warnHeadroom = WARN_GZIP_BYTES - measurement.gzipBytes;
  const statusLabel = budget.status === "fail"
    ? "FAIL"
    : budget.status === "warn"
      ? "WARN"
      : "OK";

  console.log(`[qa:worker-bundle-budget] Worker bundle budget ${statusLabel}`);
  console.log(`- artifact: ${measurement.bundlePath}`);
  if (wranglerSummary) {
    console.log(`- wrangler total upload: ${wranglerSummary.rawKiB.toFixed(2)} KiB / gzip: ${wranglerSummary.gzipKiB.toFixed(2)} KiB`);
  }
  console.log(`- raw: ${formatKiB(measurement.rawBytes)} (${measurement.rawBytes} bytes)`);
  console.log(`- gzip: ${formatKiB(measurement.gzipBytes)} (${measurement.gzipBytes} bytes)`);
  console.log(`- warn budget: ${formatKiB(WARN_GZIP_BYTES)} gzip`);
  console.log(`- hard budget: ${formatKiB(HARD_GZIP_BYTES)} gzip`);
  console.log(`- headroom to warn: ${formatKiB(warnHeadroom)} (${warnHeadroom} bytes)`);
  console.log(`- headroom to hard: ${formatKiB(hardHeadroom)} (${hardHeadroom} bytes)`);
  if (baseline) {
    console.log(`- baseline: ${BASELINE_RELATIVE_PATH} gzip=${formatKiB(baseline.gzipBytes)} (${baseline.gzipBytes} bytes) updated_at=${baseline.updatedAt}`);
    console.log(`- baseline delta: ${formatKiB(budget.baselineDeltaBytes)} (${budget.baselineDeltaBytes} bytes)`);
    console.log(`- baseline delta hard budget: ${formatKiB(BASELINE_DELTA_BYTES)} gzip`);
  }
  if (baselineUpdated) {
    console.log(`- baseline updated: ${BASELINE_RELATIVE_PATH}`);
  }
  for (const warning of budget.warnings) {
    console.log(`- WARN: ${warning}`);
  }
  for (const failure of budget.hardFailures) {
    console.log(`- FAIL: ${failure}`);
  }
  console.log("- top composition:");
  for (const item of composition) {
    console.log(`  - ${formatKiB(item.bytes)} ${item.path}`);
  }
}

export function main() {
  const updateBaseline = process.argv.slice(2).includes("--update-baseline");
  let baseline = null;

  try {
    requireOpenNextBuild();
  } catch (error) {
    console.error(missingBuildMessage(error instanceof Error ? error.message : String(error)));
    return 1;
  }

  if (!updateBaseline) {
    try {
      baseline = readBaseline();
    } catch (error) {
      console.error(missingBaselineMessage(error instanceof Error ? error.message : String(error)));
      return 1;
    }
  }

  const wranglerOutput = runWranglerDryRun();
  const wranglerSummary = parseWranglerUploadSummary(wranglerOutput);
  const measurement = readBundleMeasurement();
  const composition = readComposition();

  if (updateBaseline) {
    if (measurement.gzipBytes > HARD_GZIP_BYTES) {
      const budget = evaluateBudget(measurement.gzipBytes, {
        baselineGzipBytes: baseline?.gzipBytes,
      });
      printReport({ measurement, baseline, baselineUpdated: false, wranglerSummary, composition, budget });
      console.error(`[qa:worker-bundle-budget] baseline not updated because gzip exceeds hard budget ${formatKiB(HARD_GZIP_BYTES)}`);
      return 1;
    }
    baseline = writeBaseline(measurement);
  }

  const budget = evaluateBudget(measurement.gzipBytes, {
    baselineGzipBytes: baseline.gzipBytes,
  });
  printReport({ measurement, baseline, baselineUpdated: updateBaseline, wranglerSummary, composition, budget });
  return budget.exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  process.exitCode = main();
}
