#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LANE_REGISTRY,
  PLANE_PUBLISH_OUTCOME_BINDINGS,
  registryDigest,
  validateLaneRegistry,
} from "./lib/lane-registry.mjs";
import {
  CENTRAL_COMMIT_PATHS,
  COMMIT_MANIFEST_SCHEMA,
  UPDATE_MANIFEST_MATERIALIZATIONS,
  buildLaneCommitManifest,
  centralCommitPathKind,
  deriveCentralCommitPaths,
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

for (const [family, binding] of Object.entries(PLANE_PUBLISH_OUTCOME_BINDINGS)) {
  const workflow = manifest.workflows[binding.workflow];
  assert.ok(workflow, `${family} publish outcome owner workflow must be declared`);
  assert.ok(
    workflow.stages.always_if_exists.some(
      (entry) => entry.path === `data/admin/data-supply-state/publish-outcomes/${family}.json`,
    ),
    `${family} publish outcome shard must be staged by ${binding.workflow}`,
  );
}

const defillama = manifest.workflows[".github/workflows/fetch-defillama.yml"];
assert.deepEqual(defillama.lanes, ["defillama_stablecoins"]);
assert.deepEqual(defillama.stages.always_if_exists.map((entry) => entry.path), [
  "data/admin/data-supply-state/detection-attempts/defillama_stablecoins.json",
  "data/admin/data-supply-state/publish-outcomes/defillama-stablecoins.json",
  "data/admin/defillama_stablecoins/index.json",
  "data/admin/defillama_stablecoins/lkg/stablecoins.json",
]);
assert.deepEqual(defillama.stages.success_if_exists.map((entry) => entry.path), [
  "data/macro/stablecoins.json",
]);
assert.deepEqual(defillama.stages.success_if_exists.map((entry) => entry.required), [true]);
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
    kind: "file",
    path: "data/admin/data-supply-state/publish-outcomes/yahoo-ticker-macro.json",
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
]);
assert.deepEqual(yahooTicker.exclude, []);

const treasuryTga = manifest.workflows[".github/workflows/fetch-treasury-tga.yml"];
assert.deepEqual(treasuryTga.lanes, ["treasury_tga"]);
assert.deepEqual(treasuryTga.stages.always_if_exists.map((entry) => entry.path), [
  "data/admin/data-supply-state/detection-attempts/treasury_tga.json",
  "data/admin/data-supply-state/publish-outcomes/treasury-tga.json",
  "data/admin/treasury_tga/index.json",
  "data/admin/treasury_tga/lkg/tga.json",
]);
assert.deepEqual(treasuryTga.stages.success_if_exists.map((entry) => entry.path), [
  "data/macro/tga.json",
]);
assert.deepEqual(treasuryTga.exclude, []);

const fredMacro = manifest.workflows[".github/workflows/fetch-fred-macro.yml"];
assert.deepEqual(fredMacro.lanes, ["fred_macro"]);
assert.deepEqual(fredMacro.stages.always_if_exists.map((entry) => entry.path), [
  "data/admin/data-supply-state/detection-attempts/fred_macro.json",
  "data/admin/data-supply-state/publish-outcomes/fred-macro.json",
  "data/admin/fred_macro/index.json",
  "data/admin/fred_macro/lkg/fred_macro.json",
]);
assert.deepEqual(fredMacro.stages.success_if_exists.map((entry) => entry.path), [
  "data/macro/fred-macro.json",
]);
assert.deepEqual(fredMacro.exclude, []);

const fredBanking = manifest.workflows[".github/workflows/fetch-fred-banking.yml"];
assert.deepEqual(fredBanking.lanes, ["fred_banking"]);
assert.deepEqual(fredBanking.stages.always_if_exists.map((entry) => entry.path), [
  "data/admin/data-supply-state/detection-attempts/fred_banking.json",
  "data/admin/data-supply-state/publish-outcomes/fred-banking.json",
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
]);
assert.deepEqual(fredBanking.exclude, []);

const nasdaqGiwSox = manifest.workflows[".github/workflows/fetch-nasdaq-giw-sox.yml"];
assert.deepEqual(nasdaqGiwSox.lanes, ["nasdaq_giw_sox"]);
assert.deepEqual(nasdaqGiwSox.stages.always_if_exists.map((entry) => entry.path), [
  "data/admin/data-supply-state/detection-attempts/nasdaq_giw_sox.json",
  "data/admin/data-supply-state/publish-outcomes/nasdaq-giw-sox.json",
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
    path: "data/admin/data-supply-state/publish-outcomes/sentiment.json",
    required: false,
  },
  {
    kind: "file",
    path: "data/admin/sentiment/index.json",
    required: false,
  },
  { kind: "glob", path: "data/admin/sentiment/current/*.json", required: false },
  { kind: "glob", path: "data/admin/sentiment/lkg/*.json", required: false },
  {
    kind: "file",
    path: "data/admin/sentiment/source-observations/crypto.json",
    required: false,
  },
]);
assert.deepEqual(sentiment.stages.success_if_exists, [
  { kind: "glob", path: "data/sentiment/*.json", required: false },
]);
assert.deepEqual(sentiment.exclude, []);

const usIndicesDaily = manifest.workflows[".github/workflows/fetch-us-indices-daily.yml"];
assert.deepEqual(usIndicesDaily.lanes, ["us_indices_daily"]);
assert.deepEqual(usIndicesDaily.stages.always_if_exists, [
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/us_indices_daily.json", required: false },
  { kind: "file", path: "data/admin/data-supply-state/publish-outcomes/us-indices-daily.json", required: false },
  { kind: "directory", path: "data/admin/us-indices-daily", required: false },
]);
assert.deepEqual(usIndicesDaily.stages.success_if_exists, [
  { kind: "file", path: "data/indices/sp500.json", required: false },
  { kind: "file", path: "data/indices/nasdaq.json", required: false },
  { kind: "file", path: "data/indices/nasdaq100.json", required: false },
  { kind: "file", path: "data/indices/sox.json", required: false },
]);
assert.deepEqual(usIndicesDaily.exclude, []);

assert.equal(
  Object.keys(manifest.workflows).some((workflow) => workflow.endsWith("fetch-kospi-dart-payout.yml")),
  false,
  "retired KOSPI DART must not remain in the automatic commit manifest",
);

const fenokEdgeDaily = manifest.workflows[".github/workflows/fenok-edge-daily.yml"];
assert.deepEqual(fenokEdgeDaily.lanes, ["finra_short_volume", "occ_options_volume"]);
assert.deepEqual(fenokEdgeDaily.stages.always_if_exists, [
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/finra_short_volume.json", required: false },
  { kind: "file", path: "data/admin/data-supply-state/publish-outcomes/finra-short-volume.json", required: false },
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
  { kind: "directory", path: "data/yf/estimates-archive", required: true },
]);
assert.deepEqual(yfFinance.stages.success_if_exists, []);
assert.deepEqual(yfFinance.exclude, [
  { kind: "file", path: "data/yf/finance/_summary.json", required: false },
  { kind: "file", path: "data/yf/estimates-archive/_summary.json", required: false },
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
  { kind: "directory", path: "data/admin/yahoo_etf_fallback", required: false },
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/yahoo_etf_fallback.json", required: false },
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/stockanalysis_etf_universe.json", required: false },
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/stockanalysis_stock_financial.json", required: false },
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/stockanalysis_surfaces.json", required: false },
  // Added 2026-08-14: the shadow ETF detail lane still writes an attempt shard,
  // and the artifact packer rejects any path this policy does not own.
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/stockanalysis_etf_detail.json", required: false },
  { kind: "dynamic_set", path: "data/yf/finance", required: false },
  { kind: "directory", path: "100xfenok-next/public/data", required: false },
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
  { kind: "file", path: "data/admin/data-supply-state/publish-outcomes/fred-yardeni.json", required: false },
  { kind: "file", path: "data/admin/fred_yardeni/index.json", required: false },
  { kind: "file", path: "data/admin/fred_yardeni/current/yardney_model.json", required: false },
  { kind: "file", path: "data/admin/fred_yardeni/lkg/yardney_model.json", required: false },
]);
assert.deepEqual(fredYardeni.stages.success_if_exists, [
  { kind: "file", path: "data/yardney/yardney_model.json", required: false },
]);
assert.deepEqual(fredYardeni.exclude, []);

const edgarFilings = manifest.workflows[".github/workflows/fetch-edgar-filings.yml"];
assert.deepEqual(edgarFilings.lanes, ["edgar_filings"]);
assert.deepEqual(edgarFilings.stages.always_if_exists, [
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/edgar_filings.json", required: false },
  { kind: "file", path: "data/admin/data-supply-state/publish-outcomes/edgar-korean-summaries.json", required: false },
  { kind: "file", path: "data/admin/edgar_filings/index.json", required: false },
  { kind: "file", path: "data/admin/edgar_filings/current/edgar_filings.json", required: false },
  { kind: "file", path: "data/admin/edgar_filings/lkg/edgar_filings.json", required: false },
]);
assert.deepEqual(edgarFilings.stages.success_if_exists, [
  { kind: "directory", path: "data/edgar", required: false },
  { kind: "directory", path: "data/edgar-korean-summaries", required: false },
]);
assert.deepEqual(edgarFilings.stages.success_verify_not_plan_if_exists, []);
assert.deepEqual(edgarFilings.exclude, []);

const fdicTier1 = manifest.workflows[".github/workflows/fetch-fdic.yml"];
assert.deepEqual(fdicTier1.lanes, ["fdic_tier1"]);
assert.deepEqual(fdicTier1.stages.always_if_exists, [
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/fdic_tier1.json", required: false },
  { kind: "file", path: "data/admin/data-supply-state/publish-outcomes/fdic-tier1.json", required: false },
  { kind: "file", path: "data/admin/fdic_tier1/index.json", required: false },
  { kind: "file", path: "data/admin/fdic_tier1/lkg/fdic_tier1.json", required: false },
]);
assert.deepEqual(fdicTier1.stages.success_if_exists, [
  { kind: "file", path: "data/macro/fdic-tier1.json", required: false },
]);
assert.deepEqual(fdicTier1.exclude, []);

const slickchartsDaily = manifest.workflows[".github/workflows/slickcharts-daily.yml"];
assert.deepEqual(slickchartsDaily.lanes, ["slickcharts"]);
assert.deepEqual(slickchartsDaily.stages.always_if_exists, [
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/slickcharts.json", required: false },
  { kind: "file", path: "data/admin/data-supply-state/publish-outcomes/slickcharts-daily.json", required: false },
  { kind: "directory", path: "data/admin/slickcharts-daily-delivery", required: false },
  { kind: "directory", path: "data/admin/slickcharts-composite-recovery", required: false },
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
  { kind: "file", path: "data/admin/data-supply-state/publish-outcomes/slickcharts-weekly.json", required: false },
  { kind: "directory", path: "data/admin/slickcharts-composite-recovery", required: false },
]);
assert.deepEqual(slickchartsWeekly.stages.success_if_exists, [
  { kind: "file", path: "data/slickcharts/sp500.json", required: true },
  { kind: "file", path: "data/slickcharts/magnificent7.json", required: true },
  { kind: "file", path: "data/slickcharts/etf.json", required: true },
  { kind: "file", path: "data/slickcharts/berkshire.json", required: true },
]);
assert.deepEqual(slickchartsWeekly.exclude, []);

const slickchartsSymbols = manifest.workflows[".github/workflows/slickcharts-symbols.yml"];
assert.deepEqual(slickchartsSymbols.lanes, ["slickcharts"]);
assert.deepEqual(slickchartsSymbols.stages.always_if_exists, [
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/slickcharts.json", required: false },
  { kind: "file", path: "data/admin/data-supply-state/publish-outcomes/slickcharts-symbols.json", required: false },
  { kind: "directory", path: "data/admin/slickcharts-composite-recovery", required: false },
]);
assert.deepEqual(slickchartsSymbols.stages.success_if_exists, [
  { kind: "file", path: "data/slickcharts/symbols.json", required: true },
  { kind: "file", path: "data/slickcharts/symbols-all.json", required: true },
]);
assert.deepEqual(slickchartsSymbols.exclude, []);
const slickchartsMonthly = manifest.workflows[".github/workflows/slickcharts-monthly.yml"];
assert.deepEqual(slickchartsMonthly.lanes, ["slickcharts"]);
assert.deepEqual(slickchartsMonthly.stages.always_if_exists, [
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/slickcharts.json", required: false },
  { kind: "file", path: "data/admin/data-supply-state/publish-outcomes/slickcharts-monthly.json", required: false },
  { kind: "directory", path: "data/admin/slickcharts-composite-recovery", required: false },
]);
assert.deepEqual(slickchartsMonthly.stages.success_if_exists, [
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
assert.deepEqual(slickchartsMonthly.exclude, []);

const slickchartsHistory = manifest.workflows[".github/workflows/slickcharts-history.yml"];
assert.deepEqual(slickchartsHistory.lanes, ["slickcharts"]);
assert.deepEqual(slickchartsHistory.stages.always_if_exists, [
  { kind: "file", path: "data/admin/data-supply-state/detection-attempts/slickcharts.json", required: false },
  { kind: "file", path: "data/admin/data-supply-state/publish-outcomes/slickcharts-history.json", required: false },
  { kind: "directory", path: "data/admin/slickcharts-composite-recovery", required: false },
]);
assert.deepEqual(slickchartsHistory.stages.success_if_exists, [
  { kind: "file", path: "data/slickcharts/stocks-returns.json", required: true },
  { kind: "file", path: "data/slickcharts/stocks-dividends.json", required: true },
  { kind: "file", path: "data/slickcharts/stocks-dividends-recent.json", required: true },
  { kind: "file", path: "data/slickcharts/stocks-dividends-historical.json", required: true },
  { kind: "directory", path: "data/slickcharts/stocks", required: true },
]);
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
]);
assert.ok(buildStocksAnalyzer.stages.always_if_exists.every((entry) => entry.required === false));
assert.deepEqual(buildStocksAnalyzer.stages.success_if_exists, []);
assert.deepEqual(buildStocksAnalyzer.exclude, []);

const pipelineFailureAlarm = manifest.workflows[".github/workflows/pipeline-failure-alarm.yml"];
assert.deepEqual(pipelineFailureAlarm.lanes, []);
assert.deepEqual(pipelineFailureAlarm.stages.always_if_exists, [
  { kind: "file", path: "data/admin/alarm-state.json", required: false },
]);
assert.deepEqual(pipelineFailureAlarm.stages.success_if_exists, []);
assert.deepEqual(pipelineFailureAlarm.exclude, []);

const coordinator = manifest.workflows[".github/workflows/coordinate-computed-signals.yml"];
assert.deepEqual(coordinator.lanes, []);
assert.deepEqual(coordinator.stages.always_if_exists, [
  {
    kind: "file",
    path: "data/admin/data-supply-state/publish-outcomes/computed-signals.json",
    required: false,
  },
]);
assert.deepEqual(coordinator.stages.success_if_exists, []);
assert.deepEqual(coordinator.stages.success_verify_not_plan_if_exists, []);
assert.deepEqual(coordinator.stages.required_on_success, []);
assert.deepEqual(coordinator.exclude, []);

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

// Central commit paths are derived from the route table rather than
// hand-copied, so the rebuilt projection is compared against the committed
// artifact semantically: the same 77-path set and count, with byte equality
// everywhere else once the derived central ordering is normalized.
const rebuilt = buildLaneCommitManifest(LANE_REGISTRY);
const rebuiltCentral = rebuilt.update_manifest.central_commit_paths;
const committedCentral = manifest.update_manifest.central_commit_paths;
assert.equal(rebuiltCentral.length, committedCentral.length, "derived central list must keep the committed path count");
assert.deepEqual(
  [...rebuiltCentral].sort(),
  [...committedCentral].sort(),
  "derived central list must be semantically identical to the committed path set",
);
function withSortedCentral(artifact) {
  const draft = structuredClone(artifact);
  draft.update_manifest.central_commit_paths = [...draft.update_manifest.central_commit_paths].sort();
  const workflow = draft.workflows[".github/workflows/update-manifest.yml"];
  workflow.stages.always_if_exists = workflow.stages.always_if_exists
    .map((spec) => ({ ...spec }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return draft;
}
assert.deepEqual(
  withSortedCentral(rebuilt),
  withSortedCentral(manifest),
  "projection must match the committed manifest once the derived central ordering is normalized",
);

// Derivation, not a copied oracle: every route destination is carried into
// the final central list, and the hand-maintained base never repeats one.
const derived = deriveCentralCommitPaths();
assert.deepEqual(derived, rebuiltCentral, "generator must publish exactly the derived central list");
assert.equal(derived.length, CENTRAL_COMMIT_PATHS.length + UPDATE_MANIFEST_MATERIALIZATIONS.length);
const derivedSet = new Set(derived);
for (const route of UPDATE_MANIFEST_MATERIALIZATIONS) {
  assert.equal(derivedSet.has(route.destination), true, `derived central list must carry route destination: ${route.destination}`);
  assert.equal(CENTRAL_COMMIT_PATHS.includes(route.destination), false, `hand-maintained base must not repeat route destination: ${route.destination}`);
}
// Adding a route appends its destination in route-table order without any
// base edit, and keeps every pre-existing entry at its exact position.
const probeRoute = {
  source: "data/computed/fenok_route_probe.json",
  destination: "100xfenok-next/public/data/computed/fenok_route_probe.json",
  mode: "cp_file",
  delete: false,
  excludes: [],
  required: true,
  trailing_slash: false,
};
const probed = deriveCentralCommitPaths([...UPDATE_MANIFEST_MATERIALIZATIONS, probeRoute]);
assert.deepEqual(probed.slice(0, derived.length), derived, "pre-existing central entries must keep their exact positions");
assert.deepEqual(probed.slice(-1), [probeRoute.destination], "the new route destination must be appended in route-table order");
assert.equal(new Set(probed).size, probed.length, "derived central list must stay unique after a route addition");
// Duplicate or base-colliding destinations fail closed at derivation time.
assert.throws(
  () => deriveCentralCommitPaths([UPDATE_MANIFEST_MATERIALIZATIONS[0], UPDATE_MANIFEST_MATERIALIZATIONS[0]]),
  /lane-commit-manifest/,
  "duplicate materialization destinations must be rejected",
);
assert.throws(
  () => deriveCentralCommitPaths([{ ...probeRoute, destination: CENTRAL_COMMIT_PATHS[0] }]),
  /lane-commit-manifest/,
  "a route destination colliding with the central base must be rejected",
);

// The emitter is deterministic and --check style validation catches a stale artifact.
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lane-commit-manifest-"));
const tempPath = path.join(tempRoot, "manifest.json");
emitLaneCommitManifest({ registry: LANE_REGISTRY, outputPath: tempPath });
assert.deepEqual(JSON.parse(fs.readFileSync(tempPath, "utf8")), rebuilt, "emitted manifest must be byte-identical to the built projection");

// The kind classifier itself is exercised on representatives of both classes:
// a known JSON central path is a file and a known materialization route
// directory is a directory. Parity and central-staging tests consume the same
// exported authority, so the emission rule cannot drift from the rule they
// verify without failing here.
assert.equal(centralCommitPathKind("data/computed/signals.json"), "file", "a known JSON central path must classify as file");
assert.equal(centralCommitPathKind("100xfenok-next/public/data/slickcharts"), "directory", "a known route directory must classify as directory");

// A value-changing registry edit must change the projection and digest.
const changedRegistry = structuredClone(LANE_REGISTRY);
changedRegistry.lanes[0].label = `${changedRegistry.lanes[0].label} changed`;
validateLaneRegistry(changedRegistry);
const changed = buildLaneCommitManifest(changedRegistry);
assert.notEqual(changed.registry_digest, manifest.registry_digest);
assert.notDeepEqual(changed, manifest);

console.log("test-lane-commit-manifest: ok");
