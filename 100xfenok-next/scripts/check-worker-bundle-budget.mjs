#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

export const BUILD_COMMAND = "npm run cf:build";
// https://developers.cloudflare.com/workers/platform/limits/#worker-size
// Current platform limit: uncompressed upload, with no gzip limit.
export const WORKER_SIZE_LIMIT_BYTES = 64 * 1024 * 1024;

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const APP_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const WRANGLER_OUTDIR = path.join(APP_ROOT, ".wrangler", "worker-bundle-budget");
const WRANGLER_META_PATH = path.join(WRANGLER_OUTDIR, "bundle-meta.json");
const WRANGLER_BUNDLE_PATH = path.join(WRANGLER_OUTDIR, "worker.js");

export function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB`;
}

export function evaluateBudget(rawBytes) {
  const hardFailures = [];
  if (!Number.isFinite(rawBytes) || rawBytes < 0) {
    hardFailures.push("uncompressed upload size is unavailable");
  } else if (rawBytes > WORKER_SIZE_LIMIT_BYTES) {
    hardFailures.push(`uncompressed upload ${formatKiB(rawBytes)} exceeds Cloudflare's 64 MiB limit`);
  }
  return { status: hardFailures.length ? "fail" : "pass", exitCode: hardFailures.length ? 1 : 0, hardFailures };
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

export function missingBuildMessage(reason) {
  return [
    "[qa:worker-bundle-budget] OpenNext build output not found.",
    `reason: ${reason}`,
    `Run: ${BUILD_COMMAND}`,
  ].join(os.EOL);
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

function printReport({ measurement, wranglerSummary, composition, budget }) {
  console.log(`[qa:worker-bundle-budget] Worker upload ${budget.status === "fail" ? "FAIL" : "OK"}`);
  console.log(`- artifact: ${measurement.bundlePath}`);
  if (wranglerSummary) {
    console.log(`- uncompressed total upload: ${wranglerSummary.rawKiB.toFixed(2)} KiB (platform limit 64 MiB)`);
    console.log(`- gzip: ${wranglerSummary.gzipKiB.toFixed(2)} KiB (informational)`);
  }
  for (const failure of budget.hardFailures) console.log(`- FAIL: ${failure}`);
  console.log("- top composition:");
  for (const item of composition) console.log(`  - ${formatKiB(item.bytes)} ${item.path}`);
}

export function main() {
  try {
    requireOpenNextBuild();
  } catch (error) {
    console.error(missingBuildMessage(error instanceof Error ? error.message : String(error)));
    return 1;
  }

  const wranglerOutput = runWranglerDryRun();
  const wranglerSummary = parseWranglerUploadSummary(wranglerOutput);
  const measurement = readBundleMeasurement();
  const composition = readComposition();

  const budget = evaluateBudget(wranglerSummary ? Math.ceil(wranglerSummary.rawKiB * 1024) : NaN);
  printReport({ measurement, wranglerSummary, composition, budget });
  return budget.exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  process.exitCode = main();
}
