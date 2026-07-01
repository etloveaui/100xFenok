#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const REPO_ROOT = path.resolve(ROOT, "..");

const SOURCE_NEW_ETFS_REL = "data/stockanalysis/surfaces/new_etfs.json";
const PUBLIC_NEW_ETFS_REL = "100xfenok-next/public/data/stockanalysis/surfaces/new_etfs.json";
const ETF_SIGNAL_SUMMARY_REL = "data/computed/fenok_etf_signals_summary.json";
const CORE_ADMIN_REL = "data/admin/fenok-etf-core-daily-basket.json";
const CORE_SUMMARY_REL = "data/computed/fenok_etf_core_daily_basket_summary.json";
const CORE_PUBLIC_SUMMARY_REL = "100xfenok-next/public/data/computed/fenok_etf_core_daily_basket_summary.json";

const ROUTE_REL = "100xfenok-next/src/app/api/data/stockanalysis/etf-snapshot/route.ts";
const NEW_ETFS_UI_REL = "100xfenok-next/src/app/etfs/new/NewEtfsList.tsx";

function abs(relPath) {
  return path.join(REPO_ROOT, relPath);
}

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(abs(relPath), "utf8"));
}

function readText(relPath) {
  return fs.readFileSync(abs(relPath), "utf8");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function rowsFromSurface(payload) {
  const records = asArray(payload?.records);
  const tableRecords = asArray(payload?.tables).flatMap((table) => asArray(asRecord(table)?.records));
  return [...records, ...tableRecords].map(asRecord).filter(Boolean);
}

function normTicker(value) {
  return String(value ?? "").trim().toUpperCase().replaceAll(".", "-");
}

function tickerFromRow(row) {
  return normTicker(row?.s ?? row?.symbol ?? row?.ticker);
}

function normalizedJson(value) {
  return JSON.stringify(value);
}

function intersection(left, right) {
  return [...left].filter((value) => right.has(value)).sort();
}

function requireContains(errors, relPath, text, needles) {
  for (const needle of needles) {
    if (!text.includes(needle)) errors.push(`${relPath} missing marker: ${needle}`);
  }
}

const sourceNewEtfs = readJson(SOURCE_NEW_ETFS_REL);
const publicNewEtfs = readJson(PUBLIC_NEW_ETFS_REL);
const signalSummary = readJson(ETF_SIGNAL_SUMMARY_REL);
const coreAdmin = readJson(CORE_ADMIN_REL);
const coreSummary = readJson(CORE_SUMMARY_REL);
const corePublicSummary = readJson(CORE_PUBLIC_SUMMARY_REL);
const routeText = readText(ROUTE_REL);
const newEtfsUiText = readText(NEW_ETFS_UI_REL);

const errors = [];
const newEtfRows = rowsFromSurface(sourceNewEtfs);
const newEtfTickers = new Set(newEtfRows.map(tickerFromRow).filter(Boolean));
const signalTickers = new Set(asArray(signalSummary?.rows).map((row) => normTicker(row?.ticker)).filter(Boolean));
const expectedSignalOverlap = intersection(newEtfTickers, signalTickers);
const excludedNewEtfCount = Number(coreAdmin?.coverage?.excluded_reason_counts?.new_etf_radar_only ?? 0);

if (normalizedJson(sourceNewEtfs) !== normalizedJson(publicNewEtfs)) {
  errors.push("source new_etfs surface and public mirror differ");
}
if (newEtfTickers.size !== newEtfRows.length) {
  errors.push(`new_etfs surface must have unique non-empty tickers (${newEtfTickers.size}/${newEtfRows.length})`);
}
if (Number(coreAdmin?.coverage?.new_etf_radar_count) !== newEtfRows.length) {
  errors.push(`core admin new_etf_radar_count must equal source rows (${coreAdmin?.coverage?.new_etf_radar_count ?? "missing"} != ${newEtfRows.length})`);
}
if (Number(coreSummary?.coverage?.new_etf_radar_count) !== newEtfRows.length) {
  errors.push(`core summary new_etf_radar_count must equal source rows (${coreSummary?.coverage?.new_etf_radar_count ?? "missing"} != ${newEtfRows.length})`);
}
if (Number(corePublicSummary?.coverage?.new_etf_radar_count) !== newEtfRows.length) {
  errors.push(`public core summary new_etf_radar_count must equal source rows (${corePublicSummary?.coverage?.new_etf_radar_count ?? "missing"} != ${newEtfRows.length})`);
}
if (excludedNewEtfCount !== expectedSignalOverlap.length) {
  errors.push(`new_etf_radar_only exclusion count must match signal overlap (${excludedNewEtfCount} != ${expectedSignalOverlap.length})`);
}

const coreAdminTickers = new Set(asArray(coreAdmin?.rows).map((row) => normTicker(row?.ticker)).filter(Boolean));
const coreSummaryTickers = new Set(asArray(coreSummary?.rows).map((row) => normTicker(row?.ticker)).filter(Boolean));
const corePublicSummaryTickers = new Set(asArray(corePublicSummary?.rows).map((row) => normTicker(row?.ticker)).filter(Boolean));
const adminIntersection = intersection(newEtfTickers, coreAdminTickers);
const summaryIntersection = intersection(newEtfTickers, coreSummaryTickers);
const publicSummaryIntersection = intersection(newEtfTickers, corePublicSummaryTickers);

if (adminIntersection.length > 0) errors.push(`new ETF radar tickers must not enter core admin rows: ${adminIntersection.join(",")}`);
if (summaryIntersection.length > 0) errors.push(`new ETF radar tickers must not enter core summary rows: ${summaryIntersection.join(",")}`);
if (publicSummaryIntersection.length > 0) errors.push(`new ETF radar tickers must not enter public core summary rows: ${publicSummaryIntersection.join(",")}`);
if (coreAdmin?.readiness?.public_done_claim_allowed !== false) errors.push("core admin public_done_claim_allowed must stay false");
if (coreSummary?.readiness?.public_done_claim_allowed !== false) errors.push("core summary public_done_claim_allowed must stay false");

requireContains(errors, ROUTE_REL, routeText, [
  'const NEW_ETF_RADAR_STATUS = "watchlist_only"',
  'const NEW_ETF_CORE_BLOCKERS = ["new_etf_radar_only", "missing_core_scoring_proof"]',
  "core_candidate_allowed: false",
  "core_candidate_blockers: [...NEW_ETF_CORE_BLOCKERS]",
]);
requireContains(errors, NEW_ETFS_UI_REL, newEtfsUiText, [
  'type RadarStatus = "watchlist_only" | "unknown"',
  'watchlist_only: "관찰 목록"',
  "coreCandidateLabel",
]);

if (errors.length > 0) {
  console.error("[fenok-etf-new-radar-gate] FAIL");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `[fenok-etf-new-radar-gate] ok `
  + `(watchlist=${newEtfRows.length}, signal_overlap=${expectedSignalOverlap.length}, core_intersection=0, public_mirror=true)`
);
