#!/usr/bin/env node
/**
 * Fenok ETF signal gate check.
 *
 * Fails closed if the ETF lane emits scored rows before the scoring formulas
 * are implemented, or if ETF rows leak into the stock signal lens.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

function readJson(relPath) {
  const abs = path.join(repoRoot, relPath);
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (error) {
    throw new Error(`read ${relPath}: ${error.message}`);
  }
}

const errors = [];

const etfSignals = readJson("data/computed/fenok_etf_signals.json");
if (Number(etfSignals?.coverage?.scored_public_etf) !== 0) {
  errors.push(`fenok_etf_signals.json scored_public_etf must be 0, got ${etfSignals?.coverage?.scored_public_etf}`);
}
if (Array.isArray(etfSignals?.rows) && etfSignals.rows.length !== 0) {
  errors.push(`fenok_etf_signals.json rows must be empty, got ${etfSignals.rows.length}`);
}

const etfSummary = readJson("data/computed/fenok_etf_signals_summary.json");
if (etfSummary?.asset_type !== "etf") {
  errors.push(`fenok_etf_signals_summary.json asset_type must be etf, got ${etfSummary?.asset_type}`);
}
if (Number(etfSummary?.coverage?.scored_public_etf) !== 0) {
  errors.push(`fenok_etf_signals_summary.json scored_public_etf must be 0, got ${etfSummary?.coverage?.scored_public_etf}`);
}
if (Array.isArray(etfSummary?.rows) && etfSummary.rows.length !== 0) {
  errors.push(`fenok_etf_signals_summary.json rows must be empty, got ${etfSummary.rows.length}`);
}

const stockSignals = readJson("data/computed/fenok_signals.json");
const stockRows = Array.isArray(stockSignals?.rows) ? stockSignals.rows : [];
const leakedEtfRows = stockRows.filter((row) => (row?.asset_type ?? "stock") !== "stock");
if (leakedEtfRows.length > 0) {
  const tickers = leakedEtfRows.slice(0, 5).map((row) => row.symbol).join(", ");
  errors.push(`fenok_signals.json contains ${leakedEtfRows.length} non-stock row(s); first 5: ${tickers}`);
}

if (errors.length > 0) {
  console.error("[fenok-etf-signal-gate] FAIL");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("[fenok-etf-signal-gate] ok (scored_public_etf=0, no ETF rows in stock lens)");
