#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LANE_REGISTRY,
  registryDigest,
  validateLaneRegistry,
} from "./lib/lane-registry.mjs";
import {
  COMMIT_MANIFEST_SCHEMA,
  buildLaneCommitManifest,
  emitLaneCommitManifest,
  validateLaneCommitManifest,
} from "./build-lane-commit-manifest.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = path.join(REPO_ROOT, "data", "admin", "lane-commit-manifest.json");

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
assert.equal(manifest.schema_version, COMMIT_MANIFEST_SCHEMA);
assert.equal(manifest.registry_schema, LANE_REGISTRY.schema_version);
assert.equal(manifest.registry_digest, registryDigest());
assert.equal(validateLaneCommitManifest(manifest, { registry: LANE_REGISTRY }), true);

const defillama = manifest.workflows[".github/workflows/fetch-defillama.yml"];
assert.deepEqual(defillama.lanes, ["defillama_stablecoins"]);
assert.deepEqual(defillama.stages.always_if_exists.map((entry) => entry.path), [
  "data/admin/data-supply-state/detection-attempts/defillama_stablecoins.json",
  "data/admin/defillama_stablecoins/index.json",
  "data/admin/defillama_stablecoins/lkg/stablecoins.json",
]);
assert.deepEqual(defillama.stages.success_if_exists.map((entry) => entry.path), [
  "data/macro/stablecoins.json",
  "100xfenok-next/public/data/macro/stablecoins.json",
]);
assert.deepEqual(defillama.stages.success_if_exists.map((entry) => entry.required), [true, true]);
assert.deepEqual(defillama.exclude, []);

const yahooTicker = manifest.workflows[".github/workflows/fetch-yahoo-ticker.yml"];
assert.deepEqual(yahooTicker.lanes, ["yahoo_ticker_macro"]);
assert.deepEqual(yahooTicker.stages.always_if_exists, [
  {
    kind: "file",
    path: "data/admin/data-supply-state/detection-attempts/yahoo_ticker_macro.json",
    required: false,
  },
  {
    kind: "directory",
    path: "data/admin/yahoo-hourly-ticker",
    required: false,
  },
]);
assert.deepEqual(yahooTicker.stages.success_if_exists.map((entry) => entry.path), [
  "data/macro/yahoo-ticker.json",
  "100xfenok-next/public/data/macro/yahoo-ticker.json",
]);
assert.deepEqual(yahooTicker.exclude, []);

const treasuryTga = manifest.workflows[".github/workflows/fetch-treasury-tga.yml"];
assert.deepEqual(treasuryTga.lanes, ["treasury_tga"]);
assert.deepEqual(treasuryTga.stages.always_if_exists.map((entry) => entry.path), [
  "data/admin/data-supply-state/detection-attempts/treasury_tga.json",
  "data/admin/treasury_tga/index.json",
  "data/admin/treasury_tga/lkg/tga.json",
]);
assert.deepEqual(treasuryTga.stages.success_if_exists.map((entry) => entry.path), [
  "data/macro/tga.json",
  "100xfenok-next/public/data/macro/tga.json",
]);
assert.deepEqual(treasuryTga.exclude, []);

const fredMacro = manifest.workflows[".github/workflows/fetch-fred-macro.yml"];
assert.deepEqual(fredMacro.lanes, ["fred_macro"]);
assert.deepEqual(fredMacro.stages.always_if_exists.map((entry) => entry.path), [
  "data/admin/data-supply-state/detection-attempts/fred_macro.json",
  "data/admin/fred_macro/index.json",
  "data/admin/fred_macro/lkg/fred_macro.json",
]);
assert.deepEqual(fredMacro.stages.success_if_exists.map((entry) => entry.path), [
  "data/macro/fred-macro.json",
  "100xfenok-next/public/data/macro/fred-macro.json",
]);
assert.deepEqual(fredMacro.exclude, []);

const fredBanking = manifest.workflows[".github/workflows/fetch-fred-banking.yml"];
assert.deepEqual(fredBanking.lanes, ["fred_banking"]);
assert.deepEqual(fredBanking.stages.always_if_exists.map((entry) => entry.path), [
  "data/admin/data-supply-state/detection-attempts/fred_banking.json",
  "data/admin/fred_banking/index.json",
  "data/admin/fred_banking/lkg/daily.json",
  "data/admin/fred_banking/lkg/weekly.json",
  "data/admin/fred_banking/lkg/monthly.json",
  "data/admin/fred_banking/lkg/quarterly.json",
]);
assert.deepEqual(fredBanking.stages.success_if_exists.map((entry) => entry.path), [
  "data/macro/fred-banking-daily.json",
  "data/macro/fred-banking-weekly.json",
  "data/macro/fred-banking-monthly.json",
  "data/macro/fred-banking-quarterly.json",
  "100xfenok-next/public/data/macro/fred-banking-daily.json",
  "100xfenok-next/public/data/macro/fred-banking-weekly.json",
  "100xfenok-next/public/data/macro/fred-banking-monthly.json",
  "100xfenok-next/public/data/macro/fred-banking-quarterly.json",
]);
assert.deepEqual(fredBanking.exclude, []);

const nasdaqGiwSox = manifest.workflows[".github/workflows/fetch-nasdaq-giw-sox.yml"];
assert.deepEqual(nasdaqGiwSox.lanes, ["nasdaq_giw_sox"]);
assert.deepEqual(nasdaqGiwSox.stages.always_if_exists.map((entry) => entry.path), [
  "data/admin/data-supply-state/detection-attempts/nasdaq_giw_sox.json",
  "data/admin/nasdaq_giw_sox/index.json",
  "data/admin/nasdaq_giw_sox/lkg/constituents.json",
  "data/admin/nasdaq_giw_sox/history/constituents.json",
]);
assert.deepEqual(nasdaqGiwSox.stages.success_if_exists.map((entry) => entry.path), [
  "data/indices/nasdaq-giw-sox-constituents.json",
]);
assert.deepEqual(nasdaqGiwSox.exclude, []);

const privateOptions = manifest.workflows[".github/workflows/fetch-fenok-private-options.yml"];
assert.deepEqual(privateOptions.lanes, ["yahoo_private_options"]);
assert.deepEqual(privateOptions.stages.always_if_exists, [
  {
    kind: "file",
    path: "data/admin/data-supply-state/detection-attempts/yahoo_private_options.json",
    required: false,
  },
  {
    kind: "directory",
    path: "data/admin/yahoo_private_options",
    required: false,
  },
]);
assert.deepEqual(privateOptions.stages.success_if_exists.map((entry) => entry.path), [
  "data/computed/fenok_yahoo_private_options_availability.json",
  "100xfenok-next/public/data/computed/fenok_yahoo_private_options_availability.json",
]);
assert.deepEqual(privateOptions.exclude, []);

const sentiment = manifest.workflows[".github/workflows/fetch-sentiment.yml"];
assert.deepEqual(sentiment.lanes, ["sentiment"]);
assert.deepEqual(sentiment.stages.always_if_exists, [
  {
    kind: "file",
    path: "data/admin/data-supply-state/detection-attempts/sentiment.json",
    required: false,
  },
  {
    kind: "file",
    path: "data/admin/sentiment/index.json",
    required: false,
  },
  { kind: "glob", path: "data/admin/sentiment/current/*.json", required: false },
  { kind: "glob", path: "data/admin/sentiment/lkg/*.json", required: false },
]);
assert.deepEqual(sentiment.stages.success_if_exists, [
  { kind: "glob", path: "data/sentiment/*.json", required: false },
  { kind: "glob", path: "100xfenok-next/public/data/sentiment/*.json", required: false },
]);
assert.deepEqual(sentiment.exclude, []);

const fenokEdgeDaily = manifest.workflows[".github/workflows/fenok-edge-daily.yml"];
assert.deepEqual(fenokEdgeDaily.lanes, ["finra_short_volume", "occ_options_volume"]);
assert.deepEqual(fenokEdgeDaily.stages.always_if_exists, [
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/finra_short_volume.json", required: false },
  { kind: "file", path: "data/admin/finra_short_volume/index.json", required: false },
  { kind: "file", path: "data/admin/finra_short_volume/current/regsho_daily.json", required: false },
  { kind: "file", path: "data/admin/finra_short_volume/lkg/regsho_daily.json", required: false },
  { kind: "file", path: "data/admin/finra_short_volume/history/regsho_daily.json", required: false },
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/occ_options_volume.json", required: false },
  { kind: "file", path: "data/admin/occ_options_volume/index.json", required: false },
  { kind: "file", path: "data/admin/occ_options_volume/current/occ_options_volume.json", required: false },
  { kind: "file", path: "data/admin/occ_options_volume/lkg/occ_options_volume.json", required: false },
]);
assert.deepEqual(fenokEdgeDaily.stages.success_if_exists, []);
assert.deepEqual(fenokEdgeDaily.stages.success_verify_not_plan_if_exists, [
  { kind: "glob", path: "data/computed/fenok_flow_proxies*.json", required: false },
  { kind: "file", path: "data/computed/fenok_occ_options_availability.json", required: false },
  { kind: "glob", path: "data/computed/fenok_occ_options_volume*.json", required: false },
  { kind: "glob", path: "data/computed/fenok_signal_lens_proxies*.json", required: false },
]);
assert.deepEqual(fenokEdgeDaily.exclude, []);

const yfFinance = manifest.workflows[".github/workflows/fetch-yf-finance.yml"];
assert.deepEqual(yfFinance.lanes, ["yahoo_batch_quote_history"]);
assert.deepEqual(yfFinance.stages.always_if_exists, [
  { kind: "directory", path: "data/yf/finance", required: true },
  { kind: "file", path: "data/yf/quarter_closes.json", required: true },
  { kind: "directory", path: "data/admin/yahoo-batch-quote-history", required: true },
  { kind: "file", path: "100xfenok-next/public/data/yf/quarter_closes.json", required: true },
]);
assert.deepEqual(yfFinance.stages.success_if_exists, []);
assert.deepEqual(yfFinance.exclude, [
  { kind: "file", path: "data/yf/finance/_summary.json", required: false },
]);

const stockanalysis = manifest.workflows[".github/workflows/fetch-stockanalysis.yml"];
assert.deepEqual(stockanalysis.lanes, [
  "yahoo_etf_fallback",
  "stockanalysis_etf_universe",
  "stockanalysis_stock_financial",
  "stockanalysis_surfaces",
]);
assert.deepEqual(stockanalysis.stages.always_if_exists, [
  { kind: "directory", path: "data/stockanalysis", required: true },
  { kind: "directory", path: "data/yf/etf-details", required: true },
  { kind: "directory", path: "data/admin/data-supply-state/v1", required: true },
  { kind: "directory", path: "data/admin/stockanalysis-recovery", required: true },
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/yahoo_etf_fallback.json", required: false },
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/stockanalysis_etf_universe.json", required: false },
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/stockanalysis_stock_financial.json", required: false },
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/stockanalysis_surfaces.json", required: false },
  { kind: "dynamic_set", path: "data/yf/finance", required: false },
]);
assert.deepEqual(stockanalysis.stages.success_if_exists, []);
assert.deepEqual(stockanalysis.exclude, [
  { kind: "file", path: "data/stockanalysis/backfill/history_gap_report_latest.json", required: false },
  { kind: "file", path: "data/yf/finance/_summary.json", required: false },
]);

const fredYardeni = manifest.workflows[".github/workflows/fetch-fred-yardeni.yml"];
assert.deepEqual(fredYardeni.lanes, ["fred_yardeni"]);
assert.deepEqual(fredYardeni.stages.always_if_exists, [
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/fred_yardeni.json", required: false },
  { kind: "file", path: "data/admin/fred_yardeni/index.json", required: false },
  { kind: "file", path: "data/admin/fred_yardeni/current/yardney_model.json", required: false },
  { kind: "file", path: "data/admin/fred_yardeni/lkg/yardney_model.json", required: false },
]);
assert.deepEqual(fredYardeni.stages.success_if_exists, [
  { kind: "file", path: "data/yardney/yardney_model.json", required: false },
  { kind: "file", path: "100xfenok-next/public/data/yardney/yardney_model.json", required: false },
]);
assert.deepEqual(fredYardeni.exclude, []);

const edgarFilings = manifest.workflows[".github/workflows/fetch-edgar-filings.yml"];
assert.deepEqual(edgarFilings.lanes, ["edgar_filings"]);
assert.deepEqual(edgarFilings.stages.always_if_exists, [
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/edgar_filings.json", required: false },
  { kind: "file", path: "data/admin/edgar_filings/index.json", required: false },
  { kind: "file", path: "data/admin/edgar_filings/current/edgar_filings.json", required: false },
  { kind: "file", path: "data/admin/edgar_filings/lkg/edgar_filings.json", required: false },
]);
assert.deepEqual(edgarFilings.stages.success_if_exists, [
  { kind: "directory", path: "data/edgar", required: false },
  { kind: "directory", path: "data/edgar-korean-summaries", required: false },
  { kind: "directory", path: "100xfenok-next/public/data/edgar-korean-summaries", required: false },
]);
assert.deepEqual(edgarFilings.stages.success_verify_not_plan_if_exists, []);
assert.deepEqual(edgarFilings.exclude, []);

const fdicTier1 = manifest.workflows[".github/workflows/fetch-fdic.yml"];
assert.deepEqual(fdicTier1.lanes, ["fdic_tier1"]);
assert.deepEqual(fdicTier1.stages.always_if_exists, [
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/fdic_tier1.json", required: false },
  { kind: "file", path: "data/admin/fdic_tier1/index.json", required: false },
  { kind: "file", path: "data/admin/fdic_tier1/lkg/fdic_tier1.json", required: false },
]);
assert.deepEqual(fdicTier1.stages.success_if_exists, [
  { kind: "file", path: "data/macro/fdic-tier1.json", required: false },
  { kind: "file", path: "100xfenok-next/public/data/macro/fdic-tier1.json", required: false },
]);
assert.deepEqual(fdicTier1.exclude, []);

const slickchartsDaily = manifest.workflows[".github/workflows/slickcharts-daily.yml"];
assert.deepEqual(slickchartsDaily.lanes, ["slickcharts"]);
assert.deepEqual(slickchartsDaily.stages.always_if_exists, [
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/slickcharts.json", required: false },
  { kind: "directory", path: "data/admin/slickcharts-daily-delivery", required: false },
]);
assert.deepEqual(slickchartsDaily.stages.success_if_exists, [
  { kind: "file", path: "data/slickcharts/gainers.json", required: false },
  { kind: "file", path: "data/slickcharts/losers.json", required: false },
  { kind: "file", path: "data/slickcharts/treasury.json", required: false },
  { kind: "file", path: "data/slickcharts/currency.json", required: false },
  { kind: "file", path: "data/slickcharts/mortgage.json", required: false },
]);
assert.deepEqual(slickchartsDaily.exclude, []);

const slickchartsWeekly = manifest.workflows[".github/workflows/slickcharts-weekly.yml"];
assert.deepEqual(slickchartsWeekly.lanes, ["slickcharts"]);
assert.deepEqual(slickchartsWeekly.stages.always_if_exists, [
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/slickcharts.json", required: false },
  { kind: "file", path: "data/slickcharts/sp500.json", required: true },
  { kind: "file", path: "data/slickcharts/magnificent7.json", required: true },
  { kind: "file", path: "data/slickcharts/etf.json", required: true },
  { kind: "file", path: "data/slickcharts/berkshire.json", required: true },
]);
assert.deepEqual(slickchartsWeekly.stages.success_if_exists, []);
assert.deepEqual(slickchartsWeekly.exclude, []);

const slickchartsSymbols = manifest.workflows[".github/workflows/slickcharts-symbols.yml"];
assert.deepEqual(slickchartsSymbols.lanes, ["slickcharts"]);
assert.deepEqual(slickchartsSymbols.stages.always_if_exists, [
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/slickcharts.json", required: false },
  { kind: "file", path: "data/slickcharts/symbols.json", required: true },
]);
assert.deepEqual(slickchartsSymbols.stages.success_if_exists, []);
assert.deepEqual(slickchartsSymbols.exclude, []);
const slickchartsMonthly = manifest.workflows[".github/workflows/slickcharts-monthly.yml"];
assert.deepEqual(slickchartsMonthly.lanes, ["slickcharts"]);
assert.deepEqual(slickchartsMonthly.stages.always_if_exists, [
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/slickcharts.json", required: false },
  { kind: "file", path: "data/slickcharts/sp500-returns.json", required: true },
  { kind: "file", path: "data/slickcharts/sp500-returns-details.json", required: true },
  { kind: "file", path: "data/slickcharts/nasdaq100-returns.json", required: true },
  { kind: "file", path: "data/slickcharts/dowjones-returns.json", required: true },
  { kind: "file", path: "data/slickcharts/sp500-drawdown.json", required: true },
  { kind: "file", path: "data/slickcharts/btc-returns.json", required: true },
  { kind: "file", path: "data/slickcharts/eth-returns.json", required: true },
  { kind: "file", path: "data/slickcharts/sp500-performance.json", required: true },
  { kind: "file", path: "data/slickcharts/nasdaq100-performance.json", required: true },
  { kind: "file", path: "data/slickcharts/dowjones-performance.json", required: true },
  { kind: "file", path: "data/slickcharts/sp500-yield.json", required: true },
  { kind: "file", path: "data/slickcharts/nasdaq100-yield.json", required: true },
  { kind: "file", path: "data/slickcharts/dowjones-yield.json", required: true },
  { kind: "file", path: "data/slickcharts/sp500-analysis.json", required: true },
  { kind: "file", path: "data/slickcharts/nasdaq100-analysis.json", required: true },
  { kind: "file", path: "data/slickcharts/dowjones-analysis.json", required: true },
  { kind: "file", path: "data/slickcharts/sp500-marketcap.json", required: true },
  { kind: "file", path: "data/slickcharts/nasdaq100-ratio.json", required: true },
  { kind: "file", path: "data/slickcharts/nasdaq100.json", required: true },
  { kind: "file", path: "data/slickcharts/dowjones.json", required: true },
  { kind: "file", path: "data/slickcharts/inflation.json", required: true },
  { kind: "file", path: "data/slickcharts/1929crash.json", required: false },
]);
assert.deepEqual(slickchartsMonthly.stages.success_if_exists, []);
assert.deepEqual(slickchartsMonthly.exclude, []);

const slickchartsHistory = manifest.workflows[".github/workflows/slickcharts-history.yml"];
assert.deepEqual(slickchartsHistory.lanes, ["slickcharts"]);
assert.deepEqual(slickchartsHistory.stages.always_if_exists, [
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/slickcharts.json", required: false },
  { kind: "file", path: "data/slickcharts/stocks-returns.json", required: true },
  { kind: "file", path: "data/slickcharts/stocks-dividends.json", required: true },
  { kind: "file", path: "data/slickcharts/stocks-dividends-recent.json", required: true },
  { kind: "file", path: "data/slickcharts/stocks-dividends-historical.json", required: true },
  { kind: "directory", path: "data/slickcharts/stocks", required: true },
]);
assert.deepEqual(slickchartsHistory.stages.success_if_exists, []);
assert.deepEqual(slickchartsHistory.exclude, []);

const buildStocksAnalyzer = manifest.workflows[".github/workflows/build-stocks-analyzer.yml"];
assert.deepEqual(buildStocksAnalyzer.lanes, []);
assert.deepEqual(buildStocksAnalyzer.stages.always_if_exists.map(({ kind, path: entryPath }) => `${kind}:${entryPath}`), [
  "file:data/global-scouter/core/stocks_analyzer.json",
  "file:data/global-scouter/core/per_bands_index.json",
  "file:data/global-scouter/core/slick_index.json",
  "file:data/sec-13f/by_ticker.json",
  "file:data/sec-13f/by_sector.json",
  "file:data/sec-13f/summary.json",
  "glob:data/sec-13f/investors/*.json",
  "file:data/sec-13f/analytics/consensus.json",
  "file:data/sec-13f/analytics/ticker_aliases.json",
  "file:data/sec-13f/analytics/trades_ranking.json",
  "file:data/sec-13f/analytics/portfolio_views.json",
  "file:data/sec-13f/analytics/guru_holders_index.json",
  "file:data/global-scouter/core/revision_movers.json",
  "file:data/damodaran/industry_benchmarks.json",
  "file:data/calendar/prev-values.json",
  "file:100xfenok-next/public/data/calendar/prev-values.json",
  "file:100xfenok-next/public/data/global-scouter/core/revision_movers.json",
  "file:100xfenok-next/public/data/damodaran/industry_benchmarks.json",
  "file:100xfenok-next/public/data/global-scouter/core/stocks_analyzer.json",
  "file:100xfenok-next/public/data/global-scouter/core/per_bands_index.json",
  "file:100xfenok-next/public/data/global-scouter/core/slick_index.json",
  "file:100xfenok-next/public/data/global-scouter/README.md",
  "file:100xfenok-next/public/data/global-scouter/schema.json",
  "file:100xfenok-next/public/data/sec-13f/by_ticker.json",
  "file:100xfenok-next/public/data/sec-13f/by_sector.json",
  "file:100xfenok-next/public/data/sec-13f/summary.json",
  "file:100xfenok-next/public/data/sec-13f/analytics/consensus.json",
  "file:100xfenok-next/public/data/sec-13f/analytics/ticker_aliases.json",
  "file:100xfenok-next/public/data/sec-13f/analytics/trades_ranking.json",
  "file:100xfenok-next/public/data/sec-13f/analytics/portfolio_views.json",
  "file:100xfenok-next/public/data/sec-13f/analytics/guru_holders_index.json",
  "glob:100xfenok-next/public/data/sec-13f/investors/*.json",
]);
assert.ok(buildStocksAnalyzer.stages.always_if_exists.every((entry) => entry.required === false));
assert.deepEqual(buildStocksAnalyzer.stages.success_if_exists, []);
assert.deepEqual(buildStocksAnalyzer.exclude, [
  { kind: "file", path: "100xfenok-next/public/data/sec-13f/investors/griffin.json", required: false },
]);

const pipelineFailureAlarm = manifest.workflows[".github/workflows/pipeline-failure-alarm.yml"];
assert.deepEqual(pipelineFailureAlarm.lanes, []);
assert.deepEqual(pipelineFailureAlarm.stages.always_if_exists, [
  { kind: "file", path: "data/admin/alarm-state.json", required: false },
  { kind: "file", path: "100xfenok-next/public/data/admin/alarm-state.json", required: false },
]);
assert.deepEqual(pipelineFailureAlarm.stages.success_if_exists, []);
assert.deepEqual(pipelineFailureAlarm.exclude, []);

// Missing, stale, unsafe, duplicate, and undeclared workflow entries fail closed.
for (const [label, mutate] of [
  ["missing workflow", (draft) => { delete draft.workflows[".github/workflows/fetch-defillama.yml"]; }],
  ["stale digest", (draft) => { draft.registry_digest = "0".repeat(64); }],
  ["unsafe path", (draft) => { draft.workflows[".github/workflows/fetch-defillama.yml"].stages.always_if_exists[0].path = "../escape"; }],
  ["duplicate path", (draft) => {
    const stage = draft.workflows[".github/workflows/fetch-defillama.yml"].stages.always_if_exists;
    stage.push(structuredClone(stage[0]));
  }],
  ["wrong type", (draft) => { draft.workflows[".github/workflows/fetch-defillama.yml"].stages.success_if_exists[0].path = 42; }],
  ["empty stages", (draft) => {
    for (const stage of Object.keys(draft.workflows[".github/workflows/fetch-defillama.yml"].stages)) {
      draft.workflows[".github/workflows/fetch-defillama.yml"].stages[stage] = [];
    }
  }],
  ["undeclared workflow", (draft) => {
    draft.workflows[".github/workflows/not-declared.yml"] = structuredClone(
      draft.workflows[".github/workflows/fetch-defillama.yml"],
    );
  }],
]) {
  const draft = structuredClone(manifest);
  mutate(draft);
  assert.throws(
    () => validateLaneCommitManifest(draft, { registry: LANE_REGISTRY }),
    /lane-commit-manifest/,
    `validation must reject ${label}`,
  );
}

// The emitter is deterministic and --check style validation catches a stale artifact.
const rebuilt = buildLaneCommitManifest(LANE_REGISTRY);
assert.deepEqual(rebuilt, manifest, "committed manifest must be a deterministic registry projection");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lane-commit-manifest-"));
const tempPath = path.join(tempRoot, "manifest.json");
emitLaneCommitManifest({ registry: LANE_REGISTRY, outputPath: tempPath });
assert.deepEqual(JSON.parse(fs.readFileSync(tempPath, "utf8")), manifest);

// A value-changing registry edit must change the projection and digest.
const changedRegistry = structuredClone(LANE_REGISTRY);
changedRegistry.lanes[0].label = `${changedRegistry.lanes[0].label} changed`;
validateLaneRegistry(changedRegistry);
const changed = buildLaneCommitManifest(changedRegistry);
assert.notEqual(changed.registry_digest, manifest.registry_digest);
assert.notDeepEqual(changed, manifest);

console.log("test-lane-commit-manifest: ok");
