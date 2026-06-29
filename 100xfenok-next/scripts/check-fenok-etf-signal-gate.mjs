#!/usr/bin/env node
/**
 * Fenok ETF signal gate check.
 *
 * Validates that the ETF lane emits real scored rows in its own artifact and
 * does not leak into the stock signal lens. Missing signal scores are allowed
 * (reported as null), but the row shape and counts must be consistent.
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
const etfSummary = readJson("data/computed/fenok_etf_signals_summary.json");
const etfUniverse = readJson("data/stockanalysis/etf_universe.json");
const nonVanillaPatterns = [
  /ultrashort/i,
  /ultrapro/i,
  /\b[23]x\b/i,
  /\b-[123]x\b/i,
  /\binverse\b/i,
  /\bleveraged\b/i,
  /\bdaily\s+(bull|bear)\b/i,
  /\/leveraged-and-inverse\//i,
  /\bsingle[-\s]?stock\b/i,
];
function isNonVanilla(row) {
  const classification = row?.classification;
  if (classification && typeof classification === "object"
    && (classification.is_leveraged || classification.is_inverse || classification.is_single_stock)) {
    return true;
  }
  const text = [row?.ticker, row?.name, row?.etf_website, row?.provider_page].filter(Boolean).join(" ");
  return nonVanillaPatterns.some((pattern) => pattern.test(text));
}
const excludedVanillaTickers = new Set(
  (Array.isArray(etfUniverse?.records) ? etfUniverse.records : [])
    .filter(isNonVanilla)
    .map((row) => String(row?.ticker ?? "").trim().toUpperCase())
    .filter(Boolean),
);

function checkFile(payload, name) {
  if (payload?.asset_type !== "etf") {
    errors.push(`${name} asset_type must be etf, got ${payload?.asset_type}`);
  }
  const eligible = Number(payload?.coverage?.eligible_etf_count);
  const scored = Number(payload?.coverage?.scored_public_etf);
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];

  if (!Number.isFinite(scored) || scored <= 0) {
    errors.push(`${name} scored_public_etf must be > 0, got ${payload?.coverage?.scored_public_etf}`);
  }
  if (scored > eligible) {
    errors.push(`${name} scored_public_etf (${scored}) cannot exceed eligible_etf_count (${eligible})`);
  }
  if (rows.length !== scored) {
    errors.push(`${name} rows length (${rows.length}) must equal scored_public_etf (${scored})`);
  }

  const badRows = rows.filter((row) => row?.asset_type !== "etf");
  if (badRows.length > 0) {
    const tickers = badRows.slice(0, 5).map((row) => row.ticker).join(", ");
    errors.push(`${name} contains ${badRows.length} non-etf row(s); first 5: ${tickers}`);
  }
  const excludedRows = rows.filter((row) => excludedVanillaTickers.has(String(row?.ticker ?? "").trim().toUpperCase()));
  if (excludedRows.length > 0) {
    const tickers = excludedRows.slice(0, 5).map((row) => row.ticker).join(", ");
    errors.push(`${name} contains ${excludedRows.length} leveraged/inverse/single-stock ETF row(s); first 5: ${tickers}`);
  }

  const noScores = rows.filter((row) => !row.scores || typeof row.scores !== "object");
  if (noScores.length > 0) {
    errors.push(`${name} contains ${noScores.length} row(s) without a scores object`);
  }
  for (const row of rows) {
    for (const [key, value] of Object.entries(row.scores ?? {})) {
      if (value == null) continue;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
        errors.push(`${name} ${row.ticker}.${key} must be null or 0..100 number`);
      }
    }
  }
}

checkFile(etfSignals, "fenok_etf_signals.json");
checkFile(etfSummary, "fenok_etf_signals_summary.json");

if (Array.isArray(etfSignals?.signal_keys) && Array.isArray(etfSummary?.signal_keys)) {
  const fullKeys = etfSignals.signal_keys.join(",");
  const sumKeys = etfSummary.signal_keys.join(",");
  if (fullKeys !== sumKeys) {
    errors.push(`signal_keys mismatch: fenok_etf_signals.json=[${fullKeys}] vs summary=[${sumKeys}]`);
  }
}

const stockSignals = readJson("data/computed/fenok_signals.json");
const stockRows = Array.isArray(stockSignals?.rows) ? stockSignals.rows : [];
const leakedEtfRows = stockRows.filter((row) => (row?.asset_type ?? "stock") !== "stock");
if (leakedEtfRows.length > 0) {
  const tickers = leakedEtfRows.slice(0, 5).map((row) => row.symbol ?? row.ticker).join(", ");
  errors.push(`fenok_signals.json contains ${leakedEtfRows.length} non-stock row(s); first 5: ${tickers}`);
}

if (errors.length > 0) {
  console.error("[fenok-etf-signal-gate] FAIL");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`[fenok-etf-signal-gate] ok (scored_public_etf=${etfSignals?.coverage?.scored_public_etf}, no ETF rows in stock lens)`);
