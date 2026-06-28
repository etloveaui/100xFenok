#!/usr/bin/env node
/**
 * Update Fenok Signal Lens proxy data in the intended order.
 *
 * Default posture:
 * - full-universe FINRA flow proxy
 * - targeted OCC listed-options volume skew proxy for the reference tickers
 * - targeted GDELT headline sample with a conservative rate-limit sleep
 * - full-universe Signal Lens consolidation
 *
 * Raw OCC/news/FINRA caches remain under _private/admin. This script does not
 * write public mirrors.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = {
    dryRun: false,
    tickers: "",
    referenceOnly: false,
    skipFlow: false,
    skipOptions: false,
    skipNews: false,
    skipLens: false,
    noFetch: false,
    flowMaxWalkbackDays: "14",
    optionsMaxWalkbackDays: "7",
    optionsSleepMs: "250",
    newsMaxRecords: "25",
    newsSleepMs: "5500",
    newsRetries: "2",
    newsRetryBackoffMs: "6500",
    lensReferenceOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--tickers") args.tickers = next();
    else if (arg === "--reference-only") args.referenceOnly = true;
    else if (arg === "--skip-flow") args.skipFlow = true;
    else if (arg === "--skip-options") args.skipOptions = true;
    else if (arg === "--skip-news") args.skipNews = true;
    else if (arg === "--skip-lens") args.skipLens = true;
    else if (arg === "--no-fetch") args.noFetch = true;
    else if (arg === "--flow-max-walkback-days") args.flowMaxWalkbackDays = next();
    else if (arg === "--options-max-walkback-days") args.optionsMaxWalkbackDays = next();
    else if (arg === "--options-sleep-ms") args.optionsSleepMs = next();
    else if (arg === "--news-max-records") args.newsMaxRecords = next();
    else if (arg === "--news-sleep-ms") args.newsSleepMs = next();
    else if (arg === "--news-retries") args.newsRetries = next();
    else if (arg === "--news-retry-backoff-ms") args.newsRetryBackoffMs = next();
    else if (arg === "--lens-reference-only") args.lensReferenceOnly = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function tickerArgs(args) {
  if (args.tickers) return ["--tickers", args.tickers];
  return ["--reference-only"];
}

function runStep({ label, command, args, dryRun }) {
  const rendered = [command, ...args].join(" ");
  console.log(`\n[fenok-signal-lens] ${label}`);
  console.log(`$ ${rendered}`);
  if (dryRun) return;
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
}

function buildPlan(args) {
  const plan = [];
  if (!args.skipFlow) {
    const flowArgs = [
      "scripts/build-fenok-flow-proxies.mjs",
      "--max-walkback-days",
      args.flowMaxWalkbackDays,
    ];
    if (args.tickers) flowArgs.push("--tickers", args.tickers);
    if (args.referenceOnly) flowArgs.push("--reference-only");
    if (args.noFetch) flowArgs.push("--no-fetch");
    plan.push({ label: "FINRA daily flow proxies", command: process.execPath, args: flowArgs });
  }

  if (!args.skipOptions) {
    const optionArgs = [
      "scripts/fetch-fenok-occ-options-volume.mjs",
      ...tickerArgs(args),
      "--max-walkback-days",
      args.optionsMaxWalkbackDays,
      "--sleep-ms",
      args.optionsSleepMs,
    ];
    if (args.noFetch) optionArgs.push("--no-fetch");
    plan.push({ label: "OCC listed-options volume skew proxy", command: process.execPath, args: optionArgs });
  }

  if (!args.skipNews) {
    const newsArgs = [
      "scripts/fetch-fenok-news-tone-proxy.mjs",
      ...tickerArgs(args),
      "--max-records",
      args.newsMaxRecords,
      "--sleep-ms",
      args.newsSleepMs,
      "--retries",
      args.newsRetries,
      "--retry-backoff-ms",
      args.newsRetryBackoffMs,
    ];
    if (args.noFetch) newsArgs.push("--no-fetch");
    plan.push({ label: "GDELT headline tone proxy", command: process.execPath, args: newsArgs });
  }

  if (!args.skipLens) {
    const lensArgs = ["scripts/build-fenok-signal-lens-proxies.mjs"];
    if (args.tickers) lensArgs.push("--tickers", args.tickers);
    else if (args.lensReferenceOnly) lensArgs.push("--reference-only");
    plan.push({ label: "all-axis Signal Lens consolidation", command: process.execPath, args: lensArgs });
  }
  return plan;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = buildPlan(args);
  if (plan.length === 0) {
    console.log("[fenok-signal-lens] nothing to do");
    return;
  }
  for (const step of plan) runStep({ ...step, dryRun: args.dryRun });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err.stack || err.message);
    process.exit(1);
  }
}

export {
  buildPlan,
  parseArgs,
};
